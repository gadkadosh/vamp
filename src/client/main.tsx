import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PointSpace } from "./PointSpace";
import {
  compose,
  createConstellation,
  MATERIALS,
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

function App() {
  const [history, setHistory] = useState<History>(() => ({
    present: createConstellation(),
    past: [],
    future: [],
  }));
  const historyRef = useRef(history);
  const constellation = history.present;
  const score = useMemo(() => compose(constellation), [constellation]);
  const scoreRef = useRef(score);
  const engine = useRef<Sequencer | null>(null);
  const [selectedId, setSelected] = useState<number | null>(null);
  const selected = constellation.sources.find((source) => source.id === selectedId);
  const nextSource = useRef(Math.max(...constellation.sources.map((source) => source.id), 0) + 1);
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
                <p className="menu-caption">{constellation.sources.length} lights in this loop</p>
                <button
                  disabled={!constellation.sources.length}
                  onClick={() => {
                    edit((previous) => ({ ...previous, sources: [] }));
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
                    edit(() => createConstellation());
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
          document={constellation}
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
          renderSelection={(source, focusSurface) => (
            <>
              <span
                className="selected-swatch"
                style={{ background: toneFor(source).color, color: toneFor(source).color }}
                aria-hidden="true"
              />
              <span className="selected-pitch">{toneFor(source).note.name}</span>
              <span className="selected-material">
                {
                  MATERIALS.find(({ instrument }) => instrument === toneFor(source).instrument)
                    ?.name
                }
              </span>
              <button
                className="icon-button"
                title="Duplicate, one beat later"
                aria-label="Duplicate selected note"
                onClick={() => {
                  place({ ...source, id: nextSource.current++, step: wrapStep(source.step + 4) });
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
                    sources: previous.sources.filter(({ id }) => id !== source.id),
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
        {!constellation.sources.length && (
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
            engine.current?.setVolume(muted ? 0.35 : 0);
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
        {selected ? sourceLabel(selected) : "No note selected."}
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
              <stop stopColor={MATERIALS[2].color} stopOpacity=".3" />
              <stop offset="1" stopColor={MATERIALS[2].color} stopOpacity="0" />
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
          {MATERIALS.map((material, index) => (
            <circle
              key={material.instrument}
              cx={[86, 126, 160, 226][index]}
              cy={[77, 64, 53, 35][index]}
              r={index === 2 ? 5 : 4}
              fill={material.color}
            />
          ))}
        </svg>
        <dl>
          <div>
            <dt>Make a mark</dt>
            <dd>
              Tap the space to add a light. Drag one to change when it plays and how high it sounds.
              Release and it finds its place. Shift-drag to scatter a trail.
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
          Tab into the space for keyboard controls.
        </p>
        <button className="guide-done" onClick={() => setHelp(false)}>
          Let’s play
        </button>
      </dialog>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
