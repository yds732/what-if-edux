import * as THREE from 'three';
import type { Game } from '../../app/Game';
import { CLASSROOM, EYE_SEATED, type ClassroomWorld } from '../../world/classroom/ClassroomWorld';
import { FRIDAY, SPEAKERS } from '../script';
import { holdToRead, stowHeadset } from './shared';

/** Scene 5. Other young people's experiences, one vote, and a look at where it might lead. */
export const friday = async (game: Game): Promise<void> => {
  const { director: d, player, hud, audio, app, state } = game;
  app.fx.fade = 1;
  const room = (await d.enter('classroom', CLASSROOM.seatPartner, EYE_SEATED)) as ClassroomWorld;
  room.setVariant('morning', true);
  room.setScene('class');
  room.setScreen({ kind: 'title', eyebrow: FRIDAY.screenTitle, title: FRIDAY.screenQuestion, body: 'What should our city do next?' });
  stowHeadset(game);
  game.hands.setStyle('real', true);
  game.hands.pose('rest');
  player.sit(CLASSROOM.seatPartner, EYE_SEATED);
  player.canMove = false;
  audio.setSoundscape('classroom', 1.5);
  await d.card('friday');
  game.reach('friday.class');
  const teacher = room.cast.teacher!;
  const front = new THREE.Vector3(0.2, 1.5, -5.6);
  player.faceToward(teacher.headWorld(new THREE.Vector3()), 0.01);
  await d.fadeIn(1.4);
  await d.play(FRIDAY.intro);

  // ---- three experiences of the same technology ----
  player.faceToward(front, 1.2);
  void d.tween(1.6, (k) => (app.zoom = 18 * k)).catch(() => undefined);
  game.reach('friday.voices');
  let speaking: string | null = null;
  for (const line of FRIDAY.voices) {
    if (line.who !== speaking) {
      speaking = line.who;
      room.setVoice(line.who as 'alex' | 'sam' | 'riley');
      audio.sfx('holoOpen');
      await d.wait(0.7);
    }
    room.setScreen({ kind: 'voice', name: SPEAKERS[line.who].name, line: line.text });
    await d.say(line);
  }
  d.hush();
  void d.tween(1.2, (k) => (app.zoom = 18 * (1 - k))).catch(() => undefined);
  room.setVoice(null);
  audio.sfx('holoClose');
  room.setScreen({ kind: 'title', eyebrow: FRIDAY.screenTitle, title: 'Same technology. Different experiences.', body: 'Which option should the Youth Council recommend?' });
  player.faceToward(teacher.headWorld(new THREE.Vector3()), 1.0);
  await d.play(FRIDAY.framing);

  // ---- the vote ----
  game.reach('friday.vote');
  const pick = await d.choose(FRIDAY.vote.title, FRIDAY.vote.options);
  const policy = FRIDAY.vote.policies[pick] ?? 'combined';
  state.policyChoice = policy;
  audio.sfx('vote');

  // ---- the Future Viewer ----
  room.setVariant('viewer');
  player.faceToward(new THREE.Vector3(0.2, 2.0, -5.9), 1.2);
  void d.tween(1.8, (k) => (app.zoom = 27 * k)).catch(() => undefined);
  await d.wait(1.0);
  audio.sfx('reveal');
  room.setScreen({ kind: 'future', heading: FRIDAY.viewerTitle, note: FRIDAY.viewerNote, future: FRIDAY.futures[policy] });
  hud.setObjective(FRIDAY.viewerBody);
  game.reach('friday.future');
  await holdToRead(game, 9, 40);
  hud.setObjective(null);
  void d.tween(1.4, (k) => (app.zoom = 27 * (1 - k))).catch(() => undefined);
  room.setVariant('morning');
  room.setScreen({ kind: 'title', eyebrow: FRIDAY.screenTitle, title: 'Thank you.', body: 'Your recommendation has been sent to the Youth Council.' });
  await d.wait(1.6);
  player.faceToward(teacher.headWorld(new THREE.Vector3()), 1.0);
  await d.play(FRIDAY.closing);

  // ---- reflection, and the end ----
  await d.wait(0.6);
  await d.fadeOut(1.6, 0x0b0d1a);
  audio.setSoundscape('ending', 3);
  game.reach('friday.reflection');
  hud.setReflection([FRIDAY.reflectionTitle, '', ...FRIDAY.reflectionQuestions.flatMap((q, i) => (i ? ['', q] : [q]))]);
  await holdToRead(game, 9, 60);
  hud.setReflection(null);
  await d.wait(1.6);
  hud.setCard('Echo', 'Between Two Worlds');
  await d.wait(3.0);
  hud.setCard(null);
  await d.wait(0.9);
  hud.setReflection([FRIDAY.endLine]);
  game.reach('friday.end');
  await d.wait(4.2);
  hud.setReflection(null);
  await d.wait(1.6);
  player.stand();
};
