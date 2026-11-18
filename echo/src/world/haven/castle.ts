import * as THREE from 'three';
import { addRockCracks, randomCracks } from './cracks';

const BOULDERS: readonly (readonly [x: number, z: number, wide: number, tall: number, deep: number])[] = [
  [-8, -3, 9, 4.5, 7], [-2.5, -6.5, 11, 7, 8], [5.5, -6, 10, 10.5, 8], [10, -3, 8, 8, 7], [1.5, -9.5, 12, 11, 7],
  [7.5, -8.5, 8, 14, 7], [-6, 1.6, 5, 2.4, 4], [7.5, 1.4, 6, 3.4, 4.5], [-5, -8.5, 8, 9, 6], [12, 0.5, 5, 4, 4.5],
];

const rockGeometry = (seed: number): THREE.BufferGeometry => {
  const g = new THREE.CylinderGeometry(0.82, 1, 1, 8, 3).toNonIndexed();
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
    const k = 1 + 0.16 * Math.sin(a * 3 + seed) + 0.1 * Math.sin(a * 5 + seed * 2.3) + 0.05 * Math.sin(y * 9 + seed);
    p.setXYZ(i, x * k, y + (y > 0.49 ? 0.06 * Math.sin(a * 2 + seed) : 0), z * k);
  }
  g.computeVertexNormals();
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const deep = new THREE.Color(0x1f2c5a), side = new THREE.Color(0x34488a), top = new THREE.Color(0x6f86c6), c = new THREE.Color();
  const colors: number[] = [];
  for (let i = 0; i < nrm.count; i++) {
    const up = nrm.getY(i), h = p.getY(i) + 0.5;
    c.copy(deep).lerp(side, Math.min(1, h * 1.3));
    if (up > 0.7) c.lerp(top, (up - 0.7) * 3);
    colors.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return g;
};

export const buildMountain = (): THREE.Group => {
  const group = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xe8b85a, roughness: 0.7, emissive: 0x7a4a10, emissiveIntensity: 0.4, flatShading: true });
  for (const [i, [x, z, wide, tall, deep]] of BOULDERS.entries()) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
    if (i % 2 === 0) addRockCracks(material, randomCracks(i + 3, 1, 1), { width: 0.1, sidesOnly: true, strength: 1 });
    const lower = tall > 6 ? tall * 0.58 : tall;
    const rock = new THREE.Mesh(rockGeometry(i * 1.7 + 1), material);
    rock.scale.set(wide / 2, lower, deep / 2);
    rock.position.set(x, lower / 2 - 0.4, z);
    rock.rotation.y = i * 0.8;
    group.add(rock);
    if (tall > 6) {
      const upper = new THREE.Mesh(rockGeometry(i * 2.3 + 4), material);
      upper.scale.set(wide * 0.36, tall - lower, deep * 0.36);
      upper.position.set(x + wide * 0.08, lower - 0.4 + (tall - lower) / 2, z - deep * 0.06);
      upper.rotation.y = i * 1.3;
      group.add(upper);
    }
    if (tall > 5 && i % 2 === 0) {
      const tuft = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 0), gold);
      tuft.scale.set(1.2, 0.8, 1.1);
      tuft.position.set(x + wide * 0.08, tall - 0.3, z - deep * 0.06);
      group.add(tuft);
    }
  }
  return group;
};

export const buildPortalRing = (radius: number): THREE.Group => {
  const group = new THREE.Group();
  const stone = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.13, 12, 72), new THREE.MeshStandardMaterial({ color: 0x2a3a72, roughness: 0.6, metalness: 0.2 }));
  const inner = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.88, radius * 0.035, 10, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.82, 0.5).multiplyScalar(2.6) }));
  const outer = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.12, radius * 0.02, 8, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.78, 0.42).multiplyScalar(2) }));
  const face = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.06, 6, 96), new THREE.MeshStandardMaterial({ color: 0xe0b060, roughness: 0.35, metalness: 0.8, emissive: 0x8a5a18, emissiveIntensity: 0.5 }));
  face.position.z = radius * 0.1;
  group.add(stone, inner, outer, face);
  return group;
};
