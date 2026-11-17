import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** Prefiltered environment from any small scene; the caller owns (and disposes) the returned texture. */
export const bakeEnvironment = (renderer: THREE.WebGLRenderer, scene: THREE.Scene, blur = 0.04): THREE.Texture => {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, blur);
  pmrem.dispose();
  return target.texture;
};

/** Neutral softbox room, for the studio and as a base for interiors. */
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
