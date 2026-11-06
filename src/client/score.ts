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

export const INSTRUMENTS = {
  mallet: {
    name: "Mallet",
    polyphonic: true,
    notes: pitches([69, 67, 64, 62, 60]),
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
  keys: {
    name: "Muted piano",
    polyphonic: true,
    notes: pitches([76, 74, 72, 71, 69, 67, 65, 64, 62, 60]),
    start: startFeltKeys,
    seed: [
      ["E5", 2],
      ["D5", 6],
      ["C5", 10],
      ["B4", 14],
      ["C5", 18],
      ["G4", 22],
      ["A4", 26],
      ["E5", 30],
    ],
  },
  bass: {
    name: "Plucked bass",
    polyphonic: false,
    notes: pitches([48, 45, 43, 40, 38, 36]),
    start: startBass,
    seed: [
      ["C2", 0],
      ["G2", 16],
    ],
  },
  glass: {
    name: "Glass chimes",
    polyphonic: true,
    notes: pitches([84, 81, 79, 76, 74, 72]),
    start: scheduleGlass,
    seed: [
      ["E5", 10],
      ["C6", 26],
    ],
  },
} as const;
export type InstrumentId = keyof typeof INSTRUMENTS;
export const INSTRUMENT_IDS = Object.keys(INSTRUMENTS) as readonly InstrumentId[];

export function pitchIndex(instrument: InstrumentId, name: string): number {
  const index = INSTRUMENTS[instrument].notes.findIndex((note) => note.name === name);
  if (index < 0) throw new Error(`Unknown pitch ${name} for ${instrument}`);
  return index;
}

export type TimedNote = {
  noteId: number;
  instrument: InstrumentId;
  row: number;
  step: number;
};
export type NoteOnset = { readonly note: Readonly<TimedNote>; readonly time: number };
export type Playback = {
  time: number;
  position: number | null;
  onsets: ReadonlyMap<number, NoteOnset>;
};
export const EMPTY_PLAYBACK: Playback = { time: 0, position: null, onsets: new Map() };
