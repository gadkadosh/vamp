// @vitest-environment happy-dom
import { act } from "react";
import { expect, test, vi } from "vite-plus/test";
import { locate } from "../../src/client/space";
import { STEP_SECONDS } from "../../src/shared/score";
import { TestAudioContext } from "../audio-context";
import { setupAppTests, tones } from "./app-harness";

const app = setupAppTests();
const {
  size,
  renderApp,
  unmountApp,
  frame,
  glowAt,
  element,
  surface,
  button,
  seedId,
  seedSelector,
  notes,
  key,
  pointer,
  add,
  enterSurface,
  expectSelected,
} = app;

function compactNeighbors() {
  act(() => {
    size.width = 390;
    app.observers.get(surface())!([{ contentRect: size }]);
    element(seedSelector("mallet", "G4", 8)).focus();
  });
  key("ArrowDown"); // Give these neighbors the same E4 pitch.
  for (let step = 0; step < 3; step++) key("ArrowLeft");
  return element(seedSelector("mallet", "G4", 8));
}

test.each(["select", "drag", "remove"])(
  "overlapping mobile targets %s the nearest note, not the topmost button",
  (action) => {
    const topmost = compactNeighbors();
    const neighbor = element(seedSelector("mallet", "E4", 4));
    const before = notes();
    const center = locate({ id: "2", step: 4, tone: tones.malletE4 }, size);
    const hit = topmost.getBoundingClientRect();
    expect(Math.hypot(center.x - (hit.x + 18), center.y - (hit.y + 18))).toBeLessThan(18);
    // The browser delivers this point to the later, overlapping button, not note 2.
    pointer("pointerdown", 4, tones.malletE4, topmost, { button: action === "remove" ? 2 : 0 });
    if (action === "remove") {
      expect(document.querySelector(seedSelector("mallet", "E4", 4))).toBeNull();
      expect(notes()).toEqual(before.filter((_, index) => index !== 1));
      return;
    }
    if (action === "drag") pointer("pointermove", 2, tones.malletE4);
    pointer("pointerup", action === "drag" ? 2 : 4, tones.malletE4);
    expect(document.activeElement).toBe(neighbor);
    expect(neighbor.getAttribute("aria-pressed")).toBe("true");
    expect(topmost.getAttribute("aria-label")).toBe(before[2]);
    if (action === "drag")
      expect(neighbor.getAttribute("aria-label")).toContain("beat position 3 of 32");
    else expect(notes()).toEqual(before);
  },
);

test("mobile pointer hits follow a settling note rather than its committed landing point", () => {
  const light = compactNeighbors();
  pointer("pointerdown", 5, tones.malletE4, light);
  pointer("pointermove", 4.4, tones.malletE4);
  pointer("pointerup", 4.4, tones.malletE4);
  // The occupied landing at step 4 sends it back to step 5, but it is still near step 4.
  key("Escape");
  frame(18);
  pointer("pointerdown", 4.4, tones.malletE4);
  pointer("pointerup", 4.4, tones.malletE4);
  expect(document.activeElement).toBe(light);
  expect(light.getAttribute("aria-pressed")).toBe("true");
  expect(light.getAttribute("aria-label")).toContain("beat position 6 of 32");
});

test("an unchanged paused surface schedules no animation frames or repeated redraws", () => {
  expect(app.frames.size).toBe(0);
  const count = app.draws.mock.calls.length;
  frame(1000);
  expect(app.draws).toHaveBeenCalledTimes(count);
  expect(app.frames.size).toBe(0);
});

test("an unavailable canvas context does not break editing or playback controls", async () => {
  await unmountApp();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  await renderApp();
  expect(notes()).toHaveLength(20);
  act(() => surface().focus());
  key("Enter");
  expect(notes()).toHaveLength(21);
  await act(async () => button("Play loop").click());
  expect(TestAudioContext.instances[0].state).toBe("running");
  expect(button("Pause loop").disabled).toBe(false);
  expect(app.frames.size).toBe(0);
});

test("the first loop illuminates only notes whose scheduled onset has actually arrived", async () => {
  await act(async () => button("Play loop").click());
  const context = TestAudioContext.instances[0];
  context.currentTime = 0.05;
  frame();
  expect(glowAt(0, tones.malletC4)).toBe(225);
  expect(glowAt(30, tones.keysE5)).toBe(155);
  expect(glowAt(28, tones.malletE4)).toBe(155);
});

test("idle edits redraw once and unrelated status changes do not redraw the canvas", () => {
  const before = app.draws.mock.calls.length;
  add(3, tones.malletA3);
  expect(app.draws.mock.calls.length).toBeGreaterThan(before);
  expect(app.frames.size).toBe(0);
  const afterEdit = app.draws.mock.calls.length;
  frame(5000);
  expect(app.draws).toHaveBeenCalledTimes(afterEdit);
  expect(app.frames.size).toBe(0);
});

test("settling keeps hit targets aligned and stops requesting frames at its final position", () => {
  add(3.4, tones.malletA3 + 0.2);
  const light = element("[data-light]:last-of-type");
  const from = locate({ id: "21", step: 3.4, tone: tones.malletA3 + 0.2 }, size);
  const to = locate({ id: "21", step: 3, tone: tones.malletA3 }, size);
  expect(app.frames.size).toBe(1);
  expect(parseFloat(light.style.left)).toBeCloseTo(from.x);
  frame(90);
  const x = parseFloat(light.style.left);
  const y = parseFloat(light.style.top);
  expect(x).toBeLessThan(from.x);
  expect(x).toBeGreaterThan(to.x);
  expect(
    [...app.glows.keys()].some((key) => {
      const [px, py] = key.split(":").map(Number);
      return Math.abs(px - x) < 0.001 && Math.abs(py - y) < 0.001;
    }),
  ).toBe(true);
  frame(100);
  expect(parseFloat(light.style.left)).toBeCloseTo(to.x);
  expect(parseFloat(light.style.top)).toBeCloseTo(to.y);
  expect(app.frames.size).toBe(0);
  const count = app.draws.mock.calls.length;
  frame(500);
  expect(app.draws).toHaveBeenCalledTimes(count);
});

test("turning on reduced motion snaps a settling light and stops its animation", () => {
  add(3.4, tones.malletA3 + 0.2);
  expect(app.frames.size).toBe(1);
  act(() => {
    app.preference.matches = true;
    app.preference.dispatchEvent(new Event("change"));
  });
  expect(app.frames.size).toBe(0);
  const to = locate({ id: "21", step: 3, tone: tones.malletA3 }, size);
  expect(parseFloat(element("[data-light]:last-of-type").style.left)).toBeCloseTo(to.x);
});

test("collision feedback expires with a single redraw rather than a continuous frame loop", () => {
  pointer("pointerdown", 0, tones.bassE2, surface(), { shiftKey: true });
  pointer("pointerup", 0, tones.bassE2);
  expect(app.frames.size).toBe(0);
  const before = app.draws.mock.calls.length;
  frame(400);
  expect(app.draws).toHaveBeenCalledTimes(before);
  frame(400);
  expect(app.draws).toHaveBeenCalledTimes(before + 1);
  expect(app.frames.size).toBe(0);
});

test("pause holds the actual bloom without drawing, and resume restarts the animation", async () => {
  await act(async () => button("Play loop").click());
  const context = TestAudioContext.instances[0];
  context.currentTime = 0.05;
  frame();
  expect(glowAt(0, tones.malletC4)).toBe(225);
  await act(async () => button("Pause loop").click());
  expect(app.frames.size).toBe(0);
  const paused = app.draws.mock.calls.length;
  frame(1000);
  expect(app.draws).toHaveBeenCalledTimes(paused);
  expect(glowAt(0, tones.malletC4)).toBe(225);
  await act(async () => button("Play loop").click());
  expect(app.frames.size).toBe(1);
  context.currentTime = 0.2;
  frame();
  expect(glowAt(0, tones.malletC4)).toBeLessThan(225);
  expect(glowAt(0, tones.malletC4)).toBeGreaterThan(155);
});

test("adding a light at the current buffered beat does not invent a strike", async () => {
  await act(async () => button("Play loop").click());
  const context = TestAudioContext.instances[0];
  context.currentTime = 0.05 + 16 * STEP_SECONDS;
  frame();
  add(16, tones.malletA3);
  expect(glowAt(16, tones.malletA3)).toBe(155);
});

test("repitching a ringing light does not transfer its bloom to the new pitch", async () => {
  await act(async () => button("Play loop").click());
  const context = TestAudioContext.instances[0];
  context.currentTime = 0.05;
  frame();
  expect(glowAt(0, tones.malletC4)).toBe(225);
  enterSurface();
  key("PageDown");
  key("PageDown");
  key("ArrowUp");
  expectSelected(seedId("mallet", "C4", 0));
  expect(glowAt(0, tones.malletD4)).toBe(155);
});

test("playback does not rewrite static hit positions or poll toolbar layout every frame", async () => {
  const width = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get");
  const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get");
  enterSurface();
  key("PageUp");
  await act(async () => button("Play loop").click());
  const light = element(seedSelector("keys", "E5", 30));
  const toolbar = element(".note-tools");
  const mutations: MutationRecord[] = [];
  const observer = new MutationObserver((records) => mutations.push(...records));
  observer.observe(light, { attributes: true, attributeFilter: ["style"] });
  observer.observe(toolbar, { attributes: true, attributeFilter: ["style"] });
  const widths = width.mock.calls.length;
  const heights = height.mock.calls.length;
  const context = TestAudioContext.instances[0];
  for (let i = 1; i <= 5; i++) {
    context.currentTime = i * 0.025;
    frame();
  }
  mutations.push(...observer.takeRecords());
  observer.disconnect();
  expect(mutations).toEqual([]);
  expect(width).toHaveBeenCalledTimes(widths);
  expect(height).toHaveBeenCalledTimes(heights);
  expect(app.frames.size).toBe(1);
});

test("toolbar resizing repositions it once without starting an idle frame loop", () => {
  let width = 180;
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("note-tools") ? width : 0;
  });
  enterSurface();
  key("PageUp");
  const toolbar = element(".note-tools");
  const left = parseFloat(toolbar.style.left);
  act(() => {
    width = 400;
    app.observers.get(toolbar)!([{ contentRect: size }]);
  });
  expect(app.frames.size).toBe(1);
  frame();
  expect(parseFloat(toolbar.style.left)).toBeLessThan(left);
  expect(app.frames.size).toBe(0);
});

test("resizing a paused surface redraws the canvas and relocates hit targets without an idle loop", () => {
  enterSurface();
  key("PageUp");
  const resized = { width: 1100, height: size.height };
  const before = app.draws.mock.calls.length;
  act(() => app.observers.get(surface())!([{ contentRect: resized }]));
  const target = locate({ id: "16", step: 30, tone: tones.keysE5 }, resized);
  expect(parseFloat(element(seedSelector("keys", "E5", 30)).style.left)).toBeCloseTo(target.x);
  expect(element<HTMLCanvasElement>("canvas").width).toBe(1100);
  expect(app.draws.mock.calls.length).toBeGreaterThan(before);
  expect(app.frames.size).toBe(0);
});
