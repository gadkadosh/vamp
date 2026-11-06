import { STEP_COUNT, STEP_SECONDS } from "./score";
import { snapSource, soundingStep, toneFor } from "./playground";
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
  reducedMotion: boolean;
  preview: LandingPreview | null;
  feedback: CollisionFeedback | null;
};

function line(context: CanvasRenderingContext2D, points: Position[], color: string, width = 0.65) {
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
  width = 0.65,
) {
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, TAU);
  context.strokeStyle = color;
  context.lineWidth = width;
  context.stroke();
}
function alpha(color: string, opacity: number) {
  return `${color}${Math.round(opacity * 255)
    .toString(16)
    .padStart(2, "0")}`;
}
function glow(
  context: CanvasRenderingContext2D,
  point: Position,
  radius: number,
  color: string,
  opacity: number,
) {
  const gradient = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
  gradient.addColorStop(0, alpha(color, opacity));
  gradient.addColorStop(0.25, alpha(color, opacity * 0.42));
  gradient.addColorStop(1, `${color}00`);
  circle(context, point, radius, gradient);
}

export function drawSpace(
  context: CanvasRenderingContext2D,
  scene: Scene,
  size: Size,
  progress: number | null,
  points: LightProjection[],
  now: number,
) {
  const bounds = fieldBounds(size);
  const sounding = new Set(scene.score.map((note) => `${note.sourceId}:${note.step}`));
  const ageFor = (source: Source) => {
    if (
      progress === null ||
      scene.preview?.source.id === source.id ||
      !sounding.has(`${source.id}:${soundingStep(source.step)}`)
    )
      return Infinity;
    // The suspended audio clock holds the bloom as well as the music when paused.
    return ((progress - soundingStep(source.step) + STEP_COUNT) % STEP_COUNT) * STEP_SECONDS;
  };

  if (scene.playing && !scene.reducedMotion && progress !== null) {
    const x = bounds.left + (progress / STEP_COUNT) * bounds.width;
    const shaft = context.createLinearGradient(x - 35, 0, x + 2, 0);
    shaft.addColorStop(0, "#dce3d000");
    shaft.addColorStop(0.94, "#dce3d003");
    shaft.addColorStop(1, "#dce3d00b");
    context.fillStyle = shaft;
    context.fillRect(x - 35, bounds.top - 8, 37, bounds.height + 16);
  }

  for (const { source, position } of points) {
    const color = toneFor(source).color;
    const draft = scene.preview?.source.id === source.id;
    const selected = source.id === scene.selected || draft;
    const age = ageFor(source);
    const pulse = age < 1.8 ? Math.exp(-age * 3.1) : 0;
    const radius =
      (size.width < 520 ? 3.8 : 4.2) *
      (draft ? 1.15 : selected ? 1.05 : 1) *
      (1 + (scene.reducedMotion ? 0 : pulse * 0.12));

    // Light comes only from the notes: colored cores, soft blooms, no stars or reflections.
    glow(context, position, 155 + pulse * 70, color, 0.026 + pulse * 0.18);
    glow(context, position, 39 + pulse * 48, color, (selected ? 0.15 : 0.07) + pulse * 0.35);
    glow(context, position, radius * 2.7, color, 0.15 + pulse * 0.28);
    if (pulse > 0.02) glow(context, position, radius * 3, color, pulse * 0.2);
    if (age < 1.1 && !scene.reducedMotion) {
      const expansion = 1 - Math.exp(-age * 2.3);
      ring(context, position, radius + expansion * 68, alpha(color, (1 - age / 1.1) * 0.18));
      if (toneFor(source).instrument === "glass")
        ring(context, position, radius + expansion * 45, alpha(color, (1 - age / 1.1) * 0.09));
    }
    const core = context.createRadialGradient(
      position.x,
      position.y,
      0,
      position.x,
      position.y,
      radius,
    );
    core.addColorStop(0, color);
    core.addColorStop(0.65, color);
    core.addColorStop(1, `${color}b3`);
    circle(context, position, radius, core);

    const matches = (collision: Collision) =>
      collision.sourceId === source.id && collision.step === soundingStep(source.step);
    const conflict =
      scene.preview?.collisions.some(matches) ||
      (scene.feedback &&
        now - scene.feedback.started < 800 &&
        scene.feedback.collisions.some(matches));
    if (conflict) ring(context, position, radius + 9, "#f4a391d9");
  }

  if (scene.preview) {
    const draft = scene.preview.source;
    const landing = snapSource(draft);
    const from = locate(draft, size),
      target = locate(landing, size);
    const color = scene.preview.collisions.length ? "#f4a391" : "#d7ded0";
    context.setLineDash([2, 6]);
    line(
      context,
      [
        { x: bounds.left, y: target.y },
        { x: bounds.left + bounds.width, y: target.y },
      ],
      `${color}3b`,
    );
    line(
      context,
      [
        { x: target.x, y: bounds.top },
        { x: target.x, y: bounds.top + bounds.height },
      ],
      `${color}3b`,
    );
    context.setLineDash([]);
    line(context, [from, target], `${color}59`);
    ring(context, target, 5, `${color}bf`);
    circle(context, target, 1, `${color}d9`);
  }
}
