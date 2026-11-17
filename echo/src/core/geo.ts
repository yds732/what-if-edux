import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp01 } from './math';

/**
 * Procedural modelling kit. Everything in the game is built from four moves: sweep a section along a path,
 * spin a profile, deform a seamless sphere, and round a box. Geometries come back indexed with smooth normals;
 * colour is carried per vertex so many parts can share one material and one draw call.
 */

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();

export type V3 = readonly [number, number, number];
export const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** A unit sphere with no seam and no poles, so it can be pushed around freely and still shade smoothly. */
export const smoothSphere = (detail = 4): THREE.BufferGeometry => {
  const g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const merged = mergeVertices(g, 1e-5);
  g.dispose();
  merged.computeVertexNormals();
  return merged;
};

/** Moves every vertex through `fn` (mutating the passed vector) and rebuilds the normals. */
export const deform = (g: THREE.BufferGeometry, fn: (p: THREE.Vector3, index: number) => void): THREE.BufferGeometry => {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    _a.fromBufferAttribute(pos, i);
    fn(_a, i);
    pos.setXYZ(i, _a.x, _a.y, _a.z);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
};

/** Ellipsoid, or any blob a deformation makes of one. */
export const blob = (rx: number, ry: number, rz: number, detail = 3, shape?: (p: THREE.Vector3) => void): THREE.BufferGeometry =>
  deform(smoothSphere(detail), (p) => {
    shape?.(p);
    p.set(p.x * rx, p.y * ry, p.z * rz);
  });

/** Gives every vertex one colour (linear working space). */
export const tint = (g: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry => {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    data[i * 3] = c.r;
    data[i * 3 + 1] = c.g;
    data[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(data, 3));
  return g;
};

/** Colours each vertex from its position (and normal, when the geometry has them). */
export const tintBy = (g: THREE.BufferGeometry, fn: (p: THREE.Vector3, out: THREE.Color, n: THREE.Vector3) => void): THREE.BufferGeometry => {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const data = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    _a.fromBufferAttribute(pos, i);
    if (nor) _b.fromBufferAttribute(nor, i);
    fn(_a, c, _b);
    data[i * 3] = c.r;
    data[i * 3 + 1] = c.g;
    data[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(data, 3));
  return g;
};

export const place = (
  g: THREE.BufferGeometry,
  position: V3 | THREE.Vector3 = [0, 0, 0],
  rotation: V3 = [0, 0, 0],
  scale: V3 | number = 1,
): THREE.BufferGeometry => {
  const p = position instanceof THREE.Vector3 ? position : _a.set(position[0], position[1], position[2]);
  const s = typeof scale === 'number' ? _b.set(scale, scale, scale) : _b.set(scale[0], scale[1], scale[2]);
  _q.setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2], 'YXZ'));
  g.applyMatrix4(new THREE.Matrix4().compose(p.clone(), _q, s.clone()));
  return g;
};

/** Fills a one-component attribute with a constant; `merge` needs every part to carry the same attributes. */
export const fill = (g: THREE.BufferGeometry, name: string, value: number): THREE.BufferGeometry => {
  g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(value), 1));
  return g;
};

/** Merges parts into one geometry. Attributes missing on some parts are dropped so the merge always succeeds. */
export const merge = (parts: THREE.BufferGeometry[], dispose = true): THREE.BufferGeometry => {
  if (parts.length === 0) throw new Error('merge: no parts');
  const common = new Set(Object.keys(parts[0]!.attributes));
  for (const g of parts) for (const k of [...common]) if (!g.getAttribute(k)) common.delete(k);
  const prepared = parts.map((g) => {
    const p = g.index ? g : mergeVertices(g);
    for (const k of Object.keys(p.attributes)) if (!common.has(k)) p.deleteAttribute(k);
    return p;
  });
  const merged = mergeGeometries(prepared, false);
  if (!merged) throw new Error('merge: incompatible geometries');
  if (dispose) for (const g of parts) g.dispose();
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
};

export interface Section {
  /** Half-width along the section's side axis. */
  rx: number;
  /** Half-width along its up axis. */
  ry: number;
}
export type SectionFn = (t: number) => Section | number;
export type CapStyle = 'round' | 'flat' | 'point' | 'open';

export interface SweepOptions {
  /** Vertices around the section. */
  radial?: number;
  /** Samples along the path; defaults to 6 per control point. */
  steps?: number;
  /** Hint for the section's up axis at the start; transported along the path so the tube never twists. */
  up?: THREE.Vector3;
  startCap?: CapStyle;
  endCap?: CapStyle;
  /** Twist in radians, as a function of t. */
  twist?: (t: number) => number;
  /** Treats the control points as the exact polyline instead of fitting a curve through them. */
  polyline?: boolean;
}

const sectionOf = (s: Section | number): Section => (typeof s === 'number' ? { rx: s, ry: s } : s);

/**
 * Sweeps an elliptical section along a path. Limbs, hair locks, branches, cables, arches and rails are all this.
 * `uv.x` runs 0..1 along the path and `uv.y` around the section.
 */
export const sweep = (path: readonly THREE.Vector3[], section: SectionFn, opts: SweepOptions = {}): THREE.BufferGeometry => {
  if (path.length < 2) throw new Error('sweep: a path needs at least two points');
  const radial = opts.radial ?? 12;
  const steps = opts.steps ?? Math.max(4, (path.length - 1) * 6);
  const startCap = opts.startCap ?? 'round', endCap = opts.endCap ?? 'round';
  const curve = opts.polyline || path.length === 2 ? null : new THREE.CatmullRomCurve3(path as THREE.Vector3[], false, 'centripetal');
  const pointAt = (t: number, out: THREE.Vector3): THREE.Vector3 => {
    if (curve) return curve.getPoint(t, out);
    const f = clamp01(t) * (path.length - 1);
    const i = Math.min(path.length - 2, Math.floor(f));
    return out.lerpVectors(path[i]!, path[i + 1]!, f - i);
  };

  // centres and tangents
  const centers: THREE.Vector3[] = [], tangents: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) centers.push(pointAt(i / steps, new THREE.Vector3()));
  for (let i = 0; i <= steps; i++) {
    const a = centers[Math.max(0, i - 1)]!, b = centers[Math.min(steps, i + 1)]!;
    tangents.push(new THREE.Vector3().subVectors(b, a).normalize());
  }
  // parallel-transported frames
  const ups: THREE.Vector3[] = [], sides: THREE.Vector3[] = [];
  const hint = opts.up ?? (Math.abs(tangents[0]!.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1));
  let up = hint.clone().addScaledVector(tangents[0]!, -hint.dot(tangents[0]!)).normalize();
  for (let i = 0; i <= steps; i++) {
    if (i > 0) {
      _q.setFromUnitVectors(tangents[i - 1]!, tangents[i]!);
      up = up.clone().applyQuaternion(_q);
    }
    up.addScaledVector(tangents[i]!, -up.dot(tangents[i]!)).normalize();
    ups.push(up.clone());
    sides.push(new THREE.Vector3().crossVectors(tangents[i]!, up).normalize());
  }

  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const twistAt = (t: number): number => opts.twist?.(t) ?? 0;
  /** Appends one ring of vertices and returns its first index. */
  const ring = (center: THREE.Vector3, i: number, rx: number, ry: number, t: number): number => {
    const first = positions.length / 3;
    const twist = twistAt(t);
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2 + twist;
      const cx = Math.cos(a) * rx, cy = Math.sin(a) * ry;
      positions.push(center.x + sides[i]!.x * cx + ups[i]!.x * cy, center.y + sides[i]!.y * cx + ups[i]!.y * cy, center.z + sides[i]!.z * cx + ups[i]!.z * cy);
      uvs.push(t, k / radial);
    }
    return first;
  };
  const bridge = (a0: number, b0: number): void => {
    for (let k = 0; k < radial; k++) {
      const k1 = (k + 1) % radial;
      indices.push(a0 + k, b0 + k, a0 + k1, a0 + k1, b0 + k, b0 + k1);
    }
  };
  /** Closes a ring onto a single vertex; `outward` is -1 at the start of the path and +1 at its end. */
  const fan = (r0: number, p: THREE.Vector3, t: number, outward: -1 | 1): void => {
    const index = positions.length / 3;
    positions.push(p.x, p.y, p.z);
    uvs.push(t, 0);
    for (let k = 0; k < radial; k++) {
      const k1 = (k + 1) % radial;
      if (outward < 0) indices.push(index, r0 + k, r0 + k1);
      else indices.push(index, r0 + k1, r0 + k);
    }
  };

  const CAP = 4;
  const s0 = sectionOf(section(0)), s1 = sectionOf(section(1));
  let prev = -1;
  const add = (r: number): void => {
    if (prev >= 0) bridge(prev, r);
    prev = r;
  };
  let firstRing = -1;

  if (startCap === 'round') {
    // quarter-ellipse closure: the section shrinks as its centre slides back along the tangent
    const depth = Math.min(s0.rx, s0.ry);
    for (let j = CAP; j >= 1; j--) {
      const a = (j / (CAP + 1)) * (Math.PI / 2);
      const r = ring(centers[0]!.clone().addScaledVector(tangents[0]!, -Math.sin(a) * depth), 0, s0.rx * Math.cos(a), s0.ry * Math.cos(a), 0);
      if (firstRing < 0) firstRing = r;
      add(r);
    }
  }
  const from = startCap === 'point' ? 1 : 0;
  const to = endCap === 'point' ? steps - 1 : steps;
  for (let i = from; i <= to; i++) {
    const t = i / steps;
    const s = sectionOf(section(t));
    const r = ring(centers[i]!, i, s.rx, s.ry, t);
    if (firstRing < 0) firstRing = r;
    add(r);
  }
  if (endCap === 'round') {
    const depth = Math.min(s1.rx, s1.ry);
    for (let j = 1; j <= CAP; j++) {
      const a = (j / (CAP + 1)) * (Math.PI / 2);
      add(ring(centers[steps]!.clone().addScaledVector(tangents[steps]!, Math.sin(a) * depth), steps, s1.rx * Math.cos(a), s1.ry * Math.cos(a), 1));
    }
  }
  const lastRing = prev;

  if (startCap === 'round') fan(firstRing, centers[0]!.clone().addScaledVector(tangents[0]!, -Math.min(s0.rx, s0.ry)), 0, -1);
  else if (startCap === 'point') fan(firstRing, centers[0]!, 0, -1);
  else if (startCap === 'flat') fan(ring(centers[0]!, 0, s0.rx, s0.ry, 0), centers[0]!, 0, -1); // its own rim, so the edge stays crisp
  if (endCap === 'round') fan(lastRing, centers[steps]!.clone().addScaledVector(tangents[steps]!, Math.min(s1.rx, s1.ry)), 1, 1);
  else if (endCap === 'point') fan(lastRing, centers[steps]!, 1, 1);
  else if (endCap === 'flat') fan(ring(centers[steps]!, steps, s1.rx, s1.ry, 1), centers[steps]!, 1, 1);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
};

/** Smooth interpolation through [t, value] keys; the workhorse for limb and lock profiles. */
export const curve1 = (keys: readonly (readonly [number, number])[]) => (t: number): number => {
  if (t <= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i]!;
    if (t <= t1) {
      const [t0, v0] = keys[i - 1]!;
      const k = (t - t0) / (t1 - t0);
      const s = k * k * (3 - 2 * k);
      return v0 + (v1 - v0) * s;
    }
  }
  return keys[keys.length - 1]![1];
};

/** Smooth, seamless torus about +Y. */
export const torus = (radius: number, tube: number, radial = 10, tubular = 28): THREE.BufferGeometry => {
  const g = new THREE.TorusGeometry(radius, tube, radial, tubular);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const merged = mergeVertices(g, 1e-5);
  g.dispose();
  merged.rotateX(Math.PI / 2);
  merged.computeVertexNormals();
  return merged;
};

/** Box with rounded edges and smooth shading across them. */
export const roundBox = (w: number, h: number, d: number, radius: number, segments = 3): THREE.BufferGeometry => {
  const r = Math.min(radius, w / 2, h / 2, d / 2);
  const g = new RoundedBoxGeometry(w, h, d, segments, r);
  g.deleteAttribute('uv');
  return g;
};

/** Flat rounded rectangle in the XY plane facing +Z, with uv 0..1 across it: panels, screens, posters. */
export const roundRect = (w: number, h: number, radius: number, segments = 6): THREE.BufferGeometry => {
  const r = Math.min(radius, w / 2, h / 2);
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2);
  shape.absarc(w / 2 - r, -h / 2 + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(w / 2, h / 2 - r);
  shape.absarc(w / 2 - r, h / 2 - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-w / 2 + r, h / 2);
  shape.absarc(-w / 2 + r, h / 2 - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-w / 2, -h / 2 + r);
  shape.absarc(-w / 2 + r, -h / 2 + r, r, Math.PI, Math.PI * 1.5, false);
  const g = new THREE.ShapeGeometry(shape, segments);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
  return g;
};
