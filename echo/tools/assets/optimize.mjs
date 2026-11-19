#!/usr/bin/env node
// Turns the raw models from Tripo into the files the game loads: one per graphics tier, each simplified to a
// triangle budget, with textures resized and re-encoded, geometry compressed, and the model turned to face +Z,
// scaled to its real size in metres and stood on the origin. For figures it also works out which bone is which.
// Writes public/assets/manifest.json to say what there is.
//
//   node tools/assets/optimize.mjs [<id> ...] [--tiers=high,medium,low] [--notes]
//
// With no ids, every asset that has a raw model is processed.
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, simplify, textureCompress, transformPrimitive, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { ASSETS, glowOf, isModel } from '../../assets/catalog.mjs';
import { CACHE, PUBLIC_ASSETS, ensureDir } from './lib/env.mjs';
import { readRig } from './lib/rig.mjs';
import { finishJamie, finishLumi } from './lib/cast-finish.mjs';

const args = process.argv.slice(2);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const TIERS = (option('tiers') ?? 'high,medium,low').split(',');
const raw = path.join(CACHE, 'raw');
const out = ensureDir(path.join(PUBLIC_ASSETS, 'models'));
const manifestFile = path.join(PUBLIC_ASSETS, 'manifest.json');

/** Triangles and texture edge per tier, by what the asset is and how closely it is looked at. */
const BUDGET = {
  'character/hero': { high: [90000, 2048], medium: [40000, 1024], low: [16000, 512] },
  'character/standard': { high: [60000, 1024], medium: [28000, 1024], low: [12000, 512] },
  'prop/hero': { high: [60000, 2048], medium: [25000, 1024], low: [10000, 512] },
  'prop/standard': { high: [22000, 1024], medium: [11000, 512], low: [5000, 512] },
  'prop/repeated': { high: [7000, 1024], medium: [3500, 512], low: [1800, 512] },
};

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const triangles = (doc) => doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);

const bounds = (doc) => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const p = prim.getAttribute('POSITION'), lo = p.getMin([]), hi = p.getMax([]);
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], lo[a]); max[a] = Math.max(max[a], hi[a]); }
  }
  return { min, max, size: max.map((v, a) => v - min[a]) };
};

/**
 * Furniture drawn at an angle is modelled at that angle. This turns a model about the vertical until its
 * footprint is smallest, which stands a wardrobe square to the wall; a round thing, or one already square, is
 * left as it is.
 */
const squareUp = (doc) => {
  const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  const points = prims.flatMap((prim) => {
    const position = prim.getAttribute('POSITION'), every = Math.ceil(position.getCount() / 8000);
    return Array.from({ length: Math.floor(position.getCount() / every) }, (_, i) => position.getElement(i * every, []));
  });
  const footprint = (degrees) => {
    const c = Math.cos((degrees * Math.PI) / 180), s = Math.sin((degrees * Math.PI) / 180);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, , z] of points) {
      const u = c * x + s * z, v = -s * x + c * z;
      x0 = Math.min(x0, u); x1 = Math.max(x1, u); z0 = Math.min(z0, v); z1 = Math.max(z1, v);
    }
    return (x1 - x0) * (z1 - z0);
  };
  let best = 0;
  for (let d = -45; d <= 45; d += 0.5) if (footprint(d) < footprint(best)) best = d;
  if (footprint(best) > 0.97 * footprint(0)) return;
  const c = Math.cos((best * Math.PI) / 180), s = Math.sin((best * Math.PI) / 180);
  for (const prim of prims) transformPrimitive(prim, [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
};

/** The height of the highest point of a model above one spot of its footprint: (0, 0) is the middle, 1 an edge. */
const surfaceHeight = (doc, b, [u, v]) => {
  const x = (b.min[0] + b.max[0]) / 2 + (u * b.size[0]) / 2, z = (b.min[2] + b.max[2]) / 2 + (v * b.size[2]) / 2;
  const near = 0.06 * Math.min(b.size[0], b.size[2]);
  let top = -Infinity;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const position = prim.getAttribute('POSITION');
    for (let i = 0, p = []; i < position.getCount(); i++) {
      position.getElement(i, p);
      if (Math.hypot(p[0] - x, p[2] - z) < near) top = Math.max(top, p[1]);
    }
  }
  if (top === -Infinity) throw new Error(`nothing of the model lies over (${u}, ${v}) of its footprint`);
  return top - b.min[1];
};

/**
 * Lays a long, thin model along Z with its thick end at -Z, however it came out of the generator: an arm drawn
 * slanting across its sheet is modelled slanting. The long direction is the one the vertices spread most along.
 */
const layAlongZ = (doc) => {
  const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  const points = prims.flatMap((prim) => {
    const position = prim.getAttribute('POSITION');
    return Array.from({ length: position.getCount() }, (_, i) => position.getElement(i, []));
  });
  const mean = [0, 1, 2].map((a) => points.reduce((sum, p) => sum + p[a], 0) / points.length);
  const off = points.map((p) => p.map((v, a) => v - mean[a]));
  const spread = [0, 1, 2].map((a) => [0, 1, 2].map((b) => off.reduce((sum, p) => sum + p[a] * p[b], 0)));
  let axis = [1, 1, 1];
  for (let n = 0; n < 60; n++) {
    axis = spread.map((row) => row[0] * axis[0] + row[1] * axis[1] + row[2] * axis[2]);
    const length = Math.hypot(...axis);
    axis = axis.map((v) => v / length);
  }
  const along = off.map((p) => p[0] * axis[0] + p[1] * axis[1] + p[2] * axis[2]);
  const low = Math.min(...along), high = Math.max(...along), third = (high - low) / 3;
  // how thick an end is: how far its points lie, on average, from the middle of that end
  const girth = (from, to) => {
    const across = off.filter((_, i) => along[i] >= from && along[i] <= to).map((p) => { const d = p[0] * axis[0] + p[1] * axis[1] + p[2] * axis[2]; return p.map((v, a) => v - d * axis[a]); });
    const middle = [0, 1, 2].map((a) => across.reduce((sum, p) => sum + p[a], 0) / across.length);
    return across.reduce((sum, p) => sum + Math.hypot(p[0] - middle[0], p[1] - middle[1], p[2] - middle[2]), 0) / across.length;
  };
  if (girth(high - third, high) > girth(low, low + third)) axis = axis.map((v) => -v);
  // the turn that takes the axis onto +Z by the shortest way
  const [x, y, z] = axis;
  if (z < -0.9999) throw new Error('the model already lies along -Z: turn it with `yaw` instead');
  const k = 1 / (1 + z);
  const turn = [1 - x * x * k, -x * y * k, x, 0, -x * y * k, 1 - y * y * k, y, 0, -x, -y, z, 0, 0, 0, 0, 1];
  for (const prim of prims) transformPrimitive(prim, turn);
};

/**
 * Rolls a model that lies along Z about that axis until it is flat: its widest spread across lies along X and its
 * thinnest along Y. A bat drawn at an angle is modelled at that angle; this lays its blade level.
 */
const layFlat = (doc) => {
  const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  let n = 0, mx = 0, my = 0, xx = 0, yy = 0, xy = 0;
  const each = (fn) => { for (const prim of prims) { const position = prim.getAttribute('POSITION'); for (let i = 0, p = []; i < position.getCount(); i++) fn(position.getElement(i, p)); } };
  each((p) => { n++; mx += p[0]; my += p[1]; });
  mx /= n; my /= n;
  each((p) => { const x = p[0] - mx, y = p[1] - my; xx += x * x; yy += y * y; xy += x * y; });
  // the direction across the model that its points spread most along, as an angle from +X
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy), c = Math.cos(-angle), s = Math.sin(-angle);
  for (const prim of prims) transformPrimitive(prim, [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
};

/**
 * Props leave Tripo facing +X, a unit or so across, floating about their own middle. The game wants them facing
 * +Z, in metres, standing on the origin: that is baked into the vertices so a prop can be placed as it is.
 *
 * `fit` says how big: ['x' | 'y' | 'z', metres] sets the size along an axis; ['top', metres, [u, v]] sets the
 * height of the surface over a spot of the footprint, which is how a chair gets its seat at seat height; and
 * ['box', [x, y, z]] sets all three sizes, for furniture whose footprint and height the room depends on (an axis
 * given as null keeps the thing's own proportion: a raft tile must be square, and as tall as it comes).
 */
const normaliseProp = (doc, asset) => {
  if (asset.align === 'long-axis') layAlongZ(doc);
  if (asset.flat) layFlat(doc);
  const yaw = ((asset.yaw ?? (asset.align ? 0 : -90)) * Math.PI) / 180, c = Math.cos(yaw), s = Math.sin(yaw);
  const turn = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) transformPrimitive(prim, turn);
  if (!asset.align) squareUp(doc);
  const b = bounds(doc);
  const [axis, metres, spot] = asset.fit ?? ['y', 1];
  const uniform = () => metres / (axis === 'top' ? surfaceHeight(doc, b, spot) : b.size['xyz'.indexOf(axis)]);
  const boxed = () => {
    const set = metres.map((m, a) => (m == null ? null : m / b.size[a])), given = set.filter((k) => k != null);
    return set.map((k) => k ?? given.reduce((sum, v) => sum + v, 0) / given.length);
  };
  const [kx, ky, kz] = axis === 'box' ? boxed() : new Array(3).fill(uniform());
  const place = [kx, 0, 0, 0, 0, ky, 0, 0, 0, 0, kz, 0, -kx * (b.min[0] + b.max[0]) / 2, -ky * b.min[1], -kz * (b.min[2] + b.max[2]) / 2, 1];
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) transformPrimitive(prim, place);
  // `band: k` slims a hoop that faces +Z: its band keeps its opening and is narrowed to k of its width
  if (asset.band) {
    const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
    const fitted = bounds(doc), cy = (fitted.min[1] + fitted.max[1]) / 2;
    let opening = Infinity;
    for (const prim of prims) {
      const position = prim.getAttribute('POSITION');
      for (let i = 0, p = []; i < position.getCount(); i++) opening = Math.min(opening, Math.hypot(position.getElement(i, p)[0], p[1] - cy));
    }
    let low = Infinity;
    for (const prim of prims) {
      const position = prim.getAttribute('POSITION');
      for (let i = 0, p = []; i < position.getCount(); i++) {
        position.getElement(i, p);
        const r = Math.hypot(p[0], p[1] - cy), k = (opening + (r - opening) * asset.band) / r;
        position.setElement(i, [p[0] * k, cy + (p[1] - cy) * k, p[2]]);
        low = Math.min(low, cy + (p[1] - cy) * k);
      }
    }
    for (const prim of prims) transformPrimitive(prim, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -low, 0, 1]);
  }
  // `lengthen: [z, by]` draws out everything behind z (in metres, after fitting): a sleeve that must run off-screen
  if (asset.lengthen) {
    const [from, by] = asset.lengthen;
    for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION');
      for (let i = 0, p = []; i < position.getCount(); i++) {
        position.getElement(i, p);
        if (p[2] < from) position.setElement(i, [p[0], p[1], from + (p[2] - from) * by]);
      }
    }
  }
};

const multiply = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const applyTo = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
const jointNames = (doc) => doc.getRoot().listSkins()[0].listJoints().map((j) => j.getName()).join('|');

/**
 * Figures leave Tripo the same way as props. Their vertices follow the skeleton, so it is the skeleton that is
 * turned, scaled to the figure's height and moved, to stand the figure on the origin with its hips over it.
 */
const normaliseCharacter = (doc, asset, rig) => {
  const skin = doc.getRoot().listSkins()[0], joints = skin.listJoints(), inverse = skin.getInverseBindMatrices();
  // where the skin puts a vertex at rest: one and the same for every joint of a skeleton in its bind pose
  const rest = joints.map((j, i) => multiply(j.getWorldMatrix(), inverse.getElement(i, [])));
  if (rest.some((m) => m.some((v, k) => Math.abs(v - rest[0][k]) > 1e-3))) throw new Error('the skeleton is not in its bind pose');
  const b = bounds(doc);
  const ys = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => applyTo(rest[0], [n & 1 ? b.max[0] : b.min[0], n & 2 ? b.max[1] : b.min[1], n & 4 ? b.max[2] : b.min[2]])[1]);
  const low = Math.min(...ys), k = asset.height / (Math.max(...ys) - low);
  const hipL = joints[rig.legL[0]].getWorldTranslation(), hipR = joints[rig.legR[0]].getWorldTranslation();
  const cx = (hipL[0] + hipR[0]) / 2, cz = (hipL[2] + hipR[2]) / 2;
  // (x, y, z) -> k (cz - z, y - low, x - cx): +X turned to +Z, in metres, soles on the floor
  const place = [0, 0, k, 0, 0, k, 0, 0, -k, 0, 0, 0, k * cz, -k * low, -k * cx, 1];
  let top = joints[rig.hips];
  while (top.getParentNode()) top = top.getParentNode();
  top.setMatrix(multiply(place, top.getMatrix()));
};

/**
 * Dark glass comes out of the generator with blotchy shine and painted-on scratches. Wherever the colour is near
 * black, this makes the surface one even, smooth, flat black, so that a switched-off screen reflects the room cleanly.
 */
const evenGlass = async (doc) => {
  const EDGE = 2048;
  const pixels = (texture) => sharp(Buffer.from(texture.getImage())).resize(EDGE, EDGE, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const store = async (texture, data) => texture.setImage(await sharp(data, { raw: { width: EDGE, height: EDGE, channels: 3 } }).png().toBuffer()).setMimeType('image/png');
  for (const material of doc.getRoot().listMaterials()) {
    const maps = [material.getBaseColorTexture(), material.getMetallicRoughnessTexture(), material.getNormalTexture()];
    if (maps.some((m) => !m)) continue;
    const [colour, surface, normal] = await Promise.all(maps.map(pixels));
    for (let i = 0; i < colour.length; i += 3) {
      if (Math.max(colour[i], colour[i + 1], colour[i + 2]) > 34) continue;
      colour.set([6, 7, 10], i);
      // occlusion, roughness, metalness
      surface.set([255, 34, 0], i);
      normal.set([128, 128, 255], i);
    }
    await Promise.all([store(maps[0], colour), store(maps[1], surface), store(maps[2], normal)]);
  }
};

// gltf-transform reports every pruned accessor; the summary line per asset is what matters here
const quiet = { debug() {}, info() {}, warn: (m) => console.warn(m), error: (m) => console.error(m) };

/** What the game is told about an asset that is not in its model files: this comes straight from the catalog. */
const notes = (id) => {
  const asset = ASSETS[id];
  const out = { kind: asset.kind, world: asset.world };
  if (glowOf(id)) out.glow = glowOf(id);
  if (asset.kind === 'character') {
    out.height = asset.height;
    if (asset.face) out.face = asset.face;
  }
  return out;
};

const one = async (id) => {
  const asset = ASSETS[id];
  const character = asset.kind === 'character';
  const source = path.join(raw, character ? `${id}.rigged.glb` : `${asset.raw ?? id}.glb`);
  if (!fs.existsSync(source)) return null;
  const budget = BUDGET[`${asset.kind}/${asset.detail ?? 'standard'}`];
  const entry = { ...notes(id), tiers: {} };
  // `only`: the model is kept in one weight, which every graphics tier then loads
  for (const tier of asset.only ? [asset.only] : TIERS) {
    const [maxTriangles, textureEdge] = asset.budget ?? budget[tier];
    const doc = await io.read(source);
    doc.setLogger(quiet);
    const before = triangles(doc);
    if (id === 'lumi') await finishLumi(doc);
    if (id === 'jamie') await finishJamie(doc);
    if (character) {
      entry.rig = readRig(doc);
      normaliseCharacter(doc, asset, entry.rig);
    } else normaliseProp(doc, asset);
    const skeleton = character ? jointNames(doc) : null;
    if (asset.glass) await evenGlass(doc);
    // measured here, in metres: compression below stores positions as integers
    if (!character) entry.size = bounds(doc).size.map((v) => +v.toFixed(4));
    await doc.transform(
      dedup(),
      weld(),
      simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, maxTriangles / before), error: 0.02 }),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [textureEdge, textureEdge], quality: 88, slots: /^(?!normalTexture).*$/ }),
      // normals show every artefact as a lighting fault: keep them nearly lossless
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [textureEdge, textureEdge], quality: 96, slots: /^normalTexture$/ }),
      prune(),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    // the rig names joints by their place in the list
    if (character && jointNames(doc) !== skeleton) throw new Error(`${id}: optimising changed the skeleton's joints`);
    const file = `${id}.${tier}.glb`;
    await io.write(path.join(out, file), doc);
    entry.tiers[tier] = { file: `models/${file}`, triangles: Math.round(triangles(doc)), bytes: fs.statSync(path.join(out, file)).size };
  }
  return entry;
};

const ids = args.filter((a) => !a.startsWith('--'));
const targets = ids.length ? ids : Object.keys(ASSETS).filter(isModel);
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { assets: {} };
for (const id of targets) {
  if (!ASSETS[id] || !isModel(id)) throw new Error(`"${id}" is not a model in the catalog`);
  // --notes: the catalog's notes changed (a glow, where a face sits) but the models did not
  if (args.includes('--notes')) {
    if (manifest.assets[id]) manifest.assets[id] = { ...manifest.assets[id], glow: undefined, face: undefined, ...notes(id) };
    continue;
  }
  const entry = await one(id);
  if (!entry) {
    if (ids.length) console.log(`${id}: no raw model yet`);
    continue;
  }
  manifest.assets[id] = entry;
  console.log(`${id}: ${Object.entries(entry.tiers).map(([t, v]) => `${t} ${v.triangles} tris ${(v.bytes / 1e6).toFixed(2)} MB`).join(' | ')}${entry.size ? ` | ${entry.size.join(' x ')} m` : ''}`);
}
manifest.assets = Object.fromEntries(Object.entries(manifest.assets).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
