import { useRef, useState } from "react";
import { createSeedPattern, moveNote, placeNote } from "../shared/pattern";
import type { Note, NoteId, Pattern, Placement } from "../shared/pattern";
import { applyChanges, changesBetween } from "../shared/room";
import { useRoom } from "./useRoom";

type SoloHistory = { present: Pattern; past: Pattern[]; future: Pattern[] };
type Composition = {
  solo: boolean;
  sketch: SoloHistory | null;
  shared: Pattern;
  // A gesture or an unacknowledged shared edit overlays, but never replaces, committed state.
  preview: Pattern | null;
  gestureActivated: boolean;
};
type Gesture = { before: Pattern; cancel: () => void };
export type EditPlacement = Placement & { changed: boolean };

function startingSketch(): SoloHistory {
  return { present: createSeedPattern(), past: [], future: [] };
}

function visible(state: Composition): Pattern {
  return state.preview ?? (state.solo ? state.sketch!.present : state.shared);
}

export function useComposition(onMessage: (message: string) => void) {
  const [state, setState] = useState<Composition>(() => {
    const solo = window.location.pathname === "/solo";
    return {
      solo,
      sketch: solo ? startingSketch() : null,
      shared: { notes: [] },
      preview: null,
      gestureActivated: false,
    };
  });
  // Commands and gesture sessions must see earlier edits even before React renders them.
  const current = useRef(state);
  const gesture = useRef<Gesture | null>(null);
  const room = useRoom(
    !state.solo,
    (update, pending) => {
      apply({
        ...current.current,
        shared: update.state.pattern,
        preview: gesture.current || pending ? current.current.preview : null,
      });
      if (update.error) onMessage(update.error);
    },
    () => {
      cancelGesture();
      apply({ ...current.current, preview: null });
      onMessage("Connection lost. Your last edit may not have been saved.");
    },
  );
  const canEdit = state.solo || (room.status === "connected" && !room.pending);

  function apply(next: Composition) {
    current.current = next;
    setState(next);
  }

  function cancelGesture() {
    const active = gesture.current;
    if (!active) return false;
    gesture.current = null;
    apply({ ...current.current, preview: null, gestureActivated: false });
    active.cancel();
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
      preview: null,
    });
    return true;
  }

  function commit(before: Pattern, after: Pattern) {
    const state = current.current;
    if (state.solo) {
      const sketch = state.sketch!;
      apply({
        ...state,
        preview: null,
        gestureActivated: false,
        sketch:
          after === before
            ? sketch
            : { present: after, past: [...sketch.past, before].slice(-60), future: [] },
      });
      return;
    }

    const changes = changesBetween(before, after);
    let preview: Pattern | null = null;
    if (changes.length && room.send(changes)) {
      try {
        preview = applyChanges(state.shared, changes);
      } catch {
        // Keep the local preview until the server explains a concurrent conflict.
        preview = after;
      }
    }
    apply({ ...state, preview, gestureActivated: false });
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
      if (preview) apply({ ...current.current, preview: result.document });
      else commit(before, result.document);
    }
    return { ...result, changed: result.document !== before };
  }

  function beginGesture(cancel: () => void) {
    cancelGesture();
    const active = { before: visible(current.current), cancel };
    gesture.current = active;
    // Freeze the gesture's base even before its first placement, as remote state advances.
    apply({ ...current.current, preview: active.before });
    return {
      activate: () => {
        if (gesture.current === active) apply({ ...current.current, gestureActivated: true });
      },
      place: (note: Note) => (gesture.current === active ? place(note, true) : null),
      commit: () => {
        if (gesture.current !== active) return;
        gesture.current = null;
        commit(active.before, visible(current.current));
      },
      cancel: () => {
        if (gesture.current === active) cancelGesture();
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
    canUndo: state.solo && (state.gestureActivated || !!state.sketch?.past.length),
    canRedo: state.solo && !!state.sketch?.future.length,
    status: room.status,
    pending: room.pending,
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
