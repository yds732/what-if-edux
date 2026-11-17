import * as THREE from 'three';
import type { Game } from '../../app/Game';
import { BEDROOM, type BedroomWorld, type ChatMessage } from '../../world/bedroom/BedroomWorld';
import { HAVEN, type HavenWorld } from '../../world/haven/HavenWorld';
import { HOOKS, MONDAY, THURSDAY } from '../script';
import { chat, enterHaven, holdToRead, leaveHaven, liftHeadset, openPhone, stowHeadset, waitUse } from './shared';
import { breakStreak, havenCalls, labelLumi, leaveWhenLumiLets, tickStreak } from './companion';

/** Scene 4. The Starlight Festival and Jamie's rehearsal fall on the same evening. */
export const thursday = async (game: Game): Promise<void> => {
  const { director: d, player, hud, audio, app, state } = game;
  app.fx.fade = 1;
  const haven = (await d.enter('haven', HAVEN.spawn)) as HavenWorld;
  haven.setVariant('festival');
  labelLumi(game, haven, null);
  stowHeadset(game);
  game.hands.setStyle('haven', true);
  game.hands.pose('rest');
  player.canMove = true;
  audio.setSoundscape('havenFestival', 1.5);
  await d.card('thursday');
  game.reach('thursday.festival');
  for (const name of ['lumi', 'kai', 'nova'] as const) haven.cast[name]!.lookAtPoint(game.playerEye);
  haven.fireworks(4, 3);
  await d.fadeIn(1.4);
  await d.play(THURSDAY.intro);

  // ---- across the bridge toward the gateway; partway over, the real world interrupts ----
  haven.setBoard({ title: THURSDAY.festivalTitle, body: THURSDAY.festivalBody, value: 0, total: 1 });
  d.objective(THURSDAY.objective);
  const path = haven.bridge.path;
  const partway = path.getPointAt(0.3);
  await d.walkTo(partway.x, partway.z, 2.2);
  haven.fireworks(3, 1.2);
  game.reach('thursday.oneMore');
  await d.play(THURSDAY.oneMore);
  audio.sfx('notify');
  hud.setToast(THURSDAY.notification);
  d.objective(THURSDAY.objectiveRemove);
  await leaveWhenLumiLets(game, haven, THURSDAY.promptRemove);
  hud.setToast(null);
  d.objective(null);
  player.canMove = false;
  const bedroom = await leaveHaven(game, 1);
  const call = havenCalls(game, bedroom, HOOKS.pings.thursday);
  player.canMove = true;
  d.objective(THURSDAY.objectivePhone);
  game.reach('thursday.bedroom');
  await openPhone(game, bedroom, 'Read the message');
  d.objective(null);
  const thread: ChatMessage[] = [];
  const clash = { left: THURSDAY.clash.rehearsal, right: THURSDAY.clash.festival };
  await chat(game, bedroom, thread, THURSDAY.message.map((m) => ({ from: 'jamie' as const, text: m.text })), clash);
  game.reach('thursday.message');
  // the phone on one side, the headset on the other
  player.faceToward(BEDROOM.dock.clone(), 1.3);
  await d.wait(1.5);
  // the thought belongs to the headset; the message waits behind it
  hud.setReflection([`“${THURSDAY.thought}”`]);
  await holdToRead(game, 3.2, 7);
  hud.setReflection(null);
  await d.wait(0.5);
  player.faceToward(BEDROOM.hologram.clone(), 1.2);
  await d.wait(1.3);

  // ---- decision 2 ----
  game.reach('thursday.decision');
  const pick = await d.choose(THURSDAY.decision.title, THURSDAY.decision.options);
  state.thursdayChoice = pick === 0 ? 'help' : 'haven';
  call();
  if (state.thursdayChoice === 'help') breakStreak(state);
  if (state.thursdayChoice === 'help') await helpJamie(game, bedroom, thread);
  else await returnToHaven(game, bedroom, thread);
  await d.reflect(THURSDAY.reflection, 6.5);
  await d.fadeOut(1.6);
};

const helpJamie = async (game: Game, bedroom: BedroomWorld, thread: ChatMessage[]): Promise<void> => {
  const { director: d, audio, player } = game;
  const [you, thanks] = THURSDAY.help.reply;
  await chat(game, bedroom, thread, [{ from: 'you', text: you.text }, { from: 'jamie', text: thanks.text }]);
  // a call opens above the phone
  bedroom.setMessages(null);
  await d.wait(0.5);
  audio.sfx('holoOpen');
  bedroom.setCall(true);
  const jamie = bedroom.cast.jamie!;
  jamie.setMood('worried').lookAtPoint(game.playerEye);
  player.canMove = false;
  player.faceToward(new THREE.Vector3(BEDROOM.hologram.x, 1.05, BEDROOM.hologram.z), 0.9);
  game.reach('thursday.call');
  await d.wait(1.0);
  await d.play(THURSDAY.help.call);
  jamie.play('wave');
  await d.wait(1.3);
  audio.sfx('holoClose');
  bedroom.setCall(false);
  await d.wait(0.8);
  bedroom.setMessages([{ from: 'system', text: THURSDAY.help.phone }]);
  await d.wait(2.4);
  bedroom.setMessages(null);
  player.canMove = true;
  await d.result(THURSDAY.help.result);
};

const returnToHaven = async (game: Game, bedroom: BedroomWorld, thread: ChatMessage[]): Promise<void> => {
  const { director: d, audio, player, headset } = game;
  const [you, reply] = THURSDAY.haven.reply;
  await chat(game, bedroom, thread, [{ from: 'you', text: you.text }, { from: 'jamie', text: reply.text }]);
  bedroom.setMessages(null);
  d.objective(MONDAY.objectiveWear);
  await waitUse(game, {
    position: BEDROOM.dock.clone().add(new THREE.Vector3(0, 0.03, 0)), radius: 0.2, reach: 2.5, prompt: MONDAY.promptWear,
    onFocus: (on) => headset.setPower(on ? 1 : 0.25),
  });
  d.objective(null);
  player.canMove = false;
  await liftHeadset(game);
  const haven = await enterHaven(game, 'festival');
  labelLumi(game, haven, null);
  // back where the player left off, partway across
  const partway = haven.bridge.path.getPointAt(0.3);
  player.position.set(partway.x, partway.y, partway.z);
  player.canMove = true;
  game.reach('thursday.return');
  for (const name of ['lumi', 'kai', 'nova'] as const) haven.cast[name]!.lookAtPoint(game.playerEye);
  await d.play(THURSDAY.haven.back);
  await tickStreak(game, haven);
  d.objective(THURSDAY.haven.objective);
  const end = haven.bridge.path.getPointAt(1);
  await d.walkTo(end.x, end.z - 1.5, 2.6);
  await d.complete(THURSDAY.haven.objective);
  // the gateway opens
  haven.openGateway();
  audio.sfx('gateOpen');
  game.app.fx.flash = 0.5;
  haven.fireworks(18, 6);
  game.reach('thursday.gateway');
  await d.wait(2.2);
  audio.sfx('cheer');
  await d.play(THURSDAY.haven.cheers);
  await d.wait(0.8);
  await d.result(THURSDAY.haven.result);
};
