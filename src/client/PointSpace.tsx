import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { drawSpace, FEEDBACK_MS } from "./drawSpace";
import type { Scene } from "./drawSpace";
import type { Playback } from "./score";
import { clamp, findCollisions, moveSource, sourceLabel } from "./playground";
import type { CollisionFeedback, Constellation, Placement, Source } from "./playground";
import { layoutSources, pick, SETTLE_MS } from "./space";
import type { SettlingMotion, Size } from "./space";

type Props = {
  document: Constellation;
  selected: number | null;
  playing: boolean;
  feedback: CollisionFeedback | null;
  onSelect: (id: number | null) => void;
  onPlace: (source: Source) => Placement;
  onEdit: (change: (document: Constellation) => Constellation) => Constellation;
  onBegin: (cancel: () => void) => GestureEdit;
  nextId: () => number;
  getPlayback: () => Playback;
  onPlayback: () => void;
  renderSelection: (source: Source, focusSurface: () => void) => ReactNode;
};
type GestureEdit = {
  place: (source: Source) => Placement | null;
  commit: () => void;
  cancel: () => void;
};
type Gesture = {
  edit: GestureEdit;
  pointer: number;
  before: Constellation;
  grab: { x: number; y: number };
  last: { x: number; y: number };
  paint: boolean;
  moved: boolean;
  deselect: boolean;
};

export function PointSpace(props: Props) {
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const canvasBounds = useRef({ top: 0, height: 0 });
  const tools = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<number, HTMLButtonElement>());
  const focusedLight = useRef<HTMLButtonElement | null>(null);
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
  const scene: Scene = {
    document: { ...props.document, sources },
    selected: draft?.id ?? props.selected,
    playing: props.playing,
    feedback: props.feedback,
    reducedMotion,
    preview: draft
      ? {
          source: draft,
          collisions: findCollisions(props.document, draft),
        }
      : null,
  };
  const lights = layoutSources(sources, size, motion.current, performance.now());

  useEffect(() => {
    const keyDown = () => setKeyboard(true);
    const pointerDown = () => setKeyboard(false);
    const blur = () => gesture.current?.edit.cancel();
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", keyDown, true);
    window.addEventListener("pointerdown", pointerDown, true);
    return () => {
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("pointerdown", pointerDown, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (!keyboard || dragging) return;
    const focused = document.activeElement;
    // Undo can remove the focused button before we can redirect focus.
    const removedFocusedLight =
      focused === document.body && focusedLight.current && !focusedLight.current.isConnected;
    if (surface.current?.contains(focused) || removedFocusedLight) {
      const target = props.selected === null ? null : elements.current.get(props.selected);
      (target ?? surface.current)?.focus({ preventScroll: true });
    }
  }, [props.document, props.selected, keyboard, dragging]);

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

  useLayoutEffect(() => {
    const element = canvas.current!;
    const context = element.getContext("2d")!;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    // Let the notes illuminate the whole instrument, without clipping blooms at the field edge.
    const host = surface.current!.closest("main")!.getBoundingClientRect();
    const canvasTop = surface.current!.getBoundingClientRect().top - host.top;
    element.style.top = `${-canvasTop}px`;
    element.style.height = `${host.height}px`;
    element.width = Math.round(size.width * ratio);
    element.height = Math.round(host.height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, canvasTop * ratio);
    canvasBounds.current = { top: canvasTop, height: host.height };
  }, [size]);

  // Redraw committed scene changes; only playback and settling keep a frame loop alive.
  useLayoutEffect(() => {
    const context = canvas.current!.getContext("2d")!;
    const bounds = canvasBounds.current;
    const toolbar = tools.current;
    let toolbarSize = toolbar ? { width: toolbar.offsetWidth, height: toolbar.offsetHeight } : null;
    let toolbarPosition: { x: number; y: number } | null = null;
    let frame: number | null = null;
    function requestDraw() {
      if (frame === null) frame = requestAnimationFrame(draw);
    }
    function draw() {
      frame = null;
      const now = performance.now();
      const settling = motion.current;
      if (
        settling &&
        (scene.reducedMotion ||
          now - settling.started >= SETTLE_MS ||
          !sources.some(({ id }) => id === settling.to.id))
      )
        motion.current = null;
      const points = layoutSources(sources, size, motion.current, now);
      context.clearRect(0, -bounds.top, size.width, bounds.height);
      drawSpace(context, scene, size, props.getPlayback(), points, now);
      // React positions static lights. Only a settling light needs per-frame DOM updates.
      if (settling) {
        const point = points.find(({ source }) => source.id === settling.to.id);
        const target = elements.current.get(settling.to.id);
        if (point && target) {
          target.style.left = `${point.position.x}px`;
          target.style.top = `${point.position.y}px`;
        }
      }
      const selectedPoint = points.find(({ source }) => source.id === scene.selected);
      if (toolbar && toolbarSize && selectedPoint) {
        const { width, height } = toolbarSize;
        const position = selectedPoint.position;
        const x = clamp(position.x - width / 2, 4, Math.max(4, size.width - width - 4));
        const y =
          position.y + 27 + height > size.height ? position.y - height - 28 : position.y + 27;
        if (toolbarPosition?.x !== x) toolbar.style.left = `${x}px`;
        if (toolbarPosition?.y !== y) toolbar.style.top = `${y}px`;
        toolbarPosition = { x, y };
      }
      if (scene.playing || motion.current) requestDraw();
    }
    const remaining = scene.feedback ? scene.feedback.started + FEEDBACK_MS - performance.now() : 0;
    const feedbackTimer =
      remaining > 0
        ? setTimeout(() => {
            if (frame === null) draw();
          }, remaining)
        : undefined;
    const observer = toolbar
      ? new ResizeObserver(() => {
          const width = toolbar.offsetWidth,
            height = toolbar.offsetHeight;
          if (toolbarSize?.width !== width || toolbarSize?.height !== height) {
            toolbarSize = { width, height };
            requestDraw();
          }
        })
      : null;
    draw();
    if (toolbar) observer?.observe(toolbar);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      clearTimeout(feedbackTimer);
      observer?.disconnect();
    };
  }, [
    sources,
    size,
    props.selected,
    props.playing,
    props.feedback,
    props.getPlayback,
    draft,
    reducedMotion,
    dragging,
  ]);

  function updateDraft(source: Source | null) {
    draftRef.current = source;
    setDraft(source);
  }
  function settle(from: Source, to: Source | undefined) {
    motion.current =
      to && !reducedMotion && (from.step !== to.step || from.tone !== to.tone)
        ? { from, to, started: performance.now() }
        : null;
  }
  function coordinates(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }
  function newSource(x: number, y: number): Source {
    return { id: props.nextId(), ...pick(x, y, size) };
  }
  function add(x: number, y: number) {
    const source = newSource(x, y);
    const result = props.onPlace(source);
    if (result.accepted) settle(source, result.source);
  }
  function releasePointer(pointer: number) {
    if (surface.current?.hasPointerCapture(pointer)) surface.current.releasePointerCapture(pointer);
  }
  function cancelPreview() {
    const active = gesture.current;
    gesture.current = null;
    setDragging(false);
    if (draftRef.current) {
      settle(
        draftRef.current,
        active?.before.sources.find(({ id }) => id === draftRef.current?.id),
      );
    }
    updateDraft(null);
    if (active) releasePointer(active.pointer);
  }
  function remove(id: number) {
    props.onEdit((document) =>
      document.sources.some((source) => source.id === id)
        ? { ...document, sources: document.sources.filter((source) => source.id !== id) }
        : document,
    );
    props.onSelect(null);
    surface.current?.focus();
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current || (event.button !== 0 && event.button !== 2)) return;
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-light]");
    const id = target ? Number(target.dataset.light) : null;
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
    const hit = target?.getBoundingClientRect();
    const center = hit
      ? { x: hit.left + hit.width / 2 - bounds.left, y: hit.top + hit.height / 2 - bounds.top }
      : position;
    event.preventDefault();
    const paint = event.shiftKey && id === null;
    gesture.current = {
      edit: props.onBegin(cancelPreview),
      pointer: event.pointerId,
      before: props.document,
      grab: { x: position.x - center.x, y: position.y - center.y },
      last: position,
      paint,
      moved: false,
      deselect: source?.id === props.selected,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    if (paint) {
      surface.current?.focus();
      gesture.current.edit.place(newSource(position.x, position.y));
      return;
    }
    let initial = source ?? newSource(position.x, position.y);
    if (
      source &&
      motion.current?.to.id === source.id &&
      performance.now() - motion.current.started < SETTLE_MS
    )
      initial = { ...source, ...pick(center.x, center.y, size) };
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
    if (active.paint) {
      if (Math.hypot(position.x - active.last.x, position.y - active.last.y) > 24) {
        active.edit.place(newSource(position.x, position.y));
        active.last = position;
      }
    } else if (draftRef.current) {
      active.moved ||= Math.hypot(position.x - active.last.x, position.y - active.last.y) > 5;
      if (!active.moved) return;
      updateDraft({
        ...draftRef.current,
        ...pick(position.x - active.grab.x, position.y - active.grab.y, size),
      });
    }
  }
  function finish(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    if (event.type !== "pointerup") {
      active.edit.cancel();
      return;
    }
    gesture.current = null;
    setDragging(false);
    if (draftRef.current) {
      const source = draftRef.current;
      const previous = active.before.sources.find(({ id }) => id === source.id);
      if (previous && !active.moved) {
        settle(source, previous);
        props.onSelect(active.deselect ? null : previous.id);
        if (active.deselect) surface.current?.focus();
      } else {
        const result = active.edit.place(source);
        settle(source, result?.accepted ? result.source : previous);
      }
      updateDraft(null);
    }
    active.edit.commit();
    releasePointer(active.pointer);
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
    };
    const direction = event.key === "PageDown" ? 1 : event.key === "PageUp" ? -1 : 0;
    const document = gesture.current?.before ?? props.document;
    if (
      direction ||
      moves[event.key] ||
      ["Enter", "Escape", "Delete", "Backspace"].includes(event.key)
    )
      gesture.current?.edit.cancel();
    const source = document.sources.find((item) => item.id === props.selected);
    if (direction) {
      event.preventDefault();
      const ordered = [...document.sources].sort(
        (a, b) => a.step - b.step || a.tone - b.tone || a.id - b.id,
      );
      const index = ordered.findIndex(({ id }) => id === props.selected);
      const next =
        index < 0
          ? direction > 0
            ? 0
            : ordered.length - 1
          : (index + direction + ordered.length) % ordered.length;
      const id = ordered[next]?.id ?? null;
      props.onSelect(id);
      if (id !== null) elements.current.get(id)?.focus({ preventScroll: true });
    } else if (event.key === " ") {
      event.preventDefault();
      props.onPlayback();
    } else if (event.key === "Escape") {
      props.onSelect(null);
      surface.current?.focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      add(size.width * 0.5, size.height * 0.5);
    } else if (moves[event.key]) {
      event.preventDefault();
      if (!source) {
        props.onSelect(document.sources[0]?.id ?? null);
        return;
      }
      props.onPlace(moveSource(source, ...moves[event.key]));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      if (source) remove(source.id);
    }
  }

  const selected = props.document.sources.find(({ id }) => id === props.selected);

  return (
    <>
      <div
        ref={surface}
        className={`point-space${dragging ? " is-dragging" : ""}${keyboard ? " is-keyboard" : ""}`}
        tabIndex={selected ? -1 : 0}
        role="group"
        aria-label="Musical surface"
        aria-describedby="space-instructions"
        aria-keyshortcuts="PageUp PageDown"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) focusedLight.current = null;
        }}
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
            aria-label={sourceLabel(source)}
            aria-pressed={scene.selected === source.id}
            tabIndex={props.selected === source.id ? 0 : -1}
            onFocus={(event) => {
              focusedLight.current = event.currentTarget;
              props.onSelect(source.id);
            }}
            onClick={(event) => {
              // Pointer selection is resolved on release; retain assistive click activation.
              if (event.detail === 0 && props.document.sources.some(({ id }) => id === source.id))
                props.onSelect(source.id);
            }}
          />
        ))}
        <p id="space-instructions" className="sr-only">
          Left to right is time; bottom to top is pitch. Tap empty space to add a light. Tap a
          selected light again to deselect it. Drag a light to move it. Alignment guides and a
          landing point appear only while placing or dragging; release to settle on the previewed
          beat and pitch. Occupied bass beats and identical sounds are rejected. Shift-drag to
          scatter lights; right-click to remove. Keyboard: Page Up and Page Down select the previous
          and next light in time order, with lower pitches first at the same beat. Navigation wraps
          around the loop. Enter adds; arrows select a light, then move it one timing step or pitch.
          Select a light to duplicate or remove it using the buttons beside it. Keyboard focus uses
          a small frame. Delete removes; Escape deselects; Space plays or pauses. Tab leaves the
          surface and its selected controls. Undo restores the previous gesture, or cancels the
          current gesture before it is released. Escape also cancels an unfinished gesture.
        </p>
      </div>
      {selected && !dragging && (
        <div
          ref={tools}
          className="note-tools"
          role="group"
          aria-label="Selected note"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              props.onSelect(null);
              surface.current?.focus();
            }
          }}
        >
          {props.renderSelection(selected, () => surface.current?.focus())}
        </div>
      )}
    </>
  );
}
