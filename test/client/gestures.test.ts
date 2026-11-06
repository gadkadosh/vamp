// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { App } from "../../src/client/App";
import { locate } from "../../src/client/space";

const size = { width: 900, height: 600 };
let root: Root;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private callback: (entries: { contentRect: typeof size }[]) => void;
      constructor(callback: (entries: { contentRect: typeof size }[]) => void) {
        this.callback = callback;
      }
      observe() {
        this.callback([{ contentRect: size }]);
      }
      disconnect() {}
    },
  );
  // Only browser geometry and drawing are fake; App, PointSpace, and history run together.
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
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
    clearRect() {},
    beginPath() {},
    arc() {},
    fill() {},
    stroke() {},
    moveTo() {},
    lineTo() {},
    setLineDash() {},
    fillRect() {},
    createRadialGradient: () => ({ addColorStop() {} }),
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
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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
  act(() => {
    (document.activeElement ?? surface()).dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...modifiers,
      }),
    );
  });
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
