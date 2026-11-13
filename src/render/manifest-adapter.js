// The ONLY file that talks to the MANIFEST 3D SDK. Everything else uses these functions.
// Current status: placeholder built on Three.js so the game runs today.
// When the MANIFEST SDK/API is confirmed with the sponsor, replace the bodies here and keep the signatures:
//   createScene(container)        -> { render(target) }
//   createPlayer(scene)           -> { position: {x,z}, move(dx, dz, dt), reset() }
//   placeObjects(scene, defs)     -> [{ id, def, used, isNear(pos), markUsed() }]
//   removeObjects(scene, objects)
import * as THREE from 'three';

export function createScene(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fd3ff);
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  container.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 1.1));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x7fbf6a }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  return {
    scene,
    render(target) {
      camera.position.set(target.x, 6, target.z + 8);
      camera.lookAt(target.x, 0.8, target.z);
      renderer.render(scene, camera);
    },
  };
}

const BOUND = 12; // keep the player on the ground

export function createPlayer({ scene }) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 0.8), new THREE.MeshStandardMaterial({ color: 0xff8a3d }));
  mesh.position.set(0, 0.8, 0);
  scene.add(mesh);
  return {
    position: mesh.position,
    move(dx, dz, dt) {
      const len = Math.hypot(dx, dz) || 1;
      const speed = 4;
      mesh.position.x = THREE.MathUtils.clamp(mesh.position.x + (dx / len) * speed * dt, -BOUND, BOUND);
      mesh.position.z = THREE.MathUtils.clamp(mesh.position.z + (dz / len) * speed * dt, -BOUND, BOUND);
    },
    reset() { mesh.position.set(0, 0.8, 0); },
  };
}

export function placeObjects({ scene }, defs) {
  return defs.map((d) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: d.color ?? 0x4d7cfe }));
    mesh.position.set(d.pos[0], 0.5, d.pos[2]);
    scene.add(mesh);
    const obj = {
      id: d.id,
      def: d,
      used: false,
      mesh,
      isNear: (p) => !obj.used && Math.hypot(p.x - d.pos[0], p.z - d.pos[2]) < 2,
      markUsed() { obj.used = true; mesh.material.color.set(0x999999); },
    };
    return obj;
  });
}

export function removeObjects({ scene }, objects) {
  for (const o of objects) {
    scene.remove(o.mesh);
    o.mesh.geometry.dispose();
    o.mesh.material.dispose();
  }
}
