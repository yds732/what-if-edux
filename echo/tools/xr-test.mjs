#!/usr/bin/env node
// Plays stretches of Tuesday inside an emulated Quest 3 with its controllers, no autopilot once it hands over:
//   1. left stick walks; the right controller points at the orb and its trigger takes it; holding the trigger
//      draws a throw back and letting go throws it;
//   2. B takes the headset off; A moves dialogue on;
//   3. pointing at a choice card and pulling the trigger chooses it;
//   4. ending the session (taking the headset off) pauses, and the game carries on on the flat screen.
// The emulator (IWER) stands in for the headset: this checks the button and axis mapping and the pointing
// ray, not comfort or performance on real hardware.
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const GPU_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'];
fs.mkdirSync('shots/xr', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: GPU_ARGS });
const problems = [];
const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

const open = async (beat) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text().slice(0, 400)); });
  page.on('pageerror', (e) => problems.push(String(e.stack ?? e).slice(0, 800)));
  await page.goto(`${base}?chapter=tuesday&auto=1&speed=6&handover=${beat}&xr=emulate&q=low&dpr=1`, { waitUntil: 'load' });
  await page.waitForFunction((n) => (window.__BEATS ?? []).includes(n), beat, { timeout: 120000 });
  const t = {
    page,
    shot: (name) => page.screenshot({ path: `shots/xr/${name}.jpg`, type: 'jpeg', quality: 85 }),
    button: (hand, id, value) => page.evaluate(([h, i, v]) => window.__xrDevice.controllers[h].updateButtonValue(i, v), [hand, id, value]),
    stick: (hand, x, y) => page.evaluate(([h, sx, sy]) => window.__xrDevice.controllers[h].updateAxes('thumbstick', sx, sy), [hand, x, y]),
    press: async (hand, id, ms = 120) => { await t.button(hand, id, 1); await page.waitForTimeout(ms); await t.button(hand, id, 0); await page.waitForTimeout(150); },
    /**
     * Points the right controller's ray at a world point. The ray is not the controller's own forward axis (a
     * Touch controller's pointer is tilted from its grip), so this turns the controller by the error it reads
     * back from the game until the ray lies on the target.
     */
    point: async (target) => {
      let off = 99;
      for (let i = 0; i < 6 && off > 0.4; i++) {
        off = await page.evaluate(([tx, ty, tz]) => {
          const g = window.__game, ray = g.input.xrRay, c = window.__xrDevice.controllers.right;
          if (!ray) return 99;
          const want = ray.origin.clone().set(tx, ty, tz).sub(ray.origin).normalize();
          const have = ray.direction.clone().normalize();
          // the rotation that carries the ray onto the target, brought into the space the controller is posed in
          const rigQ = g.app.rig.getWorldQuaternion(g.app.camera.quaternion.clone());
          const fix = rigQ.clone().setFromUnitVectors(have, want);
          const local = rigQ.clone().invert().multiply(fix).multiply(rigQ);
          const q = rigQ.clone().set(c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w).premultiply(local).normalize();
          c.quaternion.set(q.x, q.y, q.z, q.w);
          return (Math.acos(Math.min(1, have.dot(want))) * 180) / Math.PI;
        }, target);
        await page.waitForTimeout(120);
      }
      return off;
    },
    close: () => context.close(),
  };
  await page.waitForTimeout(1200);
  return t;
};

// ------------------------------------------------------------------------------------------- 1. the orb
{
  const t = await open('tuesday.challenge');
  const { page } = t;
  const mode = await page.evaluate(() => ({ presenting: window.__game.app.renderer.xr.isPresenting, mode: window.__game.input.mode }));
  check('a headset session is running and the controllers are the input', mode.presenting && mode.mode === 'xr', JSON.stringify(mode));
  await page.evaluate(() => {
    const d = window.__xrDevice;
    d.controllers.right.position.set(0.22, 1.15, -0.3);
    d.controllers.left.position.set(-0.22, 1.05, -0.25);
    window.__thrown = 0;
    window.__game.star.onThrow.on(() => window.__thrown++);
  });

  const z0 = await page.evaluate(() => window.__game.player.position.z);
  await t.stick('left', 0, -1);
  await page.waitForTimeout(2900);
  await t.stick('left', 0, 0);
  await page.waitForTimeout(300);
  const z1 = await page.evaluate(() => window.__game.player.position.z);
  check('pushing the left stick forward walks', z0 - z1 > 4, `z ${z0.toFixed(2)} -> ${z1.toFixed(2)}`);

  const yaw0 = await page.evaluate(() => window.__game.player.yaw);
  await t.stick('right', 1, 0);
  await page.waitForTimeout(200);
  await t.stick('right', 0, 0);
  await page.waitForTimeout(200);
  const yaw1 = await page.evaluate(() => window.__game.player.yaw);
  check('flicking the right stick turns one step', Math.abs(Math.abs(yaw1 - yaw0) - Math.PI / 6) < 0.05, `yaw ${yaw0.toFixed(2)} -> ${yaw1.toFixed(2)}`);
  await t.stick('right', -1, 0);
  await page.waitForTimeout(200);
  await t.stick('right', 0, 0);
  await page.waitForTimeout(200);

  const orb = await page.evaluate(() => { const p = window.__game.star.pedestalItem.position; return [p.x, p.y, p.z]; });
  const off = await t.point(orb);
  await page.waitForTimeout(200);
  await t.shot('1_point');
  check('the controller can be pointed at the orb', off < 1 && (await page.evaluate(() => window.__game.interaction.focus !== null)), `${off.toFixed(2)} degrees off`);
  await t.press('right', 'trigger');
  await page.waitForTimeout(1200);
  check('the trigger takes the orb', await page.evaluate(() => window.__game.star.holding));

  let lit = 0, peak = 0;
  const LIFTS = [2.6, 2.0, 3.2, 1.5, 3.8, 2.3, 2.9, 1.0];
  for (let i = 0; i < LIFTS.length && lit < 1; i++) {
    await page.waitForFunction(() => window.__game.star.holding, undefined, { timeout: 8000 }).catch(() => undefined);
    const c = await page.evaluate(() => {
      const ring = window.__game.worlds.haven.bridge.rings.find((r) => r.state !== 'lit');
      return [ring.center.x, ring.center.y, ring.center.z];
    });
    await t.point([c[0], c[1] + LIFTS[i], c[2]]);
    await t.button('right', 'trigger', 1);
    await page.waitForTimeout(900);
    peak = Math.max(peak, await page.evaluate(() => window.__game.star.chargeLevel));
    if (i === 0) await t.shot('2_draw');
    await t.button('right', 'trigger', 0);
    await page.waitForTimeout(2600);
    lit = await page.evaluate(() => window.__game.worlds.haven.bridge.rings.filter((r) => r.state === 'lit').length);
  }
  check('holding the trigger draws the throw back', peak > 0.6, `charge ${peak.toFixed(2)}`);
  check('letting go throws along the controller', (await page.evaluate(() => window.__thrown)) >= 1);
  check('a thrown orb goes through a ring', lit >= 1, `rings lit: ${lit}`);
  await t.shot('3_hit');
  await t.close();
}

// ------------------------------------------------------------------------------------------- 2. headset off
{
  const t = await open('tuesday.notify');
  await t.page.waitForTimeout(600);
  await t.shot('4_notify');
  await t.press('right', 'b-button');
  await t.page.waitForFunction(() => (window.__BEATS ?? []).includes('tuesday.bedroom'), undefined, { timeout: 20000 })
    .then(() => check('B takes the Echo headset off', true), () => check('B takes the Echo headset off', false));
  await t.close();
}

// ------------------------------------------------------------------------------------------- 2b. next line
{
  const t = await open('tuesday.haven');
  const { page } = t;
  await page.evaluate(() => (window.__game.director.autoAdvance = false));
  await page.waitForTimeout(3500);
  const waited = !(await page.evaluate(() => window.__BEATS.includes('tuesday.challenge')));
  for (let i = 0; i < 6 && !(await page.evaluate(() => window.__BEATS.includes('tuesday.challenge'))); i++) {
    await t.press('right', 'a-button');
    await page.waitForTimeout(500);
  }
  check('A moves dialogue on when lines are set to wait', waited && (await page.evaluate(() => window.__BEATS.includes('tuesday.challenge'))));
  await t.close();
}

// ------------------------------------------------------------------------------------------- 3. a choice
{
  const t = await open('tuesday.decision');
  const { page } = t;
  await page.evaluate(() => window.__xrDevice.controllers.right.position.set(0.22, 1.15, -0.3));
  await page.waitForFunction(() => window.__game.hud.choosing, undefined, { timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const card = await page.evaluate(() => {
    const p = window.__game.hud.options[1].widget.panel.mesh.getWorldPosition(window.__game.playerEye.clone());
    return [p.x, p.y, p.z];
  });
  const off = await t.point(card);
  await page.waitForTimeout(300);
  await t.shot('5_choice');
  check('the controller can be pointed at a choice card', off < 1, `${off.toFixed(2)} degrees off`);
  await t.press('right', 'trigger');
  await page.waitForTimeout(600);
  check('the trigger chooses the card it points at', (await page.evaluate(() => window.__game.state.tuesdayChoice)) === 'haven');
  await t.close();
}

// ------------------------------------------------------------------------------------------- 4. leaving the headset
{
  const t = await open('tuesday.challenge');
  const { page } = t;
  await page.evaluate(() => window.__game.app.renderer.xr.getSession().end());
  await page.waitForSelector('.menu--veil.show', { timeout: 8000 })
    .then(() => check('taking the headset off pauses the game on the screen', true), () => check('taking the headset off pauses the game on the screen', false));
  const flat = await page.evaluate(() => {
    const g = window.__game, c = g.app.canvas;
    return { presenting: g.app.renderer.xr.isPresenting, mode: g.input.mode, css: [c.clientWidth, c.clientHeight], buffer: [c.width, c.height] };
  });
  check('the picture and the controls return to the flat screen', !flat.presenting && flat.mode !== 'xr' && flat.css.join() === '1280,720' && flat.buffer.join() === '1280,720', JSON.stringify(flat));
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.waitForTimeout(900);
  const t0 = await page.evaluate(() => window.__game.app.time);
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({ time: window.__game.app.time, paused: window.__game.app.paused }));
  await t.shot('6_flat_again');
  check('the story carries on there', after.time > t0 && !after.paused);
  await t.close();
}

const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
if (problems.length) console.log('CONSOLE ERRORS:\n ' + [...new Set(problems)].slice(0, 8).join('\n '));
await browser.close();
process.exit(failed.length || problems.length ? 1 : 0);
