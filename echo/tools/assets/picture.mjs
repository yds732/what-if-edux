#!/usr/bin/env node
// Makes the flat pictures the game loads (floors, a rug, posters) from their sheets: resized and encoded as WebP.
// A repeating texture also gets a relief map, worked out from its light and dark: joints and grain are darker
// than the boards around them, so darker is taken as lower. Adds what it makes to public/assets/manifest.json.
//
//   node tools/assets/picture.mjs [<id> ...]
//
// With no ids, every picture that has a sheet is made.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ASSETS } from '../../assets/catalog.mjs';
import { PUBLIC_ASSETS, ensureDir, sheetFile } from './lib/env.mjs';

const out = ensureDir(path.join(PUBLIC_ASSETS, 'pictures'));
const manifestFile = path.join(PUBLIC_ASSETS, 'manifest.json');

/** A tangent-space normal map from a picture's brightness, wrapping at the edges as the texture does. */
const relief = async (image, width, height, strength) => {
  const grey = await sharp(image).greyscale().blur(1.1).raw().toBuffer();
  const at = (x, y) => grey[((y + height) % height) * width + ((x + width) % width)] / 255;
  const normal = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    // image rows run downwards and the map's green points up the image
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y - 1) - at(x, y + 1)) * strength;
    const length = Math.hypot(dx, dy, 1), i = (y * width + x) * 3;
    normal[i] = Math.round((-dx / length * 0.5 + 0.5) * 255);
    normal[i + 1] = Math.round((-dy / length * 0.5 + 0.5) * 255);
    normal[i + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
  }
  return sharp(normal, { raw: { width, height, channels: 3 } });
};

const one = async (id) => {
  const asset = ASSETS[id];
  const sheet = sheetFile(id);
  if (!fs.existsSync(sheet)) return null;
  const image = await sharp(sheet).resize({ width: asset.edge, height: asset.edge, fit: 'inside' }).removeAlpha().png().toBuffer();
  const { width, height } = await sharp(image).metadata();
  const entry = { world: asset.world, file: `pictures/${id}.webp`, size: [width, height], tile: asset.tile === true };
  await sharp(image).webp({ quality: 90 }).toFile(path.join(out, `${id}.webp`));
  if (asset.tile) {
    entry.normal = `pictures/${id}.normal.webp`;
    await (await relief(image, width, height, 3.2)).webp({ quality: 94 }).toFile(path.join(out, `${id}.normal.webp`));
  }
  return entry;
};

const named = process.argv.slice(2);
const ids = named.length ? named : Object.keys(ASSETS).filter((id) => ASSETS[id].kind === 'picture');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { assets: {} };
manifest.pictures ??= {};
for (const id of ids) {
  if (ASSETS[id]?.kind !== 'picture') throw new Error(`"${id}" is not a picture in the catalog`);
  const entry = await one(id);
  if (!entry) {
    console.log(`${id}: no sheet yet`);
    continue;
  }
  manifest.pictures[id] = entry;
  console.log(`${id}: ${entry.size.join(' x ')} px${entry.normal ? ', with relief' : ''}`);
}
manifest.pictures = Object.fromEntries(Object.entries(manifest.pictures).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
