import * as THREE from 'three';
import { Rng, TAU } from '../../core/math';
import { windUniforms } from './flora';

const REED_VS_PARS = `
attribute vec4 aReed;   // x, z, yaw (direction it leans), height
attribute vec4 aLean;   // lean, sway phase, ground height, tint
uniform float uTime, uWind;
varying float vV, vTint;
`;
const REED_VS = `
{
  float v = position.y, h = aReed.w;
  vV = v; vTint = aLean.w;
  vec3 p = vec3(position.x, v * h, 0.0);
  // a stalk leans out from its clump, curving more toward the tip; the wind rocks the whole clump together
  float gust = sin(uTime * 0.9 + aReed.x * 0.3 + aReed.y * 0.25) * 0.6 + sin(uTime * 2.1 + aLean.y * 6.0) * 0.25;
  float bend = (aLean.x + 0.07 * gust * uWind) * v * v * h;
  p.z += bend;
  p.y -= bend * bend * 0.35;
  float c = cos(aReed.z), s = sin(aReed.z);
  transformed = vec3(p.x * c + p.z * s, p.y + aLean.z, -p.x * s + p.z * c);
  transformed.xz += aReed.xy;
}
`;
const REED_FS = `
{
  // dark and green at the water-soaked root, straw toward the top, a pale warm plume at the tip
  vec3 root = vec3(0.13, 0.25, 0.2), straw = vec3(0.62, 0.55, 0.32), plume = vec3(0.95, 0.82, 0.6);
  vec3 col = mix(root, straw, smoothstep(0.05, 0.75, vV));
  col = mix(col, plume, smoothstep(0.8, 0.88, vV));
  diffuseColor.rgb = col * (0.85 + 0.3 * vTint);
}
`;

export interface ReedClump {
  readonly x: number;
  readonly z: number;
  readonly ground: number;
  readonly size: number;
}

export const buildReeds = (rng: Rng, clumps: readonly ReedClump[]): THREE.Mesh => {
  const profile: [number, number][] = [[0, 1], [0.3, 0.8], [0.6, 0.6], [0.8, 0.5], [0.84, 1.9], [0.92, 1.6], [1, 0]];
  const w = 0.016;
  const verts: number[] = [], idx: number[] = [], nor: number[] = [];
  profile.forEach(([v, k], i) => {
    verts.push(-w * k, v, 0, w * k, v, 0);
    nor.push(0, 0.3, 1, 0, 0.3, 1);
    if (i < profile.length - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3);
  });
  const stalk = new THREE.BufferGeometry();
  stalk.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  stalk.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  stalk.setIndex(idx);

  const reed: number[] = [], lean: number[] = [];
  for (const c of clumps) {
    const count = Math.round(rng.range(24, 42) * c.size);
    for (let i = 0; i < count; i++) {
      const r = 0.22 * c.size * Math.sqrt(rng.next()), a = rng.range(0, TAU);
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      const outward = Math.atan2(Math.cos(a), Math.sin(a)) + rng.range(-0.5, 0.5);
      const tall = (1.15 + 0.95 * rng.next() ** 0.8) * c.size * (1 - 0.35 * (r / (0.22 * c.size + 1e-3)));
      reed.push(x, z, outward, tall);
      lean.push(rng.range(0.06, 0.26) * (0.6 + r * 3), rng.next(), c.ground - 0.05, rng.next());
    }
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = stalk.index;
  geo.setAttribute('position', stalk.getAttribute('position'));
  geo.setAttribute('normal', stalk.getAttribute('normal'));
  geo.setAttribute('aReed', new THREE.InstancedBufferAttribute(new Float32Array(reed), 4));
  geo.setAttribute('aLean', new THREE.InstancedBufferAttribute(new Float32Array(lean), 4));
  geo.instanceCount = reed.length / 4;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);

  const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, windUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${REED_VS_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${REED_VS}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vV, vTint;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n${REED_FS}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * smoothstep(0.78, 0.9, vV) * 0.18;');
  };
  mat.customProgramCacheKey = () => 'echo-reeds';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
};
