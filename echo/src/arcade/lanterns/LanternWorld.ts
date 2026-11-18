import * as THREE from 'three';
import { Character } from '../../characters/Character';
import { CAST } from '../../characters/cast';
import { Rng, clamp, clamp01, damp, ease } from '../../core/math';
import { Bursts } from '../../render/Bursts';
import { GLSL_OUTPUT } from '../../render/glsl';
import { font, glass, sparkle, spaced } from '../../ui/draw';
import { anchor, type BuildContext, type FrameContext } from '../../world/World';
import { buildFallingPetals, makeHalo } from '../../world/haven/atmosphere';
import { buildBlossomTree } from '../../world/haven/flora';
import { Batch, Rings, ownMaterials } from '../fx';
import { Minigame, type Outcome } from '../Minigame';
import { MINIGAMES } from '../registry';
import { LIGHTS } from '../script';
import { buildStage, type Stage } from '../stage';
import { PAD, paintHint, paintStat, type Paint, type UiEl } from '../ui';
import { Game, LEVELS, PRISM, SIZE, adjacent, bestMove, type At, type Gem, type Kind, type Power, type Wave } from './board';

const KINDS = ['gem-drop', 'gem-leaf', 'gem-blossom', 'gem-star', 'gem-moon'] as const;
const KIND_COLOR = [new THREE.Color(0.28, 0.5, 1.0), new THREE.Color(0.22, 0.92, 0.52), new THREE.Color(1.0, 0.5, 0.76), new THREE.Color(1.0, 0.68, 0.24), new THREE.Color(0.66, 0.94, 1.0)] as const;
const KIND_HEX = ['#5a8cff', '#3fe08a', '#ff8fc4', '#ffb347', '#b8f0ff'] as const;
const WHITE = new THREE.Color(1, 0.97, 0.9);

const CELL = 0.3, BOARD_Y = 1.95, BOARD_Z = 0.09;
const GEM_SCALE = 0.95;
const PANE = { w: 2.56, h: 2.34 };
const cellX = (x: number): number => (x - (SIZE - 1) / 2) * CELL;
const cellY = (y: number): number => BOARD_Y + (y - (SIZE - 1) / 2) * CELL;

const BACK_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BACK_FS = `
uniform float uTime, uCells; uniform vec2 uBoard;
varying vec2 vUv;
void main(){
  // the cells are the middle of the pane: the rest of it is plain dark glass out to the loom
  vec2 b = (vUv - 0.5) / uBoard + 0.5;
  float inside = step(0.0, b.x) * step(b.x, 1.0) * step(0.0, b.y) * step(b.y, 1.0);
  vec2 c = fract(b * uCells) - 0.5;
  float well = (1.0 - smoothstep(0.36, 0.48, max(abs(c.x), abs(c.y)))) * inside;
  float sheen = 0.5 + 0.5 * sin((vUv.x + vUv.y) * 5.0 - uTime * 0.5);
  vec3 col = mix(vec3(0.008, 0.014, 0.045), vec3(0.03, 0.065, 0.16), well) + vec3(0.02, 0.05, 0.09) * well * sheen;
  gl_FragColor = vec4(col, 1.0);
  ${GLSL_OUTPUT}
}`;

const FX_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FX_FS = `
uniform vec3 uColor; uniform float uTime, uKind, uShow;
varying vec2 vUv;
void main(){
  vec2 q = vUv * 2.0 - 1.0;
  float a;
  if (uKind < 1.5) {
    // a beam: a bright bar with a bead of light running along it
    float bar = exp(-abs(q.y) * 16.0) * smoothstep(1.0, 0.72, abs(q.x));
    float bead = exp(-pow((q.x - sin(uTime * 3.2)) * 5.0, 2.0)) * exp(-abs(q.y) * 9.0);
    a = bar * 0.8 + bead * 1.2;
  } else {
    // a burst: a ring that breathes
    float r = length(q), at = 0.72 + 0.1 * sin(uTime * 4.0);
    a = exp(-pow((r - at) / 0.07, 2.0)) + 0.25 * exp(-r * r * 4.0);
  }
  gl_FragColor = vec4(uColor * a * 2.4 * uShow, 1.0);
  ${GLSL_OUTPUT}
}`;

const MOTE_VS = `
attribute vec3 aColor; attribute float aSize;
uniform float uPixel;
varying vec3 vColor;
void main(){
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(aSize * uPixel * 0.85 / max(-mv.z, 0.3), 80.0);
}`;
const MOTE_FS = `
varying vec3 vColor;
void main(){
  vec2 q = gl_PointCoord - 0.5; float r = length(q) * 2.0;
  gl_FragColor = vec4(vColor * exp(-r * r * 5.0), 1.0);
  ${GLSL_OUTPUT}
}`;

interface View {
  gem: Gem;
  x: number;
  y: number;
  tx: number;
  ty: number;
  vy: number;
  falling: boolean;
  delay: number;
  scale: number;
  clearing: number;
  squash: number;
  phase: number;
}

interface Mote {
  live: boolean;
  from: THREE.Vector3;
  via: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  duration: number;
  goal: number;
  color: THREE.Color;
}

interface LanternView {
  readonly group: THREE.Group;
  readonly materials: THREE.MeshStandardMaterial[];
  readonly halo: THREE.Sprite;
  readonly home: THREE.Vector3;
  readonly emblem: THREE.Group;
  pulse: number;
  lit: number;
  rise: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -BOARD_Z);
const _tint = new THREE.Color();

export class LanternWorld extends Minigame {
  readonly id = 'lanterns' as const;
  readonly soundscape = 'arcadeLanterns' as const;
  game: Game | null = null;
  readonly stats = { swaps: 0, refused: 0 };

  private stage!: Stage;
  private readonly bursts = new Bursts(2600);
  private readonly rings = new Rings(10);
  private readonly rng = new Rng(3113);
  private readonly board3d = new THREE.Group();
  private readonly batches: Batch[] = [];
  private readonly views = new Map<number, View>();
  private readonly prisms: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshStandardMaterial>[] = [];
  private readonly marks: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  private readonly sweeps: { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; life: number }[] = [];
  private readonly lanterns: LanternView[] = [];
  private readonly lanternModels: THREE.Group[] = [];
  private readonly gemModels: THREE.Group[] = [];
  private lumi!: Character;
  private readonly backU = { uTime: { value: 0 }, uCells: { value: SIZE }, uBoard: { value: new THREE.Vector2((SIZE * CELL + 0.04) / PANE.w, (SIZE * CELL + 0.04) / PANE.h) } };

  private readonly motes: Mote[] = [];
  private readonly motePos = new Float32Array(96 * 3);
  private readonly moteColor = new Float32Array(96 * 3);
  private readonly moteSize = new Float32Array(96);
  private readonly moteU = { uPixel: { value: 1080 } };
  private motePoints!: THREE.Points;
  private readonly shown: number[] = [];

  private accepting = false;
  private pending: [At, At] | null = null;
  private grab: (At & { px: number; py: number }) | null = null;
  private selected: At | null = null;
  private hover: At | null = null;
  private idle = 0;
  private hintMove: [At, At] | null = null;
  private autoWait = 0;

  private movesEl: UiEl | null = null;
  private goalsEl: UiEl | null = null;
  private chainEl: UiEl | null = null;
  private chainText = '';
  private chainShown = 0;
  private played = 0;
  private lastWon = false;
  private sweep = 1;
  private gatherAt = 0;

  constructor() {
    super();
    this.seat = anchor(0, 0, 4.6, 0);
    this.eyeHeight = 1.6;
    this.restFocus = 5;
  }

  async build(ctx: BuildContext): Promise<void> {
    const scene = this.scene, q = ctx.quality;
    this.stage = await buildStage(ctx, this, {
      island: { radius: 10, depth: 15, seed: 31, flat: 0.82, hills: 0.6 }, grass: 16000, flowers: 90, lanterns: 12, motes: 170,
      bare: (x, z) => Math.abs(x) < 2.0 && Math.abs(z) < 0.5, shadowSpan: 6,
    });
    Object.assign(this.look, { exposure: 0.98, bloom: 0.24, saturation: 1.28, vignette: 0.42 });

    const treeRng = new Rng(77);
    const tree = buildBlossomTree(treeRng, Math.round(22000 * q.density));
    tree.group.position.set(4.4, 0, -4.6);
    tree.group.scale.setScalar(1.2);
    scene.add(tree.group);
    scene.add(buildFallingPetals(Math.round(180 * q.density), tree.canopy.map((p) => p.clone().multiplyScalar(1.2).add(tree.group.position)), 0.02, treeRng.fork(), this.stage.time));

    scene.add(await ctx.assets.instance('gem-loom'));
    const back = new THREE.Mesh(new THREE.PlaneGeometry(PANE.w, PANE.h), new THREE.ShaderMaterial({ vertexShader: BACK_VS, fragmentShader: BACK_FS, uniforms: this.backU }));
    back.position.set(0, BOARD_Y, BOARD_Z - 0.07);
    scene.add(back, this.board3d);

    for (const id of KINDS) {
      const model = await ctx.assets.instance(id);
      this.gemModels.push(model);
      this.batches.push(new Batch(model, SIZE * SIZE + 8, this.board3d));
    }
    for (let i = 0; i < 6; i++) {
      const prism = new THREE.Mesh(new THREE.IcosahedronGeometry(0.105, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.55, roughness: 0.12, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0.6 }));
      prism.visible = false;
      this.board3d.add(prism);
      this.prisms.push(prism);
    }
    for (let i = 0; i < 12; i++) {
      const mark = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
        vertexShader: FX_VS, fragmentShader: FX_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
        uniforms: { uColor: { value: new THREE.Color() }, uTime: this.stage.time, uKind: { value: 0 }, uShow: { value: 1 } },
      }));
      mark.visible = false;
      mark.renderOrder = 3;
      this.board3d.add(mark);
      this.marks.push(mark);
    }
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.board3d.add(mesh);
      this.sweeps.push({ mesh, life: 0 });
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.motePos, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.moteColor, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.moteSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.motePoints = new THREE.Points(geometry, new THREE.ShaderMaterial({ vertexShader: MOTE_VS, fragmentShader: MOTE_FS, uniforms: this.moteU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.motePoints.frustumCulled = false;
    this.motePoints.renderOrder = 5;
    for (let i = 0; i < 96; i++) this.motes.push({ live: false, from: new THREE.Vector3(), via: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, duration: 1, goal: 0, color: new THREE.Color() });
    scene.add(this.motePoints, this.rings.group, this.bursts.points);

    for (let i = 0; i < 5; i++) this.lanternModels.push(await ctx.assets.instance('lantern'));

    this.lumi = this.addPerson('lumi', await Character.create(ctx, CAST.lumi, 'lumi'));
    this.lumi.place(-2.55, 0, 0.7, 0.55).setPose('standOpen', { immediate: true });
    const aura = makeHalo(CAST.lumi.aura, 2.2, 0.18);
    aura.position.set(0, 0.95, -0.15);
    this.lumi.root.add(aura);
    this.reset();
  }

  override reset(): void {
    this.game = null;
    this.views.clear();
    this.accepting = false;
    this.pending = this.grab = this.selected = this.hover = this.hintMove = null;
    this.movesEl = this.goalsEl = this.chainEl = null;
    this.stats.swaps = this.stats.refused = 0;
    this.sweep = 1;
    for (const m of this.motes) m.live = false;
    for (const l of this.lanterns) l.group.removeFromParent();
    this.lanterns.length = 0;
    for (const s of this.sweeps) s.mesh.visible = false;
    for (const person of this.people) person.clearGesture().setMood('neutral');
  }

  private hangLanterns(): void {
    const goals = this.game!.level.goals;
    goals.forEach((goal, i) => {
      const group = new THREE.Group(), model = this.lanternModels[i]!;
      const side = i % 2 === 0 ? -1 : 1, row = Math.floor(i / 2);
      const home = new THREE.Vector3(side * 2.38, 3.0 - row * 1.0 - (goals.length > 4 && side > 0 ? 0.5 : 0), 0.3);
      model.scale.setScalar(1.55);
      model.position.y = -0.38;
      const materials = ownMaterials(model);
      const color = KIND_COLOR[goal.kind]!;
      for (const m of materials) {
        m.color.copy(color).lerp(WHITE, 0.35);
        m.emissive.copy(color);
        m.emissiveMap = m.map;
        m.emissiveIntensity = 0;
      }
      const halo = makeHalo(color.getHex(), 2.4, 0);
      const emblem = this.gemModels[goal.kind]!.clone();
      emblem.scale.setScalar(0.7);
      emblem.position.set(0, 0.58, 0);
      group.add(model, halo, emblem);
      group.position.copy(home);
      this.scene.add(group);
      this.lanterns.push({ group, materials, halo, home, emblem, pulse: 0, lit: 0, rise: 0 });
    });
  }

  async play(): Promise<Outcome> {
    const arcade = this.arcade, { hud, audio } = arcade.game;
    const level = LEVELS[this.level]!;
    const game = (this.game = new Game(level, new Rng(this.rng.int(1, 1e9))));
    this.shown.length = 0;
    for (let i = 0; i < level.goals.length; i++) this.shown.push(0);
    this.hangLanterns();
    arcade.game.reach('lights.intro');
    this.sweep = 0;
    hud.setCard(MINIGAMES.lanterns.title, `${level.name} · ${level.goals.length} lanterns · ${level.moves} moves`);
    audio.sfx('card');
    arcade.tween(2.4, (k) => (this.sweep = k), ease.inOutCubic).catch(() => undefined);
    for (let x = 0; x < SIZE; x++) for (let y = 0; y < SIZE; y++) this.spawn(game.board.at(x, y), x, y, SIZE + 1 + y * 0.6, 0.25 + x * 0.07 + y * 0.03);
    await arcade.wait(2.0);
    hud.setCard(null);
    await arcade.wait(0.4);
    this.lumi.play('wave');
    await arcade.talk(this.played === 0 ? LIGHTS.intro : this.level > 0 && this.lastWon ? LIGHTS.harder : LIGHTS.again);
    this.played++;
    this.buildHud();
    arcade.hint(LIGHTS.hint);
    arcade.game.reach('lights.ready');

    let warned = false;
    while (!game.over) {
      const [a, b] = await this.askMove();
      const ga = game.board.at(a.x, a.y), gb = game.board.at(b.x, b.y);
      const waves = game.play(a, b);
      const va = this.views.get(ga.id)!, vb = this.views.get(gb.id)!;
      [va.tx, va.ty, vb.tx, vb.ty] = [b.x, b.y, a.x, a.y];
      audio.sfx('gemSwap');
      await arcade.wait(0.16);
      if (!waves) {
        this.stats.refused++;
        [va.tx, va.ty, vb.tx, vb.ty] = [a.x, a.y, b.x, b.y];
        audio.sfx('gemBack');
        await arcade.wait(0.2);
        continue;
      }
      this.stats.swaps++;
      arcade.hint(null);
      this.movesEl?.repaint();
      for (const wave of waves) await this.playWave(wave);
      if (this.syncTargets()) {
        this.popChain(LIGHTS.hud.shuffle);
        await arcade.wait(0.6);
      }
      await arcade.until(() => this.settled());
      arcade.game.reach('lights.move');
      if (!warned && !game.over && game.movesLeft === 3) {
        warned = true;
        arcade.bark(LIGHTS.low, 1.4);
      }
    }
    await arcade.until(() => this.motes.every((m) => !m.live));
    this.accepting = false;
    arcade.hint(null);

    const won = game.won;
    this.lastWon = won;
    arcade.game.reach(won ? 'lights.won' : 'lights.lost');
    if (won) {
      audio.sfx('cheer');
      this.lumi.play('cheer').setMood('delighted');
      for (const [i, l] of this.lanterns.entries()) {
        arcade.wait(i * 0.25).then(() => arcade.tween(5.5, (k) => (l.rise = k), ease.inQuad), () => undefined).catch(() => undefined);
      }
      this.fireworks();
    } else this.lumi.play('handToChest');
    await arcade.wait(1.6);
    await arcade.talk(won ? LIGHTS.won : LIGHTS.lost);
    const lit = level.goals.filter((g, i) => game.gathered[i]! >= g.count).length;
    const outcome: Outcome = { won, stars: game.stars, summary: LIGHTS.summary(lit, level.goals.length, game.movesLeft, level.name) };
    if (won) this.level = Math.min(LEVELS.length - 1, this.level + 1);
    return outcome;
  }

  private spawn(gem: Gem, x: number, y: number, fromY: number, delay: number): View {
    const view: View = { gem, x, y: fromY, tx: x, ty: y, vy: 0, falling: fromY !== y, delay, scale: 1, clearing: 0, squash: 0, phase: this.rng.range(0, 6.28) };
    this.views.set(gem.id, view);
    return view;
  }

  private syncTargets(): boolean {
    const board = this.game!.board;
    let moved = false;
    for (let x = 0; x < SIZE; x++) for (let y = 0; y < SIZE; y++) {
      const gem = board.at(x, y), view = this.views.get(gem.id) ?? this.spawn(gem, x, y, y, 0);
      if (view.tx !== x || view.ty !== y) moved = true;
      view.tx = x;
      view.ty = y;
      view.gem = gem;
    }
    return moved;
  }

  private settled(): boolean {
    for (const v of this.views.values()) if (v.clearing > 0 || v.delay > 0 || Math.abs(v.x - v.tx) > 0.02 || Math.abs(v.y - v.ty) > 0.02) return false;
    return true;
  }

  private async playWave(wave: Wave): Promise<void> {
    const arcade = this.arcade, { audio, app } = arcade.game, game = this.game!;
    await arcade.until(() => this.settled());
    const goals = game.level.goals;
    for (const f of wave.fired) {
      const at = _a.set(cellX(f.x), cellY(f.y), BOARD_Z + 0.08).clone(), color = f.kind === PRISM ? WHITE : KIND_COLOR[f.kind] ?? WHITE;
      if (f.power === 'beamH' || f.power === 'beamV') {
        this.flashLine(f.power === 'beamH', f.power === 'beamH' ? f.y : f.x, color);
        audio.sfx('gemBeam');
      } else if (f.power === 'burst') {
        this.rings.emit(at, 1.5, color, 0.5, _p.set(0, 0, 1));
        audio.sfx('gemBurst');
      } else {
        this.rings.emit(at, 3.6, WHITE, 0.8, _p.set(0, 0, 1));
        audio.sfx('gemPrism');
        app.fx.flash = Math.max(app.fx.flash, 0.3);
      }
      this.cam.shake(0.3);
      app.fx.kick = Math.max(app.fx.kick, 0.4);
    }
    let n = 0;
    for (const c of wave.cleared) {
      const view = this.views.get(c.gem.id);
      if (!view) continue;
      view.clearing = 0.001;
      view.delay = c.by === 'match' ? 0 : 0.05 + 0.02 * (n % 8);
      const at = _a.set(cellX(c.x), cellY(c.y), BOARD_Z + 0.06);
      const color = c.gem.kind === PRISM ? WHITE : KIND_COLOR[c.gem.kind]!;
      this.bursts.emit(at, { count: 10, color, color2: WHITE, speed: 1.5, life: 0.5, size: 0.07, gravity: 0.8 });
      const goal = goals.findIndex((g) => g.kind === c.gem.kind);
      if (goal >= 0 && this.shown[goal]! + this.inFlight(goal) < goals[goal]!.count) this.sendMote(at, goal, 0.08 + 0.035 * n);
      n++;
    }
    audio.sfx('gemClear', { pitch: 2 ** (Math.min(wave.chain - 1, 7) / 12 * 2), gain: Math.min(1.2, 0.7 + 0.1 * wave.cleared.length) });
    if (wave.chain >= 2) this.popChain(LIGHTS.hud.chain(wave.chain));
    if (wave.chain === 3 && this.rng.chance(0.7)) arcade.bark(this.rng.pick(LIGHTS.chain), 1.2);
    if (wave.cleared.length >= 8) this.cam.shake(0.25);
    await arcade.wait(0.24);
    for (const c of wave.cleared) this.views.delete(c.gem.id);
    for (const m of wave.made) {
      const view = this.spawn(m.gem, m.x, m.y, m.y, 0);
      view.scale = 0.2;
      audio.sfx('gemPower');
      this.rings.emit(_a.set(cellX(m.x), cellY(m.y), BOARD_Z + 0.08), 0.9, m.gem.kind === PRISM ? WHITE : KIND_COLOR[m.gem.kind]!, 0.45, _p.set(0, 0, 1));
      if (this.rng.chance(0.4)) arcade.bark(this.rng.pick(LIGHTS.power), 1.2);
    }
    for (const f of wave.falls) {
      const view = this.views.get(f.gem.id) ?? this.spawn(f.gem, f.x, f.toY, f.fromY + 0.3, 0);
      view.tx = f.x;
      view.ty = f.toY;
      view.falling = true;
      view.delay = 0.02 * f.toY;
    }
    await arcade.until(() => this.settled());
    await arcade.wait(0.06);
  }

  private inFlight(goal: number): number {
    let n = 0;
    for (const m of this.motes) if (m.live && m.goal === goal) n++;
    return n;
  }

  private sendMote(from: THREE.Vector3, goal: number, delay: number): void {
    const mote = this.motes.find((m) => !m.live);
    const lantern = this.lanterns[goal];
    if (!mote || !lantern) return;
    mote.live = true;
    mote.from.copy(from);
    mote.to.copy(lantern.group.position);
    mote.via.lerpVectors(from, mote.to, 0.5).add(_p.set(this.rng.range(-0.4, 0.4), this.rng.range(0.2, 0.9), this.rng.range(0.7, 1.3)));
    mote.t = -delay;
    mote.duration = this.rng.range(0.55, 0.8);
    mote.goal = goal;
    mote.color.copy(KIND_COLOR[this.game!.level.goals[goal]!.kind]!);
  }

  private flashLine(horizontal: boolean, index: number, color: THREE.Color): void {
    const sweep = this.sweeps.reduce((old, s) => (s.life < old.life ? s : old));
    sweep.life = 1;
    sweep.mesh.material.color.copy(color).lerp(WHITE, 0.5).multiplyScalar(2.2);
    sweep.mesh.position.set(horizontal ? 0 : cellX(index), horizontal ? cellY(index) : BOARD_Y, BOARD_Z + 0.1);
    sweep.mesh.rotation.z = horizontal ? 0 : Math.PI / 2;
    sweep.mesh.visible = true;
  }

  private popChain(text: string): void {
    this.chainText = text;
    this.chainShown = 1.4;
    this.chainEl?.repaint();
    this.chainEl?.show(true);
  }

  private fireworks(): void {
    for (let i = 0; i < 7; i++) {
      this.arcade.game.app.tasks.wait(i * 0.3 + this.rng.range(0, 0.12), this.arcade.signal).then(() => {
        const at = new THREE.Vector3(this.rng.range(-9, 9), this.rng.range(6, 11), this.rng.range(-14, -6));
        this.bursts.emit(at, { count: 150, color: this.rng.pick(KIND_COLOR), color2: WHITE, speed: 9, spread: 0.3, life: 2.1, size: 0.5, gravity: 2.2 });
        this.arcade.game.audio.sfx('firework', { at });
      }, () => undefined);
    }
  }

  private async askMove(): Promise<[At, At]> {
    const arcade = this.arcade;
    this.pending = null;
    this.accepting = true;
    this.idle = 0;
    this.autoWait = 0.32;
    await arcade.until(() => this.pending !== null);
    this.accepting = false;
    this.grab = this.selected = this.hintMove = null;
    return this.pending!;
  }

  private cellAt(out: THREE.Vector3): At | null {
    const pointer = this.arcade.pointer;
    if (!pointer.active || !pointer.onPlane(_plane, out)) return null;
    const x = Math.round(out.x / CELL + (SIZE - 1) / 2), y = Math.round((out.y - BOARD_Y) / CELL + (SIZE - 1) / 2);
    return x >= 0 && x < SIZE && y >= 0 && y < SIZE ? { x, y } : null;
  }

  private readHand(dt: number): void {
    const arcade = this.arcade, pointer = arcade.pointer, game = this.game;
    this.hover = null;
    if (!this.accepting || !game) return;
    if (arcade.auto) {
      this.autoWait -= dt;
      if (this.autoWait <= 0) this.pending = bestMove(game, this.rng, arcade.autoSkill) ?? this.pending;
      return;
    }
    const cell = this.cellAt(_p);
    this.hover = cell;
    this.idle += dt;
    if (this.idle > 7 && !this.hintMove) this.hintMove = game.board.findMove();
    if (pointer.pressed && cell) {
      this.grab = { ...cell, px: _p.x, py: _p.y };
      this.idle = 0;
      this.hintMove = null;
      arcade.game.audio.sfx('gemPick');
    }
    const grab = this.grab;
    if (grab && pointer.down && pointer.onPlane(_plane, _p)) {
      const dx = _p.x - grab.px, dy = _p.y - grab.py;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > CELL * 0.5) {
        const to = Math.abs(dx) > Math.abs(dy) ? { x: grab.x + Math.sign(dx), y: grab.y } : { x: grab.x, y: grab.y + Math.sign(dy) };
        this.grab = null;
        if (to.x >= 0 && to.x < SIZE && to.y >= 0 && to.y < SIZE) this.pending = [{ x: grab.x, y: grab.y }, to];
      }
    } else if (grab && pointer.released) {
      const here = { x: grab.x, y: grab.y };
      this.grab = null;
      if (this.selected && adjacent(this.selected, here)) this.pending = [this.selected, here];
      else this.selected = this.selected && this.selected.x === here.x && this.selected.y === here.y ? null : here;
    } else if (!pointer.down) this.grab = null;
  }

  private buildHud(): void {
    const ui = this.arcade.ui, game = this.game!;
    this.movesEl = ui.add(150 + PAD * 2, 74 + PAD * 2, paintStat(() => LIGHTS.hud.moves, () => String(game.movesLeft), { accent: true })).at(-1, 1, 14, -12).show();
    this.goalsEl = ui.add(Math.max(300, game.level.goals.length * 104 + 24) + PAD * 2, 74 + PAD * 2, this.paintGoals()).at(0, 1, 0, -12).show();
    this.chainEl = ui.add(520 + PAD * 2, 44 + PAD * 2, paintHint(() => this.chainText)).at(0, -1, 0, 36);
  }

  private paintGoals(): Paint {
    return (ctx, w, h, el) => {
      const theme = el.layer.theme, game = this.game;
      if (!game) return;
      glass(ctx, PAD, PAD, w - PAD * 2, h - PAD * 2, theme, { glow: 0.5 });
      ctx.textBaseline = 'middle';
      ctx.fillStyle = theme.dim;
      ctx.font = font(600, 11.5);
      spaced(ctx, `${LIGHTS.hud.lanterns.toUpperCase()} · ${game.level.name.toUpperCase()}`, w / 2, PAD + 19, 2.5, 'center');
      const goals = game.level.goals, step = 104, left = w / 2 - ((goals.length - 1) * step) / 2;
      goals.forEach((goal, i) => {
        const x = left + i * step, done = this.shown[i]! >= goal.count;
        ctx.fillStyle = KIND_HEX[goal.kind]!;
        ctx.shadowColor = KIND_HEX[goal.kind]!;
        ctx.shadowBlur = done ? 14 : 0;
        sparkle(ctx, x - 30, PAD + 51, done ? 12 : 9);
        ctx.shadowBlur = 0;
        ctx.fillStyle = done ? theme.accent : theme.text;
        ctx.font = font(700, 21);
        ctx.textAlign = 'left';
        ctx.fillText(done ? 'Lit' : `${this.shown[i]}/${goal.count}`, x - 14, PAD + 52);
      });
    };
  }

  tick(dt: number, time: number): void {
    const arcade = this.arcade, { audio } = arcade.game, game = this.game;
    this.backU.uTime.value = time;
    this.rings.update(dt);
    this.readHand(dt);

    let landed = false;
    for (const v of this.views.values()) {
      if (v.delay > 0) {
        v.delay -= dt;
        if (v.clearing === 0) continue;
      }
      if (v.clearing > 0) {
        if (v.delay <= 0) v.clearing = Math.min(1, v.clearing + dt / 0.2);
        continue;
      }
      v.x = damp(v.x, v.tx, 24, dt);
      if (v.falling) {
        v.vy += 30 * dt;
        v.y -= v.vy * dt;
        if (v.y <= v.ty) {
          v.y = v.ty;
          v.falling = false;
          v.squash = Math.min(1, v.vy / 9);
          v.vy = 0;
          landed = true;
        }
      } else v.y = damp(v.y, v.ty, 24, dt);
      v.scale = damp(v.scale, 1, 12, dt);
      v.squash = damp(v.squash, 0, 14, dt);
    }
    if (landed && time - this.gatherAt > 0.05) {
      this.gatherAt = time;
      audio.sfx('gemLand', { pitch: this.rng.range(0.9, 1.15) });
    }

    if (game) {
      for (const m of this.motes) {
        if (!m.live) continue;
        m.t += dt;
        if (m.t < m.duration) continue;
        m.live = false;
        const goal = game.level.goals[m.goal]!, lantern = this.lanterns[m.goal];
        if (this.shown[m.goal]! >= goal.count) continue;
        this.shown[m.goal]!++;
        if (lantern) lantern.pulse = 1;
        this.goalsEl?.repaint();
        audio.sfx('gemGather', { pitch: 1 + 0.5 * (this.shown[m.goal]! / goal.count), gain: 0.7 });
        if (this.shown[m.goal]! >= goal.count && lantern) {
          audio.sfx('lanternLit', { at: lantern.home });
          this.bursts.emit(lantern.group.position, { count: 80, color: KIND_COLOR[goal.kind]!, color2: WHITE, speed: 3, life: 1.2, size: 0.14, gravity: -0.8 });
          this.rings.emit(lantern.group.position, 2.4, KIND_COLOR[goal.kind]!, 0.8, _p.set(0, 0, 1));
          this.lumi.play('clap').setMood('delighted');
          if (!game.won && this.rng.chance(0.75)) arcade.bark(this.rng.pick(LIGHTS.lit), 1.2);
        }
      }
      game.level.goals.forEach((goal, i) => {
        const l = this.lanterns[i];
        if (!l) return;
        const k = clamp01(this.shown[i]! / goal.count), full = k >= 1 ? 1 : 0;
        l.lit = damp(l.lit, k, 5, dt);
        l.pulse = damp(l.pulse, 0, 6, dt);
        const glow = 0.12 + 0.9 * l.lit * l.lit + 0.8 * full + 0.7 * l.pulse;
        for (const m of l.materials) m.emissiveIntensity = glow;
        l.halo.material.color.copy(KIND_COLOR[goal.kind]!).multiplyScalar(0.12 + 0.75 * l.lit + 0.5 * l.pulse + 0.4 * full);
        l.group.position.set(l.home.x + Math.sin(time * 0.7 + i) * 0.05 * (1 + 3 * l.rise), l.home.y + 0.16 * full + Math.sin(time * 1.3 + i * 2) * 0.03 + l.rise * 9, l.home.z - l.rise * 3);
        l.group.scale.setScalar(1 + 0.12 * l.pulse);
        l.emblem.rotation.y = time * 0.8 + i;
        l.emblem.visible = l.rise < 0.05;
      });
    }

    for (const s of this.sweeps) {
      if (s.life <= 0) continue;
      s.life = Math.max(0, s.life - dt / 0.32);
      const k = 1 - s.life;
      s.mesh.scale.set(SIZE * CELL * (0.3 + 0.9 * ease.outCubic(k)), CELL * (1.1 - 0.9 * k), 1);
      s.mesh.material.opacity = s.life * s.life;
      s.mesh.visible = s.life > 0;
    }
    if (this.chainShown > 0) {
      this.chainShown -= dt;
      if (this.chainShown <= 0) this.chainEl?.show(false);
    }
    this.lumi.lookAtPoint(arcade.game.playerEye);
    this.moveCamera(time);
  }

  private moveCamera(time: number): void {
    const cam = this.cam, k = this.sweep;
    cam.eye.set(Math.sin(time * 0.23) * 0.12 + (1 - k) * 2.6, 1.95 + (1 - k) * 1.6, 5.35 + (1 - k) * 2.4);
    cam.target.set(0, 1.93, 0);
    cam.fov = 38;
    cam.ease = k < 1 ? 30 : 4;
  }

  override update(frame: FrameContext): void {
    super.update(frame);
    this.stage.update(frame);
    this.bursts.update(frame.dt, frame.pixelHeight);
    this.moteU.uPixel.value = frame.pixelHeight;
    const time = frame.time;

    for (const batch of this.batches) batch.begin();
    let prisms = 0, marks = 0;
    const hint = this.hintMove, sel = this.selected, grab = this.grab, hover = this.hover;
    for (const v of this.views.values()) {
      const at = (c: At | null): boolean => !!c && c.x === v.tx && c.y === v.ty;
      const held = at(grab) || at(sel), hinted = !!hint && (at(hint[0]) || at(hint[1]));
      const wobble = Math.sin(time * 1.6 + v.phase);
      let s = v.scale * (1 + (held ? 0.16 : at(hover) ? 0.07 : 0) + (hinted ? 0.1 * Math.sin(time * 9) : 0));
      let flash = held ? 0.5 : 0;
      if (v.clearing > 0) {
        s *= 1 + 0.5 * v.clearing;
        flash = 2.5 * v.clearing;
        if (v.clearing >= 1) continue;
      }
      const sq = v.squash * 0.28;
      _p.set(cellX(v.x), cellY(v.y) - sq * CELL * 0.3, BOARD_Z + (held ? 0.07 : 0));
      _q.setFromEuler(_e.set(0.1 * wobble, 0.3 * wobble + (hinted ? 0.4 * Math.sin(time * 9) : 0), 0));
      _s.set(GEM_SCALE * s * (1 + sq), GEM_SCALE * s * (1 - sq), GEM_SCALE * s);
      const fade = v.clearing > 0 ? 1 - v.clearing * 0.4 : 1;
      if (v.gem.kind === PRISM) {
        const prism = this.prisms[prisms++];
        if (prism) {
          prism.visible = true;
          prism.position.copy(_p);
          prism.rotation.set(time * 1.1, time * 1.7, 0);
          prism.scale.setScalar(s);
          prism.material.emissive.setHSL((time * 0.25 + v.phase) % 1, 0.9, 0.5);
        }
      } else {
        _m.compose(_p.setY(_p.y - 0.15 * GEM_SCALE * s * (1 - sq)), _q, _s);
        this.batches[v.gem.kind]!.add(_m, _tint.setScalar((1 + flash) * fade));
      }
      const power: Power = v.gem.power;
      if ((power === 'beamH' || power === 'beamV' || power === 'burst') && v.clearing === 0) {
        const mark = this.marks[marks++];
        if (mark) {
          mark.visible = true;
          mark.position.set(cellX(v.x), cellY(v.y), BOARD_Z + 0.12);
          mark.rotation.z = power === 'beamV' ? Math.PI / 2 : 0;
          mark.scale.setScalar(power === 'burst' ? CELL * 1.25 : CELL * 1.5);
          mark.material.uniforms.uKind!.value = power === 'burst' ? 2 : 1;
          mark.material.uniforms.uColor!.value.copy(KIND_COLOR[v.gem.kind as Kind] ?? WHITE).lerp(WHITE, 0.4);
        }
      }
    }
    for (const batch of this.batches) batch.end();
    for (let i = prisms; i < this.prisms.length; i++) this.prisms[i]!.visible = false;
    for (let i = marks; i < this.marks.length; i++) this.marks[i]!.visible = false;

    this.motes.forEach((m, i) => {
      const k = m.live && m.t >= 0 ? clamp(m.t / m.duration, 0, 1) : -1;
      if (k < 0) {
        this.moteSize[i] = 0;
        return;
      }
      const e = ease.inOutQuad(k), u = 1 - e;
      _p.copy(m.from).multiplyScalar(u * u).addScaledVector(m.via, 2 * u * e).addScaledVector(m.to, e * e);
      this.motePos.set([_p.x, _p.y, _p.z], i * 3);
      this.moteColor.set([m.color.r * 2.2, m.color.g * 2.2, m.color.b * 2.2], i * 3);
      this.moteSize[i] = 0.2 * (0.6 + 0.4 * Math.sin(k * Math.PI));
      if (this.rng.chance(0.5)) this.bursts.emit(_p, { count: 1, color: m.color, color2: WHITE, speed: 0.3, life: 0.4, size: 0.06, gravity: 0.3 });
    });
    const g = this.motePoints.geometry;
    g.attributes.position!.needsUpdate = g.attributes.aColor!.needsUpdate = g.attributes.aSize!.needsUpdate = true;
  }
}
