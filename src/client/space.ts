import { STEP_COUNT } from "./score";
import { clamp, TONES } from "./playground";
import type { Source } from "./playground";

export type Size = { width: number; height: number };
export type Position = { x: number; y: number };
export type LightProjection = { source: Source; position: Position };
export type SettlingMotion = { from: Source; to: Source; started: number };
export const SETTLE_MS = 180;
export const TAU = Math.PI * 2;

export function fieldBounds(size: Size) {
  const compact = size.width < 520;
  const inset = compact ? 34 : size.width < 800 ? 48 : 70;
  return {
    left: inset,
    top: compact ? 35 : 38,
    width: Math.max(1, size.width - inset * 2),
    height: Math.max(1, size.height - (compact ? 72 : 82)),
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
    if (motion?.to.id === source.id && fraction < 1) {
      const from = locate(motion.from, size);
      position = {
        x: from.x + (position.x - from.x) * fraction,
        y: from.y + (position.y - from.y) * fraction,
      };
    }
    return { source, position };
  });
}

export function pick(x: number, y: number, size: Size): Pick<Source, "step" | "tone"> {
  const bounds = fieldBounds(size);
  return {
    step: clamp(((x - bounds.left) / bounds.width) * STEP_COUNT, 0, STEP_COUNT - 1),
    tone: clamp((1 - (y - bounds.top) / bounds.height) * (TONES.length - 1), 0, TONES.length - 1),
  };
}
