import { Rng } from '../core/math';

/**
 * What every sound is built from: pitch and level helpers, envelopes that cannot click, shared noise and
 * wave shapes, and the Patch that owns the nodes of one sound from its first sample to its teardown.
 */

// ---------------------------------------------------------------------------------------------------- pitch and level

/** MIDI note number to frequency in Hz (69 is A4, 440 Hz). */
export const mtof = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

const LETTERS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** MIDI numbers for space-separated note names: `notes('C3 F#4')` is [48, 66]. */
export const notes = (names: string): number[] =>
  names.split(' ').map((name) => {
    const m = /^([A-G])(#?)(-?\d)$/.exec(name);
    if (!m) throw new Error(`not a note name: "${name}"`);
    return (LETTERS[m[1]!] ?? 0) + (m[2] ? 1 : 0) + 12 * (Number(m[3]) + 1);
  });

export const note = (name: string): number => notes(name)[0]!;

/** Decibels to linear gain. */
export const dB = (value: number): number => 10 ** (value / 20);

/** The notes of the major pentatonic on `root` (any octave) that lie between two MIDI numbers, low to high. */
export const pentatonic = (root: number, low: number, high: number): number[] => {
  const out: number[] = [];
  for (let n = low; n <= high; n++) if ([0, 2, 4, 7, 9].includes((((n - root) % 12) + 12) % 12)) out.push(n);
  return out;
};

const hashString = (text: string): number => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};

// ---------------------------------------------------------------------------------------------------- envelopes

/** The shortest ramp any envelope uses: instant to the ear, but never a click. */
export const RAMP = 0.004;
/** How long a source keeps running past its envelope, so that its stop always lands on silence. */
export const SLACK = 0.012;

const CURVE_POINTS = 33;
const curve = (shape: (k: number) => number): Float32Array<ArrayBuffer> =>
  Float32Array.from({ length: CURVE_POINTS }, (_, i) => shape(i / (CURVE_POINTS - 1)));

/** Equal-power crossfade halves: two unrelated sounds swapped with these keep their combined loudness. */
export const FADE_IN = curve((k) => Math.sin((k * Math.PI) / 2));
export const FADE_OUT = curve((k) => Math.cos((k * Math.PI) / 2));
const RISE = curve((k) => 0.5 - 0.5 * Math.cos(k * Math.PI));

/**
 * A struck or plucked shape: silence, up to `peak` in `attack`, then an exponential fall that is 60 dB down
 * at `t + dur` and exactly zero a moment later.
 */
export const perc = (param: AudioParam, t: number, peak: number, dur: number, attack = RAMP): void => {
  const a = Math.max(attack, RAMP), top = Math.max(peak, 1e-6), fall = Math.max(dur, a + 0.01);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(top, t + a);
  param.exponentialRampToValueAtTime(top * 0.001, t + fall);
  param.linearRampToValueAtTime(0, t + fall + RAMP);
};

/** The way into a bowed or breathed sound: from rest at zero up to `peak` over `attack`, level at both ends. */
export const rise = (param: AudioParam, t: number, peak: number, attack: number): void => {
  param.setValueCurveAtTime(RISE.map((v) => v * peak), t, Math.max(attack, RAMP));
};

/** The way out: from `peak` down to nothing over `release`. Scheduled once the sound is to be let go. */
export const fall = (param: AudioParam, at: number, peak: number, release: number): void => {
  param.setValueCurveAtTime(RISE.map((v) => v * peak).reverse(), at, Math.max(release, RAMP));
};

/** A whole swell: up over `attack`, held, down over `release`. Even long ones have no corner. */
export const swell = (param: AudioParam, t: number, peak: number, attack: number, hold: number, release: number): void => {
  rise(param, t, peak, attack);
  fall(param, t + Math.max(attack, RAMP) + Math.max(hold, 0.001), peak, release);
};

/** Total length of a `swell`, for stopping its source. */
export const swellEnd = (t: number, attack: number, hold: number, release: number): number =>
  t + Math.max(attack, RAMP) + Math.max(hold, 0.001) + Math.max(release, RAMP) + SLACK;

/** Glides a frequency (or anything strictly positive) from one value to another on a musical, exponential path. */
export const glide = (param: AudioParam, t: number, from: number, to: number, seconds: number): void => {
  param.setValueAtTime(from, t);
  param.exponentialRampToValueAtTime(to, t + seconds);
};

// ---------------------------------------------------------------------------------------------------- shared material

export type NoiseKind = 'white' | 'pink' | 'brown';
export type Wave = OscillatorType | PeriodicWave;

const NOISE_SECONDS = 5;
/** Every noise colour is levelled to this RMS, so recipes can swap one for another without re-balancing. */
const NOISE_RMS = 0.25;

const makeNoise = (ctx: BaseAudioContext, kind: NoiseKind, rng: Rng): AudioBuffer => {
  const rate = ctx.sampleRate, n = Math.floor(NOISE_SECONDS * rate), lap = Math.floor(0.05 * rate);
  const raw = new Float32Array(n + lap);
  let b0 = 0, b1 = 0, b2 = 0, drift = 0;
  for (let i = 0; i < raw.length; i++) {
    const white = rng.next() * 2 - 1;
    if (kind === 'white') raw[i] = white;
    else if (kind === 'pink') {
      // Paul Kellet's economy filter: three leaky integrators approximate -3 dB per octave
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      raw[i] = b0 + b1 + b2 + white * 0.1848;
    } else {
      drift = (drift + 0.02 * white) / 1.02;
      raw[i] = drift;
    }
  }
  const buffer = ctx.createBuffer(1, n, rate);
  const data = buffer.getChannelData(0);
  let power = 0;
  for (let i = 0; i < n; i++) {
    // what ran past the end is folded into the start, so the loop point cannot be heard
    const k = (i / lap) * (Math.PI / 2);
    const v = i < lap ? raw[i]! * Math.sin(k) + raw[n + i]! * Math.cos(k) : raw[i]!;
    data[i] = v;
    power += v * v;
  }
  const norm = NOISE_RMS / Math.sqrt(power / n);
  for (let i = 0; i < n; i++) data[i]! *= norm;
  return buffer;
};

/** The shared resources of one audio context: reverb inputs, noise, wave shapes, and a count of what is alive. */
export class Kit {
  /** Variation for one-shots. Seeded, so an offline render is the same every time. */
  readonly rng = new Rng(0x5eed);
  /** Running totals, so a tool can prove that finished sounds really are taken down. */
  readonly live = { patches: 0, nodes: 0 };
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly waves = new Map<string, PeriodicWave>();

  /** `hall` and `room` are the inputs of the long and the short reverb. */
  constructor(readonly ctx: BaseAudioContext, readonly hall: AudioNode, readonly room: AudioNode) {}

  /** A buffer generated the first time it is asked for; its contents depend only on its key. */
  buffer(key: string, make: (ctx: BaseAudioContext, rng: Rng) => AudioBuffer): AudioBuffer {
    let b = this.buffers.get(key);
    if (!b) this.buffers.set(key, (b = make(this.ctx, new Rng(hashString(key)))));
    return b;
  }

  noise(kind: NoiseKind): AudioBuffer {
    return this.buffer(kind, (ctx, rng) => makeNoise(ctx, kind, rng));
  }

  /** An oscillator shape from harmonic strengths (the first is the fundamental), built once per key. */
  wave(key: string, harmonics: () => readonly number[]): PeriodicWave {
    let w = this.waves.get(key);
    if (!w) {
      const imag = Float32Array.from([0, ...harmonics()]);
      this.waves.set(key, (w = this.ctx.createPeriodicWave(new Float32Array(imag.length), imag)));
    }
    return w;
  }
}

// ---------------------------------------------------------------------------------------------------- patch

/** How long after its last source stops a patch is taken down: the audio thread is certain to have finished it. */
const REAP_MARGIN = 0.1;

/**
 * The nodes of one sound. A recipe builds oscillators, noise, filters and gains through the patch, which
 * starts and stops every source and remembers every node, so the whole sound can be faded early and is
 * disconnected once it is over. Times are context times; `t` is when the sound begins.
 */
export class Patch {
  private output: GainNode | null = null;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  /** Sources started with no stop time yet. */
  private sustained = 0;
  private lastStop = 0;
  /** This sound's own sends into the long reverb. */
  private readonly wets: GainNode[] = [];
  /** The patch's pitch as a detune, applied to every oscillator and filter. */
  private readonly cents: number;
  private gone = false;

  constructor(readonly kit: Kit, readonly t: number, private readonly level = 1, pitch = 1) {
    kit.live.patches++;
    this.cents = 1200 * Math.log2(pitch);
  }

  /**
   * Last stage of the sound: its overall level. Recipes connect into it and the owner connects it onward.
   * Made on first use: a note that plays straight into its bed never needs one.
   */
  get out(): GainNode {
    return (this.output ??= this.gain(this.level));
  }

  /** When the last source stops; Infinity while something is sustained and not yet released. */
  get end(): number {
    return this.sustained > 0 ? Infinity : this.lastStop;
  }

  private track<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    this.kit.live.nodes++;
    return node;
  }

  private stopAt(source: AudioScheduledSourceNode, to: number | undefined): void {
    this.sources.push(source);
    if (to === undefined) this.sustained++;
    else {
      source.stop(to);
      this.lastStop = Math.max(this.lastStop, to);
    }
  }

  /** An oscillator running from `from` to `to`; leave `to` out for one that sustains until `release`. */
  osc(wave: Wave, freq: number, from: number, to?: number, cents = 0): OscillatorNode {
    const o = this.track(this.kit.ctx.createOscillator());
    // PeriodicWave has no members to tell it apart by, so the compiler cannot narrow the union on its own
    if (typeof wave === 'string') o.type = wave as OscillatorType;
    else o.setPeriodicWave(wave);
    o.frequency.value = freq;
    o.detune.value = this.cents + cents;
    o.start(from);
    this.stopAt(o, to);
    return o;
  }

  /** A slow sine scaled to `depth`, for wiring into a parameter. It does not follow the patch's pitch. */
  lfo(rate: number, depth: number, from: number, to?: number): GainNode {
    const o = this.track(this.kit.ctx.createOscillator());
    o.frequency.value = rate;
    o.start(from);
    this.stopAt(o, to);
    const g = this.gain(depth);
    o.connect(g);
    return g;
  }

  /** A looping buffer, entered at a random point so that two uses never line up. */
  loop(buffer: AudioBuffer, from: number, to?: number, rate = 1): AudioBufferSourceNode {
    const s = this.track(this.kit.ctx.createBufferSource());
    s.buffer = buffer;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(from, this.kit.rng.next() * buffer.duration);
    this.stopAt(s, to);
    return s;
  }

  noise(kind: NoiseKind, from: number, to?: number): AudioBufferSourceNode {
    return this.loop(this.kit.noise(kind), from, to);
  }

  gain(value = 1): GainNode {
    const g = this.track(this.kit.ctx.createGain());
    g.gain.value = value;
    return g;
  }

  /** `q` is resonance in dB for low- and high-pass filters, and the usual Q for the rest. */
  filter(type: BiquadFilterType, freq: number, q = 0): BiquadFilterNode {
    const f = this.track(this.kit.ctx.createBiquadFilter());
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.detune.value = this.cents;
    return f;
  }

  pan(value: number): StereoPannerNode {
    const p = this.track(this.kit.ctx.createStereoPanner());
    p.pan.value = value;
    return p;
  }

  delay(seconds: number): DelayNode {
    const d = this.track(this.kit.ctx.createDelay(Math.max(1, seconds * 2)));
    d.delayTime.value = seconds;
    return d;
  }

  /** Scales the left and right of a signal separately: a balance control that keeps whatever stereo it had. */
  balance(left: number, right: number): { input: AudioNode; output: AudioNode } {
    const ctx = this.kit.ctx;
    // a splitter takes channels as they come, so a mono sound is first spread to both sides
    const input = this.gain(1);
    input.channelCount = 2;
    input.channelCountMode = 'explicit';
    const split = this.track(ctx.createChannelSplitter(2)), join = this.track(ctx.createChannelMerger(2));
    input.connect(split);
    split.connect(this.gain(left), 0).connect(join, 0, 0);
    split.connect(this.gain(right), 1).connect(join, 0, 1);
    return { input, output: join };
  }

  /** A struck tone: an oscillator through its own decaying envelope. Connect `amp` onward. */
  tone(wave: Wave, freq: number, t: number, dur: number, peak: number, attack = RAMP, cents = 0): { osc: OscillatorNode; amp: GainNode } {
    const osc = this.osc(wave, freq, t, t + Math.max(dur, attack + 0.01) + SLACK, cents);
    const amp = this.gain(0);
    perc(amp.gain, t, peak, dur, attack);
    osc.connect(amp);
    return { osc, amp };
  }

  /** A burst of noise through its own decaying envelope. Connect `amp` onward. */
  hiss(kind: NoiseKind, t: number, dur: number, peak: number, attack = RAMP): { src: AudioBufferSourceNode; amp: GainNode } {
    const src = this.noise(kind, t, t + Math.max(dur, attack + 0.01) + SLACK);
    const amp = this.gain(0);
    perc(amp.gain, t, peak, dur, attack);
    src.connect(amp);
    return { src, amp };
  }

  /** A one-shot buffer, played once through from `from`. */
  play(buffer: AudioBuffer, from: number, rate = 1): AudioBufferSourceNode {
    const s = this.track(this.kit.ctx.createBufferSource());
    s.buffer = buffer;
    s.playbackRate.value = rate;
    s.start(from);
    this.stopAt(s, from + buffer.duration / rate + SLACK);
    return s;
  }

  /**
   * An input that plays through `out` and also sends `hall` of itself to the long reverb, over and above
   * whatever the bus it is on sends.
   */
  mix(hall: number): GainNode {
    const input = this.gain(1), send = this.gain(hall * this.level);
    input.connect(this.out);
    input.connect(send).connect(this.kit.hall);
    this.wets.push(send);
    return input;
  }

  /** Stops every source at `at`. This is how a sustained patch ends. */
  release(at: number): void {
    for (const s of this.sources) s.stop(at);
    this.sustained = 0;
    this.lastStop = at;
  }

  /** Fades the sound out within a few milliseconds and ends it: for making room when too much is playing. */
  cut(at: number): void {
    for (const g of this.output ? [this.output, ...this.wets] : this.wets) {
      g.gain.setValueAtTime(g.gain.value, at);
      g.gain.linearRampToValueAtTime(0, at + 2 * RAMP);
    }
    this.release(at + 2 * RAMP + SLACK);
  }

  dispose(): void {
    if (this.gone) return;
    this.gone = true;
    for (const n of this.nodes) n.disconnect();
    this.kit.live.nodes -= this.nodes.length;
    this.kit.live.patches--;
    this.nodes.length = 0;
    this.sources.length = 0;
  }
}

/** Takes down every patch in the list whose last source has stopped. */
export const reap = (list: Patch[], now: number): void => {
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i]!;
    if (now <= p.end + REAP_MARGIN) continue;
    p.dispose();
    list.splice(i, 1);
  }
};

/** True once `now` is safely past `time`: whatever stopped then has been rendered out. */
export const isOver = (time: number, now: number): boolean => now > time + REAP_MARGIN;
