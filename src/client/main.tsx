import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PatternGrid } from "./PatternGrid";
import {
  createSeedPatterns,
  DEFAULT_VOLUME,
  DEFAULT_ENABLED,
  INSTRUMENTS,
  TEMPO,
  togglePatternCell,
} from "./score";
import type { InstrumentId } from "./score";
import { Sequencer } from "./sequencer";
import "./style.css";

function App() {
  const [patterns, setPatterns] = useState(createSeedPatterns);
  const patternsRef = useRef(patterns);
  const audio = useRef<Sequencer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [enabled, setEnabled] = useState(DEFAULT_ENABLED);
  const [currentStep, setCurrentStep] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const sequencer = new Sequencer(() => patternsRef.current, setCurrentStep);
    audio.current = sequencer;
    return () => {
      sequencer.dispose();
      audio.current = null;
    };
  }, []);

  async function togglePlayback() {
    if (!audio.current || busy) return;
    setBusy(true);
    setError("");
    try {
      if (playing) await audio.current.pause();
      else await audio.current.play();
      setPlaying(!playing);
    } catch {
      setError("Audio couldn’t start. Please try Play again in a browser with Web Audio support.");
    } finally {
      setBusy(false);
    }
  }

  function toggleCell(instrument: InstrumentId, row: number, step: number) {
    const next = togglePatternCell(patternsRef.current, instrument, row, step);
    patternsRef.current = next;
    setPatterns(next);
  }

  function applyEnabled(next: Record<InstrumentId, boolean>) {
    setEnabled(next);
    for (const { id } of INSTRUMENTS) audio.current?.setEnabled(id, next[id]);
  }

  function toggleSound(instrument: InstrumentId) {
    applyEnabled({ ...enabled, [instrument]: !enabled[instrument] });
  }

  function audition(instrument: InstrumentId | "ensemble") {
    const next = { ...DEFAULT_ENABLED };
    if (instrument !== "ensemble") {
      for (const { id } of INSTRUMENTS) next[id] = id === instrument;
    }
    applyEnabled(next);
    if (!playing && !busy) void togglePlayback();
  }

  return (
    <main>
      <header className="masthead">
        <a className="wordmark" href="/" aria-label="Vamp home">
          vamp<span>·</span>
        </a>
        <span className="edition">
          <span className="status-dot" /> Local prototype
        </span>
      </header>

      <section className="intro" aria-labelledby="title">
        <p className="eyebrow">A small musical experiment</p>
        <h1 id="title">
          Make a little space
          <br />
          for a melody.
        </h1>
        <p className="description">
          Four different roles, one small ensemble.
          <br />
          Listen alone, then bring them together.
        </p>
      </section>

      <section className="instrument" aria-label="Sequencer">
        <div className="transport">
          <button className="play-button" onClick={togglePlayback} disabled={busy}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              {playing ? <path d="M5 4h3v12H5zm7 0h3v12h-3z" /> : <path d="M6 3.5 16 10 6 16.5z" />}
            </svg>
            {playing ? "Pause" : "Play"}
          </button>
          <div className="tempo">
            <strong>{TEMPO}</strong> BPM<span>4/4 · two measures</span>
          </div>
          <button className="ensemble-button" onClick={() => audition("ensemble")}>
            Ensemble
          </button>
          <div className="level-control master-volume">
            <label htmlFor="volume">Volume</label>
            <input
              id="volume"
              type="range"
              min="0"
              max="100"
              value={Math.round(volume * 100)}
              onChange={(event) => {
                const value = Number(event.target.value) / 100;
                setVolume(value);
                audio.current?.setVolume(value);
              }}
            />
            <output htmlFor="volume">{Math.round(volume * 100)}%</output>
          </div>
        </div>

        {INSTRUMENTS.map((instrument) => (
          <PatternGrid
            key={instrument.id}
            id={instrument.id}
            name={instrument.name}
            description={instrument.description}
            notes={instrument.notes}
            monophonic={instrument.mode === "mono"}
            pattern={patterns[instrument.id]}
            currentStep={currentStep}
            enabled={enabled[instrument.id]}
            onToggleSound={() => toggleSound(instrument.id)}
            onListenAlone={() => audition(instrument.id)}
            onToggleCell={(row, step) => toggleCell(instrument.id, row, step)}
          />
        ))}

        <div className="instrument-footer">
          <p id="grid-help">
            Click a cell to add or remove a note.<span> Arrow keys to move, space to toggle.</span>
          </p>
          <span className="sound-label">
            <span className="sound-dot" /> One shared loop
          </span>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>

      <footer className="page-footer">
        <span>A loop to get lost in.</span>
        <span>Just this browser. Nothing is saved.</span>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
