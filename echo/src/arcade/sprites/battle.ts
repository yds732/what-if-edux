import { clamp, type Rng } from '../../core/math';

export type Element = 'ember' | 'tide' | 'bloom';
export const ELEMENTS: readonly Element[] = ['ember', 'tide', 'bloom'];
const BEATS: Record<Element, Element> = { ember: 'bloom', bloom: 'tide', tide: 'ember' };

export const STRONG = 1.5, WEAK = 0.67;
export const effectiveness = (attack: Element | null, target: Element): number => (attack === null ? 1 : BEATS[attack] === target ? STRONG : BEATS[target] === attack ? WEAK : 1);

export type SpriteId = 'cindle' | 'kilnip' | 'nimbray' | 'dewbell' | 'petalwing' | 'tufflet';
export const SPRITE_IDS: readonly SpriteId[] = ['cindle', 'kilnip', 'nimbray', 'dewbell', 'petalwing', 'tufflet'];

export interface Move {
  readonly name: string;
  readonly element: Element | null;
  readonly power: number;
  readonly cost: number;
  readonly priority?: number;
  readonly scorch?: number;
  readonly drain?: number;
  readonly recoil?: number;
  readonly shield?: boolean;
  readonly heal?: number;
  readonly dazzle?: boolean;
  readonly text: string;
}

export interface Sprite {
  readonly id: SpriteId;
  readonly name: string;
  readonly element: Element;
  readonly hp: number;
  readonly attack: number;
  readonly guard: number;
  readonly speed: number;
  readonly moves: readonly [Move, Move, Move];
  readonly blurb: string;
}

export const SPRITES: Record<SpriteId, Sprite> = {
  cindle: {
    id: 'cindle', name: 'Cindle', element: 'ember', hp: 80, attack: 28, guard: 10, speed: 30, blurb: 'A lantern that learned to hop. Quick, bright, and all in.',
    moves: [
      { name: 'Flicker', element: null, power: 18, cost: 0, text: 'A quick knock' },
      { name: 'Ember Kiss', element: 'ember', power: 28, cost: 1, scorch: 0.35, text: 'May leave a scorch' },
      { name: 'Flare Up', element: 'ember', power: 42, cost: 2, recoil: 0.25, text: 'Huge, and it singes Cindle too' },
    ],
  },
  kilnip: {
    id: 'kilnip', name: 'Kilnip', element: 'ember', hp: 98, attack: 21, guard: 15, speed: 14, blurb: 'Plates of warm stone. Slow to start, hard to shift.',
    moves: [
      { name: 'Tumble', element: null, power: 18, cost: 0, text: 'A rolling knock' },
      { name: 'Cinder Roll', element: 'ember', power: 26, cost: 1, scorch: 0.35, text: 'May leave a scorch' },
      { name: 'Kiln Shell', element: 'ember', power: 14, cost: 2, shield: true, text: 'Curls up: halves damage for a while' },
    ],
  },
  nimbray: {
    id: 'nimbray', name: 'Nimbray', element: 'tide', hp: 82, attack: 25, guard: 11, speed: 28, blurb: 'A ray pup from the cloud sea. Always gets there first.',
    moves: [
      { name: 'Fin Slap', element: null, power: 18, cost: 0, text: 'A quick knock' },
      { name: 'Spray', element: 'tide', power: 29, cost: 1, text: 'A hard jet of water' },
      { name: 'Tidal Dash', element: 'tide', power: 35, cost: 2, priority: 1, text: 'Strikes before anything else' },
    ],
  },
  dewbell: {
    id: 'dewbell', name: 'Dewbell', element: 'tide', hp: 94, attack: 22, guard: 14, speed: 18, blurb: 'A bell of waterfall mist. It mends what it can.',
    moves: [
      { name: 'Bell Bump', element: null, power: 17, cost: 0, text: 'A soft knock' },
      { name: 'Dew Drop', element: 'tide', power: 28, cost: 1, text: 'A heavy drop of water' },
      { name: 'Soothing Rain', element: 'tide', power: 0, cost: 2, heal: 0.45, text: 'Restores health, clears what ails it' },
    ],
  },
  petalwing: {
    id: 'petalwing', name: 'Petalwing', element: 'bloom', hp: 74, attack: 25, guard: 10, speed: 32, blurb: 'A moth with blossom for wings. Fast, and full of dust.',
    moves: [
      { name: 'Wing Tap', element: null, power: 18, cost: 0, text: 'A quick knock' },
      { name: 'Petal Gust', element: 'bloom', power: 27, cost: 1, drain: 0.25, text: 'Takes a little health back' },
      { name: 'Pollen Veil', element: 'bloom', power: 18, cost: 2, dazzle: true, text: 'Dazzles: the foe hits softer' },
    ],
  },
  tufflet: {
    id: 'tufflet', name: 'Tufflet', element: 'bloom', hp: 106, attack: 22, guard: 18, speed: 10, blurb: 'A boulder that grew moss and a mind. Slow, and certain.',
    moves: [
      { name: 'Headbutt', element: null, power: 19, cost: 0, text: 'A heavy knock' },
      { name: 'Moss Toss', element: 'bloom', power: 26, cost: 1, drain: 0.25, text: 'Takes a little health back' },
      { name: 'Root Slam', element: 'bloom', power: 45, cost: 2, priority: -1, text: 'Enormous, but strikes last' },
    ],
  },
};

export const MAX_SPARK = 3;
const SHIELD_ROUNDS = 2, SCORCH_ROUNDS = 3, DAZZLE_ROUNDS = 3, SCORCH_DAMAGE = 7, DAZZLED = 0.7, SHIELDED = 0.5;
export const critChance = (speed: number): number => 0.03 + Math.max(0, speed - 5) / 400;

export type Status = 'shield' | 'scorch' | 'dazzle';

export interface Fighter {
  readonly sprite: Sprite;
  hp: number;
  spark: number;
  readonly status: Record<Status, number>;
}

export type Side = 'you' | 'foe';
export const opposite = (side: Side): Side => (side === 'you' ? 'foe' : 'you');

export type Action = { readonly kind: 'move'; readonly index: 0 | 1 | 2 } | { readonly kind: 'switch'; readonly to: number };

export type BattleEvent =
  | { readonly type: 'switch'; readonly side: Side; readonly from: number; readonly to: number }
  | { readonly type: 'move'; readonly side: Side; readonly move: Move }
  | { readonly type: 'damage'; readonly side: Side; readonly amount: number; readonly hp: number; readonly effect: 'strong' | 'weak' | 'plain'; readonly crit: boolean; readonly element: Element | null }
  | { readonly type: 'heal'; readonly side: Side; readonly amount: number; readonly hp: number }
  | { readonly type: 'recoil'; readonly side: Side; readonly amount: number; readonly hp: number }
  | { readonly type: 'status'; readonly side: Side; readonly status: Status; readonly on: boolean }
  | { readonly type: 'scorch'; readonly side: Side; readonly amount: number; readonly hp: number }
  | { readonly type: 'faint'; readonly side: Side; readonly index: number }
  | { readonly type: 'spark'; readonly side: Side; readonly spark: number };

const fighter = (id: SpriteId): Fighter => ({ sprite: SPRITES[id], hp: SPRITES[id].hp, spark: 1, status: { shield: 0, scorch: 0, dazzle: 0 } });

export const expectedDamage = (user: Fighter, move: Move, target: Fighter): number => {
  if (move.power <= 0) return 0;
  const raw = move.power * (0.6 + user.sprite.attack / 60) * (30 / (30 + target.sprite.guard)) * effectiveness(move.element, target.sprite.element);
  return Math.max(1, raw * (user.status.dazzle > 0 ? DAZZLED : 1) * (target.status.shield > 0 ? SHIELDED : 1));
};

export class Battle {
  readonly teams: Record<Side, Fighter[]>;
  readonly active: Record<Side, number> = { you: 0, foe: 0 };
  winner: Side | null = null;
  rounds = 0;

  constructor(you: readonly SpriteId[], foe: readonly SpriteId[], private readonly rng: Rng) {
    this.teams = { you: you.map(fighter), foe: foe.map(fighter) };
  }

  out(side: Side): Fighter {
    return this.teams[side][this.active[side]]!;
  }

  bench(side: Side): number[] {
    return this.teams[side].map((f, i) => (f.hp > 0 && i !== this.active[side] ? i : -1)).filter((i) => i >= 0);
  }

  needsReplacement(side: Side): boolean {
    return this.winner === null && this.out(side).hp <= 0;
  }

  legal(side: Side, action: Action): boolean {
    if (this.winner || this.needsReplacement('you') || this.needsReplacement('foe')) return false;
    if (action.kind === 'switch') return this.bench(side).includes(action.to);
    return this.out(side).spark >= this.out(side).sprite.moves[action.index].cost;
  }

  options(side: Side): Action[] {
    const all: Action[] = [{ kind: 'move', index: 0 }, { kind: 'move', index: 1 }, { kind: 'move', index: 2 }, ...this.teams[side].map((_, to): Action => ({ kind: 'switch', to }))];
    return all.filter((a) => this.legal(side, a));
  }

  replace(side: Side, to: number): BattleEvent[] {
    if (!this.needsReplacement(side) || !this.bench(side).includes(to)) throw new Error(`${side} cannot send in sprite ${to} now`);
    const from = this.active[side];
    this.active[side] = to;
    return [{ type: 'switch', side, from, to }];
  }

  round(you: Action, foe: Action): BattleEvent[] {
    if (!this.legal('you', you) || !this.legal('foe', foe)) throw new Error('an action that cannot be taken now');
    const events: BattleEvent[] = [];
    const chosen: Record<Side, Action> = { you, foe };
    this.rounds++;

    for (const side of ['you', 'foe'] as const) {
      const action = chosen[side];
      if (action.kind !== 'switch') continue;
      events.push({ type: 'switch', side, from: this.active[side], to: action.to });
      this.active[side] = action.to;
    }

    const movers = (['you', 'foe'] as const).filter((side) => chosen[side].kind === 'move');
    const key = (side: Side): number => {
      const action = chosen[side] as { index: 0 | 1 | 2 };
      return (this.out(side).sprite.moves[action.index].priority ?? 0) * 1000 + this.out(side).sprite.speed;
    };
    movers.sort((a, b) => key(b) - key(a) || (this.rng.chance(0.5) ? 1 : -1));
    for (const side of movers) {
      const user = this.out(side);
      if (user.hp <= 0 || this.winner) continue;
      this.play(side, user.sprite.moves[(chosen[side] as { index: 0 | 1 | 2 }).index], events);
    }

    for (const side of ['you', 'foe'] as const) {
      const f = this.out(side);
      if (f.hp <= 0) continue;
      if (f.status.scorch > 0) {
        f.hp = Math.max(0, f.hp - SCORCH_DAMAGE);
        events.push({ type: 'scorch', side, amount: SCORCH_DAMAGE, hp: f.hp });
        if (f.hp <= 0) this.fell(side, events);
      }
      for (const status of ['shield', 'scorch', 'dazzle'] as const) {
        if (f.status[status] > 0 && --f.status[status] === 0 && f.hp > 0) events.push({ type: 'status', side, status, on: false });
      }
      if (f.hp > 0 && f.spark < MAX_SPARK) events.push({ type: 'spark', side, spark: ++f.spark });
    }
    return events;
  }

  private play(side: Side, move: Move, events: BattleEvent[]): void {
    const user = this.out(side), targetSide = opposite(side), target = this.out(targetSide);
    user.spark -= move.cost;
    events.push({ type: 'move', side, move });
    if (move.heal) {
      const amount = Math.min(user.sprite.hp - user.hp, Math.round(user.sprite.hp * move.heal));
      user.hp += amount;
      events.push({ type: 'heal', side, amount, hp: user.hp });
      for (const status of ['scorch', 'dazzle'] as const) {
        if (user.status[status] > 0) {
          user.status[status] = 0;
          events.push({ type: 'status', side, status, on: false });
        }
      }
    }
    if (move.shield) {
      user.status.shield = SHIELD_ROUNDS + 1;
      events.push({ type: 'status', side, status: 'shield', on: true });
    }
    if (move.power <= 0) return;

    const crit = this.rng.chance(critChance(user.sprite.speed)), factor = effectiveness(move.element, target.sprite.element);
    const amount = Math.min(target.hp, Math.max(1, Math.round(expectedDamage(user, move, target) * (crit ? 1.5 : 1) * this.rng.range(0.93, 1.07))));
    target.hp -= amount;
    events.push({ type: 'damage', side: targetSide, amount, hp: target.hp, effect: factor > 1 ? 'strong' : factor < 1 ? 'weak' : 'plain', crit, element: move.element });
    if (move.drain && amount > 0 && user.hp < user.sprite.hp) {
      const back = Math.min(user.sprite.hp - user.hp, Math.max(1, Math.round(amount * move.drain)));
      user.hp += back;
      events.push({ type: 'heal', side, amount: back, hp: user.hp });
    }
    if (move.recoil) {
      const hurt = Math.min(user.hp - 1, Math.max(1, Math.round(amount * move.recoil)));
      if (hurt > 0) {
        user.hp -= hurt;
        events.push({ type: 'recoil', side, amount: hurt, hp: user.hp });
      }
    }
    if (target.hp <= 0) {
      this.fell(targetSide, events);
      return;
    }
    if (move.scorch && target.status.scorch === 0 && this.rng.chance(move.scorch)) {
      target.status.scorch = SCORCH_ROUNDS;
      events.push({ type: 'status', side: targetSide, status: 'scorch', on: true });
    }
    if (move.dazzle && target.status.dazzle === 0) {
      target.status.dazzle = DAZZLE_ROUNDS;
      events.push({ type: 'status', side: targetSide, status: 'dazzle', on: true });
    }
  }

  private fell(side: Side, events: BattleEvent[]): void {
    events.push({ type: 'faint', side, index: this.active[side] });
    if (this.teams[side].every((f) => f.hp <= 0)) this.winner = opposite(side);
  }
}

const matchup = (mine: Sprite, theirs: Sprite): number => effectiveness(mine.element, theirs.element) - effectiveness(theirs.element, mine.element);

export const chooseAction = (battle: Battle, side: Side, rng: Rng, skill: number): Action => {
  const options = battle.options(side);
  if (options.length === 0) throw new Error('nothing to choose from');
  if (!rng.chance(0.25 + 0.75 * skill)) return rng.pick(options);
  const me = battle.out(side), foe = battle.out(opposite(side));
  let best = options[0]!, bestScore = -Infinity;
  for (const action of options) {
    let score: number;
    if (action.kind === 'switch') {
      const next = battle.teams[side][action.to]!;
      score = matchup(me.sprite, foe.sprite) < 0 && matchup(next.sprite, foe.sprite) > 0 && next.hp > next.sprite.hp * 0.4 ? 20 + 26 * skill : -10;
    } else {
      const move = me.sprite.moves[action.index];
      const damage = expectedDamage(me, move, foe);
      score = damage;
      if (damage >= foe.hp) score += 40;
      if (move.heal) score += me.hp < me.sprite.hp * 0.5 ? 34 : -20;
      if (move.shield) score += me.status.shield === 0 && me.hp > me.sprite.hp * 0.3 ? 12 : -12;
      if (move.dazzle) score += foe.status.dazzle === 0 ? 10 : -6;
      if (move.recoil && me.hp < me.sprite.hp * 0.3) score -= 14;
      if (move.priority === 1 && foe.hp <= damage) score += 20;
    }
    score += rng.range(0, 6 * (1.2 - skill));
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }
  return best;
};

export const chooseReplacement = (battle: Battle, side: Side, rng: Rng): number => {
  const foe = battle.out(opposite(side)), bench = battle.bench(side);
  let best = bench[0]!, bestScore = -Infinity;
  for (const i of bench) {
    const f = battle.teams[side][i]!;
    const score = matchup(f.sprite, foe.sprite) * 10 + (f.hp / f.sprite.hp) * 4 + rng.range(0, 1);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
};

export const PAIRS: Record<Element, readonly [SpriteId, SpriteId]> = { ember: ['cindle', 'kilnip'], tide: ['nimbray', 'dewbell'], bloom: ['petalwing', 'tufflet'] };

export const restOf = (picked: readonly SpriteId[]): SpriteId[] => SPRITE_IDS.filter((id) => !picked.includes(id));

export const healthOf = (f: Fighter): number => clamp(f.hp / f.sprite.hp, 0, 1);
