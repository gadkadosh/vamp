import { INSTRUMENTS, STEP_COUNT, VOICE_POLYPHONY } from "./score";
import type { InstrumentId, TimedNote } from "./score";

const MATERIALS = [
  { instrument: "bass", color: "#94bfa5", gate: 4, notes: ["C2", "D2", "E2", "G2", "A2", "C3"] },
  { instrument: "mallet", color: "#e9bd7e", gate: 1, notes: ["C4", "D4", "E4"] },
  {
    instrument: "keys",
    color: "#e5a599",
    gate: 2,
    notes: ["F4", "G4", "A4", "B4", "C5", "D5", "E5"],
  },
  { instrument: "glass", color: "#a3bfe7", gate: 1, notes: ["G5", "A5", "C6"] },
] as const;
export const TONES = MATERIALS.flatMap((material) => {
  const instrument = INSTRUMENTS.find(({ id }) => id === material.instrument)!;
  return material.notes.map((name) => ({
    instrument: material.instrument,
    color: material.color,
    gate: material.gate,
    row: instrument.notes.findIndex((note) => note.name === name),
    note: instrument.notes.find((note) => note.name === name)!,
  }));
});
// Drafts move continuously; committed lights land on rhythmic and pitched positions.
export type Source = { id: number; step: number; tone: number; energy?: number };
export const energyFor = (source: Source) => clamp(source.energy ?? 0.5);
// The middle of the volume preserves the original loudness.
export const gainForEnergy = (energy: number) => 0.18 + clamp(energy) * 1.64;
export type Constellation = { sources: Source[]; voice: "keys" | "nylon" };
export type SpatialNote = TimedNote & { sourceId: number };
export type View = "field" | "orbit" | "volume";
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
  ...(source.energy === undefined ? {} : { energy: clamp(source.energy) }),
});

export function createConstellation(): Constellation {
  let id = 0;
  const sources: Source[] = [];
  for (const instrument of INSTRUMENTS) {
    if (instrument.id === "nylon") continue;
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
  return { sources, voice: "keys" };
}

export function breathe(document: Constellation): Constellation {
  const sources = document.sources.map((source) => {
    const energy = clamp(
      0.5 + Math.sin((source.step / STEP_COUNT) * Math.PI * 2 + source.tone * 0.24) * 0.43,
    );
    return energy === energyFor(source) ? source : { ...source, energy };
  });
  return sources.every((source, i) => source === document.sources[i])
    ? document
    : { ...document, sources };
}

export function instrumentFor(source: Source, voice: Constellation["voice"]): InstrumentId {
  const instrument = toneFor(source).instrument;
  return instrument === "keys" ? voice : instrument;
}

export function findCollisions(document: Constellation, candidate: Source): Collision[] {
  const tone = toneFor(candidate);
  const step = soundingStep(candidate.step);
  return document.sources.flatMap((other) => {
    if (other.id === candidate.id) return [];
    const otherTone = toneFor(other);
    if (otherTone.instrument !== tone.instrument) return [];
    if (VOICE_POLYPHONY[tone.instrument] && otherTone.row !== tone.row) return [];
    return soundingStep(other.step) === step ? [{ sourceId: other.id, step }] : [];
  });
}

// Every source-editing action uses this transaction: never leave a silent light behind.
export function placeSource(document: Constellation, candidate: Source): Placement {
  const source = snapSource(candidate);
  const collisions = findCollisions(document, source);
  if (collisions.length) return { document, source, collisions, accepted: false };
  const previous = document.sources.find((item) => item.id === source.id);
  if (
    previous &&
    previous.step === source.step &&
    previous.tone === source.tone &&
    energyFor(previous) === energyFor(source)
  ) {
    return { document, source: previous, collisions: [], accepted: true };
  }
  const sources = previous
    ? document.sources.map((item) => (item.id === source.id ? source : item))
    : [...document.sources, source];
  return { document: { ...document, sources }, source, collisions: [], accepted: true };
}

export function compose(document: Constellation): SpatialNote[] {
  // Placement has already resolved conflicts. Compilation never drops a visible light.
  return document.sources
    .map((source) => ({
      sourceId: source.id,
      instrument: instrumentFor(source, document.voice),
      row: toneFor(source).row,
      step: soundingStep(source.step),
      length: toneFor(source).gate,
      ...(source.energy === undefined ? {} : { gain: gainForEnergy(source.energy) }),
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

export function sourceLabel(source: Source, voice: Constellation["voice"]): string {
  const instrument = INSTRUMENTS.find(({ id }) => id === instrumentFor(source, voice))!;
  return `Light ${source.id}: ${instrument.name}, ${toneFor(source).note.name}, beat position ${soundingStep(source.step) + 1} of ${STEP_COUNT}${source.energy === undefined ? "" : `, intensity ${Math.round(energyFor(source) * 100)} percent`}`;
}
