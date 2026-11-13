import { useRef, useState } from "react";
import { createSeedPattern, moveNote, placeNote } from "../shared/pattern";
import type { Note, NoteId, Pattern, Placement } from "../shared/pattern";
import { applyChanges, changesBetween } from "../shared/room";
import { useRoom } from "./useRoom";

type SoloHistory = { present: Pattern; past: Pattern[]; future: Pattern[] };
type Gesture = { before: Pattern; cancel: () => void };
// Only a gesture or an unacknowledged shared edit can overlay committed state.
type EditSession =
  | { phase: "idle" }
  | { phase: "gesturing"; gesture: Gesture; preview: Pattern; activated: boolean }
  | { phase: "awaiting-ack"; preview: Pattern };
type Composition = {
  solo: boolean;
  sketch: SoloHistory | null;
  shared: Pattern;
  edit: EditSession;
};
export type EditPlacement = Placement & { changed: boolean };

function startingSketch(): SoloHistory {
  return { present: createSeedPattern(), past: [], future: [] };
}

function visible(state: Composition): Pattern {
  if (state.edit.phase !== "idle") return state.edit.preview;
  return state.solo ? state.sketch!.present : state.shared;
}

export function useComposition(onMessage: (message: string) => void) {
  const [state, setState] = useState<Composition>(() => {
    const solo = window.location.pathname === "/solo";
    return {
      solo,
      sketch: solo ? startingSketch() : null,
      shared: { notes: [] },
      edit: { phase: "idle" },
    };
  });
  // Commands and gesture sessions must see earlier edits even before React renders them.
  const current = useRef(state);
  const room = useRoom(
    !state.solo,
    (update, pending) => {
      const state = current.current;
      apply({
        ...state,
        shared: update.state.pattern,
        edit: state.edit.phase === "awaiting-ack" && !pending ? { phase: "idle" } : state.edit,
      });
      if (update.error) onMessage(update.error);
    },
    () => {
      cancelGesture();
      apply({ ...current.current, edit: { phase: "idle" } });
      onMessage("Connection lost. Your last edit may not have been saved.");
    },
  );
  const pending = state.edit.phase === "awaiting-ack";
  const canEdit = state.solo || (room.status === "connected" && !pending);

  function apply(next: Composition) {
    current.current = next;
    setState(next);
  }

  function cancelGesture() {
    const { edit } = current.current;
    if (edit.phase !== "gesturing") return false;
    apply({ ...current.current, edit: { phase: "idle" } });
    edit.gesture.cancel();
    return true;
  }

  function changeMode(solo: boolean) {
    if (solo === current.current.solo) return false;
    cancelGesture();
    apply({
      ...current.current,
      solo,
      sketch: solo ? (current.current.sketch ?? startingSketch()) : current.current.sketch,
      shared: { notes: [] },
      edit: { phase: "idle" },
    });
    return true;
  }

  function commitSolo(before: Pattern, after: Pattern) {
    const state = current.current;
    const sketch = state.sketch!;
    apply({
      ...state,
      edit: { phase: "idle" },
      sketch:
        after === before
          ? sketch
          : { present: after, past: [...sketch.past, before].slice(-60), future: [] },
    });
  }

  function commitShared(before: Pattern, after: Pattern) {
    const state = current.current;
    const changes = changesBetween(before, after);
    if (!changes.length || !room.send(changes)) {
      apply({ ...state, edit: { phase: "idle" } });
      return;
    }

    let preview: Pattern;
    try {
      preview = applyChanges(state.shared, changes);
    } catch {
      // Keep the local preview until the server explains a concurrent conflict.
      preview = after;
    }
    apply({ ...state, edit: { phase: "awaiting-ack", preview } });
  }

  function commit(before: Pattern, after: Pattern) {
    if (current.current.solo) commitSolo(before, after);
    else commitShared(before, after);
  }

  function edit(change: (pattern: Pattern) => Pattern) {
    if (!canEdit) return;
    cancelGesture();
    const before = visible(current.current);
    commit(before, change(before));
  }

  function place(candidate: Note, preview = false): EditPlacement {
    if (!canEdit)
      return {
        document: visible(current.current),
        note: candidate,
        collisions: [],
        accepted: false,
        changed: false,
      };

    if (!preview) cancelGesture();
    const before = visible(current.current);
    const result = placeNote(before, candidate);
    if (result.accepted) {
      const state = current.current;
      if (preview && state.edit.phase === "gesturing")
        apply({ ...state, edit: { ...state.edit, preview: result.document } });
      else commit(before, result.document);
    }
    return { ...result, changed: result.document !== before };
  }

  function beginGesture(cancel: () => void) {
    cancelGesture();
    const active = { before: visible(current.current), cancel };
    // Freeze the gesture's base even before its first placement, as remote state advances.
    apply({
      ...current.current,
      edit: { phase: "gesturing", gesture: active, preview: active.before, activated: false },
    });
    function isActive() {
      const { edit } = current.current;
      return edit.phase === "gesturing" && edit.gesture === active;
    }
    return {
      activate: () => {
        const state = current.current;
        if (state.edit.phase === "gesturing" && state.edit.gesture === active)
          apply({ ...state, edit: { ...state.edit, activated: true } });
      },
      place: (note: Note) => (isActive() ? place(note, true) : null),
      commit: () => {
        if (isActive()) commit(active.before, visible(current.current));
      },
      cancel: () => {
        if (isActive()) cancelGesture();
      },
    };
  }

  function remove(id: NoteId) {
    edit((pattern) =>
      pattern.notes.some((note) => note.id === id)
        ? { ...pattern, notes: pattern.notes.filter((note) => note.id !== id) }
        : pattern,
    );
  }

  function move(id: NoteId, stepDelta: number, toneDelta: number) {
    if (!canEdit) return null;
    cancelGesture();
    // Resolve by ID after canceling: the authoritative note may have moved or been deleted.
    const note = visible(current.current).notes.find((note) => note.id === id);
    return note ? place(moveNote(note, stepDelta, toneDelta)) : null;
  }

  function undo() {
    if (!current.current.solo || cancelGesture()) return false;
    const sketch = current.current.sketch!;
    if (!sketch.past.length) return false;
    apply({
      ...current.current,
      sketch: {
        present: sketch.past[sketch.past.length - 1],
        past: sketch.past.slice(0, -1),
        future: [sketch.present, ...sketch.future],
      },
    });
    return true;
  }

  function redo() {
    if (!current.current.solo) return false;
    cancelGesture();
    const sketch = current.current.sketch!;
    if (!sketch.future.length) return false;
    apply({
      ...current.current,
      sketch: {
        present: sketch.future[0],
        past: [...sketch.past, sketch.present],
        future: sketch.future.slice(1),
      },
    });
    return true;
  }

  return {
    solo: state.solo,
    pattern: visible(state),
    canEdit,
    canUndo:
      state.solo &&
      ((state.edit.phase === "gesturing" && state.edit.activated) || !!state.sketch?.past.length),
    canRedo: state.solo && !!state.sketch?.future.length,
    status: room.status,
    pending,
    changeMode,
    clear: () => {
      if (current.current.solo) edit(() => ({ notes: [] }));
    },
    restore: () => {
      if (current.current.solo) edit(() => createSeedPattern());
    },
    place,
    move,
    remove,
    beginGesture,
    cancelGesture,
    undo,
    redo,
  };
}
