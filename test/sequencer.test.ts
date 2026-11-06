import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { DEFAULT_VOLUME, INSTRUMENTS, STEP_COUNT, STEP_SECONDS } from "../src/client/score";
import type { InstrumentId, TimedNote } from "../src/client/score";
import { compose } from "../src/client/playground";
import type { Constellation } from "../src/client/playground";
import { Sequencer } from "../src/client/sequencer";
import { carriers, channel, plucks, routesTo, TestAudioContext } from "./audio-context";

let sequencer: Sequencer | null;

beforeEach(() => {
  vi.useFakeTimers();
  TestAudioContext.instances = [];
  sequencer = null;
  vi.stubGlobal("AudioContext", TestAudioContext);
});

afterEach(() => {
  sequencer?.dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function instrument(id: InstrumentId) {
  return INSTRUMENTS.find((item) => item.id === id)!;
}

function row(id: InstrumentId, name: string) {
  const index = instrument(id).notes.findIndex((note) => note.name === name);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

function note(id: InstrumentId, name: string, step: number): TimedNote {
  return { instrument: id, row: row(id, name), step };
}

async function start(getNotes: () => TimedNote[] = () => []) {
  const engine = new Sequencer(getNotes);
  sequencer = engine;
  await engine.play();
  return { engine, context: TestAudioContext.instances.at(-1)! };
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

const floatingLight: Constellation = {
  sources: [{ id: 1, step: 2.37, tone: 7.13 }],
};

test.each([
  ["bass", 2, 2.8, [0.13]],
  ["mallet", 7, 0.9, [0.12]],
  ["keys", 11, 2.43, [0.065, 0.014, 0.0045, 0.0015]],
  ["glass", 17, 2.83, [0.035, 0.008, 0.002]],
] as const)(
  "%s retains its envelope peaks, onset, and natural decay",
  async (id, tone, seconds, peaks) => {
    const { context } = await start(() => compose({ sources: [{ id: 1, step: 0, tone }] }));
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

test("felt lights retain their partial tuning", async () => {
  const { context } = await start(() => compose({ sources: [{ id: 1, step: 0, tone: 11 }] }));
  const frequency = instrument("keys").notes[row("keys", "A4")].frequency;
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
    sources: [{ ...floatingLight.sources[0], step: 0.25 }],
  });
  const { engine, context } = await start(() => notes);
  expect(carriers(context, "mallet")).toHaveLength(1);
  runUntil(context, 0.3);
  await engine.pause();
  vi.advanceTimersByTime(2000);
  await engine.play();
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
  let document: Constellation = {
    sources: [{ ...floatingLight.sources[0], step: 10.37 }],
  };
  const { context } = await start(() => compose(document));
  document = { sources: [] };
  runUntil(context, 2);
  expect(carriers(context, "mallet")).toHaveLength(0);
  document = {
    sources: [{ ...floatingLight.sources[0], step: 16.37 }],
  };
  runUntil(context, 3.2);
  expect(carriers(context, "mallet")).toHaveLength(1);
  expect(carriers(context, "mallet")[0].start.mock.calls[0][0]).toBeCloseTo(
    0.05 + 16 * STEP_SECONDS,
    10,
  );
  document = { sources: [{ ...floatingLight.sources[0], step: 18.37 }] };
  runUntil(context, STEP_COUNT * STEP_SECONDS + 3.2);
  expect(carriers(context, "mallet").at(-1)!.start.mock.calls[0][0]).toBeCloseTo(
    0.05 + (STEP_COUNT + 18) * STEP_SECONDS,
    10,
  );
});

test("notes ring naturally across the loop seam without being cut short", async () => {
  const notes: TimedNote[] = [{ instrument: "bass", row: 5, step: 31.75 }];
  const { context } = await start(() => notes);
  runUntil(context, 0.05 + 36 * STEP_SECONDS);
  const strings = plucks(context, "bass");
  expect(strings).toHaveLength(1);
  expect(strings[0].start).toHaveBeenCalledWith(0.05 + 31.75 * STEP_SECONDS);
  expect(strings[0].stop).toHaveBeenCalledExactlyOnceWith(0.05 + 31.75 * STEP_SECONDS + 2.8);
});

test("bass damps only on the next bass onset, including across the loop seam", async () => {
  const notes: TimedNote[] = [
    { instrument: "bass", row: 0, step: 0 },
    { instrument: "keys", row: 0, step: 31.25 },
    { instrument: "bass", row: 1, step: 31 },
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
      { instrument: id, row: 0, step: 0 },
      { instrument: id, row: 1, step: 0 },
      { instrument: id, row: 2, step: 1 },
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
  const { engine, context } = await start();
  expect(engine.getPosition()).toBeNull();
  advance(context, 0.05 + STEP_SECONDS * 3.25);
  expect(engine.getPosition()).toBeCloseTo(3.25);
  await engine.pause();
  vi.advanceTimersByTime(1000);
  expect(engine.getPosition()).toBeCloseTo(3.25);
  await engine.play();
  advance(context, 0.05 + STEP_SECONDS * 34.5);
  expect(engine.getPosition()).toBeCloseTo(2.5);
});

test("audio starts only on Play and mallet events loop at exactly 32 steps", async () => {
  const notes = [note("mallet", "C4", 0), note("mallet", "A4", 31)];
  const engine = new Sequencer(() => notes);
  sequencer = engine;
  expect(TestAudioContext.instances).toHaveLength(0);
  expect(engine.getPosition()).toBeNull();
  await engine.play();
  await engine.play();
  const context = TestAudioContext.instances[0];
  expect(TestAudioContext.instances).toHaveLength(1);
  expect(context.state).toBe("running");
  expect(context.gains[0].gain.value).toBe(DEFAULT_VOLUME);
  runUntil(context, STEP_SECONDS * STEP_COUNT + 0.1);
  const voices = carriers(context, "mallet");
  expect(voices.map((voice) => voice.frequency.value)).toEqual([261.626, 440, 261.626]);
  const times = voices.map((voice) => voice.start.mock.calls[0][0]);
  expect(times[0]).toBeCloseTo(0.05);
  expect(times[1]).toBeCloseTo(0.05 + 31 * STEP_SECONDS);
  expect(times[2] - times[0]).toBeCloseTo(STEP_COUNT * STEP_SECONDS);
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
  expect(mallet.map((voice) => voice.frequency.value)).toEqual([440, 329.628]);
  expect(carriers(context, "glass")).toHaveLength(6);
  for (const voice of [...mallet, ...carriers(context, "glass")])
    expect(voice.start).toHaveBeenCalledExactlyOnceWith(0.05 + STEP_SECONDS);
  expect(sources(context, "keys")).toHaveLength(0);
  expect(sources(context, "bass")).toHaveLength(0);
});

test("pause preserves overlapping voices and resumes scheduling without re-striking", async () => {
  const notes = [note("keys", "E5", 0), note("bass", "C2", 0), note("mallet", "C4", 1)];
  const { context, engine } = await start(() => notes);
  advance(context, 0.1);
  await engine.pause();
  vi.advanceTimersByTime(2000);
  expect(context.state).toBe("suspended");
  expect(carriers(context, "keys")).toHaveLength(4);
  expect(plucks(context, "bass")).toHaveLength(1);
  expect(carriers(context, "mallet")).toHaveLength(0);
  await engine.play();
  expect(TestAudioContext.instances).toHaveLength(1);
  expect(carriers(context, "mallet")).toHaveLength(0);
  advance(context, 0.15);
  advance(context, 0.23);
  expect(carriers(context, "mallet")).toHaveLength(1);
  expect(carriers(context, "keys")).toHaveLength(4);
  expect(plucks(context, "bass")).toHaveLength(1);
});

test("master mute works before audio starts and unmute smoothly restores the volume", async () => {
  const engine = new Sequencer(() => []);
  sequencer = engine;
  engine.setVolume(0);
  expect(TestAudioContext.instances).toHaveLength(0);
  await engine.play();
  const context = TestAudioContext.instances[0];
  expect(context.gains[0].gain.value).toBe(0);
  expect(context.gains[0].connect).toHaveBeenCalledWith(context.destination);
  for (const { id } of INSTRUMENTS) {
    expect(channel(context, id).connect).toHaveBeenCalledWith(context.gains[0]);
    expect(channel(context, id).gain.value).toBe(1);
  }
  advance(context, 0.23);
  engine.setVolume(DEFAULT_VOLUME);
  expect(context.gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(
    DEFAULT_VOLUME,
    0.23,
    0.02,
  );
});

test.each(["mallet", "keys", "bass", "glass"] as const)(
  "%s cleans up its sources and local nodes without disconnecting the channel",
  async (id) => {
    const { context } = await start(() => [{ instrument: id, row: 0, step: 0 }]);
    const voices = sources(context, id);
    expect(voices).toHaveLength(id === "keys" ? 4 : id === "glass" ? 3 : 1);
    for (const voice of voices) {
      expect(voice.onended).not.toBeNull();
      voice.onended!();
      expect(voice.disconnect).toHaveBeenCalledTimes(1);
    }
    for (const part of [...context.filters, ...context.gains.slice(INSTRUMENTS.length + 1)])
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
  const { context, engine } = await start(() => [note("mallet", "C4", 0)]);
  expect(carriers(context, "mallet")).toHaveLength(1);
  engine.dispose();
  advance(context, STEP_COUNT * STEP_SECONDS);
  await engine.play();
  expect(context.state).toBe("closed");
  expect(TestAudioContext.instances).toHaveLength(1);
  expect(carriers(context, "mallet")).toHaveLength(1);
});
