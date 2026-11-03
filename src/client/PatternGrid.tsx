import { useState } from "react";
import type { KeyboardEvent } from "react";
import type { InstrumentId, Note, Pattern } from "./score";

type Props = {
  id: InstrumentId;
  name: string;
  description: string;
  notes: readonly Note[];
  monophonic: boolean;
  pattern: Pattern;
  currentStep: number | null;
  enabled: boolean;
  onToggleSound: () => void;
  onListenAlone: () => void;
  onToggleCell: (row: number, step: number) => void;
};

export function PatternGrid({
  id,
  name,
  description,
  notes,
  monophonic,
  pattern,
  currentStep,
  enabled,
  onToggleSound,
  onListenAlone,
  onToggleCell,
}: Props) {
  const [focusedCell, setFocusedCell] = useState(0);
  const columns = pattern[0].length;
  const perMeasure = columns / 2;

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, row: number, step: number) {
    const moves: Record<string, [number, number]> = {
      ArrowUp: [Math.max(0, row - 1), step],
      ArrowDown: [Math.min(notes.length - 1, row + 1), step],
      ArrowLeft: [row, Math.max(0, step - 1)],
      ArrowRight: [row, Math.min(columns - 1, step + 1)],
    };
    const target = moves[event.key];
    if (!target) return;
    event.preventDefault();
    const cell = target[0] * columns + target[1];
    document.querySelector<HTMLButtonElement>(`[data-cell="${id}-${cell}"]`)?.focus();
  }

  return (
    <section
      className={`track track-${id}${monophonic ? " track-mono" : ""}`}
      aria-labelledby={`${id}-title`}
    >
      <header className="track-heading">
        <div>
          <h2 id={`${id}-title`}>{name}</h2>
          <p id={`${id}-help`}>
            {description}
            <span className="track-range">
              {" "}
              · {notes.at(-1)!.name}–{notes[0].name}
            </span>
          </p>
        </div>
        <div className="track-actions">
          <button
            className="track-listen"
            aria-label={`Listen to ${name} alone`}
            onClick={onListenAlone}
          >
            Listen alone
          </button>
          <button
            className="track-toggle"
            aria-label={`${name} sound`}
            aria-pressed={enabled}
            onClick={onToggleSound}
          >
            {enabled ? "Sound on" : "Muted"}
          </button>
        </div>
      </header>
      <p className="track-hint" id={`${id}-articulation`}>
        {monophonic
          ? "Choose one pitch per step. Join cells to let it ring and fade; gaps damp it."
          : "Each cell is a new strike. Stack pitches for chords."}
      </p>
      <div
        className="roll-scroll"
        role="group"
        aria-label={`${name} notes`}
        aria-describedby={`${id}-help ${id}-articulation grid-help`}
      >
        <table className="piano-roll">
          <caption className="sr-only">
            {name}: two measures of {perMeasure} steps each.
          </caption>
          <thead>
            <tr className="measure-labels">
              <td />
              <th colSpan={perMeasure} scope="colgroup">
                Measure 01
              </th>
              <th colSpan={perMeasure} scope="colgroup">
                Measure 02
              </th>
            </tr>
            <tr className="step-labels">
              <td />
              {Array.from({ length: columns }, (_, step) => (
                <th key={step} scope="col" className={currentStep === step ? "is-current" : ""}>
                  <span className={step % 4 === 0 ? "" : "sr-only"}>{(step % perMeasure) + 1}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {notes.map((note, row) => (
              <tr key={note.name}>
                <th scope="row">
                  {note.name.slice(0, -1)}
                  <span>{note.name.slice(-1)}</span>
                </th>
                {pattern[row].map((active, step, cells) => {
                  const cell = row * columns + step;
                  const before = monophonic && active && cells[step - 1];
                  const after = monophonic && active && cells[step + 1];
                  return (
                    <td
                      key={step}
                      className={`${step % 4 === 0 ? "beat-start" : ""} ${step === perMeasure ? "measure-start" : ""} ${before ? "tied-before" : ""} ${after ? "tied-after" : ""}`}
                    >
                      <button
                        className={`cell${currentStep === step ? " is-current" : ""}${before ? " joins-before" : ""}${after ? " joins-after" : ""}`}
                        aria-label={`${name}, ${note.name}, measure ${Math.floor(step / perMeasure) + 1}, step ${(step % perMeasure) + 1}`}
                        aria-pressed={active}
                        tabIndex={focusedCell === cell ? 0 : -1}
                        data-cell={`${id}-${cell}`}
                        onFocus={() => setFocusedCell(cell)}
                        onKeyDown={(event) => moveFocus(event, row, step)}
                        onClick={() => onToggleCell(row, step)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
