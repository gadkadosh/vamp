import { DEFAULT_ENABLED, DEFAULT_VOLUME, INSTRUMENTS, STEP_COUNT, STEP_SECONDS } from "./score";
import type { InstrumentId, Patterns } from "./score";

export class Sequencer {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private channels = new Map<InstrumentId, GainNode>();
  private enabled = { ...DEFAULT_ENABLED };
  private monoVoices = new Map<InstrumentId, { row: number; stop: (time: number) => void }>();
  private volume = DEFAULT_VOLUME;
  private startTime: number | null = null;
  private nextTime = 0;
  private nextStep = 0;
  private currentStep: number | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private frame = 0;
  private disposed = false;
  private getPatterns: () => Patterns;
  private onStep: (step: number) => void;

  constructor(getPatterns: () => Patterns, onStep: (step: number) => void) {
    this.getPatterns = getPatterns;
    this.onStep = onStep;
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
        channel.gain.value = this.enabled[id] ? 1 : 0;
        channel.connect(this.output);
        this.channels.set(id, channel);
      }
    }
    await this.context.resume();
    if (this.disposed) return;
    if (this.context.state !== "running") throw new Error("Audio could not start");
    if (this.startTime === null) {
      this.startTime = this.nextTime = this.context.currentTime + 0.05;
    }
    this.schedule();
    this.timer = setInterval(this.schedule, 25);
    this.animate();
  }

  async pause() {
    this.clearTimers();
    // Freezing the audio clock preserves both the position and scheduled notes.
    await this.context?.suspend();
  }

  setVolume(volume: number) {
    this.volume = volume;
    if (this.context && this.output) {
      this.output.gain.setTargetAtTime(volume, this.context.currentTime, 0.02);
    }
  }

  setEnabled(instrument: InstrumentId, enabled: boolean) {
    this.enabled[instrument] = enabled;
    if (this.context) {
      this.channels
        .get(instrument)
        ?.gain.setTargetAtTime(enabled ? 1 : 0, this.context.currentTime, 0.02);
    }
  }

  dispose() {
    this.disposed = true;
    this.clearTimers();
    this.monoVoices.clear();
    void this.context?.close().catch(() => {});
  }

  private clearTimers() {
    clearInterval(this.timer);
    this.timer = undefined;
    cancelAnimationFrame(this.frame);
  }

  private schedule = () => {
    if (!this.context || !this.output) return;
    const now = this.context.currentTime;
    // If a background tab stalls the timer, skip missed steps instead of bursting.
    if (this.nextTime < now) {
      const missed = Math.ceil((now - this.nextTime) / STEP_SECONDS);
      this.nextTime += missed * STEP_SECONDS;
      this.nextStep = (this.nextStep + missed) % STEP_COUNT;
    }
    while (this.nextTime < now + 0.1) {
      const patterns = this.getPatterns();
      for (const instrument of INSTRUMENTS) {
        const channel = this.channels.get(instrument.id)!;
        const pattern = patterns[instrument.id];
        if (instrument.mode === "hit") {
          instrument.notes.forEach((note, row) => {
            if (pattern[row][this.nextStep])
              instrument.start(this.context!, channel, note.frequency, this.nextTime);
          });
          continue;
        }
        // Ties let one acoustic note decay instead of re-striking every cell.
        // Each new loop re-articulates the phrase, even if a whole row is filled.
        const row = pattern.findIndex((cells) => cells[this.nextStep]);
        const previous = this.monoVoices.get(instrument.id);
        if (previous?.row === row && this.nextStep !== 0) continue;
        previous?.stop(this.nextTime);
        this.monoVoices.delete(instrument.id);
        if (row >= 0) {
          this.monoVoices.set(instrument.id, {
            row,
            stop: instrument.start(
              this.context,
              channel,
              instrument.notes[row].frequency,
              this.nextTime,
            ),
          });
        }
      }
      this.nextTime += STEP_SECONDS;
      this.nextStep = (this.nextStep + 1) % STEP_COUNT;
    }
  };

  private animate = () => {
    if (!this.context || this.startTime === null) return;
    const elapsed = this.context.currentTime - this.startTime;
    if (elapsed >= 0) {
      const step = Math.floor(elapsed / STEP_SECONDS) % STEP_COUNT;
      if (step !== this.currentStep) {
        this.currentStep = step;
        this.onStep(step);
      }
    }
    this.frame = requestAnimationFrame(this.animate);
  };
}
