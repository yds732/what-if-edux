import * as THREE from 'three';
import { TAU, clamp01, fbm3, lerp, smoothstep } from '../../core/math';

export interface IslandSpec {
  readonly radius: number;
  readonly depth: number;
  readonly seed: number;
  readonly lump?: number;
  readonly hills?: number;
  readonly flat?: number;
  readonly detail?: number;
}

export interface Island {
  readonly geometry: THREE.BufferGeometry;
  outline(bearing: number): number;
  heightAt(x: number, z: number): number | null;
}

const GRASS_A = new THREE.Color(0x24366a), GRASS_B = new THREE.Color(0x3e5690), MOSS = new THREE.Color(0x5c74b4);
const ROCK_A = new THREE.Color(0x3b4688), ROCK_B = new THREE.Color(0x161d40), ROCK_WARM = new THREE.Color(0x56489a);

export const buildIsland = (spec: IslandSpec): Island => {
  const { radius, depth, seed } = spec;
  const lump = spec.lump ?? 0.16, hills = spec.hills ?? 0.6, flat = spec.flat ?? 0.6, detail = spec.detail ?? 1;
  const SEG = Math.round(112 * detail), TOP = Math.round(22 * detail), UNDER = Math.round(34 * detail);
  const s = seed * 13.37;

  const outline = (bearing: number): number => {
    const cx = Math.sin(bearing), cz = Math.cos(bearing);
    return radius * (1 + lump * (fbm3(cx * 1.3 + s, cz * 1.3, 0.5, 4) + 0.35 * fbm3(cx * 4.1, cz * 4.1 + s, 2.5, 3)));
  };
  const topHeight = (x: number, z: number, k: number): number => {
    const mound = hills * smoothstep(flat, 1, k) * (0.5 + 0.5 * fbm3(x * 0.16 + s, z * 0.16, 1.5, 3));
    const lip = -0.5 * smoothstep(0.93, 1, k) ** 2;
    return mound + lip + 0.05 * fbm3(x * 0.9, z * 0.9, s, 2) * smoothstep(flat * 0.8, 1, k);
  };

  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const c = new THREE.Color();
  const push = (x: number, y: number, z: number, col: THREE.Color): void => {
    positions.push(x, y, z);
    colors.push(col.r, col.g, col.b);
  };

  push(0, topHeight(0, 0, 0), 0, c.copy(GRASS_A).lerp(GRASS_B, 0.5));
  const ring = (i: number): number => 1 + i * SEG;
  let rings = 0;
  for (let i = 1; i <= TOP; i++) {
    const k = (i / TOP) ** 0.85;
    for (let j = 0; j < SEG; j++) {
      const a = (j / SEG) * TAU, r = outline(a) * k;
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      const patch = fbm3(x * 0.22 + s, z * 0.22, 4.0, 3) * 0.5 + 0.5;
      c.copy(GRASS_A).lerp(GRASS_B, patch).lerp(MOSS, smoothstep(0.62, 0.9, patch) * 0.45).lerp(ROCK_A, smoothstep(0.955, 1, k));
      push(x, topHeight(x, z, k), z, c);
    }
    rings++;
  }
  for (let i = 1; i <= UNDER; i++) {
    const v = i / UNDER;
    const y0 = -depth * v ** 1.25;
    for (let j = 0; j < SEG; j++) {
      const a = (j / SEG) * TAU, edge = outline(a);
      const cx = Math.sin(a), cz = Math.cos(a);
      const taper = (1 - v) ** 0.62 * (1 - 0.1 * smoothstep(0, 0.12, v));
      const strata = 0.045 * Math.sin(y0 * 2.6 + fbm3(cx * 2 + s, cz * 2, 0, 2) * 4);
      const crag = 0.16 * fbm3(cx * 3.2 + s, y0 * 0.22, cz * 3.2, 4) * smoothstep(0, 0.25, v);
      const spur = 0.2 * Math.max(0, fbm3(cx * 1.6, cz * 1.6 + s, 9.0, 3)) * Math.sin(v * Math.PI);
      const r = Math.max(0.02, edge * taper * (1 + strata + crag + spur));
      const y = y0 - 0.5 - 0.35 * depth * spur * v;
      const shade = clamp01(v * 1.2 + 0.25 * fbm3(cx * 5, y0 * 0.5, cz * 5, 2));
      c.copy(ROCK_A).lerp(ROCK_WARM, 0.5 * (0.5 + 0.5 * Math.sin(y0 * 2.6 + 1))).lerp(ROCK_B, shade);
      push(cx * r, y, cz * r, c);
    }
    rings++;
  }
  const tip = positions.length / 3;
  push(0, -depth * 1.06 - 0.5, 0, ROCK_B);

  for (let j = 0; j < SEG; j++) indices.push(0, ring(0) + j, ring(0) + ((j + 1) % SEG));
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = ring(i) + j, b = ring(i) + ((j + 1) % SEG), d = ring(i + 1) + j, e = ring(i + 1) + ((j + 1) % SEG);
      indices.push(a, d, b, b, d, e);
    }
  }
  for (let j = 0; j < SEG; j++) indices.push(tip, ring(rings - 1) + ((j + 1) % SEG), ring(rings - 1) + j);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  return {
    geometry, outline,
    heightAt(x, z) {
      const r = Math.hypot(x, z);
      const edge = outline(Math.atan2(x, z));
      if (r > edge) return null;
      return topHeight(x, z, lerp(0, 1, (r / edge) ** (1 / 0.85)) ** 0.85);
    },
  };
};
