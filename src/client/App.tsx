import { useEffect, useEffectEvent, useRef, useState } from "react";
import { HelpDialog } from "./HelpDialog";
import { Icon } from "./Icon";
import { PointSpace } from "./PointSpace";
import { noteLabel, toneFor } from "../shared/pattern";
import type { CollisionFeedback, Placement, Note, NoteId } from "../shared/pattern";
import { INSTRUMENTS } from "../shared/score";
import { usePlayback } from "./usePlayback";
import { useComposition } from "./useComposition";
import type { EditPlacement } from "./useComposition";

export function App() {
  const [message, setMessage] = useState("");
  const composition = useComposition(setMessage);
  const { solo, pattern, canEdit, cancelGesture } = composition;
  const {
    playing,
    busy,
    muted,
    error,
    getPlayback,
    togglePlayback,
    toggleMute,
    reset: resetPlayback,
  } = usePlayback(pattern, solo);
  const [selectedId, setSelected] = useState<NoteId | null>(null);
  const selected = pattern.notes.find((note) => note.id === selectedId);
  const [help, setHelp] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuAnchor = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const [feedback, setFeedback] = useState<CollisionFeedback | null>(null);

  function changeMode(nextSolo: boolean) {
    if (!composition.changeMode(nextSolo)) return;

    resetPlayback();
    setSelected(null);
    setFeedback(null);
    setMessage("");
    setMenu(false);
  }

  const onNavigation = useEffectEvent(() => changeMode(window.location.pathname === "/solo"));
  useEffect(() => {
    const navigate = () => onNavigation();
    window.addEventListener("popstate", navigate);
    return () => window.removeEventListener("popstate", navigate);
  }, []);

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

  function beginGesture(cancel: () => void) {
    const session = composition.beginGesture(() => {
      setSelected(selectedId);
      setFeedback(null);
      setMessage("Gesture canceled.");
      cancel();
    });
    return {
      ...session,
      place: (note: Note) => {
        const result = session.place(note);
        if (result) showPlacement(result);
        return result;
      },
    };
  }

  function removeNote(id: NoteId) {
    if (!canEdit) return;
    composition.remove(id);
    setSelected(null);
  }

  function move(id: NoteId, stepDelta: number, toneDelta: number) {
    const result = composition.move(id, stepDelta, toneDelta);
    if (result) showPlacement(result);
  }

  function place(candidate: Note): Placement {
    const result = composition.place(candidate);
    if (canEdit) showPlacement(result);
    return result;
  }

  function showPlacement(result: EditPlacement) {
    if (result.accepted) {
      setFeedback(null);
      setSelected(result.note.id);
      if (result.changed) setMessage("A note, settled into the phrase.");
    } else {
      setFeedback({ collisions: result.collisions, started: performance.now() });
      setMessage(
        toneFor(result.note).instrument === "bass"
          ? "That bass beat is occupied. Try another landing."
          : "That sound is already here. Try another pitch or beat.",
      );
      if (!result.document.notes.some(({ id }) => id === result.note.id))
        setSelected(result.collisions[0].noteId);
    }
  }

  function undo() {
    if (!composition.undo()) return;
    setFeedback(null);
    setMessage("One gesture back.");
  }

  function redo() {
    if (!composition.redo()) return;
    setFeedback(null);
    setMessage("One gesture forward.");
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
          {solo && (
            <>
              <button
                className="icon-button"
                title="Undo · ⌘/Ctrl Z"
                aria-label="Undo"
                disabled={!composition.canUndo}
                onClick={undo}
              >
                <Icon name="undo" />
              </button>
              <button
                className="icon-button"
                title="Redo · ⌘/Ctrl Shift Z"
                aria-label="Redo"
                disabled={!composition.canRedo}
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
                        composition.clear();
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
                        composition.restore();
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
            </>
          )}
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
          readOnly={!canEdit}
          selected={selected?.id ?? null}
          playing={playing}
          feedback={feedback}
          onSelect={setSelected}
          onPlace={place}
          onMove={move}
          onRemove={removeNote}
          onBegin={beginGesture}
          nextId={() => crypto.randomUUID()}
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
                disabled={!canEdit}
                onClick={() => {
                  removeNote(note.id);
                  setMessage("Note removed.");
                  focusSurface();
                }}
              >
                <Icon name="clear" />
              </button>
            </>
          )}
        />
        {!pattern.notes.length && canEdit && (
          <div className="empty-invitation" aria-hidden="true">
            <span className="empty-light" />
            <p>Leave the first light.</p>
          </div>
        )}
      </section>

      <footer className="listening-dock">
        <button
          className="mode-button"
          aria-label="Solo mode"
          aria-pressed={solo}
          onClick={() => {
            window.history.pushState(null, "", solo ? "/" : "/solo");
            changeMode(!solo);
          }}
        >
          Solo mode
        </button>
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
          onClick={toggleMute}
        >
          <Icon name={muted ? "mute" : "sound"} />
          <span>{muted ? "Sound off" : "Sound on"}</span>
        </button>
        <p className={`gesture-hint${error || message ? " is-feedback" : ""}`} role="status">
          {error || message || "Tap to add. Drag to move."}
        </p>
        <p className="mode-status" role="status">
          {solo
            ? "Only this tab. Not saved."
            : composition.status === "connecting"
              ? "Connecting…"
              : composition.status === "offline"
                ? "Reconnecting… Editing is paused."
                : composition.pending
                  ? "Saving…"
                  : "Everyone can edit. Changes are saved."}
        </p>
      </footer>
      <p className="sr-only" aria-live="polite">
        {selected ? noteLabel(selected) : "No note selected."}
      </p>

      <HelpDialog open={help} onClose={() => setHelp(false)} solo={solo} />
    </main>
  );
}
