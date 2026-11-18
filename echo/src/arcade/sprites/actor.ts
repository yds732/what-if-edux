import * as THREE from 'three';
import { clamp01, damp, ease } from '../../core/math';
import { makeHalo } from '../../world/haven/atmosphere';
import { ownMaterials } from '../fx';
import type { Element, SpriteId } from './battle';

/** The light of each element: what its moves, its sparks and its name are drawn in. */
export const ELEMENT_COLOR: Record<Element, THREE.Color> = {
  ember: new THREE.Color(1.0, 0.55, 0.18),
  tide: new THREE.Color(0.3, 0.8, 1.0),
  bloom: new THREE.Color(1.0, 0.5, 0.75),
};
export const ELEMENT_HEX: Record<Element, string> = { ember: '#ffa24a', tide: '#5fd0ff', bloom: '#ff8fc4' };
export const ELEMENT_NAME: Record<Element, string> = { ember: 'Ember', tide: 'Tide', bloom: 'Bloom' };

/**
 * How each sprite carries itself. None of them has a skeleton: a sprite is one body, moved whole. So each is given
 * a way of being alive that suits its shape: the lantern hops, the ray banks as it hovers, the bell pulses like a
 * jellyfish, the moth trembles, the two heavy ones breathe and stamp.
 */
interface Manner {
  /** Metres it hangs above the ground at rest. */
  readonly hover: number;
  /** How far it bobs, and how fast. */
  readonly bob: number;
  readonly pace: number;
  /** Squash and stretch of its breathing: the bell's is large, a boulder's is slight. */
  readonly pulse: number;
  /** A fast tremble: a moth's wings, a flame. */
  readonly flutter: number;
  /** Leans into its sideways drift. */
  readonly bank: number;
  /** Size in the arena: the models are a child's toy size, and a duel wants them bigger. */
  readonly scale: number;
}

const MANNER: Record<SpriteId, Manner> = {
  cindle: { hover: 0.1, bob: 0.07, pace: 2.6, pulse: 0.03, flutter: 0.012, bank: 0.05, scale: 1.55 },
  kilnip: { hover: 0, bob: 0, pace: 1.7, pulse: 0.035, flutter: 0, bank: 0, scale: 1.7 },
  nimbray: { hover: 0.62, bob: 0.1, pace: 1.5, pulse: 0.02, flutter: 0, bank: 0.2, scale: 1.45 },
  dewbell: { hover: 0.5, bob: 0.12, pace: 1.3, pulse: 0.09, flutter: 0, bank: 0.04, scale: 1.5 },
  petalwing: { hover: 0.6, bob: 0.06, pace: 2.2, pulse: 0.02, flutter: 0.035, bank: 0.1, scale: 1.5 },
  tufflet: { hover: 0, bob: 0, pace: 1.3, pulse: 0.025, flutter: 0, bank: 0, scale: 1.7 },
};

const _v = new THREE.Vector3();

/** A sprite on the arena: its model, where it stands, and the few motions a duel asks of it. */
export class SpriteActor {
  /** Stands at the sprite's place and faces its opponent. */
  readonly root = new THREE.Group();
  /** Carries the model, and is what squashes, hops and falls over. */
  private readonly body = new THREE.Group();
  private readonly materials: THREE.MeshStandardMaterial[];
  private readonly manner: Manner;
  private readonly halo: THREE.Sprite;
  private readonly phase: number;
  /** Where on the arena it lives; `root` leaves it only to lunge. */
  readonly home = new THREE.Vector3();
  private shown = 0;
  private wantShown = 0;
  private flash = 0;
  private recoil = 0;
  /** A leap in progress: how high, and how far through it (1 is landed). */
  private hopHeight = 0;
  private hopAt = 1;
  private lunge: { to: THREE.Vector3; t: number; duration: number } | null = null;
  private fallen = 0;
  private falling = false;
  private readonly tall: number;

  constructor(readonly id: SpriteId, readonly element: Element, model: THREE.Group, size: readonly [number, number, number]) {
    this.manner = MANNER[id];
    this.phase = id.length * 1.7 + id.charCodeAt(0);
    this.materials = ownMaterials(model);
    for (const m of this.materials) m.emissive = new THREE.Color(0, 0, 0);
    this.tall = size[1] * this.manner.scale;
    this.body.add(model);
    this.body.scale.setScalar(this.manner.scale);
    this.root.add(this.body);
    this.halo = makeHalo(ELEMENT_COLOR[element].getHex(), this.tall * 3.2, 0.22);
    this.halo.position.y = this.tall * 0.5 + this.manner.hover;
    this.root.add(this.halo);
    this.root.visible = false;
  }

  /** The middle of its body, in the world: where things aimed at it land. */
  centre(out: THREE.Vector3): THREE.Vector3 {
    return this.root.getWorldPosition(out).add(_v.set(0, this.manner.hover + this.tall * 0.5, 0));
  }

  /** How tall it stands in the arena, hover included: where a name or a number floats. */
  get top(): number {
    return this.manner.hover + this.tall;
  }

  place(at: THREE.Vector3, facing: THREE.Vector3): void {
    this.home.copy(at);
    this.root.position.copy(at);
    this.root.rotation.y = Math.atan2(facing.x - at.x, facing.z - at.z);
  }

  /** Arrives: grows out of a point of light. */
  enter(): void {
    this.root.visible = true;
    this.falling = false;
    this.fallen = 0;
    this.shown = 0;
    this.wantShown = 1;
    this.body.rotation.set(0, 0, 0);
    for (const m of this.materials) {
      m.transparent = false;
      m.opacity = 1;
    }
  }

  /** Leaves: shrinks back into light (called back to the bench). */
  leave(): void {
    this.wantShown = 0;
  }

  /** Knocked out: topples and fades. */
  faint(): void {
    this.falling = true;
    for (const m of this.materials) m.transparent = true;
  }

  /** Darts at a point and back, over `duration` seconds: a knock, or the wind-up to a throw. */
  dart(to: THREE.Vector3, duration = 0.42): void {
    this.lunge = { to: to.clone(), t: 0, duration };
  }

  /** A small leap on the spot: delight, or the kick of a move going off. */
  jump(height = 0.35): void {
    this.hopHeight = height;
    this.hopAt = 0;
  }

  /** Struck: thrown back a little, flashing white. */
  struck(strength = 1): void {
    this.flash = Math.min(1.4, this.flash + strength);
    this.recoil = Math.min(1, this.recoil + 0.6 * strength);
  }

  get gone(): boolean {
    return !this.root.visible;
  }

  update(dt: number, time: number): void {
    if (!this.root.visible) return;
    const m = this.manner, t = time * m.pace + this.phase;
    this.shown = damp(this.shown, this.wantShown, 9, dt);
    if (this.wantShown === 0 && this.shown < 0.02) {
      this.root.visible = false;
      return;
    }
    this.flash = Math.max(0, this.flash - dt * 4.5);
    this.recoil = damp(this.recoil, 0, 7, dt);
    this.hopAt = Math.min(1, this.hopAt + dt / 0.46);

    // ---- where it is: at home, unless it is darting at something ----
    this.root.position.copy(this.home);
    if (this.lunge) {
      const l = this.lunge;
      l.t += dt;
      const k = clamp01(l.t / l.duration);
      // out fast, back slower: most of the way there at a third of the time
      const reach = k < 0.34 ? ease.outCubic(k / 0.34) : 1 - ease.inOutQuad((k - 0.34) / 0.66);
      this.root.position.lerpVectors(this.home, l.to, reach * 0.72);
      if (k >= 1) this.lunge = null;
    }

    // ---- how it holds itself ----
    const breath = Math.sin(t * 1.7), drift = Math.sin(t * 0.9 + 1.3);
    const squash = 1 + m.pulse * breath;
    const body = this.body;
    body.position.set(drift * m.bank * 0.3, m.hover + m.bob * Math.sin(t) + this.hopHeight * 4 * this.hopAt * (1 - this.hopAt), -this.recoil * 0.35);
    body.rotation.z = -drift * m.bank + Math.sin(time * 31 + this.phase) * m.flutter + this.fallen * 1.2;
    body.rotation.x = -this.recoil * 0.5 + Math.sin(time * 27 + this.phase * 2) * m.flutter * 0.6;
    // breathing keeps its volume: taller is thinner
    const grow = this.shown * (2 - this.shown) * (1 + 0.25 * (1 - this.shown));
    body.scale.set((m.scale * grow) / Math.sqrt(squash), m.scale * grow * squash * (1 - 0.12 * this.recoil), (m.scale * grow) / Math.sqrt(squash));

    if (this.falling) {
      this.fallen = Math.min(1, this.fallen + dt * 1.6);
      body.position.y -= this.fallen * m.hover;
      for (const mat of this.materials) mat.opacity = 1 - ease.inQuad(this.fallen);
      if (this.fallen >= 1) this.root.visible = false;
    }
    const lit = this.flash * this.flash;
    for (const mat of this.materials) mat.emissive.setScalar(lit * 0.9);
    this.halo.material.opacity = this.shown * (1 - this.fallen);
  }
}
