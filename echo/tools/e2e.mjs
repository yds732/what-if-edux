#!/usr/bin/env node
// Plays the whole week on autopilot, once per branch set, on the real GPU. Fails on any console error, any
// page exception, or a story that does not reach its end; writes a frame at every story beat so a run can be
// read like a storyboard.
//
//   node tools/e2e.mjs [--speed=8] [--base=http://127.0.0.1:5173/] [--only=a] [--from=monday] [--w=1280 --h=720] [--xr=1]
// --xr=1 plays inside an emulated Quest 3 session (IWER), exercising the headset code path.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const opt = { speed: 8, base: 'http://127.0.0.1:5173/', only: '', from: 'monday', w: 1280, h: 720, out: 'shots/e2e', timeout: 420000, xr: 0 };
for (const a of process.argv.slice(2)) {
  const m = /^--(\w+)=(.*)$/.exec(a);
  if (m) opt[m[1]] = Number.isNaN(Number(m[2])) || m[2] === '' ? m[2] : Number(m[2]);
}

const RUNS = [
  { id: 'a', query: 'tue=meet&thu=help&policy=combined' },
  { id: 'b', query: 'tue=haven&thu=haven&policy=investigate&misses=2' },
  { id: 'c', query: 'tue=meet&thu=haven&policy=expand' },
].filter((r) => !opt.only || String(opt.only).split(',').includes(r.id));

const EXPECTED_END = 'chapter:end';
const GPU_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
  '--hide-scrollbars', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: GPU_ARGS });
let failed = false;

for (const run of RUNS) {
  const dir = path.join(opt.out, run.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({ viewport: { width: opt.w, height: opt.h }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error' || (m.type() === 'warning' && !/X3595|GPU stall|WebGL: INVALID_ENUM/.test(text))) problems.push(`${m.type()}: ${text.slice(0, 500)}`);
  });
  page.on('pageerror', (e) => problems.push(`EXCEPTION: ${String(e.stack ?? e).slice(0, 1500)}`));
  const t0 = Date.now();
  await page.goto(`${opt.base}?chapter=${opt.from}&auto=1&speed=${opt.speed}&q=high&dpr=1&${run.query}${opt.xr ? '&xr=emulate' : ''}`, { waitUntil: 'load' });

  let seen = 0, ended = false, error = null, stats = [];
  const beats = [];
  while (Date.now() - t0 < opt.timeout) {
    const state = await page.evaluate(() => ({ beats: window.__BEATS ?? [], err: window.__ERR ?? null, info: window.__INFO ?? null }));
    if (state.err) {
      error = state.err;
      break;
    }
    if (state.beats.length > seen) {
      for (const beat of state.beats.slice(seen)) {
        beats.push(beat);
        if (!beat.startsWith('chapter:')) {
          await page.waitForTimeout(Math.round(2600 / opt.speed));
          const file = path.join(dir, `${String(beats.length).padStart(2, '0')}_${beat.replace(/[^\w.]/g, '_')}.jpg`);
          await page.screenshot({ path: file, type: 'jpeg', quality: 86 });
          if (state.info) stats.push({ beat, ms: +state.info.frameMs.toFixed(1), calls: state.info.calls, tris: state.info.triangles });
        }
      }
      seen = state.beats.length;
      if (state.beats.includes(EXPECTED_END)) {
        ended = true;
        break;
      }
    }
    await page.waitForTimeout(120);
  }
  const sound = await page.evaluate(() => window.__game?.audio.stats ?? null).catch(() => null);
  if (sound?.faults) problems.push(`sound: ${sound.faults} sound(s) failed to build`);
  const ok = ended && !error && problems.length === 0;
  if (!ok) failed = true;
  const worst = stats.reduce((a, b) => (b.calls > (a?.calls ?? 0) ? b : a), null);
  console.log(JSON.stringify({ run: run.id, ok, ended, seconds: Math.round((Date.now() - t0) / 1000), beats: beats.length, lastBeat: beats[beats.length - 1], mostDrawCalls: worst, sound }));
  if (error) console.log('  PAGE ERROR:', error.slice(0, 1500));
  if (problems.length) console.log('  CONSOLE:\n   ' + [...new Set(problems)].slice(0, 12).join('\n   '));
  if (!ended && !error) console.log('  STALLED after beats:', beats.slice(-4).join(' > '));
  await context.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
