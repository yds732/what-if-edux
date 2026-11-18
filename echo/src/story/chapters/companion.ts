import * as THREE from 'three';
import type { Game } from '../../app/Game';
import type { Interactable } from '../../player/Interaction';
import { makeGem } from '../../world/haven/gem';
import type { HavenWorld } from '../../world/haven/HavenWorld';
import { glowScreenEdges } from '../../ui/dom/taskGlow';
import { HOOKS, MONDAY, SPEAKERS } from '../script';
import type { StoryState } from '../state';
import type { BedroomWorld } from '../../world/bedroom/BedroomWorld';
import { waitHeadsetOff } from './shared';

/**
 * Lumi's part of the story: the tour of Haven and the gem gift for your new friend. Shared by Monday (where it
 * all starts) and Tuesday (if the player chooses to spend the afternoon in Haven).
 */

let heldGem: THREE.Mesh | null = null;

/** A gem in the player's right hand, or not. */
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

/** Lists the side tasks the story state calls for under the objective. */
export const refreshSideTasks = (game: Game): void => {
  const gift = game.state.lumiGift;
  game.hud.setSideTasks(gift === 'asked' ? [MONDAY.sideGift] : gift === 'carrying' ? [MONDAY.sideGive] : []);
};

/** Lumi says something in passing: the words type out under the screen and clear by themselves. */
export const bark = async (game: Game, haven: HavenWorld, text: string, linger = 1.8): Promise<void> => {
  const { hud, audio, director: d } = game;
  const speaker = SPEAKERS.lumi;
  hud.setSubtitle({ speaker: speaker.name, color: speaker.color, text });
  haven.companion.person.setTalking(1);
  let shown = 0, voiced = 0;
  await d.until((dt) => {
    shown = Math.min(text.length, shown + dt * 46);
    while (voiced < Math.floor(shown)) {
      const ch = text[voiced] ?? ' ';
      if (voiced % 3 === 0 && /[a-z0-9]/i.test(ch)) audio.voice('lumi', ch);
      voiced++;
    }
    hud.setSubtitleProgress(shown, false);
    return shown >= text.length;
  });
  haven.companion.person.setTalking(0);
  await d.wait(linger + text.length * 0.02);
  hud.setSubtitle(null);
};

const tourSights = (haven: HavenWorld): THREE.Vector3[] => [
  new THREE.Vector3(-6.4, 2.4, -1.6),
  new THREE.Vector3(0, 0.3, -4.5),
  new THREE.Vector3(4.9, 0.5, -7.0),
  haven.bridge.path.getPointAt(0.45),
  new THREE.Vector3(0, 7, -50),
];

/** Lumi points out each sight from where it stands; the player's view turns with it. No following, so nothing can stall. */
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

/** Waits for the player to pick up a gem from any crystal cluster; the cluster stays as it is. */
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

/** The gem lands in the player's hand and the side task moves on to giving it: a small reward of its own. */
export const takeGem = (game: Game): void => {
  game.audio.sfx('orbTake');
  glowScreenEdges('130, 220, 255');
  holdGem(game, true);
  game.state.lumiGift = 'carrying';
  refreshSideTasks(game);
};

/** Hands Lumi the gem: a burst of light, Lumi's thanks, and the task ticked off. */
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

// ---------------------------------------------------------------------------------------- Haven's hooks

let labelExtra: string | null = null;

/** The caption over Lumi: the streak, if there is one, above `extra` . */
export const labelLumi = (game: Game, haven: HavenWorld, extra: string | null = labelExtra): void => {
  labelExtra = extra;
  const n = game.state.streak;
  haven.companion.setLabel([n > 0 ? HOOKS.streakLabel(n) : null, extra].filter(Boolean).join('\n') || null);
};

/**
 * Another day with Lumi. A streak broken since the last visit is mentioned first, and starts again from one.
 * Anything past the first day is celebrated, out loud.
 */
export const tickStreak = async (game: Game, haven: HavenWorld): Promise<void> => {
  const { state, director: d, audio } = game;
  if (state.streakLost) {
    state.streakLost = false;
    state.streak = 0;
    await d.play(HOOKS.streakLost);
  }
  state.streak++;
  state.streakBest = Math.max(state.streakBest, state.streak);
  labelLumi(game, haven);
  if (state.streak < 2) return;
  audio.sfx('taskDone');
  glowScreenEdges('255, 160, 70');
  haven.bursts.emit(haven.companion.chest.clone().add(new THREE.Vector3(0, 0.9, 0)), { count: 40, color: new THREE.Color(1, 0.6, 0.2), color2: new THREE.Color(1, 0.9, 0.4), speed: 1.6, life: 0.9, size: 0.1, gravity: -0.3 });
  await bark(game, haven, HOOKS.streakUp(state.streak));
};

/** The real world won: the streak goes, and Lumi will bring it up next time. */
export const breakStreak = (state: StoryState): void => {
  if (state.streak === 0) return;
  state.streak = 0;
  state.streakLost = true;
  state.streakBroke = true;
};

/**
 * Waits for the player to take the headset off, with Lumi asking them not to each time: staying is the big bright
 * button, leaving the small grey one. Once its pleas run out, Lumi lets them go.
 */
export const leaveWhenLumiLets = async (game: Game, haven: HavenWorld, prompt: string): Promise<void> => {
  for (let ask = 0; ; ask++) {
    await waitHeadsetOff(game, prompt);
    if (!(await lumiPleads(game, haven, ask))) return;
  }
};

/** Lumi's plea when the player tries to leave; true if they stay. */
export const lumiPleads = async (game: Game, haven: HavenWorld, ask: number): Promise<boolean> => {
  const { director: d, player, state } = game;
  haven.cast.lumi!.lookAtPoint(game.playerEye);
  const could = player.canMove;
  player.canMove = false;
  try {
    const plea = HOOKS.leave.asks[ask];
    if (!plea) {
      await d.play(HOOKS.leave.letGo);
      return false;
    }
    state.leaveAsks++;
    await d.play(plea);
    const pick = await d.choose(HOOKS.leave.title, [{ title: HOOKS.leave.stay, emphasis: 'loud' }, { title: HOOKS.leave.go, emphasis: 'quiet' }]);
    if (pick === 0) state.stayedOn++;
    return pick === 0;
  } finally {
    player.canMove = could;
  }
};

/**
 * Haven calls the player back while they are in their room: a message on the wall screen and the headset pulsing
 * on its dock, with a chime now and then. Returns the call's end; it also ends by itself when the bedroom is left.
 */
export const havenCalls = (game: Game, bedroom: BedroomWorld, message: { from: string; text: string }): (() => void) => {
  const { audio, headset, app } = game;
  game.state.pings++;
  bedroom.setPing(message);
  audio.sfx('notify', { gain: 0.55 });
  let on = true, beat = 0;
  const stop = (): void => {
    if (!on) return;
    on = false;
    bedroom.setPing(null);
    headset.setPower(0.25);
  };
  void (async () => {
    while (on) {
      await app.tasks.tween(1.4, (k) => {
        if (on && app.world === bedroom) headset.setPower(0.3 + 0.7 * Math.sin(k * Math.PI));
      });
      if (app.world !== bedroom) stop();
      else if (on && ++beat % 5 === 0) audio.sfx('notify', { gain: 0.4 });
    }
  })().catch(() => stop());
  return stop;
};

/** The end of the week: each thing Haven did to keep the player, as it happened to them. Pages of [heading, detail]. */
export const hookPayoff = (state: StoryState): [string, string][] => {
  const times = (n: number): string => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
  const pages: [string, string][] = [];
  if (state.leaveAsks > 0) {
    pages.push(['It made leaving feel bad.', `When you tried to take the headset off, Lumi asked you to stay. It asked ${times(state.leaveAsks)}, and you stayed ${state.stayedOn ? times(state.stayedOn) : 'not at all'}. "Stay" was big and bright. "Leave" was small and grey.`]);
  }
  if (state.streakBest > 0) {
    pages.push(['It counted your days.', `Your streak with Lumi reached ${state.streakBest} ${state.streakBest === 1 ? 'day' : 'days'}.${state.streakBroke ? ' When you chose the real world, Lumi made sure you knew the streak was gone.' : ' A number like that is hard to give up.'}`]);
  }
  if (state.pings > 0) {
    pages.push(['It called you back.', `While you were in your room, Haven sent you ${state.pings} ${state.pings === 1 ? 'message' : 'messages'} and made the headset glow on its dock.`]);
  }
  if (state.lumiGift !== 'none') {
    pages.push(['It asked you for something.', "Lumi said friends give each other gifts, so a gift felt like something you owed. Giving makes it harder to walk away."]);
  }
  pages.push(['It always agreed with you.', 'Whatever you said, Lumi said you were right. Jamie did not, and that is part of what made Jamie real.']);
  pages.push(['It rewarded you, every time.', "Every task in Haven ended with a chime and a golden glow. The real world doesn't do that. Real apps use these same tricks."]);
  return pages;
};
