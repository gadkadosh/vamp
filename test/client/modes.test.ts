// @vitest-environment happy-dom
import { act } from "react";
import { expect, test } from "vite-plus/test";
import { createSeedPattern } from "../../src/shared/pattern";
import { setupAppTests, TestSocket, tones } from "./app-harness";

const app = setupAppTests();
const {
  element,
  surface,
  button,
  sketchOption,
  lightIds,
  notes,
  click,
  pointer,
  add,
  paint,
  expectFinished,
  connectRoom,
} = app;

test("Solo uses fresh UUIDs for starting, added, and restored notes", () => {
  expect(app.seedIds).toHaveLength(20);
  add(3, tones.malletE3);
  expect(lightIds()).toHaveLength(21);
  const addedId = lightIds().at(-1)!;
  click(button("Sketch options"));
  click(sketchOption("Restore the starting phrase"));
  const restoredIds = lightIds();
  expect(restoredIds).toHaveLength(20);
  const ids = [...app.seedIds, addedId, ...restoredIds];
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) {
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  }
  expect(TestSocket.instances).toHaveLength(0);
});

test.each(["Start with an empty space", "Restore the starting phrase"] as const)(
  "%s remains undoable in Solo",
  (action) => {
    const starting = notes();
    add(3, tones.malletE3);
    const before = notes();
    expect(before).toHaveLength(starting.length + 1);
    click(button("Sketch options"));
    const option = sketchOption(action);
    expect(option.disabled).toBe(false);
    click(option);
    expect(notes()).toEqual(action === "Start with an empty space" ? [] : starting);
    click(button("Undo"));
    expect(notes()).toEqual(before);
  },
);

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
  pointer("pointerdown", 3, tones.malletE3);
  pointer("pointerup", 3, tones.malletE3);
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
    add(3, tones.malletE3);
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
    pointer("pointerup", 8, tones.malletC4);
    const socket = TestSocket.instances.at(-1)!;
    act(() => socket.receive({ revision: 0, pattern: { notes: [] } }));
    expect(socket.sent).toHaveLength(0);
    click(button("Solo mode"));
    expect(notes()).toEqual(starting);
    expect(button("Undo").disabled).toBe(true);
    expect(button("Redo").disabled).toBe(false);
    pointer("pointerup", 8, tones.malletC4);
    expect(notes()).toEqual(starting);
    click(button("Redo"));
    expect(notes()).toEqual(edited);
    click(button("Undo"));
    expect(notes()).toEqual(starting);
  },
);

test("mode switches discard an unacknowledged shared preview without changing Solo or replaying it", () => {
  add(3, tones.malletE3);
  const soloIds = lightIds();
  const socket = connectRoom();
  add(5, tones.malletA3);
  expect(socket.sent).toHaveLength(1);
  expect(lightIds()).toHaveLength(1);
  click(button("Solo mode"));
  expect(socket.readyState).toBe(3);
  expect(lightIds()).toEqual(soloIds);
  click(button("Undo"));
  expect(lightIds()).toEqual(app.seedIds);
  click(button("Redo"));
  expect(lightIds()).toEqual(soloIds);

  click(button("Solo mode"));
  const reconnected = TestSocket.instances.at(-1)!;
  expect(reconnected).not.toBe(socket);
  expect(lightIds()).toHaveLength(0);
  const saved = { id: crypto.randomUUID(), step: 8, tone: tones.malletC4 };
  act(() => reconnected.receive({ revision: 1, pattern: { notes: [saved] } }));
  expect(lightIds()).toEqual([saved.id]);
  expect(reconnected.sent).toHaveLength(0);
  expect(surface().getAttribute("aria-disabled")).toBe("false");
});
