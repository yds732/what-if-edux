import type * as THREE from 'three';
import type { SpeakerId } from '../story/script';
import type { ArcadeSfx } from './arcadeSfx';

export type SfxName =
  | ArcadeSfx
  | 'uiHover' | 'uiSelect' | 'advance' | 'objective' | 'card' | 'result' | 'notify'
  | 'pickup' | 'putDown' | 'sit' | 'footstep' | 'bell' | 'phoneTap' | 'holoOpen' | 'holoClose' | 'vote' | 'poster'
  | 'headsetOn' | 'headsetOff' | 'wipe'
  | 'orbAppear' | 'orbTake' | 'orbThrow' | 'ringHit' | 'ringRim' | 'orbFizzle' | 'bridgeBuild' | 'bridgeComplete'
  | 'firework' | 'gateOpen' | 'cheer' | 'fail' | 'reveal' | 'taskDone';

export type Soundscape = 'silence' | 'title' | 'classroom' | 'classroomWarm' | 'bedroom' | 'haven' | 'havenEvening' | 'havenFestival' | 'unease' | 'ending' | ArcadeScape;

export type ArcadeScape = 'arcadeRally' | 'arcadeSprites' | 'arcadeLanterns' | 'arcadeDrift' | 'arcadeDusk';

export interface SfxOptions {
  at?: THREE.Vector3;
  gain?: number;
  pitch?: number;
}

export interface GameAudio {
  unlock(): void;
  setSoundscape(scape: Soundscape, fadeSeconds?: number): void;
  sfx(name: SfxName, options?: SfxOptions): void;
  voice(speaker: SpeakerId, char: string): void;
  setCharge(amount: number): void;
  update(dt: number, camera: THREE.Camera): void;
  setVolume(master: number): void;
  setPaused(paused: boolean): void;
}

export class NullAudio implements GameAudio {
  unlock(): void {}
  setSoundscape(): void {}
  sfx(): void {}
  voice(): void {}
  setCharge(): void {}
  update(): void {}
  setVolume(): void {}
  setPaused(): void {}
}
