import { Rng, clamp } from '../core/math';
import type { Soundscape } from './GameAudio';
import { bell, choir, drip, formants, kalimba, padChord, piano, pluck, shape, thump, tick, type LetGo, type Shape, type Vowel } from './instruments';
import type { Mixer, Space } from './mixer';
import { FADE_IN, FADE_OUT, Patch, SLACK, dB, isOver, mtof, note, notes, pentatonic, reap, swell, swellEnd, type Kit } from './synth';

/**
 * The beds: what each place sounds like when nothing is happening. A bed is a set of sounds that never end
 * (air, rain, drones) and a few lines of music composed a moment ahead of the clock for as long as it plays.
 *
 * The whole week is written in one family of seven notes, so any bed can dissolve into any other without a
 * wrong note. What changes is where home is: the classroom rests on G, the bedroom on E minor, Haven floats
 * on C with its fourth raised. The chord Wednesday is left hanging on is D, G and A; the week ends on the
 * same three notes with G underneath them.
 */

export type BedName = Exclude<Soundscape, 'silence'>;

/**
 * How far ahead of the clock music is committed. Long enough to ride out a slow frame; short enough that
 * a pause, or a change of scene, is heard at once.
 */
export const LOOKAHEAD = 0.5;

/** The acoustics each soundscape is heard in. */
export const SPACES: Record<BedName, Space> = {
  title: 'haven', haven: 'haven', havenEvening: 'haven', havenFestival: 'haven', unease: 'haven', ending: 'haven',
  classroom: 'interior', classroomWarm: 'interior', bedroom: 'interior',
};

/**
 * A line of music written a little ahead of the clock. `fire` schedules whatever happens at one moment and
 * returns the seconds until the next; `run` keeps the line written as far as the horizon.
 */
class Stream {
  private index = 0;

  constructor(private next: number, private readonly fire: (t: number, index: number) => number) {}

  run(now: number, horizon: number): void {
    // after a pause or a stalled frame the line carries on from the present; it does not play what it missed
    if (this.next < now) this.next = now + 0.03;
    while (this.next < horizon) this.next += Math.max(0.01, this.fire(this.next, this.index++));
  }
}

/** One soundscape, from its fade in to the end of its fade out. */
export class Bed {
  /** Where the bed's music and its background go. Both follow the bed's fades. */
  readonly music: GainNode;
  readonly ambience: GainNode;
  /** A send straight to the long reverb, for the parts that should hang in the air longest. */
  readonly air: GainNode;
  /** Everything that sounds for the whole life of the bed. */
  readonly core: Patch;
  /** The bed's own dice: the same soundscape always composes the same music. */
  readonly rng: Rng;

  private readonly gates: GainNode[] = [];
  private readonly notes: Patch[] = [];
  private readonly streams: Stream[] = [];
  private harmony = { now: 60, next: 60, at: 0 };
  /** When the bed's fade out is complete. */
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

  /** An input whose sound fades in now, and out when the bed is released. */
  private output(to: AudioNode, fade: number): GainNode {
    const input = this.core.gain(0), gate = this.core.gain(1);
    input.gain.setValueCurveAtTime(FADE_IN, this.t0, fade);
    input.connect(gate).connect(to);
    this.gates.push(gate);
    return input;
  }

  /** Adds a line of music that starts at `from`. */
  stream(from: number, fire: (t: number, index: number) => number): void {
    this.streams.push(new Stream(from, fire));
  }

  /** One note, or one chord, of the bed's music: a patch of its own, taken down when it has rung out. */
  play(t: number, build: (p: Patch) => void): Patch {
    const p = new Patch(this.kit, t);
    build(p);
    this.notes.push(p);
    return p;
  }

  /** Tells the rest of the game which chord is sounding from `at` on, as the root of a pentatonic that fits it. */
  setRoot(root: number, at: number): void {
    this.harmony = { now: this.harmony.next, next: root, at };
  }

  rootAt(now: number): number {
    return now >= this.harmony.at ? this.harmony.next : this.harmony.now;
  }

  /** Writes the bed's music up to `horizon`. */
  compose(now: number, horizon: number): void {
    for (const s of this.streams) s.run(now, horizon);
  }

  /** Fades the bed out over `fade` seconds and stops composing. Notes already struck ring out under the fade. */
  release(at: number, fade: number): void {
    this.streams.length = 0;
    for (const g of this.gates) g.gain.setValueCurveAtTime(FADE_OUT, at, fade);
    this.silentAt = at + fade;
    this.core.release(this.silentAt + 0.02);
    // a chord still being held has no end of its own: it stops with the bed
    for (const p of this.notes) if (p.end === Infinity) p.release(this.silentAt + 0.02);
  }

  /** Takes down notes that have finished. Returns true once a released bed has nothing left and is itself taken down. */
  sweep(now: number): boolean {
    reap(this.notes, now);
    if (this.notes.length > 0 || !isOver(this.silentAt, now)) return false;
    this.core.dispose();
    return true;
  }
}

// ---------------------------------------------------------------------------------------------------- Haven

interface Chord {
  readonly pad: readonly number[];
  readonly bass: number;
  /** Root of the major pentatonic that sits best on the chord: what bells, voices and rewards are drawn from. */
  readonly bright: number;
}

const chord = (pad: string, bass: string, bright: string): Chord => ({ pad: notes(pad), bass: note(bass), bright: note(bright) });

/** Haven's home: C major 9, D over C, A minor 9, G six-nine. Bright, and never pulling anywhere. */
const HAVEN_CHORDS = [
  chord('C3 G3 D4 E4 B4', 'C2', 'C4'),
  chord('C3 A3 D4 F#4 A4', 'C2', 'D4'),
  chord('A2 E3 B3 C4 G4', 'A1', 'C4'),
  chord('G2 D3 A3 B3 E4', 'G1', 'G3'),
];

interface PadStyle {
  /** dB per oscillator. */
  readonly level: number;
  readonly shape: Shape;
  readonly detune: number;
  /** Centre of the low-pass in Hz, and how far it drifts either side. */
  readonly cutoff: number;
  readonly sweep: number;
  readonly attack: number;
  readonly release: number;
}

interface HavenStyle {
  readonly bpm: number;
  /** Sixteenths each chord lasts. */
  readonly chordSteps: number;
  readonly pad: PadStyle;
  readonly choir: { readonly level: number; readonly vowel: Vowel } | null;
  /** dB of the swell under each chord. */
  readonly sub: number | null;
  readonly bells: {
    readonly level: number;
    /** MIDI range the bells play in. */
    readonly low: number;
    readonly high: number;
    /** Seconds each bell rings. */
    readonly ring: number;
    /** Sixteenths between places a bell may fall. */
    readonly every: number;
    /** Chance of a bell on a strong place, a middling one, and the weak ones between. */
    readonly chance: readonly [number, number, number];
  } | null;
  /** dB of the festival's pulsing arpeggio and of its percussion. */
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

/** The title screen: Haven from a distance. The pad, and a bell every few seconds. */
const TITLE: HavenStyle = {
  ...HAVEN, bpm: 60, choir: null, sub: -32,
  bells: { level: -23.5, low: 72, high: 91, ring: 3.6, every: 4, chance: [0.75, 0.45, 0.12] },
};

/** Wednesday evening: the same chords, slower, lower, with the middle gone out of the sound. */
const EVENING: HavenStyle = {
  bpm: 54, chordSteps: 32,
  pad: { level: -40, shape: 'hollow', detune: 4, cutoff: 900, sweep: 300, attack: 2.4, release: 3.5 },
  choir: { level: -38, vowel: 'oo' },
  sub: null,
  bells: { level: -24, low: 67, high: 86, ring: 3, every: 4, chance: [0.6, 0.25, 0.05] },
  pulse: null, ticks: null,
};

/** Thursday's festival: everything Haven has, faster and brighter, with a pulse. */
const FESTIVAL: HavenStyle = {
  ...HAVEN, bpm: 96,
  pad: { ...HAVEN.pad, level: -42, cutoff: 2100, sweep: 900 },
  bells: { level: -28.5, low: 72, high: 96, ring: 1.5, every: 1, chance: [0.7, 0.4, 0.14] },
  pulse: -25.5, ticks: -34,
};

/** Which note of the chord the festival's pulse plays on each sixteenth of a bar. */
const PULSE = [0, 2, 4, 2, 1, 3, 4, 3, 0, 2, 4, 2, 1, 3, 4, 2];

/** A chord that is being held open, and what it takes to let it go. */
interface Held {
  readonly patch: Patch;
  readonly letGo: readonly LetGo[];
  /** Seconds its longest release takes. */
  readonly release: number;
}

/**
 * Lets the chord before go as the next one arrives. Chords are held rather than timed so that a paused game
 * comes back to the very chord it left, however long it was away.
 */
const handOver = (previous: Held | null, t: number): void => {
  if (!previous) return;
  for (const letGo of previous.letGo) letGo(t);
  previous.patch.release(t + previous.release + SLACK);
};

const CHOIR_RELEASE = 3;

/** The pad's two sides and the drifting low-pass they share. Chords are played into `left` and `right`. */
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

  // bells hop between two sides and leave a dotted-eighth echo behind them
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
          // a low swell that crests in the middle of the chord and is gone by the next
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
      // always on the grid, always a note of the chord's own scale: Haven cannot play a wrong note
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

// ---------------------------------------------------------------------------------------------------- unease

/**
 * Wednesday night, after "you just agreed with both of us". Nothing frightening happens: the music stops
 * moving. One chord with no third in it, a filter that no longer drifts, and nothing to say where it goes.
 */
const unease = (bed: Bed): void => {
  const { core, kit, t0 } = bed;
  bed.setRoot(note('D4'), t0);
  const still = core.filter('lowpass', 950, 0), sides = [core.pan(-0.5), core.pan(0.5)];
  for (const side of sides) side.connect(still);
  still.connect(bed.music);
  // D, A, D, G in pure ratios, one oscillator each. Everywhere else in the game pairs of oscillators drift
  // against each other, and tempered intervals beat; here every partial is locked to every other. The
  // waveform repeats exactly, for as long as the scene lasts.
  const d3 = mtof(note('D3'));
  [1, 3 / 2, 2, 8 / 3].forEach((ratio, i) => {
    // started a few milliseconds apart so that the locked partials do not all crest together
    core.osc(shape(kit, 'soft'), d3 * ratio, t0 + 0.0017 * i).connect(core.gain(dB(-36))).connect(sides[i % 2]!);
  });
  // a drone on the chord's own root
  const drone = core.gain(dB(-35));
  core.osc('sine', d3 / 2, t0).connect(drone);
  core.osc('sine', d3, t0 + 0.0011).connect(core.gain(0.3)).connect(drone);
  drone.connect(bed.music);
  // and very high up, the one thing that still moves: a glass tone that is two tones a third of a hertz apart
  const glass = core.gain(dB(-57));
  core.osc('sine', d3 * 12, t0).connect(glass);
  core.osc('sine', d3 * 12 + 0.31, t0).connect(glass);
  glass.connect(bed.music);
};

// ---------------------------------------------------------------------------------------------------- the human theme

/** One bar a line, eight eighth-notes a bar. */
const score = (bars: readonly string[]): (number | null)[] => bars.flatMap((bar) => bar.split(' ').map((n) => (n === '-' ? null : note(n))));

interface Part {
  readonly melody: readonly (number | null)[];
  readonly bass: readonly (number | null)[];
}

/** Jamie's theme: eight bars in G major, the kind of tune someone picks out on a kalimba without thinking. */
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

/** What follows the theme at the end of the week: only G, A and D, in no hurry. */
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
  /** dB of a melody note. */
  readonly level: number;
  /** Seconds before the first note. */
  readonly delay: number;
  /** What comes between statements of the theme: a coda, or this many bars of nothing. */
  readonly after: Part | number;
  /** Called at the start of every bar, with its number within the cycle. */
  readonly onBar?: (bar: number, t: number) => void;
}

/** Plays the theme on a kalimba, round and round, the way a person would: never twice quite the same. */
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
    // a thumb, not a sequencer: each note lands a touch late, no two are struck alike, and now and then one is left out
    if (m !== null && (strong || round === 0 || !rng.chance(0.1))) {
      const when = t + Math.abs(rng.gauss()) * 0.012, level = dB(o.level) * (strong ? 1 : 0.78) * (1 + 0.14 * rng.gauss());
      bed.play(when, (p) => kalimba(p, high, when, mtof(m), level));
    }
    if (b !== null) {
      const when = t + rng.range(0, 0.018), level = dB(o.level) * 0.7 * (1 + 0.1 * rng.gauss());
      bed.play(when, (p) => kalimba(p, low, when, mtof(b), level));
    }
    // the pulse breathes, and the last bar of the tune leans back
    const lean = inTheme && place >= 56 ? 0.07 * ((place - 56) / 8) : 0;
    return eighth * (1 + 0.025 * Math.sin(i * 0.21) + lean);
  });
};

// ---------------------------------------------------------------------------------------------------- the real world

/** A plain room in daytime: air, a ventilation duct, and the faintest open fifth, like wind across a bottle. */
const classroom = (bed: Bed, warm: boolean): void => {
  const { core, t0 } = bed;
  bed.setRoot(note('G3'), t0);
  for (const side of [-1, 1]) {
    // one unrelated noise for each ear, low-passed until only the size of the room is left
    const tone = core.gain(dB(-26));
    core.noise('pink', t0).connect(core.filter('highpass', 90, 0)).connect(core.filter('lowpass', 700, 0)).connect(tone).connect(core.pan(side * 0.7)).connect(bed.ambience);
  }
  const vent = core.gain(1);
  core.noise('brown', t0).connect(core.filter('bandpass', 140, 1.5)).connect(core.gain(dB(-27))).connect(vent);
  core.osc('sine', 118, t0).connect(core.gain(dB(-53))).connect(vent);
  core.osc('sine', 236.6, t0).connect(core.gain(dB(-61))).connect(vent);
  core.lfo(0.11, 0.12, t0).connect(vent.gain);
  vent.connect(bed.ambience);
  // the only music the room has: noise ringing in two narrow resonators, a fifth apart
  const airy = core.gain(dB(-23));
  for (const n of notes('G4 D5')) core.noise('pink', t0).connect(core.filter('bandpass', mtof(n), 45)).connect(airy);
  core.lfo(0.09, dB(-23) * 0.5, t0).connect(airy.gain);
  airy.connect(bed.music);

  if (warm) theme(bed, { bpm: 84, level: -24, delay: 2.2, after: 2 });
};

/** Six seconds of rain on glass, made to loop: a fine spray of ticks and the knock of heavier drops. */
const makeRain = (ctx: BaseAudioContext, rng: Rng): AudioBuffer => {
  const rate = ctx.sampleRate, n = Math.floor(6 * rate);
  const buffer = ctx.createBuffer(2, n, rate), left = buffer.getChannelData(0), right = buffer.getChannelData(1);
  const drops = (count: number, freq: readonly [number, number], ring: readonly [number, number], strength: readonly [number, number]): void => {
    for (let d = 0; d < count; d++) {
      const at = Math.floor(rng.next() * n), tau = rng.range(ring[0], ring[1]) * rate, w = (2 * Math.PI * rng.range(freq[0], freq[1])) / rate;
      const amp = rng.range(strength[0], strength[1]), side = rng.next(), phase = rng.next() * 2 * Math.PI, length = Math.floor(tau * 5);
      for (let k = 0; k < length; k++) {
        // drops that fall near the end wrap round to the start, so the loop has no seam
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

/** Phrases for the bedroom's piano, in E minor: [seconds into the phrase, note, touch]. */
const PHRASES: readonly (readonly (readonly [number, string, number])[])[] = [
  [[0, 'E4', 0.8], [1.2, 'B4', 0.7], [2.6, 'G4', 0.6]],
  [[0, 'A3', 0.7], [1.0, 'E4', 0.7], [2.1, 'D4', 0.55], [3.3, 'E4', 0.6]],
  [[0, 'B4', 0.7], [0.9, 'A4', 0.6], [2.0, 'E4', 0.65], [3.6, 'F#4', 0.5]],
  [[0, 'G4', 0.7], [1.4, 'E4', 0.6], [3.0, 'E3', 0.6]],
  [[0, 'D4', 0.6], [0.8, 'E4', 0.65], [1.7, 'G4', 0.7], [3.0, 'B4', 0.6]],
  [[0, 'C5', 0.6], [1.3, 'B4', 0.6], [2.7, 'G4', 0.55], [4.4, 'E4', 0.5]],
];

/** Night, rain on the window, the city a long way down. Someone is picking out notes on a piano, slowly. */
const bedroom = (bed: Bed): void => {
  const { core, kit, rng, t0 } = bed;
  bed.setRoot(note('G3'), t0);
  [0.083, 0.061].forEach((gust, i) => {
    // the hiss of rain, a different one in each ear, each rising and thinning in its own time
    const hiss = core.gain(dB(-23.5));
    core.lfo(gust, dB(-23.5) * 0.35, t0).connect(hiss.gain);
    core.noise('white', t0).connect(core.filter('highpass', 1500, 0)).connect(core.filter('bandpass', 5200, 0.5)).connect(hiss).connect(core.pan(i ? 0.8 : -0.8)).connect(bed.ambience);
  });
  const patter = core.gain(dB(-28));
  core.lfo(0.047, dB(-28) * 0.3, t0).connect(patter.gain);
  core.loop(kit.buffer('rain', makeRain), t0).connect(core.filter('highpass', 700, 0)).connect(patter).connect(bed.ambience);
  // the city: a rumble with no edges, and two low notes a fifth apart that never quite agree
  core.noise('brown', t0).connect(core.filter('lowpass', 140, 0)).connect(core.gain(dB(-25))).connect(bed.ambience);
  const hum = core.gain(dB(-40));
  for (const f of [55, 82.6]) core.osc('sine', f, t0).connect(hum);
  hum.connect(bed.ambience);

  bed.stream(t0 + 2, (t) => {
    // now and then a single drop off the window frame
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
    // sometimes the left hand puts a low E under the first note
    if (k === 0 && rng.chance(0.3)) bed.play(when, (p) => piano(p, bed.music, when + 0.03, mtof(note('E3')), level * 0.6));
    const following = line[++k];
    if (following) return (following[0] - at) * pace;
    // long gaps, and never the same phrase twice running
    k = 0;
    phrase = (phrase + rng.int(1, PHRASES.length - 1)) % PHRASES.length;
    pace = rng.range(0.9, 1.15);
    return rng.range(4, 8);
  });
};

// ---------------------------------------------------------------------------------------------------- ending

/** The theme's own harmony, one chord a bar, voiced for Haven's pad. The last is open: no third, no verdict. */
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

/** Friday: the human theme played over Haven's pad, coming to rest on an open chord and staying there. */
const ending = (bed: Bed): void => {
  const { kit } = bed;
  const style: PadStyle = { ...HAVEN.pad, level: -39, cutoff: 1300, sweep: 500, attack: 1.1, release: 2.8 };
  const pad = padVoice(bed, style);
  let held: Held | null = null;
  theme(bed, {
    bpm: 72, level: -24, delay: 0.8, after: CODA,
    onBar: (bar, t) => {
      // one chord a bar through the theme; the last, open one is then held right through the coda
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
};
