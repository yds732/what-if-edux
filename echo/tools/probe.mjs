#!/usr/bin/env node
// Opens the running dev server at a query and prints the value of an expression every few seconds: for watching
// a game play itself (the arcade on autopilot, a chapter at speed) without looking at pictures.
//
//   node tools/probe.mjs "<query>" "<js expression>" [--for=60] [--every=2] [--until=<js expression>] [--shot=name]
//                        [--w=1280 --h=720 --base=http://127.0.0.1:5173/]
//
// Stops after `for` seconds, or as soon as `until` is true. Exits 1 on a page error or if `until` never came true.
// `--shot=name` writes shots/<name>.jpg of the last frame.
import { chromium } from 'playwright';
import fs from 'node:fs';

const GPU_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
const args = process.argv.slice(2);
const opt = { for: 60, every: 2, until: '', shot: '', w: 1280, h: 720, base: 'http://127.0.0.1:5173/' };
const rest = [];
for (const a of args) {
  const m = /^--(\w+)=(.*)$/s.exec(a);
  if (m) opt[m[1]] = m[2] !== '' && !Number.isNaN(Number(m[2])) ? Number(m[2]) : m[2];
  else rest.push(a);
}
const [query, expression] = rest;
if (!query || !expression) {
  console.error('usage: probe.mjs "<query>" "<js expression>" [--for=60] [--every=2] [--until=<js>] [--shot=name]');
  process.exit(2);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: GPU_ARGS });
const page = await (await browser.newContext({ viewport: { width: opt.w, height: opt.h } })).newPage();
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text().slice(0, 500)); });
page.on('pageerror', (e) => problems.push(String(e.stack ?? e).slice(0, 900)));
await page.goto(opt.base + '?' + query, { waitUntil: 'load' });
const started = Date.now();
let reached = !opt.until;
for (;;) {
  await page.waitForTimeout(opt.every * 1000);
  const seconds = Math.round((Date.now() - started) / 1000);
  const value = await page.evaluate(`(() => { try { return ${expression}; } catch (e) { return 'ERR ' + e.message; } })()`);
  console.log(`${String(seconds).padStart(4)}s ${JSON.stringify(value)}`);
  const err = await page.evaluate(() => window.__ERR);
  if (err) problems.push(err);
  if (opt.until && (await page.evaluate(`(() => { try { return !!(${opt.until}); } catch { return false; } })()`))) reached = true;
  if (problems.length || (opt.until && reached) || seconds >= opt.for) break;
}
if (opt.shot) {
  fs.mkdirSync('shots', { recursive: true });
  await page.screenshot({ path: `shots/${opt.shot}.jpg`, type: 'jpeg', quality: 90 });
}
await browser.close();
if (problems.length) console.log('PROBLEMS:\n  ' + problems.slice(0, 8).join('\n  '));
if (!reached) console.log(`"${opt.until}" never came true`);
process.exit(problems.length || !reached ? 1 : 0);
