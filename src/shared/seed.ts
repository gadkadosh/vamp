import type { INSTRUMENTS, InstrumentId } from "./score";

export type StartingPhrase = {
  [I in InstrumentId]: readonly (readonly [
    (typeof INSTRUMENTS)[I]["notes"][number]["name"],
    number,
  ])[];
};

export const STARTING_PHRASE = {
  mallet: [
    ["C4", 0],
    ["E4", 4],
    ["G4", 8],
    ["E4", 12],
    ["D4", 16],
    ["A4", 20],
    ["G4", 24],
    ["E4", 28],
  ],
  keys: [
    ["E5", 2],
    ["D5", 6],
    ["C5", 10],
    ["B4", 14],
    ["C5", 18],
    ["G4", 22],
    ["A4", 26],
    ["E5", 30],
  ],
  bass: [
    ["C2", 0],
    ["G2", 16],
  ],
  glass: [
    ["E5", 10],
    ["C6", 26],
  ],
} as const satisfies StartingPhrase;
