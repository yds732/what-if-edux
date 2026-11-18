import * as THREE from 'three';
import type { App } from '../app/App';
import type { Soundscape } from '../audio/GameAudio';
import { damp, noise3 } from '../core/math';
import { World, anchor, cameraYaw, type Anchor } from '../world/World';
import type { Arcade } from './Arcade';
import type { MinigameId } from './registry';

export interface Outcome {
  readonly won: boolean;
  readonly stars: 0 | 1 | 2 | 3;
  readonly summary: string;
}

const _look = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

export class GameCamera {
  readonly eye = new THREE.Vector3(0, 1.5, 4);
  readonly target = new THREE.Vector3(0, 1, 0);
  fov = 50;
  ease = 5;
  private readonly at = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private settled = false;
  private trauma = 0;
  private readonly placedAt = new THREE.Vector3();
  private readonly placedTurn = new THREE.Quaternion();

  cut(): void {
    this.settled = false;
  }

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  apply(app: App, dt: number, time: number, motion: number): void {
    const k = this.settled ? 1 - Math.exp(-this.ease * dt) : 1;
    this.at.lerp(this.eye, k);
    this.look.lerp(this.target, k);
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    app.zoom = this.settled ? damp(app.zoom, 62 - this.fov, 8, dt) : 62 - this.fov;
    this.settled = true;
    if (app.renderer.xr.isPresenting) return;
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

  restore(app: App): void {
    if (!this.settled || app.renderer.xr.isPresenting) return;
    app.rig.position.set(0, 0, 0);
    app.rig.rotation.set(0, 0, 0);
    app.camera.position.copy(this.placedAt);
    app.camera.quaternion.copy(this.placedTurn);
    app.rig.updateMatrixWorld(true);
  }
}

export abstract class Minigame extends World {
  abstract override readonly id: MinigameId;
  readonly theme = 'haven' as const;
  arcade!: Arcade;
  readonly cam = new GameCamera();
  seat: Anchor = anchor(0, 0, 0, 0);
  eyeHeight = 1.15;
  abstract readonly soundscape: Soundscape;
  timeScale = 1;
  level = 0;

  abstract play(): Promise<Outcome>;
  abstract tick(dt: number, time: number): void;

  get seatYaw(): number {
    return cameraYaw(this.seat);
  }
}
