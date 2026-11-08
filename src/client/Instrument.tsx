import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { HelpDialog } from "./HelpDialog";
import { Icon } from "./Icon";
import { PointSpace } from "./PointSpace";
import { compose, placeNote, noteLabel, toneFor } from "./pattern";
import type { EditingSession, PatternEdit } from "./editing";
import type { CollisionFeedback, Pattern, Placement, Note } from "./pattern";
import { Sequencer } from "./sequencer";
import { DEFAULT_VOLUME, EMPTY_PLAYBACK, INSTRUMENTS } from "./score";

export function Instrument({ session }: { session: EditingSession }) {
  const [preview, setPreview] = useState<Pattern | null>(null);
  const gesture = useRef<{
    document: Pattern;
    notes: Note[];
    selected: number | null;
    cancel: () => void;
  } | null>(null);
  const [hasPendingEdit, setHasPendingEdit] = useState(false);
  const pattern = preview ?? session.pattern;
  const score = useMemo(() => compose(pattern), [pattern]);
  const scoreRef = useRef(score);
  const sequencerRef = useRef<Sequencer | null>(null);
  const getPlayback = useCallback(() => sequencerRef.current?.getPlayback() ?? EMPTY_PLAYBACK, []);
  const [selectedId, setSelected] = useState<number | null>(null);
  const selected = pattern.notes.find((note) => note.id === selectedId);
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

  function cancelGesture() {
    const active = gesture.current;
    if (!active) return false;
    gesture.current = null;
    setHasPendingEdit(false);
    setPreview(null);
    setSelected(active.selected);
    setFeedback(null);
    setMessage("Gesture canceled.");
    active.cancel();
    return true;
  }

  function beginGesture(cancel: () => void) {
    cancelGesture();
    const active = { document: session.pattern, notes: [] as Note[], selected: selectedId, cancel };
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
        setPreview(null);
        if (active.notes.length) session.edit({ type: "place", notes: active.notes });
      },
      cancel: () => {
        if (gesture.current === active) cancelGesture();
      },
    };
  }

  function edit(action: PatternEdit) {
    cancelGesture();
    session.edit(action);
  }

  function place(candidate: Note, preview = false): Placement {
    if (!preview) cancelGesture();
    const active = preview ? gesture.current : null;
    const current = active?.document ?? session.pattern;
    const result = placeNote(current, candidate);
    if (result.accepted) {
      if (active) {
        if (result.document !== current) active.notes.push(result.note);
        active.document = result.document;
        setPreview(result.document);
      } else {
        session.edit({ type: "place", notes: [result.note] });
      }
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
    if (!session.undo()) return;
    setFeedback(null);
    setMessage("One gesture back.");
  }

  function redo() {
    cancelGesture();
    if (!session.redo()) return;
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
            disabled={!hasPendingEdit && !session.canUndo}
            onClick={undo}
          >
            <Icon name="undo" />
          </button>
          <button
            className="icon-button"
            title="Redo · ⌘/Ctrl Shift Z"
            aria-label="Redo"
            disabled={!session.canRedo}
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
                    edit({ type: "clear" });
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
                    edit({ type: "restore" });
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
          onRemove={(id) => edit({ type: "remove", id })}
          onBegin={beginGesture}
          nextId={session.nextId}
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
                  edit({ type: "remove", id: note.id });
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
