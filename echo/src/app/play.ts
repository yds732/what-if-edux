import type { Policy } from '../story/script';
import { isMinigame } from '../arcade/registry';
import { freshState, isChapter, type ChapterId } from '../story/state';
import { WebAudio } from '../audio/WebAudio';
import { Game } from './Game';
import { numberParam } from './params';
import { isTier } from './quality';
import { loadSettings, tierFor } from './settings';

declare global {
  interface Window {
    __game?: Game;
    __BEATS?: string[];
    __xrDevice?: unknown;
  }
}

const pick = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

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
  game.arcade.autoSkill = numberParam(params, 'skill', 1, 0, 1);
  game.arcade.startLevel = Math.round(numberParam(params, 'level', 0, 0, 2));
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
      requestAnimationFrame(() => requestAnimationFrame(() => (window.__READY = true)));
    }, () => undefined);
  };
  game.onChapter = (chapter) => {
    window.__BEATS?.push(`chapter:${chapter}`);
    if (chapter === 'end' && !until) window.__READY = true;
  };

  game.start();
  if (params.get('xr') === 'emulate') {
    const { XRDevice, metaQuest3 } = await import('iwer');
    const device = new XRDevice(metaQuest3, { stereoEnabled: true });
    device.installRuntime({ forceInstall: true });
    window.__xrDevice = device;
    await game.xr.enter();
  }
  const chapter = params.get('chapter');
  const menus = (await import('../ui/dom/menus')).createMenus(game, settings, isTier(q));
  const play = params.get('play');
  if (params.has('arcade') || isMinigame(play)) {
    game.input.wantsLock = !params.has('auto') && !isMinigame(play);
    void game.runArcade(isMinigame(play) ? play : null);
  } else if (isChapter(chapter) || params.has('auto')) {
    game.input.wantsLock = !params.has('auto');
    void game.run((isChapter(chapter) ? chapter : 'monday') as ChapterId, freshState());
  } else {
    void menus.showTitle();
  }
  window.__INFO = game.app.info;
  return game;
};
