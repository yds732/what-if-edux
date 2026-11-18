import * as THREE from 'three';
import type { Input } from '../input/Input';

const _ndc = new THREE.Vector2();
const _caster = new THREE.Raycaster();

/**
 * What the player points with, as one ray in the world: the cursor through the camera, a finger on the glass, or
 * the controller in a headset. Every arcade game is played with this ray and one button, so each of them works on
 * all three.
 */
export class Pointer {
  readonly ray = new THREE.Ray();
  /** On a flat screen, where the pointer is: -1..1 across and up the picture. */
  readonly ndc = new THREE.Vector2();
  /** The ray means something this frame. False until a mouse has moved, and while no finger is on the glass. */
  active = false;
  /** The button (mouse button, finger, trigger) is down; went down this frame; came up this frame. */
  down = false;
  pressed = false;
  released = false;

  update(input: Input, camera: THREE.Camera, canvas: HTMLCanvasElement): void {
    this.down = input.held.has('primary');
    this.pressed = input.pressed.has('primary');
    this.released = input.released.has('primary');
    if (input.xrRay) {
      this.ray.copy(input.xrRay);
      this.active = true;
      return;
    }
    const p = input.pointer;
    // a finger that has just lifted still points at where it was
    this.active = p.active || this.released || (input.mode === 'mouse' && (p.x !== 0 || p.y !== 0));
    this.ndc.set((p.x / Math.max(1, canvas.clientWidth)) * 2 - 1, -(p.y / Math.max(1, canvas.clientHeight)) * 2 + 1);
    _caster.setFromCamera(_ndc.copy(this.ndc), camera);
    this.ray.copy(_caster.ray);
  }

  /** Where the ray meets a plane, or null if it runs away from it. */
  onPlane(plane: THREE.Plane, out: THREE.Vector3): THREE.Vector3 | null {
    return this.ray.intersectPlane(plane, out);
  }

  /** Spends this frame's press, so that whatever reads the pointer next does not act on it too. */
  consume(): void {
    this.pressed = this.released = false;
  }
}
