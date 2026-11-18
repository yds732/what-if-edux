import * as THREE from 'three';
import type { Picture } from '../assets/AssetLibrary';
import type { BuildContext } from './World';

export type Spot = readonly [x: number, y: number, z: number, yaw?: number, scale?: number];

const UP = new THREE.Vector3(0, 1, 0);
const matrixOf = ([x, y, z, yaw = 0, scale = 1]: Spot): THREE.Matrix4 =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, THREE.MathUtils.degToRad(yaw)), new THREE.Vector3(scale, scale, scale));

export const dress = async (ctx: BuildContext, parent: THREE.Object3D, id: string, spots: readonly Spot[]): Promise<THREE.Group> => {
  const group = await ctx.assets.instanced(id, spots.map(matrixOf));
  parent.add(group);
  return group;
};

export const sizeOf = async (ctx: BuildContext, id: string): Promise<readonly [number, number, number]> => {
  const { size } = (await ctx.assets.model(id)).entry;
  if (!size) throw new Error(`"${id}" is not a prop`);
  return size;
};

export const glowOf = (prop: THREE.Object3D): { value: number } => {
  let glow: { value: number } | undefined;
  prop.traverse((o) => {
    if (o instanceof THREE.Mesh) glow ??= (o.material as THREE.Material).userData.glow as { value: number } | undefined;
  });
  if (!glow) throw new Error(`"${prop.name}" has no painted light: give it a glow in the catalog`);
  return glow;
};

export const floorOf = (picture: Picture, wide: number, deep: number, metres: number, roughness: number): THREE.Mesh => {
  for (const texture of [picture.map, picture.normalMap]) texture?.repeat.set(wide / metres, deep / metres);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(wide, deep), new THREE.MeshStandardMaterial({ map: picture.map, normalMap: picture.normalMap, roughness }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  return floor;
};

export const framed = (picture: THREE.Texture, wide: number, tall: number, frame: THREE.ColorRepresentation = 0xd9b98f): THREE.Group => {
  const group = new THREE.Group();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(wide, tall), new THREE.MeshStandardMaterial({ map: picture, roughness: 0.82 }));
  face.position.z = 0.012;
  face.receiveShadow = true;
  const wood = new THREE.MeshStandardMaterial({ color: frame, roughness: 0.55 });
  const bar = 0.03;
  for (const [w, h, x, y] of [[wide + bar * 2, bar, 0, tall / 2 + bar / 2], [wide + bar * 2, bar, 0, -tall / 2 - bar / 2], [bar, tall, -wide / 2 - bar / 2, 0], [bar, tall, wide / 2 + bar / 2, 0]] as const) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.035), wood);
    side.position.set(x, y, 0.0175);
    side.castShadow = true;
    group.add(side);
  }
  group.add(face);
  return group;
};
