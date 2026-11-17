import * as THREE from 'three';
import { Rng, TAU } from '../core/math';
import { GLSL_NOISE, GLSL_OUTPUT } from '../render/glsl';

/**
 * The city of 2080 as seen through a window: a sky that runs from late afternoon to night, ranks of towers
 * whose windows come on as it darkens, and traffic threading the air between them. Built to sit behind glass:
 * one group, a handful of draw calls.
 */
export interface Cityscape {
  readonly group: THREE.Group;
  /** 0 is a warm afternoon, 1 is night. */
  setNight(k: number): void;
  /** 0 leaves the sky as setNight paints it; 1 is a flat grey overcast in which neither the day nor the night shows. */
  setOvercast(k: number): void;
  update(time: number): void;
}

const SKY_VS = /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FS = /* glsl */ `
${GLSL_NOISE}
uniform float uNight, uTime, uOvercast; uniform vec3 uSunDir;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir); float h = d.y;
  vec3 dayTop = vec3(0.24, 0.42, 0.78), dayLow = vec3(1.0, 0.72, 0.5), nightTop = vec3(0.012, 0.02, 0.07), nightLow = vec3(0.2, 0.12, 0.32);
  vec3 top = mix(dayTop, nightTop, uNight), low = mix(dayLow, nightLow, uNight);
  vec3 c = mix(low, top, smoothstep(-0.02, 0.6, h));
  float sun = max(dot(d, normalize(uSunDir)), 0.0);
  c += mix(vec3(1.0, 0.62, 0.3), vec3(0.5, 0.2, 0.5), uNight) * (pow(sun, 6.0) * 0.6 + pow(sun, 60.0) * 2.0 * (1.0 - uNight));
  // long evening clouds
  float cl = fbm2(vec2(d.x * 3.0 + uTime * 0.004, h * 14.0)) * smoothstep(0.02, 0.2, h) * smoothstep(0.7, 0.25, h);
  c = mix(c, mix(vec3(1.0, 0.8, 0.68), vec3(0.16, 0.13, 0.3), uNight), smoothstep(0.45, 0.8, cl) * 0.55);
  float star = step(0.9965, hash12(floor(d.xy * 260.0 + d.z * 97.0))) * uNight * smoothstep(0.15, 0.5, h);
  c += vec3(star) * 1.4;
  // overcast: one even grey lid of cloud, a little paler toward the horizon, soft lumps in it
  vec3 grey = mix(vec3(0.5, 0.51, 0.53), vec3(0.37, 0.39, 0.42), smoothstep(-0.02, 0.6, h)) * (0.94 + 0.12 * cl);
  c = mix(c, grey, uOvercast);
  gl_FragColor = vec4(c, 1.0);
  ${GLSL_OUTPUT}
}`;

const TOWER_VS_PARS = /* glsl */ `
attribute vec4 aTower;   // seed, lit fraction at night, facade style, 1 for a bare mast
varying vec3 vTowerPos, vTowerUnit, vTowerN, vTowerWN, vTowerAt; varying vec4 vTower;
`;
const TOWER_VS = /* glsl */ `
vTowerUnit = position;
vTowerPos = position * vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
vTowerN = normal;
vTowerWN = normalize(mat3(instanceMatrix) * normal);
vTowerAt = (instanceMatrix * vec4(position, 1.0)).xyz;
vTower = aTower;
`;
const TOWER_FS_PARS = /* glsl */ `
${GLSL_NOISE}
uniform float uNight, uTime, uOvercast; uniform vec3 uSunDir;
varying vec3 vTowerPos, vTowerUnit, vTowerN, vTowerWN, vTowerAt; varying vec4 vTower;
`;
/**
 * The towers are a painted backdrop with a light of their own: nothing in the room reaches them. A low sun
 * behind the skyline warms the faces that see it, the sky cools the rest, and distance takes everything
 * toward the colour of the horizon.
 */
const TOWER_FS = /* glsl */ `
{
  vec3 albedo = diffuseColor.rgb;
  vec3 n = normalize(vTowerWN);
  vec3 an = abs(vTowerN);
  bool alongZ = an.x > an.z;
  float across = alongZ ? vTowerPos.z : vTowerPos.x;
  float edge = abs(alongZ ? vTowerUnit.z : vTowerUnit.x);
  float wall = step(an.y, 0.5) * (1.0 - vTower.w);

  // the window grid lives in the tower's own space, so it never swims; its size and kind vary by tower
  vec2 cell = vec2(across, vTowerPos.y) / mix(vec2(2.3, 3.2), vec2(3.6, 3.9), fract(vTower.z * 7.0));
  vec2 id = floor(cell), f = fract(cell);
  float ribbon = step(0.6, vTower.z);
  // far away the grid is finer than a pixel: settle it to its average instead of letting it sparkle
  float detail = 1.0 - smoothstep(0.4, 1.0, max(fwidth(cell.x), fwidth(cell.y)));
  // no glass on the plant floor under the roof, nor in the solid corner at each end of a face
  float glazed = wall * (1.0 - smoothstep(0.93, 0.95, vTowerUnit.y)) * (1.0 - smoothstep(0.465, 0.49, edge));
  float bay = mix(step(0.14, f.x) * step(f.x, 0.86), 1.0, ribbon);
  float pane = mix(mix(0.42, 0.58, ribbon), bay * step(0.22, f.y) * step(f.y, 0.8), detail) * glazed;
  float chance = mix(mix(0.07, vTower.y, uNight), 0.1, uOvercast);
  float lit = mix(chance, step(hash12(id + vTower.x * 91.0), chance), detail);

  float day = (1.0 - uNight) * (1.0 - uNight) * (1.0 - uOvercast);
  float ndl = dot(n, normalize(uSunDir));
  vec3 skyLight = mix(mix(vec3(0.46, 0.56, 0.86), vec3(0.035, 0.045, 0.11), uNight), vec3(0.4, 0.41, 0.44), uOvercast) * mix(0.6, 1.0, n.y * 0.5 + 0.5);
  vec3 sunLight = vec3(2.1, 1.2, 0.62) * day * smoothstep(-0.15, 0.55, ndl);
  vec3 bounce = vec3(0.5, 0.34, 0.26) * day * 0.35;
  vec3 glass = mix(mix(albedo * 0.36 + vec3(0.07, 0.1, 0.17), vec3(0.02, 0.025, 0.05), uNight), albedo * 0.3 + vec3(0.07, 0.075, 0.085), uOvercast);
  vec3 c = mix(albedo, glass, pane) * (skyLight + sunLight + bounce);
  // shade gathers in the corners of a face, and a line of shadow sits under every floor
  c *= mix(1.0, 0.8, smoothstep(0.36, 0.5, edge) * wall);
  c *= 1.0 - 0.2 * detail * wall * (1.0 - step(0.07, f.y));
  // glass that faces the sun flares
  c += vec3(1.6, 1.0, 0.6) * day * pane * pow(max(ndl, 0.0), 4.0) * 0.35;
  // rooms with their lights on
  vec3 room = mix(vec3(0.94, 0.8, 0.62), mix(vec3(1.0, 0.78, 0.5), vec3(0.6, 0.85, 1.0), step(0.72, hash12(id * 1.7 + vTower.x))), detail);
  float flicker = mix(1.0, 0.85 + 0.15 * sin(uTime * 0.4 + hash12(id) * 40.0), detail);
  c += room * pane * lit * flicker * mix(mix(0.22, 2.0, uNight), 0.2, uOvercast);

  float haze = 1.0 - exp(-length(vTowerAt.xz) * mix(0.0022, 0.0015, uNight));
  haze = clamp(haze + (1.0 - smoothstep(-110.0, 30.0, vTowerAt.y)) * 0.34, 0.0, 0.94);
  outgoingLight = mix(c, mix(mix(vec3(0.98, 0.72, 0.55), vec3(0.1, 0.075, 0.19), uNight), vec3(0.47, 0.48, 0.5), uOvercast), haze);
}
`;

export const buildCityscape = (rng: Rng, density = 1): Cityscape => {
  const group = new THREE.Group();
  const u = { uNight: { value: 0 }, uOvercast: { value: 0 }, uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(-0.5, 0.16, -1).normalize() } };

  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, uniforms: u, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  group.add(sky);

  // towers: three ranks receding from the window, taller toward the back; some step in to a crown, some carry a mast
  const count = Math.round(170 * density);
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const mat = new THREE.MeshBasicMaterial({ fog: false });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${TOWER_VS_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${TOWER_VS}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TOWER_FS_PARS}`)
      .replace('#include <opaque_fragment>', `${TOWER_FS}\n#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'echo-tower';
  const towers = new THREE.InstancedMesh(box, mat, count * 3);
  const seeds = new Float32Array(count * 3 * 4);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const tint = new THREE.Color();
  const beacons: number[] = [];
  let used = 0;
  const block = (seed: readonly [number, number, number, number]): void => {
    towers.setMatrixAt(used, m.compose(p, q, s));
    towers.setColorAt(used, tint);
    seeds.set(seed, used * 4);
    used++;
  };
  for (let i = 0; i < count; i++) {
    const rank = i % 3;
    const dist = [150, 270, 460][rank]! * rng.range(0.8, 1.25);
    const angle = rng.range(-1.25, 1.25);
    const w = rng.range(16, 34) * (1 + rank * 0.4), d = rng.range(16, 34) * (1 + rank * 0.4);
    const h = rng.range(70, 150) * (1 + rank * 0.55) * (rng.chance(0.14) ? 1.6 : 1);
    const x = Math.sin(angle) * dist, z = -Math.cos(angle) * dist;
    const seed = [rng.next(), rng.range(0.18, 0.5), rng.next(), 0] as const;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, TAU));
    // mostly cool glass and steel, with the odd tower of warm stone
    tint.setHSL(rng.chance(0.26) ? rng.range(0.05, 0.1) : rng.range(0.55, 0.68), rng.range(0.07, 0.24), rng.range(0.42, 0.72));
    p.set(x, -120, z);
    s.set(w, h, d);
    block(seed);
    let top = -120 + h;
    if (rng.chance(0.55)) {
      const k = rng.range(0.5, 0.78), crown = h * rng.range(0.1, 0.26);
      p.set(x, top, z);
      s.set(w * k, crown, d * k);
      block(seed);
      top += crown;
    }
    if (rng.chance(0.3)) {
      const mast = rng.range(22, 58);
      p.set(x, top, z);
      s.set(1.5, mast, 1.5);
      block([seed[0], 0, 0, 1]);
      beacons.push(x, top + mast + 1, z);
    }
  }
  towers.count = used;
  box.setAttribute('aTower', new THREE.InstancedBufferAttribute(seeds, 4));
  towers.frustumCulled = false;
  group.add(towers);

  // air traffic: strings of lights moving along lanes between the towers; and a red beacon on every mast
  const lanes = Math.round(90 * density), N = lanes + beacons.length / 3;
  const lanePos = new Float32Array(N * 3), laneSeed = new Float32Array(N * 4);
  for (let i = 0; i < lanes; i++) {
    lanePos.set([rng.range(-240, 240), rng.range(-60, 60), rng.range(-420, -110)], i * 3);
    laneSeed.set([rng.next(), rng.range(8, 22) * rng.sign(), rng.range(0.6, 1.4), rng.next()], i * 4);
  }
  lanePos.set(beacons, lanes * 3);
  // speed 0 marks a beacon: it stays put, glows red and blinks
  for (let i = lanes; i < N; i++) laneSeed.set([rng.next(), 0, 1.5, 1], i * 4);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(lanePos, 3));
  lg.setAttribute('aSeed', new THREE.BufferAttribute(laneSeed, 4));
  const lights = new THREE.Points(lg, new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: /* glsl */ `
      attribute vec4 aSeed; uniform float uTime; varying float vHue, vGlow;
      void main(){
        vec3 p = position;
        bool beacon = aSeed.y == 0.0;
        if (!beacon) p.x = mod(p.x + uTime * aSeed.y + 240.0, 480.0) - 240.0;
        vGlow = beacon ? smoothstep(0.5, 0.95, sin(uTime * 2.1 + aSeed.x * 40.0)) : 1.0;
        vHue = aSeed.w;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(520.0 * aSeed.z / max(-mv.z, 1.0), 1.5, 7.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight, uOvercast; varying float vHue, vGlow;
      void main(){
        float r = length(gl_PointCoord - 0.5) * 2.0;
        vec3 c = mix(vec3(1.0, 0.86, 0.6), vec3(1.0, 0.3, 0.3), step(0.6, vHue));
        gl_FragColor = vec4(c * exp(-r * r * 4.0) * mix(mix(0.5, 2.2, uNight), 0.35, uOvercast) * vGlow, 1.0);
        ${GLSL_OUTPUT}
      }`,
  }));
  lights.frustumCulled = false;
  group.add(lights);

  return {
    group,
    setNight(k) {
      u.uNight.value = k;
    },
    setOvercast(k) {
      u.uOvercast.value = k;
    },
    update(time) {
      u.uTime.value = time;
    },
  };
};
