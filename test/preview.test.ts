import { expect, test } from "vite-plus/test";
import { drawSpace } from "../src/client/drawSpace";
import type { Scene } from "../src/client/drawSpace";
import { compose, snapSource } from "../src/client/playground";
import { fieldBounds, layoutSources, locate } from "../src/client/space";

const size = { width: 900, height: 600 };
const document: Scene["document"] = { voice: "keys", sources: [{ id: 1, step: 2, tone: 7 }] };
const candidate = { id: 2, step: 12.31, tone: 11.18 };

function recordingContext() {
  type Point = { x: number; y: number };
  const strokes: {
    points: Point[];
    dash: number[];
    color: unknown;
    width: number;
    alpha: number;
  }[] = [];
  const gradients: { stops: { offset: number; color: string }[] }[] = [];
  const labels: string[] = [];
  const circles: { x: number; y: number; radius: number }[] = [];
  const fills: { alpha: number; circle: (typeof circles)[number] | undefined }[] = [];
  let points: Point[] = [],
    dash: number[] = [];
  const context = {
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    clearRect() {},
    fill() {
      fills.push({ alpha: this.globalAlpha, circle: circles.at(-1) });
    },
    beginPath() {
      points = [];
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
      strokes.push({
        points: [...points],
        dash: [...dash],
        color: this.strokeStyle,
        width: this.lineWidth,
        alpha: this.globalAlpha,
      });
    },
    fillText(text: string) {
      labels.push(text);
    },
    arc(x: number, y: number, radius: number) {
      circles.push({ x, y, radius });
    },
    createRadialGradient() {
      const gradient = {
        stops: [] as { offset: number; color: string }[],
        addColorStop(offset: number, color: string) {
          this.stops.push({ offset, color });
        },
      };
      gradients.push(gradient);
      return gradient;
    },
  };
  return {
    context: context as unknown as Parameters<typeof drawSpace>[0],
    strokes,
    labels,
    circles,
    fills,
    gradients,
  };
}

const scene: Scene = {
  document,
  score: compose(document),
  selected: null,
  playing: false,
  preview: null,
  feedback: null,
};

function render(state: Scene, viewport = size, progress: number | null = null) {
  const recorded = recordingContext();
  drawSpace(
    recorded.context,
    state,
    viewport,
    progress,
    layoutSources(state.document.sources, viewport),
    0,
  );
  return recorded;
}

test("placing or dragging shows snapped guides and a landing ring without a note-name label or musical edits", () => {
  const before = structuredClone(document);
  const recorded = render({ ...scene, preview: { source: candidate, collisions: [] } });
  const target = locate(snapSource(candidate), size),
    bounds = fieldBounds(size);
  expect(recorded.strokes.filter((stroke) => stroke.dash.length)).toEqual([
    {
      points: [
        { x: bounds.left, y: target.y },
        target,
        { x: target.x, y: bounds.top + bounds.height + 10 },
      ],
      dash: [2, 5],
      color: "#dce6ce3d",
      width: 0.7,
      alpha: 1,
    },
  ]);
  expect(recorded.circles).toContainEqual({ ...target, radius: 5.5 });
  expect(recorded.labels).toEqual([]);
  expect(document).toEqual(before);
  expect(compose(document)).toEqual(scene.score);
});

test.each([390, 900])("idle lights have no tails or permanent guides at width %s", (width) => {
  const viewport = { width, height: 600 };
  const recorded = render(scene, viewport);
  expect(recorded.strokes).toEqual([]);
  expect(recorded.circles.filter((circle) => circle.radius === 5.2)).toEqual([
    { ...locate(document.sources[0], viewport), radius: 5.2 },
  ]);
  expect(recorded.labels).toEqual([]);
});

test("selection strengthens the light's color and glow without adding outlines or moving its head", () => {
  const idle = render(scene),
    selected = render({ ...scene, selected: 1 });
  expect(selected.strokes).toEqual([]);
  expect(selected.labels).toEqual([]);
  expect(selected.fills).toContainEqual({
    circle: { ...locate(document.sources[0], size), radius: 48 },
    alpha: 0.23,
  });
  expect(idle.fills).toContainEqual({
    circle: { ...locate(document.sources[0], size), radius: 35 },
    alpha: 0.09,
  });
  expect(selected.circles.filter((circle) => circle.radius === 5.2)).toEqual(
    idle.circles.filter((circle) => circle.radius === 5.2),
  );
  expect(selected.gradients.at(-1)?.stops).toEqual([
    { offset: 0, color: "#fff8e9" },
    { offset: 0.18, color: "#e9bd7e" },
    { offset: 0.65, color: "#e9bd7e" },
    { offset: 1, color: "#e9bd7ecc" },
  ]);
  expect(idle.gradients.at(-1)?.stops).toEqual([
    { offset: 0, color: "#edece0" },
    { offset: 0.3, color: "#e9bd7e" },
    { offset: 1, color: "#e9bd7e65" },
  ]);
  expect(compose(document)).toEqual(scene.score);
});

test("a sounding light pulses briefly, then returns to its resting glow", () => {
  const onset = render({ ...scene, playing: true }, size, 2);
  const later = render({ ...scene, playing: true }, size, 4);
  const position = locate(document.sources[0], size);
  expect(onset.fills).toContainEqual({
    circle: { ...position, radius: 67 },
    alpha: expect.closeTo(0.34, 10),
  });
  expect(later.fills).toContainEqual({ circle: { ...position, radius: 35 }, alpha: 0.09 });
});

test("without an active placement, there are no alignment guides, landing ring, or temporary labels", () => {
  const recorded = render(scene);
  expect(recorded.strokes).toEqual([]);
  expect(recorded.circles.filter((circle) => circle.radius === 5.5)).toEqual([]);
  expect(recorded.labels).toEqual([]);
  expect(recorded.circles).toContainEqual({ ...locate(document.sources[0], size), radius: 5.2 });
});

test("an occupied landing highlights the conflict without replacing the existing light or adding a label", () => {
  const recorded = render({
    ...scene,
    preview: {
      source: { id: 2, step: 2.1, tone: 7.1 },
      collisions: [{ sourceId: 1, step: 2 }],
    },
  });
  expect(recorded.strokes.find((stroke) => stroke.dash.length)?.color).toBe("#ef9b863d");
  expect(recorded.circles).toContainEqual({ ...locate(document.sources[0], size), radius: 14 });
  expect(recorded.labels).toEqual([]);
  expect(compose(document)).toEqual(scene.score);
});
