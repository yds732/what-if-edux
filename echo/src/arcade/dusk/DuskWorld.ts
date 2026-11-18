import * as THREE from 'three';
import { Character } from '../../characters/Character';
import { CAST } from '../../characters/cast';
import { Rng, clamp, clamp01, damp, ease, lerp } from '../../core/math';
import { Bursts } from '../../render/Bursts';
import { GLSL_NOISE, GLSL_OUTPUT } from '../../render/glsl';
import { Panel } from '../../ui/Panel';
import { displayFont, font, glass, roundRect, spaced } from '../../ui/draw';
import { anchor, type BuildContext, type FrameContext } from '../../world/World';
import { glowOf } from '../../world/dressing';
import { makeHalo } from '../../world/haven/atmosphere';
import { Batch, BlobShadow, Rings, ownMaterials } from '../fx';
import { Minigame, type Outcome } from '../Minigame';
import { MINIGAMES } from '../registry';
import { DUSK } from '../script';
import { buildStage, type Stage as Scenery } from '../stage';
import { PAD, paintHint, type Paint, type UiEl } from '../ui';
import { GAP, LANE, MAX_FLOCK, STAGES, March, flockRadius, labelOf, leadFor, toneOf, worthOf, type Foe, type GateOp, type MarchEvent } from './march';

const VIEW = 52;
const DECK = LANE + 0.55, AHEAD = 78, BEHIND = 16;
const GATE_TALL = 2.7, GATE_MID = (GAP + LANE) / 2 + 0.05, GATE_WIDE = LANE - GAP + 0.1, LABEL_WIDE = 2.5;
const LANTERN_EVERY = 9, LANTERNS = 12;
const TONE = { good: new THREE.Color(0.25, 1.0, 0.72), bad: new THREE.Color(1.0, 0.3, 0.48), quick: new THREE.Color(1.0, 0.76, 0.26) } as const;
const TONE_HEX = { good: '#5dffc0', bad: '#ff6f96', quick: '#ffc866' } as const;
const LING_SCALE = 1.65, BRUTE_SCALE = 1.2;
const SPARK = new THREE.Color(1.0, 0.74, 0.34), WHITE = new THREE.Color(1, 0.97, 0.9), SMOKE = new THREE.Color(0.55, 0.42, 0.95);
const DUSK_FOG = new THREE.Color(0x1c1036), DAWN_FOG = new THREE.Color(0x4a6a8a);
const UP = new THREE.Vector3(0, 1, 0);

const FLAT_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DECK_VS = `varying vec3 vAt; void main(){ vAt = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DECK_FS = `
uniform float uTime, uGone, uDawn, uHalf, uGain; uniform vec3 uLight, uDusk;
varying vec3 vAt;
float sdBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main(){
  vec2 p = vec2(vAt.x, vAt.z + uGone) / 1.5;
  vec2 q = fract(p) * 2.0 - 1.0;
  float box = sdBox(q, vec2(0.93, 0.93), 0.2);
  float inside = 1.0 - smoothstep(-0.02, 0.02, box);
  float edge = 1.0 - smoothstep(0.0, 0.08, abs(box + 0.07));
  float diamond = 1.0 - smoothstep(0.0, 0.05, abs(abs(q.x) + abs(q.y) - 0.4));
  float sheen = 0.5 + 0.5 * sin(uTime * 1.8 + floor(p.y) * 0.8);
  float rail = 1.0 - smoothstep(0.0, 0.07, abs(abs(vAt.x) - uHalf + 0.12));
  // what the flock has walked on is alight; what is ahead of it is still in the dusk
  float lit = mix(smoothstep(-9.0, 1.0, vAt.z), 1.0, uDawn);
  vec3 light = mix(uDusk, uLight, 0.25 + 0.75 * lit);
  vec3 c = light * (0.3 + edge * 2.6 + diamond * (0.5 + 1.2 * sheen) * lit) * inside + light * rail * 3.0;
  float far = smoothstep(-${AHEAD.toFixed(1)}, -${(AHEAD * 0.45).toFixed(1)}, vAt.z) * smoothstep(${BEHIND.toFixed(1)}, ${(BEHIND - 5).toFixed(1)}, vAt.z);
  gl_FragColor = vec4(c * uGain, (0.34 + 0.6 * max(edge, diamond * 0.6)) * max(inside, rail) * far);
  ${GLSL_OUTPUT}
}`;
const GATE_FS = `
uniform float uTime, uShow, uFlash; uniform vec3 uColor;
varying vec2 vUv;
void main(){
  vec2 q = abs(vUv * 2.0 - 1.0);
  float off = (max(q.x, q.y) - 0.94) / 0.05;
  float frame = exp(-off * off);
  float climb = 0.5 + 0.5 * sin(vUv.y * 34.0 - uTime * 5.0);
  float body = (0.16 + 0.12 * climb) * (1.0 - 0.5 * vUv.y);
  gl_FragColor = vec4(uColor * ((frame * 2.2 + body * 1.5) * uShow + uFlash * (0.8 + 1.0 * climb)), 1.0);
  ${GLSL_OUTPUT}
}`;
const CURTAIN_FS = `
${GLSL_NOISE}
uniform float uTime, uShow; uniform vec3 uColor;
varying vec2 vUv;
void main(){
  vec2 uv = vec2(vUv.x, clamp(vUv.y, 0.0, 1.0));
  float n = fbm2(vec2(uv.x * 9.0 + uTime * 0.015, uv.y * 3.5 - uTime * 0.04));
  float wisp = fbm2(vec2(uv.x * 26.0 - uTime * 0.03, uv.y * 9.0 - uTime * 0.09));
  float body = smoothstep(0.95, 0.3, uv.y + (n - 0.5) * 0.55);
  float ends = smoothstep(0.0, 0.2, uv.x) * smoothstep(1.0, 0.8, uv.x);
  // darkest where the bridge goes into it, paler and thinner toward its top, with pale smoke crossing it
  vec3 c = uColor * (0.35 + 1.5 * uv.y + 0.9 * n) + vec3(0.2, 0.14, 0.42) * smoothstep(0.52, 0.8, wisp) * (0.25 + uv.y);
  // and it is looking back: pairs of pale eyes, here and there, that blink
  vec2 cell = vec2(uv.x * 72.0, uv.y * 23.5), id = floor(cell), f = fract(cell) - 0.5;
  float has = step(0.9, hash12(id)) * step(uv.y, 0.62) * step(0.2, uv.y);
  float blink = smoothstep(0.0, 0.08, sin(uTime * (0.5 + hash12(id + 3.0)) + 30.0 * hash12(id + 5.0)) + 0.92);
  vec2 e = vec2(abs(f.x) - 0.13, f.y);
  c += vec3(0.5, 0.95, 1.0) * exp(-dot(e, e) * 190.0) * has * blink * 1.8;
  gl_FragColor = vec4(c, body * ends * uShow);
  ${GLSL_OUTPUT}
}`;
const SPARK_VS = `
attribute float aSize;
uniform float uPixel;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(aSize * uPixel * 0.85 / max(-mv.z, 0.3), 64.0);
}`;
const SPARK_FS = `
uniform vec3 uColor;
void main(){
  vec2 q = gl_PointCoord - 0.5; float r = length(q) * 2.0;
  gl_FragColor = vec4(mix(uColor, vec3(1.0, 0.96, 0.86), exp(-r * r * 14.0)) * exp(-r * r * 4.5) * 2.4, 1.0);
  ${GLSL_OUTPUT}
}`;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _tint = new THREE.Color();
const _leadPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 2);

interface Sprite {
  x: number;
  z: number;
  grow: number;
  readonly phase: number;
  readonly keen: number;
}

interface FoeView {
  flash: number;
  grow: number;
}

interface GateHalf {
  readonly film: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly label: Panel;
  show: number;
  flash: number;
}
interface GateView {
  id: number;
  readonly group: THREE.Group;
  readonly left: GateHalf;
  readonly right: GateHalf;
}

type Shot = 'meet' | 'march' | 'dawn' | 'after' | 'dark';

export class DuskWorld extends Minigame {
  readonly id = 'duskbreak' as const;
  readonly soundscape = 'arcadeDusk' as const;
  march: March | null = null;
  marching = false;

  private scenery!: Scenery;
  private fog!: THREE.FogExp2;
  private readonly bursts = new Bursts(3200);
  private readonly rings = new Rings(12);
  private readonly rng = new Rng(7741);
  private readonly deckU = { uTime: { value: 0 }, uGone: { value: 0 }, uDawn: { value: 0 }, uHalf: { value: DECK }, uGain: { value: 1 }, uLight: { value: new THREE.Color(0.45, 0.84, 1.0) }, uDusk: { value: new THREE.Color(0.3, 0.22, 0.75) } };

  private flock!: Batch;
  private readonly sprites: Sprite[] = [];
  private flockGlow!: THREE.Sprite;
  private flockLight: THREE.PointLight | null = null;
  private readonly shade = new BlobShadow(1, 0.5);
  private flockX = 0;
  private flockFlash = 0;
  private readonly sparkPos = new Float32Array(160 * 3);
  private readonly sparkSize = new Float32Array(160);
  private readonly sparkU = { uPixel: { value: 1080 }, uColor: { value: SPARK.clone() } };
  private sparkPoints!: THREE.Points;
  private readonly pop: { panel: Panel; life: number } = { panel: new Panel(300, 150, { world: true }), life: 0 };

  private lings!: Batch;
  private brutes!: Batch;
  private readonly foeViews = new Map<number, FoeView>();
  private maw!: THREE.Group;
  private mawGlow = { value: 1 };
  private mawGlowFull = 1;
  private mawHalo!: THREE.Sprite;
  private readonly mawShade = new BlobShadow(2.6, 0.6);
  private mawGone = 0;
  private readonly gates: GateView[] = [];
  private readonly risen: { x: number; y: number; z: number; pace: number; phase: number }[] = [];
  private readonly curtainU = { uTime: { value: 0 }, uShow: { value: 1 }, uColor: { value: new THREE.Color(0.07, 0.035, 0.16) } };

  private litLanterns!: Batch;
  private darkLanterns!: Batch;
  private lumi!: Character;
  private dawn = 0;
  private gone = 0;

  private shot: Shot = 'meet';
  private sweep = 1;
  private flockEl: UiEl | null = null;
  private wayEl: UiEl | null = null;
  private mawSeen = false;
  private toastEl: UiEl | null = null;
  private toastText = '';
  private toastFor = 0;
  private hudKey = '';
  private played = 0;
  private lastWon = false;
  private readonly told = { gate: false, bad: false, brute: false, half: false, most: false };
  private readonly choice = new Map<number, boolean>();
  private readonly soundIn = { struck: 0, lit: 0, maw: 0, dim: 0 };

  constructor() {
    super();
    this.seat = anchor(0, 0, 4.2, 0);
    this.eyeHeight = 1.5;
    this.restFocus = 14;
  }

  async build(ctx: BuildContext): Promise<void> {
    const scene = this.scene;
    this.scenery = await buildStage(ctx, this, { cloudSea: -34, shadowSpan: 8, seed: 52 });
    Object.assign(this.look, { exposure: 0.6, bloom: 0.34, saturation: 1.1, vignette: 0.5 });
    this.fog = scene.fog as THREE.FogExp2;

    const deck = new THREE.Mesh(
      new THREE.PlaneGeometry(DECK * 2, AHEAD + BEHIND).rotateX(-Math.PI / 2).translate(0, 0, (BEHIND - AHEAD) / 2),
      new THREE.ShaderMaterial({ vertexShader: DECK_VS, fragmentShader: DECK_FS, uniforms: this.deckU, transparent: true, depthWrite: false, fog: false }),
    );
    deck.frustumCulled = false;
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(520, 170), new THREE.ShaderMaterial({ vertexShader: FLAT_VS, fragmentShader: CURTAIN_FS, uniforms: this.curtainU, transparent: true, depthWrite: false, fog: false }));
    curtain.position.set(0, 38, -AHEAD + 2);
    curtain.renderOrder = -1;
    this.shade.mesh.renderOrder = this.mawShade.mesh.renderOrder = 1;
    scene.add(deck, curtain, this.shade.mesh, this.mawShade.mesh, this.rings.group, this.bursts.points);

    const lit = await ctx.assets.instance('lantern'), dark = await ctx.assets.instance('lantern');
    for (const m of ownMaterials(lit)) {
      m.emissive = new THREE.Color(1.0, 0.62, 0.3);
      m.emissiveMap = m.map;
      m.emissiveIntensity = 1.5;
    }
    for (const m of ownMaterials(dark)) m.color.setRGB(0.3, 0.26, 0.5);
    this.litLanterns = new Batch(lit, LANTERNS * 2 + 24, scene, false);
    this.darkLanterns = new Batch(dark, LANTERNS * 2, scene, false);
    await ctx.step('dusk: bridge');

    this.flock = new Batch(await ctx.assets.instance('sp-cindle-lite'), MAX_FLOCK + 4, scene);
    const sparks = new THREE.BufferGeometry();
    sparks.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
    sparks.setAttribute('aSize', new THREE.BufferAttribute(this.sparkSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.sparkPoints = new THREE.Points(sparks, new THREE.ShaderMaterial({ vertexShader: SPARK_VS, fragmentShader: SPARK_FS, uniforms: this.sparkU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.sparkPoints.frustumCulled = false;
    this.sparkPoints.renderOrder = 4;
    this.flockGlow = makeHalo(0xffb866, 4, 0.5);
    if (ctx.quality.tier !== 'low') {
      this.flockLight = new THREE.PointLight(0xffb060, 0, 20, 1.5);
      scene.add(this.flockLight);
    }
    this.pop.panel.mesh.visible = false;
    this.pop.panel.mesh.renderOrder = 6;
    scene.add(this.sparkPoints, this.flockGlow, this.pop.panel.mesh);

    const smoulder = async (id: string, strength: number): Promise<THREE.Group> => {
      const model = await ctx.assets.instance(id);
      for (const m of ownMaterials(model)) {
        m.emissive = new THREE.Color(0.62, 0.45, 1.0);
        m.emissiveMap = m.map;
        m.emissiveIntensity = strength;
      }
      return model;
    };
    this.lings = new Batch(await smoulder('gloomling', 0.75), 240, scene, false);
    this.brutes = new Batch(await smoulder('gloom-brute', 0.5), 12, scene);
    this.maw = await ctx.assets.instance('gloom-maw');
    this.maw.visible = false;
    this.mawGlow = glowOf(this.maw);
    this.mawGlowFull = this.mawGlow.value;
    this.mawHalo = makeHalo(0xffc880, 7, 0);
    scene.add(this.maw, this.mawHalo);
    await ctx.step('dusk: gloom');

    const film = new THREE.PlaneGeometry(GATE_WIDE, GATE_TALL);
    const post = new THREE.CylinderGeometry(0.06, 0.08, GATE_TALL + 0.3, 10).translate(0, (GATE_TALL + 0.3) / 2, 0);
    const postLight = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.9, 2.4), fog: false });
    for (let i = 0; i < 3; i++) {
      const group = new THREE.Group();
      const half = (side: number): GateHalf => {
        const mesh = new THREE.Mesh(film, new THREE.ShaderMaterial({
          vertexShader: FLAT_VS, fragmentShader: GATE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
          uniforms: { uTime: this.deckU.uTime, uShow: { value: 0 }, uFlash: { value: 0 }, uColor: { value: new THREE.Color() } },
        }));
        mesh.position.set(side * GATE_MID, GATE_TALL / 2 + 0.05, 0);
        mesh.renderOrder = 2;
        const label = new Panel(420, 300, { world: true });
        label.mesh.scale.set(LABEL_WIDE, LABEL_WIDE * (300 / 420), 1);
        label.mesh.position.set(side * GATE_MID, GATE_TALL / 2 + 0.1, 0.06);
        label.mesh.renderOrder = 3;
        group.add(mesh, label.mesh);
        return { film: mesh, label, show: 0, flash: 0 };
      };
      const view: GateView = { id: 0, group, left: half(-1), right: half(1) };
      for (const x of [-LANE - 0.15, -GAP + 0.05, GAP - 0.05, LANE + 0.15]) {
        const p = new THREE.Mesh(post, postLight);
        p.position.x = x;
        group.add(p);
      }
      group.visible = false;
      scene.add(group);
      this.gates.push(view);
    }

    this.lumi = this.addPerson('lumi', await Character.create(ctx, CAST.lumi, 'lumi'));
    this.lumi.place(-2.0, 0, 1.2, Math.PI * 0.82).setPose('standOpen', { immediate: true });
    const aura = makeHalo(CAST.lumi.aura, 2.2, 0.18);
    aura.position.set(0, 0.95, -0.15);
    this.lumi.root.add(aura);
    this.reset();
  }

  override reset(): void {
    this.march = null;
    this.marching = false;
    this.sprites.length = 0;
    this.foeViews.clear();
    this.risen.length = 0;
    this.choice.clear();
    this.flockEl = this.wayEl = this.toastEl = null;
    this.mawSeen = false;
    this.hudKey = '';
    this.toastFor = this.pop.life = 0;
    this.shot = 'meet';
    this.sweep = 1;
    this.dawn = this.gone = this.mawGone = this.flockX = this.flockFlash = 0;
    Object.assign(this.told, { gate: false, bad: false, brute: false, half: false, most: false });
    for (const g of this.gates) {
      g.id = 0;
      g.group.visible = false;
    }
    if (this.maw) this.maw.visible = false;
    this.lumi?.root.position.set(-2.0, 0, 1.2);
    for (const person of this.people) person.clearGesture().setMood('neutral');
  }

  async play(): Promise<Outcome> {
    const arcade = this.arcade, { hud, audio } = arcade.game;
    const stage = STAGES[this.level]!;
    const m = (this.march = new March(new Rng(this.rng.int(1, 1e9)), stage));
    arcade.game.reach('dusk.intro');

    this.shot = 'meet';
    this.cam.cut();
    hud.setCard(MINIGAMES.duskbreak.title, `${stage.name} · lead the flock to the dawn`);
    audio.sfx('card');
    await arcade.wait(2.0);
    hud.setCard(null);
    await arcade.wait(0.3);
    await arcade.talk(this.played === 0 ? DUSK.intro : this.level > 0 && this.lastWon ? DUSK.harder : DUSK.again);
    this.played++;

    this.shot = 'march';
    this.sweep = 0;
    arcade.tween(2.4, (k) => (this.sweep = k), ease.inOutCubic).catch(() => undefined);
    await arcade.wait(1.5);
    this.buildHud();
    arcade.hint(DUSK.hint);
    audio.sfx('arcadeGo');
    this.marching = true;
    arcade.game.reach('dusk.ready');
    arcade.wait(5).then(() => arcade.hint(null), () => undefined);
    await arcade.until(() => m.over !== null);
    this.marching = false;
    arcade.hint(null);

    const won = m.over === 'dawn';
    this.lastWon = won;
    arcade.game.reach(won ? 'dusk.won' : 'dusk.lost');
    this.sweep = 0;
    if (won) {
      this.shot = 'dawn';
      this.timeScale = 0.35;
      audio.sfx('dawnBreaks');
      arcade.tween(1.1, (k) => (this.mawGone = k), ease.inQuad).then(() => this.breakDusk(), () => undefined);
      arcade.tween(4.2, (k) => (this.sweep = k), ease.inOutCubic).catch(() => undefined);
      await arcade.wait(1.2);
      this.timeScale = 1;
      await arcade.tween(2.6, (k) => (this.dawn = k), ease.outCubic);
      audio.sfx('cheer');
      await arcade.wait(1.0);
      this.shot = 'after';
      this.cam.cut();
      this.lumi.root.position.set(-2.0, 0, 1.2);
      this.lumi.play('cheer').setMood('delighted');
      await arcade.wait(0.8);
    } else {
      this.shot = 'dark';
      arcade.tween(2.4, (k) => (this.sweep = k), ease.inOutCubic).catch(() => undefined);
      audio.sfx('gateLess');
      this.lumi.play('handToChest');
      await arcade.wait(2.4);
    }
    await arcade.talk(won ? DUSK.won : DUSK.lost);
    const outcome: Outcome = { won, stars: m.stars, summary: DUSK.summary(won, m.count, m.tally.lit, stage.name) };
    if (won) this.level = Math.min(STAGES.length - 1, this.level + 1);
    return outcome;
  }

  private breakDusk(): void {
    const m = this.march, app = this.arcade.game.app;
    if (!m?.maw) return;
    const at = _a.set(m.maw.x, 2.6, -m.maw.ahead).clone();
    app.fx.flash = Math.max(app.fx.flash, 0.8);
    app.fx.kick = 1;
    this.cam.shake(0.7);
    this.rings.emit(at, 16, WHITE, 1.4, _p.set(0, 0, 1));
    this.rings.emit(_p.copy(at).setY(0.1), 22, SPARK, 1.6);
    this.bursts.emit(at, { count: 320, color: SPARK, color2: WHITE, speed: 9, spread: 0.5, life: 2.4, size: 0.3, gravity: -1.2 });
    this.bursts.emit(at, { count: 160, color: SMOKE, color2: WHITE, speed: 5, spread: 0.6, life: 1.8, size: 0.22, gravity: -2.5 });
    for (let i = 0; i < 22; i++) this.risen.push({ x: at.x + this.rng.range(-3.2, 3.2), y: this.rng.range(0.4, 4.4), z: at.z + this.rng.range(-2.5, 2.5), pace: this.rng.range(0.9, 2.1), phase: this.rng.range(0, 6.28) });
    for (let i = 0; i < 8; i++) {
      app.tasks.wait(0.5 + i * 0.3 + this.rng.range(0, 0.1), this.arcade.signal).then(() => {
        const up = new THREE.Vector3(this.rng.range(-14, 14), this.rng.range(8, 17), at.z + this.rng.range(-22, -4));
        this.bursts.emit(up, { count: 150, color: this.rng.pick([SPARK, TONE.good, new THREE.Color(1.0, 0.5, 0.76), new THREE.Color(0.45, 0.84, 1.0)]), color2: WHITE, speed: 9, spread: 0.3, life: 2.1, size: 0.5, gravity: 2.2 });
        this.arcade.game.audio.sfx('firework', { at: up });
      }, () => undefined);
    }
  }

  private onEvent(e: MarchEvent): void {
    const arcade = this.arcade, { audio } = arcade.game, m = this.march!, sound = this.soundIn;
    switch (e.type) {
      case 'gate': {
        const tone = toneOf(e.op), side = e.gate.taken === 'left' ? -1 : 1;
        const view = this.gates.find((g) => g.id === e.gate.id);
        if (view) (side < 0 ? view.left : view.right).flash = 1;
        audio.sfx(tone === 'good' ? 'gateMore' : tone === 'bad' ? 'gateLess' : 'gateQuick');
        this.flockFlash = 1;
        this.rings.emit(_a.set(m.x, 0.08, 0.2), 5, TONE[tone], 0.6);
        this.bursts.emit(_a.set(m.x, 0.9, 0), { count: tone === 'bad' ? 14 : 40, color: TONE[tone], color2: WHITE, speed: 3, life: 0.7, size: 0.12, gravity: -1.5, toward: UP });
        this.popUp(tone === 'quick' ? DUSK.hud.quick : labelOf(e.op), TONE_HEX[tone]);
        if (tone === 'bad' && this.rng.chance(0.5)) arcade.bark(this.rng.pick(DUSK.bad), 1.4);
        else if (tone === 'good' && e.after - e.before >= 10 && this.rng.chance(0.55)) arcade.bark(this.rng.pick(DUSK.good), 1.2);
        if (m.count >= MAX_FLOCK && !this.told.most) {
          this.told.most = true;
          this.toast(DUSK.hud.most, 2.2);
        }
        arcade.game.reach('dusk.gate');
        break;
      }
      case 'struck': {
        const struck = this.foeViews.get(e.foe.id);
        if (struck) struck.flash = 1;
        if (e.foe.kind === 'maw') {
          if (sound.maw <= 0) {
            sound.maw = 0.2;
            audio.sfx('mawStruck', { pitch: this.rng.range(0.9, 1.15) });
          }
          if (!this.told.half && e.foe.hp < e.foe.maxHp / 2) {
            this.told.half = true;
            arcade.bark(DUSK.mawHalf, 1.6);
          }
        } else if (sound.struck <= 0) {
          sound.struck = 0.085;
          audio.sfx('sparkThrow', { pitch: this.rng.range(0.85, 1.25) });
        }
        break;
      }
      case 'lit': {
        const at = _a.set(e.foe.x, e.foe.kind === 'ling' ? 0.45 : 1.1, -e.foe.ahead);
        if (e.foe.kind === 'ling') {
          this.bursts.emit(at, { count: 7, color: SPARK, color2: WHITE, speed: 1.6, life: 0.7, size: 0.13, gravity: -2.2 });
          this.bursts.emit(at, { count: 3, color: SMOKE, color2: WHITE, speed: 1.1, life: 0.5, size: 0.16, gravity: -0.5 });
          if (sound.lit <= 0) {
            sound.lit = 0.07;
            audio.sfx('lingLit', { pitch: this.rng.range(0.9, 1.2) });
          }
        } else if (e.foe.kind === 'brute') {
          this.bursts.emit(at, { count: 70, color: SPARK, color2: WHITE, speed: 4.5, life: 1.1, size: 0.2, gravity: -1.5 });
          this.rings.emit(_p.copy(at).setY(0.08), 5.5, SPARK, 0.7);
          audio.sfx('bruteLit');
          arcade.hitStop(0.06);
          this.cam.shake(0.25);
        }
        this.foeViews.delete(e.foe.id);
        break;
      }
      case 'dimmed': {
        this.bursts.emit(_a.set(e.by.x, 0.5, 0.2), { count: 10 + e.lost * 4, color: SMOKE, color2: WHITE, speed: 2.4, life: 0.6, size: 0.14, gravity: -0.8 });
        this.foeViews.delete(e.by.id);
        if (sound.dim <= 0) {
          sound.dim = 0.12;
          audio.sfx('flockDim', { gain: e.lost > 1 ? 1.4 : 1 });
        }
        if (e.lost > 1) {
          arcade.hitStop(0.07);
          this.cam.shake(0.35);
          if (!m.over && this.rng.chance(0.6)) arcade.bark(this.rng.pick(DUSK.dimmed), 1.4);
        }
        this.popUp(`−${e.lost}`, TONE_HEX.bad);
        break;
      }
      case 'wave':
        if (e.brutes > 0 && !this.told.brute) {
          this.told.brute = true;
          arcade.game.app.tasks.wait(5.5, arcade.signal).then(() => arcade.bark(DUSK.brute, 1.8), () => undefined);
        }
        break;
      case 'maw':
        arcade.game.app.tasks.wait(6.5, arcade.signal).then(() => {
          audio.sfx('mawComes');
          arcade.bark(DUSK.maw, 2.2);
          this.mawSeen = true;
          this.wayEl?.repaint();
          arcade.game.reach('dusk.maw');
        }, () => undefined);
        break;
      case 'end':
        break;
    }
  }

  private popUp(text: string, color: string): void {
    this.pop.panel.paint((ctx, w, h) => {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = font(800, text.length > 4 ? 78 : 110);
      ctx.shadowColor = color;
      ctx.shadowBlur = 26;
      ctx.fillStyle = color;
      ctx.fillText(text, w / 2, h / 2 + 6);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fffaf0';
      ctx.fillText(text, w / 2, h / 2 + 6);
    });
    this.pop.life = 1;
  }

  private toast(text: string, seconds: number): void {
    this.toastText = text;
    this.toastFor = seconds;
    this.toastEl?.repaint();
    this.toastEl?.show(true);
  }

  private paintGate(half: GateHalf, op: GateOp): void {
    const tone = toneOf(op), color = TONE_HEX[tone];
    (half.film.material.uniforms.uColor!.value as THREE.Color).copy(TONE[tone]);
    half.label.paint((ctx, w, h) => {
      ctx.fillStyle = 'rgba(18, 8, 40, 0.62)';
      roundRect(ctx, 34, 44, w - 68, h - 88, 34);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const text = labelOf(op);
      ctx.font = op.kind === 'quick' ? font(800, 130) : displayFont(700, text.length > 2 ? 170 : 190);
      ctx.shadowColor = color;
      ctx.shadowBlur = 34;
      ctx.fillStyle = color;
      ctx.fillText(text, w / 2, op.kind === 'quick' ? h / 2 - 26 : h / 2 + 8);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fffaf0';
      ctx.fillText(text, w / 2, op.kind === 'quick' ? h / 2 - 26 : h / 2 + 8);
      if (op.kind === 'quick') {
        ctx.font = font(700, 34);
        ctx.fillStyle = color;
        spaced(ctx, DUSK.hud.quick.toUpperCase(), w / 2, h / 2 + 84, 8, 'center');
      }
    });
  }

  private buildHud(): void {
    const ui = this.arcade.ui;
    this.flockEl = ui.add(190 + PAD * 2, 84 + PAD * 2, this.paintFlock()).at(-1, 1, 14, -12).show();
    this.wayEl = ui.add(430 + PAD * 2, 74 + PAD * 2, this.paintWay()).at(0, 1, 0, -12).show();
    this.toastEl = ui.add(520 + PAD * 2, 44 + PAD * 2, paintHint(() => this.toastText)).at(0, -1, 0, 150);
  }

  private paintFlock(): Paint {
    return (ctx, w, h, el) => {
      const theme = el.layer.theme, m = this.march;
      if (!m) return;
      glass(ctx, PAD, PAD, w - PAD * 2, h - PAD * 2, theme, { glow: 0.5 });
      ctx.textBaseline = 'middle';
      ctx.font = font(600, 11.5);
      ctx.fillStyle = theme.dim;
      spaced(ctx, DUSK.hud.flock.toUpperCase(), PAD + 16, PAD + 19, 2.5);
      ctx.font = font(700, 38);
      ctx.fillStyle = m.count >= m.stage.stars[1] ? theme.accent : theme.text;
      ctx.textAlign = 'left';
      ctx.fillText(String(m.count), PAD + 16, PAD + 54);
      ctx.textAlign = 'right';
      ctx.font = font(800, 22);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i < m.quick ? TONE_HEX.quick : 'rgba(255, 255, 255, 0.16)';
        ctx.fillText('»', w - PAD - 14 - (2 - i) * 20, PAD + 54);
      }
      ctx.textAlign = 'left';
    };
  }

  private paintWay(): Paint {
    return (ctx, w, h, el) => {
      const theme = el.layer.theme, m = this.march;
      if (!m) return;
      glass(ctx, PAD, PAD, w - PAD * 2, h - PAD * 2, theme, { glow: 0.5 });
      ctx.textBaseline = 'middle';
      ctx.font = font(600, 11.5);
      ctx.fillStyle = theme.dim;
      const maw = this.mawSeen ? m.maw : null;
      spaced(ctx, (maw ? DUSK.hud.gloom : `${MINIGAMES.duskbreak.title} · ${m.stage.name}`).toUpperCase(), PAD + 16, PAD + 19, 2.5);
      const x0 = PAD + 22, x1 = w - PAD - 36, y = PAD + 50, at = (k: number): number => x0 + (x1 - x0) * k;
      if (maw) {
        const k = clamp01(1 - maw.hp / maw.maxHp);
        ctx.fillStyle = 'rgba(122, 95, 208, 0.55)';
        roundRect(ctx, x0 - 6, y - 7, x1 - x0 + 34, 14, 7);
        ctx.fill();
        if (k > 0.01) {
          const fill = ctx.createLinearGradient(x0, 0, x1, 0);
          fill.addColorStop(0, '#ffb347');
          fill.addColorStop(1, '#fff0c8');
          ctx.fillStyle = fill;
          ctx.shadowColor = '#ffb347';
          ctx.shadowBlur = 12;
          roundRect(ctx, x0 - 6, y - 7, Math.max(14, (x1 - x0 + 34) * k), 14, 7);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
        return;
      }
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.strokeStyle = theme.accent;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(at(m.progress), y);
      ctx.stroke();
      const fx = at(m.progress);
      ctx.fillStyle = theme.text;
      ctx.shadowColor = theme.accent;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(fx, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      const gx = w - PAD - 22;
      ctx.fillStyle = '#7a5fd0';
      ctx.beginPath();
      ctx.arc(gx, y + 4, 11, Math.PI, 0);
      ctx.lineTo(gx + 11, y + 9);
      ctx.lineTo(gx - 11, y + 9);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#b8f6ff';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(gx + side * 4, y + 1, 1.9, 0, Math.PI * 2);
        ctx.fill();
      }
    };
  }

  tick(dt: number, time: number): void {
    const arcade = this.arcade, m = this.march, sound = this.soundIn;
    this.rings.update(dt);
    for (const key of Object.keys(sound) as (keyof typeof sound)[]) sound[key] -= dt;
    if (m && this.marching) {
      this.lead(m);
      m.step(dt);
      for (const e of m.events.splice(0)) this.onEvent(e);
      this.gone = m.distance;
      for (const gate of m.gates) {
        if (gate.taken || gate.ahead > 34) continue;
        if (!this.told.gate) {
          this.told.gate = true;
          arcade.bark(DUSK.firstGate, 2.2);
        } else if (!this.told.bad && toneOf(gate.left) === 'bad' && toneOf(gate.right) === 'bad') {
          this.told.bad = true;
          arcade.bark(DUSK.badPair, 2.4);
          this.toast(DUSK.hud.between, 3);
        }
      }
    }

    const count = m ? m.count : 0, radius = flockRadius(Math.max(1, count)), sprites = this.sprites;
    while (sprites.length > count) {
      const lost = sprites.pop()!;
      this.bursts.emit(_a.set(lost.x, 0.4, lost.z), { count: 5, color: SMOKE, color2: WHITE, speed: 1.2, life: 0.5, size: 0.12, gravity: -0.6 });
    }
    const leadX = m ? m.x : 0;
    while (sprites.length < count) sprites.push({ x: leadX + this.rng.range(-0.4, 0.4), z: 0.2 + this.rng.range(-0.3, 0.3), grow: m && m.time > 0.2 ? 0 : 1, phase: this.rng.range(0, 6.28), keen: this.rng.range(7, 15) });
    sprites.forEach((s, i) => {
      const r = radius * Math.sqrt((i + 0.5) / count), a = i * 2.39996;
      s.x = damp(s.x, leadX + r * Math.sin(a), s.keen, dt);
      s.z = damp(s.z, radius * 0.8 + 0.25 + r * Math.cos(a) * 0.9, s.keen, dt);
      s.grow = Math.min(1, s.grow + dt * 3.5);
    });
    this.flockX = damp(this.flockX, leadX, 6, dt);
    this.flockFlash = damp(this.flockFlash, 0, 4, dt);

    if (m) for (const foe of m.foes) if (!this.foeViews.has(foe.id)) this.foeViews.set(foe.id, { flash: 0, grow: 0 });
    for (const view of this.foeViews.values()) {
      view.flash = damp(view.flash, 0, 9, dt);
      view.grow = Math.min(1, view.grow + dt * 2);
    }
    for (const lantern of this.risen) lantern.y += lantern.pace * dt;

    if (m && this.flockEl) {
      const key = `${m.count}|${m.quick}|${Math.round(m.progress * 260)}|${m.maw ? Math.round((m.maw.hp / m.maw.maxHp) * 200) : -1}`;
      if (key !== this.hudKey) {
        this.hudKey = key;
        this.flockEl.repaint();
        this.wayEl?.repaint();
      }
    }
    if (this.toastFor > 0 && (this.toastFor -= dt) <= 0) this.toastEl?.show(false);
    this.pop.life = Math.max(0, this.pop.life - dt / 1.1);
    this.lumi.lookAtPoint(arcade.game.playerEye);
    this.moveCamera(time, radius);
  }

  private lead(m: March): void {
    const arcade = this.arcade, pointer = arcade.pointer;
    if (arcade.auto) {
      const gate = m.gates.find((g) => !g.taken);
      if (gate && !this.choice.has(gate.id)) this.choice.set(gate.id, this.rng.chance(arcade.autoSkill));
      m.lead = arcade.autoSkill <= 0 ? 0 : leadFor(m, gate ? this.choice.get(gate.id)! : true);
      return;
    }
    if (pointer.active && pointer.onPlane(_leadPlane, _p)) m.lead = clamp(_p.x, -LANE, LANE);
  }

  private moveCamera(time: number, radius: number): void {
    const cam = this.cam, k = this.sweep, fx = this.flockX, m = this.march;
    _a.set(fx * 0.25, 4.0 + radius * 0.75, 5.4 + radius * 1.7);
    _s.set(fx * 0.4, 0.6, -6.0);
    switch (this.shot) {
      case 'meet':
        cam.eye.set(2.4 + Math.sin(time * 0.3) * 0.15, 1.35, -4.4);
        cam.target.set(-0.7, 0.75, 0.9);
        cam.fov = 40;
        cam.ease = 2.5;
        break;
      case 'march':
        cam.eye.set(lerp(4.6, _a.x, k), lerp(1.6, _a.y, k), lerp(1.2, _a.z, k));
        cam.target.set(lerp(-0.4, _s.x, k), lerp(0.75, _s.y, k), lerp(0.2, _s.z, k));
        cam.fov = lerp(42, VIEW, k);
        cam.ease = k < 1 ? 30 : 5;
        break;
      case 'dawn': {
        const far = m?.maw ? -m.maw.ahead : -12;
        cam.eye.set(lerp(_a.x, 0, k), lerp(_a.y, 3.0, k), lerp(_a.z, 8.6, k));
        cam.target.set(lerp(_s.x, 0, k), lerp(_s.y, 4.4 + 2.5 * k, k), lerp(_s.z, far, k));
        cam.fov = lerp(VIEW, 60, k);
        cam.ease = 30;
        break;
      }
      case 'after':
        cam.eye.set(2.5 + Math.sin(time * 0.3) * 0.2, 1.4, -4.6);
        cam.target.set(-0.6, 0.85, 0.9);
        cam.fov = 42;
        cam.ease = 2.5;
        break;
      case 'dark':
        cam.eye.set(_a.x, lerp(_a.y, 8.4, k), lerp(_a.z, 10.5, k));
        cam.target.copy(_s);
        cam.fov = VIEW;
        cam.ease = 30;
        break;
    }
  }

  override update(frame: FrameContext): void {
    super.update(frame);
    this.scenery.update(frame);
    const { dt, time } = frame, m = this.march, dawn = this.dawn;
    this.bursts.update(dt, frame.pixelHeight);
    this.sparkU.uPixel.value = frame.pixelHeight;
    this.deckU.uTime.value = time;
    this.deckU.uGone.value = this.gone;
    this.deckU.uDawn.value = dawn;

    const dark = this.shot === 'dark' ? this.sweep : 0;
    this.look.exposure = lerp(0.6, 1.06, dawn) * (1 - 0.5 * dark);
    this.look.saturation = lerp(1.1, 1.3, dawn);
    this.look.contrast = lerp(0.36, 0.24, dawn);
    this.look.vignette = lerp(0.52, 0.34, dawn);
    this.look.shadowTint.setRGB(0.02, 0.0, 0.05).lerp(_tint.setRGB(0.0, 0.008, 0.028), dawn);
    this.deckU.uGain.value = lerp(1.8, 1, dawn);
    this.curtainU.uTime.value = time;
    this.curtainU.uShow.value = 1 - dawn;
    const clouds = this.scenery.cloudSea?.material.uniforms;
    if (clouds) {
      (clouds.uLit!.value as THREE.Color).setRGB(0.1, 0.085, 0.3).lerp(_tint.setRGB(0.30, 0.42, 0.80), dawn);
      (clouds.uShade!.value as THREE.Color).setRGB(0.02, 0.016, 0.085).lerp(_tint.setRGB(0.04, 0.10, 0.28), dawn);
      (clouds.uHaze!.value as THREE.Color).setRGB(0.07, 0.04, 0.17).lerp(_tint.setRGB(0.14, 0.24, 0.40), dawn);
      (clouds.uGlow!.value as THREE.Color).setRGB(0.5, 0.3, 0.75).lerp(_tint.setRGB(1.0, 0.6, 0.34), dawn);
    }
    this.sparkU.uColor.value.copy(SPARK).multiplyScalar(lerp(1.7, 1, dawn));
    this.fog.color.copy(DUSK_FOG).lerp(DAWN_FOG, dawn);
    this.fog.density = lerp(0.03, 0.0046, dawn) * (1 + dark);
    this.scenery.hemi.intensity = lerp(0.6, 1.3, dawn);
    this.scenery.key.intensity = lerp(1.5, 3.4, dawn);
    this.scenery.rim.intensity = lerp(4.2, 1.7, dawn);

    this.litLanterns.begin();
    this.darkLanterns.begin();
    const row = LANTERNS * LANTERN_EVERY;
    for (let i = 0; i < LANTERNS; i++) for (const side of [-1, 1]) {
      const along = (((i * LANTERN_EVERY + (side > 0 ? LANTERN_EVERY / 2 : 0) - this.gone) % row) + row) % row, z = BEHIND - 2 - along;
      _m.compose(_p.set(side * (DECK + 0.9), 1.3 + Math.sin(time * 0.9 + i * 1.7 + side) * 0.12, z), _q.identity(), _s.setScalar(2.0));
      (z > -3 || dawn > 0.5 ? this.litLanterns : this.darkLanterns).add(_m);
    }
    for (const l of this.risen) {
      _m.compose(_p.set(l.x + Math.sin(time * 0.6 + l.phase) * 0.4, l.y, l.z), _q.identity(), _s.setScalar(1.4));
      this.litLanterns.add(_m);
    }
    this.litLanterns.end();
    this.darkLanterns.end();

    this.flock.begin();
    const stride = this.marching ? 1 : 0.35;
    for (const s of this.sprites) {
      const hop = Math.max(0, Math.sin(time * 9.5 + s.phase)) * 0.13 * stride + (this.shot === 'after' ? Math.max(0, Math.sin(time * 6 + s.phase)) * 0.25 : 0);
      _m.compose(_p.set(s.x, hop, s.z), _q.setFromEuler(_e.set(0, Math.PI + Math.sin(time * 1.3 + s.phase) * 0.2, Math.sin(time * 9.5 + s.phase) * 0.06 * stride)), _s.setScalar(ease.outBack(s.grow)));
      this.flock.add(_m, _tint.setScalar(1 + this.flockFlash * 1.4));
    }
    this.flock.end();
    const count = this.sprites.length, radius = flockRadius(Math.max(1, count)), mid = radius * 0.8 + 0.25;
    this.flockGlow.visible = count > 0;
    this.flockGlow.position.set(this.flockX, 0.5, mid);
    this.flockGlow.scale.setScalar(2.4 + radius * 3.2);
    this.flockGlow.material.color.setRGB(1.0, 0.7, 0.4).multiplyScalar(0.6 + 0.5 * this.flockFlash);
    if (this.flockLight) {
      this.flockLight.position.set(this.flockX, 1.3, mid - radius - 0.4);
      this.flockLight.intensity = count > 0 ? (14 + 26 * Math.sqrt(count / MAX_FLOCK)) * (1 - 0.6 * dawn) : 0;
    }
    this.shade.place(this.flockX, 0.3 - radius * 0.2, mid, 0);
    this.shade.mesh.scale.setScalar(radius * 2.6 + 0.6);

    const sparks = m?.sparks;
    for (let i = 0; i < this.sparkSize.length; i++) {
      const spark = this.marching ? sparks?.[i] : undefined;
      if (!spark?.live) {
        this.sparkSize[i] = 0;
        continue;
      }
      this.sparkPos.set([spark.x, 0.5, -spark.ahead], i * 3);
      this.sparkSize[i] = 0.42;
    }
    const g = this.sparkPoints.geometry;
    g.attributes.position!.needsUpdate = g.attributes.aSize!.needsUpdate = true;

    this.lings.begin();
    this.brutes.begin();
    let maw: Foe | null = null;
    if (m) for (const foe of m.foes) {
      if (foe.kind === 'maw') {
        maw = foe;
        continue;
      }
      const view = this.foeViews.get(foe.id);
      if (!view) continue;
      const big = foe.kind === 'brute', waddle = Math.sin(time * (big ? 3.2 : 6.5) + foe.phase);
      const s = ease.outCubic(view.grow) * (1 + 0.16 * view.flash) * (big ? BRUTE_SCALE * (0.82 + 0.18 * (foe.hp / foe.maxHp)) : LING_SCALE);
      _m.compose(_p.set(foe.x, Math.abs(waddle) * (big ? 0.06 : 0.1), -foe.ahead), _q.setFromEuler(_e.set(0, waddle * 0.14, waddle * (big ? 0.07 : 0.12))), _s.set(s, s * (1 - 0.1 * view.flash), s));
      (big ? this.brutes : this.lings).add(_m, _tint.setScalar(1.5 + view.flash * 3.2));
    }
    this.lings.end();
    this.brutes.end();

    const body = this.maw, gone = this.mawGone;
    body.visible = !!maw && gone < 1;
    this.mawShade.mesh.visible = body.visible;
    this.mawHalo.visible = body.visible;
    if (maw && body.visible) {
      const view = this.foeViews.get(maw.id), flash = view?.flash ?? 0, relit = clamp01(1 - maw.hp / maw.maxHp);
      const s = (1 + 0.04 * Math.sin(time * 1.7) + 0.05 * flash) * (1 - 0.35 * gone) * ease.outCubic(view?.grow ?? 1);
      body.position.set(maw.x + Math.sin(time * 0.8) * 0.15, 0, -maw.ahead);
      body.rotation.set(0, Math.sin(time * 0.6) * 0.08, Math.sin(time * 1.1) * 0.03);
      body.scale.set(s, s * (1 - 0.04 * flash), s);
      this.mawGlow.value = this.mawGlowFull * (0.6 + 5 * relit * relit + 2.5 * flash + 14 * gone);
      this.mawHalo.position.set(body.position.x, 2.5, -maw.ahead + 1.6);
      this.mawHalo.scale.setScalar(3 + 6 * relit + 12 * gone);
      this.mawHalo.material.color.setRGB(1.0, 0.76, 0.45).multiplyScalar(0.9 * relit * relit + 0.5 * flash + 2.5 * gone);
      this.mawShade.place(body.position.x, 0.6, -maw.ahead, 0);
    } else this.mawGlow.value = this.mawGlowFull;

    const live = m ? m.gates : [];
    for (const view of this.gates) if (view.id && !live.some((gate) => gate.id === view.id)) view.id = 0;
    for (const gate of live) {
      let view = this.gates.find((v) => v.id === gate.id);
      if (!view) {
        view = this.gates.find((v) => v.id === 0);
        if (!view) continue;
        view.id = gate.id;
        this.paintGate(view.left, gate.left);
        this.paintGate(view.right, gate.right);
        view.left.show = view.right.show = view.left.flash = view.right.flash = 0;
      }
      view.group.position.set(0, 0, -gate.ahead);
      for (const [half, side] of [[view.left, 'left'], [view.right, 'right']] as const) {
        half.show = damp(half.show, gate.taken ? 0 : 1, gate.taken ? 7 : 3, dt);
        half.flash = damp(half.flash, 0, 3.5, dt);
        const worth = m ? worthOf(m.count, m.quick, gate[side]) : 0;
        const best = !gate.taken && m ? worth >= worthOf(m.count, m.quick, gate[side === 'left' ? 'right' : 'left']) && worth > m.count : false;
        half.film.material.uniforms.uShow!.value = half.show * (0.75 + 0.25 * Math.sin(time * 3 + (side === 'left' ? 0 : 2)));
        half.film.material.uniforms.uFlash!.value = half.flash;
        half.label.mesh.material.opacity = clamp01(half.show * 1.2);
        half.label.mesh.material.color.setScalar(lerp(1.9, 1.0, dawn));
        half.label.mesh.scale.set(LABEL_WIDE * (best ? 1.06 : 1), LABEL_WIDE * (300 / 420) * (best ? 1.06 : 1), 1);
      }
    }
    for (const view of this.gates) view.group.visible = view.id !== 0;

    const pop = this.pop.panel.mesh, life = this.pop.life;
    pop.visible = life > 0;
    if (pop.visible) {
      pop.position.set(this.flockX, 2.0 + (1 - life) * 1.5, mid - 0.6);
      pop.quaternion.copy(frame.camera.quaternion);
      pop.scale.set(2.0 * ease.outBack(Math.min(1, (1 - life) * 5)), 1.0 * ease.outBack(Math.min(1, (1 - life) * 5)), 1);
      pop.material.opacity = clamp01(life * 2.2);
    }

    if (this.shot === 'march') this.lumi.root.position.set(-2.0, 0, 1.2 + this.gone);
    this.lumi.root.visible = this.lumi.root.position.z < BEHIND;
  }
}
