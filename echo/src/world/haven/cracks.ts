import * as THREE from 'three';

export interface Crack {
  readonly angle: number;
  readonly offset: number;
  readonly wave: number;
  readonly freq: number;
  readonly phase: number;
}

export const randomCracks = (seed: number, count: number, reach: number): Crack[] =>
  Array.from({ length: count }, (_, i) => {
    const s = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
    const r = s - Math.floor(s);
    return { angle: r * Math.PI + i * 1.9, offset: (r - 0.5) * reach * 0.4, wave: reach * (0.08 + 0.06 * r), freq: (1.6 + r) / reach, phase: r * 6.28 };
  });

export const addRockCracks = (material: THREE.Material, cracks: readonly Crack[], opts: { width: number; sidesOnly?: boolean; strength?: number }): void => {
  const n = Math.max(1, cracks.length);
  const data = cracks.flatMap((c) => [new THREE.Vector4(Math.cos(c.angle), Math.sin(c.angle), c.offset, c.wave), new THREE.Vector4(c.freq, c.phase, 0, 0)]);
  while (data.length < 4) data.push(new THREE.Vector4(1, 0, 1e6, 0), new THREE.Vector4(0, 0, 0, 0));
  const before = material.onBeforeCompile.bind(material);
  const key = material.customProgramCacheKey.bind(material);
  const width = opts.width, sides = opts.sidesOnly ? 1 : 0, strength = opts.strength ?? 1;
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    shader.uniforms.uCracks = { value: data.slice(0, 4) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRkPos; varying vec3 vRkNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRkPos = position; vRkNrm = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRkPos; varying vec3 vRkNrm; uniform vec4 uCracks[4];')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float core = 0.0, halo = 0.0;
  for (int i = 0; i < ${Math.min(2, n)}; i++) {
    vec4 a = uCracks[i * 2], b = uCracks[i * 2 + 1];
    vec2 dir = a.xy;
    float along = dot(vRkPos.xz, vec2(-dir.y, dir.x));
    float d = abs(dot(vRkPos.xz, dir) - a.z + a.w * sin(vRkPos.y * b.x * 2.0 + along * b.x + b.y));
    float w = ${width.toFixed(4)} * (0.75 + 0.5 * sin(vRkPos.y * b.x * 3.0 + b.y * 2.0));
    core = max(core, 1.0 - smoothstep(w * 0.15, w * 0.45, d));
    halo = max(halo, 1.0 - smoothstep(w * 0.3, w * 2.2, d));
  }
  float side = mix(1.0, 1.0 - smoothstep(0.55, 0.8, vRkNrm.y), ${sides.toFixed(1)});
  core *= side; halo *= side;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.55, halo * (1.0 - core));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.8, 0.45), core);
  totalEmissiveRadiance += (vec3(1.0, 0.84, 0.52) * core * 2.8 + vec3(1.0, 0.62, 0.22) * halo * halo * 1.2) * ${strength.toFixed(2)};
}`);
  };
  material.customProgramCacheKey = () => `${key()}|rock-cracks-${n}-${width}-${sides}-${strength}`;
  material.needsUpdate = true;
};
