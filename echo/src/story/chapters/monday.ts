import * as THREE from 'three';
import type { Game } from '../../app/Game';
import { BEDROOM, type BedroomWorld } from '../../world/bedroom/BedroomWorld';
import { CLASSROOM, EYE_SEATED, FLOOR_MARK, type ClassroomWorld } from '../../world/classroom/ClassroomWorld';
import { CONTROLS, MONDAY, TUESDAY } from '../script';
import { enterHaven, liftHeadset, restHeadset, stowHeadset, waitUse } from './shared';

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
  player.canMove = true;
  await d.wait(1.6);
  await d.fadeOut(1.4);
};
