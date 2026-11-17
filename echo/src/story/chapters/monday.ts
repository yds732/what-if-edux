import * as THREE from 'three';
import type { Game } from '../../app/Game';
import { BEDROOM, type BedroomWorld } from '../../world/bedroom/BedroomWorld';
import { CLASSROOM, EYE_SEATED, FLOOR_MARK, type ClassroomWorld } from '../../world/classroom/ClassroomWorld';
import { CONTROLS, MONDAY, TUESDAY } from '../script';
import type { Interactable } from '../../player/Interaction';
import type { HavenWorld } from '../../world/haven/HavenWorld';
import { enterHaven, liftHeadset, restHeadset, stowHeadset, waitUse } from './shared';
import { giveGem, holdGem, refreshSideTasks, sparkTour, takeGem } from './spark';

/** Scene 1. The pilot is announced; the player volunteers, goes home, and puts the headset on for the first time. */
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
  // from the back row the teacher is a long way off: lean in to listen
  void d.tween(2.6, (k) => (app.zoom = 12 * k)).catch(() => undefined);
  await d.play(MONDAY.intro);
  hud.setHint(null);
  void d.tween(1.0, (k) => (app.zoom = 12 * (1 - k))).catch(() => undefined);

  // up from the desk and to the front
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

  // ---- after school: home ----
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
  await waitUse(game, {
    position: BEDROOM.dock.clone().add(new THREE.Vector3(0, 0.03, 0)), radius: 0.2, reach: 2.5, prompt: MONDAY.promptWear,
    onFocus: (on) => headset.setPower(on ? 1 : 0.25),
  });
  d.objective(null);
  player.canMove = false;
  await liftHeadset(game);
  await d.wait(0.35);
  const haven = await enterHaven(game, 'arrival');
  game.reach('monday.haven');

  // ---- first sight of Haven ----
  const lumi = haven.cast.lumi!;
  lumi.lookAtPoint(game.playerEye);
  await d.wait(2.6);
  player.faceToward(lumi.headWorld(new THREE.Vector3()), 1.4);
  await d.play(TUESDAY.welcome);

  // ---- Spark: the other companion, in the red cap, waiting to be talked to ----
  const spark = haven.spark;
  haven.showSpark(true, { x: -4.6, z: -0.6, yaw: 2.0 });
  spark.setAlert(true);
  spark.setLabel(MONDAY.birthdayLabel);
  spark.mode = 'roam';
  refreshSideTasks(game);
  player.canMove = true;
  d.objective(MONDAY.objectiveSpark);
  await waitUse(game, { position: spark.chest, radius: 0.45, reach: 2.8, prompt: MONDAY.promptSpark });
  spark.setAlert(false);
  spark.mode = 'still';
  player.canMove = false;
  player.faceToward(spark.person.headWorld(new THREE.Vector3()), 0.6);
  await d.complete(MONDAY.objectiveSpark);
  await d.play(MONDAY.sparkHello);
  const trust = await d.choose(MONDAY.trust.title, MONDAY.trust.options);
  await d.play(trust === 0 ? MONDAY.trustYes : MONDAY.trustMaybe);
  player.canMove = true;

  // ---- the tour: Spark leads, the player follows ----
  game.reach('monday.tour');
  await sparkTour(game, haven);

  // ---- free time: talk to Spark about its birthday, find it a gem, or take the headset off ----
  await havenFreeTime(game, haven);
  await d.fadeOut(1.4);
};

/** Free time in Haven after the tour, until the player takes the headset off. Spark's birthday is there to find. */
const havenFreeTime = async (game: Game, haven: HavenWorld): Promise<void> => {
  const { director: d, player, input, state } = game;
  const spark = haven.spark;
  for (;;) {
    d.objective(MONDAY.objectiveFree);
    let action: 'talk' | 'gem' | 'give' | 'off' | null = null;
    const items: Interactable[] = [];
    if (state.sparkGift === 'none') items.push({ position: spark.chest, radius: 0.45, reach: 2.8, prompt: MONDAY.promptBirthday, enabled: true, use: () => (action = 'talk') });
    if (state.sparkGift === 'carrying') items.push({ position: spark.chest, radius: 0.45, reach: 2.8, prompt: MONDAY.promptGive, enabled: true, use: () => (action = 'give') });
    if (state.sparkGift === 'asked') for (const position of haven.gems) items.push({ position, radius: 0.55, reach: 2.6, prompt: MONDAY.promptGem, enabled: true, use: () => (action = 'gem') });
    for (const item of items) game.interaction.add(item);
    let held = 0;
    try {
      await d.until((dt) => {
        held += dt;
        if (action) return true;
        if (game.autopilot.enabled && held > 0.6) {
          // a scripted run does everything there is to do, then leaves
          action = ({ none: 'talk', asked: 'gem', carrying: 'give', given: 'off' } as const)[state.sparkGift];
          return true;
        }
        if (input.pressed.has('headset')) action = 'off';
        return action !== null;
      });
    } finally {
      for (const item of items) game.interaction.remove(item);
    }
    const did = action as 'talk' | 'gem' | 'give' | 'off' | null;
    if (did === 'off' || did === null) break;
    if (did === 'talk') {
      player.canMove = false;
      spark.mode = 'still';
      player.faceToward(spark.person.headWorld(new THREE.Vector3()), 0.6);
      await d.play(MONDAY.birthday);
      state.sparkGift = 'asked';
      refreshSideTasks(game);
      spark.mode = 'roam';
      player.canMove = true;
    } else if (did === 'gem') {
      // the gem comes from the cluster's light; the cluster stays as it was
      takeGem(game);
    } else {
      await giveGem(game, haven);
    }
  }
  d.objective(null);
  holdGem(game, false);
};
