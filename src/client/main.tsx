import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PointSpace } from "./PointSpace";
import {
  compose,
  createConstellation,
  placeSource,
  sourceLabel,
  toneFor,
  wrapStep,
} from "./playground";
import type { CollisionFeedback, Constellation, Placement, Source } from "./playground";
import { Sequencer } from "./sequencer";
import "./style.css";

type History = { present: Constellation; past: Constellation[]; future: Constellation[] };
type IconName =
  | "play"
  | "pause"
  | "undo"
  | "redo"
  | "clear"
  | "seed"
  | "help"
  | "sound"
  | "mute"
  | "duplicate"
  | "voice";
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
        <>
          <path d="M4 7h16M9 3h6M6 7l1 14h10l1-14M10 11v6m4-6v6" />
        </>
      ) : name === "seed" ? (
        <>
          <path d="M4 10a8 8 0 1 1 0 5m0-11v6h6" />
          <circle cx="12" cy="12" r="1.5" />
        </>
      ) : name === "help" ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M9 8a3 3 0 0 1 6 1c0 2-3 2-3 4m0 4h.01" />
        </>
      ) : name === "duplicate" ? (
        <>
          <rect x="8" y="8" width="12" height="12" rx="3" />
          <path d="M15 8V4H4v11h4" />
        </>
      ) : name === "voice" ? (
        <>
          <path d="M3 12c3-14 5 14 9 0s6 14 9 0" />
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

function App() {
  const [history, setHistory] = useState<History>(() => ({
    present: createConstellation(),
    past: [],
    future: [],
  }));
  const historyRef = useRef(history);
  const document = history.present;
  const score = useMemo(() => compose(document), [document]);
  const scoreRef = useRef(score);
  const engine = useRef<Sequencer | null>(null);
  const [selectedId, setSelected] = useState<number | null>(null);
  const selected = document.sources.find((source) => source.id === selectedId);
  const nextSource = useRef(Math.max(...document.sources.map((source) => source.id), 0) + 1);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [help, setHelp] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<CollisionFeedback | null>(null);
  const [message, setMessage] = useState("A few notes to start. Make the next one yours.");

  useEffect(() => {
    const sequencer = new Sequencer(
      () => scoreRef.current,
      () => {},
    );
    engine.current = sequencer;
    return () => {
      sequencer.dispose();
      engine.current = null;
    };
  }, []);
  useEffect(() => {
    scoreRef.current = score;
    engine.current?.setEnabled("keys", document.voice === "keys");
    engine.current?.setEnabled("nylon", document.voice === "nylon");
  }, [score, document.voice]);

  function apply(next: History) {
    historyRef.current = next;
    setHistory(next);
  }
  function edit(change: (document: Constellation) => Constellation, remember = true) {
    const previous = historyRef.current;
    const next = change(previous.present);
    if (next === previous.present) return next;
    apply({
      present: next,
      past: remember ? [...previous.past, previous.present].slice(-60) : previous.past,
      future: [],
    });
    return next;
  }
  function place(candidate: Source, remember = true): Placement {
    const current = historyRef.current.present;
    const result = placeSource(current, candidate);
    if (result.accepted) {
      edit(() => result.document, remember);
      setFeedback(null);
      setSelected(result.source.id);
      if (result.document !== current) setMessage("A note, settled into the phrase.");
    } else {
      setFeedback({ collisions: result.collisions, started: performance.now() });
      setMessage(
        toneFor(candidate).instrument === "bass"
          ? "That bass beat is occupied. Try another landing."
          : "That sound is already here. Try another pitch or beat.",
      );
      if (!current.sources.some(({ id }) => id === candidate.id))
        setSelected(result.collisions[0].sourceId);
    }
    return result;
  }
  function commitGesture(before: Constellation) {
    const current = historyRef.current;
    if (before === current.present) return;
    apply({ ...current, past: [...current.past, before].slice(-60), future: [] });
  }
  function undo() {
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
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    }
    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, []);

  async function togglePlayback() {
    if (!engine.current || busy) return;
    setBusy(true);
    setError("");
    try {
      if (playing) await engine.current.pause();
      else await engine.current.play();
      setPlaying(!playing);
    } catch {
      setError("Audio couldn’t start. Please try Play again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app">
      <header className="masthead">
        <a className="wordmark" href="/" aria-label="Vamp home">
          vamp<span>·</span>
        </a>
        <span className="edition">
          Open-ended instruments <i>/</i> study 04
        </span>
        <div className="header-tools">
          <button
            className="icon-button"
            title="Undo · ⌘/Ctrl Z"
            aria-label="Undo"
            disabled={!history.past.length}
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
          <span className="tool-divider" />
          <button
            className="icon-button"
            title="Start with an empty space · undoable"
            aria-label="Clear space"
            disabled={!document.sources.length}
            onClick={() => {
              edit((previous) => ({ ...previous, sources: [] }));
              setSelected(null);
              setFeedback(null);
              setMessage("An empty space. Tap anywhere to begin.");
            }}
          >
            <Icon name="clear" />
          </button>
          <button
            className="icon-button"
            title="Return to the starting constellation · undoable"
            aria-label="Reset constellation"
            onClick={() => {
              edit(() => createConstellation());
              setSelected(null);
              setFeedback(null);
              setMessage("Back to the first constellation.");
            }}
          >
            <Icon name="seed" />
          </button>
          <button
            className={`icon-button${help ? " active" : ""}`}
            title="Discover the rules"
            aria-label="Discover the rules"
            aria-expanded={help}
            aria-controls="discovery"
            onClick={() => setHelp(!help)}
          >
            <Icon name="help" />
          </button>
        </div>
      </header>

      <section className="instrument-space" aria-label="Abstract musical instrument">
        <div className="space-intro">
          <p className="eyebrow">01 / A constellation of small decisions</p>
          <h1>What happens if you leave a little light?</h1>
          <p>Place one. Move it. Leave another.</p>
        </div>
        <div className="surface-container">
          <PointSpace
            document={document}
            score={score}
            selected={selected?.id ?? null}
            playing={playing}
            feedback={feedback}
            onSelect={setSelected}
            onPlace={place}
            onEdit={edit}
            onCommit={commitGesture}
            nextId={() => nextSource.current++}
            getProgress={() => engine.current?.getPosition() ?? null}
            onPlayback={() => void togglePlayback()}
          />
          <div className="surface-caption">
            <span className="live-dot" />
            {playing ? "A shared loop, unfolding." : "The space is listening."}
          </div>
          <div className="gesture-hint">
            {selected ? "Drag end to change length" : "Tap to add · Drag to move"}
          </div>
          {document.sources.length === 0 && (
            <div className="empty-invitation" aria-hidden="true">
              <span>＋</span>A first note is all it takes.
            </div>
          )}
        </div>
        {help && (
          <aside className="discovery" id="discovery">
            <button
              className="close-discovery"
              aria-label="Close discovery guide"
              onClick={() => setHelp(false)}
            >
              ×
            </button>
            <p className="eyebrow">A few things to discover</p>
            <h2>It isn’t random.</h2>
            <p>Every light leaves a sound in the loop. Nothing changes on its own.</p>
            <dl>
              <div>
                <dt>Place & move</dt>
                <dd>
                  Left to right is when. Bottom to top is low to high. Press to place a light or
                  drag one to move it. Temporary guides and a landing point appear only while
                  positioning it. Release to settle onto the beat and pitch. The color follows the
                  sound.
                </dd>
              </div>
              <div>
                <dt>Let it ring</dt>
                <dd>
                  A light starts the note; its tail is how long it may ring. Select a light and drag
                  the small diamond at its end to change length. Brackets also shorten or lengthen
                  the selection. Tails continue across the loop edge. Bass ends at the next bass
                  note. Sounds decay naturally; a longer tail does not hold them at full volume.
                </dd>
              </div>
              <div>
                <dt>Every note has a voice</dt>
                <dd>
                  Felt and nylon can form chords. Bass has one note per beat: an occupied landing
                  flashes, and an invalid drag returns home. Identical sounds also flash instead of
                  creating a silent duplicate.
                </dd>
              </div>
              <div>
                <dt>Make a mark</dt>
                <dd>
                  Shift-drag through empty space to leave a trail of notes. There’s no fixed number
                  you have to work with.
                </dd>
              </div>
              <div>
                <dt>Take something away</dt>
                <dd>
                  Select a note and use the bin below, or right-click it. Undo brings it back.
                </dd>
              </div>
            </dl>
            <p className="discovery-foot">
              All notes share a scale. No note is silently ignored. Tab into the space for keyboard
              controls.
            </p>
          </aside>
        )}
      </section>

      <footer className="instrument-footer">
        <div className="selection-tools">
          {selected ? (
            <>
              <span className="selection-dot" />
              <span className="selection-name">{toneFor(selected).note.name}</span>
              <button
                className="icon-button"
                title="Duplicate note"
                aria-label="Duplicate selected note"
                onClick={() => {
                  const copy = {
                    ...selected,
                    id: nextSource.current++,
                    step: wrapStep(selected.step + 4),
                  };
                  place(copy);
                }}
              >
                <Icon name="duplicate" />
              </button>
              <button
                className="icon-button"
                title="Remove note · Delete key"
                aria-label="Remove selected note"
                onClick={() => {
                  edit((previous) => ({
                    ...previous,
                    sources: previous.sources.filter((source) => source.id !== selected.id),
                  }));
                  setSelected(null);
                }}
              >
                <Icon name="clear" />
              </button>
            </>
          ) : (
            <span className="selection-prompt">A light is something you can touch.</span>
          )}
        </div>
        <div className="playback-controls">
          <button className="play-button" disabled={busy} onClick={() => void togglePlayback()}>
            <Icon name={playing ? "pause" : "play"} />
            <span>{busy ? "One moment" : playing ? "Pause" : "Play & discover"}</span>
            <span className={`play-indicator${playing ? " playing" : ""}`} />
          </button>
        </div>
        <div className="listening-tools">
          <span className="source-count">
            {document.sources.length} {document.sources.length === 1 ? "note" : "notes"} <i>·</i>{" "}
            one loop
          </span>
          <span className="tool-divider" />
          <button
            className={`icon-button voice-button${document.voice === "nylon" ? " active" : ""}`}
            title={`Melody material: ${document.voice === "keys" ? "felt" : "nylon"}. Click to switch.`}
            aria-label="Use nylon melody instead of felt"
            aria-pressed={document.voice === "nylon"}
            onClick={() => {
              edit((previous) => ({
                ...previous,
                voice: previous.voice === "keys" ? "nylon" : "keys",
              }));
              setMessage("The same notes, with a different melodic texture.");
            }}
          >
            <Icon name="voice" />
          </button>
          <button
            className="icon-button"
            title={muted ? "Unmute" : "Mute"}
            aria-label="Mute audio"
            aria-pressed={muted}
            onClick={() => {
              engine.current?.setVolume(muted ? 0.35 : 0);
              setMuted(!muted);
            }}
          >
            <Icon name={muted ? "mute" : "sound"} />
          </button>
        </div>
      </footer>
      <div className="bottom-note">
        <span role="status">{error || message}</span>
        <span>Just this visit. Nothing is saved.</span>
      </div>
      <p className="sr-only" aria-live="polite">
        {selected ? sourceLabel(selected, document.voice) : "No note selected."}
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
