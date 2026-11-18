import * as THREE from 'three';
import { TAU } from '../../core/math';
import { merge, place, tint } from '../../core/geo';
import { recolourMaterial } from './recolour';

const BODY = new THREE.Color().setHSL(0.86, 0.55, 0.42);
const GLOW = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.95, 1.0).multiplyScalar(2.4), toneMapped: false });
const INLAY = new THREE.Color(1, 1, 1);

const glowing = (parts: THREE.BufferGeometry[]): THREE.Mesh => {
  const m = new THREE.Mesh(merge(parts), GLOW);
  m.userData.glow = true;
  return m;
};

const painted = (geo: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry => {
  if (geo.index) geo = geo.toNonIndexed();
  geo.deleteAttribute('uv');
  return tint(geo, color);
};

export const buildHoop = (): THREE.Group => {
  const R = 1, tube = 0.085;
  const lit = [
    painted(place(new THREE.TorusGeometry(R, 0.012, 8, 128), [0, 0, tube * 0.95]), INLAY),
    painted(place(new THREE.TorusGeometry(R, 0.012, 8, 128), [0, 0, -tube * 0.95]), INLAY),
  ];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 2;
    lit.push(painted(place(new THREE.SphereGeometry(0.045, 16, 10), [Math.cos(a) * (R + tube * 0.95), Math.sin(a) * (R + tube * 0.95), 0]), INLAY));
  }
  const mesh = new THREE.Mesh(painted(new THREE.TorusGeometry(R, tube, 24, 128), BODY), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.15 }));
  const glow = glowing(lit);
  const g = new THREE.Group();
  for (const m of [mesh, glow]) {
    m.position.y = R + tube;
    g.add(m);
  }
  return g;
};

const roundRect = (w: number, h: number, r: number): THREE.Shape => {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
};

const loop = (w: number, h: number, r: number): THREE.CurvePath<THREE.Vector3> => {
  const path = new THREE.CurvePath<THREE.Vector3>();
  const pts = roundRect(w, h, r).getPoints(24).map((p) => new THREE.Vector3(p.x, p.y, 0));
  for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i]!, pts[i + 1]!));
  return path;
};

export const buildBoardFrame = (wide: number, tall: number, centreY: number): THREE.Group => {
  const rim = 0.11, depth = 0.07, r = 0.16;
  const outer = roundRect(wide + rim * 2, tall + rim * 2, r + rim);
  outer.holes.push(roundRect(wide, tall, r) as unknown as THREE.Path);
  const frame = new THREE.ExtrudeGeometry(outer, { depth, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 4, curveSegments: 24 });
  frame.translate(0, centreY, -depth / 2);
  const line = (w: number, h: number, rr: number, z: number): THREE.BufferGeometry =>
    place(new THREE.TubeGeometry(loop(w, h, rr) as unknown as THREE.Curve<THREE.Vector3>, 400, 0.012, 6, true), [0, centreY, z]);
  const front = depth / 2 + 0.03;
  const parts = [painted(frame, BODY)];
  const lit = [
    painted(line(wide + rim, tall + rim, r + rim / 2, front), INLAY),
    painted(line(wide + rim, tall + rim, r + rim / 2, -front), INLAY),
  ];
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    lit.push(painted(place(new THREE.SphereGeometry(0.04, 16, 10), [sx * (wide / 2 + rim / 2 - 0.05), centreY + sy * (tall / 2 + rim / 2 - 0.05), front]), INLAY));
  }
  const bottom = centreY - tall / 2 - rim;
  for (const sx of [-1, 1]) {
    const x = sx * wide * 0.32;
    parts.push(painted(place(new THREE.CylinderGeometry(0.035, 0.045, bottom, 16), [x, bottom / 2, 0]), BODY));
    parts.push(painted(place(new THREE.CylinderGeometry(0.16, 0.2, 0.06, 32), [x, 0.03, 0]), BODY));
    lit.push(painted(place(new THREE.TorusGeometry(0.17, 0.008, 6, 48), [x, 0.065, 0], [Math.PI / 2, 0, 0]), INLAY));
  }
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.15 });
  recolourMaterial(material, 'board-frame');
  const g = new THREE.Group();
  g.add(new THREE.Mesh(merge(parts), material), glowing(lit));
  return g;
};
