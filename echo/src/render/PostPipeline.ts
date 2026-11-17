import * as THREE from 'three';
import type { QualitySettings } from '../app/quality';
import { FULLSCREEN_VS, GLSL_NOISE } from './glsl';

/** Per-world grade. Worlds own one; transitions lerp between two. */
export interface Look {
  exposure: number;
  /** Lerp toward the bloom pyramid: 0.04 is a clean lens, 0.2 is a dream. */
  bloom: number;
  /** Ambient occlusion strength, 0..1. */
  ao: number;
  /** 1 is neutral. */
  saturation: number;
  /** S-curve mix, 0 is neutral. */
  contrast: number;
  /** Small offsets added to the dark and the bright end after tone mapping. */
  shadowTint: THREE.Color;
  highlightTint: THREE.Color;
  vignette: number;
  grain: number;
  /** Chromatic aberration at the frame corners. */
  chroma: number;
  /** Light shafts: how strongly the bright sky streams past whatever stands in front of it. 0 is none. */
  shafts: number;
  shaftColor: THREE.Color;
  /** Depth of field: how soft the distance goes behind what the lens is focused on. 0 keeps everything sharp. */
  dof: number;
  /** Anamorphic streaks: how far the brightest lights smear sideways across the lens. */
  streak: number;
}

export const makeLook = (o: Partial<Look> = {}): Look => ({
  exposure: 1,
  bloom: 0.08,
  ao: 0.8,
  saturation: 1.1,
  contrast: 0.2,
  shadowTint: new THREE.Color(0, 0, 0),
  highlightTint: new THREE.Color(0, 0, 0),
  vignette: 0.3,
  grain: 0.012,
  chroma: 0.004,
  shafts: 0,
  shaftColor: new THREE.Color(1, 0.9, 0.75),
  dof: 0,
  streak: 0,
  ...o,
});

export const lerpLook = (out: Look, a: Look, b: Look, k: number): Look => {
  const m = (x: number, y: number) => x + (y - x) * k;
  out.exposure = m(a.exposure, b.exposure);
  out.bloom = m(a.bloom, b.bloom);
  out.ao = m(a.ao, b.ao);
  out.saturation = m(a.saturation, b.saturation);
  out.contrast = m(a.contrast, b.contrast);
  out.shadowTint.lerpColors(a.shadowTint, b.shadowTint, k);
  out.highlightTint.lerpColors(a.highlightTint, b.highlightTint, k);
  out.vignette = m(a.vignette, b.vignette);
  out.grain = m(a.grain, b.grain);
  out.chroma = m(a.chroma, b.chroma);
  out.shafts = m(a.shafts, b.shafts);
  out.shaftColor.lerpColors(a.shaftColor, b.shaftColor, k);
  out.dof = m(a.dof, b.dof);
  out.streak = m(a.streak, b.streak);
  return out;
};

/**
 * One world dissolving into another: the outgoing world is drawn to its own target and survives only beyond a
 * wavefront `radius` metres from the eye, so near things change first and the horizon last.
 */
export interface WorldWipe {
  scene: THREE.Scene;
  radius: number;
  softness: number;
  /** HDR colour of the lit rim that rides the wavefront. */
  color: THREE.Color;
}

/** How far a full `dim` takes the picture toward the fade colour. */
const DIM_DEPTH = 0.46;

export interface ScreenFx {
  /** 0..1 blend of the whole frame toward `fadeColor`. */
  fade: number;
  fadeColor: THREE.Color;
  /** 0..1: the world steps back behind the interface, for a decision that wants the player's whole attention. */
  dim: number;
  /** Additive burst of the bloom pyramid, for flashes. */
  flash: number;
  /** Radial lens punch, 0 is neutral. */
  kick: number;
  /** How far away the lens is focused, in metres: what lies well beyond it softens by the look's `dof`. */
  focus: number;
}

/** Where a world's light shafts come from. */
export interface ShaftSource {
  /** Unit vector from anywhere in the world toward the light. */
  readonly direction: THREE.Vector3;
  /** Whatever is further from the eye than this many metres is open sky: the light the shafts are made of. */
  readonly skyFrom: number;
}

export interface FrameInput {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  look: Look;
  time: number;
  fx: ScreenFx;
  wipe: WorldWipe | null;
  /** Drawn over the graded frame at native resolution, untouched by bloom or grain. */
  overlay: { scene: THREE.Scene; camera: THREE.Camera } | null;
  /** Extra passes a world needs before its main draw (planar mirror). */
  prepass: ((renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera) => void) | null;
  /** Where the world's light shafts come from, if it has any. */
  shafts: ShaftSource | null;
}

const DEPTH_GLSL = /* glsl */ `
uniform float uNear, uFar; uniform vec2 uInvProj;
float viewZ(float d){ return (uNear * uFar) / ((uFar - uNear) * d - uFar); }
`;

/** `sceneColor(uv)`: the lit HDR frame both the bloom prefilter and the grade read, with AO and any wipe folded in. */
const SCENE_COLOR_GLSL = /* glsl */ `
uniform sampler2D tScene, tAO; uniform float uAO;
vec3 sane(vec3 c){ return min(max(c, vec3(0.0)), vec3(64.0)); }   // max() first: on every GPU we target it drops a NaN, so one bad pixel never reaches the bloom pyramid
vec3 mainColor(vec2 uv){ return sane(texture2D(tScene, uv).rgb) * mix(1.0, texture2D(tAO, uv).r, uAO); }
${DEPTH_GLSL}
#ifdef WIPE
${GLSL_NOISE}
uniform sampler2D tAlt, tAltDepth; uniform float uWave, uWaveSoft, uWaveMax, uTime; uniform vec3 uWaveColor; uniform mat4 uCamWorld;
vec3 sceneColor(vec2 uv){
  float z = -viewZ(texture2D(tAltDepth, uv).x);
  vec3 vp = vec3((uv * 2.0 - 1.0) * uInvProj * z, -z);
  float dist = min(length(vp), uWaveMax);
  vec3 wp = (uCamWorld * vec4(vp, 1.0)).xyz;
  float n = fbm3(wp * 2.2 + vec3(0.0, uTime * 0.35, 0.0)) - 0.5;
  float m = smoothstep(uWave - uWaveSoft, uWave, dist + n * uWaveSoft * 1.6);   // 1: the outgoing world still stands here
  vec3 a = sane(texture2D(tAlt, uv).rgb);
  float rim = 4.0 * m * (1.0 - m);
  float sparks = step(0.82, vnoise3(wp * 14.0 + uTime)) * rim;
  return mix(mainColor(uv), a, m) + uWaveColor * (rim * rim * 1.6 + sparks * 2.5);
}
#else
#define sceneColor mainColor
#endif
`;

const AO_FS = /* glsl */ `
uniform sampler2D tDepth; uniform vec2 uTexel; uniform float uRadius; varying vec2 vUv;
${DEPTH_GLSL}
vec3 viewPos(vec2 uv){ float z = viewZ(textureLod(tDepth, uv, 0.0).x); return vec3((uv * 2.0 - 1.0) * uInvProj * -z, z); }
void main(){
  float d0 = textureLod(tDepth, vUv, 0.0).x;
  if (d0 >= 0.99999) { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); return; }
  vec3 p = viewPos(vUv);
  vec3 px1 = viewPos(vUv + vec2(uTexel.x, 0.0)), px0 = viewPos(vUv - vec2(uTexel.x, 0.0));
  vec3 py1 = viewPos(vUv + vec2(0.0, uTexel.y)), py0 = viewPos(vUv - vec2(0.0, uTexel.y));
  vec3 dx = abs(px1.z - p.z) < abs(p.z - px0.z) ? px1 - p : p - px0;
  vec3 dy = abs(py1.z - p.z) < abs(p.z - py0.z) ? py1 - p : p - py0;
  vec3 n = normalize(cross(dx, dy));
  float rw = clamp(-p.z * 0.07, uRadius * 0.4, uRadius * 6.0);      // world radius grows with distance
  float rs = rw / (-p.z * uInvProj.y) * 0.5;                          // the same radius in uv (vertical)
  float ang = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
  float bias = 0.02 * rw + 0.0015 * -p.z, eps = 0.012 * rw * rw, occ = 0.0;
  for (int i = 0; i < 12; i++) {
    float fi = (float(i) + 0.5) / 12.0, a = ang + fi * 6.2831853 * 3.7, r = rs * sqrt(fi);
    vec2 o = vec2(cos(a), sin(a)) * r * vec2(uInvProj.y / uInvProj.x, 1.0);
    vec3 v = viewPos(vUv + o) - p; float l2 = dot(v, v);
    occ += max(dot(v, n) - bias, 0.0) / (l2 + eps) * smoothstep(rw * rw * 1.8, rw * rw * 0.45, l2);
  }
  float ao = clamp(1.0 - occ * (1.0 / 12.0) * rw * 1.5, 0.0, 1.0);
  gl_FragColor = vec4(ao, 1.0 - d0, 0.0, 1.0);
}`;

/**
 * Light shafts: every pixel looks toward the light and gathers what open sky it can see along the way, so the
 * sky's brightness streams out past the edges of whatever stands in front of it.
 */
const SHAFT_FS = /* glsl */ `
uniform sampler2D tScene, tDepth; uniform vec2 uLight; uniform float uSkyFrom; varying vec2 vUv;
${DEPTH_GLSL}
float sky(vec2 uv){
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  float far = step(uSkyFrom, -viewZ(textureLod(tDepth, uv, 0.0).x));
  vec3 c = min(max(textureLod(tScene, uv, 0.0).rgb, vec3(0.0)), vec3(6.0));
  return far * max(dot(c, vec3(0.3, 0.5, 0.2)) - 0.18, 0.0);
}
void main(){
  const int N = 30;
  vec2 stride = (uLight - vUv) * (0.9 / float(N));
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec2 p = vUv + stride * jitter;
  float sum = 0.0, weight = 1.0;
  for (int i = 0; i < N; i++) { sum += sky(p) * weight; weight *= 0.955; p += stride; }
  gl_FragColor = vec4(vec3(sum / float(N)), 1.0);
}`;

const AO_BLUR_FS = /* glsl */ `
uniform sampler2D tA; uniform vec2 uDir; varying vec2 vUv;
void main(){
  vec2 c = texture2D(tA, vUv).xy; float s = c.x * 0.30, w = 0.30;
  for (int i = 1; i <= 3; i++) { for (int k = -1; k <= 1; k += 2) {
    vec2 q = textureLod(tA, vUv + uDir * float(i * k) * 1.35, 0.0).xy;
    float ww = (i == 1 ? 0.22 : i == 2 ? 0.10 : 0.03) * step(abs(q.y - c.y), 0.05 * c.y + 1e-7);
    s += q.x * ww; w += ww; } }
  gl_FragColor = vec4(s / w, c.y, 0.0, 1.0);
}`;

/** Full resolution to half: four bilinear taps, each weighted against fireflies. */
const DOWN0_FS = /* glsl */ `
uniform vec2 uT; varying vec2 vUv;
${SCENE_COLOR_GLSL}
float kw(vec3 c){ return 1.0 / (1.0 + max(c.r, max(c.g, c.b))); }
void main(){
  vec3 a = sceneColor(vUv + vec2(-1.0, 1.0) * uT), b = sceneColor(vUv + vec2(1.0, 1.0) * uT), c = sceneColor(vUv + vec2(-1.0, -1.0) * uT), d = sceneColor(vUv + vec2(1.0, -1.0) * uT);
  float wa = kw(a), wb = kw(b), wc = kw(c), wd = kw(d);
  gl_FragColor = vec4((a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd), 1.0);
}`;

const DOWN_FS = /* glsl */ `
uniform sampler2D tC; uniform vec2 uT; varying vec2 vUv;
vec3 S(vec2 o){ return texture2D(tC, vUv + o * uT).rgb; }
void main(){
  vec3 a = S(vec2(-2, 2)), b = S(vec2(0, 2)), c = S(vec2(2, 2)), d = S(vec2(-2, 0)), e = S(vec2(0, 0)), f = S(vec2(2, 0)), g = S(vec2(-2, -2)), h = S(vec2(0, -2)), i = S(vec2(2, -2));
  vec3 j = S(vec2(-1, 1)), k = S(vec2(1, 1)), l = S(vec2(-1, -1)), m = S(vec2(1, -1));
  vec3 o = (j + k + l + m) * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + e * 0.125;
  gl_FragColor = vec4(max(o, 0.0), 1.0);
}`;

const UP_FS = /* glsl */ `
uniform sampler2D tC, tB; uniform vec2 uT; uniform float uMix; varying vec2 vUv;
void main(){
  vec3 s = texture2D(tC, vUv + vec2(-1, 1) * uT).rgb + texture2D(tC, vUv + vec2(1, 1) * uT).rgb + texture2D(tC, vUv + vec2(-1, -1) * uT).rgb + texture2D(tC, vUv + vec2(1, -1) * uT).rgb;
  s += 2.0 * (texture2D(tC, vUv + vec2(0, 1) * uT).rgb + texture2D(tC, vUv + vec2(0, -1) * uT).rgb + texture2D(tC, vUv + vec2(1, 0) * uT).rgb + texture2D(tC, vUv + vec2(-1, 0) * uT).rgb);
  s += 4.0 * texture2D(tC, vUv).rgb; s /= 16.0;
  gl_FragColor = vec4(mix(texture2D(tB, vUv).rgb, s, uMix), 1.0);
}`;

const FINAL_FS = /* glsl */ `
#include <tonemapping_pars_fragment>
uniform sampler2D tBloom, tDepth, tSoft, tSofter, tShafts; uniform float uBloom, uSaturation, uContrast, uVignette, uGrain, uChroma, uFade, uFlash, uKick, uClock, uDof, uFocus, uShafts, uStreak; uniform vec3 uShadowTint, uHighlightTint, uFadeColor, uShaftColor;
varying vec2 vUv;
${SCENE_COLOR_GLSL}
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main(){
  vec2 uv = vUv, q = uv - 0.5; float r2 = dot(q, q);
  uv -= q * (r2 * uKick * 0.25);
  vec2 ca = q * r2 * uChroma;
  vec3 c = vec3(sceneColor(uv - ca).r, sceneColor(uv).g, sceneColor(uv + ca).b);
  // depth of field: what lies well behind the point of focus gives way to the softened frame
  if (uDof > 0.0) {
    float z = -viewZ(texture2D(tDepth, uv).x);
    float blur = uDof * clamp((z - uFocus * 1.4) / (uFocus * 2.4 + 2.0), 0.0, 1.0);
    vec3 soft = mix(texture2D(tSoft, uv).rgb, texture2D(tSofter, uv).rgb, clamp(blur * 2.0 - 1.0, 0.0, 1.0));
    // the sharp frame gives way quickly: half of one and half of the other reads as a double image
    c = mix(c, soft, smoothstep(0.0, 0.3, blur));
  }
  vec3 b = texture2D(tBloom, uv).rgb;
  c = mix(c, b, uBloom) + b * uFlash;
  // the brightest lights smear sideways, as through an anamorphic lens
  if (uStreak > 0.0) {
    vec3 smear = vec3(0.0);
    for (int i = 1; i <= 4; i++) {
      float o = float(i) * 0.03, w = 1.0 - float(i) * 0.2;
      smear += (texture2D(tBloom, uv + vec2(o, 0.0)).rgb + texture2D(tBloom, uv - vec2(o, 0.0)).rgb) * w;
    }
    c += max(smear * 0.25 - 0.55, 0.0) * uStreak * vec3(0.7, 0.85, 1.2);
  }
  // there is little lit air between the eye and what is right in front of it: the player's own hands stay clear
  if (uShafts > 0.0) c += texture2D(tShafts, uv).r * uShaftColor * uShafts * smoothstep(0.35, 2.6, -viewZ(texture2D(tDepth, uv).x));
  c *= 1.0 - uVignette * smoothstep(0.08, 0.80, r2 * 1.35);
  c = AgXToneMapping(c);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
  c += uShadowTint * (1.0 - l) * (1.0 - l) + uHighlightTint * l * l;
  c = mix(max(c, 0.0), uFadeColor, uFade);
  c = toSRGB(c);
  float n = fract(sin(dot(gl_FragCoord.xy + fract(uClock) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) * (uGrain + 1.0 / 255.0);                                        // grain doubles as the dither that keeps sky gradients from banding
  gl_FragColor = vec4(c, 1.0);
}`;

const _light = new THREE.Vector3();
const HALF_FLOAT = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false } as const;

export class PostPipeline {
  /** Scales the flash and the lens punch: below 1 for a player who has asked their device for less motion. */
  motion = 1;
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.Camera();
  private readonly white: THREE.DataTexture;

  private rtMain: THREE.WebGLRenderTarget | null = null;
  private rtAlt: THREE.WebGLRenderTarget | null = null;
  private rtAO: THREE.WebGLRenderTarget | null = null;
  private rtAO2: THREE.WebGLRenderTarget | null = null;
  private rtShafts: THREE.WebGLRenderTarget | null = null;
  private blooms: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget][] = [];

  private readonly depthU = { uNear: { value: 0.1 }, uFar: { value: 100 }, uInvProj: { value: new THREE.Vector2() } };
  private readonly sceneU = { tScene: { value: null as THREE.Texture | null }, tAO: { value: null as THREE.Texture | null }, uAO: { value: 0 } };
  private readonly wipeU = {
    ...this.depthU,
    tAlt: { value: null as THREE.Texture | null }, tAltDepth: { value: null as THREE.Texture | null },
    uWave: { value: 0 }, uWaveSoft: { value: 1 }, uWaveMax: { value: 60 }, uTime: { value: 0 },
    uWaveColor: { value: new THREE.Color() }, uCamWorld: { value: new THREE.Matrix4() },
  };
  private readonly finalU = {
    tBloom: { value: null as THREE.Texture | null }, uBloom: { value: 0.08 }, uSaturation: { value: 1 }, uContrast: { value: 0 },
    uVignette: { value: 0 }, uGrain: { value: 0 }, uChroma: { value: 0 }, uFade: { value: 0 }, uFlash: { value: 0 }, uKick: { value: 0 }, uClock: { value: 0 },
    uShadowTint: { value: new THREE.Color() }, uHighlightTint: { value: new THREE.Color() }, uFadeColor: { value: new THREE.Color() },
    tDepth: { value: null as THREE.Texture | null }, tSoft: { value: null as THREE.Texture | null }, tSofter: { value: null as THREE.Texture | null },
    tShafts: { value: null as THREE.Texture | null }, uDof: { value: 0 }, uFocus: { value: 6 }, uShafts: { value: 0 }, uStreak: { value: 0 }, uShaftColor: { value: new THREE.Color() },
  };

  private readonly mAO: THREE.ShaderMaterial;
  private readonly mAOBlur: THREE.ShaderMaterial;
  private readonly mShafts: THREE.ShaderMaterial;
  private readonly black: THREE.DataTexture;
  private readonly mDown0: Record<'plain' | 'wipe', THREE.ShaderMaterial>;
  private readonly mDown: THREE.ShaderMaterial;
  private readonly mUp: THREE.ShaderMaterial;
  private readonly mFinal: Record<'plain' | 'wipe', THREE.ShaderMaterial>;

  private width = 0;
  private height = 0;
  private settings: QualitySettings;

  constructor(private readonly renderer: THREE.WebGLRenderer, settings: QualitySettings) {
    this.settings = settings;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(g);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.white.needsUpdate = true;
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.black.needsUpdate = true;

    const mk = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, string> = {}) =>
      new THREE.ShaderMaterial({ vertexShader: FULLSCREEN_VS, fragmentShader, uniforms, defines, depthTest: false, depthWrite: false, toneMapped: false });

    this.mAO = mk(AO_FS, { ...this.depthU, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 0.35 } });
    this.mAOBlur = mk(AO_BLUR_FS, { tA: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.mShafts = mk(SHAFT_FS, { ...this.depthU, tScene: { value: null }, tDepth: { value: null }, uLight: { value: new THREE.Vector2() }, uSkyFrom: { value: 100 } });
    const down0U = { ...this.sceneU, uT: { value: new THREE.Vector2() } };
    this.mDown0 = { plain: mk(DOWN0_FS, down0U), wipe: mk(DOWN0_FS, { ...down0U, ...this.wipeU }, { WIPE: '' }) };
    this.mDown = mk(DOWN_FS, { tC: { value: null }, uT: { value: new THREE.Vector2() } });
    this.mUp = mk(UP_FS, { tC: { value: null }, tB: { value: null }, uT: { value: new THREE.Vector2() }, uMix: { value: 0.6 } });
    const finalU = { ...this.sceneU, ...this.depthU, ...this.finalU };
    this.mFinal = { plain: mk(FINAL_FS, finalU), wipe: mk(FINAL_FS, { ...finalU, ...this.wipeU }, { WIPE: '' }) };
  }

  get sceneWidth(): number {
    return this.width;
  }
  get sceneHeight(): number {
    return this.height;
  }

  setQuality(settings: QualitySettings): void {
    this.settings = settings;
    const w = this.width, h = this.height;
    this.width = this.height = 0;
    if (w && h) this.setSize(w, h);
  }

  /** Size of the internal scene targets in pixels. The canvas itself is sized by the caller. */
  setSize(w: number, h: number): void {
    w = Math.max(2, Math.round(w));
    h = Math.max(2, Math.round(h));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.disposeTargets();
    const depth = new THREE.DepthTexture(w, h);
    depth.minFilter = depth.magFilter = THREE.NearestFilter;
    this.rtMain = new THREE.WebGLRenderTarget(w, h, { ...HALF_FLOAT, depthBuffer: true, depthTexture: depth, samples: this.settings.msaa });
    const hw = Math.max(2, w >> 1), hh = Math.max(2, h >> 1);
    if (this.settings.ao) {
      this.rtAO = new THREE.WebGLRenderTarget(hw, hh, HALF_FLOAT);
      this.rtAO2 = new THREE.WebGLRenderTarget(hw, hh, HALF_FLOAT);
    }
    if (this.settings.shafts) this.rtShafts = new THREE.WebGLRenderTarget(hw, hh, HALF_FLOAT);
    let bw = hw, bh = hh;
    for (let i = 0; i < this.settings.bloomLevels && bw > 8 && bh > 8; i++) {
      this.blooms.push([new THREE.WebGLRenderTarget(bw, bh, HALF_FLOAT), new THREE.WebGLRenderTarget(bw, bh, HALF_FLOAT)]);
      bw >>= 1;
      bh >>= 1;
    }
  }

  private disposeTargets(): void {
    for (const t of [this.rtMain, this.rtAlt, this.rtAO, this.rtAO2, this.rtShafts, ...this.blooms.flat()]) {
      t?.depthTexture?.dispose();
      t?.dispose();
    }
    this.rtMain = this.rtAlt = this.rtAO = this.rtAO2 = this.rtShafts = null;
    this.blooms = [];
  }

  private run(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  private altTarget(): THREE.WebGLRenderTarget {
    if (!this.rtAlt) {
      const depth = new THREE.DepthTexture(this.width, this.height);
      depth.minFilter = depth.magFilter = THREE.NearestFilter;
      this.rtAlt = new THREE.WebGLRenderTarget(this.width, this.height, { ...HALF_FLOAT, depthBuffer: true, depthTexture: depth });
    }
    return this.rtAlt;
  }

  /** Releases the second world's target once a wipe has finished. */
  releaseWipe(): void {
    this.rtAlt?.depthTexture?.dispose();
    this.rtAlt?.dispose();
    this.rtAlt = null;
  }

  render(f: FrameInput): void {
    const r = this.renderer, main = this.rtMain;
    if (!main) throw new Error('PostPipeline.render before setSize');
    const { camera, look } = f;
    const pe = camera.projectionMatrix.elements;
    this.depthU.uNear.value = camera.near;
    this.depthU.uFar.value = camera.far;
    this.depthU.uInvProj.value.set(1 / pe[0]!, 1 / pe[5]!);
    r.toneMappingExposure = look.exposure;

    const variant = f.wipe ? 'wipe' : 'plain';
    if (f.wipe) {
      const alt = this.altTarget();
      r.setRenderTarget(alt);
      r.clear();
      r.render(f.wipe.scene, camera);
      const u = this.wipeU;
      u.tAlt.value = alt.texture;
      u.tAltDepth.value = alt.depthTexture;
      u.uWave.value = f.wipe.radius;
      u.uWaveSoft.value = f.wipe.softness;
      u.uWaveMax.value = Math.min(camera.far * 0.9, 90);
      u.uTime.value = f.time;
      u.uWaveColor.value.copy(f.wipe.color);
      u.uCamWorld.value.copy(camera.matrixWorld);
    }

    f.prepass?.(r, camera);
    r.setRenderTarget(main);
    r.clear();
    r.render(f.scene, camera);

    this.sceneU.tScene.value = main.texture;
    if (this.rtAO && this.rtAO2 && look.ao > 0.001) {
      const ao = this.rtAO, ao2 = this.rtAO2;
      this.mAO.uniforms.tDepth!.value = main.depthTexture;
      (this.mAO.uniforms.uTexel!.value as THREE.Vector2).set(1 / ao.width, 1 / ao.height);
      this.run(this.mAO, ao);
      this.mAOBlur.uniforms.tA!.value = ao.texture;
      (this.mAOBlur.uniforms.uDir!.value as THREE.Vector2).set(1 / ao.width, 0);
      this.run(this.mAOBlur, ao2);
      this.mAOBlur.uniforms.tA!.value = ao2.texture;
      (this.mAOBlur.uniforms.uDir!.value as THREE.Vector2).set(0, 1 / ao.height);
      this.run(this.mAOBlur, ao);
      this.sceneU.tAO.value = ao.texture;
      this.sceneU.uAO.value = look.ao;
    } else {
      this.sceneU.tAO.value = this.white;
      this.sceneU.uAO.value = 0;
    }

    // light shafts, when the world has a light to make them of and the eye is turned its way
    const u = this.finalU;
    u.tShafts.value = this.black;
    u.uShafts.value = 0;
    if (this.rtShafts && f.shafts && look.shafts > 0.001) {
      const toLight = _light.copy(f.shafts.direction).transformDirection(camera.matrixWorldInverse);
      // behind the eye there is nothing to gather; it comes on as the light swings into view
      const facing = THREE.MathUtils.smoothstep(-toLight.z, 0.0, 0.5);
      if (facing > 0.001) {
        _light.multiplyScalar(1000).applyMatrix4(camera.projectionMatrix);
        (this.mShafts.uniforms.uLight!.value as THREE.Vector2).set(_light.x * 0.5 + 0.5, _light.y * 0.5 + 0.5);
        this.mShafts.uniforms.uSkyFrom!.value = f.shafts.skyFrom;
        this.mShafts.uniforms.tScene!.value = main.texture;
        this.mShafts.uniforms.tDepth!.value = main.depthTexture;
        this.run(this.mShafts, this.rtShafts);
        u.tShafts.value = this.rtShafts.texture;
        u.uShafts.value = look.shafts * facing;
        u.uShaftColor.value.copy(look.shaftColor);
      }
    }

    // bloom: prefilter from the lit frame, walk down, then back up blending each level into the one above
    const blooms = this.blooms;
    let src: THREE.Texture = main.texture, sw = this.width, sh = this.height;
    for (let i = 0; i < blooms.length; i++) {
      const target = blooms[i]![0];
      if (i === 0) {
        const m = this.mDown0[variant];
        (m.uniforms.uT!.value as THREE.Vector2).set(1 / sw, 1 / sh);
        this.run(m, target);
      } else {
        this.mDown.uniforms.tC!.value = src;
        (this.mDown.uniforms.uT!.value as THREE.Vector2).set(1 / sw, 1 / sh);
        this.run(this.mDown, target);
      }
      src = target.texture;
      sw = target.width;
      sh = target.height;
    }
    let up = blooms[blooms.length - 1]![0];
    for (let i = blooms.length - 2; i >= 0; i--) {
      const target = blooms[i]![1];
      this.mUp.uniforms.tC!.value = up.texture;
      this.mUp.uniforms.tB!.value = blooms[i]![0].texture;
      (this.mUp.uniforms.uT!.value as THREE.Vector2).set(1 / up.width, 1 / up.height);
      this.run(this.mUp, target);
      up = target;
    }

    u.tBloom.value = up.texture;
    // the bloom pyramid's first two steps are the frame at half and quarter size: the soft focus is made of them
    u.tDepth.value = main.depthTexture;
    u.tSoft.value = blooms[0]![0].texture;
    u.tSofter.value = (blooms[1] ?? blooms[0]!)[0].texture;
    u.uDof.value = this.settings.dof ? look.dof : 0;
    u.uFocus.value = f.fx.focus;
    u.uStreak.value = look.streak;
    u.uBloom.value = look.bloom;
    u.uSaturation.value = look.saturation;
    u.uContrast.value = look.contrast;
    u.uVignette.value = look.vignette;
    u.uGrain.value = look.grain;
    u.uChroma.value = look.chroma;
    u.uShadowTint.value.copy(look.shadowTint);
    u.uHighlightTint.value.copy(look.highlightTint);
    u.uFade.value = 1 - (1 - f.fx.fade) * (1 - f.fx.dim * DIM_DEPTH);
    u.uFadeColor.value.copy(f.fx.fadeColor);
    u.uFlash.value = f.fx.flash * this.motion;
    u.uKick.value = f.fx.kick * this.motion;
    u.uClock.value = f.time;
    this.run(this.mFinal[variant], null);

    if (f.overlay) {
      const auto = r.autoClear;
      r.autoClear = false;
      r.clearDepth();
      r.render(f.overlay.scene, f.overlay.camera);
      r.autoClear = auto;
    }
  }

  /** Compiles both grade variants behind the loader so the first wipe never stalls on a shader build. */
  warm(): void {
    const t = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false });
    for (const m of [this.mDown0.wipe, this.mFinal.wipe, this.mDown0.plain, this.mFinal.plain, this.mAO, this.mAOBlur, this.mShafts, this.mDown, this.mUp]) this.run(m, t);
    this.renderer.setRenderTarget(null);
    t.dispose();
  }

  dispose(): void {
    this.disposeTargets();
    this.white.dispose();
    this.black.dispose();
    this.quad.geometry.dispose();
  }
}
