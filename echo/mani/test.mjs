import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const html = await readFile('mani/dist/scene.html', 'utf8');
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(req.url === '/' ? '<iframe src="/scene" sandbox="allow-scripts allow-pointer-lock" allow="xr-spatial-tracking *; autoplay *"></iframe>' : html);
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const root = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  // Exercise the recordings from this checkout before they reach the web release.
  const voiceBase = 'https://echo-between-two-worlds.vercel.app/assets/voices/';
  await page.route(voiceBase + '*/*.mp3', route => route.fulfill({
    path: 'public/assets/voices/' + route.request().url().slice(voiceBase.length),
    contentType: 'audio/mpeg', headers: { 'Access-Control-Allow-Origin': '*' },
  }));
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  page.on('console', msg => { if (msg.type() === 'error') console.error(msg.text().slice(0, 450)); });
  page.on('requestfailed', req => console.error(req.url().slice(0, 150), req.failure()));
  await page.addInitScript(() => { if (location.pathname === '/scene') window.__MANI_EDITOR_PREVIEW__ = true; });
  await page.goto(root);
  const frame = page.frames().find(f => f !== page.mainFrame());
  await frame.waitForFunction(() => window.__M3D_EDITOR__?.ready, undefined, { timeout: 90000 });
  const pose = () => frame.evaluate(() => window.__M3D_EDITOR__.camera.matrixWorld.toArray());
  const before = await pose();
  await frame.locator('#view').click();
  await page.keyboard.down('w');
  await page.waitForTimeout(3100);
  await page.keyboard.up('w');
  assert.deepEqual(await pose(), before);
  const mode = editing => frame.evaluate(value => dispatchEvent(new CustomEvent('m3d:edit-mode', { detail: { editing: value } })), editing);
  await mode(false);
  const game = frame.childFrames()[0];
  const begin = game.getByRole('button', { name: 'Begin the week' });
  await begin.click({ timeout: 90000 });
  await game.waitForFunction(() => window.__game?.playing && window.__BEATS?.length > 1);
  await mode(true);
  assert.equal(frame.childFrames().length, 0);
  assert.deepEqual(await pose(), before);
  console.log('Embedded edit, Test, story start, and restored camera passed.');
  await page.goto(root + '/play?chapter=monday&auto=1&xr=emulate&q=low&speed=8');
  await page.waitForFunction(() => window.__game?.app.renderer.xr.isPresenting && window.__game.app.renderer.getRenderTarget()?.isXRRenderTarget && window.__game.app.info.triangles > 0, undefined, { timeout: 90000 });
  await page.waitForFunction(() => window.__BEATS?.includes('chapter:end'), undefined, { timeout: 420000 });
  assert.equal(await page.evaluate(() => window.__game.audio.faults), 0);
  assert.deepEqual(errors, []);
  console.log('Standalone story rendered into the emulated headset and reached the ending.');
} finally {
  await browser.close();
  server.close();
}
