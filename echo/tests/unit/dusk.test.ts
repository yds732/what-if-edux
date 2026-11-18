import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/math';
import { GAP, LANE, MARCH, MAW_STAND, MAX_FLOCK, RANGE, STAGES, March, flockRadius, labelOf, leadFor, through, toneOf, worthOf, type Foe, type FoeKind, type GateOp, type MarchEvent, type Stage } from '../../src/arcade/dusk/march';

const DT = 1 / 30;

/** Runs a march for `seconds`, keeping what happened. `each` is called before every step: it is the leader. */
const run = (m: March, seconds: number, each?: (m: March) => void): MarchEvent[] => {
  const seen: MarchEvent[] = [];
  for (let t = 0; t < seconds && !m.over; t += DT) {
    each?.(m);
    m.step(DT);
    seen.push(...m.events.splice(0));
  }
  return seen;
};

/** A bridge with nothing on it: for looking at one rule at a time. */
const EMPTY: Stage = { ...STAGES[0]!, beats: [], length: 1e6 };
const bare = (count = 10): March => {
  const m = new March(new Rng(3), EMPTY);
  m.count = count;
  return m;
};
const put = (m: March, kind: FoeKind, x: number, ahead: number, hp: number, pace = 0): Foe => {
  const foe: Foe = { id: 9000 + m.foes.length, kind, x, ahead, hp, maxHp: hp, radius: kind === 'ling' ? 0.42 : kind === 'brute' ? 0.9 : 2.3, pace, phase: 0 };
  m.foes.push(foe);
  return foe;
};
const gate = (m: March, ahead: number, left: GateOp, right: GateOp): void => void m.gates.push({ id: 8000 + m.gates.length, ahead, left, right, taken: null });

describe('a gate', () => {
  it('adds, takes away, multiplies and divides, and never puts out the last sprite', () => {
    expect(through(7, { kind: 'add', n: 5 })).toBe(12);
    expect(through(7, { kind: 'sub', n: 5 })).toBe(2);
    expect(through(7, { kind: 'mul', n: 3 })).toBe(21);
    expect(through(7, { kind: 'div', n: 2 })).toBe(4);
    expect(through(3, { kind: 'sub', n: 9 })).toBe(1);
    expect(through(60, { kind: 'mul', n: 3 })).toBe(MAX_FLOCK);
    expect(through(7, { kind: 'quick' })).toBe(7);
  });

  it('is labelled with what it does, and coloured by whether that is good', () => {
    expect([{ kind: 'add', n: 5 }, { kind: 'sub', n: 3 }, { kind: 'mul', n: 2 }, { kind: 'div', n: 2 }].map((op) => labelOf(op as GateOp))).toEqual(['+5', '−3', '×2', '÷2']);
    expect(toneOf({ kind: 'mul', n: 2 })).toBe('good');
    expect(toneOf({ kind: 'div', n: 2 })).toBe('bad');
    expect(toneOf({ kind: 'quick' })).toBe('quick');
  });

  it('is worth more or less by how many the flock already is', () => {
    const plus: GateOp = { kind: 'add', n: 8 }, twice: GateOp = { kind: 'mul', n: 2 };
    expect(worthOf(5, 0, plus)).toBeGreaterThan(worthOf(5, 0, twice));
    expect(worthOf(20, 0, twice)).toBeGreaterThan(worthOf(20, 0, plus));
    // quicker sparks are worth a quarter more sprites, until they can be quickened no further
    expect(worthOf(20, 0, { kind: 'quick' })).toBe(25);
    expect(worthOf(20, 3, { kind: 'quick' })).toBe(20);
  });

  it('is gone through on the side the flock is on, and not at all by a flock led between the two', () => {
    for (const [lead, want] of [[-2, 20], [2, 5], [0, 10], [GAP - 0.05, 10]] as const) {
      const m = bare(10);
      gate(m, 8, { kind: 'mul', n: 2 }, { kind: 'div', n: 2 });
      const seen = run(m, 3, () => (m.lead = lead));
      expect(m.count).toBe(want);
      expect(seen.filter((e) => e.type === 'gate')).toHaveLength(Math.abs(lead) > GAP ? 1 : 0);
    }
  });

  it('of quickening makes every sprite throw faster', () => {
    const m = bare(10), before = m.sparkRate;
    gate(m, 4, { kind: 'quick' }, { kind: 'quick' });
    run(m, 2, () => (m.lead = 1.5));
    expect(m.count).toBe(10);
    expect(m.sparkRate).toBeCloseTo(before * 1.25, 5);
  });
});

describe('the flock', () => {
  it('goes where it is led, as fast as its feet allow, and no further than the bridge is wide', () => {
    const m = bare(4);
    m.lead = 10;
    run(m, 0.1);
    expect(m.x).toBeGreaterThan(0.5);
    expect(m.x).toBeLessThan(1.2);
    run(m, 2);
    expect(m.x).toBeLessThanOrEqual(LANE);
    expect(m.x).toBeGreaterThan(LANE - 1);
  });

  it('stands wider the more it is', () => {
    expect(flockRadius(4)).toBeLessThan(flockRadius(40));
    expect(flockRadius(99)).toBeLessThanOrEqual(1.7);
  });

  it('throws sparks up the bridge that relight what they meet', () => {
    const m = bare(10);
    const ling = put(m, 'ling', 0, 8, 3);
    const seen = run(m, 3);
    expect(seen.some((e) => e.type === 'lit' && e.foe === ling)).toBe(true);
    expect(m.foes).toHaveLength(0);
    expect(m.tally.lit).toBe(1);
  });

  it('cannot light what is not in front of it, or beyond its reach', () => {
    const m = bare(4);
    const aside = put(m, 'ling', 2.6, 6, 3, -MARCH), far = put(m, 'ling', 0, RANGE + 4, 3, -MARCH);
    run(m, 2, () => (m.lead = -2));
    expect(aside.hp).toBe(3);
    expect(far.hp).toBe(3);
  });
});

describe('what comes down the bridge', () => {
  it('puts a sprite out if it gets among the flock, and goes by harmlessly if it is dodged', () => {
    const met = bare(1);
    met.count = 6;
    put(met, 'ling', 0, 1.2, 99);
    const seen = run(met, 1);
    expect(seen.filter((e) => e.type === 'dimmed')).toHaveLength(1);
    expect(met.count).toBe(5);

    const dodged = bare(6);
    dodged.x = dodged.lead = -2.4;
    put(dodged, 'brute', 2, 1.2, 999);
    run(dodged, 2, () => (dodged.lead = -2.4));
    expect(dodged.count).toBe(6);
    expect(dodged.foes).toHaveLength(0);
  });

  it('is a march lost when the last sprite goes out', () => {
    const m = bare(3);
    put(m, 'brute', 0, 1, 999);
    const seen = run(m, 1);
    expect(m.over).toBe('dark');
    expect(seen.at(-1)).toEqual({ type: 'end', how: 'dark' });
    expect(m.stars).toBe(0);
  });
});

describe('the Gloom', () => {
  const stage: Stage = { ...STAGES[0]!, beats: [], length: 30 };

  it('waits at the end of the bridge, just inside the sparks\' reach, and comes on from there', () => {
    const m = new March(new Rng(5), stage);
    m.count = 1;
    const seen = run(m, 30 / MARCH + 0.2, () => (m.lead = -LANE));
    expect(seen.some((e) => e.type === 'maw')).toBe(true);
    expect(m.maw!.ahead).toBeGreaterThan(MAW_STAND - 0.6);
    expect(m.maw!.ahead).toBeLessThanOrEqual(MAW_STAND);
    const at = m.maw!.ahead;
    run(m, 2, () => (m.lead = -LANE));
    expect(m.maw!.ahead).toBeLessThan(at - 0.5);
  });

  it('takes only so much light at once, however many throw it', () => {
    const m = new March(new Rng(5), stage);
    m.count = MAX_FLOCK;
    run(m, 30 / MARCH + 0.1);
    const hp = m.maw!.hp;
    run(m, 3);
    expect(hp - m.maw!.hp).toBeGreaterThan(stage.maw.hp * 0.25);
    expect(hp - m.maw!.hp).toBeLessThan(stage.maw.hp * 0.4);
  });

  it('is the dawn when it is relit, and the dark if it reaches the flock', () => {
    const won = new March(new Rng(5), stage);
    won.count = 60;
    run(won, 60);
    expect(won.over).toBe('dawn');
    expect(won.stars).toBe(3);

    const lost = new March(new Rng(5), { ...stage, maw: { ...stage.maw, hp: 1e6 } });
    lost.count = 60;
    run(lost, 120);
    expect(lost.over).toBe('dark');
  });
});

describe('a march', () => {
  /**
   * Leaders of three kinds, to see that each march is fair. `wise` is how often the better half of a gate is taken;
   * `late` how long the leader takes to notice that things have changed (the lead is only looked at that often).
   */
  interface Leader { wise: number; late: number; idle?: boolean }
  const LEADERS = { keen: { wise: 0.95, late: 0.12 }, casual: { wise: 0.72, late: 0.35 }, careless: { wise: 0.5, late: 0.7 }, idle: { wise: 0.5, late: 1, idle: true } } satisfies Record<string, Leader>;

  const march = (seed: number, stage: Stage, leader: Leader): March => {
    const m = new March(new Rng(seed), stage), mind = new Rng(seed * 17 + 3);
    const choice = new Map<number, boolean>();
    let wait = 0;
    for (let t = 0; t < 400 && !m.over; t += DT) {
      if ((wait -= DT) <= 0) {
        wait = leader.late;
        // each gate is made up the leader's mind about once, when it is first seen
        const gate = m.gates.find((g) => !g.taken);
        if (gate && !choice.has(gate.id)) choice.set(gate.id, mind.chance(leader.wise));
        m.lead = leader.idle ? 0 : leadFor(m, gate ? choice.get(gate.id)! : true) + mind.range(-0.3, 0.3);
      }
      m.step(DT);
      m.events.length = 0;
    }
    return m;
  };

  const RUNS = 30;
  const tally = (stage: Stage, leader: Leader) => {
    const out = { dawn: 0, dark: 0, stars: 0, flock: 0, most: 0, dimmed: 0, seconds: 0 };
    for (let seed = 1; seed <= RUNS; seed++) {
      const m = march(seed, stage, leader);
      out[m.over ?? 'dark']++;
      out.stars += m.stars / RUNS;
      out.flock += m.count / RUNS;
      out.most += m.tally.most / RUNS;
      out.dimmed += m.tally.dimmed / RUNS;
      out.seconds += m.time / RUNS;
    }
    return out;
  };

  it('is fair on every stage: keen leaders break the dusk, casual ones mostly do, and stars tell them apart', () => {
    const table = STAGES.map((stage) => ({ stage: stage.name, keen: tally(stage, LEADERS.keen), casual: tally(stage, LEADERS.casual), careless: tally(stage, LEADERS.careless), idle: tally(stage, LEADERS.idle) }));
    const fmt = (r: ReturnType<typeof tally>): string => `${String(r.dawn).padStart(2)}/${RUNS} dawn  ${r.stars.toFixed(2)} stars  flock ${r.flock.toFixed(0)} (most ${r.most.toFixed(0)}, ${r.dimmed.toFixed(0)} put out)  ${r.seconds.toFixed(0)} s`;
    console.log(table.map((row) => `${row.stage}\n  keen     ${fmt(row.keen)}\n  casual   ${fmt(row.casual)}\n  careless ${fmt(row.careless)}\n  idle     ${fmt(row.idle)}`).join('\n'));
    const [first, long, deep] = table as [typeof table[0], typeof table[0], typeof table[0]];
    // the first march is a welcome: anyone who leads at all breaks the dusk
    expect(first.keen.dawn).toBe(RUNS);
    expect(first.casual.dawn).toBeGreaterThanOrEqual(RUNS - 3);
    expect(first.careless.dawn).toBeGreaterThanOrEqual(RUNS * 0.66);
    // the last asks for the right gates, and those who take them still get there
    expect(deep.keen.dawn).toBeGreaterThanOrEqual(RUNS * 0.7);
    expect(deep.casual.dawn).toBeGreaterThanOrEqual(RUNS * 0.4);
    expect(deep.careless.dawn).toBeLessThanOrEqual(RUNS * 0.45);
    expect(long.careless.dawn).toBeLessThanOrEqual(first.careless.dawn);
    for (const row of table) {
      // the stars tell leaders apart, and a flock that is not led at all is never enough
      expect(row.keen.stars).toBeGreaterThan(row.casual.stars);
      expect(row.casual.stars).toBeGreaterThan(row.careless.stars + 0.3);
      expect(row.keen.stars).toBeGreaterThan(2.2);
      expect(row.idle.dawn).toBe(0);
      // and nobody waits long at the end of the bridge
      expect(row.keen.seconds).toBeLessThan(STAGES.find((s) => s.name === row.stage)!.length / MARCH + 26);
    }
    // (three hundred and sixty marches: give them time)
  }, 60000);

  it('cannot be won by standing still', () => {
    for (const stage of STAGES) for (let seed = 1; seed <= 6; seed++) {
      const m = new March(new Rng(seed), stage);
      run(m, 400);
      expect(m.over).toBe('dark');
    }
  });

  it('keeps everything on the bridge', () => {
    const m = new March(new Rng(11), STAGES[2]);
    let most = 0;
    run(m, 80, () => {
      m.lead = leadFor(m, true);
      most = Math.max(most, m.foes.length);
      for (const f of m.foes) expect(Math.abs(f.x)).toBeLessThanOrEqual(LANE);
      for (const s of m.sparks) if (s.live) expect(s.ahead).toBeLessThanOrEqual(RANGE + 1);
    });
    expect(most).toBeGreaterThan(40);
    expect(most).toBeLessThan(300);
  });
});
