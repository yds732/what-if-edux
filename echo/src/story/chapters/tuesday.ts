import * as THREE from 'three';
import type { Game } from '../../app/Game';
import { BEDROOM, type BedroomWorld, type ChatMessage } from '../../world/bedroom/BedroomWorld';
import { CLASSROOM, FLOOR_MARK, type ClassroomWorld } from '../../world/classroom/ClassroomWorld';
import { HAVEN, type HavenWorld } from '../../world/haven/HavenWorld';
import { HOOKS, MONDAY, TUESDAY } from '../script';
import { chat, enterHaven, holdToRead, leaveHaven, liftHeadset, openPhone, playRings, stowHeadset, waitUse } from './shared';
import { breakStreak, giveGem, havenCalls, holdGem, labelLumi, leaveWhenLumiLets, pickGem, refreshSideTasks, tickStreak } from './companion';

export const tuesday = async (game: Game): Promise<void> => {
  const { director: d, player, hud, audio, app, state } = game;
  app.fx.fade = 1;
  const haven = (await d.enter('haven', HAVEN.spawn)) as HavenWorld;
  haven.setVariant('arrival');
  haven.showCompanion(true);
  labelLumi(game, haven, null);
  haven.companion.person.lookAtPoint(game.playerEye);
  holdGem(game, false);
  refreshSideTasks(game);
  stowHeadset(game);
  game.hands.setStyle('haven', true);
  game.hands.pose('rest');
  player.canMove = true;
  audio.setSoundscape('haven', 1.5);
  await d.card('tuesday');
  game.reach('tuesday.haven');
  await d.fadeIn(1.4);
  const lumi = haven.cast.lumi!;
  lumi.lookAtPoint(game.playerEye);
  await d.play(TUESDAY.invite);

  const board = (value: number): void => haven.setBoard({ title: TUESDAY.challengeTitle, body: TUESDAY.challengeBody, value, total: 3 });
  board(0);
  d.objective(TUESDAY.objectiveTake);
  game.reach('tuesday.challenge');
  await playRings(game, haven, {
    rings: haven.bridge.rings, orbs: 9, label: 'Star Bridge', total: 3,
    onHit: (hits) => {
      haven.bridge.setSections(hits);
      board(hits);
      audio.sfx('bridgeBuild');
    },
    onReset: () => {
      haven.bridge.setSections(0);
      board(0);
    },
  });
  d.objective(null);
  audio.sfx('bridgeComplete');
  haven.fireworks(7, 3.5);
  game.reach('tuesday.complete');
  await d.wait(1.4);
  for (const name of ['kai', 'nova'] as const) {
    const friend = haven.cast[name]!;
    friend.root.visible = true;
    friend.lookAtPoint(game.playerEye);
    haven.bursts.emit(friend.headWorld(new THREE.Vector3()), { count: 60, color: new THREE.Color(1, 0.85, 0.5), speed: 2.5, life: 0.9, size: 0.14, gravity: -0.6 });
  }
  audio.sfx('cheer');
  await d.play(TUESDAY.success);
  haven.setBoard({ title: TUESDAY.completeTitle, body: TUESDAY.completeBody, value: 3, total: 3 });
  hud.setReflection([TUESDAY.completeTitle, TUESDAY.completeBody]);
  await d.wait(3.2);
  hud.setReflection(null);
  hud.setCounter(null);

  await d.wait(0.8);
  audio.sfx('notify');
  hud.setToast(TUESDAY.notification);
  d.objective(TUESDAY.objectiveRemove);
  game.reach('tuesday.notify');
  await leaveWhenLumiLets(game, haven, TUESDAY.promptRemove);
  hud.setToast(null);
  d.objective(null);
  player.canMove = false;
  const bedroom = await leaveHaven(game, 0.1);
  const call = havenCalls(game, bedroom, HOOKS.pings.tuesday);
  player.canMove = true;
  d.objective(TUESDAY.objectivePhone);
  game.reach('tuesday.bedroom');
  await openPhone(game, bedroom, TUESDAY.promptPhone);
  d.objective(null);
  const thread: ChatMessage[] = [];
  await chat(game, bedroom, thread, [{ from: 'jamie', text: TUESDAY.message[0].text }]);

  game.reach('tuesday.decision');
  const pick = await d.choose(TUESDAY.decision.title, TUESDAY.decision.options);
  state.tuesdayChoice = pick === 0 ? 'meet' : 'haven';
  call();
  if (state.tuesdayChoice === 'meet') breakStreak(state);
  if (state.tuesdayChoice === 'meet') await meetJamie(game, bedroom, thread);
  else await stayInHaven(game, bedroom, thread);
  await d.fadeOut(1.2);
};

const meetJamie = async (game: Game, bedroom: BedroomWorld, thread: ChatMessage[]): Promise<void> => {
  const { director: d, player, audio, hud } = game;
  const [you, jamieReply] = TUESDAY.meet.reply;
  await chat(game, bedroom, thread, [{ from: 'you', text: you.text }, { from: 'jamie', text: jamieReply.text }]);
  await d.fadeOut(1.0);
  bedroom.setMessages(null);

  const room = (await d.enter('classroom', CLASSROOM.door)) as ClassroomWorld;
  room.setVariant('golden', true);
  room.setScene('poster');
  room.setPoster(null);
  room.setScreen({ kind: 'title', eyebrow: 'After-school club', title: 'Welcome Week', body: 'Making something for the students who start next term.' });
  stowHeadset(game);
  game.hands.setStyle('real', true);
  player.canMove = false;
  audio.setSoundscape('classroomWarm', 1.5);
  await d.card('tuesdaySchool');
  game.reach('tuesday.poster');
  const jamie = room.cast.jamie!;
  jamie.lookAtPoint(game.playerEye);
  player.faceToward(jamie.headWorld(new THREE.Vector3()), 0.01);
  await d.fadeIn(1.4);
  await d.say(TUESDAY.meet.scene[0]);
  d.hush();
  player.canMove = true;
  d.objective(TUESDAY.meet.objectiveJoin);
  const stand = CLASSROOM.posterStand.position;
  room.setMarker(new THREE.Vector3(stand.x, FLOOR_MARK, stand.z), 0.5);
  await d.walkTo(stand.x, stand.z, 0.9);
  room.setMarker(null);
  d.objective(null);
  player.canMove = false;
  player.faceToward(jamie.headWorld(new THREE.Vector3()), 0.8);
  await d.stepTo(stand.x, stand.z);
  await d.play(TUESDAY.meet.scene.slice(1));
  d.objective(TUESDAY.meet.objective);
  player.faceToward(new THREE.Vector3(CLASSROOM.posterTable.x, 0.75, CLASSROOM.posterTable.z), 0.9);
  const phrase = await d.choose(TUESDAY.meet.posterTitle, TUESDAY.meet.phrases.map((title) => ({ title })));
  d.objective(null);
  room.setPoster(TUESDAY.meet.phrases[phrase] ?? TUESDAY.meet.phrases[0]);
  audio.sfx('poster');
  game.hands.pose('reach', 'rest');
  await d.wait(0.9);
  game.hands.pose('rest');
  game.reach('tuesday.posterDone');
  player.faceToward(jamie.headWorld(new THREE.Vector3()), 0.9);
  await d.play(TUESDAY.meet.thanks);
  await d.wait(0.6);
  await d.result(TUESDAY.meet.result);
  hud.setObjective(null);
};

const stayInHaven = async (game: Game, bedroom: BedroomWorld, thread: ChatMessage[]): Promise<void> => {
  const { director: d, player, audio, headset, state } = game;
  const [you, jamieReply] = TUESDAY.stay.reply;
  await chat(game, bedroom, thread, [{ from: 'you', text: you.text }, { from: 'jamie', text: jamieReply.text }]);
  bedroom.setMessages(null);
  d.objective(MONDAY.objectiveWear);
  await waitUse(game, {
    position: BEDROOM.dock.clone().add(new THREE.Vector3(0, 0.03, 0)), radius: 0.2, reach: 2.5, prompt: MONDAY.promptWear,
    onFocus: (on) => headset.setPower(on ? 1 : 0.25),
  });
  d.objective(null);
  player.canMove = false;
  await liftHeadset(game);
  const haven = await enterHaven(game, 'arrival');
  haven.bridge.setSections(3, true);
  haven.bridge.rings.forEach((ring) => ring.setState('lit', true));
  const guide = haven.companion;
  haven.showCompanion(true, { x: 0.6, z: 1.6, yaw: Math.PI });
  labelLumi(game, haven, null);
  guide.mode = 'still';
  player.canMove = true;
  game.reach('tuesday.lumi');
  guide.person.lookAtPoint(game.playerEye);
  player.faceToward(guide.person.headWorld(new THREE.Vector3()), 1.0);
  await d.play(TUESDAY.stay.back);
  await tickStreak(game, haven);
  guide.mode = 'roam';

  if (state.lumiGift === 'none') {
    await d.play(TUESDAY.stay.ask);
    state.lumiGift = 'asked';
  }
  if (state.lumiGift === 'asked') {
    refreshSideTasks(game);
    d.objective(MONDAY.objectiveGem);
    await pickGem(game, haven);
    d.objective(null);
  }
  if (state.lumiGift === 'carrying') {
    holdGem(game, true);
    refreshSideTasks(game);
    d.objective(MONDAY.sideGive);
    await waitUse(game, { position: guide.chest, radius: 0.45, reach: 2.8, prompt: MONDAY.promptGive });
    d.objective(null);
    await giveGem(game, haven);
  } else {
    await d.play(TUESDAY.stay.given);
  }
  guide.mode = 'still';
  player.faceToward(guide.person.headWorld(new THREE.Vector3()), 0.6);
  haven.fireworks(8, 3);
  audio.sfx('cheer');
  await d.play(TUESDAY.stay.cheers);
  await d.wait(0.6);
  await d.result(TUESDAY.stay.result);
  await holdToRead(game, 0.2, 0.4);
};
