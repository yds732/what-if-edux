import * as THREE from 'three';
import type { QualitySettings } from '../app/quality';
import type { Character } from '../characters/Character';
import { makeLook, type FrameInput, type Look } from '../render/PostPipeline';
import type { ThemeName } from '../ui/draw';
import { Colliders } from './colliders';

export interface BuildContext {
  readonly renderer: THREE.WebGLRenderer;
  readonly quality: QualitySettings;
  /** Yields to the browser so a loader can repaint; call between heavy build steps. */
  step(label?: string): Promise<void>;
}

/** A named place and facing in a world: spawn points, seats, marks for characters. */
export interface Anchor {
  readonly position: THREE.Vector3;
  /** Compass heading in radians: 0 looks toward -Z, a quarter turn looks toward +X. */
  readonly heading: number;
}

export const anchor = (x: number, y: number, z: number, headingDeg = 0): Anchor => ({
  position: new THREE.Vector3(x, y, z),
  heading: (headingDeg * Math.PI) / 180,
});

/** An anchor at (x, y, z) that looks at the ground point (tx, tz). */
export const anchorToward = (x: number, y: number, z: number, tx: number, tz: number): Anchor => ({
  position: new THREE.Vector3(x, y, z),
  heading: Math.atan2(tx - x, -(tz - z)),
});

/** `rotation.y` that points a camera (which looks down -Z) along an anchor's heading. */
export const cameraYaw = (a: Anchor): number => -a.heading;
/** `rotation.y` that points a character (which faces +Z) along an anchor's heading. */
export const characterYaw = (a: Anchor): number => Math.PI - a.heading;

export interface FrameContext {
  readonly dt: number;
  readonly time: number;
  readonly camera: THREE.PerspectiveCamera;
  /** Height of the canvas in CSS pixels, for sizing point sprites. */
  readonly pixelHeight: number;
}

/** One self-contained place: its scene, the look it is graded with, where the player can walk, who is there. */
export abstract class World {
  abstract readonly id: string;
  /** Which interface skin belongs here. */
  abstract readonly theme: ThemeName;
  readonly scene = new THREE.Scene();
  readonly look: Look = makeLook();
  readonly colliders = new Colliders();
  /** Everyone in the world; they are animated every frame. */
  readonly people: Character[] = [];
  /** People by the name the script calls them. */
  readonly cast: Record<string, Character> = {};
  near = 0.05;
  far = 200;
  /** Colour the XR path fades through and the flat path clears to. */
  readonly clearColor = new THREE.Color(0x000000);
  prepass: FrameInput['prepass'] = null;

  abstract build(ctx: BuildContext): Promise<void>;

  /** Puts away whatever a scene in progress may have left out (a marker, a message, a caller): the stage as built. */
  reset(): void {}

  protected addPerson(name: string, person: Character): Character {
    this.people.push(person);
    this.cast[name] = person;
    this.scene.add(person.root);
    return person;
  }

  update(frame: FrameContext): void {
    for (const p of this.people) if (p.root.visible) p.update(frame.dt, frame.time);
  }
}
