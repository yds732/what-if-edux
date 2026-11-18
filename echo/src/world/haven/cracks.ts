import * as THREE from 'three';

const NOISE = `
float hcHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hcNoise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hcHash(i), hcHash(i + vec3(1,0,0)), f.x), mix(hcHash(i + vec3(0,1,0)), hcHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hcHash(i + vec3(0,0,1)), hcHash(i + vec3(1,0,1)), f.x), mix(hcHash(i + vec3(0,1,1)), hcHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
`;

export const addGoldCracks = (material: THREE.MeshStandardMaterial, opts: { scale?: number; strength?: number; sidesOnly?: boolean } = {}): void => {
  const scale = opts.scale ?? 0.55, strength = opts.strength ?? 1.6, sides = opts.sidesOnly ? 1 : 0;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCrackGold = { value: new THREE.Color(1.0, 0.72, 0.32) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCrackPos; varying vec3 vCrackNrm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCrackPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vCrackNrm = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vCrackPos; varying vec3 vCrackNrm; uniform vec3 uCrackGold;\n${NOISE}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 p = vCrackPos * ${scale.toFixed(3)};
  float n = hcNoise(p) * 0.65 + hcNoise(p * 2.3 + 11.0) * 0.35;
  float line = 1.0 - smoothstep(0.004, 0.014, abs(n - 0.5));
  float sparse = smoothstep(0.55, 0.72, hcNoise(vCrackPos * 0.09 + 3.0));
  float side = mix(1.0, 1.0 - smoothstep(0.35, 0.6, abs(vCrackNrm.y)), ${sides.toFixed(1)});
  float pulse = 0.85 + 0.15 * hcNoise(vCrackPos * 0.3);
  totalEmissiveRadiance += uCrackGold * line * sparse * side * pulse * ${strength.toFixed(2)};
  diffuseColor.rgb = mix(diffuseColor.rgb, uCrackGold * 0.5, line * sparse * side * 0.35);
}`);
  };
  material.customProgramCacheKey = () => `gold-cracks-${scale}-${strength}-${sides}`;
  material.needsUpdate = true;
};
