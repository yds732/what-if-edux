import * as THREE from 'three';
import type { BuildContext } from '../World';

/**
 * Haven's generated props were painted rose, lavender and antique gold. Regenerating them needs API keys, so
 * Haven repaints them as they are drawn instead: each prop's colours are sorted by hue into pinks and violets,
 * yellow-greens and golds, and each family is moved to where Haven's palette wants it. The textures on disk are
 * untouched, and so is every prop of the real world.
 */

/**
 * A hue to move a family of colours to (0–1 around the wheel); the least saturation it may have, so a greyish
 * pink still lands as a real blue; and how much to scale its value.
 */
type Shift = readonly [hue: number, minSaturation: number, value: number];

interface Recolour {
  /** Pinks, magentas and violets go here. */
  readonly pink?: Shift;
  /** With `pink`: every colour that is not gold goes there, so a pink marble becomes a cobalt one, veins and all. */
  readonly all?: boolean;
  /** With `pink`: leave light pastel pinks alone (the blossom trees on the islands). */
  readonly keepBlossom?: boolean;
  /** Yellow-greens (moss, leaves) go here. */
  readonly green?: Shift;
  /**
   * Antique gold becomes a pale, cool alloy edged with light, so the ornament reads as engineered rather than
   * regal. Gold brighter than `keepAbove` (a lamp's flame) stays as it is.
   */
  readonly gold?: { readonly keepAbove?: number };
}

const COBALT: Shift = [0.615, 0.72, 0.78];
const DEEP_COBALT: Shift = [0.63, 0.6, 0.62];
const EMERALD: Shift = [0.42, 0.78, 0.72];
const REGAL: Shift = [0.74, 0.55, 0.55];

const RECOLOURS: Record<string, Recolour> = {
  // the stepping stones and the dais: deep cobalt stone, the inlaid star and veins in the light alloy
  'stepping-stone': { pink: COBALT, all: true, gold: {} },
  dais: { pink: COBALT, all: true, gold: {} },
  // the floating islands: cobalt-slate rock under deep emerald moss
  'island-a': { pink: DEEP_COBALT, keepBlossom: true, green: EMERALD, gold: {} },
  'island-b': { pink: DEEP_COBALT, keepBlossom: true, green: EMERALD, gold: {} },
  // the lavender and pink crystals turn emerald; the cyan ones keep their colour on a cobalt base
  'crystals-a': { pink: EMERALD, green: EMERALD, gold: {} },
  'crystals-b': { pink: DEEP_COBALT, gold: {} },
  // ornament: no more antique gold or rose
  'board-frame': { pink: COBALT, gold: {} },
  'lamp-post': { pink: COBALT, gold: { keepAbove: 0.88 } },
  gateway: { pink: REGAL, gold: {} },
  ring: { pink: COBALT, gold: {} },
};

/** The light along the edges of the alloy: a cool cyan. */
const EDGE_LIGHT = new THREE.Color(0.25, 0.85, 1.0);

const GLSL = /* glsl */ `
uniform vec3 uHvPink, uHvGreen, uHvEdge; uniform float uHvPinkOn, uHvAll, uHvKeepBlossom, uHvGreenOn, uHvGoldOn, uHvGoldKeep;
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

const PAINT = /* glsl */ `
float hvLine = 0.0;
{
  // judged in display space, where the painted hues were chosen
  vec3 lin = diffuseColor.rgb, s = pow(max(lin, 0.0), vec3(1.0 / 2.2)), hsv = hvHsv(s);
  float sat = smoothstep(0.06, 0.16, hsv.y);
  float dPink = abs(fract(hsv.x - 0.86 + 0.5) - 0.5);                           // magenta, centred: violet .. rose
  float gold = (1.0 - smoothstep(0.05, 0.08, abs(hsv.x - 0.115))) * smoothstep(0.18, 0.34, hsv.y) * uHvGoldOn;
  gold *= 1.0 - smoothstep(uHvGoldKeep, uHvGoldKeep + 0.06, hsv.z);
  float pink = max((1.0 - smoothstep(0.14, 0.2, dPink)) * sat, uHvAll * (1.0 - gold)) * uHvPinkOn;
  pink *= 1.0 - uHvKeepBlossom * smoothstep(0.7, 0.8, hsv.z) * (1.0 - smoothstep(0.08, 0.1, abs(fract(hsv.x - 0.95 + 0.5) - 0.5)));
  float green = (1.0 - smoothstep(0.1, 0.14, abs(hsv.x - 0.27))) * sat * uHvGreenOn;
  vec3 o = s;
  o = mix(o, hvShift(hsv, uHvPink), pink);
  o = mix(o, hvShift(hsv, uHvGreen), green * (1.0 - pink));
  // gold: a pale, faintly blue alloy, brighter where it catches the light; its brightest edges carry a line of light
  float luma = dot(s, vec3(0.299, 0.587, 0.114));
  vec3 alloy = vec3(luma) * vec3(0.86, 0.95, 1.08) * 1.12;
  o = mix(o, alloy, gold);
  hvLine = gold * smoothstep(0.42, 0.72, luma);
  diffuseColor.rgb = pow(o, vec3(2.2));
}
`;

/** Materials already repainted. Not a userData flag: a cloned material copies userData but not the shader hook. */
const patched = new WeakSet<THREE.Material>();

const patch = (material: THREE.MeshStandardMaterial, r: Recolour): void => {
  if (patched.has(material)) return;
  patched.add(material);
  const uniforms = {
    uHvPink: { value: new THREE.Vector3(...(r.pink ?? [0, 1, 1])) }, uHvPinkOn: { value: r.pink ? 1 : 0 }, uHvAll: { value: r.all ? 1 : 0 }, uHvKeepBlossom: { value: r.keepBlossom ? 1 : 0 },
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

/** Repaints one material of a prop: for a copy that has been given a material of its own, like each bridge ring. */
export const recolourMaterial = (material: THREE.MeshStandardMaterial, id: string): void => {
  const r = RECOLOURS[id];
  if (r) patch(material, r);
};

/**
 * Repaints Haven's props. Copies of a prop share its materials, so this runs once, before any copy is drawn,
 * and every copy (and the title screen, which is Haven too) shows the new colours.
 */
export const recolourHavenProps = async (ctx: BuildContext): Promise<void> => {
  await Promise.all(Object.entries(RECOLOURS).map(async ([id, r]) => {
    const { scene } = await ctx.assets.model(id);
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m instanceof THREE.MeshStandardMaterial) patch(m, r);
    });
  }));
};
