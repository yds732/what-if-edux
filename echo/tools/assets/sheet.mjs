#!/usr/bin/env node
// Makes design reference sheets with OpenAI's image model.
//
//   node --env-file=<.env> tools/assets/sheet.mjs <id> [<id> ...] [--refs=key-real,lumi] [--quality=high] [--draft] [--force] [--take=2]
//
// Each sheet is written to assets/sheets/<id>.jpg, with a small copy in the cache for looking at.
// Sheets of figures and objects are made with their world's style key as a reference image, so that everything
// shares one finish; a flat picture is its own finished image. An existing sheet is kept unless --force is given; --take=N writes <id>.takeN.jpg instead.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ASSETS, sheetPrompt, sheetSize } from '../../assets/catalog.mjs';
import { CACHE, SHEETS, ensureDir, sheetFile } from './lib/env.mjs';
import { IMAGE_MODELS, generateImage } from './lib/openai.mjs';
import { pool } from './lib/pool.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))?.split('=')[1] ?? (args.includes(`--${name}`) ? true : null);
const named = args.filter((a) => !a.startsWith('--'));
// `all` is every asset that has no sheet yet
const ids = named[0] === 'all' ? Object.keys(ASSETS).filter((id) => !fs.existsSync(sheetFile(id))) : named;
if (ids.length === 0) {
  console.error(`usage: sheet.mjs <id> [...]\nassets: ${Object.keys(ASSETS).join(', ')}`);
  process.exit(2);
}
ensureDir(SHEETS);
const previews = ensureDir(path.join(CACHE, 'previews'));
const take = flag('take');

const one = async (id) => {
  const asset = ASSETS[id];
  if (!asset) throw new Error(`no asset called "${id}"`);
  const file = sheetFile(take ? `${id}.take${take}` : id);
  if (fs.existsSync(file) && !flag('force')) return `${id}: kept existing sheet`;
  const refIds = typeof flag('refs') === 'string' ? flag('refs').split(',') : asset.kind === 'key' || asset.kind === 'picture' ? [] : [`key-${asset.world}`];
  const references = refIds.map((ref) => {
    const refFile = sheetFile(ref);
    if (!fs.existsSync(refFile)) throw new Error(`${id} needs the sheet "${ref}" as a reference: make that one first`);
    return { name: path.basename(refFile), buffer: fs.readFileSync(refFile) };
  });
  const prompt = references.length ? `${sheetPrompt(id)}\n\nThe attached image is the style reference: match its finish, materials, proportions and lighting exactly, but draw only what is described here.` : sheetPrompt(id);
  const started = Date.now();
  const png = await generateImage({
    asset: id, prompt, size: sheetSize(id), references,
    quality: flag('quality') ?? 'high', model: flag('draft') ? IMAGE_MODELS.draft : IMAGE_MODELS.detailed,
  });
  // full colour resolution: the model maker reads fine coloured edges off these
  await sharp(png).jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true }).toFile(file);
  await sharp(png).resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 86 }).toFile(path.join(previews, path.basename(file)));
  return `${id}: ${path.relative(process.cwd(), file)} (${Math.round((Date.now() - started) / 1000)} s)`;
};

// a few at a time: the image API is slow, and sheets do not depend on one another once their key exists
process.exit((await pool(ids, 6, one)) ? 1 : 0);
