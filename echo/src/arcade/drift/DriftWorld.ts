import * as THREE from 'three';
import { Character } from '../../characters/Character';
import { CAST } from '../../characters/cast';
import { Rng, clamp01, damp, ease, lerp } from '../../core/math';
import { Bursts } from '../../render/Bursts';
import { GLSL_OUTPUT } from '../../render/glsl';
import { font, glass, roundRect, spaced } from '../../ui/draw';
import { anchor, type BuildContext, type FrameContext } from '../../world/World';
import { glowOf, sizeOf } from '../../world/dressing';
import { makeHalo } from '../../world/haven/atmosphere';
import { Batch, Rings } from '../fx';
import { Minigame, type Outcome } from '../Minigame';
import { MINIGAMES } from '../registry';
import { DRIFT } from '../script';
import { SpriteActor } from '../sprites/actor';
import { SPRITES } from '../sprites/battle';
import { buildStage, type Stage } from '../stage';
import { PAD, paintHint, type Paint, type UiEl } from '../ui';
import { Sea } from './sea';
import { CASTAWAYS, HOOK_OUT, MAX_LIGHT, PLANS, TILE, Voyage, WOOD_PER_TILE, nextDeed, type CrewId, type Item, type ItemKind, type VoyageEvent } from './voyage';

/** How high the deck rides above the water; and how far up the mast the line is made fast and the lantern hangs. */
const DECK = 0.3, PEG = 1.25, LAMP = 2.25;
/** Where on the lantern's own tile the mast is stepped: its back corner, which leaves the front of it to stand on. */
const MAST = { x: 0.34, z: 0.34 } as const;
/** How fast the tide carries the raft, in metres a second: what the sea, the islands and the lighthouse go by at. */
const CRUISE = 1.55;
/** How wide the voyage is seen, in degrees: the hook's whole reach to either side, and no more. */
const VIEW = 41;
/**
 * The lighthouse, as the raft comes in: where it stands, how deep its rock sits in the sea, how high its lamp is,
 * and where on its jetty (which reaches out toward the raft's path) someone can stand. Measured on the model with
 * tools/assets/profile.mjs --top.
 */
const HOUSE = { x: -9.5, z: -12, sink: 2.75, lamp: 14.2, jetty: new THREE.Vector3(3.7, 3.2, 0.6), half: 5.9 } as const;
/** The sprites are a duel's size in their own game; aboard a raft they are smaller, and the wyrm is drawn large. */
const CREW_SCALE = 1.0, WYRM_SCALE = 1.5;
/** How each thing that floats sits in the water: how deep, how big, and how much foam it makes. */
const FLOAT: Record<Exclude<ItemKind, 'castaway'>, { id: string; sink: number; scale: number; foam: number }> = {
  wood: { id: 'drift-wood', sink: 0.1, scale: 1.3, foam: 2.0 },
  crate: { id: 'drift-crate', sink: 0.2, scale: 1.4, foam: 2.0 },
  buoy: { id: 'glow-buoy', sink: 0.16, scale: 1.5, foam: 1.6 },
};

const WARM = new THREE.Color(1.0, 0.72, 0.36), SPRAY = new THREE.Color(0.5, 0.88, 1.0), WHITE = new THREE.Color(1, 0.97, 0.9);
const WOOD = new THREE.Color(0.95, 0.8, 0.58), ALARM = new THREE.Color(1.0, 0.36, 0.56), READY = new THREE.Color(1.0, 0.8, 0.42);
const CREW_HEX: Record<CrewId, string> = { cindle: '#ffa24a', nimbray: '#5fd0ff', tufflet: '#ff8fc4' };
const UP = new THREE.Vector3(0, 1, 0);

const FLAT_VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
/** Where a tile can be laid: a square of marching light on the water, with a plus in it. */
const SLOT_FS = /* glsl */ `
uniform float uTime, uHover; uniform vec3 uColor;
varying vec2 vUv;
void main(){
  vec2 q = abs(vUv * 2.0 - 1.0);
  float box = max(q.x, q.y);
  float off = (box - 0.84) / 0.045;
  float edge = exp(-off * off) * (0.55 + 0.45 * sin((q.x > q.y ? vUv.y : vUv.x) * 26.0 + uTime * 3.0));
  float plus = max(exp(-q.x * q.x * 400.0) * step(q.y, 0.3), exp(-q.y * q.y * 400.0) * step(q.x, 0.3));
  float fill = (1.0 - smoothstep(0.7, 0.88, box)) * (0.07 + 0.3 * uHover);
  gl_FragColor = vec4(uColor * (edge + plus * 0.9 + fill) * (0.75 + 0.9 * uHover), 1.0);
  ${GLSL_OUTPUT}
}`;
/** Where the hook will come down: a ring that closes to a mark when it is on something. */
const AIM_FS = /* glsl */ `
uniform float uLock, uShow; uniform vec3 uColor;
varying vec2 vUv;
void main(){
  vec2 q = vUv * 2.0 - 1.0; float r = length(q);
  float at = mix(0.78, 0.5, uLock), off = (r - at) / 0.05, out_ = (r - at - 0.16) / 0.07;
  float ring = exp(-off * off);
  float ticks = exp(-out_ * out_) * step(0.9, abs(cos(atan(q.y, q.x) * 2.0)));
  float dot_ = exp(-r * r * 60.0) * 0.6;
  gl_FragColor = vec4(uColor * (ring + ticks + dot_) * uShow, 1.0);
  ${GLSL_OUTPUT}
}`;
const BEAM_VS = /* glsl */ `
varying float vAlong, vFar; varying vec3 vN; varying vec3 vV;
void main(){
  vAlong = position.z;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFar = length(mv.xyz);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
/** The lighthouse's beam: a cone of lit air, brightest looked at through its middle, thinning to nothing at its end. */
const BEAM_FS = /* glsl */ `
uniform float uStrength; uniform vec3 uColor;
varying float vAlong, vFar; varying vec3 vN; varying vec3 vV;
void main(){
  // (clamped: MSAA can carry vAlong past the cone's end, and a power of a negative number is not a number)
  float through = pow(abs(dot(normalize(vN), normalize(vV))), 1.6), left = clamp(1.0 - vAlong, 0.0, 1.0);
  // it is a shaft of light seen from a way off: where it sweeps over the eye itself there is nothing to draw
  gl_FragColor = vec4(uColor * through * left * sqrt(left) * uStrength * smoothstep(25.0, 110.0, vFar), 1.0);
  ${GLSL_OUTPUT}
}`;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _tint = new THREE.Color();
const _slope = { x: 0, z: 0 };
const _seaPlane = new THREE.Plane(UP, 0);
const _deckPlane = new THREE.Plane(UP, -DECK * 0.5);

/** The hook's line: a thin ribbon hung between two points and turned to face the eye. */
class Rope {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly position: Float32Array;
  private static readonly at = new THREE.Vector3();
  private static readonly run = new THREE.Vector3();
  private static readonly side = new THREE.Vector3();
  private static readonly sight = new THREE.Vector3();

  /** Half the line's width, in metres. */
  width = 0.018;

  constructor(private readonly points = 18) {
    this.position = new Float32Array(points * 2 * 3);
    const index: number[] = [];
    for (let i = 0; i < points - 1; i++) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(index);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xe9d9b6, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
  }

  /** Hangs the line from `from` to `to`, sagging `sag` metres at its middle. */
  hang(from: THREE.Vector3, to: THREE.Vector3, sag: number, eye: THREE.Vector3): void {
    const n = this.points, at = Rope.at, run = Rope.run, side = Rope.side;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      at.lerpVectors(from, to, k);
      at.y -= sag * 4 * k * (1 - k);
      // across the line: at right angles to its run and to the line of sight
      run.subVectors(to, from);
      run.y -= sag * 4 * (1 - 2 * k);
      side.crossVectors(run, Rope.sight.subVectors(eye, at));
      const length = side.length();
      if (length > 1e-6) side.multiplyScalar(this.width / length);
      this.position.set([at.x - side.x, at.y - side.y, at.z - side.z, at.x + side.x, at.y + side.y, at.z + side.z], i * 6);
    }
    this.mesh.geometry.attributes.position!.needsUpdate = true;
  }
}

/** A tile of the raft as it is drawn: growing as it is lashed on, flashing as it lands. */
interface TileView {
  readonly cx: number;
  readonly cz: number;
  grow: number;
  flash: number;
  readonly turn: number;
}

/** Something afloat as it is drawn. */
interface ItemView {
  grow: number;
  readonly yaw: number;
  readonly spin: number;
}

type Shot = 'house' | 'raft' | 'arrive' | 'dark';

/**
 * Driftlight: a raft on Haven's Tidewater at dusk, carried toward a lighthouse. Hook in what drifts by: glow for
 * the lantern, wood to lay the raft wider, three sprites adrift who come aboard and help. See the tide wyrm off
 * before it takes a plank.
 *
 * The rules are in voyage.ts and the water in sea.ts. This draws the one on the other, and lends the player a hook.
 */
export class DriftWorld extends Minigame {
  readonly id = 'drift' as const;
  readonly soundscape = 'arcadeDrift' as const;
  voyage: Voyage | null = null;
  /** Whether the voyage is under way and the hook is the player's. */
  sailing = false;
  /** Hooks thrown and tiles laid by hand this voyage, for the tests. */
  readonly stats = { casts: 0, built: 0 };

  private stage!: Stage;
  private sea!: Sea;
  private fog!: THREE.FogExp2;
  private readonly bursts = new Bursts(2200);
  private readonly rings = new Rings(14);
  private readonly rng = new Rng(4421);

  // ---- the raft ----
  private readonly raft = new THREE.Group();
  private tiles!: Batch;
  private tileTall = 0.65;
  private tileFit = 1;
  private readonly tileViews = new Map<string, TileView>();
  private readonly slots: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  private mastGlow = { value: 1 };
  private mastGlowFull = 1;
  private lampHalo!: THREE.Sprite;
  private lamp: THREE.PointLight | null = null;
  /** The lantern as it is drawn, 0..1: it follows the rules a moment behind, and jumps when it is fed. */
  private lit = 1;
  private lampPulse = 0;
  private shownLight = MAX_LIGHT;

  // ---- what floats ----
  private readonly floats = {} as Record<Exclude<ItemKind, 'castaway'>, Batch>;
  private readonly itemViews = new Map<number, ItemView>();
  private readonly crew = {} as Record<CrewId, { actor: SpriteActor; aboard: boolean }>;
  private sparkIn = 1;

  // ---- the hook ----
  private readonly hook = new THREE.Group();
  private readonly rope = new Rope();
  private readonly aim = new THREE.Vector3();
  private aimOn = false;
  private aimLock = 0;
  private locked: Item | 'wyrm' | null = null;
  private aimMark!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private hoverSlot: { cx: number; cz: number } | null = null;
  private autoWait = 0;

  // ---- the wyrm ----
  private wyrm!: THREE.Group;
  private wyrmGlow = { value: 1 };
  private wyrmGlowFull = 1;
  private readonly pips: THREE.Sprite[] = [];
  private readonly wyrmView = { rise: 0, flinch: 0, x: 0, z: 0, seen: false };
  private alarmIn = 0;

  // ---- the way ----
  private readonly house = new THREE.Group();
  private readonly beams = new THREE.Group();
  private readonly beamU = { uStrength: { value: 0.5 }, uColor: { value: new THREE.Color(1.0, 0.86, 0.6) } };
  private houseLamp!: THREE.Sprite;
  private lumi!: Character;
  private readonly isles: { object: THREE.Object3D; baseY: number; phase: number }[] = [];
  private speed = CRUISE;
  private stormK = 0;
  private boltIn = 4;
  private bolt = 0;

  // ---- the picture, and what is written over it ----
  private shot: Shot = 'raft';
  private sweep = 1;
  private gaugeEl: UiEl | null = null;
  private wayEl: UiEl | null = null;
  private toastEl: UiEl | null = null;
  private toastText = '';
  private toastFor = 0;
  private gaugeKey = '';
  private wayKey = '';
  private played = 0;
  private lastWon = false;
  private readonly told = { build: false, wyrm: false, castaway: false, near: false };

  constructor() {
    super();
    // in a headset the player stands at the front of the lantern's tile, the mast behind one shoulder, looking up the tide
    this.seat = anchor(-0.2, DECK, -0.1, 0);
    this.restFocus = 12;
  }

  // ------------------------------------------------------------------------------------------------ building

  async build(ctx: BuildContext): Promise<void> {
    const scene = this.scene, q = ctx.quality;
    this.stage = await buildStage(ctx, this, { cloudSea: null, farIslands: false, shadowSpan: 7, seed: 41 });
    Object.assign(this.look, { exposure: 0.98, bloom: 0.26, saturation: 1.22, vignette: 0.4 });
    this.fog = scene.fog as THREE.FogExp2;
    this.sea = new Sea(q);
    scene.add(this.sea.group, this.raft, this.rings.group, this.bursts.points);

    // ---- Haven's islands, hanging over the water and going by ----
    const kinds = [{ id: 'island-a', turf: 10.4 }, { id: 'island-b', turf: 10.8 }] as const;
    const hung: [x: number, y: number, z: number, radius: number][] = [
      [-36, 7, -58, 9], [42, 10, -118, 12], [-72, 17, -186, 17], [60, 6, -250, 10], [-46, 12, -318, 13], [94, 24, -380, 20], [-112, 28, -96, 22], [33, 8, 24, 6], [-54, 14, -440, 15],
    ];
    for (const [i, [x, y, z, radius]] of hung.entries()) {
      const kind = kinds[i % 2]!, model = await ctx.assets.instance(kind.id);
      const scale = (radius * 2) / (await sizeOf(ctx, kind.id))[0];
      model.scale.setScalar(scale);
      model.rotation.y = i * 1.9;
      model.position.set(x, y - kind.turf * scale, z);
      model.traverse((child) => {
        child.castShadow = child.receiveShadow = false;
      });
      scene.add(model);
      this.isles.push({ object: model, baseY: model.position.y, phase: i * 2.3 });
    }
    await ctx.step('drift: sea');

    // ---- the raft: its tiles as one batch, the mast and its lantern ----
    const tileSize = await sizeOf(ctx, 'raft-tile');
    this.tileTall = tileSize[1];
    this.tileFit = TILE / tileSize[0];
    this.tiles = new Batch(await ctx.assets.instance('raft-tile'), 26, this.raft);
    const mast = await ctx.assets.instance('raft-mast');
    mast.position.set(MAST.x, DECK - 0.03, MAST.z);
    this.raft.add(mast);
    this.mastGlow = glowOf(mast);
    this.mastGlowFull = this.mastGlow.value;
    this.lampHalo = makeHalo(0xffb866, 3.6, 1);
    this.lampHalo.position.set(MAST.x, DECK + LAMP, MAST.z);
    this.raft.add(this.lampHalo);
    if (q.tier !== 'low') {
      this.lamp = new THREE.PointLight(0xffb060, 0, 16, 1.6);
      this.lamp.position.set(MAST.x, DECK + LAMP, MAST.z);
      this.raft.add(this.lamp);
    }
    const slotQuad = new THREE.PlaneGeometry(TILE * 0.96, TILE * 0.96).rotateX(-Math.PI / 2);
    for (let i = 0; i < 16; i++) {
      const slot = new THREE.Mesh(slotQuad, new THREE.ShaderMaterial({
        vertexShader: FLAT_VS, fragmentShader: SLOT_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
        uniforms: { uTime: this.stage.time, uHover: { value: 0 }, uColor: { value: READY.clone() } },
      }));
      slot.visible = false;
      slot.renderOrder = 3;
      this.raft.add(slot);
      this.slots.push(slot);
    }

    // ---- what the tide brings ----
    for (const kind of Object.keys(FLOAT) as (keyof typeof FLOAT)[]) this.floats[kind] = new Batch(await ctx.assets.instance(FLOAT[kind].id), kind === 'wood' ? 34 : 16, scene);
    for (const c of CASTAWAYS) {
      const actor = new SpriteActor(c.who, SPRITES[c.who].element, await ctx.assets.instance(`sp-${c.who}`), await sizeOf(ctx, `sp-${c.who}`));
      actor.root.scale.setScalar(CREW_SCALE);
      scene.add(actor.root);
      this.crew[c.who] = { actor, aboard: false };
    }
    await ctx.step('drift: raft');

    // ---- the hook, its line, and where it is aimed ----
    const hookMetal = new THREE.MeshStandardMaterial({ color: 0xd4e6f4, metalness: 0.85, roughness: 0.25, emissive: 0x3fd0ff, emissiveIntensity: 0.7 });
    const crook = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 8, 20, Math.PI * 1.3), hookMetal);
    crook.rotation.z = Math.PI * 0.85;
    const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8), hookMetal);
    shank.position.set(0.1, 0.1, 0);
    this.hook.add(crook, shank, makeHalo(0x6fe0ff, 0.9, 0.5));
    this.aimMark = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      vertexShader: FLAT_VS, fragmentShader: AIM_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uLock: { value: 0 }, uShow: { value: 0 }, uColor: { value: SPRAY.clone() } },
    }));
    this.aimMark.renderOrder = 3;
    scene.add(this.hook, this.rope.mesh, this.aimMark);

    // ---- the tide wyrm, and the knocks it will take ----
    this.wyrm = await ctx.assets.instance('tide-wyrm');
    this.wyrm.scale.setScalar(WYRM_SCALE);
    this.wyrm.visible = false;
    this.wyrmGlow = glowOf(this.wyrm);
    this.wyrmGlowFull = this.wyrmGlow.value;
    scene.add(this.wyrm);
    for (let i = 0; i < 3; i++) {
      const pip = makeHalo(0xffe2a0, 0.6, 1);
      pip.visible = false;
      scene.add(pip);
      this.pips.push(pip);
    }

    // ---- the lighthouse, its beam, and Lumi on its jetty ----
    this.house.add(await ctx.assets.instance('lighthouse'));
    const cone = new THREE.ConeGeometry(1, 1, 24, 1, true).translate(0, -0.5, 0).rotateX(-Math.PI / 2);
    for (const turn of [0, Math.PI]) {
      const beam = new THREE.Mesh(cone, new THREE.ShaderMaterial({ vertexShader: BEAM_VS, fragmentShader: BEAM_FS, uniforms: this.beamU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
      beam.scale.set(10, 10, 260);
      beam.rotation.y = turn;
      beam.frustumCulled = false;
      this.beams.add(beam);
    }
    this.beams.position.set(0, HOUSE.lamp, 0);
    this.houseLamp = makeHalo(0xffd9a0, 12, 1);
    this.houseLamp.position.set(0, HOUSE.lamp, 0);
    this.house.add(this.beams, this.houseLamp);
    scene.add(this.house);
    this.lumi = this.addPerson('lumi', await Character.create(ctx, CAST.lumi, 'lumi'));
    this.lumi.place(0, 0, 0, 0).setPose('standOpen', { immediate: true });
    const aura = makeHalo(CAST.lumi.aura, 2.2, 0.18);
    aura.position.set(0, 0.95, -0.15);
    this.lumi.root.add(aura);
    this.reset();
  }

  // ------------------------------------------------------------------------------------------------ a voyage

  override reset(): void {
    this.voyage = null;
    this.sailing = false;
    this.stats.casts = this.stats.built = 0;
    this.tileViews.clear();
    this.itemViews.clear();
    this.gaugeEl = this.wayEl = this.toastEl = null;
    this.gaugeKey = this.wayKey = '';
    this.toastFor = 0;
    this.shot = 'raft';
    this.sweep = 1;
    this.locked = this.hoverSlot = null;
    this.aimOn = false;
    this.lit = 1;
    this.shownLight = MAX_LIGHT;
    this.speed = CRUISE;
    this.stormK = this.bolt = 0;
    this.boltIn = 4;
    Object.assign(this.told, { build: false, wyrm: false, castaway: false, near: false });
    Object.assign(this.wyrmView, { rise: 0, flinch: 0, seen: false });
    for (const c of CASTAWAYS) {
      const crew = this.crew[c.who];
      if (!crew) continue;
      crew.aboard = false;
      crew.actor.root.visible = false;
      this.scene.add(crew.actor.root);
    }
    for (const person of this.people) person.clearGesture().setMood('neutral');
  }

  async play(): Promise<Outcome> {
    const arcade = this.arcade, { hud, audio } = arcade.game;
    const plan = PLANS[this.level]!;
    const v = (this.voyage = new Voyage(new Rng(this.rng.int(1, 1e9)), plan));
    arcade.game.reach('drift.intro');

    // ---- the lighthouse first, and Lumi on its jetty, a long way off ----
    this.shot = 'house';
    this.cam.cut();
    hud.setCard(MINIGAMES.drift.title, `${plan.name} · reach the lighthouse`);
    audio.sfx('card');
    await arcade.wait(2.0);
    hud.setCard(null);
    await arcade.wait(0.3);
    await arcade.talk(this.played === 0 ? DRIFT.intro : this.level > 0 && this.lastWon ? DRIFT.harder : DRIFT.again);
    this.played++;

    // ---- then back across the water to the raft, and up to where the whole reach of the hook can be seen ----
    this.shot = 'raft';
    this.sweep = 0;
    this.cam.cut();
    arcade.tween(2.8, (k) => (this.sweep = k), ease.inOutCubic).catch(() => undefined);
    await arcade.wait(1.9);
    this.buildHud();
    arcade.hint(DRIFT.hint);
    this.autoWait = 0.6;
    this.sailing = true;
    arcade.game.reach('drift.ready');
    await arcade.until(() => v.over !== null);
    this.sailing = false;
    this.locked = this.hoverSlot = null;
    arcade.hint(null);

    const how = v.over!, won = how === 'arrived';
    this.lastWon = won;
    arcade.game.reach(won ? 'drift.won' : 'drift.lost');
    this.sweep = 0;
    this.shot = won ? 'arrive' : 'dark';
    arcade.tween(won ? 3 : 2.2, (k) => (this.sweep = k), ease.inOutCubic).catch(() => undefined);
    if (won) {
      audio.sfx('landHo');
      this.lumi.play('cheer').setMood('delighted');
      for (const id of v.crew) this.crew[id].actor.jump(0.4);
      this.fireworks();
      await arcade.wait(3.2);
    } else {
      audio.sfx(how === 'dark' ? 'lanternLow' : 'wyrmBite');
      this.lumi.play('handToChest');
      await arcade.wait(2.4);
    }
    await arcade.talk(won ? DRIFT.won : DRIFT.lost[how]);
    const outcome: Outcome = { won, stars: v.stars, summary: DRIFT.summary(how, v.tiles.size, v.crew.length, plan.name) };
    if (won) this.level = Math.min(PLANS.length - 1, this.level + 1);
    return outcome;
  }

  /** What the rules say has happened, made into something seen and heard. */
  private onEvent(e: VoyageEvent): void {
    const arcade = this.arcade, { audio, app } = arcade.game, v = this.voyage!, sea = this.sea;
    const onWater = (x: number, z: number, lift = 0.05): THREE.Vector3 => _a.set(x, sea.height(x, z) + lift, z);
    switch (e.type) {
      case 'cast':
        audio.sfx('hookCast', { pitch: this.rng.range(0.94, 1.08) });
        break;
      case 'landed': {
        const at = onWater(e.x, e.z);
        this.rings.emit(at, e.caught ? 2.0 : 1.4, SPRAY, 0.5);
        this.bursts.emit(at, { count: e.caught ? 18 : 10, color: SPRAY, color2: WHITE, speed: 2.4, life: 0.5, size: 0.08, gravity: 6, toward: UP });
        audio.sfx('hookSplash', { gain: e.caught ? 1 : 0.6, pitch: this.rng.range(0.9, 1.15) });
        break;
      }
      case 'gather': {
        const kind = e.item.kind;
        // brought in on the hook, it lands at the foot of the mast; otherwise it comes aboard where it was
        const at = e.by === 'hook' ? _a.set(0, this.raft.position.y + DECK + 0.3, 0) : onWater(e.item.x, e.item.z, 0.3);
        if (kind === 'wood' || kind === 'crate') {
          this.bursts.emit(at, { count: 12, color: WOOD, color2: WHITE, speed: 1.6, life: 0.5, size: 0.07, gravity: 3 });
          audio.sfx('woodGet', { pitch: this.rng.range(0.92, 1.12) });
        }
        if (kind === 'buoy' || kind === 'crate') {
          // its light goes up the mast and into the lantern
          this.bursts.emit(at, { count: 22, color: WARM, color2: WHITE, speed: 1.2, life: 0.9, size: 0.1, gravity: -2.6, toward: UP });
          this.lampPulse = 1;
          if (kind === 'buoy') audio.sfx('glowGet', { pitch: 1 + 0.25 * clamp01(v.light / MAX_LIGHT) });
        }
        if (e.by === 'crew') this.crew.nimbray.actor.dart(_b.set(e.item.x, DECK, e.item.z), 0.6);
        if (!this.told.build && v.wood >= WOOD_PER_TILE) {
          this.told.build = true;
          arcade.hint(DRIFT.buildHint);
        }
        break;
      }
      case 'rescued': {
        const crew = this.crew[e.who], does = CASTAWAYS.find((c) => c.who === e.who)!.does;
        crew.aboard = true;
        this.raft.add(crew.actor.root);
        this.seatCrew();
        crew.actor.enter();
        crew.actor.jump(0.45);
        audio.sfx('spriteIn');
        this.rings.emit(_a.set(0, this.raft.position.y + DECK + 0.1, 0), 3.2, WARM, 0.7);
        this.toast(DRIFT.hud.aboard(SPRITES[e.who].name, does), 3.4);
        arcade.bark(DRIFT.rescued[Math.min(v.crew.length, DRIFT.rescued.length) - 1]!, 1.6);
        arcade.game.reach('drift.rescued');
        break;
      }
      case 'built': {
        const at = _a.set(e.cx * TILE, this.raft.position.y + DECK + 0.05, e.cz * TILE);
        this.rings.emit(at, 2.0, READY, 0.5);
        this.bursts.emit(at, { count: 16, color: WOOD, color2: WHITE, speed: 1.8, life: 0.55, size: 0.08, gravity: 3.5, toward: UP });
        audio.sfx('tileLay', { pitch: 1 + 0.02 * v.tiles.size });
        this.seatCrew();
        arcade.hint(null);
        arcade.game.reach('drift.built');
        break;
      }
      case 'wyrm': {
        const w = v.wyrm, view = this.wyrmView, at = onWater(w.x, w.z, 0.1);
        if (e.what === 'rise') {
          Object.assign(view, { x: w.x, z: w.z, seen: true });
          audio.sfx('wyrmRise');
          this.rings.emit(at, 3.4, SPRAY, 0.9);
          this.bursts.emit(at, { count: 40, color: SPRAY, color2: WHITE, speed: 3.4, life: 0.8, size: 0.11, gravity: 7, toward: UP });
          if (this.crew.tufflet.aboard) this.crew.tufflet.actor.jump(0.35);
          if (!this.told.wyrm) {
            this.told.wyrm = true;
            arcade.bark(DRIFT.wyrm, 2.6);
          }
          arcade.game.reach('drift.wyrm');
        } else if (e.what === 'hit' || e.what === 'driven') {
          view.flinch = 1;
          arcade.hitStop(e.what === 'driven' ? 0.09 : 0.05);
          audio.sfx('wyrmKnock');
          this.bursts.emit(_b.copy(at).setY(at.y + 1.9), { count: 24, color: WHITE, color2: WARM, speed: 3, life: 0.45, size: 0.12, gravity: 2 });
          this.cam.shake(0.18);
          if (e.what === 'hit') this.toast(DRIFT.hud.knocks(w.needed - w.hits), 1.3);
          else {
            audio.sfx('wyrmFlee');
            this.rings.emit(at, 4.2, SPRAY, 1.0);
            this.bursts.emit(at, { count: 60, color: SPRAY, color2: WHITE, speed: 4.2, life: 0.9, size: 0.12, gravity: 8, toward: UP });
            if (this.rng.chance(0.7)) arcade.bark(this.rng.pick(DRIFT.driven), 1.3);
          }
        } else if (e.what === 'lunge') audio.sfx('wyrmLunge');
        else {
          // the bite: splinters, spray, and the tile is gone
          const tile = _b.set(e.cx * TILE, this.raft.position.y + DECK, e.cz * TILE);
          audio.sfx('wyrmBite');
          arcade.hitStop(0.1);
          this.bursts.emit(tile, { count: 46, color: WOOD, color2: WHITE, speed: 4.5, life: 0.8, size: 0.11, gravity: 8, toward: UP });
          this.bursts.emit(tile, { count: 30, color: SPRAY, color2: WHITE, speed: 3.5, life: 0.8, size: 0.1, gravity: 7, toward: UP });
          this.rings.emit(tile, 3.6, ALARM, 0.7);
          this.cam.shake(0.6);
          app.fx.kick = Math.max(app.fx.kick, 0.6);
          this.seatCrew();
          if (!v.over && this.rng.chance(0.65)) arcade.bark(this.rng.pick(DRIFT.bitten), 1.5);
        }
        break;
      }
      case 'storm':
        if (e.on) {
          this.toast(DRIFT.hud.squall, 2.4);
          this.boltIn = 0.4;
          arcade.bark(DRIFT.squall, 2);
        } else arcade.bark(DRIFT.calm, 1.8);
        break;
      case 'low':
        audio.sfx('lanternLow');
        arcade.bark(DRIFT.low, 1.8);
        break;
      case 'end':
        break;
    }
  }

  /** Gives each sprite aboard a place on the raft: the tiles nearest the mast, or beside it while it is all there is. */
  private seatCrew(): void {
    const v = this.voyage;
    if (!v) return;
    const cells = [...v.tiles].map((key) => key.split(',').map(Number) as [number, number]).filter(([cx, cz]) => cx !== 0 || cz !== 0)
      .sort((a, b) => Math.hypot(...a) - Math.hypot(...b) || Math.atan2(a[0], a[1]) - Math.atan2(b[0], b[1]));
    const beside: [number, number][] = [[-0.36, 0.36], [0.4, -0.3], [-0.42, -0.4]];
    v.crew.forEach((id, i) => {
      const cell = cells[i], actor = this.crew[id].actor;
      const [x, z] = cell ? [cell[0] * TILE, cell[1] * TILE] : beside[i]!;
      // each looks out the way the tide comes from, turned a little to its own side
      actor.place(_a.set(x, DECK, z), _b.set(x * 1.6, DECK, z - 6));
    });
  }

  private toast(text: string, seconds: number): void {
    this.toastText = text;
    this.toastFor = seconds;
    this.toastEl?.repaint();
    this.toastEl?.show(true);
  }

  private fireworks(): void {
    const colors = [WARM, SPRAY, new THREE.Color(1.0, 0.5, 0.76), new THREE.Color(0.3, 0.95, 0.6)];
    for (let i = 0; i < 9; i++) {
      this.arcade.game.app.tasks.wait(0.4 + i * 0.32 + this.rng.range(0, 0.12), this.arcade.signal).then(() => {
        const at = new THREE.Vector3(this.house.position.x + this.rng.range(-16, 22), this.rng.range(9, 20), this.house.position.z + this.rng.range(-26, -6));
        this.bursts.emit(at, { count: 160, color: this.rng.pick(colors), color2: WHITE, speed: 10, spread: 0.3, life: 2.2, size: 0.55, gravity: 2.2 });
        this.arcade.game.audio.sfx('firework', { at });
      }, () => undefined);
    }
  }

  // ------------------------------------------------------------------------------------------------ the player's hand

  /** Where the hook is sent for a point on the water: onto the wyrm or the nearest thing, if the point is on one. */
  private target(v: Voyage, out: THREE.Vector3): void {
    this.locked = null;
    const w = v.wyrm;
    if (w.state === 'circling' && Math.hypot(this.aim.x - w.x, this.aim.z - w.z) < 1.7) {
      this.locked = 'wyrm';
      out.set(w.x, 0, w.z);
      return;
    }
    let near = 1.15, best: Item | null = null;
    for (const item of v.items) {
      const d = Math.hypot(this.aim.x - item.x, this.aim.z - item.z);
      if (!item.hooked && d < near) {
        near = d;
        best = item;
      }
    }
    this.locked = best;
    // a thing afloat will have drifted on a little by the time the hook comes down
    if (best) out.set(best.x, 0, best.z + (v.storm ? 2.0 : CRUISE) * (best.kind === 'castaway' ? 0.8 : 1) * HOOK_OUT);
    else out.copy(this.aim);
  }

  private readHand(dt: number): void {
    const arcade = this.arcade, pointer = arcade.pointer, v = this.voyage!;
    this.hoverSlot = null;
    this.aimOn = false;
    if (arcade.auto) {
      // a scripted sailor: as good a one as `autoSkill` says
      this.locked = null;
      if ((this.autoWait -= dt) > 0) return;
      const deed = nextDeed(v);
      this.autoWait = deed ? 0.5 : 0.1;
      if (!deed || !this.rng.chance(arcade.autoSkill)) return;
      if (deed.kind === 'build') v.build(deed.cx, deed.cz);
      else v.cast(deed.x, deed.z);
      return;
    }
    if (!pointer.active) {
      this.locked = null;
      return;
    }
    // a place for a tile under the pointer, if there is the wood to lay one
    if (v.wood >= WOOD_PER_TILE && pointer.onPlane(_deckPlane, _p)) {
      const cx = Math.round(_p.x / TILE), cz = Math.round(_p.z / TILE);
      if (v.slots().some((s) => s.cx === cx && s.cz === cz)) this.hoverSlot = { cx, cz };
    }
    this.aimOn = !this.hoverSlot && pointer.onPlane(_seaPlane, this.aim) !== null;
    if (this.aimOn) this.target(v, _p);
    else this.locked = null;
    if (!pointer.pressed) return;
    if (this.hoverSlot) {
      if (v.build(this.hoverSlot.cx, this.hoverSlot.cz)) this.stats.built++;
    } else if (this.aimOn && v.cast(_p.x, _p.z)) {
      this.stats.casts++;
      arcade.hint(this.told.build && v.wood >= WOOD_PER_TILE && this.stats.built === 0 ? DRIFT.buildHint : null);
    }
  }

  private buildHud(): void {
    const ui = this.arcade.ui;
    this.gaugeEl = ui.add(270 + PAD * 2, 112 + PAD * 2, this.paintGauge()).at(-1, 1, 14, -12).show();
    this.wayEl = ui.add(430 + PAD * 2, 74 + PAD * 2, this.paintWay()).at(0, 1, 0, -12).show();
    this.toastEl = ui.add(560 + PAD * 2, 44 + PAD * 2, paintHint(() => this.toastText)).at(0, -1, 0, 150);
  }

  /** The lantern, the wood in hand, and the raft: the three things a sailor keeps an eye on. */
  private paintGauge(): Paint {
    return (ctx, w, h, el) => {
      const theme = el.layer.theme, v = this.voyage;
      if (!v) return;
      glass(ctx, PAD, PAD, w - PAD * 2, h - PAD * 2, theme, { glow: 0.5 });
      const x = PAD + 16, right = w - PAD - 16;
      ctx.textBaseline = 'middle';
      ctx.font = font(600, 11.5);
      ctx.fillStyle = theme.dim;
      spaced(ctx, DRIFT.hud.lantern.toUpperCase(), x, PAD + 19, 2.5);
      // the lantern: a bar of its own light, which goes rose when it is nearly out
      const k = clamp01(this.shownLight / MAX_LIGHT), low = this.shownLight < 22;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.13)';
      roundRect(ctx, x, PAD + 32, right - x, 11, 5.5);
      ctx.fill();
      if (k > 0.01) {
        const fill = ctx.createLinearGradient(x, 0, right, 0);
        fill.addColorStop(0, low ? '#ff7fa8' : '#ffb347');
        fill.addColorStop(1, low ? '#ffc0d4' : '#ffe9b8');
        ctx.fillStyle = fill;
        ctx.shadowColor = low ? '#ff7fa8' : '#ffb347';
        ctx.shadowBlur = 10;
        roundRect(ctx, x, PAD + 32, Math.max(11, (right - x) * k), 11, 5.5);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      // wood: a pip for each plank toward the next tile, and how many planks are over
      const ready = v.wood >= WOOD_PER_TILE;
      ctx.fillStyle = theme.dim;
      spaced(ctx, DRIFT.hud.wood.toUpperCase(), x, PAD + 65, 2.5);
      for (let i = 0; i < WOOD_PER_TILE; i++) {
        ctx.fillStyle = i < v.wood ? (ready ? theme.accent : '#f2cf9c') : 'rgba(255, 255, 255, 0.16)';
        roundRect(ctx, x + 62 + i * 17, PAD + 59, 12, 12, 3);
        ctx.fill();
      }
      ctx.textAlign = 'right';
      ctx.font = font(700, 13);
      ctx.fillStyle = ready ? theme.accent : theme.dim;
      ctx.fillText(ready ? DRIFT.hud.lay : `${v.wood} / ${WOOD_PER_TILE}`, right, PAD + 66);
      // the raft, and the size that earns its star
      const fine = v.tiles.size >= v.plan.raft;
      ctx.textAlign = 'left';
      ctx.font = font(600, 11.5);
      ctx.fillStyle = theme.dim;
      spaced(ctx, DRIFT.hud.raft.toUpperCase(), x, PAD + 91, 2.5);
      ctx.textAlign = 'right';
      ctx.font = font(700, 15);
      ctx.fillStyle = fine ? theme.accent : theme.text;
      ctx.fillText(`${v.tiles.size} / ${v.plan.raft}${fine ? ' ★' : ''}`, right, PAD + 91);
      ctx.textAlign = 'left';
    };
  }

  /** The way: the raft along a line to the lighthouse, the squall marked on it, and who has been brought aboard. */
  private paintWay(): Paint {
    return (ctx, w, h, el) => {
      const theme = el.layer.theme, v = this.voyage;
      if (!v) return;
      glass(ctx, PAD, PAD, w - PAD * 2, h - PAD * 2, theme, { glow: 0.5 });
      ctx.textBaseline = 'middle';
      ctx.font = font(600, 11.5);
      ctx.fillStyle = theme.dim;
      spaced(ctx, `${MINIGAMES.drift.title} · ${v.plan.name}`.toUpperCase(), PAD + 16, PAD + 19, 2.5);
      // the three sprites: a ring for each, filled once it is aboard
      CASTAWAYS.forEach((c, i) => {
        const cx = w - PAD - 22 - (CASTAWAYS.length - 1 - i) * 20;
        ctx.beginPath();
        ctx.arc(cx, PAD + 19, 6, 0, Math.PI * 2);
        ctx.strokeStyle = CREW_HEX[c.who];
        ctx.lineWidth = 1.6;
        ctx.stroke();
        if (v.crew.includes(c.who)) {
          ctx.fillStyle = CREW_HEX[c.who];
          ctx.shadowColor = CREW_HEX[c.who];
          ctx.shadowBlur = 8;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      });
      const x0 = PAD + 22, x1 = w - PAD - 34, y = PAD + 50, at = (k: number): number => x0 + (x1 - x0) * k;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      if (v.plan.squall) {
        ctx.strokeStyle = 'rgba(140, 170, 255, 0.75)';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(at(v.plan.squall[0]), y);
        ctx.lineTo(at(v.plan.squall[1]), y);
        ctx.stroke();
      }
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(at(v.progress), y);
      ctx.stroke();
      // the raft: a small lit diamond
      const rx = at(v.progress);
      ctx.fillStyle = theme.text;
      ctx.shadowColor = theme.accent;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(rx, y - 7);
      ctx.lineTo(rx + 7, y);
      ctx.lineTo(rx, y + 7);
      ctx.lineTo(rx - 7, y);
      ctx.closePath();
      ctx.fill();
      // the lighthouse: a tower with its lamp lit
      const lx = w - PAD - 20;
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.moveTo(lx - 5, y + 9);
      ctx.lineTo(lx - 3, y - 6);
      ctx.lineTo(lx + 3, y - 6);
      ctx.lineTo(lx + 5, y + 9);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(lx, y - 10, 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    };
  }

  // ------------------------------------------------------------------------------------------------ the frame

  tick(dt: number, time: number): void {
    const arcade = this.arcade, { app, audio } = arcade.game, v = this.voyage;
    this.rings.update(dt);
    if (v && this.sailing) {
      this.readHand(dt);
      v.step(dt);
      for (const e of v.events.splice(0)) this.onEvent(e);
      if (!this.told.near && v.progress > 0.9) {
        this.told.near = true;
        arcade.bark(DRIFT.near, 1.8);
      }
    }

    // ---- the tide: it carries the raft whenever the lantern is alight ----
    const lost = v?.over === 'dark' || v?.over === 'sunk';
    this.speed = damp(this.speed, lost ? 0.25 : v?.over === 'arrived' ? 0.3 : v?.storm ? 2.0 : CRUISE, 1.2, dt);
    this.sea.flow += this.speed * dt;
    for (const isle of this.isles) {
      isle.object.position.z += this.speed * dt;
      if (isle.object.position.z > 90) isle.object.position.z -= 540;
      isle.object.position.y = isle.baseY + Math.sin(time * 0.17 + isle.phase) * 0.5;
    }

    // ---- the weather ----
    this.stormK = damp(this.stormK, v?.storm && !v.over ? 1 : 0, 0.7, dt);
    this.bolt = Math.max(0, this.bolt - dt * 5);
    if (this.stormK > 0.5 && (this.boltIn -= dt) <= 0) {
      this.boltIn = this.rng.range(4.5, 9);
      this.bolt = 1;
      app.fx.flash = Math.max(app.fx.flash, 0.5);
      app.tasks.wait(this.rng.range(0.25, 1.1), arcade.signal).then(() => audio.sfx('thunder', { pitch: this.rng.range(0.85, 1.1) }), () => undefined);
    }

    // ---- the lantern ----
    const light = v ? v.light : MAX_LIGHT;
    this.shownLight = damp(this.shownLight, light, 6, dt);
    this.lit = damp(this.lit, clamp01(light / MAX_LIGHT), 4, dt);
    this.lampPulse = damp(this.lampPulse, 0, 5, dt);

    // ---- the raft's tiles, as the rules have them ----
    if (v) {
      for (const key of v.tiles) {
        if (this.tileViews.has(key)) continue;
        const [cx, cz] = key.split(',').map(Number) as [number, number];
        this.tileViews.set(key, { cx, cz, grow: v.time < 0.1 ? 1 : 0, flash: v.time < 0.1 ? 0 : 1, turn: ((cx * 7 + cz * 13) & 3) * (Math.PI / 2) });
      }
      for (const key of this.tileViews.keys()) if (!v.tiles.has(key)) this.tileViews.delete(key);
    }
    for (const view of this.tileViews.values()) {
      view.grow = Math.min(1, view.grow + dt * 3);
      view.flash = damp(view.flash, 0, 5, dt);
    }

    // ---- the wyrm ----
    const view = this.wyrmView, up = !!v && v.wyrm.state !== 'away' && !v.over;
    view.rise = damp(view.rise, up ? 1 : 0, up ? 5 : 3.2, dt);
    view.flinch = damp(view.flinch, 0, 6, dt);
    if (v && up) {
      view.x = v.wyrm.x;
      view.z = v.wyrm.z;
      // the tile it wants is marked, again and again, until it is seen off or has it
      if ((this.alarmIn -= dt) <= 0) {
        this.alarmIn = 0.5;
        this.rings.emit(_a.set(v.wyrm.cx * TILE, this.raft.position.y + DECK + 0.06, v.wyrm.cz * TILE), 1.7, ALARM, 0.5);
      }
    }

    // ---- the sprites: adrift where the rules have them, aboard where they have been sat ----
    if (v) {
      for (const item of v.items) {
        if (item.kind !== 'castaway' || !item.who) continue;
        const actor = this.crew[item.who].actor;
        if (actor.gone) {
          actor.enter();
          if (!this.told.castaway) {
            this.told.castaway = true;
            arcade.bark(DRIFT.castaway, 2.2);
          }
        }
        actor.place(_a.set(item.x, this.sea.height(item.x, item.z) + 0.12, item.z), _b.set(0, 0, 0));
      }
      // one that drifted past unhooked is gone until the tide brings it round again
      for (const c of CASTAWAYS) {
        const crew = this.crew[c.who];
        if (!crew.aboard && !crew.actor.gone && !v.items.some((i) => i.who === c.who)) crew.actor.root.visible = false;
      }
      // Cindle feeds the lantern: a spark goes up to it every so often
      if (this.crew.cindle.aboard && (this.sparkIn -= dt) <= 0) {
        this.sparkIn = this.rng.range(0.7, 1.4);
        this.bursts.emit(this.crew.cindle.actor.centre(_a), { count: 3, color: WARM, color2: WHITE, speed: 0.5, life: 1.1, size: 0.08, gravity: -1.8, toward: UP });
      }
    }
    for (const c of CASTAWAYS) this.crew[c.who].actor.update(dt, time);

    // ---- what is written over the picture ----
    if (v && this.gaugeEl) {
      const key = `${Math.round(this.shownLight)}|${v.wood}|${v.tiles.size}`;
      if (key !== this.gaugeKey) {
        this.gaugeKey = key;
        this.gaugeEl.repaint();
      }
      const way = `${Math.round(v.progress * 260)}|${v.crew.length}`;
      if (way !== this.wayKey) {
        this.wayKey = way;
        this.wayEl?.repaint();
      }
    }
    if (this.toastFor > 0 && (this.toastFor -= dt) <= 0) this.toastEl?.show(false);
    this.lumi.lookAtPoint(arcade.game.playerEye);
    this.moveCamera(time);
  }

  private moveCamera(time: number): void {
    const cam = this.cam, k = this.sweep, house = this.house.position;
    const sway = Math.sin(time * 0.21) * 0.3, storm = this.stormK;
    // where the whole reach of the hook can be seen: the view the voyage is sailed from
    _a.set(sway + Math.sin(time * 0.9) * 0.12 * storm, 9.9 + this.raft.position.y * 0.6, 10.7);
    _b.set(0, 0, -2.0);
    switch (this.shot) {
      case 'house':
        // from the end of the jetty, between its two lanterns, to Lumi, with the tower going up out of the picture behind her
        cam.eye.set(house.x + 9.6 + Math.sin(time * 0.3) * 0.15, 1.75, house.z + HOUSE.jetty.z + 0.5);
        cam.target.set(house.x + HOUSE.jetty.x, HOUSE.jetty.y - HOUSE.sink + 1.0, house.z + HOUSE.jetty.z);
        cam.fov = 36;
        cam.ease = 2.5;
        break;
      case 'raft':
        // from low astern, the lighthouse a long way ahead, up to the sailing view
        cam.eye.set(lerp(2.4, _a.x, k), lerp(1.45, _a.y, k), lerp(5.6, _a.z, k));
        cam.target.set(lerp(-1.6, _b.x, k), lerp(2.0, _b.y, k), lerp(-40, _b.z, k));
        cam.fov = lerp(44, VIEW, k);
        cam.ease = k < 1 ? 30 : 4;
        break;
      case 'arrive':
        // down beside the raft, to look up at the lighthouse it has reached
        cam.eye.set(lerp(_a.x, 5.6, k), lerp(_a.y, 1.9, k), lerp(_a.z, 7.4, k));
        cam.target.set(lerp(_b.x, house.x + 4.5, k), lerp(_b.y, 6.6, k), lerp(_b.z, house.z, k));
        cam.fov = lerp(VIEW, 56, k);
        cam.ease = 30;
        break;
      case 'dark':
        // in close on the mast, where the light was
        cam.eye.set(lerp(_a.x, 1.2, k), lerp(_a.y, 3.4, k), lerp(_a.z, 5.6, k));
        cam.target.set(0, lerp(_b.y, DECK + 1.5, k), lerp(_b.z, 0, k));
        cam.fov = lerp(VIEW, 40, k);
        cam.ease = 30;
        break;
    }
  }

  override update(frame: FrameContext): void {
    super.update(frame);
    this.stage.update(frame);
    const { dt, time, camera } = frame, sea = this.sea, v = this.voyage, storm = this.stormK;
    this.bursts.update(dt, frame.pixelHeight);
    camera.getWorldPosition(_eye);

    // ---- the weather, in the light and the air ----
    const dark = this.shot === 'dark' ? this.sweep : 0;
    this.look.exposure = lerp(0.98, 0.82, storm) * (1 - 0.45 * dark) + this.bolt * 0.5;
    this.look.saturation = lerp(1.22, 0.96, storm);
    this.stage.key.intensity = lerp(3.0, 0.9, storm);
    this.stage.hemi.intensity = lerp(1.1, 0.7, storm) + this.bolt * 2.5;
    this.fog.density = lerp(0.0046, 0.011, storm);
    sea.storm = storm;

    // ---- the raft, riding the swell ----
    sea.slope(0, 0, _slope);
    const raftY = sea.height(0, 0) * 0.55;
    this.raft.position.y = raftY;
    this.raft.rotation.set(-Math.atan(_slope.z) * 0.5, 0, Math.atan(_slope.x) * 0.5);
    const wyrm = v?.wyrm, wanted = wyrm && wyrm.state !== 'away' && !v?.over ? `${wyrm.cx},${wyrm.cz}` : '';
    let left = 0, right = 0, back = 0;
    this.tiles.begin();
    for (const [key, view] of this.tileViews) {
      const s = this.tileFit * ease.outBack(view.grow), alarm = key === wanted ? 0.5 + 0.5 * Math.sin(time * 14) : 0;
      _m.compose(_p.set(view.cx * TILE, DECK - this.tileTall * s, view.cz * TILE), _q.setFromEuler(_e.set(0, view.turn, 0)), _s.setScalar(s));
      this.tiles.add(_m, _tint.setRGB(1 + view.flash * 1.6 + alarm * 0.9, 1 + view.flash * 1.3 - alarm * 0.35, 1 + view.flash - alarm * 0.2));
      left = Math.min(left, view.cx);
      right = Math.max(right, view.cx);
      back = Math.max(back, view.cz);
    }
    this.tiles.end();

    // ---- where a tile can be laid, once there is the wood for one ----
    const open = v && this.sailing && v.wood >= WOOD_PER_TILE ? v.slots() : [];
    this.slots.forEach((slot, i) => {
      const cell = open[i];
      slot.visible = !!cell;
      if (!cell) return;
      slot.position.set(cell.cx * TILE, DECK - 0.06, cell.cz * TILE);
      const hover = this.hoverSlot?.cx === cell.cx && this.hoverSlot.cz === cell.cz;
      slot.material.uniforms.uHover!.value = damp(slot.material.uniforms.uHover!.value as number, hover ? 1 : 0, 14, dt);
    });

    // ---- the lantern: its glass, its halo, the light it throws, and the pool of it on the water ----
    const flicker = this.lit < 0.22 ? 0.75 + 0.25 * Math.sin(time * 17) * Math.sin(time * 7.3) : 1;
    const glow = (0.06 * (1 - dark) + 0.94 * this.lit) * flicker + 0.6 * this.lampPulse;
    this.mastGlow.value = this.mastGlowFull * glow;
    this.lampHalo.material.color.setRGB(1.0, 0.72, 0.4).multiplyScalar(0.1 + 0.9 * glow);
    this.lampHalo.scale.setScalar(3.6 * (0.7 + 0.3 * glow));
    if (this.lamp) this.lamp.intensity = 12 * glow;
    sea.light = glow;
    sea.reach = v ? v.reach : 8.6;
    sea.ring = damp(sea.ring, this.sailing ? 1 : 0, 3, dt);

    // ---- what floats ----
    sea.beginRipples();
    sea.ripple(((left + right) / 2) * TILE, 0, (Math.max(right - left, back * 2) + 2.4) * TILE, 0.13, 0.9);
    sea.setWake((right - left + 1) * TILE, (back + 0.5) * TILE, clamp01(this.speed / CRUISE));
    for (const batch of Object.values(this.floats)) batch.begin();
    if (v) {
      const house = this.house.position;
      for (const item of v.items) {
        let view = this.itemViews.get(item.id);
        if (!view) this.itemViews.set(item.id, (view = { grow: 0, yaw: item.phase * 3, spin: (item.phase - 3.14) * 0.05 }));
        view.grow = Math.min(1, view.grow + dt * 1.4);
        // nothing is drawn floating through the lighthouse's rock
        if (Math.abs(item.x - house.x) < HOUSE.half && Math.abs(item.z - house.z) < HOUSE.half) continue;
        const kind = item.kind === 'castaway' ? 'wood' : item.kind, float = FLOAT[kind];
        const water = sea.height(item.x, item.z), bob = Math.sin(time * 1.7 + item.phase * 5) * 0.03;
        sea.slope(item.x, item.z, _slope);
        const s = float.scale * ease.outBack(view.grow) * (this.locked === item ? 1.15 : 1);
        _m.compose(
          _p.set(item.x, water - float.sink * s + bob + (item.hooked ? 0.1 : 0), item.z),
          _q.setFromEuler(_e.set(-Math.atan(_slope.z) + Math.sin(time * 1.3 + item.phase) * 0.06, view.yaw + time * view.spin, Math.atan(_slope.x) + Math.cos(time * 1.1 + item.phase) * 0.06)),
          _s.setScalar(s),
        );
        this.floats[kind].add(_m, _tint.setScalar(this.locked === item ? 1.7 : kind === 'buoy' ? 1.1 + 0.25 * Math.sin(time * 3 + item.phase) : 1));
        sea.ripple(item.x, item.z + 0.15, float.foam * (item.hooked ? 1.5 : 1), item.phase, item.hooked ? 1 : 0.7);
      }
      for (const id of this.itemViews.keys()) if (!v.items.some((i) => i.id === id)) this.itemViews.delete(id);
    }
    for (const batch of Object.values(this.floats)) batch.end();

    // ---- the hook and its line ----
    const hand = this.arcade.game.input.xrRay, head = this.hook.position, state = v?.hook.state ?? 'ready';
    // on a screen the line is made fast to the mast; in a headset it is in the hand that holds the controller
    const from = hand ? _a.copy(hand.origin).addScaledVector(hand.direction, 0.06) : _a.set(MAST.x + 0.1, raftY + DECK + PEG, MAST.z - 0.05);
    if (!v || state === 'ready') {
      if (hand) head.copy(hand.origin).addScaledVector(hand.direction, 0.2);
      else head.set(from.x + 0.06, from.y - 0.42, from.z + 0.05);
    }
    else {
      const k = Math.min(1, v.hook.t), water = sea.height(v.hook.x, v.hook.z);
      const reach = Math.hypot(v.hook.tx, v.hook.tz);
      if (state === 'out') head.set(lerp(from.x, v.hook.tx, k), lerp(from.y, water + 0.1, k * k) + Math.sin(k * Math.PI) * (0.5 + 0.11 * reach), lerp(from.z, v.hook.tz, k));
      else head.set(lerp(v.hook.tx, hand ? from.x : v.hook.x, hand ? k : 1), lerp(water + 0.1, from.y - (hand ? 0 : 0.42), k * k * k), lerp(v.hook.tz, hand ? from.z : v.hook.z, hand ? k : 1));
    }
    this.hook.rotation.set(0, state === 'out' ? time * 14 : 0, 0);
    this.hook.scale.setScalar(hand && state === 'ready' ? 0.6 : 1);
    // (held a hand's length from the eye it is a line; seen from the masthead it has to be drawn thick enough to see)
    this.rope.width = hand ? 0.004 : 0.018;
    this.rope.hang(from, head, state === 'out' ? 0.35 : state === 'back' ? 0.08 : 0.02, _eye);

    // ---- where it is aimed ----
    const mark = this.aimMark, show = this.aimOn && this.sailing && v?.hook.state === 'ready' ? 1 : 0;
    mark.material.uniforms.uShow!.value = damp(mark.material.uniforms.uShow!.value as number, show, 12, dt);
    this.aimLock = damp(this.aimLock, this.locked ? 1 : 0, 16, dt);
    mark.material.uniforms.uLock!.value = this.aimLock;
    (mark.material.uniforms.uColor!.value as THREE.Color).copy(this.locked === 'wyrm' ? ALARM : this.locked ? READY : SPRAY);
    if (this.aimOn && v) {
      const lockedItem = this.locked && this.locked !== 'wyrm' ? this.locked : null;
      const x = this.locked === 'wyrm' ? v.wyrm.x : lockedItem ? lockedItem.x : this.aim.x, z = this.locked === 'wyrm' ? v.wyrm.z : lockedItem ? lockedItem.z : this.aim.z;
      // the mark stops where the line does
      const d = Math.hypot(x, z), within = d > v.reach ? v.reach / d : 1;
      mark.position.set(x * within, sea.height(x * within, z * within) + 0.06, z * within);
      mark.scale.setScalar(this.locked === 'wyrm' ? 2.6 : 1.5);
    }

    // ---- the wyrm ----
    const view = this.wyrmView, body = this.wyrm;
    body.visible = view.seen && view.rise > 0.02;
    if (body.visible && v) {
      const w = v.wyrm, lunging = w.state === 'lunging' ? 1 - Math.max(0, w.timer / 0.55) : 0;
      const tx = w.cx * TILE, tz = w.cz * TILE;
      body.position.set(view.x, sea.height(view.x, view.z) - 0.3 - (1 - ease.outCubic(view.rise)) * 3.2 - lunging * 0.5, view.z);
      // it watches the tile it wants; knocked, it rears back; lunging, it comes down on the raft
      body.rotation.set(-0.5 * view.flinch + 0.9 * lunging + Math.sin(time * 2.1) * 0.05, Math.atan2(tx - view.x, tz - view.z), Math.sin(time * 1.6) * 0.07);
      body.scale.set(WYRM_SCALE * (1 + 0.14 * view.flinch), WYRM_SCALE * (1 - 0.16 * view.flinch), WYRM_SCALE * (1 + 0.14 * view.flinch));
      this.wyrmGlow.value = this.wyrmGlowFull * (1 + 5 * view.flinch);
      sea.ripple(view.x, view.z, 2.6, 0.61, view.rise);
      const need = w.state === 'circling' ? w.needed - w.hits : 0;
      this.pips.forEach((pip, i) => {
        pip.visible = i < need;
        if (pip.visible) pip.position.set(view.x + (i - (need - 1) / 2) * 0.5, body.position.y + 2.5 * WYRM_SCALE + 0.35 + Math.sin(time * 5 + i) * 0.05, view.z);
      });
    } else for (const pip of this.pips) pip.visible = false;

    // ---- the lighthouse: nearer with every second sailed, its beam going round ----
    const plan = v?.plan ?? PLANS[this.level]!, toGo = v ? Math.max(0, plan.length - v.time) : plan.length;
    // (having arrived, the raft goes on gliding in under the tower)
    const house = this.house.position.set(HOUSE.x, -HOUSE.sink, HOUSE.z - toGo * CRUISE + (this.shot === 'arrive' ? 4.5 * this.sweep : 0));
    const turn = time * 0.55;
    this.beams.rotation.y = turn;
    // (faint: against a bright dusk sky anything more is a white wedge)
    this.beamU.uStrength.value = 0.11 * (1 - 0.4 * storm);
    sea.beam.set(house.x, house.z, turn, 0.9);
    this.houseLamp.material.color.setRGB(1.0, 0.85, 0.6).multiplyScalar(0.8 + 0.2 * Math.sin(time * 3.1));
    const lx = house.x + HOUSE.jetty.x, lz = house.z + HOUSE.jetty.z;
    this.lumi.root.position.set(lx, HOUSE.jetty.y - HOUSE.sink, lz);
    this.lumi.root.rotation.y = this.shot === 'house' ? Math.atan2(_eye.x - lx, _eye.z - lz) : Math.atan2(-lx, -lz);

    sea.update(dt, camera);
  }
}
