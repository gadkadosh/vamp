import { useRef, useState } from "react";
import { createPattern, placeNote } from "../shared/pattern";
import type { Pattern } from "../shared/pattern";
import type { SoloSession, PatternEdit } from "./editing";

type History = { present: Pattern; past: Pattern[]; future: Pattern[] };

function applyEdit(pattern: Pattern, edit: PatternEdit): Pattern {
  switch (edit.type) {
    case "place":
      return edit.notes.reduce((current, note) => placeNote(current, note).document, pattern);
    case "remove":
      return pattern.notes.some(({ id }) => id === edit.id)
        ? { ...pattern, notes: pattern.notes.filter(({ id }) => id !== edit.id) }
        : pattern;
  }
}

export function useSoloSession(): SoloSession {
  const [history, setHistory] = useState<History>(() => ({
    present: createPattern(),
    past: [],
    future: [],
  }));
  const historyRef = useRef(history);
  const nextNote = useRef(history.present.notes.length + 1);

  function apply(next: History) {
    historyRef.current = next;
    setHistory(next);
  }

  function commit(present: Pattern) {
    const previous = historyRef.current;
    if (present === previous.present) return;
    apply({
      present,
      past: [...previous.past, previous.present].slice(-60),
      future: [],
    });
  }

  return {
    kind: "solo",
    pattern: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    nextId: () => nextNote.current++,
    edit: (edit) => commit(applyEdit(historyRef.current.present, edit)),
    clear() {
      const current = historyRef.current.present;
      if (current.notes.length) commit({ ...current, notes: [] });
    },
    restore: () => commit(createPattern()),
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
