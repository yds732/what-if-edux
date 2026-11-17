import * as THREE from 'three';
import { blob, curve1, fill, merge, orient, place, sweep, tint, torus, v3 } from '../core/geo';
import { DEG, Rng, TAU, clamp01, smoothstep } from '../core/math';

/**
 * Hair is sculpted the way a figurine's is. A shell follows the skull, opens around the face along a cut
 * fringe, ends in a shaped lower edge and carries shallow grooves that read as strands. Over it, a style grows
 * a few solid locks: each starts on the scalp, heads off in a direction, is pulled down by gravity and slides
 * around the head instead of passing through it.
 */

export type HairStyleName = 'messy' | 'softBob' | 'longWavy' | 'curls' | 'bun' | 'ponytail' | 'crop' | 'buns' | 'hijab';

export interface HairLook {
  style: HairStyleName;
  color: THREE.ColorRepresentation;
  /** Colour the tips drift toward; defaults to a lighter shade of the base. */
  tipColor?: THREE.ColorRepresentation;
  seed?: number;
}

interface Shell {
  /** Radius at the crown, in head radii. */
  grow: number;
  /** Extra radius toward the lower edge: the bell of a bob. */
  flare?: number;
  /** Hairline height across the forehead, as a function of unit x (-1 right .. 1 left). */
  fringe: (x: number) => number;
  /** Half-width of the face opening in unit x. */
  faceWidth?: number;
  /** Lower edge as a function of azimuth in degrees (0 front, 180 back). */
  bottom: (azimuth: number) => number;
  /** Depth of the strand grooves. */
  ridges?: number;
  ridgeCount?: number;
  /** Stretches everything below the ears downward, for hair longer than the skull. */
  stretch?: number;
}

interface Lock {
  /** Direction from the head's centre to the root (need not be unit length). */
  root: THREE.Vector3;
  /** Initial growth direction. */
  flow: THREE.Vector3;
  length: number;
  width: number;
  thickness?: number;
  droop?: number;
  /** Distance kept from the scalp, metres. */
  lift?: number;
  /** Sideways wave: amplitude in metres and number of waves. */
  wave?: number;
  waves?: number;
  /** Pull toward the neck over the last part of the lock, for ends that curl under. */
  tuck?: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const widthProfile = curve1([[0, 0.6], [0.2, 1], [0.62, 0.9], [0.88, 0.5], [1, 0.08]]);

/** Zig-zag between 0 and 1 with `n` teeth over x in [-1, 1]: cut fringes and tufted edges. */
const teeth = (x: number, n: number, phase = 0): number => Math.abs((((x * n * 0.5 + phase) % 1) + 1) % 1 - 0.5) * 2;

const shellGeometry = (R: number, s: Shell, detail: number): THREE.BufferGeometry =>
  blob(R, R * 1.03, R * 0.985, Math.round(8 + 14 * detail), (p) => {
    const az = Math.atan2(p.x, p.z) / DEG;
    const fw = s.faceWidth ?? 0.74;
    const inFace = smoothstep(-0.02, 0.12, p.z) * smoothstep(fw + 0.04, fw - 0.04, Math.abs(p.x)) * smoothstep(0.035, -0.035, p.y - s.fringe(p.x));
    const edge = s.bottom(az);
    const h = (1 - inFace) * smoothstep(edge - 0.035, edge + 0.035, p.y);
    const low = smoothstep(0.25, -0.7, p.y);
    const groove = (s.ridges ?? 0.012) * Math.sin((az * DEG) * (s.ridgeCount ?? 17) + p.y * 2.2) * (1 - smoothstep(0.72, 0.98, p.y));
    const tucked = THREE.MathUtils.lerp(0.86, 0.5, smoothstep(-0.25, -0.75, p.y)); // well inside the narrowing jaw
    const r = THREE.MathUtils.lerp(tucked, s.grow + (s.flare ?? 0) * low + groove, h);
    p.multiplyScalar(r);
    if (s.stretch && p.y < 0) p.y *= s.stretch;
  });

const growLock = (R: number, lock: Lock, rng: Rng): THREE.BufferGeometry => {
  const N = 12;
  const lift = lock.lift ?? 0.012, droop = lock.droop ?? 1;
  const th = lock.thickness ?? lock.width * 0.34;
  const rootDir = lock.root.clone().normalize();
  const pos = rootDir.clone().multiplyScalar(R * 1.0);
  const dir = lock.flow.clone().addScaledVector(rootDir, -lock.flow.dot(rootDir)).normalize();
  const ds = lock.length / N;
  const pts: THREE.Vector3[] = [pos.clone()];
  const side = new THREE.Vector3();
  const phase = rng.range(0, TAU);
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    dir.addScaledVector(UP, -droop * ds * 5.5);
    if (lock.tuck && t > 0.55) dir.addScaledVector(v3(-pos.x, 0, -pos.z).normalize(), lock.tuck * ds * 9);
    dir.normalize();
    pos.addScaledVector(dir, ds);
    // stay outside the skull, standing off more in the middle of the lock than at its root
    const minR = R * 1.02 + lift * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5) + th * 0.5;
    const r = pos.length();
    if (r < minR && pos.y > -R * 0.7) {
      pos.multiplyScalar(minR / r);
      const n = pos.clone().normalize();
      dir.addScaledVector(n, -Math.min(0, dir.dot(n))).normalize();
    }
    const p = pos.clone();
    if (lock.wave) {
      side.crossVectors(dir, rootDir).normalize();
      p.addScaledVector(side, lock.wave * Math.sin(t * TAU * (lock.waves ?? 1.5) + phase) * smoothstep(0.1, 0.5, t));
    }
    pts.push(p);
  }
  const w = lock.width;
  return sweep(pts, (t) => ({ rx: (w / 2) * widthProfile(t), ry: (th / 2) * (0.55 + 0.45 * widthProfile(t)) }), { radial: 8, steps: 20, up: rootDir, startCap: 'round', endCap: 'point' });
};

/** Azimuth 0 is the face (+Z), 90 the character's left (+X); elevation 90 is the crown. */
const dirOf = (azimuthDeg: number, elevationDeg: number): THREE.Vector3 => {
  const a = azimuthDeg * DEG, e = elevationDeg * DEG;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
};

/** Paints root-to-tip colour using a sweep's uv.x. */
const shadeLock = (g: THREE.BufferGeometry, base: THREE.Color, tip: THREE.Color, vary: number): THREE.BufferGeometry => {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const n = g.getAttribute('position').count;
  const data = new Float32Array(n * 3), glow = new Float32Array(n);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const t = uv.getX(i);
    const k = clamp01((t - 0.62) / 0.38) ** 1.3;
    c.copy(base).multiplyScalar(0.86 + 0.14 * smoothstep(0, 0.35, t) + vary).lerp(tip, k);
    data[i * 3] = c.r;
    data[i * 3 + 1] = c.g;
    data[i * 3 + 2] = c.b;
    glow[i] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(data, 3));
  g.setAttribute('glow', new THREE.BufferAttribute(glow, 1));
  return g;
};

/** Shell colour: darker in the grooves' shade near the scalp, drifting to the tip colour at the lower edge. */
const shadeShell = (g: THREE.BufferGeometry, R: number, base: THREE.Color, tip: THREE.Color, tipFrom: number, tipTo: number): THREE.BufferGeometry => {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const data = new Float32Array(pos.count * 3), glow = new Float32Array(pos.count);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / R;
    const k = smoothstep(tipFrom, tipTo, y);
    c.copy(base).multiplyScalar(0.9 + 0.1 * smoothstep(-0.2, 0.9, y)).lerp(tip, k);
    data[i * 3] = c.r;
    data[i * 3 + 1] = c.g;
    data[i * 3 + 2] = c.b;
    glow[i] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(data, 3));
  g.setAttribute('glow', new THREE.BufferAttribute(glow, 1));
  return g;
};

interface Kit {
  R: number;
  rng: Rng;
  /** 0.5..1: how finely to tessellate. */
  detail: number;
  shell(s: Shell, tipFrom?: number, tipTo?: number): void;
  lock(l: Lock): void;
  /** Any extra solid: buns, clips, goggles. `tipBlend` 0 uses the base colour, 1 the tip colour. */
  solid(g: THREE.BufferGeometry, tipBlend?: number): void;
  /** An accessory in its own colour: goggles, bands. */
  prop(g: THREE.BufferGeometry, color: THREE.ColorRepresentation): void;
}

const backFrom = (front: number, back: number, from = 55, to = 125) => (az: number): number =>
  THREE.MathUtils.lerp(front, back, smoothstep(from, to, Math.abs(az)));

const STYLES: Record<HairStyleName, (k: Kit) => void> = {
  // Jamie: short, chunky, never quite brushed
  messy: ({ R, rng, shell, lock }) => {
    shell({ grow: 1.075, fringe: (x) => 0.36 + 0.13 * teeth(x + 0.08, 5) + 0.1 * x, bottom: (az) => backFrom(-0.12, -0.5)(az) + 0.07 * teeth(az / 180, 9), ridges: 0.02, ridgeCount: 13 });
    for (let i = 0; i < 9; i++) {
      const az = -150 + i * 37.5 + rng.range(-8, 8);
      lock({ root: dirOf(az, 62 + rng.range(-5, 5)), flow: dirOf(az + rng.range(-30, 30), -5), length: R * rng.range(0.62, 0.86), width: R * rng.range(0.3, 0.38), lift: R * rng.range(0.1, 0.17), droop: 0.5 });
    }
    for (let i = 0; i < 5; i++) {
      const az = -40 + i * 22;
      lock({ root: dirOf(az * 0.8, 60), flow: dirOf(az + 30, -20), length: R * rng.range(0.5, 0.62), width: R * rng.range(0.3, 0.36), lift: R * 0.12, droop: 0.9 });
    }
    // two tufts that refuse to lie down
    lock({ root: dirOf(30, 82), flow: dirOf(70, 30), length: R * 0.4, width: R * 0.17, lift: R * 0.2, droop: -0.5 });
  },
  // Lumi: a soft, weightless bob that curls in toward the jaw, a star clipped above one temple
  softBob: ({ R, rng, shell, lock, solid }) => {
    shell({ grow: 1.085, flare: 0.1, stretch: 1.22, faceWidth: 0.7, fringe: (x) => 0.2 + 0.15 * teeth(x - 0.1, 6) - 0.1 * x * x, bottom: (az) => -0.74 + 0.13 * teeth(az / 180, 13), ridges: 0.016, ridgeCount: 19 }, -0.9, -0.2);
    for (let i = 0; i < 6; i++) {
      const az = -52 + i * 21;
      lock({ root: dirOf(az * 0.7, 62), flow: dirOf(az - 24, -30), length: R * rng.range(0.52, 0.66), width: R * rng.range(0.3, 0.36), lift: R * 0.13, droop: 1.1 });
    }
    lock({ root: dirOf(10, 86), flow: dirOf(-60, 35), length: R * 0.38, width: R * 0.11, lift: R * 0.2, droop: -0.5 });
    const star = blob(R * 0.15, R * 0.15, R * 0.04, 3, (p) => {
      const k = 0.58 + 0.42 * Math.cos(Math.atan2(p.y, p.x) * 5);
      p.x *= k;
      p.y *= k;
    });
    solid(place(star, dirOf(58, 30).multiplyScalar(R * 1.2), [-0.2, 1.0, 0.25]), 1);
  },
  // Nova: long waves down the back, a centre parting, goggles pushed up
  longWavy: ({ R, rng, shell, lock, prop }) => {
    shell({ grow: 1.08, flare: 0.07, stretch: 1.15, faceWidth: 0.72, fringe: (x) => 0.5 - 0.42 * Math.abs(x) ** 1.4, bottom: () => -0.72, ridges: 0.016, ridgeCount: 15 });
    for (let i = 0; i < 11; i++) {
      const az = 62 + i * 23.6;
      lock({ root: dirOf(az, -6 + rng.range(-4, 4)), flow: dirOf(az, -75), length: R * rng.range(2.3, 2.9), width: R * rng.range(0.42, 0.52), lift: R * 0.14, droop: 1.4, wave: R * 0.1, waves: rng.range(1.5, 2.1) });
    }
    for (const s of [-1, 1]) {
      lock({ root: dirOf(s * 50, 4), flow: dirOf(s * 40, -80), length: R * 1.9, width: R * 0.36, lift: R * 0.14, droop: 1.4, wave: R * 0.06, waves: 1.5 });
      const at = dirOf(s * 23, 58).multiplyScalar(R * 1.2);
      const out = at.clone().normalize();
      prop(orient(torus(R * 0.19, R * 0.055, 8, 20), at, out), 0x3b3550);
      prop(orient(blob(R * 0.16, R * 0.05, R * 0.16, 3), at, out), 0x9be6ff);
    }
    prop(orient(blob(R * 0.1, R * 0.04, R * 0.05, 2), dirOf(0, 61).multiplyScalar(R * 1.17), dirOf(0, 61)), 0x3b3550);
  },
  // Kai: a round cloud of tight curls
  curls: ({ R, rng, solid, detail }) => {
    const puff = blob(R * 1.34, R * 1.3, R * 1.28, Math.round(8 + 8 * detail), (p) => {
      const line = THREE.MathUtils.lerp(-0.3, 0.42, smoothstep(-0.4, 0.8, p.z));
      const k = smoothstep(line - 0.08, line + 0.1, p.y);
      const bumps = 0.05 * Math.sin(p.x * 21 + p.y * 9) * Math.sin(p.y * 19 + p.z * 13) * Math.sin(p.z * 17 + p.x * 11);
      p.multiplyScalar(THREE.MathUtils.lerp(0.66, 1 + bumps, k));
    });
    solid(place(puff, [0, R * 0.2, -R * 0.05]), 0.02);
    const N = Math.round(150 * detail);
    for (let i = 0; i < N; i++) {
      // golden-angle spiral over the upper sphere: evenly packed curls
      const y = 1 - (i + 0.5) / N * 1.25, r = Math.sqrt(Math.max(0, 1 - y * y)), a = i * 2.39996;
      const d = v3(Math.cos(a) * r, y, Math.sin(a) * r);
      if (d.z > 0.3 && d.y < 0.5) continue;
      if (d.y < -0.22) continue;
      const size = R * rng.range(0.15, 0.2) / Math.sqrt(detail);
      solid(place(blob(size, size, size, detail < 0.8 ? 1 : 2), d.multiplyScalar(R * rng.range(1.25, 1.31)).add(v3(0, R * 0.2, -R * 0.05))), rng.range(0, 0.06));
    }
  },
  // Teacher: swept back into a bun, a side parting
  bun: ({ R, shell, lock, solid }) => {
    shell({ grow: 1.07, faceWidth: 0.8, fringe: (x) => 0.4 - 0.16 * x - 0.5 * Math.abs(x) ** 3, bottom: backFrom(-0.1, -0.52), ridges: 0.012, ridgeCount: 21 });
    lock({ root: dirOf(-30, 56), flow: dirOf(46, -12), length: R * 0.78, width: R * 0.4, lift: R * 0.1, droop: 0.8 });
    solid(place(blob(R * 0.44, R * 0.4, R * 0.42, 6, (p) => { p.multiplyScalar(1 + 0.05 * Math.sin(Math.atan2(p.z, p.x) * 7 + p.y * 5)); }), [0, R * 0.92, -R * 0.74]), 0.2);
  },
  ponytail: ({ R, rng, shell, lock, solid }) => {
    shell({ grow: 1.06, fringe: (x) => 0.44 + 0.1 * teeth(x, 4) + 0.06 * x, bottom: backFrom(-0.08, -0.5), ridges: 0.012, ridgeCount: 21 });
    for (let i = 0; i < 4; i++) lock({ root: dirOf(-30 + i * 20, 60), flow: dirOf(-50 + i * 34, -25), length: R * rng.range(0.5, 0.64), width: R * 0.32, lift: R * 0.12, droop: 1.1 });
    const tail = sweep([v3(0, R * 0.62, -R * 0.94), v3(0, R * 0.56, -R * 1.45), v3(0, -R * 0.25, -R * 1.66), v3(0, -R * 1.2, -R * 1.46)], (t) => R * 0.27 * widthProfile(Math.min(1, t * 0.9 + 0.1)), { radial: 10, steps: 18, endCap: 'point' });
    solid(tail, 0.4);
    solid(place(torus(R * 0.16, R * 0.05, 8, 16), [0, R * 0.62, -R * 1.0], [1.2, 0, 0]), 1);
  },
  crop: ({ R, rng, shell, lock }) => {
    shell({ grow: 1.06, fringe: (x) => 0.52 + 0.06 * teeth(x, 6), bottom: (az) => backFrom(0.0, -0.4)(az) + 0.04 * teeth(az / 180, 11), ridges: 0.014, ridgeCount: 23 });
    for (let i = 0; i < 6; i++) lock({ root: dirOf(-45 + i * 18, 64), flow: dirOf(-40 + i * 16, 16), length: R * rng.range(0.34, 0.46), width: R * 0.3, lift: R * 0.13, droop: 0.2 });
  },
  buns: ({ R, rng, shell, lock, solid }) => {
    shell({ grow: 1.06, fringe: (x) => 0.3 + 0.14 * teeth(x, 5), bottom: backFrom(-0.1, -0.5), ridges: 0.012, ridgeCount: 19 });
    for (let i = 0; i < 5; i++) lock({ root: dirOf(-44 + i * 22, 60), flow: dirOf(-50 + i * 25, -35), length: R * rng.range(0.5, 0.62), width: R * 0.32, lift: R * 0.12, droop: 1.2 });
    for (const s of [-1, 1]) solid(place(blob(R * 0.36, R * 0.36, R * 0.36, 6), [s * R * 0.68, R * 1.0, -R * 0.2]), 0.3);
  },
  // a wrapped scarf: one smooth shape around head and neck
  hijab: ({ R, solid }) => {
    const wrap = blob(R * 1.12, R * 1.1, R * 1.1, 18, (p) => {
      const face = Math.hypot(p.x / 0.64, (p.y + 0.08) / 0.74);
      if (p.z > 0) p.multiplyScalar(THREE.MathUtils.lerp(0.8, 1, smoothstep(0.94, 1.04, face)));
      if (p.y < -0.5) p.multiplyScalar(1 + 0.3 * smoothstep(-0.5, -1, p.y));
    });
    solid(place(wrap, [0, -R * 0.02, -R * 0.02]), 0.1);
    solid(place(blob(R * 1.12, R * 0.48, R * 0.92, 8), [0, -R * 1.3, R * 0.05]), 0.1);
  },
};

/** Hair in head space (origin at the head's centre, +Z forward), vertex-coloured root to tip. */
export const buildHair = (R: number, look: HairLook, detail = 1): THREE.BufferGeometry => {
  const rng = new Rng(look.seed ?? 7);
  const base = new THREE.Color(look.color);
  const tip = look.tipColor !== undefined ? new THREE.Color(look.tipColor) : base.clone().lerp(new THREE.Color(0xffffff), 0.16);
  const parts: THREE.BufferGeometry[] = [];
  STYLES[look.style]({
    R, rng, detail,
    shell: (s, tipFrom = -2, tipTo = -1.2) => void parts.push(shadeShell(shellGeometry(R, s, detail), R, base, tip, tipTo, tipFrom)),
    lock: (l) => void parts.push(shadeLock(growLock(R, l, rng), base, tip, rng.range(-0.04, 0.04))),
    solid: (g, tipBlend = 0) => void parts.push(fill(tint(g, base.clone().lerp(tip, tipBlend)), 'glow', tipBlend)),
    prop: (g, color) => void parts.push(fill(tint(g, color), 'glow', 0)),
  });
  return merge(parts);
};
