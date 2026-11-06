import { scheduleGlass, scheduleMallet, startBass, startFeltKeys } from "./voices";

export const TEMPO = 88;
export const STEP_COUNT = 32;
export const STEP_SECONDS = 60 / TEMPO / 4;
export const DEFAULT_VOLUME = 0.35;
export type Note = { name: string; frequency: number };

function pitches(midis: readonly number[]): Note[] {
  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  return midis.map((midi) => ({
    name: `${names[midi % 12]}${Math.floor(midi / 12) - 1}`,
    frequency: 440 * 2 ** ((midi - 69) / 12),
  }));
}

const MELODY_NOTES = pitches([76, 74, 72, 71, 69, 67, 65, 64, 62, 60]);
const MELODY_SEED = [
  ["E5", 2, 2],
  ["D5", 6, 2],
  ["C5", 10, 3],
  ["B4", 14, 2],
  ["C5", 18, 3],
  ["G4", 22, 2],
  ["A4", 26, 2],
  ["E5", 30, 2],
] as const;

export const INSTRUMENTS = [
  {
    id: "mallet",
    name: "Mallet",
    description: "Harmony · original tone · chords welcome",
    mode: "hit",
    notes: [
      { name: "A4", frequency: 440 },
      { name: "G4", frequency: 391.995 },
      { name: "E4", frequency: 329.628 },
      { name: "D4", frequency: 293.665 },
      { name: "C4", frequency: 261.626 },
    ],
    start: scheduleMallet,
    seed: [
      ["C4", 0, 1],
      ["E4", 4, 1],
      ["G4", 8, 1],
      ["E4", 12, 1],
      ["D4", 16, 1],
      ["A4", 20, 1],
      ["G4", 24, 1],
      ["E4", 28, 1],
    ],
  },
  {
    id: "keys",
    name: "Felt keys",
    description: "Melody · one note at a time",
    mode: "mono",
    // Full C major: F and B add melodic movement beyond the original pentatonic.
    notes: MELODY_NOTES,
    start: startFeltKeys,
    seed: MELODY_SEED,
  },
  {
    id: "bass",
    name: "Plucked bass",
    description: "Foundation · one note at a time",
    mode: "mono",
    notes: pitches([48, 45, 43, 40, 38, 36]),
    start: startBass,
    seed: [
      ["C2", 0, 10],
      ["G2", 16, 10],
    ],
  },
  {
    id: "glass",
    name: "Glass chimes",
    description: "Sparkle · sparse, ringing accents",
    mode: "hit",
    notes: pitches([84, 81, 79, 76, 74, 72]),
    start: scheduleGlass,
    seed: [
      ["E5", 10, 1],
      ["C6", 26, 1],
    ],
  },
] as const;
export type InstrumentId = (typeof INSTRUMENTS)[number]["id"];
// Spatial event playback allows chords; the original grid's editing modes stay unchanged.
export const VOICE_POLYPHONY: Record<InstrumentId, boolean> = {
  mallet: true,
  keys: true,
  bass: false,
  glass: true,
};
export const DEFAULT_ENABLED: Record<InstrumentId, boolean> = {
  mallet: true,
  keys: true,
  bass: true,
  glass: true,
};
export type TimedNote = {
  instrument: InstrumentId;
  row: number;
  step: number;
  gain?: number;
};
export type Pattern = boolean[][];
export type Patterns = Record<InstrumentId, Pattern>;

export function createSeedPatterns(): Patterns {
  const patterns = Object.fromEntries(
    INSTRUMENTS.map(({ id, notes }) => [
      id,
      notes.map(() => Array<boolean>(STEP_COUNT).fill(false)),
    ]),
  ) as Patterns;
  for (const instrument of INSTRUMENTS) {
    for (const [name, step, length] of instrument.seed) {
      const row = instrument.notes.findIndex((note) => note.name === name);
      patterns[instrument.id][row].fill(true, step, step + length);
    }
  }
  return patterns;
}

export function togglePatternCell(
  patterns: Patterns,
  id: InstrumentId,
  row: number,
  step: number,
): Patterns {
  const mono = INSTRUMENTS.find((instrument) => instrument.id === id)!.mode === "mono";
  const active = patterns[id][row][step];
  return {
    ...patterns,
    [id]: patterns[id].map((cells, index) => {
      if (!mono && index !== row) return cells;
      return cells.map((value, column) =>
        column !== step ? value : index === row ? !active : false,
      );
    }),
  };
}
