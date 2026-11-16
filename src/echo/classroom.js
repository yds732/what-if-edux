// ECHO Scene 1: the classroom on Monday morning, 2055. Geometry, materials and lights only.
// Built from the bedroom's kit (textures, materials, city, headset), so both scenes share one look:
// glossy PBR surfaces, a generated environment map, a window light whose shadow map is rendered
// once, and static geometry merged per material.
import * as THREE from 'three';
import {
  PALETTE, makeTextures, makeMaterials, buildCity, createEchoHeadset, createBatcher, compose,
  rbox, UNIT_BOX, superquadric, displaceY, slab, roundedRect, planeM, scaleUV, profile, seeded, canvasTexture,
} from './bedroom.js';
import { SCRIPT } from './scene1-story.js';

export const CLASSROOM = { width: 8, length: 9, height: 3.2 };

const HW = CLASSROOM.width / 2;
const HL = CLASSROOM.length / 2;
const HT = CLASSROOM.height;
const HAZE = 0x2c3644;
const DESK_TOP = 0.74;
const WIN = { z0: -3.3, z1: 3.3, y0: 0.85, y1: 2.6, r: 0.35 }; // one long window in the left wall
const COLS = [-2.7, -1.25, 1.25, 2.7];                         // the centre aisle leads to the front table
const ROWS = [-0.9, 0.75, 2.4];
const SEAT_BACK = 0.55;                                         // chair centre, behind its desk
const PLAYER = { col: 1, row: 2 };
const EMPTY = new Set(['1,0', '1,1']);                          // free seats in front of the player keep the screen in view
const TABLE = { x: 0, z: -2.7, w: 1.7, d: 0.8, top: 0.82 };
const TEACHER = { x: 1.35, z: -3.2 };
const SCREEN = { y: 1.9, w: 4.4, h: 1.8 };

// One outfit per classmate: style, main colour, trim, trousers, shoes. Warm accents on the ECHO slate.
const OUTFITS = [
  { style: 'hoodie', top: 0x3f7f8c, trim: 0xe6e1d6, legs: 0x2b3442, shoes: 0xf2f2ee },
  { style: 'jacket', top: 0x8a3b4a, trim: 0xe9e4da, legs: 0x39485c, shoes: 0x1e232a },
  { style: 'sweater', top: 0xd2a24c, trim: 0x2f3a49, legs: 0x4a5361, shoes: 0xf2f2ee },
  { style: 'tee', top: 0xe9e4da, trim: 0x5b8bd0, legs: 0x3b5b86, shoes: 0x14181d },
  { style: 'hoodie', top: 0x6b5ca5, trim: 0xd9d4ca, legs: 0x262c35, shoes: 0xf2f2ee },
  { style: 'sweater', top: 0x3a6b52, trim: 0xe6e1d6, legs: 0x5b5560, shoes: 0x2a2420 },
  { style: 'jacket', top: 0x2f4f7a, trim: 0xd98c5f, legs: 0x262c35, shoes: 0xf2f2ee },
  { style: 'tee', top: 0xd9776a, trim: 0xf2efe8, legs: 0x39485c, shoes: 0xf2f2ee },
  { style: 'hoodie', top: 0x707782, trim: 0xa7c7e7, legs: 0x2b3442, shoes: 0x1e232a },
];
const SKIN = [0xe0b896, 0xc68d6a, 0x8d5a3b, 0xf1d0b5, 0x6b4430, 0xb57d58];
const HAIR = [0x1d1a18, 0x3b2a20, 0x5a3825, 0x14181d, 0x7a5a3a, 0x2a2420];
const HAIRSTYLES = ['short', 'long', 'bun', 'curly'];
const EXPRESSIONS = ['smile', 'curious', 'happy', 'neutral', 'surprised', 'smile', 'happy', 'curious', 'smile'];
const IRIS = [0x4a2e1f, 0x3f6f9a, 0x4f7a4a, 0x7a5a2e, 0x2a1d16];
const BOOK_COVERS = [0x8a3b4a, 0x3f7f8c, 0xd2a24c, 0x2f4f7a, 0x3a6b52, 0x6b5ca5, 0xd9776a, 0x4a5462];

// ---------- the classroom screen ----------
function screenTexture() {
  return canvasTexture(1536, 640, (g, W, H) => {
    const rr = (x, y, w, h, r) => { g.beginPath(); roundedRect(g, x, y, w, h, r); };
    rr(6, 6, W - 12, H - 12, 30); g.fillStyle = 'rgba(37,44,54,0.55)'; g.fill();
    g.lineWidth = 4; g.strokeStyle = 'rgba(210,228,244,0.95)'; g.stroke();
    g.fillStyle = 'rgba(167,199,231,0.95)'; g.font = '600 30px system-ui, sans-serif'; g.fillText('MON  09:05', 50, 68);
    g.fillStyle = 'rgba(203,208,213,0.5)';
    for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(W - 120 + i * 30, 58, 6, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = 'rgba(167,199,231,0.3)'; g.fillRect(44, 96, W - 88, 2);
    // Echo mark: a dot sending out rings
    const cx = 210, cy = 350;
    g.fillStyle = 'rgba(167,199,231,1)'; g.beginPath(); g.arc(cx, cy, 16, 0, Math.PI * 2); g.fill();
    for (let k = 1; k <= 3; k++) {
      g.strokeStyle = `rgba(167,199,231,${1 - k * 0.25})`; g.lineWidth = 6 - k;
      g.beginPath(); g.arc(cx, cy, 16 + k * 34, 0, Math.PI * 2); g.stroke();
    }
    const tx = 400, maxW = W - tx - 70;
    g.fillStyle = 'rgba(167,199,231,1)'; g.font = '700 56px system-ui, sans-serif';
    g.letterSpacing = '6px'; g.fillText(SCRIPT.screen.title, tx, 280); g.letterSpacing = '0px';
    g.fillStyle = '#e3e7eb'; g.font = '500 52px system-ui, sans-serif';
    const words = SCRIPT.screen.question.split(' ');
    let line = '', y = 375;
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (line && g.measureText(t).width > maxW) { g.fillText(line, tx, y); line = w; y += 68; } else line = t;
    }
    g.fillText(line, tx, y);
    g.fillStyle = 'rgba(167,199,231,0.3)'; g.fillRect(44, H - 96, W - 88, 2);
    g.fillStyle = 'rgba(203,208,213,0.6)'; g.font = '500 24px system-ui, sans-serif';
    g.letterSpacing = '4px'; g.fillText('CITY YOUTH COUNCIL  ·  PILOT REVIEW ON FRIDAY', 50, H - 48); g.letterSpacing = '0px';
  });
}

// ---------- posters, whiteboard, globe and ruled paper (drawn in code) ----------
const ELEMENTS = 'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe'.split(' ');
function periodicTexture() {
  return canvasTexture(1024, 480, (g, W, H) => {
    g.fillStyle = '#e9e6de'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#2f3a49'; g.font = '700 32px system-ui, sans-serif'; g.fillText('PERIODIC TABLE OF THE ELEMENTS', 40, 52);
    const rows = [[1, 18], [1, 2, 13, 14, 15, 16, 17, 18], [1, 2, 13, 14, 15, 16, 17, 18]];
    const cols = (r) => (r < 3 ? rows[r] : Array.from({ length: 18 }, (_, i) => i + 1));
    const colour = (c) => (c === 1 ? '#e8a598' : c === 2 ? '#e9c77f' : c <= 12 ? '#b9c6d6' : c <= 17 ? '#9fd0c3' : '#c4b6e6');
    let n = 0;
    for (let r = 0; r < 5; r++) {
      for (const c of cols(r)) {
        const x = 52 + (c - 1) * 51, y = 82 + r * 70;
        g.fillStyle = n === 0 ? '#d9d4ca' : colour(c); g.fillRect(x, y, 47, 64);
        g.fillStyle = '#1d2430'; g.font = '500 12px system-ui, sans-serif'; g.fillText(String(n + 1), x + 4, y + 14);
        g.font = '700 22px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(ELEMENTS[n], x + 23.5, y + 46); g.textAlign = 'left';
        n++;
      }
    }
  });
}
function solarTexture() {
  return canvasTexture(560, 800, (g, W, H) => {
    g.fillStyle = '#141b2b'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,255,255,${0.2 + ((i * 37) % 60) / 100})`; g.fillRect((i * 97) % W, (i * 53) % H, 2, 2); }
    g.fillStyle = '#e9e6de'; g.font = '700 34px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('OUR SOLAR SYSTEM', W / 2, 56);
    const sun = g.createRadialGradient(W / 2, -60, 20, W / 2, -60, 190);
    sun.addColorStop(0, '#fff3c4'); sun.addColorStop(0.6, '#f2b44c'); sun.addColorStop(1, 'rgba(242,180,76,0)');
    g.fillStyle = sun; g.fillRect(0, 70, W, 120);
    const planets = [['Mercury', 7, '#b3a79a'], ['Venus', 12, '#e3c48d'], ['Earth', 13, '#5b8bd0'], ['Mars', 9, '#d9776a'],
      ['Jupiter', 34, '#d8b48a'], ['Saturn', 28, '#e3cf9a'], ['Uranus', 18, '#9fd0d8'], ['Neptune', 17, '#5c6bc0']];
    planets.forEach(([name, r, col], i) => {
      const y = 170 + i * 76;
      g.fillStyle = col; g.beginPath(); g.arc(150, y, r, 0, Math.PI * 2); g.fill();
      if (name === 'Saturn') { g.strokeStyle = '#cdb98a'; g.lineWidth = 4; g.beginPath(); g.ellipse(150, y, r * 1.8, r * 0.5, -0.3, 0, Math.PI * 2); g.stroke(); }
      g.fillStyle = '#cbd0d5'; g.font = '600 28px system-ui, sans-serif'; g.textAlign = 'left'; g.fillText(name, 230, y + 10);
    });
  });
}
function whiteboardTexture() {
  return canvasTexture(1024, 732, (g, W, H) => {
    g.fillStyle = '#f4f4f1'; g.fillRect(0, 0, W, H);
    const hand = '"Segoe Print", "Comic Sans MS", "Chalkboard SE", cursive';
    g.fillStyle = '#2f4f7a'; g.font = `700 54px ${hand}`; g.fillText('Monday — Maths', 50, 90);
    g.fillStyle = '#1d2430'; g.font = `600 64px ${hand}`; g.fillText('a² + b² = c²', 60, 210);
    g.strokeStyle = '#8a3b4a'; g.lineWidth = 6; g.beginPath(); g.moveTo(640, 330); g.lineTo(640, 130); g.lineTo(940, 330); g.closePath(); g.stroke();
    g.strokeRect(640, 300, 30, 30);
    g.fillStyle = '#8a3b4a'; g.font = `600 44px ${hand}`; g.fillText('a', 595, 245); g.fillText('b', 780, 380); g.fillText('c', 805, 215);
    g.fillStyle = '#1d2430'; g.font = `600 56px ${hand}`; g.fillText('y = mx + c', 60, 340);
    g.fillStyle = '#3a6b52'; g.font = `600 44px ${hand}`; g.fillText('Homework: p. 42, Q1–6', 60, 470);
    g.fillText('Read chapter 3 ✓', 60, 545);
    g.fillStyle = 'rgba(0,0,0,0.04)'; for (let i = 0; i < 6; i++) g.fillRect(500 + i * 60, 600 + (i % 2) * 20, 180, 30); // old erased marks
  });
}
function globeTexture() {
  return canvasTexture(512, 256, (g, W, H) => {
    g.fillStyle = '#3f6f9a'; g.fillRect(0, 0, W, H);
    const blobs = [[90, 80, 60, 40], [130, 170, 30, 55], [255, 70, 50, 30], [270, 150, 40, 60], [370, 80, 90, 45], [420, 185, 35, 22]];
    for (const [x, y, rx, ry] of blobs) { g.fillStyle = '#6f9a5c'; g.beginPath(); g.ellipse(x, y, rx, ry, 0.4, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#e9e6de'; g.fillRect(0, 0, W, 14); g.fillRect(0, H - 14, W, 14);
  });
}
// Cloth-like cover with a printed title block; spines with gilt bands and a title line;
// page edges with fine lines.
function coverTexture(color) {
  const c = `#${color.toString(16).padStart(6, '0')}`;
  return canvasTexture(128, 160, (g, W, H) => {
    g.fillStyle = c; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${i % 2 ? 255 : 0},${i % 2 ? 255 : 0},${i % 2 ? 255 : 0},0.05)`; g.fillRect((i * 37) % W, (i * 71) % H, 1, 1); }
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, 10, H);                       // hinge shadow by the spine
    g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(26, 34, W - 46, 30);           // title block
    g.fillStyle = c; g.fillRect(34, 44, W - 70, 4); g.fillRect(34, 53, W - 90, 3);
    g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 2; g.strokeRect(20, 20, W - 34, H - 40);
  });
}
function spineTexture(color, i) {
  const c = `#${color.toString(16).padStart(6, '0')}`;
  return canvasTexture(32, 256, (g, W, H) => {
    g.fillStyle = c; g.fillRect(0, 0, W, H);
    const shade = g.createLinearGradient(0, 0, W, 0);
    shade.addColorStop(0, 'rgba(0,0,0,0.25)'); shade.addColorStop(0.5, 'rgba(255,255,255,0.08)'); shade.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = shade; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(232,206,140,0.85)';                                          // gilt bands
    g.fillRect(0, 18, W, 3); g.fillRect(0, 26, W, 2); g.fillRect(0, H - 28, W, 2); g.fillRect(0, H - 22, W, 3);
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(W / 2 - 3, 60 + (i % 3) * 10, 6, 90 + (i % 4) * 15); // title
  });
}
function pageEdgeTexture() {
  return canvasTexture(64, 64, (g, W, H) => {
    g.fillStyle = '#ece6d8'; g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 2) { g.fillStyle = `rgba(120,105,80,${0.08 + ((y * 7) % 5) / 40})`; g.fillRect(0, y, W, 1); }
  });
}
function ruledTexture() {
  return canvasTexture(256, 256, (g, W, H) => {
    g.fillStyle = '#efeadf'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(91,139,208,0.55)'; for (let y = 34; y < H; y += 18) g.fillRect(0, y, W, 1.5);
    g.fillStyle = 'rgba(217,119,106,0.6)'; g.fillRect(36, 0, 1.5, H);
  });
}

// ---------- daytime outside (the bedroom's skyline is shared, so only the classroom re-skins it) ----------
const DAY_HAZE = 0x9db1c6;
function daySkyTexture() {
  return canvasTexture(1024, 512, (g, W, H) => {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#36659c'); sky.addColorStop(0.45, '#6a92bd'); sky.addColorStop(0.68, '#a3bbd2'); sky.addColorStop(0.75, '#95a9be'); sky.addColorStop(1, '#7f92a6');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    const sun = g.createRadialGradient(780, 110, 6, 780, 110, 160);
    sun.addColorStop(0, 'rgba(255,248,226,0.85)'); sun.addColorStop(0.12, 'rgba(255,240,205,0.55)'); sun.addColorStop(1, 'rgba(255,246,214,0)');
    g.fillStyle = sun; g.fillRect(560, 0, 440, 300);
    for (let i = 0; i < 26; i++) { // soft clouds
      const x = (i * 211) % W, y = 60 + ((i * 97) % 200), w = 140 + ((i * 53) % 220);
      const c = g.createRadialGradient(x, y, 0, x, y, w / 2);
      c.addColorStop(0, 'rgba(236,242,248,0.38)'); c.addColorStop(1, 'rgba(255,255,255,0)');
      g.save(); g.translate(x, y); g.scale(1, 0.28); g.translate(-x, -y); g.fillStyle = c; g.fillRect(x - w / 2, y - w / 2, w, w); g.restore();
    }
    let x = 0; // far skyline fading into the daylight haze
    while (x < W) {
      const w = 5 + ((x * 7) % 16), h = 20 + ((x * 13) % 120), base = H * 0.74;
      g.fillStyle = 'rgba(98,116,138,0.6)'; g.fillRect(x, base - h, w, H);
      x += w + ((x * 3) % 9) + 1;
    }
  });
}
function dayCityTexture() {
  return canvasTexture(256, 256, (g, W, H) => {
    g.fillStyle = '#6f8296'; g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 8) {
      for (let x = 0; x < W; x += 8) {
        const v = 140 + ((x * 31 + y * 17) % 45);
        g.fillStyle = `rgb(${v - 30},${v - 8},${v + 20})`; g.fillRect(x + 1, y + 2, 6, 5); // sky reflected in the glass
      }
    }
    for (let x = 0; x < W; x += 64) { g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(x, 0, 3, H); }
  }, { repeat: true });
}
function deskHoloTexture(i) {
  return canvasTexture(384, 256, (g, W, H) => {
    g.strokeStyle = 'rgba(210,228,244,0.95)'; g.lineWidth = 3; g.strokeRect(6, 6, W - 12, H - 12);
    g.fillStyle = 'rgba(37,44,54,0.35)'; g.fillRect(6, 6, W - 12, H - 12);
    g.fillStyle = 'rgba(167,199,231,1)'; g.font = '700 22px system-ui, sans-serif';
    g.fillText(['LESSON 3 · ENERGY', 'READING · CH. 3', 'MATHS · TRIANGLES'][i % 3], 22, 40);
    g.fillStyle = 'rgba(167,199,231,0.35)'; g.fillRect(20, 54, W - 40, 2);
    if (i % 3 === 2) { g.strokeStyle = 'rgba(167,199,231,0.9)'; g.beginPath(); g.moveTo(60, 220); g.lineTo(60, 90); g.lineTo(220, 220); g.closePath(); g.stroke(); }
    else if (i % 3 === 1) { g.fillStyle = 'rgba(203,208,213,0.7)'; for (let l = 0; l < 7; l++) g.fillRect(22, 80 + l * 22, 180 + ((l * 53) % 140), 6); }
    else { g.beginPath(); for (let x = 0; x <= 340; x += 4) g.lineTo(22 + x, 160 - Math.sin(x / 30) * 50); g.strokeStyle = 'rgba(167,199,231,0.95)'; g.stroke(); }
  });
}

// Stand-in room for reflections: dark box with the window, ceiling strips and screen as light panels.
function makeEnvironment(renderer) {
  const env = new THREE.Scene();
  const hdr = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), side: THREE.DoubleSide });
  env.add(new THREE.Mesh(new THREE.BoxGeometry(CLASSROOM.width, HT, CLASSROOM.length), new THREE.MeshBasicMaterial({ color: 0x0a0d12, side: THREE.BackSide })));
  const panel = (w, h, mat, x, y, z, ry = 0, rx = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y - HT / 2, z); m.rotation.set(rx, ry, 0); env.add(m);
  };
  panel(6.6, 1.75, hdr(3.4, 3.8, 4.4), -HW + 0.05, 1.72, 0, Math.PI / 2);           // window (daylight)
  for (const x of [-2, 0, 2]) panel(0.15, 7, hdr(5, 5.2, 5.6), x, HT - 0.05, 0, 0, Math.PI / 2); // ceiling strips
  panel(4.4, 1.8, hdr(1.6, 2.4, 3.4), 0, SCREEN.y, -HL + 0.05);                       // screen
  panel(CLASSROOM.width, CLASSROOM.length, hdr(0.03, 0.035, 0.045), 0, 0.02, 0, 0, -Math.PI / 2);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.03).texture;
  pmrem.dispose();
  return tex;
}

// ---------- people ----------
// Face on a head centred at (0, 0, 0); f = +1 when the face looks along +z, -1 along -z,
// d stretches the depth for wider heads. Expressions: smile, happy, neutral, surprised, curious.
// The mouth is added last, so callers can find it as the last child.
function face(add, mats, f, expr, d = 1) {
  const z = (v) => f * v * d;
  const white = new THREE.SphereGeometry(expr === 'surprised' ? 0.019 : 0.017, 14, 10);
  const iris = new THREE.SphereGeometry(0.0095, 12, 8);
  const glint = new THREE.SphereGeometry(0.0028, 6, 4);
  const ear = superquadric(0.014, 0.032, 0.024, 0.8, 0.8, 10, 8);
  for (const s of [-1, 1]) {
    add(white, mats.white, s * 0.036, 0.016, z(0.09), 0, 0, 0, [1, 0.8, 1]);
    add(iris, mats.iris, s * 0.036, 0.015, z(0.104));
    add(glint, mats.glint, s * 0.036 + 0.004, 0.02, z(0.112));
    const lift = expr === 'surprised' || (expr === 'curious' && s === 1) ? 0.012 : 0;
    const tilt = expr === 'happy' ? -s * 0.18 : expr === 'curious' && s === 1 ? 0.25 : 0;
    add(UNIT_BROW, mats.brow, s * 0.037, 0.05 + lift, z(0.095), 0, 0, tilt * f, [0.034, 0.008, 0.008]);
    add(ear, mats.skin, s * 0.1, 0, z(-0.005));
  }
  add(superquadric(0.013, 0.03, 0.018, 0.8, 0.8, 10, 8), mats.skin, 0, -0.004, z(0.1));      // nose bridge
  add(new THREE.SphereGeometry(0.014, 10, 8), mats.skin, 0, -0.024, z(0.107));                  // nose tip
  add(superquadric(0.065, 0.045, 0.075, 0.8, 0.8, 16, 10), mats.skin, 0, -0.074, z(0.015));     // chin
  if (expr === 'happy' || expr === 'smile') {
    for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.016, 10, 8), mats.blush, s * 0.056, -0.024, z(0.088), 0, 0, 0, [1, 0.6, 0.4]);
  }
  if (expr === 'neutral') add(UNIT_BROW, mats.lip, 0, -0.056, z(0.098), 0, 0, 0, [0.03, 0.006, 0.006]);
  else if (expr === 'surprised') add(new THREE.TorusGeometry(0.011, 0.005, 6, 16), mats.lip, 0, -0.058, z(0.097));
  else {
    const r = expr === 'happy' ? 0.028 : 0.022;
    const arc = new THREE.TorusGeometry(r, expr === 'happy' ? 0.0055 : 0.0045, 6, 14, Math.PI);
    add(arc, mats.lip, expr === 'curious' ? 0.01 : 0, -0.042, z(0.097), 0, 0, Math.PI + (expr === 'curious' ? 0.25 : 0));
  }
}

// Hand resting palm-down in its own frame: fingers point along -z, thumb on the +x side when sx = 1.
function hand(add, mat, sx = 1) {
  const k = 1.2; // sized to match the arms
  add(superquadric(0.038 * k, 0.013 * k, 0.042 * k, 0.7, 0.6, 14, 8), mat, 0, 0, 0);
  const finger = new THREE.CapsuleGeometry(0.0075 * k, 0.038 * k, 3, 8);
  [-0.024, -0.008, 0.008, 0.024].forEach((x, i) => {
    add(finger, mat, x * k, -0.003 * k, (-0.062 - (i === 1 || i === 2 ? 0.005 : 0)) * k, Math.PI / 2 + 0.12, 0, 0, [1, i === 0 ? 0.8 : 1, 1]);
  });
  add(new THREE.CapsuleGeometry(0.0085 * k, 0.03 * k, 3, 8), mat, sx * 0.042 * k, -0.002 * k, -0.022 * k, Math.PI / 2, sx * 0.7, 0);
}
const UNIT_BROW = new THREE.BoxGeometry(1, 1, 1);

function hairdo(add, mat, style) {
  add(superquadric(0.108, 0.09, 0.11, 0.7, 0.8, 20, 12), mat, 0, 0.05, 0.015);           // cap
  if (style === 'long') add(superquadric(0.11, 0.16, 0.05, 0.7, 0.7, 20, 12), mat, 0, -0.1, 0.08);
  if (style === 'bun') add(new THREE.SphereGeometry(0.055, 16, 12), mat, 0, 0.1, 0.08);
  if (style === 'curly') {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      add(new THREE.SphereGeometry(0.042, 12, 8), mat, Math.cos(a) * 0.075, 0.08 + Math.sin(a * 2) * 0.01, 0.02 + Math.sin(a) * 0.07);
    }
  }
}

// Seated classmate, built at the chair origin and facing -z (towards the front).
function seatedFigure(put, nest, look) {
  const thigh = new THREE.CapsuleGeometry(0.072, 0.3, 4, 10);
  const shin = new THREE.CapsuleGeometry(0.062, 0.34, 4, 10);
  const arm = new THREE.CapsuleGeometry(0.052, 0.24, 4, 10);
  const tee = look.style === 'tee';
  for (const s of [-1, 1]) {
    put(thigh, look.legs, s * 0.1, 0.52, -0.17, Math.PI / 2);
    put(shin, look.legs, s * 0.1, 0.27, -0.36);
    put(rbox(0.09, 0.06, 0.17, 0.025), look.shoes, s * 0.1, 0.03, -0.41);
    put(arm, tee ? look.skin : look.top, s * 0.235, 0.86, -0.12, 1.0);
    if (tee) put(new THREE.CapsuleGeometry(0.06, 0.06, 4, 10), look.top, s * 0.235, 0.95, -0.03, 1.0);
    nest(s * 0.235, 0.757, -0.28, 0, s * 0.3, 0, () => hand(put, look.skin, -s));             // hands on the desk
  }
  put(superquadric(0.19, 0.27, 0.12, 0.6, 0.6, 24, 14), look.top, 0, 0.85, 0.02);
  if (look.style === 'hoodie') {
    put(superquadric(0.15, 0.075, 0.085, 0.7, 0.6, 20, 10), look.top, 0, 1.07, 0.1);        // hood
    put(superquadric(0.1, 0.05, 0.02, 0.6, 0.5, 16, 8), look.top, 0, 0.74, -0.112);          // pocket
    for (const s of [-1, 1]) put(UNIT_BROW, look.trim, s * 0.03, 0.98, -0.118, 0, 0, 0, [0.006, 0.1, 0.006]);
  } else if (look.style === 'jacket') {
    put(superquadric(0.075, 0.2, 0.03, 0.6, 0.5, 16, 10), look.trim, 0, 0.9, -0.098);        // shirt under an open jacket
    for (const s of [-1, 1]) put(UNIT_BROW, look.top, s * 0.06, 1.04, -0.1, 0.2, 0, s * 0.5, [0.03, 0.09, 0.012]);
  } else if (look.style === 'sweater') {
    put(new THREE.TorusGeometry(0.05, 0.016, 8, 20), look.trim, 0, 1.1, 0.02, Math.PI / 2);   // collar
    put(new THREE.TorusGeometry(0.186, 0.016, 8, 32), look.trim, 0, 0.93, 0.02, Math.PI / 2, 0, 0, [1, 0.64, 1]); // stripe
  } else {
    put(new THREE.TorusGeometry(0.05, 0.01, 8, 20), look.trim, 0, 1.1, 0.02, Math.PI / 2);   // tee neckline
  }
  put(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 12), look.skin, 0, 1.13, 0.02);
  nest(0, 1.27, 0.03, look.reading ? -0.35 : 0, 0, 0, () => { // readers look down at their books
    put(superquadric(0.1, 0.125, 0.11, 0.9, 0.9, 20, 14), look.skin, 0, 0, 0);
    hairdo(put, look.hair, look.hairStyle);
    face(put, { ...look.face, skin: look.skin, brow: look.hair }, -1, look.expression);
  });
}

// The teacher is a separate group so they can turn towards the player, gesture and talk.
function buildTeacher(M, mat) {
  const g = new THREE.Group();
  const skin = mat(0xd9a98a);
  const blazer = mat(0x34405a, true);
  const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0, s = 1, parent = g) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz);
    if (Array.isArray(s)) mesh.scale.set(s[0], s[1], s[2]); else mesh.scale.setScalar(s);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const leg = new THREE.CapsuleGeometry(0.075, 0.72, 4, 10);
  for (const s of [-1, 1]) {
    add(leg, M.fabricDark, s * 0.1, 0.45, 0);
    add(rbox(0.1, 0.07, 0.22, 0.03), M.darkMetal, s * 0.1, 0.035, 0.04);                      // shoes
  }
  add(superquadric(0.195, 0.28, 0.135, 0.7, 0.6, 28, 16), blazer, 0, 1.02, 0);                  // blazer, lower
  add(superquadric(0.2, 0.3, 0.13, 0.6, 0.6, 28, 16), blazer, 0, 1.28, 0);                     // blazer, chest
  add(superquadric(0.05, 0.12, 0.03, 0.6, 0.5, 16, 10), M.pale, 0, 1.42, 0.11);                 // shirt collar
  add(UNIT_BROW, mat(0x8a3b4a), 0, 1.35, 0.135, -0.12, 0, 0, [0.028, 0.2, 0.01]);                 // tie
  for (const s of [-1, 1]) add(UNIT_BROW, blazer, s * 0.06, 1.42, 0.12, -0.2, 0, -s * 0.5, [0.03, 0.12, 0.012]); // lapels
  add(rbox(0.05, 0.065, 0.006, 0.004, 1), M.holoSolid, 0.11, 1.32, 0.135);                     // Echo pilot badge
  add(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 12), skin, 0, 1.58, 0);

  const head = new THREE.Group();
  head.position.set(0, 1.73, 0);
  g.add(head);
  const h = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0, s = 1) => add(geo, m, x, y, z, rx, ry, rz, s, head);
  h(superquadric(0.105, 0.13, 0.115, 0.9, 0.9, 24, 16), skin, 0, 0, 0);
  h(superquadric(0.112, 0.08, 0.12, 0.6, 0.8, 24, 12), mat(0x9aa1ab), 0, 0.07, -0.02);
  face(h, { white: mat(0xf2efe9), iris: mat(0x4a2e1f), glint: M.lampCore, brow: mat(0x7d838c), lip: mat(0x9a5a55), skin, blush: mat(0xe39a92) }, 1, 'smile', 1.045);
  const smile = head.children[head.children.length - 1]; // the mouth face() just added
  for (const s of [-1, 1]) h(new THREE.TorusGeometry(0.025, 0.003, 6, 20), M.darkMetal, s * 0.037, 0.016, 0.121); // glasses
  h(UNIT_BROW, M.darkMetal, 0, 0.02, 0.123, 0, 0, 0, [0.024, 0.004, 0.004]);
  const talking = h(new THREE.SphereGeometry(0.016, 12, 8), mat(0x4a2226), 0, -0.055, 0.1, 0, 0, 0, [1.2, 0.6, 0.4]);
  talking.visible = false;

  const arm = new THREE.CapsuleGeometry(0.055, 0.5, 4, 10);
  add(arm, blazer, -0.27, 1.12, 0);
  // hands hang at the sides: fingers down, palms towards the body, thumbs forward
  const hangingHand = (parent, x, y, s) => {
    const yaw = new THREE.Group();
    yaw.position.set(x, y, 0); yaw.rotation.y = -s * Math.PI / 2;
    const pitch = new THREE.Group();
    pitch.rotation.x = -Math.PI / 2;
    yaw.add(pitch); parent.add(yaw);
    hand((geo, m, hx, hy, hz, rx = 0, ry = 0, rz = 0, sc = 1) => add(geo, m, hx, hy, hz, rx, ry, rz, sc, pitch), skin, s);
  };
  hangingHand(g, -0.27, 0.8, -1);
  const shoulder = new THREE.Group(); // right arm pivots at the shoulder
  shoulder.position.set(0.27, 1.42, 0);
  g.add(shoulder);
  add(arm, blazer, 0, -0.3, 0, 0, 0, 0, 1, shoulder);
  hangingHand(shoulder, 0, -0.62, 1);
  return { group: g, head, shoulder, smile, talking };
}

// ---------- scene ----------
export function buildClassroom(scene, renderer) {
  const root = new THREE.Group();
  root.name = 'classroom';
  scene.add(root);
  scene.fog = new THREE.FogExp2(DAY_HAZE, 0.012);
  scene.background = new THREE.Color(DAY_HAZE);
  scene.environment = makeEnvironment(renderer);

  const T = makeTextures();
  const M = makeMaterials(T);
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const shared = new Map(); // one material per colour keeps the merged draw calls low
  const matOf = (color, fabric) => {
    const key = `${fabric ? 'f' : 'p'}${color}`;
    if (!shared.has(key)) {
      shared.set(key, fabric
        ? S({ color, roughness: 0.92, bumpMap: T.fabric, bumpScale: 0.6, envMapIntensity: 0.5 })
        : S({ color, roughness: 0.6 }));
    }
    return shared.get(key);
  };
  const lightStrip = new THREE.MeshBasicMaterial({ color: 0xe8eef6, toneMapped: false });
  lightStrip.userData.noCast = true;

  const rnd = seeded(905);
  const solid = createBatcher();
  let origin = null;
  const at = (x, y, z, ry = 0) => { origin = compose(x, y, z, 0, ry, 0); };
  // Runs fn with a local frame nested inside the current origin.
  const nest = (x, y, z, rx, ry, rz, fn) => {
    const saved = origin;
    origin = (saved ? saved.clone() : new THREE.Matrix4()).multiply(compose(x, y, z, rx, ry, rz));
    fn();
    origin = saved;
  };
  const put = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) => solid.add(geo, mat, compose(x, y, z, rx, ry, rz, s), origin);
  const box = (mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => put(UNIT_BOX, mat, x, y, z, rx, ry, rz, [w, h, d]);
  const loose = (mesh, x, y, z) => { mesh.position.set(x, y, z); root.add(mesh); return mesh; };
  const placed = (obj, x, y, z, rx = 0, ry = 0, rz = 0) => { // loose object in the current origin's frame
    obj.applyMatrix4((origin ? origin.clone() : new THREE.Matrix4()).multiply(compose(x, y, z, rx, ry, rz)));
    root.add(obj);
    return obj;
  };
  const animated = []; // (t, dt) => void, run from update()
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
  put(planeM(CLASSROOM.width, CLASSROOM.length, 1.25), M.floor, 0, 0, 0, -Math.PI / 2);
  put(new THREE.PlaneGeometry(CLASSROOM.width, CLASSROOM.length), M.ceiling, 0, HT, 0, Math.PI / 2);
  put(planeM(CLASSROOM.width, HT, 0.9), M.wall, 0, HT / 2, -HL);
  put(planeM(CLASSROOM.width, HT, 0.9), M.wall, 0, HT / 2, HL, 0, Math.PI);
  put(planeM(CLASSROOM.length, HT, 0.9), M.wall, HW, HT / 2, 0, 0, -Math.PI / 2);
  for (const x of [-2, 0, 2]) put(rbox(0.12, 0.02, 7, 0.008), lightStrip, x, HT - 0.012, 0);

  // left wall with one long rounded window; local x of the shape runs along -z
  const winL = WIN.z1 - WIN.z0, winH = WIN.y1 - WIN.y0;
  const wallShape = new THREE.Shape().moveTo(-HL, 0).lineTo(HL, 0).lineTo(HL, HT).lineTo(-HL, HT).lineTo(-HL, 0);
  wallShape.holes.push(roundedRect(new THREE.Path(), -WIN.z1, WIN.y0, winL, winH, WIN.r));
  put(scaleUV(new THREE.ShapeGeometry(wallShape, 12), 1 / 0.9, 1 / 0.9), M.wall, -HW, 0, 0, 0, Math.PI / 2);
  const f = 0.07;
  const frameShape = roundedRect(new THREE.Shape(), -WIN.z1 - f, WIN.y0 - f, winL + 2 * f, winH + 2 * f, WIN.r + f);
  frameShape.holes.push(roundedRect(new THREE.Path(), -WIN.z1 + 0.01, WIN.y0 + 0.01, winL - 0.02, winH - 0.02, WIN.r - 0.01));
  put(new THREE.ExtrudeGeometry(frameShape, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 12 }), M.darkMetal, -HW - 0.14, 0, 0, 0, Math.PI / 2);
  for (const z of [-1.1, 1.1]) box(M.darkMetal, 0.08, winH, 0.045, -HW - 0.03, (WIN.y0 + WIN.y1) / 2, z);
  put(rbox(0.26, 0.04, winL + 0.1, 0.012), M.gloss, -HW + 0.1, WIN.y0 - 0.02, 0);                     // sill
  const glass = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(new THREE.Shape(), -WIN.z1, WIN.y0, winL, winH, WIN.r), 12), M.glass.clone());
  glass.material.opacity = 0.1;
  glass.rotation.y = Math.PI / 2;
  loose(glass, -HW - 0.05, 0, 0);

  // door and a lit panel on the right wall; storage along the back wall
  at(HW, 0, 3.3, -Math.PI / 2);
  put(rbox(1.0, 2.15, 0.05, 0.02), M.body, 0, 1.075, 0.02);
  box(M.holoSolid, 0.012, 0.09, 0.01, 0.4, 1.05, 0.05);
  at(0, 0, HL, Math.PI);
  put(rbox(5.4, 0.9, 0.45, 0.03), M.body, 0, 0.45, 0.23);
  put(rbox(5.5, 0.035, 0.5, 0.012), M.gloss, 0, 0.92, 0.25);
  box(M.holoSolid, 5.2, 0.006, 0.006, 0, 0.88, 0.48);
  for (let i = -2; i <= 2; i++) box(M.darkMetal, 0.004, 0.78, 0.006, i * 1.05, 0.45, 0.455);
  const leaf = superquadric(1, 0.16, 0.62, 1, 1, 8, 5);
  for (const px of [-2.2, 2.1]) { // potted plants on the storage unit
    put(new THREE.LatheGeometry(profile([[0, 0], [0.09, 0], [0.12, 0.04], [0.13, 0.22], [0.115, 0.23], [0.11, 0.2], [0, 0.2]]), 24), M.pale, px, 0.94, 0.25);
    for (let i = 0; i < 16; i++) {
      const a = rnd() * Math.PI * 2, tilt = 0.4 + rnd() * 0.7;
      put(leaf, M.plant, px + Math.cos(a) * 0.05, 1.18 + rnd() * 0.12, 0.25 + Math.sin(a) * 0.05, 0, a, tilt, 0.09 + rnd() * 0.05);
    }
  }

  // ===== books =====
  const pages = S({ map: pageEdgeTexture(), roughness: 0.95 });
  const lined = S({ map: ruledTexture(), roughness: 0.9 });
  const coverCache = new Map(), spineCache = new Map();
  const coverMat = (c) => {
    if (!coverCache.has(c)) coverCache.set(c, S({ map: coverTexture(c), roughness: 0.8, envMapIntensity: 0.4 }));
    return coverCache.get(c);
  };
  const spineMat = (c) => {
    const key = `${c}:${spineCache.size % 4}`; // a few title layouts per colour
    if (!spineCache.has(key)) spineCache.set(key, S({ map: spineTexture(c, spineCache.size), roughness: 0.75, envMapIntensity: 0.4 }));
    return spineCache.get(key);
  };
  const SPINE_COLORS = [...BOOK_COVERS, 0x4a5462, 0x707782, 0x9aa1ab];
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const halfRound = (r, len) => new THREE.CylinderGeometry(r, r, len, 12, 1, false, Math.PI, Math.PI);
  // A closed book lying flat, in the current origin's frame; returns its thickness.
  // Boards overhang the page block, and the spine is rounded.
  const book = (x, y, z, ry, w, d, h, color) => {
    const cover = coverMat(color), cloth = matOf(color);
    nest(x, y, z, 0, ry, 0, () => {
      box(cover, w, 0.003, d, 0, h - 0.0015, 0);                          // front board (printed)
      box(cloth, w, 0.003, d, 0, 0.0015, 0);                              // back board
      put(halfRound(h / 2, d), cloth, -w / 2 + h / 2, h / 2, 0, Math.PI / 2);
      box(pages, w - h / 2 - 0.006, h - 0.006, d - 0.008, h / 4 - 0.002, h / 2, 0);
    });
    return h;
  };
  // An open book: pages curve up from the centre fold and fall away to the edges.
  const pageGeo = (() => {
    const g = new THREE.BoxGeometry(0.15, 0.004, 0.21, 24, 1, 1);
    g.translate(0.075, 0.002, 0);
    return displaceY(g, (x, y) => (y > 0.003 ? 0.004 + 0.016 * Math.sin(Math.min(1, x / 0.035) * Math.PI / 2) - 0.07 * Math.max(0, x - 0.035) : 0));
  })();
  const openBook = (x, y, z, ry, color) => nest(x, y, z, 0, ry, 0, () => {
    const cloth = matOf(color);
    for (const s of [-1, 1]) {
      box(cloth, 0.158, 0.003, 0.222, s * 0.079, 0.0015, 0);
      put(pageGeo, lined, s * 0.002, 0.003, 0, 0, s === 1 ? 0 : Math.PI, 0);
    }
    put(halfRound(0.006, 0.222), cloth, 0, 0.0, 0, Math.PI / 2, 0, -Math.PI / 2);
  });
  const pencilMat = matOf(0xd9a63e), woodMat = matOf(0xd8b894), eraserMat = matOf(0xe39a92);
  const pencil = (x, y, z, ry) => nest(x, y + 0.004, z, 0, ry, Math.PI / 2, () => {
    put(new THREE.CylinderGeometry(0.004, 0.004, 0.16, 6), pencilMat, 0, 0, 0);
    put(new THREE.ConeGeometry(0.004, 0.018, 6), woodMat, 0, 0.089, 0);
    put(new THREE.CylinderGeometry(0.0042, 0.0042, 0.014, 8), eraserMat, 0, -0.087, 0);
  });
  const coverOf = () => BOOK_COVERS[Math.floor(rnd() * BOOK_COVERS.length)];
  const stack = (x, z, n) => {
    let y = DESK_TOP;
    for (let i = 0; i < n; i++) y += book(x + (rnd() - 0.5) * 0.02, y, z, (rnd() - 0.5) * 0.5, 0.15 + rnd() * 0.05, 0.21 + rnd() * 0.04, 0.022 + rnd() * 0.018, coverOf());
  };
  // A different mix on each desk: a stack, an open book with a pencil, or both.
  const deskBooks = (i) => {
    const kind = i % 3;
    if (kind !== 1) stack(-0.36, -0.13, 1 + (i % 3) + (i % 2));
    if (kind !== 0) openBook(-0.15, DESK_TOP, 0.11, (rnd() - 0.5) * 0.3, coverOf());
    pencil(kind !== 0 ? 0.0 : -0.1, DESK_TOP, kind !== 0 ? 0.2 : 0.12, 0.3 + rnd() * 0.5);
  };
  // Books standing on a shelf from x0 to x1, with the odd gap, flat stack and labelled spine.
  const shelfBooks = (x0, x1, y, maxH, zc) => {
    let x = x0;
    while (x < x1 - 0.06) {
      if (rnd() < 0.03) { x += 0.04 + rnd() * 0.06; continue; }
      if (rnd() < 0.06 && x + 0.22 < x1) {
        let yy = y;
        const w = 0.16 + rnd() * 0.05;
        for (let i = 0, n = 2 + Math.floor(rnd() * 3); i < n; i++) yy += book(x + w / 2, yy, zc, Math.PI / 2 + (rnd() - 0.5) * 0.2, 0.2, w, 0.025 + rnd() * 0.015, pick(BOOK_COVERS));
        x += w + 0.01;
        continue;
      }
      const t = 0.022 + rnd() * 0.03, h = Math.min(maxH, 0.2 + rnd() * 0.12), d = 0.17 + rnd() * 0.06;
      put(rbox(t, h, d, Math.min(0.004, t / 3), 2), spineMat(pick(SPINE_COLORS)), x + t / 2, y + h / 2, zc);
      box(pages, t - 0.004, 0.002, d - 0.012, x + t / 2, y + h + 0.0005, zc - 0.004);    // page tops
      x += t + 0.002;
    }
  };

  // ===== a studious room: bookcase, posters, whiteboard, shelves and a globe =====
  const BC = { z: -1.8, w: 2.4, h: 2.2, d: 0.34 };
  at(HW, 0, BC.z, -Math.PI / 2); // local x runs along the wall (+z), local z comes into the room
  put(rbox(BC.w, BC.h, 0.03, 0.01), M.body, 0, BC.h / 2, 0.015);
  for (const s of [-1, 1]) put(rbox(0.035, BC.h, BC.d, 0.01), M.gloss, s * (BC.w / 2 - 0.0175), BC.h / 2, BC.d / 2);
  const shelfY = [0.06, 0.5, 0.94, 1.38, 1.82, 2.2];
  for (const y of shelfY) put(rbox(BC.w, 0.03, BC.d, 0.008), M.gloss, 0, y - 0.015, BC.d / 2);
  for (let i = 0; i < shelfY.length - 1; i++) shelfBooks(-BC.w / 2 + 0.05, BC.w / 2 - 0.05, shelfY[i], shelfY[i + 1] - shelfY[i] - 0.05, BC.d / 2);
  decal(T.blob, 0.7, 2.6, 0.5, HW - 0.2, BC.z, { y: 0.0031 });

  const poster = (tex, w, h, z, y) => {
    at(HW, 0, z, -Math.PI / 2);
    put(rbox(w + 0.05, h + 0.05, 0.02, 0.006), M.darkMetal, 0, y, 0.01);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), S({ map: tex, roughness: 0.55, envMapIntensity: 0.6 }));
    m.rotation.y = -Math.PI / 2;
    loose(m, HW - 0.022, y, z);
  };
  poster(periodicTexture(), 1.3, 0.61, 1.0, 1.6);
  poster(solarTexture(), 0.56, 0.8, 2.25, 1.55);

  at(-3.15, 0, -HL); // whiteboard to the left of the screen
  put(rbox(1.46, 1.06, 0.03, 0.01), M.pale, 0, 1.6, 0.015);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.0), S({ map: whiteboardTexture(), roughness: 0.3, envMapIntensity: 0.7 }));
  loose(board, -3.15, 1.6, -HL + 0.032);
  put(rbox(1.2, 0.025, 0.07, 0.008), M.pale, 0, 1.06, 0.045);
  [0x2f4f7a, 0x8a3b4a, 0x1d2430].forEach((c, i) => put(new THREE.CylinderGeometry(0.009, 0.009, 0.12, 10), matOf(c), -0.35 + i * 0.16, 1.083, 0.05, 0, 0, Math.PI / 2));

  at(0, 0, HL, Math.PI); // shelves of books above the storage unit, and a globe
  for (const y of [1.45, 1.88]) {
    put(rbox(3.8, 0.035, 0.26, 0.012), M.gloss, 0, y - 0.018, 0.13);
    shelfBooks(-1.85, 1.85, y, 0.34, 0.13);
  }
  put(new THREE.CylinderGeometry(0.08, 0.09, 0.025, 24), M.darkMetal, -1.2, 0.955, 0.25);
  put(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 8), M.darkMetal, -1.2, 1.0, 0.25);
  const globe = new THREE.Mesh(new THREE.SphereGeometry(0.14, 32, 20), S({ map: globeTexture(), roughness: 0.4 }));
  globe.rotation.z = 0.4;
  loose(globe, 1.2, 1.19, HL - 0.25);
  put(new THREE.TorusGeometry(0.155, 0.006, 6, 40), M.darkMetal, -1.2, 1.19, 0.25, 0, Math.PI / 2, 0.4);

  // ===== front table that holds the headset =====
  at(TABLE.x, 0, TABLE.z);
  put(slab(roundedRect(new THREE.Shape(), -TABLE.w / 2, -TABLE.d / 2, TABLE.w, TABLE.d, 0.2), 0.06, 0.014, 20), M.gloss, 0, TABLE.top, 0);
  put(rbox(0.9, TABLE.top - 0.06, 0.32, 0.05), M.body, 0, (TABLE.top - 0.06) / 2, 0);
  box(M.holoSolid, TABLE.w - 0.36, 0.006, 0.006, 0, TABLE.top - 0.075, TABLE.d / 2 - 0.07);
  { let y = TABLE.top; for (let i = 0; i < 3; i++) y += book(-0.55, y, 0.05 * (i - 1), 0.15 * (i - 1), 0.2, 0.27, 0.03, BOOK_COVERS[i * 3 % BOOK_COVERS.length]); }
  decal(T.softRect, 2.2, 1.4, 0.18, TABLE.x, TABLE.z, { color: PALETTE.holo, additive: true });
  decal(T.blob, 2.0, 1.1, 0.7, TABLE.x, TABLE.z, { y: 0.003 });

  // ===== futuristic desk gadgets =====
  const holoWire = new THREE.MeshBasicMaterial({ color: PALETTE.holo, wireframe: true, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, fog: false });
  const holoFill = new THREE.MeshBasicMaterial({ color: PALETTE.holo, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
  const miniBeam = new THREE.MeshBasicMaterial({ map: T.beam, color: PALETTE.holo, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false });
  const hologram = (kind) => {
    const g = new THREE.Group();
    if (kind === 0) { // molecule
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 8), holoFill));
      for (let a = 0; a < 4; a++) {
        const v = new THREE.Vector3(Math.cos(a * 1.9), Math.sin(a * 2.3) * 0.8, Math.sin(a * 1.9)).normalize().multiplyScalar(0.055);
        const atom = new THREE.Mesh(new THREE.SphereGeometry(0.013, 10, 6), holoFill); atom.position.copy(v); g.add(atom);
        const bond = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.055, 6), holoWire);
        bond.position.copy(v).multiplyScalar(0.5); bond.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize()); g.add(bond);
      }
    } else if (kind === 1) { // planet with a ring
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), holoWire));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.003, 4, 40), holoFill); ring.rotation.x = 1.2; g.add(ring);
    } else if (kind === 2) {
      g.add(new THREE.Mesh(new THREE.TorusKnotGeometry(0.035, 0.009, 64, 8), holoWire));
    } else { // DNA helix
      for (let i = 0; i < 14; i++) {
        const y = -0.06 + i * 0.009, a = i * 0.6;
        for (const s of [0, Math.PI]) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 4), holoFill); b.position.set(Math.cos(a + s) * 0.025, y, Math.sin(a + s) * 0.025); g.add(b); }
      }
    }
    return g;
  };
  const glassesGeo = new THREE.TorusGeometry(0.022, 0.004, 6, 18);
  const gadgets = (i) => {
    if (i % 4 === 0) { // mini hologram projector
      put(new THREE.CylinderGeometry(0.045, 0.05, 0.014, 28), M.black, 0.38, DESK_TOP + 0.007, -0.17);
      put(new THREE.TorusGeometry(0.038, 0.003, 6, 32), M.holoSolid, 0.38, DESK_TOP + 0.015, -0.17, Math.PI / 2);
      placed(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.03, 0.12, 24, 1, true), miniBeam), 0.38, DESK_TOP + 0.075, -0.17);
      const holo = placed(hologram((i / 4) % 4), 0.38, DESK_TOP + 0.17, -0.17);
      const y0 = holo.position.y;
      animated.push((t, dt) => { holo.rotation.y += dt * 0.8; holo.position.y = y0 + Math.sin(t * 1.6 + i) * 0.008; });
    }
    if (i % 4 === 2) { // standing glass tablet with lesson notes
      put(rbox(0.26, 0.17, 0.006, 0.004), M.glass, 0.3, DESK_TOP + 0.1, -0.17, -0.25);
      put(rbox(0.12, 0.01, 0.05, 0.004), M.darkMetal, 0.3, DESK_TOP + 0.005, -0.18);
      const ui = new THREE.MeshBasicMaterial({ map: deskHoloTexture(i), transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
      placed(new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.16), ui), 0.3, DESK_TOP + 0.1, -0.166, -0.25);
    }
    put(new THREE.CapsuleGeometry(0.004, 0.12, 3, 8), M.pale, 0.33, DESK_TOP + 0.004, 0.2, 0, 0.4, Math.PI / 2); // stylus
    put(new THREE.SphereGeometry(0.0045, 8, 6), M.holoSolid, 0.33 - Math.cos(0.4) * 0.064, DESK_TOP + 0.004, 0.2 + Math.sin(0.4) * 0.064);
    if (i % 3 === 1) { // earbuds case
      put(superquadric(0.032, 0.016, 0.022, 0.6, 0.5, 16, 8), M.pale, 0.43, DESK_TOP + 0.016, 0.06);
      put(new THREE.SphereGeometry(0.003, 6, 4), M.holoSolid, 0.43, DESK_TOP + 0.02, 0.083);
    }
    if (i % 5 === 3) { // AR glasses, folded on the desk
      for (const s of [-1, 1]) put(glassesGeo, M.black, 0.05 + s * 0.028, DESK_TOP + 0.006, -0.2, Math.PI / 2);
      put(UNIT_BROW, M.holoSolid, 0.05, DESK_TOP + 0.006, -0.2, 0, 0, 0, [0.02, 0.004, 0.004]);
    }
  };

  // ===== desks, chairs and classmates =====
  let k = 0;
  ROWS.forEach((z, ri) => COLS.forEach((x, ci) => {
    at(x, 0, z);
    put(slab(roundedRect(new THREE.Shape(), -0.525, -0.29, 1.05, 0.58, 0.1), 0.045, 0.012, 16), M.gloss, 0, DESK_TOP, 0);
    for (const s of [-1, 1]) put(rbox(0.07, DESK_TOP - 0.05, 0.42, 0.03), M.satin, s * 0.42, (DESK_TOP - 0.05) / 2, 0);
    box(M.holoSolid, 0.9, 0.005, 0.005, 0, DESK_TOP - 0.05, 0.27);
    put(rbox(0.32, 0.008, 0.22, 0.004), M.black, 0.16, DESK_TOP + 0.004, 0.04, 0, -0.1);            // built-in tablet
    deskBooks(ri * COLS.length + ci);
    gadgets(ri * COLS.length + ci);
    decal(T.blob, 1.4, 0.9, 0.5, x, z, { y: 0.0032 });

    at(x, 0, z + SEAT_BACK);
    put(superquadric(0.21, 0.035, 0.2, 0.7, 0.4, 24, 10), M.fabricDark, 0, 0.46, 0);
    put(rbox(0.42, 0.42, 0.04, 0.02), M.satin, 0, 0.72, 0.2, 0.12);
    put(new THREE.LatheGeometry(profile([[0.24, 0], [0.24, 0.012], [0.1, 0.03], [0.03, 0.06], [0.025, 0.4], [0.06, 0.44]]), 28), M.darkMetal, 0, 0, 0);
    decal(T.blob, 0.75, 0.75, 0.6, x, z + SEAT_BACK, { y: 0.0034 });

    if ((ci === PLAYER.col && ri === PLAYER.row) || EMPTY.has(`${ci},${ri}`)) return;
    const o = OUTFITS[k % OUTFITS.length];
    seatedFigure(put, nest, {
      style: o.style,
      top: matOf(o.top, true),
      trim: matOf(o.trim, true),
      legs: matOf(o.legs, true),
      shoes: matOf(o.shoes),
      skin: matOf(SKIN[k % SKIN.length]),
      hair: matOf(HAIR[(k * 5) % HAIR.length]),
      hairStyle: HAIRSTYLES[k % HAIRSTYLES.length],
      expression: EXPRESSIONS[k % EXPRESSIONS.length],
      reading: k % 4 === 3,
      face: { white: matOf(0xf2efe9), iris: matOf(IRIS[k % IRIS.length]), glint: M.lampCore, lip: matOf(0x9a5a55), blush: matOf(0xe39a92) },
    });
    k++;
  }));

  // ===== on the floor: backpacks, plants, a beanbag corner =====
  const backpack = (x, z, ry, color, trim) => nest(x, 0, z, 0, ry, 0, () => {
    const main = matOf(color, true), accent = matOf(trim, true);
    put(superquadric(0.15, 0.2, 0.09, 0.6, 0.5, 20, 12), main, 0, 0.2, 0, -0.12);
    put(superquadric(0.11, 0.09, 0.04, 0.6, 0.5, 16, 8), accent, 0, 0.13, 0.08, -0.12);
    put(new THREE.TorusGeometry(0.04, 0.009, 6, 14, Math.PI), accent, 0, 0.38, -0.03);
    for (const s of [-1, 1]) put(new THREE.CapsuleGeometry(0.012, 0.24, 3, 8), accent, s * 0.07, 0.22, -0.1, -0.1);
    box(M.holoSolid, 0.16, 0.006, 0.004, 0, 0.26, 0.085); // reflective strip
  });
  // [column, row, side] beside chairs, always on the side away from the centre aisle
  [[0, 0, -1, 0x3f7f8c, 0x2b3442], [3, 0, 1, 0xd2a24c, 0x39485c], [2, 1, 1, 0x8a3b4a, 0xe9e4da], [0, 2, -1, 0x6b5ca5, 0xd9d4ca],
    [1, 2, -1, 0x2f4f7a, 0xa7c7e7], [3, 2, 1, 0x3a6b52, 0xe6e1d6], [3, 1, 1, 0xd9776a, 0x2f3a49]].forEach(([ci, ri, side, c, tr], i) => {
    at(0, 0, 0);
    backpack(COLS[ci] + side * 0.42, ROWS[ri] + SEAT_BACK + 0.05, side * (1.2 + i * 0.2), c, tr);
  });
  const tallPlant = (x, z, h) => {
    at(x, 0, z);
    put(new THREE.LatheGeometry(profile([[0, 0], [0.16, 0], [0.2, 0.05], [0.22, 0.45], [0.2, 0.46], [0.19, 0.42], [0, 0.42]]), 28), M.gloss, 0, 0, 0);
    for (let i = 0; i < 22; i++) {
      const a = rnd() * Math.PI * 2, r = 0.04 + rnd() * 0.08, y = 0.5 + rnd() * h;
      put(new THREE.CylinderGeometry(0.005, 0.007, y - 0.42, 5), M.plant, Math.cos(a) * r * 0.5, 0.42 + (y - 0.42) / 2, Math.sin(a) * r * 0.5);
      put(leaf, M.plant, Math.cos(a) * r, y, Math.sin(a) * r, 0, a, 0.5 + rnd() * 0.6, 0.18 + rnd() * 0.1);
    }
    decal(T.blob, 0.8, 0.8, 0.6, x, z, { y: 0.0033 });
  };
  tallPlant(3.55, -4.05, 0.8);
  tallPlant(-3.6, -4.0, 0.55);
  at(-3.35, 0, 3.85); // beanbag reading corner
  put(displaceY(superquadric(0.42, 0.24, 0.4, 0.8, 0.7, 28, 16), (x, y, z) => (y > 0.1 ? -0.06 * Math.exp(-(x * x + z * z) * 12) : 0)), matOf(0xd2a24c, true), 0, 0.22, 0);
  put(superquadric(0.18, 0.06, 0.16, 0.7, 0.6, 16, 8), matOf(0x3f7f8c, true), 0.5, 0.06, 0.15, 0, 0.5);
  decal(T.blob, 1.2, 1.2, 0.6, -3.35, 3.85, { y: 0.0033 });

  solid.build(root);

  // hoverboard floating by the back wall, with its glow underneath
  const hover = new THREE.Group();
  hover.add(new THREE.Mesh(superquadric(0.4, 0.025, 0.12, 0.5, 0.4, 32, 8), M.satin));
  const boardStrip = new THREE.Mesh(rbox(0.6, 0.006, 0.012, 0.003), M.holoSolid); boardStrip.position.y = -0.02; hover.add(boardStrip);
  hover.position.set(3.3, 0.16, 3.85); hover.rotation.y = 0.35;
  root.add(hover);
  const boardGlow = decal(T.halo, 1.0, 0.45, 0.45, 3.3, 3.85, { color: PALETTE.holo, additive: true, y: 0.005 });
  boardGlow.rotation.z = 0.35;
  animated.push((t) => { hover.position.y = 0.16 + Math.sin(t * 1.4) * 0.025; hover.rotation.z = Math.sin(t * 0.9) * 0.03; });

  // robot floor cleaner resting near the front, its sensor turning
  const robot = new THREE.Group();
  robot.position.set(-2.0, 0, -2.45);
  root.add(robot);
  const robotBody = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 40), M.pale); robotBody.position.y = 0.035;
  const robotRing = new THREE.Mesh(new THREE.TorusGeometry(0.168, 0.004, 6, 48), M.holoSolid); robotRing.rotation.x = Math.PI / 2; robotRing.position.y = 0.05;
  const sensor = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.025, 20), M.black); sensor.position.y = 0.078;
  const sensorDot = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.008, 0.02), M.holoSolid); sensorDot.position.set(0.03, 0.09, 0);
  robot.add(robotBody, robotRing, sensor, sensorDot);
  robotBody.castShadow = true;
  decal(T.blob, 0.5, 0.5, 0.6, -2.0, -2.45, { y: 0.0035 });
  animated.push((t, dt) => { sensor.rotation.y += dt * 3; sensorDot.position.set(Math.cos(t * 3) * 0.03, 0.09, -Math.sin(t * 3) * 0.03); sensorDot.rotation.y = t * 3; });

  // ===== classroom screen on the front wall =====
  const screenMat = new THREE.MeshBasicMaterial({ map: screenTexture(), transparent: true, opacity: 0.92, depthWrite: false, toneMapped: false, fog: false });
  loose(new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.w, SCREEN.h), screenMat), 0, SCREEN.y, -HL + 0.06);
  loose(new THREE.Mesh(rbox(SCREEN.w - 0.4, 0.014, 0.035, 0.005), M.holoSolid), 0, SCREEN.y - SCREEN.h / 2 - 0.08, -HL + 0.04);
  glow(PALETTE.holo, 4.2, 0.12, 0, SCREEN.y, -HL + 0.3);

  // ===== teacher =====
  const teacher = buildTeacher(M, matOf);
  teacher.group.position.set(TEACHER.x, 0, TEACHER.z);
  root.add(teacher.group);
  decal(T.blob, 0.8, 0.8, 0.7, TEACHER.x, TEACHER.z, { y: 0.0036 });
  const tch = { speaking: false, yaw: 0, talk: 0 };

  // ===== Echo headset on its pad, under a cone of light =====
  const pad = new THREE.Group();
  pad.position.set(TABLE.x, TABLE.top, TABLE.z);
  root.add(pad);
  const padDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.175, 0.01, 48), M.black);
  padDisc.position.y = 0.005; padDisc.receiveShadow = true;
  const padRingMat = M.holo.clone();
  const padRing = new THREE.Mesh(new THREE.RingGeometry(0.152, 0.158, 56), padRingMat);
  padRing.rotation.x = -Math.PI / 2; padRing.position.y = 0.0106;
  const haloMat = new THREE.MeshBasicMaterial({ map: T.halo, color: PALETTE.holo, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), haloMat);
  halo.rotation.x = -Math.PI / 2; halo.position.y = 0.011;
  const BEAM_H = 0.55;
  const beamMat = new THREE.MeshBasicMaterial({ map: T.beam, color: PALETTE.holo, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.06, BEAM_H, 32, 1, true), beamMat);
  beam.position.y = 0.02 + BEAM_H / 2;
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.3, 0.42), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.12; hit.name = 'headset';
  pad.add(padDisc, padRing, halo, beam, hit);
  const headset = createEchoHeadset(M);
  headset.position.set(TABLE.x, TABLE.top + 0.012, TABLE.z);
  root.add(headset);
  const hsLight = new THREE.PointLight(PALETTE.holo, 0.8, 2.2, 2);
  hsLight.position.set(TABLE.x, TABLE.top + 0.35, TABLE.z + 0.1);
  root.add(hsLight);
  const hs = { highlighted: false, collected: false, flash: -1 };

  // ===== city outside the window (the bedroom's skyline, turned to face the left wall) =====
  const cityRoot = new THREE.Group();
  cityRoot.rotation.y = Math.PI / 2;
  root.add(cityRoot);
  const updateCity = buildCity(cityRoot, T);
  const daySky = daySkyTexture(), dayCity = dayCityTexture();
  cityRoot.traverse((o) => {
    const m = o.material;
    if (!o.isMesh || !m) return;
    if (m.map === T.sky) m.map = daySky;
    else if (m.map === T.city) m.map = dayCity;
    else if (m.color && m.color.getHex() === 0x1a2129) m.color.set(0x7d8a9b); // saucer hulls in daylight
    m.needsUpdate = true;
  });

  // ===== lights =====
  root.add(new THREE.HemisphereLight(0xbcd4ee, 0x3a4250, 2.4));
  const windowLight = new THREE.DirectionalLight(0xfff1dc, 3.0); // morning sun through the window
  windowLight.position.set(-9, 6.5, 1.5);
  windowLight.target.position.set(0, 0, 0);
  windowLight.castShadow = true;
  windowLight.shadow.mapSize.set(2048, 2048);
  Object.assign(windowLight.shadow.camera, { left: -6.5, right: 6.5, top: 6.5, bottom: -6.5, near: 1, far: 22 });
  windowLight.shadow.bias = -0.0004;
  windowLight.shadow.normalBias = 0.015;
  root.add(windowLight, windowLight.target);
  const screenLight = new THREE.PointLight(PALETTE.holo, 2.2, 6, 2);
  screenLight.position.set(0, SCREEN.y, -HL + 0.7);
  root.add(screenLight);
  for (const z of [-1.5, 1.8]) {
    const fill = new THREE.PointLight(0xe8eef6, 1.3, 7, 2);
    fill.position.set(0, HT - 0.3, z);
    root.add(fill);
  }

  // ===== collisions (x/z rectangles) =====
  const colliders = [
    { minX: TABLE.x - TABLE.w / 2, maxX: TABLE.x + TABLE.w / 2, minZ: TABLE.z - TABLE.d / 2, maxZ: TABLE.z + TABLE.d / 2 },
    { minX: TEACHER.x - 0.3, maxX: TEACHER.x + 0.3, minZ: TEACHER.z - 0.3, maxZ: TEACHER.z + 0.3 },
    { minX: -2.8, maxX: 2.8, minZ: HL - 0.5, maxZ: HL },  // storage unit
    { minX: HW - 0.36, maxX: HW, minZ: BC.z - BC.w / 2, maxZ: BC.z + BC.w / 2 }, // bookcase
    { minX: 3.3, maxX: HW, minZ: -HL, maxZ: -3.8 },      // plant, front right
    { minX: -HW, maxX: -3.35, minZ: -HL, maxZ: -3.75 },  // plant, front left
    { minX: -HW, maxX: -2.85, minZ: 3.4, maxZ: HL },     // beanbag
    { minX: 2.85, maxX: HW, minZ: 3.6, maxZ: HL },       // hoverboard
    { minX: -2.2, maxX: -1.8, minZ: -2.65, maxZ: -2.25 }, // robot cleaner
  ];
  ROWS.forEach((z, ri) => COLS.forEach((x, ci) => {
    const mine = ci === PLAYER.col && ri === PLAYER.row; // the player's own chair is not a wall
    colliders.push({ minX: x - 0.53, maxX: x + 0.53, minZ: z - 0.3, maxZ: mine ? z + 0.3 : z + SEAT_BACK + 0.25 });
  }));

  // spawn: in your seat at the back, facing the screen
  const spawn = { x: COLS[PLAYER.col], z: ROWS[PLAYER.row] + 0.62, yaw: 0 };

  const _v = new THREE.Vector3();
  return {
    root,
    spawn,
    isBlocked(x, z, r = 0.25) {
      if (x < -HW + r || x > HW - r || z < -HL + r || z > HL - r) return true;
      return colliders.some((c) => x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r);
    },
    headset: {
      group: headset,
      hit,
      beamTop: 0.02 + BEAM_H, // height above the table where the instruction card sits
      worldPosition: (out) => pad.getWorldPosition(out),
      setHighlighted(on) { hs.highlighted = on; },
      collect() { hs.collected = true; hs.highlighted = false; hs.flash = 0; },
    },
    teacher: {
      headPosition: (out) => teacher.head.getWorldPosition(out),
      setSpeaking(on) { tch.speaking = on; },
    },
    // head: the player's head position, so the teacher can face them
    update(t, dt, head) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
      beam.visible = !hs.collected;
      beamMat.opacity = (hs.highlighted ? 0.55 : 0.32) + 0.2 * pulse;
      padRingMat.opacity = hs.collected ? 0.25 : hs.highlighted ? 1 : 0.35 + 0.5 * pulse;
      haloMat.opacity = hs.collected ? 0.08 : hs.highlighted ? 0.75 + 0.2 * pulse : 0.2 + 0.3 * pulse;
      hsLight.intensity = hs.collected ? 0 : hs.highlighted ? 1.6 : 0.6 + 0.4 * pulse;
      halo.scale.setScalar(1);
      if (hs.flash >= 0) {
        hs.flash += dt / 0.6;
        const e = Math.min(1, hs.flash);
        halo.scale.setScalar(1 + 4 * e);
        haloMat.opacity = 0.9 * (1 - e);
        if (hs.flash >= 1) hs.flash = -1;
      }
      if (!hs.collected) { // the headset turns slowly on its pad
        headset.rotation.y += dt * 0.5;
        headset.position.y = TABLE.top + 0.02 + Math.sin(t * 1.8) * 0.008;
      }
      screenMat.opacity = 0.88 + 0.05 * Math.sin(t * 1.3);

      // teacher: turn to face the player, gesture while speaking
      if (head) {
        teacher.group.getWorldPosition(_v);
        const want = Math.atan2(head.x - _v.x, head.z - _v.z);
        let d = want - tch.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        tch.yaw += d * Math.min(1, dt * 3);
        teacher.group.rotation.y = tch.yaw;
      }
      tch.talk += (tch.speaking ? 1 : -1) * dt * 3;
      tch.talk = Math.min(1, Math.max(0, tch.talk));
      teacher.shoulder.rotation.x = -tch.talk * (0.55 + 0.25 * Math.sin(t * 4.2));
      teacher.shoulder.rotation.z = tch.talk * 0.25;
      teacher.head.position.y = 1.73 + tch.talk * 0.008 * Math.sin(t * 9);
      teacher.talking.visible = tch.speaking;
      teacher.smile.visible = !tch.speaking;
      teacher.talking.scale.y = 0.25 + 0.6 * Math.abs(Math.sin(t * 11));
      updateCity(t, dt);
      for (const a of animated) a(t, dt);
    },
  };
}
