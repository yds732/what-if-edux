#!/usr/bin/env node
// Turns design sheets into 3D models with Tripo, and rigs the characters.
//
//   node --env-file=<.env> tools/assets/model.mjs <id> [<id> ...] [--force] [--rig-only] [--no-rig]
//
// Props are made from their sheet as one image; characters from the four views cut out of their turnaround,
// then given a skeleton. Raw results land in assets/.cache/raw/<id>.glb (and <id>.rigged.glb), with the task
// records beside them; tools/assets/optimize.mjs makes the files the game loads.
import fs from 'node:fs';
import path from 'node:path';
import { ASSETS, isModel } from '../../assets/catalog.mjs';
import { CACHE, ensureDir, sheetFile } from './lib/env.mjs';
import { MODEL_VERSION, RIG_VERSION, balance, download, runTask, upload } from './lib/tripo.mjs';
import { pool } from './lib/pool.mjs';
import { colourStats } from './lib/texture-stats.mjs';
import { splitViews } from './lib/views.mjs';

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const named = args.filter((a) => !a.startsWith('--'));
// `all` is every asset that has a sheet but no model yet
const ids = named[0] === 'all' ? Object.keys(ASSETS).filter((id) => isModel(id) && fs.existsSync(sheetFile(id)) && !fs.existsSync(path.join(CACHE, 'raw', `${id}.glb`))) : named;
if (ids.length === 0) {
  console.error(`usage: model.mjs <id> [...]\nassets: ${Object.keys(ASSETS).filter(isModel).join(', ')}`);
  process.exit(2);
}
const raw = ensureDir(path.join(CACHE, 'raw'));
const views = ensureDir(path.join(CACHE, 'views'));

/** How much is asked of Tripo, by how closely the thing will be looked at. Face limits keep raw files workable. */
const DETAIL = {
  hero: { texture_quality: 'detailed', geometry_quality: 'detailed', face_limit: 200000 },
  standard: { texture_quality: 'detailed', geometry_quality: 'standard', face_limit: 80000 },
};
const quality = (asset) => ({ model_version: MODEL_VERSION, texture: true, pbr: true, texture_alignment: 'original_image', ...DETAIL[asset.detail === 'hero' ? 'hero' : 'standard'] });

// the task id is what later steps (rigging) refer to; the download links in a task expire, so they are not kept
const record = (id, name, task) => fs.writeFileSync(path.join(raw, `${id}.${name}.json`), JSON.stringify({ task_id: task.task_id, type: task.type, consumed_credit: task.consumed_credit, output: task.type === 'animate_prerigcheck' ? task.output : Object.keys(task.output ?? {}) }, null, 2));
const fetchModel = async (task, file) => {
  const url = task.output?.pbr_model ?? task.output?.model ?? task.output?.base_model;
  if (!url) throw new Error(`task ${task.task_id} has no model in its output (${Object.keys(task.output ?? {}).join(', ')})`);
  return download(url, file);
};
const progress = (id, step) => (p) => { if (p % 25 === 0) console.log(`  ${id}: ${step} ${p}%`); };

const generate = async (id) => {
  const asset = ASSETS[id];
  const file = path.join(raw, `${id}.glb`);
  if (fs.existsSync(file) && !has('force')) return file;
  const sheet = fs.readFileSync(sheetFile(id));
  let body;
  if (asset.kind === 'character') {
    const cut = await splitViews(sheet);
    const files = [];
    for (const [i, name] of ['front', 'left', 'back', 'right'].entries()) {
      fs.writeFileSync(path.join(views, `${id}.${name}.png`), cut[i]);
      files.push(await upload(cut[i], `${id}-${name}.png`));
    }
    body = { type: 'multiview_to_model', files, ...quality(asset) };
  } else {
    body = { type: 'image_to_model', file: await upload(sheet, path.basename(sheetFile(id))), ...quality(asset) };
  }
  const task = await runTask(id, body.type, body, { onProgress: progress(id, 'model') });
  await fetchModel(task, file);
  // Tripo's texturing now and then hands back a grey sheet: the same in every channel
  const colour = await colourStats(file);
  const range = (v) => Math.max(...v) - Math.min(...v);
  if (!colour || (range(colour.mean) < 3 && range(colour.spread) < 1.5)) {
    fs.rmSync(file);
    throw new Error('the model came back without colour: run it again');
  }
  record(id, 'model', task);
  return file;
};

const rig = async (id) => {
  const file = path.join(raw, `${id}.rigged.glb`);
  if (fs.existsSync(file) && !has('force') && !has('rig-only')) return file;
  const made = JSON.parse(fs.readFileSync(path.join(raw, `${id}.model.json`), 'utf8'));
  const check = await runTask(id, 'animate_prerigcheck', { type: 'animate_prerigcheck', original_model_task_id: made.task_id });
  record(id, 'rigcheck', check);
  if (check.output?.riggable === false) throw new Error(`${id}: Tripo says this model cannot be rigged`);
  const task = await runTask(id, 'animate_rig', { type: 'animate_rig', original_model_task_id: made.task_id, model_version: RIG_VERSION, out_format: 'glb', rig_type: check.output?.rig_type ?? 'biped' }, { onProgress: progress(id, 'rig') });
  await fetchModel(task, file);
  record(id, 'rig', task);
  return file;
};

const one = async (id) => {
  const asset = ASSETS[id];
  if (!asset || !isModel(id)) throw new Error(`"${id}" is not something to model`);
  const out = [];
  if (!has('rig-only')) out.push(await generate(id));
  if (asset.kind === 'character' && !has('no-rig')) out.push(await rig(id));
  return `${id}: ${out.map((f) => `${path.basename(f)} ${(fs.statSync(f).size / 1e6).toFixed(1)} MB`).join(', ')}`;
};

const before = await balance();
const failed = await pool(ids, 6, one);
const after = await balance();
console.log(`credits: ${before.balance} -> ${after.balance} (spent ${before.balance - after.balance})`);
process.exit(failed ? 1 : 0);
