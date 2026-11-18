import { Rng } from '../core/math';

export interface ReverbShape {
  readonly seconds: number;
  readonly rt60: number;
  readonly predelay: number;
  readonly onset: number;
  readonly bright: number;
  readonly dark: number;
  readonly early: number;
  readonly seed: number;
}

export const HALL: ReverbShape = { seconds: 4.6, rt60: 3.6, predelay: 0.028, onset: 0.03, bright: 9000, dark: 1400, early: 0, seed: 7 };
export const ROOM: ReverbShape = { seconds: 0.7, rt60: 0.5, predelay: 0.004, onset: 0.002, bright: 5200, dark: 1100, early: 7, seed: 11 };

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
      high = 0.975 * (high + low - before);
      before = low;
      const closing = Math.min(1, (1 - age) * 10);
      data[i] = high * (1 - Math.exp(-t / shape.onset)) * 10 ** ((-3 * t) / shape.rt60) * closing;
    }
    for (let k = 0; k < shape.early; k++) {
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

export class Reverb {
  readonly input: GainNode;
  readonly output: GainNode;

  constructor(ctx: BaseAudioContext, shape: ReverbShape) {
    this.input = ctx.createGain();
    this.input.channelCount = 1;
    this.input.channelCountMode = 'explicit';
    const convolver = ctx.createConvolver();
    convolver.normalize = false;
    convolver.buffer = makeImpulse(ctx, shape);
    this.output = ctx.createGain();
    this.input.connect(convolver).connect(this.output);
  }
}
