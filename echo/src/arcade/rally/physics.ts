export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const v = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
const copy = (a: V3): V3 => ({ x: a.x, y: a.y, z: a.z });

export const TABLE = { length: 2.74, width: 1.525, height: 0.76, net: 0.1525 } as const;
export const BALL_RADIUS = 0.03;
export const GRAVITY = 7.6;
const DRAG = 0.14, MAGNUS = 0.0042;
const RESTITUTION = 0.9, GRIP = 0.22;
const EDGE = 0.012;

export type Side = 'you' | 'kai';
export const sideOf = (z: number): Side => (z > 0 ? 'you' : 'kai');
export const forward = (side: Side): number => (side === 'you' ? -1 : 1);

export interface Ball {
  p: V3;
  v: V3;
  w: V3;
}

export const cloneBall = (b: Ball): Ball => ({ p: copy(b.p), v: copy(b.v), w: copy(b.w) });

export type Contact = 'table' | 'net' | 'cord' | 'floor';

const overTable = (p: V3): boolean => Math.abs(p.x) <= TABLE.width / 2 + EDGE && Math.abs(p.z) <= TABLE.length / 2 + EDGE;

export const stepBall = (b: Ball, dt: number, floor = 0): Contact | null => {
  const { p, v: vel, w } = b;
  const z0 = p.z, y0 = p.y, x0 = p.x;
  const ax = -DRAG * vel.x + MAGNUS * (w.y * vel.z - w.z * vel.y);
  const ay = -GRAVITY - DRAG * vel.y + MAGNUS * (w.z * vel.x - w.x * vel.z);
  const az = -DRAG * vel.z + MAGNUS * (w.x * vel.y - w.y * vel.x);
  vel.x += ax * dt;
  vel.y += ay * dt;
  vel.z += az * dt;
  p.x += vel.x * dt;
  p.y += vel.y * dt;
  p.z += vel.z * dt;

  if ((z0 > 0) !== (p.z > 0) && z0 !== 0) {
    const k = z0 / (z0 - p.z), y = y0 + (p.y - y0) * k, x = x0 + (p.x - x0) * k;
    const top = TABLE.height + TABLE.net;
    if (Math.abs(x) <= TABLE.width / 2 && y > TABLE.height - 0.02) {
      if (y < top - BALL_RADIUS * 0.45) {
        p.z = Math.sign(z0) * 0.012;
        vel.z *= -0.16;
        vel.x *= 0.45;
        vel.y = Math.min(vel.y * 0.25, 0.15);
        b.w = v();
        return 'net';
      }
      if (y < top + BALL_RADIUS * 0.75) {
        vel.z *= 0.42;
        vel.x *= 0.7;
        vel.y = Math.abs(vel.y) * 0.25 + 0.95;
        b.w.x *= 0.2;
        b.w.z *= 0.2;
        return 'cord';
      }
    }
  }

  const rest = TABLE.height + BALL_RADIUS;
  if (p.y < rest && vel.y < 0 && y0 >= rest - 0.03 && overTable(p)) {
    p.y = rest;
    const down = -vel.y;
    vel.y = down * RESTITUTION;
    const dx = -(vel.x + w.z * BALL_RADIUS) * GRIP, dz = -(vel.z - w.x * BALL_RADIUS) * GRIP;
    vel.x += dx;
    vel.z += dz;
    w.x -= (1.5 / BALL_RADIUS) * dz;
    w.z += (1.5 / BALL_RADIUS) * dx;
    return 'table';
  }

  if (p.y < floor + BALL_RADIUS && vel.y < 0) {
    p.y = floor + BALL_RADIUS;
    vel.y *= -0.55;
    vel.x *= 0.7;
    vel.z *= 0.7;
    b.w = v();
    return 'floor';
  }
  return null;
};

export const STEP = 1 / 240;

const landing = (start: Ball, maxSeconds = 3): { at: V3; time: number; netY: number | null; contact: Contact | null } => {
  const b = cloneBall(start);
  let netY: number | null = null;
  for (let t = 0; t < maxSeconds; t += STEP) {
    const z0 = b.p.z, y0 = b.p.y;
    const hit = stepBall(b, STEP, -100);
    if ((z0 > 0) !== (b.p.z > 0)) netY = y0 + (b.p.y - y0) * (z0 / (z0 - b.p.z));
    if (hit === 'net' || hit === 'cord') return { at: b.p, time: t, netY, contact: hit };
    if (hit === 'table' || (b.p.y <= TABLE.height + BALL_RADIUS && b.v.y < 0)) return { at: b.p, time: t, netY, contact: hit };
  }
  return { at: b.p, time: maxSeconds, netY, contact: null };
};

export interface Shot {
  readonly v: V3;
  readonly w: V3;
  readonly time: number;
}

export const solveShot = (from: V3, x: number, z: number, speed: number, spin: V3 = v(), clearance = 0.03): Shot | null => {
  const dx = x - from.x, dz = z - from.z, ground = Math.hypot(dx, dz);
  if (ground < 0.2) return null;
  const rest = TABLE.height + BALL_RADIUS, needed = TABLE.height + TABLE.net + BALL_RADIUS + clearance;
  for (let pace = speed, tries = 0; tries < 14; tries++, pace *= 0.9) {
    const T = ground / pace;
    const vel = v(dx / T, (rest - from.y + 0.5 * GRAVITY * T * T) / T, dz / T);
    let found: ReturnType<typeof landing> | null = null;
    for (let i = 0; i < 6; i++) {
      found = landing({ p: copy(from), v: copy(vel), w: copy(spin) });
      const ex = x - found.at.x, ez = z - found.at.z;
      if (found.contact === 'net' || found.contact === 'cord') break;
      if (Math.hypot(ex, ez) < 0.008) break;
      vel.x += ex / Math.max(found.time, 0.05);
      vel.z += ez / Math.max(found.time, 0.05);
    }
    if (!found || found.contact === 'net' || found.contact === 'cord') continue;
    if (found.netY !== null && found.netY < needed) continue;
    if (Math.hypot(x - found.at.x, z - found.at.z) > 0.05) continue;
    return { v: vel, w: copy(spin), time: found.time };
  }
  return null;
};

export const solveServe = (server: Side, from: V3, x: number, pace = 1): Shot | null => {
  const dir = forward(server);
  const targetZ = dir * (TABLE.length / 2) * 0.55;
  for (const speed of [3.6, 3.9, 3.3, 4.2, 3.0, 4.5].map((s) => s * pace)) {
    for (const depth of [0.72, 0.62, 0.84, 0.5]) {
      const firstZ = -dir * (TABLE.length / 2) * depth, firstX = from.x + ((x - from.x) * (firstZ - from.z)) / (targetZ - from.z);
      const dx = firstX - from.x, dz = firstZ - from.z, ground = Math.hypot(dx, dz), T = ground / speed;
      if (ground < 0.15) continue;
      const rest = TABLE.height + BALL_RADIUS;
      const shot: Shot = { v: v(dx / T, (rest - from.y + 0.5 * GRAVITY * T * T) / T, dz / T), w: v(), time: T };
      const b: Ball = { p: copy(from), v: copy(shot.v), w: v() };
      let bounces = 0, good = false;
      for (let t = 0; t < 3; t += STEP) {
        const hit = stepBall(b, STEP, -100);
        if (hit === 'net' || hit === 'cord' || hit === 'floor') break;
        if (hit === 'table') {
          bounces++;
          if (bounces === 1 && sideOf(b.p.z) !== server) break;
          if (bounces === 2) {
            good = sideOf(b.p.z) !== server && Math.abs(b.p.z) > 0.35 && Math.abs(b.p.z) < TABLE.length / 2 - 0.18 && Math.abs(b.p.x) < TABLE.width / 2 - 0.12;
            break;
          }
        }
        if (b.p.y < TABLE.height - 0.2) break;
      }
      if (good) return shot;
    }
  }
  return null;
};

export interface Arrival {
  readonly ball: Ball;
  readonly time: number;
}

export const predictArrival = (start: Ball, side: Side, plane: number, serve = false, low = 0.14, maxSeconds = 2.5): Arrival | null => {
  const b = cloneBall(start);
  let bounced = false, own = serve;
  for (let t = 0; t < maxSeconds; t += STEP) {
    const z0 = b.p.z;
    const hit = stepBall(b, STEP, -100);
    if (hit === 'net') return null;
    if (hit === 'table') {
      if (sideOf(b.p.z) !== side) {
        if (!own) return null;
        own = false;
        continue;
      }
      if (bounced) return null;
      bounced = true;
      continue;
    }
    if (b.p.y < TABLE.height - 0.3) return null;
    if (!bounced) continue;
    const crossed = side === 'you' ? z0 < plane && b.p.z >= plane : z0 > plane && b.p.z <= plane;
    if (crossed || (b.v.y < 0 && b.p.y < TABLE.height + BALL_RADIUS + low)) return { ball: b, time: t };
  }
  return null;
};

export const heightAt = (start: Ball, plane: number, maxSeconds = 1.6): number | null => {
  const b = cloneBall(start);
  for (let t = 0; t < maxSeconds; t += STEP * 2) {
    const z0 = b.p.z;
    const hit = stepBall(b, STEP * 2, -100);
    if (hit === 'net') return null;
    if ((z0 < plane) !== (b.p.z < plane)) return b.p.y;
  }
  return null;
};
