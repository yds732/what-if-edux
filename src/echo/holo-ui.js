// World-space holographic UI: one canvas-textured panel with clickable buttons,
// plus small static cards. Buttons are found from the ray hit's UV, so the same
// code works for VR controller rays and the desktop mouse.
import * as THREE from 'three';
import { SCRIPT } from './story.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const C = {
  panel: 'rgba(37,44,54,0.86)',
  edge: 'rgba(167,199,231,0.85)',
  text: '#CBD0D5',
  muted: '#8f96a1',
  holo: '#A7C7E7',
  button: 'rgba(57,68,82,0.92)',
  buttonHover: 'rgba(80,96,115,0.96)',
  bubble: 'rgba(57,68,82,0.78)',
  bubbleYou: 'rgba(167,199,231,0.22)',
};
const REVEAL_CPS = 38; // characters per second for the text reveal

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { canvas, ctx, texture };
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function setFont(ctx, size, weight = 400, italic = false) {
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${FONT}`;
}

function wrap(ctx, str, maxW) {
  const lines = [];
  let line = '';
  for (const word of str.split(' ')) {
    const test = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(test).width > maxW) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function drawFrame(ctx, W, H, radius = 40) {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.shadowColor = 'rgba(167,199,231,0.5)';
  ctx.shadowBlur = 26;
  rr(ctx, 16, 16, W - 32, H - 32, radius);
  ctx.fillStyle = C.panel;
  ctx.fill();
  ctx.restore();
  rr(ctx, 16, 16, W - 32, H - 32, radius);
  ctx.lineWidth = 3;
  ctx.strokeStyle = C.edge;
  ctx.stroke();
}

// ---------- small static card (instruction, "Tap to interact") ----------
export function createHoloCard({ width, height, lines, px = 800 }) {
  const W = px;
  const H = Math.round((px * height) / width);
  const { ctx, texture } = makeCanvas(W, H);
  drawFrame(ctx, W, H, Math.min(36, H * 0.3));
  const gap = 14;
  const total = lines.reduce((sum, l) => sum + l.size, 0) + gap * (lines.length - 1);
  let y = (H - total) / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const l of lines) {
    setFont(ctx, l.size, l.weight ?? 400, l.italic);
    ctx.letterSpacing = `${l.spacing ?? 0}px`;
    ctx.fillStyle = l.color ?? C.text;
    ctx.fillText(l.text, W / 2, y + l.size / 2);
    y += l.size + gap;
  }
  texture.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
}

// ---------- main message panel ----------
export function createHoloPanel({ width = 1.5, height = 1.0, px = 1200 } = {}) {
  const W = px;
  const H = Math.round((px * height) / width);
  const { ctx, texture } = makeCanvas(W, H);
  const material = new THREE.MeshBasicMaterial({
    map: texture, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.renderOrder = 20; // drawn after the dimming layer
  mesh.name = 'holoPanel';

  const s = {
    mode: 'notification', hover: null, selected: null,
    reveal: 0, onRevealDone: null, buttonsOn: false, buttonsAlpha: 0,
    choice: null, replyOn: false, replyReveal: 0, end: null, clock: 0,
  };
  let buttons = [];
  let dirty = true;

  function text(str, x, y, { size = 40, weight = 400, color = C.text, align = 'left', italic = false, spacing = 0 } = {}) {
    setFont(ctx, size, weight, italic);
    ctx.letterSpacing = `${spacing}px`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(str, x, y);
    ctx.letterSpacing = '0px';
  }

  function messageIcon(cx, cy, k = 1) {
    const w = 96 * k, h = 66 * k;
    ctx.save();
    ctx.lineWidth = 4 * k;
    ctx.strokeStyle = C.holo;
    ctx.lineJoin = 'round';
    rr(ctx, cx - w / 2, cy - h / 2, w, h, 16 * k);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.22, cy + h / 2);
    ctx.lineTo(cx - w * 0.3, cy + h / 2 + 16 * k);
    ctx.lineTo(cx - w * 0.04, cy + h / 2);
    ctx.stroke();
    ctx.fillStyle = C.holo;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.arc(cx + i * 20 * k, cy, 4.5 * k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function header() {
    messageIcon(104, 88, 0.6);
    text(SCRIPT.message.header, 160, 102, { size: 36, weight: 700, color: C.holo, spacing: 3 });
    ctx.fillStyle = 'rgba(167,199,231,0.3)';
    ctx.fillRect(70, 148, W - 140, 2);
  }

  function button({ id, x, y, w, h, label, sub = null, alpha = 1, labelSize = 46 }) {
    const sel = s.selected === id;
    const other = s.selected && !sel;
    const hover = !s.selected && s.hover === id;
    ctx.save();
    ctx.globalAlpha = alpha * (other ? 0.35 : 1);
    if (hover || sel) {
      ctx.shadowColor = 'rgba(167,199,231,0.9)';
      ctx.shadowBlur = sel ? 42 : 30;
    }
    rr(ctx, x, y, w, h, 26);
    ctx.fillStyle = sel ? 'rgba(167,199,231,0.34)' : hover ? C.buttonHover : C.button;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = hover || sel ? 4 : 2;
    ctx.strokeStyle = hover || sel ? C.holo : 'rgba(167,199,231,0.45)';
    ctx.stroke();
    if (sub) {
      text(label, x + w / 2, y + h * 0.42, { size: labelSize, weight: 700, align: 'center' });
      setFont(ctx, 29, 400, true);
      wrap(ctx, sub, w - 50).forEach((ln, i) => text(ln, x + w / 2, y + h * 0.42 + 50 + i * 36, { size: 29, italic: true, color: C.muted, align: 'center' }));
    } else {
      text(label, x + w / 2, y + h / 2 + labelSize * 0.34, { size: labelSize, weight: 700, align: 'center', spacing: 2 });
    }
    ctx.restore();
    buttons.push({ id, x, y, w, h, enabled: alpha > 0.6 && !s.selected });
  }

  // Draws `str` wrapped, showing only the first `count` characters.
  function revealed(str, x, y, maxW, count, { size, weight = 500, lineH }) {
    setFont(ctx, size, weight);
    let left = Math.floor(count);
    const lines = wrap(ctx, str, maxW);
    lines.forEach((ln, i) => {
      if (left > 0) text(ln.slice(0, left), x, y + i * lineH, { size, weight });
      left -= ln.length + 1;
    });
    return lines.length;
  }

  function chat(str, side, y, label, count = Infinity) {
    setFont(ctx, 42, 500);
    const w = Math.min(900, ctx.measureText(str).width + 76);
    const x = side === 'right' ? W - 70 - w : 70;
    text(label, side === 'right' ? W - 78 : 78, y - 14, { size: 26, weight: 700, color: C.holo, align: side, spacing: 3 });
    rr(ctx, x, y, w, 92, 28);
    ctx.fillStyle = side === 'right' ? C.bubbleYou : C.bubble;
    ctx.fill();
    text(str.slice(0, Math.floor(Math.min(count, str.length))), x + 38, y + 60, { size: 42, weight: 500 });
  }

  function drawNotification() {
    const n = SCRIPT.notification;
    text(n.title, W / 2, 128, { size: 36, weight: 700, color: C.holo, align: 'center', spacing: 8 });
    messageIcon(W / 2, 222);
    text(n.from, W / 2, 352, { size: 62, weight: 700, align: 'center' });
    setFont(ctx, 38, 400, true);
    wrap(ctx, n.body, 920).forEach((ln, i) => text(ln, W / 2, 428 + i * 50, { size: 38, italic: true, color: C.text, align: 'center' }));
    button({ id: 'check', x: W / 2 - 290, y: 548, w: 580, h: 128, label: n.button });
  }

  function drawMessage() {
    header();
    rr(ctx, 70, 186, W - 140, 236, 28);
    ctx.fillStyle = C.bubble;
    ctx.fill();
    const full = SCRIPT.message.text;
    revealed(full, 112, 276, W - 224, s.reveal, { size: 50, lineH: 68 });
    if (s.reveal < full.length && Math.floor(s.clock * 3) % 2 === 0) {
      ctx.fillStyle = C.holo;
      ctx.fillRect(1090, 380, 14, 14);
    }
    if (s.buttonsAlpha > 0) {
      SCRIPT.choices.forEach((c, i) => button({ id: c.id, x: 70 + i * 545, y: 500, w: 515, h: 204, label: c.label, sub: c.subtitle, alpha: s.buttonsAlpha }));
    }
  }

  function drawReply() {
    header();
    rr(ctx, 70, 178, W - 140, 148, 28);
    ctx.fillStyle = C.bubble;
    ctx.fill();
    revealed(SCRIPT.message.text, 108, 240, W - 216, Infinity, { size: 38, weight: 400, lineH: 50 });
    chat(`"${s.choice.you}"`, 'right', 398, 'YOU');
    if (s.replyOn) chat(`"${s.choice.jamie}"`, 'left', 566, 'JAMIE', s.replyReveal + 1);
  }

  function drawEnd() {
    const e = s.end;
    text(e.title, W / 2, 300, { size: 64, weight: 700, align: 'center' });
    setFont(ctx, 36, 400);
    wrap(ctx, e.body, 940).forEach((ln, i) => text(ln, W / 2, 380 + i * 48, { size: 36, color: C.text, align: 'center' }));
    if (e.note) text(e.note, W / 2, 492, { size: 28, italic: true, color: C.muted, align: 'center' });
    if (e.replay) button({ id: 'replay', x: W / 2 - 210, y: 566, w: 420, h: 104, label: 'Replay scene', labelSize: 38 });
  }

  function draw() {
    buttons = [];
    drawFrame(ctx, W, H);
    if (s.mode === 'notification') drawNotification();
    else if (s.mode === 'message') drawMessage();
    else if (s.mode === 'reply') drawReply();
    else if (s.mode === 'end') drawEnd();
    texture.needsUpdate = true;
  }

  return {
    mesh,
    get opacity() { return material.opacity; },
    set opacity(v) { material.opacity = v; },
    get mode() { return s.mode; },
    // modes: 'notification' | 'message' | 'reply' | 'end'
    setMode(mode, opts = {}) {
      Object.assign(s, {
        mode, hover: null, selected: null, reveal: 0, buttonsOn: false, buttonsAlpha: 0, replyOn: false, replyReveal: 0,
        onRevealDone: opts.onRevealDone ?? null, choice: opts.choice ?? null, end: mode === 'end' ? opts : null,
      });
      dirty = true;
    },
    showButtons() { s.buttonsOn = true; },
    select(id) { s.selected = id; dirty = true; },
    showReply() { s.replyOn = true; s.replyReveal = 0; dirty = true; },
    setHover(id) { if (id !== s.hover) { s.hover = id; dirty = true; } },
    // uv comes from the raycast hit on this panel. Returns a button id or null.
    hitTest(uv) {
      if (!uv) return null;
      const x = uv.x * W;
      const y = (1 - uv.y) * H;
      const b = buttons.find((k) => k.enabled && x >= k.x && x <= k.x + k.w && y >= k.y && y <= k.y + k.h);
      return b ? b.id : null;
    },
    update(dt) {
      s.clock += dt;
      if (s.mode === 'message') {
        const len = SCRIPT.message.text.length;
        if (s.reveal < len) {
          s.reveal = Math.min(len, s.reveal + dt * REVEAL_CPS);
          dirty = true;
          if (s.reveal >= len) {
            const done = s.onRevealDone;
            s.onRevealDone = null;
            if (done) done();
          }
        }
        if (s.buttonsOn && s.buttonsAlpha < 1) {
          s.buttonsAlpha = Math.min(1, s.buttonsAlpha + dt * 3);
          dirty = true;
        }
      } else if (s.mode === 'reply' && s.replyOn && s.replyReveal < s.choice.jamie.length + 1) {
        s.replyReveal += dt * REVEAL_CPS;
        dirty = true;
      }
      if (dirty) {
        dirty = false;
        draw();
      }
    },
  };
}
