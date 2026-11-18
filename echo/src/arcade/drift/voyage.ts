import { clamp, type Rng } from '../../core/math';

export const TILE = 1.1;
export const GRID = 2;
export const WOOD_PER_TILE = 4;
export const MAX_LIGHT = 100;
export const reachOf = (light: number): number => 6 + 2.6 * clamp(light / MAX_LIGHT, 0, 1);
export const HOOK_OUT = 0.26, HOOK_BACK = 0.5;
const HOOK_GRAB = 0.95;
export const SEA = { half: 8.5, far: -15, near: 9 } as const;
const WORTH = { wood: { wood: 1, light: 0 }, crate: { wood: 2, light: 6 }, buoy: { wood: 0, light: 14 }, castaway: { wood: 0, light: 5 } } as const;

export interface Plan {
  readonly name: string;
  readonly length: number;
  readonly drain: number;
  readonly spawnEvery: number;
  readonly glow: number;
  readonly wyrmEvery: number;
  readonly patience: number;
  readonly knocks: number;
  readonly squall: readonly [number, number] | null;
  readonly raft: number;
}

export const PLANS: readonly Plan[] = [
  { name: 'Still Water', length: 100, drain: 2.6, spawnEvery: 1.0, glow: 0.3, wyrmEvery: 21, patience: 4.4, knocks: 2, squall: null, raft: 12 },
  { name: 'Evening Tide', length: 110, drain: 2.9, spawnEvery: 0.95, glow: 0.24, wyrmEvery: 15, patience: 3.6, knocks: 2, squall: [0.46, 0.68], raft: 15 },
  { name: 'Squall Night', length: 120, drain: 3.2, spawnEvery: 0.9, glow: 0.19, wyrmEvery: 10.5, patience: 2.9, knocks: 3, squall: [0.4, 0.72], raft: 18 },
];

export type ItemKind = 'wood' | 'crate' | 'buoy' | 'castaway';
export type CrewId = 'cindle' | 'nimbray' | 'tufflet';
export const CASTAWAYS: readonly { who: CrewId; at: number; does: string }[] = [
  { who: 'cindle', at: 0.12, does: 'The lantern burns longer' },
  { who: 'nimbray', at: 0.34, does: 'Fetches things in by itself' },
  { who: 'tufflet', at: 0.56, does: 'The wyrm is easier to see off' },
];
const CINDLE_SAVES = 0.7, NIMBRAY_EVERY = 6.5, NIMBRAY_REACH = 6;
export const CASTAWAY_TRIES = 2;

export interface Item {
  readonly id: number;
  readonly kind: ItemKind;
  x: number;
  z: number;
  readonly who?: CrewId;
  readonly phase: number;
  hooked: boolean;
}

export type WyrmState = 'away' | 'circling' | 'lunging';
export type Ending = 'arrived' | 'dark' | 'sunk';

export type VoyageEvent =
  | { readonly type: 'gather'; readonly item: Item; readonly by: 'hook' | 'raft' | 'crew' }
  | { readonly type: 'rescued'; readonly who: CrewId }
  | { readonly type: 'built'; readonly cx: number; readonly cz: number }
  | { readonly type: 'cast'; readonly x: number; readonly z: number }
  | { readonly type: 'landed'; readonly x: number; readonly z: number; readonly caught: number }
  | { readonly type: 'wyrm'; readonly what: 'rise' | 'hit' | 'driven' | 'lunge' | 'bite'; readonly cx: number; readonly cz: number }
  | { readonly type: 'storm'; readonly on: boolean }
  | { readonly type: 'low' }
  | { readonly type: 'end'; readonly how: Ending };

const cellKey = (cx: number, cz: number): string => `${cx},${cz}`;

export class Voyage {
  time = 0;
  light = 100;
  wood = 2;
  readonly tiles = new Set<string>([cellKey(0, 0)]);
  coreLives = 3;
  readonly crew: CrewId[] = [];
  readonly items: Item[] = [];
  readonly hook = { state: 'ready' as 'ready' | 'out' | 'back', x: 0, z: 0, tx: 0, tz: 0, t: 0, carrying: [] as Item[] };
  readonly wyrm = { state: 'away' as WyrmState, angle: 0, timer: 0, patience: 1, hits: 0, needed: 2, cx: 0, cz: 0, nextIn: 0, x: 0, z: 0, visits: 0 };
  over: Ending | null = null;
  storm = false;
  readonly events: VoyageEvent[] = [];
  readonly tally = { built: 0, bitten: 0, driven: 0 };

  private nextId = 1;
  private spawnIn = 0.4;
  private fetchIn = 2;
  private warned = false;
  private readonly waiting: { who: CrewId; at: number; tries: number }[];

  constructor(private readonly rng: Rng, readonly plan: Plan = PLANS[0]!) {
    this.waiting = CASTAWAYS.map((c) => ({ who: c.who, at: c.at * plan.length, tries: CASTAWAY_TRIES }));
    this.wyrm.nextIn = 0.2 * plan.length;
    for (let i = 0; i < 6; i++) {
      this.spawn(i % 3 === 1 ? 'buoy' : 'wood');
      this.items[i]!.z = SEA.far + ((i + rng.next()) / 6) * (-SEA.far - 4);
    }
  }

  get progress(): number {
    return clamp(this.time / this.plan.length, 0, 1);
  }

  get reach(): number {
    return reachOf(this.light);
  }

  has(cx: number, cz: number): boolean {
    return this.tiles.has(cellKey(cx, cz));
  }

  slots(): { cx: number; cz: number }[] {
    const out: { cx: number; cz: number }[] = [];
    for (let cx = -GRID; cx <= GRID; cx++) for (let cz = -GRID; cz <= GRID; cz++) {
      if (this.has(cx, cz)) continue;
      if (this.has(cx - 1, cz) || this.has(cx + 1, cz) || this.has(cx, cz - 1) || this.has(cx, cz + 1)) out.push({ cx, cz });
    }
    return out;
  }

  build(cx: number, cz: number): boolean {
    if (this.over || this.wood < WOOD_PER_TILE || !this.slots().some((s) => s.cx === cx && s.cz === cz)) return false;
    this.wood -= WOOD_PER_TILE;
    this.tiles.add(cellKey(cx, cz));
    this.tally.built++;
    this.events.push({ type: 'built', cx, cz });
    return true;
  }

  cast(x: number, z: number): boolean {
    if (this.over || this.hook.state !== 'ready') return false;
    const d = Math.hypot(x, z), k = d > this.reach ? this.reach / d : 1;
    Object.assign(this.hook, { state: 'out', tx: x * k, tz: z * k, t: 0, x: 0, z: 0 });
    this.events.push({ type: 'cast', x: x * k, z: z * k });
    return true;
  }

  private take(item: Item, by: 'hook' | 'raft' | 'crew'): void {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
    const worth = WORTH[item.kind];
    this.wood += worth.wood;
    this.light = Math.min(MAX_LIGHT, this.light + worth.light);
    this.events.push({ type: 'gather', item, by });
    if (item.kind === 'castaway' && item.who && !this.crew.includes(item.who)) {
      this.crew.push(item.who);
      this.events.push({ type: 'rescued', who: item.who });
    }
  }

  private spawn(kind: ItemKind, who?: CrewId): void {
    let x = kind === 'castaway' ? this.rng.sign() * this.rng.range(2.6, 4.6) : this.rng.range(-SEA.half, SEA.half);
    if (Math.abs(x) < 0.5) x = 0.5 * Math.sign(x || 1);
    this.items.push({ id: this.nextId++, kind, x, z: SEA.far, who, phase: this.rng.range(0, 6.28), hooked: false });
  }

  private wyrmTarget(): { cx: number; cz: number } {
    const dx = Math.sin(this.wyrm.angle), dz = Math.cos(this.wyrm.angle);
    let best = { cx: 0, cz: 0 }, bestScore = -Infinity;
    for (const key of this.tiles) {
      const [cx, cz] = key.split(',').map(Number) as [number, number];
      if (cx === 0 && cz === 0 && this.tiles.size > 1) continue;
      const score = cx * dx + cz * dz + 0.01 * Math.hypot(cx, cz);
      if (score > bestScore) {
        bestScore = score;
        best = { cx, cz };
      }
    }
    return best;
  }

  step(dt: number): void {
    if (this.over) return;
    const rng = this.rng, plan = this.plan;
    this.time += dt;
    const p = this.progress;

    const storm = !!plan.squall && p > plan.squall[0] && p < plan.squall[1];
    if (storm !== this.storm) {
      this.storm = storm;
      this.events.push({ type: 'storm', on: storm });
    }

    this.light = Math.max(0, this.light - plan.drain * (storm ? 1.3 : 1) * (this.crew.includes('cindle') ? CINDLE_SAVES : 1) * dt);
    if (this.light < 22 && !this.warned) {
      this.warned = true;
      this.events.push({ type: 'low' });
    } else if (this.light > 40) this.warned = false;
    if (this.light <= 0) return this.end('dark');

    this.spawnIn -= dt;
    if (this.spawnIn <= 0) {
      this.spawnIn = plan.spawnEvery * (storm ? 0.75 : 1) * rng.range(0.7, 1.3);
      const glow = this.light < 30 ? 0.5 : plan.glow, roll = rng.next();
      this.spawn(roll < glow ? 'buoy' : roll < glow + 0.12 ? 'crate' : 'wood');
    }
    for (const c of this.waiting) {
      if (c.tries <= 0 || this.time < c.at || this.crew.includes(c.who) || this.items.some((i) => i.who === c.who)) continue;
      c.tries--;
      c.at = this.time + 12;
      this.spawn('castaway', c.who);
    }
    const drift = storm ? 2.0 : 1.55;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i]!;
      if (item.hooked) continue;
      item.z += (item.kind === 'castaway' ? drift * 0.8 : drift) * dt;
      item.x += Math.sin(this.time * 0.6 + item.phase) * 0.25 * dt;
      if (item.z > SEA.near) {
        this.items.splice(i, 1);
        continue;
      }
      const cx = Math.round(item.x / TILE), cz = Math.round(item.z / TILE);
      if (this.has(cx, cz) && Math.hypot(item.x - cx * TILE, item.z - cz * TILE) < TILE * 0.55) this.take(item, 'raft');
    }

    const hook = this.hook;
    if (hook.state === 'out') {
      hook.t += dt / HOOK_OUT;
      const k = Math.min(1, hook.t);
      hook.x = hook.tx * k;
      hook.z = hook.tz * k;
      if (k >= 1) {
        hook.state = 'back';
        hook.t = 0;
        const off = (i: Item): number => Math.hypot(i.x - hook.tx, i.z - hook.tz);
        const near = this.items.filter((i) => !i.hooked && off(i) < HOOK_GRAB).sort((a, b) => off(a) - off(b)).slice(0, 2);
        for (const item of near) item.hooked = true;
        hook.carrying = near;
        this.events.push({ type: 'landed', x: hook.tx, z: hook.tz, caught: near.length });
        this.strike(hook.tx, hook.tz);
      }
    } else if (hook.state === 'back') {
      hook.t += dt / HOOK_BACK;
      const k = Math.min(1, hook.t);
      hook.x = hook.tx * (1 - k);
      hook.z = hook.tz * (1 - k);
      for (const item of hook.carrying) {
        item.x = hook.x;
        item.z = hook.z;
      }
      if (k >= 1) {
        hook.state = 'ready';
        for (const item of hook.carrying) this.take(item, 'hook');
        hook.carrying = [];
      }
    }

    if (this.crew.includes('nimbray')) {
      this.fetchIn -= dt;
      if (this.fetchIn <= 0) {
        const near = this.items.filter((i) => !i.hooked && i.kind !== 'castaway' && Math.hypot(i.x, i.z) < NIMBRAY_REACH).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
        if (near) {
          this.fetchIn = NIMBRAY_EVERY;
          this.take(near, 'crew');
        } else this.fetchIn = 0.5;
      }
    }

    this.stepWyrm(dt, p);
    if (!this.over && this.time >= plan.length) this.end('arrived');
  }

  private end(how: Ending): void {
    this.over = how;
    this.events.push({ type: 'end', how });
  }

  private strike(x: number, z: number): void {
    const w = this.wyrm;
    if (w.state !== 'circling' || Math.hypot(x - w.x, z - w.z) > 1.5) return;
    w.hits++;
    w.timer += 0.35;
    const driven = w.hits >= w.needed;
    this.events.push({ type: 'wyrm', what: driven ? 'driven' : 'hit', cx: w.cx, cz: w.cz });
    if (!driven) return;
    this.tally.driven++;
    this.wyrmLeaves();
  }

  private wyrmLeaves(): void {
    const w = this.wyrm;
    w.state = 'away';
    w.nextIn = this.plan.wyrmEvery * (this.storm ? 0.7 : 1) * this.rng.range(0.85, 1.2);
  }

  private stepWyrm(dt: number, p: number): void {
    const w = this.wyrm;
    if (w.state === 'away') {
      w.nextIn -= dt;
      if (w.nextIn > 0 || p > 0.9) return;
      w.state = 'circling';
      w.angle = this.rng.range(0, Math.PI * 2);
      w.timer = w.patience = this.plan.patience * (w.visits++ === 0 ? 1.45 : 1);
      w.hits = 0;
      w.needed = Math.max(1, this.plan.knocks - (this.crew.includes('tufflet') ? 1 : 0));
      Object.assign(w, this.wyrmTarget());
      this.events.push({ type: 'wyrm', what: 'rise', cx: w.cx, cz: w.cz });
    }
    if (w.state === 'circling') {
      w.timer -= dt;
      w.angle += 0.5 * dt;
      Object.assign(w, this.wyrmTarget());
      const r = 3.5 + 1.3 * clamp(w.timer / w.patience, 0, 1);
      w.x = Math.sin(w.angle) * r;
      w.z = Math.cos(w.angle) * r;
      if (w.timer <= 0) {
        w.state = 'lunging';
        w.timer = 0.55;
        this.events.push({ type: 'wyrm', what: 'lunge', cx: w.cx, cz: w.cz });
      }
    } else if (w.state === 'lunging') {
      w.timer -= dt;
      const k = 1 - Math.max(0, w.timer / 0.55);
      w.x += (w.cx * TILE - w.x) * k * 0.4;
      w.z += (w.cz * TILE - w.z) * k * 0.4;
      if (w.timer > 0) return;
      this.tally.bitten++;
      this.events.push({ type: 'wyrm', what: 'bite', cx: w.cx, cz: w.cz });
      if (w.cx === 0 && w.cz === 0) {
        if (--this.coreLives <= 0) return this.end('sunk');
      } else this.tiles.delete(cellKey(w.cx, w.cz));
      this.wyrmLeaves();
    }
  }

  get stars(): 0 | 1 | 2 | 3 {
    if (this.over !== 'arrived') return 0;
    return (1 + (this.tiles.size >= this.plan.raft ? 1 : 0) + (this.crew.length >= CASTAWAYS.length ? 1 : 0)) as 1 | 2 | 3;
  }
}

export type Deed = { kind: 'cast'; x: number; z: number } | { kind: 'build'; cx: number; cz: number };

const wanted = (v: Voyage, i: Item): number => (i.kind === 'castaway' ? 5 : i.kind === 'buoy' ? (v.light < 70 ? 4 : 0.5) : i.kind === 'crate' ? 3 : v.slots().length ? 2 : 0.2);

export const nextDeed = (v: Voyage): Deed | null => {
  if (v.over) return null;
  const slot = v.slots()[0];
  if (v.wood >= WOOD_PER_TILE && slot) return { kind: 'build', ...slot };
  if (v.hook.state !== 'ready') return null;
  if (v.wyrm.state === 'circling') return { kind: 'cast', x: v.wyrm.x, z: v.wyrm.z };
  const reach = v.reach;
  const best = v.items.filter((i) => !i.hooked && Math.hypot(i.x, i.z) < reach).sort((a, b) => wanted(v, b) - wanted(v, a) || Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
  return best ? { kind: 'cast', x: best.x, z: best.z + 0.4 } : null;
};
