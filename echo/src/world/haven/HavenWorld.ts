import * as THREE from 'three';
import { Character } from '../../characters/Character';
import { CAST } from '../../characters/cast';
import { blob, lathe, merge, place, sweep, tint, tintBy, torus, v3 } from '../../core/geo';
import { Rng, TAU, damp, fbm3 } from '../../core/math';
import { Bursts } from '../../render/Bursts';
import { makeLook } from '../../render/PostPipeline';
import { bakeEnvironment } from '../../render/env';
import { Panel } from '../../ui/Panel';
import { THEMES, font, glass, spaced, sparkle, wrap } from '../../ui/draw';
import { World, anchor, anchorToward, type Anchor, type BuildContext, type FrameContext } from '../World';
import { buildLanterns, type Lanterns, type LanternSpot } from './lanterns';
import { buildReeds, type ReedClump } from './reeds';
import { buildShootingStars, type ShootingStars } from './shootingStars';
import { buildCloudSea, buildFallingPetals, buildMotes, buildWaterfall, makeHalo, type Motes } from './atmosphere';
import { RING_POINTS, Ring, buildGateway, buildStarBridge, type Gateway, type StarBridge } from './bridge';
import { buildBlossomTree, buildCrystals, buildGlowFlowers, buildGrass, windUniforms } from './flora';
import { buildIsland, type Island } from './islands';
import { KEY_DIR, PLANET_DIR, buildSky, type HavenSky } from './sky';

/** Where things stand in Haven. The player arrives facing -Z: plaza, bridge, gateway, planet. */
export const HAVEN = {
  spawn: anchor(0, 0, 4.2, 0),
  /** Where the player stands to throw. */
  throwSpot: anchor(0, 0, -3.4, 0),
  /** Centre of the star circle. */
  plaza: new THREE.Vector3(0, 0, -4.5),
  plazaRadius: 2.5,
  /** Where a fresh orb hangs, above the star. */
  orbSource: new THREE.Vector3(0, 1.12, -4.9),
  bridgeEnd: new THREE.Vector3(0, 3.3, -44.2),
  gatewayIsland: new THREE.Vector3(0, 3.2, -54),
  lumi: anchorToward(2.2, 0, -2.2, 0, 2.6),
  kai: anchorToward(-2.7, 0, -1.9, 0, 2.6),
  nova: anchorToward(3.7, 0, -0.6, 0, 2.6),
  /** Lumi stands close for the Wednesday conversation. */
  lumiNear: anchorToward(0.35, 0, 2.05, 0, 4.2),
  tree: new THREE.Vector3(-6.4, 0, -1.6),
  bonusRing: new THREE.Vector3(-0.6, 7.0, -31),
  festivalRings: [new THREE.Vector3(-2.6, 3.3, -13.4), new THREE.Vector3(2.9, 4.7, -19.8), new THREE.Vector3(0.2, 6.6, -27.5)],
  /** The title screen on a wide display: quiet sky on the left for the words; planet, gateway and blossom on the right. */
  titleWide: anchor(-10.9, 0, 4.4, -16.7),
  /** The title screen on a tall display: the bridge straight ahead, sky above it and grass below. */
  titleTall: anchor(2.2, 0, 4.4, 1),
  /** Where Lumi waits in the wide title picture. */
  lumiTitle: anchorToward(-10.25, 0, -1.8, -10.9, 4.4),
} as const satisfies Record<string, Anchor | THREE.Vector3 | number | readonly THREE.Vector3[]>;

export type HavenVariant = 'arrival' | 'bonus' | 'evening' | 'festival' | 'title';

const GOLD_HDR = new THREE.Color(1.0, 0.74, 0.32).multiplyScalar(2.6);
const FIREWORK_HUES = [0xffd27a, 0xff8fd6, 0x7fe9ff, 0xb59bff, 0x9dffb0, 0xffffff];

interface Rocket {
  at: THREE.Vector3;
  delay: number;
  color: THREE.Color;
}

export class HavenWorld extends World {
  readonly id = 'haven';
  readonly theme = 'haven' as const;
  mainIsland!: Island;
  bridge!: StarBridge;
  gateway!: Gateway;
  /** The far, drifting ring of Tuesday's bonus challenge. */
  bonusRing!: Ring;
  readonly bursts = new Bursts(2600);
  /** A firework burst just went off, with its position: the audio listens. */
  onFirework: ((at: THREE.Vector3) => void) | null = null;

  private sky!: HavenSky;
  private readonly motes: Motes[] = [];
  private readonly drifting: { object: THREE.Object3D; baseY: number; phase: number; amp: number }[] = [];
  private readonly time = windUniforms.uTime;
  private readonly rockets: Rocket[] = [];
  private readonly festival = new THREE.Group();
  private readonly lanterns: { mesh: THREE.Object3D; x: number; z: number; speed: number; phase: number }[] = [];
  private floating!: Lanterns;
  private shootingStars!: ShootingStars;
  private board!: Panel;
  private boardData: { title: string; body: string; value: number; total: number } | null = null;
  private boardShown = 0;
  private festivalK = 0;
  private festivalTarget = 0;
  private readonly rng = new Rng(77);

  constructor() {
    super();
    this.near = 0.08;
    this.far = 3200;
    Object.assign(this.look, makeLook({
      exposure: 1.0, bloom: 0.2, ao: 0.8, saturation: 1.14, contrast: 0.22, vignette: 0.36, grain: 0.014, chroma: 0.005,
      // warm, glowing highlights over soft plum shadows: a magical golden hour
      shadowTint: new THREE.Color(0.018, 0.004, 0.024), highlightTint: new THREE.Color(0.08, 0.04, -0.03),
    }));
    this.clearColor.set(0x1a1038);
  }

  async build(ctx: BuildContext): Promise<void> {
    const scene = this.scene;
    const q = ctx.quality;
    const rng = new Rng(4080);

    // ---- sky, environment light, haze ----
    this.sky = buildSky(Math.round(2600 * (0.5 + 0.5 * q.density)));
    scene.add(this.sky.group);
    scene.environment = bakeEnvironment(ctx.renderer, this.sky.envScene, 0.02);
    scene.environmentIntensity = 1.1;
    scene.fog = new THREE.FogExp2(0x6a3a4a, 0.0046);
    scene.add(buildCloudSea(-44, this.time));
    await ctx.step('haven: sky');

    // ---- light: a warm key from behind the player so faces read, a cool rim from the planet, sky fill ----
    const key = new THREE.DirectionalLight(0xffbf80, 3.0);
    key.position.copy(KEY_DIR).multiplyScalar(60).add(v3(0, 0, -4));
    key.target.position.set(0, 0, -4);
    key.castShadow = q.shadows;
    key.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    const sc = key.shadow.camera;
    sc.left = -20; sc.right = 20; sc.top = 20; sc.bottom = -20; sc.near = 10; sc.far = 130;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.05;
    key.shadow.radius = 5;
    const rim = new THREE.DirectionalLight(0xff8fb8, 1.7);
    rim.position.copy(PLANET_DIR).multiplyScalar(60);
    scene.add(key, key.target, rim, new THREE.HemisphereLight(0xe0a8c0, 0x8a5a4a, 1.1));

    // ---- islands ----
    const rock = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    this.mainIsland = buildIsland({ radius: 13.5, depth: 20, seed: 1, lump: 0.1, hills: 0.9, flat: 0.72 });
    const main = new THREE.Mesh(this.mainIsland.geometry, rock);
    main.receiveShadow = true;
    scene.add(main);
    await ctx.step('haven: main island');

    const gi = HAVEN.gatewayIsland;
    const far: [x: number, y: number, z: number, radius: number, depth: number][] = [
      [gi.x, gi.y, gi.z, 11, 17], [-38, 9, -48, 8, 13], [34, 5, -40, 6.5, 11], [-70, 22, -120, 16, 26], [64, 16, -110, 13, 22],
      [-26, -6, -18, 4.5, 8], [30, -4, 6, 5, 9], [110, 34, -200, 22, 34], [-130, 40, -230, 26, 40], [150, 60, -330, 30, 44],
      [-60, 12, 30, 9, 15], [70, 20, 44, 11, 18], [-210, 70, -420, 40, 60],
    ];
    far.forEach(([x, y, z, radius, depth], i) => {
      const island = buildIsland({ radius, depth, seed: 10 + i, lump: 0.2, hills: i === 0 ? 0.5 : 1.6, flat: i === 0 ? 0.75 : 0.3, detail: radius > 15 ? 0.6 : 0.45 });
      const mesh = new THREE.Mesh(island.geometry, rock);
      mesh.position.set(x, y, z);
      if (i > 0) mesh.rotation.y = i * 1.7;
      scene.add(mesh);
      if (i > 0) this.drifting.push({ object: mesh, baseY: y, phase: i * 2.1, amp: 0.4 + (i % 3) * 0.25 });
      // each distant island wears a crown of crystal so it never reads as bare rock
      if (i > 0 && q.density > 0.5) {
        const crown = buildCrystals(rng, 5, radius * 0.42, rng.pick([0x59d8ff, 0x9a6bff, 0xff7ad0]));
        crown.position.set(rng.range(-0.3, 0.3) * radius, 0.4, rng.range(-0.3, 0.3) * radius);
        crown.castShadow = false;
        mesh.add(crown);
      }
    });
    await ctx.step('haven: far islands');

    // ---- the plaza: a stone disc with a star inlaid in light ----
    const plaza = new THREE.Group();
    plaza.position.copy(HAVEN.plaza);
    const R = HAVEN.plazaRadius;
    const disc = lathe([[0, 0.07], [R - 0.22, 0.07], [R - 0.05, 0.045], [R, -0.02], [R + 0.03, -0.2]], 72);
    tintBy(disc, (p, out) => {
      const ring = Math.floor(Math.hypot(p.x, p.z) / 0.62), wedge = Math.floor((Math.atan2(p.z, p.x) / TAU + 0.5) * (6 + ring * 4));
      out.set(0x8f88bd).multiplyScalar(0.82 + 0.18 * (((ring * 7 + wedge * 13) % 5) / 4) + 0.05 * fbm3(p.x * 2, 0, p.z * 2, 2));
    });
    const discMesh = new THREE.Mesh(disc, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05 }));
    discMesh.receiveShadow = true;
    plaza.add(discMesh);
    const inlay: THREE.BufferGeometry[] = [place(torus(R - 0.5, 0.028, 6, 72), [0, 0.078, 0]), place(torus(0.62, 0.024, 6, 40), [0, 0.078, 0])];
    for (let i = 0; i < 5; i++) {
      const a0 = (i / 5) * TAU + Math.PI / 2, a1 = ((i + 2) / 5) * TAU + Math.PI / 2;
      inlay.push(sweep([v3(Math.cos(a0) * 1.55, 0.078, -Math.sin(a0) * 1.55), v3(Math.cos(a1) * 1.55, 0.078, -Math.sin(a1) * 1.55)], () => ({ rx: 0.022, ry: 0.012 }), { radial: 4, steps: 2 }));
    }
    plaza.add(new THREE.Mesh(merge(inlay), new THREE.MeshBasicMaterial({ color: GOLD_HDR })));
    scene.add(plaza);
    const stones: THREE.BufferGeometry[] = [];
    const stoneSpots: [number, number, number][] = [[0.25, 3.0, 0.5], [-0.3, 1.75, 0.46], [0.22, 0.55, 0.52], [-0.18, -0.7, 0.45], [0.1, -1.55, 0.4]];
    for (const [x, z, r] of stoneSpots) stones.push(tint(place(blob(r, 0.07, r * 0.86, 3), [x, 0.015, z], [0, x * 3, 0]), 0x8a84b4));
    const stoneMesh = new THREE.Mesh(merge(stones), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
    stoneMesh.receiveShadow = true;
    scene.add(stoneMesh);
    await ctx.step('haven: plaza');

    // ---- grass, flowers, crystals ----
    const ground = (x: number, z: number): { y: number; scale: number } | null => {
      const y = this.mainIsland.heightAt(x, z);
      if (y === null) return null;
      const edge = this.mainIsland.outline(Math.atan2(x, z));
      if (Math.hypot(x, z) > edge * 0.95) return null;
      if (Math.hypot(x - HAVEN.plaza.x, z - HAVEN.plaza.z) < R + 0.12) return null;
      for (const [sx, sz, sr] of stoneSpots) if (Math.hypot(x - sx, z - sz) < sr * 0.9) return null;
      const path = Math.abs(x) < 1.1 && z > -2.2 && z < 4.6 ? 0.5 : 1;
      return { y, scale: path };
    };
    scene.add(buildGrass(Math.round(26000 * q.density), 13.5, rng.fork(), ground));
    const flowerColors = [new THREE.Color(0xff8fd6), new THREE.Color(0x7fe9ff), new THREE.Color(0xffd27a), new THREE.Color(0xb59bff)];
    const flowers: { x: number; y: number; z: number; h: number; color: THREE.Color }[] = [];
    for (let i = 0; i < 400 && flowers.length < Math.round(110 * q.density); i++) {
      const a = rng.range(0, TAU), r = rng.range(3.4, 12);
      const x = Math.cos(a) * r, z = Math.sin(a) * r - 1;
      const g = ground(x, z);
      if (!g || g.scale < 1) continue;
      flowers.push({ x, y: g.y, z, h: rng.range(0.18, 0.5), color: rng.pick(flowerColors) });
    }
    scene.add(buildGlowFlowers(flowers));
    const clusters: [x: number, z: number, scale: number, color: number, count: number][] = [
      [4.9, -7.0, 1.5, 0x59d8ff, 7], [-4.4, -7.9, 1.2, 0x9a6bff, 6], [7.6, -1.6, 0.95, 0xff7ad0, 5], [-9.0, 3.6, 1.3, 0x59d8ff, 6],
      [6.0, 5.4, 0.8, 0x9a6bff, 5], [-2.4, 8.2, 0.9, 0xff7ad0, 5], [9.6, -5.2, 1.1, 0x9a6bff, 5], [-8.4, -5.6, 0.85, 0x59d8ff, 4],
    ];
    for (const [x, z, scale, color, count] of clusters) {
      const c = buildCrystals(rng, count, scale, color);
      c.position.set(x, (this.mainIsland.heightAt(x, z) ?? 0) - 0.05, z);
      scene.add(c);
      const halo = makeHalo(color, scale * 3.2, 0.5);
      halo.position.set(x, c.position.y + scale * 0.55, z);
      scene.add(halo);
      this.colliders.circle(x, z, scale * 0.42);
    }
    await ctx.step('haven: flora');

    // ---- the blossom tree ----
    const tree = buildBlossomTree(rng.fork(), Math.round(30000 * q.density));
    tree.group.position.copy(HAVEN.tree);
    tree.group.scale.setScalar(1.3);
    scene.add(tree.group);
    this.colliders.circle(HAVEN.tree.x, HAVEN.tree.z, 0.75);
    const canopy = tree.canopy.map((p) => p.clone().multiplyScalar(1.3).add(HAVEN.tree));
    scene.add(buildFallingPetals(Math.round(240 * q.density), canopy, 0.02, rng.fork(), this.time));
    await ctx.step('haven: tree');

    // ---- lantern posts flanking the bridge ----
    const edgeZ = -this.mainIsland.outline(Math.PI) * 0.965;
    for (const s of [-1, 1]) {
      const x = s * 2.35, z = edgeZ + 1.5, y = this.mainIsland.heightAt(x, z) ?? 0;
      const post = merge([
        tint(sweep([v3(0, -0.1, 0), v3(0, 1.5, 0)], (t) => 0.1 - 0.035 * t, { radial: 6, steps: 4, endCap: 'flat' }), 0x7d74ac),
        tint(place(blob(0.2, 0.05, 0.2, 2), [0, 1.52, 0]), 0x9a92c8),
        tint(place(blob(0.24, 0.045, 0.24, 2), [0, 2.02, 0]), 0x7d74ac),
      ]);
      const postMesh = new THREE.Mesh(post, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
      postMesh.position.set(x, y, z);
      postMesh.castShadow = true;
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.72, 0.36).multiplyScalar(3.4) }));
      flame.position.set(0, 1.78, 0);
      postMesh.add(flame, makeHalo(0xffb866, 2.4, 0.55).translateY(1.78));
      const lamp = new THREE.PointLight(0xffb070, 9, 11, 1.8);
      lamp.position.set(0, 1.8, 0);
      postMesh.add(lamp);
      scene.add(postMesh);
      this.colliders.circle(x, z, 0.28);
    }

    // the lanterns, reeds and shooting stars draw on their own seed, so everything else in Haven stays where it was
    const extra = new Rng(4081);

    // ---- floating lanterns: lining the path from the arrival to the bridge, and scattered over the island ----
    const spots: LanternSpot[] = [];
    const spot = (x: number, z: number): void => {
      const y = this.mainIsland.heightAt(x, z);
      if (y !== null) spots.push({ x, z, ground: y });
    };
    for (const z of [3.6, 1.4, -0.8]) for (const s of [-1, 1]) spot(s * 1.55 + extra.range(-0.15, 0.15), z + extra.range(-0.3, 0.3));
    for (let z = HAVEN.plaza.z - HAVEN.plazaRadius - 1.2; z > edgeZ + 2.6; z -= 2.4) for (const s of [-1, 1]) spot(s * 2.05 + extra.range(-0.15, 0.15), z + extra.range(-0.3, 0.3));
    for (let i = 0, made = 0; i < 200 && made < 12; i++) {
      const a = extra.range(0, TAU), r = extra.range(5, 11.5);
      const x = Math.cos(a) * r, z = Math.sin(a) * r - 1;
      // away from the path, the plaza, the tree and each other
      if (Math.abs(x) < 3 || Math.hypot(x - HAVEN.plaza.x, z - HAVEN.plaza.z) < 4.8 || Math.hypot(x - HAVEN.tree.x, z - HAVEN.tree.z) < 3.4) continue;
      if (!ground(x, z) || spots.some((s) => Math.hypot(s.x - x, s.z - z) < 2.6)) continue;
      spot(x, z);
      made++;
    }
    this.floating = buildLanterns(extra.fork(), spots, { motesEach: Math.round(10 * q.density) + 4, lights: q.tier === 'low' ? 0 : q.tier === 'medium' ? 4 : 6 });
    scene.add(this.floating.group);

    // ---- reeds: natural clumps toward the island's edge, a few by the tree and the crystals ----
    const clumps: ReedClump[] = [];
    for (let i = 0; i < 600 && clumps.length < Math.round(26 * q.density) + 6; i++) {
      const a = extra.range(0, TAU), edge = this.mainIsland.outline(a);
      const r = edge * extra.range(0.7, 0.93);
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      // keep the way to the bridge and the arrival clear
      if ((Math.abs(x) < 3.2 && z < -2) || (Math.abs(x) < 2.2 && z > 2.5)) continue;
      const g = ground(x, z);
      if (!g || g.scale < 1 || clumps.some((c) => Math.hypot(c.x - x, c.z - z) < 1.1)) continue;
      // clumps gather in loose families, like reeds where the ground stays wet
      clumps.push({ x, z, ground: g.y, size: extra.range(0.75, 1.3) });
      if (extra.chance(0.55)) {
        const b = extra.range(0, TAU), d = extra.range(0.55, 0.9), x2 = x + Math.cos(b) * d, z2 = z + Math.sin(b) * d, g2 = ground(x2, z2);
        if (g2) clumps.push({ x: x2, z: z2, ground: g2.y, size: extra.range(0.55, 0.95) });
      }
    }
    scene.add(buildReeds(extra.fork(), clumps));

    // ---- the occasional shooting star ----
    this.shootingStars = buildShootingStars(extra.fork());
    scene.add(this.shootingStars.mesh);

    // ---- bridge, rings, gateway ----
    this.bridge = buildStarBridge(v3(0, 0.14, edgeZ), HAVEN.bridgeEnd);
    scene.add(this.bridge.group);
    this.bonusRing = new Ring(HAVEN.bonusRing, v3(0, 0, edgeZ), 1.2);
    this.bonusRing.group.visible = false;
    scene.add(this.bonusRing.group);
    this.gateway = buildGateway();
    this.gateway.group.position.set(gi.x, gi.y + 0.05, gi.z + 3.5);
    this.gateway.group.scale.setScalar(1.3);
    scene.add(this.gateway.group);
    const gateGlow = makeHalo(0x8fb4ff, 22, 0.42);
    gateGlow.position.set(gi.x, gi.y + 6, gi.z + 3.5);
    scene.add(gateGlow);
    await ctx.step('haven: bridge');

    // ---- falling water, and the air itself ----
    scene.add(buildWaterfall(v3(gi.x - 8.6, gi.y - 0.35, gi.z + 3), 2.4, 30, -1.2, this.time));
    scene.add(buildWaterfall(v3(gi.x + 8.2, gi.y - 0.35, gi.z + 1), 1.8, 26, 1.1, this.time));
    scene.add(buildWaterfall(v3(11.6, -0.5, -6.5), 1.5, 24, 1.3, this.time));
    for (const i of [3, 4, 7]) {
      const [x, y, z, radius] = far[i]!;
      scene.add(buildWaterfall(v3(x + radius * 0.72, y - 0.4, z + radius * 0.5), radius * 0.2, radius * 2.6, 0.6, this.time));
    }
    this.motes.push(buildMotes(Math.round(190 * q.density), v3(0, 0.15, -1), v3(11, 3.4, 11), rng.fork(), this.time, { a: 0xffd98a, b: 0x8fe9ff, size: 0.07, gain: 2.2 }));
    this.motes.push(buildMotes(Math.round(120 * q.density), v3(0, 1.5, -28), v3(5, 4, 18), rng.fork(), this.time, { a: 0xffe2a0, b: 0xffb0e0, size: 0.11, gain: 2.0 }));
    for (const m of this.motes) scene.add(m.points);
    scene.add(this.bursts.points);

    // ---- the challenge board: a pane of light beside the star circle ----
    this.board = new Panel(620, 400, { world: true });
    this.board.mesh.scale.set(2.05, 1.32, 1);
    this.board.mesh.position.set(-3.7, 1.75, -5.6);
    this.board.mesh.lookAt(0.2, 1.5, 1.0);
    this.board.opacity = 0;
    scene.add(this.board.mesh);

    // ---- companions ----
    for (const name of ['lumi', 'kai', 'nova'] as const) {
      const c = this.addPerson(name, new Character(CAST[name], q.characterDetail, q.shadows));
      c.placeAt(HAVEN[name]).setPose('standOpen', { immediate: true });
      const aura = makeHalo(CAST[name].outfit.trimColor ?? 0xffffff, 2.3, 0.2);
      aura.position.set(0, 0.95, -0.15);
      c.root.add(aura);
    }

    this.buildFestival(rng.fork(), edgeZ);
    this.colliders.bounds = { kind: 'circle', cx: 0, cz: -0.6, r: 9.4 };
    this.setVariant('arrival');
  }

  /** Strings of lights along the bridge and paper lanterns adrift: hidden until the festival. */
  private buildFestival(rng: Rng, edgeZ: number): void {
    const bulbs: THREE.BufferGeometry[] = [];
    const colors = [0xffd27a, 0xff8fd6, 0x7fe9ff, 0xfff1c9];
    const p = new THREE.Vector3(), t = new THREE.Vector3(), side = new THREE.Vector3();
    const N = 46;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      this.bridge.path.getPointAt(u, p);
      this.bridge.path.getTangentAt(u, t);
      side.crossVectors(t, v3(0, 1, 0)).normalize();
      const sag = 0.28 * Math.sin((u * N * Math.PI) / 3) ** 2;
      for (const s of [-1, 1]) {
        bulbs.push(tint(place(blob(0.07, 0.09, 0.07, 1), [p.x + side.x * 1.6 * s, p.y + 1.25 - sag, p.z + side.z * 1.6 * s]), colors[(i + (s > 0 ? 2 : 0)) % colors.length]!));
      }
    }
    const bulbMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    bulbMat.color.setScalar(3.0);
    this.festival.add(new THREE.Mesh(merge(bulbs), bulbMat));
    // lanterns: a warm paper box with a light inside, drifting up and around
    const lanternGeo = merge([
      tint(sweep([v3(0, 0, 0), v3(0, 0.34, 0)], (k) => 0.13 + 0.05 * Math.sin(k * Math.PI), { radial: 8, steps: 6, startCap: 'flat', endCap: 'flat' }), 0xffc98a),
      tint(place(blob(0.1, 0.02, 0.1, 1), [0, 0.35, 0]), 0x8a4a3a),
      tint(place(blob(0.1, 0.02, 0.1, 1), [0, -0.01, 0]), 0x8a4a3a),
    ]);
    const lanternMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    lanternMat.color.setScalar(2.4);
    for (let i = 0; i < 34; i++) {
      const mesh = new THREE.Mesh(lanternGeo, lanternMat);
      const x = rng.range(-22, 22), z = rng.range(edgeZ - 34, 6);
      mesh.add(makeHalo(0xffb866, 1.6, 0.35).translateY(0.17));
      this.festival.add(mesh);
      this.lanterns.push({ mesh, x, z, speed: rng.range(0.25, 0.6), phase: rng.range(0, 40) });
    }
    this.festival.visible = false;
    this.scene.add(this.festival);
  }

  override reset(): void {
    this.rockets.length = 0;
    this.setBoard(null);
  }

  /** Stands a character on the turf at an anchor (the island rises toward its rim). */
  stand(who: Character, at: Anchor): void {
    who.placeAt(at);
    who.root.position.y = this.mainIsland.heightAt(at.position.x, at.position.z) ?? 0;
  }

  /** Arranges Haven for a moment of the story. `title` is the finished bridge with only Lumi about. */
  setVariant(variant: HavenVariant): void {
    const { lumi, kai, nova } = this.cast;
    const friends = variant === 'bonus' || variant === 'festival';
    kai!.root.visible = nova!.root.visible = friends;
    lumi!.placeAt(variant === 'evening' ? HAVEN.lumiNear : HAVEN.lumi);
    this.festivalTarget = variant === 'festival' ? 1 : 0;
    this.festival.visible = variant === 'festival';
    this.bridge.setSections(variant === 'arrival' ? 0 : 3, true);
    this.bonusRing.group.visible = variant === 'bonus';
    this.bonusRing.setState(variant === 'bonus' ? 'target' : 'dormant', true);
    this.gateway.setOpen(0);
    this.bridge.rings.forEach((ring, i) => {
      // festival rings hang in new places; the Tuesday rings keep the light they earned
      ring.moveTo(variant === 'festival' ? HAVEN.festivalRings[i]! : RING_POINTS[i]!);
      ring.setState(variant === 'arrival' || variant === 'festival' ? 'dormant' : 'lit', true);
    });
    this.look.exposure = variant === 'evening' ? 0.88 : 1.0;
    this.setBoard(null);
  }

  /** The challenge board: title, a line of instruction and a row of progress stars; null puts it away. */
  setBoard(data: { title: string; body: string; value: number; total: number } | null): void {
    this.boardData = data;
    if (!data) return;
    const theme = THEMES.haven;
    this.board.paint((ctx, w, h) => {
      glass(ctx, 26, 26, w - 52, h - 52, theme, { radius: 34, glow: 1.4, borderWidth: 2.5 });
      ctx.fillStyle = theme.accent;
      sparkle(ctx, 78, 92, 17);
      ctx.fillStyle = theme.text;
      ctx.font = font(600, 38);
      ctx.textBaseline = 'middle';
      ctx.fillText(data.title, 110, 94);
      ctx.font = font(400, 26);
      ctx.fillStyle = theme.dim;
      wrap(ctx, data.body, w - 140).forEach((line, i) => ctx.fillText(line, 70, 160 + i * 36));
      for (let i = 0; i < data.total; i++) {
        const x = w / 2 + (i - (data.total - 1) / 2) * 76 - 40, y = h - 96;
        ctx.lineWidth = 3;
        ctx.strokeStyle = theme.accent;
        ctx.fillStyle = theme.accent;
        ctx.beginPath();
        ctx.arc(x, y, 24, 0, TAU);
        ctx.stroke();
        if (i < data.value) sparkle(ctx, x, y, 17);
      }
      ctx.font = font(600, 22);
      ctx.fillStyle = theme.text;
      spaced(ctx, `${data.value} / ${data.total}`, w - 170, h - 96, 3);
    });
  }

  /** Sends `count` fireworks up over the bridge. */
  fireworks(count: number, spanSeconds = 3): void {
    for (let i = 0; i < count; i++) {
      this.rockets.push({
        at: v3(this.rng.range(-22, 22), this.rng.range(11, 26), this.rng.range(-50, -20)),
        delay: (i / Math.max(1, count)) * spanSeconds + this.rng.range(0, 0.25),
        color: new THREE.Color(this.rng.pick(FIREWORK_HUES)),
      });
    }
  }

  override update(frame: FrameContext): void {
    super.update(frame);
    const { dt, time } = frame;
    this.time.value = time;
    this.sky.update(time, frame.camera, frame.pixelHeight);
    this.floating.update(time, frame.pixelHeight);
    this.shootingStars.update(dt, frame.camera);
    this.bridge.update(dt, time);
    this.gateway.update(dt, time);
    if (this.bonusRing.group.visible) {
      // the bonus ring drifts from side to side: a moving target
      const p = HAVEN.bonusRing;
      this.bonusRing.moveTo(_p.set(p.x + Math.sin(time * 0.55) * 3.2, p.y + Math.sin(time * 0.8) * 0.5, p.z));
      this.bonusRing.update(dt, time);
    }
    for (const d of this.drifting) d.object.position.y = d.baseY + Math.sin(time * 0.17 + d.phase) * d.amp;
    for (const m of this.motes) m.setPixelHeight(frame.pixelHeight);

    // fireworks: a shell bursts, then crackles
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i]!;
      r.delay -= dt;
      if (r.delay > 0) continue;
      this.bursts.emit(r.at, { count: 170, color: r.color, color2: _white, speed: 15, spread: 0.3, life: 2.3, size: 0.85, gravity: 2.6 });
      this.bursts.emit(r.at, { count: 50, color: _white, speed: 5, life: 1.3, size: 0.6, gravity: 1 });
      this.onFirework?.(r.at);
      this.rockets.splice(i, 1);
    }
    this.bursts.update(dt, frame.pixelHeight);

    this.festivalK = damp(this.festivalK, this.festivalTarget, 1.5, dt);
    this.sky.setFestival(this.festivalK);
    if (this.festival.visible) {
      for (const l of this.lanterns) {
        const y = ((time * l.speed + l.phase) % 34) - 4;
        l.mesh.position.set(l.x + Math.sin(time * 0.2 + l.phase) * 1.5, y, l.z + Math.cos(time * 0.17 + l.phase) * 1.5);
        l.mesh.rotation.y = time * 0.3 + l.phase;
      }
    }
    this.boardShown = damp(this.boardShown, this.boardData ? 1 : 0, 5, dt);
    this.board.opacity = this.boardShown;
    this.board.mesh.position.y = 1.75 + Math.sin(time * 0.9) * 0.03 - (1 - this.boardShown) * 0.2;
  }
}

const _p = new THREE.Vector3();
const _white = new THREE.Color(1, 0.97, 0.9);
