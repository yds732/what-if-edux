// Entry point: game loop, input, choice prompts, level reports and the year view.
import { LEVELS } from './game/levels.js';
import { createActionLog, summariseLevel, summariseYear, formatAmount } from './game/impact.js';
import { createScene, createPlayer, placeObjects, removeObjects } from './render/manifest-adapter.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const view = createScene(document.body);
const player = createPlayer(view);
const log = createActionLog();

let levelIndex = 0;
let objects = [];
let near = null;      // object the player is standing next to
let paused = false;   // true while a report is open

function startLevel(i) {
  levelIndex = i;
  const level = LEVELS[i];
  removeObjects(view, objects);
  objects = placeObjects(view, level.objects);
  player.reset();
  near = null;
  $('level').textContent = level.title;
  updateProgress();
  say(`${level.intro} Walk up to things to make a choice.`);
  hideReport();
}

function updateProgress() {
  $('progress').textContent = `Choices: ${objects.filter((o) => o.used).length} / ${objects.length}`;
}

function say(text) { $('log').innerHTML = `<p>${esc(text)}</p>`; }

function showChoices(obj) {
  const d = obj.def;
  $('log').innerHTML = `
    <p><strong>${esc(d.label)}</strong>: ${esc(d.prompt)}</p>
    ${d.choices.map((c, i) => `<button class="choice" data-i="${i}"><kbd>${i + 1}</kbd> ${esc(c.label)}</button>`).join('')}`;
  $('log').querySelectorAll('.choice').forEach((b) => (b.onclick = () => choose(Number(b.dataset.i))));
}

function choose(i) {
  if (!near || paused) return;
  const obj = near;
  const choice = obj.def.choices[i];
  if (!choice) return;
  log.record(choice.action, LEVELS[levelIndex].id);
  obj.markUsed();
  near = null;
  updateProgress();
  say(`You chose: ${choice.label}.`);
  if (objects.every((o) => o.used)) setTimeout(endLevel, 600);
}

addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase());
  if (e.key === '1' || e.key === '2') choose(Number(e.key) - 1);
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
const keys = new Set();

// ---------- reports ----------
function amountsHtml(amounts) {
  if (!amounts.length) return '';
  return `<ul class="amounts">${amounts.map((a) => `<li>${a.value == null
    ? `<span class="pending">${esc(a.metric.replace(/_.*/, ''))}: figure being checked</span>`
    : esc(formatAmount(a.metric, a.value))}</li>`).join('')}</ul>`;
}

function showReport(html, buttonText, onNext) {
  paused = true;
  $('reportBody').innerHTML = `${html}<button id="next">${esc(buttonText)}</button>`;
  $('report').style.display = 'flex';
  $('next').onclick = onNext;
}
function hideReport() { paused = false; $('report').style.display = 'none'; }

function endLevel() {
  const level = LEVELS[levelIndex];
  const s = summariseLevel(log, level.id);
  const html = `
    <h2>${esc(level.title)}: what if you did this every day?</h2>
    ${s.lines.map((l) => `
      <div class="line ${l.isBad ? 'bad' : 'good'}">
        <h3>${esc(l.label)}</h3>
        <p>${esc(l.consequence)}</p>
        ${l.amounts.length ? `<p class="when">If you did this ${esc(l.when)}:</p>${amountsHtml(l.amounts)}` : ''}
        ${l.better ? `<p class="better">Better choice next time: <strong>${esc(l.better)}</strong></p>` : ''}
      </div>`).join('')}
    <p class="disclaimer">${esc(s.disclaimer)}</p>`;
  const hasNext = levelIndex + 1 < LEVELS.length;
  showReport(html, hasNext ? 'Next level' : 'See your year', () => (hasNext ? startLevel(levelIndex + 1) : endGame()));
}

function endGame() {
  const y = summariseYear(log);
  const html = `
    <h2>Your year</h2>
    <p>You made <strong>${y.goodCount} of ${y.total}</strong> planet-friendly choices.</p>
    ${y.totals.length ? `<p>Over a year, your choices would add up to:</p><ul class="amounts">${y.totals.map((t) => `<li>${esc(formatAmount(t.metric, t.value))}</li>`).join('')}</ul>` : ''}
    ${y.topChanges.length
      ? `<h3>Your top ${y.topChanges.length === 1 ? 'thing' : 'two things'} to change</h3><ol>${y.topChanges.map((c) => `<li>${esc(c.label)} → <strong>${esc(c.better)}</strong></li>`).join('')}</ol>`
      : '<h3>Amazing, every choice was planet-friendly!</h3>'}
    <p class="disclaimer">${esc(y.disclaimer)}</p>`;
  showReport(html, 'Play again', () => location.reload());
}

// ---------- loop ----------
let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (!paused) {
    const dx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    const dz = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
    if (dx || dz) player.move(dx, dz, dt);
    const nowNear = objects.find((o) => o.isNear(player.position)) ?? null;
    if (nowNear !== near) {
      near = nowNear;
      if (near) showChoices(near);
      else if (!objects.every((o) => o.used)) say('Walk up to something to make a choice.');
    }
  }
  view.render(player.position);
  requestAnimationFrame(loop);
}

startLevel(0);
requestAnimationFrame(loop);
