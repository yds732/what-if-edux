#!/usr/bin/env node
// Captures the DOM menus over the live game: the title at three screen shapes, chapters, settings, pause,
// and the end-of-week summary; then checks that Continue resumes a week in progress. Fails on any console error.
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const GPU_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--hide-scrollbars', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'];
fs.mkdirSync('shots/ui', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: GPU_ARGS });
const problems = [];

const open = async (width, height, query = '', touch = false) => {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text().slice(0, 400)); });
  page.on('pageerror', (e) => problems.push(String(e.stack ?? e).slice(0, 800)));
  await page.goto(base + query, { waitUntil: 'load' });
  return { page, shot: (name) => page.screenshot({ path: `shots/ui/${name}.jpg`, type: 'jpeg', quality: 88 }), close: () => context.close() };
};

{
  const { page, shot, close } = await open(1600, 900);
  await page.waitForSelector('.menu--title.show', { timeout: 90000 });
  await page.waitForTimeout(5200);
  await shot('title');
  await page.getByRole('button', { name: 'Chapters' }).click();
  await page.waitForTimeout(900);
  await shot('chapters');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.waitForTimeout(900);
  await shot('settings');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Begin the week' }).click();
  await page.waitForTimeout(7000);
  await shot('monday');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(900);
  await shot('pause');
  await close();
}
for (const [name, w, h] of [['title_tall', 390, 844], ['title_phone', 844, 390], ['title_tablet', 1024, 768]]) {
  const { page, shot, close } = await open(w, h, '', true);
  await page.waitForSelector('.menu--title.show', { timeout: 90000 });
  await page.waitForTimeout(5200);
  await shot(name);
  if (name !== 'title_tablet') {
    await page.getByRole('button', { name: 'Chapters' }).click();
    await page.waitForTimeout(900);
    await shot(`${name}_chapters`);
    await page.getByRole('button', { name: 'Back' }).click();
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.waitForTimeout(900);
    await shot(`${name}_settings`);
  }
  await close();
}
for (const [name, w, h, touch] of [['end', 1600, 900, false], ['end_tall', 390, 844, true]]) {
  const { page, shot, close } = await open(w, h, '?chapter=friday&auto=1&speed=8&tue=meet&thu=help&policy=combined', touch);
  // the week's earlier choices, as if it had been played from Monday
  await page.waitForFunction(() => (window.__BEATS ?? []).includes('friday.class'), undefined, { timeout: 90000 });
  await page.evaluate(() => Object.assign(window.__game.state, { tuesdayChoice: 'meet', thursdayChoice: 'help' }));
  await page.waitForSelector('.card--wide', { timeout: 240000 });
  await page.waitForTimeout(3600);
  await shot(name);
  await close();
}
// progress: a week left part-way is offered again on the title, with its choices intact
{
  const { page, close } = await open(1280, 720, '?chapter=monday&auto=1&speed=8&tue=haven&q=low&dpr=1');
  await page.waitForFunction(() => (window.__BEATS ?? []).includes('wednesday.class'), undefined, { timeout: 240000 });
  await page.goto(`${base}?q=low&dpr=1`, { waitUntil: 'load' });
  await page.waitForSelector('.menu--title.show', { timeout: 90000 });
  const resume = page.getByRole('button', { name: 'Continue · Wednesday' });
  if ((await resume.count()) !== 1) problems.push('the title does not offer "Continue · Wednesday" after leaving on Wednesday');
  else {
    await resume.click();
    await page.waitForFunction(() => (window.__BEATS ?? []).includes('wednesday.class'), undefined, { timeout: 60000 });
    const state = await page.evaluate(() => window.__game.state);
    if (state.tuesdayChoice !== 'haven') problems.push(`Continue lost Tuesday's choice: ${JSON.stringify(state)}`);
  }
  await close();
}
console.log(JSON.stringify({ ok: problems.length === 0, problems }));
await browser.close();
process.exit(problems.length ? 1 : 0);
