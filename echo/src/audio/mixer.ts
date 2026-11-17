import { clamp } from '../core/math';
import { HALL, ROOM, Reverb } from './reverb';
import { Kit, Patch, dB, reap } from './synth';

export type BusName = 'music' | 'ambience' | 'sfx' | 'voice' | 'ui';
/** The acoustics around the player: open sky, or four walls. */
export type Space = 'haven' | 'interior';

/** A world position: anything with coordinates, so the mixer needs nothing from three.js. */
export interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PlayOptions {
  gain?: number;
  pitch?: number;
  at?: Point;
}

/** One-shots allowed to sound at once. One more than this and the oldest is faded out to make room. */
export const MAX_ONE_SHOTS = 24;
/** One-shots start this far ahead of the clock, so their first ramp is never clipped by a busy main thread. */
const LEAD = 0.01;

/**
 * The safety limiter. With a hard knee it does nothing at all below its threshold, so the mix is heard exactly
 * as balanced; it only acts when many loud things land together.
 */
const LIMITER = { threshold: -4, ratio: 20, attack: 0.003, release: 0.25 };
/** The compressor node adds this much gain by itself (0.6 of what it would take off a full-scale signal). */
const LIMITER_MAKEUP_DB = -0.6 * LIMITER.threshold * (1 - 1 / LIMITER.ratio);

/** How much of each bus goes to the long reverb and to the short one, by where the player is. */
const SENDS: Record<Space, Record<Exclude<BusName, 'ui'>, readonly [hall: number, room: number]>> = {
  haven: { music: [0.5, 0], ambience: [0.2, 0], sfx: [0.3, 0], voice: [0.14, 0] },
  interior: { music: [0.1, 0.3], ambience: [0, 0], sfx: [0.03, 0.32], voice: [0, 0.22] },
};

/** A sound dead ahead or within arm's reach plays as written; from there it leans and thins, but only so far. */
const MAX_LEAN = 0.6;
const NEAR = 6;
const ROLLOFF = 0.08;
const FAR_FLOOR = 0.5;

/**
 * The signal path from every sound to the speakers:
 *
 *   music, ambience, sfx, voice -> world (ducked while paused) -> master (volume) -> limiter -> output
 *   ui -----------------------------------------------------------^
 *
 * with a send from each world bus to the long reverb and the short one. It also plays one-shots: it places
 * them around the listener, caps how many sound at once, and takes them down when they end.
 */
export class Mixer {
  readonly kit: Kit;
  readonly buses: Record<BusName, GainNode>;
  /** The last node before the speakers, for tools that meter the finished mix. */
  readonly output: GainNode;
  space: Space = 'interior';

  private readonly world: GainNode;
  private readonly master: GainNode;
  private readonly sends: { bus: Exclude<BusName, 'ui'>; hall: GainNode; room: GainNode }[] = [];
  /** One-shots still sounding, oldest first. */
  private readonly shots: Patch[] = [];
  /** Sounds on their way out that no longer count toward the cap. */
  private readonly retired: Patch[] = [];
  /** A realtime context can be held back by the browser; an offline one is simply rendered. */
  private readonly realtime: boolean;
  /** Listener position and the direction of its right ear. */
  private readonly ear = { x: 0, y: 0, z: 0, rx: 1, ry: 0, rz: 0 };

  constructor(readonly ctx: BaseAudioContext) {
    this.realtime = typeof AudioContext !== 'undefined' && ctx instanceof AudioContext;
    const gain = (): GainNode => ctx.createGain();
    this.world = gain();
    this.master = gain();
    this.output = gain();
    this.output.gain.value = dB(-LIMITER_MAKEUP_DB);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = LIMITER.threshold;
    limiter.knee.value = 0;
    limiter.ratio.value = LIMITER.ratio;
    limiter.attack.value = LIMITER.attack;
    limiter.release.value = LIMITER.release;
    this.world.connect(this.master).connect(limiter).connect(this.output).connect(ctx.destination);

    const hall = new Reverb(ctx, HALL), room = new Reverb(ctx, ROOM);
    hall.output.connect(this.world);
    room.output.connect(this.world);
    this.kit = new Kit(ctx, hall.input, room.input);

    this.buses = { music: gain(), ambience: gain(), sfx: gain(), voice: gain(), ui: gain() };
    // interface sounds stay dry and stay audible in the pause menu
    this.buses.ui.connect(this.master);
    for (const bus of ['music', 'ambience', 'sfx', 'voice'] as const) {
      const node = this.buses[bus], toHall = gain(), toRoom = gain();
      node.connect(this.world);
      node.connect(toHall).connect(hall.input);
      node.connect(toRoom).connect(room.input);
      [toHall.gain.value, toRoom.gain.value] = SENDS[this.space][bus];
      this.sends.push({ bus, hall: toHall, room: toRoom });
    }
  }

  /** Changes the acoustics over `seconds`: sounds already ringing move with the player. */
  setSpace(space: Space, seconds: number): void {
    if (space === this.space) return;
    this.space = space;
    const now = this.ctx.currentTime, tau = Math.max(seconds, 0.05) / 3;
    for (const s of this.sends) {
      const [hall, room] = SENDS[space][s.bus];
      s.hall.gain.setTargetAtTime(hall, now, tau);
      s.room.gain.setTargetAtTime(room, now, tau);
    }
  }

  setVolume(volume: number): void {
    this.master.gain.setTargetAtTime(clamp(volume, 0, 1), this.ctx.currentTime, 0.03);
  }

  /** Ducks the world to silence, or brings it back. Music is not rescheduled: it simply stops being composed. */
  setPaused(paused: boolean): void {
    this.world.gain.setTargetAtTime(paused ? 0 : 1, this.ctx.currentTime, paused ? 0.05 : 0.09);
  }

  /** If the browser is holding a realtime context back, asks for it to run. Only works inside a user gesture. */
  wake(): void {
    const ctx = this.ctx;
    if (this.realtime && ctx.state !== 'running' && ctx.state !== 'closed') void (ctx as AudioContext).resume().catch(() => undefined);
  }

  /** Where the listener is, from a camera's world matrix (column-major: right, up, back, position). */
  setListener(m: ArrayLike<number>): void {
    const e = this.ear;
    e.x = m[12] ?? 0;
    e.y = m[13] ?? 0;
    e.z = m[14] ?? 0;
    const len = Math.hypot(m[0] ?? 1, m[1] ?? 0, m[2] ?? 0) || 1;
    e.rx = (m[0] ?? 1) / len;
    e.ry = (m[1] ?? 0) / len;
    e.rz = (m[2] ?? 0) / len;
  }

  /**
   * Plays one sound on a bus. With a position it is leaned toward that side and thinned with distance: never
   * fully to one ear, never to nothing. Dropped if the context is not running, so that sounds asked for in
   * the meantime do not all go off together when it starts.
   */
  play(bus: BusName, build: (p: Patch) => void, options: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (this.realtime && ctx.state !== 'running') return;
    const now = ctx.currentTime;
    this.sweep(now);
    let level = Math.max(0, options.gain ?? 1), lean = 0;
    const at = options.at;
    if (at) {
      const e = this.ear, dx = at.x - e.x, dy = at.y - e.y, dz = at.z - e.z, distance = Math.hypot(dx, dy, dz);
      if (distance > 1e-3) lean = clamp((dx * e.rx + dy * e.ry + dz * e.rz) / distance, -1, 1) * MAX_LEAN;
      level *= Math.max(FAR_FLOOR, NEAR / (NEAR + ROLLOFF * Math.max(0, distance - NEAR)));
    }
    if (this.shots.length >= MAX_ONE_SHOTS) {
      const oldest = this.shots.shift()!;
      oldest.cut(now);
      this.retired.push(oldest);
    }
    const p = new Patch(this.kit, now + LEAD, level, options.pitch ?? 1);
    try {
      build(p);
    } catch (e) {
      p.release(now);
      p.dispose();
      throw e;
    }
    if (lean === 0) p.out.connect(this.buses[bus]);
    else {
      // equal-power balance, scaled so that dead centre is exactly the unplaced sound
      const angle = ((lean + 1) * Math.PI) / 4;
      const side = p.balance(Math.SQRT2 * Math.cos(angle), Math.SQRT2 * Math.sin(angle));
      p.out.connect(side.input);
      side.output.connect(this.buses[bus]);
    }
    this.shots.push(p);
  }

  /** Hands over a sound that is already ending, to be taken down when it has. */
  retire(p: Patch): void {
    this.retired.push(p);
  }

  /** Takes down every one-shot that has finished. */
  sweep(now: number): void {
    reap(this.shots, now);
    reap(this.retired, now);
  }

  /** One-shots sounding now. */
  get voices(): number {
    return this.shots.length;
  }
}
