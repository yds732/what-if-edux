import * as THREE from 'three';
import { blob, curve1, merge, place, sweep, tint, tintBy, v3 } from '../../core/geo';
import { Rng, TAU, fbm3, lerp, smoothstep } from '../../core/math';

export const windUniforms = { uTime: { value: 0 }, uWind: { value: 1 } };

const BLADE_VS_PARS = `
attribute vec4 aBlade;   // x, z, yaw, height
attribute vec3 aTint;
attribute float aGround;
uniform float uTime, uWind;
varying float vBladeV;
varying vec3 vTint;
`;
const BLADE_VS = `
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

export const buildGrass = (count: number, radius: number, rng: Rng, ground: (x: number, z: number) => { y: number; scale: number } | null): THREE.Mesh => {
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
  const a = new THREE.Color(0x3f4fa8), b = new THREE.Color(0x9aa8f4), glow = new THREE.Color(0xffd98a), c = new THREE.Color();
  let placed = 0;
  for (let i = 0; i < count * 14 && placed < count; i++) {
    const r = radius * Math.sqrt(rng.next()), ang = rng.range(0, TAU);
    const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
    const g = ground(x, z);
    if (!g) continue;
    const patch = fbm3(x * 0.22, z * 0.22, 3.3, 3) * 0.5 + 0.5;
    const tuft = fbm3(x * 1.6, z * 1.6, 7.1, 2) * 0.5 + 0.5;
    const want = Math.min(1, smoothstep(0.38, 0.46, patch) * (0.45 + 0.8 * smoothstep(0.35, 0.6, tuft)) + 0.025);
    if (rng.next() > want) continue;
    const lush = smoothstep(0.5, 0.66, patch);
    const h = (0.16 + 0.34 * rng.next() ** 1.6) * (0.6 + 0.6 * patch + 1.5 * lush * tuft) * g.scale;
    data.push(x, z, rng.range(0, TAU), h);
    heights.push(g.y);
    c.copy(a).lerp(b, patch * 0.8 + rng.range(0, 0.2)).lerp(glow, rng.chance(0.1) ? 0.55 : 0);
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
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vTint * (0.62 + 0.55 * vBladeV);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vTint * vBladeV * vBladeV * 0.22;');
  };
  mat.customProgramCacheKey = () => 'echo-grass';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
};

export interface Tree {
  readonly group: THREE.Group;
  readonly canopy: THREE.Vector3[];
}

const PETAL_VS_PARS = `
attribute vec4 aLeaf;   // local offset xyz, size
attribute vec4 aLeafRot; // axis-angle packed: yaw, tilt, phase, tint
uniform float uTime, uWind;
varying float vLeafTint, vLeafPhase; varying vec2 vLeafUv;
`;
const PETAL_VS = `
{
  float yaw = aLeafRot.x, tilt = aLeafRot.y + 0.25 * sin(uTime * 1.7 + aLeafRot.z * 6.28) * uWind;
  vec3 p = position * aLeaf.w;
  float ct = cos(tilt), st = sin(tilt), cy = cos(yaw), sy = sin(yaw);
  p = vec3(p.x, p.y * ct - p.z * st, p.y * st + p.z * ct);
  p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
  vec3 sway = vec3(sin(uTime * 0.9 + aLeaf.y * 0.7), 0.0, cos(uTime * 0.7 + aLeaf.x * 0.6)) * 0.035 * uWind;
  transformed = p + aLeaf.xyz + sway;
  objectNormal = normalize(aLeaf.xyz - vec3(0.0, 4.2, 0.0)) * 0.7 + vec3(0.0, 0.5, 0.0);   // shade the canopy as one soft mass
  vLeafTint = aLeafRot.w; vLeafPhase = aLeafRot.z; vLeafUv = uv;
}
`;

export const buildBlossomTree = (rng: Rng, petalCount: number): Tree => {
  const group = new THREE.Group();
  const bark: THREE.BufferGeometry[] = [];
  const tips: { p: THREE.Vector3; r: number }[] = [];
  const barkA = new THREE.Color(0x1e1a2a), barkB = new THREE.Color(0x3e3450);

  const branch = (from: THREE.Vector3, dir: THREE.Vector3, length: number, radius: number, depth: number): void => {
    const bend = v3(rng.range(-0.8, 0.8), rng.range(-0.1, 0.5), rng.range(-0.8, 0.8));
    const mid = from.clone().addScaledVector(dir, length * 0.5).addScaledVector(bend, length * 0.18);
    const end = from.clone().addScaledVector(dir.clone().add(bend.multiplyScalar(0.35)).normalize(), length);
    const g = sweep([from, mid, end], (t) => radius * lerp(1, 0.58, t), { radial: depth === 0 ? 12 : 7, steps: 10, startCap: 'round', endCap: 'round' });
    bark.push(tintBy(g, (p, out) => void out.copy(barkA).lerp(barkB, 0.5 + 0.5 * fbm3(p.x * 3, p.y * 1.2, p.z * 3, 2))));
    if (depth >= 4) {
      tips.push({ p: end, r: 0.55 + rng.range(0, 0.35) });
      return;
    }
    const kids = depth === 0 ? 4 : rng.int(2, 3);
    for (let i = 0; i < kids; i++) {
      const spread = depth === 0 ? 0.85 : 0.7;
      const d = dir.clone().add(v3(rng.range(-1, 1) * spread, depth >= 2 ? rng.range(-0.25, 0.3) : rng.range(0.05, 0.45), rng.range(-1, 1) * spread)).normalize();
      branch(from.clone().lerp(end, rng.range(0.72, 1)), d, length * rng.range(0.6, 0.78), radius * 0.58, depth + 1);
    }
    if (depth >= 2) tips.push({ p: end, r: 0.5 + rng.range(0, 0.3) });
  };
  const trunkTop = v3(0.5, 2.5, 0.25);
  bark.push(tintBy(sweep([v3(-0.15, -0.3, 0), v3(0.05, 0.9, 0.05), trunkTop], curve1([[0, 0.58], [0.16, 0.36], [1, 0.25]]), { radial: 14, steps: 14, startCap: 'flat', endCap: 'round' }),
    (p, out) => void out.copy(barkA).lerp(barkB, 0.5 + 0.5 * fbm3(p.x * 3, p.y * 1.2, p.z * 3, 2))));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + rng.range(-0.3, 0.3);
    bark.push(tint(sweep([v3(-0.1, 0.35, 0), v3(Math.cos(a) * 0.5, 0.05, Math.sin(a) * 0.5), v3(Math.cos(a) * 1.1, -0.22, Math.sin(a) * 1.1)], (t) => 0.16 * (1 - t * 0.75), { radial: 7, steps: 8 }), barkA));
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + rng.range(-0.4, 0.4);
    branch(trunkTop.clone().add(v3(0, -0.25 * i * 0.3, 0)), v3(Math.cos(a) * 0.95, rng.range(0.3, 0.65), Math.sin(a) * 0.95).normalize(), rng.range(2.1, 2.8), 0.21, 1);
  }
  branch(trunkTop.clone(), v3(0.06, 1, 0.04).normalize(), 2.5, 0.2, 1);
  const trunk = new THREE.Mesh(merge(bark), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  group.add(trunk);

  const pinkA = new THREE.Color(0xffcf5a), pinkB = new THREE.Color(0xfff1c4), lilac = new THREE.Color(0xd8952e);
  const rose = new THREE.Color(0xf6b23c);
  const masses: THREE.BufferGeometry[] = [];
  const puffs: { p: THREE.Vector3; r: number }[] = [];
  const dark = new THREE.Color(0xa86f22);
  for (const tip of tips) {
    const n = 3 + Math.round(tip.r * 3);
    for (let i = 0; i < n; i++) {
      const off = v3(rng.gauss(), rng.gauss() * 0.45 + 0.1, rng.gauss()).multiplyScalar(tip.r * 0.6);
      const r = tip.r * rng.range(0.42, 0.62);
      const p = tip.p.clone().add(off);
      puffs.push({ p, r });
      const core = r * 0.42;
      const g = blob(core, core * 0.8, core, 3, (q) => {
        q.multiplyScalar(1 + 0.16 * fbm3(q.x * 3 + p.x, q.y * 3, q.z * 3 + p.z, 2));
      });
      place(g, p);
      masses.push(tintBy(g, (_q, out, normal) => void out.copy(dark).lerp(pinkA, 0.35 + 0.35 * normal.y)));
    }
  }
  const massMesh = new THREE.Mesh(merge(masses), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, emissive: 0xffc870, emissiveIntensity: 0.1 }));
  massMesh.castShadow = true;
  group.add(massMesh);

  const card = new THREE.PlaneGeometry(1, 0.86, 2, 1);
  const cp = card.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < cp.count; i++) cp.setZ(i, -0.35 * cp.getX(i) * cp.getX(i));
  const leaf: number[] = [], rot: number[] = [];
  const canopy: THREE.Vector3[] = [];
  for (let i = 0; i < petalCount; i++) {
    const puff = rng.pick(puffs);
    const d = v3(rng.gauss(), rng.gauss() * 0.8 + 0.25, rng.gauss()).normalize();
    const p = puff.p.clone().addScaledVector(d, puff.r * (rng.next() < 0.75 ? rng.range(0.85, 1.12) : rng.range(0.45, 0.85)));
    leaf.push(p.x, p.y, p.z, rng.range(0.18, 0.36));
    const light = Math.min(1, Math.max(0, 0.3 + 0.42 * d.y + 0.28 * smoothstep(2.2, 6.0, p.y) + rng.range(-0.12, 0.12)));
    rot.push(rng.range(0, TAU), rng.range(-1.1, 1.1), rng.next(), light);
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
  petals.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 4, 0), 9);
  const petalMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.7 });
  petalMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, windUniforms, { uPinkA: { value: pinkA }, uPinkB: { value: pinkB }, uLilac: { value: lilac }, uRose: { value: rose } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${PETAL_VS_PARS}`)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = normalize(aLeaf.xyz - vec3(0.5, 4.0, 0.2)) * 0.75 + vec3(0.0, 0.45, 0.0);')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${PETAL_VS.replace(/objectNormal = [^;]+;/, '')}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLeafTint, vLeafPhase; varying vec2 vLeafUv;\nuniform vec3 uPinkA, uPinkB, uLilac, uRose;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        // a cluster of blossom, not a single petal: a few round lobes around a centre, like a painted dab
        vec2 q = (vLeafUv - 0.5) * vec2(1.0, 1.16);
        float m = 1.0 - length(q) / 0.27, turn = vLeafPhase * 6.2832;
        for (int k = 0; k < 5; k++) {
          float a = turn + float(k) * 1.2566;
          vec2 c = vec2(cos(a), sin(a)) * (0.19 + 0.05 * sin(vLeafPhase * 31.0 + float(k)));
          m = max(m, 1.0 - length(q - c) / (0.15 + 0.04 * fract(vLeafPhase * 7.3 + float(k) * 0.37)));
        }
        if (m <= 0.0) discard;
        // lavender in the shade, soft pink in between, warm cream where the light lands
        vec3 col = mix(uLilac, uPinkA, smoothstep(0.05, 0.55, vLeafTint));
        col = mix(col, uPinkB, smoothstep(0.5, 0.95, vLeafTint));
        // about one cluster in five is magenta-rose
        col = mix(col, uRose, step(0.8, fract(vLeafPhase * 13.7)) * 0.85);
        diffuseColor.rgb = col * (0.9 + 0.18 * vLeafPhase) * (0.86 + 0.14 * smoothstep(0.0, 0.5, m));`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * (0.12 + 0.2 * vLeafTint);');
  };
  petalMat.customProgramCacheKey = () => 'echo-petals';
  const petalMesh = new THREE.Mesh(petals, petalMat);
  petalMesh.frustumCulled = false;
  group.add(petalMesh);
  return { group, canopy };
};

export const buildGlowFlowers = (spots: readonly { x: number; y: number; z: number; h: number; color: THREE.Color }[]): THREE.Group => {
  const group = new THREE.Group();
  const stems: THREE.BufferGeometry[] = [], bulbs: THREE.BufferGeometry[] = [];
  for (const s of spots) {
    const lean = v3(Math.sin(s.x * 7.1) * 0.08, 0, Math.cos(s.z * 5.3) * 0.08);
    const top = v3(s.x + lean.x * s.h * 2, s.y + s.h, s.z + lean.z * s.h * 2);
    stems.push(tint(sweep([v3(s.x, s.y - 0.03, s.z), v3(s.x + lean.x * s.h, s.y + s.h * 0.55, s.z + lean.z * s.h), top], (t) => 0.011 * (1 - 0.5 * t), { radial: 5, steps: 6 }), 0x3f4fa8));
    const b = blob(0.03 * (0.7 + s.h), 0.042 * (0.7 + s.h), 0.03 * (0.7 + s.h), 2, (p) => { if (p.y > 0) p.multiplyScalar(1 - 0.25 * p.y); });
    bulbs.push(tint(place(b, top), s.color));
  }
  if (stems.length === 0) return group;
  group.add(new THREE.Mesh(merge(stems), new THREE.MeshLambertMaterial({ vertexColors: true })));
  const bulbMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  bulbMat.color.setScalar(2.6);
  group.add(new THREE.Mesh(merge(bulbs), bulbMat));
  return group;
};
