import * as THREE from 'three';
import { Character } from '../../characters/Character';
import { CAST } from '../../characters/cast';
import { Rng, clamp, clamp01, damp, ease } from '../../core/math';
import { Bursts } from '../../render/Bursts';
import { GLSL_OUTPUT } from '../../render/glsl';
import { Panel } from '../../ui/Panel';
import { THEMES, displayFont, font, glass, spaced, sparkle } from '../../ui/draw';
import { anchor, type BuildContext, type FrameContext } from '../../world/World';
import { dress, sizeOf, type Spot } from '../../world/dressing';
import { makeHalo } from '../../world/haven/atmosphere';
import { BlobShadow, Rings, Trail, ownMaterials, repaint } from '../fx';
import { reachArm } from '../ik';
import { Minigame, type Outcome } from '../Minigame';
import { MINIGAMES } from '../registry';
import { RALLY } from '../script';
import { buildStage, type Stage } from '../stage';
import { Court } from './court';
import { KaiBrain, LEVELS } from './opponent';
import { BALL_RADIUS, TABLE, v, type Contact, type Side } from './physics';
import { PlayerBot, REACH, type Swing } from './player';
import { TO_WIN, gamePoint, matchWinner, serverFor, starsFor, type Score } from './rules';

/** The court is the top of a dais: everything in the game is placed from there, this far above the island's turf. */
const LIFT = 0.11;
const H = TABLE.height, HALF_L = TABLE.length / 2, HALF_W = TABLE.width / 2;
/** Where Kai stands along the table. */
const KAI_Z = -1.92;
/** From the middle of the blade back to where a hand holds the bat, and the same for the model lying flat: its blade is toward -Z. */
const GRIP = 0.135, BLADE_Z = -0.05, HALF_THICK = 0.023;

const CYAN = new THREE.Color(0.45, 0.84, 1.0);
const GOLD = new THREE.Color(1.0, 0.72, 0.3);
const WHITE = new THREE.Color(1, 0.97, 0.9);
const AMBER = new THREE.Color(1.0, 0.62, 0.22);

const LINES_VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
/** The lines of the table, drawn in light on the stone: the edge all round, the centre line, and a glow that answers each bounce. */
const LINES_FS = /* glsl */ `
uniform float uPulse; uniform vec2 uSize; uniform vec3 uColor;
varying vec2 vUv;
void main(){
  vec2 p = (vUv - 0.5) * uSize;                       // metres from the middle of the table
  vec2 d = uSize * 0.5 - abs(p);                      // metres in from each edge
  float edge = 1.0 - smoothstep(0.012, 0.02, min(d.x, d.y));
  float centre = 1.0 - smoothstep(0.002, 0.005, abs(p.x));
  float halo = exp(-min(d.x, d.y) * 26.0) * 0.35;
  float a = edge + centre * 0.55 + halo;
  gl_FragColor = vec4(uColor * a * (1.0 + 1.4 * uPulse), 1.0);
  ${GLSL_OUTPUT}
}`;

const NET_VS = /* glsl */ `
uniform float uShake, uShakeX, uTime;
varying vec2 vUv;
void main(){
  vUv = uv;
  vec3 p = position;
  // struck, the net bellies where it was hit and shivers along its length
  float near = exp(-pow((p.x - uShakeX) * 3.0, 2.0));
  p.z += sin(uTime * 46.0 + p.x * 9.0) * uShake * (0.012 + 0.03 * near) * uv.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const NET_FS = /* glsl */ `
uniform vec3 uColor; uniform float uShake;
varying vec2 vUv;
void main(){
  vec2 cell = fract(vUv * vec2(150.0, 13.0));
  float thread = max(1.0 - smoothstep(0.0, 0.16, min(cell.x, 1.0 - cell.x)), 1.0 - smoothstep(0.0, 0.2, min(cell.y, 1.0 - cell.y)));
  float tape = smoothstep(0.86, 0.9, vUv.y);
  float a = max(thread * 0.5, tape);
  if (a < 0.04) discard;
  gl_FragColor = vec4(mix(uColor * (0.5 + 2.0 * uShake), vec3(1.6, 1.7, 1.8), tape), a);
  ${GLSL_OUTPUT}
}`;

type Phase = 'idle' | 'serveYou' | 'serveKai' | 'live' | 'dead';

interface PointResult {
  readonly winner: Side;
  /** A clean winner: the other side never touched it. */
  readonly clean: boolean;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _plane = new THREE.Plane();

/** The turn that lays a bat (blade toward its own -Z, faces toward +-Y) with its blade along `blade` and its face toward `face`. */
const batTurn = (out: THREE.Quaternion, blade: THREE.Vector3, face: THREE.Vector3): THREE.Quaternion => {
  _z.copy(blade).normalize().negate();
  _y.copy(face).addScaledVector(_z, -face.dot(_z)).normalize();
  _x.crossVectors(_y, _z);
  return out.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
};

/**
 * Moonlight Rally: table tennis against Kai, on a dais under Haven's planet. First to seven.
 *
 * The player's bat follows the pointer across their end of the table and rises by itself to the height of the ball,
 * so the game is getting there, and how the bat is moving when it does: pushed forward through the ball it drives,
 * drawn across it places the ball wide. Every shot is solved to land where it was aimed (see physics.ts); a ball
 * goes astray only off the edge of the blade or from swinging flat out.
 */
export class RallyWorld extends Minigame {
  readonly id = 'rally' as const;
  readonly soundscape = 'arcadeRally' as const;
  readonly score: Score = { you: 0, kai: 0 };
  phase: Phase = 'idle';
  /** Times each bat has met the ball this game. */
  readonly hits = { you: 0, kai: 0 };

  private stage!: Stage;
  /** Everything placed from the dais top: the table, the ball, the bats, the people. */
  private readonly court3d = new THREE.Group();
  private readonly bursts = new Bursts(1400);
  private readonly rings = new Rings(12);
  private readonly rng = new Rng(7107);
  /** The game itself: the ball, the rules and Kai's play. This class draws it and gives it the player's bat. */
  private readonly court = new Court(new Rng(7108), new Rng(2080), {
    contact: (contact) => this.onContact(contact),
    struck: (by, power, clean) => this.onStruck(by, power, clean),
    decided: (winner) => this.onDecided(winner),
  });
  /** The scripted player's hands, when a test is at the controls. */
  private readonly bot = new PlayerBot(new Rng(4242));

  // ---- the ball ----
  /** Where the ball is in the world: what everyone watches. */
  private readonly ballWorld = new THREE.Vector3();
  private readonly ballMesh = new THREE.Group();
  private readonly ballSpin = new THREE.Group();
  private readonly trail = new Trail(64, 0.034, 0.3);
  private readonly shadow = new BlobShadow(BALL_RADIUS);
  private ballLight: THREE.PointLight | null = null;
  private result: PointResult | null = null;
  private deadFor = 0;
  private serveClock = 0;
  private heat = 0;

  // ---- the player's bat ----
  private readonly bat = new THREE.Group();
  private readonly batAt = new THREE.Vector3(0, H + 0.2, 1.75);
  private readonly batWant = new THREE.Vector3(0, H + 0.2, 1.75);
  private readonly batVel = new THREE.Vector3();
  private readonly batTrail = new Trail(28, 0.07, 0.16);
  private swing = 0;
  private punch = 0;

  // ---- Kai ----
  private kai!: Character;
  private readonly kaiBat = new THREE.Group();
  private readonly kaiBatAt = new THREE.Vector3(-0.3, H + 0.1, KAI_Z + 0.36);
  private readonly kaiBatTurn = new THREE.Quaternion();
  private readonly kaiHand = new THREE.Quaternion();
  private readonly kaiWrist = new THREE.Vector3();
  private readonly kaiVel = new THREE.Vector3();
  private follow = 0;
  private readonly followFrom = new THREE.Vector3();
  private kaiZ = KAI_Z;
  private lumi!: Character;
  private nova!: Character;

  // ---- the court ----
  private readonly linesU = { uPulse: { value: 0 }, uSize: { value: new THREE.Vector2(TABLE.width, TABLE.length) }, uColor: { value: CYAN.clone().multiplyScalar(1.5) } };
  private readonly netU = { uShake: { value: 0 }, uShakeX: { value: 0 }, uTime: { value: 0 }, uColor: { value: CYAN.clone() } };
  private board!: Panel;
  private boardPulse = 0;
  private readonly lamps: THREE.PointLight[] = [];
  private played = 0;
  private sweep = 1;

  constructor() {
    super();
    this.seat = anchor(0, LIFT, 2.42, 0);
    this.eyeHeight = 1.5;
    this.restFocus = 5;
  }

  // ------------------------------------------------------------------------------------------------ building

  async build(ctx: BuildContext): Promise<void> {
    const scene = this.scene, q = ctx.quality;
    this.stage = await buildStage(ctx, this, {
      island: { radius: 11.5, depth: 17, seed: 14, flat: 0.8, hills: 0.7 }, grass: 16000, flowers: 70, lanterns: 14, motes: 150,
      bare: (x, z) => Math.hypot(x, z) < 4.28, shadowSpan: 7,
    });
    Object.assign(this.look, { exposure: 1.02, bloom: 0.22, saturation: 1.26, vignette: 0.4 });
    this.court3d.position.y = LIFT;
    scene.add(this.court3d);

    // ---- the dais the table stands on: Haven's star, half as big again ----
    const S = 1.6, daisTall = (await sizeOf(ctx, 'dais'))[1];
    await dress(ctx, scene, 'dais', [[0, LIFT - daisTall * S, 0, 18, S]]);

    // ---- the table: the model is the slab and its legs; the lines and the net are drawn here, exactly to size ----
    const table = await ctx.assets.instance('pp-table');
    table.rotation.y = Math.PI / 2;
    this.court3d.add(table);
    const lines = new THREE.Mesh(new THREE.PlaneGeometry(TABLE.width, TABLE.length), new THREE.ShaderMaterial({ vertexShader: LINES_VS, fragmentShader: LINES_FS, uniforms: this.linesU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    lines.rotation.x = -Math.PI / 2;
    lines.position.y = H + 0.0025;
    lines.renderOrder = 1;
    this.court3d.add(lines);
    this.buildNet();

    // ---- the ball: a bead of warm light ----
    const core = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.93, 0.78).multiplyScalar(1.9) }));
    // a faint band, so that its spin can be seen
    const band = new THREE.Mesh(new THREE.TorusGeometry(BALL_RADIUS * 1.01, BALL_RADIUS * 0.12, 6, 28), new THREE.MeshBasicMaterial({ color: GOLD.clone().multiplyScalar(2.6) }));
    this.ballSpin.add(core, band);
    this.ballMesh.add(this.ballSpin, makeHalo(0xffd9a0, 0.34, 0.55));
    if (q.tier !== 'low') {
      this.ballLight = new THREE.PointLight(0xffd9a0, 0.9, 1.5, 1.8);
      this.ballMesh.add(this.ballLight);
    }
    this.court3d.add(this.ballMesh, this.shadow.mesh, this.rings.group);
    this.batTrail.uniforms.uGain.value = 0;
    // sparks and trails are drawn in the world itself: they turn to face the camera, which is placed there
    scene.add(this.bursts.points, this.trail.mesh, this.batTrail.mesh);

    // ---- bats: the player's, and Kai's in his own amber ----
    // (their rubber is a deep cobalt that the evening would turn black: it is given a little light of its own)
    const lit = (model: THREE.Object3D, paint: (m: THREE.MeshStandardMaterial) => void): THREE.Object3D => {
      for (const m of ownMaterials(model)) {
        paint(m);
        m.emissiveMap = m.map;
        m.emissive.setScalar(1);
        m.emissiveIntensity = 0.5;
      }
      model.position.set(0, -HALF_THICK, -BLADE_Z);
      return model;
    };
    this.bat.add(lit(await ctx.assets.instance('pp-paddle'), () => undefined));
    this.court3d.add(this.bat);
    this.kaiBat.add(lit(await ctx.assets.instance('pp-paddle'), (m) => repaint(m, 0.63, 0.08, 0.13)));

    // ---- Kai, and the two who watch ----
    this.kai = this.addPerson('kai', await Character.create(ctx, CAST.kai, 'kai'));
    this.lumi = this.addPerson('lumi', await Character.create(ctx, CAST.lumi, 'lumi'));
    this.nova = this.addPerson('nova', await Character.create(ctx, CAST.nova, 'nova'));
    for (const person of [this.kai, this.lumi, this.nova]) {
      this.court3d.add(person.root);
      person.setPose('standOpen', { immediate: true });
      const aura = makeHalo(person.spec.aura ?? 0xffffff, 2.2, 0.18);
      aura.position.set(0, 0.95, -0.15);
      person.root.add(aura);
    }
    this.kai.place(0, 0, KAI_Z, 0);
    this.lumi.place(-2.25, 0, -1.0, 1.15).lookAtPoint(this.ballWorld);
    this.nova.place(2.3, 0, -1.25, -1.15).lookAtPoint(this.ballWorld);
    // the bat rides in his right hand: its blade carries on from his forearm, its face is his palm
    this.kaiBat.quaternion.setFromRotationMatrix(_m.makeBasis(_x.set(0, 0, 1), _y.set(1, 0, 0), _z.set(0, 1, 0)));
    this.kaiBat.position.set(0, -0.05, 0).sub(_a.set(0, 0, GRIP).applyQuaternion(this.kaiBat.quaternion));
    this.kai.rig.bones.handR.add(this.kaiBat);
    this.kai.onPose = () => reachArm(this.kai, 'R', this.kaiWrist, _a.set(-0.5, -1, -0.4), this.kaiHand);

    // ---- the scoreboard: a pane of light hung over Kai's end ----
    this.board = new Panel(900, 300, { world: true });
    this.board.mesh.scale.set(3.0, 1.0, 1);
    this.board.mesh.position.set(0, 2.42, -5.4);
    this.board.mesh.material.depthWrite = true;
    this.board.mesh.material.alphaTest = 0.02;
    this.court3d.add(this.board.mesh);

    // ---- lamp posts at the corners of the dais, and crystals in the grass beyond ----
    const lampTall = (await sizeOf(ctx, 'lamp-post'))[1];
    const posts: Spot[] = [];
    for (const [i, [x, z]] of ([[-3.1, -2.6], [3.1, -2.6], [-3.1, 2.6], [3.1, 2.6]] as const).entries()) {
      posts.push([x, LIFT - 0.05, z, i * 90]);
      scene.add(makeHalo(0xffb866, 3.2, 0.8).translateX(x).translateY(LIFT + lampTall * 0.82).translateZ(z));
      if (q.tier !== 'low' && z < 0) {
        const lamp = new THREE.PointLight(0xffb070, 7, 10, 1.8);
        lamp.position.set(x, LIFT + lampTall * 0.82, z);
        scene.add(lamp);
        this.lamps.push(lamp);
      }
    }
    await dress(ctx, scene, 'lamp-post', posts);
    const island = this.stage.island!;
    const crystals: Record<'crystals-a' | 'crystals-b', Spot[]> = { 'crystals-a': [], 'crystals-b': [] };
    for (const [n, [x, z, scale]] of ([[-6.4, -5.2, 1.3], [6.8, -4.4, 1.1], [-7.6, 2.2, 0.9], [7.2, 3.4, 1.2], [-4.2, 7.4, 0.8], [4.8, -8.0, 1.0], [0.6, -8.6, 1.4]] as const).entries()) {
      const y = (island.heightAt(x, z) ?? 0) - 0.12;
      crystals[n % 2 ? 'crystals-b' : 'crystals-a'].push([x, y, z, n * 67, scale]);
      scene.add(makeHalo(n % 2 ? 0x59d8ff : 0x1fd68a, scale * 3, 0.45).translateX(x).translateY(y + scale * 0.6).translateZ(z));
    }
    for (const id of ['crystals-a', 'crystals-b'] as const) await dress(ctx, scene, id, crystals[id]);

    this.paintBoard();
    this.reset();
  }

  private buildNet(): void {
    const wide = TABLE.width + TABLE.overhang * 2;
    const net = new THREE.Mesh(new THREE.PlaneGeometry(wide, TABLE.net, 48, 4), new THREE.ShaderMaterial({ vertexShader: NET_VS, fragmentShader: NET_FS, uniforms: this.netU, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    net.position.set(0, H + TABLE.net / 2, 0);
    net.renderOrder = 2;
    const alloy = new THREE.MeshStandardMaterial({ color: 0xcfe0f2, metalness: 0.9, roughness: 0.28 });
    const tip = new THREE.MeshBasicMaterial({ color: CYAN.clone().multiplyScalar(2.6) });
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, TABLE.net + 0.03, 12), alloy);
      post.position.set((s * wide) / 2, H + TABLE.net / 2 - 0.005, 0);
      post.castShadow = true;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), tip);
      cap.position.set((s * wide) / 2, H + TABLE.net + 0.014, 0);
      const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.05), alloy);
      clamp.position.set(s * (wide / 2 - 0.02), H - 0.012, 0);
      this.court3d.add(post, cap, clamp);
    }
    this.court3d.add(net);
  }

  private paintBoard(): void {
    const theme = THEMES.haven, { you, kai } = this.score;
    const point = gamePoint(this.score), serving = this.phase === 'serveYou' ? 'you' : this.phase === 'serveKai' ? 'kai' : this.court.rally.serving;
    this.board.paint((ctx, w, h) => {
      ctx.fillStyle = 'rgba(8, 14, 38, 0.9)';
      ctx.fillRect(12, 12, w - 24, h - 24);
      glass(ctx, 12, 12, w - 24, h - 24, theme, { glow: 1.3, borderWidth: 2.5 });
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      for (const [side, x, name, n] of [['you', w * 0.2, RALLY.board.you, you], ['kai', w * 0.8, RALLY.board.kai, kai]] as const) {
        ctx.fillStyle = theme.dim;
        ctx.font = font(600, 30);
        spaced(ctx, name, x, 62, 8, 'center');
        ctx.fillStyle = side === 'you' ? theme.accent : '#ffcf7a';
        ctx.font = font(700, 150);
        ctx.fillText(String(n), x, 172);
        if (serving === side) {
          ctx.fillStyle = theme.accent;
          sparkle(ctx, x + (side === 'you' ? -118 : 118), 62, 16);
        }
      }
      ctx.fillStyle = theme.text;
      ctx.font = displayFont(500, 46);
      ctx.fillText(MINIGAMES.rally.title, w / 2, 92, 330);
      ctx.fillStyle = point ? theme.accent : theme.dim;
      ctx.font = font(600, 22);
      spaced(ctx, point ? RALLY.board.point : RALLY.board.to(TO_WIN), w / 2, 152, 5, 'center');
      ctx.fillStyle = theme.dim;
      ctx.font = font(500, 22);
      ctx.fillText(`Kai · ${LEVELS[this.level]!.name}`, w / 2, 204);
    });
  }

  // ------------------------------------------------------------------------------------------------ the match

  override reset(): void {
    this.score.you = this.score.kai = 0;
    this.hits.you = this.hits.kai = 0;
    this.phase = 'idle';
    this.result = null;
    this.court.reset();
    this.bot.rest();
    this.kaiZ = KAI_Z;
    this.court.ball.p = v(0.25, H + 0.32, 1.7);
    this.trail.clear();
    this.heat = this.swing = this.punch = this.follow = 0;
    this.timeScale = 1;
    this.sweep = 1;
    if (this.board) this.paintBoard();
    for (const person of this.people) person.clearGesture().setMood('neutral');
  }

  async play(): Promise<Outcome> {
    const arcade = this.arcade, { hud, audio } = arcade.game;
    const level = LEVELS[this.level]!;
    this.bot.skill = arcade.autoSkill;
    // ---- the way in: round the table from the side, to the player's end ----
    this.sweep = 0;
    arcade.game.reach('rally.intro');
    this.kai.play('wave');
    hud.setCard(MINIGAMES.rally.title, `Kai · ${level.name} · first to ${TO_WIN}`);
    audio.sfx('card');
    arcade.tween(2.6, (k) => (this.sweep = k), ease.inOutCubic).catch(() => undefined);
    await arcade.wait(2.0);
    hud.setCard(null);
    await arcade.wait(0.5);
    await arcade.talk(this.played === 0 ? RALLY.intro : this.level > 0 && this.lastWon ? RALLY.harder : RALLY.again);
    hud.setHint(RALLY.controls);
    this.played++;
    arcade.game.reach('rally.ready');

    while (!matchWinner(this.score)) {
      const point = await this.rally(serverFor(this.score));
      this.score[point.winner]++;
      arcade.game.reach('rally.point');
      this.boardPulse = 1;
      this.paintBoard();
      const done = matchWinner(this.score) !== null;
      this.celebrate(point, done);
      // the last point is watched in slow motion
      if (done) {
        this.timeScale = 0.35;
        await arcade.wait(0.9);
        this.timeScale = 1;
      }
      await arcade.wait(done ? 0.8 : 1.35);
      if (!done && gamePoint(this.score) === 'you' && this.rng.chance(0.7)) arcade.bark(RALLY.gamePoint, 1.4);
      // the card of controls has done its work once a point has been played
      hud.setHint(null);
    }
    hud.setHint(null);
    arcade.hint(null);
    this.phase = 'idle';

    // ---- the end: whoever won, Kai is gracious about it ----
    const won = matchWinner(this.score) === 'you';
    this.lastWon = won;
    arcade.game.reach(won ? 'rally.won' : 'rally.lost');
    if (won) {
      audio.sfx('cheer');
      this.fireworks();
      this.lumi.play('cheer');
      this.nova.play('cheer');
      this.kai.play('clap');
    } else this.kai.play('handToChest');
    await arcade.wait(1.2);
    await arcade.talk(won ? RALLY.won : RALLY.lost);
    const outcome: Outcome = { won, stars: starsFor(this.score), summary: RALLY.summary(this.score.you, this.score.kai, level.name) };
    if (won) this.level = Math.min(LEVELS.length - 1, this.level + 1);
    return outcome;
  }

  private lastWon = false;

  /** One point, from the serve to whoever wins it. */
  private async rally(server: Side): Promise<PointResult> {
    const arcade = this.arcade;
    this.result = null;
    this.serveClock = 0;
    this.court.reset();
    this.bot.rest();
    this.trail.clear();
    this.phase = server === 'you' ? 'serveYou' : 'serveKai';
    this.paintBoard();
    arcade.hint(server === 'you' ? RALLY.serve : null);
    await arcade.until(() => this.result !== null);
    arcade.hint(null);
    return this.result!;
  }

  /** What follows a point: light, sound, and something kind from someone. */
  private celebrate(point: PointResult, last: boolean): void {
    const arcade = this.arcade, { audio, app } = arcade.game;
    const yours = point.winner === 'you';
    audio.sfx(yours ? 'pointWon' : 'pointLost');
    const at = _a.set(0, LIFT + H + 0.5, yours ? -0.7 : 0.7);
    this.bursts.emit(at, { count: yours ? 90 : 36, color: yours ? CYAN : AMBER, color2: WHITE, speed: yours ? 4.2 : 2.4, life: 1.1, size: 0.11, gravity: 1.6 });
    if (yours) {
      app.fx.flash = Math.max(app.fx.flash, 0.16);
      this.lumi.play('cheer').setMood('delighted');
      this.nova.play('clap').setMood('happy');
      this.kai.play(point.clean ? 'clap' : 'nod').setMood('happy');
    } else {
      this.lumi.play('clap').setMood('happy');
      this.kai.play('handToChest').setMood('happy');
    }
    if (last) return;
    // someone says something about most points
    const pool = yours ? (this.rng.chance(0.55) ? RALLY.yours : RALLY.lumiYours) : this.rng.chance(0.6) ? RALLY.his : RALLY.lumiHis;
    if (this.rng.chance(0.8)) arcade.bark(this.rng.pick(pool), 1.3);
  }

  private fireworks(): void {
    const hues = [CYAN, GOLD, new THREE.Color(1, 0.45, 0.7), new THREE.Color(0.35, 0.95, 0.6), WHITE];
    for (let i = 0; i < 7; i++) {
      this.arcade.game.app.tasks.wait(i * 0.28 + this.rng.range(0, 0.12), this.arcade.signal).then(() => {
        const at = new THREE.Vector3(this.rng.range(-9, 9), this.rng.range(6, 12), this.rng.range(-16, -7));
        this.bursts.emit(at, { count: 150, color: this.rng.pick(hues), color2: WHITE, speed: 9, spread: 0.3, life: 2.1, size: 0.5, gravity: 2.2 });
        this.arcade.game.audio.sfx('firework', { at });
      }, () => undefined);
    }
  }

  // ------------------------------------------------------------------------------------------------ the frame

  tick(dt: number, time: number): void {
    const arcade = this.arcade, { input, audio } = arcade.game, pointer = arcade.pointer;
    const court = this.court, ball = court.ball;
    this.netU.uTime.value = time;
    this.netU.uShake.value = damp(this.netU.uShake.value, 0, 5, dt);
    this.linesU.uPulse.value = damp(this.linesU.uPulse.value, 0, 6, dt);
    this.boardPulse = damp(this.boardPulse, 0, 4, dt);
    this.board.mesh.scale.set(3.0 * (1 + 0.06 * this.boardPulse), 1.0 * (1 + 0.06 * this.boardPulse), 1);
    this.rings.update(dt);
    this.punch = damp(this.punch, 0, 12, dt);

    this.movePlayerBat(dt);

    const level = LEVELS[this.level]!, easeOff = KaiBrain.ease(this.score.kai, this.score.you, level);
    const swing = (offX: number, offY: number): Swing => (arcade.auto ? this.bot.swing(offX, offY, court.brain.x) : { offX, offY, across: this.batVel.x, drive: this.swing });
    switch (this.phase) {
      case 'serveYou': {
        // the ball waits over the bat for the player to send it
        this.serveClock += dt;
        ball.p = v(this.batAt.x, this.batAt.y + 0.2 + Math.sin(time * 3) * 0.012, this.batAt.z - 0.06);
        const go = arcade.auto ? this.serveClock > 0.7 : this.serveClock > 0.25 && (pointer.pressed || input.pressed.has('advance') || input.pressed.has('interact'));
        if (go && court.serveYou(clamp(-this.batAt.x * 0.55 + this.rng.range(-0.12, 0.12), -0.5, 0.5), level, easeOff)) {
          this.phase = 'live';
          this.trail.clear();
          this.punch = 1;
          this.paintBoard();
          audio.sfx('serveToss');
          audio.sfx('ballBat', { gain: 0.7 });
          arcade.hint(null);
        }
        court.step(0, this.batAt, swing, level, easeOff);
        break;
      }
      case 'serveKai': {
        // Kai holds it up, lets it drop, and serves
        this.serveClock += dt;
        const toss = clamp01((this.serveClock - 0.7) / 0.55);
        ball.p = v(court.brain.x - 0.3, H + 0.34 + Math.sin(toss * Math.PI) * 0.22, this.kaiZ + 0.42);
        if (this.serveClock > 0.7 && this.serveClock - dt <= 0.7) audio.sfx('serveToss');
        if (this.serveClock > 1.25 && court.serveKai(level)) {
          this.phase = 'live';
          this.trail.clear();
          this.bot.incoming();
          this.startFollow();
          this.paintBoard();
          audio.sfx('ballBat', { gain: 0.7, at: this.worldOf(ball.p) });
        }
        court.step(0, this.batAt, swing, level, easeOff);
        break;
      }
      case 'live':
      case 'dead':
        court.step(dt, this.batAt, swing, level, easeOff);
        if (this.phase === 'dead') this.deadFor += dt;
        break;
      default:
        court.step(0, this.batAt, swing, level, easeOff);
        break;
    }

    this.ballWorld.set(ball.p.x, ball.p.y + LIFT, ball.p.z);
    this.moveKai(dt);
    this.moveCamera();

    // ---- the ball as it is drawn ----
    const p = ball.p, speed = Math.hypot(ball.v.x, ball.v.y, ball.v.z);
    this.ballMesh.position.set(p.x, p.y, p.z);
    this.ballMesh.visible = this.phase !== 'idle' && !(this.phase === 'dead' && this.deadFor > 1.6);
    this.ballSpin.rotation.x += ball.w.x * dt;
    this.ballSpin.rotation.y += ball.w.y * dt;
    this.ballSpin.rotation.z += ball.w.z * dt;
    const over = Math.abs(p.x) <= HALF_W && Math.abs(p.z) <= HALF_L;
    this.shadow.place(p.x, p.y - BALL_RADIUS, p.z, over ? H : 0);
    this.shadow.mesh.visible = this.ballMesh.visible;
    // the faster it flies, the hotter its trail
    this.heat = damp(this.heat, this.phase === 'live' ? clamp01((speed - 5.2) / 4.5) : 0, 6, dt);
    this.trail.uniforms.uColor.value.copy(CYAN).lerp(AMBER, this.heat);
    this.trail.uniforms.uGain.value = this.phase === 'live' || this.phase === 'dead' ? 1.6 + 2.6 * this.heat : 0;
    this.trail.width = 0.026 + 0.022 * this.heat;
  }

  private worldOf(p: { x: number; y: number; z: number }): THREE.Vector3 {
    return _c.set(p.x, p.y + LIFT, p.z);
  }

  /** The point is over: the ball stays in the world a moment longer, bouncing away. */
  private onDecided(winner: Side): void {
    const rally = this.court.rally;
    // clean: the loser never got a bat to the ball after the winner struck it
    this.result = { winner, clean: rally.lastHitter === winner && rally.received <= 1 && rally.length > 1 };
    this.phase = 'dead';
    this.deadFor = 0;
    this.bot.rest();
  }

  /** Light and sound for a bat meeting the ball. `power` 0..1. */
  private onStruck(by: Side, power: number, clean: boolean): void {
    const { audio, app } = this.arcade.game, ball = this.court.ball;
    this.hits[by]++;
    if (by === 'you') this.punch = 0.6 + 0.4 * power;
    else {
      this.bot.incoming();
      this.startFollow();
    }
    const at = this.worldOf(ball.p).clone();
    const smash = power > 0.72;
    audio.sfx(smash ? 'ballSmash' : 'ballBat', { at, gain: 0.6 + 0.5 * power, pitch: 1 + this.rng.range(-0.05, 0.05) + (clean ? 0 : -0.18) });
    const color = by === 'you' ? CYAN : AMBER;
    this.bursts.emit(at, { count: Math.round(8 + 34 * power), color, color2: WHITE, speed: 1.6 + 4 * power, life: 0.45, size: 0.06 + 0.05 * power, gravity: 1.5, toward: _b.set(0, 0.3, by === 'you' ? -1 : 1) });
    this.rings.emit(_a.set(ball.p.x, ball.p.y, ball.p.z), 0.34 + 0.5 * power, color, 0.3, _b.set(0, 0, 1));
    this.cam.shake(by === 'you' ? 0.1 + 0.34 * power : 0.05 + 0.12 * power);
    if (smash) {
      app.fx.kick = Math.max(app.fx.kick, 0.35 + (0.5 * (power - 0.72)) / 0.28);
      app.fx.flash = Math.max(app.fx.flash, 0.1);
    }
  }

  /** Light and sound for the ball meeting the table, the net or the ground. */
  private onContact(contact: Contact): void {
    const { audio } = this.arcade.game, ball = this.court.ball, p = ball.p;
    const at = this.worldOf(p).clone();
    const speed = Math.hypot(ball.v.x, ball.v.y, ball.v.z);
    if (contact === 'table') {
      // a ball rolling to a stop makes no sound worth hearing
      if (speed < 0.5) return;
      audio.sfx('ballTable', { at, gain: clamp(0.35 + speed * 0.09, 0.3, 1.1), pitch: 1 + this.rng.range(-0.06, 0.06) });
      this.rings.emit(_a.set(p.x, H + 0.004, p.z), 0.3 + speed * 0.04, CYAN, 0.42);
      this.linesU.uPulse.value = Math.min(1, this.linesU.uPulse.value + 0.5);
      this.bursts.emit(at, { count: 5, color: CYAN, color2: WHITE, speed: 0.9, life: 0.3, size: 0.045, gravity: 2, toward: _b.set(0, 1, 0) });
    } else if (contact === 'net' || contact === 'cord') {
      audio.sfx('ballNet', { at, gain: contact === 'cord' ? 0.6 : 1 });
      this.netU.uShake.value = contact === 'cord' ? 0.6 : 1;
      this.netU.uShakeX.value = p.x;
      this.bursts.emit(at, { count: 10, color: WHITE, speed: 1.2, life: 0.35, size: 0.05, gravity: 2 });
    } else if (speed > 0.6) audio.sfx('ballOut', { at, gain: this.deadFor > 0.4 ? 0.4 : 0.9 });
  }

  // ------------------------------------------------------------------------------------------------ the player

  private movePlayerBat(dt: number): void {
    const arcade = this.arcade, pointer = arcade.pointer, input = arcade.game.input;
    const want = this.batWant, court = this.court;
    const mine = court.live && court.rally.lastHitter === 'kai';
    if (arcade.auto) {
      // a scripted player: a stand-in for a person, as good as its skill
      this.bot.update(dt, court.ball, mine, court.rally.awaitingServeBounce());
      want.set(this.bot.x, want.y, this.bot.z);
    } else if (input.xrRay) {
      // in a headset the bat is in the hand: a little ahead of the controller
      want.copy(input.xrRay.origin).addScaledVector(input.xrRay.direction, 0.14);
      want.y -= LIFT;
    } else if (pointer.active) {
      // on a screen the pointer slides the bat over a level plane at the player's end
      _plane.set(_a.set(0, 1, 0), -(LIFT + H + 0.2));
      const hit = pointer.onPlane(_plane, _b);
      if (hit) want.set(clamp(hit.x, -REACH.x, REACH.x), want.y, clamp(hit.z, REACH.near, REACH.far));
    }
    // and it rises to the height the ball will pass at: the player's job is to be there, and to swing
    if (!input.xrRay) want.y = damp(want.y, court.batHeight(want.z) ?? H + 0.2, mine ? 16 : 6, dt);
    const before = _a.copy(this.batAt);
    this.batAt.x = damp(this.batAt.x, want.x, 30, dt);
    this.batAt.y = damp(this.batAt.y, want.y, 30, dt);
    this.batAt.z = damp(this.batAt.z, want.z, 30, dt);
    if (dt > 0) this.batVel.lerp(_b.subVectors(this.batAt, before).multiplyScalar(1 / dt), 1 - Math.exp(-22 * dt));
    // the hardest it has been pushed forward lately: a swing is judged by its best moment, not its last
    this.swing = Math.max(this.swing * Math.exp(-8 * dt), -this.batVel.z);

    // ---- as it is drawn: blade up, leaning out to the side it is on, turned in toward the table ----
    // (its rubber face is turned to the player, who only ever sees it from behind)
    const side = clamp(this.batAt.x * 1.1, -1, 1);
    batTurn(this.bat.quaternion, _b.set(side * 0.5 + this.batVel.x * 0.05, 1, 0.12 - this.punch * 0.5), _c.set(this.batAt.x * 0.3, -0.12 - this.punch * 0.4, 1));
    this.bat.position.copy(this.batAt);
    this.bat.position.z -= this.punch * 0.09;
    const fast = clamp01((this.batVel.length() - 1.5) / 4);
    this.batTrail.uniforms.uGain.value = 0.9 * fast;
  }

  // ------------------------------------------------------------------------------------------------ Kai

  /** After he has hit: the bat carries on through the ball for a moment. */
  private startFollow(): void {
    const p = this.court.ball.p;
    this.follow = 0.26;
    this.followFrom.set(p.x, p.y, p.z);
    this.kaiBatAt.copy(this.followFrom);
  }

  private moveKai(dt: number): void {
    const brain = this.court.brain, plan = brain.plan, bat = this.kaiBatAt;
    const before = _a.copy(bat);
    // a short ball draws him forward to the table
    const forwardTo = plan ? clamp(plan.at.z - 0.62, KAI_Z - 0.1, KAI_Z + 0.42) : KAI_Z;
    this.kaiZ = damp(this.kaiZ, forwardTo, 5, dt);
    const root = this.kai.root.position;
    const lean = clamp((brain.x - root.x) * 0.5, -0.16, 0.16);
    root.x = damp(root.x, brain.x, 18, dt);
    root.z = this.kaiZ;
    this.kai.root.rotation.z = damp(this.kai.root.rotation.z, -lean, 8, dt);

    const ready = _b.set(root.x - 0.31, H + 0.09, this.kaiZ + 0.36);
    if (this.follow > 0) {
      // through the ball, up and across
      this.follow -= dt;
      const k = 1 - Math.max(0, this.follow) / 0.26;
      bat.copy(this.followFrom).add(_c.set(0.22, 0.26, 0.5).multiplyScalar(ease.outCubic(k)));
    } else if (plan) {
      const left = plan.time - brain.clock, hit = _c.set(plan.at.x, plan.at.y, plan.at.z);
      if (left > 0.15) {
        // drawing back behind where the ball will be
        const back = hit.add(_x.set(-0.1, -0.07, -0.38));
        const k = 1 - Math.exp(-(left > 0.4 ? 5 : 14) * dt);
        bat.lerp(left > 0.42 ? back.lerp(ready, 0.45) : back, k);
      } else {
        // and through it: wherever the bat has got to, it is on the ball as the ball arrives
        bat.lerp(hit, clamp01(dt / Math.max(left, dt)));
      }
    } else if (this.phase === 'serveKai') {
      bat.lerp(_c.set(root.x - 0.3, H + 0.3 + clamp01((this.serveClock - 0.7) / 0.5) * 0.1, this.kaiZ + 0.26), 1 - Math.exp(-10 * dt));
    } else bat.lerp(ready, 1 - Math.exp(-7 * dt));
    if (dt > 0) this.kaiVel.lerp(_x.subVectors(bat, before).multiplyScalar(1 / dt), 1 - Math.exp(-18 * dt));

    // the blade stands up out of his hand and faces down the table, closing over the ball as he swings through
    const swing = clamp(this.kaiVel.z / 5, -0.4, 1);
    batTurn(this.kaiBatTurn, _x.set(-0.42 + this.kaiVel.x * 0.04, 1, -0.1 + swing * 0.55), _y.set(0.1, 0.2 - swing * 0.35, 1));
    // the hand that would hold a bat lying so, and the wrist that hand hangs from
    this.kaiHand.copy(this.kaiBatTurn).multiply(_q.copy(this.kaiBat.quaternion).invert());
    this.kaiWrist.set(0, 0, GRIP).applyQuaternion(this.kaiBatTurn).add(bat).add(_x.set(0, 0.05, 0).applyQuaternion(this.kaiHand));
    this.kaiWrist.y += LIFT;
    this.kai.lookAtPoint(this.phase === 'idle' ? this.arcade.game.playerEye : this.ballWorld);
  }

  // ------------------------------------------------------------------------------------------------ the camera

  private moveCamera(): void {
    const cam = this.cam, ball = this.court.ball.p;
    // the player's end: a little above and behind the bat, leaning with it
    const eye = _a.set(this.batAt.x * 0.2, LIFT + 1.74, 3.08), target = _b.set(ball.x * 0.1 + this.batAt.x * 0.05, LIFT + 0.8, -0.5);
    if (this.sweep < 1) {
      // arriving: in from the side and round to the player's end
      const k = this.sweep, a = (1 - k) * 1.25;
      eye.set(Math.sin(a) * 4.6, LIFT + 1.74 + (1 - k) * 0.8, Math.cos(a) * (3.08 + (1 - k) * 1.2));
      target.set(0, LIFT + 0.8, -0.5 * k);
      cam.ease = 30;
    } else cam.ease = 5;
    cam.eye.copy(eye);
    cam.target.copy(target);
    cam.fov = 50 - 3 * this.heat;
  }

  override update(frame: FrameContext): void {
    super.update(frame);
    this.stage.update(frame);
    this.bursts.update(frame.dt, frame.pixelHeight);
    this.trail.update(this.ballWorld, frame.camera, frame.dt);
    this.batTrail.update(_b.copy(this.batAt).setY(this.batAt.y + LIFT + 0.04), frame.camera, frame.dt);
    if (this.ballLight) this.ballLight.intensity = this.ballMesh.visible ? 0.9 + 1.2 * this.heat : 0;
  }
}
