import * as THREE from 'three';
import { Character } from '../../characters/Character';
import { CAST } from '../../characters/cast';
import { Rng, clamp01, damp, ease } from '../../core/math';
import { Bursts } from '../../render/Bursts';
import { GLSL_OUTPUT } from '../../render/glsl';
import { Panel } from '../../ui/Panel';
import { displayFont, font, glass, roundRect, spaced, sparkle, type Theme } from '../../ui/draw';
import { anchorToward, type BuildContext, type FrameContext } from '../../world/World';
import { sizeOf } from '../../world/dressing';
import { makeHalo } from '../../world/haven/atmosphere';
import { Rings, Trail } from '../fx';
import { Minigame, type Outcome } from '../Minigame';
import { MINIGAMES } from '../registry';
import { DUEL } from '../script';
import { buildStage, type Stage } from '../stage';
import { PAD, paintHint, type Paint, type UiEl } from '../ui';
import { ELEMENT_COLOR, ELEMENT_HEX, ELEMENT_NAME, SpriteActor } from './actor';
import {
  Battle, ELEMENTS, MAX_SPARK, PAIRS, SPRITES, SPRITE_IDS, chooseAction, chooseReplacement, effectiveness, restOf,
  type Action, type BattleEvent, type Element, type Fighter, type Move, type Side, type SpriteId, type Status,
} from './battle';

const ARENA_WIDE = 7.4;
/** How well Nova plays at each level: see `chooseAction`. */
const SKILL = [0.12, 0.55, 0.95] as const;
const WHITE = new THREE.Color(1, 0.97, 0.9);
const PLAIN = new THREE.Color(0.95, 0.95, 1.0);
const MEND = new THREE.Color(0.45, 1.0, 0.7);
const STATUS_NAME: Record<Status, string> = { shield: 'SHELL', scorch: 'SCORCH', dazzle: 'DAZZLE' };
const STATUS_HEX: Record<Status, string> = { shield: '#9fd8ff', scorch: '#ffa24a', dazzle: '#ffd0f0' };

const DOME_VS = /* glsl */ `varying vec3 vN, vV; varying float vY;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalMatrix * normal; vV = -mv.xyz; vY = position.y; gl_Position = projectionMatrix * mv; }`;
/** A shell of light round a sprite: bright where it turns away from the eye, with slow bands running up it. */
const DOME_FS = /* glsl */ `
uniform vec3 uColor; uniform float uTime, uShow;
varying vec3 vN, vV; varying float vY;
void main(){
  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);
  float bands = 0.5 + 0.5 * sin(vY * 16.0 - uTime * 3.0);
  gl_FragColor = vec4(uColor * (0.1 + 1.7 * rim + 0.14 * bands) * uShow, 1.0);
  ${GLSL_OUTPUT}
}`;

/** What the plates show of one side: the battle as far as it has been acted out, which lags the battle itself. */
interface View {
  index: number;
  hp: number[];
  spark: number;
  status: Record<Status, boolean>;
}

interface Popup {
  readonly panel: Panel;
  life: number;
  readonly from: THREE.Vector3;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/**
 * Sprite Duel: three of Haven's sprites against Nova's three, a round at a time. The rules are in battle.ts; this
 * is the arena they are acted out in. A round is decided all at once and then played back as a little scene:
 * a sprite darts, something flies, something lands, a number floats up, a bar goes down.
 */
export class SpriteWorld extends Minigame {
  readonly id = 'sprites' as const;
  readonly soundscape = 'arcadeSprites' as const;
  battle: Battle | null = null;
  /** Rounds played and moves chosen by hand this duel, for the tests. */
  readonly stats = { rounds: 0, chosen: 0 };

  private stage!: Stage;
  private floor = 0.4;
  private readonly bursts = new Bursts(2200);
  private readonly rings = new Rings(10);
  private readonly rng = new Rng(9091);
  private readonly actors = {} as Record<SpriteId, SpriteActor>;
  private nova!: Character;
  private lumi!: Character;
  private readonly homes: Record<Side, THREE.Vector3> = { you: new THREE.Vector3(-0.85, 0, 1.65), foe: new THREE.Vector3(0.85, 0, -1.65) };
  private readonly domes = {} as Record<Side, THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>>;
  private readonly view: Record<Side, View> = { you: { index: 0, hp: [], spark: 1, status: { shield: false, scorch: false, dazzle: false } }, foe: { index: 0, hp: [], spark: 1, status: { shield: false, scorch: false, dazzle: false } } };
  private readonly hpShown: Record<Side, number> = { you: 1, foe: 1 };

  // ---- what flies between them ----
  private readonly orb = new THREE.Group();
  private readonly orbCore: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly orbHalo: THREE.Sprite;
  private readonly trail = new Trail(48, 0.11, 0.34);
  private shot: { from: THREE.Vector3; to: THREE.Vector3; t: number; duration: number; element: Element | null } | null = null;
  private readonly orbAt = new THREE.Vector3();
  private readonly popups: Popup[] = [];

  // ---- the interface of a duel ----
  private plates: Record<Side, UiEl> | null = null;
  private logEl: UiEl | null = null;
  private logText = '';
  private readonly moveButtons: UiEl[] = [];
  private swapButton: UiEl | null = null;
  private readonly benchButtons: UiEl[] = [];
  private backButton: UiEl | null = null;
  private menu: 'none' | 'moves' | 'bench' | 'replace' = 'none';
  private chosen: Action | null = null;
  private replaced: number | null = null;
  private shotName: 'wide' | 'pair' | 'you' | 'foe' | 'fell' = 'wide';
  private played = 0;
  private lastWon = false;
  private statusClock = 0;

  constructor() {
    super();
    this.orbCore = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.orbHalo = makeHalo(0xffffff, 1.5, 0.9);
    this.orb.add(this.orbCore, this.orbHalo);
    this.orb.visible = false;
    this.eyeHeight = 1.5;
    this.restFocus = 6;
  }

  // ------------------------------------------------------------------------------------------------ building

  async build(ctx: BuildContext): Promise<void> {
    const scene = this.scene;
    this.stage = await buildStage(ctx, this, {
      island: { radius: 10.5, depth: 16, seed: 23, flat: 0.8, hills: 0.7 }, grass: 15000, flowers: 70, lanterns: 14, motes: 160,
      bare: (x, z) => Math.hypot(x, z) < ARENA_WIDE / 2 + 0.15, shadowSpan: 6.5,
    });
    Object.assign(this.look, { exposure: 1.0, bloom: 0.24, contrast: 0.27, vignette: 0.42 });

    // ---- the ring: sprites stand on its inlaid top, wherever the modeller put that ----
    const arena = await ctx.assets.instance('sp-arena');
    arena.scale.setScalar(ARENA_WIDE / (await sizeOf(ctx, 'sp-arena'))[0]);
    // its inlaid line runs across, between the two sides
    arena.rotation.y = Math.PI / 2;
    scene.add(arena);
    arena.updateMatrixWorld(true);
    const top = new THREE.Raycaster(new THREE.Vector3(1.1, 40, 0.8), new THREE.Vector3(0, -1, 0)).intersectObject(arena, true)[0];
    // it was modelled as a tall drum: most of it goes into the island, and a low step of it is left standing
    this.floor = 0.5;
    arena.position.y = this.floor - (top ? top.point.y : 2);
    for (const side of ['you', 'foe'] as const) this.homes[side].y = this.floor;
    this.seat = anchorToward(0.3, this.floor, 5.6, 0.1, -0.5);

    for (const id of SPRITE_IDS) {
      const actor = new SpriteActor(id, SPRITES[id].element, await ctx.assets.instance(`sp-${id}`), await sizeOf(ctx, `sp-${id}`));
      this.actors[id] = actor;
      scene.add(actor.root);
    }
    await ctx.step('duel: sprites');

    // ---- Nova at her end of the ring, Lumi at the player's ----
    this.nova = this.addPerson('nova', await Character.create(ctx, CAST.nova, 'nova'));
    this.lumi = this.addPerson('lumi', await Character.create(ctx, CAST.lumi, 'lumi'));
    for (const person of [this.nova, this.lumi]) {
      person.setPose('standOpen', { immediate: true });
      const aura = makeHalo(person.spec.aura ?? 0xffffff, 2.2, 0.18);
      aura.position.set(0, 0.95, -0.15);
      person.root.add(aura);
    }
    this.nova.place(2.15, this.floor, -2.5, Math.atan2(-2.15 - 0.8, 2.5 + 1.6));
    this.lumi.place(-2.25, this.floor, 0.25, Math.atan2(2.25 - 0.85, 1.65 - 0.25));

    // ---- a shell for each side, the thing that flies, and the numbers that float up ----
    for (const side of ['you', 'foe'] as const) {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), new THREE.ShaderMaterial({
        vertexShader: DOME_VS, fragmentShader: DOME_FS, uniforms: { uColor: { value: new THREE.Color(0.5, 0.85, 1.0) }, uTime: this.stage.time, uShow: { value: 0 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      }));
      dome.visible = false;
      dome.renderOrder = 3;
      this.domes[side] = dome;
      scene.add(dome);
    }
    for (let i = 0; i < 5; i++) {
      const panel = new Panel(300, 130, { world: true });
      panel.mesh.scale.set(1.5, 0.65, 1);
      panel.mesh.material.depthTest = false;
      panel.mesh.renderOrder = 6;
      panel.opacity = 0;
      scene.add(panel.mesh);
      this.popups.push({ panel, life: 0, from: new THREE.Vector3() });
    }
    scene.add(this.orb, this.trail.mesh, this.rings.group, this.bursts.points);
    this.reset();
  }

  // ------------------------------------------------------------------------------------------------ the duel

  override reset(): void {
    this.battle = null;
    this.shot = null;
    this.orb.visible = false;
    this.trail.clear();
    this.menu = 'none';
    this.chosen = null;
    this.replaced = null;
    this.plates = this.logEl = this.swapButton = this.backButton = null;
    this.moveButtons.length = this.benchButtons.length = 0;
    this.stats.rounds = this.stats.chosen = 0;
    this.timeScale = 1;
    for (const id of SPRITE_IDS) {
      const actor = this.actors[id];
      if (actor) actor.root.visible = false;
    }
    for (const side of ['you', 'foe'] as const) {
      this.view[side].status = { shield: false, scorch: false, dazzle: false };
      if (this.domes[side]) this.domes[side].visible = false;
    }
    for (const p of this.popups) p.panel.opacity = p.life = 0;
    for (const person of this.people) person.clearGesture().setMood('neutral');
    this.setShot('wide', true);
  }

  async play(): Promise<Outcome> {
    const arcade = this.arcade, { hud, audio } = arcade.game;
    const levelName = DUEL.levels[this.level]!;
    arcade.game.reach('duel.intro');
    this.nova.play('wave');
    hud.setCard(MINIGAMES.sprites.title, `Nova · ${levelName}`);
    audio.sfx('card');
    await arcade.wait(2.0);
    hud.setCard(null);
    await arcade.wait(0.5);
    await arcade.talk(this.played === 0 ? DUEL.intro : this.level > 0 && this.lastWon ? DUEL.harder : DUEL.again);
    this.played++;

    // ---- a team: one of each element, chosen from the two there are ----
    const team: SpriteId[] = [];
    this.setShot('pair');
    for (const element of ELEMENTS) {
      const pair = PAIRS[element];
      pair.forEach((id, i) => {
        const actor = this.actors[id];
        actor.place(_a.set(i === 0 ? -0.95 : 0.95, this.floor, 0.5), _b.set(i === 0 ? -0.6 : 0.6, this.floor, 6));
        actor.enter();
        this.burst(actor, 30);
      });
      audio.sfx('spriteIn');
      arcade.game.reach(`duel.pick.${element}`);
      let pick: number;
      if (arcade.auto) {
        await arcade.wait(0.7);
        pick = this.rng.int(0, 1);
      } else {
        pick = await arcade.choose(DUEL.pick[element].title, pair.map((id) => ({ title: SPRITES[id].name, detail: `${SPRITES[id].blurb} ${DUEL.pick[element].rule}.` })));
      }
      const taken = pair[pick]!;
      team.push(taken);
      this.actors[taken].jump(0.5);
      audio.sfx('arcadeStar');
      await arcade.wait(0.7);
      for (const id of pair) this.actors[id].leave();
      audio.sfx('spriteBack');
      await arcade.wait(0.4);
    }

    // ---- out they come ----
    const battle = (this.battle = new Battle(team, restOf(team), new Rng(this.rng.int(1, 1e9))));
    for (const side of ['you', 'foe'] as const) {
      this.view[side] = { index: 0, hp: battle.teams[side].map((f) => f.hp), spark: 1, status: { shield: false, scorch: false, dazzle: false } };
      this.hpShown[side] = 1;
    }
    this.setShot('wide');
    this.buildHud();
    await arcade.say(DUEL.ready);
    hud.setSubtitle(null);
    this.nova.play('present');
    await this.sendIn('foe', 0);
    await this.sendIn('you', 0);
    arcade.game.reach('duel.ready');

    const skill = SKILL[this.level]!;
    while (!battle.winner) {
      const mine = await this.askAction();
      const hers = chooseAction(battle, 'foe', this.rng, skill);
      this.stats.rounds++;
      await this.enact(battle.round(mine, hers));
      for (const side of ['foe', 'you'] as const) {
        if (!battle.needsReplacement(side)) continue;
        const to = side === 'foe' || arcade.auto ? chooseReplacement(battle, side, this.rng) : await this.askReplacement();
        await this.enact(battle.replace(side, to));
      }
      arcade.game.reach('duel.round');
    }

    // ---- over: Nova is delighted, or sorry ----
    this.showMenu('none');
    const won = battle.winner === 'you';
    this.lastWon = won;
    arcade.game.reach(won ? 'duel.won' : 'duel.lost');
    this.setLog('');
    const standing = battle.teams.you.filter((f) => f.hp > 0).length;
    if (won) {
      audio.sfx('cheer');
      this.nova.play('cheer');
      this.lumi.play('cheer');
      this.actors[battle.out('you').sprite.id].jump(0.6);
      this.fireworks();
    } else this.nova.play('handToChest');
    await arcade.wait(1.3);
    await arcade.talk(won ? DUEL.won : DUEL.lost);
    const outcome: Outcome = { won, stars: (won ? Math.max(1, standing) : 0) as 0 | 1 | 2 | 3, summary: DUEL.summary(won ? standing : 0, levelName) };
    if (won) this.level = Math.min(SKILL.length - 1, this.level + 1);
    return outcome;
  }

  private actorOf(side: Side, index = this.view[side].index): SpriteActor {
    return this.actors[this.battle!.teams[side][index]!.sprite.id];
  }

  private fighter(side: Side, index = this.view[side].index): Fighter {
    return this.battle!.teams[side][index]!;
  }

  /** A sprite comes out onto its side of the ring. */
  private async sendIn(side: Side, index: number): Promise<void> {
    const arcade = this.arcade, v = this.view[side];
    v.index = index;
    v.status = { shield: false, scorch: false, dazzle: false };
    v.spark = this.fighter(side, index).spark;
    this.hpShown[side] = v.hp[index]! / this.fighter(side, index).sprite.hp;
    const actor = this.actorOf(side, index);
    actor.place(this.homes[side], this.homes[side === 'you' ? 'foe' : 'you']);
    actor.enter();
    this.burst(actor, 70);
    this.rings.emit(_a.copy(this.homes[side]).setY(this.floor + 0.03), 2.6, ELEMENT_COLOR[actor.element], 0.6);
    arcade.game.audio.sfx('spriteIn', { at: this.homes[side] });
    this.setLog(DUEL.log.sent(side === 'you', this.fighter(side, index).sprite.name));
    this.repaintHud();
    await arcade.wait(0.75);
  }

  private burst(actor: SpriteActor, count: number): void {
    this.bursts.emit(actor.centre(_c), { count, color: ELEMENT_COLOR[actor.element], color2: WHITE, speed: 2.6, life: 0.8, size: 0.14, gravity: -0.5 });
  }

  /** Plays a round back, one thing at a time. */
  private async enact(events: BattleEvent[]): Promise<void> {
    const arcade = this.arcade, { audio, app } = arcade.game, battle = this.battle!;
    this.showMenu('none');
    for (const e of events) {
      const v = this.view[e.side];
      switch (e.type) {
        case 'switch': {
          const from = battle.teams[e.side][e.from]!;
          if (!this.actorOf(e.side, e.from).gone && v.hp[e.from]! > 0) {
            this.setShot(e.side);
            this.setLog(DUEL.log.back(from.sprite.name));
            this.actorOf(e.side, e.from).leave();
            audio.sfx('spriteBack');
            await arcade.wait(0.5);
          }
          this.setShot('wide');
          await this.sendIn(e.side, e.to);
          break;
        }
        case 'move': {
          const user = this.actorOf(e.side), target = this.actorOf(e.side === 'you' ? 'foe' : 'you');
          v.spark = Math.max(0, v.spark - e.move.cost);
          this.setShot(e.side);
          this.setLog(DUEL.log.used(this.fighter(e.side).sprite.name, e.move.name));
          this.repaintHud();
          await arcade.wait(0.3);
          if (e.move.power > 0) await this.strike(user, target, e.move);
          else {
            user.jump(0.4);
            await arcade.wait(0.3);
          }
          break;
        }
        case 'damage': {
          const actor = this.actorOf(e.side), at = actor.centre(_a).clone();
          v.hp[v.index] = e.hp;
          const color = e.element ? ELEMENT_COLOR[e.element] : PLAIN;
          actor.struck(e.effect === 'strong' ? 1.3 : e.effect === 'weak' ? 0.5 : 0.9);
          this.bursts.emit(at, { count: e.effect === 'strong' ? 130 : e.effect === 'weak' ? 30 : 70, color, color2: WHITE, speed: e.effect === 'strong' ? 6 : 3.6, life: 0.8, size: 0.16, gravity: e.element === 'ember' ? -1 : 2.4 });
          this.rings.emit(_b.copy(actor.home).setY(this.floor + 0.03), e.effect === 'strong' ? 3.4 : 2.2, color, 0.5);
          this.cam.shake(e.effect === 'strong' ? 0.6 : e.effect === 'weak' ? 0.12 : 0.32);
          audio.sfx(e.effect === 'strong' ? 'spriteStrong' : 'spriteHit', { at, pitch: e.effect === 'weak' ? 0.8 : 1 });
          this.popup(at, `-${e.amount}`, e.effect === 'strong' ? '#ffe08a' : e.effect === 'weak' ? '#b8c2dd' : '#ffffff', e.crit ? DUEL.log.crit : e.effect === 'strong' ? DUEL.log.strong : e.effect === 'weak' ? DUEL.log.weak : '');
          if (e.effect === 'strong' || e.crit) {
            app.fx.flash = Math.max(app.fx.flash, 0.2);
            app.fx.kick = Math.max(app.fx.kick, 0.5);
          }
          // the player picked the right element: Lumi noticed
          if (e.effect === 'strong' && e.side === 'foe' && this.rng.chance(0.45)) arcade.bark(this.rng.pick(DUEL.lumiStrong), 1.2);
          this.repaintHud();
          await arcade.wait(e.effect === 'strong' ? 0.85 : 0.6);
          break;
        }
        case 'heal': {
          const actor = this.actorOf(e.side), at = actor.centre(_a).clone();
          v.hp[v.index] = e.hp;
          if (e.amount > 0) {
            this.bursts.emit(at, { count: 60, color: MEND, color2: WHITE, speed: 1.6, life: 1.1, size: 0.14, gravity: -1.6 });
            this.rings.emit(_b.copy(actor.home).setY(this.floor + 0.03), 2.2, MEND, 0.7);
            this.popup(at, `+${e.amount}`, '#8dffc0', '');
            audio.sfx('spriteMend', { at });
            actor.jump(0.25);
          }
          this.repaintHud();
          await arcade.wait(0.55);
          break;
        }
        case 'recoil': {
          const actor = this.actorOf(e.side), at = actor.centre(_a).clone();
          v.hp[v.index] = e.hp;
          actor.struck(0.5);
          this.popup(at, `-${e.amount}`, '#ffb38a', '');
          this.repaintHud();
          await arcade.wait(0.4);
          break;
        }
        case 'status': {
          v.status[e.status] = e.on;
          const name = this.fighter(e.side).sprite.name;
          if (e.on) {
            this.setLog(e.status === 'shield' ? DUEL.log.shield(name) : e.status === 'scorch' ? DUEL.log.scorched(name) : DUEL.log.dazzle(name));
            audio.sfx(e.status === 'shield' ? 'spriteShell' : e.status === 'dazzle' ? 'spriteDazzle' : 'moveEmber', { gain: e.status === 'scorch' ? 0.5 : 1 });
          } else this.setLog(DUEL.log.wore[e.status]);
          this.repaintHud();
          await arcade.wait(e.on ? 0.6 : 0.35);
          break;
        }
        case 'scorch': {
          const actor = this.actorOf(e.side), at = actor.centre(_a).clone();
          v.hp[v.index] = e.hp;
          actor.struck(0.45);
          this.bursts.emit(at, { count: 36, color: ELEMENT_COLOR.ember, color2: WHITE, speed: 1.8, life: 0.8, size: 0.13, gravity: -1.8 });
          this.popup(at, `-${e.amount}`, '#ffa24a', '');
          this.setLog(DUEL.log.scorch(this.fighter(e.side).sprite.name));
          audio.sfx('spriteHit', { at, gain: 0.5, pitch: 1.3 });
          this.repaintHud();
          await arcade.wait(0.5);
          break;
        }
        case 'faint': {
          const actor = this.actorOf(e.side, e.index);
          v.hp[e.index] = 0;
          v.status = { shield: false, scorch: false, dazzle: false };
          this.setShot('fell');
          this.setLog(DUEL.log.fell(battle.teams[e.side][e.index]!.sprite.name));
          actor.faint();
          this.burst(actor, 120);
          audio.sfx('spriteFell', { at: actor.home });
          // watched slowly: it is the moment the duel turns on
          this.timeScale = 0.45;
          this.repaintHud();
          if (e.side === 'you') this.nova.play('handToChest').setMood('worried');
          else {
            this.nova.play('clap').setMood('delighted');
            this.lumi.play('cheer');
          }
          if (!battle.winner) arcade.bark(this.rng.pick(e.side === 'you' ? DUEL.yoursFell : DUEL.hersFell), 1.4);
          await arcade.wait(0.9);
          this.timeScale = 1;
          await arcade.wait(0.3);
          this.setShot('wide');
          break;
        }
        case 'spark':
          v.spark = e.spark;
          this.repaintHud();
          break;
      }
    }
    this.setShot('wide');
  }

  /** The move itself: a knock is a dart at the other sprite; an element is thrown. */
  private async strike(user: SpriteActor, target: SpriteActor, move: Move): Promise<void> {
    const arcade = this.arcade, { audio } = arcade.game;
    const to = target.centre(_a).clone();
    if (move.element === null) {
      user.dart(target.home, 0.46);
      audio.sfx('moveKnock', { at: user.home });
      await arcade.wait(0.17);
      return;
    }
    user.jump(0.3);
    user.dart(_b.lerpVectors(user.home, target.home, 0.22), 0.4);
    audio.sfx(move.element === 'ember' ? 'moveEmber' : move.element === 'tide' ? 'moveTide' : 'moveBloom', { at: user.home });
    await arcade.wait(0.12);
    const from = user.centre(_c).clone();
    const color = ELEMENT_COLOR[move.element];
    this.orbCore.material.color.copy(color).lerp(WHITE, 0.12).multiplyScalar(1.9);
    this.orbHalo.material.color.copy(color).multiplyScalar(1.5);
    this.orb.scale.setScalar(0.7 + move.power / 60);
    this.trail.uniforms.uColor.value.copy(color);
    this.trail.uniforms.uGain.value = 2.6;
    this.trail.clear();
    this.shot = { from, to, t: 0, duration: 0.4, element: move.element };
    await arcade.until(() => this.shot === null);
  }

  private popup(at: THREE.Vector3, text: string, color: string, note: string): void {
    const p = this.popups.reduce((old, q) => (q.life < old.life ? q : old));
    p.life = 1;
    p.from.copy(at).add(_c.set(this.rng.range(-0.25, 0.25), 0.55, 0));
    p.panel.paint((ctx, w, h) => {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.font = font(800, 68);
      ctx.lineWidth = 9;
      ctx.strokeStyle = 'rgba(8, 12, 34, 0.92)';
      ctx.strokeText(text, w / 2, note ? 46 : h / 2);
      ctx.fillStyle = color;
      ctx.fillText(text, w / 2, note ? 46 : h / 2);
      if (!note) return;
      ctx.font = font(700, 24);
      ctx.lineWidth = 6;
      ctx.strokeText(note, w / 2, 100, w - 12);
      ctx.fillText(note, w / 2, 100, w - 12);
    });
  }

  private fireworks(): void {
    const hues = [ELEMENT_COLOR.ember, ELEMENT_COLOR.tide, ELEMENT_COLOR.bloom, WHITE];
    for (let i = 0; i < 7; i++) {
      this.arcade.game.app.tasks.wait(i * 0.28 + this.rng.range(0, 0.12), this.arcade.signal).then(() => {
        const at = new THREE.Vector3(this.rng.range(-8, 8), this.rng.range(6, 11), this.rng.range(-14, -6));
        this.bursts.emit(at, { count: 150, color: this.rng.pick(hues), color2: WHITE, speed: 9, spread: 0.3, life: 2.1, size: 0.5, gravity: 2.2 });
        this.arcade.game.audio.sfx('firework', { at });
      }, () => undefined);
    }
  }

  // ------------------------------------------------------------------------------------------------ asking the player

  /** Waits for the player to pick a move or a swap. */
  private async askAction(): Promise<Action> {
    const arcade = this.arcade, battle = this.battle!;
    if (arcade.auto) {
      await arcade.wait(0.35);
      return chooseAction(battle, 'you', this.rng, arcade.autoSkill);
    }
    this.chosen = null;
    arcade.hush();
    this.setLog(DUEL.log.choose(battle.out('you').sprite.name));
    this.showMenu('moves');
    await arcade.until(() => this.chosen !== null);
    this.stats.chosen++;
    this.showMenu('none');
    return this.chosen!;
  }

  private async askReplacement(): Promise<number> {
    this.replaced = null;
    this.arcade.hush();
    this.setLog(DUEL.log.replace);
    this.showMenu('replace');
    await this.arcade.until(() => this.replaced !== null);
    this.showMenu('none');
    return this.replaced!;
  }

  private setLog(text: string): void {
    this.logText = text;
    if (!this.logEl) return;
    this.logEl.repaint();
    this.logEl.show(text !== '');
  }

  private showMenu(menu: 'none' | 'moves' | 'bench' | 'replace'): void {
    this.menu = menu;
    const battle = this.battle;
    const moves = menu === 'moves', bench = menu === 'bench' || menu === 'replace';
    this.moveButtons.forEach((b, i) => {
      b.disabled = !battle || !battle.legal('you', { kind: 'move', index: i as 0 | 1 | 2 });
      b.repaint();
      b.show(moves);
    });
    if (this.swapButton) {
      this.swapButton.disabled = !battle || battle.bench('you').length === 0;
      this.swapButton.repaint();
      this.swapButton.show(moves);
    }
    const waiting = battle ? battle.teams.you.map((_, i) => i).filter((i) => i !== battle.active.you) : [];
    this.benchButtons.forEach((b, n) => {
      const index = waiting[n];
      b.disabled = index === undefined || !battle || battle.teams.you[index]!.hp <= 0;
      b.repaint();
      b.show(bench && index !== undefined);
    });
    this.backButton?.show(menu === 'bench');
  }

  private buildHud(): void {
    const ui = this.arcade.ui, battle = this.battle!;
    // the pause control has the top right corner: Nova's plate stands clear of it
    this.plates = {
      foe: ui.add(390 + PAD * 2, 104 + PAD * 2, this.paintPlate('foe')).at(1, 1, -88, -12).show(),
      you: ui.add(390 + PAD * 2, 104 + PAD * 2, this.paintPlate('you')).at(-1, -1, 14, 108).show(),
    };
    this.logEl = ui.add(620 + PAD * 2, 44 + PAD * 2, paintHint(() => this.logText)).at(0, 1, 0, -18);
    const wide = 262, gap = 10, total = wide * 3 + 128 + gap * 3, left = -total / 2 + wide / 2;
    for (let i = 0; i < 3; i++) {
      const b = ui.add(wide + PAD * 2, 84 + PAD * 2, this.paintMove(i as 0 | 1 | 2)).at(0, -1, left + i * (wide + gap), 12);
      b.key = (['choice1', 'choice2', 'choice3'] as const)[i]!;
      b.onClick = () => {
        if (this.menu === 'moves' && battle.legal('you', { kind: 'move', index: i as 0 | 1 | 2 })) this.chosen = { kind: 'move', index: i as 0 | 1 | 2 };
      };
      this.moveButtons.push(b);
    }
    this.swapButton = ui.add(128 + PAD * 2, 84 + PAD * 2, this.paintPlain(() => DUEL.tag.swap, 'E')).at(0, -1, left + 3 * (wide + gap) - wide / 2 + 64, 12);
    this.swapButton.key = 'interact';
    this.swapButton.onClick = () => this.showMenu('bench');
    for (let n = 0; n < 2; n++) {
      const b = ui.add(340 + PAD * 2, 84 + PAD * 2, this.paintBench(n)).at(0, -1, (n - 0.5) * 350 - 70, 12);
      b.key = (['choice1', 'choice2'] as const)[n]!;
      b.onClick = () => {
        const waiting = battle.teams.you.map((_, i) => i).filter((i) => i !== battle.active.you);
        const index = waiting[n];
        if (index === undefined || battle.teams.you[index]!.hp <= 0) return;
        if (this.menu === 'replace') this.replaced = index;
        else if (this.menu === 'bench' && battle.legal('you', { kind: 'switch', to: index })) this.chosen = { kind: 'switch', to: index };
      };
      this.benchButtons.push(b);
    }
    this.backButton = ui.add(128 + PAD * 2, 84 + PAD * 2, this.paintPlain(() => DUEL.tag.back, 'E')).at(0, -1, 350 + 30, 12);
    this.backButton.key = 'interact';
    this.backButton.onClick = () => this.showMenu('moves');
  }

  private repaintHud(): void {
    this.plates?.you.repaint();
    this.plates?.foe.repaint();
  }

  // ------------------------------------------------------------------------------------------------ painting

  private static chip(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string): number {
    ctx.font = font(700, 11.5);
    const w = ctx.measureText(text).width + 18;
    ctx.fillStyle = color;
    ctx.globalAlpha *= 0.22;
    roundRect(ctx, x, y, w, 20, 10);
    ctx.fill();
    ctx.globalAlpha /= 0.22;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    roundRect(ctx, x + 0.6, y + 0.6, w - 1.2, 18.8, 10);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 9, y + 10.5);
    return w;
  }

  private static sparks(ctx: CanvasRenderingContext2D, x: number, y: number, have: number, of: number, theme: Theme): void {
    for (let i = 0; i < of; i++) {
      ctx.fillStyle = i < have ? theme.accent : 'rgba(255, 255, 255, 0.18)';
      sparkle(ctx, x + i * 17, y, 6.5);
    }
  }

  /** A side's plate: who is out, what it is, how it is, and who is waiting behind it. */
  private paintPlate(side: Side): Paint {
    return (ctx, w, h, el) => {
      const theme = el.layer.theme, battle = this.battle;
      if (!battle) return;
      const v = this.view[side], f = battle.teams[side][v.index]!, sprite = f.sprite;
      const x = PAD, y = PAD, pw = w - PAD * 2;
      glass(ctx, x, y, pw, h - PAD * 2, theme, { glow: 0.8 });
      ctx.fillStyle = ELEMENT_HEX[sprite.element];
      ctx.fillRect(x, y, 5, h - PAD * 2);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillStyle = theme.dim;
      ctx.font = font(600, 10.5);
      spaced(ctx, side === 'you' ? 'YOURS' : 'NOVA\'S', x + 18, y + 16, 2.2);
      ctx.fillStyle = theme.text;
      ctx.font = displayFont(600, 30);
      ctx.fillText(sprite.name, x + 18, y + 40);
      let cx = x + 18 + ctx.measureText(sprite.name).width + 12;
      cx += SpriteWorld.chip(ctx, cx, y + 30, ELEMENT_NAME[sprite.element].toUpperCase(), ELEMENT_HEX[sprite.element]) + 6;
      for (const status of ['shield', 'scorch', 'dazzle'] as const) if (v.status[status]) cx += SpriteWorld.chip(ctx, cx, y + 30, STATUS_NAME[status], STATUS_HEX[status]) + 6;
      // the bar: what is shown eases toward what is so
      const bx = x + 18, by = y + 62, bw = pw - 36, k = clamp01(this.hpShown[side]);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      roundRect(ctx, bx, by, bw, 12, 6);
      ctx.fill();
      ctx.fillStyle = k > 0.5 ? '#5fe0a0' : k > 0.22 ? '#ffc35a' : '#ff6a5a';
      if (k > 0.004) {
        roundRect(ctx, bx, by, Math.max(12, bw * k), 12, 6);
        ctx.fill();
      }
      ctx.fillStyle = theme.dim;
      ctx.font = font(600, 12.5);
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.max(0, Math.round(v.hp[v.index]!))} / ${sprite.hp}`, bx + bw, by + 26);
      // sparks, and the three of the team: lit if standing, ringed if out
      SpriteWorld.sparks(ctx, bx + 6, by + 27, v.spark, MAX_SPARK, theme);
      battle.teams[side].forEach((member, i) => {
        const px = bx + 82 + i * 20, py = by + 27;
        ctx.beginPath();
        ctx.arc(px, py, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = v.hp[i]! > 0 ? ELEMENT_HEX[member.sprite.element] : 'rgba(255, 255, 255, 0.16)';
        ctx.fill();
        if (i === v.index) {
          ctx.strokeStyle = theme.text;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(px, py, 8.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    };
  }

  /** A move's button: what it is called, what it does, what it costs, and how it would land on what is out. */
  private paintMove(index: 0 | 1 | 2): Paint {
    return (ctx, w, h, el) => {
      const theme = el.layer.theme, battle = this.battle;
      if (!battle) return;
      const me = battle.out('you'), move = me.sprite.moves[index], foe = battle.out('foe');
      const x = PAD, y = PAD, bw = w - PAD * 2, bh = h - PAD * 2, k = el.glow;
      const color = move.element ? ELEMENT_HEX[move.element] : '#cfd6ea';
      glass(ctx, x, y, bw, bh, theme, { glow: 0.4 + 0.9 * k, border: k > 0.02 ? color : undefined, borderWidth: 1.5 + k, wash: `rgba(255, 255, 255, ${0.09 * k})` });
      ctx.globalAlpha = el.disabled ? 0.38 : 1;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 5, bh);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillStyle = theme.dim;
      ctx.font = font(600, 11);
      ctx.fillText(String(index + 1), x + 16, y + 16);
      ctx.fillStyle = theme.text;
      ctx.font = font(650, 19);
      ctx.fillText(move.name, x + 30, y + 26, bw - 110);
      ctx.fillStyle = theme.dim;
      ctx.font = font(400, 12.5);
      ctx.fillText(move.text, x + 16, y + 52, bw - 28);
      ctx.font = font(500, 11.5);
      ctx.fillText(move.power > 0 ? `power ${move.power}` : 'no damage', x + 16, y + 70);
      if (move.cost > 0) SpriteWorld.sparks(ctx, x + bw - 14 - (move.cost - 1) * 17, y + 68, el.disabled ? 0 : move.cost, move.cost, theme);
      // how it would land on the sprite across the ring: the lesson of the game, said every turn
      const factor = move.power > 0 ? effectiveness(move.element, foe.sprite.element) : 1;
      if (factor !== 1) {
        ctx.globalAlpha = el.disabled ? 0.38 : 1;
        const label = factor > 1 ? DUEL.tag.strong : DUEL.tag.weak;
        ctx.font = font(700, 11.5);
        SpriteWorld.chip(ctx, x + bw - ctx.measureText(label).width - 28, y + 15, label, factor > 1 ? '#ffe08a' : '#9aa6c8');
      }
      ctx.globalAlpha = 1;
    };
  }

  /** One of the two sprites waiting: a button to bring it in. */
  private paintBench(n: number): Paint {
    return (ctx, w, h, el) => {
      const theme = el.layer.theme, battle = this.battle;
      if (!battle) return;
      const waiting = battle.teams.you.map((_, i) => i).filter((i) => i !== battle.active.you);
      const index = waiting[n];
      if (index === undefined) return;
      const f = battle.teams.you[index]!, sprite = f.sprite, foe = battle.out('foe');
      const x = PAD, y = PAD, bw = w - PAD * 2, bh = h - PAD * 2, k = el.glow;
      glass(ctx, x, y, bw, bh, theme, { glow: 0.4 + 0.9 * k, border: k > 0.02 ? ELEMENT_HEX[sprite.element] : undefined, borderWidth: 1.5 + k, wash: `rgba(255, 255, 255, ${0.09 * k})` });
      ctx.globalAlpha = el.disabled ? 0.38 : 1;
      ctx.fillStyle = ELEMENT_HEX[sprite.element];
      ctx.fillRect(x, y, 5, bh);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillStyle = theme.dim;
      ctx.font = font(600, 11);
      ctx.fillText(String(n + 1), x + 16, y + 16);
      ctx.fillStyle = theme.text;
      ctx.font = displayFont(600, 26);
      ctx.fillText(sprite.name, x + 30, y + 27);
      const cx = x + 30 + ctx.measureText(sprite.name).width + 10;
      SpriteWorld.chip(ctx, cx, y + 17, f.hp > 0 ? ELEMENT_NAME[sprite.element].toUpperCase() : DUEL.tag.out.toUpperCase(), f.hp > 0 ? ELEMENT_HEX[sprite.element] : '#9aa6c8');
      const k2 = clamp01(f.hp / sprite.hp);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      roundRect(ctx, x + 16, y + 50, bw - 32, 9, 4.5);
      ctx.fill();
      if (k2 > 0) {
        ctx.fillStyle = k2 > 0.5 ? '#5fe0a0' : k2 > 0.22 ? '#ffc35a' : '#ff6a5a';
        roundRect(ctx, x + 16, y + 50, Math.max(9, (bw - 32) * k2), 9, 4.5);
        ctx.fill();
      }
      // which way the elements lean between it and what it would face
      const mine = effectiveness(sprite.element, foe.sprite.element), theirs = effectiveness(foe.sprite.element, sprite.element);
      ctx.fillStyle = theme.dim;
      ctx.font = font(500, 12);
      ctx.fillText(mine > 1 ? `Strong against ${foe.sprite.name}` : theirs > 1 ? `Weak against ${foe.sprite.name}` : `Even with ${foe.sprite.name}`, x + 16, y + 72);
      ctx.globalAlpha = 1;
    };
  }

  private paintPlain(label: () => string, hint: string): Paint {
    return (ctx, w, h, el) => {
      const theme = el.layer.theme, x = PAD, y = PAD, bw = w - PAD * 2, bh = h - PAD * 2, k = el.glow;
      glass(ctx, x, y, bw, bh, theme, { glow: 0.4 + 0.9 * k, border: k > 0.02 ? theme.accent : undefined, borderWidth: 1.5 + k, wash: `rgba(255, 255, 255, ${0.09 * k})` });
      ctx.globalAlpha = el.disabled ? 0.38 : 1;
      ctx.fillStyle = theme.text;
      ctx.font = font(650, 18);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label(), x + bw / 2, y + bh / 2 - 6);
      ctx.fillStyle = theme.dim;
      ctx.font = font(600, 11);
      ctx.fillText(hint, x + bw / 2, y + bh / 2 + 18);
      ctx.globalAlpha = 1;
    };
  }

  // ------------------------------------------------------------------------------------------------ the frame

  private setShot(name: 'wide' | 'pair' | 'you' | 'foe' | 'fell', cut = false): void {
    this.shotName = name;
    if (cut) this.cam.cut();
  }

  tick(dt: number, time: number): void {
    for (const id of SPRITE_IDS) this.actors[id].update(dt, time);
    this.rings.update(dt);

    // ---- what is flying ----
    const shot = this.shot;
    if (shot) {
      shot.t += dt;
      const k = clamp01(shot.t / shot.duration);
      this.orbAt.lerpVectors(shot.from, shot.to, ease.inQuad(k));
      this.orbAt.y += Math.sin(k * Math.PI) * 0.55;
      this.orb.position.copy(this.orbAt);
      this.orb.visible = true;
      const color = shot.element ? ELEMENT_COLOR[shot.element] : PLAIN;
      this.bursts.emit(this.orbAt, { count: 3, color, color2: WHITE, speed: 0.9, life: 0.5, size: 0.11, gravity: shot.element === 'ember' ? -1.4 : shot.element === 'tide' ? 2.6 : 0.5 });
      if (k >= 1) {
        this.shot = null;
        this.orb.visible = false;
      }
    } else this.trail.uniforms.uGain.value = damp(this.trail.uniforms.uGain.value, 0, 8, dt);

    // ---- conditions that show for as long as they last ----
    const battle = this.battle;
    this.statusClock += dt;
    const puff = this.statusClock > 0.12;
    if (puff) this.statusClock = 0;
    for (const side of ['you', 'foe'] as const) {
      const v = this.view[side], dome = this.domes[side];
      const actor = battle ? this.actorOf(side) : null;
      const shown = (dome.material.uniforms.uShow!.value = damp(dome.material.uniforms.uShow!.value, actor && v.status.shield && !actor.gone ? 1 : 0, 6, dt));
      dome.visible = shown > 0.01;
      if (actor) {
        dome.position.copy(actor.centre(_a));
        dome.scale.setScalar(actor.top * 0.78);
        if (puff && !actor.gone && v.status.scorch) this.bursts.emit(actor.centre(_a), { count: 2, color: ELEMENT_COLOR.ember, color2: WHITE, speed: 0.8, life: 0.7, size: 0.1, gravity: -1.6 });
        if (puff && !actor.gone && v.status.dazzle) this.bursts.emit(actor.centre(_a).add(_b.set(0, actor.top * 0.3, 0)), { count: 2, color: ELEMENT_COLOR.bloom, color2: WHITE, speed: 1.1, life: 0.6, size: 0.09, gravity: 0 });
      }
      // the bar on the plate follows the health it shows
      if (battle) {
        const want = v.hp[v.index]! / this.fighter(side).sprite.hp, was = this.hpShown[side];
        this.hpShown[side] = Math.abs(want - was) < 0.002 ? want : damp(was, want, 6, dt);
        if (this.hpShown[side] !== was) this.plates?.[side].repaint();
      }
    }

    // ---- numbers rising off whoever was struck ----
    for (const p of this.popups) {
      if (p.life <= 0) continue;
      p.life = Math.max(0, p.life - dt / 1.1);
      const k = 1 - p.life;
      p.panel.mesh.position.copy(p.from).setY(p.from.y + 0.9 * ease.outCubic(k));
      p.panel.opacity = clamp01(p.life * 3) * clamp01(k * 9);
      p.panel.mesh.scale.set(1.5 * (1 + 0.5 * clamp01(1 - k * 5)), 0.65 * (1 + 0.5 * clamp01(1 - k * 5)), 1);
    }

    this.moveCamera(time);
    for (const person of this.people) person.lookAtPoint(this.arcade.game.playerEye);
  }

  private moveCamera(time: number): void {
    const cam = this.cam, f = this.floor, you = this.homes.you;
    const sway = Math.sin(time * 0.31) * 0.18;
    cam.ease = 3.6;
    // (the ring's pylons stand a sixth of a turn apart, one to either side of the player's end: every view looks between them)
    switch (this.shotName) {
      case 'pair':
        // looking down past the two of them: they stand in the top of the picture, over the cards they are chosen from
        cam.eye.set(sway * 0.6, f + 1.2, 4.2);
        cam.target.set(0, f - 0.45, 0.5);
        cam.fov = 42;
        break;
      case 'you':
        // over the player's sprite, across the ring at Nova's
        cam.eye.set(you.x + 1.0 + sway * 0.4, f + 1.45, you.z + 2.35);
        cam.target.set(0.4, f + 0.72, -1.1);
        cam.fov = 42;
        break;
      case 'foe':
        // from the side, as her sprite's move comes across
        cam.eye.set(-2.9, f + 1.5 + sway * 0.3, 1.5);
        cam.target.set(0.35, f + 0.7, -0.2);
        cam.fov = 48;
        break;
      case 'fell':
        cam.eye.set(sway * 3, f + 1.15, 4.5);
        cam.target.set(0, f + 0.6, 0);
        cam.fov = 37;
        break;
      default:
        // the whole ring from the player's end: their sprite near and to the left, Nova's across it to the right
        cam.eye.set(0.25 + sway, f + 2.25, 6.3);
        cam.target.set(0.1, f + 0.6, -0.6);
        cam.fov = 44;
        break;
    }
  }

  override update(frame: FrameContext): void {
    super.update(frame);
    this.stage.update(frame);
    this.bursts.update(frame.dt, frame.pixelHeight);
    this.trail.update(this.orbAt, frame.camera, frame.dt);
    for (const p of this.popups) if (p.life > 0) frame.camera.getWorldQuaternion(p.panel.mesh.quaternion);
  }
}
