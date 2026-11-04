import { expect, test } from "vite-plus/test";
import {
  breathe,
  compose,
  createConstellation,
  energyFor,
  gainForEnergy,
  moveSource,
  placeSource,
  TONES,
} from "../src/client/playground";
import type { Constellation, Source } from "../src/client/playground";
import { layoutSources, locate, pick } from "../src/client/space";
import { VOLUME_CAMERA } from "../src/client/volume";

const light: Source = { id: 1, step: 7, tone: 11, energy: 0.25 };
const size = { width: 1360, height: 615 };

test("volume picking intersects the note's own intensity plane, including mobile and flattened views", () => {
  for (const viewport of [size, { width: 354, height: 380 }])
    for (const camera of [
      VOLUME_CAMERA,
      { yaw: -0.8, tilt: -0.4 },
      { yaw: 0.8, tilt: 0.6 },
      { ...VOLUME_CAMERA, flat: true },
    ])
      for (const energy of [0, 0.1, 0.5, 0.95, 1])
        for (let step = 0.27; step < 32; step += 2.37)
          for (let tone = 0.13; tone < TONES.length - 1; tone += 1.17) {
            const source = { ...light, step, tone, energy };
            const point = locate(source, "volume", camera, viewport);
            const result = pick(point.x, point.y, "volume", camera, viewport, energy);
            expect(result.step).toBeCloseTo(step, 9);
            expect(result.tone).toBeCloseTo(tone, 9);
          }
});

test("depth changes position, visual size and sound; flattening removes perspective, not dynamics", () => {
  const quiet = { ...light, energy: 0.1 };
  const loud = { ...light, energy: 0.95 };
  const a = locate(quiet, "volume", VOLUME_CAMERA, size);
  const b = locate(loud, "volume", VOLUME_CAMERA, size);
  expect(a.x).not.toBe(b.x);
  expect(a.y).not.toBe(b.y);
  expect(b.depth).toBeLessThan(a.depth);
  expect(b.scale).toBeGreaterThan(a.scale);
  expect(locate(quiet, "volume", { ...VOLUME_CAMERA, flat: true }, size)).toEqual(
    locate(loud, "volume", { ...VOLUME_CAMERA, flat: true }, size),
  );
  const document: Constellation = { voice: "keys", sources: [loud] };
  const before = compose(document);
  for (const view of ["field", "orbit", "volume"] as const)
    layoutSources(document.sources, view, VOLUME_CAMERA, size);
  expect(compose(document)).toEqual(before);
  expect(before[0].gain).toBeCloseTo(gainForEnergy(0.95));
  expect(compose({ ...document, sources: [quiet] })[0]).toEqual({
    ...before[0],
    gain: gainForEnergy(0.1),
  });
});

test("intensity edits preserve timing and pitch, can be repeated, and cannot bypass musical collisions", () => {
  const original: Constellation = { voice: "keys", sources: [light] };
  const result = placeSource(original, { ...light, energy: 0.9 });
  expect(result.accepted).toBe(true);
  expect(result.document.sources).toEqual([{ ...light, energy: 0.9 }]);
  expect(placeSource(result.document, result.source).document).toBe(result.document);
  expect(original.sources).toEqual([light]);
  expect(placeSource(original, { ...light, id: 2, energy: 0.95 }).accepted).toBe(false);
  expect(moveSource(light, 1, 1)).toEqual({ ...light, step: 8, tone: 12 });
  expect(placeSource(original, { ...light, energy: 4 }).source.energy).toBe(1);
  expect(energyFor({ ...light, energy: undefined })).toBe(0.5);
  expect(gainForEnergy(0.5)).toBe(1);
});

test("Breathe creates genuine depth without changing the phrase and is idempotent", () => {
  const original = createConstellation();
  const shaped = breathe(original);
  expect(new Set(shaped.sources.map(energyFor)).size).toBeGreaterThan(10);
  expect(
    shaped.sources.map(({ energy = 0.5, ...source }) => {
      expect(energy).toBeGreaterThan(0);
      return source;
    }),
  ).toEqual(original.sources);
  expect(
    compose(shaped).map(({ gain = 1, ...note }) => {
      expect(gain).toBeGreaterThan(0);
      return note;
    }),
  ).toEqual(compose(original));
  expect(breathe(shaped)).toBe(shaped);
  expect(original.sources.every((source) => source.energy === undefined)).toBe(true);
});
