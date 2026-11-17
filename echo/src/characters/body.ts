import * as THREE from 'three';
import { blob, curve1, lathe, merge, place, sweep, tint, torus, v3 } from '../core/geo';
import { applySkin, limbWeights, rigidSkin, torsoWeights, type BoneName, type Proportions } from './skeleton';

export interface Outfit {
  top: 'hoodie' | 'sweater';
  topColor: THREE.ColorRepresentation;
  /** Cuffs, collar, drawstrings, shirt. */
  accentColor: THREE.ColorRepresentation;
  bottom: 'trousers' | 'skirt';
  bottomColor: THREE.ColorRepresentation;
  shoeColor: THREE.ColorRepresentation;
  /** Luminous seams; set only for Haven's companions. */
  trimColor?: THREE.ColorRepresentation;
  /** A staff lanyard and card. */
  lanyardColor?: THREE.ColorRepresentation;
}

export interface BodyParts {
  /** Cloth, skin and shoes in one vertex-coloured, skinned geometry. */
  readonly body: THREE.BufferGeometry;
  /** Emissive seams, skinned the same way; null when the outfit has none. */
  readonly trim: THREE.BufferGeometry | null;
}

/** One hand in wrist space: fingers hang down -Y, the palm faces -X, the thumb points +Z. This is a left hand. */
export const handGeometry = (scale = 1): THREE.BufferGeometry => {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(place(blob(0.0165, 0.04, 0.035, 2), [0, -0.043, 0.002]));
  const fingers: [z: number, len: number, r: number][] = [[0.0245, 0.05, 0.0098], [0.0085, 0.056, 0.0102], [-0.0075, 0.052, 0.0098], [-0.0225, 0.042, 0.0088]];
  for (const [z, len, r] of fingers) {
    const path = [v3(0, -0.07, z), v3(-0.004, -0.07 - len * 0.5, z * 1.03), v3(-0.014, -0.07 - len * 0.93, z * 1.04)];
    parts.push(sweep(path, (t) => r * (1 - 0.18 * t), { radial: 7, steps: 6 }));
  }
  parts.push(sweep([v3(-0.003, -0.026, 0.026), v3(-0.006, -0.046, 0.045), v3(-0.012, -0.066, 0.052)], (t) => 0.0118 * (1 - 0.15 * t), { radial: 7, steps: 6 }));
  const g = merge(parts);
  if (scale !== 1) g.scale(scale, scale, scale);
  return g;
};

/** Mirrors a geometry across the YZ plane, keeping its faces outward. */
export const mirrorX = (g: THREE.BufferGeometry): THREE.BufferGeometry => {
  g.scale(-1, 1, 1);
  const index = g.index;
  if (index) {
    const a = index.array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1]!;
      a[i + 1] = a[i + 2]!;
      a[i + 2] = t;
    }
    index.needsUpdate = true;
  }
  g.computeVertexNormals();
  return g;
};

export const buildBody = (p: Proportions, joints: Record<BoneName, THREE.Vector3>, outfit: Outfit, skin: THREE.ColorRepresentation): BodyParts => {
  const b = p.build;
  const hipY = joints.hips.y, shoulderY = joints.armL.y, half = p.shoulderWidth / 2;
  const top = new THREE.Color(outfit.topColor), accent = new THREE.Color(outfit.accentColor);
  const cloth: THREE.BufferGeometry[] = [], trims: THREE.BufferGeometry[] = [];
  const torsoW = torsoWeights(joints);
  const chestRigid = (g: THREE.BufferGeometry) => rigidSkin(g, 'chest');
  const skirt = outfit.bottom === 'skirt';

  // ---- torso: one sweep from hem to the base of the neck. Waist, chest, then the slope of the shoulders ----
  const hemY = hipY - 0.068, topY = shoulderY + 0.05;
  const ty = (y: number): number => (y - hemY) / (topY - hemY);
  const puff = outfit.top === 'hoodie' ? 1.05 : 1;
  const width = curve1([[0, 0.127], [ty(hemY + 0.03), 0.133], [ty(hipY + 0.1), 0.122], [ty(shoulderY - 0.13), 0.13], [ty(shoulderY - 0.06), half + 0.012], [ty(shoulderY + 0.014), half + 0.002], [1, 0.07]]);
  const depth = curve1([[0, 0.097], [ty(hemY + 0.03), 0.104], [ty(hipY + 0.1), 0.096], [ty(shoulderY - 0.13), 0.107], [ty(shoulderY - 0.06), 0.096], [ty(shoulderY + 0.014), 0.074], [1, 0.05]]);
  const torso = sweep([v3(0, hemY, 0), v3(0, topY, 0)], (t) => ({ rx: width(t) * b * puff, ry: depth(t) * b * puff }), { radial: 24, steps: 22, startCap: 'flat' });
  cloth.push(applySkin(tint(torso, top), torsoW));
  const frontAt = (y: number): number => depth(ty(y)) * b * puff; // z of the chest surface at a height

  if (outfit.top === 'hoodie') {
    // resting hood, collar, a low pocket, drawstrings
    cloth.push(chestRigid(tint(place(blob(0.118 * b, 0.095, 0.04, 4, (q) => { if (q.y < 0) q.x *= 1 - 0.5 * q.y * q.y; }), [0, shoulderY - 0.012, -0.088 * b], [-0.2, 0, 0]), top)));
    cloth.push(chestRigid(tint(place(torus(0.064, 0.016, 10, 28), [0, shoulderY + 0.052, 0.012], [0.42, 0, 0], [1.12, 0.9, 1.2]), top.clone().multiplyScalar(0.95))));
    cloth.push(applySkin(tint(place(blob(0.082 * b, 0.034, 0.014, 2), [0, hipY + 0.045, frontAt(hipY + 0.045) - 0.003]), top.clone().multiplyScalar(0.92)), torsoW));
    for (const s of [-1, 1]) {
      const path = [v3(0.03 * s, shoulderY + 0.03, 0.07), v3(0.034 * s, shoulderY - 0.035, frontAt(shoulderY - 0.035) + 0.004), v3(0.037 * s, shoulderY - 0.1, frontAt(shoulderY - 0.1) + 0.005)];
      cloth.push(chestRigid(tint(sweep(path, () => 0.0048, { radial: 6, steps: 8 }), accent)));
      cloth.push(chestRigid(tint(place(blob(0.007, 0.012, 0.007, 1), path[2]!), accent)));
    }
  } else {
    cloth.push(chestRigid(tint(place(torus(0.056, 0.016, 8, 24), [0, shoulderY + 0.05, 0.003], [0.28, 0, 0], [1.08, 0.9, 1.14]), accent)));
  }
  if (outfit.lanyardColor !== undefined) {
    // staff lanyard: a ribbon from the back of the neck to a card on the chest
    const yc = shoulderY - 0.2;
    for (const s of [-1, 1]) {
      const ribbon = [v3(0.058 * s, shoulderY + 0.05, -0.01), v3(0.062 * s, shoulderY - 0.02, frontAt(shoulderY - 0.02) + 0.003), v3(0.006 * s, yc + 0.03, frontAt(yc + 0.03) + 0.004)];
      cloth.push(chestRigid(tint(sweep(ribbon, () => ({ rx: 0.006, ry: 0.002 }), { radial: 6, steps: 12 }), outfit.lanyardColor)));
    }
    cloth.push(chestRigid(tint(place(blob(0.03, 0.04, 0.004, 2, (q) => { q.x = Math.sign(q.x) * Math.abs(q.x) ** 0.5; q.y = Math.sign(q.y) * Math.abs(q.y) ** 0.5; }), [0, yc, frontAt(yc) + 0.006]), 0xf4f2ec)));
    cloth.push(chestRigid(tint(place(blob(0.018, 0.012, 0.003, 1), [0, yc + 0.012, frontAt(yc) + 0.0105]), outfit.lanyardColor)));
  }

  // ---- arms: the sleeve's rounded top sits in the shoulder; cuff; hand ----
  const sleeveR = curve1([[0, 0.052], [0.3, 0.05], [0.54, 0.046], [0.84, 0.049], [0.92, 0.047], [0.95, 0.042], [1, 0.042]]);
  for (const side of ['L', 'R'] as const) {
    const arm = `arm${side}` as const, fore = `fore${side}` as const, hand = `hand${side}` as const;
    const sx = joints[arm].x, s = side === 'L' ? 1 : -1;
    const wristY = joints[hand].y;
    const girth = b * (outfit.top === 'hoodie' ? 1.06 : 0.96);
    const sleeve = sweep([v3(sx, shoulderY - 0.02, 0), v3(sx, wristY - 0.004, 0)], (t) => sleeveR(t) * girth, { radial: 14, steps: 18, endCap: 'flat' });
    const weights = limbWeights('chest', [arm, fore, hand], joints);
    cloth.push(applySkin(tint(sleeve, top), weights));
    cloth.push(applySkin(tint(sweep([v3(sx, wristY + 0.026, 0), v3(sx, wristY - 0.008, 0)], () => 0.0455 * girth, { radial: 14, steps: 3, startCap: 'flat', endCap: 'flat' }), accent), () => [[fore, 1]]));
    const h = handGeometry(1.24);
    if (s < 0) mirrorX(h);
    place(h, [sx, wristY + 0.016, 0]);
    cloth.push(rigidSkin(tint(h, skin), hand));
    if (outfit.trimColor) {
      // a line of light down the outside of each sleeve
      const path = [v3(sx + s * 0.051 * girth, shoulderY - 0.07, 0), v3(sx + s * 0.049 * girth, wristY + 0.05, 0)];
      trims.push(applySkin(sweep(path, () => ({ rx: 0.004, ry: 0.011 }), { radial: 6, steps: 14, up: v3(0, 0, 1) }), weights));
    }
  }

  // ---- hips and legs ----
  const bottomColor = new THREE.Color(outfit.bottomColor);
  cloth.push(rigidSkin(tint(place(blob((p.hipWidth / 2 + 0.07) * b, 0.084, 0.084 * b, 4), [0, hipY - 0.035, 0]), bottomColor), 'hips'));
  const legR = curve1([[0, 0.083], [0.3, 0.077], [0.55, 0.069], [1, 0.066]]);
  for (const side of ['L', 'R'] as const) {
    const leg = `leg${side}` as const, shin = `shin${side}` as const, foot = `foot${side}` as const;
    const hx = joints[leg].x;
    const g = sweep([v3(hx, joints[leg].y + 0.01, 0), v3(hx, joints[foot].y - 0.012, 0)], (t) => legR(t) * b * (skirt ? 0.72 : 1), { radial: 14, steps: 18, endCap: 'flat' });
    cloth.push(applySkin(tint(g, skirt ? skin : bottomColor), limbWeights('hips', [leg, shin, foot], joints)));
    const shoe = merge([
      tint(place(blob(0.062, 0.052, 0.112, 3, (q) => { if (q.y < 0) q.y *= 0.45; if (q.z < 0) q.z *= 0.72; }), [hx, 0.04, 0.032]), outfit.shoeColor),
      tint(place(blob(0.066, 0.022, 0.12, 3, (q) => { if (q.z < 0) q.z *= 0.74; }), [hx, 0.02, 0.032]), 0xf1eee8),
      tint(place(blob(0.052, 0.028, 0.044, 2), [hx, 0.044, 0.104]), 0xf1eee8),
    ]);
    cloth.push(rigidSkin(shoe, foot));
  }
  if (skirt) {
    // long high-waisted skirt with soft folds, hanging from the hips
    const y0 = hipY + 0.13, y1 = joints.shinL.y - 0.17;
    const w0 = width(ty(y0)) * b + 0.006;
    const g = lathe([[0.02, y0 + 0.012], [w0, y0 + 0.004], [w0 + 0.004, y0 - 0.03], [0.166 * b, hipY - 0.02], [0.196 * b, (hipY + y1) / 2], [0.228 * b, y1], [0.218 * b, y1 - 0.012], [0.02, y1 - 0.004]], 44, 1, 0.8);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const k = Math.min(1, Math.max(0, (hipY - y) / (hipY - y1)));
      const fold = 1 + 0.03 * k * Math.sin(Math.atan2(z, x) * 11);
      pos.setXYZ(i, x * fold, y, z * fold);
    }
    g.computeVertexNormals();
    cloth.push(rigidSkin(tint(g, bottomColor), 'hips'));
  }

  // ---- neck ----
  const neck = sweep([v3(0, shoulderY + 0.02, 0), v3(0, joints.head.y + 0.035, 0)], () => 0.04 * b, { radial: 12, steps: 4 });
  cloth.push(applySkin(tint(neck, skin), (q) => (q.y < joints.neck.y ? [['chest', 1]] : [['neck', 1]])));

  if (outfit.trimColor) {
    // chest seam: a soft V of light from the collar, and one line above the hem
    for (const s of [-1, 1]) {
      const ya = shoulderY + 0.005, yb = shoulderY - 0.15;
      trims.push(applySkin(sweep([v3(0.07 * s, ya, frontAt(ya) + 0.002), v3(0.045 * s, (ya + yb) / 2, frontAt((ya + yb) / 2) + 0.003), v3(0.018 * s, yb, frontAt(yb) + 0.003)], () => 0.0038, { radial: 6, steps: 10 }), torsoW));
    }
    const yh = hemY + 0.03, wz = width(ty(yh)) * b * puff, dz = frontAt(yh);
    const arc = [-0.8, -0.4, 0, 0.4, 0.8].map((a) => v3(Math.sin(a) * wz * 1.01, yh, Math.cos(a) * dz * 1.02));
    trims.push(applySkin(sweep(arc, () => 0.0036, { radial: 6, steps: 16 }), torsoW));
  }

  return { body: merge(cloth), trim: trims.length ? merge(trims) : null };
};
