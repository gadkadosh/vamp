// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { EditingSession } from "../../src/client/editing";
import { createPattern } from "../../src/client/pattern";
import { useSoloSession } from "../../src/client/useSoloSession";

let root: Root;
let session: EditingSession;

function Solo() {
  session = useSoloSession();
  return null;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(StrictMode, null, createElement(Solo))));
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

test("a group of placements snaps accepted notes and creates exactly one undo entry", () => {
  const before = session.pattern;
  const first = { id: session.nextId(), step: 2.2, tone: 9.1 };
  const duplicate = { ...first, id: session.nextId() };
  const last = { id: session.nextId(), step: 6.4, tone: 10.2 };
  act(() => session.edit({ type: "place", notes: [first, duplicate, last] }));
  const placed = session.pattern;
  expect(placed.notes).toEqual([
    ...before.notes,
    { ...first, step: 2, tone: 9 },
    { ...last, step: 6, tone: 10 },
  ]);
  expect(session.canUndo).toBe(true);
  act(() => expect(session.undo()).toBe(true));
  expect(session.pattern).toBe(before);
  expect(session.canUndo).toBe(false);
  expect(session.canRedo).toBe(true);
  act(() => expect(session.redo()).toBe(true));
  expect(session.pattern).toBe(placed);
  expect(session.canRedo).toBe(false);
});

test("rejected and unchanged edits preserve the pattern and its redo branch", () => {
  const before = session.pattern;
  const note = { id: session.nextId(), step: 2, tone: 9 };
  act(() => session.edit({ type: "place", notes: [note] }));
  const placed = session.pattern;
  act(() => expect(session.undo()).toBe(true));
  act(() => {
    session.edit({ type: "place", notes: [{ ...before.notes[0], id: session.nextId() }] });
    session.edit({ type: "place", notes: [before.notes[0]] });
    session.edit({ type: "place", notes: [] });
    session.edit({ type: "remove", id: -1 });
  });
  expect(session.pattern).toBe(before);
  expect(session.canUndo).toBe(false);
  expect(session.canRedo).toBe(true);
  act(() => expect(session.redo()).toBe(true));
  expect(session.pattern).toBe(placed);
});

test("remove, clear, and restore are explicit undoable edits", () => {
  const seed = session.pattern;
  act(() => session.edit({ type: "remove", id: seed.notes[0].id }));
  const removed = session.pattern;
  expect(removed.notes).toEqual(seed.notes.slice(1));
  act(() => session.edit({ type: "clear" }));
  expect(session.pattern.notes).toEqual([]);
  act(() => session.edit({ type: "restore" }));
  expect(session.pattern).toEqual(createPattern());
  act(() => expect(session.undo()).toBe(true));
  expect(session.pattern.notes).toEqual([]);
  act(() => expect(session.undo()).toBe(true));
  expect(session.pattern).toBe(removed);
  act(() => expect(session.undo()).toBe(true));
  expect(session.pattern).toBe(seed);
  expect(session.canUndo).toBe(false);
});

test("sequential edits use the latest committed state, including before React renders", () => {
  const before = session.pattern;
  const first = { id: session.nextId(), step: 2, tone: 9 };
  const last = { id: session.nextId(), step: 6, tone: 10 };
  act(() => {
    session.edit({ type: "place", notes: [first] });
    session.edit({ type: "place", notes: [last] });
  });
  expect(session.pattern.notes).toEqual([...before.notes, first, last]);
  act(() => expect(session.undo()).toBe(true));
  expect(session.pattern.notes).toEqual([...before.notes, first]);
  act(() => expect(session.undo()).toBe(true));
  expect(session.pattern).toBe(before);
});

test("IDs are not reused after undo, clear, or restore", () => {
  const first = session.nextId();
  expect(first).toBeGreaterThan(Math.max(...session.pattern.notes.map(({ id }) => id)));
  act(() => session.edit({ type: "place", notes: [{ id: first, step: 2, tone: 9 }] }));
  act(() => expect(session.undo()).toBe(true));
  expect(session.nextId()).toBe(first + 1);
  act(() => session.edit({ type: "clear" }));
  act(() => session.edit({ type: "restore" }));
  expect(session.nextId()).toBe(first + 2);
});

test("history retains at most 60 completed edits", () => {
  act(() => {
    for (let index = 0; index < 65; index++) {
      session.edit({ type: index % 2 === 0 ? "clear" : "restore" });
    }
  });
  expect(session.pattern.notes).toEqual([]);
  act(() => {
    for (let index = 0; index < 60; index++) expect(session.undo()).toBe(true);
  });
  expect(session.pattern.notes).toEqual([]);
  expect(session.canUndo).toBe(false);
  expect(session.undo()).toBe(false);
});
