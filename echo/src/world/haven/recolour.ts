import * as THREE from 'three';
import type { BuildContext } from '../World';

type Shift = readonly [hue: number, minSaturation: number, value: number];

interface Recolour {
  readonly pink?: Shift;
  readonly all?: boolean;
  readonly keepBlossom?: boolean;
  readonly green?: Shift;
  readonly gold?: { readonly keepAbove?: number };
  readonly pinkBlossom?: boolean;
}

const COBALT: Shift = [0.615, 0.72, 0.78];
const DEEP_COBALT: Shift = [0.63, 0.6, 0.62];
const REGAL: Shift = [0.74, 0.55, 0.55];
const MEADOW_GOLD: Shift = [0.14, 0.55, 1.45];
const CRYSTAL_BLUE: Shift = [0.55, 0.6, 0.8];

const RECOLOURS: Record<string, Recolour> = {
  'stepping-stone': { pink: COBALT, all: true, gold: {} },
  dais: { pink: COBALT, all: true, gold: {} },
  'island-a': { pink: DEEP_COBALT, keepBlossom: true, pinkBlossom: true, green: MEADOW_GOLD, gold: {} },
  'island-b': { pink: DEEP_COBALT, keepBlossom: true, pinkBlossom: true, green: MEADOW_GOLD, gold: {} },
  'crystals-a': { pink: CRYSTAL_BLUE, green: CRYSTAL_BLUE, gold: {} },
  'crystals-b': { pink: DEEP_COBALT, gold: {} },
  'board-frame': { pink: COBALT, gold: {} },
  'lamp-post': { pink: COBALT, gold: { keepAbove: 0.88 } },
  gateway: { pink: REGAL, gold: {} },
  ring: { pink: COBALT, gold: {} },
};

const EDGE_LIGHT = new THREE.Color(1.0, 0.78, 0.34);

const GLSL = `
uniform vec3 uHvPink, uHvGreen, uHvEdge; uniform float uHvPinkOn, uHvAll, uHvKeepBlossom, uHvBlossomGold, uHvGreenOn, uHvGoldOn, uHvGoldKeep;
vec3 hvHsv(vec3 c){
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hvRgb(vec3 c){
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
vec3 hvShift(vec3 hsv, vec3 to){ return hvRgb(vec3(to.x, mix(to.y, 1.0, hsv.y), hsv.z * to.z)); }
`;

const PAINT = `
float hvLine = 0.0;
{
  // judged in display space, where the painted hues were chosen
  vec3 lin = diffuseColor.rgb, s = pow(max(lin, 0.0), vec3(1.0 / 2.2)), hsv = hvHsv(s);
  float sat = smoothstep(0.06, 0.16, hsv.y);
  float dPink = abs(fract(hsv.x - 0.86 + 0.5) - 0.5);                           // magenta, centred: violet .. rose
  float gold = (1.0 - smoothstep(0.05, 0.08, abs(hsv.x - 0.115))) * smoothstep(0.18, 0.34, hsv.y) * uHvGoldOn;
  gold *= 1.0 - smoothstep(uHvGoldKeep, uHvGoldKeep + 0.06, hsv.z);
  float pink = max((1.0 - smoothstep(0.14, 0.2, dPink)) * sat, uHvAll * (1.0 - gold)) * uHvPinkOn;
  float blossom = uHvKeepBlossom * smoothstep(0.7, 0.8, hsv.z) * (1.0 - smoothstep(0.08, 0.1, abs(fract(hsv.x - 0.95 + 0.5) - 0.5)));
  pink *= 1.0 - blossom;
  float green = (1.0 - smoothstep(0.1, 0.14, abs(hsv.x - 0.27))) * sat * uHvGreenOn;
  vec3 o = s;
  o = mix(o, hvShift(hsv, uHvPink), pink);
  o = mix(o, hvShift(hsv, uHvGreen), green * (1.0 - pink));
  o = mix(o, hvShift(hsv, vec3(0.12, 0.72, 1.05)), blossom * sat * uHvBlossomGold);
  // gold: a pale, faintly blue alloy, brighter where it catches the light; its brightest edges carry a line of light
  float luma = dot(s, vec3(0.299, 0.587, 0.114));
  vec3 alloy = vec3(luma) * vec3(1.18, 0.95, 0.52) * 1.15;
  o = mix(o, alloy, gold);
  hvLine = gold * smoothstep(0.42, 0.72, luma);
  diffuseColor.rgb = pow(o, vec3(2.2));
}
`;

const patched = new WeakSet<THREE.Material>();

const patch = (material: THREE.MeshStandardMaterial, r: Recolour): void => {
  if (patched.has(material)) return;
  patched.add(material);
  const uniforms = {
    uHvPink: { value: new THREE.Vector3(...(r.pink ?? [0, 1, 1])) }, uHvPinkOn: { value: r.pink ? 1 : 0 }, uHvAll: { value: r.all ? 1 : 0 }, uHvKeepBlossom: { value: r.keepBlossom ? 1 : 0 }, uHvBlossomGold: { value: r.pinkBlossom ? 0 : 1 },
    uHvGreen: { value: new THREE.Vector3(...(r.green ?? [0, 1, 1])) }, uHvGreenOn: { value: r.green ? 1 : 0 },
    uHvGoldOn: { value: r.gold ? 1 : 0 }, uHvGoldKeep: { value: r.gold?.keepAbove ?? 2 }, uHvEdge: { value: EDGE_LIGHT },
  };
  const before = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${PAINT}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uHvEdge * hvLine * 1.3;');
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|haven-recolour`;
  material.needsUpdate = true;
};

export const recolourMaterial = (material: THREE.MeshStandardMaterial, id: string): void => {
  const r = RECOLOURS[id];
  if (r) patch(material, r);
};

export const recolourHavenProps = async (ctx: BuildContext): Promise<void> => {
  await Promise.all(Object.entries(RECOLOURS).map(async ([id, r]) => {
    const { scene } = await ctx.assets.model(id);
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m instanceof THREE.MeshStandardMaterial) patch(m, r);
    });
  }));
};
