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

const plucks = new WeakMap<BaseAudioContext, Map<number, AudioBuffer>>();
const BASS_SECONDS = 2.8;

function pluckedString(context: BaseAudioContext, frequency: number) {
  let cache = plucks.get(context);
  if (!cache) {
    cache = new Map();
    plucks.set(context, cache);
  }
  let buffer = cache.get(frequency);
  if (!buffer) {
    buffer = context.createBuffer(
      1,
      Math.ceil(context.sampleRate * BASS_SECONDS),
      context.sampleRate,
    );
    const data = buffer.getChannelData(0);
    const delay = Math.round(context.sampleRate / frequency - 0.5);
    let seed = 42;
    for (let i = 0; i < delay; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const phase = (2 * Math.PI * i) / (delay + 0.5);
      data[i] = 0.7 * Math.sin(phase) + 0.22 * Math.sin(phase * 2) + 0.05 * (seed / 2 ** 32 - 0.5);
    }
    // Karplus–Strong-style string decay: each trip around the string loses a
    // little energy and more high frequencies. No steady oscillator underneath.
    const damping = Math.exp(-1 / (frequency * 1.2));
    for (let i = delay; i < data.length; i++) {
      data[i] = damping * 0.5 * (data[i - delay] + (i > delay ? data[i - delay - 1] : 0));
    }
    cache.set(frequency, buffer);
  }
  return buffer;
}

export function startBass(
  context: BaseAudioContext,
  output: AudioNode,
  frequency: number,
  time: number,
) {
  const source = context.createBufferSource();
  const body = context.createBiquadFilter();
  const envelope = context.createGain();
  const gate = context.createGain();
  source.buffer = pluckedString(context, frequency);
  body.type = "lowpass";
  body.frequency.value = 700;
  body.Q.value = 0.5;
  envelope.gain.setValueAtTime(0, time);
  envelope.gain.linearRampToValueAtTime(0.13, time + 0.01);
  envelope.gain.setValueAtTime(0.13, time + BASS_SECONDS - 0.08);
  envelope.gain.linearRampToValueAtTime(0, time + BASS_SECONDS);
  source.connect(body).connect(envelope).connect(gate).connect(output);
  source.start(time);
  source.stop(time + BASS_SECONDS);
  source.onended = () => {
    source.disconnect();
    body.disconnect();
    envelope.disconnect();
    gate.disconnect();
  };
  return damper(gate, [{ source, end: time + BASS_SECONDS }], time);
}
