import { expect, test } from "vite-plus/test";
import {
  compose,
  createPattern,
  findCollisions,
  moveNote,
  placeNote,
  snapNote,
  TONES,
  toneFor,
} from "../src/client/pattern";
import type { Pattern, Note } from "../src/client/pattern";
import { layoutNotes, locate, pick, SETTLE_MS } from "../src/client/space";
import { STEP_COUNT } from "../src/client/score";

const light: Note = { id: 1, step: 3, tone: 7 };
const documentOf = (...notes: Note[]): Pattern => ({ notes });

function add(document: Pattern, note: Note) {
  const result = placeNote(document, note);
  expect(result.accepted).toBe(true);
  return result.document;
}

test("draft tone positions are continuous while sounding pitches ascend through four materials", () => {
  expect(new Set(TONES.map((tone) => tone.instrument))).toEqual(
    new Set(["bass", "mallet", "keys", "glass"]),
  );
  for (const [index, tone] of TONES.entries()) {
    expect(tone.row).toBeGreaterThanOrEqual(0);
    expect(tone.note.frequency).toBeGreaterThan(index ? TONES[index - 1].note.frequency : 0);
    expect(toneFor({ ...light, tone: index + 0.2 })).toEqual(tone);
  }
});

test("landing snaps both timing and pitch, wraps the loop seam, and is idempotent", () => {
  const empty = documentOf();
  const draft = { ...light, step: 3.71, tone: 7.137 };
  const result = placeNote(empty, draft);
  expect(result.note).toEqual({ ...draft, step: 4, tone: 7 });
  expect(result.document.notes).toEqual([result.note]);
  expect(placeNote(result.document, result.note).document).toBe(result.document);
  expect(snapNote({ ...draft, step: 31.83 }).step).toBe(0);
  expect(empty.notes).toEqual([]);
  expect(draft.step).toBe(3.71);
  expect(draft.tone).toBe(7.137);
  expect(compose(empty)).toEqual([]);
  expect(compose(result.document)).toEqual([
    { noteId: 1, instrument: "mallet", row: TONES[7].row, step: 4 },
  ]);
});

test("felt keys allow several different pitches at the same beat, all with audible events", () => {
  let document = add(documentOf(), { ...light, tone: 10 });
  document = add(document, { ...light, id: 2, tone: 11.2 });
  document = add(document, { ...light, id: 3, tone: 13 });
  const felt = compose(document);
  expect(felt).toHaveLength(3);
  expect(felt.map((note) => note.noteId)).toEqual([1, 2, 3]);
  expect(new Set(felt.map((note) => note.row)).size).toBe(3);
  expect(felt.every((note) => note.instrument === "keys" && note.step === 3)).toBe(true);
});

test("a second bass pitch at an occupied beat is rejected without changing either note", () => {
  const bass = { ...light, step: 0, tone: 0 };
  const document = documentOf(bass);
  const result = placeNote(document, { ...bass, id: 2, step: 31.83, tone: 3 });
  expect(result.accepted).toBe(false);
  expect(result.document).toBe(document);
  expect(result.collisions).toEqual([{ noteId: bass.id, step: 0 }]);
  expect(document.notes).toEqual([bass]);
  expect(add(document, { ...bass, id: 2, step: 1, tone: 3 }).notes).toHaveLength(2);
});

test("moving into a bass conflict preserves the original document", () => {
  const a: Note = { ...light, tone: 0, step: 2 };
  const b: Note = { ...light, id: 2, tone: 3, step: 18 };
  const document = documentOf(a, b);
  const moved = placeNote(document, moveNote(a, 16, 0.2));
  expect(moved.accepted).toBe(false);
  expect(moved.document).toBe(document);
  expect(moved.collisions).toEqual([{ noteId: 2, step: 18 }]);
  expect(document.notes).toEqual([a, b]);
  const valid = placeNote(document, moveNote(a, 1, 0.2));
  expect(valid.accepted).toBe(true);
  expect(valid.document.notes[0]).toMatchObject({ step: 3, tone: 0 });
  expect(valid.document.notes[1]).toBe(b);
});

test("identical sounds flash existing lights rather than keeping silent duplicates, for every material", () => {
  for (const tone of [0, 7, 10, 17]) {
    const original = { ...light, tone };
    const document = documentOf(original);
    const result = placeNote(document, { ...original, id: 2, step: 3.1, tone: tone + 0.2 });
    expect(result.accepted).toBe(false);
    expect(result.document).toBe(document);
    expect(result.collisions).toEqual([{ noteId: 1, step: 3 }]);
  }
  const copy = { ...light, id: 2, step: light.step + 4 };
  expect(add(documentOf(light), copy).notes).toEqual([light, copy]);
  expect(add(documentOf(light), { ...light, id: 2, tone: 10 }).notes).toHaveLength(2);
});

test("every accepted light contributes exactly one note and one hit target", () => {
  let document = documentOf();
  for (let id = 1; id <= 300; id++) {
    const result = placeNote(document, {
      id,
      step: (id * 0.37) % 32,
      tone: (id * 0.071) % 18,
    });
    document = result.document;
  }
  const events = compose(document);
  expect(document.notes.length).toBeGreaterThan(10);
  expect(events).toHaveLength(document.notes.length);
  for (const note of document.notes) {
    expect(events.filter((event) => event.noteId === note.id)).toEqual([
      {
        noteId: note.id,
        instrument: toneFor(note).instrument,
        row: toneFor(note).row,
        step: note.step,
      },
    ]);
    expect(findCollisions(document, note)).toEqual([]);
  }
  const points = layoutNotes(document.notes, { width: 900, height: 720 });
  expect(points).toHaveLength(document.notes.length);
  expect(points.map(({ note }) => note.id).sort((a, b) => a - b)).toEqual(
    document.notes.map(({ id }) => id),
  );
});

test("the shared 2D surface tracks fractional pointer positions on desktop and mobile", () => {
  for (const size of [
    { width: 1360, height: 560 },
    { width: 354, height: 440 },
  ])
    for (let tone = 0.137; tone < TONES.length - 1; tone += 1.17)
      for (let step = 0.271; step < STEP_COUNT - 1; step += 2.37) {
        const position = locate({ ...light, step, tone }, size);
        const picked = pick(position.x, position.y, size);
        expect(picked.step).toBeCloseTo(step, 9);
        expect(picked.tone).toBeCloseTo(tone, 9);
      }
});

test("landing and bounce animations share the same positions for drawing and hit testing", () => {
  const size = { width: 1360, height: 560 };
  const draft = { ...light, step: 12.34, tone: 9.21 };
  const landing = snapNote(draft);
  const motion = { from: draft, to: landing, started: 100 };
  const projected = (time: number) => layoutNotes([landing], size, motion, time)[0].position;
  const from = locate(draft, size);
  const to = locate(landing, size);
  expect(projected(100)).toEqual(from);
  expect(projected(100 + SETTLE_MS)).toEqual(to);
  const halfway = projected(100 + SETTLE_MS / 2);
  expect(halfway.x).toBeGreaterThan(Math.min(from.x, to.x));
  expect(halfway.x).toBeLessThan(Math.max(from.x, to.x));
  expect(halfway.y).toBeGreaterThan(Math.min(from.y, to.y));
  expect(halfway.y).toBeLessThan(Math.max(from.y, to.y));
  const bounce = layoutNotes(
    [light],
    size,
    { from: draft, to: light, started: 100 },
    100 + SETTLE_MS,
  )[0];
  expect(bounce.position).toEqual(locate(light, size));
});

test("out-of-bounds picking stays finite and timing nudges wrap without moving the pitch axis", () => {
  for (const x of [-500, 0, 177, 354, 1000])
    for (const y of [-500, 0, 220, 440, 1000]) {
      const position = pick(x, y, { width: 354, height: 440 });
      expect(Number.isFinite(position.step)).toBe(true);
      expect(position.step).toBeGreaterThanOrEqual(0);
      expect(position.step).toBeLessThanOrEqual(STEP_COUNT - 1);
      expect(Number.isFinite(position.tone)).toBe(true);
      expect(position.tone).toBeGreaterThanOrEqual(0);
      expect(position.tone).toBeLessThanOrEqual(TONES.length - 1);
    }
  // The right edge lands on the final step, not a surprising jump back to step 0.
  expect(snapNote({ ...light, ...pick(354, 100, { width: 354, height: 440 }) }).step).toBe(31);
  expect(moveNote({ ...light, step: 0, tone: 0.1 }, -1, 0)).toMatchObject({
    step: 31,
    tone: 0.1,
  });
});

test("the seed has no conflicting or silent lights and projection never changes the score", () => {
  const document = createPattern();
  const before = structuredClone(document);
  const score = compose(document);
  expect(document).toEqual(createPattern());
  expect(
    document.notes.map((note) => [toneFor(note).instrument, toneFor(note).note.name, note.step]),
  ).toEqual([
    ["mallet", "C4", 0],
    ["mallet", "E4", 4],
    ["mallet", "E4", 8],
    ["mallet", "E4", 12],
    ["mallet", "D4", 16],
    ["mallet", "E4", 20],
    ["mallet", "E4", 24],
    ["mallet", "E4", 28],
    ["keys", "E5", 2],
    ["keys", "D5", 6],
    ["keys", "C5", 10],
    ["keys", "B4", 14],
    ["keys", "C5", 18],
    ["keys", "G4", 22],
    ["keys", "A4", 26],
    ["keys", "E5", 30],
    ["bass", "C2", 0],
    ["bass", "G2", 16],
    ["glass", "G5", 10],
    ["glass", "C6", 26],
  ]);
  expect(score).toHaveLength(document.notes.length);
  expect(new Set(score.map((note) => note.instrument))).toEqual(
    new Set(["bass", "mallet", "keys", "glass"]),
  );
  for (const note of document.notes) {
    expect(findCollisions(document, note)).toEqual([]);
    locate(note, { width: 1000, height: 600 });
  }
  expect(document).toEqual(before);
  expect(compose(document)).toEqual(score);
});
