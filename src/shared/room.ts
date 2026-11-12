import { findCollisions, TONES } from "./pattern";
import type { Note, NoteId, Pattern } from "./pattern";
import { STEP_COUNT } from "./score";

export type Change =
  | { type: "add"; note: Note }
  | { type: "move"; note: Note }
  | { type: "remove"; id: NoteId };
export type RoomState = { revision: number; pattern: Pattern };
export type EditMessage = { type: "edit"; requestId: string; changes: Change[] };
export type StateMessage = {
  type: "state";
  state: RoomState;
  requestId?: string;
  error?: string;
};

export const MAX_MESSAGE_LENGTH = 128_000;
export const MAX_NOTES = 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isId(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNote(value: unknown): value is Note {
  return (
    isRecord(value) &&
    isId(value.id) &&
    Number.isInteger(value.step) &&
    Number(value.step) >= 0 &&
    Number(value.step) < STEP_COUNT &&
    Number.isInteger(value.tone) &&
    Number(value.tone) >= 0 &&
    Number(value.tone) < TONES.length
  );
}

export function parseEdit(value: unknown): EditMessage | null {
  if (
    !isRecord(value) ||
    value.type !== "edit" ||
    !isId(value.requestId) ||
    !Array.isArray(value.changes) ||
    !value.changes.length ||
    value.changes.length > MAX_NOTES * 2
  )
    return null;

  const changes: Change[] = [];
  for (const change of value.changes) {
    if (!isRecord(change)) return null;
    if (change.type === "remove" && isId(change.id)) {
      changes.push({ type: "remove", id: change.id });
    } else if ((change.type === "add" || change.type === "move") && isNote(change.note)) {
      const { id, step, tone } = change.note;
      changes.push({ type: change.type, note: { id, step, tone } });
    } else return null;
  }

  return { type: "edit", requestId: value.requestId, changes };
}

export function changesBetween(before: Pattern, after: Pattern): Change[] {
  const previous = new Map(before.notes.map((note) => [note.id, note]));
  const next = new Map(after.notes.map((note) => [note.id, note]));
  const changes: Change[] = [];

  for (const note of before.notes) {
    if (!next.has(note.id)) changes.push({ type: "remove", id: note.id });
  }

  for (const note of after.notes) {
    const old = previous.get(note.id);
    if (!old) changes.push({ type: "add", note });
    else if (old.step !== note.step || old.tone !== note.tone) changes.push({ type: "move", note });
  }
  return changes;
}

// Validate the final batch, so a multi-note gesture either lands in full or not at all.
export function applyChanges(pattern: Pattern, changes: Change[]): Pattern {
  const notes = new Map(pattern.notes.map((note) => [note.id, note]));
  const touched = new Set<NoteId>();

  for (const change of changes) {
    const id = change.type === "remove" ? change.id : change.note.id;
    if (touched.has(id)) throw new Error("A light can only change once per edit.");
    touched.add(id);
    if (change.type === "remove") notes.delete(id);
    else {
      const exists = notes.has(id);
      if (change.type === "add" && exists) throw new Error("That light already exists.");
      if (change.type === "move" && !exists)
        throw new Error("That light was removed. Try another edit.");
      notes.set(id, change.note);
    }
  }

  if (notes.size > MAX_NOTES) throw new Error("This composition has too many lights.");
  const next = { notes: [...notes.values()] };
  if (next.notes.some((note) => findCollisions(next, note).length)) {
    throw new Error("That sound is already here. Try another pitch or beat.");
  }
  return next;
}
