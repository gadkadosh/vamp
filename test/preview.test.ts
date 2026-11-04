import { expect, test } from "vite-plus/test";
import { drawSpace } from "../src/client/drawSpace";
import type { Scene } from "../src/client/drawSpace";
import { compose, snapSource } from "../src/client/playground";
import { fieldBounds, layoutSources, locate, tailLayout } from "../src/client/space";

const size = { width: 900, height: 600 };
const document: Scene["document"] = { voice: "keys", sources: [{ id: 1, step: 2, tone: 7 }] };
const candidate = { id: 2, step: 12.31, tone: 11.18 };

function recordingContext() {
  type Point = { x: number; y: number };
  const strokes: { points: Point[]; dash: number[]; color: unknown }[] = [];
  const labels: string[] = [];
  const circles: { x: number; y: number; radius: number }[] = [];
  let points: Point[] = [],
    dash: number[] = [];
  const context = {
    strokeStyle: "",
    clearRect() {},
    fill() {},
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
      strokes.push({ points: [...points], dash: [...dash], color: this.strokeStyle });
    },
    fillText(text: string) {
      labels.push(text);
    },
    arc(x: number, y: number, radius: number) {
      circles.push({ x, y, radius });
    },
    createLinearGradient() {
      return { addColorStop() {} };
    },
    createRadialGradient() {
      return { addColorStop() {} };
    },
  };
  return {
    context: context as unknown as Parameters<typeof drawSpace>[0],
    strokes,
    labels,
    circles,
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

function render(state: Scene) {
  const recorded = recordingContext();
  drawSpace(recorded.context, state, size, null, layoutSources(state.document.sources, size), 0);
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
    },
  ]);
  expect(recorded.circles).toContainEqual({ ...target, radius: 5.5 });
  expect(recorded.labels).toEqual([]);
  expect(document).toEqual(before);
  expect(compose(document)).toEqual(scene.score);
});

test("the renderer draws wrapped ringing tails without moving heads or adding notes", () => {
  const document: Scene["document"] = {
    voice: "keys",
    sources: [{ id: 1, step: 31, tone: 11, length: 4 }],
  };
  const recorded = render({ ...scene, document, score: compose(document) });
  const point = layoutSources(document.sources, size)[0];
  const tail = tailLayout(point, size);
  const horizontal = recorded.strokes.filter(
    (stroke) => stroke.points.length === 2 && stroke.points[0].y === stroke.points[1].y,
  );
  expect(horizontal.map((stroke) => stroke.points)).toEqual(
    tail.segments.flatMap((segment) => [
      [segment.from, segment.to],
      [segment.from, segment.to],
    ]),
  );
  expect(recorded.circles.filter((circle) => circle.radius === 5.2)).toEqual([
    { ...point.position, radius: 5.2 },
  ]);
  expect(compose(document)).toHaveLength(1);
  expect(recorded.labels).toEqual([]);
});

test("resizing previews the quantized tail endpoint rather than moving the note's onset", () => {
  const source = { ...candidate, step: 12, tone: 11, length: 3.6 };
  const recorded = render({ ...scene, preview: { source, collisions: [], resizing: true } });
  const target = tailLayout(layoutSources([snapSource(source)], size)[0], size).end;
  expect(recorded.circles).toContainEqual({ ...target, radius: 5.5 });
  expect(recorded.strokes.find((stroke) => stroke.dash.length)?.points[1]).toEqual(target);
  expect(recorded.labels).toEqual([]);
});

test("without an active placement, there are no alignment guides, landing ring, or temporary labels", () => {
  const recorded = render(scene);
  expect(recorded.strokes.filter((stroke) => stroke.dash.length)).toEqual([]);
  expect(recorded.circles.filter((circle) => circle.radius === 5.5)).toEqual([]);
  expect(recorded.labels).toEqual([]);
  // The lights themselves remain visible when the placement overlay is absent.
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
