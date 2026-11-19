import * as THREE from 'three';
import { MINIGAMES, MINIGAME_IDS, type MinigameId } from '../../arcade/registry';
import { v3 } from '../../core/geo';
import { Rng, TAU, damp } from '../../core/math';
import { GLSL_NOISE, GLSL_OUTPUT } from '../../render/glsl';
import { Panel } from '../../ui/Panel';
import { THEMES, displayFont, font, roundRect, spaced, sparkle } from '../../ui/draw';
import { Disc, Walkway, type Colliders } from '../colliders';
import { dress, sizeOf, type Spot } from '../dressing';
import { anchorToward, type Anchor, type BuildContext } from '../World';
import { makeHalo } from './atmosphere';
import { buildGlowFlowers, buildGrass } from './flora';
import { buildIsland, type Island } from './islands';

export const ARCADE_ISLE = {
  centre: new THREE.Vector3(0, 0, 29),
  radius: 9.6,
  plaza: 7.5,
  gateRing: 6.15,
  gateArc: 78,
} as const;

const GATE = { openingY: 1.6, openingWide: 0.98, openingTall: 1.12, base: 1.5 };
const BRIDGE_WIDE = 2.2;
const BRIDGE_LIGHT = new THREE.Color(0.45, 0.84, 1.0);

const FILM_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FILM_FS = `
${GLSL_NOISE}
uniform float uTime, uOpen, uNear; uniform vec3 uColor;
varying vec2 vUv;
void main(){
  vec2 q = vUv * 2.0 - 1.0; float r = length(q);
  if (r > 1.0) discard;
  float a = atan(q.y, q.x);
  vec2 around = vec2(cos(a), sin(a));
  float drift = fbm2(around * 1.4 + vec2(r * 3.0 - uTime * 0.22, uTime * 0.13));
  float arms = 0.5 + 0.5 * sin(a * 3.0 + r * 8.0 - uTime * (1.0 + 0.8 * uNear) + drift * 5.0);
  arms = smoothstep(0.15, 0.95, arms);
  float core = exp(-r * r * (7.0 - 3.0 * uNear));
  float rim = smoothstep(0.7, 1.0, r);
  float sparkles = smoothstep(0.985, 1.0, vnoise(q * 34.0 + vec2(uTime * 0.6, -uTime * 0.4))) * (1.0 - r);
  vec3 lit = uColor * (0.18 + 1.6 * arms * (1.0 - 0.55 * r) + 2.6 * rim) + vec3(1.0, 0.96, 0.9) * (core * (2.2 + 1.6 * uNear) + sparkles * 6.0);
  vec3 ghost = uColor * (0.05 + 0.25 * rim + 0.06 * arms);
  float edge = smoothstep(1.0, 0.94, r);
  float litA = (0.62 + 0.3 * arms + 0.4 * core) * edge;
  float ghostA = (0.05 + 0.22 * rim) * edge;
  gl_FragColor = vec4(mix(ghost, lit, uOpen), mix(ghostA, min(litA, 0.97), uOpen));
  ${GLSL_OUTPUT}
}`;

const DECK_VS = `
attribute float aTile;
uniform float uTime, uReveal;
varying vec2 vUv; varying float vTile, vBuilt;
void main(){
  vUv = uv; vTile = aTile;
  vBuilt = clamp(uReveal - aTile, 0.0, 1.0);
  vec3 p = position;
  p.y += (1.0 - vBuilt) * -0.25 + sin(uTime * 1.1 + aTile * 0.7) * 0.015 * vBuilt;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const DECK_FS = `
uniform float uTime; uniform vec3 uLight;
varying vec2 vUv; varying float vTile, vBuilt;
float sdBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main(){
  vec2 q = vUv * 2.0 - 1.0;
  float box = sdBox(q, vec2(0.95, 0.86), 0.22);
  float inside = 1.0 - smoothstep(-0.02, 0.02, box);
  if (inside < 0.01 || vBuilt < 0.002) discard;
  float edge = 1.0 - smoothstep(0.0, 0.09, abs(box + 0.07));
  float sheen = 0.5 + 0.5 * sin(uTime * 1.6 - vTile * 0.7);
  float diamond = 1.0 - smoothstep(0.0, 0.05, abs(abs(q.x) + abs(q.y) - 0.42));
  float flash = vBuilt * (1.0 - vBuilt) * 4.0;
  vec3 c = uLight * (0.45 + edge * 3.2 + diamond * (0.9 + 1.1 * sheen)) + vec3(0.85, 0.95, 1.0) * (edge * 1.1 + flash * 5.0);
  gl_FragColor = vec4(c, (0.3 + 0.62 * max(edge, diamond * 0.7)) * inside * vBuilt);
  ${GLSL_OUTPUT}
}`;

export interface PortalGate {
  readonly id: MinigameId;
  readonly position: THREE.Vector3;
  readonly yaw: number;
  readonly film: THREE.Vector3;
  readonly back: Anchor;
  readonly keeper: Anchor;
}

export interface ArcadeIsle {
  readonly group: THREE.Group;
  readonly island: Island;
  readonly gates: Record<MinigameId, PortalGate>;
  readonly spawn: Anchor;
  readonly guide: Anchor;
  setOpen(open: boolean, immediate?: boolean): void;
  setStars(id: MinigameId, stars: number): void;
  update(dt: number, time: number, camera: THREE.Camera): void;
}

interface GateParts {
  readonly uniforms: { uTime: { value: number }; uOpen: { value: number }; uNear: { value: number }; uColor: { value: THREE.Color } };
  readonly plate: Panel;
  readonly halo: THREE.Sprite;
  readonly light: THREE.PointLight | null;
  stars: number;
  near: number;
}

const paintPlate = (plate: Panel, id: MinigameId, stars: number): void => {
  const info = MINIGAMES[id], theme = THEMES.haven;
  const hex = `#${new THREE.Color(info.color).getHexString()}`;
  plate.paint((ctx, w, h) => {
    ctx.fillStyle = 'rgba(8, 14, 38, 0.9)';
    roundRect(ctx, 6, 6, w - 12, h - 12, 26);
    ctx.fill();
    ctx.strokeStyle = hex;
    ctx.lineWidth = 3;
    ctx.shadowColor = hex;
    ctx.shadowBlur = 18;
    roundRect(ctx, 7.5, 7.5, w - 15, h - 15, 26);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.text;
    ctx.font = displayFont(600, 84);
    ctx.fillText(info.title, w / 2, 76, w - 60);
    ctx.fillStyle = theme.dim;
    ctx.font = font(500, 31);
    ctx.fillText(info.load ? info.tagline : 'Opening soon', w / 2, 140, w - 60);
    for (let i = 0; i < 3; i++) {
      const x = w / 2 + (i - 1) * 62, y = 190;
      ctx.fillStyle = i < stars ? hex : 'rgba(255, 255, 255, 0.16)';
      ctx.shadowColor = hex;
      ctx.shadowBlur = i < stars ? 16 : 0;
      sparkle(ctx, x, y, 19);
    }
    ctx.shadowBlur = 0;
    if (!info.load) {
      ctx.fillStyle = theme.dim;
      ctx.font = font(600, 18);
      spaced(ctx, 'SEALED', w / 2, 228, 5, 'center');
    }
  });
};

export const buildArcadeIsle = async (ctx: BuildContext, scene: THREE.Scene, colliders: Colliders, main: Island, time: { value: number }): Promise<ArcadeIsle> => {
  const q = ctx.quality, rng = new Rng(5150);
  const C = ARCADE_ISLE.centre;
  const group = new THREE.Group();
  group.name = 'arcade isle';
  group.position.copy(C);
  scene.add(group);

  const island = buildIsland({ radius: ARCADE_ISLE.radius, depth: 15, seed: 9, lump: 0.07, hills: 0.55, flat: 0.84 });
  const rock = new THREE.Mesh(island.geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }));
  rock.receiveShadow = true;
  group.add(rock);

  const daisTall = (await sizeOf(ctx, 'dais'))[1];
  await dress(ctx, group, 'dais', [[0, 0.07 - daisTall, 0, 36]]);
  const gates = {} as Record<MinigameId, PortalGate>;
  const parts = {} as Record<MinigameId, GateParts>;
  const spots: Spot[] = [];
  const lit = q.tier === 'high' || q.tier === 'ultra';
  for (const [i, id] of MINIGAME_IDS.entries()) {
    const bearing = ((i / (MINIGAME_IDS.length - 1)) * 2 - 1) * -ARCADE_ISLE.gateArc * (Math.PI / 180);
    const lx = Math.sin(bearing) * ARCADE_ISLE.gateRing, lz = Math.cos(bearing) * ARCADE_ISLE.gateRing;
    const yaw = Math.atan2(-lx, -lz);
    spots.push([lx, 0, lz, THREE.MathUtils.radToDeg(yaw)]);
    const position = v3(C.x + lx, 0, C.z + lz);
    const inward = v3(-Math.sin(bearing), 0, -Math.cos(bearing)), across = v3(inward.z, 0, -inward.x);
    const backAt = position.clone().addScaledVector(inward, 2.7), keeperAt = position.clone().addScaledVector(inward, 0.9).addScaledVector(across, 2.0);
    gates[id] = {
      id, position, yaw,
      film: v3(position.x, GATE.openingY, position.z),
      back: anchorToward(backAt.x, 0, backAt.z, C.x, C.z),
      keeper: anchorToward(keeperAt.x, 0, keeperAt.z, C.x, C.z - 2),
    };
    colliders.circle(position.x, position.z, GATE.base);

    const color = new THREE.Color(MINIGAMES[id].color);
    const uniforms = { uTime: time, uOpen: { value: 0 }, uNear: { value: 0 }, uColor: { value: color } };
    const film = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.ShaderMaterial({ vertexShader: FILM_VS, fragmentShader: FILM_FS, uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    film.scale.set(GATE.openingWide, GATE.openingTall, 1);
    film.position.set(lx, GATE.openingY, lz);
    film.rotation.y = yaw;
    film.renderOrder = 2;
    const halo = makeHalo(MINIGAMES[id].color, 5.2, 0);
    halo.position.set(lx, GATE.openingY, lz).addScaledVector(inward, 0.3);
    const plate = new Panel(760, 250, { world: true });
    plate.mesh.scale.set(3.3, 3.3 * (250 / 760), 1);
    plate.mesh.position.set(lx, 4.5, lz).addScaledVector(inward, 0.2);
    plate.mesh.rotation.order = 'YXZ';
    plate.mesh.rotation.x = 0.16;
    plate.mesh.rotation.y = yaw;
    plate.mesh.material.depthWrite = true;
    plate.mesh.material.alphaTest = 0.02;
    plate.opacity = 0;
    const light = lit ? new THREE.PointLight(MINIGAMES[id].color, 0, 7, 1.8) : null;
    if (light) light.position.set(lx, GATE.openingY, lz).addScaledVector(inward, 0.9);
    group.add(film, halo, plate.mesh);
    if (light) group.add(light);
    parts[id] = { uniforms, plate, halo, light, stars: 0, near: 0 };
    paintPlate(plate, id, 0);
  }
  await dress(ctx, group, 'portal-gate', spots);
  await ctx.step('haven: arcade gates');

  const ground = (x: number, z: number): { y: number; scale: number } | null => {
    const y = island.heightAt(x, z);
    if (y === null || Math.hypot(x, z) > island.outline(Math.atan2(x, z)) * 0.95) return null;
    if (Math.hypot(x, z) < 2.72) return null;
    for (const [sx, , sz] of spots) if (Math.hypot(x - sx, z - sz) < GATE.base + 0.05) return null;
    return { y, scale: Math.hypot(x, z) < 5 ? 0.6 : 1 };
  };
  group.add(buildGrass(Math.round(13000 * q.density), ARCADE_ISLE.radius, rng.fork(), ground, q.tier === 'low'));
  const flowerColors = [new THREE.Color(0x3fe0b0), new THREE.Color(0x5fd8ff), new THREE.Color(0xffb347), new THREE.Color(0xff8fc8)];
  const flowers: { x: number; y: number; z: number; h: number; color: THREE.Color }[] = [];
  for (let i = 0; i < 300 && flowers.length < Math.round(60 * q.density); i++) {
    const a = rng.range(0, TAU), r = rng.range(3.2, 8.8), x = Math.cos(a) * r, z = Math.sin(a) * r, g = ground(x, z);
    if (g) flowers.push({ x, y: g.y, z, h: rng.range(0.18, 0.46), color: rng.pick(flowerColors) });
  }
  group.add(buildGlowFlowers(flowers));
  const crystals: Record<'crystals-a' | 'crystals-b', Spot[]> = { 'crystals-a': [], 'crystals-b': [] };
  for (const [n, [x, z, scale]] of ([[-8.0, 3.6, 1.0], [8.1, 3.2, 1.15], [-4.4, 7.6, 0.9], [4.6, 7.5, 1.0], [-2.9, -7.4, 0.8], [3.1, -7.3, 0.85], [0.1, 8.7, 1.2]] as const).entries()) {
    const y = (island.heightAt(x, z) ?? 0) - 0.12;
    crystals[n % 2 ? 'crystals-b' : 'crystals-a'].push([x, y, z, rng.range(0, 360), scale]);
    group.add(makeHalo(n % 2 ? 0x59d8ff : 0x1fd68a, scale * 3, 0.45).translateX(x).translateY(y + scale * 0.6).translateZ(z));
  }
  for (const id of ['crystals-a', 'crystals-b'] as const) await dress(ctx, group, id, crystals[id]);
  await ctx.step('haven: arcade isle');

  const fromZ = main.outline(0) * 0.9, toZ = C.z - island.outline(Math.PI) * 0.9;
  const fromY = (main.heightAt(0, fromZ) ?? 0) + 0.1, toY = (island.heightAt(0, toZ - C.z) ?? 0) + 0.1;
  const TILES = Math.max(4, Math.round(toZ - fromZ));
  const deckGeometry = new THREE.BufferGeometry();
  {
    const position: number[] = [], uv: number[] = [], tile: number[] = [], index: number[] = [];
    const step = (toZ - fromZ) / TILES;
    for (let i = 0; i < TILES; i++) {
      const z0 = fromZ + step * (i + 0.04), z1 = fromZ + step * (i + 0.96);
      const y0 = fromY + ((toY - fromY) * i) / TILES, y1 = fromY + ((toY - fromY) * (i + 1)) / TILES, at = position.length / 3;
      position.push(-BRIDGE_WIDE / 2, y0, z0, BRIDGE_WIDE / 2, y0, z0, BRIDGE_WIDE / 2, y1, z1, -BRIDGE_WIDE / 2, y1, z1);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      tile.push(i, i, i, i);
      index.push(at, at + 2, at + 1, at, at + 3, at + 2);
    }
    deckGeometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    deckGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    deckGeometry.setAttribute('aTile', new THREE.Float32BufferAttribute(tile, 1));
    deckGeometry.setIndex(index);
  }
  const deckU = { uTime: time, uReveal: { value: 0 }, uLight: { value: BRIDGE_LIGHT } };
  const deck = new THREE.Mesh(deckGeometry, new THREE.ShaderMaterial({ vertexShader: DECK_VS, fragmentShader: DECK_FS, uniforms: deckU, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  deck.frustumCulled = false;
  deck.renderOrder = 2;
  scene.add(deck);

  const path: { x: number; y: number; z: number }[] = [{ x: 0, y: 0, z: 8.2 }];
  for (let z = 9; z < fromZ; z += 0.5) path.push({ x: 0, y: main.heightAt(0, z) ?? 0, z });
  path.push({ x: 0, y: fromY, z: fromZ }, { x: 0, y: toY, z: toZ });
  for (let z = toZ + 0.5; z < C.z - ARCADE_ISLE.plaza + 1; z += 0.5) path.push({ x: 0, y: island.heightAt(0, z - C.z) ?? 0, z });
  path.push({ x: 0, y: 0, z: C.z - ARCADE_ISLE.plaza + 1 });
  const walkway = new Walkway(path, BRIDGE_WIDE / 2 - 0.05);
  walkway.reach = 0;
  const plaza = new Disc(C.x, C.z, ARCADE_ISLE.plaza, 0);
  plaza.open = false;
  colliders.walkways.push(walkway, plaza);

  let open = 0, shown = 0;
  const pos = new THREE.Vector3();
  return {
    group, island, gates,
    spawn: anchorToward(C.x, 0, C.z - 3.4, C.x, C.z + 6),
    guide: anchorToward(C.x + 1.5, 0, C.z - 1.2, C.x, C.z - 3.4),
    setOpen(on, immediate = false) {
      open = on ? 1 : 0;
      walkway.reach = open;
      plaza.open = on;
      if (immediate) shown = open;
    },
    setStars(id, stars) {
      const p = parts[id];
      if (p.stars === stars) return;
      p.stars = stars;
      paintPlate(p.plate, id, stars);
    },
    update(dt, _time, camera) {
      shown = damp(shown, open, 1.6, dt);
      deckU.uReveal.value = shown * (TILES + 1);
      deck.visible = shown > 0.003;
      camera.getWorldPosition(pos);
      for (const id of MINIGAME_IDS) {
        const p = parts[id], gate = gates[id], ready = MINIGAMES[id].load ? 1 : 0.22;
        const near = Math.max(0, 1 - Math.hypot(pos.x - gate.position.x, pos.z - gate.position.z) / 5);
        p.near = damp(p.near, near * open, 4, dt);
        p.uniforms.uOpen.value = shown * ready;
        p.uniforms.uNear.value = p.near;
        p.halo.material.color.set(MINIGAMES[id].color).multiplyScalar(shown * ready * (0.55 + 0.5 * p.near));
        p.plate.opacity = shown;
        if (p.light) p.light.intensity = shown * ready * (5 + 6 * p.near);
      }
    },
  };
};
