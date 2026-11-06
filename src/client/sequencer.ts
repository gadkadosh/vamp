import { DEFAULT_VOLUME, EMPTY_PLAYBACK, INSTRUMENTS, STEP_COUNT, STEP_SECONDS } from "./score";
import type { InstrumentId, NoteOnset, Playback, TimedNote } from "./score";

export class Sequencer {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private channels = new Map<InstrumentId, GainNode>();
  private monoVoices = new Map<InstrumentId, (time: number) => void>();
  private scheduledUntil = 0;
  private onsets: NoteOnset[] = [];
  private volume = DEFAULT_VOLUME;
  private startTime: number | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;
  private getScore: () => TimedNote[];

  constructor(getScore: () => TimedNote[]) {
    this.getScore = getScore;
  }

  async play() {
    if (this.disposed || this.timer !== undefined) return;
    // Create and resume only from the Play gesture, never on page load.
    if (!this.context) {
      this.context = new AudioContext();
      this.output = this.context.createGain();
      this.output.gain.value = this.volume;
      this.output.connect(this.context.destination);
      for (const { id } of INSTRUMENTS) {
        const channel = this.context.createGain();
        channel.connect(this.output);
        this.channels.set(id, channel);
      }
    }
    await this.context.resume();
    if (this.disposed) return;
    if (this.context.state !== "running") throw new Error("Audio could not start");
    if (this.startTime === null) {
      this.startTime = this.context.currentTime + 0.05;
    }
    this.schedule();
    this.timer = setInterval(this.schedule, 25);
  }

  async pause() {
    this.clearTimer();
    // Freezing the audio clock preserves both the position and scheduled notes.
    await this.context?.suspend();
  }

  // Expose only strikes whose audio-time onset has arrived, not future buffered notes.
  getPlayback(): Playback {
    if (!this.context || this.startTime === null) return EMPTY_PLAYBACK;
    const time = this.context.currentTime;
    const elapsed = time - this.startTime;
    const onsets = new Map<number, NoteOnset>();
    for (const onset of this.onsets) {
      if (onset.time <= time) onsets.set(onset.note.noteId, onset);
    }
    return {
      time,
      position: elapsed < 0 ? null : (elapsed / STEP_SECONDS) % STEP_COUNT,
      onsets,
    };
  }

  setVolume(volume: number) {
    this.volume = volume;
    if (this.context && this.output) {
      this.output.gain.setTargetAtTime(volume, this.context.currentTime, 0.02);
    }
  }

  dispose() {
    this.disposed = true;
    this.clearTimer();
    this.monoVoices.clear();
    this.onsets = [];
    void this.context?.close().catch(() => {});
  }

  private clearTimer() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private schedule = () => {
    if (!this.context || !this.output || this.startTime === null) return;
    const now = this.context.currentTime;
    const notes = this.getScore();
    const start = this.startTime;
    const from = Math.max(start, now, this.scheduledUntil);
    const until = now + 0.1;
    if (from >= until) return;
    const loopSeconds = STEP_COUNT * STEP_SECONDS;
    // One loop of actual strikes is sufficient for blooms, without retaining deleted notes forever.
    this.onsets = this.onsets.filter((onset) => onset.time >= now - loopSeconds);
    const starts: NoteOnset[] = [];
    for (
      let loop = Math.floor((from - start) / loopSeconds);
      loop <= Math.floor((until - start) / loopSeconds);
      loop++
    ) {
      for (const note of notes) {
        const time = start + loop * loopSeconds + note.step * STEP_SECONDS;
        if (time >= from && time < until) starts.push({ note, time });
      }
    }
    starts.sort((a, b) => a.time - b.time);
    for (const { note, time } of starts) {
      const instrument = INSTRUMENTS.find(({ id }) => id === note.instrument)!;
      const channel = this.channels.get(instrument.id)!;
      this.monoVoices.get(instrument.id)?.(time);
      const stop = instrument.start(
        this.context,
        channel,
        instrument.notes[note.row].frequency,
        time,
      );
      // Only bass returns a damper; polyphonic voices finish naturally.
      if (stop) this.monoVoices.set(instrument.id, stop);
      this.onsets.push({ note: { ...note }, time });
    }
    // A rolling, half-open audio-time window prevents duplicate strikes, handles
    // fractional onsets, and skips missed events after a background-tab stall.
    this.scheduledUntil = until;
  };
}
