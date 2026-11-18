import { clamp, type Rng } from '../../core/math';

export const LANE = 3.0;
export const GAP = 0.45;
export const RANGE = 12;
export const SPARK_SPEED = 20;
export const MARCH = 4.4;
export const MAX_FLOCK = 99;
const SPARKS_EACH = 1.5, QUICKEN = 0.25, MAX_QUICK = 3;
export const flockRadius = (count: number): number => Math.min(1.7, 0.1 + 0.2 * Math.sqrt(count));

export type GateOp = { readonly kind: 'add' | 'sub' | 'mul' | 'div'; readonly n: number } | { readonly kind: 'quick' };

export const through = (count: number, op: GateOp): number =>
  clamp(op.kind === 'add' ? count + op.n : op.kind === 'sub' ? count - op.n : op.kind === 'mul' ? count * op.n : op.kind === 'div' ? Math.ceil(count / op.n) : count, 1, MAX_FLOCK);

export const labelOf = (op: GateOp): string => (op.kind === 'add' ? `+${op.n}` : op.kind === 'sub' ? `−${op.n}` : op.kind === 'mul' ? `×${op.n}` : op.kind === 'div' ? `÷${op.n}` : '»');
export const toneOf = (op: GateOp): 'good' | 'bad' | 'quick' => (op.kind === 'quick' ? 'quick' : op.kind === 'add' || op.kind === 'mul' ? 'good' : 'bad');

export const worthOf = (count: number, quick: number, op: GateOp): number => (op.kind === 'quick' ? count * (quick < MAX_QUICK ? 1 + QUICKEN / (1 + QUICKEN * quick) : 1) : through(count, op));

type GateSpec = readonly ['add' | 'sub', number, number] | readonly ['mul' | 'div', number] | readonly ['quick'];
type Beat = { readonly at: number; readonly gate: readonly [GateSpec, GateSpec] } | { readonly at: number; readonly horde: number; readonly brutes?: number; readonly side?: boolean };
const HORDE = [10, 220] as const;
export const SIGHT = RANGE + 33, GATHER = RANGE + 15;

export interface Stage {
  readonly name: string;
  readonly start: number;
  readonly beats: readonly Beat[];
  readonly length: number;
  readonly horde: number;
  readonly lingHp: number;
  readonly bruteHp: number;
  readonly maw: { readonly hp: number; readonly pace: number; readonly brood: number };
  readonly stars: readonly [number, number];
}

export const STAGES: readonly Stage[] = [
  {
    name: 'First Dusk', start: 5, length: 250, horde: 2.8, lingHp: 1, bruteHp: 30, maw: { hp: 300, pace: 0.5, brood: 2.2 }, stars: [26, 60],
    beats: [
      { at: 18, gate: [['add', 4, 6], ['add', 9, 12]] }, { at: 40, horde: 1.3 },
      { at: 62, gate: [['mul', 2], ['add', 6, 9]] }, { at: 86, horde: 1.6, side: true },
      { at: 110, gate: [['sub', 3, 5], ['add', 5, 8]] }, { at: 132, horde: 1.8, brutes: 1 },
      { at: 158, gate: [['mul', 2], ['quick']] }, { at: 182, horde: 2.0, side: true },
      { at: 206, gate: [['add', 12, 18], ['mul', 2]] }, { at: 228, horde: 2.1, brutes: 2 },
    ],
  },
  {
    name: 'Long Dusk', start: 6, length: 310, horde: 2.1, lingHp: 1, bruteHp: 34, maw: { hp: 700, pace: 0.55, brood: 1.9 }, stars: [36, 70],
    beats: [
      { at: 18, gate: [['add', 5, 8], ['mul', 2]] }, { at: 38, horde: 1.5 },
      { at: 60, gate: [['div', 2], ['sub', 2, 4]] }, { at: 82, horde: 1.7, brutes: 1, side: true },
      { at: 106, gate: [['mul', 3], ['add', 14, 20]] }, { at: 130, horde: 1.9 },
      { at: 154, gate: [['quick'], ['add', 8, 12]] }, { at: 178, horde: 2.1, brutes: 2, side: true },
      { at: 204, gate: [['sub', 8, 12], ['div', 2]] }, { at: 228, horde: 2.2, brutes: 1 },
      { at: 254, gate: [['mul', 2], ['add', 18, 26]] }, { at: 280, horde: 2.4, brutes: 2 },
    ],
  },
  {
    name: 'Deep Dusk', start: 8, length: 370, horde: 1.6, lingHp: 1, bruteHp: 38, maw: { hp: 950, pace: 0.6, brood: 1.6 }, stars: [44, 84],
    beats: [
      { at: 18, gate: [['mul', 2], ['add', 9, 13]] }, { at: 38, horde: 1.7, brutes: 1 },
      { at: 62, gate: [['sub', 4, 6], ['div', 2]] }, { at: 84, horde: 1.9, side: true },
      { at: 108, gate: [['mul', 3], ['add', 22, 30]] }, { at: 132, horde: 2.1, brutes: 2 },
      { at: 158, gate: [['div', 3], ['sub', 10, 14]] }, { at: 182, horde: 2.2, brutes: 1, side: true },
      { at: 208, gate: [['quick'], ['mul', 2]] }, { at: 232, horde: 2.4, brutes: 2 },
      { at: 258, gate: [['div', 2], ['sub', 14, 20]] }, { at: 282, horde: 2.5, brutes: 2, side: true },
      { at: 308, gate: [['add', 20, 30], ['mul', 2]] }, { at: 334, horde: 2.7, brutes: 3 },
    ],
  },
];

export interface Gate {
  readonly id: number;
  ahead: number;
  readonly left: GateOp;
  readonly right: GateOp;
  taken: 'left' | 'right' | 'none' | null;
}

export type FoeKind = 'ling' | 'brute' | 'maw';
export interface Foe {
  readonly id: number;
  readonly kind: FoeKind;
  x: number;
  ahead: number;
  hp: number;
  readonly maxHp: number;
  readonly radius: number;
  readonly pace: number;
  readonly phase: number;
}

export interface Spark {
  x: number;
  ahead: number;
  live: boolean;
}

export type Ending = 'dawn' | 'dark';

export type MarchEvent =
  | { readonly type: 'gate'; readonly gate: Gate; readonly op: GateOp; readonly before: number; readonly after: number }
  | { readonly type: 'lit'; readonly foe: Foe }
  | { readonly type: 'struck'; readonly foe: Foe }
  | { readonly type: 'dimmed'; readonly by: Foe; readonly lost: number }
  | { readonly type: 'wave'; readonly lings: number; readonly brutes: number }
  | { readonly type: 'maw'; readonly foe: Foe }
  | { readonly type: 'end'; readonly how: Ending };

const RADIUS: Record<FoeKind, number> = { ling: 0.42, brute: 0.9, maw: 2.3 };
const LING_DRIFT = 0.2;
const BITE: Record<FoeKind, number> = { ling: 1, brute: 7, maw: MAX_FLOCK };
const MAW_CAP = 1 / 9;
export const MAW_STAND = RANGE - 1.5;

export class March {
  time = 0;
  distance = 0;
  count: number;
  x = 0;
  lead = 0;
  quick = 0;
  readonly gates: Gate[] = [];
  readonly foes: Foe[] = [];
  readonly sparks: Spark[] = [];
  maw: Foe | null = null;
  over: Ending | null = null;
  readonly events: MarchEvent[] = [];
  readonly tally = { lit: 0, dimmed: 0, most: 0 };

  private nextId = 1;
  private beat = 0;
  private owed = 0;
  private broodIn = 2;
  private mawTaken = 0;

  constructor(private readonly rng: Rng, readonly stage: Stage = STAGES[0]!) {
    this.count = this.tally.most = stage.start;
    for (let i = 0; i < 160; i++) this.sparks.push({ x: 0, ahead: 0, live: false });
  }

  get radius(): number {
    return flockRadius(this.count);
  }

  get sparkRate(): number {
    return this.count * SPARKS_EACH * (1 + QUICKEN * this.quick);
  }

  get progress(): number {
    return clamp(this.distance / this.stage.length, 0, 1);
  }

  get stars(): 0 | 1 | 2 | 3 {
    if (this.over !== 'dawn') return 0;
    return this.count >= this.stage.stars[1] ? 3 : this.count >= this.stage.stars[0] ? 2 : 1;
  }

  private op(spec: GateSpec): GateOp {
    const [kind, from, to] = spec as readonly [GateOp['kind'], number?, number?];
    return kind === 'quick' ? { kind } : { kind, n: to === undefined ? from! : this.rng.int(from!, to) };
  }

  private foe(kind: FoeKind, x: number, ahead: number, hp: number, pace: number): Foe {
    const foe: Foe = { id: this.nextId++, kind, x, ahead, hp, maxHp: hp, radius: RADIUS[kind], pace, phase: this.rng.range(0, 6.28) };
    this.foes.push(foe);
    return foe;
  }

  private unroll(): void {
    const stage = this.stage, rng = this.rng;
    for (; this.beat < stage.beats.length; this.beat++) {
      const beat = stage.beats[this.beat]!, ahead = beat.at - this.distance;
      if (ahead > ('gate' in beat ? SIGHT : GATHER)) break;
      if ('gate' in beat) {
        const [a, b] = rng.chance(0.5) ? beat.gate : [beat.gate[1], beat.gate[0]];
        this.gates.push({ id: this.nextId++, ahead, left: this.op(a), right: this.op(b), taken: null });
      } else {
        const lings = clamp(Math.round(beat.horde * stage.horde * this.count), HORDE[0], HORDE[1]);
        const bruteHp = Math.round(stage.bruteHp * (0.6 + this.count / 30));
        const middle = beat.side ? rng.sign() * 1.5 : 0, spread = beat.side ? 1.5 : LANE - 0.3, deep = 6 + lings * 0.07;
        for (let i = 0; i < lings; i++) this.foe('ling', clamp(middle + rng.range(-1, 1) * spread, -LANE + 0.3, LANE - 0.3), ahead + rng.range(0, deep), stage.lingHp, rng.range(0.8, 1.4));
        for (let i = 0; i < (beat.brutes ?? 0); i++) this.foe('brute', rng.range(-LANE + 1, LANE - 1), ahead + deep + 1 + i * 3.2, bruteHp, 0.5);
        this.events.push({ type: 'wave', lings, brutes: beat.brutes ?? 0 });
      }
    }
    if (this.beat >= stage.beats.length && !this.maw && stage.length - this.distance < SIGHT) {
      this.maw = this.foe('maw', 0, stage.length - this.distance + MAW_STAND, stage.maw.hp, stage.maw.pace);
      this.events.push({ type: 'maw', foe: this.maw });
    }
  }

  private end(how: Ending): void {
    this.over = how;
    this.events.push({ type: 'end', how });
  }

  step(dt: number): void {
    if (this.over) return;
    const rng = this.rng, stage = this.stage;
    this.time += dt;
    const reach = LANE - Math.min(this.radius, 1.2) * 0.5;
    this.x += clamp(clamp(this.lead, -reach, reach) - this.x, -9 * dt, 9 * dt);

    const marching = this.distance < stage.length;
    const pace = marching ? MARCH : 0;
    this.distance = Math.min(stage.length, this.distance + pace * dt);
    this.unroll();

    for (let i = this.gates.length - 1; i >= 0; i--) {
      const gate = this.gates[i]!;
      gate.ahead -= pace * dt;
      if (gate.ahead <= 0 && !gate.taken) {
        gate.taken = this.x < -GAP ? 'left' : this.x > GAP ? 'right' : 'none';
        if (gate.taken !== 'none') {
          const op = gate[gate.taken], before = this.count;
          if (op.kind === 'quick') this.quick = Math.min(MAX_QUICK, this.quick + 1);
          this.count = through(this.count, op);
          this.tally.most = Math.max(this.tally.most, this.count);
          this.events.push({ type: 'gate', gate, op, before, after: this.count });
        }
      }
      if (gate.ahead < -6) this.gates.splice(i, 1);
    }

    const maw = this.maw;
    this.mawTaken = Math.max(0, this.mawTaken - stage.maw.hp * MAW_CAP * dt);
    if (maw && maw.ahead < RANGE + 4 && (this.broodIn -= dt) <= 0) {
      this.broodIn = stage.maw.brood;
      for (const side of [-1, 1]) this.foe('ling', clamp(maw.x + side * rng.range(0.8, 2.6), -LANE + 0.3, LANE - 0.3), maw.ahead - 2.2, stage.lingHp, rng.range(1.2, 1.7));
    }

    const flock = this.radius;
    for (let i = this.foes.length - 1; i >= 0; i--) {
      const foe = this.foes[i]!;
      foe.ahead -= (pace + (foe.kind === 'maw' && marching ? 0 : foe.pace)) * dt;
      if (foe.kind === 'ling') foe.x += clamp(this.x - foe.x, -LING_DRIFT * dt, LING_DRIFT * dt);
      const level = foe.kind === 'maw' ? foe.ahead <= foe.radius + 0.5 : foe.ahead <= 0.35 && foe.ahead > -0.7;
      if (level && Math.abs(foe.x - this.x) < flock + foe.radius) {
        const lost = Math.min(this.count, BITE[foe.kind]);
        this.count -= lost;
        this.tally.dimmed += lost;
        this.events.push({ type: 'dimmed', by: foe, lost });
        if (foe.kind !== 'maw') this.foes.splice(i, 1);
        if (this.count <= 0) return this.end('dark');
      } else if (foe.ahead < -4) this.foes.splice(i, 1);
    }

    this.owed += this.sparkRate * dt;
    for (const spark of this.sparks) {
      if (spark.live || this.owed < 1) continue;
      this.owed--;
      spark.live = true;
      spark.x = this.x + rng.range(-1, 1) * flock * 0.92;
      spark.ahead = 0.3;
    }
    const unseen = Math.floor(this.owed);
    this.owed -= unseen;
    for (let n = 0; n < unseen; n++) this.land(this.x + rng.range(-1, 1) * flock * 0.92, 0, RANGE);
    for (const spark of this.sparks) {
      if (!spark.live) continue;
      const from = spark.ahead;
      spark.ahead += SPARK_SPEED * dt;
      if (this.land(spark.x, from, spark.ahead) || spark.ahead > RANGE) spark.live = false;
    }
    if (maw && maw.hp <= 0) this.end('dawn');
  }

  private land(x: number, from: number, to: number): boolean {
    let first: Foe | null = null;
    for (const foe of this.foes) {
      if (foe.hp <= 0 || Math.abs(foe.x - x) > foe.radius + 0.14) continue;
      if (foe.ahead - foe.radius * 0.6 <= to && foe.ahead + 0.6 >= from && (!first || foe.ahead < first.ahead)) first = foe;
    }
    if (!first) return false;
    if (first.kind === 'maw') {
      const room = this.stage.maw.hp * MAW_CAP - this.mawTaken;
      if (room < 1) return true;
      this.mawTaken++;
    }
    first.hp--;
    if (first.hp > 0) this.events.push({ type: 'struck', foe: first });
    else {
      this.tally.lit++;
      this.events.push({ type: 'lit', foe: first });
      if (first.kind !== 'maw') this.foes.splice(this.foes.indexOf(first), 1);
    }
    return true;
  }
}

export const leadFor = (m: March, wise: boolean): number => {
  const gate = m.gates.filter((g) => !g.taken && g.ahead < 26).sort((a, b) => a.ahead - b.ahead)[0];
  if (gate && gate.ahead < 13) {
    const left = worthOf(m.count, m.quick, gate.left), right = worthOf(m.count, m.quick, gate.right);
    if (wise && Math.max(left, right) < m.count) return 0;
    return (left >= right === wise ? -1 : 1) * (LANE * 0.55);
  }
  const brute = m.foes.find((f) => f.kind === 'brute' && f.ahead < 4.5 && f.hp > m.sparkRate * 0.25);
  if (brute) return brute.x > 0 ? brute.x - brute.radius - m.radius - 0.4 : brute.x + brute.radius + m.radius + 0.4;
  let near: Foe | null = null;
  for (const f of m.foes) if (f.ahead > 0.5 && f.ahead < RANGE && (!near || f.ahead < near.ahead)) near = f;
  return near ? near.x : gate ? 0 : m.lead * 0.98;
};
