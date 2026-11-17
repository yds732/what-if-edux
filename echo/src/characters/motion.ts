import type { BoneName } from './skeleton';

/**
 * Poses and gestures as data. Angles are degrees in YXZ order on bones that are axis-aligned in bind pose:
 *   x  pitch: negative swings an arm or thigh forward, positive nods the head down
 *   y  yaw:   positive turns toward the character's left (+X)
 *   z  roll:  positive lifts the left arm away from the body (use the negative for the right arm)
 */
type Angles = readonly [x: number, y: number, z: number];

export interface Pose {
  readonly bones: Partial<Record<BoneName, Angles>>;
  /** Offset of the hips from standing height; `seated` poses are lowered onto the seat by the character. */
  readonly hipsY: number;
  readonly hipsZ: number;
  readonly seated?: boolean;
}

export type PoseName = 'stand' | 'standOpen' | 'sit' | 'sitDesk' | 'sitDeskL' | 'sitDeskR' | 'sitLean';

/**
 * Seated at a classroom table (top 0.585 m, its edge 0.15 m in front of the hips): angles solved against the cast's
 * measured arms so the wrists rest on the top and the elbows stay behind its edge, clear of the wood.
 */
const SEATED_LEGS = { legL: [-80, 0, 4], legR: [-80, 0, -4], shinL: [82, 0, 0], shinR: [82, 0, 0] } as const;
const ON_DESK_L: Angles = [-56, 0, 9], FORE_ON_DESK_L: Angles = [-48, 0, -18];
const ON_DESK_R: Angles = [-56, 0, -9], FORE_ON_DESK_R: Angles = [-48, 0, 18];
/** An arm left hanging at the side, the hand by the seat. */
const AT_SIDE_L: Angles = [-6, 0, 11], FORE_AT_SIDE_L: Angles = [-16, 0, 0];
const AT_SIDE_R: Angles = [-6, 0, -11], FORE_AT_SIDE_R: Angles = [-16, 0, 0];

export const POSES: Record<PoseName, Pose> = {
  stand: {
    hipsY: 0, hipsZ: 0,
    bones: { armL: [-3, 0, 8], armR: [-3, 0, -8], foreL: [-13, 0, 0], foreR: [-13, 0, 0], legL: [0, 0, 2.5], legR: [0, 0, -2.5], head: [1, 0, 0] },
  },
  /** Arms a little away from the body, palms forward: a companion's open welcome. */
  standOpen: {
    hipsY: 0, hipsZ: 0,
    bones: { armL: [-8, 0, 16], armR: [-8, 0, -16], foreL: [-24, 0, 0], foreR: [-24, 0, 0], legL: [0, 0, 3], legR: [0, 0, -3], head: [-2, 0, 0], chest: [-2, 0, 0] },
  },
  sit: {
    hipsY: 0, hipsZ: 0, seated: true,
    bones: {
      legL: [-80, 0, 4], legR: [-80, 0, -4], shinL: [80, 0, 0], shinR: [80, 0, 0],
      armL: [-16, 0, 7], armR: [-16, 0, -7], foreL: [-58, 0, -12], foreR: [-58, 0, 12], spine: [2, 0, 0],
    },
  },
  /** Both forearms resting on the table. */
  sitDesk: {
    hipsY: 0, hipsZ: 0, seated: true,
    bones: { ...SEATED_LEGS, armL: ON_DESK_L, foreL: FORE_ON_DESK_L, armR: ON_DESK_R, foreR: FORE_ON_DESK_R, spine: [8, 0, 0], chest: [4, 0, 0], head: [-6, 0, 0] },
  },
  /** The left forearm on the table, the right arm down at the side. */
  sitDeskL: {
    hipsY: 0, hipsZ: 0, seated: true,
    bones: { ...SEATED_LEGS, armL: ON_DESK_L, foreL: FORE_ON_DESK_L, armR: AT_SIDE_R, foreR: FORE_AT_SIDE_R, spine: [8, 0, -2], chest: [4, 0, -2], head: [-6, 0, 2] },
  },
  /** The right forearm on the table, the left arm down at the side. */
  sitDeskR: {
    hipsY: 0, hipsZ: 0, seated: true,
    bones: { ...SEATED_LEGS, armL: AT_SIDE_L, foreL: FORE_AT_SIDE_L, armR: ON_DESK_R, foreR: FORE_ON_DESK_R, spine: [8, 0, 2], chest: [4, 0, 2], head: [-6, 0, -2] },
  },
  /** Leaning in over the table, forearms on it and hands drawn together: interested. */
  sitLean: {
    hipsY: 0, hipsZ: 0, seated: true,
    bones: {
      legL: [-80, 0, 5], legR: [-80, 0, -5], shinL: [86, 0, 0], shinR: [86, 0, 0],
      armL: [-46, 0, 12], armR: [-46, 0, -12], foreL: [-64, 0, -30], foreR: [-64, 0, 30], spine: [12, 0, 0], chest: [4, 0, 0], head: [-12, 0, 0],
    },
  },
};

type Key = readonly [t: number, x: number, y: number, z: number];

export interface Gesture {
  readonly duration: number;
  readonly loop?: boolean;
  readonly tracks: Partial<Record<BoneName, readonly Key[]>>;
  /** Vertical lift of the hips over the gesture, metres. */
  readonly hop?: (t: number) => number;
}

export type GestureName =
  | 'wave' | 'nod' | 'shake' | 'cheer' | 'clap' | 'think' | 'shrug' | 'present' | 'point' | 'handToChest' | 'fidget' | 'thumbsUp' | 'beckon' | 'slump';

const hopCurve = (t: number): number => Math.max(0, Math.sin(t * Math.PI * 3)) * 0.06 * (1 - t * 0.4);

export const GESTURES: Record<GestureName, Gesture> = {
  wave: {
    duration: 2.1,
    tracks: {
      armR: [[0, -3, 0, -8], [0.16, -18, 0, -96], [0.88, -18, 0, -96], [1, -3, 0, -8]],
      foreR: [[0, -13, 0, 0], [0.16, -20, 0, -96], [0.3, -20, 0, -62], [0.44, -20, 0, -100], [0.58, -20, 0, -62], [0.72, -20, 0, -100], [0.88, -20, 0, -80], [1, -13, 0, 0]],
      head: [[0, 1, 0, 0], [0.2, -3, 0, 5], [0.85, -3, 0, 5], [1, 1, 0, 0]],
    },
  },
  nod: { duration: 0.95, tracks: { head: [[0, 1, 0, 0], [0.22, 15, 0, 0], [0.45, -2, 0, 0], [0.66, 11, 0, 0], [1, 1, 0, 0]], neck: [[0, 0, 0, 0], [0.22, 5, 0, 0], [0.45, 0, 0, 0], [0.66, 4, 0, 0], [1, 0, 0, 0]] } },
  shake: { duration: 1.2, tracks: { head: [[0, 1, 0, 0], [0.18, 3, 17, 0], [0.42, 3, -17, 0], [0.64, 3, 12, 0], [0.84, 3, -8, 0], [1, 1, 0, 0]] } },
  cheer: {
    duration: 1.7, hop: hopCurve,
    tracks: {
      armL: [[0, -3, 0, 8], [0.14, -30, 0, 150], [0.82, -24, 0, 142], [1, -3, 0, 8]],
      armR: [[0, -3, 0, -8], [0.14, -30, 0, -150], [0.82, -24, 0, -142], [1, -3, 0, -8]],
      foreL: [[0, -13, 0, 0], [0.14, -30, 0, 22], [0.4, -12, 0, 6], [0.6, -30, 0, 22], [0.82, -14, 0, 8], [1, -13, 0, 0]],
      foreR: [[0, -13, 0, 0], [0.14, -30, 0, -22], [0.4, -12, 0, -6], [0.6, -30, 0, -22], [0.82, -14, 0, -8], [1, -13, 0, 0]],
      head: [[0, 1, 0, 0], [0.15, -14, 0, 0], [0.82, -10, 0, 0], [1, 1, 0, 0]],
      chest: [[0, 0, 0, 0], [0.15, -7, 0, 0], [0.82, -5, 0, 0], [1, 0, 0, 0]],
    },
  },
  clap: {
    duration: 1.5,
    tracks: {
      armL: [[0, -3, 0, 8], [0.14, -48, -24, 4], [0.86, -48, -24, 4], [1, -3, 0, 8]],
      armR: [[0, -3, 0, -8], [0.14, -48, 24, -4], [0.86, -48, 24, -4], [1, -3, 0, -8]],
      foreL: [[0, -13, 0, 0], [0.14, -72, 0, -8], [0.26, -72, 0, -30], [0.38, -72, 0, -8], [0.5, -72, 0, -30], [0.62, -72, 0, -8], [0.74, -72, 0, -30], [0.86, -72, 0, -8], [1, -13, 0, 0]],
      foreR: [[0, -13, 0, 0], [0.14, -72, 0, 8], [0.26, -72, 0, 30], [0.38, -72, 0, 8], [0.5, -72, 0, 30], [0.62, -72, 0, 8], [0.74, -72, 0, 30], [0.86, -72, 0, 8], [1, -13, 0, 0]],
    },
  },
  think: {
    duration: 2.6,
    tracks: {
      armR: [[0, -3, 0, -8], [0.18, -40, 22, -6], [0.84, -40, 22, -6], [1, -3, 0, -8]],
      foreR: [[0, -13, 0, 0], [0.18, -128, 0, 20], [0.84, -128, 0, 20], [1, -13, 0, 0]],
      armL: [[0, -3, 0, 8], [0.2, -22, -30, 6], [0.84, -22, -30, 6], [1, -3, 0, 8]],
      foreL: [[0, -13, 0, 0], [0.2, -84, 0, -30], [0.84, -84, 0, -30], [1, -13, 0, 0]],
      head: [[0, 1, 0, 0], [0.2, 6, 10, 6], [0.84, 6, 10, 6], [1, 1, 0, 0]],
    },
  },
  shrug: {
    duration: 1.5,
    tracks: {
      armL: [[0, -3, 0, 8], [0.25, -10, 0, 26], [0.7, -10, 0, 26], [1, -3, 0, 8]],
      armR: [[0, -3, 0, -8], [0.25, -10, 0, -26], [0.7, -10, 0, -26], [1, -3, 0, -8]],
      foreL: [[0, -13, 0, 0], [0.25, -74, 30, 0], [0.7, -74, 30, 0], [1, -13, 0, 0]],
      foreR: [[0, -13, 0, 0], [0.25, -74, -30, 0], [0.7, -74, -30, 0], [1, -13, 0, 0]],
      head: [[0, 1, 0, 0], [0.25, 2, 0, 9], [0.7, 2, 0, 9], [1, 1, 0, 0]],
    },
  },
  /** One open hand toward what is being shown. */
  present: {
    duration: 2.4,
    tracks: {
      armR: [[0, -3, 0, -8], [0.2, -34, -8, -46], [0.8, -34, -8, -46], [1, -3, 0, -8]],
      foreR: [[0, -13, 0, 0], [0.2, -46, -30, 0], [0.8, -46, -30, 0], [1, -13, 0, 0]],
      chest: [[0, 0, 0, 0], [0.2, 0, -8, 0], [0.8, 0, -8, 0], [1, 0, 0, 0]],
    },
  },
  point: {
    duration: 1.8,
    tracks: {
      armR: [[0, -3, 0, -8], [0.2, -74, 8, -10], [0.8, -74, 8, -10], [1, -3, 0, -8]],
      foreR: [[0, -13, 0, 0], [0.2, -8, 0, 0], [0.8, -8, 0, 0], [1, -13, 0, 0]],
    },
  },
  handToChest: {
    duration: 2.2,
    tracks: {
      armR: [[0, -3, 0, -8], [0.2, -30, 34, -10], [0.82, -30, 34, -10], [1, -3, 0, -8]],
      foreR: [[0, -13, 0, 0], [0.2, -112, 0, 26], [0.82, -112, 0, 26], [1, -13, 0, 0]],
      head: [[0, 1, 0, 0], [0.2, 5, 0, -4], [0.82, 5, 0, -4], [1, 1, 0, 0]],
    },
  },
  /** Rubbing the back of the neck: nervous. */
  fidget: {
    duration: 2.8,
    tracks: {
      armR: [[0, -3, 0, -8], [0.2, -40, -20, -128], [0.8, -40, -20, -128], [1, -3, 0, -8]],
      foreR: [[0, -13, 0, 0], [0.2, -126, 0, -30], [0.35, -118, 0, -22], [0.5, -126, 0, -30], [0.65, -118, 0, -22], [0.8, -126, 0, -30], [1, -13, 0, 0]],
      head: [[0, 1, 0, 0], [0.2, 12, -12, 0], [0.8, 12, -12, 0], [1, 1, 0, 0]],
      chest: [[0, 0, 0, 0], [0.2, 6, 0, 0], [0.8, 6, 0, 0], [1, 0, 0, 0]],
    },
  },
  thumbsUp: {
    duration: 1.7,
    tracks: {
      armR: [[0, -3, 0, -8], [0.18, -52, 14, -14], [0.82, -52, 14, -14], [1, -3, 0, -8]],
      foreR: [[0, -13, 0, 0], [0.18, -70, 0, 0], [0.3, -60, 0, 0], [0.42, -70, 0, 0], [0.82, -70, 0, 0], [1, -13, 0, 0]],
    },
  },
  beckon: {
    duration: 1.8,
    tracks: {
      armR: [[0, -3, 0, -8], [0.18, -58, 0, -20], [0.84, -58, 0, -20], [1, -3, 0, -8]],
      foreR: [[0, -13, 0, 0], [0.18, -30, 0, 0], [0.34, -96, 0, 0], [0.5, -40, 0, 0], [0.66, -96, 0, 0], [0.84, -40, 0, 0], [1, -13, 0, 0]],
    },
  },
  /** Shoulders drop, head down: discouraged. Hold it. */
  slump: {
    duration: 1.2,
    tracks: {
      spine: [[0, 0, 0, 0], [1, 9, 0, 0]], chest: [[0, 0, 0, 0], [1, 8, 0, 0]], head: [[0, 1, 0, 0], [1, 18, 0, 0]],
      armL: [[0, -3, 0, 8], [1, 2, 0, 5]], armR: [[0, -3, 0, -8], [1, 2, 0, -5]],
    },
  },
};
