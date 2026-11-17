import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { loadGltf } from '../../assets/gltf';
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
const cast: SubjectFactory = async (ctx, params) => {
  const names = (params.get('who') ?? 'lumi,jamie').split(',').filter(isCastName);
  const spacing = Number(params.get('spacing') ?? 0.8);
  const turn = (Number(params.get('turn') ?? 0) * Math.PI) / 180;
  const pose = params.get('pose');
  const gesture = params.get('gesture');
  const mood = params.get('mood') as Mood | null;
  const group = new THREE.Group();
  const made = await Promise.all(names.map((name) => Character.create(ctx, CAST[name], name, true)));
  const characters = made.map((c, i) => {
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
const hands: SubjectFactory = async (ctx, params) => {
  const group = new THREE.Group();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.4, 0.6);
  group.add(camera);
  const app = { camera, renderer: ctx.renderer } as unknown as ConstructorParameters<typeof Hands>[0];
  const input = { look: new THREE.Vector2() } as unknown as ConstructorParameters<typeof Hands>[1];
  const player = { travelled: 0 } as unknown as ConstructorParameters<typeof Hands>[2];
  const rig = new Hands(app, input, player, ctx.assets);
  await rig.ready;
  const pose = (params.get('pose') ?? 'rest') as HandPose;
  rig.pose(pose, (params.get('left') ?? pose) as HandPose);
  rig.setStyle(params.get('style') === 'haven' ? 'haven' : 'real', true);
  rig.snap();
  if (params.has('headset')) {
    const headset = buildHeadset(ctx.assets);
    await headset.ready;
    headset.setPower(1);
    headset.group.position.set(0, -0.22, -0.43);
    headset.group.rotation.set(0.5, Math.PI, 0);
    camera.add(headset.group);
  }
  return { object: group, update: ({ dt }) => rig.update(dt) };
};
SUBJECTS.hands = hands;

/** What a loaded model is made of, for the asset tools to read back from a capture. */
export interface ModelReport {
  triangles: number;
  meshes: number;
  skinned: number;
  size: [number, number, number];
  materials: { name: string; maps: Record<string, string> }[];
  bones: string[];
  animations: string[];
}
declare global {
  interface Window {
    __MODEL?: ModelReport;
  }
}

const describeModel = (root: THREE.Object3D, animations: THREE.AnimationClip[]): ModelReport => {
  const report: ModelReport = { triangles: 0, meshes: 0, skinned: 0, size: [0, 0, 0], materials: [], bones: [], animations: animations.map((a) => `${a.name} ${a.duration.toFixed(2)}s`) };
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    if (o instanceof THREE.Bone) report.bones.push(`${o.parent instanceof THREE.Bone ? o.parent.name : '-'}>${o.name}`);
    if (!(o instanceof THREE.Mesh)) return;
    report.meshes++;
    if (o instanceof THREE.SkinnedMesh) report.skinned++;
    const g = o.geometry as THREE.BufferGeometry;
    report.triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (seen.has(m)) continue;
      seen.add(m);
      const maps: Record<string, string> = {};
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'] as const) {
        const t = (m as THREE.MeshStandardMaterial)[key];
        const image = t?.image as { width?: number; height?: number } | undefined;
        if (image) maps[key] = `${image.width}x${image.height}`;
      }
      report.materials.push({ name: m.name || m.type, maps });
    }
  });
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  report.size = [+size.x.toFixed(3), +size.y.toFixed(3), +size.z.toFixed(3)];
  return report;
};

/**
 * `?shot=studio&subject=model&url=/assets/.cache/raw/lumi.glb&h=1.4&turns=0,90,180,270&spacing=1.2`
 * A model file seen from several sides at once: copies in a row, each turned by one of `turns` (degrees), scaled
 * so the model is `h` metres tall and standing on the floor. What it is made of is left in `window.__MODEL`.
 */
const model: SubjectFactory = async (_ctx, params) => {
  const url = params.get('url');
  if (!url) throw new Error('the model subject needs &url=<path to a .glb>');
  const gltf = await loadGltf(url);
  window.__MODEL = describeModel(gltf.scene, gltf.animations);
  const turns = (params.get('turns') ?? '0,90,180,270').split(',').map(Number);
  const height = Number(params.get('h') ?? 1.2);
  const group = new THREE.Group();
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
  const scale = height / size.y;
  const spacing = Number(params.get('spacing') ?? Math.max(size.x, size.z) * scale * 1.25);
  turns.forEach((deg, i) => {
    const copy = cloneSkinned(gltf.scene);
    copy.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = o.receiveShadow = true;
      o.frustumCulled = false;
    });
    // turn about the model's own middle, then stand it on the floor
    const pivot = new THREE.Group();
    copy.position.set(-centre.x, -box.min.y, -centre.z);
    pivot.add(copy);
    pivot.scale.setScalar(scale);
    pivot.rotation.y = (deg * Math.PI) / 180;
    pivot.position.x = (i - (turns.length - 1) / 2) * spacing;
    group.add(pivot);
  });
  return { object: group };
};
SUBJECTS.model = model;
