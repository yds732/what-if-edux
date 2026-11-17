import * as THREE from 'three';
import { blob, merge, place, sweep, tint, v3 } from '../../core/geo';
import { Rng, TAU } from '../../core/math';
import { GLSL_OUTPUT } from '../../render/glsl';
import { makeHalo } from './atmosphere';

/**
 * Paper lanterns that float above Haven's grass, bobbing slowly, each with a few motes of light circling it
 * and fading as they rise. A handful carry a real light, so the grass and stones around them glow warm.
 */
export interface LanternSpot {
  readonly x: number;
  readonly z: number;
  /** Ground height under the lantern. */
  readonly ground: number;
}

export interface Lanterns {
  readonly group: THREE.Group;
  update(time: number, pixelHeight: number): void;
}

const MOTE_VS = /* glsl */ `
attribute vec4 aHome;    // lantern x, rest height, z, bob phase
attribute vec4 aBob;     // bob speed, bob amplitude, orbit radius, orbit speed
attribute vec4 aSeed;    // angle, life rate, life offset, size
uniform float uTime, uPixel;
varying float vAlpha;
void main() {
  // the same bob as the lantern it circles (lanterns.ts update)
  vec3 centre = vec3(aHome.x, aHome.y + sin(uTime * aBob.x + aHome.w) * aBob.y, aHome.z);
  float life = fract(uTime * aSeed.y + aSeed.z);
  float ang = aSeed.x + uTime * aBob.w;
  float r = aBob.z * (0.75 + 0.6 * life);
  vec3 p = centre + vec3(cos(ang) * r, -0.12 + life * 0.75, sin(ang) * r);
  // born from nothing, brightest in the middle of its life, faded before it is gone
  vAlpha = pow(sin(life * 3.14159), 1.4);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(aSeed.w * uPixel * 0.85 / max(-mv.z, 0.4), 48.0);
}`;

const MOTE_FS = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  vec2 q = gl_PointCoord - 0.5; float r = length(q) * 2.0;
  float a = exp(-r * r * 5.0) * vAlpha;
  gl_FragColor = vec4(uColor * a, 1.0);
  ${GLSL_OUTPUT}
}`;

export const buildLanterns = (rng: Rng, spots: readonly LanternSpot[], opts: { motesEach: number; lights: number }): Lanterns => {
  const group = new THREE.Group();

  // a round paper lantern: a bellied shade between two small dark caps, a little loop on top
  const shade = sweep([v3(0, 0, 0), v3(0, 0.38, 0)], (k) => 0.11 + 0.09 * Math.sin(k * Math.PI), { radial: 12, steps: 8, startCap: 'flat', endCap: 'flat' });
  const geo = merge([
    tint(shade, 0xf6b070),
    tint(place(blob(0.085, 0.022, 0.085, 1), [0, 0.39, 0]), 0x6a3a30),
    tint(place(blob(0.075, 0.02, 0.075, 1), [0, -0.01, 0]), 0x6a3a30),
    tint(place(blob(0.018, 0.04, 0.018, 1), [0, 0.44, 0]), 0x6a3a30),
  ]);
  geo.translate(0, -0.19, 0);
  // lit from inside: the shade glows, brightest at its widest
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  mat.color.setScalar(1.85);

  const lanterns: { object: THREE.Object3D; home: THREE.Vector3; speed: number; amp: number; phase: number; sway: number }[] = [];
  const lightCount = Math.min(opts.lights, spots.length);
  let lit = 0;
  for (const [i, s] of spots.entries()) {
    const object = new THREE.Group();
    const home = new THREE.Vector3(s.x, s.ground + rng.range(1.55, 2.45), s.z);
    object.position.copy(home);
    object.add(new THREE.Mesh(geo, mat));
    object.add(makeHalo(0xffb866, rng.range(1.5, 1.9), 0.42));
    object.add(makeHalo(0xffd9a0, 0.55, 0.9));
    // spread the few real lights evenly through the list, so they fall along the path and around the island
    if (lightCount > 0 && i % Math.max(1, Math.floor(spots.length / lightCount)) === 0 && lit < lightCount) {
      object.add(new THREE.PointLight(0xffb36a, 3.2, 6.5, 1.7));
      lit++;
    }
    group.add(object);
    lanterns.push({ object, home, speed: rng.range(0.7, 1.15), amp: rng.range(0.1, 0.18), phase: rng.range(0, TAU), sway: rng.range(0.25, 0.45) });
  }

  // the motes: one draw call for every lantern's little circle of light
  const n = spots.length * opts.motesEach;
  const home = new Float32Array(n * 4), bob = new Float32Array(n * 4), seed = new Float32Array(n * 4);
  let k = 0;
  for (const l of lanterns) {
    for (let j = 0; j < opts.motesEach; j++, k++) {
      home.set([l.home.x, l.home.y, l.home.z, l.phase], k * 4);
      bob.set([l.speed, l.amp, rng.range(0.22, 0.42), rng.range(0.35, 0.8) * (rng.chance(0.5) ? 1 : -1)], k * 4);
      seed.set([rng.range(0, TAU), rng.range(0.18, 0.34), rng.next(), rng.range(0.06, 0.11)], k * 4);
    }
  }
  const mg = new THREE.BufferGeometry();
  // positions are worked out in the shader; this only gives three.js a count
  mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  mg.setAttribute('aHome', new THREE.BufferAttribute(home, 4));
  mg.setAttribute('aBob', new THREE.BufferAttribute(bob, 4));
  mg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const uniforms = { uTime: { value: 0 }, uPixel: { value: 1080 }, uColor: { value: new THREE.Color(1.0, 0.78, 0.42).multiplyScalar(3.2) } };
  const motes = new THREE.Points(mg, new THREE.ShaderMaterial({
    vertexShader: MOTE_VS, fragmentShader: MOTE_FS, uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  motes.frustumCulled = false;
  group.add(motes);

  return {
    group,
    update(time, pixelHeight) {
      uniforms.uTime.value = time;
      uniforms.uPixel.value = pixelHeight;
      for (const l of lanterns) {
        l.object.position.y = l.home.y + Math.sin(time * l.speed + l.phase) * l.amp;
        // a lantern on a breath of air turns and tips a little
        l.object.rotation.set(Math.sin(time * 0.5 + l.phase) * 0.05, time * 0.12 * l.sway + l.phase, Math.cos(time * 0.43 + l.phase) * 0.05);
      }
    },
  };
};
