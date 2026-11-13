import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import {
  DEFAULT_VOLUME,
  INSTRUMENTS,
  INSTRUMENT_IDS,
  STEP_COUNT,
  STEP_SECONDS,
} from "../src/shared/score";
import type { InstrumentId, TimedNote } from "../src/shared/score";
import { compose, TONES } from "../src/shared/pattern";
import type { Pattern } from "../src/shared/pattern";
import { Sequencer } from "../src/client/sequencer";
import { carriers, channel, deferred, plucks, routesTo, TestAudioContext } from "./audio-context";

let activeSequencer: Sequencer | null;
let nextNoteId: number;

beforeEach(() => {
  vi.useFakeTimers();
  TestAudioContext.instances = [];
  activeSequencer = null;
  nextNoteId = 1;
  vi.stubGlobal("AudioContext", TestAudioContext);
});

afterEach(() => {
  activeSequencer?.dispose();
  expect(vi.getTimerCount()).toBe(0);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function row(id: InstrumentId, name: string) {
  const index = INSTRUMENTS[id].notes.findIndex((note) => note.name === name);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

function note(id: InstrumentId, name: string, step: number): TimedNote {
  return { noteId: String(nextNoteId++), instrument: id, row: row(id, name), step };
}

async function start(getNotes: () => TimedNote[] = () => []) {
  const sequencer = new Sequencer(getNotes);
  activeSequencer = sequencer;
  await sequencer.play();
  return { sequencer, context: TestAudioContext.instances.at(-1)! };
}

function advance(context: TestAudioContext, time: number) {
  context.currentTime = time;
  vi.advanceTimersByTime(25);
}

function runUntil(context: TestAudioContext, time: number) {
  for (let tick = context.currentTime; tick < time; tick += 0.025) advance(context, tick);
}

function sources(context: TestAudioContext, id: InstrumentId) {
  return [...carriers(context, id), ...plucks(context, id)];
}

const floatingLight: Pattern = {
  notes: [{ id: "1", step: 2.37, tone: 7.13 }],
};

test.each([
  ["bass", "E2", 2.8, [0.13]],
  ["mallet", "D4", 0.9, [0.12]],
  ["keys", "A4", 2.43, [0.065, 0.014, 0.0045, 0.0015]],
  ["glass", "A5", 2.83, [0.035, 0.008, 0.002]],
] as const)(
  "%s retains its envelope peaks, onset, and natural decay",
  async (id, name, seconds, peaks) => {
    const tone = TONES.findIndex((tone) => tone.instrument === id && tone.note.name === name);
    const { context } = await start(() => compose({ notes: [{ id: "1", step: 0, tone }] }));
    runUntil(context, 3.2);
    const voices = sources(context, id);
    expect(voices).toHaveLength(peaks.length);
    for (const source of voices) {
      expect(source.start).toHaveBeenCalledExactlyOnceWith(0.05);
      expect(source.stop).toHaveBeenCalledTimes(1);
    }
    expect(voices[0].stop.mock.calls[0][0]).toBeCloseTo(0.05 + seconds, 10);
    expect(
      context.gains
        .filter((gain) => routesTo(gain, channel(context, id)))
        .flatMap((gain) => gain.gain.linearRampToValueAtTime.mock.calls)
        .filter(([value]) => value > 0)
        .map(([value]) => value),
    ).toEqual(peaks);
  },
);

test.each([
  ["mallet", "D3", 50],
  ["mallet", "E3", 52],
  ["mallet", "G3", 55],
  ["mallet", "A3", 57],
  ["mallet", "G4", 67],
  ["mallet", "A4", 69],
  ["keys", "C4", 60],
  ["keys", "D4", 62],
  ["keys", "E4", 64],
  ["keys", "G5", 79],
  ["glass", "C5", 72],
  ["glass", "D5", 74],
  ["glass", "E5", 76],
  ["glass", "G5", 79],
  ["glass", "D6", 86],
  ["glass", "E6", 88],
] as const)("%s %s is playable and schedules at its expected frequency", async (id, name, midi) => {
  const tone = TONES.findIndex((tone) => tone.instrument === id && tone.note.name === name);
  expect(tone).toBeGreaterThanOrEqual(0);
  const { context } = await start(() => compose({ notes: [{ id: "1", step: 0, tone }] }));
  const voices = carriers(context, id);
  expect(voices).toHaveLength(id === "keys" ? 4 : id === "glass" ? 3 : 1);
  expect(voices[0].frequency.value).toBeCloseTo(440 * 2 ** ((midi - 69) / 12), 10);
  expect(voices[0].start).toHaveBeenCalledExactlyOnceWith(0.05);
});

test("felt lights retain their partial tuning", async () => {
  const tone = TONES.findIndex((tone) => tone.instrument === "keys" && tone.note.name === "A4");
  const { context } = await start(() => compose({ notes: [{ id: "1", step: 0, tone }] }));
  const frequency = INSTRUMENTS.keys.notes[row("keys", "A4")].frequency;
  expect(carriers(context, "keys").map((source) => source.frequency.value)).toEqual(
    [1, 2.003, 3.009, 4.02].map((ratio) => frequency * ratio),
  );
  expect(plucks(context, "keys")).toEqual([]);
});

test("magnetic lights always schedule on the beat, including raw draft inputs", async () => {
  const { context } = await start(() => compose(floatingLight));
  runUntil(context, 0.6);
  const strikes = carriers(context, "mallet");
  expect(strikes).toHaveLength(1);
  expect(strikes[0].start.mock.calls[0][0]).toBeCloseTo(0.05 + 2 * STEP_SECONDS, 10);
});

test("event scheduling never duplicates buffered strikes when paused and resumed", async () => {
  const notes = compose({
    notes: [{ ...floatingLight.notes[0], step: 0.25 }],
  });
  const { sequencer, context } = await start(() => notes);
  expect(carriers(context, "mallet")).toHaveLength(1);
  runUntil(context, 0.3);
  await sequencer.pause();
  vi.advanceTimersByTime(2000);
  await sequencer.play();
  runUntil(context, 0.6);
  expect(carriers(context, "mallet")).toHaveLength(1);
});

test("event timelines wrap without drift and skip missed loops instead of catching up in a burst", async () => {
  const { context } = await start(() => compose(floatingLight));
  const loop = STEP_COUNT * STEP_SECONDS;
  runUntil(context, loop + 0.6);
  const strikes = carriers(context, "mallet");
  expect(strikes).toHaveLength(2);
  expect(strikes[1].start.mock.calls[0][0] - strikes[0].start.mock.calls[0][0]).toBeCloseTo(
    loop,
    10,
  );
  const before = strikes.length;
  advance(context, 40);
  const added = carriers(context, "mallet").slice(before);
  expect(added.length).toBeLessThanOrEqual(1);
  expect(added.every((source) => source.start.mock.calls[0][0] >= 40)).toBe(true);
});

test("live timing edits use the next unscheduled audio window", async () => {
  let document: Pattern = {
    notes: [{ ...floatingLight.notes[0], step: 10.37 }],
  };
  const { context } = await start(() => compose(document));
  document = { notes: [] };
  runUntil(context, 2);
  expect(carriers(context, "mallet")).toHaveLength(0);
  document = {
    notes: [{ ...floatingLight.notes[0], step: 16.37 }],
  };
  runUntil(context, 3.2);
  expect(carriers(context, "mallet")).toHaveLength(1);
  expect(carriers(context, "mallet")[0].start.mock.calls[0][0]).toBeCloseTo(
    0.05 + 16 * STEP_SECONDS,
    10,
  );
  document = { notes: [{ ...floatingLight.notes[0], step: 18.37 }] };
  runUntil(context, STEP_COUNT * STEP_SECONDS + 3.2);
  expect(carriers(context, "mallet").at(-1)!.start.mock.calls[0][0]).toBeCloseTo(
    0.05 + (STEP_COUNT + 18) * STEP_SECONDS,
    10,
  );
});

test("notes ring naturally across the loop seam without being cut short", async () => {
  const notes: TimedNote[] = [{ noteId: "1", instrument: "bass", row: 5, step: 31.75 }];
  const { context } = await start(() => notes);
  runUntil(context, 0.05 + 36 * STEP_SECONDS);
  const strings = plucks(context, "bass");
  expect(strings).toHaveLength(1);
  expect(strings[0].start).toHaveBeenCalledWith(0.05 + 31.75 * STEP_SECONDS);
  expect(strings[0].stop).toHaveBeenCalledExactlyOnceWith(0.05 + 31.75 * STEP_SECONDS + 2.8);
});

test("bass damps only on the next bass onset, including across the loop seam", async () => {
  const notes: TimedNote[] = [
    { noteId: "1", instrument: "bass", row: 0, step: 0 },
    { noteId: "2", instrument: "keys", row: 0, step: 31.25 },
    { noteId: "3", instrument: "bass", row: 1, step: 31 },
  ];
  const { context } = await start(() => notes);
  runUntil(context, 0.05 + STEP_COUNT * STEP_SECONDS + 0.1);
  const strings = plucks(context, "bass");
  expect(strings).toHaveLength(3);
  expect(strings[0].stop).toHaveBeenCalledExactlyOnceWith(0.05 + 2.8);
  expect(strings[1].stop.mock.calls.at(-1)![0]).toBeCloseTo(0.05 + STEP_COUNT * STEP_SECONDS, 10);
  expect(strings[2].stop).toHaveBeenCalledExactlyOnceWith(0.05 + STEP_COUNT * STEP_SECONDS + 2.8);
  const gates = context.gains.filter((gain) => gain.connections.includes(channel(context, "bass")));
  expect(gates[0].gain.setValueAtTime).not.toHaveBeenCalled();
  expect(gates[0].gain.linearRampToValueAtTime).not.toHaveBeenCalled();
  expect(gates[1].gain.setValueAtTime).toHaveBeenCalledWith(
    1,
    0.05 + STEP_COUNT * STEP_SECONDS - 0.008,
  );
  expect(gates[1].gain.linearRampToValueAtTime).toHaveBeenCalledWith(
    0,
    0.05 + STEP_COUNT * STEP_SECONDS,
  );
});

test.each([
  ["mallet", 1, 0.9],
  ["keys", 4, 2.43],
  ["glass", 3, 2.83],
] as const)(
  "%s chords decay independently when simultaneous and later notes overlap",
  async (id, partials, seconds) => {
    const notes: TimedNote[] = [
      { noteId: "1", instrument: id, row: 0, step: 0 },
      { noteId: "2", instrument: id, row: 1, step: 0 },
      { noteId: "3", instrument: id, row: 2, step: 1 },
    ];
    const { context } = await start(() => notes);
    runUntil(context, 0.3);
    const voices = carriers(context, id);
    expect(voices).toHaveLength(3 * partials);
    const fundamentals = voices.filter((_, index) => index % partials === 0);
    expect(fundamentals[0].start).toHaveBeenCalledExactlyOnceWith(0.05);
    expect(fundamentals[1].start).toHaveBeenCalledExactlyOnceWith(0.05);
    expect(fundamentals[2].start.mock.calls[0][0]).toBeCloseTo(0.05 + STEP_SECONDS, 10);
    runUntil(context, 3);
    for (const source of voices) expect(source.stop).toHaveBeenCalledTimes(1);
    for (const source of fundamentals) {
      expect(source.stop.mock.calls[0][0] - source.start.mock.calls[0][0]).toBeCloseTo(seconds, 10);
    }
  },
);

test("the spatial playhead reads the audio clock, wraps the loop, and holds while paused", async () => {
  const { sequencer, context } = await start();
  expect(sequencer.getPlayback().position).toBeNull();
  advance(context, 0.05 + STEP_SECONDS * 3.25);
  expect(sequencer.getPlayback().position).toBeCloseTo(3.25);
  await sequencer.pause();
  vi.advanceTimersByTime(1000);
  expect(sequencer.getPlayback().position).toBeCloseTo(3.25);
  await sequencer.play();
  advance(context, 0.05 + STEP_SECONDS * 34.5);
  expect(sequencer.getPlayback().position).toBeCloseTo(2.5);
});

test("audio starts only on Play and mallet events loop at exactly 32 steps", async () => {
  const notes = [note("mallet", "C4", 0), note("mallet", "A4", 31)];
  const sequencer = new Sequencer(() => notes);
  activeSequencer = sequencer;
  expect(TestAudioContext.instances).toHaveLength(0);
  expect(sequencer.getPlayback().position).toBeNull();
  await sequencer.play();
  await sequencer.play();
  const context = TestAudioContext.instances[0];
  expect(TestAudioContext.instances).toHaveLength(1);
  expect(context.state).toBe("running");
  expect(context.gains[0].gain.value).toBe(DEFAULT_VOLUME);
  runUntil(context, STEP_SECONDS * STEP_COUNT + 0.1);
  const voices = carriers(context, "mallet");
  expect(voices.map((voice) => voice.frequency.value)).toEqual([
    expect.closeTo(261.625565, 5),
    440,
    expect.closeTo(261.625565, 5),
  ]);
  const times = voices.map((voice) => voice.start.mock.calls[0][0]);
  expect(times[0]).toBeCloseTo(0.05);
  expect(times[1]).toBeCloseTo(0.05 + 31 * STEP_SECONDS);
  expect(times[2] - times[0]).toBeCloseTo(STEP_COUNT * STEP_SECONDS);
});

test("concurrent Play calls share one scheduler and Pause clears it completely", async () => {
  const pending = deferred();
  const resume = vi
    .spyOn(TestAudioContext.prototype, "resume")
    .mockImplementationOnce(async function (this: TestAudioContext) {
      await pending.promise;
      this.state = "running";
    });
  const sequencer = new Sequencer(() => [note("mallet", "C4", 0)]);
  activeSequencer = sequencer;
  const first = sequencer.play();
  const second = sequencer.play();
  expect(resume).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  pending.resolve();
  await Promise.all([first, second]);
  const context = TestAudioContext.instances[0];
  expect(vi.getTimerCount()).toBe(1);
  expect(carriers(context, "mallet")).toHaveLength(1);
  await sequencer.pause();
  expect(context.state).toBe("suspended");
  expect(vi.getTimerCount()).toBe(0);
  advance(context, STEP_COUNT * STEP_SECONDS);
  expect(carriers(context, "mallet")).toHaveLength(1);
});

test("Play requested during a pending Pause waits, then resumes one scheduler", async () => {
  const { sequencer, context } = await start();
  const pending = deferred();
  const suspend = vi.spyOn(context, "suspend").mockImplementationOnce(async () => {
    await pending.promise;
    context.state = "suspended";
  });
  const resume = vi.spyOn(context, "resume");
  const paused = sequencer.pause();
  const playing = sequencer.play();
  expect(suspend).toHaveBeenCalledTimes(1);
  expect(resume).not.toHaveBeenCalled();
  pending.resolve();
  await Promise.all([paused, playing]);
  expect(context.state).toBe("running");
  expect(resume).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(1);
  await sequencer.pause();
  expect(vi.getTimerCount()).toBe(0);
});

test("Pause requested during startup runs after resume instead of leaving audio running", async () => {
  const pending = deferred();
  vi.spyOn(TestAudioContext.prototype, "resume").mockImplementationOnce(async function (
    this: TestAudioContext,
  ) {
    await pending.promise;
    this.state = "running";
  });
  const suspend = vi.spyOn(TestAudioContext.prototype, "suspend");
  const sequencer = new Sequencer(() => []);
  activeSequencer = sequencer;
  const playing = sequencer.play();
  const paused = sequencer.pause();
  expect(suspend).not.toHaveBeenCalled();
  pending.resolve();
  await Promise.all([playing, paused]);
  expect(TestAudioContext.instances[0].state).toBe("suspended");
  expect(vi.getTimerCount()).toBe(0);
});

test("a rejected Pause leaves scheduling intact and can be retried", async () => {
  const { sequencer, context } = await start(() => [note("mallet", "C4", 1)]);
  vi.spyOn(context, "suspend").mockRejectedValueOnce(new Error("Cannot suspend"));
  await expect(sequencer.pause()).rejects.toThrow("Cannot suspend");
  expect(context.state).toBe("running");
  expect(vi.getTimerCount()).toBe(1);
  advance(context, 0.15);
  expect(carriers(context, "mallet")).toHaveLength(1);
  await sequencer.pause();
  expect(context.state).toBe("suspended");
  expect(vi.getTimerCount()).toBe(0);
});

test("a rejected Play does not block a queued retry", async () => {
  vi.spyOn(TestAudioContext.prototype, "resume").mockRejectedValueOnce(new Error("Cannot resume"));
  const sequencer = new Sequencer(() => [note("mallet", "C4", 0)]);
  activeSequencer = sequencer;
  const failed = sequencer.play();
  const retry = sequencer.play();
  await expect(failed).rejects.toThrow("Cannot resume");
  await retry;
  const context = TestAudioContext.instances[0];
  expect(context.state).toBe("running");
  expect(carriers(context, "mallet")).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(1);
});

test("disposing during startup prevents pending and queued commands from scheduling", async () => {
  const pending = deferred();
  vi.spyOn(TestAudioContext.prototype, "resume").mockReturnValueOnce(pending.promise);
  const sequencer = new Sequencer(() => [note("mallet", "C4", 0)]);
  activeSequencer = sequencer;
  const first = sequencer.play();
  const second = sequencer.play();
  sequencer.dispose();
  pending.resolve();
  await Promise.all([first, second]);
  const context = TestAudioContext.instances[0];
  expect(context.state).toBe("closed");
  expect(carriers(context, "mallet")).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});

test("live edits schedule chords in multiple instruments without retaining removed notes", async () => {
  let notes = [note("mallet", "C4", 1)];
  const { context } = await start(() => notes);
  notes = [
    note("mallet", "A4", 1),
    note("mallet", "E4", 1),
    note("glass", "C6", 1),
    note("glass", "A5", 1),
  ];
  advance(context, 0.15);
  const mallet = carriers(context, "mallet");
  expect(mallet.map((voice) => voice.frequency.value)).toEqual([
    440,
    expect.closeTo(329.627557, 5),
  ]);
  expect(carriers(context, "glass")).toHaveLength(6);
  for (const voice of [...mallet, ...carriers(context, "glass")])
    expect(voice.start).toHaveBeenCalledExactlyOnceWith(0.05 + STEP_SECONDS);
  expect(sources(context, "keys")).toHaveLength(0);
  expect(sources(context, "bass")).toHaveLength(0);
});

test("pause preserves overlapping voices and resumes scheduling without re-striking", async () => {
  const notes = [note("keys", "E5", 0), note("bass", "C2", 0), note("mallet", "C4", 1)];
  const { context, sequencer } = await start(() => notes);
  advance(context, 0.1);
  await sequencer.pause();
  vi.advanceTimersByTime(2000);
  expect(context.state).toBe("suspended");
  expect(carriers(context, "keys")).toHaveLength(4);
  expect(plucks(context, "bass")).toHaveLength(1);
  expect(carriers(context, "mallet")).toHaveLength(0);
  await sequencer.play();
  expect(TestAudioContext.instances).toHaveLength(1);
  expect(carriers(context, "mallet")).toHaveLength(0);
  advance(context, 0.15);
  advance(context, 0.23);
  expect(carriers(context, "mallet")).toHaveLength(1);
  expect(carriers(context, "keys")).toHaveLength(4);
  expect(plucks(context, "bass")).toHaveLength(1);
});

test("master mute works before audio starts and unmute smoothly restores the volume", async () => {
  const sequencer = new Sequencer(() => []);
  activeSequencer = sequencer;
  sequencer.setVolume(0);
  expect(TestAudioContext.instances).toHaveLength(0);
  await sequencer.play();
  const context = TestAudioContext.instances[0];
  expect(context.gains[0].gain.value).toBe(0);
  expect(context.gains[0].connect).toHaveBeenCalledWith(context.destination);
  for (const id of INSTRUMENT_IDS) {
    expect(channel(context, id).connect).toHaveBeenCalledWith(context.gains[0]);
    expect(channel(context, id).gain.value).toBe(1);
  }
  advance(context, 0.23);
  sequencer.setVolume(DEFAULT_VOLUME);
  expect(context.gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(
    DEFAULT_VOLUME,
    0.23,
    0.02,
  );
});

test.each(["mallet", "keys", "bass", "glass"] as const)(
  "%s cleans up its sources and local nodes without disconnecting the channel",
  async (id) => {
    const { context } = await start(() => [{ noteId: "1", instrument: id, row: 0, step: 0 }]);
    const voices = sources(context, id);
    expect(voices).toHaveLength(id === "keys" ? 4 : id === "glass" ? 3 : 1);
    for (const voice of voices) {
      expect(voice.onended).not.toBeNull();
      voice.onended!();
      expect(voice.disconnect).toHaveBeenCalledTimes(1);
    }
    for (const part of [...context.filters, ...context.gains.slice(INSTRUMENT_IDS.length + 1)])
      expect(part.disconnect).toHaveBeenCalledTimes(1);
    expect(channel(context, id).disconnect).not.toHaveBeenCalled();
    expect(context.gains[0].disconnect).not.toHaveBeenCalled();
  },
);

test("the bass's generated string loses energy over time and reuses buffers only for the same pitch", async () => {
  const notes = [note("bass", "C2", 0), note("bass", "C2", 2), note("bass", "G2", 4)];
  const { context } = await start(() => notes);
  runUntil(context, 0.85);
  const voices = plucks(context, "bass");
  expect(voices).toHaveLength(3);
  expect(voices[0].buffer).toBe(voices[1].buffer);
  expect(voices[2].buffer).not.toBe(voices[0].buffer);
  const data = voices[0].buffer!.getChannelData(0);
  const rms = (values: Float32Array) =>
    Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
  const early = rms(data.slice(context.sampleRate * 0.1, context.sampleRate * 0.3));
  const late = rms(data.slice(context.sampleRate * 2, context.sampleRate * 2.5));
  expect(early).toBeGreaterThan(0.2);
  expect(late).toBeLessThan(early / 3);
});

test("dispose stops scheduling, closes audio, and prevents subsequent playback", async () => {
  const { context, sequencer } = await start(() => [note("mallet", "C4", 0)]);
  expect(carriers(context, "mallet")).toHaveLength(1);
  sequencer.dispose();
  advance(context, STEP_COUNT * STEP_SECONDS);
  await sequencer.play();
  expect(context.state).toBe("closed");
  expect(TestAudioContext.instances).toHaveLength(1);
  expect(carriers(context, "mallet")).toHaveLength(1);
});

test("playback exposes actual onsets only after their buffered start time arrives", async () => {
  const notes = [note("mallet", "C4", 0), note("keys", "E5", 30)];
  const { context, sequencer } = await start(() => notes);
  expect(carriers(context, "mallet")).toHaveLength(1);
  expect(sequencer.getPlayback().onsets.size).toBe(0);
  advance(context, 0.05);
  const playback = sequencer.getPlayback();
  expect(playback.time).toBe(0.05);
  expect([...playback.onsets.values()]).toEqual([{ note: notes[0], time: 0.05 }]);
});

test("a future loop's buffered strike does not replace the previous actual onset early", async () => {
  const notes = [note("mallet", "C4", 0)];
  const { context, sequencer } = await start(() => notes);
  const next = 0.05 + STEP_COUNT * STEP_SECONDS;
  advance(context, next - 0.05);
  expect(carriers(context, "mallet")).toHaveLength(2);
  expect(sequencer.getPlayback().onsets.get(notes[0].noteId)?.time).toBe(0.05);
  advance(context, next);
  expect(sequencer.getPlayback().onsets.get(notes[0].noteId)?.time).toBe(next);
});

test("new notes behind the playhead have no onset until their next actual strike", async () => {
  let notes: TimedNote[] = [];
  const { context, sequencer } = await start(() => notes);
  advance(context, 0.05 + 2 * STEP_SECONDS);
  notes = [note("mallet", "C4", 1)];
  advance(context, 0.05 + 3 * STEP_SECONDS);
  expect(sequencer.getPlayback().onsets.size).toBe(0);
  expect(carriers(context, "mallet")).toHaveLength(0);
  const next = 0.05 + STEP_COUNT * STEP_SECONDS + STEP_SECONDS;
  advance(context, next - 0.05);
  expect(carriers(context, "mallet")).toHaveLength(1);
  expect(sequencer.getPlayback().onsets.size).toBe(0);
  advance(context, next);
  expect(sequencer.getPlayback().onsets.get(notes[0].noteId)).toEqual({
    note: notes[0],
    time: next,
  });
});

test("a stalled scheduler never reports missed strikes as if they played", async () => {
  let notes: TimedNote[] = [];
  const { context, sequencer } = await start(() => notes);
  notes = [note("mallet", "C4", 4)];
  advance(context, 0.05 + 5 * STEP_SECONDS);
  expect(carriers(context, "mallet")).toHaveLength(0);
  expect(sequencer.getPlayback().onsets.size).toBe(0);
});

test("onset identity is a snapshot of what was scheduled, not a mutable score reference", async () => {
  const notes = [note("mallet", "C4", 0)];
  const original = { ...notes[0] };
  const { context, sequencer } = await start(() => notes);
  notes[0].row = row("mallet", "E4");
  advance(context, 0.05);
  expect(sequencer.getPlayback().onsets.get(original.noteId)?.note).toEqual(original);
});

test("playback drops old onset history even after all notes are deleted", async () => {
  let notes = [note("mallet", "C4", 0)];
  const { context, sequencer } = await start(() => notes);
  advance(context, 0.05);
  expect(sequencer.getPlayback().onsets.size).toBe(1);
  notes = [];
  advance(context, 100);
  expect(sequencer.getPlayback().onsets.size).toBe(0);
  expect(carriers(context, "mallet")).toHaveLength(1);
});
