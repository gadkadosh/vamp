import type { Note, Pattern } from "./pattern";

export type PatternEdit =
  | { type: "place"; notes: Note[] }
  | { type: "remove"; id: number }
  | { type: "clear" }
  | { type: "restore" };

// Committed state and editing operations, independent of the instrument's local previews.
export type EditingSession = {
  pattern: Pattern;
  canUndo: boolean;
  canRedo: boolean;
  edit: (edit: PatternEdit) => void;
  undo: () => boolean;
  redo: () => boolean;
  nextId: () => number;
};
