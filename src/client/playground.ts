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
export type Source = { id: number; step: number; tone: number };
export type Constellation = { sources: Source[] };
export type Collision = { sourceId: number; step: number };
export type CollisionFeedback = { collisions: Collision[]; started: number };
export type Placement = {
  document: Constellation;
  source: Source;
  collisions: Collision[];
  accepted: boolean;
};
export const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export const wrapStep = (step: number) => ((step % STEP_COUNT) + STEP_COUNT) % STEP_COUNT;
export const toneFor = (source: Source) =>
  TONES[clamp(Math.round(source.tone), 0, TONES.length - 1)];
export const soundingStep = (step: number) => wrapStep(Math.round(step));
export const snapSource = (source: Source): Source => ({
  ...source,
  step: soundingStep(source.step),
  tone: clamp(Math.round(source.tone), 0, TONES.length - 1),
});

export function createConstellation(): Constellation {
  let id = 0;
  const sources: Source[] = [];
  for (const instrument of INSTRUMENTS) {
    for (const [name, step] of instrument.seed) {
      const frequency = instrument.notes.find((note) => note.name === name)!.frequency;
      const candidates = TONES.map((tone, index) => ({ ...tone, index })).filter(
        (tone) => tone.instrument === instrument.id,
      );
      const closest = candidates.reduce((a, b) =>
        Math.abs(a.note.frequency - frequency) <= Math.abs(b.note.frequency - frequency) ? a : b,
      );
      sources.push({ id: ++id, step, tone: closest.index });
    }
  }
  return { sources };
}

export function findCollisions(document: Constellation, candidate: Source): Collision[] {
  const tone = toneFor(candidate);
  const step = soundingStep(candidate.step);
  return document.sources.flatMap((other) => {
    if (other.id === candidate.id) return [];
    const otherTone = toneFor(other);
    if (otherTone.instrument !== tone.instrument) return [];
    if (tone.polyphonic && otherTone.row !== tone.row) return [];
    return soundingStep(other.step) === step ? [{ sourceId: other.id, step }] : [];
  });
}

// Every source-editing action uses this transaction: never leave a silent light behind.
export function placeSource(document: Constellation, candidate: Source): Placement {
  const source = snapSource(candidate);
  const collisions = findCollisions(document, source);
  if (collisions.length) return { document, source, collisions, accepted: false };
  const previous = document.sources.find((item) => item.id === source.id);
  if (previous && previous.step === source.step && previous.tone === source.tone) {
    return { document, source: previous, collisions: [], accepted: true };
  }
  const sources = previous
    ? document.sources.map((item) => (item.id === source.id ? source : item))
    : [...document.sources, source];
  return { document: { ...document, sources }, source, collisions: [], accepted: true };
}

export function compose(document: Constellation): TimedNote[] {
  // Placement has already resolved conflicts. Compilation never drops a visible light.
  return document.sources
    .map((source) => ({
      sourceId: source.id,
      instrument: toneFor(source).instrument,
      row: toneFor(source).row,
      step: soundingStep(source.step),
    }))
    .sort((a, b) => a.step - b.step);
}

export function moveSource(source: Source, stepDelta: number, toneDelta: number): Source {
  return {
    ...source,
    step: wrapStep(source.step + stepDelta),
    tone: clamp(source.tone + toneDelta, 0, TONES.length - 1),
  };
}

export function sourceLabel(source: Source): string {
  const instrument = INSTRUMENTS.find(({ id }) => id === toneFor(source).instrument)!;
  return `Note ${source.id}: ${instrument.name}, ${toneFor(source).note.name}, beat position ${soundingStep(source.step) + 1} of ${STEP_COUNT}`;
}
