#!/usr/bin/env node
// Plays stretches of the week inside an emulated Quest 3 with its controllers, no autopilot once it hands over:
//   2. B takes the headset off once Lumi's plea to stay is answered with the trigger; A moves dialogue on;
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
  await page.goto(`${base}?chapter=${beat.split('.')[0]}&auto=1&speed=6&handover=${beat}&xr=emulate&q=low&dpr=1`, { waitUntil: 'load' });
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

// ------------------------------------------------------------------------------------------- 2. headset off
{
  const t = await open('thursday.oneMore');
  const { page } = t;
  await page.evaluate(() => window.__xrDevice.controllers.right.position.set(0.22, 1.15, -0.3));
  // the day's last lines play out first: B counts once the story asks for the headset to come off
  const asked = await page.waitForFunction(() => { const h = window.__game.hud; return h.prompt.widget.visible && h.promptAction === 'headset'; }, undefined, { timeout: 30000 }).then(() => true, () => false);
  await t.shot('4_notify');
  await t.press('right', 'b-button');
  // The leave confirmation has one card, Yes.
  await page.waitForFunction(() => window.__game.hud.choosing, undefined, { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const leave = await page.evaluate(() => {
    const p = window.__game.hud.options[0].widget.panel.mesh.getWorldPosition(window.__game.playerEye.clone());
    return [p.x, p.y, p.z];
  });
  await t.point(leave);
  await t.press('right', 'trigger');
  await page.waitForFunction(() => (window.__BEATS ?? []).includes('thursday.bedroom'), undefined, { timeout: 60000 })
    .then(() => check('B takes the Echo headset off', asked, asked ? '' : 'the story never asked for the headset'), () => check('B takes the Echo headset off', false));
  const phone = await page.evaluate(() => [...window.__game.interaction.items].find((item) => item.enabled).position.toArray());
  await t.point(phone);
  await t.press('right', 'trigger');
  await page.waitForFunction(() => window.__game.worlds.bedroom.holoTarget === 1);
  const firstMessage = await page.evaluate(() => window.__game.worlds.bedroom.hologram.texture.version);
  await t.press('right', 'a-button');
  await page.waitForFunction((first) => window.__game.worlds.bedroom.hologram.texture.version === first + 1, firstMessage, { timeout: 1200 });
  check('one press of A advances one phone message immediately', true);
  await t.close();
}

// ------------------------------------------------------------------------------------------- 2b. next line
{
  const t = await open('friday.class');
  const { page } = t;
  await page.evaluate(() => (window.__game.director.autoAdvance = false));
  await page.waitForTimeout(3500);
  const waited = !(await page.evaluate(() => window.__BEATS.includes('friday.voices')));
  for (let i = 0; i < 8 && !(await page.evaluate(() => window.__BEATS.includes('friday.voices'))); i++) {
    await t.press('right', 'a-button');
    await page.waitForTimeout(500);
  }
  check('A moves dialogue on when lines are set to wait', waited && (await page.evaluate(() => window.__BEATS.includes('friday.voices'))));
  await t.close();
}

// ------------------------------------------------------------------------------------------- 3. a choice
{
  const t = await open('monday.decision');
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
  const t = await open('thursday.festival');
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
