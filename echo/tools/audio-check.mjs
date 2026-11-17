#!/usr/bin/env node
// Measures the game's sound, because a test run cannot listen to it. Renders every soundscape, every sound
// effect and a line from every speaker offline in Chrome, prints peak, RMS and length for each, and then runs
// the engine for a few seconds against a real AudioContext. Exits non-zero if anything is silent, clips,
// contains NaN, misses its level, leaves nodes running, or logs to the console.
//
//   node tools/audio-check.mjs [--only=<text>] [--live=0] [--wav=shots/audio]
//
// --only renders just the rows whose name contains the text; --wav also saves every render as a WAV file, to
// be listened to.
// It bundles src/audio/check.ts itself and runs it on a blank page: no dev server is needed, and none is touched.
import { chromium } from 'playwright';
import { build } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const opt = { only: '', live: 1, wav: '' };
for (const a of process.argv.slice(2)) {
  const m = /^--(\w+)=(.*)$/.exec(a);
  if (m) opt[m[1]] = m[2];
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = await build({
  root, configFile: false, logLevel: 'silent',
  build: { write: false, minify: false, lib: { entry: 'src/audio/check.ts', formats: ['iife'], name: 'AudioCheck' } },
});
const code = (Array.isArray(bundle) ? bundle[0] : bundle).output[0].code;

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const page = await browser.newPage();
const consoleProblems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') consoleProblems.push(`${m.type()}: ${m.text().slice(0, 400)}`);
});
page.on('pageerror', (e) => consoleProblems.push(`exception: ${String(e.stack ?? e).slice(0, 800)}`));
await page.goto('about:blank');
await page.addScriptTag({ content: code });

const db = (v) => (v === null || !Number.isFinite(v) ? '  -inf' : v.toFixed(1).padStart(6));
let failures = 0;
const fail = (text) => {
  failures++;
  console.log(`      FAIL  ${text}`);
};

console.log('group   name                                     peak dBFS  rms dBFS  sounding  of      notes');
console.log('------  ---------------------------------------  ---------  --------  --------  ------  -----');
const plan = await page.evaluate(() => AudioCheck.plan());
for (const [index, name] of plan.entries()) {
  if (opt.only && !name.includes(opt.only)) continue;
  let row;
  try {
    row = await page.evaluate((i) => AudioCheck.run(i), index);
  } catch (e) {
    console.log(`${name}`);
    fail(`did not render: ${String(e.message ?? e).split('\n')[0]}`);
    continue;
  }
  console.log(`${row.group.padEnd(6)}  ${row.name.padEnd(39)}  ${db(row.peak)}     ${db(row.rms)}    ${row.active.toFixed(2).padStart(6)} s  ${String(row.seconds).padStart(4)} s  ${row.note}`);
  for (const problem of row.problems) fail(problem);
  if (opt.wav) {
    fs.mkdirSync(opt.wav, { recursive: true });
    const data = await page.evaluate(() => AudioCheck.wav());
    if (data) fs.writeFileSync(path.join(opt.wav, `${name.replace(/[^\w]+/g, '-')}.wav`), Buffer.from(data, 'base64'));
  }
}

if (Number(opt.live) && !opt.only) {
  const missing = await page.evaluate(() => AudioCheck.missing());
  console.log(`\nwithout Web Audio: ${missing.length ? '' : 'every call is a quiet no-op'}`);
  for (const problem of missing) fail(problem);

  const live = await page.evaluate(() => AudioCheck.live());
  console.log(`live AudioContext: ${live.state} at ${live.sampleRate} Hz, clock advanced ${live.ran} s; output ${db(live.playing).trim()} dB playing, ${db(live.paused).trim()} dB paused, ${db(live.resumed).trim()} dB resumed`);
  for (const problem of live.problems) fail(problem);
}

for (const problem of [...new Set(consoleProblems)]) fail(`console ${problem}`);
await browser.close();
console.log(failures ? `\n${failures} problem(s).` : '\nAll sound checks passed.');
process.exit(failures ? 1 : 0);
