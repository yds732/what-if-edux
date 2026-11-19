#!/usr/bin/env node
// Plays Haven's arcade the way a person does: real key, mouse and touch events, no autopilot.
//
//   node tools/arcade-test.mjs [scenario ...] [--base=http://127.0.0.1:5173/]
//
// With no names, every scenario runs. Each opens its own page, and fails on a console error. Where the view has
// to be turned (walking to a gate), the player's heading is set directly, as tools/input-test.mjs does: what is
// being checked here is the gate, the game behind it and the way back out, not the mouse-look.
import { chromium } from 'playwright';
import fs from 'node:fs';

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith('--base='))?.slice(7) ?? 'http://127.0.0.1:5173/';
const wanted = args.filter((a) => !a.startsWith('--'));
const GPU_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--hide-scrollbars', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
fs.mkdirSync('shots/arcade-test', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: GPU_ARGS });
const problems = [];
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  return !!ok;
};

/** A page with the game on it, and the things a scenario does to it. `touch` makes it a phone. */
const open = async (query, { touch = false } = {}) => {
  const context = await browser.newContext(touch ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${query}: ${m.text().slice(0, 400)}`); });
  page.on('pageerror', (e) => problems.push(`${query}: ${String(e.stack ?? e).slice(0, 800)}`));
  const cdp = touch ? await context.newCDPSession(page) : null;
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id = 0]) => ({ x, y, id })) });
  const t = {
    page, send,
    beat: (name, timeout = 90000) => page.waitForFunction((n) => (window.__BEATS ?? []).includes(n), name, { timeout }).then(() => true, () => false),
    reached: (name) => page.evaluate((n) => (window.__BEATS ?? []).includes(n), name),
    shot: (name) => page.screenshot({ path: `shots/arcade-test/${name}.jpg`, type: 'jpeg', quality: 85 }),
    /** A value read from the game being played. */
    game: (expression) => page.evaluate(`(() => { const game = window.__game, world = game.arcade.active; return ${expression}; })()`),
    /** Where a point of the world is on the screen, in CSS pixels. */
    project: (x, y, z) => page.evaluate(([px, py, pz]) => {
      const g = window.__game, p = g.playerEye.clone().set(px, py, pz).project(g.app.camera);
      return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight };
    }, [x, y, z]),
    tap: async (x, y, ms = 70) => {
      await send('touchStart', [[x, y]]);
      await page.waitForTimeout(ms);
      await send('touchEnd', []);
      await page.waitForTimeout(120);
    },
    /** Presses Space until a beat is reached: lines of dialogue wait to be read. */
    talkUntil: async (name, tries = 60) => {
      for (let i = 0; i < tries && !(await t.reached(name)); i++) {
        if (touch) await t.tap(600, 200);
        else await page.keyboard.press('Space');
        await page.waitForTimeout(350);
      }
      return t.reached(name);
    },
    /** Holds W, turned toward a point on the ground, until within `radius` of it. */
    walk: async (x, z, radius, timeout = 20000) => {
      const t0 = Date.now();
      await page.keyboard.down('KeyW');
      try {
        while (Date.now() - t0 < timeout) {
          const d = await page.evaluate(([tx, tz]) => {
            const pl = window.__game.player, dx = tx - pl.position.x, dz = tz - pl.position.z;
            pl.yaw = Math.atan2(-dx, -dz);
            pl.pitch = 0.1;
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
    /** The buttons of whatever DOM menu is open. */
    menu: () => page.evaluate(() => [...document.querySelectorAll('#ui .menu.show button')].map((b) => b.textContent.trim())),
    click: (label) => page.locator('#ui .menu.show button', { hasText: label }).first().click(),
    /** Where one of a game's own panels is on the screen (`expression` picks it from `world`), or null if it is not showing. */
    panel: (expression) => page.evaluate(`(() => {
      const game = window.__game, world = game.arcade.active, hud = game.hud, el = ${expression};
      return el && el.widget.visible ? { x: innerWidth / 2 + el.widget.x * hud.uiScale, y: innerHeight / 2 - el.widget.y * hud.uiScale, disabled: el.disabled } : null;
    })()`),
    /** Where the cards of a decision are on the screen. */
    cards: () => page.evaluate(() => {
      const hud = window.__game.hud;
      return hud.choosing ? hud.options.filter((o) => o.widget.visible).map((o) => ({ x: innerWidth / 2 + o.widget.x * hud.uiScale, y: innerHeight / 2 - o.widget.y * hud.uiScale })) : [];
    }),
    /** Presses somewhere: a click, or a tap on a phone. */
    press: async (x, y) => {
      if (touch) await t.tap(x, y);
      else await page.mouse.click(x, y);
    },
    close: () => context.close(),
  };
  await page.goto(base + (query ? `?${query}` : ''), { waitUntil: 'load' });
  return t;
};

/** Plays Moonlight Rally with a pointer: `move(x, y)` puts the pointer somewhere, `press()` serves. Returns what happened. */
const playRally = async (t, move, press, seconds) => {
  const LIFT = 0.11, PLANE = LIFT + 0.76 + 0.2;
  const started = Date.now();
  let served = 0;
  while (Date.now() - started < seconds * 1000) {
    const s = await t.game('world ? { phase: world.phase, ball: world.court.ball.p, vz: world.court.ball.v.z, last: world.court.rally.lastHitter, hits: world.hits, score: world.score } : null');
    if (!s) break;
    // the bat goes where the ball is, across the table; pushed forward as the ball arrives
    const coming = s.phase === 'live' && s.last === 'kai' && s.vz > 0;
    const at = await t.project(coming ? s.ball.x : 0, PLANE, coming && s.ball.z > 0.9 ? 1.35 : 1.75);
    await move(at.x, at.y);
    if (s.phase === 'serveYou') {
      await t.page.waitForTimeout(350);
      await press(at.x, at.y);
      served++;
    }
    if (s.score.you + s.score.kai >= 2 && s.hits.you >= 3) break;
    await t.page.waitForTimeout(16);
  }
  return { served, ...(await t.game('({ hits: world.hits, score: world.score, phase: world.phase })')) };
};

const SCENARIOS = {
  /** From the title's button to the isle, on foot to a gate, through it, and back out by the pause menu. */
  hub: async () => {
    const t = await open('');
    await t.page.waitForSelector('#ui .menu--title.show', { timeout: 90000 });
    check('title: offers the arcade', (await t.menu()).includes('Haven Arcade'), (await t.menu()).join(' | '));
    await t.click('Haven Arcade');
    check('arcade: arrives on the isle', await t.talkUntil('arcade.hub'));
    const gate = await t.page.evaluate(() => { const g = window.__game.worlds.haven.arcade.gates.rally.position; return { x: g.x, z: g.z }; });
    check('arcade: walks from the plaza to a gate', await t.walk(gate.x, gate.z, 3.0));
    // looking at the film in the arch
    await t.page.evaluate(() => {
      const g = window.__game, f = g.worlds.haven.arcade.gates.rally.film, pl = g.player;
      pl.yaw = Math.atan2(-(f.x - pl.position.x), -(f.z - pl.position.z));
      pl.pitch = Math.atan2(f.y - pl.eyeHeight, Math.hypot(f.x - pl.position.x, f.z - pl.position.z));
    });
    await t.page.waitForTimeout(400);
    const prompt = await t.page.evaluate(() => window.__game.interaction.focus?.prompt ?? null);
    check('arcade: the gate asks to be stepped through', prompt === 'Step into Moonlight Rally', String(prompt));
    await t.shot('hub-gate');
    await t.page.keyboard.press('KeyE');
    check('arcade: E steps through the gate into the game', await t.beat('rally.intro', 60000));
    check('game: its world is the one on screen', (await t.game('game.app.world.id')) === 'rally');
    await t.talkUntil('rally.ready');
    await t.page.keyboard.press('Escape');
    await t.page.waitForSelector('#ui .menu.show .card--pause', { timeout: 5000 }).catch(() => undefined);
    const menu = await t.menu();
    check('game: Escape pauses, and the pause menu knows it is a game', menu.includes('Restart game') && menu.includes('Leave game'), menu.join(' | '));
    await t.shot('hub-pause');
    await t.click('Leave game');
    check('game: "Leave game" goes back out through the gate', await t.beat('arcade.back.rally', 30000));
    await t.page.waitForTimeout(1500);
    const back = await t.game('({ world: game.app.world.id, canMove: game.player.canMove, active: !!world, sticks: game.input.sticks })');
    check('arcade: back on the isle, free to walk', back.world === 'haven' && back.canMove && !back.active && back.sticks, JSON.stringify(back));
    await t.shot('hub-back');
    await t.close();
  },

  /** A whole exchange with the mouse: serve with a click, follow the ball, return it. */
  rally: async () => {
    const t = await open('play=rally');
    check('rally: opens', await t.beat('rally.intro', 90000));
    check('rally: the introduction can be read through', await t.talkUntil('rally.ready'));
    const holdsPaddle = () => t.page.evaluate(() => {
      const { kai, kaiBat } = window.__game.arcade.active;
      const [fingers, thumb] = kai.rightWrist.children;
      return [fingers.children[0], thumb.children[0].children[0]].every((joint) => {
        const p = kaiBat.worldToLocal(joint.getWorldPosition(kaiBat.position.clone()));
        // Both pads must reach the wooden handle, which runs from 10 to 18.5 cm behind the blade centre.
        const z = Math.max(0.1, Math.min(0.185, p.z));
        return Math.hypot(p.x, p.y, p.z - z) < 0.035;
      });
    });
    check('rally: Kai grips the handle with his fingers and thumb before the serve', await holdsPaddle());
    const result = await playRally(t, (x, y) => t.page.mouse.move(x, y), (x, y) => t.page.mouse.click(x, y), 60);
    check('rally: the handle stays in Kai\'s hand through play', await holdsPaddle());
    await t.shot('rally-mouse');
    check('rally: a click serves', result.served >= 1, JSON.stringify(result));
    check('rally: the bat follows the mouse onto the ball', result.hits.you >= 3, JSON.stringify(result.hits));
    check('rally: points are played and scored', result.score.you + result.score.kai >= 2, JSON.stringify(result.score));
    // restart from the pause menu: the score goes back to nothing
    await t.page.keyboard.press('KeyP');
    await t.page.waitForSelector('#ui .menu.show .card--pause', { timeout: 5000 }).catch(() => undefined);
    await t.click('Restart game');
    await t.page.waitForTimeout(2500);
    const again = await t.game('({ score: world.score, active: !!world })');
    check('rally: "Restart game" begins it again', again.active && again.score.you + again.score.kai === 0, JSON.stringify(again));
    await t.close();
  },

  /** The same on a phone: a finger anywhere is the pointer, with no walking stick in the way. */
  rallyTouch: async () => {
    const t = await open('play=rally', { touch: true });
    check('rally on a phone: opens', await t.beat('rally.intro', 90000));
    check('rally on a phone: the introduction can be tapped through', await t.talkUntil('rally.ready'));
    let down = false;
    const move = async (x, y) => {
      await t.send(down ? 'touchMove' : 'touchStart', [[x, y]]);
      down = true;
    };
    const press = async (x, y) => {
      // lift and put the finger down again: a tap serves
      if (down) await t.send('touchEnd', []);
      down = false;
      await t.tap(x, y);
    };
    // on the left half of the screen as well as the right: nothing there is a walking stick while a game is open
    const result = await playRally(t, move, press, 60);
    if (down) await t.send('touchEnd', []);
    await t.shot('rally-touch');
    check('rally on a phone: a tap serves', result.served >= 1, JSON.stringify(result));
    check('rally on a phone: the bat follows the finger onto the ball', result.hits.you >= 3, JSON.stringify(result.hits));
    check('rally on a phone: no stick appears under the finger', (await t.page.evaluate(() => window.__game.input.stickView)) === null);
    await t.close();
  },
};

/** Plays a duel through with a pointer: picks a team from the cards, then moves from the buttons, swapping once. */
const playDuel = async (t, label) => {
  check(`${label}: opens`, await t.beat('duel.intro', 90000));
  // ---- a team: a card for each element; the second by its number key where there is a keyboard ----
  let picked = 0;
  for (const element of ['ember', 'tide', 'bloom']) {
    if (!(await t.talkUntil(`duel.pick.${element}`))) break;
    await t.page.waitForFunction(() => window.__game.hud.choosing, undefined, { timeout: 15000 }).catch(() => undefined);
    await t.page.waitForTimeout(700);
    const cards = await t.cards();
    if (cards.length !== 2) break;
    if (element === 'ember') await t.shot(`${label}-pick`);
    if (element === 'tide' && label === 'duel') await t.page.keyboard.press('Digit2');
    else await t.press(cards[0].x, cards[0].y);
    picked++;
    await t.page.waitForFunction(() => !window.__game.hud.choosing, undefined, { timeout: 8000 }).catch(() => undefined);
  }
  check(`${label}: a sprite of each element can be chosen from the cards`, picked === 3, `${picked} chosen`);
  check(`${label}: the duel begins`, await t.talkUntil('duel.ready'));
  const team = await t.game('world.battle.teams.you.map((f) => f.sprite.element)');
  check(`${label}: the team has one of each element`, team.join() === 'ember,tide,bloom', team.join());

  // ---- rounds: whatever move can be afforded; one swap; replacements as they are asked for ----
  let swapped = false, shots = 0;
  const started = Date.now();
  while (Date.now() - started < 240000) {
    const s = await t.game('world ? { menu: world.menu, won: world.battle.winner, rounds: world.stats.rounds, out: world.battle.active.you } : null');
    if (!s || s.won) break;
    if (s.menu === 'moves') {
      if (shots++ === 0) await t.shot(`${label}-moves`);
      const swap = await t.panel('world.swapButton');
      if (!swapped && s.rounds >= 2 && swap && !swap.disabled) {
        await t.press(swap.x, swap.y);
        await t.page.waitForTimeout(350);
        await t.shot(`${label}-bench`);
        const bench = [await t.panel('world.benchButtons[0]'), await t.panel('world.benchButtons[1]')].find((b) => b && !b.disabled);
        if (bench) {
          await t.press(bench.x, bench.y);
          await t.page.waitForTimeout(1600);
          swapped = (await t.game('world.battle.active.you')) !== s.out;
        }
        continue;
      }
      // the dearest move it can pay for
      for (const i of [2, 1, 0]) {
        const b = await t.panel(`world.moveButtons[${i}]`);
        if (b && !b.disabled) {
          await t.press(b.x, b.y);
          break;
        }
      }
    } else if (s.menu === 'replace') {
      const bench = [await t.panel('world.benchButtons[0]'), await t.panel('world.benchButtons[1]')].find((b) => b && !b.disabled);
      if (bench) await t.press(bench.x, bench.y);
    }
    await t.page.waitForTimeout(250);
  }
  const end = await t.game('world ? { won: world.battle.winner, stats: world.stats } : null');
  check(`${label}: moves are chosen from the buttons, round after round`, end && end.stats.chosen >= 4, JSON.stringify(end));
  check(`${label}: a sprite can be swapped for another`, swapped);
  check(`${label}: the duel is fought to the end`, end && (end.won === 'you' || end.won === 'foe'), JSON.stringify(end));
  // the card at the end: its second button goes back out
  await t.talkUntil(end && end.won === 'you' ? 'duel.won' : 'duel.lost');
  await t.page.waitForFunction(() => window.__game.arcade.ui.els.size >= 3 && [...window.__game.arcade.ui.els].filter((e) => e.onClick && e.widget.visible).length === 2, undefined, { timeout: 30000 }).catch(() => undefined);
  await t.page.waitForTimeout(500);
  await t.shot(`${label}-end`);
  const leave = await t.panel('[...game.arcade.ui.els].filter((e) => e.onClick && e.widget.visible)[1]');
  if (leave) await t.press(leave.x, leave.y);
  check(`${label}: "Back to Haven" on the last card goes back out through the gate`, await t.beat('arcade.back.sprites', 30000));
};

SCENARIOS.duel = async () => {
  const t = await open('play=sprites');
  await playDuel(t, 'duel');
  await t.close();
};
SCENARIOS.duelTouch = async () => {
  const t = await open('play=sprites', { touch: true });
  await playDuel(t, 'duel on a phone');
  await t.close();
};

/** Plays Lantern Lights with a pointer: drags jewels onto their neighbours, taps two in turn, and tries a swap that makes nothing. */
const playLights = async (t, label, touch) => {
  check(`${label}: opens`, await t.beat('lights.intro', 90000));
  check(`${label}: the introduction can be read through`, await t.talkUntil('lights.ready'));
  /** Where a cell of the board is on the screen. */
  const cell = (c) => t.project((c.x - 3) * 0.3, 1.95 + (c.y - 3) * 0.3, 0.09);
  const state = () => t.game('world && world.game ? { left: world.game.movesLeft, over: world.game.over, accepting: world.accepting, stats: world.stats } : null');
  const ready = async () => {
    for (let i = 0; i < 200; i++) {
      const s = await state();
      if (!s || s.over || s.accepting) return s;
      await t.page.waitForTimeout(100);
    }
    return state();
  };
  const drag = async (a, b) => {
    const from = await cell(a), to = await cell(b);
    if (touch) {
      await t.send('touchStart', [[from.x, from.y]]);
      for (let k = 1; k <= 4; k++) {
        await t.send('touchMove', [[from.x + ((to.x - from.x) * k) / 4, from.y + ((to.y - from.y) * k) / 4]]);
        await t.page.waitForTimeout(30);
      }
      await t.send('touchEnd', []);
    } else {
      await t.page.mouse.move(from.x, from.y);
      await t.page.mouse.down();
      await t.page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
      await t.page.mouse.move(to.x, to.y, { steps: 3 });
      await t.page.mouse.up();
    }
  };
  const tapCell = async (c) => {
    const at = await cell(c);
    await t.press(at.x, at.y);
  };

  // ---- a swap that makes nothing is refused, and costs no move ----
  let s = await ready();
  const dud = await t.game(`(() => { const b = world.game.board; for (let x = 0; x < 6; x++) for (let y = 0; y < 7; y++) if (!b.canSwap({ x, y }, { x: x + 1, y })) return [{ x, y }, { x: x + 1, y }]; return null; })()`);
  if (dud) {
    await drag(dud[0], dud[1]);
    await t.page.waitForTimeout(900);
    const after = await state();
    check(`${label}: a swap that lines nothing up is put back, and costs no move`, after.left === s.left && after.stats.refused === 1, JSON.stringify(after));
  }
  // ---- a drag makes a swap ----
  s = await ready();
  let move = await t.game('world.game.board.findMove()');
  await drag(move[0], move[1]);
  s = await ready();
  check(`${label}: dragging a jewel onto its neighbour makes the swap`, s && s.stats.swaps === 1, JSON.stringify(s));
  await t.shot(`${label}-board`);
  // ---- so do two taps: one jewel, then the one beside it ----
  move = await t.game('world.game.board.findMove()');
  await tapCell(move[0]);
  await t.page.waitForTimeout(250);
  await tapCell(move[1]);
  // the click is acted on in the next frame: give it one before asking how the board stands
  await t.page.waitForTimeout(300);
  s = await ready();
  check(`${label}: tapping a jewel and then its neighbour makes the swap too`, s && s.stats.swaps === 2, JSON.stringify(s));
  // ---- and on to the end of the level ----
  for (let i = 0; i < 40 && s && !s.over; i++) {
    move = await t.game('world.game.board.findMove()');
    if (!move) break;
    await drag(move[0], move[1]);
    s = await ready();
  }
  const end = await t.game('world && world.game ? { won: world.game.won, over: world.game.over, left: world.game.movesLeft, gathered: world.game.gathered } : null');
  check(`${label}: the level is played to its end`, end && end.over, JSON.stringify(end));
  await t.talkUntil(end && end.won ? 'lights.won' : 'lights.lost');
  await t.page.waitForFunction(() => [...window.__game.arcade.ui.els].filter((e) => e.onClick && e.widget.visible).length === 2, undefined, { timeout: 40000 }).catch(() => undefined);
  await t.page.waitForTimeout(500);
  await t.shot(`${label}-end`);
  const leave = await t.panel('[...game.arcade.ui.els].filter((e) => e.onClick && e.widget.visible)[1]');
  if (leave) await t.press(leave.x, leave.y);
  check(`${label}: the last card goes back out through the gate`, await t.beat('arcade.back.lanterns', 30000));
};

SCENARIOS.lights = async () => {
  const t = await open('play=lanterns');
  await playLights(t, 'lights', false);
  await t.close();
};
SCENARIOS.lightsTouch = async () => {
  const t = await open('play=lanterns', { touch: true });
  await playLights(t, 'lights on a phone', true);
  await t.close();
};

/**
 * Sails Driftlight with a pointer: hooks something afloat, lays a tile, sees the wyrm off, and goes on to the
 * lighthouse hooking whatever is most wanted. (Two things are arranged rather than waited for: the wood for the
 * first tile, and the wyrm's first visit.)
 */
const playDrift = async (t, label, touch) => {
  check(`${label}: opens`, await t.beat('drift.intro', 90000));
  check(`${label}: the introduction can be read through`, await t.talkUntil('drift.ready'));
  const state = () => t.game('world && world.voyage ? { time: Math.round(world.voyage.time), light: Math.round(world.voyage.light), wood: world.voyage.wood, tiles: world.voyage.tiles.size, crew: world.voyage.crew.length, over: world.voyage.over, stats: world.stats, driven: world.voyage.tally.driven, bitten: world.voyage.tally.bitten } : null');
  const water = (x, z) => t.project(x, 0, z);
  const TILE = 1.1, DECK = 0.3;
  // the view finishes rising to where the voyage is sailed from
  await t.page.waitForTimeout(1200);

  // ---- a click on something afloat throws the hook at it, and it is brought in ----
  const plank = () => t.game(`(() => { const v = world.voyage, near = v.items.filter((i) => !i.hooked && i.kind === 'wood' && Math.hypot(i.x, i.z) < v.reach - 0.8 && i.z < 3.5 && i.z > -7).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0]; return near ? { x: near.x, z: near.z } : null; })()`);
  let item = null;
  for (let i = 0; i < 80 && !item; i++) {
    item = await plank();
    if (!item) await t.page.waitForTimeout(250);
  }
  const before = await state();
  if (item) {
    const at = await water(item.x, item.z);
    await t.press(at.x, at.y);
  }
  await t.page.waitForTimeout(1200);
  let s = await state();
  check(`${label}: a click on a plank afloat throws the hook and brings it in`, !!item && s.stats.casts === 1 && s.wood === before.wood + 1, JSON.stringify({ item, before, s }));

  // ---- with wood enough, a click on a glowing square lays a tile there ----
  await t.game('(world.voyage.wood = 4, 1)');
  await t.page.waitForTimeout(250);
  const slot = await t.game('world.voyage.slots()[0]');
  const square = await t.project(slot.cx * TILE, DECK, slot.cz * TILE);
  await t.press(square.x, square.y);
  await t.page.waitForTimeout(500);
  s = await state();
  check(`${label}: a click on a glowing square lays a tile`, s.tiles === 2 && s.stats.built === 1 && s.wood === 0, JSON.stringify(s));
  await t.shot(`${label}-raft`);

  // ---- the wyrm, brought on early, is knocked on the nose until it goes ----
  await t.game('(world.voyage.wyrm.nextIn = 0, 1)');
  await t.page.waitForFunction(() => window.__game.arcade.active.voyage.wyrm.state === 'circling', undefined, { timeout: 8000 }).catch(() => undefined);
  for (let i = 0; i < 30; i++) {
    const w = await t.game('({ state: world.voyage.wyrm.state, x: world.voyage.wyrm.x, z: world.voyage.wyrm.z, hook: world.voyage.hook.state })');
    if (w.state !== 'circling') break;
    if (w.hook === 'ready') {
      const at = await water(w.x, w.z);
      await t.press(at.x, at.y);
      if (i === 0) await t.shot(`${label}-wyrm`);
    }
    await t.page.waitForTimeout(120);
  }
  s = await state();
  check(`${label}: the hook sees the wyrm off before it takes a plank`, s.driven === 1 && s.bitten === 0, JSON.stringify(s));

  // ---- and on to the lighthouse: a tile whenever there is the wood, the wyrm whenever it shows, and otherwise whatever is most wanted ----
  for (let i = 0, t0 = Date.now(); Date.now() - t0 < 240000; i++) {
    const next = await t.game(`(() => {
      const v = world.voyage;
      if (v.over) return { over: v.over };
      if (v.wood >= 4 && v.slots().length) return { build: v.slots()[0] };
      if (v.hook.state !== 'ready') return {};
      if (v.wyrm.state === 'circling') return { cast: [v.wyrm.x, v.wyrm.z] };
      const want = (i) => (i.kind === 'castaway' ? 5 : i.kind === 'buoy' ? (v.light < 70 ? 4 : 0.5) : i.kind === 'crate' ? 3 : 2);
      const best = v.items.filter((i) => !i.hooked && Math.hypot(i.x, i.z) < v.reach - 0.3 && i.z < 4.2 && i.z > -8).sort((a, b) => want(b) - want(a) || Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
      return best ? { cast: [best.x, best.z] } : {};
    })()`);
    if (next.over) break;
    if (next.build) {
      const at = await t.project(next.build.cx * TILE, DECK, next.build.cz * TILE);
      await t.press(at.x, at.y);
    } else if (next.cast) {
      const at = await water(next.cast[0], next.cast[1]);
      await t.press(at.x, at.y);
    }
    if (i === 160) await t.shot(`${label}-voyage`);
    await t.page.waitForTimeout(touch ? 40 : 170);
  }
  const end = await state();
  check(`${label}: the voyage is sailed to the lighthouse`, end.over === 'arrived' && end.tiles >= 8 && end.crew >= 2, JSON.stringify(end));
  await t.page.waitForFunction(() => [...window.__game.arcade.ui.els].filter((e) => e.onClick && e.widget.visible).length === 2, undefined, { timeout: 60000 }).catch(() => undefined);
  await t.page.waitForTimeout(500);
  await t.shot(`${label}-end`);
  const leave = await t.panel('[...game.arcade.ui.els].filter((e) => e.onClick && e.widget.visible)[1]');
  if (leave) await t.press(leave.x, leave.y);
  check(`${label}: the last card goes back out through the gate`, await t.beat('arcade.back.drift', 30000));
};

SCENARIOS.drift = async () => {
  const t = await open('play=drift');
  await playDrift(t, 'drift', false);
  await t.close();
};
SCENARIOS.driftTouch = async () => {
  const t = await open('play=drift', { touch: true });
  await playDrift(t, 'drift on a phone', true);
  await t.close();
};

/**
 * Leads Duskbreak's flock with a pointer: across the bridge and back, through the better of the first gates, and
 * on to the dawn taking the better gate each time (or the gap between two bad ones) and facing whatever is nearest.
 */
const playDusk = async (t, label, touch) => {
  check(`${label}: opens`, await t.beat('dusk.intro', 90000));
  check(`${label}: the introduction can be read through`, await t.talkUntil('dusk.ready'));
  const state = () => t.game('world && world.march ? { time: Math.round(world.march.time), x: +world.march.x.toFixed(2), count: world.march.count, over: world.march.over, lit: world.march.tally.lit, dimmed: world.march.tally.dimmed } : null');
  /** Points at a place across the bridge, a little ahead of the flock: where the game reads the lead from. */
  let finger = false;
  const lead = async (x) => {
    const at = await t.project(x, 0, -2);
    if (!touch) return t.page.mouse.move(at.x, at.y);
    await t.send(finger ? 'touchMove' : 'touchStart', [[at.x, at.y]]);
    finger = true;
  };
  await t.page.waitForTimeout(1100);

  // ---- the flock goes where it is pointed ----
  await lead(2.2);
  await t.page.waitForTimeout(700);
  const right = await state();
  await lead(-2.2);
  await t.page.waitForTimeout(900);
  const left = await state();
  check(`${label}: the flock goes where it is pointed, to either side of the bridge`, right.x > 1.4 && left.x < -1.4, JSON.stringify({ right, left }));

  // ---- and on to the dawn ----
  let gates = 0, firstGate = null;
  for (let i = 0, t0 = Date.now(); Date.now() - t0 < 240000; i++) {
    const next = await t.game(`(() => {
      const m = world.march;
      if (m.over) return { over: m.over };
      const worth = (op) => (op.kind === 'add' ? m.count + op.n : op.kind === 'sub' ? Math.max(1, m.count - op.n) : op.kind === 'mul' ? m.count * op.n : op.kind === 'div' ? Math.ceil(m.count / op.n) : m.count * (m.quick < 3 ? 1.2 : 1));
      const gate = m.gates.filter((g) => !g.taken).sort((a, b) => a.ahead - b.ahead)[0];
      if (gate && gate.ahead < 14) {
        const l = worth(gate.left), r = worth(gate.right);
        return { x: Math.max(l, r) < m.count ? 0 : l >= r ? -1.7 : 1.7, gate: { id: gate.id, want: Math.min(99, Math.round(Math.max(l, r, m.count))), quick: (l >= r ? gate.left : gate.right).kind === 'quick' }, count: m.count };
      }
      const brute = m.foes.find((f) => f.kind === 'brute' && f.ahead < 4.5);
      if (brute) return { x: brute.x > 0 ? brute.x - 2.6 : brute.x + 2.6 };
      let near = null;
      for (const f of m.foes) if (f.ahead > 0.5 && f.ahead < 12 && (!near || f.ahead < near.ahead)) near = f;
      return { x: near ? near.x : 0, count: m.count };
    })()`);
    if (next.over) break;
    await lead(next.x);
    if (next.gate && (!firstGate || firstGate.id === next.gate.id)) firstGate = { ...next.gate, before: next.count };
    else if (firstGate && !firstGate.after && next.count !== undefined && !next.gate) {
      firstGate.after = next.count;
      check(`${label}: the gate the flock is led through makes it as many as it says`, firstGate.quick || firstGate.after >= firstGate.want - 2, JSON.stringify(firstGate));
      await t.shot(`${label}-march`);
    }
    if (next.gate) gates++;
    if (i === 260) await t.shot(`${label}-horde`);
    await t.page.waitForTimeout(touch ? 50 : 70);
  }
  if (touch && finger) await t.send('touchEnd', []);
  const end = await state();
  check(`${label}: the flock is led to the dawn, and is a good many by then`, end.over === 'dawn' && end.count >= 40 && end.lit > 100 && gates > 0, JSON.stringify(end));
  await t.page.waitForFunction(() => [...window.__game.arcade.ui.els].filter((e) => e.onClick && e.widget.visible).length === 2, undefined, { timeout: 60000 }).catch(() => undefined);
  await t.page.waitForTimeout(500);
  await t.shot(`${label}-end`);
  const leave = await t.panel('[...game.arcade.ui.els].filter((e) => e.onClick && e.widget.visible)[1]');
  if (leave) await t.press(leave.x, leave.y);
  check(`${label}: the last card goes back out through the gate`, await t.beat('arcade.back.duskbreak', 30000));
};

SCENARIOS.dusk = async () => {
  const t = await open('play=duskbreak');
  await playDusk(t, 'dusk', false);
  await t.close();
};
SCENARIOS.duskTouch = async () => {
  const t = await open('play=duskbreak', { touch: true });
  await playDusk(t, 'dusk on a phone', true);
  await t.close();
};

const names = wanted.length ? wanted : Object.keys(SCENARIOS);
for (const name of names) {
  const run = SCENARIOS[name];
  if (!run) {
    console.error(`no scenario called "${name}" (have: ${Object.keys(SCENARIOS).join(', ')})`);
    process.exit(2);
  }
  try {
    await run();
  } catch (e) {
    check(`${name}: ran to the end`, false, String(e.message ?? e).split('\n')[0]);
  }
}
await browser.close();
for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.ok || !c.detail ? '' : `  [${c.detail}]`}`);
if (problems.length) console.log('PROBLEMS:\n  ' + [...new Set(problems)].slice(0, 10).join('\n  '));
const failed = checks.filter((c) => !c.ok).length;
console.log(failed || problems.length ? `\n${failed} of ${checks.length} checks failed${problems.length ? `, ${problems.length} console errors` : ''}.` : `\nAll ${checks.length} checks passed.`);
process.exit(failed || problems.length ? 1 : 0);
