import * as THREE from 'three';
import type { Game } from '../../app/Game';
import type { Interactable } from '../../player/Interaction';
import { makeGem } from '../../world/haven/gem';
import type { HavenWorld } from '../../world/haven/HavenWorld';
import { glowScreenEdges } from '../../ui/dom/taskGlow';
import { MONDAY, SPEAKERS } from '../script';

/**
 * Lumi's part of the story: the tour of Haven, its birthday, and the gem it asks for. Shared by Monday (where it
 * all starts) and Tuesday (Lumi's birthday, if the player chooses to spend it in Haven).
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

/** Where the tour stops, what Lumi shows at each, and what it says. */
const tourStops = (haven: HavenWorld): { x: number; z: number; show: THREE.Vector3 }[] => {
  const path = haven.bridge.path;
  const onDeck = path.getPointAt(0.06), start = path.getPointAt(0.0), far = path.getPointAt(0.45);
  return [
    { x: -4.9, z: -0.5, show: new THREE.Vector3(-6.4, 2.4, -1.6) },
    { x: -2.0, z: -3.0, show: new THREE.Vector3(0, 0.3, -4.5) },
    { x: 3.5, z: -5.8, show: new THREE.Vector3(4.9, 0.5, -7.0) },
    { x: start.x - 1.2, z: start.z + 1.6, show: far },
    { x: onDeck.x, z: onDeck.z, show: new THREE.Vector3(0, 7, -50) },
  ];
};

/** Lumi leads the player round Haven: it goes ahead, waits, and once the player is with it, shows them something. */
export const lumiTour = async (game: Game, haven: HavenWorld): Promise<void> => {
  const { director: d, player, audio } = game;
  const guide = haven.companion;
  d.objective(MONDAY.objectiveFollow);
  const stops = tourStops(haven);
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]!;
    guide.leadTo(stop.x, stop.z, stop.show);
    // a scripted run simply arrives alongside
    if (game.autopilot.enabled) player.position.set(stop.x + 1.2, player.position.y, stop.z + 1.2);
    await d.until(() => guide.arrived);
    await d.until(() => guide.followed);
    // the cue: the ring at Lumi's feet lights up, a chime, and Lumi points
    audio.sfx('ringRim');
    guide.person.play('point');
    await bark(game, haven, MONDAY.tour[i]!);
  }
  guide.mode = 'roam';
  await d.complete(MONDAY.tourDone);
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
