import * as THREE from 'three';
import { Rng, TAU } from '../../core/math';
import { GLSL_NOISE, GLSL_OUTPUT } from '../../render/glsl';

/** Direction of the ringed planet that hangs behind the gateway, and of the key light that models faces. */
export const PLANET_DIR = new THREE.Vector3(0.1, 0.2, -1).normalize();
export const KEY_DIR = new THREE.Vector3(-0.45, 0.62, 0.62).normalize();

const SKY_FS = /* glsl */ `
${GLSL_NOISE}
uniform float uTime, uFestival; uniform vec3 uPlanetDir;
varying vec3 vDir;
vec3 skyColor(vec3 d){
  float h = d.y;
  // a warm, painterly dusk: gold at the horizon, rose and peach above it, deep violet overhead
  vec3 zenith = vec3(0.03, 0.02, 0.08), mid = vec3(0.24, 0.11, 0.22), low = vec3(0.72, 0.34, 0.28), horizon = vec3(1.0, 0.62, 0.28);
  vec3 c = mix(horizon, low, smoothstep(-0.02, 0.1, h));
  c = mix(c, mid, smoothstep(0.06, 0.34, h));
  c = mix(c, zenith, smoothstep(0.28, 0.9, h));
  // the glow of the hidden sun gathers under the planet
  float toward = max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uPlanetDir.x, 0.0, uPlanetDir.z))), 0.0);
  c += vec3(1.0, 0.62, 0.3) * pow(toward, 4.0) * exp(-max(h, 0.0) * 5.0) * 0.8;
  // a golden veil low across the whole sky
  c += vec3(0.5, 0.3, 0.12) * exp(-max(h, 0.0) * 9.0) * 0.35;
  // nebula: two soft bands of dust across the sky
  float n = fbm3(d * 2.4 + vec3(0.0, 0.0, uTime * 0.004));
  float band = exp(-pow((d.y - 0.42 - 0.25 * d.x) * 3.2, 2.0));
  c += (vec3(0.42, 0.16, 0.6) * smoothstep(0.42, 0.8, n) + vec3(0.1, 0.3, 0.6) * smoothstep(0.5, 0.9, fbm3(d * 4.1 + 7.0))) * band * 0.3;
  // below the horizon: the cloud sea's own haze
  c = mix(c, vec3(0.42, 0.22, 0.24), smoothstep(0.0, -0.22, h));
  return c;
}
void main(){
  vec3 d = normalize(vDir);
  vec3 c = skyColor(d);
  // ringed planet: disc, soft terminator, bands, a tilted ring that passes in front and behind
  vec3 pz = normalize(uPlanetDir), px = normalize(cross(vec3(0.0, 1.0, 0.0), pz)), py = cross(pz, px);
  vec2 q = vec2(dot(d, px), dot(d, py)) / max(dot(d, pz), 1e-3);
  float facing = step(0.0, dot(d, pz));
  const float PR = 0.2;
  float r = length(q) / PR;
  float disc = (1.0 - smoothstep(0.985, 1.0, r)) * facing;
  vec3 nrm = vec3(q / PR, sqrt(max(1.0 - r * r, 0.0)));
  float lit = clamp(dot(nrm, normalize(vec3(-0.55, 0.5, 0.67))) * 0.75 + 0.42, 0.0, 1.0);
  float bands = fbm2(vec2(q.y / PR * 4.5 + fbm2(q / PR * 2.2) * 0.9, q.x / PR * 0.7));
  vec3 planet = mix(vec3(0.82, 0.4, 0.52), vec3(1.0, 0.78, 0.6), smoothstep(0.25, 0.75, bands)) * (0.1 + 0.85 * lit * lit);
  planet += vec3(0.5, 0.6, 1.0) * pow(r, 6.0) * 0.28;                       // limb haze
  c = mix(c, planet, disc * 0.96);
  c += vec3(1.0, 0.56, 0.62) * exp(-max(r - 1.0, 0.0) * 3.4) * 0.16 * facing * (1.0 - disc);   // corona
  vec2 rq = mat2(0.906, 0.423, -0.423, 0.906) * q / PR;                                         // ring plane tilted 25 degrees
  float rr = length(vec2(rq.x, rq.y * 3.6));
  float ringMask = smoothstep(1.32, 1.4, rr) * (1.0 - smoothstep(2.05, 2.15, rr)) * facing;
  float gaps = 0.55 + 0.45 * sin(rr * 46.0) * sin(rr * 17.0 + 1.0);
  float behind = step(0.0, rq.y) * disc;                                                         // the far half hides behind the disc
  c += vec3(1.0, 0.8, 0.7) * ringMask * gaps * (1.0 - behind) * 0.42;
  c += vec3(1.0, 0.75, 0.4) * uFestival * 0.03 * exp(-abs(d.y) * 5.0);
  gl_FragColor = vec4(c, 1.0);
  ${GLSL_OUTPUT}
}`;

const SKY_VS = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99999, p.w);   // pinned just inside the far plane
}`;

const STAR_VS = /* glsl */ `
attribute float aSize, aPhase; attribute vec3 aColor;
uniform float uTime, uPixel;
varying vec3 vColor;
void main(){
  float tw = 0.72 + 0.28 * sin(uTime * (1.2 + aPhase * 2.3) + aPhase * 40.0);
  vColor = aColor * tw;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99998, p.w);
  gl_PointSize = aSize * uPixel;
}`;
const STAR_FS = /* glsl */ `
varying vec3 vColor;
void main(){
  vec2 q = gl_PointCoord - 0.5; float r = length(q) * 2.0;
  float core = exp(-r * r * 9.0), flare = max(0.0, 1.0 - abs(q.x) * 14.0) * max(0.0, 1.0 - abs(q.y) * 2.4) + max(0.0, 1.0 - abs(q.y) * 14.0) * max(0.0, 1.0 - abs(q.x) * 2.4);
  gl_FragColor = vec4(vColor * (core + flare * 0.22), 1.0);
  ${GLSL_OUTPUT}
}`;

const AURORA_VS = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main(){
  vUv = uv;
  vec3 p = position;
  float sway = sin(uv.x * 9.0 + uTime * 0.22) * 14.0 + sin(uv.x * 23.0 - uTime * 0.31) * 6.0;
  p.xz += normalize(vec2(p.x, p.z) + 1e-3) * sway * uv.y;       // the curtain's top edge wanders more than its foot
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const AURORA_FS = /* glsl */ `
${GLSL_NOISE}
uniform float uTime, uStrength; uniform vec3 uLow, uHigh;
varying vec2 vUv;
void main(){
  float rays = fbm2(vec2(vUv.x * 60.0 + uTime * 0.12, vUv.y * 1.6 - uTime * 0.05));
  rays = 0.35 + 0.65 * smoothstep(0.25, 0.75, rays);
  float body = fbm2(vec2(vUv.x * 7.0 - uTime * 0.03, 3.0));
  float vertical = smoothstep(0.0, 0.05, vUv.y) * pow(clamp(1.0 - vUv.y, 0.0, 1.0), 2.6);   // clamped: MSAA can extrapolate uv past the edge
  float ends = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
  float a = rays * vertical * ends * smoothstep(0.36, 0.7, body) * uStrength;
  gl_FragColor = vec4(mix(uLow, uHigh, smoothstep(0.0, 0.75, vUv.y)) * a, 1.0);
  ${GLSL_OUTPUT}
}`;

export interface HavenSky {
  readonly group: THREE.Group;
  /** A plain copy of the dome for baking the environment map. */
  readonly envScene: THREE.Scene;
  update(time: number, camera: THREE.Camera, pixelHeight: number): void;
  setFestival(k: number): void;
}

export const buildSky = (starCount: number): HavenSky => {
  const group = new THREE.Group();
  const uniforms = { uTime: { value: 0 }, uFestival: { value: 0 }, uPlanetDir: { value: PLANET_DIR.clone() } };
  const domeGeo = new THREE.IcosahedronGeometry(1, 4);
  const domeMat = new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, uniforms, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  group.add(dome);

  // the environment bake sees the dome from the origin through an ordinary camera
  const envScene = new THREE.Scene();
  const envDome = new THREE.Mesh(new THREE.IcosahedronGeometry(50, 4), new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: SKY_FS, uniforms, side: THREE.BackSide, fog: false,
  }));
  envScene.add(envDome);

  // stars: crisp points, denser and brighter toward the zenith, each with its own slow twinkle
  const rng = new Rng(2080);
  const pos = new Float32Array(starCount * 3), size = new Float32Array(starCount), phase = new Float32Array(starCount), color = new Float32Array(starCount * 3);
  const tints = [new THREE.Color(1, 0.96, 0.9), new THREE.Color(0.8, 0.88, 1), new THREE.Color(1, 0.82, 0.72), new THREE.Color(0.86, 0.8, 1)];
  for (let i = 0; i < starCount; i++) {
    const y = Math.pow(rng.next(), 0.75) * 0.98 + 0.02, a = rng.range(0, TAU), r = Math.sqrt(1 - y * y);
    pos.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
    const big = rng.chance(0.06);
    size[i] = big ? rng.range(5, 9) : rng.range(1.4, 3.2);
    phase[i] = rng.next();
    const c = rng.pick(tints).clone().multiplyScalar((big ? rng.range(2.5, 5) : rng.range(0.5, 1.8)) * (0.35 + 0.65 * y));
    color.set([c.r, c.g, c.b], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  starGeo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  starGeo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
  const starU = { uTime: uniforms.uTime, uPixel: { value: 1 } };
  const stars = new THREE.Points(starGeo, new THREE.ShaderMaterial({ vertexShader: STAR_VS, fragmentShader: STAR_FS, uniforms: starU, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  stars.frustumCulled = false;
  stars.renderOrder = -999;
  group.add(stars);

  // aurora: three curtains hung on arcs high over the islands
  const auroraMats: THREE.ShaderMaterial[] = [];
  const curtain = (radius: number, from: number, to: number, base: number, height: number, low: THREE.ColorRepresentation, high: THREE.ColorRepresentation, strength: number): void => {
    const SEG = 96;
    const p: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG, a = THREE.MathUtils.lerp(from, to, u);
      const rr = radius * (1 + 0.12 * Math.sin(u * 7.0)), x = Math.sin(a) * rr, z = -Math.cos(a) * rr;
      p.push(x, base + 30 * Math.sin(u * 5.0), z, x, base + height, z);
      uv.push(u, 0, u, 1);
      if (i < SEG) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      vertexShader: AURORA_VS, fragmentShader: AURORA_FS, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
      uniforms: { uTime: uniforms.uTime, uStrength: { value: strength }, uLow: { value: new THREE.Color(low) }, uHigh: { value: new THREE.Color(high) } },
    });
    auroraMats.push(m);
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = -998;
    group.add(mesh);
  };
  curtain(1500, -1.3, 0.35, 330, 520, 0x38ffb4, 0x8c5cff, 1.1);
  curtain(1900, 0.1, 1.5, 420, 560, 0x4ce0ff, 0xff6ad5, 0.85);
  curtain(1300, 1.9, 3.6, 280, 440, 0x5affc8, 0x7a66ff, 0.7);

  return {
    group, envScene,
    update(time, camera, pixelHeight) {
      uniforms.uTime.value = time;
      starU.uPixel.value = pixelHeight / 1080;
      // stars and dome are pinned to the camera in their shaders; the curtains are real geometry far away
      void camera;
    },
    setFestival(k) {
      uniforms.uFestival.value = k;
      for (const m of auroraMats) m.uniforms.uStrength!.value *= 1; // strength is set per curtain; the festival only warms the horizon
    },
  };
};
