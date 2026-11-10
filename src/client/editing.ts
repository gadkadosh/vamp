import type { Note, NoteId, Pattern } from "../shared/pattern";

export type PatternEdit = { type: "place"; notes: Note[] } | { type: "remove"; id: NoteId };

type Session = {
  pattern: Pattern;
  edit: (edit: PatternEdit) => void;
};

export type SoloSession = Session & {
  kind: "solo";
  canUndo: boolean;
  canRedo: boolean;
  undo: () => boolean;
  redo: () => boolean;
  clear: () => void;
  restore: () => void;
  nextId: () => number;
};

export type SharedSession = Session & {
  kind: "shared";
  status: "loading" | "ready" | "saving" | "unavailable";
  error: string;
  reload: () => void;
  nextId: () => string;
};

export type EditingSession = SoloSession | SharedSession;
