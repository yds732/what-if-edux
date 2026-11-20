import * as THREE from 'three';
import { Rng } from '../../core/math';

export interface Window {
  readonly x: number;
  readonly y0: number;
  readonly y1: number;
  readonly z0: number;
  readonly z1: number;
}

export interface Sunbeams {
  readonly group: THREE.Group;
  setSun(towardRoom: THREE.Vector3, color: THREE.Color, strength: number): void;
  update(time: number, pixelHeight: number): void;
}

const MAX_WINDOWS = 4;
const SHAFT_LENGTH = 11;

const finish = '\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n';

const SHAFT_VS = `
attribute float aAlong;   // 0 at the window, 1 at the far end of the shaft
attribute float aAcross;  // 0..1 across the face, for soft edges
uniform vec3 uDir;
uniform float uLength;
varying float vAlong, vAcross;
varying vec3 vWorld;
void main() {
  vec3 p = position + uDir * aAlong * uLength;
  vAlong = aAlong; vAcross = aAcross;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const SHAFT_FS = `
uniform vec3 uColor;
uniform float uStrength, uTime;
varying float vAlong, vAcross;
varying vec3 vWorld;
void main() {
  // soft at both edges of every face, brightest near the window, gone before the far wall
  float edge = smoothstep(0.0, 0.35, vAcross) * smoothstep(1.0, 0.65, vAcross);
  float fade = smoothstep(0.0, 0.06, vAlong) * pow(1.0 - vAlong, 1.7);
  // slow drifting unevenness, as if the air itself were moving
  float n = 0.82 + 0.18 * sin(vWorld.y * 3.1 + vWorld.z * 2.3 + uTime * 0.35) * sin(vWorld.x * 1.7 - uTime * 0.21);
  // below the floor there is nothing to light
  float above = smoothstep(-0.02, 0.12, vWorld.y);
  // Alpha attenuates the light after output conversion, including in the direct XR render.
  gl_FragColor = vec4(uColor, edge * fade * n * above * uStrength * 0.09);${finish}
}`;

const DUST_VS = `
attribute vec4 aSeed;     // phase, speed, size, twinkle
uniform float uTime, uPixel;
uniform vec3 uDir, uBox0, uBox1;
uniform vec4 uWin[${MAX_WINDOWS}];   // z0, z1, y0, y1 for each window
uniform float uWinX;
varying float vLit, vTwinkle;
void main() {
  vec3 size = uBox1 - uBox0;
  float t = uTime * aSeed.y;
  // a slow wandering drift with a gentle sink, wrapped inside the room
  vec3 p = position + vec3(sin(t * 0.31 + aSeed.x * 6.28) * 0.35 + t * 0.018,
                           sin(t * 0.23 + aSeed.x * 3.1) * 0.22 - t * 0.012,
                           cos(t * 0.27 + aSeed.x * 4.7) * 0.35);
  p = uBox0 + mod(p - uBox0, size);
  // trace back along the sunlight to the window wall: lit if that point is inside a window opening
  float back = (p.x - uWinX) / max(uDir.x, 1e-3);
  vec3 q = p - uDir * back;
  float lit = 0.0;
  for (int i = 0; i < ${MAX_WINDOWS}; i++) {
    vec4 w = uWin[i];
    float inZ = smoothstep(w.x, w.x + 0.12, q.z) * smoothstep(w.y, w.y - 0.12, q.z);
    float inY = smoothstep(w.z, w.z + 0.12, q.y) * smoothstep(w.w, w.w - 0.12, q.y);
    lit = max(lit, inZ * inY);
  }
  vLit = lit * step(0.0, back);
  vTwinkle = 0.65 + 0.35 * sin(uTime * (1.3 + aSeed.w * 2.0) + aSeed.x * 40.0);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSeed.z * uPixel / max(-mv.z, 0.2);
}`;

const DUST_FS = `
uniform vec3 uColor;
uniform float uStrength;
varying float vLit, vTwinkle;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  if (r > 0.5) discard;
  float soft = pow(1.0 - r * 2.0, 1.8);
  // in the shade a mote is barely there; in the sun it glints
  float glow = mix(0.035, 1.0, vLit) * vTwinkle;
  gl_FragColor = vec4(uColor * uStrength * 1.8, soft * glow);${finish}
}`;

export const buildSunbeams = (rng: Rng, windows: readonly Window[], room: { min: THREE.Vector3; max: THREE.Vector3 }, density: number): Sunbeams => {
  const group = new THREE.Group();
  const dir = new THREE.Vector3(0.75, -0.55, 0.2).normalize();
  const color = new THREE.Color(1, 0.95, 0.86);
  const uniforms = {
    uDir: { value: dir }, uLength: { value: SHAFT_LENGTH }, uColor: { value: color }, uStrength: { value: 1 }, uTime: { value: 0 },
  };

  const pos: number[] = [], along: number[] = [], across: number[] = [], index: number[] = [];
  const quad = (a: THREE.Vector3, b: THREE.Vector3): void => {
    const base = pos.length / 3;
    for (const [p, k, s] of [[a, 0, 0], [b, 0, 1], [b, 1, 1], [a, 1, 0]] as const) {
      pos.push(p.x, p.y, p.z);
      along.push(k);
      across.push(s);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const w of windows) {
    const x = w.x + 0.02;
    const c = (y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
    quad(c(w.y0, w.z0), c(w.y0, w.z1));
    quad(c(w.y1, w.z0), c(w.y1, w.z1));
    quad(c(w.y0, w.z0), c(w.y1, w.z0));
    quad(c(w.y0, w.z1), c(w.y1, w.z1));
    for (const k of [0.3, 0.5, 0.7]) {
      const z = w.z0 + (w.z1 - w.z0) * k, y = w.y0 + (w.y1 - w.y0) * k;
      quad(c(w.y0, z), c(w.y1, z));
      quad(c(y, w.z0), c(y, w.z1));
    }
  }
  const shaftGeo = new THREE.BufferGeometry();
  shaftGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  shaftGeo.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  shaftGeo.setAttribute('aAcross', new THREE.Float32BufferAttribute(across, 1));
  shaftGeo.setIndex(index);
  const shafts = new THREE.Mesh(shaftGeo, new THREE.ShaderMaterial({
    uniforms, vertexShader: SHAFT_VS, fragmentShader: SHAFT_FS,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
  }));
  shafts.frustumCulled = false;
  shafts.renderOrder = 5;
  group.add(shafts);

  const count = Math.round(1400 * density);
  const dpos = new Float32Array(count * 3), seed = new Float32Array(count * 4);
  const size = room.max.clone().sub(room.min);
  for (let i = 0; i < count; i++) {
    dpos[i * 3] = room.min.x + rng.next() * size.x;
    dpos[i * 3 + 1] = room.min.y + rng.next() * size.y;
    dpos[i * 3 + 2] = room.min.z + rng.next() * size.z;
    seed.set([rng.next(), rng.range(0.6, 1.4), rng.range(0.018, 0.042), rng.next()], i * 4);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const win = Array.from({ length: MAX_WINDOWS }, (_, i) => {
    const w = windows[i];
    return w ? new THREE.Vector4(w.z0, w.z1, w.y0, w.y1) : new THREE.Vector4(0, 0, 0, 0);
  });
  const dustUniforms = {
    uDir: uniforms.uDir, uColor: uniforms.uColor, uStrength: uniforms.uStrength, uTime: uniforms.uTime,
    uPixel: { value: 900 }, uBox0: { value: room.min.clone() }, uBox1: { value: room.max.clone() },
    uWin: { value: win }, uWinX: { value: windows[0]?.x ?? 0 },
  };
  const dust = new THREE.Points(dustGeo, new THREE.ShaderMaterial({
    uniforms: dustUniforms, vertexShader: DUST_VS, fragmentShader: DUST_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  dust.frustumCulled = false;
  dust.renderOrder = 6;
  group.add(dust);

  return {
    group,
    setSun(towardRoom, c, strength) {
      dir.copy(towardRoom).normalize();
      color.copy(c);
      uniforms.uStrength.value = strength;
      group.visible = strength > 0.01;
    },
    update(time, pixelHeight) {
      uniforms.uTime.value = time;
      dustUniforms.uPixel.value = pixelHeight * 0.83;
    },
  };
};
