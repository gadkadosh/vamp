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
  ["E5", 2],
  ["D5", 6],
  ["C5", 10],
  ["B4", 14],
  ["C5", 18],
  ["G4", 22],
  ["A4", 26],
  ["E5", 30],
] as const;

export const INSTRUMENTS = [
  {
    id: "mallet",
    name: "Mallet",
    polyphonic: true,
    notes: [
      { name: "A4", frequency: 440 },
      { name: "G4", frequency: 391.995 },
      { name: "E4", frequency: 329.628 },
      { name: "D4", frequency: 293.665 },
      { name: "C4", frequency: 261.626 },
    ],
    start: scheduleMallet,
    seed: [
      ["C4", 0],
      ["E4", 4],
      ["G4", 8],
      ["E4", 12],
      ["D4", 16],
      ["A4", 20],
      ["G4", 24],
      ["E4", 28],
    ],
  },
  {
    id: "keys",
    name: "Felt keys",
    polyphonic: true,
    // Full C major: F and B add melodic movement beyond the original pentatonic.
    notes: MELODY_NOTES,
    start: startFeltKeys,
    seed: MELODY_SEED,
  },
  {
    id: "bass",
    name: "Plucked bass",
    polyphonic: false,
    notes: pitches([48, 45, 43, 40, 38, 36]),
    start: startBass,
    seed: [
      ["C2", 0],
      ["G2", 16],
    ],
  },
  {
    id: "glass",
    name: "Glass chimes",
    polyphonic: true,
    notes: pitches([84, 81, 79, 76, 74, 72]),
    start: scheduleGlass,
    seed: [
      ["E5", 10],
      ["C6", 26],
    ],
  },
] as const;
export type InstrumentId = (typeof INSTRUMENTS)[number]["id"];
export type TimedNote = {
  instrument: InstrumentId;
  row: number;
  step: number;
  gain?: number;
};
