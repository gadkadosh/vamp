import { useRef, useState } from "react";
import { createPattern, placeNote } from "./pattern";
import type { Pattern } from "./pattern";
import type { EditingSession, PatternEdit } from "./editing";

type History = { present: Pattern; past: Pattern[]; future: Pattern[] };

function applyEdit(pattern: Pattern, edit: PatternEdit): Pattern {
  switch (edit.type) {
    case "place":
      return edit.notes.reduce((current, note) => placeNote(current, note).document, pattern);
    case "remove":
      return pattern.notes.some(({ id }) => id === edit.id)
        ? { ...pattern, notes: pattern.notes.filter(({ id }) => id !== edit.id) }
        : pattern;
    case "clear":
      return pattern.notes.length ? { ...pattern, notes: [] } : pattern;
    case "restore":
      return createPattern();
  }
}

export function useSoloSession(): EditingSession {
  const [history, setHistory] = useState<History>(() => ({
    present: createPattern(),
    past: [],
    future: [],
  }));
  const historyRef = useRef(history);
  const nextNote = useRef(Math.max(...history.present.notes.map(({ id }) => id), 0) + 1);

  function apply(next: History) {
    historyRef.current = next;
    setHistory(next);
  }

  return {
    pattern: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    nextId: () => nextNote.current++,
    edit(edit) {
      const previous = historyRef.current;
      const present = applyEdit(previous.present, edit);
      if (present === previous.present) return;
      apply({
        present,
        past: [...previous.past, previous.present].slice(-60),
        future: [],
      });
    },
    undo() {
      const current = historyRef.current;
      if (!current.past.length) return false;
      apply({
        present: current.past[current.past.length - 1],
        past: current.past.slice(0, -1),
        future: [current.present, ...current.future],
      });
      return true;
    },
    redo() {
      const current = historyRef.current;
      if (!current.future.length) return false;
      apply({
        present: current.future[0],
        past: [...current.past, current.present],
        future: current.future.slice(1),
      });
      return true;
    },
  };
}
