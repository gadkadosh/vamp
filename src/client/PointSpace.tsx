import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { drawSpace } from "./drawSpace";
import { STEP_COUNT } from "./score";
import {
  durationFor,
  findCollisions,
  moveSource,
  resizeSource,
  sourceLabel,
  toneFor,
} from "./playground";
import type {
  CollisionFeedback,
  Constellation,
  Placement,
  Source,
  SpatialNote,
} from "./playground";
import { fieldBounds, layoutSources, pick, tailLayout, SETTLE_MS } from "./space";
import type { SettlingMotion, Size } from "./space";

type Props = {
  document: Constellation;
  score: SpatialNote[];
  selected: number | null;
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
  last: { x: number; y: number };
  paint: boolean;
  resizing: boolean;
  startX: number;
  length: number;
};

export function PointSpace(props: Props) {
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const elements = useRef(new Map<number, HTMLButtonElement>());
  const lengthElement = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState<Size>({ width: 1, height: 1 });
  const gesture = useRef<Gesture | null>(null);
  const motion = useRef<SettlingMotion | null>(null);
  const [draft, setDraft] = useState<Source | null>(null);
  const draftRef = useRef(draft);
  const [dragging, setDragging] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const sources = draft
    ? props.document.sources.some(({ id }) => id === draft.id)
      ? props.document.sources.map((source) => (source.id === draft.id ? draft : source))
      : [...props.document.sources, draft]
    : props.document.sources;
  const scene = {
    ...props,
    document: { ...props.document, sources },
    selected: draft?.id ?? props.selected,
    preview: draft
      ? {
          source: draft,
          collisions: findCollisions(props.document, draft),
          resizing: gesture.current?.resizing,
        }
      : null,
  };
  const latest = useRef(scene);
  latest.current = scene;
  const lights = layoutSources(sources, size, motion.current, performance.now());
  const selectedLight = lights.find((point) => point.source.id === scene.selected);
  const handlePosition = selectedLight ? tailLayout(selectedLight, size).end : null;

  useEffect(() => {
    const keyDown = () => setKeyboard(true);
    const pointerDown = () => setKeyboard(false);
    window.addEventListener("keydown", keyDown, true);
    window.addEventListener("pointerdown", pointerDown, true);
    return () => {
      window.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("pointerdown", pointerDown, true);
    };
  }, []);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(surface.current!);
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener("change", update);
    return () => {
      observer.disconnect();
      preference.removeEventListener("change", update);
    };
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
      const points = layoutSources(scene.document.sources, size, motion.current, now);
      drawSpace(context, scene, size, scene.getProgress(), points, now);
      for (const { source, position } of points) {
        const target = elements.current.get(source.id);
        if (target) {
          target.style.left = `${position.x}px`;
          target.style.top = `${position.y}px`;
        }
      }
      const selected = points.find((point) => point.source.id === scene.selected);
      if (selected && lengthElement.current) {
        const handle = tailLayout(selected, size).end;
        lengthElement.current.style.left = `${handle.x}px`;
        lengthElement.current.style.top = `${handle.y}px`;
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
    motion.current = to && !reducedMotion ? { from, to, started: performance.now() } : null;
  }
  function coordinates(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }
  function newSource(x: number, y: number): Source {
    return { id: props.nextId(), ...pick(x, y, size) };
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
    const lengthTarget = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-length]");
    const id = lengthTarget
      ? Number(lengthTarget.dataset.length)
      : target
        ? Number(target.dataset.light)
        : null;
    const source = props.document.sources.find((source) => source.id === id);
    if (event.button === 2) {
      if (source) {
        event.preventDefault();
        remove(source.id);
      }
      return;
    }
    const position = coordinates(event);
    const bounds = surface.current!.getBoundingClientRect();
    const hit = (lengthTarget ?? target)?.getBoundingClientRect();
    const center = hit
      ? { x: hit.left + hit.width / 2 - bounds.left, y: hit.top + hit.height / 2 - bounds.top }
      : position;
    event.preventDefault();
    const paint = event.shiftKey && id === null;
    gesture.current = {
      pointer: event.pointerId,
      before: props.document,
      grab: { x: position.x - center.x, y: position.y - center.y },
      last: position,
      paint,
      resizing: Boolean(lengthTarget),
      startX: position.x,
      length: source ? durationFor(source, props.document.sources) : 1,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    if (paint) {
      add(position.x, position.y, false);
      return;
    }
    let initial = source ?? newSource(position.x, position.y);
    if (
      source &&
      !lengthTarget &&
      motion.current?.to.id === source.id &&
      performance.now() - motion.current.started < SETTLE_MS
    )
      initial = { ...source, ...pick(center.x, center.y, size) };
    motion.current = null;
    updateDraft(initial);
    props.onSelect(source?.id ?? null);
    if (source) (lengthTarget ?? target)?.focus();
    else surface.current?.focus();
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    const position = coordinates(event);
    if (active.paint) {
      if (Math.hypot(position.x - active.last.x, position.y - active.last.y) > 24) {
        add(position.x, position.y, false);
        active.last = position;
      }
    } else if (draftRef.current) {
      updateDraft(
        active.resizing
          ? resizeSource(
              draftRef.current,
              active.length + (position.x - active.startX) / (fieldBounds(size).width / STEP_COUNT),
              active.before.sources,
            )
          : {
              ...draftRef.current,
              ...pick(position.x - active.grab.x, position.y - active.grab.y, size),
            },
      );
    }
  }
  function finish(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    gesture.current = null;
    setDragging(false);
    if (active.paint) props.onCommit(active.before);
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
  function changeLength(source: Source, delta: number) {
    props.onPlace(
      resizeSource(
        source,
        durationFor(source, props.document.sources) + delta,
        props.document.sources,
      ),
    );
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
    } else if (source && (event.key === "[" || event.key === "]")) {
      event.preventDefault();
      changeLength(source, event.key === "]" ? 1 : -1);
    } else if (moves[event.key]) {
      event.preventDefault();
      if (!source) {
        props.onSelect(props.document.sources[0]?.id ?? null);
        return;
      }
      props.onPlace(moveSource(source, ...moves[event.key]));
    } else if (source && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      remove(source.id);
    }
  }

  return (
    <div
      ref={surface}
      className={`point-space${dragging ? " is-dragging" : ""}${dragging && gesture.current?.resizing ? " is-resizing" : ""}${keyboard ? " is-keyboard" : ""}`}
      tabIndex={0}
      role="group"
      aria-label="Interactive constellation"
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
      {selectedLight && handlePosition && (
        <button
          key={`length-${selectedLight.source.id}`}
          ref={lengthElement}
          type="button"
          data-length={selectedLight.source.id}
          className="length-hit"
          style={{
            left: handlePosition.x,
            top: handlePosition.y,
            color: toneFor(selectedLight.source).color,
          }}
          title="Drag the end to change ringing time"
          aria-label={`Resize light ${selectedLight.source.id}: ${Math.round(selectedLight.length)} timing steps. Left and right arrows adjust length.`}
          onKeyDown={(event) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.stopPropagation();
              event.preventDefault();
              changeLength(selectedLight.source, event.key === "ArrowRight" ? 1 : -1);
            } else if (event.key === "Enter") {
              event.stopPropagation();
              event.preventDefault();
              surface.current?.focus();
            }
          }}
        >
          <span aria-hidden="true" />
        </button>
      )}
      <p id="space-instructions" className="sr-only">
        Left to right is time; bottom to top is pitch. Tap empty space to add a light. Drag a light
        to move it. Alignment guides and a landing point appear only while placing or dragging;
        release to settle on the previewed beat and pitch. Occupied bass beats and identical sounds
        are rejected. Shift-drag to scatter lights; right-click to remove. Keyboard: Enter adds;
        arrows move one timing step or pitch; brackets shorten or lengthen the selection. Select a
        light and drag its end-cap to change ringing time. The end-cap is keyboard-focusable; left
        and right arrows resize it. Keyboard focus uses corner marks. Delete removes; Escape
        deselects; Space plays or pauses. Tab leaves the surface and its selected controls. Undo
        restores the previous gesture.
      </p>
    </div>
  );
}
