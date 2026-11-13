export const TEMPO = 88;
export const STEP_COUNT = 32;
export const STEP_SECONDS = 60 / TEMPO / 4;
export const DEFAULT_VOLUME = 0.35;

const PITCH_CLASSES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"] as const;
type PitchClass = (typeof PITCH_CLASSES)[number];
type Pitch = `${PitchClass}${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;

function defineInstrument<const Pitches extends readonly Pitch[]>(instrument: {
  name: string;
  polyphonic: boolean;
  notes: Pitches;
}) {
  return {
    ...instrument,
    notes: instrument.notes.map((name: Pitches[number]) => {
      const pitchClass = name.slice(0, -1) as PitchClass;
      const midi = (Number(name.at(-1)) + 1) * 12 + PITCH_CLASSES.indexOf(pitchClass);
      return { name, frequency: 440 * 2 ** ((midi - 69) / 12) };
    }),
  };
}

export const INSTRUMENTS = {
  mallet: defineInstrument({
    name: "Mallet",
    polyphonic: true,
    notes: ["A4", "G4", "E4", "D4", "C4", "A3", "G3", "E3", "D3"],
  }),
  keys: defineInstrument({
    name: "Muted piano",
    polyphonic: true,
    notes: ["G5", "E5", "D5", "C5", "B4", "A4", "G4", "F4", "E4", "D4", "C4"],
  }),
  bass: defineInstrument({
    name: "Plucked bass",
    polyphonic: false,
    notes: ["C3", "A2", "G2", "E2", "D2", "C2"],
  }),
  glass: defineInstrument({
    name: "Glass chimes",
    polyphonic: true,
    notes: ["E6", "D6", "C6", "A5", "G5", "E5", "D5", "C5"],
  }),
} as const;

export type InstrumentId = keyof typeof INSTRUMENTS;
export const INSTRUMENT_IDS = Object.keys(INSTRUMENTS) as readonly InstrumentId[];

export function pitchIndex(instrument: InstrumentId, name: string): number {
  const index = INSTRUMENTS[instrument].notes.findIndex((note) => note.name === name);
  if (index < 0) throw new Error(`Unknown pitch ${name} for ${instrument}`);
  return index;
}

export type NoteId = string;
export type TimedNote = {
  noteId: NoteId;
  instrument: InstrumentId;
  row: number;
  step: number;
};
export type NoteOnset = { readonly note: Readonly<TimedNote>; readonly time: number };
export type Playback = {
  time: number;
  position: number | null;
  onsets: ReadonlyMap<NoteId, NoteOnset>;
};

export const EMPTY_PLAYBACK: Playback = { time: 0, position: null, onsets: new Map() };
