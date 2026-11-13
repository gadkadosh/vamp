import { INSTRUMENTS, INSTRUMENT_IDS, pitchIndex, STEP_COUNT } from "./score";
import type { InstrumentId, NoteId, TimedNote } from "./score";
import { STARTING_PHRASE } from "./seed";
export type { NoteId } from "./score";

// Presentation only: pitch ranges come from the score and may overlap between instruments.
export const INSTRUMENT_LAYOUT = [
  { instrument: "bass", color: "#6dcbb0" },
  { instrument: "mallet", color: "#efbb67" },
  { instrument: "keys", color: "#e99db3" },
  { instrument: "glass", color: "#a5b4f6" },
] as const satisfies readonly { instrument: InstrumentId; color: string }[];

export const TONES = INSTRUMENT_LAYOUT.flatMap((entry) => {
  const instrument = INSTRUMENTS[entry.instrument];
  return instrument.notes
    .map((note, row) => ({
      instrument: entry.instrument,
      polyphonic: instrument.polyphonic,
      color: entry.color,
      row,
      note,
    }))
    .sort((a, b) => a.note.frequency - b.note.frequency);
});

// Drafts move continuously; committed lights land on rhythmic and pitched positions.
export type Note = { id: NoteId; step: number; tone: number };
export type Pattern = { notes: Note[] };
export type Collision = { noteId: NoteId; step: number };
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

export function createSeedPattern(
  idFor: (index: number) => NoteId = () => crypto.randomUUID(),
): Pattern {
  let id = 0;
  const notes: Note[] = [];
  for (const instrumentId of INSTRUMENT_IDS) {
    for (const [name, step] of STARTING_PHRASE[instrumentId]) {
      const row = pitchIndex(instrumentId, name);
      const tone = TONES.findIndex((tone) => tone.instrument === instrumentId && tone.row === row);
      if (tone < 0) throw new Error(`No instrument layout for ${instrumentId}`);
      notes.push({ id: idFor(++id), step, tone });
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
  const instrument = INSTRUMENTS[toneFor(note).instrument];
  return `${instrument.name}, ${toneFor(note).note.name}, beat position ${soundingStep(note.step) + 1} of ${STEP_COUNT}`;
}
