import * as THREE from 'three';
import { makeHalo } from './atmosphere';

const STONE = 0x6f7fd0, STONE_DARK = 0x4a58a8, ROOF = 0x2c3478, GOLD = 0xffcf6a;

export const buildCastle = (): THREE.Group => {
  const group = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: STONE, roughness: 0.75 });
  const stoneDark = new THREE.MeshStandardMaterial({ color: STONE_DARK, roughness: 0.8 });
  const roof = new THREE.MeshStandardMaterial({ color: ROOF, roughness: 0.45, metalness: 0.2 });
  const gold = new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.3, metalness: 0.8, emissive: 0xffb04a, emissiveIntensity: 0.6 });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.82, 0.45).multiplyScalar(2.2) });

  const windows = (r: number, y0: number, y1: number, cx: number, cz: number, n: number): void => {
    for (let y = y0; y < y1; y += 2.4) for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + y * 0.7;
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.9), glow);
      w.position.set(cx + Math.sin(a) * (r + 0.02), y, cz + Math.cos(a) * (r + 0.02));
      w.rotation.y = a;
      group.add(w);
    }
  };
  const tower = (x: number, z: number, r: number, h: number, roofH: number): void => {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, h, 28), stone);
    body.position.set(x, h / 2, z);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.12, r * 1.12, 0.35, 28), stoneDark);
    band.position.set(x, h - 0.2, z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.13, 0.06, 8, 40), gold);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, h - 0.02, z);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r * 1.3, roofH, 28), roof);
    cone.position.set(x, h + roofH / 2, z);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.2, 10), gold);
    tip.position.set(x, h + roofH + 0.5, z);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), gold);
    orb.position.set(x, h + roofH + 0.05, z);
    group.add(body, band, ring, cone, tip, orb);
    windows(r, 2.5, h - 1.2, x, z, 4);
  };

  const keep = new THREE.Mesh(new THREE.BoxGeometry(10, 8, 6.5), stone);
  keep.position.set(0, 4, -1.2);
  const keepTop = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.5, 6.9), stoneDark);
  keepTop.position.set(0, 8.1, -1.2);
  for (let k = -4; k <= 4; k += 1.6) {
    const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.5), stoneDark);
    merlon.position.set(k, 8.7, 2.0);
    group.add(merlon);
  }
  const hall = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 5), stone);
  hall.position.set(0, 10.5, -1.6);
  const hallRoof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 4.3, 3.6, 4, 1), roof);
  hallRoof.rotation.y = Math.PI / 4;
  hallRoof.scale.set(1, 1, 0.85);
  hallRoof.position.set(0, 14.8, -1.6);
  group.add(keep, keepTop, hall, hallRoof);

  for (const [x, y] of [[-3.2, 3.6], [0, 3.6], [3.2, 3.6], [-3.2, 6.3], [3.2, 6.3], [-1.5, 11], [1.5, 11]] as const) {
    const arch = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16, 0, Math.PI), glow);
    arch.position.set(x, y + 0.5, y > 9 ? 0.92 : 2.06);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 1.0), glow);
    pane.position.set(x, y, y > 9 ? 0.92 : 2.06);
    group.add(arch, pane);
  }
  const rose = new THREE.Mesh(new THREE.CircleGeometry(0.9, 32), glow);
  rose.position.set(0, 12.6, 0.93);
  const roseRim = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.08, 8, 40), gold);
  roseRim.position.copy(rose.position);
  group.add(rose, roseRim);

  tower(-6, 0.6, 1.5, 11, 4.5);
  tower(6, 0.6, 1.5, 11, 4.5);
  tower(-4.6, -4.4, 1.2, 13, 4);
  tower(4.6, -4.4, 1.2, 13, 4);
  tower(0, -5.2, 1.7, 19, 6.5);

  const glowHalo = makeHalo(0xffd38a, 18, 0.35);
  glowHalo.position.set(0, 10, 0);
  group.add(glowHalo);
  group.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = false; });
  return group;
};
