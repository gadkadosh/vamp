import { expect, expectTypeOf, test } from "vite-plus/test";
import { INSTRUMENTS } from "../src/shared/score";
import type { StartingPhrase } from "../src/shared/seed";

test.each([
  ["mallet", [69, 67, 64, 62, 60, 57, 55, 52, 50]],
  ["keys", [79, 76, 74, 72, 71, 69, 67, 65, 64, 62, 60]],
  ["bass", [48, 45, 43, 40, 38, 36]],
  ["glass", [88, 86, 84, 81, 79, 76, 74, 72]],
] as const)("%s named pitches preserve their tuning and playback rows", (id, midis) => {
  expect(INSTRUMENTS[id].notes.map((note) => note.frequency)).toEqual(
    midis.map((midi) => 440 * 2 ** ((midi - 69) / 12)),
  );
});

test("seed pitch types are specific to each instrument", () => {
  expectTypeOf<StartingPhrase["mallet"][number][0]>().toEqualTypeOf<
    (typeof INSTRUMENTS.mallet.notes)[number]["name"]
  >();
  expectTypeOf<StartingPhrase["mallet"][number][0]>().toEqualTypeOf<
    "A4" | "G4" | "E4" | "D4" | "C4" | "A3" | "G3" | "E3" | "D3"
  >();
  expectTypeOf<StartingPhrase["glass"][number][0]>().toEqualTypeOf<
    "E6" | "D6" | "C6" | "A5" | "G5" | "E5" | "D5" | "C5"
  >();
});
