import { expect, test } from "vite-plus/test";
import { drawSpace } from "../src/client/drawSpace";
import type { Scene } from "../src/client/drawSpace";
import { compose, snapNote, toneFor } from "../src/shared/pattern";
import { EMPTY_PLAYBACK, STEP_COUNT, STEP_SECONDS } from "../src/shared/score";
import type { Playback } from "../src/shared/score";
import { fieldBounds, layoutNotes, locate } from "../src/client/space";

const size = { width: 900, height: 600 };
const document: Scene["document"] = { notes: [{ id: "1", step: 2, tone: 7 }] };
const candidate = { id: "2", step: 12.31, tone: 11.18 };

type Gradient = { stops: { offset: number; color: string }[] };
type Circle = { x: number; y: number; radius: number };

function recordingContext() {
  type Point = { x: number; y: number };
  const strokes: { points: Point[]; circle: Circle | null; dash: number[]; color: string }[] = [];
  const fills: { circle: Circle | null; color: string | Gradient }[] = [];
  const rectangles: number[][] = [];
  let points: Point[] = [];
  let circle: Circle | null = null;
  let dash: number[] = [];
  const gradient = (): Gradient & { addColorStop: (offset: number, color: string) => void } => ({
    stops: [],
    addColorStop(offset, color) {
      this.stops.push({ offset, color });
    },
  });
  const context = {
    strokeStyle: "",
    fillStyle: "" as string | Gradient,
    lineWidth: 1,
    fill() {
      const color =
        typeof this.fillStyle === "string" ? this.fillStyle : { stops: [...this.fillStyle.stops] };
      fills.push({ circle, color });
    },
    fillRect(...bounds: number[]) {
      rectangles.push(bounds);
    },
    beginPath() {
      points = [];
      circle = null;
    },
    moveTo(x: number, y: number) {
      points.push({ x, y });
    },
    lineTo(x: number, y: number) {
      points.push({ x, y });
    },
    setLineDash(value: number[]) {
      dash = value;
    },
    stroke() {
      strokes.push({ points: [...points], circle, dash: [...dash], color: this.strokeStyle });
    },
    arc(x: number, y: number, radius: number) {
      circle = { x, y, radius };
    },
    createRadialGradient: gradient,
    createLinearGradient: gradient,
  };
  return {
    context: context as unknown as Parameters<typeof drawSpace>[0],
    strokes,
    fills,
    rectangles,
  };
}

const scene: Scene = {
  document,
  selected: null,
  playing: false,
  reducedMotion: false,
  preview: null,
  feedback: null,
};

const onsetTime = 0.05 + 2 * STEP_SECONDS;

function playback(time = onsetTime): Playback {
  return {
    time,
    position: ((time - 0.05) / STEP_SECONDS) % STEP_COUNT,
    onsets: new Map([["1", { note: compose(document)[0], time: onsetTime }]]),
  };
}

function render(state: Scene, viewport = size, playback: Playback = EMPTY_PLAYBACK, now = 0) {
  const recorded = recordingContext();
  drawSpace(
    recorded.context,
    state,
    viewport,
    playback,
    layoutNotes(state.document.notes, viewport),
    now,
  );
  return recorded;
}

function core(recorded: ReturnType<typeof render>) {
  return recorded.fills.at(-1);
}

test("an empty field has no decorative particles, glows, or permanent guides", () => {
  expect(render(scene).fills.length).toBeGreaterThan(0);
  const recorded = render({ ...scene, document: { notes: [] } });
  expect(recorded.fills).toEqual([]);
  expect(recorded.strokes).toEqual([]);
  expect(recorded.rectangles).toEqual([]);
});

test.each([390, 900])(
  "idle lights retain their material color in centered, circular cores at width %s",
  (width) => {
    const viewport = { width, height: 600 };
    const note = document.notes[0];
    const recorded = render(scene, viewport);
    const color = toneFor(note).color;
    expect(recorded.fills).toHaveLength(4); // Three diffuse glows and one core, no background lights.
    expect(core(recorded)).toEqual({
      circle: { ...locate(note, viewport), radius: width < 520 ? 3.8 : 4.2 },
      color: {
        stops: [
          { offset: 0, color },
          { offset: 0.65, color },
          { offset: 1, color: `${color}b3` },
        ],
      },
    });
    expect(recorded.strokes).toEqual([]);
  },
);

test("selection intensifies the material without adding a ring or moving the light", () => {
  const idle = render(scene);
  const selected = render({ ...scene, selected: "1" });
  const color = toneFor(document.notes[0]).color;
  expect(selected.strokes).toEqual([]);
  expect(selected.fills[1]).toMatchObject({
    circle: { radius: 39 },
    color: { stops: [{ offset: 0, color: `${color}26` }, expect.anything(), expect.anything()] },
  });
  expect(idle.fills[1]).toMatchObject({
    color: { stops: [{ offset: 0, color: `${color}12` }, expect.anything(), expect.anything()] },
  });
  expect(core(selected)?.circle).toEqual({
    ...locate(document.notes[0], size),
    radius: 4.2 * 1.05,
  });
  expect(core(selected)?.color).toEqual(core(idle)?.color);
});

test("a sounding light blooms, then returns to rest; pausing holds the bloom", () => {
  const onset = render({ ...scene, playing: true }, size, playback());
  const paused = render(scene, size, playback());
  const later = render({ ...scene, playing: true }, size, playback(onsetTime + 2));
  const idle = render(scene);
  expect(onset.fills[0].circle?.radius).toBe(225);
  expect(onset.fills[1].circle?.radius).toBe(87);
  expect(onset.fills).toEqual(paused.fills);
  expect(onset.strokes.filter(({ circle }) => circle)).toHaveLength(1);
  expect(later.fills).toEqual(idle.fills);
  expect(onset.rectangles).toHaveLength(1);
  expect(paused.rectangles).toEqual([]);
});

test("reduced motion uses illumination, not an expanding wave, growing core, or moving sweep", () => {
  const onset = render({ ...scene, playing: true, reducedMotion: true }, size, playback());
  const idle = render({ ...scene, reducedMotion: true });
  expect(core(onset)?.circle).toEqual(core(idle)?.circle);
  expect(onset.fills[1].circle?.radius).toBeGreaterThan(idle.fills[1].circle?.radius ?? Infinity);
  expect(onset.strokes).toEqual([]);
  expect(onset.rectangles).toEqual([]);
});

test("placement reveals both full snapped guides and a landing point without editing the phrase", () => {
  const before = structuredClone(document);
  const recorded = render({ ...scene, preview: { note: candidate, collisions: [] } });
  const target = locate(snapNote(candidate), size);
  const bounds = fieldBounds(size);
  expect(
    recorded.strokes.filter((stroke) => stroke.dash.length).map(({ points }) => points),
  ).toEqual([
    [
      { x: bounds.left, y: target.y },
      { x: bounds.left + bounds.width, y: target.y },
    ],
    [
      { x: target.x, y: bounds.top },
      { x: target.x, y: bounds.top + bounds.height },
    ],
  ]);
  expect(recorded.strokes).toContainEqual(
    expect.objectContaining({ circle: { ...target, radius: 5 } }),
  );
  expect(recorded.fills).toContainEqual({ circle: { ...target, radius: 1 }, color: "#d7ded0d9" });
  expect(document).toEqual(before);
  expect(compose(document)).toEqual(compose(before));
  expect(render(scene).strokes).toEqual([]);
});

test("an occupied landing highlights the conflict without replacing the existing light", () => {
  const recorded = render({
    ...scene,
    preview: { note: { id: "2", step: 2.1, tone: 7.1 }, collisions: [{ noteId: "1", step: 2 }] },
  });
  expect(recorded.strokes.find((stroke) => stroke.dash.length)?.color).toBe("#f4a3913b");
  expect(recorded.strokes).toContainEqual(
    expect.objectContaining({
      circle: { ...locate(document.notes[0], size), radius: 4.2 + 9 },
      color: "#f4a391d9",
    }),
  );
  expect(core(recorded)?.circle).toEqual({
    ...locate(snapNote({ id: "2", step: 2.1, tone: 7.1 }), size),
    radius: 1,
  });
  expect(document.notes).toEqual([{ id: "1", step: 2, tone: 7 }]);
});

test("collision feedback expires without leaving a permanent outline", () => {
  const feedback = { collisions: [{ noteId: "1", step: 2 }], started: 100 };
  expect(render({ ...scene, feedback }, size, EMPTY_PLAYBACK, 200).strokes).toHaveLength(1);
  expect(render({ ...scene, feedback }, size, EMPTY_PLAYBACK, 900).strokes).toEqual([]);
});

test("loop position alone never illuminates a note that has not struck", () => {
  const clock = { ...EMPTY_PLAYBACK, time: 0.05, position: 0 };
  expect(render({ ...scene, playing: true }, size, clock).fills).toEqual(render(scene).fills);
});

test("a buffered future onset cannot illuminate a note early", () => {
  expect(render(scene, size, playback(onsetTime - 0.01)).fills).toEqual(render(scene).fills);
});

test.each([{ id: "2" }, { step: 3 }, { tone: 8 }, { tone: 10 }])(
  "an onset does not transfer to a newly created, moved, or repitched light: %j",
  (change) => {
    const state = { ...scene, document: { notes: [{ ...document.notes[0], ...change }] } };
    expect(render(state, size, playback()).fills).toEqual(render(state).fills);
  },
);

test("a true onset carries its bloom across the loop seam without inventing later strikes", () => {
  const note = { id: "1", step: 31, tone: 7 };
  const state = { ...scene, document: { notes: [note] } };
  const time = 0.05 + 33 * STEP_SECONDS;
  const clock: Playback = {
    time,
    position: 1,
    onsets: new Map([["1", { note: compose(state.document)[0], time: 0.05 + 31 * STEP_SECONDS }]]),
  };
  expect(render(state, size, clock).fills[0].circle?.radius).toBeCloseTo(
    155 + 70 * Math.exp(-2 * STEP_SECONDS * 3.1),
  );
  expect(render(state, size, { ...clock, time: time + 32 * STEP_SECONDS }).fills).toEqual(
    render(state).fills,
  );
});

test("dragging previews suppress the bloom of the note's previous actual strike", () => {
  const state = { ...scene, preview: { note: document.notes[0], collisions: [] } };
  expect(render(state, size, playback()).fills[0].circle?.radius).toBe(155);
});
