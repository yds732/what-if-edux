import * as THREE from 'three';
import type { Input } from '../input/Input';

const _ndc = new THREE.Vector2();
const _caster = new THREE.Raycaster();

export class Pointer {
  readonly ray = new THREE.Ray();
  readonly ndc = new THREE.Vector2();
  active = false;
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
    this.active = p.active || this.released || (input.mode === 'mouse' && (p.x !== 0 || p.y !== 0));
    this.ndc.set((p.x / Math.max(1, canvas.clientWidth)) * 2 - 1, -(p.y / Math.max(1, canvas.clientHeight)) * 2 + 1);
    _caster.setFromCamera(_ndc.copy(this.ndc), camera);
    this.ray.copy(_caster.ray);
  }

  onPlane(plane: THREE.Plane, out: THREE.Vector3): THREE.Vector3 | null {
    return this.ray.intersectPlane(plane, out);
  }

  consume(): void {
    this.pressed = this.released = false;
  }
}
