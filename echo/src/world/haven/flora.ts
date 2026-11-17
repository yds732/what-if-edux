import * as THREE from 'three';
import { blob, curve1, fill, merge, place, sweep, tint, tintBy, v3 } from '../../core/geo';
import { Rng, TAU, fbm3, lerp, smoothstep } from '../../core/math';

/** Shared clock for everything that sways. */
export const windUniforms = { uTime: { value: 0 }, uWind: { value: 1 } };

// ---------------------------------------------------------------------------------------------------- grass

const BLADE_VS_PARS = /* glsl */ `
attribute vec4 aBlade;   // x, z, yaw, height
attribute vec3 aTint;
attribute float aGround;
uniform float uTime, uWind;
varying float vBladeV;
varying vec3 vTint;
`;
const BLADE_VS = /* glsl */ `
{
  float h = aBlade.w, c = cos(aBlade.z), s = sin(aBlade.z);
  vec3 p = position; float v = p.y; vBladeV = v;
  p.y *= h; p.x *= 0.5 + 0.5 * h;
  float gust = sin(uTime * 1.3 + aBlade.x * 0.55 + aBlade.y * 0.4) + 0.5 * sin(uTime * 2.7 + aBlade.x * 1.7);
  float bend = (0.14 + 0.1 * gust * uWind) * v * v * h;
  p.z += bend; p.y -= bend * bend * 0.6;
  transformed = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  transformed.xz += aBlade.xy;
  transformed.y += aGround;
  vTint = aTint;
}
`;

/**
 * A field of blades in one draw call. `ground` decides where grass may grow and how tall; it returns the
 * ground height, or null to leave the spot bare.
 */
export const buildGrass = (count: number, radius: number, rng: Rng, ground: (x: number, z: number) => { y: number; scale: number } | null): THREE.Mesh => {
  // one blade: a tapering strip, three segments
  const blade = new THREE.BufferGeometry();
  const w = 0.028;
  const verts: number[] = [], idx: number[] = [], nor: number[] = [];
  const profile = [1, 0.82, 0.5, 0];
  for (let i = 0; i < profile.length; i++) {
    const v = i / (profile.length - 1);
    verts.push(-w * profile[i]!, v, 0, w * profile[i]!, v, 0);
    nor.push(0, 0.35, 1, 0, 0.35, 1);
    if (i < profile.length - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3);
  }
  blade.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  blade.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  blade.setIndex(idx);

  const data: number[] = [], tints: number[] = [], heights: number[] = [];
  const a = new THREE.Color(0x1d6f6a), b = new THREE.Color(0x58c9a0), glow = new THREE.Color(0x9ff0d0), c = new THREE.Color();
  let placed = 0;
  for (let i = 0; i < count * 3 && placed < count; i++) {
    const r = radius * Math.sqrt(rng.next()), ang = rng.range(0, TAU);
    const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
    const g = ground(x, z);
    if (!g) continue;
    const patch = fbm3(x * 0.35, z * 0.35, 3.3, 2) * 0.5 + 0.5;
    const h = (0.16 + 0.34 * rng.next() ** 1.6) * (0.7 + 0.7 * patch) * g.scale;
    data.push(x, z, rng.range(0, TAU), h);
    heights.push(g.y);
    c.copy(a).lerp(b, patch * 0.8 + rng.range(0, 0.2)).lerp(glow, rng.chance(0.06) ? 0.5 : 0);
    tints.push(c.r, c.g, c.b);
    placed++;
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = blade.index;
  geo.setAttribute('position', blade.getAttribute('position'));
  geo.setAttribute('normal', blade.getAttribute('normal'));
  geo.setAttribute('aBlade', new THREE.InstancedBufferAttribute(new Float32Array(data), 4));
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(tints), 3));
  geo.setAttribute('aGround', new THREE.InstancedBufferAttribute(new Float32Array(heights), 1));
  geo.instanceCount = placed;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius + 2);

  const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, windUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${BLADE_VS_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${BLADE_VS}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBladeV;\nvarying vec3 vTint;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vTint * (0.42 + 0.9 * vBladeV);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vTint * vBladeV * vBladeV * 0.22;');
  };
  mat.customProgramCacheKey = () => 'echo-grass';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
};

// ---------------------------------------------------------------------------------------------------- blossom tree

export interface Tree {
  readonly group: THREE.Group;
  /** World-space points among the blossom, for spawning falling petals. */
  readonly canopy: THREE.Vector3[];
}

const PETAL_VS_PARS = /* glsl */ `
attribute vec4 aLeaf;   // local offset xyz, size
attribute vec4 aLeafRot; // axis-angle packed: yaw, tilt, phase, tint
uniform float uTime, uWind;
varying float vLeafTint; varying vec2 vLeafUv;
`;
const PETAL_VS = /* glsl */ `
{
  float yaw = aLeafRot.x, tilt = aLeafRot.y + 0.25 * sin(uTime * 1.7 + aLeafRot.z * 6.28) * uWind;
  vec3 p = position * aLeaf.w;
  float ct = cos(tilt), st = sin(tilt), cy = cos(yaw), sy = sin(yaw);
  p = vec3(p.x, p.y * ct - p.z * st, p.y * st + p.z * ct);
  p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
  vec3 sway = vec3(sin(uTime * 0.9 + aLeaf.y * 0.7), 0.0, cos(uTime * 0.7 + aLeaf.x * 0.6)) * 0.035 * uWind;
  transformed = p + aLeaf.xyz + sway;
  objectNormal = normalize(aLeaf.xyz - vec3(0.0, 4.2, 0.0)) * 0.7 + vec3(0.0, 0.5, 0.0);   // shade the canopy as one soft mass
  vLeafTint = aLeafRot.w; vLeafUv = uv;
}
`;

export const buildBlossomTree = (rng: Rng, petalCount: number): Tree => {
  const group = new THREE.Group();
  const bark: THREE.BufferGeometry[] = [];
  const tips: { p: THREE.Vector3; r: number }[] = [];
  const barkA = new THREE.Color(0x3a2a4e), barkB = new THREE.Color(0x6a4a6e);

  const branch = (from: THREE.Vector3, dir: THREE.Vector3, length: number, radius: number, depth: number): void => {
    const bend = v3(rng.range(-0.5, 0.5), rng.range(0.1, 0.5), rng.range(-0.5, 0.5));
    const mid = from.clone().addScaledVector(dir, length * 0.5).addScaledVector(bend, length * 0.18);
    const end = from.clone().addScaledVector(dir.clone().add(bend.multiplyScalar(0.35)).normalize(), length);
    const g = sweep([from, mid, end], (t) => radius * lerp(1, 0.58, t), { radial: depth === 0 ? 12 : 7, steps: 10, startCap: 'round', endCap: 'round' });
    bark.push(tintBy(g, (p, out) => void out.copy(barkA).lerp(barkB, 0.5 + 0.5 * fbm3(p.x * 3, p.y * 1.2, p.z * 3, 2))));
    if (depth >= 3) {
      tips.push({ p: end, r: 0.75 + rng.range(0, 0.5) });
      return;
    }
    const kids = depth === 0 ? 4 : rng.int(2, 3);
    for (let i = 0; i < kids; i++) {
      const spread = depth === 0 ? 0.85 : 0.7;
      const d = dir.clone().add(v3(rng.range(-1, 1) * spread, rng.range(0.05, 0.6), rng.range(-1, 1) * spread)).normalize();
      branch(from.clone().lerp(end, rng.range(0.72, 1)), d, length * rng.range(0.6, 0.78), radius * 0.58, depth + 1);
    }
    if (depth >= 1) tips.push({ p: end, r: 0.6 + rng.range(0, 0.4) });
  };
  // a leaning trunk with a root flare
  const trunkTop = v3(0.5, 2.5, 0.25);
  bark.push(tintBy(sweep([v3(-0.15, -0.3, 0), v3(0.05, 0.9, 0.05), trunkTop], curve1([[0, 0.58], [0.16, 0.36], [1, 0.25]]), { radial: 14, steps: 14, startCap: 'flat', endCap: 'round' }),
    (p, out) => void out.copy(barkA).lerp(barkB, 0.5 + 0.5 * fbm3(p.x * 3, p.y * 1.2, p.z * 3, 2))));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + rng.range(-0.3, 0.3);
    bark.push(tint(sweep([v3(-0.1, 0.35, 0), v3(Math.cos(a) * 0.5, 0.05, Math.sin(a) * 0.5), v3(Math.cos(a) * 1.1, -0.22, Math.sin(a) * 1.1)], (t) => 0.16 * (1 - t * 0.75), { radial: 7, steps: 8 }), barkA));
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + rng.range(-0.4, 0.4);
    branch(trunkTop.clone().add(v3(0, -0.25 * i * 0.3, 0)), v3(Math.cos(a) * 0.8, rng.range(0.55, 0.9), Math.sin(a) * 0.8).normalize(), rng.range(1.9, 2.5), 0.2, 1);
  }
  const trunk = new THREE.Mesh(merge(bark), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  group.add(trunk);

  // canopy: soft masses at the branch tips...
  const pinkA = new THREE.Color(0xff8fc8), pinkB = new THREE.Color(0xffd0ec), lilac = new THREE.Color(0xb78cff);
  const masses: THREE.BufferGeometry[] = [];
  // each branch tip carries a cluster of small puffs: light on top, deep violet underneath
  const puffs: { p: THREE.Vector3; r: number }[] = [];
  const dark = new THREE.Color(0x6a3f9c);
  for (const tip of tips) {
    const n = 3 + Math.round(tip.r * 3);
    for (let i = 0; i < n; i++) {
      const off = v3(rng.gauss(), rng.gauss() * 0.6 + 0.2, rng.gauss()).multiplyScalar(tip.r * 0.48);
      const r = tip.r * rng.range(0.42, 0.62);
      const p = tip.p.clone().add(off);
      puffs.push({ p, r });
      const g = blob(r, r * 0.86, r, 3, (q) => {
        q.multiplyScalar(1 + 0.16 * fbm3(q.x * 3 + p.x, q.y * 3, q.z * 3 + p.z, 2));
      });
      place(g, p);
      masses.push(tintBy(g, (_q, out, normal) => void out.copy(dark).lerp(pinkA, 0.5 + 0.5 * normal.y).lerp(pinkB, Math.max(0, normal.y) ** 2 * 0.5)));
    }
  }
  const massMesh = new THREE.Mesh(merge(masses), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, emissive: 0xff7ab8, emissiveIntensity: 0.16 }));
  massMesh.castShadow = true;
  group.add(massMesh);

  // ...and thousands of petals sitting on them, each a small curved card
  const card = new THREE.PlaneGeometry(1, 0.66, 2, 1);
  const cp = card.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < cp.count; i++) cp.setZ(i, -0.35 * cp.getX(i) * cp.getX(i));
  const leaf: number[] = [], rot: number[] = [];
  const canopy: THREE.Vector3[] = [];
  for (let i = 0; i < petalCount; i++) {
    const puff = rng.pick(puffs);
    const d = v3(rng.gauss(), rng.gauss() * 0.8 + 0.25, rng.gauss()).normalize();
    const p = puff.p.clone().addScaledVector(d, puff.r * rng.range(0.96, 1.1));
    leaf.push(p.x, p.y, p.z, rng.range(0.06, 0.11));
    rot.push(rng.range(0, TAU), rng.range(-1.1, 1.1), rng.next(), rng.next());
    if (i % 24 === 0 && d.y < 0.2) canopy.push(p);
  }
  const petals = new THREE.InstancedBufferGeometry();
  petals.index = card.index;
  petals.setAttribute('position', card.getAttribute('position'));
  petals.setAttribute('normal', card.getAttribute('normal'));
  petals.setAttribute('uv', card.getAttribute('uv'));
  petals.setAttribute('aLeaf', new THREE.InstancedBufferAttribute(new Float32Array(leaf), 4));
  petals.setAttribute('aLeafRot', new THREE.InstancedBufferAttribute(new Float32Array(rot), 4));
  petals.instanceCount = petalCount;
  petals.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 4, 0), 7);
  const petalMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.7 });
  petalMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, windUniforms, { uPinkA: { value: pinkA }, uPinkB: { value: pinkB }, uLilac: { value: lilac } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${PETAL_VS_PARS}`)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = normalize(aLeaf.xyz - vec3(0.5, 4.0, 0.2)) * 0.75 + vec3(0.0, 0.45, 0.0);')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${PETAL_VS.replace(/objectNormal = [^;]+;/, '')}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLeafTint; varying vec2 vLeafUv;\nuniform vec3 uPinkA, uPinkB, uLilac;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 q = vLeafUv - 0.5;
        if (abs(q.y) * 2.0 > pow(max(1.0 - 4.0 * q.x * q.x, 0.0), 0.6)) discard;     // a pointed petal cut out of the card
        diffuseColor.rgb = mix(mix(uPinkA, uPinkB, vLeafTint), uLilac, smoothstep(0.75, 1.0, vLeafTint) * 0.6) * (0.72 + 0.5 * vLeafUv.x);`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.34;');
  };
  petalMat.customProgramCacheKey = () => 'echo-petals';
  const petalMesh = new THREE.Mesh(petals, petalMat);
  petalMesh.frustumCulled = false;
  group.add(petalMesh);
  return { group, canopy };
};

// ---------------------------------------------------------------------------------------------------- crystals

/** A cluster of faceted prisms that hold their own light, brightest at the root. */
export const buildCrystals = (rng: Rng, count: number, scale: number, color: THREE.ColorRepresentation): THREE.Mesh => {
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.Color(color);
  for (let i = 0; i < count; i++) {
    const h = scale * rng.range(0.45, 1.25) * (i === 0 ? 1.35 : 1), r = h * rng.range(0.13, 0.2);
    const body = new THREE.CylinderGeometry(r * 0.82, r, h * 0.78, 6, 1);
    body.translate(0, h * 0.39, 0);
    const tip = new THREE.ConeGeometry(r * 0.82, h * 0.26, 6, 1);
    tip.translate(0, h * 0.78 + h * 0.13, 0);
    const g = merge([body.toNonIndexed(), tip.toNonIndexed()]);
    g.deleteAttribute('uv');
    const lean = i === 0 ? 0.08 : rng.range(0.2, 0.75), a = rng.range(0, TAU), d = i === 0 ? 0 : scale * rng.range(0.12, 0.42);
    place(g, [Math.cos(a) * d, -0.05 * scale, Math.sin(a) * d], [Math.sin(a) * lean, rng.range(0, 1), -Math.cos(a) * lean]);
    const top = h * 1.04;
    tintBy(g, (p, out) => void out.copy(base).multiplyScalar(lerp(1.5, 0.45, smoothstep(0, top, p.y))));
    fill(g, 'glow', 1);
    parts.push(g);
  }
  const geo = merge(parts);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.1, flatShading: true });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.95;');
  };
  mat.customProgramCacheKey = () => 'echo-crystal';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
};

// ---------------------------------------------------------------------------------------------------- glow flowers

/** Lantern flowers: a thin stem and a bulb of light. One draw call for stems, one for bulbs. */
export const buildGlowFlowers = (spots: readonly { x: number; y: number; z: number; h: number; color: THREE.Color }[]): THREE.Group => {
  const group = new THREE.Group();
  const stems: THREE.BufferGeometry[] = [], bulbs: THREE.BufferGeometry[] = [];
  for (const s of spots) {
    const lean = v3(Math.sin(s.x * 7.1) * 0.08, 0, Math.cos(s.z * 5.3) * 0.08);
    const top = v3(s.x + lean.x * s.h * 2, s.y + s.h, s.z + lean.z * s.h * 2);
    stems.push(tint(sweep([v3(s.x, s.y - 0.03, s.z), v3(s.x + lean.x * s.h, s.y + s.h * 0.55, s.z + lean.z * s.h), top], (t) => 0.011 * (1 - 0.5 * t), { radial: 5, steps: 6 }), 0x2f8a78));
    const b = blob(0.03 * (0.7 + s.h), 0.042 * (0.7 + s.h), 0.03 * (0.7 + s.h), 2, (p) => { if (p.y > 0) p.multiplyScalar(1 - 0.25 * p.y); });
    bulbs.push(tint(place(b, top), s.color));
  }
  if (stems.length === 0) return group;
  group.add(new THREE.Mesh(merge(stems), new THREE.MeshLambertMaterial({ vertexColors: true })));
  const bulbMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  bulbMat.color.setScalar(2.6);   // HDR: the bulbs are light sources for the bloom
  group.add(new THREE.Mesh(merge(bulbs), bulbMat));
  return group;
};
