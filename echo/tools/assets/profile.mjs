#!/usr/bin/env node
// Measures the hole through a model that faces +Z: at each height, how far from the middle the nearest surface is.
// It is how a gate's opening is found, to hang a film of light in it.
//
//   node tools/assets/profile.mjs <file.glb> [--rows=24] [--slab=0.25]
//   node tools/assets/profile.mjs <file.glb> --top=14
//
// `slab` is how far in front of and behind the model's middle plane counts, as a fraction of its depth.
// `--top=N` prints instead a map of the model seen from above, N cells each way: the height of the highest surface
// over each cell. It is how a jetty or a deck is found, to stand someone on it. Rows run from the back (-Z) to the
// front (+Z), columns from -X to +X.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const args = process.argv.slice(2);
const option = (name, fallback) => Number(args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: profile.mjs <file.glb> [--rows=24] [--slab=0.25]');
  process.exit(2);
}
await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).read(file);
const points = [];
for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
  const position = prim.getAttribute('POSITION');
  for (let i = 0; i < position.getCount(); i++) points.push(position.getElement(i, []));
}
const min = [0, 1, 2].map((a) => Math.min(...points.map((p) => p[a]))), max = [0, 1, 2].map((a) => Math.max(...points.map((p) => p[a])));
const top = option('top', 0);
if (top > 0) {
  console.log(`size ${max.map((v, a) => (v - min[a]).toFixed(3)).join(' x ')} m; x ${min[0].toFixed(2)}..${max[0].toFixed(2)}, z ${min[2].toFixed(2)}..${max[2].toFixed(2)}`);
  const cells = Array.from({ length: top }, () => new Array(top).fill(-Infinity));
  for (const p of points) {
    const cx = Math.min(top - 1, Math.floor(((p[0] - min[0]) / (max[0] - min[0])) * top)), cz = Math.min(top - 1, Math.floor(((p[2] - min[2]) / (max[2] - min[2])) * top));
    cells[cz][cx] = Math.max(cells[cz][cx], p[1]);
  }
  const mid = (a, i) => (min[a] + ((max[a] - min[a]) * (i + 0.5)) / top).toFixed(1).padStart(5);
  console.log(`      x${cells[0].map((_, i) => mid(0, i)).join(' ')}`);
  cells.forEach((row, i) => console.log(`z${mid(2, i)} ${row.map((h) => (Number.isFinite(h) ? h.toFixed(1) : '.').padStart(5)).join(' ')}`));
  process.exit(0);
}
const rows = option('rows', 24), slab = option('slab', 0.25) * (max[2] - min[2]), midZ = (min[2] + max[2]) / 2, midX = (min[0] + max[0]) / 2;
console.log(`size ${max.map((v, a) => (v - min[a]).toFixed(3)).join(' x ')} m, ${points.length} vertices; middle x ${midX.toFixed(3)}, z ${midZ.toFixed(3)}`);
for (let r = rows - 1; r >= 0; r--) {
  const y0 = min[1] + ((max[1] - min[1]) * r) / rows, y1 = min[1] + ((max[1] - min[1]) * (r + 1)) / rows;
  let near = Infinity;
  for (const p of points) if (p[1] >= y0 && p[1] < y1 && Math.abs(p[2] - midZ) < slab) near = Math.min(near, Math.abs(p[0] - midX));
  console.log(`y ${y0.toFixed(2)}..${y1.toFixed(2)}  clear to ${Number.isFinite(near) ? near.toFixed(3) : '-'}  ${'#'.repeat(Math.round((Number.isFinite(near) ? near : 0) * 20))}`);
}
