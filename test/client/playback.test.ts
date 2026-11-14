// @vitest-environment happy-dom
import { act } from "react";
import { expect, test, vi } from "vite-plus/test";
import { createSeedPattern } from "../../src/shared/pattern";
import { DEFAULT_VOLUME } from "../../src/shared/score";
import { deferred, TestAudioContext } from "../audio-context";
import { setupAppTests, TestSocket, tones } from "./app-harness";

const app = setupAppTests();
const {
  frame,
  glowAt,
  element,
  surface,
  button,
  seedSelector,
  notes,
  click,
  key,
  add,
  connectRoom,
} = app;

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
  act(() => element(seedSelector("mallet", "C4", 0)).focus());
  act(() => button("Remove selected note").focus());
  const before = notes();
  await act(async () => {
    expect(key(" ").defaultPrevented).toBe(false);
  });
  expect(TestAudioContext.instances).toHaveLength(0);
  // happy-dom does not synthesize a native button click from keyboard events.
  click(button("Remove selected note"));
  expect(document.querySelector(seedSelector("mallet", "C4", 0))).toBeNull();
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
  expect(app.frames.size).toBe(0);
  await act(async () => pending.resolve());
  expect(button("Pause loop").disabled).toBe(false);
  expect(button("Pause loop").getAttribute("aria-busy")).toBe("false");
  expect(button("Pause loop").getAttribute("aria-pressed")).toBe("true");
  expect(TestAudioContext.instances[0].state).toBe("running");
  expect(app.frames.size).toBe(1);
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
    expect(app.frames.size).toBe(0);
    await toggle("Play loop");
    const context = TestAudioContext.instances[0];
    vi.spyOn(context, "suspend").mockRejectedValueOnce(new Error("Cannot suspend"));
    await toggle("Pause loop");
    expect(button("Pause loop").disabled).toBe(false);
    expect(element('[role="status"]').textContent).toContain("Audio couldn’t pause");
    expect(context.state).toBe("running");
    expect(app.frames.size).toBe(1);
    await toggle("Pause loop");
    expect(button("Play loop").getAttribute("aria-pressed")).toBe("false");
    expect(context.state).toBe("suspended");
    expect(app.frames.size).toBe(0);
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
  add(3, tones.malletA3);
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
  expect(app.frames.size).toBe(1);
  context.currentTime = 0.05;
  frame();
  expect(glowAt(0, tones.malletC4)).toBe(225);
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
  expect(app.frames.size).toBe(0);
});

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
      expect(app.frames.size).toBe(0);
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
    expect(app.frames.size).toBe(1);
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
