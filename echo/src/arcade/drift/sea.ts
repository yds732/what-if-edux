import * as THREE from 'three';
import { Rng } from '../../core/math';
import { GLSL_NOISE, GLSL_OUTPUT } from '../../render/glsl';

const SWELLS = [
  { dir: [0.24, 0.97], length: 17, height: 0.15, speed: 2.1 },
  { dir: [-0.5, 0.87], length: 9.2, height: 0.09, speed: 1.6 },
  { dir: [0.71, 0.71], length: 5.3, height: 0.05, speed: 1.25 },
  { dir: [-0.16, 0.99], length: 3.1, height: 0.028, speed: 0.95 },
] as const;
const SWELL_HEIGHT = SWELLS.reduce((sum, w) => sum + w.height, 0);
const FLAT_FROM = 120, FLAT_BY = 420;

const f = (n: number): string => (Number.isInteger(n) ? `${n}.0` : String(n));
const GLSL_SWELL = `
uniform float uSeaTime, uFlow, uAmp;
float seaWave(vec2 p, out vec2 slope){
  float h = 0.0; slope = vec2(0.0);
${SWELLS.map((w) => {
  const k = (Math.PI * 2) / w.length;
  return `  { vec2 d = vec2(${f(w.dir[0])}, ${f(w.dir[1])}); float a = dot(d, p) * ${f(k)} - uSeaTime * ${f(k * w.speed)}; h += ${f(w.height)} * sin(a); slope += d * (${f(w.height * k)} * cos(a)); }`;
}).join('\n')}
  slope *= uAmp;
  return h * uAmp;
}
float seaFlat(vec2 p){ return 1.0 - smoothstep(${f(FLAT_FROM)}, ${f(FLAT_BY)}, length(p)); }
`;

const RIPPLE_VS = `
attribute vec2 aRipple;      // phase, strength
varying vec2 vUv; varying vec2 vRipple;
void main(){
  vUv = uv; vRipple = aRipple;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const RIPPLE_FS = `
${GLSL_NOISE}
uniform float uSeaTime; uniform vec3 uFoam;
varying vec2 vUv; varying vec2 vRipple;
void main(){
  vec2 q = vUv * 2.0 - 1.0; float r = length(q);
  float t = fract(vRipple.x + uSeaTime * 0.55);
  float off = (r - (0.3 + 0.62 * t)) / 0.07;
  float ring = exp(-off * off) * (1.0 - t) * (1.0 - t);
  float hug = smoothstep(0.62, 0.3, r) * 0.55;
  float lace = fbm2(q * 5.0 + vRipple.x * 31.0 + vec2(0.0, uSeaTime * 0.3));
  float a = (ring * 0.8 + hug * smoothstep(0.38, 0.62, lace)) * vRipple.y * smoothstep(1.0, 0.86, r);
  gl_FragColor = vec4(uFoam, a);
  ${GLSL_OUTPUT}
}`;

const WAKE_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const WAKE_FS = `
${GLSL_NOISE}
uniform float uSeaTime, uFlow, uStrength; uniform vec3 uFoam;
varying vec2 vUv;
void main(){
  // x: -1..1 across; y: 0 where the water leaves the raft, 1 far downstream (clamped: MSAA can carry uv past the edge)
  float x = vUv.x * 2.0 - 1.0, y = clamp(vUv.y, 0.0, 1.0);
  float open = 0.3 + 0.55 * sqrt(y);
  float off = (abs(x) - open) / (0.04 + 0.08 * y);
  float lace = fbm2(vec2(x * 6.0, y * 14.0 - uFlow * 0.5) + uSeaTime * 0.04);
  float arms = exp(-off * off) * smoothstep(0.3, 0.62, lace);
  float flecks = smoothstep(open, open * 0.2, abs(x)) * smoothstep(0.62, 0.8, lace) * 0.6;
  float fade = smoothstep(0.0, 0.1, y) * (1.0 - y) * (1.0 - y) * smoothstep(1.0, 0.85, abs(x));
  gl_FragColor = vec4(uFoam, (arms * 0.7 + flecks) * fade * uStrength);
  ${GLSL_OUTPUT}
}`;

const RAIN_VS = `
attribute vec4 aDrop;        // x, z, phase, which end of the streak
uniform float uSeaTime, uRain; uniform vec3 uEye;
varying float vEnd;
void main(){
  vEnd = aDrop.w;
  // each drop falls through a box that travels with the eye, and comes round again at the top
  float fall = fract(aDrop.z - uSeaTime * (0.9 + 0.35 * fract(aDrop.z * 7.0)));
  vec3 p = vec3(aDrop.x, fall * 16.0 - 3.0, aDrop.y);
  p.xz = mod(p.xz - uEye.xz + 14.0, 28.0) - 14.0 + uEye.xz;
  // blown aslant, and drawn as a short streak along its fall
  p.x += (16.0 - p.y) * 0.22; p.z -= (16.0 - p.y) * 0.3;
  p += vec3(-0.22, 1.0, 0.3) * (aDrop.w * 0.62);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const RAIN_FS = `
uniform float uRain; uniform vec3 uColor;
varying float vEnd;
void main(){
  gl_FragColor = vec4(uColor * uRain * (0.25 + 0.75 * vEnd), 1.0);
  ${GLSL_OUTPUT}
}`;

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const FLAT = new THREE.Quaternion();

const seaGeometry = (segments: number): THREE.BufferGeometry => {
  const radii: number[] = [];
  for (let r = 0.3; r < 12; r += 0.3) radii.push(r);
  for (let r = 12; r < 2400; r *= 1.085) radii.push(r);
  const position: number[] = [0, 0, 0], index: number[] = [];
  for (const r of radii) for (let s = 0; s < segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    position.push(Math.sin(a) * r, 0, Math.cos(a) * r);
  }
  for (let s = 0; s < segments; s++) index.push(0, 1 + s, 1 + ((s + 1) % segments));
  for (let i = 0; i < radii.length - 1; i++) for (let s = 0; s < segments; s++) {
    const a = 1 + i * segments + s, b = 1 + i * segments + ((s + 1) % segments), c = a + segments, d = b + segments;
    index.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(position.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(index);
  return g;
};

export class Sea {
  readonly group = new THREE.Group();
  flow = 0;
  storm = 0;
  light = 1;
  reach = 8;
  ring = 0;
  readonly beam = new THREE.Vector4(0, -200, 0, 0);

  private time = 0;
  private readonly uniforms = {
    uSeaTime: { value: 0 }, uFlow: { value: 0 }, uAmp: { value: 0.6 }, uStorm: { value: 0 },
    uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() }, uFoam: { value: new THREE.Color() },
    uLight: { value: 1 }, uReach: { value: 8 }, uRing: { value: 0 }, uBeam: { value: this.beam },
    uLantern: { value: new THREE.Color(1.0, 0.62, 0.26) }, uSpark: { value: new THREE.Color(0.35, 0.95, 1.0) },
  };
  private readonly ripples: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly rippleData: Float32Array;
  private rippleCount = 0;
  private readonly wake: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly rainUniforms = { uSeaTime: this.uniforms.uSeaTime, uRain: { value: 0 }, uEye: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color(0.55, 0.72, 0.9) } };
  private readonly rain: THREE.LineSegments;

  constructor(quality: { density: number; tier: string }, ripples = 48) {
    const u = this.uniforms;
    const water = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15, metalness: 0, envMapIntensity: 1.5 });
    water.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${GLSL_SWELL}\nvarying vec3 vSea;`)
        .replace('#include <beginnormal_vertex>', `
          vec2 seaSlope; float seaFar = seaFlat(position.xz);
          float seaH = seaWave(vec2(position.x, position.z - uFlow), seaSlope) * seaFar;
          vec3 objectNormal = normalize(vec3(-seaSlope.x * seaFar, 1.0, -seaSlope.y * seaFar));`)
        .replace('#include <begin_vertex>', `
          vec3 transformed = vec3(position.x, seaH, position.z);
          vSea = transformed;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
${GLSL_NOISE}
${GLSL_SWELL}
uniform float uStorm, uLight, uReach, uRing; uniform vec3 uDeep, uShallow, uFoam, uLantern, uSpark; uniform vec4 uBeam;
varying vec3 vSea;
float seaFoam = 0.0;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 sp = vec2(vSea.x, vSea.z - uFlow);
  // troughs are deep water, crests let the light through
  float crest = clamp(vSea.y / (${f(SWELL_HEIGHT)} * uAmp + 1e-4) * 0.5 + 0.5, 0.0, 1.0);
  diffuseColor.rgb = mix(uDeep, uShallow, crest * crest);
  // foam where the swell breaks: little of it in fair weather, a great deal in a squall
  float lace = fbm2(sp * 1.25 + vec2(0.0, uSeaTime * 0.16));
  seaFoam = smoothstep(0.8 - 0.3 * uStorm, 1.0, crest) * smoothstep(0.4, 0.68, lace) * seaFlat(vSea.xz);
  diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, seaFoam * 0.85);
}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.7, seaFoam);`)
        .replace('#include <normal_fragment_maps>', `
{
  vec2 sp = vec2(vSea.x, vSea.z - uFlow);
  vec2 slope; seaWave(sp, slope);
  slope *= seaFlat(vSea.xz);
  // the ripples the swell carries: two layers of them crossing, flattening with distance so that far water does not shimmer
  float e = 0.07;
  vec2 q1 = sp * 1.7 + vec2(uSeaTime * 0.21, -uSeaTime * 0.33), q2 = sp * 4.6 + vec2(-uSeaTime * 0.4, -uSeaTime * 0.27);
  float n1 = vnoise(q1), n2 = vnoise(q2);
  vec2 rip = vec2(vnoise(q1 + vec2(e, 0.0)) - n1, vnoise(q1 + vec2(0.0, e)) - n1) * 0.07 + vec2(vnoise(q2 + vec2(e, 0.0)) - n2, vnoise(q2 + vec2(0.0, e)) - n2) * 0.03;
  rip *= (1.0 + 1.8 * uStorm) / (e * (1.0 + 0.0011 * dot(vViewPosition, vViewPosition)));
  vec3 seaNormal = normalize(vec3(-(slope.x + rip.x), 1.0, -(slope.y + rip.y)));
  normal = normalize((viewMatrix * vec4(seaNormal, 0.0)).xyz);
}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float d = length(vSea.xz);
  // the lantern's light lying on the water, and the edge of it: as far as the hook's line will reach
  float inPool = d / (uReach * 0.6), atEdge = (d - uReach) / 0.06;
  float pool = exp(-inPool * inPool);
  float edge = exp(-atEdge * atEdge) * (0.5 + 0.5 * sin(atan(vSea.z, vSea.x) * 48.0 + uSeaTime * 0.7));
  totalEmissiveRadiance += uLantern * uLight * (pool * 0.2 + edge * 0.42 * uRing);
  // the living light of this sea: sparks carried on the tide, brightest where the lantern wakes them
  vec2 sp = vec2(vSea.x, vSea.z - uFlow) * 4.2, cell = floor(sp);
  float spark = step(0.955, hash12(cell)) * smoothstep(0.32, 0.0, length(fract(sp) - 0.5 - (hash22(cell) - 0.5) * 0.5));
  float twinkle = 0.5 + 0.5 * sin(uSeaTime * (1.5 + 4.0 * hash12(cell + 7.0)) + 40.0 * hash12(cell + 3.0));
  totalEmissiveRadiance += uSpark * spark * twinkle * (0.35 + 1.4 * pool * uLight) / (1.0 + 0.003 * d * d);
  // and the lighthouse's beam going over
  vec2 out2 = vSea.xz - uBeam.xy; float along = length(out2);
  float aside = 1.0 - dot(out2 / max(along, 1e-3), vec2(sin(uBeam.z), cos(uBeam.z)));
  totalEmissiveRadiance += vec3(1.0, 0.84, 0.56) * exp(-aside * 2600.0) * uBeam.w * 0.16 * exp(-along / 240.0) * smoothstep(4.0, 30.0, along);
}`);
    };
    water.customProgramCacheKey = () => 'arcade-sea';
    const surface = new THREE.Mesh(seaGeometry(quality.tier === 'low' ? 72 : 128), water);
    surface.receiveShadow = true;
    surface.frustumCulled = false;
    this.group.add(surface);

    const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.rippleData = new Float32Array(ripples * 2);
    quad.setAttribute('aRipple', new THREE.InstancedBufferAttribute(this.rippleData, 2).setUsage(THREE.DynamicDrawUsage));
    const foamy = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 } as const;
    this.ripples = new THREE.InstancedMesh(quad, new THREE.ShaderMaterial({ vertexShader: RIPPLE_VS, fragmentShader: RIPPLE_FS, uniforms: { uSeaTime: u.uSeaTime, uFoam: u.uFoam }, ...foamy }), ripples);
    this.ripples.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ripples.frustumCulled = false;
    this.ripples.renderOrder = 1;
    this.ripples.count = 0;
    this.wake = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      vertexShader: WAKE_VS, fragmentShader: WAKE_FS, uniforms: { uSeaTime: u.uSeaTime, uFlow: u.uFlow, uFoam: u.uFoam, uStrength: { value: 1 } }, ...foamy,
    }));
    this.wake.renderOrder = 1;
    this.wake.frustumCulled = false;
    this.group.add(this.ripples, this.wake);

    const drops = Math.round(1500 * quality.density) + 300, rng = new Rng(808);
    const drop = new Float32Array(drops * 2 * 4);
    for (let i = 0; i < drops; i++) {
      const x = rng.range(-14, 14), z = rng.range(-14, 14), phase = rng.next();
      drop.set([x, z, phase, 0, x, z, phase, 1], i * 8);
    }
    const streaks = new THREE.BufferGeometry();
    streaks.setAttribute('aDrop', new THREE.BufferAttribute(drop, 4));
    streaks.setAttribute('position', new THREE.BufferAttribute(new Float32Array(drops * 2 * 3), 3));
    this.rain = new THREE.LineSegments(streaks, new THREE.ShaderMaterial({ vertexShader: RAIN_VS, fragmentShader: RAIN_FS, uniforms: this.rainUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rain.renderOrder = 6;
    this.group.add(this.rain);
  }

  private get amp(): number {
    return 0.55 + 1.25 * this.storm;
  }

  height(x: number, z: number): number {
    const flat = 1 - THREE.MathUtils.smoothstep(Math.hypot(x, z), FLAT_FROM, FLAT_BY), pz = z - this.flow;
    let h = 0;
    for (const w of SWELLS) {
      const k = (Math.PI * 2) / w.length;
      h += w.height * Math.sin((w.dir[0] * x + w.dir[1] * pz) * k - this.time * k * w.speed);
    }
    return h * this.amp * flat;
  }

  slope(x: number, z: number, out: { x: number; z: number }): void {
    const e = 0.4;
    out.x = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    out.z = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
  }

  beginRipples(): void {
    this.rippleCount = 0;
  }

  ripple(x: number, z: number, size: number, phase: number, strength = 1): void {
    const i = this.rippleCount;
    if (i >= this.rippleData.length / 2) return;
    this.ripples.setMatrixAt(i, _m.compose(_p.set(x, this.height(x, z) + 0.02, z), FLAT, _s.set(size, 1, size)));
    this.rippleData[i * 2] = phase;
    this.rippleData[i * 2 + 1] = strength;
    this.rippleCount++;
  }

  setWake(width: number, from: number, strength: number): void {
    const long = 9 + width * 1.6;
    this.wake.scale.set(width * 2.6, 1, long);
    this.wake.position.set(0, 0.03, from + long / 2 - 0.4);
    this.wake.material.uniforms.uStrength!.value = strength;
  }

  update(dt: number, camera: THREE.Camera): void {
    const u = this.uniforms, s = this.storm;
    this.time += dt;
    u.uSeaTime.value = this.time;
    u.uFlow.value = this.flow;
    u.uAmp.value = this.amp;
    u.uStorm.value = s;
    u.uLight.value = this.light;
    u.uReach.value = this.reach;
    u.uRing.value = this.ring;
    u.uDeep.value.setRGB(0.006, 0.04, 0.115).lerp(_c.setRGB(0.012, 0.024, 0.05), s);
    u.uShallow.value.setRGB(0.012, 0.2, 0.27).lerp(_c.setRGB(0.03, 0.085, 0.13), s);
    u.uFoam.value.setRGB(0.62, 0.82, 0.92).lerp(_c.setRGB(0.42, 0.5, 0.6), s);
    this.ripples.count = this.rippleCount;
    this.ripples.instanceMatrix.needsUpdate = true;
    (this.ripples.geometry.attributes.aRipple as THREE.InstancedBufferAttribute).needsUpdate = true;
    this.rain.visible = s > 0.02;
    this.rainUniforms.uRain.value = s * 0.36;
    camera.getWorldPosition(this.rainUniforms.uEye.value);
  }
}

const _c = new THREE.Color();
