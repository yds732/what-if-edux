import * as THREE from 'three';
import type { App } from '../app/App';
import { angleDelta, clamp, damp } from '../core/math';
import { Signal } from '../core/tasks';
import type { Input } from '../input/Input';
import { cameraYaw, type Anchor } from '../world/World';

export const EYE_STANDING = 1.15;
export const PLAYER_RADIUS = 0.28;
const WALK_SPEED = 2.5;
const PITCH_LIMIT = 1.35;

export class Player {
  readonly position = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  eyeHeight = EYE_STANDING;
  canMove = true;
  canLook = true;
  seated = false;
  travelled = 0;
  readonly onStep = new Signal<number>();
  headYaw = 0;
  xrFloor = 0;

  private readonly velocity = new THREE.Vector2();
  private bobPhase = 0;
  private life = 0;
  private readonly breathing = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1;
  private bob = 0;
  private eye = EYE_STANDING;
  private floorY = 0;
  private turn: { yaw: number; pitch: number; left: number; total: number; fromYaw: number; fromPitch: number } | null = null;
  private lastStepAt = 0;
  private seatYaw: number | null = null;
  private readonly aimOrigin = new THREE.Vector3();
  private readonly aimDir = new THREE.Vector3();
  private aimSet = false;

  constructor(private readonly app: App, private readonly input: Input) {}

  teleport(a: Anchor, eyeHeight = EYE_STANDING): void {
    this.position.copy(a.position);
    this.floorY = a.position.y;
    this.yaw = cameraYaw(a);
    this.pitch = 0;
    this.eyeHeight = this.eye = eyeHeight;
    this.velocity.set(0, 0);
    this.seated = false;
    this.seatYaw = null;
    this.turn = null;
    this.apply();
  }

  sit(a: Anchor, eyeHeight: number): void {
    this.position.copy(a.position);
    this.floorY = a.position.y;
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

  forward(out: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  aimFrom(origin: THREE.Vector3 | null, direction: THREE.Vector3 | null): void {
    this.aimSet = !!origin && !!direction;
    if (origin && direction) {
      this.aimOrigin.copy(origin);
      this.aimDir.copy(direction);
    }
  }

  aim(out: THREE.Vector3): THREE.Vector3 {
    return this.aimSet ? out.copy(this.aimDir) : this.forward(out);
  }

  distanceTo(x: number, z: number): number {
    return Math.hypot(this.position.x - x, this.position.z - z);
  }

  update(dt: number): void {
    const input = this.input;
    const xr = this.app.renderer.xr.isPresenting;

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
      const off = clamp(angleDelta(this.seatYaw, this.yaw), -2.3, 2.3);
      this.yaw = this.seatYaw + off;
    }

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
      if (dt > 0) this.velocity.set((next.x - before.x) / dt, (next.z - before.y) / dt);
      this.bobPhase += moved * 3.4;
      if (this.travelled - this.lastStepAt > 0.72) {
        this.lastStepAt = this.travelled;
        this.onStep.emit(speed / WALK_SPEED);
      }
    }
    if (!this.seated) {
      const ground = this.app.world?.colliders.groundAt(this.position.x, this.position.z, PLAYER_RADIUS) ?? null;
      this.position.y = damp(this.position.y, ground ?? this.floorY, 14, dt);
    }
    const walking = clamp(speed / WALK_SPEED, 0, 1);
    this.bob = xr ? 0 : damp(this.bob, Math.sin(this.bobPhase * 2) * 0.022 * walking, 14, dt);
    this.eye = damp(this.eye, this.eyeHeight, 6, dt);
    this.life += dt;
    this.apply();
  }

  private apply(): void {
    const { rig, camera, renderer } = this.app;
    rig.rotation.set(0, this.yaw, 0);
    if (renderer.xr.isPresenting) {
      rig.position.set(this.position.x, this.position.y + this.xrFloor, this.position.z);
      return;
    }
    rig.position.copy(this.position);
    const t = this.life, k = this.breathing;
    const breath = Math.sin((t * TAU) / BREATH_SECONDS);
    const lift = (0.006 * breath + 0.0015 * Math.sin(t * 0.83 + 1.3)) * k;
    const swayX = (0.0035 * Math.sin(t * 0.37 + 0.6) + 0.0012 * Math.sin(t * 1.13)) * k;
    const drift = {
      pitch: (0.0035 * breath + 0.0022 * Math.sin(t * 0.61 + 2.1) + 0.0008 * Math.sin(t * 1.9)) * k,
      yaw: (0.0028 * Math.sin(t * 0.43 + 0.4) + 0.0009 * Math.sin(t * 1.27 + 3)) * k,
      roll: (0.0016 * Math.sin(t * 0.29 + 1.7) + 0.0006 * Math.sin(t * 0.97)) * k,
    };
    camera.position.set(swayX, this.eye + this.bob + lift, 0);
    camera.rotation.set(this.pitch + drift.pitch, drift.yaw, drift.roll, 'YXZ');
  }
}

const BREATH_SECONDS = 4.6;
const TAU = Math.PI * 2;
const _v = new THREE.Vector3();
const _p = new THREE.Vector2();
