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
    createLinearGradient() {
      const gradient = {
        stops: [] as { offset: number; color: string }[],
        addColorStop(offset: number, color: string) {
          this.stops.push({ offset, color });
        },
      };
      gradients.push(gradient);
      return gradient;
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
    gradients,
    fills,
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

function render(state: Scene, viewport = size) {
  const recorded = recordingContext();
  drawSpace(
    recorded.context,
    state,
    viewport,
    null,
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

test("the renderer draws wrapped ringing tails without moving heads or adding notes", () => {
  const document: Scene["document"] = {
    voice: "keys",
    sources: [{ id: 1, step: 31, tone: 11, length: 4 }],
  };
  const recorded = render({ ...scene, document, score: compose(document) });
  const point = layoutSources(document.sources, size)[0];
  const tail = tailLayout(point, size);
  expect(recorded.strokes).toHaveLength(4);
  expect(
    recorded.strokes.filter((stroke) => stroke.width === 1).map((stroke) => stroke.points),
  ).toEqual(tail.segments.map((segment) => [segment.from, segment.to]));
  expect(recorded.circles.filter((circle) => circle.radius === 5.2)).toEqual([
    { ...point.position, radius: 5.2 },
  ]);
  expect(compose(document)).toHaveLength(1);
  expect(recorded.labels).toEqual([]);
  // Wrapping must not restart the head's brighter color at the left edge.
  expect(recorded.gradients[0].stops.at(-1)?.color).toBe(recorded.gradients[1].stops[0].color);
  expect(recorded.gradients[1].stops[0].color).not.toBe(recorded.gradients[0].stops[0].color);
});

test.each([
  { width: 900, step: 2, length: 4 },
  { width: 390, step: 2, length: 1 },
  { width: 900, step: 0, length: 32 },
])(
  "round lights keep fine tails that emerge from the glow without changing duration (width $width, step $step, length $length)",
  ({ width, step, length }) => {
    const viewport = { width, height: 600 };
    const document: Scene["document"] = {
      voice: "keys",
      sources: [{ id: 1, step, tone: 11, length }],
    };
    const recorded = render({ ...scene, document, score: compose(document) }, viewport);
    const point = layoutSources(document.sources, viewport)[0];
    const end = tailLayout(point, viewport).segments[0].to;
    const gradient = recorded.gradients[0];
    expect(recorded.strokes).toEqual([
      { points: [point.position, end], color: gradient, dash: [], width: 3.2, alpha: 0.12 },
      { points: [point.position, end], color: gradient, dash: [], width: 1, alpha: 1 },
    ]);
    expect(recorded.circles).toContainEqual({ ...point.position, radius: 5.2 });
    const pixelLength = end.x - point.position.x;
    expect(gradient.stops.map((stop) => stop.offset)).toEqual([
      0,
      Math.min(2 / pixelLength, 0.15),
      Math.min(18 / pixelLength, 0.45),
      0.6,
      1,
    ]);
    const opacities = gradient.stops.map((stop) => Number.parseInt(stop.color.slice(-2), 16));
    // Transparent at the head, a gentle reveal inside its glow, then a quiet fade.
    expect(opacities.slice(0, 2)).toEqual([0, 0]);
    expect(opacities[2]).toBeGreaterThan(opacities[3]);
    expect(opacities[3]).toBeGreaterThan(opacities[4]);
    expect(opacities[2]).toBeLessThan(80);
    expect(opacities[4]).toBeGreaterThan(0);
  },
);

test("selection strengthens the light's glow and tail without adding outlines or permanent guides", () => {
  const idle = render(scene),
    selected = render({ ...scene, selected: 1 });
  const peak = (state: ReturnType<typeof render>) =>
    Math.max(...state.gradients[0].stops.map((stop) => Number.parseInt(stop.color.slice(-2), 16)));
  expect(peak(selected)).toBeGreaterThan(peak(idle));
  expect(selected.strokes.filter((stroke) => stroke.dash.length)).toEqual([]);
  expect(selected.labels).toEqual([]);
  expect(selected.strokes.map((stroke) => stroke.points)).toEqual(
    idle.strokes.map((stroke) => stroke.points),
  );
  expect(selected.fills).toContainEqual({
    circle: { ...locate(document.sources[0], size), radius: 48 },
    alpha: 0.17,
  });
  expect(idle.fills).toContainEqual({
    circle: { ...locate(document.sources[0], size), radius: 35 },
    alpha: 0.09,
  });
  expect(selected.circles.filter((circle) => circle.radius === 5.2)).toEqual(
    idle.circles.filter((circle) => circle.radius === 5.2),
  );
});

test.each([12, 30])(
  "resizing at step %s previews only a vertical endpoint guide, without a landing ring",
  (step) => {
    const source = { ...candidate, step, tone: 11, length: 3.6 };
    const recorded = render({ ...scene, preview: { source, collisions: [], resizing: true } });
    const target = tailLayout(layoutSources([snapSource(source)], size)[0], size).end;
    const bounds = fieldBounds(size);
    expect(
      recorded.strokes.filter((stroke) => stroke.dash.length).map((stroke) => stroke.points),
    ).toEqual([
      [
        { x: target.x, y: bounds.top },
        { x: target.x, y: bounds.top + bounds.height + 10 },
      ],
    ]);
    expect(
      recorded.circles.filter((circle) => circle.radius === 5.5 || circle.radius === 1.5),
    ).toEqual([]);
    expect(recorded.strokes.filter((stroke) => stroke.points.length === 0)).toEqual([]);
    expect(recorded.labels).toEqual([]);
  },
);

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
