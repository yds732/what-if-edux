import * as THREE from 'three';
import { Arcade } from '../arcade/Arcade';
import { runHub } from '../arcade/hub';
import type { MinigameId } from '../arcade/registry';
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
import { AssetLibrary } from '../assets/AssetLibrary';
import { App, type AppOptions } from './App';

export type WorldId = 'classroom' | 'bedroom' | 'haven';

export interface AutopilotPlan {
  tuesday: 'meet' | 'haven';
  thursday: 'help' | 'haven';
  policy: Policy;
  misses: number;
}

export class Autopilot {
  enabled = false;
  plan: AutopilotPlan = { tuesday: 'meet', thursday: 'help', policy: 'combined', misses: 0 };

  choose(title: string, count: number): Promise<number> {
    const t = title.toLowerCase();
    let index = 0;
    if (t.includes('afternoon')) index = this.plan.tuesday === 'meet' ? 0 : 1;
    else if (t.includes('what will you do')) index = this.plan.thursday === 'help' ? 0 : 1;
    else if (t.includes('recommendation')) index = ['expand', 'combined', 'investigate'].indexOf(this.plan.policy);
    return Promise.resolve(Math.min(Math.max(index, 0), count - 1));
  }
}

export class Game {
  readonly app: App;
  readonly input: Input;
  readonly player: Player;
  readonly hands: Hands;
  readonly hud: Hud;
  readonly interaction: Interaction;
  readonly director: Director;
  readonly arcade: Arcade;
  readonly autopilot = new Autopilot();
  readonly headset: HeadsetProp;
  readonly xr: XRRig;
  readonly playerEye = new THREE.Vector3();
  readonly worlds: Partial<Record<WorldId, World>> = {};
  readonly assets: AssetLibrary;
  state: StoryState = freshState();
  chapter: ChapterId | null = null;
  playing = false;
  speed = 1;
  beat = '';
  onBeat: ((name: string) => void) | null = null;
  onChapter: ((chapter: ChapterId | 'end') => void) | null = null;
  star: StarBridgeGame | null = null;
  onLoading: ((label: string | null, bytes?: number) => void) | null = null;

  private readonly factories: Record<WorldId, () => World> = { classroom: () => new ClassroomWorld(), bedroom: () => new BedroomWorld(), haven: () => new HavenWorld() };
  private readonly building = new Map<WorldId, Promise<World>>();

  constructor(options: AppOptions, readonly audio: GameAudio = new NullAudio()) {
    const app = (this.app = new App(options));
    this.assets = new AssetLibrary(app.quality);
    this.headset = buildHeadset(this.assets);
    this.input = new Input(options.canvas);
    this.hud = new Hud(this.input);
    this.player = new Player(app, this.input);
    this.hands = new Hands(app, this.input, this.player, this.assets);
    this.interaction = new Interaction(app, this.input, this.hud);
    this.director = new Director(this);
    app.overlay = { scene: this.hud.scene, camera: this.hud.camera };
    app.onResize = (w, h, dpr) => this.hud.resize(w, h, dpr);
    this.headset.setPower(0);

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
    this.arcade = new Arcade(this);
    this.xr = new XRRig(this);
    app.senses.push({ update: (dt) => this.xr.update(dt) }, { update: () => this.input.beginFrame() });
    this.input.onGesture.on(() => this.audio.unlock());
    this.hud.onHover.on(() => this.audio.sfx('uiHover'));
    this.player.onStep.on((speed) => this.audio.sfx('footstep', { gain: 0.175 + 0.2 * speed }));
  }

  addSystem(update: (dt: number, time: number) => void): void {
    this.app.systems.splice(this.app.systems.length - 1, 0, { update });
  }

  context(): BuildContext {
    return { renderer: this.app.renderer, quality: this.app.quality, assets: this.assets, step: () => new Promise((r) => setTimeout(r, 0)) };
  }

  ensureWorld(id: WorldId): Promise<World> {
    const ready = this.worlds[id];
    if (ready) return Promise.resolve(ready);
    let pending = this.building.get(id);
    if (!pending) {
      pending = (async () => {
        this.onLoading?.(id);
        const before = this.assets.loaded;
        this.assets.onProgress = (loaded) => this.onLoading?.(id, loaded - before);
        const world = this.factories[id]();
        await Promise.all([world.build(this.context()), this.hands.ready, this.headset.ready]);
        await this.app.renderer.compileAsync(world.scene, this.app.camera);
        this.worlds[id] = world;
        if (world instanceof HavenWorld) {
          this.star = new StarBridgeGame(this.app, this.input, this.player, this.hands, this.interaction, world.bursts, world.scene);
          world.onFirework = (at) => this.audio.sfx('firework', { at });
        }
        this.assets.onProgress = null;
        this.onLoading?.(null);
        return world;
      })();
      this.building.set(id, pending);
    }
    return pending;
  }

  setWorld(world: World): void {
    this.interaction.clear();
    if (this.star) this.interaction.add(this.star.pedestalItem);
    this.app.setWorld(world);
    this.hud.setTheme(world.theme);
    this.hands.setStyle(world.theme === 'haven' ? 'haven' : 'real');
  }

  reach(name: string): void {
    this.beat = name;
    this.onBeat?.(name);
  }

  clearStage(): void {
    this.director.abort();
    this.arcade.reset();
    const app = this.app;
    app.zoom = app.fovKick = 0;
    app.lookOverride = null;
    app.focus = null;
    Object.assign(app.fx, { dim: 0, flash: 0, kick: 0 });
    this.hud.clear();
    this.star?.end();
    this.audio.setCharge(0);
    this.player.stand();
    for (const world of Object.values(this.worlds)) world.reset();
  }

  async run(from: ChapterId, state: StoryState = freshState()): Promise<void> {
    this.clearStage();
    this.state = state;
    this.playing = true;
    this.hud.setControlsTip(true);
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

  async runArcade(first: MinigameId | null = null): Promise<void> {
    this.clearStage();
    this.chapter = null;
    this.playing = true;
    this.hud.setControlsTip(true);
    try {
      await runHub(this, first);
    } catch (e) {
      if (!isCancelled(e)) throw e;
    }
  }

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
