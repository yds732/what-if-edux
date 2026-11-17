import * as THREE from 'three';
import { blob, merge, place } from '../core/geo';

/**
 * A head is one smooth mesh; its face is drawn by the fragment shader straight onto the skin from a handful of
 * numbers (how open each eye is, how the mouth curves...). Expressions are therefore continuous, crisp at any
 * distance, lit like the rest of the head, and cost nothing beyond the head's own draw call.
 */
export interface FaceState {
  /** 0 closed .. 1 open (1.2 is wide-eyed), per eye. */
  eyeL: number;
  eyeR: number;
  /** -1 downturned .. 1 arched: bends the eyes into the "^ ^" of a real smile. */
  eyeSmile: number;
  /** Where the eyes point, -1..1 on each axis. */
  gazeX: number;
  gazeY: number;
  /** 0 closed .. 1 fully open. */
  mouthOpen: number;
  /** -1 frown .. 1 smile. */
  mouthSmile: number;
  /** 0.5 pursed .. 1.4 broad. */
  mouthWidth: number;
  /** -1 low .. 1 raised. */
  browRaise: number;
  /** -1 angry .. 1 worried (inner ends up). */
  browTilt: number;
  /** 0..1 */
  blush: number;
}

export const neutralFace = (): FaceState => ({
  eyeL: 1, eyeR: 1, eyeSmile: 0, gazeX: 0, gazeY: 0, mouthOpen: 0, mouthSmile: 0.35, mouthWidth: 1, browRaise: 0, browTilt: 0, blush: 0.25,
});

export interface FaceLook {
  skin: THREE.ColorRepresentation;
  eyeColor?: THREE.ColorRepresentation;
  browColor?: THREE.ColorRepresentation;
  /** Companions carry a glint of their own light in the eye. */
  glintColor?: THREE.ColorRepresentation;
  /** Eye size multiplier. */
  eyeScale?: number;
}

const FACE_PARS = /* glsl */ `
varying vec3 vHeadPos;
uniform float uHeadR, uEyeScale, uBlush;
uniform vec4 uEyes;    // openL, openR, smile, -
uniform vec2 uGaze;
uniform vec4 uMouth;   // open, smile, width, -
uniform vec2 uBrow;    // raise, tilt
uniform vec3 uEyeColor, uBrowColor, uGlintColor;
float faceGloss = 0.0; vec3 faceGlint = vec3(0.0);

float fEye(vec2 f, vec2 c, vec2 r, float open, float smile, out float glint){
  vec2 d = f - c;
  d.y -= smile * 0.62 * r.x * (1.0 - (d.x * d.x) / (r.x * r.x));
  float ry = max(r.y * open, 0.021);
  float e = (length(vec2(d.x / r.x, d.y / ry)) - 1.0) * min(r.x, ry);
  float aa = fwidth(e) * 0.75 + 1e-5;
  float m = 1.0 - smoothstep(-aa, aa, e);
  float vis = smoothstep(0.35, 0.8, open) * (1.0 - smoothstep(0.3, 0.7, abs(smile)));
  vec2 g1 = d - vec2(-0.30, 0.32) * r, g2 = d - vec2(0.26, -0.34) * r;
  glint = (1.0 - smoothstep(0.22 * r.x, 0.30 * r.x, length(g1)) + 0.7 * (1.0 - smoothstep(0.09 * r.x, 0.15 * r.x, length(g2)))) * vis * m;
  return m;
}
float fSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
`;

const FACE_COLOR = /* glsl */ `
{
  vec2 f = vHeadPos.xy / uHeadR;
  float front = smoothstep(0.05, 0.3, vHeadPos.z / uHeadR);
  if (front > 0.0) {
    vec3 skin = diffuseColor.rgb;
    // cheeks
    vec2 bl = vec2(abs(f.x) - 0.50, f.y + 0.34);
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(skin, vec3(1.0, 0.36, 0.38), 0.55), uBlush * front * exp(-dot(bl, bl) / 0.026));
    // mouth
    float w = 0.115 * uMouth.z;
    vec2 d = f - vec2(0.0, -0.49);
    float x = clamp(d.x / w, -1.0, 1.0);
    // an open mouth has a flatter upper lip and a deep lower one: a smile that opens, not a tongue that hangs
    float opening = smoothstep(0.0, 0.45, uMouth.x);
    float sag = uMouth.y * 0.55 * w * (1.0 - x * x) * (1.0 - 0.7 * opening);
    float top = -sag + uMouth.y * 0.2 * w;
    float depth = uMouth.x * w * (1.25 + 0.55 * max(uMouth.y, 0.0));
    float lower = top - depth * pow(1.0 - x * x, 0.7);
    float beyond = abs(d.x) - w;
    float dLine = beyond > 0.0 ? length(vec2(beyond, d.y - top)) : abs(d.y - top);
    float aaM = fwidth(d.y) * 0.9 + 1e-5;
    float inside = smoothstep(lower - aaM, lower + aaM, d.y) * (1.0 - smoothstep(top - aaM, top + aaM, d.y)) * (1.0 - smoothstep(w - aaM, w + aaM, abs(d.x))) * step(0.02, uMouth.x);
    float down = clamp((top - d.y) / max(depth, 1e-4), 0.0, 1.0);
    vec3 mouthIn = mix(vec3(0.30, 0.07, 0.09), vec3(0.86, 0.38, 0.40), smoothstep(0.5, 0.85, down));
    diffuseColor.rgb = mix(diffuseColor.rgb, mouthIn, inside * front);
    float line = 1.0 - smoothstep(0.014 - aaM, 0.014 + aaM, dLine);
    diffuseColor.rgb = mix(diffuseColor.rgb, skin * vec3(0.42, 0.24, 0.24), line * front * 0.92);
    // brows
    for (int i = 0; i < 2; i++) {
      float s = i == 0 ? -1.0 : 1.0;
      vec2 c = vec2(0.36 * s, 0.25 + 0.07 * uBrow.x);
      vec2 dir = vec2(0.095, 0.0);
      float tilt = uBrow.y * 0.045;
      vec2 a = c - dir * s + vec2(0.0, tilt), b = c + dir * s - vec2(0.0, tilt);
      float db = fSeg(f, a, b);
      float aaB = fwidth(db) + 1e-5;
      diffuseColor.rgb = mix(diffuseColor.rgb, uBrowColor, (1.0 - smoothstep(0.02 - aaB, 0.02 + aaB, db)) * front * 0.9);
    }
    // eyes
    vec2 r = vec2(0.118, 0.172) * uEyeScale;
    vec2 gz = uGaze * vec2(0.03, 0.025);
    float gl, gr;
    float el = fEye(f, vec2(0.36, -0.07) + gz, r, uEyes.y, uEyes.z, gl);   // +x is the character's left
    float er = fEye(f, vec2(-0.36, -0.07) + gz, r, uEyes.x, uEyes.z, gr);
    float eyes = max(el, er) * front;
    diffuseColor.rgb = mix(diffuseColor.rgb, uEyeColor, eyes);
    faceGloss = eyes;
    faceGlint = uGlintColor * (gl + gr) * front;
  }
}
`;

export class FaceMaterial extends THREE.MeshStandardMaterial {
  private readonly u = {
    uHeadR: { value: 0.135 }, uEyeScale: { value: 1 }, uBlush: { value: 0.25 },
    uEyes: { value: new THREE.Vector4(1, 1, 0, 0) }, uGaze: { value: new THREE.Vector2() },
    uMouth: { value: new THREE.Vector4(0, 0.35, 1, 0) }, uBrow: { value: new THREE.Vector2() },
    uEyeColor: { value: new THREE.Color(0x15121a) }, uBrowColor: { value: new THREE.Color(0x3a2a22) }, uGlintColor: { value: new THREE.Color(0xffffff) },
  };

  constructor(headRadius: number, look: FaceLook) {
    super({ color: look.skin, roughness: 0.62, metalness: 0 });
    this.u.uHeadR.value = headRadius;
    this.u.uEyeScale.value = look.eyeScale ?? 1;
    if (look.eyeColor !== undefined) this.u.uEyeColor.value.set(look.eyeColor);
    if (look.browColor !== undefined) this.u.uBrowColor.value.set(look.browColor);
    if (look.glintColor !== undefined) this.u.uGlintColor.value.set(look.glintColor);
    this.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vHeadPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeadPos = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FACE_PARS}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${FACE_COLOR}`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.16, faceGloss);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += faceGlint;');
    };
  }

  override customProgramCacheKey(): string {
    return 'echo-face';
  }

  apply(s: FaceState): void {
    this.u.uEyes.value.set(s.eyeR, s.eyeL, s.eyeSmile, 0);
    this.u.uGaze.value.set(s.gazeX, s.gazeY);
    this.u.uMouth.value.set(s.mouthOpen, s.mouthSmile, s.mouthWidth, 0);
    this.u.uBrow.value.set(s.browRaise, s.browTilt);
    this.u.uBlush.value = s.blush;
  }
}

/** Head centred on the origin, facing +Z: a soft egg with a narrower jaw, ears and the hint of a nose. */
export const headGeometry = (R: number, detail = 1): THREE.BufferGeometry => {
  const skull = blob(R, R * 1.03, R * 0.985, Math.round(6 + 6 * detail), (p) => {
    if (p.y < 0) {
      const k = p.y * p.y;
      p.x *= 1 - 0.2 * k;
      p.z *= 1 - 0.1 * k;
    }
    if (p.z > 0) p.z *= 0.955;
    // cheeks: a little fullness low on the front sides
    const cheek = Math.exp(-((p.y + 0.36) ** 2) / 0.07) * Math.max(0, p.z) * Math.abs(p.x);
    p.x += Math.sign(p.x) * 0.05 * cheek;
    p.z += 0.03 * cheek;
  });
  const parts = [skull, place(blob(R * 0.06, R * 0.05, R * 0.07, 3), [0, -R * 0.25, R * 0.9])];
  for (const s of [-1, 1]) parts.push(place(blob(R * 0.12, R * 0.2, R * 0.15, 3), [s * R * 0.96, -R * 0.06, -R * 0.04], [0, s * 0.3, 0]));
  return merge(parts);
};
