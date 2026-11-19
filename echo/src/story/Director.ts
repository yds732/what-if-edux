import * as THREE from 'three';
import type { Game, WorldId } from '../app/Game';
import type { Character } from '../characters/Character';
import { ease, type Ease } from '../core/math';
import { lerpLook, makeLook, WIPE_DISTANCE } from '../render/PostPipeline';
import type { ChoiceOption } from '../ui/Hud';
import { cameraYaw, type Anchor, type World } from '../world/World';
import { DAYS, SPEAKERS, type Line } from './script';
import { glowScreenEdges } from '../ui/dom/taskGlow';

const _head = new THREE.Vector3();

const TYPE_SPEED = 46;

export class Director {
  autoAdvance = true;
  private controller = new AbortController();
  private readonly blend = makeLook();

  constructor(private readonly game: Game) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  private get auto(): boolean {
    return this.game.autopilot.enabled;
  }

  abort(): void {
    this.controller.abort();
    this.controller = new AbortController();
  }

  wait(seconds: number, signal: AbortSignal = this.signal): Promise<void> {
    return this.game.app.tasks.wait(seconds, signal);
  }

  until(predicate: (dt: number) => boolean, signal: AbortSignal = this.signal): Promise<void> {
    return this.game.app.tasks.until(predicate, signal);
  }

  tween(seconds: number, onUpdate: (k: number) => void, easing: Ease = ease.inOutCubic): Promise<void> {
    return this.game.app.tasks.tween(seconds, onUpdate, easing, this.signal);
  }

  advancePressed(): boolean {
    const input = this.game.input;
    if (this.game.hud.choosing) return false;
    const tapped = input.mode === 'touch' ? input.released.has('primary') && input.wasTap : input.pressed.has('primary');
    if (!tapped && !input.pressed.has('advance')) return false;
    input.pressed.delete('primary');
    input.pressed.delete('advance');
    input.released.delete('primary');
    return true;
  }

  async say(line: Line, signal: AbortSignal = this.signal): Promise<void> {
    const { app } = this.game;
    const person = app.world?.cast[line.who];
    app.focus = person ? person.headWorld(_head).distanceTo(this.game.playerEye) : null;
    if (person) {
      if (line.mood) person.setMood(line.mood);
      if (line.gesture) person.play(line.gesture);
      person.lookAtPoint(this.game.playerEye);
    }
    await this.subtitle(line, person, signal);
  }

  async subtitle(line: Line, person?: Character, signal = this.signal, linger?: number): Promise<void> {
    const { hud, audio } = this.game;
    const speaker = SPEAKERS[line.who];
    hud.setSubtitle({ speaker: speaker.name, color: speaker.color, text: line.text });
    const speech = audio.voice(line, this.game.speed);
    const total = line.text.length;
    let shown = 0;
    try {
      await this.until((dt) => {
        shown = Math.min(total, shown + dt * TYPE_SPEED);
        if (this.advancePressed()) shown = total;
        person?.setTalking(speech?.done ? 0 : 1);
        hud.setSubtitleProgress(shown, false);
        return shown >= total;
      }, signal);
      hud.setSubtitleProgress(total, true);
      let held = 0;
      const reading = linger === undefined ? 0.85 + total * 0.04 : linger + total * 0.02;
      await this.until((dt) => {
        held += dt;
        const finished = !speech || speech.done;
        if (finished) person?.setTalking(0);
        if (this.advancePressed()) {
          audio.sfx('advance');
          return true;
        }
        return finished && held > reading && (linger !== undefined || this.autoAdvance || this.auto);
      }, signal);
    } finally {
      speech?.stop();
      person?.setTalking(0);
    }
  }

  async read(line: Line, seconds: number, minimum = 0): Promise<void> {
    const speech = this.game.audio.voice(line, this.game.speed);
    let held = 0;
    try {
      await this.until((dt) => {
        held += dt;
        return (held >= minimum && this.advancePressed()) || (held >= seconds && (!speech || speech.done));
      });
    } finally {
      speech?.stop();
    }
  }

  async play(lines: readonly Line[]): Promise<void> {
    for (const line of lines) await this.say(line);
    this.game.hud.setSubtitle(null);
  }

  hush(): void {
    this.game.hud.setSubtitle(null);
  }

  async complete(text: string): Promise<void> {
    const { hud, audio, app } = this.game;
    audio.sfx('taskDone');
    glowScreenEdges();
    app.fx.flash = Math.max(app.fx.flash, 0.12);
    hud.setObjective(text, true);
    await this.wait(1.5);
    hud.setObjective(null);
  }

  objective(text: string | null): void {
    this.game.hud.setObjective(text);
    if (text) this.game.audio.sfx('objective');
  }

  async choose(title: string, options: readonly ChoiceOption[]): Promise<number> {
    const { hud, input, interaction, player, audio } = this.game;
    this.hush();
    interaction.enabled = false;
    const couldMove = player.canMove, couldLook = player.canLook;
    player.canMove = false;
    player.canLook = false;
    hud.setReticleVisible(false);
    input.freePointer();
    const fx = this.game.app.fx;
    if (fx.fade < 0.01) fx.fadeColor.set(0x05040a);
    this.tween(0.5, (k) => (fx.dim = k)).catch(() => undefined);
    try {
      const shown = hud.choose(title, [...options], this.signal);
      if (this.auto) {
        const want = await this.game.autopilot.choose(title, options.length);
        this.wait(1.1).then(() => input.inject((['choice1', 'choice2', 'choice3'] as const)[want] ?? 'choice1'), () => undefined);
      }
      const index = await shown;
      audio.sfx('uiSelect');
      return index;
    } finally {
      this.game.app.tasks.tween(0.45, (k) => (fx.dim = Math.min(fx.dim, 1 - k))).catch(() => undefined);
      player.canMove = couldMove;
      player.canLook = couldLook;
      interaction.enabled = true;
      hud.setReticleVisible(true);
      if (this.game.playing) input.capturePointer();
    }
  }

  async result(data: { heading: string; gained: string; missed: string }): Promise<void> {
    const { hud, audio } = this.game;
    this.hush();
    hud.setResult(data);
    audio.sfx('result');
    await this.wait(1.2);
    let held = 0;
    await this.until((dt) => {
      held += dt;
      return this.advancePressed() || held > (this.auto ? 1.5 : 7.5);
    });
    hud.setResult(null);
    await this.wait(0.5);
  }

  async reflect(lines: readonly string[], seconds: number): Promise<void> {
    const { hud } = this.game;
    this.hush();
    hud.setReflection([...lines]);
    await this.wait(1.4);
    let held = 0;
    await this.until((dt) => {
      held += dt;
      return held > (this.auto ? Math.min(seconds, 2) : seconds) || (held > 1 && this.advancePressed());
    });
    hud.setReflection(null);
    await this.wait(1.4);
  }

  fadeOut(seconds = 0.7, color: THREE.ColorRepresentation = 0x05040a): Promise<void> {
    const fx = this.game.app.fx;
    fx.fadeColor.set(color);
    const from = fx.fade;
    return this.tween(seconds, (k) => (fx.fade = from + (1 - from) * k), ease.inOutQuad);
  }

  fadeIn(seconds = 0.9): Promise<void> {
    const fx = this.game.app.fx;
    const from = fx.fade;
    return this.tween(seconds, (k) => (fx.fade = from * (1 - k)), ease.inOutQuad);
  }

  async card(key: keyof typeof DAYS): Promise<void> {
    const { hud, audio } = this.game;
    const d = DAYS[key];
    hud.setCard(d.day, d.place);
    audio.sfx('card');
    await this.wait(2.3);
    hud.setCard(null);
    await this.wait(0.6);
  }

  async enter(id: WorldId, anchor: Anchor, eyeHeight?: number): Promise<World> {
    const world = await this.game.ensureWorld(id);
    this.game.setWorld(world);
    this.game.player.teleport(anchor, eyeHeight);
    return world;
  }

  async wipeTo(id: WorldId, anchor: Anchor, onArrival?: () => void): Promise<World> {
    const { app, player, audio } = this.game;
    const from = app.world;
    const to = await this.game.ensureWorld(id);
    const arrive = (): void => {
      this.game.setWorld(to);
      player.teleport(anchor);
      onArrival?.();
    };
    if (!from || app.renderer.xr.isPresenting) {
      await this.fadeOut(0.5, 0xe8f0ff);
      arrive();
      await this.fadeIn(0.9);
      return to;
    }
    const delta = cameraYaw(anchor) - player.yaw;
    const toReal = to.theme !== 'haven';
    const wipe = { projection: app.post.captureWipe(app.camera, delta), radius: 0, softness: 2.4, color: new THREE.Color(toReal ? 0x9fd0ff : 0xffc27a).multiplyScalar(2.2) };
    const pitch = player.pitch;
    app.wipe = wipe;
    arrive();
    player.pitch = pitch;

    const reach = WIPE_DISTANCE + 2 * wipe.softness;
    app.lookOverride = this.blend;
    lerpLook(this.blend, from.look, to.look, 0);
    audio.sfx('wipe');
    try {
      await this.tween(toReal ? 0.65 : 1.05, (k) => {
        wipe.radius = reach * k;
        lerpLook(this.blend, from.look, to.look, k);
      }, ease.linear);
    } finally {
      app.wipe = null;
      app.lookOverride = null;
    }
    return to;
  }

  async walkTo(x: number, z: number, radius: number): Promise<void> {
    const player = this.game.player;
    if (this.auto) {
      await this.wait(0.4);
      player.position.set(x, player.position.y, z);
      return;
    }
    await this.until(() => player.distanceTo(x, z) < radius);
  }

  async stepTo(x: number, z: number, seconds = 0.6): Promise<void> {
    const p = this.game.player.position, fromX = p.x, fromZ = p.z;
    if (this.auto || this.game.app.renderer.xr.isPresenting) {
      p.set(x, p.y, z);
      return;
    }
    await this.tween(seconds, (k) => p.set(fromX + (x - fromX) * k, p.y, fromZ + (z - fromZ) * k));
  }
}
