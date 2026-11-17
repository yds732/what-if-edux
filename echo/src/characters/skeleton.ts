import * as THREE from 'three';

export const BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR',
  'legL', 'shinL', 'footL', 'legR', 'shinR', 'footR',
] as const;
export type BoneName = (typeof BONES)[number];

export const PARENT: Record<BoneName, BoneName | null> = {
  hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  armL: 'chest', foreL: 'armL', handL: 'foreL', armR: 'chest', foreR: 'armR', handR: 'foreR',
  legL: 'hips', shinL: 'legL', footL: 'shinL', legR: 'hips', shinR: 'legR', footR: 'shinR',
};

export interface Rig {
  readonly root: THREE.Bone;
  readonly bones: Record<BoneName, THREE.Bone>;
  readonly skeleton: THREE.Skeleton;
  readonly joints: Record<BoneName, THREE.Vector3>;
}

/**
 * A rig whose joints stand at the given points in character space: the character faces +Z and its left is +X.
 * Bones carry no rotation in this pose.
 */
export const rigFromJoints = (joints: Record<BoneName, THREE.Vector3>): Rig => {
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
