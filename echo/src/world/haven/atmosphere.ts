import * as THREE from 'three';
import type { Rng } from '../../core/math';
import { GLSL_NOISE, GLSL_OUTPUT } from '../../render/glsl';

// ---------------------------------------------------------------------------------------------------- cloud sea

const CLOUD_VS = /* glsl */ `varying vec3 vWorld; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const CLOUD_FS = /* glsl */ `
${GLSL_NOISE}
uniform float uTime; uniform vec3 uLit, uShade, uHaze, uGlow; uniform vec2 uLightDir;
varying vec3 vWorld;
float density(vec2 p){
  vec2 w = vec2(fbm2(p * 0.55 + uTime * 0.004), fbm2(p * 0.55 + 5.2 - uTime * 0.003));
  return fbm2(p + w * 1.5 + vec2(uTime * 0.007, 0.0));
}
void main(){
  vec2 p = vWorld.xz * 0.0075;
  float d = density(p), toward = density(p + uLightDir * 0.09);
  float lit = clamp((d - toward) * 3.2 + 0.5, 0.0, 1.0);          // the side of each billow that faces the light
  vec3 c = mix(uShade, uLit, lit * smoothstep(0.25, 0.7, d));
  c += uGlow * pow(lit, 3.0) * 0.55;
  float dist = length(vWorld.xz - cameraPosition.xz);
  c = mix(c, uHaze, smoothstep(160.0, 1300.0, dist));              // melt into the horizon
  gl_FragColor = vec4(c, 1.0);
  ${GLSL_OUTPUT}
}`;

export const buildCloudSea = (y: number, timeUniform: { value: number }): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(2600, 48), new THREE.ShaderMaterial({
    vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS, fog: false,
    uniforms: {
      uTime: timeUniform, uLit: { value: new THREE.Color(0.30, 0.42, 0.80) }, uShade: { value: new THREE.Color(0.04, 0.10, 0.28) },
      uHaze: { value: new THREE.Color(0.14, 0.24, 0.40) }, uGlow: { value: new THREE.Color(1.0, 0.6, 0.34) }, uLightDir: { value: new THREE.Vector2(0.1, -1).normalize() },
    },
  }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.frustumCulled = false;
  return mesh;
};

// ---------------------------------------------------------------------------------------------------- waterfalls

const FALL_VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FALL_FS = /* glsl */ `
${GLSL_NOISE}
uniform float uTime; uniform vec3 uColor;
varying vec2 vUv;
void main(){
  float streaks = fbm2(vec2(vUv.x * 14.0, vUv.y * 2.2 + uTime * 1.5)) * 0.6 + 0.4 * fbm2(vec2(vUv.x * 40.0, vUv.y * 5.0 + uTime * 2.4));
  float sides = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
  float fade = smoothstep(0.0, 0.04, vUv.y) * pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.2);      // thins into mist on the way down
  float a = sides * fade * (0.25 + 0.75 * smoothstep(0.3, 0.75, streaks));
  gl_FragColor = vec4(uColor * (0.6 + 1.3 * streaks), a);
  ${GLSL_OUTPUT}
}`;

/** A ribbon of falling water from `top`, `height` metres long, facing `facing` radians about Y. */
export const buildWaterfall = (top: THREE.Vector3, width: number, height: number, facing: number, timeUniform: { value: number }): THREE.Mesh => {
  const g = new THREE.PlaneGeometry(width, height, 1, 8);
  // uv.y = 0 at the lip, 1 at the bottom; the sheet bellies outward as it falls
  const pos = g.getAttribute('position') as THREE.BufferAttribute, uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const v = 1 - uv.getY(i);
    uv.setY(i, v);
    pos.setZ(i, 0.4 * Math.sin(v * Math.PI * 0.5) * width * 0.4);
    pos.setX(i, pos.getX(i) * (1 + 0.35 * v));
  }
  g.translate(0, -height / 2, 0);
  const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
    vertexShader: FALL_VS, fragmentShader: FALL_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: timeUniform, uColor: { value: new THREE.Color(0.6, 1.0, 1.25) } },
  }));
  mesh.position.copy(top);
  mesh.rotation.y = facing;
  return mesh;
};

// ---------------------------------------------------------------------------------------------------- particles

const MOTE_VS = /* glsl */ `
attribute vec4 aSeed;   // phase, speed, size, hue
uniform float uTime, uPixel; uniform vec3 uBox, uCenter;
varying float vHue; varying float vTwinkle;
void main(){
  // each mote wanders on its own slow loop inside the box
  vec3 p = position + vec3(sin(uTime * 0.31 * aSeed.y + aSeed.x * 40.0), sin(uTime * 0.23 * aSeed.y + aSeed.x * 17.0) * 0.6, cos(uTime * 0.27 * aSeed.y + aSeed.x * 29.0)) * 0.9;
  p.y += mod(uTime * 0.05 * aSeed.y + aSeed.x * 7.0, 1.0) * 0.8;
  vHue = aSeed.w;
  vTwinkle = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * (1.2 + aSeed.y) + aSeed.x * 60.0), 2.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(aSeed.z * uPixel * 0.85 / max(-mv.z, 0.4), 64.0);
}`;
const MOTE_FS = /* glsl */ `
uniform vec3 uColorA, uColorB; uniform float uGain;
varying float vHue; varying float vTwinkle;
void main(){
  vec2 q = gl_PointCoord - 0.5; float r = length(q) * 2.0;
  float a = exp(-r * r * 5.0) * vTwinkle;
  gl_FragColor = vec4(mix(uColorA, uColorB, vHue) * a * uGain, 1.0);
  ${GLSL_OUTPUT}
}`;

export interface Motes {
  readonly points: THREE.Points;
  setPixelHeight(h: number): void;
}

/** Fireflies and pollen: additive points wandering inside a box. */
export const buildMotes = (count: number, center: THREE.Vector3, box: THREE.Vector3, rng: Rng, timeUniform: { value: number }, opts: { a: THREE.ColorRepresentation; b: THREE.ColorRepresentation; size: number; gain: number }): Motes => {
  const pos = new Float32Array(count * 3), seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    pos.set([center.x + rng.range(-1, 1) * box.x, center.y + rng.next() ** 1.5 * box.y, center.z + rng.range(-1, 1) * box.z], i * 3);
    seed.set([rng.next(), rng.range(0.5, 1.6), opts.size * rng.range(0.5, 1.4), rng.next()], i * 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const u = { uTime: timeUniform, uPixel: { value: 1080 }, uBox: { value: box }, uCenter: { value: center }, uColorA: { value: new THREE.Color(opts.a) }, uColorB: { value: new THREE.Color(opts.b) }, uGain: { value: opts.gain } };
  const points = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: MOTE_VS, fragmentShader: MOTE_FS, uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  points.frustumCulled = false;
  return { points, setPixelHeight: (h) => void (u.uPixel.value = h) };
};

const PETAL_VS = /* glsl */ `
attribute vec4 aStart;   // xyz at the top of its fall, phase
attribute vec3 aSpin;    // spin speed, drift, size
uniform float uTime, uFloor;
varying vec2 vUv; varying float vFade;
void main(){
  vUv = uv;
  float life = 9.0 + aSpin.y * 4.0;
  float t = mod(uTime + aStart.w * life, life) / life;        // 0 at the branch, 1 on the ground
  float fall = aStart.y - uFloor;
  vec3 c = aStart.xyz;
  c.y = aStart.y - fall * t;
  c.x += sin(t * 9.0 + aStart.w * 40.0) * 0.5 * aSpin.y + t * 2.2;         // a breeze carries them across the plaza
  c.z += cos(t * 7.0 + aStart.w * 23.0) * 0.4 * aSpin.y - t * 0.9;
  float ang = uTime * aSpin.x + aStart.w * 30.0;
  vec3 p = position * aSpin.z;
  p = vec3(p.x * cos(ang) + p.z * sin(ang), p.y * cos(ang * 0.7) - p.z * sin(ang * 0.7), p.z * cos(ang) - p.x * sin(ang));
  vFade = smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.9, t);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(c + p, 1.0);
}`;
const PETAL_FS = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv; varying float vFade;
void main(){
  vec2 q = vUv - 0.5;
  if (dot(q, q) * 4.0 > 1.0 - 0.3 * abs(q.y)) discard;
  gl_FragColor = vec4(uColor * (0.75 + 0.6 * vUv.y), vFade);
  ${GLSL_OUTPUT}
}`;

/** Petals coming off the blossom tree: an endless, looping fall, all in the vertex shader. */
export const buildFallingPetals = (count: number, sources: readonly THREE.Vector3[], floor: number, rng: Rng, timeUniform: { value: number }): THREE.Mesh => {
  const card = new THREE.PlaneGeometry(1, 0.8);
  const start = new Float32Array(count * 4), spin = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const s = rng.pick(sources);
    start.set([s.x + rng.range(-0.6, 0.6), s.y - rng.range(0, 0.5), s.z + rng.range(-0.6, 0.6), rng.next()], i * 4);
    spin.set([rng.range(1.5, 4) * rng.sign(), rng.range(0.4, 1.2), rng.range(0.07, 0.13)], i * 3);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.index = card.index;
  g.setAttribute('position', card.getAttribute('position'));
  g.setAttribute('uv', card.getAttribute('uv'));
  g.setAttribute('aStart', new THREE.InstancedBufferAttribute(start, 4));
  g.setAttribute('aSpin', new THREE.InstancedBufferAttribute(spin, 3));
  g.instanceCount = count;
  const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
    vertexShader: PETAL_VS, fragmentShader: PETAL_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: timeUniform, uFloor: { value: floor }, uColor: { value: new THREE.Color(1.5, 0.9, 1.2) } },
  }));
  mesh.frustumCulled = false;
  return mesh;
};

/** Soft round sprite texture for halos, drawn once. */
let haloTexture: THREE.Texture | null = null;
export const getHaloTexture = (): THREE.Texture => {
  if (haloTexture) return haloTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.14)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  haloTexture = new THREE.CanvasTexture(canvas);
  haloTexture.colorSpace = THREE.SRGBColorSpace;
  return haloTexture;
};

/** An additive glow billboard: gives lights a halo on screen and stands in for bloom in a headset. */
export const makeHalo = (color: THREE.ColorRepresentation, size: number, strength = 1): THREE.Sprite => {
  const mat = new THREE.SpriteMaterial({ map: getHaloTexture(), color: new THREE.Color(color).multiplyScalar(strength), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(size);
  return sprite;
};

