import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/math';
import { CASTAWAY_TRIES, HOOK_BACK, HOOK_OUT, MAX_LIGHT, PLANS, SEA, Voyage, WOOD_PER_TILE, nextDeed, reachOf, type Deed, type Item, type ItemKind, type Plan, type VoyageEvent } from '../../src/arcade/drift/voyage';

const DT = 1 / 30;
const LENGTH = PLANS[0]!.length;

const run = (v: Voyage, seconds: number, each?: (v: Voyage) => void): VoyageEvent[] => {
  const seen: VoyageEvent[] = [];
  for (let t = 0; t < seconds && !v.over; t += DT) {
    v.step(DT);
    each?.(v);
    seen.push(...v.events.splice(0));
  }
  return seen;
};

const drop = (v: Voyage, kind: ItemKind, x: number, z: number, who?: Item['who']): Item => {
  const item: Item = { id: 9000 + v.items.length, kind, x, z, who, phase: 0, hooked: false };
  v.items.push(item);
  return item;
};

const quiet = (seed = 1, plan = PLANS[0]): Voyage => {
  const v = new Voyage(new Rng(seed), plan);
  v.items.length = 0;
  (v as unknown as { spawnIn: number }).spawnIn = 1e9;
  v.wyrm.nextIn = 1e9;
  (v as unknown as { waiting: unknown[] }).waiting.length = 0;
  return v;
};

describe('the raft', () => {
  it('starts as one tile with the lantern lit, and can grow to each side of it', () => {
    const v = quiet();
    expect([...v.tiles]).toEqual(['0,0']);
    expect(v.light).toBeGreaterThan(50);
    expect(v.slots().map((s) => `${s.cx},${s.cz}`).sort()).toEqual(['-1,0', '0,-1', '0,1', '1,0']);
    for (const key of ['1,0', '2,0']) v.tiles.add(key);
    expect(v.slots().some((s) => s.cx === 3)).toBe(false);
  });

  it('takes a tile only beside one that is there, and only for the wood', () => {
    const v = quiet();
    v.wood = WOOD_PER_TILE - 1;
    expect(v.build(1, 0)).toBe(false);
    v.wood = WOOD_PER_TILE * 2;
    expect(v.build(1, 1)).toBe(false);
    expect(v.build(1, 0)).toBe(true);
    expect(v.build(1, 1)).toBe(true);
    expect(v.wood).toBe(0);
    expect(v.tiles.size).toBe(3);
    expect(v.build(-2, 0)).toBe(false);
  });
});

describe('the hook', () => {
  it('goes out to where it was thrown and brings back what was there', () => {
    const v = quiet();
    const wood = v.wood, plank = drop(v, 'wood', 3, -2);
    expect(v.cast(3, -2 + 1.5 * HOOK_OUT)).toBe(true);
    expect(v.cast(0, 3)).toBe(false);
    const seen = run(v, HOOK_OUT + HOOK_BACK + 0.2);
    expect(seen.some((e) => e.type === 'gather' && e.item === plank && e.by === 'hook')).toBe(true);
    expect(v.wood).toBe(wood + 1);
    expect(v.items).toHaveLength(0);
    expect(v.hook.state).toBe('ready');
  });

  it('comes back empty from open water', () => {
    const v = quiet();
    drop(v, 'wood', 3, -2);
    v.cast(-4, 2);
    const seen = run(v, 1);
    expect(seen.some((e) => e.type === 'gather')).toBe(false);
  });

  it('reaches no further than its line, which is longer while the lantern is bright', () => {
    const v = quiet();
    v.light = MAX_LIGHT;
    v.cast(0, -40);
    expect(Math.hypot(v.hook.tx, v.hook.tz)).toBeCloseTo(reachOf(MAX_LIGHT), 5);
    expect(reachOf(10)).toBeLessThan(reachOf(90));
  });
});

describe('the tide', () => {
  it('brings things down past the raft, and what bumps into it is fished out', () => {
    const v = quiet();
    const hit = drop(v, 'buoy', 0.2, -3), miss = drop(v, 'wood', 5, -3);
    v.light = 40;
    const seen = run(v, 6);
    expect(seen.some((e) => e.type === 'gather' && e.item === hit && e.by === 'raft')).toBe(true);
    expect(v.items).toContain(miss);
    expect(miss.z).toBeGreaterThan(3);
    run(v, 12);
    expect(v.items).not.toContain(miss);
  });

  it('puts the lantern out in the end if nothing is fed to it', () => {
    const v = quiet();
    const seen = run(v, LENGTH);
    expect(v.over).toBe('dark');
    expect(v.time).toBeLessThan(LENGTH * 0.75);
    expect(seen.filter((e) => e.type === 'low')).toHaveLength(1);
    expect(seen.at(-1)).toEqual({ type: 'end', how: 'dark' });
  });

  it('is rougher in the squall across the middle of the later voyages', () => {
    const v = quiet(1, PLANS[1]);
    v.light = 1e6;
    const seen = run(v, PLANS[1]!.length + 1);
    expect(seen.filter((e) => e.type === 'storm').map((e) => e.type === 'storm' && e.on)).toEqual([true, false]);
    expect(v.over).toBe('arrived');
  });
});

describe('the crew', () => {
  it('comes aboard when a castaway is hooked, and each does its part', () => {
    const v = quiet();
    drop(v, 'castaway', 2, 0, 'cindle');
    v.cast(2, 0.3);
    const seen = run(v, 1);
    expect(seen.some((e) => e.type === 'rescued' && e.who === 'cindle')).toBe(true);
    expect(v.crew).toEqual(['cindle']);

    const plain = quiet(), kept = quiet();
    kept.crew.push('cindle');
    run(plain, 20);
    run(kept, 20);
    expect(kept.light).toBeGreaterThan(plain.light + 3);

    const fetch = quiet();
    fetch.crew.push('nimbray');
    drop(fetch, 'wood', 4, -4);
    expect(run(fetch, 4).some((e) => e.type === 'gather' && e.by === 'crew')).toBe(true);
  });

  it('is offered again if it drifts by unhooked', () => {
    const v = new Voyage(new Rng(4));
    v.wyrm.nextIn = 1e9;
    v.light = 1e6;
    let offered = 0;
    const known = new Set<number>();
    run(v, 70, () => {
      for (const i of v.items) if (i.who === 'cindle' && !known.has(i.id)) {
        known.add(i.id);
        offered++;
      }
    });
    expect(offered).toBe(CASTAWAY_TRIES);
  });
});

describe('the wyrm', () => {
  const roused = (tiles: [number, number][] = []): Voyage => {
    const v = quiet();
    v.light = 1e6;
    for (const [cx, cz] of tiles) v.tiles.add(`${cx},${cz}`);
    v.wyrm.nextIn = 0;
    return v;
  };

  it('circles, lunges and takes an outer plank if nothing is done', () => {
    const v = roused([[1, 0], [-1, 0]]);
    const seen = run(v, 8);
    const kinds = seen.filter((e) => e.type === 'wyrm').map((e) => e.type === 'wyrm' && e.what);
    expect(kinds).toEqual(['rise', 'lunge', 'bite']);
    expect(v.tiles.size).toBe(2);
    expect(v.has(0, 0)).toBe(true);
    expect(v.over).toBeNull();
  });

  it('is seen off by the hook, and takes nothing', () => {
    const v = roused([[1, 0], [-1, 0]]);
    const seen = run(v, 8, () => {
      if (v.wyrm.state === 'circling' && v.hook.state === 'ready') v.cast(v.wyrm.x, v.wyrm.z);
    });
    const kinds = seen.filter((e) => e.type === 'wyrm').map((e) => e.type === 'wyrm' && e.what);
    expect(kinds).toEqual(['rise', 'hit', 'driven']);
    expect(v.tiles.size).toBe(3);
    expect(v.wyrm.state).toBe('away');
  });

  it('needs one knock fewer with Tufflet aboard', () => {
    const v = roused([[1, 0]]);
    v.crew.push('tufflet');
    const seen = run(v, 8, () => {
      if (v.wyrm.state === 'circling' && v.hook.state === 'ready') v.cast(v.wyrm.x, v.wyrm.z);
    });
    expect(seen.filter((e) => e.type === 'wyrm').map((e) => e.type === 'wyrm' && e.what)).toEqual(['rise', 'driven']);
  });

  it('sinks a raft of one tile only after three bites', () => {
    const v = roused();
    v.wyrm.nextIn = 0;
    const seen = run(v, 200, () => {
      if (v.wyrm.state === 'away') v.wyrm.nextIn = Math.min(v.wyrm.nextIn, 0.5);
    });
    expect(seen.filter((e) => e.type === 'wyrm' && e.what === 'bite')).toHaveLength(3);
    expect(v.over).toBe('sunk');
  });

  it('leaves the raft alone on the last stretch', () => {
    const v = roused([[1, 0]]);
    v.wyrm.nextIn = 1e9;
    run(v, LENGTH * 0.91);
    v.wyrm.nextIn = 0;
    const seen = run(v, LENGTH);
    expect(seen.some((e) => e.type === 'wyrm')).toBe(false);
    expect(v.over).toBe('arrived');
  });
});

describe('a voyage', () => {
  it('earns a star for arriving, one for a fine raft, one for all three sprites', () => {
    const v = quiet();
    v.light = 1e6;
    run(v, LENGTH + 1);
    expect(v.stars).toBe(1);
    const full = quiet();
    full.light = 1e6;
    for (let i = 1; i < full.plan.raft; i++) full.tiles.add(`${(i % 5) - 2},${i < 5 ? 1 : i < 10 ? -1 : 2}`);
    expect(full.tiles.size).toBe(full.plan.raft);
    full.crew.push('cindle', 'nimbray', 'tufflet');
    run(full, LENGTH + 1);
    expect(full.stars).toBe(3);
    const lost = quiet();
    run(lost, LENGTH);
    expect(lost.stars).toBe(0);
  });

  interface Sailor { every: number; picky: number; slop: number }
  const SAILORS = {
    keen: { every: 0.85, picky: 0.95, slop: 0.25 },
    casual: { every: 1.4, picky: 0.7, slop: 0.5 },
    dreamy: { every: 2.6, picky: 0.4, slop: 0.8 },
  } satisfies Record<string, Sailor>;

  const idly = (v: Voyage, hand: Rng): Deed | null => {
    const slot = v.slots()[0];
    if (v.wood >= WOOD_PER_TILE && slot) return { kind: 'build', ...slot };
    if (v.hook.state !== 'ready') return null;
    const near = v.items.filter((i) => !i.hooked && Math.hypot(i.x, i.z) < v.reach);
    const any = near[hand.int(0, Math.max(0, near.length - 1))];
    return any ? { kind: 'cast', x: any.x, z: any.z } : null;
  };

  const sail = (seed: number, plan: Plan, sailor: Sailor): Voyage => {
    const v = new Voyage(new Rng(seed), plan), hand = new Rng(seed * 31 + 7);
    let wait = sailor.every;
    for (let t = 0; t < plan.length + 5 && !v.over; t += DT) {
      v.step(DT);
      v.events.length = 0;
      if ((wait -= DT) > 0) continue;
      const deed = hand.chance(sailor.picky) ? nextDeed(v) : idly(v, hand);
      if (!deed) continue;
      wait = sailor.every * hand.range(0.7, 1.3);
      if (deed.kind === 'build') v.build(deed.cx, deed.cz);
      else v.cast(deed.x + hand.range(-1, 1) * sailor.slop, deed.z + hand.range(-1, 1) * sailor.slop);
    }
    return v;
  };

  const RUNS = 60;
  const tally = (plan: Plan, sailor: Sailor) => {
    const out = { arrived: 0, dark: 0, sunk: 0, stars: 0, tiles: 0, crew: 0, light: 0, bitten: 0 };
    for (let seed = 1; seed <= RUNS; seed++) {
      const v = sail(seed, plan, sailor);
      out[v.over ?? 'dark']++;
      out.stars += v.stars / RUNS;
      out.tiles += v.tiles.size / RUNS;
      out.crew += v.crew.length / RUNS;
      out.light += v.light / RUNS;
      out.bitten += v.tally.bitten / RUNS;
    }
    return out;
  };

  it('is fair on every voyage: keen sailors arrive, casual ones mostly do, and dreamers are carried home more gently', () => {
    const table = PLANS.map((plan) => ({ plan: plan.name, keen: tally(plan, SAILORS.keen), casual: tally(plan, SAILORS.casual), dreamy: tally(plan, SAILORS.dreamy) }));
    const fmt = (r: ReturnType<typeof tally>): string => `${String(r.arrived).padStart(2)}/${RUNS} home (${r.dark} dark, ${r.sunk} sunk)  ${r.stars.toFixed(2)} stars  ${r.tiles.toFixed(1)} tiles  ${r.crew.toFixed(1)} crew  ${r.bitten.toFixed(1)} bites  light ${r.light.toFixed(0)}`;
    console.log(table.map((row) => `${row.plan}\n  keen   ${fmt(row.keen)}\n  casual ${fmt(row.casual)}\n  dreamy ${fmt(row.dreamy)}`).join('\n'));
    const [still, evening, squall] = table as [typeof table[0], typeof table[0], typeof table[0]];
    expect(still.keen.arrived).toBe(RUNS);
    expect(still.casual.arrived).toBeGreaterThanOrEqual(57);
    expect(still.dreamy.arrived).toBeGreaterThanOrEqual(50);
    expect(squall.keen.arrived).toBeGreaterThanOrEqual(56);
    expect(squall.casual.arrived).toBeGreaterThanOrEqual(50);
    expect(squall.dreamy.arrived).toBeLessThanOrEqual(46);
    expect(squall.dreamy.arrived).toBeGreaterThanOrEqual(20);
    expect(evening.dreamy.arrived).toBeLessThanOrEqual(still.dreamy.arrived);
    expect(squall.dreamy.arrived).toBeLessThan(evening.dreamy.arrived);
    expect(squall.casual.stars).toBeLessThan(still.casual.stars);
    for (const row of table) {
      expect(row.keen.stars).toBeGreaterThanOrEqual(row.casual.stars);
      expect(row.casual.stars).toBeGreaterThan(row.dreamy.stars + 0.5);
    }
    expect(squall.keen.stars).toBeGreaterThan(2.6);
    expect(squall.casual.stars).toBeLessThan(2.5);
    expect(still.dreamy.stars).toBeGreaterThan(1.3);
  }, 60000);

  it('cannot be won by doing nothing', () => {
    for (const plan of PLANS) for (let seed = 1; seed <= 12; seed++) {
      const v = new Voyage(new Rng(seed), plan);
      run(v, plan.length + 5);
      expect(v.over === 'dark' || v.over === 'sunk').toBe(true);
    }
  });

  it('keeps everything that floats where it can be seen and reached for', () => {
    const v = new Voyage(new Rng(9), PLANS[2]);
    v.light = 1e6;
    let most = 0;
    run(v, 60, () => {
      most = Math.max(most, v.items.length);
      for (const i of v.items) {
        expect(Math.abs(i.x)).toBeLessThan(SEA.half + 1);
        expect(i.z).toBeLessThanOrEqual(SEA.near + 0.1);
      }
    });
    expect(most).toBeGreaterThan(5);
    expect(most).toBeLessThan(26);
  });
});
