import { vi } from "vite-plus/test";
import { INSTRUMENT_IDS } from "../src/client/score";
import type { InstrumentId } from "../src/client/score";

export function deferred() {
  let resolve: () => void;
  const promise = new Promise<void>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve: () => resolve() };
}

function parameter(value = 0) {
  return {
    value,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
  };
}

function node() {
  const connections: unknown[] = [];
  return {
    connections,
    connect: vi.fn((target: unknown) => {
      connections.push(target);
      return target;
    }),
    disconnect: vi.fn(),
  };
}

function gain() {
  return { ...node(), gain: parameter(1) };
}

function oscillator() {
  return {
    ...node(),
    type: "sine",
    frequency: parameter(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null as (() => void) | null,
  };
}

function filter() {
  return { ...node(), type: "lowpass", frequency: parameter(), Q: parameter(1) };
}

type TestBuffer = {
  length: number;
  sampleRate: number;
  getChannelData: (channel: number) => Float32Array;
};

function bufferSource() {
  return {
    ...node(),
    buffer: null as TestBuffer | null,
    start: vi.fn(),
    stop: vi.fn(),
    onended: null as (() => void) | null,
  };
}

// Only the clock and Web Audio boundary are fake; voices and scheduling run unchanged.
export class TestAudioContext {
  static instances: TestAudioContext[] = [];
  currentTime = 0;
  state = "suspended";
  sampleRate = 8000;
  destination = node();
  oscillators: ReturnType<typeof oscillator>[] = [];
  gains: ReturnType<typeof gain>[] = [];
  filters: ReturnType<typeof filter>[] = [];
  bufferSources: ReturnType<typeof bufferSource>[] = [];

  constructor() {
    TestAudioContext.instances.push(this);
  }

  createGain() {
    const result = gain();
    this.gains.push(result);
    return result;
  }

  createOscillator() {
    const result = oscillator();
    this.oscillators.push(result);
    return result;
  }

  createBiquadFilter() {
    const result = filter();
    this.filters.push(result);
    return result;
  }

  createBufferSource() {
    const result = bufferSource();
    this.bufferSources.push(result);
    return result;
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, sampleRate, getChannelData: (channel: number) => data[channel] };
  }

  async resume() {
    this.state = "running";
  }

  async suspend() {
    this.state = "suspended";
  }

  async close() {
    this.state = "closed";
  }
}

export function channel(context: TestAudioContext, id: InstrumentId) {
  return context.gains[1 + INSTRUMENT_IDS.indexOf(id)];
}

export function routesTo(
  source: ReturnType<typeof node>,
  target: ReturnType<typeof node>,
): boolean {
  return source.connections.some((connection) => {
    if (connection === target) return true;
    return (
      typeof connection === "object" &&
      connection !== null &&
      "connections" in connection &&
      routesTo(connection as ReturnType<typeof node>, target)
    );
  });
}

export function carriers(context: TestAudioContext, id: InstrumentId) {
  return context.oscillators.filter((source) => routesTo(source, channel(context, id)));
}

export function plucks(context: TestAudioContext, id: InstrumentId) {
  return context.bufferSources.filter((source) => routesTo(source, channel(context, id)));
}
