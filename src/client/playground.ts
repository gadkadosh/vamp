import { INSTRUMENTS, STEP_COUNT } from "./score";
import type { TimedNote } from "./score";

export const MATERIALS = [
  {
    instrument: "bass",
    name: "Bass",
    color: "#6dcbb0",
    notes: ["C2", "D2", "E2", "G2", "A2", "C3"],
  },
  { instrument: "mallet", name: "Mallet", color: "#efbb67", notes: ["C4", "D4", "E4"] },
  {
    instrument: "keys",
    name: "Felt keys",
    color: "#e99db3",
    notes: ["F4", "G4", "A4", "B4", "C5", "D5", "E5"],
  },
  { instrument: "glass", name: "Glass", color: "#a5b4f6", notes: ["G5", "A5", "C6"] },
] as const;
export const TONES = MATERIALS.flatMap((material) => {
  const instrument = INSTRUMENTS.find(({ id }) => id === material.instrument)!;
  return material.notes.map((name) => ({
    instrument: material.instrument,
    polyphonic: instrument.polyphonic,
    color: material.color,
    row: instrument.notes.findIndex((note) => note.name === name),
    note: instrument.notes.find((note) => note.name === name)!,
  }));
});
// Drafts move continuously; committed lights land on rhythmic and pitched positions.
export type Note = { id: number; step: number; tone: number };
export type Pattern = { notes: Note[] };
export type Collision = { noteId: number; step: number };
export type CollisionFeedback = { collisions: Collision[]; started: number };
export type Placement = {
  document: Pattern;
  note: Note;
  collisions: Collision[];
  accepted: boolean;
};
export const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export const wrapStep = (step: number) => ((step % STEP_COUNT) + STEP_COUNT) % STEP_COUNT;
export const toneFor = (note: Note) => TONES[clamp(Math.round(note.tone), 0, TONES.length - 1)];
export const soundingStep = (step: number) => wrapStep(Math.round(step));
export const snapNote = (note: Note): Note => ({
  ...note,
  step: soundingStep(note.step),
  tone: clamp(Math.round(note.tone), 0, TONES.length - 1),
});

export function createPattern(): Pattern {
  let id = 0;
  const notes: Note[] = [];
  for (const instrument of INSTRUMENTS) {
    for (const [name, step] of instrument.seed) {
      const frequency = instrument.notes.find((note) => note.name === name)!.frequency;
      const candidates = TONES.map((tone, index) => ({ ...tone, index })).filter(
        (tone) => tone.instrument === instrument.id,
      );
      const closest = candidates.reduce((a, b) =>
        Math.abs(a.note.frequency - frequency) <= Math.abs(b.note.frequency - frequency) ? a : b,
      );
      notes.push({ id: ++id, step, tone: closest.index });
    }
  }
  return { notes };
}

export function findCollisions(document: Pattern, candidate: Note): Collision[] {
  const tone = toneFor(candidate);
  const step = soundingStep(candidate.step);
  return document.notes.flatMap((other) => {
    if (other.id === candidate.id) return [];
    const otherTone = toneFor(other);
    if (otherTone.instrument !== tone.instrument) return [];
    if (tone.polyphonic && otherTone.row !== tone.row) return [];
    return soundingStep(other.step) === step ? [{ noteId: other.id, step }] : [];
  });
}

// Every note-editing action uses this transaction: never leave a silent light behind.
export function placeNote(document: Pattern, candidate: Note): Placement {
  const note = snapNote(candidate);
  const collisions = findCollisions(document, note);
  if (collisions.length) return { document, note, collisions, accepted: false };
  const previous = document.notes.find((item) => item.id === note.id);
  if (previous && previous.step === note.step && previous.tone === note.tone) {
    return { document, note: previous, collisions: [], accepted: true };
  }
  const notes = previous
    ? document.notes.map((item) => (item.id === note.id ? note : item))
    : [...document.notes, note];
  return { document: { ...document, notes }, note, collisions: [], accepted: true };
}

export function compose(document: Pattern): TimedNote[] {
  // Placement has already resolved conflicts. Compilation never drops a visible light.
  return document.notes
    .map((note) => ({
      noteId: note.id,
      instrument: toneFor(note).instrument,
      row: toneFor(note).row,
      step: soundingStep(note.step),
    }))
    .sort((a, b) => a.step - b.step);
}

export function moveNote(note: Note, stepDelta: number, toneDelta: number): Note {
  return {
    ...note,
    step: wrapStep(note.step + stepDelta),
    tone: clamp(note.tone + toneDelta, 0, TONES.length - 1),
  };
}

export function noteLabel(note: Note): string {
  const instrument = INSTRUMENTS.find(({ id }) => id === toneFor(note).instrument)!;
  return `Note ${note.id}: ${instrument.name}, ${toneFor(note).note.name}, beat position ${soundingStep(note.step) + 1} of ${STEP_COUNT}`;
}
