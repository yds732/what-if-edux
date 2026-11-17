import './menus.css';
import type { Game } from '../../app/Game';
import { TIERS } from '../../app/quality';
import { saveSettings, tierFor, type Settings } from '../../app/settings';
import { FRIDAY, THURSDAY, TUESDAY } from '../../story/script';
import { CHAPTERS, clearProgress, freshState, loadProgress, type ChapterId, type StoryState } from '../../story/state';
import { XRRig } from '../../input/XRRig';
import type { Character } from '../../characters/Character';
import { HAVEN, type HavenWorld } from '../../world/haven/HavenWorld';

/** Two framings of Haven behind the title: words on the left of a wide screen, or above and below the bridge on a tall one. */
const TITLE_VIEWS = {
  wide: { at: HAVEN.titleWide, pitch: 0.105, lumi: HAVEN.lumiTitle },
  tall: { at: HAVEN.titleTall, pitch: 0.16, lumi: HAVEN.lumi },
} as const;
type TitleView = keyof typeof TITLE_VIEWS;

/** The title camera's orbit: around the plaza and the bridge, 45 degrees above them. */
const TITLE_ORBIT = { centre: { x: 0, y: 0.5, z: -13 }, radius: 30, tilt: Math.PI / 4, speed: 0.015, start: 0.6 } as const;

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

/** Timing of the click sparkle: it starts with the press and is gone shortly after the button settles. */
const SPARKLE = { count: 6, ms: 420, reach: [16, 28] as const };
const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** A few motes of light thrown out from where a button was pressed: a small secondary touch on the click. */
const sparkle = (button: HTMLElement, event: MouseEvent): void => {
  if (reducedMotion()) return;
  const box = button.getBoundingClientRect();
  // a keyboard press has no pointer position: sparkle from the middle of the button
  const x = event.detail > 0 ? event.clientX : box.left + box.width / 2, y = event.detail > 0 ? event.clientY : box.top + box.height / 2;
  const layer = el('div', 'sparkles');
  document.body.append(layer);
  const turn = Math.random() * Math.PI * 2;
  const motes = Array.from({ length: SPARKLE.count }, (_, i) => {
    const mote = document.createElement('i');
    mote.style.left = `${x}px`;
    mote.style.top = `${y}px`;
    layer.append(mote);
    const a = turn + (i / SPARKLE.count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const r = SPARKLE.reach[0] + Math.random() * (SPARKLE.reach[1] - SPARKLE.reach[0]);
    return mote.animate([
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${Math.cos(a) * r}px, ${Math.sin(a) * r}px) scale(0.2)`, opacity: 0 },
    ], { duration: SPARKLE.ms * (0.8 + Math.random() * 0.4), easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'forwards' }).finished;
  });
  void Promise.allSettled(motes).then(() => layer.remove());
};

/** Small line icons for the title's utility buttons, drawn in the text colour. */
const ICONS = {
  chapters: '<path d="M4 5.5h16M4 12h16M4 18.5h10" />',
  settings: '<circle cx="12" cy="12" r="3.2" /><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5" />',
  arrow: '<path d="M5 12h13M13 6.5 18.5 12 13 17.5" />',
} as const;
const icon = (name: keyof typeof ICONS): SVGSVGElement => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon', `icon--${name}`);
  svg.innerHTML = ICONS[name];
  return svg;
};
/** The title's words and buttons arrive once per visit; returning to the title later shows them at once. */
let titleEntered = false;

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
    // every menu button answers a click with a little sparkle
    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement | null)?.closest('button');
      if (b && !b.disabled) sparkle(b, e);
    });
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
    const begin = button('Begin the week', 'btn--primary btn--go', () => this.begin('monday', freshState()));
    begin.append(icon('arrow'));
    buttons.append(begin);
    if (save && save.chapter !== 'monday') {
      buttons.append(button(`Continue · ${save.chapter[0]!.toUpperCase()}${save.chapter.slice(1)}`, '', () => this.begin(save.chapter, save.state)));
    }
    if (this.xrSupported) {
      buttons.append(button('Play in VR', '', () => {
        void this.game.xr.enter().then(() => this.begin('monday', freshState()), (e: unknown) => console.warn('Could not start VR:', e));
      }));
    }
    // chapters and settings live apart from the main action, in the corner where games keep them
    const utility = el('nav', 'utility');
    utility.setAttribute('aria-label', 'More');
    const chapters = button('Chapters', 'btn--utility', () => this.showChapters());
    const settings = button('Settings', 'btn--utility', () => this.showSettings(() => void this.showTitle()));
    chapters.prepend(icon('chapters'));
    settings.prepend(icon('settings'));
    utility.append(chapters, settings);
    const head = el('div', 'head'), actions = el('div', 'actions');
    head.append(el('h1', 'logo', 'ECHO'), el('p', 'logo-sub', 'Between Two Worlds'),
      el('p', 'tagline', 'A week in 2080 with an AI companion who always understands you, a classmate who does not always agree, and a vote that shapes your city.'));
    actions.append(buttons, el('p', 'fine', 'About 10 minutes · Sound on · Ages 11 to 14'));
    menu.append(head, actions, utility);
    if (!titleEntered) {
      titleEntered = true;
      menu.classList.add('enter');
      // the order things arrive in: the name, its subtitle, the line, the action, then the corner
      [...Array.from(head.children), actions, utility].forEach((part, i) => (part as HTMLElement).style.setProperty('--i', String(i)));
    }
    menu.classList.toggle('tall', this.title.view === 'tall');
    this.show(menu);
    // the picture comes up behind the title
    game.app.tasks.tween(2.2, (k) => (game.app.fx.fade = 1 - k)).catch(() => undefined);
    // build the first scene's world while the player reads the title
    void game.ensureWorld('classroom');
  }

  /**
   * The title's camera: high above Haven, looking down at 45 degrees, circling the whole island very slowly.
   * Lumi stands on the plaza below; the framing for the screen's shape only decides where she stands.
   */
  private driftCamera(title: TitleScene): void {
    const { player, app } = this.game;
    const name: TitleView = app.camera.aspect >= 1.15 ? 'wide' : 'tall';
    const view = TITLE_VIEWS[name];
    if (title.view !== name) {
      title.view = name;
      title.haven.stand(title.lumi, view.lumi);
      document.querySelector('.menu--title')?.classList.toggle('tall', name === 'tall');
    }
    // one full turn every ~7 minutes, with a gentle breathing in distance so the orbit never feels mechanical
    const t = app.time * TITLE_ORBIT.speed + TITLE_ORBIT.start;
    const radius = TITLE_ORBIT.radius * (1 + 0.04 * Math.sin(app.time * 0.05));
    const cx = TITLE_ORBIT.centre.x, cz = TITLE_ORBIT.centre.z;
    const x = cx + Math.sin(t) * radius, z = cz + Math.cos(t) * radius;
    player.position.set(x, 0, z);
    player.eyeHeight = radius * Math.tan(TITLE_ORBIT.tilt) + TITLE_ORBIT.centre.y;
    player.yaw = Math.atan2(-(cx - x), -(cz - z));
    player.pitch = -TITLE_ORBIT.tilt;
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
