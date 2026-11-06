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

function ringPartials(
  context: BaseAudioContext,
  output: AudioNode,
  frequency: number,
  time: number,
  partials: readonly (readonly [ratio: number, peak: number, duration: number])[],
) {
  for (const [ratio, peak, duration] of partials) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.frequency.value = frequency * ratio;
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(peak, time + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    envelope.gain.linearRampToValueAtTime(0, time + duration + 0.03);
    oscillator.connect(envelope).connect(output);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.03);
    oscillator.onended = () => {
      oscillator.disconnect();
      envelope.disconnect();
    };
  }
}

export function startFeltKeys(
  context: BaseAudioContext,
  output: AudioNode,
  frequency: number,
  time: number,
) {
  ringPartials(context, output, frequency, time, [
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
) {
  const source = context.createBufferSource();
  const body = context.createBiquadFilter();
  const envelope = context.createGain();
  const gate = context.createGain();
  const end = time + BASS.seconds;
  source.buffer = pluckedString(context, frequency);
  body.type = "lowpass";
  body.frequency.value = BASS.cutoff;
  body.Q.value = 0.5;
  envelope.gain.setValueAtTime(0, time);
  envelope.gain.linearRampToValueAtTime(BASS.peak, time + BASS.attack);
  envelope.gain.setValueAtTime(BASS.peak, end - 0.08);
  envelope.gain.linearRampToValueAtTime(0, end);
  source.connect(body).connect(envelope).connect(gate).connect(output);
  source.start(time);
  source.stop(end);
  source.onended = () => {
    source.disconnect();
    body.disconnect();
    envelope.disconnect();
    gate.disconnect();
  };
  // Fade out at the next bass onset without touching notes that have already ended.
  return (next: number) => {
    if (next >= end) return;
    gate.gain.setValueAtTime(1, Math.max(time, next - 0.008));
    gate.gain.linearRampToValueAtTime(0, next);
    source.stop(next);
  };
}
