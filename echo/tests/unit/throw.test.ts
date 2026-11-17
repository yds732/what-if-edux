import { describe, expect, it } from 'vitest';
import {
  HAVEN_GRAVITY, MAX_SPEED, MIN_SPEED, assistForMisses, assistLaunch, crossRing, flightPoint, solveLaunch, speedForCharge, type RingTarget, type Vec3,
} from '../../src/game/throw';

const ring: RingTarget = { center: { x: 0, y: 3, z: -12 }, normal: { x: 0, y: 0, z: 1 }, radius: 1.25 };

/** Flies an orb in small steps and reports the first thing it does to the ring. */
const fly = (from: Vec3, v: Vec3, target: RingTarget, dt = 1 / 120): 'through' | 'rim' | 'miss' => {
  let p = { ...from };
  const vel = { ...v };
  for (let t = 0; t < 6; t += dt) {
    const prev = p;
    vel.y -= HAVEN_GRAVITY * dt;
    p = { x: p.x + vel.x * dt, y: p.y + vel.y * dt, z: p.z + vel.z * dt };
    const c = crossRing(prev, p, target);
    if (c) return c.kind;
  }
  return 'miss';
};

describe('speedForCharge', () => {
  it('runs from the minimum to the maximum and clamps outside 0..1', () => {
    expect(speedForCharge(0)).toBe(MIN_SPEED);
    expect(speedForCharge(1)).toBe(MAX_SPEED);
    expect(speedForCharge(-3)).toBe(MIN_SPEED);
    expect(speedForCharge(9)).toBe(MAX_SPEED);
    expect(speedForCharge(0.5)).toBeCloseTo((MIN_SPEED + MAX_SPEED) / 2);
  });
});

describe('crossRing', () => {
  it('scores a pass through the middle, front to back', () => {
    expect(crossRing({ x: 0, y: 3, z: -11 }, { x: 0, y: 3, z: -13 }, ring)).toMatchObject({ kind: 'through', offset: 0 });
  });
  it('ignores a pass from behind', () => {
    expect(crossRing({ x: 0, y: 3, z: -13 }, { x: 0, y: 3, z: -11 }, ring)).toBeNull();
  });
  it('ignores a segment that never reaches the plane', () => {
    expect(crossRing({ x: 0, y: 3, z: -5 }, { x: 0, y: 3, z: -6 }, ring)).toBeNull();
  });
  it('calls a clip of the hoop a rim, and a wide pass nothing', () => {
    expect(crossRing({ x: 1.3, y: 3, z: -11 }, { x: 1.3, y: 3, z: -13 }, ring)?.kind).toBe('rim');
    expect(crossRing({ x: 2.4, y: 3, z: -11 }, { x: 2.4, y: 3, z: -13 }, ring)).toBeNull();
  });
  it('catches a fast orb that crosses the whole ring in one step', () => {
    expect(crossRing({ x: 0, y: 3, z: 0 }, { x: 0.2, y: 3.1, z: -40 }, ring)?.kind).toBe('through');
  });
});

describe('solveLaunch', () => {
  const from: Vec3 = { x: 0.2, y: 1.2, z: -3.4 };
  it('finds a throw of the asked speed that goes through the ring', () => {
    for (const speed of [13, 17, MAX_SPEED]) {
      const v = solveLaunch(from, ring.center, speed);
      expect(v).not.toBeNull();
      expect(Math.hypot(v!.x, v!.y, v!.z)).toBeCloseTo(speed, 5);
      expect(fly(from, v!, ring)).toBe('through');
    }
  });
  it('reports a target that is out of range', () => {
    expect(solveLaunch(from, { x: 0, y: 3, z: -400 }, MIN_SPEED)).toBeNull();
  });
  it('agrees with flightPoint', () => {
    const v = solveLaunch(from, ring.center, 18)!;
    const horizontal = Math.hypot(v.x, v.z);
    const t = Math.hypot(ring.center.x - from.x, ring.center.z - from.z) / horizontal;
    const p = flightPoint(from, v, t);
    expect(p.x).toBeCloseTo(ring.center.x, 4);
    expect(p.y).toBeCloseTo(ring.center.y, 4);
    expect(p.z).toBeCloseTo(ring.center.z, 4);
  });
});

describe('assistLaunch', () => {
  const ideal: Vec3 = { x: 0, y: 6, z: -15 };
  const speed = Math.hypot(ideal.x, ideal.y, ideal.z);
  const off = (deg: number): Vec3 => {
    const a = (deg * Math.PI) / 180;
    return { x: Math.sin(a) * 15, y: 6, z: -Math.cos(a) * 15 };
  };
  const angleTo = (v: Vec3): number => (Math.acos((v.x * ideal.x + v.y * ideal.y + v.z * ideal.z) / (Math.hypot(v.x, v.y, v.z) * speed)) * 180) / Math.PI;

  it('leaves a throw alone when there is no help or no solution', () => {
    const aimed = off(5);
    expect(assistLaunch(aimed, ideal, 0)).toBe(aimed);
    expect(assistLaunch(aimed, null, 0.8)).toBe(aimed);
  });
  it('pulls a near miss toward the ring without changing its speed', () => {
    const aimed = off(5);
    const helped = assistLaunch(aimed, ideal, 0.6);
    expect(angleTo(helped)).toBeLessThan(angleTo(aimed));
    expect(Math.hypot(helped.x, helped.y, helped.z)).toBeCloseTo(Math.hypot(aimed.x, aimed.y, aimed.z), 5);
  });
  it('does nothing for a throw aimed somewhere else entirely', () => {
    const aimed = off(40);
    expect(assistLaunch(aimed, ideal, 0.85)).toBe(aimed);
  });
});

describe('assistForMisses', () => {
  it('grows with every miss and stops short of throwing for the player', () => {
    const levels = [0, 1, 2, 3, 4, 10].map(assistForMisses);
    for (let i = 1; i < levels.length; i++) expect(levels[i]!).toBeGreaterThanOrEqual(levels[i - 1]!);
    expect(levels[0]).toBeGreaterThan(0);
    expect(levels[levels.length - 1]).toBeLessThan(1);
  });
});
