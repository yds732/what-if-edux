import * as THREE from 'three';
import type { Game } from '../../app/Game';
import { BEDROOM, type BedroomWorld } from '../../world/bedroom/BedroomWorld';
import { CLASSROOM, EYE_SEATED, FLOOR_MARK, type ClassroomWorld } from '../../world/classroom/ClassroomWorld';
import { CONTROLS, HOOKS, MONDAY } from '../script';
import type { Interactable } from '../../player/Interaction';
import type { HavenWorld } from '../../world/haven/HavenWorld';
import { enterHaven, liftHeadset, restHeadset, stowHeadset, waitUse } from './shared';
import { giveGem, havenCalls, holdGem, labelLumi, lumiPleads, lumiTour, refreshSideTasks, takeGem, tickStreak } from './companion';

export const monday = async (game: Game): Promise<void> => {
  const { director: d, player, hud, audio, app, headset } = game;
  app.fx.fade = 1;
  const room = (await d.enter('classroom', CLASSROOM.seatMonday, EYE_SEATED)) as ClassroomWorld;
  room.setVariant('morning', true);
  room.setScene('class');
  room.setScreen({ kind: 'title', eyebrow: 'Harbour District School', title: MONDAY.screenTitle, body: MONDAY.screenQuestion });
  restHeadset(game, CLASSROOM.plinth.clone().add(new THREE.Vector3(0, 0.075, 0)));
  player.sit(CLASSROOM.seatMonday, EYE_SEATED);
  player.canMove = false;
  game.hands.pose('rest');
  audio.setSoundscape('classroom', 1.5);
  await d.card('monday');
  game.reach('monday.class');
  const teacher = room.cast.teacher!;
  player.faceToward(teacher.headWorld(new THREE.Vector3()), 0.01);
  await d.fadeIn(1.4);
  hud.setHint(CONTROLS);
  void d.tween(2.6, (k) => (app.zoom = 12 * k)).catch(() => undefined);
  await d.play(MONDAY.intro);
  hud.setHint(null);
  void d.tween(1.0, (k) => (app.zoom = 12 * (1 - k))).catch(() => undefined);

  player.stand();
  player.canMove = true;
  d.objective(MONDAY.objectiveWalk);
  game.reach('monday.walk');
  room.setMarker(new THREE.Vector3(CLASSROOM.front.x, FLOOR_MARK, CLASSROOM.front.z), 0.5);
  await d.walkTo(CLASSROOM.front.x, CLASSROOM.front.z, 1.35);
  room.setMarker(null);
  d.objective(MONDAY.objectiveTake);
  teacher.setMood('happy');
  await waitUse(game, {
    position: headset.group.position.clone(), radius: 0.2, reach: 2.6, prompt: MONDAY.promptTake,
    onFocus: (on) => headset.setPower(on ? 1 : 0.25),
  });
  d.objective(null);
  player.canMove = false;
  await liftHeadset(game);
  game.reach('monday.headset');
  await d.play(MONDAY.thanks);
  await d.wait(0.5);
  await d.fadeOut(1.0);
  stowHeadset(game);
  game.hands.pose('rest');

  const bedroom = (await d.enter('bedroom', BEDROOM.enter)) as BedroomWorld;
  bedroom.setNight(0.9, true);
  bedroom.setMessages(null);
  restHeadset(game, BEDROOM.dock);
  player.canMove = true;
  audio.setSoundscape('bedroom', 1.5);
  await d.card('mondayHome');
  game.reach('monday.bedroom');
  await d.fadeIn(1.4);
  d.objective(MONDAY.objectiveWear);
  const call = havenCalls(game, bedroom, HOOKS.pings.monday);
  await waitUse(game, {
    position: BEDROOM.dock.clone().add(new THREE.Vector3(0, 0.03, 0)), radius: 0.2, reach: 2.5, prompt: MONDAY.promptWear,
    onFocus: (on) => headset.setPower(on ? 1 : 0.25),
  });
  call();
  d.objective(null);
  player.canMove = false;
  await liftHeadset(game);
  await d.wait(0.35);
  const haven = await enterHaven(game, 'arrival');
  game.reach('monday.haven');

  const lumi = haven.cast.lumi!;
  lumi.lookAtPoint(game.playerEye);
  await d.wait(2.6);
  player.faceToward(lumi.headWorld(new THREE.Vector3()), 1.4);

  const guide = haven.companion;
  haven.showCompanion(true);
  guide.setAlert(true);
  labelLumi(game, haven, null);
  refreshSideTasks(game);
  player.canMove = true;
  d.objective(MONDAY.objectiveLumi);
  await waitUse(game, { position: guide.chest, radius: 0.45, reach: 2.8, prompt: MONDAY.promptLumi });
  guide.setAlert(false);
  guide.mode = 'still';
  player.canMove = false;
  player.faceToward(guide.person.headWorld(new THREE.Vector3()), 0.6);
  await d.complete(MONDAY.objectiveLumi);
  await d.play(MONDAY.lumiHello);
  const trust = await d.choose(MONDAY.trust.title, MONDAY.trust.options);
  await d.play(trust === 0 ? MONDAY.trustYes : MONDAY.trustMaybe);
  await tickStreak(game, haven);
  player.canMove = true;

  game.reach('monday.tour');
  await lumiTour(game, haven);

  await havenFreeTime(game, haven);
  await d.fadeOut(1.4);
};

const havenFreeTime = async (game: Game, haven: HavenWorld): Promise<void> => {
  const { director: d, player, input, state } = game;
  const guide = haven.companion;
  let asks = 0;
  for (;;) {
    d.objective(MONDAY.objectiveFree);
    let action: 'talk' | 'gem' | 'give' | 'off' | null = null;
    const items: Interactable[] = [];
    if (state.lumiGift === 'none') items.push({ position: guide.chest, radius: 0.45, reach: 2.8, prompt: MONDAY.promptTalk, enabled: true, use: () => (action = 'talk') });
    if (state.lumiGift === 'carrying') items.push({ position: guide.chest, radius: 0.45, reach: 2.8, prompt: MONDAY.promptGive, enabled: true, use: () => (action = 'give') });
    if (state.lumiGift === 'asked') for (const position of haven.gems) items.push({ position, radius: 0.55, reach: 2.6, prompt: MONDAY.promptGem, enabled: true, use: () => (action = 'gem') });
    for (const item of items) game.interaction.add(item);
    let held = 0;
    try {
      await d.until((dt) => {
        held += dt;
        if (action) return true;
        if (game.autopilot.enabled && held > 0.6) {
          action = ({ none: 'talk', asked: 'gem', carrying: 'give', given: 'off' } as const)[state.lumiGift];
          return true;
        }
        if (input.pressed.has('headset')) action = 'off';
        return action !== null;
      });
    } finally {
      for (const item of items) game.interaction.remove(item);
    }
    const did = action as 'talk' | 'gem' | 'give' | 'off' | null;
    if (did === null) break;
    if (did === 'off') {
      if (await lumiPleads(game, haven, asks++)) continue;
      break;
    }
    if (did === 'talk') {
      player.canMove = false;
      guide.mode = 'still';
      player.faceToward(guide.person.headWorld(new THREE.Vector3()), 0.6);
      await d.play(MONDAY.askGift);
      state.lumiGift = 'asked';
      refreshSideTasks(game);
      guide.mode = 'roam';
      player.canMove = true;
    } else if (did === 'gem') {
      takeGem(game);
    } else {
      await giveGem(game, haven);
    }
  }
  d.objective(null);
  holdGem(game, false);
};
