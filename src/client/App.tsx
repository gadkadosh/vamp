import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { HelpDialog } from "./HelpDialog";
import { Icon } from "./Icon";
import { PointSpace } from "./PointSpace";
import { compose, createPattern, placeNote, noteLabel, toneFor } from "./pattern";
import type { CollisionFeedback, Pattern, Placement, Note } from "./pattern";
import { Sequencer } from "./sequencer";
import { DEFAULT_VOLUME, EMPTY_PLAYBACK, INSTRUMENTS } from "./score";

type History = { present: Pattern; past: Pattern[]; future: Pattern[] };
export function App() {
  const [history, setHistory] = useState<History>(() => ({
    present: createPattern(),
    past: [],
    future: [],
  }));
  const historyRef = useRef(history);
  const gesture = useRef<{ before: History; selected: number | null; cancel: () => void } | null>(
    null,
  );
  const [hasPendingEdit, setHasPendingEdit] = useState(false);
  const pattern = history.present;
  const score = useMemo(() => compose(pattern), [pattern]);
  const scoreRef = useRef(score);
  const sequencerRef = useRef<Sequencer | null>(null);
  const getPlayback = useCallback(() => sequencerRef.current?.getPlayback() ?? EMPTY_PLAYBACK, []);
  const [selectedId, setSelected] = useState<number | null>(null);
  const selected = pattern.notes.find((note) => note.id === selectedId);
  const nextNote = useRef(Math.max(...pattern.notes.map((note) => note.id), 0) + 1);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [help, setHelp] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuAnchor = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<CollisionFeedback | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const sequencer = new Sequencer(() => scoreRef.current);
    sequencerRef.current = sequencer;
    return () => {
      sequencer.dispose();
      sequencerRef.current = null;
    };
  }, []);

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!menu) return;

    function outside(event: globalThis.PointerEvent) {
      if (!menuAnchor.current?.contains(event.target as Node)) setMenu(false);
    }

    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [menu]);

  function apply(next: History) {
    historyRef.current = next;
    setHistory(next);
  }

  function cancelGesture() {
    const active = gesture.current;
    if (!active) return false;
    gesture.current = null;
    setHasPendingEdit(false);
    apply(active.before);
    setSelected(active.selected);
    setFeedback(null);
    setMessage("Gesture canceled.");
    active.cancel();
    return true;
  }

  function beginGesture(cancel: () => void) {
    cancelGesture();
    const active = { before: historyRef.current, selected: selectedId, cancel };
    gesture.current = active;
    return {
      activate: () => {
        if (gesture.current === active) setHasPendingEdit(true);
      },
      place: (note: Note) => (gesture.current === active ? place(note, true) : null),
      commit: () => {
        if (gesture.current !== active) return;
        gesture.current = null;
        setHasPendingEdit(false);
        const present = historyRef.current.present;
        if (present !== active.before.present) {
          apply({
            present,
            past: [...active.before.past, active.before.present].slice(-60),
            future: [],
          });
        }
      },
      cancel: () => {
        if (gesture.current === active) cancelGesture();
      },
    };
  }

  function edit(change: (document: Pattern) => Pattern) {
    cancelGesture();
    const previous = historyRef.current;
    const next = change(previous.present);
    if (next === previous.present) return next;
    apply({
      present: next,
      past: [...previous.past, previous.present].slice(-60),
      future: [],
    });
    return next;
  }

  function place(candidate: Note, preview = false): Placement {
    if (!preview) cancelGesture();
    const current = historyRef.current.present;
    const result = placeNote(current, candidate);
    if (result.accepted) {
      if (preview) apply({ ...historyRef.current, present: result.document });
      else edit(() => result.document);
      setFeedback(null);
      setSelected(result.note.id);
      if (result.document !== current) setMessage("A note, settled into the phrase.");
    } else {
      setFeedback({ collisions: result.collisions, started: performance.now() });
      setMessage(
        toneFor(candidate).instrument === "bass"
          ? "That bass beat is occupied. Try another landing."
          : "That sound is already here. Try another pitch or beat.",
      );
      if (!current.notes.some(({ id }) => id === candidate.id))
        setSelected(result.collisions[0].noteId);
    }
    return result;
  }

  function undo() {
    if (cancelGesture()) return;
    const current = historyRef.current;
    if (!current.past.length) return;
    apply({
      present: current.past[current.past.length - 1],
      past: current.past.slice(0, -1),
      future: [current.present, ...current.future],
    });
    setFeedback(null);
    setMessage("One gesture back.");
  }

  function redo() {
    cancelGesture();
    const current = historyRef.current;
    if (!current.future.length) return;
    apply({
      present: current.future[0],
      past: [...current.past, current.present],
      future: current.future.slice(1),
    });
    setFeedback(null);
    setMessage("One gesture forward.");
  }

  async function togglePlayback() {
    const sequencer = sequencerRef.current;
    if (!sequencer || busy) return;
    setBusy(true);
    setError("");
    try {
      if (playing) await sequencer.pause();
      else await sequencer.play();
      if (sequencerRef.current !== sequencer) return;
      setPlaying(!playing);
    } catch {
      if (sequencerRef.current !== sequencer) return;
      setError(
        playing
          ? "Audio couldn’t pause. Please try Pause again."
          : "Audio couldn’t start. Please try Play again.",
      );
    } finally {
      if (sequencerRef.current === sequencer) setBusy(false);
    }
  }

  const onShortcut = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (help) return;
    if (event.key === "Escape") {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.repeat
      )
        return;
      if (menu) {
        event.preventDefault();
        setMenu(false);
        menuTrigger.current?.focus();
      } else if (cancelGesture()) {
        event.preventDefault();
      } else if (selected) {
        event.preventDefault();
        setSelected(null);
      }
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (
      event.key !== " " ||
      event.defaultPrevented ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(
        "input, textarea, select, a[href], summary, [contenteditable]:not([contenteditable='false']), button:not([data-light]), [role='button']",
      )
    )
      return;
    event.preventDefault();
    if (!event.repeat) void togglePlayback();
  });

  useEffect(() => {
    const keyDown = (event: globalThis.KeyboardEvent) => onShortcut(event);
    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, []);

  return (
    <main className="instrument" aria-label="Vamp musical instrument">
      <header className="masthead">
        <h1 className="wordmark" aria-label="Vamp">
          vamp<span aria-hidden="true">·</span>
        </h1>
        <nav className="header-tools" aria-label="Sketch controls">
          <button
            className="icon-button"
            title="Undo · ⌘/Ctrl Z"
            aria-label="Undo"
            disabled={!hasPendingEdit && !history.past.length}
            onClick={undo}
          >
            <Icon name="undo" />
          </button>
          <button
            className="icon-button"
            title="Redo · ⌘/Ctrl Shift Z"
            aria-label="Redo"
            disabled={!history.future.length}
            onClick={redo}
          >
            <Icon name="redo" />
          </button>
          <div
            className="menu-anchor"
            ref={menuAnchor}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setMenu(false);
            }}
          >
            <button
              ref={menuTrigger}
              className="icon-button"
              aria-label="Sketch options"
              aria-expanded={menu}
              aria-controls="sketch-menu"
              onClick={() => setMenu(!menu)}
            >
              <Icon name="more" />
            </button>
            {menu && (
              <div className="popover sketch-menu" id="sketch-menu">
                <p className="menu-caption">{pattern.notes.length} lights in this loop</p>
                <button
                  disabled={!pattern.notes.length}
                  onClick={() => {
                    edit((previous) => ({ ...previous, notes: [] }));
                    setSelected(null);
                    setFeedback(null);
                    setMessage("An empty space. Tap anywhere to begin.");
                    setMenu(false);
                    menuTrigger.current?.focus();
                  }}
                >
                  Start with an empty space
                </button>
                <button
                  onClick={() => {
                    edit(() => createPattern());
                    setSelected(null);
                    setFeedback(null);
                    setMessage("Back to the starting phrase.");
                    setMenu(false);
                    menuTrigger.current?.focus();
                  }}
                >
                  Restore the starting phrase
                </button>
                <p className="menu-footnote">Both can be undone. Nothing is saved.</p>
              </div>
            )}
          </div>
          <button
            className="help-button"
            aria-haspopup="dialog"
            onClick={() => {
              setMenu(false);
              setHelp(true);
            }}
          >
            How to play
          </button>
        </nav>
      </header>

      <section className="surface" aria-label="Your musical sketch">
        <PointSpace
          document={pattern}
          selected={selected?.id ?? null}
          playing={playing}
          feedback={feedback}
          onSelect={setSelected}
          onPlace={place}
          onEdit={edit}
          onBegin={beginGesture}
          nextId={() => nextNote.current++}
          getPlayback={getPlayback}
          renderSelection={(note, focusSurface) => (
            <>
              <span className="selected-pitch" style={{ color: toneFor(note).color }}>
                {toneFor(note).note.name}
              </span>
              <span className="selected-material">
                {INSTRUMENTS[toneFor(note).instrument].name}
              </span>
              <button
                className="icon-button"
                title="Remove · Delete"
                aria-label="Remove selected note"
                onClick={() => {
                  edit((previous) => ({
                    ...previous,
                    notes: previous.notes.filter(({ id }) => id !== note.id),
                  }));
                  setSelected(null);
                  setMessage("Note removed.");
                  focusSurface();
                }}
              >
                <Icon name="clear" />
              </button>
            </>
          )}
        />
        {!pattern.notes.length && (
          <div className="empty-invitation" aria-hidden="true">
            <span className="empty-light" />
            <p>Leave the first light.</p>
          </div>
        )}
      </section>

      <footer className="listening-dock">
        <div className="transport">
          <button
            className="play-button"
            disabled={busy}
            aria-label={playing ? "Pause loop" : "Play loop"}
            aria-busy={busy}
            aria-keyshortcuts="Space"
            aria-pressed={playing}
            onClick={() => void togglePlayback()}
          >
            <Icon name={playing ? "pause" : "play"} />
          </button>
        </div>
        <button
          className="sound-control"
          aria-label={muted ? "Unmute audio" : "Mute audio"}
          aria-pressed={muted}
          onClick={() => {
            sequencerRef.current?.setVolume(muted ? DEFAULT_VOLUME : 0);
            setMuted(!muted);
          }}
        >
          <Icon name={muted ? "mute" : "sound"} />
          <span>{muted ? "Sound off" : "Sound on"}</span>
        </button>
        <p className={`gesture-hint${error || message ? " is-feedback" : ""}`} role="status">
          {error || message || "Tap to add. Drag to move."}
        </p>
      </footer>
      <p className="sr-only" aria-live="polite">
        {selected ? noteLabel(selected) : "No note selected."}
      </p>

      <HelpDialog open={help} onClose={() => setHelp(false)} />
    </main>
  );
}
