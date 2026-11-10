import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import type { Playback } from "./score";
import { moveNote, noteLabel } from "../shared/pattern";
import type { CollisionFeedback, Pattern, Placement, Note, NoteId } from "../shared/pattern";
import { layoutNotes, pick, SETTLE_MS } from "./space";
import type { Size } from "./space";
import { useSpaceRenderer } from "./useSpaceRenderer";

type Props = {
  document: Pattern;
  selected: NoteId | null;
  disabled: boolean;
  undoable: boolean;
  playing: boolean;
  feedback: CollisionFeedback | null;
  onSelect: (id: NoteId | null) => void;
  onPlace: (note: Note) => Placement;
  onRemove: (id: NoteId) => void;
  onBegin: (cancel: () => void) => GestureEdit;
  nextId: () => NoteId;
  getPlayback: () => Playback;
  renderSelection: (note: Note, focusSurface: () => void) => ReactNode;
};

type GestureEdit = {
  activate: () => void;
  place: (note: Note) => Placement | null;
  commit: () => void;
  cancel: () => void;
};

type Gesture = {
  edit: GestureEdit;
  pointer: number;
  before: Pattern;
  grab: { x: number; y: number };
  last: { x: number; y: number };
  paint: boolean;
  moved: boolean;
  deselect: boolean;
};

export function PointSpace(props: Props) {
  const focusedControl = useRef<HTMLElement | null>(null);
  const [size, setSize] = useState<Size>({ width: 1, height: 1 });
  const gesture = useRef<Gesture | null>(null);
  const [draft, setDraft] = useState<Note | null>(null);
  const draftRef = useRef(draft);
  const [dragging, setDragging] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const { surface, canvas, tools, elements, motion, lights } = useSpaceRenderer(props, {
    draft,
    size,
    reducedMotion,
    dragging,
  });

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
    // Undo or deselection can remove a focused control before we can redirect focus.
    const removedFocusedControl =
      focused === document.body && focusedControl.current && !focusedControl.current.isConnected;
    if (surface.current?.contains(focused) || removedFocusedControl) {
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

  function updateDraft(note: Note | null) {
    draftRef.current = note;
    setDraft(note);
  }

  function settle(from: Note, to: Note | undefined) {
    motion.current =
      to && !reducedMotion && (from.step !== to.step || from.tone !== to.tone)
        ? { from, to, started: performance.now() }
        : null;
  }

  function coordinates(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function newNote(x: number, y: number): Note {
    return { id: props.nextId(), ...pick(x, y, size) };
  }

  function add(x: number, y: number) {
    const note = newNote(x, y);
    const result = props.onPlace(note);
    if (result.accepted) settle(note, result.note);
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
        active?.before.notes.find(({ id }) => id === draftRef.current?.id),
      );
    }
    updateDraft(null);
    if (active) releasePointer(active.pointer);
  }

  function remove(id: NoteId) {
    props.onRemove(id);
    props.onSelect(null);
    surface.current?.focus();
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (props.disabled || gesture.current || (event.button !== 0 && event.button !== 2)) return;
    const position = coordinates(event);
    // Overlapping buttons receive events in DOM order, not by proximity to the visible lights.
    const points = layoutNotes(props.document.notes, size, motion.current, performance.now());
    let nearest: (typeof points)[number] | undefined;
    let distance = 18; // Match the 36px circular hit targets.
    for (const point of points) {
      const gap = Math.hypot(position.x - point.position.x, position.y - point.position.y);
      if (gap <= distance) {
        nearest = point;
        distance = gap;
      }
    }
    const note = nearest?.note;
    const target = note ? elements.current.get(note.id) : null;
    if (event.button === 2) {
      if (note) {
        event.preventDefault();
        remove(note.id);
      }
      return;
    }
    const center = nearest?.position ?? position;
    event.preventDefault();
    const paint = event.shiftKey && !note;
    gesture.current = {
      edit: props.onBegin(cancelPreview),
      pointer: event.pointerId,
      before: props.document,
      grab: { x: position.x - center.x, y: position.y - center.y },
      last: position,
      paint,
      moved: false,
      deselect: note?.id === props.selected,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    // A press on an existing light is only selection until it becomes a drag.
    if (!note) gesture.current.edit.activate();
    if (paint) {
      surface.current?.focus();
      gesture.current.edit.place(newNote(position.x, position.y));
      return;
    }
    let initial = note ?? newNote(position.x, position.y);
    if (
      note &&
      motion.current?.to.id === note.id &&
      performance.now() - motion.current.started < SETTLE_MS
    )
      initial = { ...note, ...pick(center.x, center.y, size) };
    motion.current = null;
    updateDraft(initial);
    props.onSelect(note?.id ?? null);
    if (note) target?.focus();
    else surface.current?.focus();
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    const position = coordinates(event);
    if (active.paint) {
      if (Math.hypot(position.x - active.last.x, position.y - active.last.y) > 24) {
        active.edit.place(newNote(position.x, position.y));
        active.last = position;
      }
    } else if (draftRef.current) {
      active.moved ||= Math.hypot(position.x - active.last.x, position.y - active.last.y) > 5;
      if (!active.moved) return;
      active.edit.activate();
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
      const note = draftRef.current;
      const previous = active.before.notes.find(({ id }) => id === note.id);
      if (previous && !active.moved) {
        settle(note, previous);
        props.onSelect(active.deselect ? null : previous.id);
        if (active.deselect) surface.current?.focus();
      } else {
        const result = active.edit.place(note);
        settle(note, result?.accepted ? result.note : previous);
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
    if (
      props.disabled &&
      (moves[event.key] || ["Enter", "Delete", "Backspace"].includes(event.key))
    ) {
      event.preventDefault();
      return;
    }
    const direction = event.key === "PageDown" ? 1 : event.key === "PageUp" ? -1 : 0;
    const document = gesture.current?.before ?? props.document;
    if (direction || moves[event.key] || ["Enter", "Delete", "Backspace"].includes(event.key))
      gesture.current?.edit.cancel();
    const note = document.notes.find((item) => item.id === props.selected);
    if (direction) {
      event.preventDefault();
      const ordered = [...document.notes].sort((a, b) => a.step - b.step || a.tone - b.tone);
      const index = ordered.findIndex(({ id }) => id === props.selected);
      let next: number;
      if (index < 0) {
        next = direction > 0 ? 0 : ordered.length - 1;
      } else {
        next = (index + direction + ordered.length) % ordered.length;
      }
      const id = ordered[next]?.id ?? null;
      props.onSelect(id);
      if (id !== null) elements.current.get(id)?.focus({ preventScroll: true });
    } else if (event.key === "Enter") {
      event.preventDefault();
      add(size.width * 0.5, size.height * 0.5);
    } else if (moves[event.key]) {
      event.preventDefault();
      if (!note) {
        props.onSelect(document.notes[0]?.id ?? null);
        return;
      }
      props.onPlace(moveNote(note, ...moves[event.key]));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      if (note) remove(note.id);
    }
  }

  const selected = props.document.notes.find(({ id }) => id === props.selected);

  return (
    <>
      <div
        ref={surface}
        className={`point-space${dragging ? " is-dragging" : ""}${keyboard ? " is-keyboard" : ""}`}
        tabIndex={selected ? -1 : 0}
        role="group"
        aria-label="Musical surface"
        aria-disabled={props.disabled}
        aria-describedby="space-instructions"
        aria-keyshortcuts="PageUp PageDown"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) focusedControl.current = null;
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
        {lights.map(({ note, position }) => (
          <button
            key={note.id}
            ref={(element) => {
              if (element) elements.current.set(note.id, element);
              else elements.current.delete(note.id);
            }}
            type="button"
            data-light={note.id}
            className="light-hit"
            style={{ left: position.x, top: position.y }}
            aria-label={noteLabel(note)}
            aria-pressed={(draft?.id ?? props.selected) === note.id}
            tabIndex={props.selected === note.id ? 0 : -1}
            onFocus={(event) => {
              focusedControl.current = event.currentTarget;
              props.onSelect(note.id);
            }}
            onClick={(event) => {
              // Pointer selection is resolved on release; retain assistive click activation.
              if (event.detail === 0 && props.document.notes.some(({ id }) => id === note.id))
                props.onSelect(note.id);
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
          Select a light to remove it using the button beside it. Keyboard focus uses a small frame.
          Delete removes; Escape deselects from anywhere; Space plays or pauses. Tab leaves the
          surface and its selected controls.{" "}
          {props.undoable &&
            "Undo restores the previous gesture, or cancels the current gesture before it is released. "}
          Escape closes an open menu or help dialog first, or cancels an unfinished gesture before
          deselecting.
        </p>
      </div>
      {selected && !dragging && (
        <div
          ref={tools}
          className="note-tools"
          role="group"
          aria-label="Selected note"
          onFocus={(event) => {
            focusedControl.current = event.target;
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) focusedControl.current = null;
          }}
        >
          {props.renderSelection(selected, () => surface.current?.focus())}
        </div>
      )}
    </>
  );
}
