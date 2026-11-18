import * as THREE from 'three';
import { addGoldCracks } from './cracks';


export const buildMountain = (): THREE.Group => {
  const group = new THREE.Group();
  const rock = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, flatShading: true });
  addGoldCracks(rock, { scale: 0.55, strength: 1.3 });
  const deep = new THREE.Color(0x1d2a52), slate = new THREE.Color(0x3a4f86), peri = new THREE.Color(0x6f86c6), violet = new THREE.Color(0x5a4f9a), mist = new THREE.Color(0xb4c6e4);
  const c = new THREE.Color();
  const mass = (x: number, z: number, layers: readonly (readonly [radius: number, height: number])[], seed: number, rot: number): void => {
    let y = -1;
    const total = layers.reduce((a, [, h]) => a + h, 0);
    for (const [k, [r, h]] of layers.entries()) {
      const next = layers[k + 1]?.[0] ?? r * 0.55;
      const g = new THREE.CylinderGeometry(next * 1.05, r, h, 13, 3).toNonIndexed();
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      const colors: number[] = [];
      for (let i = 0; i < p.count; i++) {
        const a = Math.atan2(p.getZ(i), p.getX(i));
        const bump = 1 + 0.14 * Math.sin(a * 3 + seed * 2 + k) + 0.08 * Math.sin(a * 7 + k * 3);
        p.setX(i, p.getX(i) * bump);
        p.setZ(i, p.getZ(i) * bump);
        const t = (y + h / 2 + p.getY(i) + 1) / total;
        c.copy(deep).lerp(slate, Math.min(1, t * 1.8)).lerp(peri, Math.max(0, t - 0.5) * 1.6).lerp(violet, 0.25 * (0.5 + 0.5 * Math.sin(a * 2 + seed)));
        if (t > 0.88) c.lerp(mist, (t - 0.88) * 5);
        colors.push(c.r, c.g, c.b);
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, rock);
      m.position.set(x + Math.sin(seed + k) * 0.6, y + h / 2, z + Math.cos(seed * 2 + k) * 0.5);
      m.rotation.y = rot + k * 0.4;
      group.add(m);
      y += h * 0.92;
    }
  };
  mass(0, 0, [[11, 6], [9, 6], [7.2, 5.5], [5.4, 5], [3.6, 4]], 1, 0);
  mass(-9, 3, [[7, 5], [5.5, 4.5], [3.8, 4]], 2, 0.7);
  mass(9.5, 2.5, [[7.5, 5], [5.8, 5], [4, 4.5]], 3, 1.3);
  return group;
};
