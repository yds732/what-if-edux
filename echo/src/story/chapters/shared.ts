import * as THREE from 'three';
import type { Game } from '../../app/Game';
import { ease } from '../../core/math';
import { Cancelled } from '../../core/tasks';
import type { Interactable } from '../../player/Interaction';
import { BEDROOM, type BedroomWorld, type ChatMessage } from '../../world/bedroom/BedroomWorld';
import { HAVEN, type HavenVariant, type HavenWorld } from '../../world/haven/HavenWorld';
import type { Ring } from '../../world/haven/bridge';
import type { Anchor } from '../../world/World';
import { ORB_CONTROLS, TUESDAY } from '../script';

export const waitUse = (game: Game, spec: Pick<Interactable, 'position' | 'radius' | 'reach' | 'prompt' | 'onFocus'>): Promise<void> => {
  const d = game.director;
  return new Promise<void>((resolve, reject) => {
    const signal = d.signal;
    if (signal.aborted) {
      reject(new Cancelled());
      return;
    }
    const finish = (): void => {
      signal.removeEventListener('abort', onAbort);
      game.interaction.remove(item);
    };
    const item: Interactable = {
      ...spec, enabled: true,
      use: () => {
        finish();
        resolve();
      },
    };
    const onAbort = (): void => {
      finish();
      reject(new Cancelled());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    game.interaction.add(item);
    if (game.autopilot.enabled) game.app.tasks.wait(0.5, signal).then(() => item.enabled && item.use(), () => undefined);
  });
};

export const waitHeadsetOff = async (game: Game, prompt: string): Promise<void> => {
  const { hud, input, interaction } = game;
  interaction.enabled = false;
  let held = 0;
  try {
    await game.director.until((dt) => {
      held += dt;
      hud.setPrompt(prompt, 'headset');
      if (game.autopilot.enabled) return held > 0.6;
      if (input.pressed.has('headset')) return true;
      return input.mode === 'touch' && held > 0.5 && input.released.has('primary') && input.wasTap;
    });
  } finally {
    hud.setPrompt(null);
    interaction.enabled = true;
  }
};

export const holdToRead = async (game: Game, min: number, max: number): Promise<void> => {
  const { input } = game;
  let held = 0;
  await game.director.until((dt) => {
    held += dt;
    if (game.autopilot.enabled) return held > Math.min(min, 1.2);
    if (held < min) return false;
    const pressed = input.pressed.has('advance') || input.pressed.has('primary') || (input.mode === 'touch' && input.released.has('primary') && input.wasTap);
    return pressed || held > max;
  });
};

const CRADLE = { position: new THREE.Vector3(0, -0.22, -0.43), rotation: new THREE.Euler(0.5, Math.PI, 0) };
const FACE = { position: new THREE.Vector3(0, -0.02, -0.1), rotation: new THREE.Euler(0, Math.PI, 0) };

export const restHeadset = (game: Game, at: THREE.Vector3): void => {
  const g = game.headset.group;
  game.app.world?.scene.add(g);
  g.visible = true;
  g.position.copy(at);
  g.rotation.set(0, 0, 0);
  g.scale.setScalar(1);
  game.headset.setPower(0.25);
};

export const stowHeadset = (game: Game): void => {
  game.app.camera.add(game.headset.group);
  game.headset.group.visible = false;
};

const moveHeadset = (game: Game, to: { position: THREE.Vector3; rotation: THREE.Euler }, seconds: number): Promise<void> => {
  const g = game.headset.group;
  const from = g.position.clone(), fromQ = g.quaternion.clone(), toQ = new THREE.Quaternion().setFromEuler(to.rotation);
  return game.director.tween(seconds, (k) => {
    g.position.lerpVectors(from, to.position, k);
    g.quaternion.slerpQuaternions(fromQ, toQ, k);
  }, ease.inOutCubic);
};

export const liftHeadset = async (game: Game): Promise<void> => {
  const { hands, audio, headset } = game;
  hands.pose('reach');
  await game.director.wait(0.22);
  game.app.camera.attach(headset.group);
  hands.pose('cradle');
  audio.sfx('pickup');
  headset.setPower(1);
  await moveHeadset(game, CRADLE, 0.55);
};

export const enterHaven = async (game: Game, variant: HavenVariant, at: Anchor = HAVEN.spawn): Promise<HavenWorld> => {
  const { hands, audio, app, director: d } = game;
  const haven = (await game.ensureWorld('haven')) as HavenWorld;
  haven.setVariant(variant);
  hands.pose('face');
  audio.sfx('headsetOn');
  await moveHeadset(game, FACE, 0.75);
  app.fx.flash = 0.9;
  stowHeadset(game);
  hands.pose('rest');
  audio.setSoundscape(variant === 'festival' ? 'havenFestival' : variant === 'evening' ? 'havenEvening' : 'haven', 2.5);
  await d.wipeTo('haven', at);
  return haven;
};

export const leaveHaven = async (game: Game, night: number): Promise<BedroomWorld> => {
  const { hands, audio, app, director: d, headset } = game;
  const bedroom = (await game.ensureWorld('bedroom')) as BedroomWorld;
  bedroom.setNight(night, true);
  hands.pose('face');
  audio.sfx('headsetOff');
  await d.wait(0.4);
  app.fx.flash = 0.7;
  audio.setSoundscape('bedroom', 2);
  await d.wipeTo('bedroom', BEDROOM.desk);
  const g = headset.group;
  app.camera.add(g);
  g.visible = true;
  g.position.copy(FACE.position);
  g.rotation.copy(FACE.rotation);
  headset.setPower(0.6);
  hands.pose('cradle');
  await moveHeadset(game, CRADLE, 0.5);
  bedroom.scene.attach(g);
  hands.pose('rest');
  const from = g.position.clone(), fromQ = g.quaternion.clone(), toQ = new THREE.Quaternion();
  await d.tween(0.6, (k) => {
    g.position.lerpVectors(from, BEDROOM.dock, k);
    g.position.y += Math.sin(k * Math.PI) * 0.08;
    g.quaternion.slerpQuaternions(fromQ, toQ, k);
  });
  audio.sfx('putDown');
  headset.setPower(0.25);
  game.player.faceToward(BEDROOM.phone, 1.1);
  return bedroom;
};

export const openPhone = async (game: Game, bedroom: BedroomWorld, prompt: string): Promise<void> => {
  bedroom.setAlert(true);
  await waitUse(game, { position: BEDROOM.phone.clone().add(new THREE.Vector3(0, 0.03, 0)), radius: 0.17, reach: 2.4, prompt });
  bedroom.setAlert(false);
  game.hands.pose('rest', 'reach');
  game.audio.sfx('phoneTap');
  game.app.tasks.wait(0.5).then(() => game.hands.pose('rest'), () => undefined);
  game.audio.sfx('holoOpen');
  game.player.faceToward(BEDROOM.hologram.clone().add(new THREE.Vector3(0, -0.3, 0)), 0.9);
};

export const chat = async (game: Game, bedroom: BedroomWorld, thread: ChatMessage[], add: readonly ChatMessage[], footer: { left: string; right: string } | null = null): Promise<void> => {
  for (const m of add) {
    thread.push(m);
    bedroom.setMessages(thread.slice(-4), footer);
    game.audio.sfx(m.from === 'you' ? 'uiSelect' : 'notify', { gain: 0.6 });
    await holdToRead(game, 0.9 + m.text.length * 0.03, 2.2 + m.text.length * 0.055);
  }
};

export interface RingRound {
  readonly rings: readonly Ring[];
  readonly orbs: number | null;
  readonly label: string;
  readonly done?: number;
  readonly total: number;
  onHit(hits: number, ring: Ring): void;
  onReset?(): void;
}

export const playRings = async (game: Game, haven: HavenWorld, round: RingRound): Promise<void> => {
  const d = game.director, star = game.star;
  if (!star) throw new Error('the orb game needs Haven to be built');
  const lumi = haven.cast.lumi!;
  const base = round.done ?? 0;
  let hits = 0, failed = false, firstTake = true, wasted = 0;
  const offs = [
    star.onHit.on(({ ring }) => {
      hits++;
      game.hud.setCounter({ label: round.label, value: base + hits, total: round.total });
      game.audio.sfx('ringHit', { at: ring.center });
      lumi.setMood('delighted').play('cheer');
      round.onHit(base + hits, ring);
    }),
    star.onMiss.on(({ rim }) => {
      game.audio.sfx(rim ? 'ringRim' : 'orbFizzle');
      lumi.setMood('delighted').play(hits % 2 ? 'clap' : 'thumbsUp');
    }),
    star.onThrow.on((charge) => game.audio.sfx('orbThrow', { pitch: 0.85 + 0.4 * charge })),
    star.onTake.on(() => {
      game.audio.sfx('orbTake');
      if (firstTake) {
        firstTake = false;
        d.objective(TUESDAY.objective.replace('the three glowing rings', round.rings.length === 1 ? 'the glowing ring' : 'the glowing rings'));
        game.hud.setHint(ORB_CONTROLS);
        game.app.tasks.wait(7, d.signal).then(() => game.hud.setHint(null), () => undefined);
      }
    }),
    star.onAppear.on(() => game.audio.sfx('orbAppear', { at: HAVEN.orbSource })),
    star.onFail.on(() => (failed = true)),
  ];
  game.hud.setCounter({ label: round.label, value: base, total: round.total });
  try {
    for (;;) {
      failed = false;
      star.begin({ rings: round.rings, source: HAVEN.orbSource, orbs: round.orbs });
      let pause = 0;
      await d.until((dt) => {
        game.audio.setCharge(star.chargeLevel);
        if (game.autopilot.enabled && (pause -= dt) <= 0 && (star.offering || star.holding)) {
          pause = 0.35;
          const target = round.rings.find((r) => r.state !== 'lit') ?? null;
          const miss = star.holding && wasted < game.autopilot.plan.misses;
          if (miss) wasted++;
          star.autoPlay(miss ? null : target);
        }
        return failed || round.rings.every((r) => r.state === 'lit');
      });
      game.audio.setCharge(0);
      if (!failed) break;
      star.end();
      game.audio.sfx('fail');
      for (const r of round.rings) r.setState('dormant', true);
      hits = 0;
      round.onReset?.();
      game.hud.setCounter({ label: round.label, value: base, total: round.total });
      await d.play(TUESDAY.retry);
    }
  } finally {
    for (const off of offs) off();
    star.end();
    game.hud.setHint(null);
    game.audio.setCharge(0);
  }
};
