import * as THREE from 'three';
import type { QualitySettings } from '../app/quality';
import type { AssetLibrary } from '../assets/AssetLibrary';
import type { Character } from '../characters/Character';
import { makeLook, type FrameInput, type Look, type ShaftSource } from '../render/PostPipeline';
import type { ThemeName } from '../ui/draw';
import { Colliders } from './colliders';

export interface BuildContext {
  readonly renderer: THREE.WebGLRenderer;
  readonly quality: QualitySettings;
  readonly assets: AssetLibrary;
  step(label?: string): Promise<void>;
}

export interface Anchor {
  readonly position: THREE.Vector3;
  readonly heading: number;
}

export const anchor = (x: number, y: number, z: number, headingDeg = 0): Anchor => ({
  position: new THREE.Vector3(x, y, z),
  heading: (headingDeg * Math.PI) / 180,
});

export const anchorToward = (x: number, y: number, z: number, tx: number, tz: number): Anchor => ({
  position: new THREE.Vector3(x, y, z),
  heading: Math.atan2(tx - x, -(tz - z)),
});

export const cameraYaw = (a: Anchor): number => -a.heading;
export const characterYaw = (a: Anchor): number => Math.PI - a.heading;

export interface FrameContext {
  readonly dt: number;
  readonly time: number;
  readonly camera: THREE.PerspectiveCamera;
  readonly pixelHeight: number;
}

export abstract class World {
  abstract readonly id: string;
  abstract readonly theme: ThemeName;
  readonly scene = new THREE.Scene();
  readonly look: Look = makeLook();
  readonly colliders = new Colliders();
  readonly people: Character[] = [];
  readonly cast: Record<string, Character> = {};
  near = 0.05;
  far = 200;
  readonly clearColor = new THREE.Color(0x000000);
  prepass: FrameInput['prepass'] = null;
  restFocus = 7;
  shafts: ShaftSource | null = null;

  abstract build(ctx: BuildContext): Promise<void>;

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
