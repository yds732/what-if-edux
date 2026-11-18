#!/usr/bin/env node
// Drives the game the way a person does, through real key and mouse events. The scripted player is only used
// to reach the start of each stretch (`handover`); from there everything goes through the DOM:
//   1. Friday: a line waits to be read, Space moves it on, P pauses and stops time, Resume goes on.
//   2. Monday: stand up, walk round the desks to the front, pick up the headset.
//   3. Monday: walk in from the door to the poster table, choose a phrase with the number keys.
//   4. Wednesday: walk from the door to the chair beside Jamie and sit down.
//   5. Monday at home: cross the bedroom and put the headset on.
//   6. Thursday: take the headset off with Q, open the phone, click a choice card with the mouse.
//   7. Friday: pause mid-scene, restart the day, toggle pause with P, go back to the title and begin again.
//   8. The mouse: a click captures it, moving it looks around, losing it pauses, a decision frees and retakes it.
//   9. Thursday in Haven: walk with W and strafe with D, then off the meadow, onto the bridge and along it.
// Sections 2 to 7 and 9 turn the view by setting the player's heading, so that they do not depend on where a
// mouse happens to be; section 8 is the mouse itself.
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const GPU_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--hide-scrollbars', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'];
fs.mkdirSync('shots/input', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: GPU_ARGS });
const problems = [];
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok, detail }); };

const open = async (query) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text().slice(0, 400)); });
  page.on('pageerror', (e) => problems.push(String(e.stack ?? e).slice(0, 800)));
  await page.goto(base + query, { waitUntil: 'load' });
  const t = {
    page,
    beat: (name, timeout = 90000) => page.waitForFunction((n) => (window.__BEATS ?? []).includes(n), name, { timeout }),
    shot: (name) => page.screenshot({ path: `shots/input/${name}.jpg`, type: 'jpeg', quality: 85 }),
    at: () => page.evaluate(() => ({ x: window.__game.player.position.x, z: window.__game.player.position.z })),
    face: (x, y, z) => page.evaluate(([tx, ty, tz]) => {
      const pl = window.__game.player;
      const dx = tx - pl.position.x, dz = tz - pl.position.z;
      pl.yaw = Math.atan2(-dx, -dz);
      pl.pitch = Math.atan2(ty - pl.eyeHeight, Math.hypot(dx, dz));
    }, [x, y, z]),
    /** Holds W and keeps turning toward a point on the floor until the player is within `radius` of it. */
    walk: async (x, z, radius = 0.45, timeout = 15000) => {
      const t0 = Date.now();
      await page.keyboard.down('KeyW');
      try {
        while (Date.now() - t0 < timeout) {
          const d = await page.evaluate(([tx, tz]) => {
            const pl = window.__game.player;
            const dx = tx - pl.position.x, dz = tz - pl.position.z;
            pl.yaw = Math.atan2(-dx, -dz);
            pl.pitch = -0.12;
            return Math.hypot(dx, dz);
          }, [x, z]);
          if (d < radius) return true;
          await page.waitForTimeout(50);
        }
        return false;
      } finally {
        await page.keyboard.up('KeyW');
      }
    },
    /** The thing the story is asking the player to use, if any. */
    target: () => page.evaluate(() => {
      const item = [...window.__game.interaction.items].find((i) => i.enabled);
      return item ? [item.position.x, item.position.y, item.position.z] : null;
    }),
    focused: () => page.evaluate(() => window.__game.interaction.focus !== null),
    close: () => context.close(),
  };
  return t;
};

// ------------------------------------------------------------------------------------------- 1. Friday, a line and the pause menu
{
  const t = await open('?chapter=friday&dpr=1&q=high');
  const { page } = t;
  await t.beat('friday.class');
  // the mouse cannot be captured here: let clicks count as they do while a cursor is free
  await page.evaluate(() => { window.__game.input.wantsLock = false; window.__game.director.autoAdvance = false; });
  await page.waitForTimeout(2500);

  // Space finishes the typing, then moves on: with auto-advance off the story waits for it
  const before = await page.evaluate(() => window.__BEATS.length);
  await page.waitForTimeout(3000);
  check('a line waits for the player when auto-advance is off', (await page.evaluate(() => window.__BEATS.length)) === before);
  // the teacher's opening lines, each typed out by one press and moved on from by the next
  for (let i = 0; i < 12 && !(await page.evaluate(() => window.__BEATS.includes('friday.voices'))); i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
  }
  await t.beat('friday.voices', 15000).then(() => check('Space advances dialogue', true), () => check('Space advances dialogue', false));
  await t.shot('1_voices');

  await page.keyboard.press('KeyP');
  await page.waitForSelector('.menu--veil.show', { timeout: 5000 }).then(() => check('P opens the pause menu', true), () => check('P opens the pause menu', false));
  const t0 = await page.evaluate(() => window.__game.app.time);
  await page.waitForTimeout(600);
  check('time stands still while paused', (await page.evaluate(() => window.__game.app.time)) === t0);
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.waitForTimeout(600);
  check('Resume continues', (await page.evaluate(() => window.__game.app.time)) > t0);
  await t.close();
}

// ------------------------------------------------------------------------------------------- 2. Monday
{
  const t = await open('?chapter=monday&auto=1&speed=6&handover=monday.walk&dpr=1&q=high');
  const { page } = t;
  await t.beat('monday.walk');
  await page.waitForTimeout(700);
  const from = await t.at();
  // out from behind the desk to the aisle down the middle of the room, and up it to the mark at the front
  const route = [[0.2, 3.3], [0.1, -2.2], [0.1, -2.8]];
  let arrived = true;
  for (const [x, z] of route) arrived = arrived && (await t.walk(x, z));
  await t.shot('4_front');
  const there = await t.at();
  check('Monday: the player can walk from their desk to the front', arrived, `(${from.x.toFixed(1)}, ${from.z.toFixed(1)}) -> (${there.x.toFixed(1)}, ${there.z.toFixed(1)})`);
  await page.waitForTimeout(400);
  const headset = await t.target();
  check('Monday: arriving at the front offers the headset', !!headset);
  if (headset) await t.face(...headset);
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyE');
  await t.beat('monday.headset', 8000).then(() => check('Monday: E picks up the headset', true), () => check('Monday: E picks up the headset', false));
  await t.close();
}

// ------------------------------------------------------------------------------------------- 3. Monday, the poster
{
  const t = await open('?chapter=monday&auto=1&speed=6&handover=monday.poster&tue=meet&dpr=1&q=high');
  const { page } = t;
  await t.beat('monday.poster');
  await page.waitForFunction(() => window.__game.player.canMove, undefined, { timeout: 30000 });
  await page.waitForTimeout(600);
  await t.shot('5_door');
  const from = await t.at();
  const arrived = await t.walk(-2.6, -1.2, 0.95); // the story takes over within 0.9 m of the mark
  const there = await t.at();
  check('Tuesday: the player can walk from the door to the poster table', arrived, `(${from.x.toFixed(1)}, ${from.z.toFixed(1)}) -> (${there.x.toFixed(1)}, ${there.z.toFixed(1)})`);
  await page.waitForFunction(() => window.__game.hud.choosing, undefined, { timeout: 40000 }).then(() => check('Tuesday: arriving starts the poster conversation', true), () => check('Tuesday: arriving starts the poster conversation', false));
  await page.waitForTimeout(900);
  await t.shot('6_phrases');
  await page.keyboard.press('Digit2');
  await t.beat('monday.posterDone', 8000).then(() => check('Monday: the 2 key picks the second phrase', true), () => check('Monday: the 2 key picks the second phrase', false));
  await t.close();
}

// ------------------------------------------------------------------------------------------- 4. Wednesday, the seat
{
  const t = await open('?chapter=wednesday&auto=1&speed=6&handover=wednesday.find&dpr=1&q=high');
  const { page } = t;
  await t.beat('wednesday.find');
  await page.waitForTimeout(600);
  const from = await t.at();
  // down the aisle by the wall until level with Jamie's desk
  const arrived = await t.walk(4.3, 1.5);
  const there = await t.at();
  check('Wednesday: the player can walk from the door to Jamie\'s desk', arrived, `(${from.x.toFixed(1)}, ${from.z.toFixed(1)}) -> (${there.x.toFixed(1)}, ${there.z.toFixed(1)})`);
  const seat = await t.target();
  if (seat) await t.face(...seat);
  await page.waitForTimeout(400);
  await t.shot('7_seat');
  check('Wednesday: the empty chair can be picked out from the aisle', await t.focused());
  await page.keyboard.press('KeyE');
  await t.beat('wednesday.partner', 8000).then(() => check('Wednesday: E sits beside Jamie', true), () => check('Wednesday: E sits beside Jamie', false));
  await t.close();
}

// ------------------------------------------------------------------------------------------- 5. Monday, home
{
  const t = await open('?chapter=monday&auto=1&speed=6&handover=monday.bedroom&dpr=1&q=high');
  const { page } = t;
  await t.beat('monday.bedroom');
  await page.waitForFunction(() => window.__game.player.canMove && [...window.__game.interaction.items].some((i) => i.enabled), undefined, { timeout: 30000 });
  await page.waitForTimeout(500);
  const dock = await t.target();
  // a couple of steps toward the desk, then look at the headset on its dock
  await t.walk(dock[0], dock[2] + 1.6, 0.4, 8000);
  await t.face(...dock);
  await page.waitForTimeout(400);
  await t.shot('8_dock');
  check('Monday: the headset on the desk can be picked out', await t.focused());
  await page.keyboard.press('KeyE');
  await t.beat('monday.haven', 20000).then(() => check('Monday: E puts the headset on and Haven opens', true), () => check('Monday: E puts the headset on and Haven opens', false));
  await t.close();
}

// ------------------------------------------------------------------------------------------- 6. Thursday, the message
{
  const t = await open('?chapter=thursday&auto=1&speed=6&handover=thursday.oneMore&dpr=1&q=high');
  const { page } = t;
  await t.beat('thursday.oneMore');
  // the day's last lines play out first: Q counts once the story asks for the headset to come off
  await page.waitForFunction(() => { const h = window.__game.hud; return h.prompt.widget.visible && h.promptAction === 'headset'; }, undefined, { timeout: 30000 })
    .then(() => check('Thursday: a prompt asks for the headset to come off, naming the key', true), () => check('Thursday: a prompt asks for the headset to come off, naming the key', false));
  await page.keyboard.press('KeyQ');
  // Lumi asks for one more minute: 2 picks Leave
  await page.waitForFunction(() => window.__game.hud.choosing, undefined, { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(600);
  await page.keyboard.press('Digit2');
  await t.beat('thursday.bedroom', 60000).then(() => check('Thursday: Q takes the headset off', true), () => check('Thursday: Q takes the headset off', false));
  await page.waitForFunction(() => [...window.__game.interaction.items].some((i) => i.enabled), undefined, { timeout: 20000 });
  await page.waitForTimeout(1600);
  const phone = await t.target();
  await t.face(...phone);
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyE');
  // Jamie's messages arrive one by one in the opened phone; a thought is then held on screen before the choice
  await t.beat('thursday.message', 60000).then(() => check('Thursday: E on the phone opens the message', true), () => check('Thursday: E on the phone opens the message', false));
  await page.waitForFunction(() => window.__game.hud.choosing, undefined, { timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(900);
  // the mouse is free while a choice is up: point at the second card and click it
  const card = await page.evaluate(() => {
    const hud = window.__game.hud, w = hud.options[1].widget;
    return { x: innerWidth / 2 + w.x * hud.uiScale, y: innerHeight / 2 - w.y * hud.uiScale };
  });
  await page.mouse.move(card.x, card.y, { steps: 6 });
  await page.waitForTimeout(250);
  await t.shot('9_hover');
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(600);
  check('Thursday: clicking the second card chooses to stay in Haven', (await page.evaluate(() => window.__game.state.thursdayChoice)) === 'haven');
  await t.close();
}

// ------------------------------------------------------------------------------------------- 7. restart, and the title
{
  const t = await open('?chapter=friday&auto=1&speed=6&handover=friday.future&dpr=1&q=high');
  const { page } = t;
  const stage = () => page.evaluate(() => {
    const g = window.__game;
    return { zoom: g.app.zoom, dim: g.app.fx.dim, paused: g.app.paused, playing: g.playing, time: g.app.time };
  });
  const count = (name) => page.evaluate((n) => window.__BEATS.filter((b) => b === n).length, name);
  await t.beat('friday.future');
  await page.waitForTimeout(2500);
  check('Friday: the view leans in to the Future Viewer', (await stage()).zoom > 10, `zoom ${(await stage()).zoom.toFixed(1)}`);

  await page.keyboard.press('KeyP');
  await page.waitForSelector('.menu--veil.show', { timeout: 5000 });
  await page.getByRole('button', { name: 'Restart this day' }).click();
  await page.waitForFunction(() => window.__BEATS.filter((b) => b === 'friday.class').length >= 2, undefined, { timeout: 30000 })
    .then(() => check('Restart this day begins the day again', true), () => check('Restart this day begins the day again', false));
  const fresh = await stage();
  check('a restarted day starts from a clean stage', fresh.zoom === 0 && fresh.dim === 0 && !fresh.paused, JSON.stringify(fresh));
  await page.waitForTimeout(2500);
  await t.shot('10_restarted');

  // the key that pauses also resumes, and one press of it does not pause again
  await page.keyboard.press('KeyP');
  await page.waitForSelector('.menu--veil.show', { timeout: 5000 });
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(900);
  const a0 = (await stage()).time;
  await page.waitForTimeout(500);
  const a1 = await stage();
  check('P resumes as well as pauses', a1.time > a0 && !a1.paused && (await page.locator('.menu--veil.show').count()) === 0);

  await page.keyboard.press('KeyP');
  await page.waitForSelector('.menu--veil.show', { timeout: 5000 });
  await page.getByRole('button', { name: 'Back to title' }).click();
  await page.waitForSelector('.menu--title.show', { timeout: 30000 }).then(() => check('Back to title opens the title', true), () => check('Back to title opens the title', false));
  await page.waitForTimeout(2600);
  const title = await stage();
  check('the title is shown on a clean stage, with the story stopped', title.zoom === 0 && !title.playing && !title.paused, JSON.stringify(title));
  await t.shot('11_title_again');
  const mondays = await count('monday.class');
  await page.getByRole('button', { name: 'Begin the week' }).click();
  await page.waitForFunction((n) => window.__BEATS.filter((b) => b === 'monday.class').length > n, mondays, { timeout: 30000 })
    .then(() => check('Begin the week starts Monday from there', true), () => check('Begin the week starts Monday from there', false));
  await t.close();
}

// ------------------------------------------------------------------------------------------- 8. the mouse itself
{
  const t = await open('?chapter=friday&speed=6&dpr=1&q=high');
  const { page } = t;
  const locked = () => page.evaluate(() => document.pointerLockElement?.id ?? null);
  const view = () => page.evaluate(() => ({ yaw: window.__game.player.yaw, pitch: window.__game.player.pitch }));
  await t.beat('friday.class');
  await page.waitForTimeout(1200);
  await page.mouse.click(640, 360);
  await page.waitForTimeout(500);
  check('a click on the picture captures the mouse', (await locked()) === 'view');
  const v0 = await view();
  for (let i = 1; i <= 10; i++) await page.mouse.move(640 + i * 10, 360);
  await page.waitForTimeout(250);
  const v1 = await view();
  for (let i = 1; i <= 10; i++) await page.mouse.move(740, 360 - i * 6);
  await page.waitForTimeout(250);
  const v2 = await view();
  check('moving the mouse right turns the view right', v1.yaw < v0.yaw - 0.1, `yaw ${v0.yaw.toFixed(2)} -> ${v1.yaw.toFixed(2)}`);
  check('moving the mouse up looks up', v2.pitch > v1.pitch + 0.05, `pitch ${v1.pitch.toFixed(2)} -> ${v2.pitch.toFixed(2)}`);

  // Esc hands the mouse back to the browser: from the page's side that is the lock ending
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForSelector('.menu--veil.show', { timeout: 5000 })
    .then(() => check('losing the mouse (Esc) pauses the game', true), () => check('losing the mouse (Esc) pauses the game', false));
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.waitForTimeout(600);
  check('Resume takes the mouse back', (await locked()) === 'view');

  // a decision frees the mouse to point with, without pausing, and takes it back afterwards
  await t.beat('friday.vote', 120000);
  await page.waitForFunction(() => window.__game.hud.choosing, undefined, { timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(900);
  check('a decision frees the mouse without pausing', (await locked()) === null && (await page.locator('.menu--veil.show').count()) === 0);
  const card = await page.evaluate(() => {
    const hud = window.__game.hud, w = hud.options[1].widget;
    return { x: innerWidth / 2 + w.x * hud.uiScale, y: innerHeight / 2 - w.y * hud.uiScale };
  });
  await page.mouse.move(card.x, card.y, { steps: 5 });
  await page.waitForTimeout(250);
  await page.mouse.click(card.x, card.y);
  await page.waitForTimeout(900);
  check('the click that chooses also takes the mouse back', (await page.evaluate(() => window.__game.state.policyChoice)) === 'combined' && (await locked()) === 'view', `choice ${await page.evaluate(() => window.__game.state.policyChoice)}, lock ${await locked()}`);
  await t.close();
}

// ------------------------------------------------------------------------------------------- 9. Thursday, onto the bridge
{
  const t = await open('?chapter=thursday&auto=1&speed=6&handover=thursday.festival&dpr=1&q=low');
  const { page } = t;
  await t.beat('thursday.festival', 180000);
  // the welcome is read through, and then the walk is the player's
  for (let i = 0; i < 30 && !(await page.evaluate(() => window.__game.player.canMove && !window.__game.hud.subtitle)); i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(350);
  }
  // W walks where the player faces, up the meadow towards the bridge, and D steps to the right of that
  await t.face(0, 1.6, -12.3);
  const start = await t.at();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2900);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(400);
  const walked = await t.at();
  check('W walks forward', start.z - walked.z > 5, `z ${start.z.toFixed(2)} -> ${walked.z.toFixed(2)}`);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyD');
  const strafed = await t.at();
  check('D strafes right', strafed.x - walked.x > 0.5, `x ${walked.x.toFixed(2)} -> ${strafed.x.toFixed(2)}`);
  // up the middle of the meadow, over its edge to the bridge's first tile, and along the bridge as it winds
  const edge = await t.walk(0, -9.4, 0.6, 20000);
  const tile = await t.walk(0, -12.3, 0.7, 10000);
  const first = await t.at();
  check('Thursday: the bridge can be walked onto from the meadow', edge && tile, `(${first.x.toFixed(1)}, ${first.z.toFixed(1)})`);
  for (let k = 0.03; k <= 0.3001; k += 0.03) {
    const at = await page.evaluate((u) => { const v = window.__game.app.world.bridge.path.getPointAt(u); return [v.x, v.z]; }, k);
    await t.walk(at[0], at[1], 0.6, 8000);
  }
  await t.shot('9_bridge');
  await t.beat('thursday.oneMore', 8000).then(() => check('Thursday: walking out along the bridge moves the story on', true), () => check('Thursday: walking out along the bridge moves the story on', false));
  await t.close();
}

const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
if (problems.length) console.log('CONSOLE ERRORS:\n ' + problems.join('\n '));
await browser.close();
process.exit(failed.length || problems.length ? 1 : 0);
