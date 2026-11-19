import * as THREE from 'three';
import type { Game } from '../app/Game';
import type { Soundscape } from '../audio/GameAudio';
import { ease, type Ease } from '../core/math';
import { Cancelled, isCancelled } from '../core/tasks';
import type { Line } from '../story/script';
import { SPEAKERS } from '../story/script';
import type { Anchor } from '../world/World';
import type { Minigame, Outcome } from './Minigame';
import { Pointer } from './Pointer';
import { MINIGAMES, MINIGAME_IDS, type MinigameId, type MinigameInfo } from './registry';
import { PAD, UiLayer, paintBark, paintButton, paintHint, paintResult, type UiEl } from './ui';

const STORE = 'echo-between-two-worlds/arcade';
const TYPE_SPEED = 46;
const _eye = new THREE.Vector3();

const loadStars = (): Record<MinigameId, number> => {
  const stars = Object.fromEntries(MINIGAME_IDS.map((id) => [id, 0])) as Record<MinigameId, number>;
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<Record<MinigameId, number>>;
    for (const id of MINIGAME_IDS) stars[id] = Math.max(0, Math.min(3, Math.round(Number(saved[id]) || 0)));
  } catch {
  }
  return stars;
};

export class Arcade {
  active: Minigame | null = null;
  readonly pointer = new Pointer();
  readonly ui: UiLayer;
  readonly stars = loadStars();
  onStars: ((id: MinigameId, stars: number) => void) | null = null;
  last: Outcome | null = null;
  readonly plays: Partial<Record<MinigameId, number>> = {};
  autoSkill = 1;
  startLevel = 0;

  private readonly built = new Map<MinigameId, Promise<Minigame>>();
  private session: AbortController | null = null;
  private restartWanted = false;
  private barking: AbortController | null = null;
  private hintEl: UiEl | null = null;
  private hintText = '';
  private barkEl: UiEl | null = null;
  private barkLine = { name: '', color: '#ffffff', text: '' };
  private held = false;
  private readonly motion = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.25 : 1;

  constructor(readonly game: Game) {
    this.ui = new UiLayer(game.hud, game.input);
    this.ui.onHover = () => game.audio.sfx('uiHover');
    this.ui.onPress = () => game.audio.sfx('uiSelect');
    game.addSystem((dt, time) => this.update(dt, time));
  }

  private update(dt: number, time: number): void {
    const world = this.active;
    if (!world && this.ui.els.size === 0) return;
    const { app, input } = this.game;
    this.ui.update(dt);
    if (!world) return;
    world.cam.restore(app);
    this.pointer.update(input, app.camera, app.canvas);
    if (this.ui.hovering) this.pointer.down = this.pointer.pressed = false;
    world.tick(dt * world.timeScale, time);
    world.cam.apply(app, dt, time, this.motion);
    this.game.playerEye.copy(app.camera.getWorldPosition(_eye));
  }

  get auto(): boolean {
    return this.game.autopilot.enabled;
  }

  get signal(): AbortSignal {
    return this.session?.signal ?? this.game.director.signal;
  }

  wait(seconds: number): Promise<void> {
    return this.game.app.tasks.wait(seconds, this.signal);
  }

  until(predicate: (dt: number) => boolean): Promise<void> {
    return this.game.app.tasks.until(predicate, this.signal);
  }

  tween(seconds: number, onUpdate: (k: number) => void, easing: Ease = ease.inOutCubic): Promise<void> {
    return this.game.app.tasks.tween(seconds, onUpdate, easing, this.signal);
  }

  say(line: Line): Promise<void> {
    this.hush();
    return this.game.director.say(line, this.signal);
  }

  async talk(lines: readonly Line[]): Promise<void> {
    for (const line of lines) await this.say(line);
    this.game.hud.setSubtitle(null);
  }

  bark(line: Line, hold = 1.7): void {
    this.hush();
    const stop = (this.barking = new AbortController());
    const session = this.signal;
    const end = (): void => stop.abort();
    session.addEventListener('abort', end, { once: true });
    const { audio, app } = this.game;
    const person = app.world?.cast[line.who], speaker = SPEAKERS[line.who];
    if (person) {
      if (line.mood) person.setMood(line.mood);
      if (line.gesture) person.play(line.gesture);
      person.setTalking(1);
    }
    const el = (this.barkEl ??= this.ui.add(760 + PAD * 2, 42 + PAD * 2, paintBark(() => this.barkLine)).at(0, 1, 0, -98));
    this.barkLine = { name: speaker.name, color: speaker.color, text: '' };
    el.repaint();
    el.show();
    const speech = audio.voice(line, this.game.speed);
    const finish = (): void => {
      speech?.stop();
      person?.setTalking(0);
      el.show(false);
      this.barking = null;
      session.removeEventListener('abort', end);
    };
    stop.signal.addEventListener('abort', finish, { once: true });
    let shown = 0, held = 0;
    const total = line.text.length;
    app.tasks.until((dt) => {
      shown = Math.min(total, shown + dt * TYPE_SPEED);
      if (this.barkLine.text.length !== Math.floor(shown)) {
        this.barkLine.text = line.text.slice(0, Math.floor(shown));
        el.repaint();
      }
      if (shown < total) return false;
      if (!speech || speech.done) person?.setTalking(0);
      return (held += dt) > hold && (!speech || speech.done);
    }, stop.signal).then(() => stop.abort(), () => undefined);
  }

  hitStop(seconds: number): void {
    const world = this.active;
    if (!world || this.held || world.timeScale !== 1) return;
    this.held = true;
    world.timeScale = 0.04;
    this.game.app.tasks.wait(seconds).then(() => {
      if (this.held && this.active === world) world.timeScale = 1;
      this.held = false;
    }, () => (this.held = false));
  }

  hush(): void {
    this.barking?.abort();
  }

  hint(text: string | { mouse: string; touch: string; xr: string } | null): void {
    const words = text === null ? '' : typeof text === 'string' ? text : text[this.game.input.mode];
    if (!this.hintEl) this.hintEl = this.ui.add(520 + PAD * 2, 42 + PAD * 2, paintHint(() => this.hintText)).at(0, -1, 0, 96);
    if (words && words !== this.hintText) {
      this.hintText = words;
      this.hintEl.repaint();
    }
    this.hintEl.show(words !== '');
  }

  choose(title: string, options: readonly { title: string; detail?: string }[]): Promise<number> {
    this.hush();
    return this.game.hud.choose(title, [...options], this.signal).then((index) => {
      this.game.audio.sfx('uiSelect');
      this.game.input.flush();
      return index;
    });
  }

  private fade(to: number, seconds: number, signal: AbortSignal): Promise<void> {
    const fx = this.game.app.fx, from = fx.fade;
    return this.game.app.tasks.tween(seconds, (k) => (fx.fade = from + (to - from) * k), ease.inOutQuad, signal);
  }

  private load(id: MinigameId, info: MinigameInfo): Promise<Minigame> {
    let pending = this.built.get(id);
    if (!pending) {
      const game = this.game;
      pending = (async () => {
        if (!info.load) throw new Error(`the game "${id}" is not built yet`);
        game.onLoading?.(info.title);
        const before = game.assets.loaded;
        game.assets.onProgress = (loaded) => game.onLoading?.(info.title, loaded - before);
        try {
          const world = await info.load();
          world.arcade = this;
          world.level = this.startLevel;
          await world.build(game.context());
          await game.app.renderer.compileAsync(world.scene, game.app.camera);
          return world;
        } finally {
          game.assets.onProgress = null;
          game.onLoading?.(null);
        }
      })();
      this.built.set(id, pending);
      pending.catch(() => this.built.delete(id));
    }
    return pending;
  }

  prepare(id: MinigameId): Promise<Minigame> {
    return this.load(id, MINIGAMES[id]);
  }

  async play(id: MinigameId, back: Anchor, scape: Soundscape, opts: { once?: boolean } = {}): Promise<'done' | 'interrupted'> {
    const game = this.game, { director: d, app, player, hud, input, audio, interaction, hands } = game;
    const info = MINIGAMES[id];
    const from = app.world;
    if (!from) throw new Error('there is no world to come back to');

    interaction.enabled = false;
    hud.setPrompt(null);
    hud.setReticleVisible(false);
    player.canMove = player.canLook = false;
    audio.sfx('portalEnter');
    app.fx.kick = 1;
    app.fx.flash = Math.max(app.fx.flash, 0.5);
    await d.fadeOut(0.55, info.color);
    this.last = null;
    const world = await this.load(id, info);
    if (d.signal.aborted) throw new Cancelled();

    hands.pose('away');
    input.freePointer();
    input.sticks = false;
    game.setWorld(world);
    player.teleport(world.seat, world.eyeHeight);
    hud.setControlsTip(false);
    this.active = world;
    audio.setSoundscape(world.soundscape, 1.2);
    let cut = false;
    try {
      for (let again = true; again; ) {
        again = false;
        this.restartWanted = false;
        const session = (this.session = new AbortController());
        const end = (): void => session.abort();
        d.signal.addEventListener('abort', end, { once: true });
        try {
          world.reset();
          world.timeScale = 1;
          world.cam.cut();
          this.fade(0, 0.9, session.signal).catch(() => undefined);
          const outcome = await world.play();
          if ((world as { interrupted?: boolean }).interrupted) {
            this.last = null;
            cut = true;
            continue;
          }
          this.last = outcome;
          this.plays[id] = (this.plays[id] ?? 0) + 1;
          this.record(id, outcome);
          again = await this.finish(outcome, opts.once === true);
        } catch (e) {
          if (!isCancelled(e) || d.signal.aborted) throw e;
          again = this.restartWanted;
        } finally {
          d.signal.removeEventListener('abort', end);
          this.session = null;
          this.endSession();
        }
        if (again) await d.fadeOut(0.35, info.color);
      }
      if (!cut) {
        audio.sfx('portalExit');
        await d.fadeOut(0.45, info.color);
      }
    } finally {
      this.reset();
    }
    if (cut) {
      hud.setReticleVisible(true);
      hud.setControlsTip(true);
      player.canLook = true;
      interaction.enabled = true;
      input.flush();
      input.capturePointer();
      return 'interrupted';
    }
    game.setWorld(from);
    player.teleport(back);
    hands.pose('rest');
    hud.setReticleVisible(true);
    hud.setControlsTip(true);
    player.canMove = player.canLook = true;
    interaction.enabled = true;
    input.flush();
    input.capturePointer();
    audio.setSoundscape(scape, 1.2);
    app.fx.kick = 0.6;
    await d.fadeIn(0.9);
    return 'done';
  }

  restart(): void {
    if (!this.session) return;
    this.restartWanted = true;
    this.session.abort();
  }

  leave(): void {
    this.restartWanted = false;
    this.session?.abort();
  }

  private endSession(): void {
    this.hush();
    this.ui.clear();
    this.hintEl = this.barkEl = null;
    this.game.hud.clear();
    this.held = false;
    if (this.active) this.active.timeScale = 1;
  }

  reset(): void {
    this.endSession();
    this.active?.reset();
    this.active = null;
    this.game.input.sticks = true;
    this.game.app.zoom = 0;
  }

  private record(id: MinigameId, outcome: Outcome): void {
    if (outcome.stars <= this.stars[id]) return;
    this.stars[id] = outcome.stars;
    this.onStars?.(id, outcome.stars);
    try {
      localStorage.setItem(STORE, JSON.stringify(this.stars));
    } catch {
    }
  }

  private async finish(outcome: Outcome, once = false): Promise<boolean> {
    const { audio } = this.game;
    let reveal = 0, pick: boolean | null = null;
    const card = this.ui.add(560 + PAD * 2, 250 + PAD * 2, paintResult({ heading: outcome.won ? 'You won!' : 'So close', summary: outcome.summary, stars: outcome.stars, reveal: () => reveal })).at(0, 0, 0, 78).show();
    const again = this.ui.add(250 + PAD * 2, 56 + PAD * 2, paintButton('Play again', { primary: true, hint: '1' })).at(0, 0, -135, -112);
    const leave = this.ui.add(250 + PAD * 2, 56 + PAD * 2, paintButton(once ? 'Continue' : 'Back to Haven', { primary: once, hint: once ? '1' : '2' })).at(0, 0, once ? 0 : 135, -112);
    again.key = 'choice1';
    leave.key = once ? 'choice1' : 'choice2';
    again.onClick = () => (pick = true);
    leave.onClick = () => (pick = false);
    audio.sfx(outcome.won ? 'arcadeWin' : 'arcadeLose');
    let landed = 0;
    await this.wait(0.5);
    await this.tween(0.45 * Math.max(1, outcome.stars), (k) => {
      reveal = k;
      card.repaint();
      while (landed < outcome.stars && k * 3 >= landed + 0.5) audio.sfx('arcadeStar', { pitch: 1 + 0.12 * landed++ });
    }, ease.linear);
    if (!once) again.show();
    leave.show();
    if (this.auto) this.wait(1.2).then(() => (pick ??= false), () => undefined);
    await this.until(() => pick !== null);
    return pick === true;
  }
}
