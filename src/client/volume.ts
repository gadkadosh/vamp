import { clamp, TONES } from "./playground";
import { STEP_COUNT } from "./score";
import type { Camera, Position, Size } from "./space";

export const VOLUME_CAMERA: Camera = { yaw: -0.46, tilt: 0.28 };
const DISTANCE = 1500;
const FOCAL = 1200;
const drawingHeight = (size: Size) => Math.max(100, size.height - 130);
const fit = (size: Size) => Math.min(size.width / 1240, drawingHeight(size) / 610);
const flatBounds = (size: Size) => ({
  width: Math.max(1, size.width - 48),
  height: Math.max(1, drawingHeight(size) - 48),
});

// A real volume: x = loop time, y = pitch, z = intensity. Flattening is a
// projection change only; the musical coordinates never move.
export function volumePosition(
  step: number,
  tone: number,
  energy: number,
  camera: Camera,
  size: Size,
): Position {
  if (camera.flat) {
    const bounds = flatBounds(size);
    return {
      x: 24 + (step / STEP_COUNT) * bounds.width,
      y: 24 + (1 - tone / (TONES.length - 1)) * bounds.height,
      scale: 1,
      depth: DISTANCE,
    };
  }
  const x = (step / STEP_COUNT - 0.5) * 920;
  const y = (tone / (TONES.length - 1) - 0.5) * 380;
  const z = (energy - 0.5) * 440;
  const { yaw, tilt } = camera;
  const rx = x * Math.cos(yaw) - z * Math.sin(yaw);
  const rz = x * Math.sin(yaw) + z * Math.cos(yaw);
  const ry = y * Math.cos(tilt) - rz * Math.sin(tilt);
  const depth = DISTANCE - y * Math.sin(tilt) - rz * Math.cos(tilt);
  const scale = (FOCAL / depth) * fit(size);
  return {
    x: size.width / 2 + rx * scale,
    y: drawingHeight(size) * 0.48 - ry * scale,
    scale,
    depth,
  };
}

export function pickVolume(x: number, y: number, energy: number, camera: Camera, size: Size) {
  if (camera.flat) {
    const bounds = flatBounds(size);
    return {
      step: clamp(((x - 24) / bounds.width) * STEP_COUNT, 0, STEP_COUNT - 1e-6),
      tone: clamp((1 - (y - 24) / bounds.height) * (TONES.length - 1), 0, TONES.length - 1),
    };
  }
  const u = (x - size.width / 2) / (FOCAL * fit(size));
  const v = -(y - drawingHeight(size) * 0.48) / (FOCAL * fit(size));
  const sy = Math.sin(camera.yaw),
    cy = Math.cos(camera.yaw);
  const st = Math.sin(camera.tilt),
    ct = Math.cos(camera.tilt);
  const denominator = u * sy + v * st * cy + ct * cy;
  const depth = (DISTANCE * ct * cy - (energy - 0.5) * 440) / Math.max(0.12, denominator);
  const rz = -v * depth * st + (DISTANCE - depth) * ct;
  const worldX = u * depth * cy + rz * sy;
  const worldY = v * depth * ct + (DISTANCE - depth) * st;
  return {
    step: clamp((worldX / 920 + 0.5) * STEP_COUNT, 0, STEP_COUNT - 1e-6),
    tone: clamp((worldY / 380 + 0.5) * (TONES.length - 1), 0, TONES.length - 1),
  };
}
