export function scheduleMallet(
  context: BaseAudioContext,
  output: AudioNode,
  frequency: number,
  time: number,
  gain = 1,
) {
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  const gate = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  envelope.gain.setValueAtTime(0, time);
  envelope.gain.linearRampToValueAtTime(0.12 * gain, time + 0.02);
  envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.85);
  envelope.gain.linearRampToValueAtTime(0, time + 0.9);
  oscillator.connect(envelope).connect(gate).connect(output);
  oscillator.start(time);
  oscillator.stop(time + 0.9);
  oscillator.onended = () => {
    oscillator.disconnect();
    envelope.disconnect();
    gate.disconnect();
  };
  return damper(gate, [{ source: oscillator, end: time + 0.9 }], time);
}

type TimedSource = { source: AudioScheduledSourceNode; end: number };

// Damp a voice at its gate end (or the next bass onset). The short fade avoids clicks.
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
  gain: number,
) {
  const gate = context.createGain();
  gate.connect(output);
  const sources = partials.map(([ratio, peak, duration], index) => {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.frequency.value = frequency * ratio;
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(peak * gain, time + 0.008);
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
  gain = 1,
) {
  return ringPartials(
    context,
    output,
    frequency,
    time,
    [
      [1, 0.065, 2.4],
      [2.003, 0.014, 0.9],
      [3.009, 0.0045, 0.5],
      [4.02, 0.0015, 0.3],
    ],
    gain,
  );
}

export function scheduleGlass(
  context: BaseAudioContext,
  output: AudioNode,
  frequency: number,
  time: number,
  gain = 1,
) {
  // Inharmonic modes give these high accents a glass-like, rather than keyboard, color.
  return ringPartials(
    context,
    output,
    frequency,
    time,
    [
      [1, 0.035, 2.8],
      [2.76, 0.008, 0.9],
      [5.4, 0.002, 0.3],
    ],
    gain,
  );
}

const BASS = { seconds: 2.8, peak: 0.13, cutoff: 700, attack: 0.01 };
const plucks = new WeakMap<BaseAudioContext, Map<number, AudioBuffer>>();

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
      Math.ceil(context.sampleRate * BASS.seconds),
      context.sampleRate,
    );
    const data = buffer.getChannelData(0);
    let seed = 42;
    const delay = Math.round(context.sampleRate / frequency - 0.5);
    for (let i = 0; i < delay; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const phase = (2 * Math.PI * i) / (delay + 0.5);
      data[i] = 0.7 * Math.sin(phase) + 0.22 * Math.sin(phase * 2) + 0.05 * (seed / 2 ** 32 - 0.5);
    }
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
  gain = 1,
) {
  const voice = BASS;
  const source = context.createBufferSource();
  const body = context.createBiquadFilter();
  const envelope = context.createGain();
  const gate = context.createGain();
  source.buffer = pluckedString(context, frequency);
  body.type = "lowpass";
  body.frequency.value = voice.cutoff;
  body.Q.value = 0.5;
  envelope.gain.setValueAtTime(0, time);
  envelope.gain.linearRampToValueAtTime(voice.peak * gain, time + voice.attack);
  envelope.gain.setValueAtTime(voice.peak * gain, time + voice.seconds - 0.08);
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
