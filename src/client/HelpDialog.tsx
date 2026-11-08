import { useEffect, useRef } from "react";
import { Icon } from "./Icon";
import { INSTRUMENT_LAYOUT } from "./pattern";

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  return (
    <dialog ref={dialog} className="discovery" aria-labelledby="guide-title" onClose={onClose}>
      <button className="icon-button close-guide" aria-label="Close guide" onClick={onClose}>
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
            Release and it finds its place. Shift-drag to scatter a trail. Escape or Undo cancels an
            unfinished gesture.
          </dd>
        </div>
        <div>
          <dt>Let it ring</dt>
          <dd>
            Press Play. The lights bloom as their sounds unfold. Nothing changes unless you change
            it. Higher notes change from bass through mallet and muted piano to glass.
          </dd>
        </div>
        <div>
          <dt>Keep or take away</dt>
          <dd>
            Select a light to remove it. Tap it again to deselect. Undo brings it back. Occupied
            bass beats and identical sounds flash instead of adding a duplicate.
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
      <button className="guide-done" onClick={onClose}>
        Let’s play
      </button>
    </dialog>
  );
}
