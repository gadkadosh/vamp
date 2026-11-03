import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import {
  createSeedPatterns,
  DEFAULT_ENABLED,
  DEFAULT_VOLUME,
  INSTRUMENTS,
  STEP_SECONDS,
  togglePatternCell,
} from "../src/client/score";
import type { InstrumentId, Patterns } from "../src/client/score";
import { Sequencer } from "../src/client/sequencer";
import { carriers, channel, plucks, TestAudioContext } from "./audio-context";

let sequencer: Sequencer | null;
const onStep = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  TestAudioContext.instances = [];
  sequencer = null;
  onStep.mockClear();
  vi.stubGlobal("AudioContext", TestAudioContext);
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
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

function emptyPatterns() {
  const patterns = createSeedPatterns();
  Object.values(patterns).forEach((pattern) => pattern.forEach((cells) => cells.fill(false)));
  return patterns;
}

function paint(patterns: Patterns, id: InstrumentId, name: string, step: number, length = 1) {
  patterns[id][row(id, name)].fill(true, step, step + length);
}

async function start(patterns: Patterns) {
  const engine = new Sequencer(() => patterns, onStep);
  sequencer = engine;
  await engine.play();
  return { engine, context: TestAudioContext.instances[0] };
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

const monoIds = ["keys", "nylon", "bass"] as const;

test("the ensemble has distinct ranges and roles, with more than five melodic pitches", () => {
  const patterns = createSeedPatterns();
  expect(INSTRUMENTS.map((item) => item.id)).toEqual(["mallet", "keys", "nylon", "bass", "glass"]);
  expect(instrument("keys").notes.map((note) => note.name)).toEqual([
    "E5",
    "D5",
    "C5",
    "B4",
    "A4",
    "G4",
    "F4",
    "E4",
    "D4",
    "C4",
  ]);
  expect(instrument("bass").notes.at(-1)!.name).toBe("C2");
  expect(instrument("glass").notes[0].name).toBe("C6");
  for (const item of INSTRUMENTS) {
    expect(patterns[item.id]).toHaveLength(item.notes.length);
    expect(patterns[item.id].every((cells) => cells.length === 32)).toBe(true);
    expect(patterns[item.id].flat().some(Boolean)).toBe(true);
    if (item.mode === "mono") {
      for (let step = 0; step < 32; step++)
        expect(patterns[item.id].filter((cells) => cells[step]).length).toBeLessThanOrEqual(1);
    }
  }
  expect(patterns.mallet.flat().filter(Boolean)).toHaveLength(8);
  expect(patterns.glass.flat().filter(Boolean)).toHaveLength(2);
  expect(DEFAULT_ENABLED).toEqual({
    mallet: true,
    keys: true,
    nylon: false,
    bass: true,
    glass: true,
  });
});

test("nylon and felt keys share a starting melody and range but their edits are independent", () => {
  const patterns = createSeedPatterns();
  expect(instrument("nylon").notes).toEqual(instrument("keys").notes);
  expect(patterns.nylon).toEqual(patterns.keys);
  expect(patterns.nylon).not.toBe(patterns.keys);
  expect(patterns.nylon[0]).not.toBe(patterns.keys[0]);
  const edited = togglePatternCell(patterns, "nylon", 0, 0);
  expect(edited.nylon[0][0]).toBe(true);
  expect(edited.keys[0][0]).toBe(false);
  expect(edited.keys).toBe(patterns.keys);
});

test.each(monoIds)(
  "editing %s replaces the other pitch in that step, not neighboring steps or tracks",
  (id) => {
    const before = emptyPatterns();
    const first = 0;
    const second = 1;
    before[id][first][3] = before[id][first][4] = true;
    const next = togglePatternCell(before, id, second, 3);
    expect(next[id][first][3]).toBe(false);
    expect(next[id][second][3]).toBe(true);
    expect(next[id][first][4]).toBe(true);
    expect(before[id][first][3]).toBe(true);
    expect(before[id][second][3]).toBe(false);
    expect(next.mallet).toBe(before.mallet);
    const removed = togglePatternCell(next, id, second, 3);
    expect(removed[id].some((cells) => cells[3])).toBe(false);
  },
);

test("mallet and glass retain editable chords, with no shared rows between seeds", () => {
  const before = emptyPatterns();
  for (const id of ["mallet", "glass"] as const) {
    const first = togglePatternCell(before, id, 0, 0);
    const chord = togglePatternCell(first, id, 1, 0);
    expect(chord[id][0][0]).toBe(true);
    expect(chord[id][1][0]).toBe(true);
    expect(before[id][0][0]).toBe(false);
  }
  const seeds = createSeedPatterns();
  seeds.keys[0][0] = true;
  expect(seeds.keys[1][0]).toBe(false);
  expect(createSeedPatterns().keys[0][0]).toBe(false);
});

test("audio starts only on Play and the unchanged mallet loops at exactly 32 steps", async () => {
  const patterns = emptyPatterns();
  paint(patterns, "mallet", "C4", 0);
  paint(patterns, "mallet", "A4", 31);
  expect(TestAudioContext.instances).toHaveLength(0);
  const { context } = await start(patterns);
  expect(context.state).toBe("running");
  expect(context.gains[0].gain.value).toBe(DEFAULT_VOLUME);
  runUntil(context, STEP_SECONDS * 32 + 0.1);
  const voices = carriers(context, "mallet");
  expect(voices.map((voice) => voice.frequency.value)).toEqual([261.626, 440, 261.626]);
  const times = voices.map((voice) => voice.start.mock.calls[0][0]);
  expect(times[0]).toBeCloseTo(0.05);
  expect(times[1]).toBeCloseTo(0.05 + 31 * STEP_SECONDS);
  expect(times[2] - times[0]).toBeCloseTo(32 * STEP_SECONDS);
  expect(onStep).toHaveBeenLastCalledWith(0);
});

test("live edits reach the next unscheduled step without changing the other roles", async () => {
  const patterns = emptyPatterns();
  paint(patterns, "mallet", "C4", 1);
  const { context } = await start(patterns);
  patterns.mallet[row("mallet", "C4")][1] = false;
  paint(patterns, "mallet", "A4", 1);
  paint(patterns, "mallet", "E4", 1);
  paint(patterns, "glass", "C6", 1);
  paint(patterns, "glass", "A5", 1);
  advance(context, 0.15);
  const mallet = carriers(context, "mallet");
  expect(mallet.map((voice) => voice.frequency.value)).toEqual([440, 329.628]);
  expect(carriers(context, "glass")).toHaveLength(6);
  for (const voice of [...mallet, ...carriers(context, "glass")])
    expect(voice.start).toHaveBeenCalledWith(0.05 + STEP_SECONDS);
  expect(sources(context, "keys")).toHaveLength(0);
  expect(sources(context, "bass")).toHaveLength(0);
});

test.each(monoIds)(
  "%s ties notes and damps the old voice completely before a new pitch",
  async (id) => {
    const patterns = emptyPatterns();
    patterns[id][0][0] = patterns[id][0][1] = patterns[id][1][2] = true;
    const { context } = await start(patterns);
    runUntil(context, 0.65);
    const voices = sources(context, id);
    const count = id === "keys" ? 4 : 1;
    expect(voices).toHaveLength(count * 2);
    const change = 0.05 + 2 * STEP_SECONDS;
    expect(voices[0].start).toHaveBeenCalledWith(0.05);
    expect(voices[count].start.mock.calls[0][0]).toBeCloseTo(change);
    expect(voices[0].stop.mock.calls.at(-1)![0]).toBeCloseTo(change);
    for (const voice of voices.slice(0, count))
      expect(voice.stop.mock.calls.at(-1)![0]).toBeLessThanOrEqual(change);
    const gate = context.gains.find((gain) => gain.connections.includes(channel(context, id)))!;
    expect(gate.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, change);
    expect(voices[count].stop.mock.calls.at(-1)![0]).toBeCloseTo(0.05 + 3 * STEP_SECONDS);
  },
);

test.each(monoIds)(
  "%s never makes a chord even if a malformed column contains multiple pitches",
  async (id) => {
    const patterns = emptyPatterns();
    patterns[id][0][0] = patterns[id][1][0] = true;
    const { context } = await start(patterns);
    expect(sources(context, id)).toHaveLength(id === "keys" ? 4 : 1);
    if (id === "keys")
      expect(carriers(context, id)[0].frequency.value).toBe(instrument(id).notes[0].frequency);
  },
);

test.each(monoIds)(
  "%s lets long notes decay naturally and re-articulates them once per loop",
  async (id) => {
    const patterns = emptyPatterns();
    patterns[id][0].fill(true);
    const { context } = await start(patterns);
    runUntil(context, STEP_SECONDS * 64 + 0.1);
    const voices = sources(context, id);
    const count = id === "keys" ? 4 : 1;
    expect(voices).toHaveLength(count * 3);
    for (const voice of voices) {
      expect(voice.stop).toHaveBeenCalledTimes(1);
      expect(voice.stop.mock.calls[0][0] - voice.start.mock.calls[0][0]).toBeLessThan(3);
    }
    expect(voices[count].start.mock.calls[0][0] - voices[0].start.mock.calls[0][0]).toBeCloseTo(
      32 * STEP_SECONDS,
    );
    patterns[id][0][1] = false;
    advance(context, STEP_SECONDS * 64 + 0.15);
    advance(context, STEP_SECONDS * 64 + 0.32);
    expect(sources(context, id)).toHaveLength(voices.length + count);
  },
);

test("pause and resume preserve both mono notes without re-striking or duplicating sources", async () => {
  const patterns = emptyPatterns();
  patterns.mallet.forEach((cells) => cells.fill(true));
  patterns.keys[0].fill(true);
  patterns.bass[0].fill(true);
  const { context, engine } = await start(patterns);
  advance(context, 0.1);
  await engine.pause();
  const count = context.oscillators.length;
  const steps = onStep.mock.calls.length;
  vi.advanceTimersByTime(2000);
  expect(context.state).toBe("suspended");
  expect(context.oscillators).toHaveLength(count);
  expect(onStep).toHaveBeenCalledTimes(steps);
  await engine.play();
  expect(TestAudioContext.instances).toHaveLength(1);
  expect(context.oscillators).toHaveLength(count);
  advance(context, 0.15);
  advance(context, 0.23);
  expect(onStep).toHaveBeenLastCalledWith(1);
  expect(context.oscillators).toHaveLength(count + 5);
  expect(carriers(context, "keys")).toHaveLength(4);
  expect(plucks(context, "bass")).toHaveLength(1);
});

test("the four roles can be muted independently under master volume", async () => {
  const engine = new Sequencer(createSeedPatterns, onStep);
  sequencer = engine;
  engine.setEnabled("glass", false);
  expect(TestAudioContext.instances).toHaveLength(0);
  await engine.play();
  const context = TestAudioContext.instances[0];
  for (const { id } of INSTRUMENTS) {
    expect(channel(context, id).connect).toHaveBeenCalledWith(context.gains[0]);
    expect(channel(context, id).gain.value).toBe(id === "glass" ? 0 : Number(DEFAULT_ENABLED[id]));
  }
  advance(context, 0.23);
  engine.setEnabled("glass", true);
  engine.setEnabled("keys", false);
  engine.setVolume(0);
  expect(channel(context, "glass").gain.setTargetAtTime).toHaveBeenLastCalledWith(1, 0.23, 0.02);
  expect(channel(context, "keys").gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0.23, 0.02);
  expect(context.gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0.23, 0.02);
});

test.each(monoIds)(
  "%s cleans up its sources and local nodes without disconnecting the channel",
  async (id) => {
    const patterns = emptyPatterns();
    patterns[id][0][0] = true;
    const { context } = await start(patterns);
    advance(context, 0.15);
    const end = 0.05 + STEP_SECONDS;
    const voices = sources(context, id);
    expect(voices).toHaveLength(id === "keys" ? 4 : 1);
    for (const voice of voices) {
      expect(voice.stop.mock.calls.at(-1)![0]).toBeCloseTo(end);
      expect(voice.onended).not.toBeNull();
      voice.onended!();
      expect(voice.disconnect).toHaveBeenCalledTimes(1);
    }
    for (const part of [...context.filters, ...context.gains.slice(INSTRUMENTS.length + 1)])
      expect(part.disconnect).toHaveBeenCalledTimes(1);
    expect(channel(context, id).disconnect).not.toHaveBeenCalled();
  },
);

test("the bass's generated string loses energy over time and reuses buffers only for the same pitch", async () => {
  const patterns = emptyPatterns();
  paint(patterns, "bass", "C2", 0);
  paint(patterns, "bass", "C2", 2);
  paint(patterns, "bass", "G2", 4);
  const { context } = await start(patterns);
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

test("nylon has a finite, decaying generated string and reuses only matching pitch buffers", async () => {
  const patterns = emptyPatterns();
  paint(patterns, "nylon", "C4", 0);
  paint(patterns, "nylon", "C4", 2);
  paint(patterns, "nylon", "E5", 4);
  const { context } = await start(patterns);
  runUntil(context, 0.85);
  const voices = plucks(context, "nylon");
  expect(voices).toHaveLength(3);
  expect(voices[0].buffer).toBe(voices[1].buffer);
  expect(voices[2].buffer).not.toBe(voices[0].buffer);
  const data = voices[0].buffer!.getChannelData(0);
  const rms = (values: Float32Array) =>
    Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
  expect(rms(data.slice(0, context.sampleRate * 0.04))).toBeGreaterThan(0.05);
  expect(rms(data.slice(context.sampleRate, context.sampleRate * 1.5))).toBeLessThan(
    rms(data.slice(0, context.sampleRate * 0.1)) / 10,
  );
  expect(data.length / context.sampleRate).toBe(2.2);
});

test("a stalled scheduler skips missed strikes and damps mono notes whose cells have passed", async () => {
  const patterns = emptyPatterns();
  patterns.mallet[0].fill(true);
  patterns.keys[0][0] = patterns.nylon[0][0] = patterns.bass[0][0] = true;
  const { context, engine } = await start(patterns);
  advance(context, 2);
  const time = 0.05 + 12 * STEP_SECONDS;
  const mallet = carriers(context, "mallet");
  expect(mallet).toHaveLength(2);
  expect(mallet[1].start.mock.calls[0][0]).toBeCloseTo(time);
  for (const id of monoIds) {
    const voices = sources(context, id);
    expect(voices).toHaveLength(id === "keys" ? 4 : 1);
    expect(voices[0].stop.mock.calls.at(-1)![0]).toBeCloseTo(time);
  }
  expect(onStep).toHaveBeenLastCalledWith(11);
  const count = context.oscillators.length;
  engine.dispose();
  vi.advanceTimersByTime(1000);
  expect(context.state).toBe("closed");
  expect(context.oscillators).toHaveLength(count);
});
