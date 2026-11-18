import { RAMP, fall, glide, mtof, rise, swellEnd, type Kit, type Patch } from './synth';

const series = (count: number, strength: (n: number) => number): number[] => Array.from({ length: count }, (_, i) => strength(i + 1));

const SHAPES = {
  soft: () => series(14, (n) => 1 / n ** 1.7),
  hollow: () => series(11, (n) => (n % 2 ? 1 / n ** 1.5 : 0.03 / n)),
  glass: () => [1, 0.3, 0.1, 0.14, 0, 0.05],
  reed: () => series(12, (n) => 1 / n ** 1.15),
  piano: () => [1, 0.5, 0.28, 0.17, 0.1, 0.07, 0.04, 0.03],
} as const;

export type Shape = keyof typeof SHAPES;

export const shape = (kit: Kit, name: Shape): PeriodicWave => kit.wave(name, SHAPES[name]);

export interface BellOptions {
  level: number;
  dur: number;
  ratio?: number;
  index?: number;
  attack?: number;
  cents?: number;
}

export const bell = (p: Patch, dest: AudioNode, t: number, freq: number, o: BellOptions): void => {
  const ratio = o.ratio ?? 3.5;
  const index = (o.index ?? 1.2) * Math.min(1, 1400 / freq);
  const { osc, amp } = p.tone('sine', freq, t, o.dur, o.level, o.attack, o.cents);
  p.tone('sine', freq * ratio, t, o.dur * 0.55, freq * ratio * index, RAMP, o.cents).amp.connect(osc.frequency);
  amp.connect(dest);
};

export const sparkle = (p: Patch, dest: AudioNode, t: number, freqs: readonly number[], spacing: number, level: number, dur = 0.5): void => {
  const sides = [p.pan(-0.55), p.pan(0.55)];
  for (const s of sides) s.connect(dest);
  freqs.forEach((f, i) => bell(p, sides[i % 2]!, t + i * spacing, f, { level: level * (1 - (0.5 * i) / freqs.length), dur, ratio: 2, index: 0.8 }));
};

export const kalimba = (p: Patch, dest: AudioNode, t: number, freq: number, level: number): void => {
  const ring = 2.4 * (330 / freq) ** 0.3;
  p.tone('sine', freq, t, ring, level, 0.005).amp.connect(dest);
  p.tone('sine', freq * 2, t, ring * 0.35, level * 0.16, 0.005).amp.connect(dest);
  p.tone('sine', freq * 5.43, t, 0.1, level * 0.2).amp.connect(dest);
  p.hiss('pink', t, 0.035, level * 0.6).amp.connect(p.filter('bandpass', 1900, 1.4)).connect(dest);
};

export const piano = (p: Patch, dest: AudioNode, t: number, freq: number, level: number): void => {
  const ring = 4.2 * (220 / freq) ** 0.35;
  const felt = p.filter('lowpass', freq * 7, -2);
  glide(felt.frequency, t, Math.min(9000, freq * 7), freq * 1.6, ring * 0.5);
  for (const cents of [-3, 3.5]) p.tone(shape(p.kit, 'piano'), freq, t, ring, level * 0.5, 0.006, cents).amp.connect(felt);
  p.hiss('pink', t, 0.045, level * 0.2).amp.connect(p.filter('lowpass', 1100, 0)).connect(dest);
  felt.connect(dest);
};

export const pluck = (p: Patch, dest: AudioNode, t: number, freq: number, level: number): void => {
  const snap = p.filter('lowpass', freq * 6, 3);
  glide(snap.frequency, t, Math.min(8000, freq * 6), freq * 1.5, 0.14);
  p.tone(shape(p.kit, 'reed'), freq, t, 0.26, level, 0.005).amp.connect(snap).connect(dest);
};

export const tick = (p: Patch, dest: AudioNode, t: number, level: number, corner = 7000, dur = 0.035): void => {
  p.hiss('white', t, dur, level).amp.connect(p.filter('highpass', corner, 0)).connect(dest);
};

export const thump = (p: Patch, dest: AudioNode, t: number, from: number, to: number, dur: number, level: number): void => {
  const { osc, amp } = p.tone('sine', from, t, dur, level, 0.005);
  glide(osc.frequency, t, from, to, dur * 0.7);
  amp.connect(dest);
};

export const drip = (p: Patch, dest: AudioNode, t: number, freq: number, level: number): void => {
  for (const [delay, f, l] of [[0, freq, level], [0.07, freq * 1.22, level * 0.4]] as const) {
    const { osc, amp } = p.tone('sine', f, t + delay, 0.09, l);
    glide(osc.frequency, t + delay, f, f * 1.4, 0.03);
    amp.connect(dest);
  }
};

export interface SwellOptions {
  level: number;
  attack: number;
  hold?: number;
  release: number;
}

export type LetGo = (at: number) => void;

const sustain = (gains: readonly GainNode[], t: number, o: SwellOptions): { end: number | undefined; letGo: LetGo } => {
  for (const g of gains) rise(g.gain, t, o.level, o.attack);
  const letGo: LetGo = (at) => {
    for (const g of gains) fall(g.gain, at, o.level, o.release);
  };
  if (o.hold === undefined) return { end: undefined, letGo };
  letGo(t + Math.max(o.attack, RAMP) + Math.max(o.hold, 0.001));
  return { end: swellEnd(t, o.attack, o.hold, o.release), letGo };
};

export interface PadOptions extends SwellOptions {
  wave: PeriodicWave;
  detune: number;
}

export const padChord = (p: Patch, left: AudioNode, right: AudioNode, t: number, midi: readonly number[], o: PadOptions): LetGo => {
  const sides = [p.gain(0), p.gain(0)];
  const { end, letGo } = sustain(sides, t, o);
  midi.forEach((n, i) => {
    p.osc(o.wave, mtof(n), t, end, -o.detune * (1 + 0.15 * i)).connect(sides[i % 2]!);
    p.osc(o.wave, mtof(n), t, end, o.detune).connect(sides[(i + 1) % 2]!);
  });
  sides[0]!.connect(left);
  sides[1]!.connect(right);
  return letGo;
};

const VOWELS = {
  ah: [[800, 6, 1], [1150, 8, 0.5], [2900, 10, 0.12]],
  oo: [[350, 5, 1], [750, 7, 0.3], [2700, 10, 0.03]],
} as const;

export type Vowel = keyof typeof VOWELS;

export const formants = (p: Patch, dest: AudioNode, vowel: Vowel): GainNode => {
  const input = p.gain(1);
  for (const [centre, q, strength] of VOWELS[vowel]) input.connect(p.filter('bandpass', centre, q)).connect(p.gain(strength)).connect(dest);
  return input;
};

export const choir = (p: Patch, dest: AudioNode, t: number, midi: readonly number[], o: SwellOptions): LetGo => {
  const breath = p.gain(0);
  const { end, letGo } = sustain([breath], t, o);
  midi.forEach((n, i) => {
    const vibrato = p.lfo(4.6 + 0.55 * i, 7, t, end);
    for (const cents of [-8, 8]) {
      const voice = p.osc(shape(p.kit, 'reed'), mtof(n), t, end, cents);
      vibrato.connect(voice.detune);
      voice.connect(breath);
    }
  });
  breath.connect(dest);
  return letGo;
};
