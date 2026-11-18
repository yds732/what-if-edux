import * as THREE from 'three';
import { Rng, TAU } from '../../core/math';
import { GLSL_OUTPUT } from '../../render/glsl';

export interface ShootingStars {
  readonly mesh: THREE.Mesh;
  update(dt: number, camera: THREE.Camera): void;
}

const STAR = {
  gap: [3.5, 9] as const,
  life: [0.55, 1.0] as const,
  distance: 900,
  travel: [180, 300] as const,
  tail: 0.45,
  width: 2.2,
} as const;

const VS = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FS = `
uniform float uFade; uniform vec3 uColor;
varying vec2 vUv;
void main() {
  // bright at the head (uv.x = 1), thinning to nothing at the tail; soft across its width
  float along = pow(vUv.x, 2.4);
  float across = pow(1.0 - abs(vUv.y * 2.0 - 1.0), 1.5);
  float head = smoothstep(0.92, 1.0, vUv.x) * 1.8;
  gl_FragColor = vec4(uColor * (along + head) * across * uFade, 1.0);
  ${GLSL_OUTPUT}
}`;

export const buildShootingStars = (rng: Rng): ShootingStars => {
  const geo = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(12), 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', pos);
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0, 1, 1], 2));
  geo.setIndex([0, 2, 1, 1, 2, 3]);
  const uniforms = { uFade: { value: 0 }, uColor: { value: new THREE.Color(1.0, 0.93, 0.82).multiplyScalar(3) } };
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
  }));
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = -1;

  let wait = rng.range(1.5, 4);
  let star: { from: THREE.Vector3; dir: THREE.Vector3; travel: number; life: number; age: number } | null = null;
  const head = new THREE.Vector3(), tail = new THREE.Vector3(), side = new THREE.Vector3(), view = new THREE.Vector3(), eye = new THREE.Vector3();

  const spawn = (): void => {
    const bearing = rng.range(0, TAU), up = rng.range(0.32, 0.9);
    const from = new THREE.Vector3(Math.sin(bearing) * Math.cos(up), Math.sin(up), Math.cos(bearing) * Math.cos(up)).multiplyScalar(STAR.distance);
    const across = new THREE.Vector3(Math.cos(bearing), 0, -Math.sin(bearing)).multiplyScalar(rng.chance(0.5) ? 1 : -1);
    const dir = across.multiplyScalar(0.85).add(new THREE.Vector3(0, -rng.range(0.35, 0.6), 0)).normalize();
    star = { from, dir, travel: rng.range(...STAR.travel), life: rng.range(...STAR.life), age: 0 };
  };

  return {
    mesh,
    update(dt, camera) {
      if (!star) {
        wait -= dt;
        if (wait <= 0) spawn();
        mesh.visible = false;
        return;
      }
      star.age += dt;
      const k = star.age / star.life;
      if (k >= 1) {
        star = null;
        wait = rng.range(...STAR.gap);
        mesh.visible = false;
        return;
      }
      const eased = 1 - (1 - k) ** 1.6;
      camera.getWorldPosition(eye);
      uniforms.uFade.value = Math.min(1, k * 8) * (1 - k ** 3);
      head.copy(star.from).addScaledVector(star.dir, star.travel * eased).add(eye);
      tail.copy(head).addScaledVector(star.dir, -star.travel * STAR.tail * Math.min(1, k * 3));
      view.subVectors(head, eye).normalize();
      side.crossVectors(star.dir, view).normalize().multiplyScalar(STAR.width);
      pos.setXYZ(0, tail.x - side.x * 0.3, tail.y - side.y * 0.3, tail.z - side.z * 0.3);
      pos.setXYZ(1, tail.x + side.x * 0.3, tail.y + side.y * 0.3, tail.z + side.z * 0.3);
      pos.setXYZ(2, head.x - side.x, head.y - side.y, head.z - side.z);
      pos.setXYZ(3, head.x + side.x, head.y + side.y, head.z + side.z);
      pos.needsUpdate = true;
      mesh.visible = true;
    },
  };
};
