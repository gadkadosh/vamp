import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { drawSpace } from "./drawSpace";
import { breathe, clamp, energyFor, findCollisions, moveSource, sourceLabel } from "./playground";
import { VOLUME_CAMERA } from "./volume";
import type {
  CollisionFeedback,
  Constellation,
  Placement,
  Source,
  SpatialNote,
  View,
} from "./playground";
import { DEFAULT_CAMERA, layoutSources, pick, SETTLE_MS } from "./space";
import type { Camera, SettlingMotion, Size } from "./space";

type Props = {
  document: Constellation;
  score: SpatialNote[];
  selected: number | null;
  view: View;
  playing: boolean;
  feedback: CollisionFeedback | null;
  onSelect: (id: number | null) => void;
  onPlace: (source: Source, remember?: boolean) => Placement;
  onEdit: (change: (document: Constellation) => Constellation, remember?: boolean) => Constellation;
  onCommit: (before: Constellation) => void;
  nextId: () => number;
  getProgress: () => number | null;
  onPlayback: () => void;
};
type Gesture = {
  pointer: number;
  before: Constellation;
  grab: { x: number; y: number };
  camera: Camera;
  start: { x: number; y: number };
  last: { x: number; y: number };
  rotate: boolean;
  cameraHandle: boolean;
  paint: boolean;
  depth: boolean;
  energy: number;
};

export function PointSpace(props: Props) {
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const elements = useRef(new Map<number, HTMLButtonElement>());
  const [size, setSize] = useState<Size>({ width: 1, height: 1 });
  const [orbitCamera, setOrbitCamera] = useState(DEFAULT_CAMERA);
  const [volumeCamera, setVolumeCamera] = useState(VOLUME_CAMERA);
  const camera = props.view === "volume" ? volumeCamera : orbitCamera;
  const setCamera = props.view === "volume" ? setVolumeCamera : setOrbitCamera;
  const [writeEnergy, setWriteEnergy] = useState(0.5);
  const [pullDepth, setPullDepth] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const motion = useRef<SettlingMotion | null>(null);
  const [draft, setDraft] = useState<Source | null>(null);
  const draftRef = useRef(draft);
  const [dragging, setDragging] = useState(false);
  const sources = draft
    ? props.document.sources.some(({ id }) => id === draft.id)
      ? props.document.sources.map((source) => (source.id === draft.id ? draft : source))
      : [...props.document.sources, draft]
    : props.document.sources;
  const scene = {
    ...props,
    camera,
    writeEnergy,
    document: { ...props.document, sources },
    selected: draft?.id ?? props.selected,
    preview: draft ? { source: draft, collisions: findCollisions(props.document, draft) } : null,
  };
  const latest = useRef(scene);
  latest.current = scene;
  const lights = layoutSources(
    sources,
    props.view,
    camera,
    size,
    motion.current,
    performance.now(),
  );

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(surface.current!);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = canvas.current!;
    const context = element.getContext("2d")!;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    element.width = Math.round(size.width * ratio);
    element.height = Math.round(size.height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    let frame: number;
    function draw() {
      const scene = latest.current;
      const now = performance.now();
      if (motion.current && now - motion.current.started >= SETTLE_MS) motion.current = null;
      const points = layoutSources(
        scene.document.sources,
        scene.view,
        scene.camera,
        size,
        motion.current,
        now,
      );
      drawSpace(context, scene, size, scene.getProgress(), points, now);
      for (const { source, position } of points) {
        const target = elements.current.get(source.id);
        if (target) {
          target.style.left = `${position.x}px`;
          target.style.top = `${position.y}px`;
        }
      }
      frame = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(frame);
  }, [size]);

  function updateDraft(source: Source | null) {
    draftRef.current = source;
    setDraft(source);
  }
  function settle(from: Source, to: Source | undefined) {
    motion.current =
      to && !matchMedia("(prefers-reduced-motion: reduce)").matches
        ? { from, to, started: performance.now() }
        : null;
  }
  function coordinates(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }
  function newSource(x: number, y: number): Source {
    return {
      id: props.nextId(),
      ...pick(x, y, props.view, camera, size, writeEnergy),
      ...(props.view === "volume" ? { energy: writeEnergy } : {}),
    };
  }
  function add(x: number, y: number, remember: boolean) {
    const source = newSource(x, y);
    const result = props.onPlace(source, remember);
    if (remember && result.accepted) settle(source, result.source);
  }
  function remove(id: number) {
    props.onEdit((document) => ({
      ...document,
      sources: document.sources.filter((source) => source.id !== id),
    }));
    props.onSelect(null);
    surface.current?.focus();
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current || (event.button !== 0 && event.button !== 2)) return;
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-light]");
    const id = target ? Number(target.dataset.light) : null;
    const source = props.document.sources.find((source) => source.id === id);
    const position = coordinates(event);
    const bounds = surface.current!.getBoundingClientRect();
    const hit = target?.getBoundingClientRect();
    const center = hit
      ? { x: hit.left + hit.width / 2 - bounds.left, y: hit.top + hit.height / 2 - bounds.top }
      : position;
    event.preventDefault();
    if (event.button === 2 && id !== null) {
      remove(id);
      return;
    }
    const cameraHandle = Boolean((event.target as HTMLElement).closest("[data-camera]"));
    const depth =
      props.view === "volume" && !cameraHandle && (pullDepth || (event.altKey && id !== null));
    const rotate =
      props.view !== "field" && !depth && (event.altKey || event.button === 2 || cameraHandle);
    if (event.button === 2 && !rotate) return;
    const paint = event.shiftKey && id === null && !rotate && !depth;
    gesture.current = {
      pointer: event.pointerId,
      before: props.document,
      grab: { x: position.x - center.x, y: position.y - center.y },
      start: position,
      last: position,
      camera,
      rotate,
      cameraHandle,
      paint,
      depth,
      energy: source ? energyFor(source) : writeEnergy,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    if (rotate || (depth && !source)) return;
    if (paint) {
      add(position.x, position.y, false);
      return;
    }
    let initial = source ?? newSource(position.x, position.y);
    if (
      source &&
      motion.current?.to.id === source.id &&
      performance.now() - motion.current.started < SETTLE_MS
    ) {
      const current = pick(center.x, center.y, props.view, camera, size, energyFor(source));
      initial = { ...source, ...current };
    }
    motion.current = null;
    updateDraft(initial);
    props.onSelect(source?.id ?? null);
    if (source) target?.focus();
    else surface.current?.focus();
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    const position = coordinates(event);
    if (active.rotate) {
      active.last = position;
      setCamera({
        ...active.camera,
        yaw:
          props.view === "volume"
            ? clamp(active.camera.yaw + (position.x - active.start.x) * 0.007, -0.8, 0.8)
            : active.camera.yaw + (position.x - active.start.x) * 0.007,
        tilt: clamp(
          active.camera.tilt + (position.y - active.start.y) * 0.004,
          props.view === "volume" ? -0.4 : 0.55,
          props.view === "volume" ? 0.6 : 1.25,
        ),
      });
    } else if (active.depth) {
      const energy = clamp(active.energy + (active.start.y - position.y) / 240);
      if (draftRef.current) updateDraft({ ...draftRef.current, energy });
      else setWriteEnergy(energy);
    } else if (active.paint) {
      if (Math.hypot(position.x - active.last.x, position.y - active.last.y) > 24) {
        add(position.x, position.y, false);
        active.last = position;
      }
    } else if (draftRef.current) {
      const source = draftRef.current;
      const next = pick(
        position.x - active.grab.x,
        position.y - active.grab.y,
        props.view,
        camera,
        size,
        energyFor(source),
      );
      updateDraft({ ...source, ...next });
    }
  }
  function finish(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    gesture.current = null;
    setDragging(false);
    if (active.rotate) {
      if (
        active.cameraHandle &&
        Math.hypot(active.last.x - active.start.x, active.last.y - active.start.y) < 4
      )
        setCamera(props.view === "volume" ? VOLUME_CAMERA : DEFAULT_CAMERA);
    } else if (active.paint) props.onCommit(active.before);
    else if (draftRef.current) {
      const source = draftRef.current;
      const previous = active.before.sources.find(({ id }) => id === source.id);
      if (event.type === "pointerup") {
        const result = props.onPlace(source);
        settle(source, result.accepted ? result.source : previous);
      } else settle(source, previous);
      updateDraft(null);
    }
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
    };
    const source = props.document.sources.find((item) => item.id === props.selected);
    if (event.key === " ") {
      event.preventDefault();
      props.onPlayback();
    } else if (event.key === "Escape") {
      props.onSelect(null);
      surface.current?.focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      add(size.width * 0.5, size.height * 0.5, true);
    } else if (moves[event.key]) {
      event.preventDefault();
      if (!source) {
        props.onSelect(props.document.sources[0]?.id ?? null);
        return;
      }
      const [step, tone] = moves[event.key];
      props.onPlace(
        props.view === "volume" && event.shiftKey
          ? { ...source, energy: clamp(energyFor(source) + (tone || step) * 0.1) }
          : moveSource(source, step, tone),
      );
    } else if (source && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      remove(source.id);
    }
  }

  return (
    <div
      ref={surface}
      className={`point-space${dragging ? " is-dragging" : ""}`}
      tabIndex={0}
      role="group"
      aria-label={
        props.view === "volume"
          ? "Interactive musical volume"
          : props.view === "field"
            ? "Interactive constellation"
            : "Interactive orbital constellation"
      }
      aria-describedby="space-instructions"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onKeyDown={keyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      <canvas ref={canvas} aria-hidden="true" />
      {lights.map(({ source, position }) => (
        <button
          key={source.id}
          ref={(element) => {
            if (element) elements.current.set(source.id, element);
            else elements.current.delete(source.id);
          }}
          type="button"
          data-light={source.id}
          className="light-hit"
          style={{ left: position.x, top: position.y }}
          aria-label={sourceLabel(source, props.document.voice)}
          aria-pressed={scene.selected === source.id}
          tabIndex={props.selected === source.id ? 0 : -1}
          onFocus={() => props.onSelect(source.id)}
          onClick={() => {
            if (props.document.sources.some(({ id }) => id === source.id))
              props.onSelect(source.id);
          }}
        />
      ))}
      {props.view === "volume" && (
        <div
          className="volume-tools"
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <div className="membrane-control" role="group" aria-label="Writing membrane intensity">
            <span>Write in</span>
            {(
              [
                [0.1, "Whisper"],
                [0.5, "Glow"],
                [0.95, "Flare"],
              ] as const
            ).map(([energy, label]) => (
              <button
                key={label}
                aria-pressed={Math.abs(writeEnergy - energy) < 0.06}
                onClick={() => setWriteEnergy(energy)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="volume-actions">
            <button
              aria-pressed={pullDepth}
              onClick={() => setPullDepth(!pullDepth)}
              title="Drag a light up for more intensity; down for less. Drag empty space to move the membrane."
            >
              ↗ Pull depth
            </button>
            <button
              aria-pressed={Boolean(camera.flat)}
              onClick={() => setVolumeCamera({ ...volumeCamera, flat: !volumeCamera.flat })}
            >
              ▱ {camera.flat ? "Return to volume" : "Flatten"}
            </button>
            <button
              onClick={() => props.onEdit(breathe)}
              title="Give the phrase a wave of quiet and forceful notes. Undoable."
            >
              ∿ Breathe
            </button>
          </div>
          <p>
            {pullDepth
              ? "Drag a light ↑ louder / ↓ softer. Empty space moves the membrane."
              : "Place on the membrane. Drag to compose. Pull depth to sculpt intensity."}
          </p>
        </div>
      )}
      {props.view !== "field" && (
        <button
          className="camera-reset surface-utility"
          data-camera
          title="Drag to turn · Click to reset the view"
          aria-label="Viewpoint: drag to turn, click to reset"
          onKeyDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            if (event.detail === 0)
              setCamera(props.view === "volume" ? VOLUME_CAMERA : DEFAULT_CAMERA);
          }}
        >
          ⌖
        </button>
      )}
      <p id="space-instructions" className="sr-only">
        Drag freely; a small landing point previews the beat and pitch. Release to settle. Occupied
        bass beats and identical sounds flash instead of creating silent lights. Shift-drag to
        scatter lights; right-click to remove. In Orbit, drag the compass or Alt-drag to turn. In
        Volume, Pull depth makes vertical drags change intensity. Shift-arrows change selected
        intensity. Flatten changes only the view. Breathe adds an undoable wave of dynamics.
        Keyboard: Enter adds; arrows move one beat in time or one pitch; Delete removes; Escape
        deselects; Space plays or pauses. Tab leaves the space.
      </p>
    </div>
  );
}
