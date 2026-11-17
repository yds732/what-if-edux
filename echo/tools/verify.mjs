#!/usr/bin/env node
// Runs everything that checks the game, in order, and reports each step. Uses the dev server on port 5173 if
// one is running; otherwise starts its own for the duration.
//
//   node tools/verify.mjs            every step
//   node tools/verify.mjs touch vr   only the steps whose name contains one of these words
import { spawnSync } from 'node:child_process';
import { createServer } from 'vite';

const BASE = 'http://127.0.0.1:5173/';
const STEPS = [
  ['types', 'npx tsc --noEmit'],
  ['unit tests', 'npx vitest run'],
  ['sound: every soundscape, effect and voice rendered and measured', 'node tools/audio-check.mjs'],
  ['story: the week on autopilot, three branch sets', 'node tools/e2e.mjs --speed=8'],
  ['story in an emulated headset', 'node tools/e2e.mjs --speed=8 --only=b --xr=1 --out=shots/e2e_xr'],
  ['keyboard and mouse', 'node tools/input-test.mjs'],
  ['touch', 'node tools/touch-test.mjs'],
  ['vr controllers', 'node tools/xr-test.mjs'],
  ['menus at desktop, tablet and phone sizes', 'node tools/ui-shots.mjs'],
];

const only = process.argv.slice(2).map((w) => w.toLowerCase());
const steps = STEPS.filter(([name]) => only.length === 0 || only.some((w) => name.includes(w)));
if (steps.length === 0) {
  console.error(`no step matches: ${only.join(', ')}\nsteps: ${STEPS.map(([n]) => n).join(' | ')}`);
  process.exit(2);
}

const running = await fetch(BASE).then((r) => r.ok, () => false);
// no hot reload in a server started for tests: a reload in the middle of a run would look like a failure
const server = running ? null : await (await createServer({ server: { hmr: false }, logLevel: 'error' })).listen();

let failed = 0;
for (const [name, command] of steps) {
  const t0 = Date.now();
  const run = spawnSync(command, { shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const ok = run.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  if (!ok) console.log(`${run.stdout ?? ''}${run.stderr ?? ''}`.trim().split('\n').slice(-40).map((l) => `      ${l}`).join('\n'));
}
await server?.close();
console.log(failed ? `\n${failed} of ${steps.length} steps failed.` : `\nAll ${steps.length} steps passed.`);
process.exit(failed ? 1 : 0);
