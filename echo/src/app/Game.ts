import * as THREE from 'three';
import { NullAudio, type GameAudio } from '../audio/GameAudio';
import { isCancelled } from '../core/tasks';
import { StarBridgeGame } from '../game/StarBridgeGame';
import { Input } from '../input/Input';
import { XRRig } from '../input/XRRig';
import { Hands } from '../player/Hands';
import { Interaction } from '../player/Interaction';
import { Player } from '../player/Player';
import { Director } from '../story/Director';
import { CHAPTER_RUNNERS } from '../story/chapters';
import type { Policy } from '../story/script';
import { CHAPTERS, freshState, saveProgress, type ChapterId, type StoryState } from '../story/state';
import { Hud } from '../ui/Hud';
import type { BuildContext, World } from '../world/World';
import { BedroomWorld } from '../world/bedroom/BedroomWorld';
import { ClassroomWorld } from '../world/classroom/ClassroomWorld';
import { HavenWorld } from '../world/haven/HavenWorld';
import { buildHeadset, type HeadsetProp } from '../world/props';
import { App, type AppOptions } from './App';

export type WorldId = 'classroom' | 'bedroom' | 'haven';

/** Decisions a scripted playthrough makes, so every branch can be tested without a person. */
export interface AutopilotPlan {
  tuesday: 'meet' | 'haven';
  thursday: 'help' | 'haven';
  policy: Policy;
  /** Number of orbs to waste before each hit, to exercise the miss path. */
  misses: number;
}

export class Autopilot {
  enabled = false;
  plan: AutopilotPlan = { tuesday: 'meet', thursday: 'help', policy: 'combined', misses: 0 };

  /** Picks the option the plan calls for, by the question being asked. */
  choose(title: string, count: number): Promise<number> {
    const t = title.toLowerCase();
    let index = 0;
    if (t.includes('afternoon')) index = this.plan.tuesday === 'meet' ? 0 : 1;
    else if (t.includes('what will you do')) index = this.plan.thursday === 'help' ? 0 : 1;
    else if (t.includes('recommendation')) index = ['expand', 'combined', 'investigate'].indexOf(this.plan.policy);
    return Promise.resolve(Math.min(Math.max(index, 0), count - 1));
  }
}

/**
 * The whole game: engine, player, interface, the worlds and the story that runs through them. Systems update
 * in a fixed order each frame; the story itself is the Director's async chapters riding the same clock.
 */
export class Game {
  readonly app: App;
  readonly input: Input;
  readonly player: Player;
  readonly hands: Hands;
  readonly hud: Hud;
  readonly interaction: Interaction;
  readonly director: Director;
  readonly autopilot = new Autopilot();
  readonly headset: HeadsetProp = buildHeadset();
  /** The headset session, when the device has one. */
  readonly xr: XRRig;
  /** Where characters look when they look at the player. */
  readonly playerEye = new THREE.Vector3();
  readonly worlds: Partial<Record<WorldId, World>> = {};
  state: StoryState = freshState();
  chapter: ChapterId | null = null;
  /** In the story (not at the title, not paused): the mouse belongs to the game. */
  playing = false;
  /** Steps of game time per displayed frame; tests run the week at many times real speed. */
  speed = 1;
  /** The last story beat reached, for tests and captures. */
  beat = '';
  /** Called whenever the story reaches a named beat. */
  onBeat: ((name: string) => void) | null = null;
  /** Called when a chapter begins and when the week ends. */
  onChapter: ((chapter: ChapterId | 'end') => void) | null = null;
  star: StarBridgeGame | null = null;
  /** Shown while a world is being built mid-game. */
  onLoading: ((label: string | null) => void) | null = null;

  private readonly factories: Record<WorldId, () => World> = { classroom: () => new ClassroomWorld(), bedroom: () => new BedroomWorld(), haven: () => new HavenWorld() };
  private readonly building = new Map<WorldId, Promise<World>>();

  /** Without an `audio` the game runs silent, which is what captures and unit tests want. */
  constructor(options: AppOptions, readonly audio: GameAudio = new NullAudio()) {
    const app = (this.app = new App(options));
    this.input = new Input(options.canvas);
    this.hud = new Hud(this.input);
    this.player = new Player(app, this.input);
    this.hands = new Hands(app, this.input, this.player);
    this.interaction = new Interaction(app, this.input, this.hud);
    this.director = new Director(this);
    app.overlay = { scene: this.hud.scene, camera: this.hud.camera };
    app.onResize = (w, h, dpr) => this.hud.resize(w, h, dpr);
    this.headset.setPower(0);

    // order matters: decide what was used, play the orb game, move the body, then dress the frame
    app.systems.push(
      { update: () => this.interaction.update() },
      { update: (dt, t) => this.star?.update(dt, t) },
      { update: (dt) => this.player.update(dt) },
      { update: () => this.player.eyePosition(this.playerEye) },
      { update: (dt) => this.hands.update(dt) },
      { update: (dt) => this.hud.update(dt) },
      { update: (dt) => this.audio.update(dt, app.camera) },
      { update: () => this.input.endFrame() },
    );
    this.xr = new XRRig(this);
    // controllers are polled, not delivered as events: read them before the story runs, or it never sees a button
    app.senses.push({ update: (dt) => this.xr.update(dt) }, { update: () => this.input.beginFrame() });
    // every gesture, not only the first: a browser may leave sound suspended until a later one
    this.input.onGesture.on(() => this.audio.unlock());
    this.hud.onHover.on(() => this.audio.sfx('uiHover'));
    this.player.onStep.on((speed) => this.audio.sfx('footstep', { gain: 0.35 + 0.4 * speed }));
  }

  /** Adds a per-frame system that runs after the built-in ones but before the frame's input is cleared. */
  addSystem(update: (dt: number, time: number) => void): void {
    this.app.systems.splice(this.app.systems.length - 1, 0, { update });
  }

  private context(): BuildContext {
    return { renderer: this.app.renderer, quality: this.app.quality, step: () => new Promise((r) => setTimeout(r, 0)) };
  }

  /** Returns a world, building it first if this is its first visit. */
  ensureWorld(id: WorldId): Promise<World> {
    const ready = this.worlds[id];
    if (ready) return Promise.resolve(ready);
    let pending = this.building.get(id);
    if (!pending) {
      pending = (async () => {
        this.onLoading?.(id);
        const world = this.factories[id]();
        await world.build(this.context());
        await this.app.renderer.compileAsync(world.scene, this.app.camera);
        this.worlds[id] = world;
        if (world instanceof HavenWorld) {
          this.star = new StarBridgeGame(this.app, this.input, this.player, this.hands, this.interaction, world.bursts, world.scene);
          world.onFirework = (at) => this.audio.sfx('firework', { at });
        }
        this.onLoading?.(null);
        return world;
      })();
      this.building.set(id, pending);
    }
    return pending;
  }

  /** Makes a world the current one and dresses the interface and the player's hands for it. */
  setWorld(world: World): void {
    this.interaction.clear();
    if (this.star) this.interaction.add(this.star.pedestalItem);
    this.app.setWorld(world);
    this.hud.setTheme(world.theme);
    this.hands.setStyle(world.theme === 'haven' ? 'haven' : 'real');
  }

  /** Marks a named point in the story. */
  reach(name: string): void {
    this.beat = name;
    this.onBeat?.(name);
  }

  /**
   * Stops the story and clears away what it had on stage: the camera's lean, the interface, a round of the orb
   * game, props the worlds had out. Restarting a day or leaving for the title must not carry any of it along.
   */
  clearStage(): void {
    this.director.abort();
    const app = this.app;
    app.zoom = app.fovKick = 0;
    app.lookOverride = null;
    Object.assign(app.fx, { dim: 0, flash: 0, kick: 0 });
    this.hud.clear();
    this.star?.end();
    this.audio.setCharge(0);
    this.player.stand();
    for (const world of Object.values(this.worlds)) world.reset();
  }

  /** Plays the week from `from` to its end. Resolves when the story finishes or is aborted. */
  async run(from: ChapterId, state: StoryState = freshState()): Promise<void> {
    this.clearStage();
    this.state = state;
    this.playing = true;
    try {
      for (const id of CHAPTERS.slice(CHAPTERS.indexOf(from))) {
        this.chapter = id;
        saveProgress(id, this.state);
        this.onChapter?.(id);
        await CHAPTER_RUNNERS[id](this);
      }
      this.onChapter?.('end');
    } catch (e) {
      if (!isCancelled(e)) throw e;
    }
  }

  /** Starts the frame loop. */
  start(): void {
    const app = this.app;
    let last = 0;
    app.renderer.setAnimationLoop((now: number) => {
      const elapsed = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60;
      last = now;
      if (this.speed > 1) for (let i = 0; i < this.speed; i++) app.step(1 / 60);
      else app.step(elapsed);
      app.render();
      app.sampleFrame(elapsed * 1000);
    });
  }
}
