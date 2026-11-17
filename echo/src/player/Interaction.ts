import * as THREE from 'three';
import type { App } from '../app/App';
import type { Input } from '../input/Input';
import type { Hud } from '../ui/Hud';

/** Something in the world the player can look at and use. */
export interface Interactable {
  /** World-space centre; its owner keeps this current if the thing moves. */
  readonly position: THREE.Vector3;
  /** Size of the target in metres: the ray may pass this close and still count. */
  radius: number;
  /** How far away it can be used from. */
  reach: number;
  prompt: string;
  enabled: boolean;
  use(): void;
  /** Lets the object light up while it is the thing being looked at. */
  onFocus?(focused: boolean): void;
}

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();
const _ndc = new THREE.Vector2();
const _ray = new THREE.Raycaster();

/**
 * Finds what the player is pointing at (the screen centre when the mouse is captured, the finger or cursor
 * otherwise) and turns a press into that thing's `use`.
 */
export class Interaction {
  readonly items = new Set<Interactable>();
  focus: Interactable | null = null;
  /** The story turns this off during dialogue and choices. */
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

  /** Ray through a canvas position in CSS pixels, or through the screen centre when `at` is null. */
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
      // forgiving: a small target far away is as easy to pick as a large one nearby
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
    // a free cursor or a finger aims where it is; a captured mouse aims at the screen centre
    const free = !input.locked && input.pointer.active;
    this.aim(free && !touch ? input.pointer : null);
    this.setFocus(this.pick());
    hud.setFocus(this.focus !== null);
    hud.setPrompt(this.focus ? this.focus.prompt : null);

    let used: Interactable | null = null;
    if (touch) {
      // on a touch screen you tap the thing itself
      if (input.released.has('primary') && input.wasTap) {
        this.aim(input.pointer);
        used = this.pick() ?? this.focus;
      }
    } else if (input.pressed.has('interact') || input.pressed.has('primary')) {
      used = this.focus;
    }
    if (used) {
      input.pressed.delete('primary'); // the press is spent: it must not also throw, or advance a line
      input.pressed.delete('interact');
      used.use();
    }
  }
}
