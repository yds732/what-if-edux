#!/usr/bin/env node
// Says what a model file is made of, and writes its textures out as small pictures to look at.
//
//   node tools/assets/inspect.mjs <file.glb> [--textures] [--joints] [--rig]
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { CACHE, ensureDir } from './lib/env.mjs';
import { describeRig, readRig } from './lib/rig.mjs';

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error('usage: inspect.mjs <file.glb> [--textures] [--joints] [--rig]');
  process.exit(2);
}
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(file);
const root = doc.getRoot();
const name = path.basename(file, '.glb');

console.log(`extensions: ${root.listExtensionsUsed().map((e) => e.extensionName).join(', ') || 'none'}`);
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const tris = (prim.getIndices()?.getCount() ?? pos.getCount()) / 3;
    console.log(`mesh "${mesh.getName()}": ${pos.getCount()} vertices, ${tris} triangles, attributes ${prim.listSemantics().join(' ')}, min ${pos.getMin([]).map((v) => v.toFixed(3))} max ${pos.getMax([]).map((v) => v.toFixed(3))}`);
  }
}
for (const m of root.listMaterials()) {
  console.log(`material "${m.getName()}": base ${m.getBaseColorFactor().map((v) => v.toFixed(2))} metal ${m.getMetallicFactor()} rough ${m.getRoughnessFactor()} emissive ${m.getEmissiveFactor()} alpha ${m.getAlphaMode()} double ${m.getDoubleSided()}`);
}
for (const t of root.listTextures()) console.log(`texture "${t.getName() || t.getURI()}": ${t.getMimeType()} ${t.getSize()?.join('x')} ${(t.getImage().byteLength / 1e6).toFixed(2)} MB`);

if (flags.includes('--textures')) {
  const out = ensureDir(path.join(CACHE, 'previews'));
  const slots = { base: (m) => m.getBaseColorTexture(), normal: (m) => m.getNormalTexture(), orm: (m) => m.getMetallicRoughnessTexture(), emissive: (m) => m.getEmissiveTexture(), occlusion: (m) => m.getOcclusionTexture() };
  for (const m of root.listMaterials()) {
    for (const [slot, get] of Object.entries(slots)) {
      const t = get(m);
      if (!t) continue;
      const target = path.join(out, `${name}.${slot}.jpg`);
      await sharp(Buffer.from(t.getImage())).resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 82 }).toFile(target);
      const stats = await sharp(Buffer.from(t.getImage())).stats();
      console.log(`  ${slot}: mean ${stats.channels.map((c) => c.mean.toFixed(0)).join(',')} -> ${path.relative(process.cwd(), target)}`);
    }
  }
}

if (flags.includes('--joints')) {
  // world positions of every joint in the bind pose
  const world = new Map();
  const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
  const visit = (node, parent) => {
    const m = parent ? mul(parent, node.getMatrix()) : node.getMatrix();
    world.set(node, m);
    node.listChildren().forEach((c) => visit(c, m));
  };
  for (const scene of root.listScenes()) scene.listChildren().forEach((n) => visit(n, null));
  // how much of the mesh each joint carries
  const share = new Map();
  let total = 0;
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
    const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
    if (!J || !W) continue;
    const joints = root.listSkins()[0].listJoints();
    for (let i = 0; i < J.getCount(); i++) {
      const j = J.getElement(i, []), w = W.getElement(i, []);
      for (let k = 0; k < 4; k++) { share.set(joints[j[k]], (share.get(joints[j[k]]) ?? 0) + w[k]); total += w[k]; }
    }
  }
  for (const skin of root.listSkins()) {
    const joints = new Set(skin.listJoints());
    console.log(`skin "${skin.getName()}": ${joints.size} joints`);
    const walk = (j, depth) => {
      const m = world.get(j);
      console.log(`  ${'  '.repeat(depth)}${j.getName()}  at ${[m[12], m[13], m[14]].map((v) => v.toFixed(3)).join(' ')}  carries ${(100 * (share.get(j) ?? 0) / total).toFixed(1)}%`);
      j.listChildren().filter((c) => joints.has(c)).forEach((c) => walk(c, depth + 1));
    };
    skin.listJoints().filter((j) => !joints.has(j.getParentNode())).forEach((j) => walk(j, 0));
  }
  for (const scene of root.listScenes()) for (const n of scene.listChildren()) console.log(`scene node "${n.getName()}": T ${n.getTranslation().map((v) => v.toFixed(3))} R ${n.getRotation().map((v) => v.toFixed(3))} S ${n.getScale().map((v) => v.toFixed(3))}; children ${n.listChildren().map((c) => c.getName()).join(', ')}`);
}

// which joint the game will take for which part of the body
if (flags.includes('--rig')) console.log(describeRig(doc, readRig(doc)));
