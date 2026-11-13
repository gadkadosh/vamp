import { TONES } from "../shared/pattern";
import type { Pattern } from "../shared/pattern";

// Frozen storage format from before every score pitch was exposed. Not a playable-pitch list.
const LEGACY_TONES = [
  { instrument: "bass", notes: ["C2", "D2", "E2", "G2", "A2", "C3"] },
  { instrument: "mallet", notes: ["D3", "E3", "G3", "A3", "C4", "D4", "E4"] },
  { instrument: "keys", notes: ["F4", "G4", "A4", "B4", "C5", "D5", "E5", "G5"] },
  { instrument: "glass", notes: ["A5", "C6", "D6", "E6"] },
].flatMap(({ instrument, notes }) => notes.map((name) => ({ instrument, name })));

export function migrateLegacyPattern(pattern: Pattern): Pattern {
  return {
    notes: pattern.notes.map((note) => {
      const legacy = LEGACY_TONES[note.tone];
      if (!legacy) throw new Error(`Unknown legacy tone ${note.tone}`);
      const tone = TONES.findIndex(
        (tone) => tone.instrument === legacy.instrument && tone.note.name === legacy.name,
      );
      if (tone < 0) throw new Error(`Missing migrated pitch ${legacy.instrument} ${legacy.name}`);
      return { ...note, tone };
    }),
  };
}
