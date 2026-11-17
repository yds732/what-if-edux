import { Rng } from '../core/math';

/** A space described by the way sound dies in it. */
export interface ReverbShape {
  /** Length of the impulse in seconds. */
  readonly seconds: number;
  /** Time for the tail to fall 60 dB. */
  readonly rt60: number;
  /** Silence before the first reflection: the size of the place. */
  readonly predelay: number;
  /** How long the tail takes to bloom. A soft onset reads as distance, a hard one as a nearby wall. */
  readonly onset: number;
  /** Low-pass corner in Hz at the start of the tail and at its end: air and walls take the top first. */
  readonly bright: number;
  readonly dark: number;
  /** Discrete early reflections, for the sense of a room with surfaces. */
  readonly early: number;
  readonly seed: number;
}

/** Haven: open sky. Long, slow to bloom, and bright. */
export const HALL: ReverbShape = { seconds: 4.6, rt60: 3.6, predelay: 0.028, onset: 0.03, bright: 9000, dark: 1400, early: 0, seed: 7 };
/** The classroom and the bedroom: short, close and a little dull. */
export const ROOM: ReverbShape = { seconds: 0.7, rt60: 0.5, predelay: 0.004, onset: 0.002, bright: 5200, dark: 1100, early: 7, seed: 11 };

/**
 * Generates a stereo impulse response: decaying noise, different in each ear, that loses its top as it ages.
 * Each channel carries unit energy, so a steady sound comes back from the reverb about as loud as it went in.
 */
export const makeImpulse = (ctx: BaseAudioContext, shape: ReverbShape): AudioBuffer => {
  const rate = ctx.sampleRate, n = Math.ceil(shape.seconds * rate), start = Math.floor(shape.predelay * rate);
  const buffer = ctx.createBuffer(2, n, rate);
  const rng = new Rng(shape.seed);
  const span = Math.max(1, n - start);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let low = 0, high = 0, before = 0;
    for (let i = start; i < n; i++) {
      const t = (i - start) / rate, age = (i - start) / span;
      const corner = shape.bright * (shape.dark / shape.bright) ** age;
      low += (1 - Math.exp((-2 * Math.PI * corner) / rate)) * (rng.next() * 2 - 1 - low);
      // a gentle high-pass keeps the tail from filling the bass
      high = 0.975 * (high + low - before);
      before = low;
      // the last tenth is eased to nothing, so the cut-off end of the tail is not a tick
      const closing = Math.min(1, (1 - age) * 10);
      data[i] = high * (1 - Math.exp(-t / shape.onset)) * 10 ** ((-3 * t) / shape.rt60) * closing;
    }
    for (let k = 0; k < shape.early; k++) {
      // single reflections standing clear of the tail, alternating sides, each later and fainter than the last
      const at = start + Math.floor((0.004 + 0.034 * ((k + rng.next()) / shape.early)) * rate);
      if ((k + c) % 2 === 0 && at < n) data[at]! += (rng.sign() * 2) / (1 + 0.5 * k);
    }
    let energy = 0;
    for (let i = 0; i < n; i++) energy += data[i]! * data[i]!;
    const norm = 1 / Math.sqrt(energy || 1);
    for (let i = 0; i < n; i++) data[i]! *= norm;
  }
  return buffer;
};

/** A convolution reverb: whatever is sent to `input` (summed to mono) returns from `output` in stereo. */
export class Reverb {
  readonly input: GainNode;
  readonly output: GainNode;

  constructor(ctx: BaseAudioContext, shape: ReverbShape) {
    this.input = ctx.createGain();
    // one channel in, two out: half the convolution work, and the impulse supplies the width
    this.input.channelCount = 1;
    this.input.channelCountMode = 'explicit';
    const convolver = ctx.createConvolver();
    // the impulse is levelled above; the node's own normalisation would only hide that
    convolver.normalize = false;
    convolver.buffer = makeImpulse(ctx, shape);
    this.output = ctx.createGain();
    this.input.connect(convolver).connect(this.output);
  }
}
