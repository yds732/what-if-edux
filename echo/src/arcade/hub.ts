import * as THREE from 'three';
import type { Game } from '../app/Game';
import { Cancelled } from '../core/tasks';
import type { Interactable } from '../player/Interaction';
import type { HavenWorld } from '../world/haven/HavenWorld';
import { stowHeadset } from '../story/chapters/shared';
import { MINIGAMES, MINIGAME_IDS, type MinigameId } from './registry';
import { HUB } from './script';

type Keeper = 'lumi' | 'kai' | 'nova';
type Pick = { gate: MinigameId } | { talk: Keeper };

const _head = new THREE.Vector3();

/** Offers the five gates and the three companions, and resolves with whichever the player uses. */
const pick = (game: Game, haven: HavenWorld): Promise<Pick> =>
  new Promise<Pick>((resolve, reject) => {
    const signal = game.director.signal;
    if (signal.aborted) {
      reject(new Cancelled());
      return;
    }
    const items: Interactable[] = [];
    const finish = (): void => {
      signal.removeEventListener('abort', onAbort);
      for (const item of items) game.interaction.remove(item);
    };
    const onAbort = (): void => {
      finish();
      reject(new Cancelled());
    };
    const offer = (item: Omit<Interactable, 'enabled' | 'use'>, picked: Pick): void => {
      items.push(game.interaction.add({ ...item, enabled: true, use: () => {
        finish();
        resolve(picked);
      } }));
    };
    for (const id of MINIGAME_IDS) {
      const info = MINIGAMES[id], gate = haven.arcade.gates[id];
      offer({ position: gate.film, radius: 1.05, reach: 3.6, prompt: info.load ? HUB.prompt.enter(info.title) : HUB.prompt.sealed }, { gate: id });
    }
    for (const who of ['lumi', 'kai', 'nova'] as const) {
      const person = haven.cast[who]!;
      offer({ position: person.headWorld(new THREE.Vector3()).setY(person.root.position.y + 0.95), radius: 0.42, reach: 2.6, prompt: HUB.prompt.talk(person.spec.name) }, { talk: who });
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });

/**
 * The arcade, from arriving on the isle to leaving for the title: Lumi's welcome, then for as long as the player
 * stays, a walk about the isle between games. `first` goes straight through that gate (tests, and links to one game).
 */
export const runHub = async (game: Game, first: MinigameId | null = null): Promise<void> => {
  const { director: d, player, hud, audio, app, arcade } = game;
  app.fx.fade = 1;
  const haven = (await game.ensureWorld('haven')) as HavenWorld;
  const isle = haven.arcade;
  game.setWorld(haven);
  haven.setVariant('arcade');
  player.teleport(isle.spawn);
  for (const id of MINIGAME_IDS) isle.setStars(id, arcade.stars[id]);
  arcade.onStars = (id, stars) => isle.setStars(id, stars);
  // everyone at their post: Lumi to greet, Kai and Nova by the gates they keep
  const { lumi, kai, nova } = haven.cast;
  haven.stand(lumi!, isle.guide);
  haven.stand(kai!, isle.gates.rally.keeper);
  haven.stand(nova!, isle.gates.sprites.keeper);
  for (const person of [lumi!, kai!, nova!]) person.setPose('standOpen', { immediate: true }).lookAtPoint(game.playerEye);
  stowHeadset(game);
  game.hands.setStyle('haven', true);
  game.hands.pose('rest');
  player.canMove = player.canLook = true;
  audio.setSoundscape('havenFestival', 1.5);

  if (!first) {
    hud.setCard(HUB.card.title, HUB.card.subtitle);
    audio.sfx('card');
    await d.wait(2.1);
    hud.setCard(null);
    await d.wait(0.5);
    game.reach('arcade.isle');
    await d.fadeIn(1.4);
    player.faceToward(lumi!.headWorld(_head), 0.9);
    await d.play(HUB.welcome);
  }

  for (let next: MinigameId | null = first; ; next = null) {
    let picked: Pick;
    if (next) picked = { gate: next };
    else {
      d.objective(HUB.objective);
      game.reach('arcade.hub');
      picked = await pick(game, haven);
      d.objective(null);
    }
    if ('talk' in picked) {
      const person = haven.cast[picked.talk]!;
      player.faceToward(person.headWorld(_head), 0.6);
      await d.play(HUB.keeper[picked.talk]);
      continue;
    }
    const id = picked.gate;
    if (!MINIGAMES[id].load) {
      await d.play([HUB.sealed]);
      continue;
    }
    const before = arcade.stars[id];
    game.reach(`arcade.enter.${id}`);
    await arcade.play(id, isle.gates[id].back, 'havenFestival');
    game.reach(`arcade.back.${id}`);
    // Lumi is always pleased, however it went
    const said = arcade.last?.won ? HUB.back.won : arcade.last ? HUB.back.lost : HUB.back.left;
    player.faceToward(lumi!.headWorld(_head), 0.8);
    await d.play([said[(before + (arcade.plays[id] ?? 0)) % said.length]!]);
  }
};
