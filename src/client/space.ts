import { STEP_COUNT } from "./score";
import { clamp, energyFor, TONES } from "./playground";
import { pickVolume, volumePosition } from "./volume";
import type { Source, View } from "./playground";

export type Camera = { yaw: number; tilt: number; flat?: boolean };
export type Size = { width: number; height: number };
export type Position = { x: number; y: number; scale: number; depth: number };
export type LightProjection = { source: Source; position: Position };
export type SettlingMotion = { from: Source; to: Source; started: number };
export const SETTLE_MS = 180;
export const DEFAULT_CAMERA: Camera = { yaw: -0.3, tilt: 0.8 };
export const TAU = Math.PI * 2;
const INNER = 85;
const OUTER = 370;
const DISTANCE = 1100;
const FOCAL = 980;
const CENTER_Y = 0.47;
const SOURCE_HEIGHT = 10;
const fit = (size: Size) => Math.min(size.width / 900, size.height / 720);

export function fieldBounds(size: Size) {
  const padding = 24;
  return {
    left: padding,
    top: padding,
    width: Math.max(1, size.width - padding * 2),
    height: Math.max(1, size.height - padding - 52),
  };
}

export function project(x: number, y: number, z: number, camera: Camera, size: Size): Position {
  const rx = x * Math.cos(camera.yaw) - z * Math.sin(camera.yaw);
  const rz = x * Math.sin(camera.yaw) + z * Math.cos(camera.yaw);
  const depth = DISTANCE - y * Math.sin(camera.tilt) - rz * Math.cos(camera.tilt);
  const scale = (FOCAL / depth) * fit(size);
  return {
    x: size.width * 0.5 + rx * scale,
    y: size.height * CENTER_Y + (rz * Math.sin(camera.tilt) - y * Math.cos(camera.tilt)) * scale,
    depth,
    scale,
  };
}

export function orbitPosition(
  step: number,
  tone: number,
  height: number,
  camera: Camera,
  size: Size,
): Position {
  const angle = (step / STEP_COUNT) * TAU;
  const radius = INNER + (tone / (TONES.length - 1)) * (OUTER - INNER);
  return project(Math.sin(angle) * radius, height, -Math.cos(angle) * radius, camera, size);
}

export function locate(source: Source, view: View, camera: Camera, size: Size): Position {
  if (view === "volume")
    return volumePosition(source.step, source.tone, energyFor(source), camera, size);
  if (view === "orbit") return orbitPosition(source.step, source.tone, SOURCE_HEIGHT, camera, size);
  const bounds = fieldBounds(size);
  return {
    x: bounds.left + (source.step / STEP_COUNT) * bounds.width,
    y: bounds.top + (1 - source.tone / (TONES.length - 1)) * bounds.height,
    scale: 1,
    depth: 0,
  };
}

// Canvas and hit targets use the same animated positions, including return-to-origin bounces.
export function layoutSources(
  sources: Source[],
  view: View,
  camera: Camera,
  size: Size,
  motion: SettlingMotion | null = null,
  now = 0,
): LightProjection[] {
  const fraction = motion ? 1 - (1 - clamp((now - motion.started) / SETTLE_MS)) ** 3 : 1;
  return sources
    .map((source) => {
      let position = locate(source, view, camera, size);
      if (motion?.to.id === source.id && fraction < 1) {
        const from = locate(motion.from, view, camera, size);
        position = {
          x: from.x + (position.x - from.x) * fraction,
          y: from.y + (position.y - from.y) * fraction,
          depth: from.depth + (position.depth - from.depth) * fraction,
          scale: from.scale + (position.scale - from.scale) * fraction,
        };
      }
      return { source, position };
    })
    .sort((a, b) => b.position.depth - a.position.depth);
}

export function pick(
  x: number,
  y: number,
  view: View,
  camera: Camera,
  size: Size,
  energy = 0.5,
): Pick<Source, "step" | "tone"> {
  if (view === "volume") return pickVolume(x, y, energy, camera, size);
  if (view === "field") {
    const bounds = fieldBounds(size);
    return {
      step: clamp(((x - bounds.left) / bounds.width) * STEP_COUNT, 0, STEP_COUNT - 1e-6),
      tone: clamp((1 - (y - bounds.top) / bounds.height) * (TONES.length - 1), 0, TONES.length - 1),
    };
  }
  // Intersect the pointer ray with the source's horizontal plane. The same camera
  // transform is inverted here, so camera motion never changes a musical value.
  const unit = fit(size);
  const u = (x - size.width * 0.5) / (FOCAL * unit);
  const v = (y - size.height * CENTER_Y) / (FOCAL * unit);
  const s = Math.sin(camera.tilt);
  const c = Math.cos(camera.tilt);
  const rz = (v * (DISTANCE - SOURCE_HEIGHT * s) + SOURCE_HEIGHT * c) / Math.max(0.05, s + v * c);
  const depth = DISTANCE - SOURCE_HEIGHT * s - rz * c;
  const rx = u * depth;
  const worldX = rx * Math.cos(camera.yaw) + rz * Math.sin(camera.yaw);
  const worldZ = -rx * Math.sin(camera.yaw) + rz * Math.cos(camera.yaw);
  const radius = Math.hypot(worldX, worldZ);
  const angle = (((Math.atan2(worldX, -worldZ) / TAU) % 1) + 1) % 1;
  return {
    step: angle * STEP_COUNT,
    tone: clamp(((radius - INNER) / (OUTER - INNER)) * (TONES.length - 1), 0, TONES.length - 1),
  };
}
