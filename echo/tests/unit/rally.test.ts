import { describe, expect, it } from 'vitest';
import { BALL_RADIUS, GRAVITY, STEP, TABLE, cloneBall, predictArrival, sideOf, solveServe, solveShot, stepBall, v, type Ball, type Contact, type Side } from '../../src/arcade/rally/physics';

const REST = TABLE.height + BALL_RADIUS;

/** Flies a ball until it has met `count` things, and says what and where. */
const fly = (ball: Ball, count: number, seconds = 4): { contact: Contact; x: number; z: number; ball: Ball }[] => {
  const met: { contact: Contact; x: number; z: number; ball: Ball }[] = [];
  for (let t = 0; t < seconds && met.length < count; t += STEP) {
    const contact = stepBall(ball, STEP);
    if (contact) met.push({ contact, x: ball.p.x, z: ball.p.z, ball: cloneBall(ball) });
  }
  return met;
};

describe('the ball', () => {
  it('bounces off the table to a little less than it fell from', () => {
    const ball: Ball = { p: v(0.2, REST + 0.4, 0.6), v: v(), w: v() };
    fly(ball, 1);
    let top = 0;
    for (let t = 0; t < 1; t += STEP) {
      if (stepBall(ball, STEP)) break;
      top = Math.max(top, ball.p.y - REST);
    }
    expect(top).toBeGreaterThan(0.26);
    expect(top).toBeLessThan(0.36);
  });

  it('falls past the table when it comes down beyond the edge', () => {
    const ball: Ball = { p: v(TABLE.width / 2 + 0.1, REST + 0.3, 0.5), v: v(), w: v() };
    expect(fly(ball, 1)[0]!.contact).toBe('floor');
  });

  it('drops on its own side when driven into the net', () => {
    const ball: Ball = { p: v(0, TABLE.height + 0.12, 0.6), v: v(0, 0.2, -6), w: v() };
    const met = fly(ball, 2);
    expect(met[0]!.contact).toBe('net');
    expect(met[1]!.z).toBeGreaterThan(0);
  });

  it('keeps its pace off the table with topspin and loses it with backspin', () => {
    const through = (spinX: number): number => {
      const ball: Ball = { p: v(0, REST + 0.25, 0.2), v: v(0, 0, -5), w: v(spinX, 0, 0) };
      return -fly(ball, 1)[0]!.ball.v.z;
    };
    // moving toward -Z, topspin turns about -X
    expect(through(-120)).toBeGreaterThan(through(0) + 0.3);
    expect(through(120)).toBeLessThan(through(0) - 0.3);
  });
});

describe('solveShot', () => {
  const from = v(0.3, TABLE.height + 0.22, 1.5);

  it('lands the ball where it was aimed, over the net, at any pace and spin', () => {
    for (const x of [-0.6, 0, 0.55]) for (const z of [-0.4, -0.85, -1.2]) for (const speed of [3.5, 6, 9]) for (const spin of [v(), v(-90, 0, 0), v(70, 0, 0), v(0, 60, 0)]) {
      const shot = solveShot(from, x, z, speed, spin);
      expect(shot, `x ${x} z ${z} speed ${speed}`).not.toBeNull();
      const met = fly({ p: { ...from }, v: { ...shot!.v }, w: { ...shot!.w } }, 1);
      expect(met[0]!.contact).toBe('table');
      expect(Math.hypot(met[0]!.x - x, met[0]!.z - z)).toBeLessThan(0.06);
    }
  });

  it('lifts a shot that would have gone into the net', () => {
    // from low and close, a fast flat ball cannot clear the tape: the answer is a slower, higher one
    const low = v(0, TABLE.height + 0.06, 0.9);
    const shot = solveShot(low, 0, -0.5, 9)!;
    expect(shot).not.toBeNull();
    expect(Math.hypot(shot.v.x, shot.v.z)).toBeLessThan(8);
    expect(fly({ p: { ...low }, v: { ...shot.v }, w: { ...shot.w } }, 1)[0]!.contact).toBe('table');
  });

  it('works from Kai\'s end as well', () => {
    const shot = solveShot(v(-0.2, TABLE.height + 0.25, -1.5), 0.4, 0.9, 6, v(80, 0, 0))!;
    const met = fly({ p: v(-0.2, TABLE.height + 0.25, -1.5), v: { ...shot.v }, w: { ...shot.w } }, 1);
    expect(Math.hypot(met[0]!.x - 0.4, met[0]!.z - 0.9)).toBeLessThan(0.06);
  });
});

describe('solveServe', () => {
  it('bounces once on the server\'s half and then on the receiver\'s', () => {
    for (const server of ['you', 'kai'] as Side[]) for (const x of [-0.5, 0, 0.5]) for (const fromX of [-0.4, 0.4]) {
      const from = v(fromX, TABLE.height + 0.22, server === 'you' ? 1.5 : -1.5);
      const shot = solveServe(server, from, x);
      expect(shot, `${server} to ${x} from ${fromX}`).not.toBeNull();
      const met = fly({ p: { ...from }, v: { ...shot!.v }, w: { ...shot!.w } }, 2);
      expect(met.map((m) => m.contact)).toEqual(['table', 'table']);
      expect(sideOf(met[0]!.z)).toBe(server);
      expect(sideOf(met[1]!.z)).not.toBe(server);
    }
  });
});

describe('predictArrival', () => {
  it('says where a shot can be met after its bounce', () => {
    const from = v(0.2, TABLE.height + 0.2, 1.5);
    const shot = solveShot(from, -0.3, -0.8, 6)!;
    const arrival = predictArrival({ p: { ...from }, v: { ...shot.v }, w: { ...shot.w } }, 'kai', -(TABLE.length / 2 + 0.12))!;
    expect(arrival).not.toBeNull();
    expect(arrival.time).toBeGreaterThan(shot.time);
    expect(arrival.ball.p.z).toBeLessThan(-0.8);
    expect(arrival.ball.p.y).toBeGreaterThan(TABLE.height);
  });

  it('is null for a ball that is going into the net or out', () => {
    expect(predictArrival({ p: v(0, TABLE.height + 0.06, 1.0), v: v(0, 0.1, -7), w: v() }, 'kai', -1.5)).toBeNull();
    expect(predictArrival({ p: v(0, TABLE.height + 0.3, 1.0), v: v(0, 3, -9), w: v() }, 'kai', -1.5)).toBeNull();
  });

  it('gravity is what the solver assumes', () => {
    // a ball thrown straight up comes back in 2v/g, less a little for drag
    const ball: Ball = { p: v(3, 1, 3), v: v(0, 3, 0), w: v() };
    let t = 0;
    while (ball.p.y >= 1 && t < 2) {
      stepBall(ball, STEP);
      t += STEP;
    }
    expect(t).toBeGreaterThan((2 * 3) / GRAVITY - 0.06);
    expect(t).toBeLessThan((2 * 3) / GRAVITY + 0.02);
  });
});
