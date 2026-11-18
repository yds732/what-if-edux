import * as THREE from 'three';
import { v3 } from '../core/geo';
import { Rng, TAU } from '../core/math';
import { bakeEnvironment } from '../render/env';
import { makeLook } from '../render/PostPipeline';
import type { BuildContext, FrameContext, World } from '../world/World';
import { sizeOf } from '../world/dressing';
import { buildCloudSea, buildMotes, type Motes } from '../world/haven/atmosphere';
import { buildGlowFlowers, buildGrass, windUniforms } from '../world/haven/flora';
import { buildIsland, type Island } from '../world/haven/islands';
import { buildLanterns, type Lanterns, type LanternSpot } from '../world/haven/lanterns';
import { recolourHavenProps } from '../world/haven/recolour';
import { KEY_DIR, PLANET_DIR, buildSky, type HavenSky } from '../world/haven/sky';

export interface StageOptions {
  readonly island?: { readonly radius: number; readonly depth?: number; readonly seed?: number; readonly flat?: number; readonly hills?: number };
  readonly grass?: number;
  readonly bare?: (x: number, z: number) => boolean;
  readonly flowers?: number;
  readonly lanterns?: number;
  readonly motes?: number;
  readonly farIslands?: boolean;
  readonly cloudSea?: number | null;
  readonly shadowSpan?: number;
  readonly shadowCentre?: THREE.Vector3;
  readonly keyDir?: THREE.Vector3;
  readonly seed?: number;
}

export interface Stage {
  readonly time: { value: number };
  readonly sky: HavenSky;
  readonly island: Island | null;
  readonly cloudSea: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null;
  readonly key: THREE.DirectionalLight;
  readonly rim: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  update(frame: FrameContext): void;
}

export const buildStage = async (ctx: BuildContext, world: World, o: StageOptions = {}): Promise<Stage> => {
  const scene = world.scene, q = ctx.quality, rng = new Rng(o.seed ?? 31);
  const time = windUniforms.uTime;
  await recolourHavenProps(ctx);

  world.near = 0.08;
  world.far = 3200;
  Object.assign(world.look, makeLook({
    exposure: 1.0, bloom: 0.2, ao: 0.8, saturation: 1.24, contrast: 0.24, vignette: 0.36, grain: 0.014, chroma: 0.004,
    shafts: 0.2, shaftColor: new THREE.Color(0.7, 0.88, 1.0), dof: 0, streak: 0.1,
    shadowTint: new THREE.Color(0.0, 0.008, 0.028), highlightTint: new THREE.Color(0.035, 0.03, -0.01),
  }));
  world.clearColor.set(0x0c1438);
  world.shafts = { direction: PLANET_DIR, skyFrom: 700 };

  const sky = buildSky(Math.round(2400 * (0.5 + 0.5 * q.density)));
  scene.add(sky.group);
  scene.environment = bakeEnvironment(ctx.renderer, sky.envScene, 0.02);
  scene.environmentIntensity = 1.1;
  scene.fog = new THREE.FogExp2(0x2e4a6a, 0.0046);
  const cloudSea = o.cloudSea !== null ? (buildCloudSea(o.cloudSea ?? -44, time) as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>) : null;
  if (cloudSea) scene.add(cloudSea);

  const centre = o.shadowCentre ?? v3(0, 0, 0), span = o.shadowSpan ?? 9;
  const key = new THREE.DirectionalLight(0xffbf80, 3.0);
  key.position.copy(o.keyDir ?? KEY_DIR).multiplyScalar(60).add(centre);
  key.target.position.copy(centre);
  key.castShadow = q.shadows;
  key.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
  const sc = key.shadow.camera;
  sc.left = -span;
  sc.right = span;
  sc.top = span;
  sc.bottom = -span;
  sc.near = 10;
  sc.far = 130;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  key.shadow.radius = 4;
  const rim = new THREE.DirectionalLight(0x78a6ff, 1.7);
  rim.position.copy(PLANET_DIR).multiplyScalar(60);
  const hemi = new THREE.HemisphereLight(0x9cc4e8, 0x2a6a4a, 1.1);
  scene.add(key, key.target, rim, hemi);
  await ctx.step('stage: sky');

  let island: Island | null = null;
  const motes: Motes[] = [];
  let lanterns: Lanterns | null = null;
  if (o.island) {
    const { radius } = o.island;
    island = buildIsland({ radius, depth: o.island.depth ?? radius * 1.5, seed: o.island.seed ?? 3, lump: 0.08, hills: o.island.hills ?? 0.6, flat: o.island.flat ?? 0.8 });
    const rock = new THREE.Mesh(island.geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }));
    rock.receiveShadow = true;
    scene.add(rock);
    const made = island;
    const ground = (x: number, z: number): { y: number; scale: number } | null => {
      const y = made.heightAt(x, z);
      if (y === null || Math.hypot(x, z) > made.outline(Math.atan2(x, z)) * 0.95 || o.bare?.(x, z)) return null;
      return { y, scale: 1 };
    };
    if (o.grass) scene.add(buildGrass(Math.round(o.grass * q.density), radius, rng.fork(), ground));
    if (o.flowers) {
      const colors = [new THREE.Color(0x3fe0b0), new THREE.Color(0x5fd8ff), new THREE.Color(0xffb347), new THREE.Color(0xff8fc8)];
      const flowers: { x: number; y: number; z: number; h: number; color: THREE.Color }[] = [];
      for (let i = 0; i < o.flowers * 6 && flowers.length < Math.round(o.flowers * q.density); i++) {
        const a = rng.range(0, TAU), r = rng.range(0.25, 0.95) * radius, x = Math.cos(a) * r, z = Math.sin(a) * r, g = ground(x, z);
        if (g) flowers.push({ x, y: g.y, z, h: rng.range(0.18, 0.48), color: rng.pick(colors) });
      }
      scene.add(buildGlowFlowers(flowers));
    }
    if (o.lanterns) {
      const spots: LanternSpot[] = [];
      for (let i = 0; i < o.lanterns; i++) {
        const a = ((i + rng.range(-0.3, 0.3)) / o.lanterns) * TAU, r = made.outline(a) * rng.range(1.08, 1.5);
        spots.push({ x: Math.sin(a) * r, z: Math.cos(a) * r, ground: 0, lift: rng.range(-0.4, 2.4) });
      }
      lanterns = buildLanterns(rng.fork(), spots, { motesEach: Math.round(8 * q.density) + 3, lights: q.tier === 'low' ? 0 : 3 });
      scene.add(lanterns.group);
    }
    if (o.motes) motes.push(buildMotes(Math.round(o.motes * q.density), v3(0, 0.15, 0), v3(radius * 0.9, 3.2, radius * 0.9), rng.fork(), time, { a: 0xffd98a, b: 0x8fe9ff, size: 0.07, gain: 2.2 }));
    await ctx.step('stage: island');
  }
  for (const m of motes) scene.add(m.points);

  const drifting: { object: THREE.Object3D; baseY: number; phase: number; amp: number }[] = [];
  if (o.farIslands ?? true) {
    const far: [x: number, y: number, z: number, radius: number][] = [
      [-36, 7, -46, 8], [32, 4, -38, 6.5], [-68, 20, -118, 16], [62, 15, -108, 13], [-27, -5, -14, 4.5], [29, -3, 9, 5],
      [108, 32, -196, 22], [-128, 38, -228, 26], [-58, 11, 34, 9], [68, 19, 46, 11], [4, 26, -150, 18],
    ];
    const kinds = [{ id: 'island-a', turf: 10.4 }, { id: 'island-b', turf: 10.8 }] as const;
    for (const [i, [x, y, z, radius]] of far.entries()) {
      const kind = kinds[i % 2]!;
      const model = await ctx.assets.instance(kind.id);
      const scale = (radius * 2) / (await sizeOf(ctx, kind.id))[0];
      model.scale.setScalar(scale);
      model.rotation.y = i * 1.7;
      const baseY = y - kind.turf * scale;
      model.position.set(x, baseY, z);
      model.traverse((child) => {
        child.castShadow = child.receiveShadow = false;
      });
      scene.add(model);
      drifting.push({ object: model, baseY, phase: i * 2.1, amp: 0.4 + (i % 3) * 0.25 });
    }
    await ctx.step('stage: far islands');
  }

  return {
    time, sky, island, cloudSea, key, rim, hemi,
    update(frame) {
      time.value = frame.time;
      sky.update(frame.time, frame.camera, frame.pixelHeight);
      lanterns?.update(frame.time, frame.pixelHeight);
      for (const m of motes) m.setPixelHeight(frame.pixelHeight);
      for (const d of drifting) d.object.position.y = d.baseY + Math.sin(frame.time * 0.17 + d.phase) * d.amp;
    },
  };
};
