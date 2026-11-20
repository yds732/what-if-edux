import * as THREE from 'three';
import type { Game } from '../../app/Game';
import type { Interactable } from '../../player/Interaction';
import { makeGem } from '../../world/haven/gem';
import type { HavenWorld } from '../../world/haven/HavenWorld';
import { glowScreenEdges } from '../../ui/dom/taskGlow';
import { HOOKS, MONDAY, SPEAKERS, type Line } from '../script';
import { recordHavenVisit, type StoryState } from '../state';
import type { BedroomWorld } from '../../world/bedroom/BedroomWorld';
import { waitHeadsetOff } from './shared';

let heldGem: THREE.Mesh | null = null;

export const holdGem = (game: Game, on: boolean): void => {
  if (on && !heldGem) {
    heldGem = makeGem(0.032);
    heldGem.position.set(0, 0.045, 0);
    game.hands.right.palm.add(heldGem);
    game.hands.pose('hold', 'rest');
  } else if (!on && heldGem) {
    heldGem.removeFromParent();
    heldGem = null;
    game.hands.pose('rest');
  }
};

export const refreshSideTasks = (game: Game): void => {
  const gift = game.state.lumiGift;
  game.hud.setSideTasks(gift === 'asked' ? [MONDAY.sideGift] : gift === 'carrying' ? [MONDAY.sideGive] : []);
};

const bark = async (game: Game, haven: HavenWorld, line: Line): Promise<void> => {
  await game.director.subtitle(line, haven.companion.person, game.director.signal, 1.8);
  game.director.hush();
};

const tourSights = (haven: HavenWorld): THREE.Vector3[] => [
  new THREE.Vector3(-6.4, 2.4, -1.6),
  new THREE.Vector3(4.9, 0.5, -7.0),
  haven.bridge.path.getPointAt(0.45),
  new THREE.Vector3(0, 7, -50),
];

export const lumiTour = async (game: Game, haven: HavenWorld): Promise<void> => {
  const { director: d, player, audio } = game;
  const guide = haven.companion;
  const me = guide.person.root;
  player.canMove = false;
  guide.mode = 'still';
  d.objective(MONDAY.objectiveTour);
  const sights = tourSights(haven);
  for (let i = 0; i < sights.length; i++) {
    const sight = sights[i]!;
    guide.placeAt(me.position.x, me.position.z, Math.atan2(sight.x - me.position.x, sight.z - me.position.z));
    guide.person.lookAtPoint(sight);
    player.faceToward(sight, 0.9);
    await d.wait(0.6);
    audio.sfx('ringRim');
    guide.person.play('point');
    await bark(game, haven, MONDAY.tour[i]!);
  }
  guide.person.lookAtPoint(game.playerEye);
  player.faceToward(guide.person.headWorld(new THREE.Vector3()), 0.6);
  guide.mode = 'roam';
  player.canMove = true;
  await d.complete(MONDAY.objectiveTour);
};

export const pickGem = async (game: Game, haven: HavenWorld): Promise<void> => {
  const { director: d } = game;
  let picked = false;
  const items: Interactable[] = haven.gems.map((position) => ({
    position, radius: 0.55, reach: 2.6, prompt: MONDAY.promptGem, enabled: true, use: () => (picked = true),
  }));
  for (const item of items) game.interaction.add(item);
  try {
    let held = 0;
    await d.until((dt) => {
      held += dt;
      return picked || (game.autopilot.enabled && held > 0.5);
    });
  } finally {
    for (const item of items) game.interaction.remove(item);
  }
  takeGem(game);
};

export const takeGem = (game: Game): void => {
  game.audio.sfx('orbTake');
  glowScreenEdges('130, 220, 255');
  holdGem(game, true);
  game.state.lumiGift = 'carrying';
  refreshSideTasks(game);
};

export const giveGem = async (game: Game, haven: HavenWorld): Promise<void> => {
  const { director: d, player, audio } = game;
  const guide = haven.companion;
  player.canMove = false;
  guide.mode = 'still';
  player.faceToward(guide.person.headWorld(new THREE.Vector3()), 0.6);
  game.hands.pose('offer', 'rest');
  await d.wait(0.5);
  holdGem(game, false);
  audio.sfx('reveal');
  haven.bursts.emit(guide.chest, { count: 70, color: new THREE.Color(0.5, 0.9, 1), color2: new THREE.Color(1, 0.5, 0.45), speed: 2.6, life: 1, size: 0.13, gravity: -0.5 });
  game.state.lumiGift = 'given';
  refreshSideTasks(game);
  await d.complete(MONDAY.giftDone);
  await d.play(MONDAY.thanksGift);
  guide.mode = 'roam';
  player.canMove = true;
};

let labelExtra: string | null = null;

export const labelLumi = (game: Game, haven: HavenWorld, extra: string | null = labelExtra): void => {
  labelExtra = extra;
  const n = game.state.streak;
  haven.companion.setLabel([n > 0 ? HOOKS.streakLabel(n) : null, extra].filter(Boolean).join('\n') || null);
};

export const tickStreak = async (game: Game, haven: HavenWorld): Promise<void> => {
  const { state, director: d, audio } = game;
  if (!recordHavenVisit(state, game.chapter)) return;
  if (state.streakLost) {
    state.streakLost = false;
    await d.play(HOOKS.streakLost);
  }
  labelLumi(game, haven);
  if (state.streak < 2) return;
  audio.sfx('taskDone');
  glowScreenEdges('255, 160, 70');
  haven.bursts.emit(haven.companion.chest.clone().add(new THREE.Vector3(0, 0.9, 0)), { count: 40, color: new THREE.Color(1, 0.6, 0.2), color2: new THREE.Color(1, 0.9, 0.4), speed: 1.6, life: 0.9, size: 0.1, gravity: -0.3 });
  await bark(game, haven, HOOKS.streakUp[state.streak - 2] ?? HOOKS.streakContinues);
};

export const breakStreak = (state: StoryState): void => {
  if (state.streak === 0) return;
  state.streak = 0;
  state.streakLost = true;
  state.streakBroke = true;
};

export const leaveWhenLumiLets = async (game: Game, haven: HavenWorld, prompt: string): Promise<void> => {
  await waitHeadsetOff(game, prompt);
  await lumiPleads(game, haven, 0);
};

export const lumiPleads = async (game: Game, haven: HavenWorld, ask: number): Promise<boolean> => {
  const { director: d, player, state } = game;
  haven.cast.lumi!.lookAtPoint(game.playerEye);
  const could = player.canMove;
  player.canMove = false;
  try {
    const plea = HOOKS.leave.asks[Math.min(ask, HOOKS.leave.asks.length - 1)]!;
    state.leaveAsks++;
    await d.play(plea);
    await d.wait(0.6);
    await d.play(HOOKS.leave.letGo);
    return false;
  } finally {
    player.canMove = could;
  }
};

export const echoTempts = (game: Game): (() => void) => {
  const { app, headset, audio } = game;
  const toEcho = new THREE.Vector3(), forward = new THREE.Vector3();
  let on = true, looked = false, flicker = 0;
  const glance = (): number => {
    headset.group.getWorldPosition(toEcho).sub(game.playerEye).normalize();
    app.camera.getWorldDirection(forward);
    return forward.angleTo(toEcho);
  };
  app.tasks.until((dt) => {
    if (!on) return true;
    const angle = glance();
    if (angle < 0.3) looked = true;
    else if (looked && angle > 0.6) {
      looked = false;
      flicker = 2.6;
      audio.sfx('notify', { gain: 0.35 });
    }
    if (flicker > 0) {
      flicker -= dt;
      headset.setPower(Math.sin(app.time * 26) > 0 ? 1 : 0.15);
      if (flicker <= 0) headset.setPower(0.3);
    }
    return false;
  }).catch(() => undefined);
  return () => {
    on = false;
    headset.setPower(0.25);
  };
};

export const havenCalls = (game: Game, bedroom: BedroomWorld, message: Line | { from: string; text: string }): (() => void) => {
  const { audio, headset, app } = game;
  const signal = game.director.signal;
  game.state.pings++;
  bedroom.setPing('who' in message ? { from: SPEAKERS[message.who].name, text: message.text } : message);
  audio.sfx('notify', { gain: 0.55 });
  const speech = 'who' in message ? audio.voice(message, game.speed) : null;
  let on = true, beat = 0;
  const stop = (): void => {
    if (!on) return;
    on = false;
    speech?.stop();
    signal.removeEventListener('abort', stop);
    bedroom.setPing(null);
    headset.setPower(0.25);
  };
  signal.addEventListener('abort', stop, { once: true });
  void (async () => {
    while (on) {
      await app.tasks.tween(1.4, (k) => {
        if (on && app.world === bedroom) headset.setPower(0.3 + 0.7 * Math.sin(k * Math.PI));
      }, undefined, signal);
      if (app.world !== bedroom) stop();
      else if (on && ++beat % 5 === 0) audio.sfx('notify', { gain: 0.4 });
    }
  })().catch(() => stop());
  return stop;
};

export const hookPayoff = (state: StoryState): string[] => {
  const days = state.streakBest > 0 ? `a streak of ${state.streakBest} ${state.streakBest === 1 ? 'day' : 'days'}` : 'a streak';
  return [
    '• Lumi sounded sad every time you tried to leave.',
    `• It kept count of your days together: ${days} you would not want to break.`,
    ...(state.pings > 0 ? [`• It sent ${state.pings} ${state.pings === 1 ? 'message' : 'messages'} to call you back while you were in your room.`] : []),
    '• It rewarded every task with a chime and a golden glow.',
    '',
    'Real apps use these same tricks to keep you coming back.',
  ];
};
