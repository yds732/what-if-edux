import * as THREE from 'three';
import type { App } from '../app/App';
import type { Soundscape } from '../audio/GameAudio';
import { damp, noise3 } from '../core/math';
import { World, anchor, cameraYaw, type Anchor } from '../world/World';
import type { Arcade } from './Arcade';
import type { MinigameId } from './registry';

/** How a session ended. `stars` is what the portal shows afterwards: 0 for a loss, 1 to 3 for a win. */
export interface Outcome {
  readonly won: boolean;
  readonly stars: 0 | 1 | 2 | 3;
  /** One line under the heading: the score, or what decided it. */
  readonly summary: string;
}

const _look = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * A game's camera on a flat screen: where it stands, what it looks at, how wide it sees. The game moves `eye` and
 * `target`; the real camera eases after them, and shakes when asked. In a headset the player's own head is the
 * camera, so only the seat (see `Minigame.seat`) applies.
 */
export class GameCamera {
  readonly eye = new THREE.Vector3(0, 1.5, 4);
  readonly target = new THREE.Vector3(0, 1, 0);
  /** Vertical field of view in degrees on a wide screen (tall screens widen it, as everywhere in the game). */
  fov = 50;
  /** How quickly the real camera follows, per second. */
  ease = 5;
  private readonly at = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private settled = false;
  private trauma = 0;
  /** Where the real camera was put last frame: the pointer's ray is cast from here. */
  private readonly placedAt = new THREE.Vector3();
  private readonly placedTurn = new THREE.Quaternion();

  /** The next frame starts where `eye` and `target` are, with no easing: a cut. */
  cut(): void {
    this.settled = false;
  }

  /** Adds a jolt, 0..1. Jolts add up and die away in under a second. */
  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** `motion` is 1, or less where the device asks for reduced motion. */
  apply(app: App, dt: number, time: number, motion: number): void {
    const k = this.settled ? 1 - Math.exp(-this.ease * dt) : 1;
    this.at.lerp(this.eye, k);
    this.look.lerp(this.target, k);
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    app.zoom = this.settled ? damp(app.zoom, 62 - this.fov, 8, dt) : 62 - this.fov;
    this.settled = true;
    if (app.renderer.xr.isPresenting) return;
    // the rig rests at the world's origin: the camera is placed in the world itself
    app.rig.position.set(0, 0, 0);
    app.rig.rotation.set(0, 0, 0);
    const s = this.trauma * this.trauma * motion, t = time * 31;
    const cam = app.camera;
    cam.position.copy(this.at).add(_look.set(noise3(t, 0, 0), noise3(0, t, 0), noise3(0, 0, t)).multiplyScalar(0.07 * s));
    cam.quaternion.setFromRotationMatrix(_m.lookAt(cam.position, this.look, UP));
    cam.quaternion.multiply(_q.setFromAxisAngle(_look.set(0, 0, 1), noise3(t, 7, 3) * 0.025 * s));
    this.placedAt.copy(cam.position);
    this.placedTurn.copy(cam.quaternion);
    cam.updateMatrixWorld(true);
  }

  /**
   * Puts the real camera back where this one last placed it. The first-person body stands at the seat and moves
   * the camera there every frame before the arcade runs: whatever reads the camera in between (the pointer's ray)
   * must see the picture as it was drawn.
   */
  restore(app: App): void {
    if (!this.settled || app.renderer.xr.isPresenting) return;
    app.rig.position.set(0, 0, 0);
    app.rig.rotation.set(0, 0, 0);
    app.camera.position.copy(this.placedAt);
    app.camera.quaternion.copy(this.placedTurn);
    app.rig.updateMatrixWorld(true);
  }
}

/**
 * One of the games behind Haven's portals: a world of its own, and a session that plays out in it.
 *
 * `play` is the session written top to bottom, like a chapter of the story: introduce, play, say how it went.
 * `tick` is the game itself, run every frame with that frame's input. Everything a session waits on goes through
 * the arcade (`this.arcade.wait`, `until`, `say`), so leaving the game or the whole arcade unwinds it from any point.
 */
export abstract class Minigame extends World {
  abstract override readonly id: MinigameId;
  readonly theme = 'haven' as const;
  /** Set by the arcade before the world is built. */
  arcade!: Arcade;
  readonly cam = new GameCamera();
  /** Where the player is put: in a headset this is where they stand, looking along its heading. */
  seat: Anchor = anchor(0, 0, 0, 0);
  /** How high their eyes are there, in a headset: the story's child height unless the game is played standing at something. */
  eyeHeight = 1.15;
  /** The music this game plays to. */
  abstract readonly soundscape: Soundscape;
  /** Scales the time `tick` is given: slow motion for a winning point. */
  timeScale = 1;
  /** Which of the game's stages is played next, from 0: each game has a few, and moves on to the next with each win. */
  level = 0;

  /** Plays one session from its introduction to its last moment. Rejects with Cancelled if the player leaves. */
  abstract play(): Promise<Outcome>;
  /** One frame of the game: `dt` already carries `timeScale`. */
  abstract tick(dt: number, time: number): void;

  /** `rotation.y` of the rig that faces the seat's heading. */
  get seatYaw(): number {
    return cameraYaw(this.seat);
  }
}
