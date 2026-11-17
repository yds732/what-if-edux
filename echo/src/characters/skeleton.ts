import * as THREE from 'three';

export const BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR',
  'legL', 'shinL', 'footL', 'legR', 'shinR', 'footR',
] as const;
export type BoneName = (typeof BONES)[number];
export const boneIndex = (name: BoneName): number => BONES.indexOf(name);

const PARENT: Record<BoneName, BoneName | null> = {
  hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  armL: 'chest', foreL: 'armL', handL: 'foreL', armR: 'chest', foreR: 'armR', handR: 'foreR',
  legL: 'hips', shinL: 'legL', footL: 'shinL', legR: 'hips', shinR: 'legR', footR: 'shinR',
};

/** Body measurements in metres. The character faces +Z; its left side is +X. */
export interface Proportions {
  /** Sole to hip joint. */
  legLength: number;
  /** Hip joint to shoulder line. */
  torsoLength: number;
  /** Shoulder joint to wrist. */
  armLength: number;
  shoulderWidth: number;
  hipWidth: number;
  neckLength: number;
  /** Radius of the head. */
  headRadius: number;
  /** Girth multiplier for torso and limbs. */
  build: number;
}

export const KID: Proportions = {
  legLength: 0.72, torsoLength: 0.38, armLength: 0.43, shoulderWidth: 0.27, hipWidth: 0.15, neckLength: 0.06, headRadius: 0.14, build: 1,
};
export const ADULT: Proportions = {
  legLength: 0.84, torsoLength: 0.46, armLength: 0.54, shoulderWidth: 0.33, hipWidth: 0.18, neckLength: 0.07, headRadius: 0.136, build: 1.05,
};

/** Bind-pose joint positions in character space (origin between the feet). Bones are axis-aligned in bind pose. */
export const jointPositions = (p: Proportions): Record<BoneName, THREE.Vector3> => {
  const hipY = p.legLength, shoulderY = hipY + p.torsoLength;
  const upper = p.armLength * 0.52, thigh = (p.legLength - 0.07) * 0.5;
  const sx = p.shoulderWidth / 2, hx = p.hipWidth / 2;
  const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
  return {
    hips: v(0, hipY), spine: v(0, hipY + p.torsoLength * 0.3), chest: v(0, hipY + p.torsoLength * 0.62),
    neck: v(0, shoulderY + 0.035), head: v(0, shoulderY + 0.035 + p.neckLength),
    armL: v(sx, shoulderY), foreL: v(sx, shoulderY - upper), handL: v(sx, shoulderY - p.armLength),
    armR: v(-sx, shoulderY), foreR: v(-sx, shoulderY - upper), handR: v(-sx, shoulderY - p.armLength),
    legL: v(hx, hipY - 0.02), shinL: v(hx, hipY - 0.02 - thigh), footL: v(hx, 0.07),
    legR: v(-hx, hipY - 0.02), shinR: v(-hx, hipY - 0.02 - thigh), footR: v(-hx, 0.07),
  };
};

export interface Rig {
  readonly root: THREE.Bone;
  readonly bones: Record<BoneName, THREE.Bone>;
  readonly skeleton: THREE.Skeleton;
  readonly joints: Record<BoneName, THREE.Vector3>;
}

export const buildRig = (p: Proportions): Rig => {
  const joints = jointPositions(p);
  const bones = {} as Record<BoneName, THREE.Bone>;
  for (const name of BONES) {
    const b = new THREE.Bone();
    b.name = name;
    bones[name] = b;
  }
  for (const name of BONES) {
    const parent = PARENT[name];
    const b = bones[name];
    if (parent) {
      bones[parent].add(b);
      b.position.copy(joints[name]).sub(joints[parent]);
    } else {
      b.position.copy(joints[name]);
    }
  }
  const list = BONES.map((n) => bones[n]);
  bones.hips.updateMatrixWorld(true);
  return { root: bones.hips, bones, skeleton: new THREE.Skeleton(list), joints };
};

export type Influence = readonly [bone: BoneName, weight: number];

/** Writes skinIndex/skinWeight from a function of each vertex's bind-pose position. */
export const applySkin = (g: THREE.BufferGeometry, weigh: (p: THREE.Vector3) => readonly Influence[]): THREE.BufferGeometry => {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const idx = new Uint16Array(pos.count * 4), wts = new Float32Array(pos.count * 4);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const inf = weigh(p).filter(([, w]) => w > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    let sum = 0;
    for (const [, w] of inf) sum += w;
    if (sum <= 0) throw new Error('applySkin: vertex with no influences');
    inf.forEach(([bone, w], k) => {
      idx[i * 4 + k] = boneIndex(bone);
      wts[i * 4 + k] = w / sum;
    });
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
  return g;
};

/** Binds every vertex rigidly to one bone. */
export const rigidSkin = (g: THREE.BufferGeometry, bone: BoneName): THREE.BufferGeometry => applySkin(g, () => [[bone, 1]]);

const ss = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Blend down a chain of joints by distance along -Y from the chain's first joint: shoulders/elbows/wrists, hips/knees/ankles. */
export const limbWeights = (
  parent: BoneName, chain: readonly [BoneName, BoneName, BoneName], joints: Record<BoneName, THREE.Vector3>, blend = 0.045,
) => (p: THREE.Vector3): Influence[] => {
  const [a, b, c] = chain;
  const y = p.y;
  const wRoot = ss(joints[a].y - blend * 0.6, joints[a].y + blend * 1.2, y); // above the first joint the parent takes over
  const wMid = ss(joints[b].y + blend, joints[b].y - blend, y);
  const wEnd = ss(joints[c].y + blend * 0.5, joints[c].y - blend * 0.5, y);
  const wa = (1 - wRoot) * (1 - wMid);
  const wb = (1 - wRoot) * wMid * (1 - wEnd);
  const wc = (1 - wRoot) * wMid * wEnd;
  return [[parent, wRoot], [a, wa], [b, wb], [c, wc]];
};

/** Blend up the spine by height. */
export const torsoWeights = (joints: Record<BoneName, THREE.Vector3>) => (p: THREE.Vector3): Influence[] => {
  const y = p.y;
  const s = ss(joints.hips.y + 0.02, joints.spine.y + 0.04, y);
  const c = ss(joints.spine.y + 0.02, joints.chest.y + 0.03, y);
  const n = ss(joints.neck.y - 0.01, joints.neck.y + 0.03, y);
  return [['hips', 1 - s], ['spine', s * (1 - c)], ['chest', c * (1 - n)], ['neck', n]];
};
