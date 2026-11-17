import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { Model } from '../assets/AssetLibrary';
import { BONES, PARENT, rigFromJoints, type BoneName, type Rig } from './skeleton';

/** Where the drawn face sits on a generated head, in metres in the character's own space. */
export interface FacePlacement {
  /** Middle of the head: the eyes are a little below it, the mouth half a radius below. */
  readonly centre: THREE.Vector3;
  /** The head's radius as the face understands it: every feature is sized from this. */
  readonly radius: number;
}

interface Driven {
  readonly bone: THREE.Bone;
  /** Index of the parent in `driven`, or -1 for the root. */
  readonly parent: number;
  /** Which of the animator's bones this one copies, if any. */
  readonly source: BoneName | null;
  /** Rest rotation relative to the parent: what a bone the animator does not know keeps. */
  readonly restLocal: THREE.Quaternion;
  /** Rest rotation in the character's space, turned so the bone lies along the animator's rest pose. */
  readonly aligned: THREE.Quaternion;
  /** This frame's rotation in the character's space. */
  readonly now: THREE.Quaternion;
}

type Limb = readonly [BoneName, BoneName, BoneName];
const ARM_L: Limb = ['armL', 'foreL', 'handL'], ARM_R: Limb = ['armR', 'foreR', 'handR'];
const LEG_L: Limb = ['legL', 'shinL', 'footL'], LEG_R: Limb = ['legR', 'shinR', 'footR'];

const DOWN = new THREE.Vector3(0, -1, 0);
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();

/**
 * A generated, rigged figure, driven by the game's own animator.
 *
 * The file arrives standing on the origin, in metres, facing +Z, with a note of which of its bones is which
 * (see tools/assets/lib/rig.mjs). A 17-bone rig in the animator's own layout is laid over those joints, with the
 * limbs hanging straight, and every frame each of the model's bones is turned to match the animator's bone it
 * stands for. Bones the animator knows nothing about (fingers, hair, collars) ride along with their parents.
 */
export class GeneratedBody {
  /** Add this to the character's root. */
  readonly root = new THREE.Group();
  /** The animator's rig, measured from this body. */
  readonly rig: Rig;
  readonly material: THREE.MeshStandardMaterial;
  readonly mesh: THREE.SkinnedMesh;
  readonly face: FacePlacement;
  /** Takes a vertex of the mesh to the character's space in the rest pose. */
  readonly toCharacter = new THREE.Matrix4();

  private readonly driven: Driven[] = [];
  private readonly rootParentInverse = new THREE.Matrix4();
  private readonly rootRest = new THREE.Matrix4();
  private readonly hipsRest = new THREE.Vector3();
  /** Straightened legs are a touch longer than the legs as modelled: the body rides this much higher. */
  private readonly lift: number;
  private readonly modelQuat = {} as Record<BoneName, THREE.Quaternion>;

  constructor(model: Model) {
    const map = model.entry.rig;
    if (!map) throw new Error(`"${model.id}" has no rig: it is not a character`);
    const scene = cloneSkinned(model.scene);
    let found: THREE.SkinnedMesh | null = null;
    scene.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) found ??= o;
    });
    if (!found) throw new Error(`"${model.id}" has no skinned mesh`);
    const mesh = (this.mesh = found as THREE.SkinnedMesh);
    mesh.frustumCulled = false;
    this.material = (mesh.material as THREE.MeshStandardMaterial).clone();
    mesh.material = this.material;
    this.root.add(scene);
    this.root.updateMatrixWorld(true);

    const bones = mesh.skeleton.bones;
    // at rest every bone agrees on where the skin puts a vertex
    this.toCharacter.multiplyMatrices(bones[0]!.matrixWorld, mesh.skeleton.boneInverses[0]!);
    const pos = bones.map((b) => b.getWorldPosition(new THREE.Vector3()));
    const rot = bones.map((b) => b.getWorldQuaternion(new THREE.Quaternion()));
    const index = new Map(bones.map((b, i) => [b, i]));

    // ---- the animator's rig, laid over these joints with the limbs hanging straight ----
    const joints = {} as Record<BoneName, THREE.Vector3>;
    const hipMid = pos[map.legL[0]]!.clone().add(pos[map.legR[0]]!).multiplyScalar(0.5);
    joints.hips = new THREE.Vector3(0, hipMid.y, hipMid.z);
    joints.chest = pos[map.chest]!.clone().setX(0);
    joints.spine = map.spine === null ? joints.hips.clone().lerp(joints.chest, 0.5) : pos[map.spine]!.clone().setX(0);
    joints.head = pos[map.head]!.clone().setX(0);
    joints.neck = map.neck === null ? joints.chest.clone().lerp(joints.head, 0.6) : pos[map.neck]!.clone().setX(0);
    const source = new Map<number, BoneName>([[map.hips, 'hips'], [map.chest, 'chest'], [map.head, 'head']]);
    if (map.spine !== null) source.set(map.spine, 'spine');
    if (map.neck !== null) source.set(map.neck, 'neck');
    // where each limb bone points at rest in the model, to be swung onto where the animator's points: straight down
    const points = new Map<number, THREE.Vector3>();
    const limb = (names: Limb, j: readonly number[], hand: boolean): void => {
      const [a, b, c] = [j[0]!, j[1]!, j[2]!];
      joints[names[0]] = pos[a]!.clone();
      joints[names[1]] = joints[names[0]].clone().addScaledVector(DOWN, pos[a]!.distanceTo(pos[b]!));
      joints[names[2]] = joints[names[1]].clone().addScaledVector(DOWN, pos[b]!.distanceTo(pos[c]!));
      [a, b, c].forEach((bone, k) => source.set(bone, names[k]!));
      points.set(a, new THREE.Vector3().subVectors(pos[b]!, pos[a]!).normalize());
      points.set(b, new THREE.Vector3().subVectors(pos[c]!, pos[b]!).normalize());
      // a hand carries on from its forearm as it was modelled; a foot stays flat on the floor
      if (hand) points.set(c, points.get(b)!);
    };
    limb(ARM_L, map.armL, true);
    limb(ARM_R, map.armR, true);
    limb(LEG_L, map.legL, false);
    limb(LEG_R, map.legR, false);
    this.lift = ((pos[map.legL[2]]!.y - joints.footL.y) + (pos[map.legR[2]]!.y - joints.footR.y)) / 2;
    this.rig = rigFromJoints(joints);
    this.hipsRest.copy(joints.hips);
    for (const name of BONES) this.modelQuat[name] = new THREE.Quaternion();

    // parents before children, so a bone's parent is already posed when its turn comes
    const order: number[] = [];
    const visit = (i: number): void => {
      order.push(i);
      for (const child of bones[i]!.children) {
        const k = index.get(child as THREE.Bone);
        if (k !== undefined) visit(k);
      }
    };
    visit(map.hips);
    const slot = new Map(order.map((i, k) => [i, k]));
    for (const i of order) {
      const bone = bones[i]!;
      const direction = points.get(i);
      const aligned = rot[i]!.clone();
      if (direction) aligned.premultiply(_q.setFromUnitVectors(direction, DOWN));
      const parent = i === map.hips ? -1 : slot.get(index.get(bone.parent as THREE.Bone)!)!;
      this.driven.push({ bone, parent, source: source.get(i) ?? null, restLocal: bone.quaternion.clone(), aligned, now: rot[i]!.clone() });
    }
    const rootBone = bones[map.hips]!;
    this.rootRest.copy(rootBone.matrixWorld);
    this.rootParentInverse.copy(rootBone.parent!.matrixWorld).invert();

    const guess = guessFace(mesh, this.toCharacter, map.head, joints.head, pos[map.chest]!.y);
    const fit = model.entry.face ?? {};
    const radius = guess.radius * (fit.size ?? 1);
    this.face = { radius, centre: guess.centre.add(_v.set(0, (fit.up ?? 0) * radius, (fit.out ?? 0) * radius)) };
  }

  /** Copies the animator's pose onto the model. Call after the animator has posed its rig. */
  retarget(): void {
    const rig = this.rig.bones;
    for (const name of BONES) {
      const parent = PARENT[name];
      if (parent) this.modelQuat[name].multiplyQuaternions(this.modelQuat[parent], rig[name].quaternion);
      else this.modelQuat[name].copy(rig[name].quaternion);
    }
    for (const d of this.driven) {
      if (d.parent < 0) {
        // the root rides the animator's hips as one rigid piece: wherever the hips have gone since rest, it goes too
        _v.copy(this.hipsRest).applyQuaternion(this.modelQuat.hips).negate().add(rig.hips.position);
        _v.y += this.lift;
        _m.compose(_v, this.modelQuat.hips, _s.setScalar(1)).multiply(this.rootRest).premultiply(this.rootParentInverse);
        _m.decompose(d.bone.position, d.bone.quaternion, _s);
        d.now.multiplyQuaternions(this.modelQuat.hips, d.aligned);
        continue;
      }
      const parent = this.driven[d.parent]!.now;
      if (d.source) {
        d.now.multiplyQuaternions(this.modelQuat[d.source], d.aligned);
        d.bone.quaternion.copy(parent).invert().multiply(d.now);
      } else {
        d.now.multiplyQuaternions(parent, d.restLocal);
      }
    }
  }
}

/**
 * Finds the face from the nose: the foremost point of the head on its centre line, below the hairline.
 * Everything else about the face is laid out from there, in proportions that suit these big-headed figures.
 */
const guessFace = (mesh: THREE.SkinnedMesh, toCharacter: THREE.Matrix4, headJoint: number, headAt: THREE.Vector3, shoulderY: number): { centre: THREE.Vector3; radius: number } => {
  const position = mesh.geometry.getAttribute('position'), index = mesh.geometry.getAttribute('skinIndex'), weight = mesh.geometry.getAttribute('skinWeight');
  const p = new THREE.Vector3();
  let topY = -Infinity, halfWidth = 0;
  const head: THREE.Vector3[] = [];
  for (let i = 0; i < position.count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (index.getComponent(i, k) === headJoint) w += weight.getComponent(i, k);
    if (w < 0.6) continue;
    p.fromBufferAttribute(position, i).applyMatrix4(toCharacter);
    if (p.y < shoulderY) continue;
    head.push(p.clone());
    topY = Math.max(topY, p.y);
    halfWidth = Math.max(halfWidth, Math.abs(p.x));
  }
  if (head.length === 0) throw new Error('no vertices follow the head bone: the face cannot be placed');
  // the nose: furthest forward near the centre line, in the lower half of the head (the fringe is higher up)
  const lowHalf = headAt.y + (topY - headAt.y) * 0.55;
  let nose = head[0]!;
  for (const v of head) if (Math.abs(v.x) < halfWidth * 0.12 && v.y < lowHalf && v.z > nose.z) nose = v;
  const radius = (topY - headAt.y) * 0.46;
  return { centre: new THREE.Vector3(0, nose.y + radius * 0.2, nose.z - radius * 1.0), radius };
};
