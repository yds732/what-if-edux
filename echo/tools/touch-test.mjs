#!/usr/bin/env node
// Plays two stretches of Tuesday on an emulated phone with real touch events (no autopilot once it hands over):
//   1. tap the phone, tap through the chat, tap a choice card on the LEFT half of the screen, walk with the
//      thumb stick, tap the middle of three cards;
//   2. walk to the star circle with the stick, tap the orb, hold and release on the right to throw.
// The view is turned by setting the player's heading (a look-drag is checked separately).
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const GPU_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--hide-scrollbars', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'];
const W = 844, H = 390;
fs.mkdirSync('shots/touch', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: GPU_ARGS });
const problems = [];
const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

const open = async (query) => {
  const context = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text().slice(0, 400)); });
  page.on('pageerror', (e) => problems.push(String(e.stack ?? e).slice(0, 800)));
  const cdp = await context.newCDPSession(page);
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id = 0]) => ({ x, y, id })) });
  const t = {
    page,
    send,
    tap: async (x, y, ms = 70) => { await send('touchStart', [[x, y]]); await page.waitForTimeout(ms); await send('touchEnd', []); await page.waitForTimeout(120); },
    beat: (name, timeout = 90000) => page.waitForFunction((n) => (window.__BEATS ?? []).includes(n), name, { timeout }),
    reached: (name) => page.evaluate((n) => (window.__BEATS ?? []).includes(n), name),
    shot: (name) => page.screenshot({ path: `shots/touch/${name}.jpg`, type: 'jpeg', quality: 85 }),
    /** Screen position (CSS px) of the thing the player is being asked to use. */
    target: () => page.evaluate(() => {
      const g = window.__game;
      const item = [...g.interaction.items].find((i) => i.enabled);
      if (!item) return null;
      const p = item.position.clone().project(g.app.camera);
      return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight };
    }),
    /** Screen positions of the choice cards on show. */
    cards: () => page.evaluate(() => {
      const hud = window.__game.hud;
      if (!hud.choosing) return [];
      return hud.options.filter((o) => o.widget.visible).map((o) => ({ x: innerWidth / 2 + o.widget.x * hud.uiScale, y: innerHeight / 2 - o.widget.y * hud.uiScale }));
    }),
    face: (x, y, z) => page.evaluate(([tx, ty, tz]) => {
      const pl = window.__game.player;
      const dx = tx - pl.position.x, dz = tz - pl.position.z;
      pl.yaw = Math.atan2(-dx, -dz);
      pl.pitch = Math.atan2(ty - pl.eyeHeight, Math.hypot(dx, dz));
    }, [x, y, z]),
    /** Pushes the left thumb stick forward for a while. */
    walk: async (ms) => {
      await send('touchStart', [[120, 260]]);
      await send('touchMove', [[120, 190]]);
      await page.waitForTimeout(ms);
      await send('touchEnd', []);
      await page.waitForTimeout(150);
    },
    /** Taps until a beat is reached (lines of dialogue wait for a tap). */
    tapUntil: async (name, x, y, tries = 40) => {
      for (let i = 0; i < tries; i++) {
        if (await t.reached(name)) return true;
        await t.tap(x, y);
        await page.waitForTimeout(450);
      }
      return t.reached(name);
    },
    close: () => context.close(),
  };
  await page.goto(base + query, { waitUntil: 'load' });
  return t;
};

// ---------------------------------------------------------------- 1. phone, chat, choices, walking
{
  const t = await open('?chapter=monday&auto=1&speed=6&handover=monday.message&q=low&dpr=1');
  await t.beat('monday.message');
  await t.page.waitForTimeout(2500);
  const phone = await t.target();
  check('the phone is on screen to be tapped', !!phone && phone.x > 0 && phone.x < W && phone.y > 0 && phone.y < H, JSON.stringify(phone));
  await t.shot('1_phone');
  if (phone) await t.tap(phone.x, phone.y);
  // taps on the LEFT half must count too: that is where a thumb rests
  check('taps on the left half advance the chat', await t.tapUntil('monday.decision', 150, 200));
  await t.page.waitForFunction(() => window.__game.hud.choosing, undefined, { timeout: 8000 }).catch(() => undefined);
  await t.page.waitForTimeout(900);
  const two = await t.cards();
  await t.shot('2_decision');
  check('two choice cards are showing', two.length === 2, JSON.stringify(two));
  if (two.length) {
    check('the first card sits on the left half of the screen', two[0].x < W * 0.42, `x=${Math.round(two[0].x)}`);
    await t.tap(two[0].x, two[0].y);
    await t.page.waitForTimeout(700);
  }
  check('tapping the left card chooses it', (await t.page.evaluate(() => window.__game.state.tuesdayChoice)) === 'meet');
  check('taps carry the story to the poster scene', await t.tapUntil('monday.poster', 700, 120));
  await t.page.waitForTimeout(2600);
  await t.tap(700, 120); // "Hey! Glad you came!"
  await t.page.waitForTimeout(700);
  await t.tap(700, 120);
  await t.page.waitForTimeout(900);
  const stand = await t.page.evaluate(() => {
    const g = window.__game;
    return { canMove: g.player.canMove, x: g.player.position.x, z: g.player.position.z };
  });
  check('the player is free to walk to the poster table', stand.canMove);
  // head for the poster stand with the thumb stick
  const goal = { x: -2.6, z: -1.2 }; // CLASSROOM.posterStand
  await t.face(goal.x, 1.0, goal.z);
  await t.shot('3_walk');
  await t.walk(1400);
  const moved = await t.page.evaluate(() => ({ x: window.__game.player.position.x, z: window.__game.player.position.z }));
  check('the thumb stick walks the player', Math.hypot(moved.x - stand.x, moved.z - stand.z) > 1, `moved ${Math.hypot(moved.x - stand.x, moved.z - stand.z).toFixed(2)} m`);
  for (let i = 0; i < 6 && !(await t.page.evaluate(() => !window.__game.player.canMove)); i++) {
    await t.face(goal.x, 1.0, goal.z);
    await t.walk(700);
  }
  let three = [];
  for (let i = 0; i < 30 && three.length !== 3; i++) {
    await t.tap(700, 120);
    await t.page.waitForTimeout(500);
    three = await t.cards();
  }
  await t.page.waitForTimeout(900);
  three = await t.cards();
  await t.shot('4_poster');
  check('three poster phrases are offered', three.length === 3, JSON.stringify(three));
  if (three.length === 3) await t.tap(three[1].x, three[1].y);
  await t.beat('monday.posterDone', 8000).then(() => check('tapping the middle card writes the poster', true), () => check('tapping the middle card writes the poster', false));
  await t.close();
}

const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
if (problems.length) console.log('CONSOLE ERRORS:\n ' + problems.join('\n '));
await browser.close();
process.exit(failed.length || problems.length ? 1 : 0);
