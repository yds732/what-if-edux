// ECHO Scene 1 entry (scene1.html): Monday at school. The teacher introduces Echo,
// the player walks to the front and volunteers by picking up the headset.
// Works in VR (WebXR controllers) and on desktop (WASD + mouse), like Scene 2.
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { buildClassroom } from './classroom.js';
import { PALETTE } from './bedroom.js';
import { createHoloCard, createHoloPanel, createDialoguePanel } from './holo-ui.js';
import { createStory, SCRIPT, STATES } from './scene1-story.js';
import { createSfx } from './sfx.js';
import { SCENE1_NEXT_URL } from './config.js';

const EYE = 1.6;             // desktop eye height when standing (m)
const SEATED_EYE = 1.15;     // desktop eye height while seated
const WALK = 1.5;            // walking speed (m/s)
const SNAP = Math.PI / 6;    // VR snap-turn angle
const TABLE_RADIUS = 1.5;    // how close counts as "at the front table"
const PANEL_DIST = 1.7;      // end card distance from the player

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- renderer and camera rig ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (err) { // no WebGL (e.g. a remote desktop without a graphics card): say so instead of a dead Start button
  const has = (type) => { try { return document.createElement('canvas').getContext(type) ? 'yes' : 'no'; } catch { return 'no'; } };
  $('start').innerHTML = '<h1>ECHO</h1><p>This browser could not start 3D graphics (WebGL). Open the page on a computer with a graphics card, or turn on hardware acceleration in the browser settings.</p><p id="glInfo"></p>';
  $('glInfo').textContent = `WebGL 2: ${has('webgl2')} · WebGL 1: ${has('webgl')} · ${err.message}`;
  throw err;
}
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
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 400);
camera.position.set(0, SEATED_EYE, 0);
const rig = new THREE.Group(); // move/turn this, not the camera: the headset drives the camera in VR
rig.add(camera);
scene.add(rig);

const room = buildClassroom(scene, renderer);
renderer.shadowMap.needsUpdate = true;
let yaw = room.spawn.yaw;
let pitch = 0;
rig.position.set(room.spawn.x, 0, room.spawn.z);
rig.rotation.y = yaw;

const sfx = createSfx();
const story = createStory({
  onChange(next, prev) {
    document.body.dataset.state = next;
    console.info(`[echo:scene1] ${prev} -> ${next}`);
  },
});
document.body.dataset.state = story.state;

// ---------- world-space UI ----------
// Instruction cards float above the headset, carried by its cone of light.
const CARD = { w: 1.0, h: 0.32 };
const card = (body) => {
  const c = createHoloCard({
    width: CARD.w, height: CARD.h,
    lines: [
      { text: SCRIPT.screen.title, size: 42, weight: 700, color: '#A7C7E7', spacing: 4 },
      { text: body, size: 36, italic: true },
    ],
  });
  c.visible = false;
  scene.add(c);
  return c;
};
const walkCard = card(SCRIPT.walkPrompt);
const pickupCard = card(SCRIPT.pickupPrompt);

const prompt = createHoloCard({ width: 0.3, height: 0.08, px: 600, lines: [{ text: SCRIPT.headsetPrompt, size: 60, weight: 600 }] });
prompt.visible = false;
scene.add(prompt);

const dialogue = createDialoguePanel();
dialogue.mesh.visible = false;
scene.add(dialogue.mesh);

const endPanel = createHoloPanel();
endPanel.mesh.visible = false;
scene.add(endPanel.mesh);
let endReady = false;

// A dark shell around the head fades the classroom out at the end.
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
  const grip = renderer.xr.getControllerGrip(i);
  grip.add(new THREE.Mesh(handGeo, handMat));
  rig.add(grip);
  const state = { line, hit: null, connected: false, object: c, grip };
  c.addEventListener('connected', () => { state.connected = true; });
  c.addEventListener('disconnected', () => { state.connected = false; state.hit = null; });
  // trigger: use what the ray points at; otherwise move the teacher's dialogue on
  c.addEventListener('select', () => { if (!activate(state.hit, grip)) advanceTalk(); });
  rig.add(c);
  controllers.push(state);
}

// ---------- desktop input ----------
const keys = new Set();
const mouse = new THREE.Vector2();
const CENTER = new THREE.Vector2(0, 0);
let mouseInside = false;
let mouseHit = null;
let dragging = false;
const canvas = renderer.domElement;
const locked = () => document.pointerLockElement === canvas;
const lockPointer = () => { try { canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* not available */ } };

addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (!started || e.repeat) return;
  if (e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter') {
    if (e.code === 'Space') e.preventDefault();
    if (!advanceTalk() && story.state === STATES.HEADSET_HIGHLIGHTED) pickUp(camera);
  }
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
  yaw -= e.movementX * 0.0022;
  pitch = clamp(pitch - e.movementY * 0.0022, -1.35, 1.35);
});
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !started || renderer.xr.isPresenting) return;
  updateMouseHit();
  if (activate(mouseHit, camera)) return;
  advanceTalk(); // a click anywhere also moves the dialogue on
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
function targets() {
  const list = [];
  if (story.state === STATES.HEADSET_HIGHLIGHTED) list.push(room.headset.hit);
  if (talk && dialogue.mesh.visible) list.push(dialogue.mesh);
  if (endPanel.mesh.visible && endReady) list.push(endPanel.mesh);
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

// Called on trigger press / mouse click. `holder` is what takes the headset (a VR grip or the camera).
function activate(hit, holder) {
  if (!hit) return false;
  if (hit.object === room.headset.hit) { pickUp(holder); return true; }
  if (hit.object === dialogue.mesh && dialogue.hitTest(hit.uv)) { advanceTalk(); return true; }
  if (hit.object === endPanel.mesh && endPanel.hitTest(hit.uv) === 'replay') { location.reload(); return true; }
  return false;
}

function updateHover() {
  let onContinue = false;
  let endId = null;
  for (const h of allHits()) {
    if (!h) continue;
    if (h.object === dialogue.mesh && dialogue.hitTest(h.uv)) onContinue = true;
    if (h.object === endPanel.mesh) endId = endPanel.hitTest(h.uv) || endId;
  }
  dialogue.setHover(onContinue);
  endPanel.setHover(endId);
  const overHeadset = mouseHit && mouseHit.object === room.headset.hit;
  canvas.style.cursor = !locked() && (onContinue || endId || overHeadset) ? 'pointer' : 'default';
}

// ---------- the teacher's dialogue ----------
let talk = null; // { lines, i, done }
function sayLines(lines, done) {
  talk = { lines, i: 0, done };
  dialogue.say(SCRIPT.speaker, lines[0]);
  dialogue.mesh.visible = true;
  sfx.tick();
}
// Returns true if the dialogue used the input.
function advanceTalk() {
  if (!talk) return false;
  if (!dialogue.revealed) { dialogue.finishReveal(); return true; }
  sfx.tick();
  talk.i++;
  if (talk.i < talk.lines.length) {
    dialogue.say(SCRIPT.speaker, talk.lines[talk.i]);
    return true;
  }
  const { done } = talk;
  talk = null;
  dialogue.mesh.visible = false;
  dialogue.opacity = 0;
  if (done) done();
  return true;
}
// The panel floats above the teacher, faces the player and grows with distance so it stays readable.
function updateDialogue(dt) {
  room.teacher.setSpeaking(!!talk && !dialogue.revealed);
  if (!dialogue.mesh.visible) return;
  dialogue.opacity = Math.min(1, dialogue.opacity + dt * 4);
  headPos();
  room.teacher.headPosition(tmp);
  const s = clamp(Math.hypot(head.x - tmp.x, head.z - tmp.z) * 0.3, 0.6, 1.9);
  dialogue.mesh.scale.setScalar(s);
  dialogue.mesh.position.set(tmp.x + 0.25, tmp.y + 0.2 + 0.3 * s, tmp.z + 0.2);
  dialogue.mesh.lookAt(head);
}

// ---------- the headset ----------
function updateInstruction() {
  const near = story.state === STATES.HEADSET_HIGHLIGHTED;
  const active = near || story.state === STATES.WALK_PROMPTED;
  walkCard.visible = active && !near;
  pickupCard.visible = near;
  if (!active) return;
  const c = near ? pickupCard : walkCard;
  headPos();
  room.headset.worldPosition(tmp);
  const dx = head.x - tmp.x;
  const dz = head.z - tmp.z;
  const s = clamp(Math.hypot(dx, dz) * 0.36, 0.5, 1.6);
  c.scale.setScalar(s);
  c.position.set(tmp.x, tmp.y + room.headset.beamTop + 0.02 + (CARD.h * s) / 2, tmp.z);
  c.rotation.set(0, Math.atan2(dx, dz), 0);
}

function updateHeadset() {
  if (story.state !== STATES.WALK_PROMPTED && story.state !== STATES.HEADSET_HIGHLIGHTED) return;
  headPos();
  room.headset.worldPosition(tmp);
  const near = Math.hypot(head.x - tmp.x, head.z - tmp.z) < TABLE_RADIUS;
  story.setNearTable(near);
  room.headset.setHighlighted(near);
  prompt.visible = near;
  if (near) {
    prompt.position.set(tmp.x, tmp.y + 0.36, tmp.z);
    prompt.lookAt(head);
  }
}

let hold = null; // headset moving into the player's hand
function pickUp(holder = camera) {
  if (!story.collectHeadset()) return;
  sfx.confirm();
  prompt.visible = false;
  room.headset.collect();
  const g = room.headset.group;
  holder.attach(g); // keeps its world position, then eases into the hand
  const desk = holder === camera;
  hold = {
    t: 0,
    fromP: g.position.clone(),
    fromQ: g.quaternion.clone(),
    toP: desk ? new THREE.Vector3(0.2, -0.24, -0.5) : new THREE.Vector3(0, 0.02, -0.06),
    toQ: new THREE.Quaternion().setFromEuler(desk ? new THREE.Euler(0.5, -0.35, 0) : new THREE.Euler(-0.3, 0, 0)),
  };
  later(1.0, () => sayLines(SCRIPT.thanks, startTransition));
}
function stepHold(dt) {
  if (!hold) return;
  hold.t = Math.min(1, hold.t + dt / 0.6);
  const e = 1 - Math.pow(1 - hold.t, 3);
  const g = room.headset.group;
  g.position.lerpVectors(hold.fromP, hold.toP, e);
  g.quaternion.slerpQuaternions(hold.fromQ, hold.toQ, e);
  if (hold.t >= 1) hold = null;
}

// ---------- movement ----------
const canMove = () => started && (story.state === STATES.WALK_PROMPTED || story.state === STATES.HEADSET_HIGHLIGHTED);

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

let stand = null; // desktop only: rise from the chair when the teacher asks for volunteers
function standUp() {
  if (!renderer.xr.isPresenting) stand = { t: 0, from: camera.position.y };
}
function desktopInput(dt) {
  if (stand) {
    stand.t = Math.min(1, stand.t + dt / 0.8);
    camera.position.y = stand.from + (EYE - stand.from) * (1 - Math.pow(1 - stand.t, 3));
    if (stand.t >= 1) stand = null;
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

// ---------- story steps ----------
// Hook for the next scene: listen for 'echo:transition' or set SCENE1_NEXT_URL in config.js.
function startTransition() {
  if (!story.startTransition()) return;
  dispatchEvent(new CustomEvent('echo:transition', { detail: { scene: 1, next: 'bedroom' } }));
  sfx.whoosh();
  later(0.3, () => { dimTarget = 1; });
  later(1.6, showNextSceneCard);
}

function showNextSceneCard() {
  const url = SCENE1_NEXT_URL;
  endPanel.setMode('end', { ...SCRIPT.next, note: url ? null : 'Placeholder: this scene is not connected yet.', replay: !url });
  endPanel.mesh.position.copy(inFrontOfHead(PANEL_DIST, -0.1));
  endPanel.mesh.lookAt(headPos(new THREE.Vector3()));
  endPanel.mesh.scale.setScalar(0.9);
  endPanel.opacity = 0;
  endPanel.mesh.visible = true;
  later(0.6, () => { endReady = true; });
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
  later(1.2, () => sayLines(SCRIPT.intro, () => {
    story.promptWalk();
    standUp();
    sfx.notify();
  }));
}
$('startDesktop').addEventListener('click', () => { start(); lockPointer(); });
renderer.xr.addEventListener('sessionstart', () => {
  start();
  if (locked()) document.exitPointerLock();
  $('hint').style.display = 'none';
});
renderer.xr.addEventListener('sessionend', () => {
  camera.position.set(0, story.state === STATES.SEATED ? SEATED_EYE : EYE, 0);
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
  updateHeadset();
  updateInstruction();
  updateHover();
  room.update(elapsed, dt, headPos(new THREE.Vector3()));
  stepHold(dt);
  dialogue.update(dt);
  updateDialogue(dt);
  endPanel.update(dt);
  if (endPanel.mesh.visible) endPanel.opacity = Math.min(1, endPanel.opacity + dt * 1.6);
  dimLevel += clamp(dimTarget - dimLevel, -1.8 * dt, 1.8 * dt);
  dim.material.opacity = dimLevel;
  dim.visible = dimLevel > 0.001;
  dim.position.copy(headPos());
  renderer.render(scene, camera);
});

// for debugging and automated tests
window.echo = {
  story, start, advance: advanceTalk, pickUp, room, camera, rig, dialogue,
  get talking() { return !!talk; },
  get elapsed() { return elapsed; },
  setView(x, z, y, p) { rig.position.set(x, 0, z); yaw = y; pitch = p; },
  info: () => renderer.info.render,
};
