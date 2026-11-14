// @vitest-environment happy-dom
import { act } from "react";
import { expect, test } from "vite-plus/test";
import { createSeedPattern } from "../../src/shared/pattern";
import type { Pattern } from "../../src/shared/pattern";
import { setupAppTests, TestSocket, tones } from "./app-harness";

const app = setupAppTests();
const {
  renderApp,
  unmountApp,
  frame,
  element,
  surface,
  button,
  lightIds,
  notes,
  click,
  key,
  pointer,
  add,
  expectFinished,
  connectRoom,
} = app;

test("the default URL connects to the room instead of starting a local sketch", async () => {
  await unmountApp();
  window.history.replaceState(null, "", "/");
  await renderApp();
  const socket = TestSocket.instances.at(-1)!;
  expect(socket.url.pathname).toBe("/api/room");
  expect(notes()).toHaveLength(0);
  expect(surface().getAttribute("aria-disabled")).toBe("true");
  add(3, tones.malletE3);
  expect(socket.sent).toHaveLength(0);
  expect(notes()).toHaveLength(0);
  const pattern = createSeedPattern();
  act(() => socket.receive({ revision: 4, pattern }));
  expect(notes()).toHaveLength(20);
  expect(surface().getAttribute("aria-disabled")).toBe("false");
});

test("shared gestures send one committed batch with UUIDs, wait for acknowledgement, and roll back rejection", () => {
  const socket = connectRoom();
  pointer("pointerdown", 3, tones.malletE3, surface(), { shiftKey: true });
  pointer("pointermove", 5, tones.malletA3);
  expect(socket.sent).toHaveLength(0);
  pointer("pointerup", 5, tones.malletA3);
  expect(socket.sent).toHaveLength(1);
  const request = socket.sent[0];
  expect(request.changes).toHaveLength(2);
  expect(
    request.changes.every((change) => change.type === "add" && typeof change.note.id === "string"),
  ).toBe(true);
  expect(notes()).toHaveLength(2);
  expect(surface().getAttribute("aria-disabled")).toBe("true");
  pointer("pointerdown", 7, tones.malletC4);
  pointer("pointerup", 7, tones.malletC4);
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
  pointer("pointerdown", 3, tones.malletE3);
  const remote = { id: crypto.randomUUID(), step: 5, tone: tones.malletC4 };
  act(() => socket.receive({ revision: 1, pattern: { notes: [remote] } }));
  pointer("pointerup", 3, tones.malletE3);
  expect(socket.sent).toHaveLength(1);
  expect(socket.sent[0].changes).toHaveLength(1);
  expect(socket.sent[0].changes[0]).toMatchObject({
    type: "add",
    note: { step: 3, tone: tones.malletE3 },
  });
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
    const original = { id: crypto.randomUUID(), step: 3, tone: tones.malletE3 };
    const socket = connectRoom({ notes: [original] });
    const before = notes();
    pointer("pointerdown", 3, tones.malletE3);
    pointer("pointermove", 5, tones.malletA3);
    const preview = notes();
    expect(preview).not.toEqual(before);
    const remote = { id: crypto.randomUUID(), step: 5, tone: tones.malletA3 };
    const authoritative = { notes: conflict === "deletion" ? [remote] : [original, remote] };
    act(() => socket.receive({ revision: 1, pattern: authoritative }));
    expect(notes()).toEqual(preview);
    expect(socket.sent).toHaveLength(0);

    pointer("pointerup", 5, tones.malletA3);
    expectFinished();
    expect(socket.sent).toHaveLength(1);
    const request = socket.sent[0];
    expect(request.changes).toEqual([
      { type: "move", note: { ...original, step: 5, tone: tones.malletA3 } },
    ]);
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
  const original = { id: crypto.randomUUID(), step: 3, tone: tones.malletE3 };
  const socket = connectRoom({ notes: [original] });
  pointer("pointerdown", 3, tones.malletE3);
  const remote = { id: crypto.randomUUID(), step: 5, tone: tones.malletC4 };
  act(() => socket.receive({ revision: 1, pattern: { notes: [remote] } }));
  expect(lightIds()).toEqual([original.id]);
  expect(socket.sent).toHaveLength(0);

  pointer("pointerup", 3, tones.malletE3);
  expectFinished();
  expect(lightIds()).toEqual([remote.id]);
  expect(socket.sent).toHaveLength(0);
  expect(surface().getAttribute("aria-disabled")).toBe("false");
});

test("canceling a shared preview reveals the latest remote state and release cannot recommit it", () => {
  const original = { id: crypto.randomUUID(), step: 3, tone: tones.malletE3 };
  const socket = connectRoom({ notes: [original] });
  pointer("pointerdown", 10, tones.malletA3, surface(), { shiftKey: true });
  expect(notes()).toHaveLength(2);
  const remote = { id: crypto.randomUUID(), step: 5, tone: tones.malletC4 };
  act(() => socket.receive({ revision: 1, pattern: { notes: [remote] } }));
  key("Escape");
  expect(lightIds()).toEqual([remote.id]);
  expectFinished();
  pointer("pointermove", 12, tones.malletA3);
  pointer("pointerup", 12, tones.malletA3);
  expect(lightIds()).toEqual([remote.id]);
  expect(socket.sent).toHaveLength(0);
});

test.each(["acknowledgement", "rejection", "disconnect"])(
  "an unrelated remote update keeps the pending preview until %s",
  (outcome) => {
    const socket = connectRoom();
    add(3, tones.malletE3);
    const request = socket.sent[0];
    const change = request.changes[0];
    if (change.type !== "add") throw new Error("Expected an added light");
    const remote = { id: crypto.randomUUID(), step: 5, tone: tones.malletC4 };
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

test.each(["acknowledgement", "rejection"])(
  "after %s, canceling a new gesture restores saved state and the next edit stays independent",
  (outcome) => {
    const original = { id: crypto.randomUUID(), step: 1, tone: tones.malletE3 };
    const socket = connectRoom({ notes: [original] });
    add(3, tones.malletA3);
    const firstRequest = socket.sent[0];
    const firstChange = firstRequest.changes[0];
    if (firstChange.type !== "add") throw new Error("Expected an added light");

    const remote = { id: crypto.randomUUID(), step: 5, tone: tones.malletC4 };
    const saved: Pattern["notes"] = [original, remote];
    if (outcome === "acknowledgement") saved.push(firstChange.note);
    act(() =>
      socket.receive(
        { revision: 2, pattern: { notes: saved } },
        {
          requestId: firstRequest.requestId,
          ...(outcome === "rejection" ? { error: "Edit rejected." } : {}),
        },
      ),
    );
    expect(lightIds()).toEqual(saved.map(({ id }) => id));
    expect(surface().getAttribute("aria-disabled")).toBe("false");

    pointer("pointerdown", 9, tones.malletE4, surface(), { shiftKey: true });
    pointer("pointermove", 11, tones.malletA4);
    expect(lightIds()).toHaveLength(saved.length + 2);
    key("Escape");
    pointer("pointerup", 11, tones.malletA4);
    expectFinished();
    expect(lightIds()).toEqual(saved.map(({ id }) => id));
    expect(socket.sent).toHaveLength(1);

    add(13, tones.keysD4);
    expect(socket.sent).toHaveLength(2);
    expect(socket.sent[1].changes).toEqual([
      { type: "add", note: { id: expect.any(String), step: 13, tone: tones.keysD4 } },
    ]);
    expect(lightIds()).toHaveLength(saved.length + 1);
    expect(surface().getAttribute("aria-disabled")).toBe("true");
  },
);

test("disconnect cancels unfinished gestures and reconnects without replaying edits", () => {
  const socket = connectRoom();
  pointer("pointerdown", 3, tones.malletE3, surface(), { shiftKey: true });
  expect(notes()).toHaveLength(1);
  act(() => socket.close());
  expect(notes()).toHaveLength(0);
  pointer("pointerup", 3, tones.malletE3);
  expect(socket.sent).toHaveLength(0);
  expect(surface().getAttribute("aria-disabled")).toBe("true");
  frame(500);
  const reconnected = TestSocket.instances.at(-1)!;
  expect(reconnected).not.toBe(socket);
  const saved = { id: crypto.randomUUID(), step: 3, tone: tones.malletE3 };
  act(() => reconnected.receive({ revision: 1, pattern: { notes: [saved] } }));
  expect(notes()).toHaveLength(1);
  expect(reconnected.sent).toHaveLength(0);
  expect(surface().getAttribute("aria-disabled")).toBe("false");
});

test("a keyboard nudge during a drag cannot restore a remotely deleted note", () => {
  const note = { id: crypto.randomUUID(), step: 3, tone: tones.malletE3 };
  const socket = connectRoom({ notes: [note] });
  pointer("pointerdown", 3, tones.malletE3);
  pointer("pointermove", 5, tones.malletA3);
  act(() => socket.receive({ revision: 1, pattern: { notes: [] } }));
  key("ArrowRight");
  expect(notes()).toHaveLength(0);
  expect(socket.sent).toHaveLength(0);
  expectFinished();
  pointer("pointerup", 5, tones.malletA3);
  expect(notes()).toHaveLength(0);
  expect(socket.sent).toHaveLength(0);
});

test("a keyboard nudge during a drag uses the remotely updated position", () => {
  const note = { id: crypto.randomUUID(), step: 3, tone: tones.malletE3 };
  const socket = connectRoom({ notes: [note] });
  pointer("pointerdown", 3, tones.malletE3);
  pointer("pointermove", 5, tones.malletA3);
  const moved = { ...note, step: 8, tone: tones.malletC4 };
  act(() => socket.receive({ revision: 1, pattern: { notes: [moved] } }));
  key("ArrowRight");
  expect(socket.sent).toHaveLength(1);
  expect(socket.sent[0].changes).toEqual([{ type: "move", note: { ...moved, step: 9 } }]);
  expectFinished();
  pointer("pointerup", 5, tones.malletA3);
  expect(socket.sent).toHaveLength(1);
});

test.each(["button", "Delete", "Backspace", "right-click"])(
  "shared moves and %s removal send targeted changes, not pattern replacements",
  (control) => {
    const note = { id: crypto.randomUUID(), step: 3, tone: tones.malletE3 };
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
  add(3, tones.malletE3);
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
