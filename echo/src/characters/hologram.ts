import * as THREE from 'three';

export interface Hologram {
  readonly amount: { value: number };
  readonly color: THREE.Color;
  readonly time: { value: number };
}

export const addHologram = (material: THREE.MeshStandardMaterial): Hologram => {
  const uniforms = { uHolo: { value: 0 }, uHoloColor: { value: new THREE.Color() }, uHoloTime: { value: 0 } };
  const before = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vHoloY;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvHoloY = (modelMatrix * vec4(transformed, 1.0)).y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uHolo, uHoloTime; uniform vec3 uHoloColor; varying float vHoloY;')
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
if (uHolo > 0.0) {
  // A travelling band modulates the projection's light across a continuous surface.
  float band = abs(fract(vHoloY * 9.0 - uHoloTime * 0.35) - 0.5);
  float scan = 0.5 + 0.5 * sin(vHoloY * 420.0 - uHoloTime * 9.0);
  float edge = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.0);
  float flicker = 0.93 + 0.07 * sin(uHoloTime * 37.0) * sin(uHoloTime * 11.3);
  float tone = dot(gl_FragColor.rgb, vec3(0.3, 0.5, 0.2));
  vec3 light = uHoloColor * (0.22 + 0.9 * tone + 0.3 * scan + 1.9 * edge) * flicker * mix(0.80, 1.0, smoothstep(0.0, 0.07, band));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, light, uHolo);
}`);
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|echo-hologram`;
  material.needsUpdate = true;
  return { amount: uniforms.uHolo, color: uniforms.uHoloColor.value, time: uniforms.uHoloTime };
};
