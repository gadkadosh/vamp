import { STEP_COUNT } from "./score";
import { energyFor, snapSource, soundingStep, toneFor, TONES } from "./playground";
import { volumePosition } from "./volume";
import type {
  Collision,
  CollisionFeedback,
  Constellation,
  Source,
  SpatialNote,
  View,
} from "./playground";
import { fieldBounds, locate, orbitPosition, project, TAU } from "./space";
import type { Camera, LightProjection, Position, Size } from "./space";

export type LandingPreview = { source: Source; collisions: Collision[] };

type Scene = {
  document: Constellation;
  view: View;
  camera: Camera;
  selected: number | null;
  score: SpatialNote[];
  playing: boolean;
  preview: LandingPreview | null;
  feedback: CollisionFeedback | null;
  writeEnergy?: number;
};

function line(context: CanvasRenderingContext2D, positions: Position[], color: string, width = 1) {
  context.beginPath();
  positions.forEach((position, i) => {
    if (i === 0) context.moveTo(position.x, position.y);
    else context.lineTo(position.x, position.y);
  });
  context.strokeStyle = color;
  context.lineWidth = width;
  context.stroke();
}

function circle(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fill: string | CanvasGradient,
) {
  context.beginPath();
  context.arc(x, y, radius, 0, TAU);
  context.fillStyle = fill;
  context.fill();
}

function glow(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha: number,
) {
  const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, `${color}00`);
  context.globalAlpha = alpha;
  circle(context, x, y, radius, gradient);
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
  const { width, height } = size;
  context.clearRect(0, 0, width, height);
  // Deterministic dust, not unrelated animation or musical events.
  for (let i = 0; i < 95; i++)
    circle(
      context,
      (i * 197.7 + 31) % width,
      (i * 91.3 + 17) % height,
      i % 7 === 0 ? 1 : 0.55,
      i % 7 === 0 ? "#b7c9c533" : "#a7b5be17",
    );
  const position = scene.playing ? progress : null;
  if (scene.view === "field") drawField(context, size, progress);
  else if (scene.view === "volume") drawVolume(context, scene, size, progress);
  else drawOrbit(context, size, scene.camera, progress);

  const sounding = new Set(scene.score.map((note) => `${note.sourceId}:${note.step}`));
  for (const { source, position: point } of points) {
    const step = source.step;
    const tone = toneFor(source);
    const selected = source.id === scene.selected;
    const onset = soundingStep(step);
    const delta = position === null ? STEP_COUNT : (position - onset + STEP_COUNT) % STEP_COUNT;
    const audible = scene.preview?.source.id !== source.id && sounding.has(`${source.id}:${onset}`);
    const pulse = audible && delta < 1.5 ? Math.exp(-delta * 3.4) : 0;
    const radius =
      (scene.view === "volume" ? 4 + energyFor(source) * 4 : 5.2) * Math.max(0.65, point.scale);
    if (scene.view === "volume" && !scene.camera.flat) {
      const foot = volumePosition(step, source.tone, 0, scene.camera, size);
      line(context, [foot, point], `${tone.color}${selected ? "88" : "28"}`, selected ? 1.2 : 0.7);
      circle(context, foot.x, foot.y, 2, `${tone.color}44`);
    }
    if (scene.view === "orbit") {
      const foot = orbitPosition(step, source.tone, 0, scene.camera, size);
      circle(context, foot.x, foot.y, radius * 1.7, `${tone.color}09`);
      line(context, [foot, point], `${tone.color}${selected ? "55" : "1c"}`, 0.75);
    }
    glow(
      context,
      point.x,
      point.y,
      (selected ? 56 : 35) * Math.max(0.7, point.scale) + pulse * 32,
      tone.color,
      0.09 + pulse * 0.25,
    );
    const matches = (collision: Collision) =>
      collision.sourceId === source.id && collision.step === onset;
    const previewConflict = scene.preview?.collisions.some(matches);
    const age = scene.feedback ? now - scene.feedback.started : Infinity;
    const flash =
      age < 900 && scene.feedback?.collisions.some(matches)
        ? (1 - age / 900) * (0.65 + Math.cos(age / 55) * 0.25)
        : 0;
    if (previewConflict || flash > 0) {
      glow(context, point.x, point.y, radius + 32, "#ef9b86", previewConflict ? 0.2 : flash * 0.25);
      context.beginPath();
      context.arc(point.x, point.y, radius + 13, 0, TAU);
      context.strokeStyle = "#ef9b86";
      context.globalAlpha = previewConflict ? 0.75 : flash;
      context.lineWidth = 1.2;
      context.stroke();
      context.globalAlpha = 1;
    }
    if (selected) {
      context.beginPath();
      context.arc(point.x, point.y, radius + 11, 0, TAU);
      context.strokeStyle = `${tone.color}77`;
      context.lineWidth = 0.8;
      context.stroke();
    }
    if (pulse > 0.03) {
      context.beginPath();
      context.arc(point.x, point.y, radius + (1 - pulse) * 22, 0, TAU);
      context.strokeStyle = `${tone.color}${Math.round(pulse * 100)
        .toString(16)
        .padStart(2, "0")}`;
      context.lineWidth = 1;
      context.stroke();
    }
    const gradient = context.createRadialGradient(
      point.x - radius * 0.3,
      point.y - radius * 0.4,
      0,
      point.x,
      point.y,
      radius,
    );
    gradient.addColorStop(0, pulse > 0.2 ? "#fffef4" : "#edece0");
    gradient.addColorStop(0.3, tone.color);
    gradient.addColorStop(1, `${tone.color}65`);
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, TAU);
    context.fillStyle = gradient;
    context.fill();
    circle(
      context,
      point.x - radius * 0.25,
      point.y - radius * 0.3,
      Math.max(1, radius * 0.17),
      "#fffff9a0",
    );
  }
  if (scene.preview) {
    const draft = scene.preview.source;
    const landing = snapSource(draft);
    const from = locate(draft, scene.view, scene.camera, size);
    const target = locate(landing, scene.view, scene.camera, size);
    const color = scene.preview.collisions.length ? "#ef9b86" : "#dce6ce";
    line(context, [from, target], `${color}66`, 0.75);
    glow(context, target.x, target.y, 16, color, 0.08);
    context.beginPath();
    context.arc(target.x, target.y, 5, 0, TAU);
    context.strokeStyle = `${color}99`;
    context.lineWidth = 0.8;
    context.stroke();
    circle(context, target.x, target.y, 1.5, `${color}bb`);
  }
}

function drawField(context: CanvasRenderingContext2D, size: Size, progress: number | null) {
  const bounds = fieldBounds(size);
  for (const [toneIndex, color] of [
    [2, "#94bfa5"],
    [7, "#e9bd7e"],
    [12, "#e5a599"],
    [17, "#a3bfe7"],
  ] as const) {
    const y = bounds.top + (1 - (toneIndex + 0.5) / TONES.length) * bounds.height;
    glow(context, size.width * 0.55, y, Math.max(size.width * 0.6, 380), color, 0.018);
  }
  if (progress !== null) {
    const x = bounds.left + (progress / STEP_COUNT) * bounds.width;
    const gradient = context.createLinearGradient(x - 65, 0, x, 0);
    gradient.addColorStop(0, "#c8dbd000");
    gradient.addColorStop(1, "#c8dbd00a");
    context.fillStyle = gradient;
    context.fillRect(x - 65, bounds.top - 18, 65, bounds.height + 36);
    line(
      context,
      [
        { x, y: bounds.top - 18, depth: 0, scale: 1 },
        { x, y: bounds.top + bounds.height + 18, depth: 0, scale: 1 },
      ],
      "#d0dfd155",
      0.8,
    );
    circle(context, x, bounds.top + bounds.height + 23, 2, "#bdceba");
  }
}

function drawOrbit(
  context: CanvasRenderingContext2D,
  size: Size,
  camera: Camera,
  progress: number | null,
) {
  const center = project(0, 0, 0, camera, size);
  glow(context, center.x, center.y, Math.min(size.width, size.height) * 0.55, "#91b0af", 0.045);
  circle(context, center.x, center.y, 2, "#b6c9bb55");
  if (progress !== null) {
    const angle = (progress / STEP_COUNT) * TAU;
    const start = project(Math.sin(angle) * 75, 0, -Math.cos(angle) * 75, camera, size);
    const end = project(Math.sin(angle) * 390, 0, -Math.cos(angle) * 390, camera, size);
    const previous = angle - 0.1;
    const trail = project(Math.sin(previous) * 390, 0, -Math.cos(previous) * 390, camera, size);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.lineTo(trail.x, trail.y);
    context.closePath();
    context.fillStyle = "#d9e5ce07";
    context.fill();
    line(context, [start, end], "#d0dfd15c", 0.9);
    glow(context, end.x, end.y, 18, "#d0dfd1", 0.18);
    circle(context, end.x, end.y, 2.2, "#d0dfd1");
  }
}

function drawVolume(
  context: CanvasRenderingContext2D,
  scene: Scene,
  size: Size,
  progress: number | null,
) {
  const at = (step: number, tone: number, energy: number) =>
    volumePosition(step, tone, energy, scene.camera, size);
  const top = TONES.length - 1;
  const polygon = (points: Position[], fill: string, stroke: string) => {
    context.beginPath();
    points.forEach((point, i) =>
      i ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y),
    );
    context.closePath();
    context.fillStyle = fill;
    context.fill();
    context.strokeStyle = stroke;
    context.lineWidth = 0.7;
    context.stroke();
  };
  glow(context, size.width * 0.5, size.height * 0.45, size.width * 0.42, "#8bbfbe", 0.035);
  if (!scene.camera.flat) {
    for (const energy of [0, 1]) {
      polygon(
        [at(0, 0, energy), at(32, 0, energy), at(32, top, energy), at(0, top, energy)],
        "#9ec8bb02",
        "#9ec8bb20",
      );
    }
    for (const step of [0, 32])
      for (const tone of [0, top])
        line(context, [at(step, tone, 0), at(step, tone, 1)], "#b2d6c333", 0.7);
  }
  const energy = scene.writeEnergy ?? 0.5;
  polygon(
    [at(0, 0, energy), at(32, 0, energy), at(32, top, energy), at(0, top, energy)],
    "#acdac008",
    "#b9dfc357",
  );
  for (let step = 0; step <= 32; step += 4) {
    const bottom = at(step, 0, energy),
      tick = at(step, -0.35, energy);
    line(context, [bottom, tick], "#bed8c64a");
    context.fillStyle = "#91afa378";
    context.font = '9px "Avenir Next", sans-serif';
    context.textAlign = "center";
    context.fillText(step === STEP_COUNT ? "↺" : String(step / 4 + 1), tick.x, tick.y + 13);
  }
  // Threads make a phrase legible through depth, without inventing extra notes.
  for (const material of ["bass", "mallet", "keys", "glass"]) {
    const phrase = scene.document.sources
      .filter((source) => toneFor(source).instrument === material)
      .sort((a, b) => a.step - b.step);
    if (phrase.length < 2) continue;
    context.beginPath();
    phrase.forEach((source, index) => {
      const point = at(source.step, source.tone, energyFor(source));
      if (!index) context.moveTo(point.x, point.y);
      else {
        const previous = phrase[index - 1];
        const middle = (previous.step + source.step) / 2;
        const a = at(middle, previous.tone, energyFor(previous));
        const b = at(middle, source.tone, energyFor(source));
        context.bezierCurveTo(a.x, a.y, b.x, b.y, point.x, point.y);
      }
    });
    context.strokeStyle = `${toneFor(phrase[0]).color}35`;
    context.lineWidth = 1;
    context.stroke();
  }
  if (progress !== null) {
    polygon(
      [at(progress, 0, 0), at(progress, top, 0), at(progress, top, 1), at(progress, 0, 1)],
      "#d2ebca0a",
      "#d2ebca38",
    );
    line(context, [at(progress, 0, energy), at(progress, top, energy)], "#deeed68a", 1);
  }
  context.font = '9px "Avenir Next", sans-serif';
  context.textAlign = "left";
  context.fillStyle = "#9bb9ad";
  const label = at(0, top, energy);
  context.fillText(
    scene.camera.flat ? "UNFOLDED / ALL DEPTHS" : "WRITING MEMBRANE",
    label.x,
    label.y - 15,
  );
  if (!scene.camera.flat) {
    for (const [depth, text] of [
      [0, "WHISPER"],
      [1, "FLARE"],
    ] as const) {
      const point = at(32, 0, depth);
      context.fillStyle = "#91afa38c";
      context.fillText(text, point.x + 12, point.y + 4);
    }
  }
}
