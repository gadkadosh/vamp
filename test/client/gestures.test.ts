// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { App } from "../../src/client/App";
import { locate } from "../../src/client/space";
import { createSeedPattern, TONES } from "../../src/shared/pattern";
import type { Pattern } from "../../src/shared/pattern";
import type { EditMessage, StateMessage } from "../../src/shared/room";
import { DEFAULT_VOLUME, INSTRUMENTS, STEP_SECONDS } from "../../src/shared/score";
import { deferred, TestAudioContext } from "../audio-context";

const size = { width: 900, height: 600 };
const malletC4 = TONES.findIndex((tone) => tone.instrument === "mallet" && tone.note.name === "C4");
const malletE4 = TONES.findIndex((tone) => tone.instrument === "mallet" && tone.note.name === "E4");
const keysE5 = TONES.findIndex((tone) => tone.instrument === "keys" && tone.note.name === "E5");
let root: Root;
let seedIds: string[];
let frames: Map<number, FrameRequestCallback>;
let wallTime: number;
let draws: ReturnType<typeof vi.fn<() => void>>;
let glows: Map<string, number>;
let preference: EventTarget & { matches: boolean };
let observers: Map<Element, (entries: { contentRect: typeof size }[]) => void>;

class TestSocket {
  static OPEN = 1;
  static instances: TestSocket[] = [];
  readyState = 0;
  sent: EditMessage[] = [];
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly url: URL;
  constructor(url: URL) {
    this.url = url;
    TestSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as EditMessage);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  receive(state: StateMessage["state"], extra: Partial<StateMessage> = {}) {
    this.readyState = 1;
    this.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify({ type: "state", state, ...extra }) }),
    );
  }
}

beforeEach(async () => {
  window.history.replaceState(null, "", "/solo");
  TestSocket.instances = [];
  vi.stubGlobal("WebSocket", TestSocket);
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
  seedIds = lightIds();
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
  const position = locate({ id: "0", step, tone }, size);
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

function lightIds() {
  return [...document.querySelectorAll<HTMLElement>("[data-light]")].map(
    (light) => light.dataset.light!,
  );
}

function seedSelector(index: number) {
  return `[data-light="${seedIds[index - 1]}"]`;
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
  const position = locate({ id: "0", step, tone }, size);
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
  pointer("pointerdown", 0, malletC4, element(seedSelector(1)));
  pointer("pointermove", 2, malletC4);
  expect(surface().classList.contains("is-dragging")).toBe(true);
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

test("selecting and deselecting a light never enables Undo, even while pressed", () => {
  const before = notes();
  const light = element(seedSelector(1));
  for (const selected of [true, false]) {
    pointer("pointerdown", 0, malletC4, light);
    expect(button("Undo").disabled).toBe(true);
    pointer("pointerup", 0, malletC4);
    expect(light.getAttribute("aria-pressed")).toBe(String(selected));
    expect(button("Undo").disabled).toBe(true);
    expect(button("Redo").disabled).toBe(true);
    expect(notes()).toEqual(before);
  }
});

test("selection preserves the existing undo and redo history", () => {
  const seed = notes();
  add(2, 9);
  const edited = notes();
  add(0, malletC4);
  expect(button("Undo").disabled).toBe(false);
  click(button("Undo"));
  expect(notes()).toEqual(seed);
  pointer("pointerdown", 0, malletC4);
  expect(button("Undo").disabled).toBe(true);
  expect(button("Redo").disabled).toBe(false);
  pointer("pointerup", 0, malletC4);
  expect(button("Undo").disabled).toBe(true);
  click(button("Redo"));
  expect(notes()).toEqual(edited);
});

test("Undo becomes available only when a selection press turns into a drag", () => {
  const before = notes();
  pointer("pointerdown", 0, malletC4);
  expect(button("Undo").disabled).toBe(true);
  const position = locate({ id: "1", step: 0, tone: malletC4 }, size);
  pointer("pointermove", 0, malletC4, surface(), { clientX: position.x + 2 });
  expect(button("Undo").disabled).toBe(true);
  pointer("pointermove", 2, malletC4);
  expect(button("Undo").disabled).toBe(false);
  click(button("Undo"));
  expectFinished();
  expect(button("Undo").disabled).toBe(true);
  pointer("pointerup", 2, malletC4);
  expect(notes()).toEqual(before);
  expect(button("Redo").disabled).toBe(true);
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
  // Empty space beyond the seed's hit target, but at the same occupied bass timing step.
  pointer("pointerdown", 0, 2, surface(), { shiftKey: true });
  pointer("pointerup", 0, 2);
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
  expect(document.querySelector(seedSelector(1))).toBeNull();
  expect(notes()).toHaveLength(before.length - 1);
  expectFinished();
  pointer("pointerup", 2, malletC4);
  pointer("lostpointercapture", 2, malletC4);
  expect(document.querySelector(seedSelector(1))).toBeNull();
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
  pointer("pointerup", 2, malletC4);
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
  pointer("pointerup", 2, malletC4);
  expect(notes()).toEqual(before);
  click(button("Undo"));
  expect(notes()).toEqual(seed);
});

test("Enter interrupts scattering and adds only the requested keyboard note", () => {
  const before = notes();
  paint();
  key("Enter");
  expect(notes()).toHaveLength(before.length + 1);
  expect(notes().at(-1)).toContain("Muted piano, D4, beat position 17 of 32");
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
    else pointer(interruption, 2, malletC4);
    expect(notes()).toEqual(before);
    expectFinished();
    pointer("pointerup", 2, malletC4);
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
  pointer("pointerup", 2, malletC4);
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

function expectSelected(id: string) {
  const light = element<HTMLButtonElement>(`[data-light="${id}"]`);
  expect(document.activeElement).toBe(light);
  expect(light.getAttribute("aria-pressed")).toBe("true");
  expect(light.tabIndex).toBe(0);
  expect(surface().classList.contains("is-keyboard")).toBe(true);
}

test("Page Down reaches every note in time and pitch order without editing the music", () => {
  const before = notes();
  enterSurface();
  const order = [17, 1, 9, 2, 10, 3, 11, 19, 4, 12, 18, 5, 13, 6, 14, 7, 15, 20, 8, 16].map(
    (index) => seedIds[index - 1],
  );
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
  expectSelected(seedIds[15]);
  key("PageUp");
  expectSelected(seedIds[7]);
  key("PageDown");
  expectSelected(seedIds[15]);
  key("PageDown");
  expectSelected(seedIds[16]);
  key("PageUp");
  expectSelected(seedIds[15]);
});

test("a non-first note can be selected, moved, and deleted entirely from the keyboard", () => {
  const before = notes();
  enterSurface();
  key("PageUp");
  expectSelected(seedIds[15]);
  key("ArrowLeft");
  expectSelected(seedIds[15]);
  const moved = notes();
  expect(moved[15]).toContain("E5, beat position 30 of 32");
  expect(moved.filter((_, index) => index !== 15)).toEqual(
    before.filter((_, index) => index !== 15),
  );
  key("Delete");
  expect(document.querySelector(seedSelector(16))).toBeNull();
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
  expectSelected(seedIds[0]);
  expect(notes()).toEqual(before);
  key("ArrowRight");
  expectSelected(seedIds[0]);
  expect(notes()[0]).toContain("beat position 2 of 32");
});

test("Enter focuses the new light; undo and redo keep focus inside the surface", () => {
  const before = notes();
  enterSurface();
  key("Enter");
  const id = lightIds().at(-1)!;
  expectSelected(id);
  expect(notes()).toHaveLength(before.length + 1);
  key("z", { metaKey: true });
  expect(notes()).toEqual(before);
  expect(document.activeElement).toBe(surface());
  key("z", { metaKey: true, shiftKey: true });
  expectSelected(id);
});

test("the surface has a single note tab stop and Escape restores the empty selection entry point", () => {
  enterSurface();
  key("PageDown");
  expectSelected(seedIds[16]);
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

test.each(["body", '[aria-label="Mute audio"]', '[aria-label="Play loop"]'])(
  "Escape deselects globally without moving focus from %s or editing the music",
  (selector) => {
    const before = notes();
    act(() => element(seedSelector(1)).focus());
    const target = element(selector);
    if (target === document.body) target.tabIndex = -1;
    act(() => target.focus());
    expect(key("Escape").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(target);
    expect(element(seedSelector(1)).getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector(".note-tools")).toBeNull();
    expect(surface().tabIndex).toBe(0);
    expect(notes()).toEqual(before);
    expect(button("Undo").disabled).toBe(true);
    expect(key("Escape").defaultPrevented).toBe(false);
  },
);

test("Escape from the selected note's remove control returns focus to the surface", () => {
  act(() => element(seedSelector(1)).focus());
  act(() => button("Remove selected note").focus());
  expect(key("Escape").defaultPrevented).toBe(true);
  expect(document.querySelector(".note-tools")).toBeNull();
  expect(element(seedSelector(1)).getAttribute("aria-pressed")).toBe("false");
  expect(document.activeElement).toBe(surface());
});

test.each(["surface", "outside"])(
  "Escape cancels a gesture before deselecting, with focus %s the canvas",
  (focus) => {
    const before = notes();
    act(() => element(seedSelector(1)).focus());
    paint();
    if (focus === "outside") act(() => button("Mute audio").focus());
    const target = document.activeElement;
    expect(notes()).toHaveLength(before.length + 2);
    expect(key("Escape").defaultPrevented).toBe(true);
    expect(notes()).toEqual(before);
    expectFinished();
    expect(element(seedSelector(1)).getAttribute("aria-pressed")).toBe("true");
    expect(button("Undo").disabled).toBe(true);
    if (focus === "outside") expect(document.activeElement).toBe(target);
    pointer("pointerup", 8, 10);
    expect(notes()).toEqual(before);
    key("Escape", { repeat: true });
    expect(element(seedSelector(1)).getAttribute("aria-pressed")).toBe("true");
    key("Escape");
    expect(element(seedSelector(1)).getAttribute("aria-pressed")).toBe("false");
  },
);

test("Escape closes sketch options before deselecting and ignores held repeats", () => {
  act(() => element(seedSelector(1)).focus());
  click(button("Sketch options"));
  act(() => element(".sketch-menu button").focus());
  expect(key("Escape").defaultPrevented).toBe(true);
  expect(document.querySelector(".sketch-menu")).toBeNull();
  expect(document.activeElement).toBe(button("Sketch options"));
  expect(element(seedSelector(1)).getAttribute("aria-pressed")).toBe("true");
  key("Escape", { repeat: true });
  expect(element(seedSelector(1)).getAttribute("aria-pressed")).toBe("true");
  key("Escape");
  expect(element(seedSelector(1)).getAttribute("aria-pressed")).toBe("false");
  expect(document.activeElement).toBe(button("Sketch options"));
});

test("Escape leaves the help dialog's native dismissal alone without deselecting", () => {
  act(() => element(seedSelector(1)).focus());
  click(element(".help-button"));
  act(() => button("Close guide").focus());
  expect(element<HTMLDialogElement>("dialog").open).toBe(true);
  expect(key("Escape").defaultPrevented).toBe(false);
  expect(element(seedSelector(1)).getAttribute("aria-pressed")).toBe("true");
  // happy-dom does not synthesize native dialog dismissal from keyboard events.
  click(button("Close guide"));
  expect(element<HTMLDialogElement>("dialog").open).toBe(false);
  act(() => button("Mute audio").focus());
  key("Escape");
  expect(element(seedSelector(1)).getAttribute("aria-pressed")).toBe("false");
});

test("native help dismissal restores shortcuts and allows reopening", async () => {
  act(() => element(seedSelector(1)).focus());
  click(element(".help-button"));
  const dialog = element<HTMLDialogElement>("dialog");
  expect(dialog.open).toBe(true);

  await act(async () => dialog.close());
  expect(dialog.open).toBe(false);
  act(() => button("Mute audio").focus());
  key("Escape");
  expect(element(seedSelector(1)).getAttribute("aria-pressed")).toBe("false");

  click(element(".help-button"));
  expect(dialog.open).toBe(true);
  click(element(".guide-done"));
  expect(dialog.open).toBe(false);
});

test.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }])(
  "Escape leaves modified or composing key events alone: %j",
  (modifiers) => {
    act(() => element(seedSelector(1)).focus());
    expect(key("Escape", modifiers).defaultPrevented).toBe(false);
    expectSelected(seedIds[0]);
  },
);

test("Escape respects events already handled by another control", () => {
  act(() => element(seedSelector(1)).focus());
  const target = button("Mute audio");
  act(() => target.focus());
  target.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
  key("Escape");
  expect(element(seedSelector(1)).getAttribute("aria-pressed")).toBe("true");
  expect(document.activeElement).toBe(target);
});

test.each(["button", "Delete", "Backspace", "right-click"])(
  "%s removes the selected note, clears its details, and creates one Solo undo entry",
  (control) => {
    const before = notes();
    enterSurface();
    key("PageUp");
    expectSelected(seedIds[15]);
    expect(element(".selected-pitch").textContent).toBe("E5");
    expect(element(".selected-pitch").style.color).toBe("#e99db3");
    expect(element(".selected-material").textContent).toBe("Muted piano");
    if (control === "button") click(button("Remove selected note"));
    else if (control === "right-click")
      pointer("pointerdown", 30, keysE5, surface(), { button: 2 });
    else key(control);
    expect(document.querySelector(seedSelector(16))).toBeNull();
    expect(notes()).toEqual(before.filter((_, index) => index !== 15));
    expect(document.activeElement).toBe(surface());
    expect(document.querySelector('[role="group"][aria-label="Selected note"]')).toBeNull();
    if (control === "button") expect(element(".gesture-hint").textContent).toBe("Note removed.");
    click(button("Undo"));
    expect(notes()).toEqual(before);
    expect(button("Undo").disabled).toBe(true);
  },
);

test("selected note details follow pitch and instrument changes", () => {
  enterSurface();
  key("PageUp");
  key("ArrowUp");
  key("ArrowUp");
  expect(element(".selected-pitch").textContent).toBe("C5");
  expect(element(".selected-pitch").style.color).toBe("#a5b4f6");
  expect(element(".selected-material").textContent).toBe("Glass chimes");
  click(button("Undo"));
  expect(element(".selected-pitch").textContent).toBe("G5");
  expect(element(".selected-pitch").style.color).toBe("#e99db3");
  expect(element(".selected-material").textContent).toBe("Muted piano");
});

test("the keyboard can reach every allowed pitch, including overlapping instrument ranges", () => {
  click(button("Sketch options"));
  click(element(".sketch-menu button:first-of-type"));
  enterSurface();
  key("Enter");
  const light = element("[data-light]");
  expect(TONES).toHaveLength(34);
  for (let index = 0; index < TONES.length; index++) key("ArrowDown");
  for (const [index, tone] of TONES.entries()) {
    expect(light.getAttribute("aria-label")).toBe(
      `${INSTRUMENTS[tone.instrument].name}, ${tone.note.name}, beat position 17 of 32`,
    );
    expect(element(".selected-pitch").textContent).toBe(tone.note.name);
    expect(element(".selected-material").textContent).toBe(INSTRUMENTS[tone.instrument].name);
    if (index < TONES.length - 1) key("ArrowUp");
  }
  expect(notes()).toHaveLength(1);
});

test("note navigation preserves the existing redo branch", () => {
  add(2, 9);
  const completed = notes();
  click(button("Undo"));
  const before = notes();
  enterSurface();
  key("PageDown");
  key("PageDown");
  expectSelected(seedIds[0]);
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
  expectSelected(seedIds[16]);
  expectFinished();
  pointer("pointerup", 8, 10);
  expect(notes()).toEqual(before);
  expect(button("Undo").disabled).toBe(true);
});

test("switching to pointer selection does not retain the keyboard focus treatment", () => {
  enterSurface();
  key("PageUp");
  expectSelected(seedIds[15]);
  const light = element(seedSelector(1));
  pointer("pointerdown", 0, malletC4, light);
  pointer("pointerup", 0, malletC4);
  expect(document.activeElement).toBe(light);
  expect(light.getAttribute("aria-pressed")).toBe("true");
  expect(surface().classList.contains("is-keyboard")).toBe(false);
  pointer("pointerdown", 0, malletC4, light);
  pointer("pointerup", 0, malletC4);
  expect(document.activeElement).toBe(surface());
  expect(light.getAttribute("aria-pressed")).toBe("false");
});

function compactNeighbors() {
  act(() => {
    size.width = 390;
    observers.get(surface())!([{ contentRect: size }]);
    element(seedSelector(3)).focus();
  });
  key("ArrowDown"); // Give these neighbors the same E4 pitch.
  for (let step = 0; step < 3; step++) key("ArrowLeft");
  return element(seedSelector(3));
}

test.each(["select", "drag", "remove"])(
  "overlapping mobile targets %s the nearest note, not the topmost button",
  (action) => {
    const topmost = compactNeighbors();
    const neighbor = element(seedSelector(2));
    const before = notes();
    const center = locate({ id: "2", step: 4, tone: malletE4 }, size);
    const hit = topmost.getBoundingClientRect();
    expect(Math.hypot(center.x - (hit.x + 18), center.y - (hit.y + 18))).toBeLessThan(18);
    // The browser delivers this point to the later, overlapping button, not note 2.
    pointer("pointerdown", 4, malletE4, topmost, { button: action === "remove" ? 2 : 0 });
    if (action === "remove") {
      expect(document.querySelector(seedSelector(2))).toBeNull();
      expect(notes()).toEqual(before.filter((_, index) => index !== 1));
      return;
    }
    if (action === "drag") pointer("pointermove", 2, malletE4);
    pointer("pointerup", action === "drag" ? 2 : 4, malletE4);
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
  pointer("pointerdown", 5, malletE4, light);
  pointer("pointermove", 4.4, malletE4);
  pointer("pointerup", 4.4, malletE4);
  // The occupied landing at step 4 sends it back to step 5, but it is still near step 4.
  key("Escape");
  frame(18);
  pointer("pointerdown", 4.4, malletE4);
  pointer("pointerup", 4.4, malletE4);
  expect(document.activeElement).toBe(light);
  expect(light.getAttribute("aria-pressed")).toBe("true");
  expect(light.getAttribute("aria-label")).toContain("beat position 6 of 32");
});

test("keyboard input outside the surface never steals focus or changes the selected note", () => {
  const light = element(seedSelector(1));
  pointer("pointerdown", 0, malletC4, light);
  pointer("pointerup", 0, malletC4);
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

test.each(["body", ".point-space", "[data-light]"])(
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
  act(() => element(seedSelector(1)).focus());
  act(() => button("Remove selected note").focus());
  const before = notes();
  await act(async () => {
    expect(key(" ").defaultPrevented).toBe(false);
  });
  expect(TestAudioContext.instances).toHaveLength(0);
  // happy-dom does not synthesize a native button click from keyboard events.
  click(button("Remove selected note"));
  expect(document.querySelector(seedSelector(1))).toBeNull();
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
  expect(glowAt(0, malletC4)).toBe(225);
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
  expect(glowAt(0, malletC4)).toBe(225);
  expect(glowAt(30, keysE5)).toBe(155);
  expect(glowAt(28, malletE4)).toBe(155);
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
  const light = element("[data-light]:last-of-type");
  const from = locate({ id: "21", step: 3.4, tone: 9.2 }, size);
  const to = locate({ id: "21", step: 3, tone: 9 }, size);
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
  const to = locate({ id: "21", step: 3, tone: 9 }, size);
  expect(parseFloat(element("[data-light]:last-of-type").style.left)).toBeCloseTo(to.x);
});

test("collision feedback expires with a single redraw rather than a continuous frame loop", () => {
  pointer("pointerdown", 0, 2, surface(), { shiftKey: true });
  pointer("pointerup", 0, 2);
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
  expect(glowAt(0, malletC4)).toBe(225);
  await act(async () => button("Pause loop").click());
  expect(frames.size).toBe(0);
  const paused = draws.mock.calls.length;
  frame(1000);
  expect(draws).toHaveBeenCalledTimes(paused);
  expect(glowAt(0, malletC4)).toBe(225);
  await act(async () => button("Play loop").click());
  expect(frames.size).toBe(1);
  context.currentTime = 0.2;
  frame();
  expect(glowAt(0, malletC4)).toBeLessThan(225);
  expect(glowAt(0, malletC4)).toBeGreaterThan(155);
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
  expect(glowAt(0, malletC4)).toBe(225);
  enterSurface();
  key("PageDown");
  key("PageDown");
  key("ArrowUp");
  expectSelected(seedIds[0]);
  expect(glowAt(0, malletC4 + 1)).toBe(155);
});

test("playback does not rewrite static hit positions or poll toolbar layout every frame", async () => {
  const width = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get");
  const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get");
  enterSurface();
  key("PageUp");
  await act(async () => button("Play loop").click());
  const light = element(seedSelector(16));
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
  const target = locate({ id: "16", step: 30, tone: keysE5 }, resized);
  expect(parseFloat(element(seedSelector(16)).style.left)).toBeCloseTo(target.x);
  expect(element<HTMLCanvasElement>("canvas").width).toBe(1100);
  expect(draws.mock.calls.length).toBeGreaterThan(before);
  expect(frames.size).toBe(0);
});

function connectRoom(pattern: Pattern = { notes: [] }) {
  click(button("Solo mode"));
  const socket = TestSocket.instances.at(-1)!;
  act(() => socket.receive({ revision: 0, pattern }));
  return socket;
}

test.each(["toggle", "navigation"])(
  "switching modes via %s stops playback and starts the next composition fresh",
  async (control) => {
    for (const path of ["/", "/solo"]) {
      await act(async () => button("Play loop").click());
      const context = TestAudioContext.instances.at(-1)!;
      context.currentTime = 2;
      frame();
      expect(button("Pause loop").getAttribute("aria-pressed")).toBe("true");

      act(() => {
        if (control === "toggle") button("Solo mode").click();
        else {
          window.history.replaceState(null, "", path);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }
      });
      if (path === "/") {
        act(() =>
          TestSocket.instances.at(-1)!.receive({ revision: 0, pattern: createSeedPattern() }),
        );
      }
      expect(context.state).toBe("closed");
      expect(button("Play loop").disabled).toBe(false);
      expect(button("Play loop").getAttribute("aria-pressed")).toBe("false");
      expect(frames.size).toBe(0);
      const strikes = context.oscillators.length;
      frame(1000);
      expect(context.oscillators).toHaveLength(strikes);
    }
    await act(async () => button("Play loop").click());
    const context = TestAudioContext.instances.at(-1)!;
    expect(context.state).toBe("running");
    expect(context.currentTime).toBe(0);
    expect(context.oscillators.length).toBeGreaterThan(0);
  },
);

test.each(["play", "pause"])(
  "switching modes discards a pending %s without affecting new playback",
  async (transition) => {
    if (transition === "pause") await act(async () => button("Play loop").click());
    const pending = deferred();
    vi.spyOn(
      TestAudioContext.prototype,
      transition === "play" ? "resume" : "suspend",
    ).mockImplementationOnce(() => pending.promise);
    click(button(transition === "play" ? "Play loop" : "Pause loop"));
    const oldContext = TestAudioContext.instances.at(-1)!;
    expect(element<HTMLButtonElement>(".play-button").disabled).toBe(true);
    connectRoom(createSeedPattern());
    expect(oldContext.state).toBe("closed");
    expect(button("Play loop").disabled).toBe(false);
    await act(async () => button("Play loop").click());
    const context = TestAudioContext.instances.at(-1)!;
    expect(context).not.toBe(oldContext);
    await act(async () => pending.resolve());
    expect(context.state).toBe("running");
    expect(button("Pause loop").disabled).toBe(false);
    expect(button("Pause loop").getAttribute("aria-busy")).toBe("false");
    expect(frames.size).toBe(1);
  },
);

test.each(["play", "pause"])(
  "a failed %s from the previous mode cannot change new playback or report an error",
  async (transition) => {
    if (transition === "pause") await act(async () => button("Play loop").click());
    const pending = deferred();
    vi.spyOn(
      TestAudioContext.prototype,
      transition === "play" ? "resume" : "suspend",
    ).mockImplementationOnce(() => pending.promise);
    click(button(transition === "play" ? "Play loop" : "Pause loop"));
    connectRoom(createSeedPattern());
    await act(async () => button("Play loop").click());
    await act(async () => pending.reject(new Error("Old playback failed")));
    expect(button("Pause loop").disabled).toBe(false);
    expect(button("Pause loop").getAttribute("aria-pressed")).toBe("true");
    expect(element(".gesture-hint").textContent).not.toContain("Audio couldn’t");
    expect(TestAudioContext.instances.at(-1)!.state).toBe("running");
  },
);

test("switching compositions clears a playback error and allows a fresh start", async () => {
  vi.spyOn(TestAudioContext.prototype, "resume").mockRejectedValueOnce(new Error("Cannot resume"));
  await act(async () => button("Play loop").click());
  expect(element(".gesture-hint").textContent).toContain("Audio couldn’t start");
  connectRoom(createSeedPattern());
  expect(element(".gesture-hint").textContent).not.toContain("Audio couldn’t");
  await act(async () => button("Play loop").click());
  expect(button("Pause loop").getAttribute("aria-pressed")).toBe("true");
  expect(TestAudioContext.instances.at(-1)!.state).toBe("running");
});

test("mute is preserved when switching compositions", async () => {
  click(button("Mute audio"));
  await act(async () => button("Play loop").click());
  connectRoom(createSeedPattern());
  expect(button("Unmute audio").getAttribute("aria-pressed")).toBe("true");
  await act(async () => button("Play loop").click());
  expect(TestAudioContext.instances.at(-1)!.gains[0].gain.value).toBe(0);
});

test("Solo uses fresh UUIDs for starting, added, and restored notes", () => {
  expect(seedIds).toHaveLength(20);
  add(3, 7);
  expect(lightIds()).toHaveLength(21);
  const addedId = lightIds().at(-1)!;
  click(button("Sketch options"));
  click(element<HTMLButtonElement>(".sketch-menu button:nth-of-type(2)"));
  const restoredIds = lightIds();
  expect(restoredIds).toHaveLength(20);
  const ids = [...seedIds, addedId, ...restoredIds];
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) {
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  }
  expect(TestSocket.instances).toHaveLength(0);
});

test.each([1, 2])("sketch action %i remains undoable in Solo", (action) => {
  const starting = notes();
  add(3, 7);
  const before = notes();
  expect(before).toHaveLength(starting.length + 1);
  click(button("Sketch options"));
  const option = element<HTMLButtonElement>(`.sketch-menu button:nth-of-type(${action})`);
  expect(option.disabled).toBe(false);
  click(option);
  expect(notes()).toEqual(action === 1 ? [] : starting);
  click(button("Undo"));
  expect(notes()).toEqual(before);
});

test.each([false, true])(
  "Solo controls and an open menu disappear in shared mode (populated: %s)",
  (populated) => {
    expect(button("Undo").disabled).toBe(true);
    expect(button("Redo").disabled).toBe(true);
    click(button("Sketch options"));
    expect(element(".sketch-menu").textContent).toContain("Restore the starting phrase");
    const socket = connectRoom(populated ? createSeedPattern() : { notes: [] });
    for (const label of ["Undo", "Redo", "Sketch options"]) {
      expect(document.querySelector(`button[aria-label="${label}"]`)).toBeNull();
    }
    expect(document.querySelector(".sketch-menu")).toBeNull();
    expect(notes()).toHaveLength(populated ? createSeedPattern().notes.length : 0);
    expect(socket.sent).toHaveLength(0);
  },
);

test("Solo is network-free and its sketch and history survive mode switches and URL navigation", () => {
  expect(TestSocket.instances).toHaveLength(0);
  pointer("pointerdown", 3, 7);
  pointer("pointerup", 3, 7);
  const soloNotes = notes();
  expect(button("Undo").disabled).toBe(false);
  const socket = connectRoom();
  expect(window.location.pathname).toBe("/");
  expect(notes()).toHaveLength(0);
  expect(document.querySelector('button[aria-label="Undo"]')).toBeNull();
  expect(socket.sent).toHaveLength(0);
  click(button("Solo mode"));
  expect(window.location.pathname).toBe("/solo");
  expect(notes()).toEqual(soloNotes);
  expect(button("Undo").disabled).toBe(false);
  expect(button("Redo").disabled).toBe(true);
  click(button("Sketch options"));
  expect(element(".sketch-menu").textContent).toContain("Start with an empty space");
  expect(socket.readyState).toBe(3);
  act(() => {
    window.history.replaceState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(button("Solo mode").getAttribute("aria-pressed")).toBe("false");
  expect(document.querySelector('button[aria-label="Undo"]')).toBeNull();
  expect(document.querySelector(".sketch-menu")).toBeNull();
  expect(TestSocket.instances).toHaveLength(2);
});

test.each(["toggle", "navigation"])(
  "switching modes via %s cancels a Solo preview without changing its undo or redo history",
  (control) => {
    const starting = notes();
    add(3, 7);
    const edited = notes();
    click(button("Undo"));
    paint();
    expect(notes()).toHaveLength(starting.length + 2);

    act(() => {
      if (control === "toggle") button("Solo mode").click();
      else {
        window.history.replaceState(null, "", "/");
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
    });
    expectFinished();
    pointer("pointerup", 8, 10);
    const socket = TestSocket.instances.at(-1)!;
    act(() => socket.receive({ revision: 0, pattern: { notes: [] } }));
    expect(socket.sent).toHaveLength(0);
    click(button("Solo mode"));
    expect(notes()).toEqual(starting);
    expect(button("Undo").disabled).toBe(true);
    expect(button("Redo").disabled).toBe(false);
    pointer("pointerup", 8, 10);
    expect(notes()).toEqual(starting);
    click(button("Redo"));
    expect(notes()).toEqual(edited);
    click(button("Undo"));
    expect(notes()).toEqual(starting);
  },
);

test("mode switches discard an unacknowledged shared preview without changing Solo or replaying it", () => {
  add(3, 7);
  const soloIds = lightIds();
  const socket = connectRoom();
  add(5, 9);
  expect(socket.sent).toHaveLength(1);
  expect(lightIds()).toHaveLength(1);
  click(button("Solo mode"));
  expect(socket.readyState).toBe(3);
  expect(lightIds()).toEqual(soloIds);
  click(button("Undo"));
  expect(lightIds()).toEqual(seedIds);
  click(button("Redo"));
  expect(lightIds()).toEqual(soloIds);

  click(button("Solo mode"));
  const reconnected = TestSocket.instances.at(-1)!;
  expect(reconnected).not.toBe(socket);
  expect(lightIds()).toHaveLength(0);
  const saved = { id: crypto.randomUUID(), step: 8, tone: 10 };
  act(() => reconnected.receive({ revision: 1, pattern: { notes: [saved] } }));
  expect(lightIds()).toEqual([saved.id]);
  expect(reconnected.sent).toHaveLength(0);
  expect(surface().getAttribute("aria-disabled")).toBe("false");
});

test("the default URL connects to the room instead of starting a local sketch", async () => {
  await act(async () => root.render(null));
  window.history.replaceState(null, "", "/");
  await act(async () => root.render(createElement(StrictMode, null, createElement(App))));
  const socket = TestSocket.instances.at(-1)!;
  expect(socket.url.pathname).toBe("/api/room");
  expect(notes()).toHaveLength(0);
  expect(surface().getAttribute("aria-disabled")).toBe("true");
  add(3, 7);
  expect(socket.sent).toHaveLength(0);
  expect(notes()).toHaveLength(0);
  const pattern = createSeedPattern();
  act(() => socket.receive({ revision: 4, pattern }));
  expect(notes()).toHaveLength(20);
  expect(surface().getAttribute("aria-disabled")).toBe("false");
});

test("shared gestures send one committed batch with UUIDs, wait for acknowledgement, and roll back rejection", () => {
  const socket = connectRoom();
  pointer("pointerdown", 3, 7, surface(), { shiftKey: true });
  pointer("pointermove", 5, 9);
  expect(socket.sent).toHaveLength(0);
  pointer("pointerup", 5, 9);
  expect(socket.sent).toHaveLength(1);
  const request = socket.sent[0];
  expect(request.changes).toHaveLength(2);
  expect(
    request.changes.every((change) => change.type === "add" && typeof change.note.id === "string"),
  ).toBe(true);
  expect(notes()).toHaveLength(2);
  expect(surface().getAttribute("aria-disabled")).toBe("true");
  pointer("pointerdown", 7, 10);
  pointer("pointerup", 7, 10);
  expect(socket.sent).toHaveLength(1);
  act(() =>
    socket.receive(
      { revision: 0, pattern: { notes: [] } },
      { requestId: request.requestId, error: "That sound is already here." },
    ),
  );
  expect(notes()).toHaveLength(0);
  expect(surface().getAttribute("aria-disabled")).toBe("false");
  expect(element(".gesture-hint").textContent).toContain("already here");
});

test("a remote edit during a gesture is preserved without becoming part of the local command", () => {
  const socket = connectRoom();
  pointer("pointerdown", 3, 7);
  const remote = { id: crypto.randomUUID(), step: 5, tone: 10 };
  act(() => socket.receive({ revision: 1, pattern: { notes: [remote] } }));
  pointer("pointerup", 3, 7);
  expect(socket.sent).toHaveLength(1);
  expect(socket.sent[0].changes).toHaveLength(1);
  expect(socket.sent[0].changes[0]).toMatchObject({ type: "add", note: { step: 3, tone: 7 } });
  expect(notes()).toHaveLength(2);
  const change = socket.sent[0].changes[0];
  if (change.type !== "add") throw new Error("Expected an added light");
  act(() =>
    socket.receive(
      { revision: 2, pattern: { notes: [remote, change.note] } },
      { requestId: socket.sent[0].requestId },
    ),
  );
  expect(notes()).toHaveLength(2);
  expect(surface().getAttribute("aria-disabled")).toBe("false");
});

test.each(["deletion", "collision"])(
  "a remote %s invalidates a shared drag but keeps its preview until rejection",
  (conflict) => {
    const original = { id: crypto.randomUUID(), step: 3, tone: 7 };
    const socket = connectRoom({ notes: [original] });
    const before = notes();
    pointer("pointerdown", 3, 7);
    pointer("pointermove", 5, 9);
    const preview = notes();
    expect(preview).not.toEqual(before);
    const remote = { id: crypto.randomUUID(), step: 5, tone: 9 };
    const authoritative = { notes: conflict === "deletion" ? [remote] : [original, remote] };
    act(() => socket.receive({ revision: 1, pattern: authoritative }));
    expect(notes()).toEqual(preview);
    expect(socket.sent).toHaveLength(0);

    pointer("pointerup", 5, 9);
    expectFinished();
    expect(socket.sent).toHaveLength(1);
    const request = socket.sent[0];
    expect(request.changes).toEqual([{ type: "move", note: { ...original, step: 5, tone: 9 } }]);
    expect(notes()).toEqual(preview);
    expect(surface().getAttribute("aria-disabled")).toBe("true");

    const error =
      conflict === "deletion"
        ? "That light was removed. Try another edit."
        : "That sound is already here. Try another pitch or beat.";
    act(() =>
      socket.receive(
        { revision: 1, pattern: authoritative },
        { requestId: request.requestId, error },
      ),
    );
    expect(lightIds()).toEqual(authoritative.notes.map((note) => note.id));
    if (conflict === "collision") expect(notes()[0]).toBe(before[0]);
    expect(surface().getAttribute("aria-disabled")).toBe("false");
    expect(element(".gesture-hint").textContent).toContain(error);
    expect(socket.sent).toHaveLength(1);
  },
);

test("releasing a shared selection-only gesture reveals remote state without sending an edit", () => {
  const original = { id: crypto.randomUUID(), step: 3, tone: 7 };
  const socket = connectRoom({ notes: [original] });
  pointer("pointerdown", 3, 7);
  const remote = { id: crypto.randomUUID(), step: 5, tone: 10 };
  act(() => socket.receive({ revision: 1, pattern: { notes: [remote] } }));
  expect(lightIds()).toEqual([original.id]);
  expect(socket.sent).toHaveLength(0);

  pointer("pointerup", 3, 7);
  expectFinished();
  expect(lightIds()).toEqual([remote.id]);
  expect(socket.sent).toHaveLength(0);
  expect(surface().getAttribute("aria-disabled")).toBe("false");
});

test("canceling a shared preview reveals the latest remote state and release cannot recommit it", () => {
  const original = { id: crypto.randomUUID(), step: 3, tone: 7 };
  const socket = connectRoom({ notes: [original] });
  pointer("pointerdown", 10, 9, surface(), { shiftKey: true });
  expect(notes()).toHaveLength(2);
  const remote = { id: crypto.randomUUID(), step: 5, tone: 10 };
  act(() => socket.receive({ revision: 1, pattern: { notes: [remote] } }));
  key("Escape");
  expect(lightIds()).toEqual([remote.id]);
  expectFinished();
  pointer("pointermove", 12, 9);
  pointer("pointerup", 12, 9);
  expect(lightIds()).toEqual([remote.id]);
  expect(socket.sent).toHaveLength(0);
});

test.each(["acknowledgement", "rejection", "disconnect"])(
  "an unrelated remote update keeps the pending preview until %s",
  (outcome) => {
    const socket = connectRoom();
    add(3, 7);
    const request = socket.sent[0];
    const change = request.changes[0];
    if (change.type !== "add") throw new Error("Expected an added light");
    const remote = { id: crypto.randomUUID(), step: 5, tone: 10 };
    act(() => socket.receive({ revision: 1, pattern: { notes: [remote] } }));
    expect(lightIds()).toEqual([change.note.id]);
    expect(surface().getAttribute("aria-disabled")).toBe("true");

    if (outcome === "disconnect") {
      act(() => socket.close());
    } else {
      act(() =>
        socket.receive(
          {
            revision: outcome === "acknowledgement" ? 2 : 1,
            pattern: { notes: outcome === "acknowledgement" ? [remote, change.note] : [remote] },
          },
          {
            requestId: request.requestId,
            ...(outcome === "rejection" ? { error: "That sound is already here." } : {}),
          },
        ),
      );
    }
    expect(lightIds()).toEqual(
      outcome === "acknowledgement" ? [remote.id, change.note.id] : [remote.id],
    );
    expect(surface().getAttribute("aria-disabled")).toBe(String(outcome === "disconnect"));
    expect(socket.sent).toHaveLength(1);
  },
);

test("disconnect cancels unfinished gestures and reconnects without replaying edits", () => {
  const socket = connectRoom();
  pointer("pointerdown", 3, 7, surface(), { shiftKey: true });
  expect(notes()).toHaveLength(1);
  act(() => socket.close());
  expect(notes()).toHaveLength(0);
  pointer("pointerup", 3, 7);
  expect(socket.sent).toHaveLength(0);
  expect(surface().getAttribute("aria-disabled")).toBe("true");
  frame(500);
  const reconnected = TestSocket.instances.at(-1)!;
  expect(reconnected).not.toBe(socket);
  const saved = { id: crypto.randomUUID(), step: 3, tone: 7 };
  act(() => reconnected.receive({ revision: 1, pattern: { notes: [saved] } }));
  expect(notes()).toHaveLength(1);
  expect(reconnected.sent).toHaveLength(0);
  expect(surface().getAttribute("aria-disabled")).toBe("false");
});

test("a keyboard nudge during a drag cannot restore a remotely deleted note", () => {
  const note = { id: crypto.randomUUID(), step: 3, tone: 7 };
  const socket = connectRoom({ notes: [note] });
  pointer("pointerdown", 3, 7);
  pointer("pointermove", 5, 9);
  act(() => socket.receive({ revision: 1, pattern: { notes: [] } }));
  key("ArrowRight");
  expect(notes()).toHaveLength(0);
  expect(socket.sent).toHaveLength(0);
  expectFinished();
  pointer("pointerup", 5, 9);
  expect(notes()).toHaveLength(0);
  expect(socket.sent).toHaveLength(0);
});

test("a keyboard nudge during a drag uses the remotely updated position", () => {
  const note = { id: crypto.randomUUID(), step: 3, tone: 7 };
  const socket = connectRoom({ notes: [note] });
  pointer("pointerdown", 3, 7);
  pointer("pointermove", 5, 9);
  const moved = { ...note, step: 8, tone: 10 };
  act(() => socket.receive({ revision: 1, pattern: { notes: [moved] } }));
  key("ArrowRight");
  expect(socket.sent).toHaveLength(1);
  expect(socket.sent[0].changes).toEqual([{ type: "move", note: { ...moved, step: 9 } }]);
  expectFinished();
  pointer("pointerup", 5, 9);
  expect(socket.sent).toHaveLength(1);
});

test.each(["button", "Delete", "Backspace", "right-click"])(
  "shared moves and %s removal send targeted changes, not pattern replacements",
  (control) => {
    const note = { id: crypto.randomUUID(), step: 3, tone: 7 };
    const socket = connectRoom({ notes: [note] });
    act(() => element(`[data-light="${note.id}"]`).focus());
    key("ArrowRight");
    expect(socket.sent[0].changes).toEqual([{ type: "move", note: { ...note, step: 4 } }]);
    act(() =>
      socket.receive(
        { revision: 1, pattern: { notes: [{ ...note, step: 4 }] } },
        { requestId: socket.sent[0].requestId },
      ),
    );
    if (control === "button") click(button("Remove selected note"));
    else if (control === "right-click")
      pointer("pointerdown", 4, note.tone, surface(), { button: 2 });
    else key(control);
    expect(socket.sent).toHaveLength(2);
    expect(socket.sent[1].changes).toEqual([{ type: "remove", id: note.id }]);
    expect(notes()).toHaveLength(0);
    expect(document.activeElement).toBe(surface());
    expect(document.querySelector('[role="group"][aria-label="Selected note"]')).toBeNull();
    if (control === "button") expect(element(".gesture-hint").textContent).toBe("Note removed.");
    act(() =>
      socket.receive(
        { revision: 2, pattern: { notes: [] } },
        { requestId: socket.sent[1].requestId },
      ),
    );
    expect(notes()).toHaveLength(0);
    expect(surface().getAttribute("aria-disabled")).toBe("false");
  },
);

test("an acknowledgement timeout reconnects and loads saved state instead of retrying the edit", () => {
  const socket = connectRoom();
  add(3, 7);
  const change = socket.sent[0].changes[0];
  if (change.type !== "add") throw new Error("Expected an added light");
  frame(10_000);
  expect(socket.readyState).toBe(3);
  expect(surface().getAttribute("aria-disabled")).toBe("true");
  frame(500);
  const reconnected = TestSocket.instances.at(-1)!;
  act(() => reconnected.receive({ revision: 1, pattern: { notes: [change.note] } }));
  expect(notes()).toHaveLength(1);
  expect(reconnected.sent).toHaveLength(0);
  expect(surface().getAttribute("aria-disabled")).toBe("false");
});
