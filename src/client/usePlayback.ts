import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compose } from "../shared/pattern";
import type { Pattern } from "../shared/pattern";
import { DEFAULT_VOLUME, EMPTY_PLAYBACK } from "../shared/score";
import { Sequencer } from "./sequencer";

export function usePlayback(pattern: Pattern, solo: boolean) {
  const score = useMemo(() => compose(pattern), [pattern]);
  const scoreRef = useRef(score);
  const sequencerRef = useRef<Sequencer | null>(null);
  const getPlayback = useCallback(() => sequencerRef.current?.getPlayback() ?? EMPTY_PLAYBACK, []);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const sequencer = new Sequencer(() => scoreRef.current);
    sequencerRef.current = sequencer;

    return () => {
      sequencer.dispose();
      sequencerRef.current = null;
    };
  }, [solo]);

  useEffect(() => {
    sequencerRef.current?.setVolume(muted ? 0 : DEFAULT_VOLUME);
  }, [muted, solo]);

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  function reset() {
    setPlaying(false);
    setBusy(false);
    setError("");
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

  return {
    playing,
    busy,
    muted,
    error,
    getPlayback,
    togglePlayback,
    toggleMute: () => setMuted(!muted),
    reset,
  };
}
