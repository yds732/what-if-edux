import * as THREE from 'three';

export interface Glow {
  readonly color?: string;
  readonly strength: number;
  readonly from?: number;
  readonly vivid?: number;
}

export const addGlow = (material: THREE.MeshStandardMaterial, glow: Glow): { value: number } => {
  const uniforms = { uGlowColor: { value: new THREE.Color(glow.color ?? 0xffffff) }, uGlow: { value: glow.strength }, uGlowAnyHue: { value: glow.color ? 0 : 1 }, uGlowFrom: { value: glow.from ?? 0.6 }, uGlowVivid: { value: glow.vivid ?? 0.3 } };
  material.userData.glow = uniforms.uGlow;
  const before = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uGlowColor; uniform float uGlow, uGlowAnyHue, uGlowFrom, uGlowVivid;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 paint = diffuseColor.rgb;
  float hi = max(paint.r, max(paint.g, paint.b)), lo = min(paint.r, min(paint.g, paint.b));
  vec3 lean = normalize(paint - vec3(lo) + 1e-4), want = normalize(uGlowColor - vec3(min(uGlowColor.r, min(uGlowColor.g, uGlowColor.b))) + 1e-4);
  float hue = max(uGlowAnyHue, smoothstep(0.86, 0.97, dot(lean, want)));
  totalEmissiveRadiance += paint * (smoothstep(uGlowVivid, uGlowVivid + 0.2, hi - lo) * smoothstep(uGlowFrom, uGlowFrom + 0.25, hi) * hue * uGlow);
}`);
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|echo-glow`;
  material.needsUpdate = true;
  return uniforms.uGlow;
};
