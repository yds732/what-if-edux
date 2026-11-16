// ECHO Scene 2 entry (echo.html): bedroom, phone, Jamie's message and the two choices.
// Works in VR (WebXR controllers) and on desktop (WASD + mouse).
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { buildBedroom, PALETTE } from './bedroom.js';
import { createHoloPanel, createHoloCard } from './holo-ui.js';
import { createStory, SCRIPT, STATES, BRANCHES } from './story.js';
import { createSfx } from './sfx.js';
import { NEXT_SCENE_URL } from './config.js';

const EYE = 1.6;            // desktop eye height (m)
const WALK = 1.5;           // walking speed (m/s)
const SNAP = Math.PI / 6;   // VR snap-turn angle
const PHONE_RADIUS = 1.3;   // how close counts as "near the phone"
const PANEL_DIST = 1.7;     // message panel distance from the player
const DIM = 0.72;           // how dark the room gets behind the message

const $ = (id) => document.getElementById(id);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- renderer and camera rig ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // the room is static: the shadow map is rendered once
renderer.xr.enabled = true;
renderer.xr.setFoveation(1);
$('app').appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1015);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 400);
camera.position.set(0, EYE, 0);
const rig = new THREE.Group(); // move/turn this, not the camera: the headset drives the camera in VR
rig.add(camera);
scene.add(rig);

const room = buildBedroom(scene, renderer);
renderer.shadowMap.needsUpdate = true;
let yaw = room.spawn.yaw;
let pitch = 0;
rig.position.set(room.spawn.x, 0, room.spawn.z);
rig.rotation.y = yaw;

const sfx = createSfx();
const story = createStory({
  onChange(next, prev) {
    document.body.dataset.state = next;
    console.info(`[echo] ${prev} -> ${next}`);
  },
});
document.body.dataset.state = story.state;

// ---------- world-space UI ----------
// The notification card floats above the phone, carried by the phone's cone of light.
const CARD = { w: 1.0, h: 0.32 };
const instruction = createHoloCard({
  width: CARD.w, height: CARD.h,
  lines: [
    { text: SCRIPT.instruction.title, size: 42, weight: 700, color: '#A7C7E7', spacing: 4 },
    { text: SCRIPT.instruction.body, size: 36, italic: true },
  ],
});
instruction.visible = false;
scene.add(instruction);

const prompt = createHoloCard({ width: 0.3, height: 0.08, px: 600, lines: [{ text: SCRIPT.phonePrompt, size: 60, weight: 600 }] });
prompt.visible = false;
scene.add(prompt);

const panel = createHoloPanel();
panel.mesh.visible = false;
scene.add(panel.mesh);
let panelReady = false; // buttons only react once the panel has settled
let panelAnim = null;

// A dark shell around the head dims the room in VR and on desktop alike.
const dim = new THREE.Mesh(
  new THREE.SphereGeometry(0.6, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0x05070a, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false }),
);
dim.renderOrder = 10;
dim.visible = false;
scene.add(dim);
let dimLevel = 0;
let dimTarget = 0;

// ---------- VR controllers ----------
const controllers = [];
const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
const rayMat = new THREE.LineBasicMaterial({ color: PALETTE.holo, transparent: true, opacity: 0.7, fog: false });
const handGeo = new THREE.BoxGeometry(0.035, 0.03, 0.11);
const handMat = new THREE.MeshStandardMaterial({ color: PALETTE.blueGray, roughness: 0.5 });
for (let i = 0; i < 2; i++) {
  const c = renderer.xr.getController(i);
  const line = new THREE.Line(rayGeo, rayMat);
  line.renderOrder = 30;
  line.visible = false;
  c.add(line);
  const state = { line, hit: null, connected: false };
  c.userData.echo = state;
  c.addEventListener('connected', () => { state.connected = true; });
  c.addEventListener('disconnected', () => { state.connected = false; state.hit = null; });
  c.addEventListener('select', () => activate(state.hit));
  rig.add(c);
  const grip = renderer.xr.getControllerGrip(i);
  grip.add(new THREE.Mesh(handGeo, handMat));
  rig.add(grip);
  controllers.push(state);
  state.object = c;
}

// ---------- desktop input ----------
const keys = new Set();
const mouse = new THREE.Vector2();
const CENTER = new THREE.Vector2(0, 0);
let mouseInside = false;
let mouseHit = null;
let dragging = false;
let levelView = false; // desktop: ease the view back to level when the message opens
const canvas = renderer.domElement;
const locked = () => document.pointerLockElement === canvas;
const lockPointer = () => { try { canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* not available */ } };

addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyE' && phoneNear) openPhone();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
canvas.addEventListener('pointermove', (e) => {
  mouseInside = true;
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
});
canvas.addEventListener('pointerleave', () => { mouseInside = false; });
document.addEventListener('mousemove', (e) => {
  if (renderer.xr.isPresenting) return;
  // locked: free look. Not locked (e.g. embedded page): hold the mouse button and drag.
  if (!locked() && !(dragging && e.buttons & 1)) return;
  levelView = false;
  yaw -= e.movementX * 0.0022;
  pitch = clamp(pitch - e.movementY * 0.0022, -1.35, 1.35);
});
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !started || renderer.xr.isPresenting) return;
  updateMouseHit();
  if (activate(mouseHit)) return;
  dragging = true;
  if (!locked()) lockPointer();
});
addEventListener('mouseup', () => { dragging = false; });
document.addEventListener('pointerlockchange', () => { $('crosshair').style.display = locked() ? 'block' : 'none'; });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- helpers ----------
const head = new THREE.Vector3();
const fwd = new THREE.Vector3();
const tmp = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const raycaster = new THREE.Raycaster();

const headPos = (out = head) => camera.getWorldPosition(out);
function headForward() {
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-6) fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  return fwd.normalize();
}
function inFrontOfHead(dist, dy) {
  headPos();
  headForward();
  return new THREE.Vector3(head.x + fwd.x * dist, head.y + dy, head.z + fwd.z * dist);
}

// simple timers that follow the render loop
let elapsed = 0;
const timers = [];
const later = (sec, fn) => timers.push({ at: elapsed + sec, fn });
function runTimers() {
  for (let i = timers.length - 1; i >= 0; i--) {
    if (timers[i].at <= elapsed) timers.splice(i, 1)[0].fn();
  }
}

// ---------- pointing and selecting ----------
const phoneInteractive = () => started && (story.state === STATES.BEDROOM_ENTERED || story.state === STATES.PHONE_HIGHLIGHTED);
function targets() {
  const list = [];
  if (phoneInteractive()) list.push(room.phone.hit);
  if (panel.mesh.visible && panelReady) list.push(panel.mesh);
  return list;
}
function cast(list) {
  const h = raycaster.intersectObjects(list, false)[0];
  return h ? { object: h.object, uv: h.uv, distance: h.distance } : null;
}
function updateMouseHit() {
  mouseHit = null;
  const list = targets();
  if (!list.length || renderer.xr.isPresenting) return;
  if (locked()) raycaster.setFromCamera(CENTER, camera);
  else if (mouseInside) raycaster.setFromCamera(mouse, camera);
  else return;
  mouseHit = cast(list);
}
function updateControllerHits() {
  const list = targets();
  for (const c of controllers) {
    c.hit = null;
    c.line.visible = c.connected && renderer.xr.isPresenting;
    if (!c.line.visible) continue;
    tmpM.identity().extractRotation(c.object.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(c.object.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tmpM);
    if (list.length) c.hit = cast(list);
    c.line.scale.z = c.hit ? c.hit.distance : 3;
  }
}
const allHits = () => [mouseHit, ...controllers.map((c) => c.hit)];

// Called on trigger press / mouse click. Returns true if something was activated.
function activate(hit) {
  if (!hit) return false;
  if (hit.object === room.phone.hit) { openPhone(); return true; }
  if (hit.object === panel.mesh) {
    const id = panel.hitTest(hit.uv);
    if (id) { onButton(id); return true; }
  }
  return false;
}

// Keeps the card readable from across the room: it grows with distance and always faces the player.
function updateInstruction() {
  if (!instruction.visible) return;
  headPos();
  room.phone.worldPosition(tmp);
  const dx = head.x - tmp.x;
  const dz = head.z - tmp.z;
  const s = clamp(Math.hypot(dx, dz) * 0.36, 0.5, 1.15);
  instruction.scale.setScalar(s);
  instruction.position.set(tmp.x, tmp.y + room.phone.beamTop + 0.02 + (CARD.h * s) / 2, tmp.z);
  instruction.rotation.set(0, Math.atan2(dx, dz), 0);
}

let phoneNear = false;
function updatePhone() {
  if (!phoneInteractive()) return;
  headPos();
  room.phone.worldPosition(tmp);
  phoneNear = Math.hypot(head.x - tmp.x, head.z - tmp.z) < PHONE_RADIUS;
  const aimed = allHits().some((h) => h && h.object === room.phone.hit);
  const on = phoneNear || aimed;
  story.setPhoneHighlighted(on);
  room.phone.setHighlighted(on);
  prompt.visible = on;
  if (on) {
    prompt.position.set(tmp.x, tmp.y + 0.24, tmp.z);
    prompt.lookAt(head);
  }
}

function updateHover() {
  let id = null;
  for (const h of allHits()) {
    if (h && h.object === panel.mesh) {
      id = panel.hitTest(h.uv);
      if (id) break;
    }
  }
  panel.setHover(id);
  const overPhone = mouseHit && mouseHit.object === room.phone.hit;
  canvas.style.cursor = !locked() && (id || overPhone) ? 'pointer' : 'default';
}

// ---------- movement ----------
const canMove = () => phoneInteractive(); // walking is paused while the message is open

function walk(ix, iz, dt) {
  headForward();
  let mx = -fwd.z * ix - fwd.x * iz;
  let mz = fwd.x * ix - fwd.z * iz;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  const dx = mx * WALK * dt;
  const dz = mz * WALK * dt;
  headPos();
  if (!room.isBlocked(head.x + dx, head.z)) { rig.position.x += dx; head.x += dx; }
  if (!room.isBlocked(head.x, head.z + dz)) rig.position.z += dz;
}

function desktopInput(dt) {
  if (levelView) {
    pitch *= Math.exp(-7 * dt);
    if (Math.abs(pitch) < 0.01) levelView = false;
  }
  rig.rotation.y = yaw;
  camera.rotation.set(pitch, 0, 0);
  const ix = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const iz = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
  if ((ix || iz) && canMove()) walk(ix, iz, dt);
}

let snapReady = true;
function snapTurn(angle) {
  const before = headPos(new THREE.Vector3());
  yaw += angle;
  rig.rotation.y = yaw;
  rig.updateMatrixWorld(true);
  const after = headPos(new THREE.Vector3());
  rig.position.x += before.x - after.x; // turn around the head, not the room origin
  rig.position.z += before.z - after.z;
}

// Left stick: walk. Right stick: snap turn.
function xrInput(dt) {
  const session = renderer.xr.getSession();
  if (!session) return;
  for (const src of session.inputSources) {
    const gp = src.gamepad;
    if (!gp || gp.axes.length < 4) continue;
    const ax = gp.axes[2];
    const ay = gp.axes[3];
    if (src.handedness === 'right') {
      if (snapReady && Math.abs(ax) > 0.7) { snapTurn(-Math.sign(ax) * SNAP); snapReady = false; }
      else if (Math.abs(ax) < 0.3) snapReady = true;
    } else if (canMove() && Math.hypot(ax, ay) > 0.15) walk(ax, ay, dt);
  }
}

// ---------- message panel animation ----------
function animatePanel(to, dur, done) {
  panelAnim = { t: 0, dur, to, done, from: { pos: panel.mesh.position.clone(), scale: panel.mesh.scale.x, opacity: panel.opacity } };
}
function stepPanel(dt) {
  if (!panelAnim) return;
  const a = panelAnim;
  a.t = Math.min(1, a.t + dt / a.dur);
  const e = 1 - Math.pow(1 - a.t, 3);
  if (a.to.pos) panel.mesh.position.lerpVectors(a.from.pos, a.to.pos, e);
  panel.mesh.scale.setScalar(lerp(a.from.scale, a.to.scale ?? a.from.scale, e));
  panel.opacity = lerp(a.from.opacity, a.to.opacity ?? a.from.opacity, e);
  if (a.t >= 1) {
    panelAnim = null;
    if (a.done) a.done();
  }
}
function facePanelFrom(pos) {
  panel.mesh.position.copy(pos);
  panel.mesh.lookAt(headPos(new THREE.Vector3()));
}

// ---------- story steps ----------
function openPhone() {
  if (!phoneInteractive() || !story.openNotification()) return;
  sfx.confirm();
  room.phone.select();
  instruction.visible = false;
  prompt.visible = false;
  phoneNear = false;
  levelView = true;
  // the panel grows out of the phone and settles in front of the player
  const target = inFrontOfHead(PANEL_DIST, -0.12);
  facePanelFrom(target);
  room.phone.worldPosition(panel.mesh.position);
  panel.mesh.scale.setScalar(0.06);
  panel.opacity = 0;
  panel.setMode('notification');
  panel.mesh.visible = true;
  panelReady = false;
  dimTarget = DIM;
  animatePanel({ pos: target, scale: 0.82, opacity: 1 }, 0.6, () => { panelReady = true; });
}

function onButton(id) {
  if (id === 'check') {
    if (!story.openMessage()) return;
    sfx.tick();
    panel.setMode('message', { onRevealDone: () => { if (story.showChoices()) panel.showButtons(); } });
    animatePanel({ scale: 1 }, 0.35);
  } else if (BRANCHES.includes(id)) {
    const choice = story.choose(id); // also saves tuesdayChoice
    if (!choice) return;
    sfx.confirm();
    panel.select(id);
    later(0.7, () => { panel.setMode('reply', { choice }); sfx.send(); });
    later(1.7, () => { panel.showReply(); sfx.receive(); });
    later(4.4, () => {
      panelReady = false;
      dimTarget = 0; // normal bedroom lighting comes back
      animatePanel({ scale: 0.94, opacity: 0 }, 0.5, () => {
        panel.mesh.visible = false;
        startTransition(choice.id);
      });
    });
  } else if (id === 'replay') {
    location.reload();
  }
}

// Branch hook: listen for 'echo:transition' or set a URL in config.js.
function startTransition(branch) {
  if (!story.startTransition()) return;
  dispatchEvent(new CustomEvent('echo:transition', { detail: { branch, tuesdayChoice: story.tuesdayChoice } }));
  const haven = branch === 'stayInHaven';
  if (haven) {
    sfx.whoosh();
    room.headset.lift(inFrontOfHead(0.22, -0.02), 1.6); // the Echo headset comes up to the player's face
    later(1.1, () => { dimTarget = 1; });
  } else {
    later(0.3, () => { dimTarget = 1; });
  }
  later(haven ? 2.3 : 1.5, () => showNextSceneCard(branch));
}

function showNextSceneCard(branch) {
  const url = NEXT_SCENE_URL[branch];
  const card = branch === 'stayInHaven'
    ? { title: 'Returning to Haven…', body: 'Next: the Star Bridge bonus challenge.' }
    : { title: 'After school…', body: 'Next: the classroom, making the welcome poster with Jamie.' };
  panel.setMode('end', { ...card, note: url ? null : 'Placeholder: this scene is not connected yet.', replay: !url });
  facePanelFrom(inFrontOfHead(PANEL_DIST, -0.1));
  panel.mesh.scale.setScalar(0.9);
  panel.opacity = 0;
  panel.mesh.visible = true;
  animatePanel({ opacity: 1 }, 0.6, () => { panelReady = true; });
  if (url) later(2.5, () => { location.href = url; });
}

// ---------- start ----------
let started = false;
function start() {
  if (started) return;
  started = true;
  sfx.unlock();
  $('start').style.display = 'none';
  $('hint').style.display = renderer.xr.isPresenting ? 'none' : 'block';
  instruction.visible = true;
  later(0.6, () => sfx.notify());
  later(14, () => { if (phoneInteractive()) sfx.notify(); }); // one gentle reminder
}
$('startDesktop').addEventListener('click', () => { start(); lockPointer(); });
renderer.xr.addEventListener('sessionstart', () => {
  start();
  if (locked()) document.exitPointerLock();
  $('hint').style.display = 'none';
});
renderer.xr.addEventListener('sessionend', () => {
  camera.position.set(0, EYE, 0);
  camera.quaternion.identity();
  pitch = 0;
  if (started) $('hint').style.display = 'block';
});

// ---------- loop ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  runTimers();
  if (renderer.xr.isPresenting) xrInput(dt);
  else desktopInput(dt);
  rig.updateMatrixWorld(true);
  updateMouseHit();
  updateControllerHits();
  updatePhone();
  updateInstruction();
  updateHover();
  room.update(elapsed, dt);
  stepPanel(dt);
  panel.update(dt);
  dimLevel += clamp(dimTarget - dimLevel, -1.8 * dt, 1.8 * dt);
  dim.material.opacity = dimLevel;
  dim.visible = dimLevel > 0.001;
  dim.position.copy(headPos());
  renderer.render(scene, camera);
});

// for debugging and automated tests
window.echo = {
  story, openPhone, press: onButton, room, camera, rig,
  setView(x, z, y, p) { rig.position.set(x, 0, z); yaw = y; pitch = p; },
  info: () => renderer.info.render,
};
