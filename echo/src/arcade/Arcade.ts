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
/** Characters per second of a line typing out: the story's own pace. */
const TYPE_SPEED = 46;
const _eye = new THREE.Vector3();

/** The most stars each game has been won with, kept between visits. */
const loadStars = (): Record<MinigameId, number> => {
  const stars = Object.fromEntries(MINIGAME_IDS.map((id) => [id, 0])) as Record<MinigameId, number>;
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<Record<MinigameId, number>>;
    for (const id of MINIGAME_IDS) stars[id] = Math.max(0, Math.min(3, Math.round(Number(saved[id]) || 0)));
  } catch {
    // storage can be unavailable (private mode, embedded frames): the portals simply start unlit
  }
  return stars;
};

/**
 * The arcade: what takes the player through a portal, runs the game on the other side and brings them back.
 *
 * A game is a world of its own (see `Minigame`). While one is open the first-person body stands still and the
 * arcade drives the camera, hands the game a pointer and a place for its interface, and gives it the verbs its
 * session waits on. Those wait on the game clock and end with the session, so restarting, leaving the game or
 * leaving the arcade altogether unwinds cleanly from any point.
 */
export class Arcade {
  /** The game being played, if one is. */
  active: Minigame | null = null;
  readonly pointer = new Pointer();
  readonly ui: UiLayer;
  readonly stars = loadStars();
  /** A game has been won with more stars than before: the isle lights them on its portal. */
  onStars: ((id: MinigameId, stars: number) => void) | null = null;
  /** How the last visit through a portal ended: null if the player left before the end. */
  last: Outcome | null = null;
  /** Sessions finished in each game since the page was opened. */
  readonly plays: Partial<Record<MinigameId, number>> = {};
  /**
   * For tests: with the game's autopilot on, each game plays itself, as well as `autoSkill` says (1 plays to win,
   * 0 does nothing useful), so that both endings can be reached without a person.
   */
  autoSkill = 1;
  /** For tests and captures: the stage each game starts at, where it has that many (0 is the first). */
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

  // ------------------------------------------------------------------------------------------------ the frame

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
    // whoever looks at the player looks at the camera, wherever the game has put it
    this.game.playerEye.copy(app.camera.getWorldPosition(_eye));
  }

  /** A scripted player is at the controls: games play themselves. */
  get auto(): boolean {
    return this.game.autopilot.enabled;
  }

  // ------------------------------------------------------------------------------------------------ what a session waits on

  /** Ends when the session does: the player restarts or leaves the game, or leaves the arcade. */
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

  /** A line the game stops for: it types out, and waits to be read or clicked past. */
  say(line: Line): Promise<void> {
    this.hush();
    return this.game.director.say(line, this.signal);
  }

  async talk(lines: readonly Line[]): Promise<void> {
    for (const line of lines) await this.say(line);
    this.game.hud.setSubtitle(null);
  }

  /**
   * A line spoken over the game without stopping it: it types out, stays `hold` seconds, and goes. A newer one
   * replaces it. It is shown as one slim line near the top of the picture, not in the story's subtitle box, which
   * would lie across whatever is being played.
   */
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
    let shown = 0, voiced = 0, held = 0;
    const total = line.text.length;
    app.tasks.until((dt) => {
      shown = Math.min(total, shown + dt * TYPE_SPEED);
      while (voiced < Math.floor(shown)) {
        const ch = line.text[voiced] ?? ' ';
        if (voiced % 3 === 0 && /[a-z0-9]/i.test(ch)) audio.voice(line.who, ch);
        voiced++;
      }
      if (this.barkLine.text.length !== Math.floor(shown)) {
        this.barkLine.text = line.text.slice(0, Math.floor(shown));
        el.repaint();
      }
      if (shown < total) return false;
      person?.setTalking(0);
      return (held += dt) > hold;
    }, stop.signal).then(() => el.show(false), () => undefined).finally(() => {
      person?.setTalking(0);
      session.removeEventListener('abort', end);
    });
  }

  /**
   * A beat of stillness on a heavy blow: the game all but stops for `seconds` (a twentieth of one is plenty) and
   * then goes on. The picture and the sound carry on through it, which is what makes the blow land.
   */
  hitStop(seconds: number): void {
    const world = this.active;
    // (not on top of another, nor of a game's own slow motion)
    if (!world || this.held || world.timeScale !== 1) return;
    this.held = true;
    world.timeScale = 0.04;
    this.game.app.tasks.wait(seconds).then(() => {
      if (this.held && this.active === world) world.timeScale = 1;
      this.held = false;
    }, () => (this.held = false));
  }

  /** Stops whatever is being said over the game. */
  hush(): void {
    if (!this.barking) return;
    this.barking.abort();
    this.barking = null;
    this.barkEl?.show(false);
  }

  /**
   * One line at the foot of the screen saying what to do now ("Click to serve"); null takes it away. Give the words
   * for each way of playing and the right ones are shown.
   */
  hint(text: string | { mouse: string; touch: string; xr: string } | null): void {
    const words = text === null ? '' : typeof text === 'string' ? text : text[this.game.input.mode];
    if (!this.hintEl) this.hintEl = this.ui.add(520 + PAD * 2, 42 + PAD * 2, paintHint(() => this.hintText)).at(0, -1, 0, 96);
    if (words && words !== this.hintText) {
      this.hintText = words;
      this.hintEl.repaint();
    }
    this.hintEl.show(words !== '');
  }

  /** Shows a decision on the HUD's cards and resolves with the one picked. */
  choose(title: string, options: readonly { title: string; detail?: string }[]): Promise<number> {
    this.hush();
    return this.game.hud.choose(title, [...options], this.signal).then((index) => {
      this.game.audio.sfx('uiSelect');
      // the click that picked a card belongs to the card
      this.game.input.flush();
      return index;
    });
  }

  private fade(to: number, seconds: number, signal: AbortSignal): Promise<void> {
    const fx = this.game.app.fx, from = fx.fade;
    return this.game.app.tasks.tween(seconds, (k) => (fx.fade = from + (to - from) * k), ease.inOutQuad, signal);
  }

  // ------------------------------------------------------------------------------------------------ in and out

  /** Fetches a game's code and builds its world: once, however often its portal is entered. */
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
      // a fetch that failed may be tried again
      pending.catch(() => this.built.delete(id));
    }
    return pending;
  }

  /**
   * Takes the player through a portal, plays the game for as long as they want another go, and puts them back at
   * `back` in the world they came from, to `scape`. Rejects with Cancelled if the arcade itself is left meanwhile.
   */
  async play(id: MinigameId, back: Anchor, scape: Soundscape): Promise<void> {
    const game = this.game, { director: d, app, player, hud, input, audio, interaction, hands } = game;
    const info = MINIGAMES[id];
    const from = app.world;
    if (!from) throw new Error('there is no world to come back to');

    // ---- through the portal: the picture is pulled in and goes to the portal's own light ----
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
    // the arcade was left while the game was still arriving
    if (d.signal.aborted) throw new Cancelled();

    hands.pose('away');
    input.freePointer();
    input.sticks = false;
    game.setWorld(world);
    player.teleport(world.seat, world.eyeHeight);
    hud.setControlsTip(false);
    this.active = world;
    audio.setSoundscape(world.soundscape, 1.2);
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
          this.last = outcome;
          this.plays[id] = (this.plays[id] ?? 0) + 1;
          this.record(id, outcome);
          again = await this.finish(outcome);
        } catch (e) {
          // leaving the arcade unwinds all the way; restarting or leaving this game stops here
          if (!isCancelled(e) || d.signal.aborted) throw e;
          again = this.restartWanted;
        } finally {
          d.signal.removeEventListener('abort', end);
          this.session = null;
          this.endSession();
        }
        if (again) await d.fadeOut(0.35, info.color);
      }
      // ---- and back out: the game keeps the camera until the picture has gone to light ----
      audio.sfx('portalExit');
      await d.fadeOut(0.45, info.color);
    } finally {
      this.reset();
    }
    game.setWorld(from);
    player.teleport(back);
    hands.pose('rest');
    hud.setReticleVisible(true);
    hud.setControlsTip(true);
    player.canMove = player.canLook = true;
    interaction.enabled = true;
    input.flush();
    // the mouse is the player's head again; a browser that will not hand it over outside a click does so on the next one
    input.capturePointer();
    audio.setSoundscape(scape, 1.2);
    app.fx.kick = 0.6;
    await d.fadeIn(0.9);
  }

  /** The pause menu's "Restart": the game in progress begins again. */
  restart(): void {
    if (!this.session) return;
    this.restartWanted = true;
    this.session.abort();
  }

  /** The pause menu's "Leave game": back out through the portal. */
  leave(): void {
    this.restartWanted = false;
    this.session?.abort();
  }

  /** Takes down what a session had up: its interface, its talk, its slow motion. */
  private endSession(): void {
    this.hush();
    this.ui.clear();
    this.hintEl = this.barkEl = null;
    this.game.hud.clear();
    this.held = false;
    if (this.active) this.active.timeScale = 1;
  }

  /**
   * Gives the game back everything the arcade took over. Safe to call at any time: when the stage is cleared
   * (a return to the title) as well as on the way out of a portal.
   */
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
      // see loadStars
    }
  }

  /** The card that ends a session. Resolves true for another go. */
  private async finish(outcome: Outcome): Promise<boolean> {
    const { audio } = this.game;
    let reveal = 0, pick: boolean | null = null;
    const card = this.ui.add(560 + PAD * 2, 250 + PAD * 2, paintResult({ heading: outcome.won ? 'You won!' : 'So close', summary: outcome.summary, stars: outcome.stars, reveal: () => reveal })).at(0, 0, 0, 78).show();
    const again = this.ui.add(250 + PAD * 2, 56 + PAD * 2, paintButton('Play again', { primary: true, hint: '1' })).at(0, 0, -135, -112);
    const leave = this.ui.add(250 + PAD * 2, 56 + PAD * 2, paintButton('Back to Haven', { hint: '2' })).at(0, 0, 135, -112);
    again.key = 'choice1';
    leave.key = 'choice2';
    again.onClick = () => (pick = true);
    leave.onClick = () => (pick = false);
    audio.sfx(outcome.won ? 'arcadeWin' : 'arcadeLose');
    // the stars land one after another, each with its own note
    let landed = 0;
    await this.wait(0.5);
    await this.tween(0.45 * Math.max(1, outcome.stars), (k) => {
      reveal = k;
      card.repaint();
      while (landed < outcome.stars && k * 3 >= landed + 0.5) audio.sfx('arcadeStar', { pitch: 1 + 0.12 * landed++ });
    }, ease.linear);
    again.show();
    leave.show();
    // a scripted player has seen enough, and goes back out
    if (this.auto) this.wait(1.2).then(() => (pick ??= false), () => undefined);
    await this.until(() => pick !== null);
    return pick === true;
  }
}
