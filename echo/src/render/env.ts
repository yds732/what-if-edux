import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const bakeEnvironment = (renderer: THREE.WebGLRenderer, scene: THREE.Scene, blur = 0.04): THREE.Texture => {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, blur);
  pmrem.dispose();
  return target.texture;
};

export const bakeRoomEnvironment = (renderer: THREE.WebGLRenderer): THREE.Texture => {
  const room = new RoomEnvironment();
  const texture = bakeEnvironment(renderer, room);
  room.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  return texture;
};
