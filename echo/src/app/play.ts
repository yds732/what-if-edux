import type { Policy } from '../story/script';
import { freshState, isChapter, type ChapterId } from '../story/state';
import { WebAudio } from '../audio/WebAudio';
import { Game } from './Game';
import { numberParam } from './params';
import { isTier } from './quality';
import { loadSettings, tierFor } from './settings';

declare global {
  interface Window {
    __game?: Game;
    /** Story beats reached so far, in order. */
    __BEATS?: string[];
    /** The emulated headset, when `?xr=emulate` made one: tests move its controllers and press their buttons. */
    __xrDevice?: unknown;
  }
}

const pick = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

/**
 * Starts the game. With no parameters it opens on the title screen. For tests and captures:
 *   ?chapter=tuesday        start at a day, skipping the title
 *   &auto=1                 a scripted player makes every move (&tue=meet|haven &thu=help|haven &policy=expand|combined|investigate &misses=2)
 *   &speed=8                run game time faster
 *   &until=tuesday.decision hold the frame at a story beat (&after=1.5 seconds past it) and raise window.__READY
 *   &handover=tuesday.notify the scripted player stops at a story beat and gives the controls back, at normal speed
 */
export const runGame = async (canvas: HTMLCanvasElement, params: URLSearchParams): Promise<Game> => {
  const q = params.get('q');
  const settings = loadSettings();
  const game = new Game({
    canvas, tier: isTier(q) ? q : tierFor(settings),
    fixedScale: params.has('scale') ? numberParam(params, 'scale', 1, 0.3, 1) : null,
    maxDpr: numberParam(params, 'dpr', 2, 0.5, 3),
  }, new WebAudio());
  window.__game = game;
  window.__BEATS = [];

  game.autopilot.enabled = params.has('auto');
  game.autopilot.plan = {
    tuesday: pick(params.get('tue'), ['meet', 'haven'] as const, 'meet'),
    thursday: pick(params.get('thu'), ['help', 'haven'] as const, 'help'),
    policy: pick<Policy>(params.get('policy'), ['expand', 'combined', 'investigate'], 'combined'),
    misses: numberParam(params, 'misses', 0, 0, 99),
  };
  game.speed = Math.round(numberParam(params, 'speed', 1, 1, 16));
  // a scripted player has no hands to make the gesture that starts sound: where the browser allows it, start anyway
  if (params.has('auto')) game.audio.unlock();

  const until = params.get('until'), handover = params.get('handover');
  const after = numberParam(params, 'after', 1.2, 0, 600);
  game.onBeat = (name) => {
    window.__BEATS?.push(name);
    if (name === handover) {
      game.autopilot.enabled = false;
      game.speed = 1;
    }
    if (name !== until) return;
    game.app.tasks.wait(after).then(() => {
      game.app.paused = true;
      // two more frames so the held picture is the settled one
      requestAnimationFrame(() => requestAnimationFrame(() => (window.__READY = true)));
    }, () => undefined);
  };
  game.onChapter = (chapter) => {
    window.__BEATS?.push(`chapter:${chapter}`);
    if (chapter === 'end' && !until) window.__READY = true;
  };

  game.start();
  if (params.get('xr') === 'emulate') {
    // no headset to hand: emulate a Quest 3 in the page and walk straight into the session
    const { XRDevice, metaQuest3 } = await import('iwer');
    const device = new XRDevice(metaQuest3, { stereoEnabled: true });
    device.installRuntime({ forceInstall: true });
    window.__xrDevice = device;
    await game.xr.enter();
  }
  const chapter = params.get('chapter');
  const menus = (await import('../ui/dom/menus')).createMenus(game, settings, isTier(q));
  if (isChapter(chapter) || params.has('auto')) {
    game.input.wantsLock = !params.has('auto');
    void game.run((isChapter(chapter) ? chapter : 'monday') as ChapterId, freshState());
  } else {
    void menus.showTitle();
  }
  window.__INFO = game.app.info;
  return game;
};
