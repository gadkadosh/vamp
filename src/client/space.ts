import { STEP_COUNT } from "./score";
import { clamp, durationFor, TONES } from "./playground";
import type { Source } from "./playground";

export type Size = { width: number; height: number };
export type Position = { x: number; y: number };
export type LightProjection = { source: Source; position: Position; length: number };
export type SettlingMotion = { from: Source; to: Source; started: number };
export const SETTLE_MS = 180;
export const TAU = Math.PI * 2;

export function fieldBounds(size: Size) {
  const padding = 24;
  return {
    left: padding,
    top: padding,
    width: Math.max(1, size.width - padding * 2),
    height: Math.max(1, size.height - padding - 52),
  };
}

export function locate(source: Source, size: Size): Position {
  const bounds = fieldBounds(size);
  return {
    x: bounds.left + (source.step / STEP_COUNT) * bounds.width,
    y: bounds.top + (1 - source.tone / (TONES.length - 1)) * bounds.height,
  };
}

// Canvas lights and hit targets share the same settling animation.
export function layoutSources(
  sources: Source[],
  size: Size,
  motion: SettlingMotion | null = null,
  now = 0,
): LightProjection[] {
  const fraction = motion ? 1 - (1 - clamp((now - motion.started) / SETTLE_MS)) ** 3 : 1;
  return sources.map((source) => {
    let position = locate(source, size);
    let length = durationFor(source, sources);
    if (motion?.to.id === source.id && fraction < 1) {
      const from = locate(motion.from, size);
      position = {
        x: from.x + (position.x - from.x) * fraction,
        y: from.y + (position.y - from.y) * fraction,
      };
      const fromLength = durationFor(motion.from, sources);
      length = fromLength + (length - fromLength) * fraction;
    }
    return { source, position, length };
  });
}

export function tailLayout(point: LightProjection, size: Size) {
  const bounds = fieldBounds(size);
  const unit = bounds.width / STEP_COUNT;
  const length = clamp(point.length, 1, STEP_COUNT);
  const firstLength = Math.min(
    length,
    Math.max(0, (bounds.left + bounds.width - point.position.x) / unit),
  );
  const segments: { from: Position; to: Position; fromFraction: number; toFraction: number }[] = [];
  if (firstLength > 1e-6)
    segments.push({
      from: point.position,
      to: { x: point.position.x + firstLength * unit, y: point.position.y },
      fromFraction: 0,
      toFraction: firstLength / length,
    });
  if (length - firstLength > 1e-6)
    segments.push({
      from: { x: bounds.left, y: point.position.y },
      to: { x: bounds.left + (length - firstLength) * unit, y: point.position.y },
      fromFraction: firstLength / length,
      toFraction: 1,
    });
  const end = segments[segments.length - 1].to;
  // Hang the handle below the endpoint so even a one-step tail doesn't cover its head.
  return { segments, end, handle: { x: end.x, y: end.y + 16 } };
}

export function pick(x: number, y: number, size: Size): Pick<Source, "step" | "tone"> {
  const bounds = fieldBounds(size);
  return {
    step: clamp(((x - bounds.left) / bounds.width) * STEP_COUNT, 0, STEP_COUNT - 1),
    tone: clamp((1 - (y - bounds.top) / bounds.height) * (TONES.length - 1), 0, TONES.length - 1),
  };
}
