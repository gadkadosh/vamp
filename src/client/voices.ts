export function scheduleMallet(
  context: BaseAudioContext,
  output: AudioNode,
  frequency: number,
  time: number,
) {
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  envelope.gain.setValueAtTime(0, time);
  envelope.gain.linearRampToValueAtTime(0.12, time + 0.02);
  envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.85);
  envelope.gain.linearRampToValueAtTime(0, time + 0.9);
  oscillator.connect(envelope).connect(output);
  oscillator.start(time);
  oscillator.stop(time + 0.9);
  oscillator.onended = () => {
    oscillator.disconnect();
    envelope.disconnect();
  };
}

type TimedSource = { source: AudioScheduledSourceNode; end: number };

// Damp just before a note change: the next melody/bass note never forms a chord
// with the previous note's tail. The short fade avoids an abrupt click.
function damper(gate: GainNode, sources: TimedSource[], start: number) {
  const end = Math.max(...sources.map((item) => item.end));
  return (time: number) => {
    if (time >= end) return;
    gate.gain.setValueAtTime(1, Math.max(start, time - 0.008));
    gate.gain.linearRampToValueAtTime(0, time);
    for (const item of sources) if (time < item.end) item.source.stop(time);
  };
}

function ringPartials(
  context: BaseAudioContext,
  output: AudioNode,
  frequency: number,
  time: number,
  partials: readonly (readonly [ratio: number, peak: number, duration: number])[],
) {
  const gate = context.createGain();
  gate.connect(output);
  const sources = partials.map(([ratio, peak, duration], index) => {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.frequency.value = frequency * ratio;
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(peak, time + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    envelope.gain.linearRampToValueAtTime(0, time + duration + 0.03);
    oscillator.connect(envelope).connect(gate);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.03);
    oscillator.onended = () => {
      oscillator.disconnect();
      envelope.disconnect();
      if (index === 0) gate.disconnect(); // Fundamental is the longest-lived partial.
    };
    return { source: oscillator, end: time + duration + 0.03 };
  });
  return damper(gate, sources, time);
}

export function startFeltKeys(
  context: BaseAudioContext,
  output: AudioNode,
  frequency: number,
  time: number,
) {
  return ringPartials(context, output, frequency, time, [
    [1, 0.065, 2.4],
    [2.003, 0.014, 0.9],
    [3.009, 0.0045, 0.5],
    [4.02, 0.0015, 0.3],
  ]);
}

export function scheduleGlass(
  context: BaseAudioContext,
  output: AudioNode,
  frequency: number,
  time: number,
) {
  // Inharmonic modes give these high accents a glass-like, rather than keyboard, color.
  ringPartials(context, output, frequency, time, [
    [1, 0.035, 2.8],
    [2.76, 0.008, 0.9],
    [5.4, 0.002, 0.3],
  ]);
}

const STRINGS = {
  bass: { seconds: 2.8, peak: 0.13, cutoff: 700, attack: 0.01 },
  nylon: { seconds: 2.2, peak: 0.16, cutoff: 4800, attack: 0.004 },
} as const;
type StringKind = keyof typeof STRINGS;
const plucks = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

function pluckedString(context: BaseAudioContext, frequency: number, kind: StringKind) {
  let cache = plucks.get(context);
  if (!cache) {
    cache = new Map();
    plucks.set(context, cache);
  }
  const key = `${kind}:${frequency}`;
  let buffer = cache.get(key);
  if (!buffer) {
    buffer = context.createBuffer(
      1,
      Math.ceil(context.sampleRate * STRINGS[kind].seconds),
      context.sampleRate,
    );
    const data = buffer.getChannelData(0);
    let seed = 42;
    if (kind === "bass") {
      const delay = Math.round(context.sampleRate / frequency - 0.5);
      for (let i = 0; i < delay; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const phase = (2 * Math.PI * i) / (delay + 0.5);
        data[i] =
          0.7 * Math.sin(phase) + 0.22 * Math.sin(phase * 2) + 0.05 * (seed / 2 ** 32 - 0.5);
      }
      const damping = Math.exp(-1 / (frequency * 1.2));
      for (let i = delay; i < data.length; i++) {
        data[i] = damping * 0.5 * (data[i - delay] + (i > delay ? data[i - delay - 1] : 0));
      }
    } else {
      // A triangular displacement models a pluck partway along a nylon string.
      // Fractional delay keeps higher melody pitches in tune between sample positions.
      const period = context.sampleRate / frequency - 0.5;
      const delay = Math.floor(period);
      const fraction = period - delay;
      const initial = delay + 2;
      for (let i = 0; i < initial; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const phase = (i / (period + 0.5)) % 1;
        const displacement = phase < 0.22 ? phase / 0.22 : (1 - phase) / 0.78;
        data[i] = displacement - 0.5 + 0.012 * (seed / 2 ** 32 - 0.5);
      }
      const mean = data.slice(0, initial).reduce((sum, value) => sum + value, 0) / initial;
      for (let i = 0; i < initial; i++) data[i] -= mean;
      const damping = Math.exp(-1 / frequency);
      for (let i = initial; i < data.length; i++) {
        const first = data[i - delay] * (1 - fraction) + data[i - delay - 1] * fraction;
        const second = data[i - delay - 1] * (1 - fraction) + data[i - delay - 2] * fraction;
        data[i] = damping * 0.5 * (first + second);
      }
    }
    cache.set(key, buffer);
  }
  return buffer;
}

function startPluck(
  context: BaseAudioContext,
  output: AudioNode,
  frequency: number,
  time: number,
  kind: StringKind,
) {
  const voice = STRINGS[kind];
  const source = context.createBufferSource();
  const body = context.createBiquadFilter();
  const envelope = context.createGain();
  const gate = context.createGain();
  source.buffer = pluckedString(context, frequency, kind);
  body.type = "lowpass";
  body.frequency.value = voice.cutoff;
  body.Q.value = 0.5;
  envelope.gain.setValueAtTime(0, time);
  envelope.gain.linearRampToValueAtTime(voice.peak, time + voice.attack);
  envelope.gain.setValueAtTime(voice.peak, time + voice.seconds - 0.08);
  envelope.gain.linearRampToValueAtTime(0, time + voice.seconds);
  source.connect(body).connect(envelope).connect(gate).connect(output);
  source.start(time);
  source.stop(time + voice.seconds);
  source.onended = () => {
    source.disconnect();
    body.disconnect();
    envelope.disconnect();
    gate.disconnect();
  };
  return damper(gate, [{ source, end: time + voice.seconds }], time);
}

export function startBass(
  context: BaseAudioContext,
  output: AudioNode,
  frequency: number,
  time: number,
) {
  return startPluck(context, output, frequency, time, "bass");
}

export function startNylon(
  context: BaseAudioContext,
  output: AudioNode,
  frequency: number,
  time: number,
) {
  return startPluck(context, output, frequency, time, "nylon");
}
