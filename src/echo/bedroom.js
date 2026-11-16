// ECHO Scene 2: the player's bedroom in 2055. Geometry, materials and lights only.
// Look: glossy PBR surfaces lit by a generated environment map, one window light with a
// shadow map that is rendered once, and static geometry merged per material (few draw calls).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const PALETTE = { slate: 0x252c36, blueGray: 0x394452, gray: 0x707782, offWhite: 0xcbd0d5, holo: 0xa7c7e7 };
export const ROOM = { width: 4.5, length: 5, height: 3 };

const HW = ROOM.width / 2;
const HL = ROOM.length / 2;
const DESK_TOP = 0.76;
const HAZE = 0x2c3644;
const WIN = { x0: -1.0, x1: 1.5, y0: 0.95, y1: 2.45, r: 0.3 };

// ---------- small helpers ----------
function seeded(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();
const _eul = new THREE.Euler();
function compose(x, y, z, rx = 0, ry = 0, rz = 0, s = 1) {
  _pos.set(x, y, z);
  _quat.setFromEuler(_eul.set(rx, ry, rz, 'YXZ'));
  if (Array.isArray(s)) _scl.set(s[0], s[1], s[2]); else _scl.set(s, s, s);
  return new THREE.Matrix4().compose(_pos, _quat, _scl);
}

// Collects static geometry and merges it into one mesh per material.
function createBatcher() {
  const groups = new Map();
  return {
    add(geo, mat, matrix, origin) {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      g.clearGroups();
      g.applyMatrix4(origin ? origin.clone().multiply(matrix) : matrix);
      if (!groups.has(mat)) groups.set(mat, []);
      groups.get(mat).push(g);
    },
    build(parent, { shadows = true } = {}) {
      for (const [mat, list] of groups) {
        const mesh = new THREE.Mesh(mergeGeometries(list, false), mat);
        mesh.castShadow = shadows && !mat.userData.noCast;
        mesh.receiveShadow = shadows;
        parent.add(mesh);
        list.forEach((g) => g.dispose());
      }
      groups.clear();
    },
  };
}

const rbox = (w, h, d, r = 0.02, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, r);
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

// Soft rounded solid (pillows, mattress, cushions). e < 1 makes it boxier.
function superquadric(a, b, c, e1 = 0.5, e2 = 0.5, ws = 28, hs = 16) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  const p = g.attributes.position;
  const pw = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = Math.hypot(x, z);
    const cu = r > 1e-6 ? x / r : 0;
    const su = r > 1e-6 ? z / r : 0;
    p.setXYZ(i, a * pw(r, e1) * pw(cu, e2), b * pw(y, e1), c * pw(r, e1) * pw(su, e2));
  }
  g.computeVertexNormals();
  return g;
}

function displaceY(g, fn) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + fn(p.getX(i), p.getY(i), p.getZ(i)));
  g.computeVertexNormals();
  return g;
}

function roundedRect(path, x, y, w, h, r) {
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
  return path;
}

// Flat slab from a top-view outline. Shape coordinates are (x, -z); the slab's top is at y = 0.
function slab(shape, thickness, bevel = 0.008, curveSegments = 16) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -(thickness - bevel), 0);
  return g;
}

function planeM(w, h, tile) { // plane with UVs in tiles, so textures keep their real size
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile);
  return g;
}

function scaleUV(g, su, sv) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}

const profile = (pts) => pts.map(([r, y]) => new THREE.Vector2(r, y));

// ---------- textures (all drawn in code: no image files) ----------
function canvasTexture(w, h, draw, { repeat = false, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function noise(g, W, H, rnd, amount, n = 2600) {
  for (let i = 0; i < n; i++) {
    const v = rnd() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${rnd() * amount})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}

function makeTextures() {
  const rnd = seeded(2055);
  const T = {};

  // wall panels: one tile = one panel, with a soft seam
  T.wall = canvasTexture(256, 256, (g, W, H) => {
    g.fillStyle = '#d9d9d9'; g.fillRect(0, 0, W, H);
    const v = g.createLinearGradient(0, 0, W, 0);
    v.addColorStop(0, 'rgba(0,0,0,0.5)'); v.addColorStop(0.03, 'rgba(0,0,0,0.1)'); v.addColorStop(0.1, 'rgba(255,255,255,0.05)');
    v.addColorStop(0.9, 'rgba(0,0,0,0)'); v.addColorStop(0.97, 'rgba(0,0,0,0.12)'); v.addColorStop(1, 'rgba(0,0,0,0.5)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
    noise(g, W, H, rnd, 0.05);
  }, { repeat: true });

  T.floor = canvasTexture(512, 512, (g, W, H) => {
    g.fillStyle = '#cfcfcf'; g.fillRect(0, 0, W, H);
    noise(g, W, H, rnd, 0.07, 5000);
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 3; g.strokeRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1; g.strokeRect(4, 4, W - 8, H - 8);
  }, { repeat: true });

  T.fabric = canvasTexture(128, 128, (g, W, H) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 2) { g.fillStyle = `rgba(255,255,255,${0.05 + rnd() * 0.08})`; g.fillRect(0, y, W, 1); }
    for (let x = 0; x < W; x += 2) { g.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.08})`; g.fillRect(x, 0, 1, H); }
  }, { repeat: true, srgb: false });
  T.fabric.repeat.set(10, 10);

  T.rug = canvasTexture(256, 256, (g, W, H) => {
    g.fillStyle = '#3a414c'; g.fillRect(0, 0, W, H);
    noise(g, W, H, rnd, 0.18, 9000);
    g.strokeStyle = 'rgba(203,208,213,0.10)';
    for (const r of [0.86, 0.8]) { g.lineWidth = 3; g.beginPath(); g.arc(W / 2, H / 2, (W / 2) * r, 0, Math.PI * 2); g.stroke(); }
    const e = g.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.5);
    e.addColorStop(0, 'rgba(0,0,0,0)'); e.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = e; g.fillRect(0, 0, W, H);
  });

  // city facade: dark with a few lit windows
  T.city = canvasTexture(256, 256, (g, W, H) => {
    g.fillStyle = '#141a22'; g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 8) {
      const busy = rnd() < 0.18 ? 0.22 : 0.025; // most floors are dark; a few are lit
      for (let x = 0; x < W; x += 8) {
        if (rnd() < busy) { g.fillStyle = rnd() < 0.8 ? 'rgba(167,199,231,0.6)' : 'rgba(225,228,232,0.6)'; g.fillRect(x + 2, y + 3, 4, 3); }
      }
    }
    for (let x = 0; x < W; x += 64) { g.fillStyle = 'rgba(255,255,255,0.025)'; g.fillRect(x, 0, 2, H); }
  }, { repeat: true });

  T.sky = canvasTexture(1024, 512, (g, W, H) => {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0d1117'); sky.addColorStop(0.42, '#1d2530'); sky.addColorStop(0.6, '#3a4758'); sky.addColorStop(0.72, '#2f3a49'); sky.addColorStop(1, '#141a22');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) { // soft cloud bands
      const x = rnd() * W, y = H * (0.2 + rnd() * 0.4), w = 120 + rnd() * 260, h = 10 + rnd() * 26;
      const c = g.createRadialGradient(x, y, 0, x, y, w / 2);
      c.addColorStop(0, `rgba(120,138,160,${0.05 + rnd() * 0.07})`); c.addColorStop(1, 'rgba(120,138,160,0)');
      g.save(); g.translate(x, y); g.scale(1, h / (w / 2)); g.translate(-x, -y); g.fillStyle = c; g.fillRect(x - w / 2, y - w / 2, w, w); g.restore();
    }
    let x = 0; // far skyline: thin towers and spires fading into the haze
    while (x < W) {
      const w = 5 + rnd() * 16, h = 20 + rnd() * 120, base = H * 0.72;
      g.fillStyle = `rgba(30,38,48,${0.55 + rnd() * 0.3})`;
      g.fillRect(x, base - h, w, H);
      if (rnd() < 0.4) { g.beginPath(); g.moveTo(x, base - h); g.lineTo(x + w / 2, base - h - 20 - rnd() * 50); g.lineTo(x + w, base - h); g.fill(); }
      if (rnd() < 0.25) g.fillRect(x - w * 0.8, base - h * (0.5 + rnd() * 0.4), w * 2.6, 3);
      x += w + rnd() * 9;
    }
  });

  T.holo = canvasTexture(768, 432, (g, W, H) => {
    const rr = (x, y, w, h, r) => { g.beginPath(); roundedRect(g, x, y, w, h, r); };
    rr(6, 6, W - 12, H - 12, 22); g.fillStyle = 'rgba(37,44,54,0.5)'; g.fill();
    g.lineWidth = 3; g.strokeStyle = 'rgba(210,228,244,0.95)'; g.stroke();
    g.fillStyle = 'rgba(167,199,231,0.95)'; g.font = '600 24px system-ui, sans-serif'; g.fillText('TUE  15:42', 34, 52);
    g.fillStyle = 'rgba(203,208,213,0.5)';
    for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(W - 90 + i * 24, 44, 5, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = 'rgba(167,199,231,0.3)'; g.fillRect(30, 72, W - 60, 2);
    g.lineWidth = 2;
    for (let i = 0; i < 4; i++) { // side list
      g.strokeStyle = 'rgba(167,199,231,0.45)'; rr(34, 96 + i * 74, 150, 58, 12); g.stroke();
      g.fillStyle = 'rgba(167,199,231,0.25)'; g.fillRect(48, 112 + i * 74, 60 + ((i * 37) % 60), 7); g.fillRect(48, 130 + i * 74, 100 - ((i * 23) % 50), 7);
    }
    for (let k = 0; k < 7; k++) { // layered ridge plot
      g.beginPath();
      for (let i = 0; i <= 60; i++) {
        const u = i / 60, x = 220 + u * 500;
        const peak = Math.exp(-Math.pow((u - 0.42 - k * 0.02) / 0.16, 2)) * (150 - k * 14) + Math.exp(-Math.pow((u - 0.74) / 0.09, 2)) * (70 - k * 6);
        const y = 372 - k * 9 - peak * (0.85 + 0.15 * Math.sin(u * 40 + k));
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.strokeStyle = `rgba(167,199,231,${0.85 - k * 0.1})`; g.lineWidth = 1.6; g.stroke();
    }
    g.fillStyle = 'rgba(167,199,231,0.3)'; g.fillRect(220, 384, 500, 2);
    g.fillStyle = 'rgba(203,208,213,0.6)'; g.font = '500 15px system-ui, sans-serif'; g.fillText('HAVEN  ·  SESSION ENDED', 222, 110);
  });

  T.keys = canvasTexture(384, 128, (g) => {
    g.strokeStyle = 'rgba(167,199,231,0.75)'; g.lineWidth = 1.5;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 13; c++) { g.beginPath(); roundedRect(g, 10 + c * 28 + (r % 2) * 6, 10 + r * 28, 22, 22, 5); g.stroke(); }
  });

  T.halo = canvasTexture(128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.45)'); r.addColorStop(0.6, 'rgba(255,255,255,0.1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  });

  T.softRect = canvasTexture(128, 256, (g, W, H) => { // glow under the bed
    g.filter = 'blur(14px)'; g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(26, 26, W - 52, H - 52);
  });

  T.blob = canvasTexture(128, 128, (g) => { // soft contact shadow
    const r = g.createRadialGradient(64, 64, 6, 64, 64, 64);
    r.addColorStop(0, 'rgba(0,0,0,0.75)'); r.addColorStop(0.6, 'rgba(0,0,0,0.3)'); r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  });

  T.beam = canvasTexture(8, 128, (g, W, H) => {
    const v = g.createLinearGradient(0, 0, 0, H);
    v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.5, 'rgba(255,255,255,0.14)'); v.addColorStop(1, 'rgba(255,255,255,0.6)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
  });

  T.art = canvasTexture(256, 320, (g, W, H) => {
    const s = g.createLinearGradient(0, 0, 0, H);
    s.addColorStop(0, '#1b222c'); s.addColorStop(0.6, '#465467'); s.addColorStop(1, '#232b36');
    g.fillStyle = s; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(203,208,213,0.5)'; g.beginPath(); g.arc(178, 92, 20, 0, Math.PI * 2); g.fill();
    [['#2b3542', 200, 60], ['#1f2731', 235, 90], ['#161c24', 270, 50]].forEach(([col, base, amp], k) => {
      g.fillStyle = col; g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 8) g.lineTo(x, base - Math.abs(Math.sin(x * 0.021 + k * 1.7)) * amp * (0.5 + 0.5 * Math.sin(x * 0.007 + k)));
      g.lineTo(W, H); g.fill();
    });
  });

  return T;
}

// ---------- materials ----------
function makeMaterials(T) {
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const P = (o) => new THREE.MeshPhysicalMaterial(o);
  const fabric = (color, o = {}) => S({ color, roughness: 0.95, metalness: 0, bumpMap: T.fabric, bumpScale: 0.6, envMapIntensity: 0.5, ...o });
  const M = {
    wall: S({ color: 0x4d596a, roughness: 0.72, metalness: 0.05, map: T.wall, bumpMap: T.wall, bumpScale: 0.8 }),
    floor: S({ color: 0x2b323c, roughness: 0.3, metalness: 0.1, map: T.floor, envMapIntensity: 1.1 }),
    ceiling: S({ color: 0x39424e, roughness: 0.9 }),
    metal: S({ color: 0x5a626e, roughness: 0.28, metalness: 0.9 }),
    darkMetal: S({ color: 0x1e232a, roughness: 0.35, metalness: 0.85 }),
    gloss: P({ color: 0x2b313a, roughness: 0.16, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.4 }),
    satin: P({ color: 0x343b45, roughness: 0.38, metalness: 0.15, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
    body: S({ color: 0x3a424d, roughness: 0.45, metalness: 0.3 }),
    black: S({ color: 0x14181d, roughness: 0.2, metalness: 0.4, envMapIntensity: 1.5 }),
    pale: S({ color: PALETTE.offWhite, roughness: 0.35, metalness: 0.05 }),
    fabricDark: fabric(0x262c35),
    fabricMid: fabric(0x4a5361),
    sheet: fabric(0x6a7483),
    pillow: fabric(0x8b95a3),
    rug: S({ color: 0xffffff, map: T.rug, roughness: 1, envMapIntensity: 0.2 }),
    plant: S({ color: 0x3a5246, roughness: 0.6, envMapIntensity: 0.8 }),
    glass: S({ color: 0xcfe0f2, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.22, envMapIntensity: 2.5, depthWrite: false }),
    books: [0x2a313b, 0x4a5462, 0x707782, 0x9aa1ab, 0x39485c, 0x5b5560].map((c) => S({ color: c, roughness: 0.75 })),
    lampShade: S({ color: 0xdedbd3, roughness: 0.5, emissive: 0xd9d4ca, emissiveIntensity: 0.35 }),
    lampCore: new THREE.MeshBasicMaterial({ color: 0xfff6e6, toneMapped: false }),
    ceilingDisc: new THREE.MeshBasicMaterial({ color: 0x39424e }),
    holo: new THREE.MeshBasicMaterial({ color: PALETTE.holo, transparent: true, opacity: 0.8, toneMapped: false }),
    holoSolid: new THREE.MeshBasicMaterial({ color: PALETTE.holo, toneMapped: false }),
  };
  [M.lampShade, M.lampCore, M.ceilingDisc, M.holo, M.holoSolid, M.glass, M.rug].forEach((m) => { m.userData.noCast = true; });
  return M;
}

// A tiny stand-in room used only to make reflections: dark box with the window, lamp and screen as light panels.
function makeEnvironment(renderer) {
  const env = new THREE.Scene();
  const hdr = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), side: THREE.DoubleSide });
  env.add(new THREE.Mesh(new THREE.BoxGeometry(4.5, 3, 5), new THREE.MeshBasicMaterial({ color: 0x0a0d12, side: THREE.BackSide })));
  const panel = (w, h, mat, x, y, z, ry = 0, rx = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y - 1.2, z); m.rotation.set(rx, ry, 0); env.add(m);
  };
  panel(2.5, 1.5, hdr(2.2, 2.8, 3.8), 0.25, 1.7, -2.45);              // window
  panel(0.5, 0.3, hdr(7, 6.4, 5.4), -0.82, 0.75, -2.2);               // bedside lamp
  panel(0.9, 0.5, hdr(1.6, 2.4, 3.4), 2.0, 1.3, -1.05, -Math.PI / 2); // holo display
  panel(3.5, 4, hdr(0.1, 0.12, 0.15), 0, 2.95, 0, 0, Math.PI / 2);    // ceiling
  panel(4.5, 5, hdr(0.03, 0.035, 0.045), 0, 0.02, 0, 0, -Math.PI / 2); // floor
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.03).texture;
  pmrem.dispose();
  return tex;
}

// ---------- city outside the window ----------
function buildCity(root, T) {
  const rnd = seeded(77);
  const city = createBatcher();
  const facade = new THREE.MeshBasicMaterial({ map: T.city });
  const hull = new THREE.MeshBasicMaterial({ color: 0x1a2129 });
  const lights = new THREE.MeshBasicMaterial({ color: 0xbfd6ee, toneMapped: false });

  const sky = new THREE.Mesh(new THREE.PlaneGeometry(560, 280), new THREE.MeshBasicMaterial({ map: T.sky, fog: false, toneMapped: false }));
  sky.position.set(0, 18, -190);
  root.add(sky);

  function spire(x, top, z, R, H) {
    const k1 = 1.4 + rnd() * 1.2, k2 = 1.1 + rnd() * 0.9;
    const pts = [[R, 0], [R * 0.92, 0.42], [R * k1, 0.43], [R * k1, 0.445], [R * 0.78, 0.46], [R * 0.62, 0.7], [R * k2, 0.71], [R * k2, 0.722], [R * 0.42, 0.735], [R * 0.16, 0.9], [R * 0.03, 1]]
      .map(([r, t]) => new THREE.Vector2(r, t * H));
    const g = scaleUV(new THREE.LatheGeometry(pts, 14), Math.max(1, Math.round((R * 6.3) / 20)), H / 20);
    city.add(g, facade, compose(x, top - H, z));
    for (const [k, t] of [[k1, 0.437], [k2, 0.716]]) city.add(new THREE.TorusGeometry(R * k, R * 0.03, 4, 28), lights, compose(x, top - H + t * H, z, Math.PI / 2));
    city.add(new THREE.SphereGeometry(R * 0.06, 6, 4), lights, compose(x, top, z));
  }
  function block(x, top, z, w, d, H) {
    const g = scaleUV(new THREE.BoxGeometry(w, H, d), Math.max(1, Math.round(w / 20)), H / 20);
    city.add(g, facade, compose(x, top - H / 2, z, 0, rnd() * 0.6));
  }
  // mid-distance towers (the room is high up, so they run far below the window)
  for (let i = 0; i < 22; i++) {
    const z = -42 - rnd() * 85, x = (rnd() - 0.5) * (50 + -z * 0.9), top = -14 + rnd() * 52;
    if (rnd() < 0.72) spire(x, top, z, 2.2 + rnd() * 3.6, 150); else block(x, top - 10, z - 25, 6 + rnd() * 7, 6 + rnd() * 7, 150);
  }
  spire(-7.5, 24, -36, 3.4, 150);
  spire(11, 9, -30, 2.4, 150);

  // floating platforms
  const saucers = [];
  for (const [x, y, z, r] of [[3.2, 6.5, -44, 5.5], [-15, 2.5, -62, 8], [19, 15, -80, 10], [-3, 21, -96, 9]]) {
    const b = createBatcher();
    const pts = [[0.02, -0.5], [0.07, -0.18], [0.5, -0.08], [1, -0.01], [1, 0.02], [0.55, 0.07], [0.14, 0.13], [0.05, 0.45], [0.012, 0.9]].map(([a, h]) => new THREE.Vector2(a * r, h * r));
    b.add(new THREE.LatheGeometry(pts, 24), hull, compose(0, 0, 0));
    b.add(new THREE.TorusGeometry(r * 1.0, r * 0.012, 4, 40), lights, compose(0, 0.005 * r, 0, Math.PI / 2));
    b.add(new THREE.TorusGeometry(r * 0.52, r * 0.01, 4, 32), lights, compose(0, -0.075 * r, 0, Math.PI / 2));
    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    b.build(grp, { shadows: false });
    root.add(grp);
    saucers.push({ grp, y, phase: rnd() * 6 });
  }
  city.build(root, { shadows: false });

  // a few slow lights crossing the sky
  const N = 9;
  const traffic = new Float32Array(N * 3);
  const lanes = [];
  for (let i = 0; i < N; i++) lanes.push({ y: -6 + rnd() * 34, z: -40 - rnd() * 60, speed: (rnd() < 0.5 ? -1 : 1) * (1.5 + rnd() * 3), x: (rnd() - 0.5) * 120 });
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(traffic, 3));
  const points = new THREE.Points(tg, new THREE.PointsMaterial({ color: 0xd6e4f2, size: 2.2, sizeAttenuation: false, toneMapped: false }));
  points.frustumCulled = false;
  root.add(points);

  return (t, dt) => {
    for (const s of saucers) s.grp.position.y = s.y + Math.sin(t * 0.25 + s.phase) * 0.35;
    lanes.forEach((l, i) => {
      l.x += l.speed * dt;
      if (l.x > 70) l.x = -70; else if (l.x < -70) l.x = 70;
      traffic[i * 3] = l.x; traffic[i * 3 + 1] = l.y; traffic[i * 3 + 2] = l.z;
    });
    tg.attributes.position.needsUpdate = true;
  };
}

// ---------- scene ----------
export function buildBedroom(scene, renderer) {
  const root = new THREE.Group();
  root.name = 'bedroom';
  scene.add(root);
  scene.fog = new THREE.FogExp2(HAZE, 0.014);
  scene.background = new THREE.Color(HAZE);
  scene.environment = makeEnvironment(renderer);

  const T = makeTextures();
  const M = makeMaterials(T);
  const rnd = seeded(13);
  const solid = createBatcher();
  let origin = null;
  const at = (x, y, z, ry = 0) => { origin = compose(x, y, z, 0, ry, 0); };
  const put = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) => solid.add(geo, mat, compose(x, y, z, rx, ry, rz, s), origin);
  const box = (mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => put(UNIT_BOX, mat, x, y, z, rx, ry, rz, [w, h, d]);
  const loose = (mesh, x, y, z) => { mesh.position.set(x, y, z); root.add(mesh); return mesh; };
  const glow = (color, size, opacity, x, y, z) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.halo, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
    s.scale.setScalar(size);
    return loose(s, x, y, z);
  };
  const decal = (map, w, d, opacity, x, z, { color = 0xffffff, additive = false, y = 0.004 } = {}) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity, depthWrite: false, toneMapped: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    m.rotation.x = -Math.PI / 2;
    return loose(m, x, y, z);
  };

  // ===== shell =====
  at(0, 0, 0);
  put(planeM(ROOM.width, ROOM.length, 1.25), M.floor, 0, 0, 0, -Math.PI / 2);
  put(new THREE.PlaneGeometry(ROOM.width, ROOM.length), M.ceiling, 0, ROOM.height, 0, Math.PI / 2);
  put(planeM(ROOM.length, ROOM.height, 0.9), M.wall, -HW, ROOM.height / 2, 0, 0, Math.PI / 2);
  put(planeM(ROOM.length, ROOM.height, 0.9), M.wall, HW, ROOM.height / 2, 0, 0, -Math.PI / 2);
  put(planeM(ROOM.width, ROOM.height, 0.9), M.wall, 0, ROOM.height / 2, HL, 0, Math.PI);

  // back wall with a rounded window opening
  const winW = WIN.x1 - WIN.x0, winH = WIN.y1 - WIN.y0;
  const wallShape = new THREE.Shape().moveTo(-HW, 0).lineTo(HW, 0).lineTo(HW, ROOM.height).lineTo(-HW, ROOM.height).lineTo(-HW, 0);
  wallShape.holes.push(roundedRect(new THREE.Path(), WIN.x0, WIN.y0, winW, winH, WIN.r));
  put(scaleUV(new THREE.ShapeGeometry(wallShape, 12), 1 / 0.9, 1 / 0.9), M.wall, 0, 0, -HL);
  const f = 0.07;
  const frameShape = roundedRect(new THREE.Shape(), WIN.x0 - f, WIN.y0 - f, winW + 2 * f, winH + 2 * f, WIN.r + f);
  frameShape.holes.push(roundedRect(new THREE.Path(), WIN.x0 + 0.01, WIN.y0 + 0.01, winW - 0.02, winH - 0.02, WIN.r - 0.01));
  put(new THREE.ExtrudeGeometry(frameShape, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 12 }), M.darkMetal, 0, 0, -HL - 0.14);
  box(M.darkMetal, 0.045, winH, 0.08, (WIN.x0 + WIN.x1) / 2, (WIN.y0 + WIN.y1) / 2, -HL - 0.03);
  const glass = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(new THREE.Shape(), WIN.x0, WIN.y0, winW, winH, WIN.r), 12), M.glass.clone());
  glass.material.opacity = 0.1;
  loose(glass, 0, 0, -HL - 0.05);

  // door and wardrobe on the wall behind the player
  put(rbox(0.95, 2.12, 0.05, 0.02), M.body, -1.25, 1.06, HL - 0.02);
  box(M.holoSolid, 0.012, 0.09, 0.01, -0.86, 1.05, HL - 0.05);
  put(rbox(1.9, 2.5, 0.08, 0.03), M.body, 1.2, 1.25, HL - 0.03);
  box(M.darkMetal, 0.006, 2.4, 0.01, 1.2, 1.25, HL - 0.075);
  put(new THREE.CircleGeometry(0.4, 40), M.ceilingDisc, 0, ROOM.height - 0.003, 0.2, Math.PI / 2);

  // rug
  put(new THREE.CircleGeometry(1.05, 56), M.rug, -0.15, 0.006, 0.15, -Math.PI / 2);

  // ===== bed (head against the back wall, along the left wall) =====
  at(-1.68, 0, -1.4);
  put(rbox(0.86, 0.13, 1.8, 0.02), M.darkMetal, 0, 0.065, 0);                                   // recessed plinth: the bed appears to float
  put(slab(roundedRect(new THREE.Shape(), -0.57, -1.05, 1.14, 2.1, 0.12), 0.17, 0.02), M.gloss, 0, 0.3, 0);
  box(M.holoSolid, 0.006, 0.006, 1.7, 0.44, 0.128, 0);                                           // single light line under the frame
  put(superquadric(0.51, 0.105, 0.98, 0.45, 0.22, 36, 18), M.sheet, 0, 0.385, 0.02);             // mattress
  put(displaceY(superquadric(0.545, 0.075, 0.7, 0.6, 0.3, 48, 20), (x, y, z) => (y > 0 ? 0.012 * Math.sin(x * 17 + z * 5) * Math.sin(z * 11 - x * 3) + 0.008 * Math.sin(z * 23 + x * 9) : 0)), M.fabricMid, 0.005, 0.475, 0.3);
  put(displaceY(superquadric(0.56, 0.05, 0.3, 0.6, 0.32, 40, 16), (x, y, z) => (y > 0 ? 0.008 * Math.sin(x * 21) * Math.sin(z * 26) : 0)), M.fabricDark, 0.0, 0.515, 0.7, 0, 0.04); // folded throw
  put(superquadric(0.31, 0.08, 0.2, 0.85, 0.42, 32, 16), M.pillow, -0.03, 0.52, -0.72, 0.1, -0.07); // pillow
  put(rbox(1.2, 1.02, 0.13, 0.055, 4), M.fabricDark, 0, 0.62, -1.03);                             // upholstered headboard
  put(rbox(1.24, 0.05, 0.16, 0.02), M.satin, 0, 1.14, -1.03);
  put(rbox(0.09, 0.62, 1.0, 0.04, 4), M.fabricDark, -0.52, 0.6, -0.5);                            // side wing along the wall
  box(M.holoSolid, 0.05, 0.012, 0.004, 0.42, 0.9, -0.962);                                        // touch control
  decal(T.softRect, 1.7, 2.7, 0.2, -1.62, -1.38, { color: PALETTE.holo, additive: true });
  decal(T.blob, 1.5, 2.5, 0.8, -1.68, -1.4, { y: 0.003 });

  // nightstand (floating) and lamp
  at(-0.8, 0, -2.26);
  put(rbox(0.52, 0.2, 0.4, 0.03), M.gloss, 0, 0.42, 0);
  box(M.darkMetal, 0.44, 0.004, 0.01, 0, 0.42, 0.2);
  put(new THREE.LatheGeometry(profile([[0.075, 0], [0.07, 0.012], [0.02, 0.03], [0.012, 0.1], [0.012, 0.2]]), 24), M.metal, -0.08, 0.52, 0);
  put(new THREE.LatheGeometry(profile([[0.135, -0.004], [0.145, 0], [0.135, 0.035], [0.1, 0.075], [0.05, 0.095], [0.0, 0.1]]), 32), M.lampShade, -0.08, 0.72, 0);
  put(new THREE.CircleGeometry(0.13, 32), M.lampCore, -0.08, 0.718, 0, Math.PI / 2);
  put(new THREE.CylinderGeometry(0.032, 0.028, 0.075, 20), M.pale, 0.13, 0.5575, 0.06);
  put(rbox(0.1, 0.012, 0.15, 0.005), M.black, 0.12, 0.526, -0.1, 0, 0.3);
  glow(0xfff0dc, 0.75, 0.42, -0.88, 0.7, -2.24);
  decal(T.blob, 0.7, 0.55, 0.5, -0.8, -2.26, { y: 0.003 });

  // shelf above the bed: books and a trailing plant.
  // Local axes for wall shelves: x runs along the wall, z comes out of the wall into the room.
  at(-HW, 1.6, -1.4, Math.PI / 2);
  put(rbox(1.5, 0.035, 0.24, 0.012), M.gloss, 0, 0, 0.12);
  const bookRow = (x0, n, yBase, zc) => {
    let x = x0;
    for (let i = 0; i < n; i++) {
      const t = 0.022 + rnd() * 0.03, h = 0.18 + rnd() * 0.1, d = 0.13 + rnd() * 0.05;
      const lean = i === n - 1 ? 0.22 : 0;
      box(M.books[Math.floor(rnd() * M.books.length)], t, h, d, x + t / 2 + (lean ? 0.03 : 0), yBase + h / 2 - (lean ? 0.004 : 0), zc, 0, 0, -lean);
      x += t + 0.002;
    }
    return x;
  };
  bookRow(-0.1, 9, 0.018, 0.12);
  put(rbox(0.16, 0.1, 0.12, 0.015), M.body, -0.32, 0.068, 0.12);
  put(new THREE.LatheGeometry(profile([[0.0, 0], [0.05, 0], [0.068, 0.02], [0.072, 0.1], [0.064, 0.105], [0.06, 0.09], [0.0, 0.09]]), 20), M.pale, 0.55, 0.018, 0.12); // plant pot
  const leaf = superquadric(1, 0.16, 0.62, 1, 1, 8, 5);
  for (let i = 0; i < 9; i++) { // upright leaves
    const a = rnd() * Math.PI * 2, tilt = 0.5 + rnd() * 0.6;
    put(leaf, M.plant, 0.55 + Math.cos(a) * 0.04, 0.16 + rnd() * 0.05, 0.12 + Math.sin(a) * 0.04, 0, a, tilt, 0.04 + rnd() * 0.02);
  }
  for (let v = 0; v < 6; v++) { // trailing vines
    const a = -0.4 + v * 0.55 + rnd() * 0.3, L = 0.35 + rnd() * 0.5, pts = [];
    for (let k = 0; k <= 8; k++) {
      const u = k / 8, out = 0.07 + 0.09 * Math.min(1, u * 3);
      pts.push(new THREE.Vector3(0.55 + Math.cos(a) * out + Math.sin(u * 5 + v) * 0.015, 0.125 + 0.03 * Math.sin(Math.min(1, u * 3) * Math.PI) - L * Math.pow(Math.max(0, u - 0.15), 1.3), 0.12 + Math.abs(Math.sin(a)) * out * 0.9 + 0.02));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    put(new THREE.TubeGeometry(curve, 16, 0.0028, 4), M.plant);
    for (let k = 1; k <= 11; k++) {
      const p = curve.getPoint(k / 11);
      put(leaf, M.plant, p.x + (rnd() - 0.5) * 0.03, p.y, p.z + (rnd() - 0.5) * 0.03, rnd() * 1.2 - 0.6, rnd() * 6.3, 0.9 + rnd() * 0.8, 0.026 + rnd() * 0.018);
    }
  }

  // ===== desk: one curved top running along the right wall and under the window =====
  at(0, 0, 0);
  const deskShape = new THREE.Shape();
  deskShape.moveTo(HW, -0.2); deskShape.lineTo(HW, HL); deskShape.lineTo(0.2, HL);
  deskShape.quadraticCurveTo(0.2, 1.9, 0.62, 1.9); deskShape.lineTo(1.0, 1.9);
  deskShape.quadraticCurveTo(1.55, 1.9, 1.55, 1.35); deskShape.lineTo(1.55, 0.15);
  deskShape.quadraticCurveTo(1.55, -0.2, 1.9, -0.2); deskShape.lineTo(HW, -0.2);
  put(slab(deskShape, 0.05, 0.012, 20), M.gloss, 0, DESK_TOP, 0);
  put(rbox(0.5, 0.2, 0.9, 0.03), M.body, 1.97, DESK_TOP - 0.16, -0.75);            // drawer unit hanging under the top
  box(M.darkMetal, 0.004, 0.006, 0.8, 1.719, DESK_TOP - 0.16, -0.75);
  put(rbox(0.07, DESK_TOP - 0.05, 0.5, 0.03), M.satin, 1.82, (DESK_TOP - 0.05) / 2, 0.02, 0, 0.5); // sculpted leg at the end
  put(rbox(0.07, DESK_TOP - 0.05, 0.42, 0.03), M.satin, 0.42, (DESK_TOP - 0.05) / 2, -2.22, 0, 0.25);
  put(rbox(0.5, DESK_TOP - 0.05, 0.5, 0.05), M.body, 1.98, (DESK_TOP - 0.05) / 2, -2.22);
  decal(T.blob, 1.4, 3.4, 0.6, 1.95, -1.1, { y: 0.003 });
  decal(T.blob, 2.6, 1.3, 0.5, 1.2, -2.2, { y: 0.0035 });

  // desk objects
  const top = DESK_TOP;
  put(rbox(0.3, 0.008, 0.11, 0.004), M.black, 1.74, top + 0.004, -1.05, 0, Math.PI / 2);                  // glass keyboard
  put(new THREE.CylinderGeometry(0.045, 0.042, 0.1, 24, 1, true), M.darkMetal, 2.06, top + 0.05, -0.52);  // pen cup
  put(new THREE.CircleGeometry(0.043, 24), M.darkMetal, 2.06, top + 0.002, -0.52, -Math.PI / 2);
  for (let i = 0; i < 4; i++) put(new THREE.CylinderGeometry(0.004, 0.004, 0.15, 6), i % 2 ? M.pale : M.metal, 2.06 + (rnd() - 0.5) * 0.04, top + 0.085, -0.52 + (rnd() - 0.5) * 0.04, (rnd() - 0.5) * 0.4, 0, (rnd() - 0.5) * 0.4);
  box(M.books[1], 0.2, 0.03, 0.27, 2.03, top + 0.015, 0.0, 0, 0.12);                                      // stacked books
  box(M.books[3], 0.19, 0.025, 0.26, 2.03, top + 0.0425, 0.0, 0, -0.1);
  box(M.books[0], 0.17, 0.03, 0.24, 2.02, top + 0.07, 0.01, 0, 0.3);
  put(new THREE.CylinderGeometry(0.03, 0.03, 0.07, 20), M.pale, 1.72, top + 0.035, -1.72);                // small speaker
  put(new THREE.CylinderGeometry(0.031, 0.031, 0.006, 20), M.darkMetal, 1.72, top + 0.073, -1.72);
  put(new THREE.CylinderGeometry(0.036, 0.03, 0.085, 20), M.pale, 0.55, top + 0.0425, -2.25);             // mug
  put(rbox(0.26, 0.008, 0.19, 0.004), M.black, 0.85, top + 0.004, -2.2, 0, 0.2);                          // tablet
  // snow globe in the corner
  put(new THREE.CylinderGeometry(0.075, 0.085, 0.045, 28), M.black, 2.0, top + 0.0225, -2.18);
  put(superquadric(0.05, 0.022, 0.05, 1, 1, 12, 6), M.pale, 2.0, top + 0.06, -2.18);
  loose(new THREE.Mesh(new THREE.SphereGeometry(0.095, 32, 20), M.glass), 2.0, top + 0.125, -2.18);

  // ===== chair: one moulded shell on a pedestal =====
  at(0.98, 0, -1.05, Math.PI / 2 - 0.35);
  const line = new THREE.SplineCurve(profile([[0.26, 0.43], [0.2, 0.455], [0.02, 0.45], [-0.16, 0.455], [-0.235, 0.52], [-0.27, 0.72], [-0.3, 0.96]])).getPoints(28);
  const up = [], down = [];
  line.forEach((p, i) => {
    const q = line[Math.min(i + 1, line.length - 1)], o = line[Math.max(i - 1, 0)];
    const n = new THREE.Vector2(-(q.y - o.y), q.x - o.x).normalize().multiplyScalar(0.02);
    up.push(new THREE.Vector2(p.x + n.x, p.y + n.y)); down.push(new THREE.Vector2(p.x - n.x, p.y - n.y));
  });
  const shell = new THREE.ExtrudeGeometry(new THREE.Shape([...up, ...down.reverse()]), { depth: 0.42, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.016, bevelSegments: 4, curveSegments: 4 });
  shell.translate(0, 0, -0.21);
  shell.rotateY(-Math.PI / 2);
  put(shell, M.satin);
  put(superquadric(0.2, 0.022, 0.2, 0.7, 0.4, 24, 10), M.fabricDark, 0, 0.475, 0.03);
  put(new THREE.LatheGeometry(profile([[0.3, 0], [0.3, 0.012], [0.12, 0.03], [0.035, 0.06], [0.028, 0.36], [0.06, 0.42], [0.12, 0.435]]), 32), M.darkMetal, 0, 0, 0.02);
  decal(T.blob, 0.9, 0.9, 0.75, 0.98, -1.05, { y: 0.0075 });

  // ===== shelves over the desk =====
  for (const [y, z0, z1] of [[1.86, -2.15, 0.05], [2.26, -1.75, 0.05]]) {
    at(HW, y, (z0 + z1) / 2, -Math.PI / 2);
    const len = z1 - z0;
    put(rbox(len, 0.035, 0.26, 0.012), M.gloss, 0, 0, 0.13);
    if (y < 2) {
      const end = bookRow(-len / 2 + 0.1, 11, 0.018, 0.13);
      put(new THREE.CylinderGeometry(0.05, 0.06, 0.03, 24), M.black, end + 0.22, 0.033, 0.13);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.085, 32, 20), M.glass);
      orb.position.set(end + 0.22, 0.13, 0.13).applyMatrix4(origin);
      root.add(orb);
      bookRow(end + 0.5, 6, 0.018, 0.13);
      put(rbox(0.2, 0.12, 0.16, 0.015), M.body, len / 2 - 0.2, 0.078, 0.13);
    } else {
      put(rbox(0.26, 0.15, 0.18, 0.02), M.body, -len / 2 + 0.22, 0.093, 0.13);
      bookRow(-len / 2 + 0.5, 8, 0.018, 0.13);
      box(M.books[2], 0.24, 0.03, 0.17, len / 2 - 0.3, 0.033, 0.13, 0, 0.1);
      box(M.books[4], 0.22, 0.028, 0.16, len / 2 - 0.3, 0.062, 0.13, 0, -0.2);
      put(new THREE.LatheGeometry(profile([[0, 0], [0.03, 0], [0.045, 0.05], [0.03, 0.12], [0.012, 0.15], [0.016, 0.17]]), 20), M.pale, len / 2 - 0.3, 0.076, 0.13);
    }
  }
  // framed picture
  at(HW, 1.45, 0.95, -Math.PI / 2);
  put(rbox(0.52, 0.66, 0.03, 0.01), M.darkMetal, 0, 0, 0.015);
  const art = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.58), new THREE.MeshStandardMaterial({ map: T.art, roughness: 0.25, envMapIntensity: 1.2 }));
  art.position.set(0, 0, 0.032).applyMatrix4(origin);
  art.rotation.y = -Math.PI / 2;
  root.add(art);

  solid.build(root);

  // ===== lights =====
  root.add(new THREE.HemisphereLight(0x8ea4c4, 0x2c333d, 1.7));
  const windowLight = new THREE.DirectionalLight(0x9fb6d8, 1.6);
  windowLight.position.set(-0.5, 5.2, -6.6);
  windowLight.target.position.set(0.15, 0, -0.4);
  windowLight.castShadow = true;
  windowLight.shadow.mapSize.set(2048, 2048);
  Object.assign(windowLight.shadow.camera, { left: -4.5, right: 4.5, top: 4.5, bottom: -4.5, near: 1, far: 16 });
  windowLight.shadow.bias = -0.0004;
  windowLight.shadow.normalBias = 0.015;
  root.add(windowLight, windowLight.target);
  const lampLight = new THREE.PointLight(0xf0e2cc, 1.1, 4.5, 2);
  lampLight.position.set(-0.88, 0.66, -2.2);
  root.add(lampLight);
  const holoLight = new THREE.PointLight(PALETTE.holo, 1.5, 3, 2);
  holoLight.position.set(1.7, 1.25, -1.05);
  root.add(holoLight);

  // ===== holographic display (curved, floating over the desk) =====
  T.holo.wrapS = THREE.RepeatWrapping; T.holo.repeat.x = -1; T.holo.offset.x = 1; // seen from inside the curve
  const screenMat = new THREE.MeshBasicMaterial({ map: T.holo, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, fog: false });
  const R = 1.25, arc = 0.8;
  const screen = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.54, 24, 1, true, Math.PI / 2 - arc / 2, arc), screenMat);
  loose(screen, 2.04 - R, 1.31, -1.05);
  loose(new THREE.Mesh(rbox(0.035, 0.014, 0.6, 0.005), M.holoSolid), 2.1, top + 0.007, -1.05);
  const keys = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.095), new THREE.MeshBasicMaterial({ map: T.keys, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }));
  keys.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
  loose(keys, 1.74, top + 0.0085, -1.05);
  glow(PALETTE.holo, 1.5, 0.16, 1.95, 1.3, -1.05);

  // ===== Echo headset (stand-in model: there is no Scene 1 model in this repo yet) =====
  const headset = new THREE.Group();
  headset.position.set(1.2, top, -2.18);
  headset.rotation.y = 0.5;
  root.add(headset);
  const hsBody = new THREE.Mesh(superquadric(0.1, 0.048, 0.055, 0.45, 0.35, 28, 14), M.satin);
  hsBody.position.y = 0.05; hsBody.castShadow = true;
  const visor = new THREE.Mesh(superquadric(0.094, 0.036, 0.02, 0.5, 0.35, 28, 12), M.black);
  visor.position.set(0, 0.052, 0.045);
  const visorLight = new THREE.Mesh(rbox(0.11, 0.006, 0.004, 0.002, 1), M.holoSolid);
  visorLight.position.set(0, 0.03, 0.064);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.098, 0.011, 8, 28, Math.PI), M.fabricDark);
  strap.position.set(0, 0.05, -0.03); strap.rotation.x = -Math.PI / 2;
  headset.add(hsBody, visor, visorLight, strap);
  const lift = { on: false, t: 0, dur: 1, from: new THREE.Vector3(), to: new THREE.Vector3() };

  // ===== phone on its charging pad =====
  const phone = new THREE.Group();
  phone.position.set(1.8, top, -0.3);
  phone.rotation.y = 0.45;
  root.add(phone);
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.125, 0.008, 40), M.black);
  pad.position.y = 0.004; pad.receiveShadow = true;
  const padRing = new THREE.Mesh(new THREE.RingGeometry(0.108, 0.113, 48), M.holo.clone());
  padRing.rotation.x = -Math.PI / 2; padRing.position.y = 0.0086;
  const phoneMat = new THREE.MeshPhysicalMaterial({ color: 0x20252c, roughness: 0.18, metalness: 0.7, clearcoat: 1, clearcoatRoughness: 0.1, emissive: PALETTE.holo, emissiveIntensity: 0 });
  const phoneGeo = rbox(0.076, 0.009, 0.156, 0.0044, 4);
  const bodyMesh = new THREE.Mesh(phoneGeo, phoneMat);
  bodyMesh.position.y = 0.0135; bodyMesh.castShadow = true;
  const edge = new THREE.Mesh(rbox(0.079, 0.004, 0.159, 0.002, 2), M.holo.clone()); // lit rim
  edge.position.y = 0.0135;
  const symbolMat = new THREE.MeshBasicMaterial({ color: PALETTE.holo, transparent: true, opacity: 0.5, toneMapped: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.012, 0.0155, 36), symbolMat);
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.0183;
  const outlineMat = new THREE.MeshBasicMaterial({ color: PALETTE.holo, side: THREE.BackSide, transparent: true, opacity: 0.9, toneMapped: false });
  const outline = new THREE.Mesh(phoneGeo, outlineMat);
  outline.position.y = 0.0135; outline.scale.set(1.16, 1.9, 1.08); outline.visible = false;
  const haloMat = new THREE.MeshBasicMaterial({ map: T.halo, color: PALETTE.holo, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), haloMat);
  halo.rotation.x = -Math.PI / 2; halo.position.y = 0.0095;
  // cone of light that carries the notification card above the phone
  const BEAM_H = 0.5;
  const beamMat = new THREE.MeshBasicMaterial({ map: T.beam, color: PALETTE.holo, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.03, BEAM_H, 32, 1, true), beamMat);
  beam.position.y = 0.02 + BEAM_H / 2;
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.36), new THREE.MeshBasicMaterial({ visible: false })); // generous target
  hit.position.y = 0.09; hit.name = 'phone';
  phone.add(pad, padRing, bodyMesh, edge, ring, outline, halo, beam, hit);
  const ph = { highlighted: false, selected: false, flash: -1 };

  const updateCity = buildCity(root, T);

  // ===== collisions (x/z rectangles) =====
  const colliders = [
    { minX: -HW, maxX: -1.08, minZ: -HL, maxZ: -0.3 },    // bed
    { minX: -1.1, maxX: -0.5, minZ: -HL, maxZ: -2.02 },   // nightstand
    { minX: 1.5, maxX: HW, minZ: -HL, maxZ: 0.28 },       // desk, right wall
    { minX: 0.15, maxX: HW, minZ: -HL, maxZ: -1.85 },     // desk, under the window
    { minX: 0.72, maxX: 1.3, minZ: -1.35, maxZ: -0.78 },  // chair
    { minX: 0.2, maxX: HW, minZ: 2.3, maxZ: HL },         // wardrobe
  ];

  // spawn: near the door, looking towards the desk with the bed on the left
  const spawn = { x: -0.3, z: 1.8 };
  spawn.yaw = Math.atan2(-(0.75 - spawn.x), -(-1.4 - spawn.z));

  return {
    root,
    spawn,
    isBlocked(x, z, r = 0.25) {
      if (x < -HW + r || x > HW - r || z < -HL + r || z > HL - r) return true;
      return colliders.some((c) => x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r);
    },
    phone: {
      hit,
      beamTop: 0.02 + BEAM_H, // height above the desk where the notification card sits
      worldPosition: (out) => phone.getWorldPosition(out),
      setHighlighted(on) { ph.highlighted = on; },
      select() { ph.selected = true; ph.highlighted = false; ph.flash = 0; },
    },
    headset: {
      // moves the headset towards the player's face (used when returning to Haven)
      lift(to, dur) {
        lift.on = true; lift.t = 0; lift.dur = dur;
        lift.from.copy(headset.position);
        lift.to.copy(to);
      },
    },
    update(t, dt) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
      outline.visible = ph.highlighted;
      beam.visible = !ph.selected;
      beamMat.opacity = 0.35 + 0.2 * pulse;
      if (ph.highlighted) {
        symbolMat.opacity = 1;
        phoneMat.emissiveIntensity = 0.4;
        edge.material.opacity = 1;
        padRing.material.opacity = 1;
        outlineMat.opacity = 0.7 + 0.3 * pulse;
        haloMat.opacity = 0.7 + 0.2 * pulse;
      } else if (ph.selected) {
        symbolMat.opacity = 0.4;
        phoneMat.emissiveIntensity = 0.05;
        edge.material.opacity = 0.3;
        padRing.material.opacity = 0.3;
        haloMat.opacity = 0.1;
      } else {
        symbolMat.opacity = 0.3 + 0.7 * pulse;
        phoneMat.emissiveIntensity = 0.1 * pulse;
        edge.material.opacity = 0.45 + 0.5 * pulse;
        padRing.material.opacity = 0.35 + 0.5 * pulse;
        haloMat.opacity = 0.2 + 0.3 * pulse;
      }
      halo.scale.setScalar(1);
      if (ph.flash >= 0) {
        ph.flash += dt / 0.6;
        const e = Math.min(1, ph.flash);
        halo.scale.setScalar(1 + 4 * e);
        haloMat.opacity = 0.9 * (1 - e);
        if (ph.flash >= 1) ph.flash = -1;
      }
      screenMat.opacity = 0.86 + 0.06 * Math.sin(t * 1.3);
      updateCity(t, dt);
      if (lift.on) {
        lift.t = Math.min(1, lift.t + dt / lift.dur);
        const e = lift.t * lift.t * (3 - 2 * lift.t);
        headset.position.lerpVectors(lift.from, lift.to, e);
        headset.position.y += Math.sin(e * Math.PI) * 0.15;
        if (lift.t >= 1) lift.on = false;
      }
    },
  };
}
