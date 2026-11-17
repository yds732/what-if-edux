import * as THREE from 'three';

/**
 * A figure's head is modelled blank; its face is drawn by the fragment shader straight onto the skin from a handful
 * of numbers (how open each eye is, how the mouth curves...). Expressions are therefore continuous, crisp at any
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
  eyeL: 1, eyeR: 1, eyeSmile: 0, gazeX: 0, gazeY: 0, mouthOpen: 0, mouthSmile: 0.25, mouthWidth: 1, browRaise: 0, browTilt: 0, blush: 0,
});

export interface FaceLook {
  /** Iris colour. */
  eyeColor?: THREE.ColorRepresentation;
  browColor?: THREE.ColorRepresentation;
  /** Companions carry a glint of their own light in the eye. */
  glintColor?: THREE.ColorRepresentation;
  /** Eye size multiplier. */
  eyeScale?: number;
}

/*
 * The style is a calm, natural one: almond eyes with white, a coloured iris and a single modest catch-light under a
 * soft lash line; straight, fairly thick brows a little above them; a small closed mouth that only just turns up.
 * Every character shares it; they differ by colouring and by how their resting mouth sits.
 */
const FACE_PARS = /* glsl */ `
varying vec3 vHeadPos;
uniform float uEyeScale, uBlush;
uniform vec4 uEyes;    // openL, openR, smile, -
uniform vec2 uGaze;
uniform vec4 uMouth;   // open, smile, width, -
uniform vec2 uBrow;    // raise, tilt
uniform vec3 uEyeColor, uBrowColor, uGlintColor;
float faceGloss = 0.0; vec3 faceGlint = vec3(0.0);

// returns the eye's coverage; col is its colour there
float fEye(vec2 f, vec2 c, vec2 r, float open, float smile, vec2 gaze, out vec3 col, out float glint){
  vec2 d = f - c;
  d.y -= smile * 0.5 * r.x * (1.0 - (d.x * d.x) / (r.x * r.x));
  // almond: the upper lid is a fuller curve than the lower
  float ry = max(r.y * open * (d.y > 0.0 ? 1.0 : 0.78), 0.010);
  float e = (length(vec2(d.x / r.x, d.y / ry)) - 1.0) * min(r.x, ry);
  float aa = fwidth(e) * 0.75 + 1e-5;
  float m = 1.0 - smoothstep(-aa, aa, e);
  // the iris keeps its size as the lids close over it
  float ri = 0.86 * r.y;
  vec2 q = f - c - gaze * vec2(0.34 * r.x, 0.2 * r.y) - vec2(0.0, 0.1 * r.y);
  float di = length(q);
  float aaI = fwidth(di) * 0.75 + 1e-5;
  float iris = 1.0 - smoothstep(ri - aaI, ri + aaI, di);
  float pupil = 1.0 - smoothstep(0.42 * ri - aaI, 0.42 * ri + aaI, di);
  vec3 irisCol = uEyeColor * (1.0 + 0.35 * smoothstep(0.2 * ri, -0.8 * ri, q.y)) * (1.0 - 0.45 * smoothstep(0.62 * ri, ri, di));
  vec3 sclera = vec3(0.93, 0.91, 0.88) * (1.0 - 0.2 * smoothstep(-0.1, 0.9, d.y / max(r.y * open, 0.01)));
  col = mix(sclera, irisCol, iris);
  col = mix(col, vec3(0.025, 0.02, 0.025), pupil);
  // lash line: dark along the upper lid, a faint edge along the lower
  float lashW = mix(0.005, 0.02, smoothstep(-0.35, 0.25, d.y / max(ry, 0.01)));
  float lash = smoothstep(-lashW - aa, -lashW + aa, e);
  col = mix(col, mix(vec3(0.05, 0.04, 0.04), uBrowColor * 0.6, 0.3), lash);
  float vis = smoothstep(0.35, 0.8, open) * (1.0 - smoothstep(0.3, 0.7, abs(smile)));
  vec2 g1 = q - vec2(-0.32, 0.34) * ri, g2 = q - vec2(0.3, -0.36) * ri;
  glint = ((1.0 - smoothstep(0.13 * ri, 0.2 * ri, length(g1))) + 0.35 * (1.0 - smoothstep(0.05 * ri, 0.1 * ri, length(g2)))) * vis * m * (1.0 - lash);
  return m;
}
float fSeg(vec2 p, vec2 a, vec2 b, out float h){ vec2 pa = p - a, ba = b - a; h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
`;

const FACE_COLOR = /* glsl */ `
{
  vec2 f = vHeadPos.xy;
  // the face is on the front of the head, and nowhere else on the body
  float front = smoothstep(0.05, 0.3, vHeadPos.z) * (1.0 - smoothstep(1.25, 1.45, length(vHeadPos)));
  if (front > 0.0) {
    vec3 skin = diffuseColor.rgb;
    // cheeks: only ever a faint warmth
    vec2 bl = vec2(abs(f.x) - 0.48, f.y + 0.30);
    diffuseColor.rgb = mix(diffuseColor.rgb, skin * vec3(1.08, 0.86, 0.84), uBlush * front * exp(-dot(bl, bl) / 0.03));
    // mouth: small and closed at rest
    float w = 0.092 * uMouth.z;
    vec2 d = f - vec2(0.0, -0.48);
    float x = clamp(d.x / w, -1.0, 1.0);
    // an open mouth has a flatter upper lip and a deep lower one: a smile that opens, not a tongue that hangs
    float opening = smoothstep(0.0, 0.45, uMouth.x);
    float sag = uMouth.y * w * (0.45 * (1.0 - x * x) - 0.12 * pow(abs(x), 4.0)) * (1.0 - 0.7 * opening);
    float top = -sag + uMouth.y * 0.16 * w;
    float depth = uMouth.x * w * (1.15 + 0.4 * max(uMouth.y, 0.0));
    float lower = top - depth * pow(1.0 - x * x, 0.7);
    float beyond = abs(d.x) - w;
    float dLine = beyond > 0.0 ? length(vec2(beyond, d.y - top)) : abs(d.y - top);
    float aaM = fwidth(d.y) * 0.9 + 1e-5;
    float inside = smoothstep(lower - aaM, lower + aaM, d.y) * (1.0 - smoothstep(top - aaM, top + aaM, d.y)) * (1.0 - smoothstep(w - aaM, w + aaM, abs(d.x))) * step(0.02, uMouth.x);
    float down = clamp((top - d.y) / max(depth, 1e-4), 0.0, 1.0);
    // a soft shade under the lower lip
    vec2 lp = vec2(d.x / (0.62 * w), (d.y - (top - depth - 0.034)) / 0.016);
    diffuseColor.rgb = mix(diffuseColor.rgb, skin * vec3(0.86, 0.78, 0.76), 0.35 * front * exp(-dot(lp, lp)));
    vec3 mouthIn = mix(vec3(0.30, 0.09, 0.10), vec3(0.78, 0.40, 0.40), smoothstep(0.5, 0.85, down));
    diffuseColor.rgb = mix(diffuseColor.rgb, mouthIn, inside * front);
    float line = 1.0 - smoothstep(0.0095 - aaM, 0.0095 + aaM, dLine);
    diffuseColor.rgb = mix(diffuseColor.rgb, skin * vec3(0.52, 0.32, 0.31), line * front * mix(0.85, 0.45, smoothstep(0.55, 1.0, abs(d.x) / w)));
    // brows: straight and fairly full, tapering toward the temple
    for (int i = 0; i < 2; i++) {
      float s = i == 0 ? -1.0 : 1.0;
      vec2 c = vec2(0.365 * s, 0.155 + 0.06 * uBrow.x);
      float tilt = uBrow.y * 0.04;
      vec2 a = c - vec2(0.115 * s, -tilt), b = c + vec2(0.115 * s, -tilt - 0.005);
      float h;
      fSeg(f, a, b, h);
      float db = length(f - mix(a, b, h) - vec2(0.0, 0.007 * 4.0 * h * (1.0 - h)));
      float rad = mix(0.03, 0.016, smoothstep(0.25, 1.0, h));
      float aaB = fwidth(db) + 1e-5;
      diffuseColor.rgb = mix(diffuseColor.rgb, uBrowColor, (1.0 - smoothstep(rad - aaB, rad + aaB, db)) * front * 0.94);
    }
    // eyes
    vec2 r = vec2(0.126, 0.1) * uEyeScale;
    float gl, gr;
    vec3 cl, cr;
    float el = fEye(f, vec2(0.36, -0.06), r, uEyes.y, uEyes.z, uGaze, cl, gl);   // +x is the character's left
    float er = fEye(f, vec2(-0.36, -0.06), r, uEyes.x, uEyes.z, uGaze, cr, gr);
    diffuseColor.rgb = mix(diffuseColor.rgb, cl, el * front);
    diffuseColor.rgb = mix(diffuseColor.rgb, cr, er * front);
    faceGloss = max(el, er) * front;
    faceGlint = uGlintColor * 0.7 * (gl + gr) * front;
  }
}
`;

/**
 * A face drawn onto whatever material covers a head. The material's vertices are taken into "face space" by
 * `toFace`: origin at the middle of the head, +Z out of the face, +X toward the character's left, one unit per
 * head radius. A generated head keeps its own textures; the features go on top of them.
 */
export class FaceLayer {
  private readonly u = {
    uFaceMatrix: { value: new THREE.Matrix4() }, uEyeScale: { value: 1 }, uBlush: { value: 0 },
    uEyes: { value: new THREE.Vector4(1, 1, 0, 0) }, uGaze: { value: new THREE.Vector2() },
    uMouth: { value: new THREE.Vector4(0, 0.25, 1, 0) }, uBrow: { value: new THREE.Vector2() },
    uEyeColor: { value: new THREE.Color(0x4a2e1f) }, uBrowColor: { value: new THREE.Color(0x2a201c) }, uGlintColor: { value: new THREE.Color(0xffffff) },
  };

  constructor(look: Partial<FaceLook>, toFace: THREE.Matrix4) {
    this.u.uFaceMatrix.value.copy(toFace);
    this.u.uEyeScale.value = look.eyeScale ?? 1;
    if (look.eyeColor !== undefined) this.u.uEyeColor.value.set(look.eyeColor);
    if (look.browColor !== undefined) this.u.uBrowColor.value.set(look.browColor);
    if (look.glintColor !== undefined) this.u.uGlintColor.value.set(look.glintColor);
  }

  /** Changes where the face sits on the head (for fitting it to a generated head). */
  setPlacement(toFace: THREE.Matrix4): void {
    this.u.uFaceMatrix.value.copy(toFace);
  }

  /** Adds the face to a material. Call before the material is first used. */
  install(material: THREE.MeshStandardMaterial): void {
    const before = material.onBeforeCompile.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      before(shader, renderer);
      Object.assign(shader.uniforms, this.u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vHeadPos;\nuniform mat4 uFaceMatrix;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeadPos = (uFaceMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FACE_PARS}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${FACE_COLOR}`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.16, faceGloss);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += faceGlint;');
    };
    const key = material.customProgramCacheKey.bind(material);
    material.customProgramCacheKey = () => `${key()}|echo-face`;
    material.needsUpdate = true;
  }

  apply(s: FaceState): void {
    this.u.uEyes.value.set(s.eyeR, s.eyeL, s.eyeSmile, 0);
    this.u.uGaze.value.set(s.gazeX, s.gazeY);
    this.u.uMouth.value.set(s.mouthOpen, s.mouthSmile, s.mouthWidth, 0);
    this.u.uBrow.value.set(s.browRaise, s.browTilt);
    this.u.uBlush.value = s.blush;
  }
}
