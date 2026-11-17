import { clamp } from '../core/math';
import type { SpeakerId } from '../story/script';
import { bell, shape } from './instruments';
import { dB, glide, swell, swellEnd, type Kit, type Patch } from './synth';

/**
 * How everyone talks: one short pitched syllable for every few letters of a line. People in the real world
 * have mouths (vowels, breath, a puff of air on consonants) and wander between the notes. Haven's companions
 * are tuned instruments, and every syllable they speak is a note of Haven's own scale.
 */

/** A person: a vocal tract and some breath. */
interface RealVoice {
  readonly kind: 'real';
  /** Hz at the middle of the speaker's range. */
  readonly base: number;
  /** Size of the mouth and throat: above 1 is smaller, so every vowel sits higher. */
  readonly tract: number;
  /** How fast the upper harmonics fall away: more is darker and warmer. */
  readonly tilt: number;
  /** Air mixed into the tone. */
  readonly breath: number;
  /** Peak level in dB. */
  readonly level: number;
  /** Seconds a syllable lasts. */
  readonly length: number;
  /** Semitones between the lowest and highest syllable. */
  readonly span: number;
  /** Semitones each syllable slides before it settles. */
  readonly scoop: number;
}

/** A companion: an instrument that only plays the notes of Haven. */
interface HavenVoice {
  readonly kind: 'haven';
  readonly base: number;
  /** The semitones from `base` this voice may land on. */
  readonly scale: readonly number[];
  readonly level: number;
  readonly timbre: 'bell' | 'round' | 'glass';
}

export const VOICES: Record<SpeakerId, RealVoice | HavenVoice> = {
  teacher: { kind: 'real', base: 210, tract: 1.1, tilt: 1.3, breath: 0.05, level: -16.5, length: 0.088, span: 5, scoop: 0.8 },
  jamie: { kind: 'real', base: 260, tract: 1.22, tilt: 1.0, breath: 0.16, level: -17, length: 0.076, span: 6, scoop: 1.2 },
  you: { kind: 'real', base: 300, tract: 1.18, tilt: 1.2, breath: 0.08, level: -22.5, length: 0.07, span: 4, scoop: 0.7 },
  alex: { kind: 'real', base: 345, tract: 1.32, tilt: 0.85, breath: 0.09, level: -17.5, length: 0.068, span: 5, scoop: 1.4 },
  sam: { kind: 'real', base: 290, tract: 1.25, tilt: 0.95, breath: 0.2, level: -18.5, length: 0.082, span: 7, scoop: 1.0 },
  riley: { kind: 'real', base: 245, tract: 1.15, tilt: 1.25, breath: 0.07, level: -17, length: 0.092, span: 4, scoop: 0.6 },
  // C5, G3 and A4: each companion's scale is drawn from the five notes Haven's bells play
  lumi: { kind: 'haven', base: 523.25, scale: [-5, -3, 0, 2, 4, 7, 9], level: -15, timbre: 'bell' },
  // Lumi's notes, a semitone flat and always a little too even
  spark: { kind: 'haven', base: 493.88, scale: [-5, -3, 0, 2, 4, 7, 9], level: -15, timbre: 'glass' },
  kai: { kind: 'haven', base: 196, scale: [-5, -3, 0, 2, 4, 7], level: -16.5, timbre: 'round' },
  nova: { kind: 'haven', base: 440, scale: [-5, -2, 0, 3, 5, 7], level: -13, timbre: 'glass' },
};

/** Each speaker reads the alphabet as a different tune. */
const PHASE = Object.fromEntries(Object.keys(VOICES).map((id, i) => [id, i * 1.7])) as Record<SpeakerId, number>;

const VOWEL_LETTERS = 'aeiou';
type VowelLetter = 'a' | 'e' | 'i' | 'o' | 'u';

/** The first three resonances of an adult mouth for each vowel, in Hz. */
const FORMANTS: Record<VowelLetter, readonly [number, number, number]> = {
  a: [730, 1090, 2440],
  e: [530, 1840, 2480],
  i: [290, 2250, 2900],
  o: [570, 840, 2410],
  u: [320, 870, 2240],
};
const FORMANT_STRENGTH = [1, 0.6, 0.3] as const;
const FORMANT_WIDTH = [110, 140, 220] as const;

/** Where a character falls in a speaker's range, from -1 to 1. Fixed for each letter, so a line always has the same tune. */
const contour = (speaker: SpeakerId, char: string): number => {
  const letter = char.toLowerCase();
  // the golden angle scatters neighbouring letters across the range
  const x = (letter.charCodeAt(0) || 0) * 2.399963 + PHASE[speaker];
  // vowels carry the stress, so they sit a little higher
  const lift = VOWEL_LETTERS.includes(letter) ? 0.3 : 0;
  return clamp(0.7 * Math.sin(x) + 0.3 * Math.sin(x * 2.7 + 1) + lift, -1, 1);
};

/** The pitch in Hz of one syllable: decided by who is speaking and which character, and by nothing else. */
export const syllablePitch = (speaker: SpeakerId, char: string): number => {
  const v = VOICES[speaker], c = contour(speaker, char);
  if (v.kind === 'haven') return v.base * 2 ** (v.scale[Math.round(((c + 1) / 2) * (v.scale.length - 1))]! / 12);
  return v.base * 2 ** ((c * v.span) / 24);
};

/** The vowel a character is spoken on: its own if it is one, otherwise whichever its code lands on. */
const vowelOf = (letter: string): VowelLetter => {
  const index = VOWEL_LETTERS.indexOf(letter);
  return VOWEL_LETTERS[index >= 0 ? index : (letter.charCodeAt(0) || 0) % 5] as VowelLetter;
};

/** One period of a speaker's voice on a vowel: a falling series of harmonics, lifted where the mouth resonates. */
const vowelWave = (kit: Kit, speaker: SpeakerId, v: RealVoice, vowel: VowelLetter): PeriodicWave =>
  kit.wave(`voice:${speaker}:${vowel}`, () =>
    Array.from({ length: Math.min(40, Math.floor(4200 / v.base)) }, (_, k) => {
      const f = (k + 1) * v.base;
      let lift = 0.3;
      FORMANTS[vowel].forEach((centre, j) => {
        const d = (f - centre * v.tract) / (FORMANT_WIDTH[j]! * v.tract);
        lift += FORMANT_STRENGTH[j]! * Math.exp(-0.5 * d * d);
      });
      return lift / (k + 1) ** v.tilt;
    }),
  );

// ---------------------------------------------------------------------------------------- recorded keystrokes

/** Single keystrokes cut from the team's keyboard recording: real-world people "type" their lines. */
const KEY_URLS = Array.from({ length: 8 }, (_, i) => new URL(`./keys/key-${i + 1}.wav`, import.meta.url).href);
let keyBuffers: AudioBuffer[] | null = null;
let keysLoading: Promise<void> | null = null;

/** Starts loading the keystroke samples; until they arrive, people speak with the synthesised voice. */
export const loadKeySamples = (ctx: BaseAudioContext): Promise<void> =>
  (keysLoading ??= Promise.all(KEY_URLS.map(async (url) => ctx.decodeAudioData(await (await fetch(url)).arrayBuffer())))
    .then((buffers) => void (keyBuffers = buffers))
    .catch((e: unknown) => console.warn('Keystroke samples did not load; using the synthesised voice.', e)));

/** One syllable as one keystroke, chosen by the letter and pitched by the speaker, so each person types in their own key. */
const speakKey = (p: Patch, speaker: SpeakerId, v: RealVoice, char: string, keys: AudioBuffer[]): void => {
  const code = char.toLowerCase().charCodeAt(0) || 0;
  const buffer = keys[(code * 5 + PHASE[speaker] * 3) % keys.length | 0]!;
  // the speaker's pitch moves the keystroke gently: higher voices type a little brighter, lower ones a little deeper
  const rate = (syllablePitch(speaker, char) / 260) ** 0.45;
  const amp = p.gain(dB(v.level + 4));
  p.play(buffer, p.t, rate).connect(amp).connect(p.mix(0.12));
};

const speakReal = (p: Patch, speaker: SpeakerId, v: RealVoice, char: string): void => {
  const t = p.t, letter = char.toLowerCase(), f = syllablePitch(speaker, char);
  const vowel = vowelOf(letter), open = VOWEL_LETTERS.includes(letter), level = dB(v.level);
  // a consonant closes the mouth first, so the tone arrives a little later
  const attack = open ? 0.012 : 0.02, hold = v.length * 0.35, release = v.length * 0.5, end = swellEnd(t, attack, hold, release);

  const tone = p.osc(vowelWave(p.kit, speaker, v, vowel), f, t, end), amp = p.gain(0);
  // speech never lands on a pitch: each syllable slides into place, up or down
  const scoop = (letter.charCodeAt(0) || 0) % 2 ? v.scoop : -0.6 * v.scoop;
  glide(tone.frequency, t, f * 2 ** (-scoop / 12), f, v.length * 0.45);
  swell(amp.gain, t, level, attack, hold, release);
  tone.connect(amp).connect(p.out);

  const air = p.gain(0);
  swell(air.gain, t, level * v.breath * 6, 0.01, hold, release);
  p.noise('pink', t, end).connect(p.filter('bandpass', FORMANTS[vowel][1] * v.tract, 1.5)).connect(air).connect(p.out);
  if (!open) p.hiss('white', t, 0.022, level * 0.5).amp.connect(p.filter('highpass', 2800, 0)).connect(p.out);
};

const speakHaven = (p: Patch, speaker: SpeakerId, v: HavenVoice, char: string): void => {
  const t = p.t, f = syllablePitch(speaker, char), level = dB(v.level);
  if (v.timbre === 'bell') {
    // a small bell for every syllable, left to ring into the next
    const m = p.mix(0.35);
    bell(p, m, t, f, { level, dur: 0.17, ratio: 2, index: 1.1 });
    p.tone('sine', f * 2, t, 0.07, level * 0.2).amp.connect(m);
  } else if (v.timbre === 'round') {
    const end = swellEnd(t, 0.012, 0.03, 0.05), tone = p.osc(shape(p.kit, 'hollow'), f, t, end), amp = p.gain(0);
    glide(tone.frequency, t, f * 1.03, f, 0.04);
    swell(amp.gain, t, level, 0.012, 0.03, 0.05);
    tone.connect(p.filter('lowpass', f * 3.2, 0)).connect(amp).connect(p.mix(0.12));
  } else {
    const { osc, amp } = p.tone(shape(p.kit, 'glass'), f, t, 0.13, level, 0.008);
    glide(osc.frequency, t, f * 0.97, f, 0.03);
    amp.connect(p.mix(0.2));
  }
};

/** Adds one syllable of `speaker` saying `char` to a patch. */
export const speak = (p: Patch, speaker: SpeakerId, char: string): void => {
  const v = VOICES[speaker];
  if (v.kind === 'real') {
    if (keyBuffers) speakKey(p, speaker, v, char, keyBuffers);
    else speakReal(p, speaker, v, char);
  }
  else speakHaven(p, speaker, v, char);
};
