import { clamp } from '../core/math';
import { HALL, ROOM, Reverb } from './reverb';
import { Kit, Patch, dB, reap } from './synth';

export type BusName = 'music' | 'ambience' | 'sfx' | 'voice' | 'ui';
export type Space = 'haven' | 'interior';

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

export const MAX_ONE_SHOTS = 24;
const LEAD = 0.01;

const LIMITER = { threshold: -4, ratio: 20, attack: 0.003, release: 0.25 };
const LIMITER_MAKEUP_DB = -0.6 * LIMITER.threshold * (1 - 1 / LIMITER.ratio);

const SENDS: Record<Space, Record<Exclude<BusName, 'ui'>, readonly [hall: number, room: number]>> = {
  haven: { music: [0.5, 0], ambience: [0.2, 0], sfx: [0.3, 0], voice: [0.14, 0] },
  interior: { music: [0.1, 0.3], ambience: [0, 0], sfx: [0.03, 0.32], voice: [0, 0.22] },
};

const MAX_LEAN = 0.6;
const NEAR = 6;
const ROLLOFF = 0.08;
const FAR_FLOOR = 0.5;

export class Mixer {
  readonly kit: Kit;
  readonly buses: Record<BusName, GainNode>;
  readonly output: GainNode;
  space: Space = 'interior';

  private readonly world: GainNode;
  private readonly master: GainNode;
  private readonly sends: { bus: Exclude<BusName, 'ui'>; hall: GainNode; room: GainNode }[] = [];
  private readonly shots: Patch[] = [];
  private readonly retired: Patch[] = [];
  private readonly realtime: boolean;
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
    this.buses.voice.gain.value = dB(-6);
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

  setPaused(paused: boolean): void {
    this.world.gain.setTargetAtTime(paused ? 0 : 1, this.ctx.currentTime, paused ? 0.05 : 0.09);
  }

  wake(): void {
    const ctx = this.ctx;
    if (this.realtime && ctx.state !== 'running' && ctx.state !== 'closed') void (ctx as AudioContext).resume().catch(() => undefined);
  }

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
      const angle = ((lean + 1) * Math.PI) / 4;
      const side = p.balance(Math.SQRT2 * Math.cos(angle), Math.SQRT2 * Math.sin(angle));
      p.out.connect(side.input);
      side.output.connect(this.buses[bus]);
    }
    this.shots.push(p);
  }

  retire(p: Patch): void {
    this.retired.push(p);
  }

  sweep(now: number): void {
    reap(this.shots, now);
    reap(this.retired, now);
  }

  get voices(): number {
    return this.shots.length;
  }
}
