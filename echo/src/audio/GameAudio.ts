import type * as THREE from 'three';
import type { SpeakerId } from '../story/script';

export type SfxName =
  | 'uiHover' | 'uiSelect' | 'advance' | 'objective' | 'card' | 'result' | 'notify'
  | 'pickup' | 'putDown' | 'sit' | 'footstep' | 'bell' | 'phoneTap' | 'holoOpen' | 'holoClose' | 'vote' | 'poster'
  | 'headsetOn' | 'headsetOff' | 'wipe'
  | 'orbAppear' | 'orbTake' | 'orbThrow' | 'ringHit' | 'ringRim' | 'orbFizzle' | 'bridgeBuild' | 'bridgeComplete'
  | 'firework' | 'gateOpen' | 'cheer' | 'fail' | 'reveal' | 'taskDone';

/** Which bed of ambience and music is playing. */
export type Soundscape = 'silence' | 'title' | 'classroom' | 'classroomWarm' | 'bedroom' | 'haven' | 'havenEvening' | 'havenFestival' | 'unease' | 'ending';

export interface SfxOptions {
  /** World position, for sounds that come from somewhere. */
  at?: THREE.Vector3;
  gain?: number;
  /** Playback pitch multiplier. */
  pitch?: number;
}

/** Everything the game asks of its sound: the story never touches Web Audio directly. */
export interface GameAudio {
  /** Must be called from a user gesture before anything is audible. */
  unlock(): void;
  setSoundscape(scape: Soundscape, fadeSeconds?: number): void;
  sfx(name: SfxName, options?: SfxOptions): void;
  /** One syllable of a character's voice, called as their line types out. */
  voice(speaker: SpeakerId, char: string): void;
  /** Continuous sounds driven by a 0..1 value: the hum of a charging throw. */
  setCharge(amount: number): void;
  /** Keeps the listener at the camera. */
  update(dt: number, camera: THREE.Camera): void;
  setVolume(master: number): void;
  setPaused(paused: boolean): void;
}

/** Stand-in used by captures and tests, and until the player has made a gesture. */
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
