import { Rng, clamp } from '../core/math';
import type { Soundscape } from './GameAudio';
import { bell, choir, drip, formants, kalimba, padChord, piano, pluck, shape, thump, tick, type LetGo, type Shape, type Vowel } from './instruments';
import type { Mixer, Space } from './mixer';
import { FADE_IN, FADE_OUT, Patch, SLACK, dB, isOver, mtof, note, notes, pentatonic, reap, swell, swellEnd, type Kit } from './synth';

export type BedName = Exclude<Soundscape, 'silence'>;

export const LOOKAHEAD = 0.5;

export const SPACES: Record<BedName, Space> = {
  title: 'haven', haven: 'haven', havenEvening: 'haven', havenFestival: 'haven', unease: 'haven', ending: 'haven',
  classroom: 'interior', classroomWarm: 'interior', bedroom: 'interior',
  arcadeRally: 'haven', arcadeSprites: 'haven', arcadeLanterns: 'haven', arcadeDrift: 'haven', arcadeDusk: 'haven',
};

class Stream {
  private index = 0;

  constructor(private next: number, private readonly fire: (t: number, index: number) => number) {}

  run(now: number, horizon: number): void {
    if (this.next < now) this.next = now + 0.03;
    while (this.next < horizon) this.next += Math.max(0.01, this.fire(this.next, this.index++));
  }
}

export class Bed {
  readonly music: GainNode;
  readonly ambience: GainNode;
  readonly air: GainNode;
  readonly core: Patch;
  readonly rng: Rng;

  private readonly gates: GainNode[] = [];
  private readonly notes: Patch[] = [];
  private readonly streams: Stream[] = [];
  private harmony = { now: 60, next: 60, at: 0 };
  private silentAt = Infinity;

  constructor(private readonly mixer: Mixer, readonly name: BedName, readonly t0: number, fade: number) {
    this.rng = new Rng(Object.keys(BEDS).indexOf(name) + 1);
    this.core = new Patch(mixer.kit, t0);
    this.music = this.output(mixer.buses.music, fade);
    this.ambience = this.output(mixer.buses.ambience, fade);
    this.air = this.output(mixer.kit.hall, fade);
    BEDS[name](this);
  }

  get kit(): Kit {
    return this.mixer.kit;
  }

  private output(to: AudioNode, fade: number): GainNode {
    const input = this.core.gain(0), gate = this.core.gain(1);
    input.gain.setValueCurveAtTime(FADE_IN, this.t0, fade);
    input.connect(gate).connect(to);
    this.gates.push(gate);
    return input;
  }

  stream(from: number, fire: (t: number, index: number) => number): void {
    this.streams.push(new Stream(from, fire));
  }

  play(t: number, build: (p: Patch) => void): Patch {
    const p = new Patch(this.kit, t);
    build(p);
    this.notes.push(p);
    return p;
  }

  setRoot(root: number, at: number): void {
    this.harmony = { now: this.harmony.next, next: root, at };
  }

  rootAt(now: number): number {
    return now >= this.harmony.at ? this.harmony.next : this.harmony.now;
  }

  compose(now: number, horizon: number): void {
    for (const s of this.streams) s.run(now, horizon);
  }

  release(at: number, fade: number): void {
    this.streams.length = 0;
    for (const g of this.gates) g.gain.setValueCurveAtTime(FADE_OUT, at, fade);
    this.silentAt = at + fade;
    this.core.release(this.silentAt + 0.02);
    for (const p of this.notes) if (p.end === Infinity) p.release(this.silentAt + 0.02);
  }

  sweep(now: number): boolean {
    reap(this.notes, now);
    if (this.notes.length > 0 || !isOver(this.silentAt, now)) return false;
    this.core.dispose();
    return true;
  }
}

interface Chord {
  readonly pad: readonly number[];
  readonly bass: number;
  readonly bright: number;
}

const chord = (pad: string, bass: string, bright: string): Chord => ({ pad: notes(pad), bass: note(bass), bright: note(bright) });

const HAVEN_CHORDS = [
  chord('C3 G3 D4 E4 B4', 'C2', 'C4'),
  chord('C3 A3 D4 F#4 A4', 'C2', 'D4'),
  chord('A2 E3 B3 C4 G4', 'A1', 'C4'),
  chord('G2 D3 A3 B3 E4', 'G1', 'G3'),
];

interface PadStyle {
  readonly level: number;
  readonly shape: Shape;
  readonly detune: number;
  readonly cutoff: number;
  readonly sweep: number;
  readonly attack: number;
  readonly release: number;
}

interface HavenStyle {
  readonly bpm: number;
  readonly chordSteps: number;
  readonly pad: PadStyle;
  readonly choir: { readonly level: number; readonly vowel: Vowel } | null;
  readonly sub: number | null;
  readonly bells: {
    readonly level: number;
    readonly low: number;
    readonly high: number;
    readonly ring: number;
    readonly every: number;
    readonly chance: readonly [number, number, number];
  } | null;
  readonly pulse: number | null;
  readonly ticks: number | null;
}

const HAVEN: HavenStyle = {
  bpm: 72, chordSteps: 32,
  pad: { level: -41, shape: 'soft', detune: 7, cutoff: 1500, sweep: 800, attack: 1.8, release: 3 },
  choir: { level: -36, vowel: 'ah' },
  sub: -30,
  bells: { level: -27, low: 72, high: 96, ring: 1.7, every: 1, chance: [0.8, 0.42, 0.16] },
  pulse: null, ticks: null,
};

const TITLE: HavenStyle = {
  ...HAVEN, bpm: 60, choir: null, sub: -32,
  bells: { level: -23.5, low: 72, high: 91, ring: 3.6, every: 4, chance: [0.75, 0.45, 0.12] },
};

const EVENING: HavenStyle = {
  bpm: 54, chordSteps: 32,
  pad: { level: -40, shape: 'hollow', detune: 4, cutoff: 900, sweep: 300, attack: 2.4, release: 3.5 },
  choir: { level: -38, vowel: 'oo' },
  sub: null,
  bells: { level: -24, low: 67, high: 86, ring: 3, every: 4, chance: [0.6, 0.25, 0.05] },
  pulse: null, ticks: null,
};

const FESTIVAL: HavenStyle = {
  ...HAVEN, bpm: 96,
  pad: { ...HAVEN.pad, level: -42, cutoff: 2100, sweep: 900 },
  bells: { level: -28.5, low: 72, high: 96, ring: 1.5, every: 1, chance: [0.7, 0.4, 0.14] },
  pulse: -25.5, ticks: -34,
};

const ARCADE_RALLY: HavenStyle = {
  ...HAVEN, bpm: 112, chordSteps: 16,
  pad: { ...HAVEN.pad, level: -43, cutoff: 2300, sweep: 700, attack: 0.9, release: 1.6 },
  choir: null, sub: -32,
  bells: { level: -30, low: 76, high: 93, ring: 1.1, every: 2, chance: [0.5, 0.3, 0.1] },
  pulse: -25, ticks: -32,
};

const ARCADE_SPRITES: HavenStyle = {
  ...HAVEN, bpm: 124, chordSteps: 32,
  pad: { ...HAVEN.pad, level: -43, shape: 'hollow', cutoff: 1700, sweep: 600, attack: 1.2, release: 2 },
  choir: { level: -40, vowel: 'oo' }, sub: -29,
  bells: { level: -31, low: 74, high: 91, ring: 0.9, every: 4, chance: [0.6, 0.35, 0.1] },
  pulse: -24.5, ticks: -31,
};

const ARCADE_LANTERNS: HavenStyle = {
  ...HAVEN, bpm: 84,
  pad: { ...HAVEN.pad, level: -42, cutoff: 1700, sweep: 700 },
  choir: { level: -38, vowel: 'ah' }, sub: -31,
  bells: { level: -26, low: 72, high: 98, ring: 1.6, every: 1, chance: [0.85, 0.5, 0.2] },
  pulse: -29, ticks: null,
};

const ARCADE_DRIFT: HavenStyle = {
  ...HAVEN, bpm: 72, chordSteps: 32,
  pad: { ...HAVEN.pad, level: -42, shape: 'hollow', cutoff: 1400, sweep: 500, attack: 1.8, release: 2.8 },
  choir: { level: -38, vowel: 'oo' }, sub: -30,
  bells: { level: -27, low: 69, high: 91, ring: 2.4, every: 2, chance: [0.7, 0.36, 0.12] },
  pulse: -30, ticks: null,
};

const ARCADE_DUSK: HavenStyle = {
  ...HAVEN, bpm: 132, chordSteps: 32,
  pad: { ...HAVEN.pad, level: -43, shape: 'hollow', cutoff: 1300, sweep: 500, attack: 1.0, release: 1.8 },
  choir: { level: -41, vowel: 'oo' }, sub: -30.5,
  bells: { level: -33, low: 72, high: 88, ring: 0.8, every: 4, chance: [0.5, 0.25, 0.08] },
  pulse: -26.5, ticks: -32,
};

const PULSE = [0, 2, 4, 2, 1, 3, 4, 3, 0, 2, 4, 2, 1, 3, 4, 2];

interface Held {
  readonly patch: Patch;
  readonly letGo: readonly LetGo[];
  readonly release: number;
}

const handOver = (previous: Held | null, t: number): void => {
  if (!previous) return;
  for (const letGo of previous.letGo) letGo(t);
  previous.patch.release(t + previous.release + SLACK);
};

const CHOIR_RELEASE = 3;

const padVoice = (bed: Bed, style: PadStyle): { left: AudioNode; right: AudioNode } => {
  const { core, t0 } = bed;
  const lowpass = core.filter('lowpass', style.cutoff, 1), left = core.pan(-0.6), right = core.pan(0.6);
  core.lfo(1 / 23, style.sweep, t0).connect(lowpass.frequency);
  left.connect(lowpass);
  right.connect(lowpass);
  lowpass.connect(bed.music);
  return { left, right };
};

const haven = (bed: Bed, s: HavenStyle): void => {
  const { core, kit, rng, t0 } = bed;
  const step = 15 / s.bpm, span = s.chordSteps * step;
  const pad = padVoice(bed, s.pad);

  const mouths = s.choir ? formants(core, bed.music, s.choir.vowel) : null;

  const bells = [core.pan(-0.45), core.pan(0.45)], bellBus = core.gain(1);
  const echo = core.delay(step * 3), dull = core.filter('lowpass', 2600, 0);
  for (const side of bells) side.connect(bellBus);
  bellBus.connect(bed.music);
  bellBus.connect(core.gain(0.5)).connect(bed.air);
  bellBus.connect(echo).connect(dull);
  dull.connect(core.gain(0.34)).connect(echo);
  dull.connect(core.gain(0.4)).connect(bed.music);

  const pulses = [core.pan(-0.25), core.pan(0.25)];
  for (const side of pulses) side.connect(bed.music);

  let walk = 3, bellCount = 0, held: Held | null = null;
  bed.stream(t0 + 0.05, (t, i) => {
    const place = i % s.chordSteps, c = HAVEN_CHORDS[Math.floor(i / s.chordSteps) % HAVEN_CHORDS.length]!;
    if (place === 0) {
      bed.setRoot(c.bright, t);
      handOver(held, t);
      const letGo: LetGo[] = [];
      const patch = bed.play(t, (p) => {
        letGo.push(padChord(p, pad.left, pad.right, t, c.pad, { wave: shape(kit, s.pad.shape), level: dB(s.pad.level), detune: s.pad.detune, attack: s.pad.attack, release: s.pad.release }));
        if (mouths && s.choir) letGo.push(choir(p, mouths, t, c.pad.slice(-3), { level: dB(s.choir.level), attack: 2.6, release: CHOIR_RELEASE }));
        if (s.sub !== null) {
          const end = swellEnd(t, span * 0.45, span * 0.1, span * 0.45), sub = p.gain(0);
          swell(sub.gain, t, dB(s.sub), span * 0.45, span * 0.1, span * 0.45);
          p.osc('sine', mtof(c.bass), t, end).connect(sub);
          p.osc('sine', mtof(c.bass + 12), t, end).connect(p.gain(0.3)).connect(sub);
          sub.connect(bed.music);
        }
      });
      held = { patch, letGo, release: Math.max(s.pad.release, CHOIR_RELEASE) };
    }
    const b = s.bells;
    if (b && i % b.every === 0) {
      const beat = (i / b.every) % 4, weight = beat === 0 ? 0 : beat === 2 ? 1 : 2;
      if (rng.chance(b.chance[weight])) {
        const pool = pentatonic(c.bright, b.low, b.high);
        walk = clamp(walk + rng.int(-2, 2), 0, pool.length - 1);
        const f = mtof(pool[walk]!), side = bells[bellCount++ % 2]!, level = dB(b.level) * [1, 0.7, 0.5][weight]!;
        bed.play(t, (p) => bell(p, side, t, f, { level, dur: b.ring, index: 1 }));
      }
    }
    if (s.pulse !== null) {
      const f = mtof(c.pad[PULSE[i % 16]!]! + 12), level = dB(s.pulse) * (i % 4 === 0 ? 1 : 0.62), side = pulses[i % 2]!;
      bed.play(t, (p) => pluck(p, side, t, f, level));
    }
    if (s.ticks !== null) {
      const k = i % 16, level = dB(s.ticks);
      bed.play(t, (p) => {
        if (k % 4 === 2) tick(p, bed.music, t, level, 7500, 0.04);
        else tick(p, bed.music, t, level * (k % 2 ? 0.3 : 0.15), 9000, 0.02);
        if (k === 4 || k === 12) p.tone('sine', 1650, t, 0.03, level * 0.9).amp.connect(bed.music);
        if (k === 0 || k === 10) thump(p, bed.music, t, 84, 50, 0.22, level * 2.2);
      });
    }
    return step;
  });
};

const unease = (bed: Bed): void => {
  const { core, kit, t0 } = bed;
  bed.setRoot(note('D4'), t0);
  const still = core.filter('lowpass', 950, 0), sides = [core.pan(-0.5), core.pan(0.5)];
  for (const side of sides) side.connect(still);
  still.connect(bed.music);
  const d3 = mtof(note('D3'));
  [1, 3 / 2, 2, 8 / 3].forEach((ratio, i) => {
    core.osc(shape(kit, 'soft'), d3 * ratio, t0 + 0.0017 * i).connect(core.gain(dB(-36))).connect(sides[i % 2]!);
  });
  const drone = core.gain(dB(-35));
  core.osc('sine', d3 / 2, t0).connect(drone);
  core.osc('sine', d3, t0 + 0.0011).connect(core.gain(0.3)).connect(drone);
  drone.connect(bed.music);
  const glass = core.gain(dB(-57));
  core.osc('sine', d3 * 12, t0).connect(glass);
  core.osc('sine', d3 * 12 + 0.31, t0).connect(glass);
  glass.connect(bed.music);
};

const score = (bars: readonly string[]): (number | null)[] => bars.flatMap((bar) => bar.split(' ').map((n) => (n === '-' ? null : note(n))));

interface Part {
  readonly melody: readonly (number | null)[];
  readonly bass: readonly (number | null)[];
}

const THEME: Part = {
  melody: score([
    'B4 - D5 - E5 - D5 -',
    'B4 - - A4 G4 - - -',
    'E4 - G4 - D5 - - B4',
    'A4 - - - - - F#4 A4',
    'B4 - D5 - G5 - E5 -',
    'D5 - - E5 D5 - B4 -',
    'G4 - A4 - B4 - A4 -',
    'G4 - D5 - G5 - - -',
  ]),
  bass: score([
    'G3 - - - D3 - - -',
    'E3 - - - B3 - - -',
    'C3 - - - G3 - - -',
    'D3 - - - A3 - - -',
    'E3 - - - B3 - - -',
    'C3 - - - G3 - - -',
    'D3 - - - A3 - - -',
    'G3 - - - D3 - - -',
  ]),
};

const CODA: Part = {
  melody: score([
    'D5 - - - A4 - - -',
    '- - G4 - - - - -',
    'A4 - - - D5 - - -',
    '- - - - G5 - - -',
    'D5 - - - - - A4 -',
    'G4 - - - - - - -',
    '- - - - D5 - - -',
    '- - - - - - - -',
  ]),
  bass: score([
    'G3 - - - - - - -',
    '- - - - D3 - - -',
    'G3 - - - - - - -',
    '- - - - - - - -',
    'G3 - - - - - - -',
    '- - - - D3 - - -',
    'G3 - - - - - - -',
    '- - - - - - - -',
  ]),
};

interface ThemeOptions {
  readonly bpm: number;
  readonly level: number;
  readonly delay: number;
  readonly after: Part | number;
  readonly onBar?: (bar: number, t: number) => void;
}

const theme = (bed: Bed, o: ThemeOptions): void => {
  const { core, rng } = bed, eighth = 30 / o.bpm;
  const coda = typeof o.after === 'number' ? null : o.after;
  const total = THEME.melody.length + (coda ? coda.melody.length : (o.after as number) * 8);
  const high = core.pan(0.15), low = core.pan(-0.2);
  high.connect(bed.music);
  low.connect(bed.music);
  bed.stream(bed.t0 + o.delay, (t, i) => {
    const place = i % total, round = Math.floor(i / total), inTheme = place < THEME.melody.length;
    const part = inTheme ? THEME : coda, k = inTheme ? place : place - THEME.melody.length;
    if (place % 8 === 0) o.onBar?.(place / 8, t);
    const strong = k % 4 === 0, m = part?.melody[k] ?? null, b = part?.bass[k] ?? null;
    if (m !== null && (strong || round === 0 || !rng.chance(0.1))) {
      const when = t + Math.abs(rng.gauss()) * 0.012, level = dB(o.level) * (strong ? 1 : 0.78) * (1 + 0.14 * rng.gauss());
      bed.play(when, (p) => kalimba(p, high, when, mtof(m), level));
    }
    if (b !== null) {
      const when = t + rng.range(0, 0.018), level = dB(o.level) * 0.7 * (1 + 0.1 * rng.gauss());
      bed.play(when, (p) => kalimba(p, low, when, mtof(b), level));
    }
    const lean = inTheme && place >= 56 ? 0.07 * ((place - 56) / 8) : 0;
    return eighth * (1 + 0.025 * Math.sin(i * 0.21) + lean);
  });
};

const classroom = (bed: Bed, warm: boolean): void => {
  const { core, t0 } = bed;
  bed.setRoot(note('G3'), t0);
  for (const side of [-1, 1]) {
    const tone = core.gain(dB(-26));
    core.noise('pink', t0).connect(core.filter('highpass', 90, 0)).connect(core.filter('lowpass', 700, 0)).connect(tone).connect(core.pan(side * 0.7)).connect(bed.ambience);
  }
  const vent = core.gain(1);
  core.noise('brown', t0).connect(core.filter('bandpass', 140, 1.5)).connect(core.gain(dB(-27))).connect(vent);
  core.osc('sine', 118, t0).connect(core.gain(dB(-53))).connect(vent);
  core.osc('sine', 236.6, t0).connect(core.gain(dB(-61))).connect(vent);
  core.lfo(0.11, 0.12, t0).connect(vent.gain);
  vent.connect(bed.ambience);
  const airy = core.gain(dB(-23));
  for (const n of notes('G4 D5')) core.noise('pink', t0).connect(core.filter('bandpass', mtof(n), 45)).connect(airy);
  core.lfo(0.09, dB(-23) * 0.5, t0).connect(airy.gain);
  airy.connect(bed.music);

  if (warm) theme(bed, { bpm: 84, level: -24, delay: 2.2, after: 2 });
};

const makeRain = (ctx: BaseAudioContext, rng: Rng): AudioBuffer => {
  const rate = ctx.sampleRate, n = Math.floor(6 * rate);
  const buffer = ctx.createBuffer(2, n, rate), left = buffer.getChannelData(0), right = buffer.getChannelData(1);
  const drops = (count: number, freq: readonly [number, number], ring: readonly [number, number], strength: readonly [number, number]): void => {
    for (let d = 0; d < count; d++) {
      const at = Math.floor(rng.next() * n), tau = rng.range(ring[0], ring[1]) * rate, w = (2 * Math.PI * rng.range(freq[0], freq[1])) / rate;
      const amp = rng.range(strength[0], strength[1]), side = rng.next(), phase = rng.next() * 2 * Math.PI, length = Math.floor(tau * 5);
      for (let k = 0; k < length; k++) {
        const v = amp * Math.exp(-k / tau) * Math.sin(w * k + phase), j = (at + k) % n;
        left[j]! += v * (1 - side);
        right[j]! += v * side;
      }
    }
  };
  drops(2200, [1800, 6500], [0.0004, 0.0016], [0.2, 1]);
  drops(160, [500, 1500], [0.003, 0.011], [0.25, 0.6]);
  let power = 0;
  for (let i = 0; i < n; i++) power += left[i]! ** 2 + right[i]! ** 2;
  const norm = 0.1 / Math.sqrt(power / (2 * n));
  for (let i = 0; i < n; i++) {
    left[i]! *= norm;
    right[i]! *= norm;
  }
  return buffer;
};

const PHRASES: readonly (readonly (readonly [number, string, number])[])[] = [
  [[0, 'E4', 0.8], [1.2, 'B4', 0.7], [2.6, 'G4', 0.6]],
  [[0, 'A3', 0.7], [1.0, 'E4', 0.7], [2.1, 'D4', 0.55], [3.3, 'E4', 0.6]],
  [[0, 'B4', 0.7], [0.9, 'A4', 0.6], [2.0, 'E4', 0.65], [3.6, 'F#4', 0.5]],
  [[0, 'G4', 0.7], [1.4, 'E4', 0.6], [3.0, 'E3', 0.6]],
  [[0, 'D4', 0.6], [0.8, 'E4', 0.65], [1.7, 'G4', 0.7], [3.0, 'B4', 0.6]],
  [[0, 'C5', 0.6], [1.3, 'B4', 0.6], [2.7, 'G4', 0.55], [4.4, 'E4', 0.5]],
];

const sea = (bed: Bed): void => {
  const { core, rng, t0 } = bed;
  [0.11, 0.083].forEach((breath, i) => {
    const wash = core.gain(dB(-27));
    core.lfo(breath, dB(-27) * 0.7, t0).connect(wash.gain);
    core.noise('pink', t0).connect(core.filter('highpass', 300, 0)).connect(core.filter('lowpass', i ? 2600 : 1700, 0)).connect(wash).connect(core.pan(i ? 0.75 : -0.75)).connect(bed.ambience);
  });
  core.noise('brown', t0).connect(core.filter('lowpass', 180, 0)).connect(core.gain(dB(-27))).connect(bed.ambience);
  bed.stream(t0 + 1.5, (t) => {
    const f = rng.range(240, 520), level = dB(-24) * rng.range(0.5, 1), side = rng.range(-0.7, 0.7);
    bed.play(t, (p) => {
      const where = p.pan(side);
      drip(p, where, t, f, level);
      where.connect(bed.ambience);
    });
    return rng.range(1.2, 4.5);
  });
};

const bedroom = (bed: Bed): void => {
  const { core, kit, rng, t0 } = bed;
  bed.setRoot(note('G3'), t0);
  [0.083, 0.061].forEach((gust, i) => {
    const hiss = core.gain(dB(-23.5));
    core.lfo(gust, dB(-23.5) * 0.35, t0).connect(hiss.gain);
    core.noise('white', t0).connect(core.filter('highpass', 1500, 0)).connect(core.filter('bandpass', 5200, 0.5)).connect(hiss).connect(core.pan(i ? 0.8 : -0.8)).connect(bed.ambience);
  });
  const patter = core.gain(dB(-28));
  core.lfo(0.047, dB(-28) * 0.3, t0).connect(patter.gain);
  core.loop(kit.buffer('rain', makeRain), t0).connect(core.filter('highpass', 700, 0)).connect(patter).connect(bed.ambience);
  core.noise('brown', t0).connect(core.filter('lowpass', 140, 0)).connect(core.gain(dB(-25))).connect(bed.ambience);
  const hum = core.gain(dB(-40));
  for (const f of [55, 82.6]) core.osc('sine', f, t0).connect(hum);
  hum.connect(bed.ambience);

  bed.stream(t0 + 2, (t) => {
    const f = rng.range(900, 1700), level = dB(-20) * rng.range(0.5, 1), side = rng.range(-0.6, 0.6);
    bed.play(t, (p) => {
      const where = p.pan(side);
      drip(p, where, t, f, level);
      where.connect(bed.ambience);
    });
    return rng.range(2.5, 7);
  });

  let phrase = rng.int(0, PHRASES.length - 1), k = 0, pace = 1;
  bed.stream(t0 + 2.5, (t) => {
    const line = PHRASES[phrase]!, [at, name, touch] = line[k]!;
    const when = t + rng.range(0, 0.03), level = dB(-19.5) * touch * rng.range(0.85, 1.1);
    bed.play(when, (p) => piano(p, bed.music, when, mtof(note(name)), level));
    if (k === 0 && rng.chance(0.3)) bed.play(when, (p) => piano(p, bed.music, when + 0.03, mtof(note('E3')), level * 0.6));
    const following = line[++k];
    if (following) return (following[0] - at) * pace;
    k = 0;
    phrase = (phrase + rng.int(1, PHRASES.length - 1)) % PHRASES.length;
    pace = rng.range(0.9, 1.15);
    return rng.range(4, 8);
  });
};

const ENDING_CHORDS = [
  chord('G2 D3 A3 B3 D4', 'G1', 'G3'),
  chord('E2 B2 G3 B3 D4', 'E1', 'G3'),
  chord('C3 G3 B3 D4 E4', 'C2', 'C4'),
  chord('D3 A3 D4 F#4 A4', 'D2', 'D4'),
  chord('E3 B3 D4 G4', 'E2', 'G3'),
  chord('C3 G3 D4 E4 B4', 'C2', 'C4'),
  chord('D3 A3 D4 G4', 'D2', 'G3'),
  chord('G2 D3 G3 A3 D4', 'G1', 'G3'),
];

const ending = (bed: Bed): void => {
  const { kit } = bed;
  const style: PadStyle = { ...HAVEN.pad, level: -39, cutoff: 1300, sweep: 500, attack: 1.1, release: 2.8 };
  const pad = padVoice(bed, style);
  let held: Held | null = null;
  theme(bed, {
    bpm: 72, level: -24, delay: 0.8, after: CODA,
    onBar: (bar, t) => {
      const c = ENDING_CHORDS[bar];
      if (!c) return;
      bed.setRoot(c.bright, t);
      handOver(held, t);
      const letGo: LetGo[] = [];
      const patch = bed.play(t, (p) => letGo.push(padChord(p, pad.left, pad.right, t, c.pad, { wave: shape(kit, style.shape), level: dB(style.level), detune: style.detune, attack: style.attack, release: style.release })));
      held = { patch, letGo, release: style.release };
    },
  });
};

const BEDS: Record<BedName, (bed: Bed) => void> = {
  title: (bed) => haven(bed, TITLE),
  classroom: (bed) => classroom(bed, false),
  classroomWarm: (bed) => classroom(bed, true),
  bedroom,
  haven: (bed) => haven(bed, HAVEN),
  havenEvening: (bed) => haven(bed, EVENING),
  havenFestival: (bed) => haven(bed, FESTIVAL),
  unease,
  ending,
  arcadeRally: (bed) => haven(bed, ARCADE_RALLY),
  arcadeSprites: (bed) => haven(bed, ARCADE_SPRITES),
  arcadeLanterns: (bed) => haven(bed, ARCADE_LANTERNS),
  arcadeDusk: (bed) => haven(bed, ARCADE_DUSK),
  arcadeDrift: (bed) => {
    haven(bed, ARCADE_DRIFT);
    sea(bed);
  },
};
