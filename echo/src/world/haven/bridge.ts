import * as THREE from 'three';
import { addGlow } from '../../assets/glow';
import { merge, place, v3 } from '../../core/geo';
import { TAU, damp } from '../../core/math';
import { GLSL_NOISE, GLSL_OUTPUT } from '../../render/glsl';

/** Centres of the three rings of the Star Bridge challenge, near to far. */
export const RING_POINTS = [new THREE.Vector3(2.3, 2.8, -12.8), new THREE.Vector3(-3.1, 4.0, -18.6), new THREE.Vector3(1.1, 5.4, -25.2)] as const;
export const RING_RADIUS = 1.25;

const TILES = 40;
/** Tiles that already stand when the player first arrives: the bridge is begun, not absent. */
const STUB = 4;
const GOLD = new THREE.Color(1.0, 0.74, 0.32);

const TILE_VS = /* glsl */ `
attribute float aTile; attribute vec3 aCenter;
uniform float uReveal, uTime;
varying vec2 vUv; varying float vBuilt, vTile;
void main(){
  vUv = uv; vTile = aTile;
  float k = clamp(uReveal - aTile, 0.0, 1.0);
  vBuilt = k;
  float pop = 1.0 + 2.2 * pow(k - 1.0, 3.0) + 1.2 * pow(k - 1.0, 2.0);      // overshoot, then settle
  float s = mix(0.86, pop, step(0.001, k));
  vec3 p = aCenter + (position - aCenter) * s;
  p.y += (1.0 - k) * -0.18 + sin(uTime * 1.1 + aTile * 0.7) * 0.02 * k;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const TILE_FS = /* glsl */ `
uniform float uTime, uFestival; uniform vec3 uGold;
varying vec2 vUv; varying float vBuilt, vTile;
float sdBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float sdStar(vec2 p, float r){
  const vec2 k1 = vec2(0.809016994375, -0.587785252292), k2 = vec2(-0.809016994375, -0.587785252292);
  p.x = abs(p.x); p -= 2.0 * max(dot(k1, p), 0.0) * k1; p -= 2.0 * max(dot(k2, p), 0.0) * k2; p.x = abs(p.x);
  p.y -= r;
  vec2 ba = 0.46 * vec2(0.587785252292, 0.809016994375) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
void main(){
  vec2 q = vUv * 2.0 - 1.0;
  float box = sdBox(q, vec2(0.93, 0.86), 0.2);
  float inside = 1.0 - smoothstep(-0.02, 0.02, box);
  if (inside < 0.01) discard;
  float edge = 1.0 - smoothstep(0.0, 0.085, abs(box + 0.07));
  float star = 1.0 - smoothstep(-0.01, 0.02, sdStar(q * vec2(1.0, 1.15), 0.42));
  float starLine = 1.0 - smoothstep(0.0, 0.03, abs(sdStar(q * vec2(1.0, 1.15), 0.56)));
  float sheen = 0.5 + 0.5 * sin(uTime * 1.6 - vTile * 0.55);
  // built: a pane of warm light. unbuilt: only the ghost of where it will be
  vec3 lit = uGold * (0.5 + edge * 3.4 + star * (1.3 + 1.2 * sheen) + starLine * 1.5) + vec3(1.0, 0.9, 0.75) * edge * 1.2;
  float litA = 0.34 + 0.6 * max(edge, star * 0.85);
  vec3 ghost = mix(vec3(0.55, 0.5, 1.0), uGold, 0.3) * (edge * 0.7 + starLine * 0.25);
  float ghostA = (0.035 + edge * 0.5 + starLine * 0.16) * (0.55 + 0.45 * sin(uTime * 1.3 - vTile * 0.5));
  float flash = vBuilt * (1.0 - vBuilt) * 4.0;
  vec3 c = mix(ghost, lit, vBuilt) + vec3(1.0, 0.95, 0.8) * flash * 5.0 + uGold * uFestival * star * 1.2 * vBuilt;
  gl_FragColor = vec4(c, mix(ghostA, litA, vBuilt) * inside);
  ${GLSL_OUTPUT}
}`;

const FILM_VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FILM_FS = /* glsl */ `
${GLSL_NOISE}
uniform float uTime, uPower; uniform vec3 uColor;
varying vec2 vUv;
void main(){
  vec2 q = vUv * 2.0 - 1.0; float r = length(q);
  if (r > 1.0) discard;
  float n = fbm2(q * 2.4 + vec2(uTime * 0.25, -uTime * 0.18));
  float rimGlow = pow(r, 3.0);
  float a = (0.02 + 0.2 * rimGlow + 0.07 * smoothstep(0.45, 0.8, n)) * uPower;
  gl_FragColor = vec4(uColor * (0.3 + 0.9 * rimGlow + 0.5 * n) * a * 3.0, 1.0);
  ${GLSL_OUTPUT}
}`;

export type RingState = 'dormant' | 'target' | 'lit';

const _v = new THREE.Vector3();

/** Middle and size of the hole through a ring-shaped model that faces +Z and stands on its origin. */
const openingOf = (model: THREE.Object3D): { centreY: number; radius: number } => {
  model.updateMatrixWorld(true);
  const centreY = new THREE.Box3().setFromObject(model).getCenter(_v).y;
  let radius = Infinity;
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const position = (o.geometry as THREE.BufferGeometry).getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      _v.fromBufferAttribute(position, i).applyMatrix4(o.matrixWorld);
      radius = Math.min(radius, Math.hypot(_v.x, _v.y - centreY));
    }
  });
  return { centreY, radius };
};

export class Ring {
  readonly group = new THREE.Group();
  readonly center: THREE.Vector3;
  /** Unit normal of the ring's plane, pointing back toward the plaza. */
  readonly normal: THREE.Vector3;
  readonly radius: number;
  state: RingState = 'dormant';
  private readonly hoopMat: THREE.MeshStandardMaterial;
  /** The hoop's painted gold and opal, which shine brighter as the ring wakes. */
  private readonly paint: { value: number };
  private readonly filmU = { uTime: { value: 0 }, uPower: { value: 1 }, uColor: { value: GOLD.clone() } };
  private readonly dashes: THREE.Mesh;
  private pulse = 0;
  private glow = 0.5;
  private flash = 0;

  /** `hoop` is a copy of the ring model, which this ring keeps: it is sized so that its opening is `radius`. */
  constructor(center: THREE.Vector3, facing: THREE.Vector3, hoop: THREE.Object3D, radius = RING_RADIUS) {
    this.center = center.clone();
    this.radius = radius;
    this.normal = facing.clone().sub(center).setY(0).normalize();
    this.group.position.copy(center);
    this.group.lookAt(center.clone().add(this.normal));

    const opening = openingOf(hoop);
    const scale = radius / opening.radius;
    hoop.scale.setScalar(scale);
    hoop.position.y = -opening.centreY * scale;
    let material: THREE.MeshStandardMaterial | null = null, paint: { value: number } | null = null;
    hoop.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      // every ring wakes on its own, so each has a material of its own
      if (!material) {
        material = (o.material as THREE.MeshStandardMaterial).clone();
        material.emissive.copy(GOLD);
        paint = addGlow(material, { strength: 1, vivid: 0.46 });
      }
      o.material = material;
      o.castShadow = false;
    });
    if (!material || !paint) throw new Error('the ring model has no mesh');
    this.hoopMat = material;
    this.paint = paint;
    this.group.add(hoop);

    const film = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), new THREE.ShaderMaterial({
      vertexShader: FILM_VS, fragmentShader: FILM_FS, uniforms: this.filmU, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    }));
    this.group.add(film);

    // a slowly turning dashed halo marks the ring to aim for
    const dashGeo: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      dashGeo.push(place(new THREE.BoxGeometry(0.22, 0.035, 0.02), [Math.cos(a) * (radius + 0.42), Math.sin(a) * (radius + 0.42), 0], [0, 0, a + Math.PI / 2]));
    }
    const dashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.9, 0.7).multiplyScalar(2.2), transparent: true, opacity: 0, depthWrite: false });
    this.dashes = new THREE.Mesh(merge(dashGeo.map((g) => { g.deleteAttribute('uv'); return g; })), dashMat);
    this.group.add(this.dashes);
  }

  /** `quiet` changes the state without the flash of a fresh hit (used when a scene is being arranged). */
  setState(state: RingState, quiet = false): void {
    if (state === 'lit' && this.state !== 'lit' && !quiet) this.flash = 1;
    this.state = state;
  }

  /** Moves the ring; its plane keeps facing the way it was built to face. */
  moveTo(center: THREE.Vector3): void {
    this.center.copy(center);
    this.group.position.copy(center);
  }

  update(dt: number, time: number): void {
    this.pulse += dt;
    const target = this.state === 'target' ? 2.6 + 1.1 * Math.sin(this.pulse * 3.2) : this.state === 'lit' ? 4.2 : 0.75;
    this.glow = damp(this.glow, target, 6, dt);
    this.flash = Math.max(0, this.flash - dt * 1.6);
    const level = this.glow + this.flash * 14;
    // asleep, a ring is its own gold and opal; it only gives off light once it is the one to aim for
    this.hoopMat.emissiveIntensity = 0.014 * Math.max(0, level - 0.75);
    this.paint.value = 0.1 + 0.42 * Math.max(0, level - 0.75);
    this.filmU.uTime.value = time;
    this.filmU.uPower.value = damp(this.filmU.uPower.value, this.state === 'lit' ? 0.25 : this.state === 'target' ? 1.5 : 0.7, 5, dt) + this.flash * 3;
    const dashMat = this.dashes.material as THREE.MeshBasicMaterial;
    dashMat.opacity = damp(dashMat.opacity, this.state === 'target' ? 0.9 : 0, 6, dt);
    this.dashes.rotation.z = time * 0.35;
    const s = 1 + this.flash * 0.12 + (this.state === 'target' ? 0.015 * Math.sin(this.pulse * 3.2) : 0);
    this.group.scale.setScalar(s);
  }
}

export interface StarBridge {
  readonly group: THREE.Group;
  readonly rings: Ring[];
  readonly path: THREE.CatmullRomCurve3;
  /** 0..3: how many sections stand. Fractions are mid-build. */
  built: number;
  /** Sets the target number of sections; the deck grows toward it tile by tile. */
  setSections(n: number, immediate?: boolean): void;
  setFestival(k: number): void;
  update(dt: number, time: number): void;
}

/** `hoops` are three copies of the ring model, one for each ring. */
export const buildStarBridge = (start: THREE.Vector3, end: THREE.Vector3, hoops: readonly THREE.Object3D[]): StarBridge => {
  const group = new THREE.Group();
  // the deck runs through the foot of each ring, like a road through a gate
  const under = (p: THREE.Vector3): THREE.Vector3 => v3(p.x, p.y - 2.05, p.z);
  const path = new THREE.CatmullRomCurve3([
    start.clone(), under(RING_POINTS[0]), under(RING_POINTS[1]), under(RING_POINTS[2]), v3(0.4, lerpY(start, end, 0.68), start.z + (end.z - start.z) * 0.68), end.clone(),
  ], false, 'centripetal');

  // deck: one quad per tile, laid along the path
  const pos: number[] = [], uv: number[] = [], tile: number[] = [], center: number[] = [], idx: number[] = [];
  const W = 1.35, up = v3(0, 1, 0);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), t = new THREE.Vector3(), side = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < TILES; i++) {
    const u0 = (i + 0.06) / TILES, u1 = (i + 0.94) / TILES;
    path.getPointAt(u0, a);
    path.getPointAt(u1, b);
    t.subVectors(b, a).normalize();
    side.crossVectors(t, up).normalize();
    c.addVectors(a, b).multiplyScalar(0.5);
    const base = pos.length / 3;
    for (const [p, v] of [[a, 0], [b, 1]] as const) {
      for (const s of [-1, 1]) {
        pos.push(p.x + side.x * W * s, p.y, p.z + side.z * W * s);
        uv.push(s * 0.5 + 0.5, v);
        tile.push(i);
        center.push(c.x, c.y, c.z);
      }
    }
    idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
  const deckGeo = new THREE.BufferGeometry();
  deckGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  deckGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  deckGeo.setAttribute('aTile', new THREE.Float32BufferAttribute(tile, 1));
  deckGeo.setAttribute('aCenter', new THREE.Float32BufferAttribute(center, 3));
  deckGeo.setIndex(idx);
  const deckU = { uReveal: { value: 0 }, uTime: { value: 0 }, uFestival: { value: 0 }, uGold: { value: GOLD.clone() } };
  const deck = new THREE.Mesh(deckGeo, new THREE.ShaderMaterial({ vertexShader: TILE_VS, fragmentShader: TILE_FS, uniforms: deckU, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  deck.frustumCulled = false;
  deck.renderOrder = 2;
  group.add(deck);

  const rings = RING_POINTS.map((p, i) => new Ring(p, start, hoops[i]!));
  for (const r of rings) group.add(r.group);

  let target = 0;
  const revealFor = (sections: number): number => STUB + (sections / 3) * (TILES - STUB) + (sections >= 3 ? 1 : 0);
  deckU.uReveal.value = revealFor(0);
  const bridge: StarBridge = {
    group, rings, path, built: 0,
    setSections(n, immediate = false) {
      target = n;
      if (immediate) {
        bridge.built = n;
        deckU.uReveal.value = revealFor(n);
      }
    },
    setFestival(k) {
      deckU.uFestival.value = k;
    },
    update(dt, time) {
      deckU.uTime.value = time;
      const want = revealFor(target);
      // tiles arrive one after another: about a third of a second each, faster for long stretches
      const speed = Math.max(9, Math.abs(want - deckU.uReveal.value) * 1.6);
      deckU.uReveal.value += Math.sign(want - deckU.uReveal.value) * Math.min(Math.abs(want - deckU.uReveal.value), speed * dt);
      bridge.built = (Math.max(0, deckU.uReveal.value - STUB) / (TILES - STUB)) * 3;
      for (const r of rings) r.update(dt, time);
    },
  };
  return bridge;
};

const lerpY = (a: THREE.Vector3, b: THREE.Vector3, k: number): number => a.y + (b.y - a.y) * k;

// ---------------------------------------------------------------------------------------------------- gateway

const PORTAL_FS = /* glsl */ `
${GLSL_NOISE}
uniform float uTime, uOpen; uniform vec3 uColor;
varying vec2 vUv;
void main(){
  vec2 q = vUv * 2.0 - 1.0;
  float arch = smoothstep(1.0, 0.9, length(vec2(q.x, max(q.y - 0.15, 0.0) * 1.25))) * smoothstep(-1.0, -0.96, q.y) * step(abs(q.x), 1.0);
  if (arch < 0.01) discard;
  float swirl = fbm2(vec2(atan(q.y, q.x) * 1.4 + uTime * 0.2, length(q) * 3.0 - uTime * 0.45));
  float core = exp(-dot(q, q) * 1.6);
  vec3 c = uColor * (0.25 + swirl * 0.9 + core * (0.6 + 5.0 * uOpen)) + vec3(1.0, 0.95, 0.85) * core * uOpen * 6.0;
  gl_FragColor = vec4(c, arch * (0.5 + 0.5 * uOpen + 0.3 * swirl));
  ${GLSL_OUTPUT}
}`;

export interface Gateway {
  readonly group: THREE.Group;
  /** 0 dormant .. 1 open. */
  setOpen(k: number): void;
  update(dt: number, time: number): void;
}

/** The gateway model is made this many times its own size: it has to be seen from the far end of the bridge. */
const GATEWAY_SCALE = 1.5;
/** The arch's opening in the model, in its own metres: half its width, its threshold and its peak. */
const ARCH = { halfWidth: 1.07, floor: 0.79, top: 5.05 };

/** `model` is a copy of the gateway model, which the gateway keeps. */
export const buildGateway = (model: THREE.Object3D): Gateway => {
  const group = new THREE.Group();
  model.scale.setScalar(GATEWAY_SCALE);
  group.add(model);

  const portalU = { uTime: { value: 0 }, uOpen: { value: 0 }, uColor: { value: new THREE.Color(0.55, 0.75, 1.0) } };
  // the portal fills the arch, a little over its edges so that no gap shows
  const wide = ARCH.halfWidth * 2 * GATEWAY_SCALE * 1.12, tall = (ARCH.top - ARCH.floor) * GATEWAY_SCALE * 1.04;
  const portal = new THREE.Mesh(new THREE.PlaneGeometry(wide, tall), new THREE.ShaderMaterial({
    vertexShader: FILM_VS, fragmentShader: PORTAL_FS, uniforms: portalU, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  }));
  portal.position.set(0, ARCH.floor * GATEWAY_SCALE + tall / 2, 0);
  group.add(portal);

  // a star turning above the keystone
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.85, 0.5).multiplyScalar(3) }));
  star.position.set(0, 6.2 * GATEWAY_SCALE + 0.7, 0);
  star.scale.set(0.7, 1.4, 0.7);
  group.add(star);

  let open = 0, shown = 0;
  return {
    group,
    setOpen(k) {
      open = k;
    },
    update(dt, time) {
      shown = damp(shown, open, 2.2, dt);
      portalU.uTime.value = time;
      portalU.uOpen.value = shown;
      star.rotation.y = time * 0.7;
      (star.material as THREE.MeshBasicMaterial).color.setRGB(1, 0.85, 0.5).multiplyScalar(3 + shown * 5 + Math.sin(time * 2) * 0.4);
    },
  };
};
