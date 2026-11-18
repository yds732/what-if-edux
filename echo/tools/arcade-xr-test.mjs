#!/usr/bin/env node
// Steps into each of the arcade's games inside an emulated Quest 3 and does the one thing each asks of a controller:
//   rally       the bat is in the hand (it goes where the controller is carried), and the trigger serves
//   sprites     a card is chosen by pointing at it and pulling the trigger
//   lanterns    a jewel is dragged onto its neighbour with the trigger held
//   drift       the trigger throws the hook at what the controller points at
//   duskbreak   the flock goes where the controller points
// Every game reads one ray and one button (src/arcade/Pointer.ts), so this is a check that a headset's controller
// is that ray and its trigger that button, in each game's own world. The emulator (IWER) stands in for the
// headset, as in tools/xr-test.mjs, whose way of pointing a controller this borrows: comfort and performance on
// real hardware are not what it measures.
//
//   node tools/arcade-xr-test.mjs [game...] [--base=http://127.0.0.1:5173/]
import { chromium } from 'playwright';
import fs from 'node:fs';

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith('--base='))?.slice(7) ?? 'http://127.0.0.1:5173/';
const wanted = args.filter((a) => !a.startsWith('--'));
const GPU_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'];
fs.mkdirSync('shots/xr', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: GPU_ARGS });
const problems = [];
const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });

const open = async (id) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${id}: ${m.text().slice(0, 400)}`); });
  page.on('pageerror', (e) => problems.push(`${id}: ${String(e.stack ?? e).slice(0, 800)}`));
  await page.goto(`${base}?play=${id}&xr=emulate&q=low&dpr=1`, { waitUntil: 'load' });
  const t = {
    page,
    beat: (name, timeout = 120000) => page.waitForFunction((n) => (window.__BEATS ?? []).includes(n), name, { timeout }).then(() => true, () => false),
    reached: (name) => page.evaluate((n) => (window.__BEATS ?? []).includes(n), name),
    shot: (name) => page.screenshot({ path: `shots/xr/arcade-${name}.jpg`, type: 'jpeg', quality: 85 }),
    game: (expression) => page.evaluate(`(() => { const game = window.__game, world = game.arcade.active; return ${expression}; })()`),
    button: (hand, button, value) => page.evaluate(([h, i, v]) => window.__xrDevice.controllers[h].updateButtonValue(i, v), [hand, button, value]),
    press: async (hand, button, ms = 120) => { await t.button(hand, button, 1); await page.waitForTimeout(ms); await t.button(hand, button, 0); await page.waitForTimeout(150); },
    /** A moves dialogue on: pressed until a beat is reached. */
    talkUntil: async (name, tries = 50) => {
      for (let i = 0; i < tries && !(await t.reached(name)); i++) await t.press('right', 'a-button');
      return t.reached(name);
    },
    /** Points the right controller's ray at a world point (see tools/xr-test.mjs): turned by the error read back from the game until it lies on it. */
    point: async (target) => {
      let off = 99;
      for (let i = 0; i < 7 && off > 0.3; i++) {
        off = await page.evaluate(([tx, ty, tz]) => {
          const g = window.__game, ray = g.input.xrRay, c = window.__xrDevice.controllers.right;
          if (!ray) return 99;
          const want = ray.origin.clone().set(tx, ty, tz).sub(ray.origin).normalize();
          const have = ray.direction.clone().normalize();
          const rigQ = g.app.rig.getWorldQuaternion(g.app.camera.quaternion.clone());
          const fix = rigQ.clone().setFromUnitVectors(have, want);
          const local = rigQ.clone().invert().multiply(fix).multiply(rigQ);
          const q = rigQ.clone().set(c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w).premultiply(local).normalize();
          c.quaternion.set(q.x, q.y, q.z, q.w);
          return (Math.acos(Math.min(1, have.dot(want))) * 180) / Math.PI;
        }, target);
        await page.waitForTimeout(110);
      }
      return off;
    },
    close: () => context.close(),
  };
  return t;
};

/** What each game is asked to do with the controller once its introduction is over. */
const GAMES = {
  rally: {
    intro: 'rally.intro', ready: 'rally.ready',
    act: async (t) => {
      // in a headset the bat is in the hand: it goes where the controller is carried, to one side and then the other
      const carry = (x) => t.page.evaluate((cx) => window.__xrDevice.controllers.right.position.set(cx, 1.15, -0.3), x);
      await carry(0.35);
      await t.page.waitForTimeout(400);
      const right = await t.game('world.batAt.x');
      await carry(-0.35);
      await t.page.waitForTimeout(400);
      const left = await t.game('world.batAt.x');
      await carry(0.22);
      check('rally: the bat is in the hand, and goes where the controller is carried', right - left > 0.5, `x ${left.toFixed(2)} .. ${right.toFixed(2)}`);
      await t.press('right', 'trigger');
      await t.page.waitForTimeout(2600);
      const hits = await t.game('world.hits.you + world.hits.kai');
      check('rally: the trigger serves', hits >= 1 || (await t.reached('rally.point')), `hits ${hits}`);
    },
  },
  sprites: {
    intro: 'duel.intro', ready: 'duel.pick.ember',
    act: async (t) => {
      await t.page.waitForFunction(() => window.__game.hud.choosing && window.__game.hud.options.some((o) => o.widget.visible), undefined, { timeout: 20000 }).catch(() => undefined);
      await t.page.waitForTimeout(600);
      const card = await t.page.evaluate(() => {
        const p = window.__game.hud.options[0].widget.panel.mesh.getWorldPosition(window.__game.playerEye.clone());
        return [p.x, p.y, p.z];
      });
      const off = await t.point(card);
      await t.page.waitForTimeout(250);
      await t.press('right', 'trigger');
      check('sprites: a card is chosen by pointing at it and pulling the trigger', off < 1.5 && (await t.beat('duel.pick.tide', 15000)), `${off.toFixed(2)} degrees off`);
    },
  },
  lanterns: {
    intro: 'lights.intro', ready: 'lights.ready',
    act: async (t) => {
      await t.page.waitForTimeout(600);
      const move = await t.game('world.game.board.findMove()');
      const cell = (c) => [(c.x - 3) * 0.3, 1.95 + (c.y - 3) * 0.3, 0.09];
      await t.point(cell(move[0]));
      await t.page.waitForTimeout(200);
      const hover = await t.game('world.hover');
      check('lanterns: the controller points at a jewel', hover && hover.x === move[0].x && hover.y === move[0].y, JSON.stringify({ move, hover }));
      // the trigger held, and the jewel pulled onto its neighbour
      await t.button('right', 'trigger', 1);
      await t.page.waitForTimeout(200);
      await t.point(cell(move[1]));
      await t.page.waitForTimeout(250);
      await t.button('right', 'trigger', 0);
      await t.page.waitForTimeout(1200);
      check('lanterns: a jewel is dragged onto its neighbour with the trigger held', (await t.game('world.stats.swaps')) === 1, JSON.stringify(await t.game('world.stats')));
    },
  },
  drift: {
    intro: 'drift.intro', ready: 'drift.ready',
    act: async (t) => {
      await t.page.waitForTimeout(800);
      let item = null;
      for (let i = 0; i < 60 && !item; i++) {
        item = await t.game(`(() => { const v = world.voyage, near = v.items.filter((i) => !i.hooked && i.kind === 'wood' && Math.hypot(i.x, i.z) < v.reach - 1 && i.z < -1.5).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0]; return near ? [near.x, 0, near.z] : null; })()`);
        if (!item) await t.page.waitForTimeout(250);
      }
      const wood = await t.game('world.voyage.wood');
      const off = item ? await t.point(item) : 99;
      await t.press('right', 'trigger');
      await t.page.waitForTimeout(1300);
      const after = await t.game('({ casts: world.stats.casts, wood: world.voyage.wood })');
      check('drift: the trigger throws the hook at what the controller points at', off < 3 && after.casts === 1 && after.wood === wood + 1, JSON.stringify({ off, wood, after }));
    },
  },
  duskbreak: {
    intro: 'dusk.intro', ready: 'dusk.ready',
    act: async (t) => {
      await t.page.waitForTimeout(600);
      await t.point([2.2, 0.4, -2]);
      await t.page.waitForTimeout(800);
      const right = await t.game('world.march.x');
      await t.point([-2.2, 0.4, -2]);
      await t.page.waitForTimeout(900);
      const left = await t.game('world.march.x');
      check('duskbreak: the flock goes where the controller points', right > 1.3 && left < -1.3, `x ${left.toFixed(2)} .. ${right.toFixed(2)}`);
    },
  },
};

for (const id of wanted.length ? wanted : Object.keys(GAMES)) {
  const game = GAMES[id];
  if (!game) {
    console.error(`no game called "${id}": ${Object.keys(GAMES).join(', ')}`);
    process.exit(2);
  }
  const t = await open(id);
  try {
    check(`${id}: opens in the headset`, await t.beat(game.intro));
    const mode = await t.page.evaluate(() => ({ presenting: window.__game.app.renderer.xr.isPresenting, mode: window.__game.input.mode }));
    check(`${id}: a headset session is running and the controllers are the input`, mode.presenting && mode.mode === 'xr', JSON.stringify(mode));
    await t.page.evaluate(() => {
      const d = window.__xrDevice;
      d.controllers.right.position.set(0.22, 1.15, -0.3);
      d.controllers.left.position.set(-0.22, 1.05, -0.25);
    });
    check(`${id}: A reads through the introduction`, await t.talkUntil(game.ready));
    await game.act(t);
    await t.shot(id);
  } catch (e) {
    check(`${id}: runs without failing`, false, String(e).slice(0, 300));
  }
  await t.close();
}

const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
if (problems.length) console.log('CONSOLE ERRORS:\n ' + [...new Set(problems)].slice(0, 8).join('\n '));
await browser.close();
process.exit(failed.length || problems.length ? 1 : 0);
