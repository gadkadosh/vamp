import { expect, test } from "vite-plus/test";
import { migrateLegacyPattern } from "../src/server/migratePattern";
import { compose } from "../src/shared/pattern";
import { INSTRUMENTS } from "../src/shared/score";

test("every old canvas position keeps its instrument, pitch, identity, and timing", () => {
  const expected = [
    ["bass", "C2 D2 E2 G2 A2 C3"],
    ["mallet", "D3 E3 G3 A3 C4 D4 E4"],
    ["keys", "F4 G4 A4 B4 C5 D5 E5 G5"],
    ["glass", "A5 C6 D6 E6"],
  ].flatMap(([instrument, names]) => names.split(" ").map((name) => [instrument, name]));
  const legacy = {
    notes: expected.map((_, tone) => ({ id: `old-${tone}`, tone, step: tone })),
  };
  const before = structuredClone(legacy);
  const migrated = migrateLegacyPattern(legacy);
  const score = compose(migrated);
  expect(
    score.map((note) => [note.instrument, INSTRUMENTS[note.instrument].notes[note.row].name]),
  ).toEqual(expected);
  expect(migrated.notes.map(({ id, step }) => ({ id, step }))).toEqual(
    legacy.notes.map(({ id, step }) => ({ id, step })),
  );
  expect(legacy).toEqual(before);
});

test("migration fails rather than guessing an unknown legacy position", () => {
  expect(() => migrateLegacyPattern({ notes: [{ id: "invalid", step: 0, tone: 25 }] })).toThrow(
    "Unknown legacy tone 25",
  );
});
