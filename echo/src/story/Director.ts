import * as THREE from 'three';
import type { Game, WorldId } from '../app/Game';
import { ease, type Ease } from '../core/math';
import { lerpLook, makeLook } from '../render/PostPipeline';
import type { ChoiceOption } from '../ui/Hud';
import { cameraYaw, type Anchor, type World } from '../world/World';
import { DAYS, SPEAKERS, type Line } from './script';
import { glowScreenEdges } from '../ui/dom/taskGlow';

const _head = new THREE.Vector3();

/** Characters per second of the typewriter. */
const TYPE_SPEED = 46;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * The stage manager. Chapters are plain async functions that call these verbs one after another: say a line,
 * wait for the player to walk somewhere, offer a choice, dissolve one world into another. Every verb waits on
 * the game clock and honours the chapter's abort signal, so a restart unwinds cleanly from any point.
 */
export class Director {
  /** Finish lines by themselves after a reading pause. */
  autoAdvance = true;
  private controller = new AbortController();
  private readonly blend = makeLook();

  constructor(private readonly game: Game) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** A scripted playthrough is driving: nothing waits for a person. */
  private get auto(): boolean {
    return this.game.autopilot.enabled;
  }

  /** Stops whatever chapter is running; its awaits reject with Cancelled. */
  abort(): void {
    this.controller.abort();
    this.controller = new AbortController();
  }

  // ------------------------------------------------------------------------------------------------ time

  wait(seconds: number): Promise<void> {
    return this.game.app.tasks.wait(seconds, this.signal);
  }

  until(predicate: (dt: number) => boolean): Promise<void> {
    return this.game.app.tasks.until(predicate, this.signal);
  }

  tween(seconds: number, onUpdate: (k: number) => void, easing: Ease = ease.inOutCubic): Promise<void> {
    return this.game.app.tasks.tween(seconds, onUpdate, easing, this.signal);
  }

  /** True once when the player asks to move on (click, tap, Space, Enter). The press is consumed. */
  private advancePressed(): boolean {
    const input = this.game.input;
    if (this.game.hud.choosing) return false;
    const tapped = input.mode === 'touch' ? input.released.has('primary') && input.wasTap : input.pressed.has('primary');
    if (!tapped && !input.pressed.has('advance')) return false;
    input.pressed.delete('primary');
    input.pressed.delete('advance');
    input.released.delete('primary');
    return true;
  }

  // ------------------------------------------------------------------------------------------------ words

  /** One line of dialogue: the speaker animates, the words type out, and the line waits to be read. */
  async say(line: Line): Promise<void> {
    const { hud, audio, app } = this.game;
    const speaker = SPEAKERS[line.who];
    const person = app.world?.cast[line.who];
    // the lens goes to whoever is speaking, and back to rest for a line with no face to it
    app.focus = person ? person.headWorld(_head).distanceTo(this.game.playerEye) : null;
    if (person) {
      if (line.mood) person.setMood(line.mood);
      if (line.gesture) person.play(line.gesture);
      person.setTalking(1);
      person.lookAtPoint(this.game.playerEye);
    }
    hud.setSubtitle({ speaker: speaker.name, color: speaker.color, text: line.text });
    const total = line.text.length;
    let shown = 0, voiced = 0;
    {
      await this.until((dt) => {
        shown = Math.min(total, shown + dt * TYPE_SPEED);
        if (this.advancePressed()) shown = total;
        // a syllable every third letter is enough to read as speech
        while (voiced < Math.floor(shown)) {
          const ch = line.text[voiced] ?? ' ';
          if (voiced % 3 === 0 && /[a-z0-9]/i.test(ch)) audio.voice(line.who, ch);
          voiced++;
        }
        hud.setSubtitleProgress(shown, false);
        return shown >= total;
      });
    }
    person?.setTalking(0);
    hud.setSubtitleProgress(total, true);
    let held = 0;
    const reading = 0.85 + total * 0.04;
    await this.until((dt) => {
      held += dt;
      if (this.advancePressed()) {
        audio.sfx('advance');
        return true;
      }
      return (this.autoAdvance || this.auto) && held > reading;
    });
  }

  async play(lines: readonly Line[]): Promise<void> {
    for (const line of lines) await this.say(line);
    this.game.hud.setSubtitle(null);
  }

  /** Clears the subtitle panel between beats. */
  hush(): void {
    this.game.hud.setSubtitle(null);
  }

  /** A task done: a chime, the screen's edges light up gold, and the task stays up ticked for a moment. */
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

  /** Offers a decision and returns the index picked. The world holds still while the player decides. */
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
    this.tween(0.5, (k) => (fx.dim = k)).catch(() => undefined);
    try {
      const shown = hud.choose(title, [...options], this.signal);
      // a scripted run still shows the choice for a moment, then answers it through the same door a key press uses
      if (this.auto) {
        const want = await this.game.autopilot.choose(title, options.length);
        this.wait(1.1).then(() => input.inject((['choice1', 'choice2', 'choice3'] as const)[want] ?? 'choice1'), () => undefined);
      }
      const index = await shown;
      audio.sfx('uiSelect');
      return index;
    } finally {
      // not a tween on the story's clock: the picture must come back even if the story was cancelled mid-choice
      this.game.app.tasks.tween(0.45, (k) => (fx.dim = Math.min(fx.dim, 1 - k))).catch(() => undefined);
      player.canMove = couldMove;
      player.canLook = couldLook;
      interaction.enabled = true;
      hud.setReticleVisible(true);
      if (this.game.playing) input.capturePointer();
    }
  }

  /** The two-line outcome card after a decision: what it gave, what it cost. */
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

  /** Unframed lines in the middle of the screen, held for `seconds`. */
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

  // ------------------------------------------------------------------------------------------------ picture

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

  /** The title card that opens a day. Call with the picture already faded out. */
  async card(key: keyof typeof DAYS): Promise<void> {
    const { hud, audio } = this.game;
    const d = DAYS[key];
    hud.setCard(d.day, d.place);
    audio.sfx('card');
    await this.wait(2.3);
    hud.setCard(null);
    await this.wait(0.6);
  }

  /** Cuts to a world, under a fade or a card. */
  async enter(id: WorldId, anchor: Anchor, eyeHeight?: number): Promise<World> {
    const world = await this.game.ensureWorld(id);
    this.game.setWorld(world);
    this.game.player.teleport(anchor, eyeHeight);
    return world;
  }

  /**
   * Dissolves the current world into another around the player: near things change first, the horizon last.
   * This is what putting the headset on, and taking it off, looks like.
   */
  async wipeTo(id: WorldId, anchor: Anchor, eyeHeight?: number): Promise<World> {
    const { app, player, audio } = this.game;
    const from = app.world;
    const to = await this.game.ensureWorld(id);
    if (!from || app.renderer.xr.isPresenting) {
      // a headset has no second pass to dissolve with: go through light instead
      await this.fadeOut(0.5, 0xe8f0ff);
      this.game.setWorld(to);
      player.teleport(anchor, eyeHeight);
      await this.fadeIn(0.9);
      return to;
    }
    // slide the outgoing scene under the player so their pose is continuous across the cut
    const delta = cameraYaw(anchor) - player.yaw;
    const moved = player.position.clone().applyAxisAngle(UP, delta);
    from.scene.rotation.y = delta;
    from.scene.position.copy(anchor.position).sub(moved);
    from.scene.updateMatrixWorld(true);
    const pitch = player.pitch;
    this.game.setWorld(to);
    player.teleport(anchor, eyeHeight);
    player.pitch = pitch;

    const reach = Math.min(app.camera.far * 0.9, 90) + 6;
    const wipe = { scene: from.scene, radius: 0, softness: 2.4, color: new THREE.Color(to.theme === 'haven' ? 0xffc27a : 0x9fd0ff).multiplyScalar(2.2) };
    app.wipe = wipe;
    app.lookOverride = this.blend;
    lerpLook(this.blend, from.look, to.look, 0);
    audio.sfx('wipe');
    // into Haven the wave can take its time; back into a real room it must not leave Haven's far hills and sky
    // hanging in the window after the room itself is back, so it races out and is gone in under two seconds
    const toReal = to.theme !== 'haven';
    try {
      await this.tween(toReal ? 1.8 : 3.1, (k) => {
        // slow at arm's length, then racing for the horizon
        wipe.radius = toReal ? reach * (0.1 * k + 0.9 * k * k) : reach * (0.06 * k + 0.94 * k * k * k);
        lerpLook(this.blend, from.look, to.look, Math.min(1, k * (toReal ? 2.2 : 1.6)));
      }, ease.linear);
    } finally {
      app.wipe = null;
      app.lookOverride = null;
      app.post.releaseWipe();
      from.scene.rotation.y = 0;
      from.scene.position.set(0, 0, 0);
      from.scene.updateMatrixWorld(true);
    }
    return to;
  }

  /** Waits until the player is within `radius` metres of a ground point. A scripted run is simply put there. */
  async walkTo(x: number, z: number, radius: number): Promise<void> {
    const player = this.game.player;
    if (this.auto) {
      await this.wait(0.4);
      player.position.set(x, player.position.y, z);
      return;
    }
    await this.until(() => player.distanceTo(x, z) < radius);
  }

  /** Carries the player the last step onto a mark, so a scene is seen from where it was composed. A cut in a headset, where being moved is unpleasant. */
  async stepTo(x: number, z: number, seconds = 0.6): Promise<void> {
    const p = this.game.player.position, fromX = p.x, fromZ = p.z;
    if (this.auto || this.game.app.renderer.xr.isPresenting) {
      p.set(x, p.y, z);
      return;
    }
    await this.tween(seconds, (k) => p.set(fromX + (x - fromX) * k, p.y, fromZ + (z - fromZ) * k));
  }
}
