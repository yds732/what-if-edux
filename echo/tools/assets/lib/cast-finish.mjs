import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const smooth = (lo, hi, v) => {
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

const paintThroughMask = async (texture, maskName, paint) => {
  const image = sharp(Buffer.from(texture.getImage())).removeAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const mask = await sharp(fileURLToPath(new URL(`../../../assets/masks/${maskName}.png`, import.meta.url)))
    .resize(info.width, info.height).greyscale().raw().toBuffer();
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) paint(data, 3 * i, mask[i] / 255);
  }
  texture.setImage(await sharp(data, { raw: info }).png().toBuffer()).setMimeType('image/png');
};

export const finishLumi = async (doc) => {
  const material = doc.getRoot().listMaterials()[0];
  await paintThroughMask(material.getBaseColorTexture(), 'lumi-skin', (rgb, i, skin) => {
    rgb[i + 1] = Math.round(rgb[i + 1] * (1 - 0.17 * skin));
    rgb[i + 2] = Math.round(rgb[i + 2] * (1 - 0.27 * skin));
  });

  // In Lumi's bind pose the sleeve and the hoodie have separate surfaces below the armpit.
  // Remove weights from across that gap, blending back into the original shoulder.
  const mesh = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const position = mesh.getAttribute('POSITION'), joints = mesh.getAttribute('JOINTS_0'), weights = mesh.getAttribute('WEIGHTS_0');
  const p = [], j = [], w = [];
  for (let i = 0; i < position.getCount(); i++) {
    const [, y, z] = position.getElement(i, p);
    if (y < 0.32 || y >= 0.595) continue;
    joints.getElement(i, j);
    weights.getElement(i, w);
    // Joints 6 through 23 are her two collar-to-fingertip chains.
    const arm = w.reduce((sum, v, k) => sum + (j[k] >= 6 && j[k] <= 23 ? v : 0), 0);
    const body = w.reduce((sum, v, k) => sum + (j[k] >= 6 && j[k] <= 23 ? 0 : v), 0);
    if (arm === 0 || body === 0) continue;
    const seam = 0.29 - 0.395 * y;
    const feather = Math.max(0.0004, (y - 0.521) * 0.55);
    const sleeve = smooth(seam - feather, seam + feather, Math.abs(z));
    const share = sleeve + (arm / (arm + body) - sleeve) * smooth(0.525, 0.595, y);
    for (let k = 0; k < 4; k++) w[k] = j[k] >= 6 && j[k] <= 23 ? (w[k] / arm) * share : (w[k] / body) * (1 - share);
    weights.setElement(i, w);
  }
};

export const finishJamie = async (doc) => {
  const material = doc.getRoot().listMaterials()[0];
  // Remove the same crease from the painted shadows and the baked tangent-space normals.
  for (const [texture, target] of [[material.getBaseColorTexture(), [222, 167, 121]], [material.getNormalTexture(), [128, 128, 255]]]) {
    await paintThroughMask(texture, 'jamie-mouth', (rgb, i, amount) => {
      for (let k = 0; k < 3; k++) rgb[i + k] = Math.round(rgb[i + k] + (target[k] - rgb[i + k]) * amount);
    });
  }
  const mesh = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const position = mesh.getAttribute('POSITION'), normal = mesh.getAttribute('NORMAL');
  const p = [], n = [];
  for (let i = 0; i < position.getCount(); i++) {
    const [x, y, z] = position.getElement(i, p);
    const dy = y - 0.733, radius = Math.hypot(dy / 0.015, z / 0.030);
    if (x < 0.09 || radius >= 1) continue;
    // Fair the sculpted lip crease into the surrounding cheek and chin. The animated
    // mouth is painted here by FaceLayer, including its lip line and lower-lip shade.
    const blend = 1 - smooth(0.64, 1, radius);
    const surface = 0.1082 + 0.444 * dy - 12.12 * dy * dy - 7.8 * z * z;
    p[0] += (surface - x) * blend;
    position.setElement(i, p);
    normal.getElement(i, n);
    const ny = 24.24 * dy - 0.444, nz = 15.6 * z, length = Math.hypot(1, ny, nz);
    n[0] += (1 / length - n[0]) * blend;
    n[1] += (ny / length - n[1]) * blend;
    n[2] += (nz / length - n[2]) * blend;
    const scale = Math.hypot(...n);
    normal.setElement(i, n.map((v) => v / scale));
  }
};
