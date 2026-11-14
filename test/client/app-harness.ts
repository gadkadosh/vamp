import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, vi } from "vite-plus/test";
import { App } from "../../src/client/App";
import { locate } from "../../src/client/space";
import { TONES } from "../../src/shared/pattern";
import type { Pattern } from "../../src/shared/pattern";
import type { EditMessage, StateMessage } from "../../src/shared/room";
import { INSTRUMENTS, STEP_COUNT } from "../../src/shared/score";
import type { InstrumentId } from "../../src/shared/score";
import { TestAudioContext } from "../audio-context";

function tone(instrument: InstrumentId, pitch: string) {
  const index = TONES.findIndex(
    (tone) => tone.instrument === instrument && tone.note.name === pitch,
  );
  if (index < 0) throw new Error(`Unknown test pitch ${instrument} ${pitch}`);
  return index;
}

export const tones = {
  bassE2: tone("bass", "E2"),
  malletE3: tone("mallet", "E3"),
  malletA3: tone("mallet", "A3"),
  malletC4: tone("mallet", "C4"),
  malletD4: tone("mallet", "D4"),
  malletE4: tone("mallet", "E4"),
  malletA4: tone("mallet", "A4"),
  keysD4: tone("keys", "D4"),
  keysE5: tone("keys", "E5"),
};

export class TestSocket {
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

// Each suite gets its own fixture. Only browser APIs and transport are simulated;
// App, editing/history, rendering, and the sequencer run together under StrictMode.
export function setupAppTests() {
  const size = { width: 900, height: 600 };
  let root: Root;
  let seedIds: string[];
  let seedLabels: Map<string, string>;
  let frames: Map<number, FrameRequestCallback>;
  let wallTime: number;
  let draws: ReturnType<typeof vi.fn<() => void>>;
  let glows: Map<string, number>;
  let preference: EventTarget & { matches: boolean };
  let observers: Map<Element, (entries: { contentRect: typeof size }[]) => void>;

  beforeEach(async () => {
    window.history.replaceState(null, "", "/solo");
    TestSocket.instances = [];
    vi.stubGlobal("WebSocket", TestSocket);
    size.width = 900;
    size.height = 600;
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
        return new DOMRect(
          parseFloat(this.style.left) - 18,
          parseFloat(this.style.top) - 18,
          36,
          36,
        );
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
    await renderApp();
    seedIds = lightIds();
    seedLabels = new Map(
      [...document.querySelectorAll<HTMLElement>("[data-light]")].map((light) => [
        light.getAttribute("aria-label")!,
        light.dataset.light!,
      ]),
    );
  });

  afterEach(async () => {
    try {
      await act(async () => root.unmount());
      expect(frames.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      document.body.replaceChildren();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  async function renderApp() {
    await act(async () => root.render(createElement(StrictMode, null, createElement(App))));
  }

  async function unmountApp() {
    await act(async () => root.render(null));
  }

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
    expect(found, `Missing element: ${selector}`).not.toBeNull();
    return found!;
  }

  function surface() {
    return element(".point-space");
  }

  function button(label: string) {
    return element<HTMLButtonElement>(`button[aria-label="${label}"]`);
  }

  function sketchOption(label: "Start with an empty space" | "Restore the starting phrase") {
    const option = [...document.querySelectorAll<HTMLButtonElement>(".sketch-menu button")].find(
      (button) => button.textContent === label,
    );
    expect(option, `Missing sketch option: ${label}`).toBeDefined();
    return option!;
  }

  function lightIds() {
    return [...document.querySelectorAll<HTMLElement>("[data-light]")].map(
      (light) => light.dataset.light!,
    );
  }

  // Capture seed identities before edits, so these locators still work after moving a note.
  function seedId(instrument: InstrumentId, pitch: string, step: number) {
    const label = `${INSTRUMENTS[instrument].name}, ${pitch}, beat position ${step + 1} of ${STEP_COUNT}`;
    const id = seedLabels.get(label);
    expect(id, `Missing seed note: ${label}`).toBeDefined();
    return id!;
  }

  function seedSelector(instrument: InstrumentId, pitch: string, step: number) {
    return `[data-light="${seedId(instrument, pitch, step)}"]`;
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
    pointer("pointerdown", 6, tones.malletA3, surface(), { shiftKey: true });
    pointer("pointermove", 8, tones.malletC4);
  }

  function drag() {
    pointer("pointerdown", 0, tones.malletC4, element(seedSelector("mallet", "C4", 0)));
    pointer("pointermove", 2, tones.malletC4);
    expect(surface().classList.contains("is-dragging")).toBe(true);
  }

  function expectFinished() {
    expect(surface().classList.contains("is-dragging")).toBe(false);
    expect(surface().hasPointerCapture(1)).toBe(false);
  }

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

  function connectRoom(pattern: Pattern = { notes: [] }) {
    click(button("Solo mode"));
    const socket = TestSocket.instances.at(-1)!;
    act(() => socket.receive({ revision: 0, pattern }));
    return socket;
  }

  return {
    size,
    renderApp,
    unmountApp,
    frame,
    glowAt,
    element,
    surface,
    button,
    sketchOption,
    lightIds,
    seedId,
    seedSelector,
    notes,
    click,
    blur,
    key,
    pointer,
    add,
    paint,
    drag,
    expectFinished,
    enterSurface,
    expectSelected,
    connectRoom,
    get seedIds() {
      return seedIds;
    },
    get frames() {
      return frames;
    },
    get draws() {
      return draws;
    },
    get glows() {
      return glows;
    },
    get preference() {
      return preference;
    },
    get observers() {
      return observers;
    },
  };
}
