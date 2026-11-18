import * as THREE from 'three';
import type { Character } from '../characters/Character';

const DOWN = new THREE.Vector3(0, -1, 0);
const _s = new THREE.Vector3();
const _t = new THREE.Vector3();
const _e = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _parent = new THREE.Quaternion();
const _arm = new THREE.Quaternion();
const _q = new THREE.Quaternion();

/**
 * Bends an arm of a posed figure so that its wrist is at `wrist` (a point in the world), the elbow leaning toward
 * `bend`, and, if `hand` is given, the hand turned to that orientation in the world. Call from `Character.onPose`:
 * the animator has posed the rest of the body, and this overrides one arm. `weight` blends from the animator's own
 * arm (0) to the reach (1).
 *
 * The animator's skeleton hangs each arm straight down at rest, which is what makes this two lines of
 * trigonometry: shoulder to elbow and elbow to wrist are each "turn DOWN to point this way".
 */
export const reachArm = (person: Character, side: 'L' | 'R', wrist: THREE.Vector3, bend: THREE.Vector3, hand: THREE.Quaternion | null = null, weight = 1): void => {
  const bones = person.rig.bones;
  const upper = bones[`arm${side}`], fore = bones[`fore${side}`], palm = bones[`hand${side}`];
  const chest = upper.parent!;
  chest.updateWorldMatrix(true, false);
  upper.updateWorldMatrix(false, false);
  const scale = person.root.getWorldScale(_scale).x;
  const l1 = fore.position.length() * scale, l2 = palm.position.length() * scale;
  const shoulder = upper.getWorldPosition(_s);

  // the wrist can be no further than the arm is long, and no nearer than its two halves fold
  _d.subVectors(wrist, shoulder);
  const want = _d.length(), reach = Math.min(Math.max(want, Math.abs(l1 - l2) + 0.01), l1 + l2 - 0.004);
  _d.multiplyScalar(1 / Math.max(want, 1e-6));
  _t.copy(shoulder).addScaledVector(_d, reach);
  // the elbow lies on a circle about the line from shoulder to wrist: take the point of it nearest `bend`
  const along = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach), out = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  _p.copy(bend).addScaledVector(_d, -bend.dot(_d));
  if (_p.lengthSq() < 1e-8) _p.set(0, -1, 0).addScaledVector(_d, _d.y);
  _p.normalize();
  _e.copy(shoulder).addScaledVector(_d, along).addScaledVector(_p, out);

  chest.getWorldQuaternion(_parent);
  // shoulder: DOWN, in the chest's frame, turned to point at the elbow
  _d.subVectors(_e, shoulder).normalize().applyQuaternion(_q.copy(_parent).invert());
  upper.quaternion.slerp(_q.setFromUnitVectors(DOWN, _d), weight);
  _arm.multiplyQuaternions(_parent, upper.quaternion);
  // elbow: DOWN, in the upper arm's frame, turned to point at the wrist
  _d.subVectors(_t, _e).normalize().applyQuaternion(_q.copy(_arm).invert());
  fore.quaternion.slerp(_q.setFromUnitVectors(DOWN, _d), weight);
  if (hand) {
    _arm.multiply(fore.quaternion);
    palm.quaternion.slerp(_q.copy(_arm).invert().multiply(hand), weight);
  }
};
