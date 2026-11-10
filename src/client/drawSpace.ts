import { STEP_COUNT } from "./score";
import type { Playback } from "./score";
import { snapNote, soundingStep, toneFor } from "../shared/pattern";
import type { Collision, CollisionFeedback, Pattern, Note, NoteId } from "../shared/pattern";
import { fieldBounds, locate, TAU } from "./space";
import type { LightProjection, Position, Size } from "./space";

export const FEEDBACK_MS = 800;
export type LandingPreview = { note: Note; collisions: Collision[] };
export type Scene = {
  document: Pattern;
  selected: NoteId | null;
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
  playback: Playback,
  points: LightProjection[],
  now: number,
) {
  const bounds = fieldBounds(size);
  const progress = playback.position;
  const ageFor = (note: Note) => {
    const onset = playback.onsets.get(note.id);
    const tone = toneFor(note);
    if (
      !onset ||
      onset.time > playback.time ||
      scene.preview?.note.id === note.id ||
      onset.note.step !== soundingStep(note.step) ||
      onset.note.instrument !== tone.instrument ||
      onset.note.row !== tone.row
    )
      return Infinity;
    // Both bloom age and pause behavior come from the same clock as the actual strike.
    return playback.time - onset.time;
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

  for (const { note, position } of points) {
    const color = toneFor(note).color;
    const draft = scene.preview?.note.id === note.id;
    const selected = note.id === scene.selected || draft;
    const age = ageFor(note);
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
      if (toneFor(note).instrument === "glass")
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
      collision.noteId === note.id && collision.step === soundingStep(note.step);
    const conflict =
      scene.preview?.collisions.some(matches) ||
      (scene.feedback &&
        now - scene.feedback.started < FEEDBACK_MS &&
        scene.feedback.collisions.some(matches));
    if (conflict) ring(context, position, radius + 9, "#f4a391d9");
  }

  if (scene.preview) {
    const draft = scene.preview.note;
    const landing = snapNote(draft);
    const from = locate(draft, size);
    const target = locate(landing, size);
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
