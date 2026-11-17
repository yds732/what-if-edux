import * as THREE from 'three';
import type { App } from '../app/App';
import { angleDelta, clamp, damp } from '../core/math';
import { Signal } from '../core/tasks';
import type { Input } from '../input/Input';
import { cameraYaw, type Anchor } from '../world/World';

/** A twelve-year-old's eye level. */
export const EYE_STANDING = 1.36;
export const PLAYER_RADIUS = 0.28;
const WALK_SPEED = 2.5;
const PITCH_LIMIT = 1.35;

/**
 * The first-person body: where the player stands, where they look, how they walk. It owns the camera rig;
 * the story freezes it for cutscenes, seats it at desks and turns it gently toward what matters.
 */
export class Player {
  readonly position = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  eyeHeight = EYE_STANDING;
  /** Walking is allowed. */
  canMove = true;
  /** Looking around is allowed. */
  canLook = true;
  seated = false;
  /** Metres walked, for footsteps and for "you moved" checks. */
  travelled = 0;
  readonly onStep = new Signal<number>();
  /** In a headset: how far the real head is turned from the rig, so walking follows the gaze. */
  headYaw = 0;
  /** In a headset: lift applied to the floor so the eyes sit at `eyeHeight`. */
  xrFloor = 0;

  private readonly velocity = new THREE.Vector2();
  private bobPhase = 0;
  private bob = 0;
  private eye = EYE_STANDING;
  private turn: { yaw: number; pitch: number; left: number; total: number; fromYaw: number; fromPitch: number } | null = null;
  private lastStepAt = 0;
  private seatYaw: number | null = null;
  private readonly aimOrigin = new THREE.Vector3();
  private readonly aimDir = new THREE.Vector3();
  private aimSet = false;

  constructor(private readonly app: App, private readonly input: Input) {}

  teleport(a: Anchor, eyeHeight = EYE_STANDING): void {
    this.position.copy(a.position);
    this.yaw = cameraYaw(a);
    this.pitch = 0;
    this.eyeHeight = this.eye = eyeHeight;
    this.velocity.set(0, 0);
    this.seated = false;
    this.seatYaw = null;
    this.turn = null;
    this.apply();
  }

  /** Sits at an anchor: no walking, and the head only turns so far from the seat's facing. */
  sit(a: Anchor, eyeHeight: number): void {
    this.position.copy(a.position);
    this.seated = true;
    this.seatYaw = cameraYaw(a);
    this.eyeHeight = eyeHeight;
    this.velocity.set(0, 0);
  }

  stand(eyeHeight = EYE_STANDING): void {
    this.seated = false;
    this.seatYaw = null;
    this.eyeHeight = eyeHeight;
  }

  /** Eases the view toward a world point over `seconds`; any look input from the player cancels it. */
  faceToward(target: THREE.Vector3, seconds = 0.9): void {
    const eye = this.eyePosition(_v);
    const dx = target.x - eye.x, dy = target.y - eye.y, dz = target.z - eye.z;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -PITCH_LIMIT, PITCH_LIMIT);
    this.turn = { yaw, pitch, left: seconds, total: seconds, fromYaw: this.yaw, fromPitch: this.pitch };
  }

  eyePosition(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.position.x, this.position.y + this.eye + this.bob, this.position.z);
  }

  /** Unit vector the player is looking along. */
  forward(out: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  /** In a headset the player aims with a controller: pass its ray each frame, or nulls to aim with the eyes again. */
  aimFrom(origin: THREE.Vector3 | null, direction: THREE.Vector3 | null): void {
    this.aimSet = !!origin && !!direction;
    if (origin && direction) {
      this.aimOrigin.copy(origin);
      this.aimDir.copy(direction);
    }
  }

  /** Unit vector things are thrown and pointed along: the controller's ray in a headset, the view otherwise. */
  aim(out: THREE.Vector3): THREE.Vector3 {
    return this.aimSet ? out.copy(this.aimDir) : this.forward(out);
  }

  distanceTo(x: number, z: number): number {
    return Math.hypot(this.position.x - x, this.position.z - z);
  }

  update(dt: number): void {
    const input = this.input;
    const xr = this.app.renderer.xr.isPresenting;

    // ---- look ----
    if (this.canLook && (input.look.x !== 0 || input.look.y !== 0)) {
      this.yaw += input.look.x;
      this.pitch = clamp(this.pitch + input.look.y, -PITCH_LIMIT, PITCH_LIMIT);
      this.turn = null;
    }
    if (this.turn) {
      const t = this.turn;
      t.left -= dt;
      const k = 1 - Math.max(0, t.left) / t.total;
      const s = k * k * (3 - 2 * k);
      this.yaw = t.fromYaw + angleDelta(t.fromYaw, t.yaw) * s;
      this.pitch = t.fromPitch + (t.pitch - t.fromPitch) * s;
      if (t.left <= 0) this.turn = null;
    }
    if (this.seatYaw !== null) {
      // a seated head turns about 130 degrees either way
      const off = clamp(angleDelta(this.seatYaw, this.yaw), -2.3, 2.3);
      this.yaw = this.seatYaw + off;
    }

    // ---- walk ----
    let mx = 0, my = 0;
    if (this.canMove && !this.seated) {
      mx = input.move.x;
      my = input.move.y;
    }
    const heading = this.yaw + (xr ? this.headYaw : 0);
    const sin = Math.sin(heading), cos = Math.cos(heading);
    const wantX = (mx * cos - my * sin) * WALK_SPEED;
    const wantZ = (-mx * sin - my * cos) * WALK_SPEED;
    const accel = mx !== 0 || my !== 0 ? 11 : 14;
    this.velocity.x = damp(this.velocity.x, wantX, accel, dt);
    this.velocity.y = damp(this.velocity.y, wantZ, accel, dt);
    const speed = this.velocity.length();
    if (speed > 0.01) {
      const before = _p.set(this.position.x, this.position.z);
      const next = { x: this.position.x + this.velocity.x * dt, z: this.position.z + this.velocity.y * dt };
      this.app.world?.colliders.resolve(next, PLAYER_RADIUS);
      this.position.x = next.x;
      this.position.z = next.z;
      const moved = Math.hypot(next.x - before.x, next.z - before.y);
      this.travelled += moved;
      // sliding along a wall should not leave stored speed pushing into it
      if (dt > 0) this.velocity.set((next.x - before.x) / dt, (next.z - before.y) / dt);
      this.bobPhase += moved * 3.4;
      if (this.travelled - this.lastStepAt > 0.72) {
        this.lastStepAt = this.travelled;
        this.onStep.emit(speed / WALK_SPEED);
      }
    }
    const walking = clamp(speed / WALK_SPEED, 0, 1);
    this.bob = xr ? 0 : damp(this.bob, Math.sin(this.bobPhase * 2) * 0.022 * walking, 14, dt);
    this.eye = damp(this.eye, this.eyeHeight, 6, dt);
    this.apply();
  }

  private apply(): void {
    const { rig, camera, renderer } = this.app;
    rig.rotation.set(0, this.yaw, 0);
    if (renderer.xr.isPresenting) {
      // the headset drives the camera; the rig is the floor under it
      rig.position.set(this.position.x, this.position.y + this.xrFloor, this.position.z);
      return;
    }
    rig.position.copy(this.position);
    camera.position.set(0, this.eye + this.bob, 0);
    camera.rotation.set(this.pitch, 0, 0, 'YXZ');
  }
}

const _v = new THREE.Vector3();
const _p = new THREE.Vector2();
