import { describe, expect, it } from 'vitest';
import { Colliders, Walkway } from '../../src/world/colliders';

describe('Walkway', () => {
  const make = (reach = 1) => {
    const c = new Colliders();
    c.bounds = { kind: 'circle', cx: 0, cz: 0, r: 5 };
    const w = new Walkway([{ x: 0, y: 0, z: -4.5 }, { x: 0, y: 2, z: -20 }], 1.3);
    w.reach = reach;
    c.walkways.push(w);
    return { c, w };
  };
  it('lets the player walk out past the bounds along the walkway, rising with it', () => {
    const { c } = make();
    const p = c.resolve({ x: 0.2, z: -12 }, 0.28);
    expect(p).toEqual({ x: 0.2, z: -12 });
    expect(c.groundAt(0.2, -12, 0.28)).toBeCloseTo(((12 - 4.5) / 15.5) * 2, 2);
  });
  it('keeps the player on the deck instead of off its side', () => {
    const { c } = make();
    const p = c.resolve({ x: 3, z: -12 }, 0.28);
    expect(p.x).toBeCloseTo(1.02, 2);
    expect(p.z).toBeCloseTo(-12, 2);
  });
  it('stops at the end of what has been built', () => {
    const { c, w } = make(0.5);
    const p = c.resolve({ x: 0, z: -18 }, 0.28);
    expect(p.z).toBeGreaterThan(-4.5 - w.length * 0.5 - 0.3);
  });
  it('with nothing built, the bounds hold as before', () => {
    const { c } = make(0);
    const p = c.resolve({ x: 0, z: -8 }, 0.28);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(4.72, 2);
    expect(c.groundAt(0, -8, 0.28)).toBeNull();
  });
});
