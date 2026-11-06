import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PointSpace } from "./PointSpace";
import {
  compose,
  createPattern,
  INSTRUMENT_LAYOUT,
  placeNote,
  noteLabel,
  toneFor,
  wrapStep,
} from "./pattern";
import type { CollisionFeedback, Pattern, Placement, Note } from "./pattern";
import { Sequencer } from "./sequencer";
import { DEFAULT_VOLUME, EMPTY_PLAYBACK, INSTRUMENTS } from "./score";

type History = { present: Pattern; past: Pattern[]; future: Pattern[] };
type IconName =
  | "play"
  | "pause"
  | "undo"
  | "redo"
  | "clear"
  | "more"
  | "close"
  | "sound"
  | "mute"
  | "duplicate";

function Icon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "play" ? (
        <path d="m9 5 10 7-10 7Z" fill="currentColor" stroke="none" />
      ) : name === "pause" ? (
        <path d="M9 6v12M16 6v12" strokeWidth="3" />
      ) : name === "undo" ? (
        <path d="m8 5-5 5 5 5M3 10h10a6 6 0 0 1 0 12" />
      ) : name === "redo" ? (
        <path d="m16 5 5 5-5 5m5-5H11a6 6 0 0 0 0 12" />
      ) : name === "clear" ? (
        <path d="M4 7h16M9 3h6M6 7l1 14h10l1-14M10 11v6m4-6v6" />
      ) : name === "more" ? (
        <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" />
      ) : name === "close" ? (
        <path d="m6 6 12 12M18 6 6 18" />
      ) : name === "duplicate" ? (
        <>
          <rect x="8" y="8" width="12" height="12" rx="3" />
          <path d="M15 8V4H4v11h4" />
        </>
      ) : (
        <>
          <path d="m10 5-5 4H2v6h3l5 4Z" />
          {name === "sound" ? (
            <path d="M14 8a6 6 0 0 1 0 8m4-12a11 11 0 0 1 0 16" />
          ) : (
            <path d="m15 9 6 6m0-6-6 6" />
          )}
        </>
      )}
    </svg>
  );
}

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
  const [gesturing, setGesturing] = useState(false);
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
  const guide = useRef<HTMLDialogElement>(null);
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
    if (help) guide.current?.showModal();
    else guide.current?.close();
  }, [help]);

  useEffect(() => {
    if (!menu) return;

    function outside(event: globalThis.PointerEvent) {
      if (!menuAnchor.current?.contains(event.target as Node)) setMenu(false);
    }

    function keyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setMenu(false);
        menuTrigger.current?.focus();
      }
    }

    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyDown);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keyDown);
    };
  }, [menu]);

  function apply(next: History) {
    historyRef.current = next;
    setHistory(next);
  }

  function cancelGesture() {
    const active = gesture.current;
    if (!active) return false;
    gesture.current = null;
    setGesturing(false);
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
    setGesturing(true);
    return {
      place: (note: Note) => (gesture.current === active ? place(note, true) : null),
      commit: () => {
        if (gesture.current !== active) return;
        gesture.current = null;
        setGesturing(false);
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

  useEffect(() => {
    function keyDown(event: globalThis.KeyboardEvent) {
      if (
        guide.current?.open ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "z"
      )
        return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    }

    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, []);

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

  useEffect(() => {
    function keyDown(event: globalThis.KeyboardEvent) {
      if (
        event.key !== " " ||
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        guide.current?.open
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
    }

    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  });

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
            disabled={!gesturing && !history.past.length}
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
              <span
                className="selected-swatch"
                style={{ background: toneFor(note).color, color: toneFor(note).color }}
                aria-hidden="true"
              />
              <span className="selected-pitch">{toneFor(note).note.name}</span>
              <span className="selected-material">
                {INSTRUMENTS[toneFor(note).instrument].name}
              </span>
              <button
                className="icon-button"
                title="Duplicate, one beat later"
                aria-label="Duplicate selected note"
                onClick={() => {
                  place({ ...note, id: nextNote.current++, step: wrapStep(note.step + 4) });
                }}
              >
                <Icon name="duplicate" />
              </button>
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

      <dialog
        ref={guide}
        className="discovery"
        aria-labelledby="guide-title"
        onClose={() => setHelp(false)}
      >
        <button
          className="icon-button close-guide"
          aria-label="Close guide"
          onClick={() => setHelp(false)}
        >
          <Icon name="close" />
        </button>
        <h2 id="guide-title">Leave a little light.</h2>
        <p className="guide-intro">
          Every light is a sound.
          <br />
          Every loop is another chance to listen.
        </p>
        <svg
          className="guide-diagram"
          viewBox="0 0 330 125"
          aria-label="Time runs left to right, pitch rises upwards"
          role="img"
        >
          <defs>
            <radialGradient id="guide-glow">
              <stop stopColor={INSTRUMENT_LAYOUT[2].color} stopOpacity=".3" />
              <stop offset="1" stopColor={INSTRUMENT_LAYOUT[2].color} stopOpacity="0" />
            </radialGradient>
          </defs>
          <path
            d="M28 95H307m-5-4 5 4-5 4M28 95V18m-4 5 4-5 4 5"
            stroke="#80938e"
            strokeWidth=".8"
            fill="none"
          />
          <text x="293" y="116">
            Later
          </text>
          <text x="41" y="25">
            Higher
          </text>
          <circle cx="160" cy="53" r="40" fill="url(#guide-glow)" />
          {INSTRUMENT_LAYOUT.map((entry, index) => (
            <circle
              key={entry.instrument}
              cx={[86, 126, 160, 226][index]}
              cy={[77, 64, 53, 35][index]}
              r={index === 2 ? 5 : 4}
              fill={entry.color}
            />
          ))}
        </svg>
        <dl>
          <div>
            <dt>Make a mark</dt>
            <dd>
              Tap the space to add a light. Drag one to change when it plays and how high it sounds.
              Release and it finds its place. Shift-drag to scatter a trail. Escape or Undo cancels
              an unfinished gesture.
            </dd>
          </div>
          <div>
            <dt>Let it ring</dt>
            <dd>
              Press Play. The lights bloom as their sounds unfold. Nothing changes unless you change
              it. Higher notes change from bass through mallet and felt keys to glass.
            </dd>
          </div>
          <div>
            <dt>Keep or take away</dt>
            <dd>
              Select a light to copy or remove it. Tap it again to deselect. Undo brings it back.
              Occupied bass beats and identical sounds flash instead of adding a duplicate.
            </dd>
          </div>
        </dl>
        <p className="guide-footnote">
          Just this tab. Nothing is saved.
          <br />
          Tab into the space. Page Up / Down select a light; arrows move it.
          <br />
          On Mac laptops, use Fn + ↑ / ↓ to select.
        </p>
        <button className="guide-done" onClick={() => setHelp(false)}>
          Let’s play
        </button>
      </dialog>
    </main>
  );
}
