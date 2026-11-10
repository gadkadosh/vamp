import { STEP_COUNT } from "./music";
import { TONES } from "./pattern";
import type { Note, Pattern } from "./pattern";

export const COMPOSITION_ID = "global";
export type SharedNote = Note & { id: string };
export type Composition = { id: string; revision: number; pattern: Pattern };
export type NoteChange =
  | { type: "add"; note: SharedNote }
  | { type: "move"; note: SharedNote }
  | { type: "remove"; id: string };
export type CompositionEdit = { compositionId: string; changes: NoteChange[] };
export type EditResponse = { composition: Composition; error?: string };

export function isSharedId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9-]{1,64}$/.test(value);
}

export function isSharedNote(value: unknown): value is SharedNote {
  if (value === null || typeof value !== "object") return false;
  const note = value as Record<string, unknown>;
  return (
    isSharedId(note.id) &&
    typeof note.step === "number" &&
    Number.isInteger(note.step) &&
    note.step >= 0 &&
    note.step < STEP_COUNT &&
    typeof note.tone === "number" &&
    Number.isInteger(note.tone) &&
    note.tone >= 0 &&
    note.tone < TONES.length
  );
}

export function isComposition(value: unknown): value is Composition {
  if (value === null || typeof value !== "object") return false;
  const composition = value as Record<string, unknown>;
  if (
    !isSharedId(composition.id) ||
    typeof composition.revision !== "number" ||
    !Number.isSafeInteger(composition.revision) ||
    composition.revision < 0 ||
    !composition.pattern ||
    typeof composition.pattern !== "object"
  )
    return false;
  const pattern = composition.pattern as Record<string, unknown>;
  return (
    Array.isArray(pattern.notes) &&
    pattern.notes.length <= STEP_COUNT * TONES.length &&
    pattern.notes.every(isSharedNote)
  );
}
