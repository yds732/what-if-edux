import * as THREE from 'three';
import type { Game } from '../../app/Game';
import { BEDROOM, type BedroomWorld } from '../../world/bedroom/BedroomWorld';
import { CLASSROOM, EYE_SEATED, SEAT, type ClassroomWorld } from '../../world/classroom/ClassroomWorld';
import { HAVEN } from '../../world/haven/HavenWorld';
import { MONDAY, WEDNESDAY } from '../script';
import { enterHaven, liftHeadset, restHeadset, stowHeadset, waitUse } from './shared';

/** Scene 3. A disagreement with a classmate, and a companion who agrees with everyone. */
export const wednesday = async (game: Game): Promise<void> => {
  const { director: d, player, hud, audio, app, state, headset } = game;
  app.fx.fade = 1;
  const room = (await d.enter('classroom', CLASSROOM.door)) as ClassroomWorld;
  room.setVariant('morning', true);
  room.setScene('class');
  room.setScreen({ kind: 'title', eyebrow: WEDNESDAY.screenTitle, title: 'Echo Pilot', body: WEDNESDAY.screenQuestion });
  stowHeadset(game);
  game.hands.setStyle('real', true);
  game.hands.pose('rest');
  player.canMove = false;
  audio.setSoundscape('classroom', 1.5);
  await d.card('wednesday');
  game.reach('wednesday.class');
  const teacher = room.cast.teacher!, jamie = room.cast.jamie!;
  player.faceToward(teacher.headWorld(new THREE.Vector3()), 0.01);
  await d.fadeIn(1.4);
  await d.play(WEDNESDAY.intro);

  // ---- find Jamie ----
  jamie.lookAtPoint(game.playerEye).setMood('happy').play('wave');
  const seat = CLASSROOM.seatPartner.position;
  room.setMarker(new THREE.Vector3(seat.x, SEAT + 0.02, seat.z - 0.02));
  player.canMove = true;
  d.objective(WEDNESDAY.objectiveSit);
  game.reach('wednesday.find');
  await waitUse(game, { position: new THREE.Vector3(seat.x, SEAT + 0.25, seat.z), radius: 0.45, reach: 2.4, prompt: WEDNESDAY.promptSit });
  room.setMarker(null);
  d.objective(null);
  player.canMove = false;
  audio.sfx('sit');
  await d.stepTo(seat.x, seat.z, 0.5);
  player.sit(CLASSROOM.seatPartner, EYE_SEATED);
  await d.wait(0.5);
  player.faceToward(jamie.headWorld(new THREE.Vector3()), 0.9);
  game.reach('wednesday.partner');

  // ---- two different perspectives ----
  await d.play(WEDNESDAY.greeting);
  // Jamie only mentions Tuesday if there was one: a week begun from the chapter list has no yesterday
  if (state.tuesdayChoice) await d.play(state.tuesdayChoice === 'meet' ? WEDNESDAY.greetingMet : WEDNESDAY.greetingStayed);
  await d.play(WEDNESDAY.discussion);
  jamie.setMood('happy');
  audio.sfx('bell');
  hud.setToast({ title: WEDNESDAY.bell, body: 'End of the school day' });
  await d.wait(2.4);
  hud.setToast(null);
  await d.fadeOut(1.2);
  player.stand();

  // ---- evening: back to Haven ----
  const bedroom = (await d.enter('bedroom', BEDROOM.enter)) as BedroomWorld;
  bedroom.setNight(1, true);
  bedroom.setMessages(null);
  restHeadset(game, BEDROOM.dock);
  player.canMove = true;
  audio.setSoundscape('bedroom', 1.5);
  await d.card('wednesdayEvening');
  game.reach('wednesday.bedroom');
  await d.fadeIn(1.4);
  d.objective(WEDNESDAY.objectiveWear);
  await waitUse(game, {
    position: BEDROOM.dock.clone().add(new THREE.Vector3(0, 0.03, 0)), radius: 0.2, reach: 2.5, prompt: MONDAY.promptWear,
    onFocus: (on) => headset.setPower(on ? 1 : 0.25),
  });
  d.objective(null);
  player.canMove = false;
  await liftHeadset(game);
  const haven = await enterHaven(game, 'evening', HAVEN.spawn);
  game.reach('wednesday.haven');
  const lumi = haven.cast.lumi!;
  lumi.lookAtPoint(game.playerEye);
  await d.wait(1.2);
  player.faceToward(lumi.headWorld(new THREE.Vector3()), 1.1);
  await d.play(WEDNESDAY.evening);

  // ---- the pause ----
  await d.wait(1.6);
  audio.setSoundscape('unease', 3);
  game.reach('wednesday.pause');
  await d.play(WEDNESDAY.pause);
  await d.wait(1.8);
  await d.play(WEDNESDAY.offer);
  // silence. Haven stays beautiful; Lumi goes on smiling.
  lumi.setMood('blank').clearGesture();
  game.reach('wednesday.silence');
  await d.wait(3.4);
  await d.reflect(WEDNESDAY.reflection, 5.5);
  await d.fadeOut(2.6);
  player.canMove = true;
};
