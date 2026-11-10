import { INSTRUMENTS as MATERIALS } from "../shared/music";
import type { NoteId, TimedNote } from "../shared/music";
import { scheduleGlass, scheduleMallet, startBass, startFeltKeys } from "./voices";

export { TEMPO, STEP_COUNT, STEP_SECONDS, INSTRUMENT_IDS, pitchIndex } from "../shared/music";
export type { InstrumentId, TimedNote } from "../shared/music";

export const INSTRUMENTS = {
  mallet: { ...MATERIALS.mallet, start: scheduleMallet },
  keys: { ...MATERIALS.keys, start: startFeltKeys },
  bass: { ...MATERIALS.bass, start: startBass },
  glass: { ...MATERIALS.glass, start: scheduleGlass },
};
export const DEFAULT_VOLUME = 0.35;
export type NoteOnset = { readonly note: Readonly<TimedNote>; readonly time: number };
export type Playback = {
  time: number;
  position: number | null;
  onsets: ReadonlyMap<NoteId, NoteOnset>;
};
export const EMPTY_PLAYBACK: Playback = { time: 0, position: null, onsets: new Map() };
