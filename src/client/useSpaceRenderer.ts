import { useLayoutEffect, useRef } from "react";
import { drawSpace, FEEDBACK_MS } from "./drawSpace";
import type { Scene } from "./drawSpace";
import { clamp, findCollisions } from "./pattern";
import type { Note } from "./pattern";
import type { Playback } from "./score";
import { layoutNotes, SETTLE_MS } from "./space";
import type { SettlingMotion, Size } from "./space";

type PlaybackScene = Pick<Scene, "document" | "selected" | "playing" | "feedback"> & {
  getPlayback: () => Playback;
};
type View = { draft: Note | null; size: Size; reducedMotion: boolean; dragging: boolean };

// Keep the canvas, animated hit targets, and selection toolbar on the same frame clock.
export function useSpaceRenderer(
  { document, selected, playing, feedback, getPlayback }: PlaybackScene,
  { draft, size, reducedMotion, dragging }: View,
) {
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const canvasBounds = useRef({ top: 0, height: 0 });
  const tools = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<number, HTMLButtonElement>());
  const motion = useRef<SettlingMotion | null>(null);
  let notes = document.notes;
  if (draft) {
    if (notes.some(({ id }) => id === draft.id)) {
      notes = notes.map((note) => (note.id === draft.id ? draft : note));
    } else {
      notes = [...notes, draft];
    }
  }

  const scene: Scene = {
    document: { ...document, notes },
    selected: draft?.id ?? selected,
    playing,
    feedback,
    reducedMotion,
    preview: draft
      ? {
          note: draft,
          collisions: findCollisions(document, draft),
        }
      : null,
  };
  const lights = layoutNotes(notes, size, motion.current, performance.now());

  useLayoutEffect(() => {
    const element = canvas.current!;
    const context = element.getContext("2d");
    if (!context) return;
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
    const context = canvas.current!.getContext("2d");
    if (!context) return;
    const bounds = canvasBounds.current;
    const toolbar = tools.current;
    let toolbarSize = toolbar ? { width: toolbar.offsetWidth, height: toolbar.offsetHeight } : null;
    let toolbarPosition: { x: number; y: number } | null = null;
    let frame: number | null = null;

    function requestDraw() {
      if (frame === null) frame = requestAnimationFrame(draw);
    }

    const draw = () => {
      frame = null;
      const now = performance.now();
      const settling = motion.current;
      if (
        settling &&
        (scene.reducedMotion ||
          now - settling.started >= SETTLE_MS ||
          !notes.some(({ id }) => id === settling.to.id))
      )
        motion.current = null;
      const points = layoutNotes(notes, size, motion.current, now);
      context.clearRect(0, -bounds.top, size.width, bounds.height);
      drawSpace(context, scene, size, getPlayback(), points, now);
      // React positions static lights. Only a settling light needs per-frame DOM updates.
      if (settling) {
        const point = points.find(({ note }) => note.id === settling.to.id);
        const target = elements.current.get(settling.to.id);
        if (point && target) {
          target.style.left = `${point.position.x}px`;
          target.style.top = `${point.position.y}px`;
        }
      }
      const selectedPoint = points.find(({ note }) => note.id === scene.selected);
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
    };

    const remaining = scene.feedback ? scene.feedback.started + FEEDBACK_MS - performance.now() : 0;
    const feedbackTimer =
      remaining > 0
        ? setTimeout(() => {
            if (frame === null) draw();
          }, remaining)
        : undefined;
    const observer = toolbar
      ? new ResizeObserver(() => {
          const width = toolbar.offsetWidth;
          const height = toolbar.offsetHeight;
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
  }, [notes, size, selected, playing, feedback, getPlayback, draft, reducedMotion, dragging]);

  return { surface, canvas, tools, elements, motion, lights };
}
