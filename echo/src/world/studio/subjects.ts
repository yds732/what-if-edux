import * as THREE from 'three';
import { Character, type Mood } from '../../characters/Character';
import { CAST, isCastName } from '../../characters/cast';
import { GESTURES, POSES, type GestureName, type PoseName } from '../../characters/motion';
import { Hands, type HandPose } from '../../player/Hands';
import { buildHeadset } from '../props';
import type { SubjectFactory } from './StudioWorld';

/**
 * `?shot=studio&subject=cast&who=lumi,jamie&pose=stand&gesture=wave&mood=happy&talk=1&spacing=0.8&turn=20`
 * Lines characters up for inspection; every parameter is optional.
 */
const cast: SubjectFactory = (_ctx, params) => {
  const names = (params.get('who') ?? 'lumi,jamie').split(',').filter(isCastName);
  const spacing = Number(params.get('spacing') ?? 0.8);
  const turn = (Number(params.get('turn') ?? 0) * Math.PI) / 180;
  const pose = params.get('pose');
  const gesture = params.get('gesture');
  const mood = params.get('mood') as Mood | null;
  const group = new THREE.Group();
  const characters = names.map((name, i) => {
    const c = new Character(CAST[name]);
    c.place((i - (names.length - 1) / 2) * spacing, 0, 0, turn);
    if (pose && pose in POSES) c.setPose(pose as PoseName, { immediate: true });
    if (gesture && gesture in GESTURES) c.play(gesture as GestureName, params.has('hold'));
    if (mood) c.setMood(mood);
    if (params.has('talk')) c.setTalking(1);
    if (params.has('look')) {
      const [x, y, z] = (params.get('look') ?? '').split(',').map(Number);
      c.lookAtPoint(new THREE.Vector3(x, y, z));
    }
    group.add(c.root);
    return c;
  });
  if (pose && POSES[pose as PoseName]?.seated) {
    for (const c of characters) {
      const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.17, 0.36, 24), new THREE.MeshStandardMaterial({ color: 0xd9d6e2, roughness: 0.6 }));
      stool.position.set(c.root.position.x, 0.18, -0.02);
      stool.castShadow = stool.receiveShadow = true;
      group.add(stool);
    }
  }
  return { object: group, update: ({ dt, time }) => characters.forEach((c) => c.update(dt, time)) };
};

export const SUBJECTS: Record<string, SubjectFactory> = { cast };

/**
 * `?shot=studio&subject=hands&pose=cradle&style=real&eye=0,1.4,0.6&at=0,1.4,-1` shows the first-person hands
 * exactly as the player sees them: the stand-in camera sits at (0, 1.4, 0.6) looking down -Z.
 */
const hands: SubjectFactory = (ctx, params) => {
  const group = new THREE.Group();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.4, 0.6);
  group.add(camera);
  const app = { camera, renderer: ctx.renderer } as unknown as ConstructorParameters<typeof Hands>[0];
  const input = { look: new THREE.Vector2() } as unknown as ConstructorParameters<typeof Hands>[1];
  const player = { travelled: 0 } as unknown as ConstructorParameters<typeof Hands>[2];
  const rig = new Hands(app, input, player);
  const pose = (params.get('pose') ?? 'rest') as HandPose;
  rig.pose(pose, (params.get('left') ?? pose) as HandPose);
  rig.setStyle(params.get('style') === 'haven' ? 'haven' : 'real', true);
  rig.snap();
  if (params.has('headset')) {
    const headset = buildHeadset();
    headset.setPower(1);
    headset.group.position.set(0, -0.22, -0.43);
    headset.group.rotation.set(0.5, Math.PI, 0);
    camera.add(headset.group);
  }
  return { object: group, update: ({ dt }) => rig.update(dt) };
};
SUBJECTS.hands = hands;
