import { expect, test } from "vite-plus/test";
import {
  compose,
  durationFor,
  lengthFor,
  moveSource,
  placeSource,
  resizeSource,
  snapSource,
} from "../src/client/playground";
import type { Constellation, Source } from "../src/client/playground";
import { fieldBounds, layoutSources, locate, SETTLE_MS, tailLayout } from "../src/client/space";

const light: Source = { id: 1, step: 4, tone: 11 };
const documentOf = (...sources: Source[]): Constellation => ({ sources, voice: "keys" });
const size = { width: 1008, height: 600 }; // 30 px per timing step.

test("length defaults preserve melody/bass gates and allow struck voices to decay naturally", () => {
  expect([0, 7, 11, 17].map((tone) => lengthFor({ ...light, tone }))).toEqual([4, 6, 2, 17]);
  expect(compose(documentOf(light))[0].length).toBe(2);
});

test("resizing is a quantized, idempotent placement without changing onset, pitch, or intensity", () => {
  const original = documentOf({ ...light, energy: 0.7 });
  const draft = resizeSource(original.sources[0], 5.6, original.sources);
  expect(draft).toEqual({ ...original.sources[0], length: 5.6 });
  const result = placeSource(original, draft);
  expect(result.accepted).toBe(true);
  expect(result.document.sources).toEqual([{ ...original.sources[0], length: 6 }]);
  expect(compose(result.document)).toEqual([{ ...compose(original)[0], length: 6 }]);
  expect(placeSource(result.document, draft).document).toBe(result.document);
  expect(placeSource(original, { ...light, energy: 0.7, length: 2 }).document).toBe(original);
  expect(moveSource(result.source, 1, 1)).toEqual({ ...result.source, step: 5, tone: 12 });
  expect(snapSource({ ...light, length: -2 }).length).toBe(1);
  expect(snapSource({ ...light, length: 80 }).length).toBe(32);
  expect(original.sources).toEqual([{ ...light, energy: 0.7 }]);
});

test("bass ringing and resizing stop at the next bass onset, including across the loop seam", () => {
  const a = { ...light, tone: 0, step: 30, length: 8 };
  const b = { ...light, id: 2, tone: 3, step: 2 };
  const document = documentOf(a, b);
  expect(durationFor(a, document.sources)).toBe(4);
  expect(resizeSource(a, 20, document.sources).length).toBe(4);
  expect(compose(document).find((event) => event.sourceId === 1)?.length).toBe(4);
  expect(durationFor(a, [a])).toBe(8);
  expect(a.length).toBe(8);
  const moved = placeSource(document, { ...a, step: 2, length: 1 });
  expect(moved.accepted).toBe(false);
  expect(moved.document).toBe(document);
});

test("long polyphonic notes can overlap, but length cannot bypass onset collisions", () => {
  const original = documentOf({ ...light, length: 20 });
  const later = placeSource(original, { ...light, id: 2, step: 8, length: 12 });
  expect(later.accepted).toBe(true);
  expect(compose(later.document).map((event) => event.length)).toEqual([20, 12]);
  expect(placeSource(original, { ...light, id: 2, length: 1 }).accepted).toBe(false);
});

test("tail width follows musical length while the note head stays fixed", () => {
  const point = layoutSources([{ ...light, length: 4 }], size)[0];
  const tail = tailLayout(point, size);
  expect(point.position).toEqual(locate(light, size));
  expect(tail.segments).toEqual([
    {
      from: point.position,
      to: { x: point.position.x + 120, y: point.position.y },
      fromFraction: 0,
      toFraction: 1,
    },
  ]);
  expect(tail.handle).toEqual({ x: tail.end.x, y: tail.end.y + 16 });
});

test("tails split at the loop seam without changing total length or the endpoint's pitch", () => {
  const source = { ...light, step: 31, length: 4 };
  const point = layoutSources([source], size)[0];
  const { segments, end } = tailLayout(point, size),
    bounds = fieldBounds(size);
  expect(segments).toHaveLength(2);
  expect(segments[0].to.x).toBe(bounds.left + bounds.width);
  expect(segments[1].from.x).toBe(bounds.left);
  expect(segments.map((segment) => segment.to.x - segment.from.x)).toEqual([30, 90]);
  expect(end).toEqual({ x: bounds.left + 90, y: point.position.y });
  expect(segments[1].fromFraction).toBe(0.25);
  const fullLoop = tailLayout(layoutSources([{ ...light, step: 16, length: 32 }], size)[0], size);
  expect(fullLoop.end).toEqual(locate({ ...light, step: 16 }, size));
  expect(fullLoop.handle.y).toBe(fullLoop.end.y + 16);
});

test("the tail and its handle share the same length while settling or returning after cancellation", () => {
  const from = { ...light, length: 3.6 },
    to = { ...light, length: 4 };
  const motion = { from, to, started: 100 };
  const start = layoutSources([to], size, motion, 100)[0];
  const middle = layoutSources([to], size, motion, 100 + SETTLE_MS / 2)[0];
  const end = layoutSources([to], size, motion, 100 + SETTLE_MS)[0];
  expect(start.length).toBe(3.6);
  expect(middle.length).toBeGreaterThan(3.6);
  expect(middle.length).toBeLessThan(4);
  expect(end.length).toBe(4);
  for (const point of [start, middle, end]) {
    const tail = tailLayout(point, size);
    expect(tail.end.x).toBeCloseTo(point.position.x + point.length * 30);
    expect(tail.handle.x).toBe(tail.end.x);
  }
  expect(
    layoutSources([from], size, { from: to, to: from, started: 100 }, 100 + SETTLE_MS)[0].length,
  ).toBe(3.6);
});
