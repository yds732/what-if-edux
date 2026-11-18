#!/usr/bin/env node
// Captures a run of frames a fixed time apart, so that motion can be judged: a rally, a combo, a camera move.
//
//   node tools/burst.mjs <name> "<query with &until=<beat>&after=<s>>" [--frames=8] [--step=0.1] [--w=960 --h=540]
//                        [--eval=<js run before the first frame>] [--base=http://127.0.0.1:5173/]
//
// Waits for the page to hold at its `until` beat, then takes the clock itself: each frame is `step` seconds of
// game time after the last, drawn once. Writes shots/burst/<name>-NN.jpg and shots/burst/<name>.jpg (all of them, tiled).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const GPU_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
const opt = { frames: 8, step: 0.1, w: 960, h: 540, base: 'http://127.0.0.1:5173/', eval: '', cols: 4, timeout: 120000 };
const rest = [];
for (const a of process.argv.slice(2)) {
  const m = /^--(\w+)=(.*)$/s.exec(a);
  if (m) opt[m[1]] = m[2] !== '' && !Number.isNaN(Number(m[2])) ? Number(m[2]) : m[2];
  else rest.push(a);
}
const [name, query] = rest;
if (!name || !query) {
  console.error('usage: burst.mjs <name> "<query with &until=<beat>>" [--frames=8] [--step=0.1] [--w= --h=] [--eval=<js>]');
  process.exit(2);
}
const out = path.join('shots', 'burst');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: GPU_ARGS });
const page = await (await browser.newContext({ viewport: { width: opt.w, height: opt.h } })).newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(String(e.stack ?? e).slice(0, 900)));
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text().slice(0, 400)); });
await page.goto(opt.base + '?' + query, { waitUntil: 'load' });
await page.waitForFunction(() => window.__READY === true || window.__ERR !== undefined, undefined, { timeout: opt.timeout });
const err = await page.evaluate(() => window.__ERR);
if (err) problems.push(err);
// from here the clock is ours: the page's own loop is stopped, and each frame is stepped and drawn by hand
await page.evaluate(() => { const app = window.__game.app; app.stop(); app.paused = false; });
if (opt.eval) await page.evaluate(opt.eval);
const files = [];
for (let i = 0; i < opt.frames && problems.length === 0; i++) {
  await page.evaluate((seconds) => {
    const app = window.__game.app;
    for (let t = 0; t < seconds - 1e-6; t += 1 / 120) app.step(1 / 120);
    app.render();
  }, i === 0 ? 1 / 120 : opt.step);
  const file = path.join(out, `${name}-${String(i).padStart(2, '0')}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
  files.push(file);
}
await browser.close();
if (problems.length) {
  console.log('PROBLEMS:\n  ' + problems.slice(0, 8).join('\n  '));
  process.exit(1);
}
// all of them on one sheet, in reading order
const tile = Math.round(1920 / opt.cols) - 4, tall = Math.round((tile * opt.h) / opt.w), rows = Math.ceil(files.length / opt.cols);
const sheet = path.join(out, `${name}.jpg`);
await sharp({ create: { width: opt.cols * (tile + 4) + 4, height: rows * (tall + 4) + 4, channels: 3, background: '#101014' } })
  .composite(await Promise.all(files.map(async (file, i) => ({ input: await sharp(file).resize(tile, tall).toBuffer(), left: 4 + (i % opt.cols) * (tile + 4), top: 4 + Math.floor(i / opt.cols) * (tall + 4) }))))
  .jpeg({ quality: 88 })
  .toFile(sheet);
console.log(`${files.length} frames -> ${sheet}`);
