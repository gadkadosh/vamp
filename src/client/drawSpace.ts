import { STEP_COUNT } from "./score";
import { snapSource, soundingStep, toneFor, TONES } from "./playground";
import type {
  Collision,
  CollisionFeedback,
  Constellation,
  Source,
  SpatialNote,
} from "./playground";
import { fieldBounds, locate, TAU } from "./space";
import type { LightProjection, Position, Size } from "./space";

export type LandingPreview = { source: Source; collisions: Collision[] };
export type Scene = {
  document: Constellation;
  selected: number | null;
  score: SpatialNote[];
  playing: boolean;
  preview: LandingPreview | null;
  feedback: CollisionFeedback | null;
};

function line(
  context: CanvasRenderingContext2D,
  points: Position[],
  color: string | CanvasGradient,
  width = 1,
) {
  context.beginPath();
  points.forEach((point, i) =>
    i ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y),
  );
  context.strokeStyle = color;
  context.lineWidth = width;
  context.stroke();
}
function circle(
  context: CanvasRenderingContext2D,
  point: Position,
  radius: number,
  fill: string | CanvasGradient,
) {
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, TAU);
  context.fillStyle = fill;
  context.fill();
}
function ring(
  context: CanvasRenderingContext2D,
  point: Position,
  radius: number,
  color: string,
  width = 1,
) {
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, TAU);
  context.strokeStyle = color;
  context.lineWidth = width;
  context.stroke();
}
function glow(
  context: CanvasRenderingContext2D,
  point: Position,
  radius: number,
  color: string,
  alpha: number,
) {
  const gradient = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, `${color}00`);
  context.globalAlpha = alpha;
  circle(context, point, radius, gradient);
  context.globalAlpha = 1;
}

export function drawSpace(
  context: CanvasRenderingContext2D,
  scene: Scene,
  size: Size,
  progress: number | null,
  points: LightProjection[],
  now: number,
) {
  context.clearRect(0, 0, size.width, size.height);
  const bounds = fieldBounds(size);
  const sounding = new Set(scene.score.map((note) => `${note.sourceId}:${note.step}`));
  const pulseFor = (source: Source) => {
    if (
      !scene.playing ||
      progress === null ||
      scene.preview?.source.id === source.id ||
      !sounding.has(`${source.id}:${soundingStep(source.step)}`)
    )
      return 0;
    const age = (progress - soundingStep(source.step) + STEP_COUNT) % STEP_COUNT;
    return age < 1.5 ? Math.exp(-age * 3.4) : 0;
  };

  for (let i = 0; i < 95; i++)
    circle(
      context,
      { x: (i * 197.7 + 31) % size.width, y: (i * 91.3 + 17) % size.height },
      i % 7 ? 0.55 : 1,
      "#a7b5be22",
    );
  for (const [tone, color] of [
    [2, "#94bfa5"],
    [7, "#e9bd7e"],
    [12, "#e5a599"],
    [17, "#a3bfe7"],
  ] as const)
    glow(
      context,
      { x: size.width * 0.55, y: bounds.top + (1 - (tone + 0.5) / TONES.length) * bounds.height },
      Math.max(size.width * 0.6, 380),
      color,
      0.018,
    );

  if (progress !== null) {
    const x = bounds.left + (progress / STEP_COUNT) * bounds.width;
    line(
      context,
      [
        { x, y: bounds.top - 10 },
        { x, y: bounds.top + bounds.height + 10 },
      ],
      "#d0dfd155",
      0.8,
    );
    circle(context, { x, y: bounds.top + bounds.height + 21 }, 2, "#bdceba");
  }

  for (const { source, position } of points) {
    const color = toneFor(source).color;
    const selected = source.id === scene.selected;
    const pulse = pulseFor(source);
    const matches = (collision: Collision) =>
      collision.sourceId === source.id && collision.step === soundingStep(source.step);
    const age = scene.feedback ? now - scene.feedback.started : Infinity;
    const conflict =
      scene.preview?.collisions.some(matches) ||
      (age < 900 && scene.feedback?.collisions.some(matches));
    if (conflict) ring(context, position, 14, "#ef9b86", 1.3);
    glow(
      context,
      position,
      (selected ? 48 : 35) + pulse * 32,
      color,
      (selected ? 0.23 : 0.09) + pulse * 0.25,
    );
    if (pulse > 0.03)
      ring(
        context,
        position,
        5 + (1 - pulse) * 22,
        `${color}${Math.round(pulse * 100)
          .toString(16)
          .padStart(2, "0")}`,
      );
    const gradient = context.createRadialGradient(
      position.x - 1.5,
      position.y - 2,
      0,
      position.x,
      position.y,
      5.2,
    );
    gradient.addColorStop(0, pulse > 0.2 ? "#fffef4" : selected ? "#fff8e9" : "#edece0");
    gradient.addColorStop(selected ? 0.18 : 0.3, color);
    if (selected) gradient.addColorStop(0.65, color);
    gradient.addColorStop(1, `${color}${selected ? "cc" : "65"}`);
    circle(context, position, 5.2, gradient);
  }

  if (scene.preview) {
    const draft = scene.preview.source;
    const landing = snapSource(draft);
    const from = locate(draft, size),
      target = locate(landing, size);
    const color = scene.preview.collisions.length ? "#ef9b86" : "#dce6ce";
    context.setLineDash([2, 5]);
    line(
      context,
      [
        { x: bounds.left, y: target.y },
        { x: target.x, y: target.y },
        { x: target.x, y: bounds.top + bounds.height + 10 },
      ],
      `${color}3d`,
      0.7,
    );
    context.setLineDash([]);
    line(context, [from, target], `${color}66`, 0.75);
    ring(context, target, 5.5, `${color}aa`, 0.9);
    circle(context, target, 1.5, `${color}bb`);
  }
}
