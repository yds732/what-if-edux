#!/usr/bin/env node
// Capture frames of the running dev server on the real GPU, so a build can be judged by looking at it.
//
//   node tools/shot.mjs [--w=1600 --h=900 --dpr=1 --touch=1 --base=http://127.0.0.1:5173/ --out=shots --fmt=jpg]
//                       <name> "<query>" [<name> "<query>" ...]
//
// Each pair opens `<base>?<query>`, waits for window.__READY, and writes <out>/<name>.<fmt>.
// A query may carry `@eval=<js>` after the URL part (split on the first " @eval=") to run script before the shot.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = { w: 1600, h: 900, dpr: 1, touch: 0, base: 'http://127.0.0.1:5173/', out: 'shots', fmt: 'jpg', timeout: 90000, wait: 0 };
const pairs = [];
for (const a of args) {
  const m = /^--(\w+)=(.*)$/.exec(a);
  if (m) opt[m[1]] = Number.isNaN(Number(m[2])) ? m[2] : Number(m[2]);
  else pairs.push(a);
}
if (pairs.length === 0 || pairs.length % 2 !== 0) {
  console.error('usage: shot.mjs [--w= --h= --dpr= --touch= --base= --out= --fmt=] <name> "<query>" ...');
  process.exit(2);
}

export const GPU_ARGS = [
  '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader=false',
  '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
];

fs.mkdirSync(opt.out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: GPU_ARGS });
// --touch=1 is a phone or tablet: a coarse pointer and no mouse
const context = await browser.newContext({ viewport: { width: opt.w, height: opt.h }, deviceScaleFactor: opt.dpr, hasTouch: !!opt.touch, isMobile: !!opt.touch });
let failed = false;

for (let i = 0; i < pairs.length; i += 2) {
  const name = pairs[i];
  const [query, evalJs] = pairs[i + 1].split(' @eval=');
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text().slice(0, 600)}`); });
  page.on('pageerror', (e) => logs.push(`EXCEPTION: ${String(e.stack ?? e).slice(0, 1200)}`));
  const t0 = Date.now();
  const result = { name, ok: false };
  try {
    await page.goto(opt.base + (query ? '?' + query : ''), { waitUntil: 'load' });
    await page.waitForFunction(() => window.__READY === true || window.__ERR !== undefined, undefined, { timeout: opt.timeout });
    const err = await page.evaluate(() => window.__ERR);
    if (err) throw new Error('page error: ' + err);
    if (evalJs) result.eval = await page.evaluate(evalJs);
    if (opt.wait) await page.waitForTimeout(opt.wait);
    const file = path.join(opt.out, `${name}.${opt.fmt}`);
    await page.screenshot({ path: file, type: opt.fmt === 'png' ? 'png' : 'jpeg', ...(opt.fmt === 'png' ? {} : { quality: 90 }) });
    result.info = await page.evaluate(() => window.__INFO);
    result.file = file;
    result.ok = true;
  } catch (e) {
    result.error = String(e.message ?? e).slice(0, 1500);
    failed = true;
  }
  result.ms = Date.now() - t0;
  console.log(JSON.stringify(result));
  if (logs.length) console.log('  CONSOLE:\n   ' + logs.slice(0, 20).join('\n   '));
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
