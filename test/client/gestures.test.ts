// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { App } from "../../src/client/App";
import { locate } from "../../src/client/space";
import { DEFAULT_VOLUME, STEP_SECONDS } from "../../src/client/score";
import { deferred, TestAudioContext } from "../audio-context";

const size = { width: 900, height: 600 };
let root: Root;
let frames: Map<number, FrameRequestCallback>;
let wallTime: number;
let draws: ReturnType<typeof vi.fn<() => void>>;
let glows: Map<string, number>;
let preference: EventTarget & { matches: boolean };
let observers: Map<Element, (entries: { contentRect: typeof size }[]) => void>;

beforeEach(async () => {
  size.width = 900;
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  preference = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("matchMedia", () => preference);
  TestAudioContext.instances = [];
  vi.stubGlobal("AudioContext", TestAudioContext);
  frames = new Map();
  wallTime = 0;
  draws = vi.fn();
  glows = new Map();
  observers = new Map();
  vi.spyOn(performance, "now").mockImplementation(() => wallTime);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private callback: (entries: { contentRect: typeof size }[]) => void;
      private target: Element | null = null;
      constructor(callback: (entries: { contentRect: typeof size }[]) => void) {
        this.callback = callback;
      }
      observe(target: Element) {
        this.target = target;
        observers.set(target, this.callback);
        this.callback([{ contentRect: size }]);
      }
      disconnect() {
        if (this.target) observers.delete(this.target);
      }
    },
  );
  // Only browser geometry and drawing are fake; App, PointSpace, and history run together.
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.matches("[data-light]")) {
      return new DOMRect(parseFloat(this.style.left) - 18, parseFloat(this.style.top) - 18, 36, 36);
    }
    return new DOMRect(0, 0, size.width, size.height);
  });
  const context = {
    setTransform() {},
    clearRect() {
      draws();
      glows.clear();
    },
    beginPath() {},
    arc() {},
    fill() {},
    stroke() {},
    moveTo() {},
    lineTo() {},
    setLineDash() {},
    fillRect() {},
    createRadialGradient: (...args: number[]) => {
      const key = `${args[0]}:${args[1]}`;
      glows.set(key, Math.max(glows.get(key) ?? 0, args[5]));
      return { addColorStop() {} };
    },
    createLinearGradient: () => ({ addColorStop() {} }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(StrictMode, null, createElement(App))));
});

afterEach(async () => {
  await act(async () => root.unmount());
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function frame(milliseconds = 16) {
  act(() => {
    wallTime += milliseconds;
    vi.advanceTimersByTime(milliseconds);
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(wallTime);
  });
}

function glowAt(step: number, tone: number) {
  const position = locate({ id: 0, step, tone }, size);
  return glows.get(`${position.x}:${position.y}`);
}

function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  expect(found).not.toBeNull();
  return found!;
}

function surface() {
  return element(".point-space");
}

function button(label: string) {
  return element<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

function notes() {
  return [...document.querySelectorAll("[data-light]")].map((light) =>
    light.getAttribute("aria-label"),
  );
}

function click(target: HTMLElement) {
  act(() => target.click());
}

function blur() {
  act(() => {
    window.dispatchEvent(new Event("blur"));
  });
}

function key(key: string, modifiers: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  act(() => {
    (document.activeElement ?? surface()).dispatchEvent(event);
  });
  return event;
}

function pointer(
  type: string,
  step: number,
  tone: number,
  target = surface(),
  options: PointerEventInit = {},
) {
  const position = locate({ id: 0, step, tone }, size);
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        button: 0,
        bubbles: true,
        cancelable: true,
        clientX: position.x,
        clientY: position.y,
        ...options,
      }),
    );
  });
}

function add(step: number, tone: number) {
  pointer("pointerdown", step, tone);
  pointer("pointerup", step, tone);
}

function paint() {
  pointer("pointerdown", 6, 9, surface(), { shiftKey: true });
  pointer("pointermove", 8, 10);
}

function drag() {
  pointer("pointerdown", 0, 6, element('[data-light="1"]'));
  pointer("pointermove", 2, 6);
}

function expectFinished() {
  expect(surface().classList.contains("is-dragging")).toBe(false);
  expect(surface().hasPointerCapture(1)).toBe(false);
}

test("Undo cancels scattering without undoing the preceding edit or letting release recommit it", () => {
  const seed = notes();
  add(2, 9);
  const before = notes();
  expect(before).toHaveLength(seed.length + 1);
  paint();
  expect(notes()).toHaveLength(before.length + 2);
  key("z", { ctrlKey: true });
  expect(notes()).toEqual(before);
  expectFinished();
  pointer("pointermove", 12, 9);
  pointer("pointerup", 12, 9);
  pointer("lostpointercapture", 12, 9);
  expect(notes()).toEqual(before);
  click(button("Undo"));
  expect(notes()).toEqual(seed);
  click(button("Redo"));
  expect(notes()).toEqual(before);
});

test("Undo can cancel the first gesture even when no completed history exists", () => {
  const seed = notes();
  expect(button("Undo").disabled).toBe(true);
  paint();
  expect(button("Undo").disabled).toBe(false);
  click(button("Undo"));
  expect(notes()).toEqual(seed);
  expect(button("Undo").disabled).toBe(true);
  expect(button("Redo").disabled).toBe(true);
  pointer("pointerup", 8, 10);
  expect(notes()).toEqual(seed);
});

test.each(["Escape", "pointercancel", "lostpointercapture", "blur"])(
  "%s cancels the entire scattered trail and preserves the previous redo branch",
  (interruption) => {
    add(2, 9);
    const completed = notes();
    click(button("Undo"));
    const before = notes();
    paint();
    expect(notes()).toHaveLength(before.length + 2);
    if (interruption === "Escape") key("Escape");
    else if (interruption === "blur") blur();
    else pointer(interruption, 8, 10);
    expect(notes()).toEqual(before);
    expectFinished();
    pointer("pointerup", 8, 10);
    expect(notes()).toEqual(before);
    expect(button("Redo").disabled).toBe(false);
    click(button("Redo"));
    expect(notes()).toEqual(completed);
  },
);

test("scattering commits exactly one undo entry and clears redo only on commit", () => {
  add(2, 9);
  click(button("Undo"));
  const before = notes();
  paint();
  const painted = notes();
  expect(painted).toHaveLength(before.length + 2);
  expect(button("Redo").disabled).toBe(false);
  pointer("pointerup", 8, 10);
  expectFinished();
  expect(button("Redo").disabled).toBe(true);
  click(button("Undo"));
  expect(notes()).toEqual(before);
  expect(button("Undo").disabled).toBe(true);
  click(button("Redo"));
  expect(notes()).toEqual(painted);
});

test("a rejected scatter creates no history entry and does not discard redo", () => {
  add(2, 9);
  const completed = notes();
  click(button("Undo"));
  const before = notes();
  // Empty space at a different bass pitch, but the same occupied bass timing step.
  pointer("pointerdown", 0, 1, surface(), { shiftKey: true });
  pointer("pointerup", 0, 1);
  expect(notes()).toEqual(before);
  expect(button("Undo").disabled).toBe(true);
  click(button("Redo"));
  expect(notes()).toEqual(completed);
});

test("Redo cancels a live gesture before replaying the next completed edit", () => {
  add(2, 9);
  const completed = notes();
  click(button("Undo"));
  paint();
  key("z", { metaKey: true, shiftKey: true });
  expect(notes()).toEqual(completed);
  expectFinished();
  pointer("pointerup", 8, 10);
  expect(notes()).toEqual(completed);
});

test("deleting during a drag removes the original note and release cannot recreate it", () => {
  const before = notes();
  drag();
  key("Delete");
  expect(document.querySelector('[data-light="1"]')).toBeNull();
  expect(notes()).toHaveLength(before.length - 1);
  expectFinished();
  pointer("pointerup", 2, 6);
  pointer("lostpointercapture", 2, 6);
  expect(document.querySelector('[data-light="1"]')).toBeNull();
  click(button("Undo"));
  expect(notes()).toEqual(before);
  expect(button("Undo").disabled).toBe(true);
});

test("a keyboard nudge cancels the draft and edits the original position exactly once", () => {
  const before = notes();
  drag();
  key("ArrowRight");
  const nudged = notes();
  expect(nudged[0]).toContain("beat position 2 of 32");
  expectFinished();
  pointer("pointerup", 2, 6);
  expect(notes()).toEqual(nudged);
  click(button("Undo"));
  expect(notes()).toEqual(before);
  expect(button("Undo").disabled).toBe(true);
});

test("Undo cancels an ordinary drag without consuming the preceding completed edit", () => {
  const seed = notes();
  add(2, 9);
  const before = notes();
  drag();
  key("z", { metaKey: true });
  expect(notes()).toEqual(before);
  expectFinished();
  pointer("pointerup", 2, 6);
  expect(notes()).toEqual(before);
  click(button("Undo"));
  expect(notes()).toEqual(seed);
});

test("Enter interrupts scattering and adds only the requested keyboard note", () => {
  const before = notes();
  paint();
  key("Enter");
  expect(notes()).toHaveLength(before.length + 1);
  expect(notes().at(-1)).toContain("F4, beat position 17 of 32");
  const added = notes();
  expectFinished();
  pointer("pointerup", 8, 10);
  expect(notes()).toEqual(added);
  click(button("Undo"));
  expect(notes()).toEqual(before);
});

test.each(["pointercancel", "lostpointercapture", "blur"])(
  "%s cancels an ordinary drag without changing music or history",
  (interruption) => {
    const before = notes();
    drag();
    if (interruption === "blur") blur();
    else pointer(interruption, 2, 6);
    expect(notes()).toEqual(before);
    expectFinished();
    pointer("pointerup", 2, 6);
    expect(notes()).toEqual(before);
    expect(button("Undo").disabled).toBe(true);
  },
);

test("clear interrupts scattering and undo restores the phrase before the gesture", () => {
  const before = notes();
  paint();
  click(button("Sketch options"));
  click(element(".sketch-menu button:first-of-type"));
  expect(notes()).toEqual([]);
  expectFinished();
  pointer("pointerup", 8, 10);
  expect(notes()).toEqual([]);
  click(button("Undo"));
  expect(notes()).toEqual(before);
});

test("a completed drag is still undoable as one edit", () => {
  const before = notes();
  drag();
  pointer("pointerup", 2, 6);
  const moved = notes();
  expect(moved[0]).toContain("beat position 3 of 32");
  expectFinished();
  click(button("Undo"));
  expect(notes()).toEqual(before);
  expect(button("Undo").disabled).toBe(true);
  click(button("Redo"));
  expect(notes()).toEqual(moved);
});

test("events from another pointer cannot finish or cancel the current gesture", () => {
  const before = notes();
  paint();
  const painted = notes();
  pointer("pointercancel", 8, 10, surface(), { pointerId: 2 });
  pointer("pointerup", 8, 10, surface(), { pointerId: 2 });
  expect(surface().classList.contains("is-dragging")).toBe(true);
  expect(notes()).toEqual(painted);
  pointer("pointerup", 8, 10);
  click(button("Undo"));
  expect(notes()).toEqual(before);
});

function enterSurface() {
  act(() => surface().focus());
}

function expectSelected(id: number) {
  const light = element<HTMLButtonElement>(`[data-light="${id}"]`);
  expect(document.activeElement).toBe(light);
  expect(light.getAttribute("aria-pressed")).toBe("true");
  expect(light.tabIndex).toBe(0);
  expect(surface().classList.contains("is-keyboard")).toBe(true);
}

test("Page Down reaches every note in time and pitch order without editing the music", () => {
  const before = notes();
  enterSurface();
  const order = [17, 1, 9, 2, 10, 3, 11, 19, 4, 12, 18, 5, 13, 6, 14, 7, 15, 20, 8, 16];
  for (const id of order) {
    expect(key("PageDown").defaultPrevented).toBe(true);
    expectSelected(id);
  }
  key("PageDown");
  expectSelected(order[0]);
  expect(notes()).toEqual(before);
  expect(button("Undo").disabled).toBe(true);
});

test("Page Up starts at the last note and cycles backwards across the loop boundary", () => {
  enterSurface();
  expect(key("PageUp").defaultPrevented).toBe(true);
  expectSelected(16);
  key("PageUp");
  expectSelected(8);
  key("PageDown");
  expectSelected(16);
  key("PageDown");
  expectSelected(17);
  key("PageUp");
  expectSelected(16);
});

test("a non-first note can be selected, moved, and deleted entirely from the keyboard", () => {
  const before = notes();
  enterSurface();
  key("PageUp");
  expectSelected(16);
  key("ArrowLeft");
  expectSelected(16);
  const moved = notes();
  expect(moved[15]).toContain("E5, beat position 30 of 32");
  expect(moved.filter((_, index) => index !== 15)).toEqual(
    before.filter((_, index) => index !== 15),
  );
  key("Delete");
  expect(document.querySelector('[data-light="16"]')).toBeNull();
  expect(notes()).toEqual(moved.filter((_, index) => index !== 15));
  expect(document.activeElement).toBe(surface());
  key("z", { ctrlKey: true });
  expect(notes()).toEqual(moved);
  key("z", { ctrlKey: true });
  expect(notes()).toEqual(before);
});

test("arrows still select a light first and then move it, with focus on that light", () => {
  const before = notes();
  enterSurface();
  key("ArrowRight");
  expectSelected(1);
  expect(notes()).toEqual(before);
  key("ArrowRight");
  expectSelected(1);
  expect(notes()[0]).toContain("beat position 2 of 32");
});

test("Enter focuses the new light; undo and redo keep focus inside the surface", () => {
  const before = notes();
  enterSurface();
  key("Enter");
  expectSelected(21);
  expect(notes()).toHaveLength(before.length + 1);
  key("z", { metaKey: true });
  expect(notes()).toEqual(before);
  expect(document.activeElement).toBe(surface());
  key("z", { metaKey: true, shiftKey: true });
  expectSelected(21);
});

test("the surface has a single note tab stop and Escape restores the empty selection entry point", () => {
  enterSurface();
  key("PageDown");
  expectSelected(17);
  expect(surface().tabIndex).toBe(-1);
  expect(
    [...document.querySelectorAll<HTMLButtonElement>("[data-light]")].filter(
      (light) => light.tabIndex === 0,
    ),
  ).toEqual([document.activeElement]);
  expect([
    ...document.querySelectorAll('[role="group"][aria-label="Selected note"] button'),
  ]).toEqual([button("Remove selected note")]);
  expect(button("Remove selected note").tabIndex).toBe(0);
  key("Escape");
  expect(document.activeElement).toBe(surface());
  expect(surface().tabIndex).toBe(0);
  expect(
    [...document.querySelectorAll("[data-light]")].every(
      (light) => light.getAttribute("aria-pressed") === "false",
    ),
  ).toBe(true);
  expect(
    [...document.querySelectorAll<HTMLButtonElement>("[data-light]")].every(
      (light) => light.tabIndex === -1,
    ),
  ).toBe(true);
});

test("the selected note's remove button deletes only that note and undo restores it", () => {
  const before = notes();
  enterSurface();
  key("PageUp");
  expectSelected(16);
  click(button("Remove selected note"));
  expect(document.querySelector('[data-light="16"]')).toBeNull();
  expect(notes()).toEqual(before.filter((_, index) => index !== 15));
  expect(document.activeElement).toBe(surface());
  expect(document.querySelector('[role="group"][aria-label="Selected note"]')).toBeNull();
  click(button("Undo"));
  expect(notes()).toEqual(before);
});

test("note navigation preserves the existing redo branch", () => {
  add(2, 9);
  const completed = notes();
  click(button("Undo"));
  const before = notes();
  enterSurface();
  key("PageDown");
  key("PageDown");
  expectSelected(1);
  expect(notes()).toEqual(before);
  expect(button("Undo").disabled).toBe(true);
  expect(button("Redo").disabled).toBe(false);
  click(button("Redo"));
  expect(notes()).toEqual(completed);
});

test.each(["PageUp", "PageDown"])("%s safely leaves an empty surface focused", (navigation) => {
  click(button("Sketch options"));
  click(element(".sketch-menu button:first-of-type"));
  enterSurface();
  const event = key(navigation);
  expect(event.defaultPrevented).toBe(true);
  expect(notes()).toEqual([]);
  expect(document.activeElement).toBe(surface());
  expect(surface().tabIndex).toBe(0);
});

test("note navigation cancels an unfinished trail without committing it on release", () => {
  const before = notes();
  paint();
  key("PageDown");
  expect(notes()).toEqual(before);
  expectSelected(17);
  expectFinished();
  pointer("pointerup", 8, 10);
  expect(notes()).toEqual(before);
  expect(button("Undo").disabled).toBe(true);
});

test("switching to pointer selection does not retain the keyboard focus treatment", () => {
  enterSurface();
  key("PageUp");
  expectSelected(16);
  const light = element('[data-light="1"]');
  pointer("pointerdown", 0, 6, light);
  pointer("pointerup", 0, 6);
  expect(document.activeElement).toBe(light);
  expect(light.getAttribute("aria-pressed")).toBe("true");
  expect(surface().classList.contains("is-keyboard")).toBe(false);
  pointer("pointerdown", 0, 6, light);
  pointer("pointerup", 0, 6);
  expect(document.activeElement).toBe(surface());
  expect(light.getAttribute("aria-pressed")).toBe("false");
});

function compactNeighbors() {
  act(() => {
    size.width = 390;
    observers.get(surface())!([{ contentRect: size }]);
    element('[data-light="3"]').focus();
  });
  for (let step = 0; step < 3; step++) key("ArrowLeft");
  return element('[data-light="3"]');
}

test.each(["select", "drag", "remove"])(
  "overlapping mobile targets %s the nearest note, not the topmost button",
  (action) => {
    const topmost = compactNeighbors();
    const neighbor = element('[data-light="2"]');
    const before = notes();
    const center = locate({ id: 2, step: 4, tone: 8 }, size);
    const hit = topmost.getBoundingClientRect();
    expect(Math.hypot(center.x - (hit.x + 18), center.y - (hit.y + 18))).toBeLessThan(18);
    // The browser delivers this point to the later, overlapping button, not note 2.
    pointer("pointerdown", 4, 8, topmost, { button: action === "remove" ? 2 : 0 });
    if (action === "remove") {
      expect(document.querySelector('[data-light="2"]')).toBeNull();
      expect(notes()).toEqual(before.filter((_, index) => index !== 1));
      return;
    }
    if (action === "drag") pointer("pointermove", 2, 8);
    pointer("pointerup", action === "drag" ? 2 : 4, 8);
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
  pointer("pointerdown", 5, 8, light);
  pointer("pointermove", 4.4, 8);
  pointer("pointerup", 4.4, 8);
  // The occupied landing at step 4 sends it back to step 5, but it is still near step 4.
  key("Escape");
  frame(18);
  pointer("pointerdown", 4.4, 8);
  pointer("pointerup", 4.4, 8);
  expect(document.activeElement).toBe(light);
  expect(light.getAttribute("aria-pressed")).toBe("true");
  expect(light.getAttribute("aria-label")).toContain("beat position 6 of 32");
});

test("keyboard input outside the surface never steals focus or changes the selected note", () => {
  const light = element('[data-light="1"]');
  pointer("pointerdown", 0, 6, light);
  pointer("pointerup", 0, 6);
  const mute = button("Mute audio");
  act(() => mute.focus());
  expect(key("PageDown").defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(mute);
  expect(light.getAttribute("aria-pressed")).toBe("true");
});

test("an unchanged paused surface schedules no animation frames or repeated redraws", () => {
  expect(frames.size).toBe(0);
  const count = draws.mock.calls.length;
  frame(1000);
  expect(draws).toHaveBeenCalledTimes(count);
  expect(frames.size).toBe(0);
});

test("an unavailable canvas context does not break editing or playback controls", async () => {
  await act(async () => root.render(null));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  await act(async () => root.render(createElement(StrictMode, null, createElement(App))));
  expect(notes()).toHaveLength(20);
  act(() => surface().focus());
  key("Enter");
  expect(notes()).toHaveLength(21);
  await act(async () => button("Play loop").click());
  expect(TestAudioContext.instances[0].state).toBe("running");
  expect(button("Pause loop").disabled).toBe(false);
  expect(frames.size).toBe(0);
});

test.each(["body", ".point-space", '[data-light="1"]'])(
  "Space plays and pauses from %s without changing the music",
  async (selector) => {
    const target = element(selector);
    act(() => target.focus());
    const before = notes();
    await act(async () => {
      expect(key(" ").defaultPrevented).toBe(true);
    });
    expect(button("Pause loop").getAttribute("aria-pressed")).toBe("true");
    const context = TestAudioContext.instances[0];
    expect(context.state).toBe("running");
    await act(async () => {
      expect(key(" ").defaultPrevented).toBe(true);
    });
    expect(button("Play loop").getAttribute("aria-pressed")).toBe("false");
    expect(context.state).toBe("suspended");
    expect(notes()).toEqual(before);
  },
);

test("holding Space does not repeatedly toggle playback or scroll", async () => {
  await act(async () => key(" "));
  const context = TestAudioContext.instances[0];
  await act(async () => {
    expect(key(" ", { repeat: true }).defaultPrevented).toBe(true);
  });
  expect(button("Pause loop").getAttribute("aria-pressed")).toBe("true");
  expect(context.state).toBe("running");
  await act(async () => key(" "));
  await act(async () => {
    expect(key(" ", { repeat: true }).defaultPrevented).toBe(true);
  });
  expect(button("Play loop").getAttribute("aria-pressed")).toBe("false");
  expect(context.state).toBe("suspended");
});

test.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }])(
  "Space leaves modified or composing key events alone: %j",
  async (modifiers) => {
    act(() => surface().focus());
    await act(async () => {
      expect(key(" ", modifiers).defaultPrevented).toBe(false);
    });
    expect(button("Play loop").getAttribute("aria-pressed")).toBe("false");
    expect(TestAudioContext.instances).toHaveLength(0);
  },
);

test.each([
  '<input aria-label="Typing" />',
  '<textarea aria-label="Typing"></textarea>',
  '<select aria-label="Choice"><option>One</option></select>',
  '<div contenteditable="true"><span tabindex="0">Typing</span></div>',
  '<a href="#">Link</a>',
  "<details><summary>Details</summary></details>",
  '<div role="button" tabindex="0"><span tabindex="0">Action</span></div>',
])("Space leaves focused controls and editable content alone: %s", async (html) => {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);
  const target = container.querySelector<HTMLElement>("span, input, textarea, select, a, summary")!;
  act(() => target.focus());
  expect(document.activeElement).toBe(target);
  await act(async () => {
    expect(key(" ").defaultPrevented).toBe(false);
  });
  expect(button("Play loop").getAttribute("aria-pressed")).toBe("false");
  expect(TestAudioContext.instances).toHaveLength(0);
});

test("Space on a note's remove control does not toggle playback", async () => {
  act(() => element('[data-light="1"]').focus());
  act(() => button("Remove selected note").focus());
  const before = notes();
  await act(async () => {
    expect(key(" ").defaultPrevented).toBe(false);
  });
  expect(TestAudioContext.instances).toHaveLength(0);
  // happy-dom does not synthesize a native button click from keyboard events.
  click(button("Remove selected note"));
  expect(document.querySelector('[data-light="1"]')).toBeNull();
  expect(notes()).toEqual(before.slice(1));
  expect(button("Play loop").getAttribute("aria-pressed")).toBe("false");
});

test("Space leaves the playback button's native activation alone", async () => {
  act(() => button("Play loop").focus());
  await act(async () => {
    expect(key(" ").defaultPrevented).toBe(false);
  });
  expect(TestAudioContext.instances).toHaveLength(0);
  await act(async () => button("Play loop").click());
  expect(button("Pause loop").getAttribute("aria-pressed")).toBe("true");
  expect(TestAudioContext.instances[0].state).toBe("running");
});

test("Space respects events already handled by another control", async () => {
  const target = surface();
  act(() => target.focus());
  target.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
  await act(async () => key(" "));
  expect(TestAudioContext.instances).toHaveLength(0);
  expect(button("Play loop").getAttribute("aria-pressed")).toBe("false");
});

test("Space does not toggle playback while the help dialog is open", async () => {
  click(element(".help-button"));
  const dialog = element<HTMLDialogElement>("dialog");
  expect(dialog.open).toBe(true);
  // Focus the dialog itself rather than one of its native buttons.
  dialog.tabIndex = -1;
  act(() => dialog.focus());
  await act(async () => {
    expect(key(" ").defaultPrevented).toBe(false);
  });
  expect(TestAudioContext.instances).toHaveLength(0);
  expect(button("Play loop").getAttribute("aria-pressed")).toBe("false");
});

test("Space ignores another press while audio startup is pending", async () => {
  const pending = deferred();
  const resume = vi
    .spyOn(TestAudioContext.prototype, "resume")
    .mockImplementationOnce(async function (this: TestAudioContext) {
      await pending.promise;
      this.state = "running";
    });
  key(" ");
  expect(button("Play loop").disabled).toBe(true);
  key(" ");
  expect(resume).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve());
  expect(button("Pause loop").disabled).toBe(false);
  expect(TestAudioContext.instances[0].state).toBe("running");
});

test("Play stays disabled until audio startup completes", async () => {
  const pending = deferred();
  vi.spyOn(TestAudioContext.prototype, "resume").mockImplementationOnce(async function (
    this: TestAudioContext,
  ) {
    await pending.promise;
    this.state = "running";
  });
  click(button("Play loop"));
  expect(button("Play loop").disabled).toBe(true);
  expect(button("Play loop").getAttribute("aria-busy")).toBe("true");
  expect(frames.size).toBe(0);
  await act(async () => pending.resolve());
  expect(button("Pause loop").disabled).toBe(false);
  expect(button("Pause loop").getAttribute("aria-busy")).toBe("false");
  expect(button("Pause loop").getAttribute("aria-pressed")).toBe("true");
  expect(TestAudioContext.instances[0].state).toBe("running");
  expect(frames.size).toBe(1);
});

test.each(["button", "Space"])(
  "failed playback transitions allow retry using %s",
  async (control) => {
    async function toggle(label: string) {
      await act(async () => {
        if (control === "Space") key(" ");
        else button(label).click();
      });
    }

    vi.spyOn(TestAudioContext.prototype, "resume").mockRejectedValueOnce(
      new Error("Cannot resume"),
    );
    await toggle("Play loop");
    expect(button("Play loop").disabled).toBe(false);
    expect(element('[role="status"]').textContent).toContain("Audio couldn’t start");
    expect(frames.size).toBe(0);
    await toggle("Play loop");
    const context = TestAudioContext.instances[0];
    vi.spyOn(context, "suspend").mockRejectedValueOnce(new Error("Cannot suspend"));
    await toggle("Pause loop");
    expect(button("Pause loop").disabled).toBe(false);
    expect(element('[role="status"]').textContent).toContain("Audio couldn’t pause");
    expect(context.state).toBe("running");
    expect(frames.size).toBe(1);
    await toggle("Pause loop");
    expect(button("Play loop").getAttribute("aria-pressed")).toBe("false");
    expect(context.state).toBe("suspended");
    expect(frames.size).toBe(0);
  },
);

test("Space respects a pending pause across edits and can resume after it completes", async () => {
  await act(async () => key(" "));
  const context = TestAudioContext.instances[0];
  const pending = deferred();
  const suspend = vi.spyOn(context, "suspend").mockImplementationOnce(async () => {
    await pending.promise;
    context.state = "suspended";
  });
  key(" ");
  expect(button("Pause loop").disabled).toBe(true);
  add(3, 9);
  key(" ");
  expect(suspend).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve());
  expect(button("Play loop").disabled).toBe(false);
  expect(context.state).toBe("suspended");
  await act(async () => key(" "));
  expect(button("Pause loop").disabled).toBe(false);
  expect(context.state).toBe("running");
});

test("mute before Play stays silent while playback and animation run independently", async () => {
  click(button("Mute audio"));
  expect(button("Unmute audio").getAttribute("aria-pressed")).toBe("true");
  expect(TestAudioContext.instances).toHaveLength(0);
  await act(async () => button("Play loop").click());
  const context = TestAudioContext.instances[0];
  expect(context.gains[0].gain.value).toBe(0);
  expect(context.state).toBe("running");
  expect(frames.size).toBe(1);
  context.currentTime = 0.05;
  frame();
  expect(glowAt(0, 6)).toBe(225);
  click(button("Unmute audio"));
  expect(context.gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(
    DEFAULT_VOLUME,
    0.05,
    0.02,
  );
  expect(button("Pause loop").getAttribute("aria-pressed")).toBe("true");
  click(button("Mute audio"));
  await act(async () => button("Pause loop").click());
  expect(button("Unmute audio").getAttribute("aria-pressed")).toBe("true");
  expect(context.state).toBe("suspended");
  expect(frames.size).toBe(0);
});

test("the first loop illuminates only notes whose scheduled onset has actually arrived", async () => {
  await act(async () => button("Play loop").click());
  const context = TestAudioContext.instances[0];
  context.currentTime = 0.05;
  frame();
  expect(glowAt(0, 6)).toBe(225);
  expect(glowAt(30, 15)).toBe(155);
  expect(glowAt(28, 8)).toBe(155);
});

test("idle edits redraw once and unrelated status changes do not redraw the canvas", () => {
  const before = draws.mock.calls.length;
  add(3, 9);
  expect(draws.mock.calls.length).toBeGreaterThan(before);
  expect(frames.size).toBe(0);
  const afterEdit = draws.mock.calls.length;
  frame(5000);
  expect(draws).toHaveBeenCalledTimes(afterEdit);
  expect(frames.size).toBe(0);
});

test("settling keeps hit targets aligned and stops requesting frames at its final position", () => {
  add(3.4, 9.2);
  const light = element('[data-light="21"]');
  const from = locate({ id: 21, step: 3.4, tone: 9.2 }, size);
  const to = locate({ id: 21, step: 3, tone: 9 }, size);
  expect(frames.size).toBe(1);
  expect(parseFloat(light.style.left)).toBeCloseTo(from.x);
  frame(90);
  const x = parseFloat(light.style.left);
  const y = parseFloat(light.style.top);
  expect(x).toBeLessThan(from.x);
  expect(x).toBeGreaterThan(to.x);
  expect(
    [...glows.keys()].some((key) => {
      const [px, py] = key.split(":").map(Number);
      return Math.abs(px - x) < 0.001 && Math.abs(py - y) < 0.001;
    }),
  ).toBe(true);
  frame(100);
  expect(parseFloat(light.style.left)).toBeCloseTo(to.x);
  expect(parseFloat(light.style.top)).toBeCloseTo(to.y);
  expect(frames.size).toBe(0);
  const count = draws.mock.calls.length;
  frame(500);
  expect(draws).toHaveBeenCalledTimes(count);
});

test("turning on reduced motion snaps a settling light and stops its animation", () => {
  add(3.4, 9.2);
  expect(frames.size).toBe(1);
  act(() => {
    preference.matches = true;
    preference.dispatchEvent(new Event("change"));
  });
  expect(frames.size).toBe(0);
  const to = locate({ id: 21, step: 3, tone: 9 }, size);
  expect(parseFloat(element('[data-light="21"]').style.left)).toBeCloseTo(to.x);
});

test("collision feedback expires with a single redraw rather than a continuous frame loop", () => {
  pointer("pointerdown", 0, 1, surface(), { shiftKey: true });
  pointer("pointerup", 0, 1);
  expect(frames.size).toBe(0);
  const before = draws.mock.calls.length;
  frame(400);
  expect(draws).toHaveBeenCalledTimes(before);
  frame(400);
  expect(draws).toHaveBeenCalledTimes(before + 1);
  expect(frames.size).toBe(0);
});

test("pause holds the actual bloom without drawing, and resume restarts the animation", async () => {
  await act(async () => button("Play loop").click());
  const context = TestAudioContext.instances[0];
  context.currentTime = 0.05;
  frame();
  expect(glowAt(0, 6)).toBe(225);
  await act(async () => button("Pause loop").click());
  expect(frames.size).toBe(0);
  const paused = draws.mock.calls.length;
  frame(1000);
  expect(draws).toHaveBeenCalledTimes(paused);
  expect(glowAt(0, 6)).toBe(225);
  await act(async () => button("Play loop").click());
  expect(frames.size).toBe(1);
  context.currentTime = 0.2;
  frame();
  expect(glowAt(0, 6)).toBeLessThan(225);
  expect(glowAt(0, 6)).toBeGreaterThan(155);
});

test("adding a light at the current buffered beat does not invent a strike", async () => {
  await act(async () => button("Play loop").click());
  const context = TestAudioContext.instances[0];
  context.currentTime = 0.05 + 16 * STEP_SECONDS;
  frame();
  add(16, 9);
  expect(glowAt(16, 9)).toBe(155);
});

test("repitching a ringing light does not transfer its bloom to the new pitch", async () => {
  await act(async () => button("Play loop").click());
  const context = TestAudioContext.instances[0];
  context.currentTime = 0.05;
  frame();
  expect(glowAt(0, 6)).toBe(225);
  enterSurface();
  key("PageDown");
  key("PageDown");
  key("ArrowUp");
  expectSelected(1);
  expect(glowAt(0, 7)).toBe(155);
});

test("playback does not rewrite static hit positions or poll toolbar layout every frame", async () => {
  const width = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get");
  const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get");
  enterSurface();
  key("PageUp");
  await act(async () => button("Play loop").click());
  const light = element('[data-light="16"]');
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
  expect(frames.size).toBe(1);
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
    observers.get(toolbar)!([{ contentRect: size }]);
  });
  expect(frames.size).toBe(1);
  frame();
  expect(parseFloat(toolbar.style.left)).toBeLessThan(left);
  expect(frames.size).toBe(0);
});

test("resizing a paused surface redraws the canvas and relocates hit targets without an idle loop", () => {
  enterSurface();
  key("PageUp");
  const resized = { width: 1100, height: size.height };
  const before = draws.mock.calls.length;
  act(() => observers.get(surface())!([{ contentRect: resized }]));
  const target = locate({ id: 16, step: 30, tone: 15 }, resized);
  expect(parseFloat(element('[data-light="16"]').style.left)).toBeCloseTo(target.x);
  expect(element<HTMLCanvasElement>("canvas").width).toBe(1100);
  expect(draws.mock.calls.length).toBeGreaterThan(before);
  expect(frames.size).toBe(0);
});
