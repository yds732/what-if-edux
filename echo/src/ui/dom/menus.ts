import './menus.css';
import type { Game } from '../../app/Game';
import { TIERS } from '../../app/quality';
import { SKIN_TONES, saveSettings, tierFor, type Settings } from '../../app/settings';
import { FRIDAY, THURSDAY, TUESDAY } from '../../story/script';
import { CHAPTERS, clearProgress, freshState, loadProgress, type ChapterId, type StoryState } from '../../story/state';
import { XRRig } from '../../input/XRRig';
import type { Character } from '../../characters/Character';
import { cameraYaw } from '../../world/World';
import { HAVEN, type HavenWorld } from '../../world/haven/HavenWorld';

/** Two framings of Haven behind the title: words on the left of a wide screen, or above and below the bridge on a tall one. */
const TITLE_VIEWS = {
  wide: { at: HAVEN.titleWide, pitch: 0.105, lumi: HAVEN.lumiTitle },
  tall: { at: HAVEN.titleTall, pitch: 0.16, lumi: HAVEN.lumi },
} as const;
type TitleView = keyof typeof TITLE_VIEWS;

/** What the title screen keeps while it is open. */
interface TitleScene {
  haven: HavenWorld;
  lumi: Character;
  view: TitleView | null;
  nextWave: number;
}

const DAY_BLURBS: Record<ChapterId, string> = {
  monday: 'The Echo pilot. You volunteer, and see Haven for the first time.',
  tuesday: 'The Star Bridge, and a message from a classmate.',
  wednesday: 'A disagreement with Jamie. A companion who agrees with everyone.',
  thursday: 'The Starlight Festival and a rehearsal, on the same evening.',
  friday: 'Other voices, one vote, and a possible future.',
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const button = (label: string, className: string, onClick: () => void): HTMLButtonElement => {
  const b = el('button', `btn ${className}`.trim(), label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
};

/** Title, pause, settings, chapter select and the end-of-week summary: ordinary DOM, laid over the canvas. */
class Menus {
  private readonly root = document.getElementById('ui') as HTMLElement;
  private current: HTMLElement | null = null;
  private readonly loading = el('div', 'loading');
  private title: TitleScene | null = null;
  private paused = false;
  private xrSupported = false;

  /** `tierPinned`: the address bar named a graphics tier, which holds for this page whatever the settings say. */
  constructor(private readonly game: Game, private readonly settings: Settings, private readonly tierPinned: boolean) {
    this.loading.style.opacity = '0';
    this.root.append(this.loading);
    void XRRig.supported().then((ok) => {
      this.xrSupported = ok;
      if (ok && this.title) void this.showTitle();
    });
    // taking the headset off mid-story pauses the game on the flat screen
    game.xr.onEnd.push(() => this.pause());
    this.applySettings();
    game.onLoading = (label) => {
      this.loading.innerHTML = label ? `Building ${label === 'haven' ? 'Haven' : `the ${label}`}<i></i>` : '';
      this.loading.style.opacity = label ? '1' : '0';
    };
    game.input.onLockLost.on(() => this.pause());
    game.addSystem(() => {
      if (game.input.pressed.has('pause')) this.pause();
      if (this.title) this.driftCamera(this.title);
    });
    const previous = game.onChapter;
    game.onChapter = (chapter) => {
      previous?.(chapter);
      if (chapter === 'end') this.showEnd();
    };
    addEventListener('visibilitychange', () => {
      if (document.hidden && game.playing) this.pause();
    });
    // the key that pauses also resumes (nothing in the game runs while paused, so this one is heard here)
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' && this.paused && !e.repeat) this.resume();
    });
    this.buildTouchOverlay();
  }

  private applySettings(): void {
    const { game, settings } = this;
    if (!this.tierPinned && tierFor(settings) !== game.app.quality.tier) game.app.setQuality(tierFor(settings));
    game.audio.setVolume(settings.volume);
    game.director.autoAdvance = settings.autoAdvance;
    game.input.sensitivity = settings.sensitivity;
    game.hands.setSkin(SKIN_TONES[settings.skin] ?? SKIN_TONES[1]);
    saveSettings(settings);
  }

  private show(menu: HTMLElement): void {
    this.close();
    this.current = menu;
    this.root.append(menu);
    requestAnimationFrame(() => menu.classList.add('show'));
  }

  private close(): void {
    const menu = this.current;
    if (!menu) return;
    this.current = null;
    menu.classList.remove('show');
    setTimeout(() => menu.remove(), 500);
  }

  // ------------------------------------------------------------------------------------------------ title

  async showTitle(): Promise<void> {
    const game = this.game;
    game.playing = false;
    game.clearStage();
    game.input.freePointer();
    game.app.paused = false;
    game.hud.setReticleVisible(false);
    game.app.fx.fade = 1;
    const haven = (await game.ensureWorld('haven')) as HavenWorld;
    game.setWorld(haven);
    haven.setVariant('title');
    game.hands.pose('away');
    game.player.canMove = game.player.canLook = false;
    game.interaction.enabled = false;
    game.audio.setSoundscape('title', 2);
    const lumi = haven.cast.lumi!;
    lumi.lookAtPoint(game.playerEye);
    this.title = { haven, lumi, view: null, nextWave: game.app.time + 2.6 };
    this.driftCamera(this.title);
    const boot = document.querySelector<HTMLElement>('.boot');
    if (boot) {
      boot.style.opacity = '0';
      setTimeout(() => boot.remove(), 900);
    }

    const menu = el('div', 'menu menu--title');
    const save = loadProgress();
    const buttons = el('div', 'buttons');
    buttons.append(button('Begin the week', 'btn--primary', () => this.begin('monday', freshState())));
    if (save && save.chapter !== 'monday') {
      buttons.append(button(`Continue · ${save.chapter[0]!.toUpperCase()}${save.chapter.slice(1)}`, '', () => this.begin(save.chapter, save.state)));
    }
    if (this.xrSupported) {
      buttons.append(button('Play in VR', '', () => {
        void this.game.xr.enter().then(() => this.begin('monday', freshState()), (e: unknown) => console.warn('Could not start VR:', e));
      }));
    }
    const row = el('div', 'buttons buttons--row');
    row.append(button('Chapters', 'btn--quiet', () => this.showChapters()), button('Settings', 'btn--quiet', () => this.showSettings(() => void this.showTitle())));
    const head = el('div', 'head'), actions = el('div', 'actions');
    head.append(el('h1', 'logo', 'ECHO'), el('p', 'logo-sub', 'Between Two Worlds'),
      el('p', 'tagline', 'A week in 2080 with an AI companion who always understands you, a classmate who does not always agree, and a vote that shapes your city.'));
    actions.append(buttons, row, el('p', 'fine', 'About 10 minutes · Sound on · Ages 11 to 14'));
    menu.append(head, actions);
    menu.classList.toggle('tall', this.title.view === 'tall');
    this.show(menu);
    // the picture comes up behind the title
    game.app.tasks.tween(2.2, (k) => (game.app.fx.fade = 1 - k)).catch(() => undefined);
    // build the first scene's world while the player reads the title
    void game.ensureWorld('classroom');
  }

  /** A slow drift of the title's camera, in whichever framing suits the screen's shape; Lumi waves now and then. */
  private driftCamera(title: TitleScene): void {
    const { player, app } = this.game;
    const name: TitleView = app.camera.aspect >= 1.15 ? 'wide' : 'tall';
    const view = TITLE_VIEWS[name];
    if (title.view !== name) {
      title.view = name;
      title.haven.stand(title.lumi, view.lumi);
      document.querySelector('.menu--title')?.classList.toggle('tall', name === 'tall');
    }
    const t = app.time * 0.045;
    player.position.set(view.at.position.x + Math.sin(t) * 0.45, 0, view.at.position.z + Math.cos(t * 0.8) * 0.4);
    player.eyeHeight = 1.5;
    player.yaw = cameraYaw(view.at) + Math.sin(t * 0.7) * 0.025;
    player.pitch = view.pitch + Math.sin(t * 0.5) * 0.012;
    if (app.time >= title.nextWave) {
      title.lumi.play('wave');
      title.nextWave = app.time + 11;
    }
  }

  private begin(chapter: ChapterId, state: StoryState): void {
    const game = this.game;
    this.title = null;
    this.close();
    game.audio.unlock();
    game.hud.setReticleVisible(true);
    game.interaction.enabled = true;
    game.player.canLook = true;
    game.hands.pose('rest');
    game.input.capturePointer();
    void game.run(chapter, state);
  }

  private showChapters(): void {
    const menu = el('div', 'menu menu--veil');
    const card = el('div', 'card');
    card.append(el('h2', '', 'Chapters'), el('p', 'lede', 'Start the week from any day.'));
    const days = el('div', 'days');
    for (const id of CHAPTERS) {
      const day = el('button', 'day');
      day.type = 'button';
      day.append(el('b', '', id), el('span', '', DAY_BLURBS[id]));
      day.addEventListener('click', () => this.begin(id, freshState()));
      days.append(day);
    }
    card.append(days, button('Back', 'btn--quiet', () => void this.showTitle()));
    menu.append(card);
    this.show(menu);
  }

  // ------------------------------------------------------------------------------------------------ settings

  private showSettings(back: () => void): void {
    const s = this.settings;
    const menu = el('div', 'menu menu--veil');
    const card = el('div', 'card');
    card.append(el('h2', '', 'Settings'));
    const row = (title: string, hint: string, control: HTMLElement): void => {
      const r = el('div', 'setting');
      const label = el('div', '', title);
      if (hint) label.append(el('small', '', hint));
      r.append(label, control);
      card.append(r);
    };
    const seg = <T extends string>(options: readonly T[], value: T, onPick: (v: T) => void): HTMLElement => {
      const group = el('div', 'seg');
      for (const o of options) {
        const b = el('button', '', o[0]!.toUpperCase() + o.slice(1));
        b.type = 'button';
        b.setAttribute('aria-pressed', String(o === value));
        b.addEventListener('click', () => {
          for (const other of Array.from(group.children)) other.setAttribute('aria-pressed', 'false');
          b.setAttribute('aria-pressed', 'true');
          onPick(o);
          this.applySettings();
        });
        group.append(b);
      }
      return group;
    };
    const range = (min: number, max: number, value: number, onInput: (v: number) => void): HTMLElement => {
      const input = el('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = '0.05';
      input.value = String(value);
      input.addEventListener('input', () => {
        onInput(Number(input.value));
        this.applySettings();
      });
      return input;
    };
    row('Graphics', 'Auto picks for this device and adapts as you play. A new level loads with the page.', seg(['auto', ...TIERS] as const, s.quality, (v) => {
      s.quality = v;
      // worlds are built for a level of detail: start over on it, unless a story is in progress
      if (!this.game.playing) {
        this.applySettings();
        location.reload();
      }
    }));
    row('Volume', '', range(0, 1, s.volume, (v) => (s.volume = v)));
    row('Dialogue', 'Lines move on by themselves after a reading pause.', seg(['auto', 'manual'] as const, s.autoAdvance ? 'auto' : 'manual', (v) => (s.autoAdvance = v === 'auto')));
    row('Look sensitivity', '', range(0.4, 2, s.sensitivity, (v) => (s.sensitivity = v)));
    const swatches = el('div', 'swatches');
    SKIN_TONES.forEach((tone, i) => {
      const b = el('button');
      b.type = 'button';
      b.style.background = `#${tone.toString(16).padStart(6, '0')}`;
      b.setAttribute('aria-label', `Hand tone ${i + 1}`);
      b.setAttribute('aria-pressed', String(i === s.skin));
      b.addEventListener('click', () => {
        for (const other of Array.from(swatches.children)) other.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', 'true');
        s.skin = i;
        this.applySettings();
      });
      swatches.append(b);
    });
    row('Your hands', 'As they look in the real world.', swatches);
    const done = button('Done', 'btn--primary', back);
    done.style.marginTop = '20px';
    card.append(done);
    menu.append(card);
    this.show(menu);
  }

  // ------------------------------------------------------------------------------------------------ pause

  pause(): void {
    const game = this.game;
    if (!game.playing || this.paused || game.autopilot.enabled) return;
    this.paused = true;
    game.app.paused = true;
    game.audio.setPaused(true);
    game.input.freePointer();
    const menu = el('div', 'menu menu--veil');
    const card = el('div', 'card');
    card.append(el('h2', '', 'Paused'), el('p', 'lede', game.chapter ? `${game.chapter[0]!.toUpperCase()}${game.chapter.slice(1)}` : ''));
    const buttons = el('div', 'buttons');
    buttons.style.width = '100%';
    buttons.append(
      button('Resume', 'btn--primary', () => this.resume()),
      button('Restart this day', '', () => {
        const chapter = game.chapter ?? 'monday';
        this.resume(false);
        void game.run(chapter, { ...game.state });
      }),
      button('Settings', '', () => this.showSettings(() => {
        this.paused = false;
        this.pause();
      })),
      button('Back to title', 'btn--quiet', () => {
        this.resume(false);
        void this.showTitle();
      }),
    );
    card.append(buttons);
    menu.append(card);
    this.show(menu);
  }

  private resume(capture = true): void {
    const game = this.game;
    this.paused = false;
    this.close();
    game.input.flush();
    game.app.paused = false;
    game.audio.setPaused(false);
    if (capture && !game.hud.choosing) game.input.capturePointer();
  }

  // ------------------------------------------------------------------------------------------------ the end

  private showEnd(): void {
    const game = this.game, s = game.state;
    game.playing = false;
    game.input.freePointer();
    game.hud.setReticleVisible(false);
    clearProgress();
    // the classroom comes back, out of focus, behind the summary
    game.app.tasks.tween(2.6, (k) => (game.app.fx.fade = 1 - k)).catch(() => undefined);
    const menu = el('div', 'menu menu--veil');
    const card = el('div', 'card card--wide');
    card.append(el('h2', '', 'Your week'), el('p', 'lede', 'There was no score. These were your choices; someone else would have made others.'));
    const week = el('div', 'week');
    const line = (day: string, text: string): void => {
      const r = el('div');
      r.append(el('b', '', day), el('span', '', text));
      week.append(r);
    };
    if (s.tuesdayChoice) line('Tuesday', s.tuesdayChoice === 'meet' ? TUESDAY.meet.result.gained : TUESDAY.stay.result.gained);
    if (s.thursdayChoice) line('Thursday', s.thursdayChoice === 'help' ? THURSDAY.help.result.gained : THURSDAY.haven.result.gained);
    if (s.policyChoice) line('Friday', `You recommended: ${FRIDAY.futures[s.policyChoice].title.toLowerCase()}. ${FRIDAY.futures[s.policyChoice].question}`);
    const questions = el('ol', 'questions');
    for (const q of FRIDAY.reflectionQuestions) questions.append(el('li', '', q));
    const buttons = el('div', 'buttons buttons--row');
    buttons.append(button('Play the week again', 'btn--primary', () => this.begin('monday', freshState())), button('Back to title', '', () => void this.showTitle()));
    card.append(week, questions, buttons);
    menu.append(card, el('p', 'fine', FRIDAY.endLine));
    this.show(menu);
  }

  // ------------------------------------------------------------------------------------------------ touch

  private buildTouchOverlay(): void {
    const game = this.game;
    const layer = el('div', 'touch');
    const stick = el('div', 'stick'), knob = el('div', 'knob');
    const pause = el('button', 'pause', 'II');
    pause.type = 'button';
    pause.setAttribute('aria-label', 'Pause');
    pause.addEventListener('click', () => this.pause());
    pause.hidden = game.input.mode !== 'touch';
    layer.append(stick, knob, pause);
    this.root.append(layer);
    game.input.onModeChange.on((mode) => (pause.hidden = mode !== 'touch'));
    game.addSystem(() => {
      const v = game.input.stickView;
      stick.style.opacity = knob.style.opacity = v ? '1' : '0';
      if (!v) return;
      stick.style.left = `${v.ox}px`;
      stick.style.top = `${v.oy}px`;
      knob.style.left = `${v.ox + v.dx * 44}px`;
      knob.style.top = `${v.oy - v.dy * 44}px`;
    });
  }
}

/** Builds the menus (pause, settings, the end-of-week summary, touch controls). Call once. */
export const createMenus = (game: Game, settings: Settings, tierPinned: boolean): { showTitle(): Promise<void> } => new Menus(game, settings, tierPinned);
