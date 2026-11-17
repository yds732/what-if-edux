/**
 * Flight of a thrown orb: pure functions over plain numbers, so the rules can be tested without a renderer.
 * Haven's gravity is gentle on purpose; arcs are slow enough to read and to enjoy.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface RingTarget {
  readonly center: Vec3;
  /** Unit normal of the ring's plane, pointing back toward the thrower. */
  readonly normal: Vec3;
  readonly radius: number;
}

export const HAVEN_GRAVITY = 6.4;
export const ORB_RADIUS = 0.17;
export const MIN_SPEED = 9;
export const MAX_SPEED = 21;
/** Seconds of holding for a full-power throw. */
export const CHARGE_TIME = 0.95;

export const speedForCharge = (charge: number): number => MIN_SPEED + (MAX_SPEED - MIN_SPEED) * Math.min(1, Math.max(0, charge));

export type Crossing =
  | { readonly kind: 'through'; readonly offset: number }
  | { readonly kind: 'rim'; readonly offset: number }
  | null;

/**
 * Did the segment from `a` to `b` pass through the ring's plane, front to back? `through` is a score, `rim`
 * means it clipped the hoop itself. Segments are swept, so a fast orb can never skip the ring between frames.
 */
export const crossRing = (a: Vec3, b: Vec3, ring: RingTarget, orbRadius = ORB_RADIUS): Crossing => {
  const n = ring.normal, c = ring.center;
  const da = (a.x - c.x) * n.x + (a.y - c.y) * n.y + (a.z - c.z) * n.z;
  const db = (b.x - c.x) * n.x + (b.y - c.y) * n.y + (b.z - c.z) * n.z;
  if (!(da > 0 && db <= 0)) return null;
  const t = da / (da - db);
  const qx = a.x + (b.x - a.x) * t - c.x, qy = a.y + (b.y - a.y) * t - c.y, qz = a.z + (b.z - a.z) * t - c.z;
  const offset = Math.hypot(qx, qy, qz);
  if (offset <= ring.radius - orbRadius * 0.4) return { kind: 'through', offset };
  if (offset <= ring.radius + orbRadius * 1.6) return { kind: 'rim', offset };
  return null;
};

/** Position after `t` seconds of free flight. */
export const flightPoint = (from: Vec3, velocity: Vec3, t: number, gravity = HAVEN_GRAVITY): Vec3 => ({
  x: from.x + velocity.x * t,
  y: from.y + velocity.y * t - 0.5 * gravity * t * t,
  z: from.z + velocity.z * t,
});

/**
 * Launch velocity of magnitude `speed` that carries an orb from `from` through `to` on the lower of the two
 * possible arcs, or null when the target is out of range at that speed.
 */
export const solveLaunch = (from: Vec3, to: Vec3, speed: number, gravity = HAVEN_GRAVITY): Vec3 | null => {
  const dx = to.x - from.x, dz = to.z - from.z, h = to.y - from.y;
  const d = Math.hypot(dx, dz);
  if (d < 1e-4) return null;
  const s2 = speed * speed;
  const disc = s2 * s2 - gravity * (gravity * d * d + 2 * h * s2);
  if (disc < 0) return null;
  const tan = (s2 - Math.sqrt(disc)) / (gravity * d);
  const cos = 1 / Math.sqrt(1 + tan * tan), sin = tan * cos;
  return { x: (dx / d) * speed * cos, y: speed * sin, z: (dz / d) * speed * cos };
};

/**
 * Bends an aimed throw toward the ideal one. `assist` 0 leaves the throw alone, 1 replaces it; nothing happens
 * if the aim is more than `coneDeg` away, so a throw in the wrong direction is still a miss.
 */
export const assistLaunch = (aimed: Vec3, ideal: Vec3 | null, assist: number, coneDeg = 14): Vec3 => {
  if (!ideal || assist <= 0) return aimed;
  const la = Math.hypot(aimed.x, aimed.y, aimed.z), li = Math.hypot(ideal.x, ideal.y, ideal.z);
  if (la < 1e-6 || li < 1e-6) return aimed;
  const cos = (aimed.x * ideal.x + aimed.y * ideal.y + aimed.z * ideal.z) / (la * li);
  const angle = Math.acos(Math.min(1, Math.max(-1, cos))) * (180 / Math.PI);
  if (angle > coneDeg) return aimed;
  // strongest when nearly on target, fading to nothing at the edge of the cone
  const k = assist * (1 - (angle / coneDeg) ** 2);
  const x = aimed.x + (ideal.x - aimed.x) * k, y = aimed.y + (ideal.y - aimed.y) * k, z = aimed.z + (ideal.z - aimed.z) * k;
  const l = Math.hypot(x, y, z);
  return { x: (x / l) * la, y: (y / l) * la, z: (z / l) * la };
};

/** Help grows with each miss and resets on a hit: the challenge finds the player's level by itself. */
export const assistForMisses = (misses: number): number => Math.min(0.85, 0.18 + misses * 0.17);
