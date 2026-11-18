import * as THREE from 'three';
import type { App } from '../app/App';
import type { Input } from '../input/Input';
import type { Hud } from '../ui/Hud';

export interface Interactable {
  readonly position: THREE.Vector3;
  radius: number;
  reach: number;
  prompt: string;
  enabled: boolean;
  use(): void;
  onFocus?(focused: boolean): void;
}

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();
const _ndc = new THREE.Vector2();
const _ray = new THREE.Raycaster();

export class Interaction {
  readonly items = new Set<Interactable>();
  focus: Interactable | null = null;
  enabled = true;

  constructor(private readonly app: App, private readonly input: Input, private readonly hud: Hud) {}

  add(item: Interactable): Interactable {
    this.items.add(item);
    return item;
  }

  remove(item: Interactable): void {
    this.items.delete(item);
    if (this.focus === item) this.setFocus(null);
  }

  clear(): void {
    this.setFocus(null);
    this.items.clear();
  }

  private setFocus(item: Interactable | null): void {
    if (item === this.focus) return;
    this.focus?.onFocus?.(false);
    this.focus = item;
    item?.onFocus?.(true);
  }

  private aim(at: { x: number; y: number } | null): void {
    const xrRay = this.input.xrRay;
    if (xrRay) {
      _origin.copy(xrRay.origin);
      _dir.copy(xrRay.direction);
      return;
    }
    const cam = this.app.camera;
    if (at) {
      const c = this.app.canvas;
      _ndc.set((at.x / c.clientWidth) * 2 - 1, -(at.y / c.clientHeight) * 2 + 1);
    } else _ndc.set(0, 0);
    _ray.setFromCamera(_ndc, cam);
    _origin.copy(_ray.ray.origin);
    _dir.copy(_ray.ray.direction);
  }

  private pick(): Interactable | null {
    let best: Interactable | null = null, bestScore = Infinity;
    for (const item of this.items) {
      if (!item.enabled) continue;
      _to.subVectors(item.position, _origin);
      const along = _to.dot(_dir);
      if (along < 0.05 || along > item.reach + item.radius) continue;
      const off = Math.sqrt(Math.max(0, _to.lengthSq() - along * along));
      const tolerance = item.radius * 1.15 + along * 0.035;
      if (off > tolerance) continue;
      const score = off / tolerance + along * 0.02;
      if (score < bestScore) {
        bestScore = score;
        best = item;
      }
    }
    return best;
  }

  update(): void {
    const input = this.input, hud = this.hud;
    if (!this.enabled) {
      this.setFocus(null);
      hud.setFocus(false);
      hud.setPrompt(null);
      return;
    }
    const touch = input.mode === 'touch';
    const free = !input.locked && input.pointer.active;
    this.aim(free && !touch ? input.pointer : null);
    this.setFocus(this.pick());
    hud.setFocus(this.focus !== null);
    hud.setPrompt(this.focus ? this.focus.prompt : null);

    let used: Interactable | null = null;
    if (touch) {
      if (input.released.has('primary') && input.wasTap) {
        this.aim(input.pointer);
        used = this.pick() ?? this.focus;
      }
    } else if (input.pressed.has('interact') || input.pressed.has('primary')) {
      used = this.focus;
    }
    if (used) {
      input.pressed.delete('primary');
      input.pressed.delete('interact');
      used.use();
    }
  }
}
