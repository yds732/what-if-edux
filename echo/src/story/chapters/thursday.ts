import * as THREE from 'three';
import type { Game } from '../../app/Game';
import { BEDROOM, type BedroomWorld, type ChatMessage } from '../../world/bedroom/BedroomWorld';
import type { HavenWorld } from '../../world/haven/HavenWorld';
import type { Interactable } from '../../player/Interaction';
import { Cancelled } from '../../core/tasks';
import { MINIGAMES, MINIGAME_IDS, type MinigameId } from '../../arcade/registry';
import { HUB } from '../../arcade/script';
import { RallyWorld } from '../../arcade/rally/RallyWorld';
import { HOOKS, MONDAY, THURSDAY } from '../script';
import { chat, enterHaven, holdToRead, leaveHaven, liftHeadset, openPhone, stowHeadset, waitHeadsetOff, waitUse } from './shared';
import { breakStreak, echoTempts, havenCalls, labelLumi, tickStreak } from './companion';

const gateUse = (game: Game, haven: HavenWorld, ids: readonly MinigameId[]): Promise<MinigameId> =>
  new Promise<MinigameId>((resolve, reject) => {
    const signal = game.director.signal;
    const items: Interactable[] = [];
    const done = (): void => {
      signal.removeEventListener('abort', abort);
      for (const item of items) game.interaction.remove(item);
    };
    const abort = (): void => {
      done();
      reject(new Cancelled());
    };
    for (const id of ids) {
      items.push(game.interaction.add({ position: haven.arcade.gates[id].film, radius: 1.05, reach: 3.6, prompt: HUB.prompt.enter(MINIGAMES[id].title), enabled: true, use: () => {
        done();
        resolve(id);
      } }));
    }
    signal.addEventListener('abort', abort, { once: true });
    if (game.autopilot.enabled) game.app.tasks.wait(0.8).then(() => {
      if (items.length && !signal.aborted) {
        done();
        resolve(ids[0]!);
      }
    }, () => undefined);
  });

const onTheIsle = (game: Game, haven: HavenWorld): void => {
  const isle = haven.arcade;
  haven.setVariant('arcade');
  for (const id of MINIGAME_IDS) isle.setStars(id, game.arcade.stars[id]);
  const { lumi, kai, nova } = haven.cast;
  haven.stand(lumi!, isle.guide);
  haven.stand(kai!, isle.gates.rally.keeper);
  haven.stand(nova!, isle.gates.sprites.keeper);
  for (const person of [lumi!, kai!, nova!]) person.setPose('standOpen', { immediate: true }).lookAtPoint(game.playerEye);
};


export const thursday = async (game: Game): Promise<void> => {
  const { director: d, player, hud, audio, app, state, arcade } = game;
  app.fx.fade = 1;
  const haven = (await game.ensureWorld('haven')) as HavenWorld;
  game.setWorld(haven);
  onTheIsle(game, haven);
  player.teleport(haven.arcade.spawn);
  labelLumi(game, haven, null);
  stowHeadset(game);
  game.hands.setStyle('haven', true);
  game.hands.pose('rest');
  player.canMove = true;
  audio.setSoundscape('havenFestival', 1.5);
  await d.card('thursday');
  game.reach('thursday.festival');
  const lumi = haven.cast.lumi!;
  haven.fireworks(4, 3);
  await d.fadeIn(1.4);
  player.faceToward(lumi.headWorld(new THREE.Vector3()), 0.9);
  await d.play(THURSDAY.intro);

  d.objective(THURSDAY.objective);
  await gateUse(game, haven, ['rally']);
  d.objective(null);
  arcade.startLevel = 0;
  const rally = await arcadeWorld(game);
  rally.interruptAt = 6;
  await arcade.play('rally', haven.arcade.gates.rally.back, 'havenFestival');
  game.reach('thursday.oneMore');
  audio.sfx('notify');
  hud.setToast({ ...THURSDAY.notification, center: true });
  player.canMove = false;
  await d.wait(0.9);
  await d.play(THURSDAY.oneMore);
  d.objective(THURSDAY.objectiveRemove);
  await waitHeadsetOff(game, THURSDAY.promptRemove);
  hud.setToast(null);
  await d.choose(THURSDAY.leaveTitle, THURSDAY.leaveOptions);
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
  const tempt = echoTempts(game);
  await chat(game, bedroom, thread, THURSDAY.message.map((m) => ({ from: 'jamie' as const, text: m.text })), clash);
  game.reach('thursday.message');
  player.faceToward(BEDROOM.dock.clone(), 1.3);
  await d.wait(1.5);
  hud.setReflection([`“${THURSDAY.thought}”`]);
  await holdToRead(game, 3.2, 7);
  hud.setReflection(null);
  await d.wait(0.5);
  player.faceToward(BEDROOM.hologram.clone(), 1.2);
  await d.wait(1.3);

  game.reach('thursday.decision');
  const pick = await d.choose(THURSDAY.decision.title, THURSDAY.decision.options);
  state.thursdayChoice = pick === 0 ? 'help' : 'haven';
  tempt();
  call();
  if (state.thursdayChoice === 'help') {
    breakStreak(state);
    (await arcadeWorld(game)).resume = false;
  }
  if (state.thursdayChoice === 'help') await helpJamie(game, bedroom, thread);
  else await returnToHaven(game, bedroom, thread);
  await d.reflect(THURSDAY.reflection, 6.5);
  await d.fadeOut(1.6);
};

const helpJamie = async (game: Game, bedroom: BedroomWorld, thread: ChatMessage[]): Promise<void> => {
  const { director: d, audio, player } = game;
  const [you, thanks] = THURSDAY.help.reply;
  await chat(game, bedroom, thread, [{ from: 'you', text: you.text }, { from: 'jamie', text: thanks.text }]);
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
  const { director: d, audio, player, headset, arcade } = game;
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
  const haven = await enterHaven(game, 'arcade', haven0(game).arcade.gates.rally.back);
  onTheIsle(game, haven);
  labelLumi(game, haven, null);
  const lumi = haven.cast.lumi!;
  game.reach('thursday.return');
  faceMe(game, lumi);
  player.faceToward(lumi.headWorld(new THREE.Vector3()), 0.8);
  await d.play(THURSDAY.haven.back);
  await tickStreak(game, haven);
  const world = await arcadeWorld(game);
  world.resume = true;
  await arcade.play('rally', haven.arcade.gates.rally.back, 'havenFestival', { once: true });
  faceMe(game, lumi);
  player.faceToward(lumi.headWorld(new THREE.Vector3()), 0.8);
  await d.play(THURSDAY.haven.next);
  d.objective(THURSDAY.haven.objectiveNext);
  game.reach('thursday.gateway');
  const next = await gateUse(game, haven, MINIGAME_IDS.filter((id) => id !== 'rally' && MINIGAMES[id].load));
  d.objective(null);
  await arcade.play(next, haven.arcade.gates[next].back, 'havenFestival', { once: true });
  haven.fireworks(10, 4);
  audio.sfx('cheer');
  faceMe(game, lumi);
  player.faceToward(lumi.headWorld(new THREE.Vector3()), 0.8);
  await d.play(THURSDAY.haven.cheers);
  await d.wait(0.6);
  await d.result(THURSDAY.haven.result);
};

const faceMe = (game: Game, who: { root: THREE.Object3D; place: (x: number, y: number, z: number, yaw: number) => unknown; lookAtPoint: (p: THREE.Vector3) => unknown }): void => {
  const p = who.root.position, me = game.player.position;
  who.place(p.x, p.y, p.z, Math.atan2(me.x - p.x, me.z - p.z));
  who.lookAtPoint(game.playerEye);
};

const haven0 = (game: Game): HavenWorld => game.worlds.haven as HavenWorld;

const arcadeWorld = async (game: Game): Promise<RallyWorld> => {
  const built = await game.arcade.prepare('rally');
  if (!(built instanceof RallyWorld)) throw new Error('Moonlight Rally did not load');
  return built;
};
