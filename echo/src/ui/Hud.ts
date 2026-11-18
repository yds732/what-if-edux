import * as THREE from 'three';
import { clamp } from '../core/math';
import { Cancelled, Signal } from '../core/tasks';
import { ACTION_LABELS, type Input, type InputMode } from '../input/Input';
import { KEYBINDS, type Hints } from '../story/script';
import { THEMES, displayFont, fade, font, glass, keyCap, roundRect, spaced, sparkle, wrap, type Theme, type ThemeName } from './draw';
import { Widget } from './Panel';

export interface SubtitleLine {
  readonly speaker: string;
  readonly color: string;
  readonly text: string;
}

export interface ChoiceOption {
  readonly title: string;
  readonly detail?: string;
  readonly emphasis?: 'loud' | 'quiet';
}

interface Painted {
  readonly widget: Widget;
  repaint(): void;
}

const PAD = 26;
const SHEET_DISTANCE = 1.35, SHEET_SCALE = 0.00155;

export class Hud {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  readonly root = new THREE.Group();
  theme: Theme = THEMES.real;

  private vw = 1280;
  private vh = 720;
  private uiScale = 1;
  private density = 2;
  private readonly items: Painted[] = [];
  private mode: InputMode = 'mouse';
  private time = 0;

  private readonly reticle = this.add(new Widget(56, 56), () => this.paintReticle());
  private readonly prompt = this.add(new Widget(520, 64 + PAD * 2), () => this.paintPrompt());
  private readonly objective = this.add(new Widget(470, 78 + PAD * 2), () => this.paintObjective());
  private readonly subtitle = this.add(new Widget(900, 150 + PAD * 2), () => this.paintSubtitle());
  private readonly card = this.add(new Widget(1100, 300), () => this.paintCard());
  private readonly result = this.add(new Widget(760, 300 + PAD * 2), () => this.paintResult());
  private readonly toast = this.add(new Widget(430, 84 + PAD * 2), () => this.paintToast());
  private readonly reflection = this.add(new Widget(1000, 260), () => this.paintReflection());
  private readonly counter = this.add(new Widget(330, 62 + PAD * 2), () => this.paintCounter());
  private readonly hint = this.add(new Widget(440, 150 + PAD * 2), () => this.paintHint());
  private readonly keysTip = this.add(new Widget(300, 34 + PAD * 2), () => this.paintKeysTip());
  private readonly choiceTitle = this.add(new Widget(900, 90), () => this.paintChoiceTitle());
  private readonly options: Painted[] = [];

  private focused = false;
  private promptText = '';
  private promptAction: keyof (typeof ACTION_LABELS)['mouse'] = 'interact';
  private objectiveText = '';
  private objectiveDone = false;
  private sideTasks: string[] = [];
  readonly onHover = new Signal();
  private reticleWanted = true;
  private sub: { line: SubtitleLine; lines: string[]; chars: number; total: number; waiting: boolean } | null = null;
  private cardText = { title: '', subtitle: '' };
  private resultData: { heading: string; gained: string; missed: string } = { heading: '', gained: '', missed: '' };
  private toastData = { title: '', body: '' };
  private reflectionLines: string[] = [];
  private counterData = { label: '', value: 0, total: 3, pulse: 0 };
  private hints: Hints | null = null;
  private storyHints: Hints | null = null;
  private controlsOpen = false;
  private inPlay = false;
  private choice: { title: string; options: ChoiceOption[]; hover: number; pick: ((i: number) => void) | null } | null = null;
  private lastSubPaint = -1;
  private follow: THREE.Camera | null = null;
  private ray: THREE.Ray | null = null;
  private rayPoint: { x: number; y: number } | null = null;
  private lastSize: [number, number, number] = [1280, 720, 1];
  private readonly plane = new THREE.Plane();

  constructor(private readonly input: Input) {
    this.scene.add(this.root);
    this.reticle.widget.slide = 0;
    this.card.widget.slide = 0;
    this.card.widget.rate = 2.6;
    this.reflection.widget.rate = 1.6;
    this.reflection.widget.slide = 6;
    this.result.widget.rate = 5;
    this.toast.widget.slide = -14;
    input.onModeChange.on((m) => {
      this.mode = m;
      this.prompt.repaint();
      this.hint.repaint();
    });
    this.mode = input.mode;
    this.keysTip.widget.slide = -8;
  }

  private add(widget: Widget, paint: () => void): Painted {
    const item: Painted = { widget, repaint: paint };
    this.items.push(item);
    this.root.add(widget.panel.mesh);
    widget.panel.setDensity(this.density);
    return item;
  }

  setTheme(name: ThemeName): void {
    this.theme = THEMES[name];
    this.repaintAll();
  }

  enterWorldSpace(parent: THREE.Object3D, camera: THREE.Camera): void {
    this.follow = camera;
    parent.add(this.root);
    this.vw = 1000;
    this.vh = 580;
    this.uiScale = 1;
    this.root.scale.setScalar(SHEET_SCALE);
    for (const item of [...this.items, ...this.options]) item.widget.panel.setDensity(2);
    this.density = 2;
    this.repaintAll();
    this.placeInWorld(1);
  }

  exitWorldSpace(): void {
    this.follow = null;
    this.ray = this.rayPoint = null;
    this.scene.add(this.root);
    this.root.position.set(0, 0, 0);
    this.root.quaternion.identity();
    this.density = 0;
    this.resize(...this.lastSize);
  }

  setRay(ray: THREE.Ray | null): void {
    this.ray = ray;
  }

  private placeInWorld(k: number): void {
    const cam = this.follow;
    if (!cam) return;
    const yaw = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ').y;
    const tx = cam.position.x - Math.sin(yaw) * SHEET_DISTANCE, tz = cam.position.z - Math.cos(yaw) * SHEET_DISTANCE, ty = cam.position.y - 0.2;
    const p = this.root.position;
    p.set(p.x + (tx - p.x) * k, p.y + (ty - p.y) * k, p.z + (tz - p.z) * k);
    let dy = yaw - this.root.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.root.rotation.set(0, this.root.rotation.y + dy * k, 0);
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.lastSize = [cssWidth, cssHeight, dpr];
    if (this.follow) return;
    this.uiScale = clamp(Math.min(cssWidth / 1280, cssHeight / 720), 0.62, 1.7);
    this.vw = cssWidth / this.uiScale;
    this.vh = cssHeight / this.uiScale;
    this.camera.left = -cssWidth / 2;
    this.camera.right = cssWidth / 2;
    this.camera.top = cssHeight / 2;
    this.camera.bottom = -cssHeight / 2;
    this.camera.updateProjectionMatrix();
    this.root.scale.setScalar(this.uiScale);
    const density = Math.min(3, this.uiScale * dpr);
    if (Math.abs(density - this.density) > 0.01) {
      this.density = density;
      for (const item of [...this.items, ...this.options]) item.widget.panel.setDensity(density);
      this.repaintAll();
    }
    this.layoutChoice();
  }

  private repaintAll(): void {
    for (const item of [...this.items, ...this.options]) item.repaint();
  }

  setFocus(focused: boolean): void {
    if (focused === this.focused) return;
    this.focused = focused;
    this.reticle.repaint();
  }

  setReticleVisible(v: boolean): void {
    this.reticleWanted = v;
  }

  setPrompt(text: string | null, action: keyof (typeof ACTION_LABELS)['mouse'] = 'interact'): void {
    if (text === null) {
      this.prompt.widget.visible = false;
      return;
    }
    this.prompt.widget.visible = true;
    if (text !== this.promptText || action !== this.promptAction) {
      this.promptText = text;
      this.promptAction = action;
      this.prompt.repaint();
    }
  }

  setSideTasks(tasks: readonly string[]): void {
    this.sideTasks = [...tasks];
    if (this.objective.widget.visible) this.objective.repaint();
  }

  setObjective(text: string | null, done = false): void {
    if (text === null) {
      this.objective.widget.visible = false;
      return;
    }
    this.objectiveDone = done;
    this.objectiveText = text;
    this.objective.repaint();
    this.objective.widget.visible = true;
    this.objective.widget.snap();
    this.objective.widget.visible = false;
    this.objective.widget.snap();
    this.objective.widget.visible = true;
  }

  setSubtitle(line: SubtitleLine | null): void {
    if (line === null) {
      this.subtitle.widget.visible = false;
      this.sub = null;
      return;
    }
    const w = Math.min(900, this.vw - 40);
    const panel = this.subtitle.widget.panel;
    let lines: string[] = [];
    panel.paint((ctx) => {
      ctx.font = font(400, 23);
      lines = wrap(ctx, line.text, w - 76);
    });
    panel.resize(w + PAD * 2, 74 + lines.length * 32 + PAD * 2);
    this.sub = { line, lines, chars: 0, total: line.text.length, waiting: false };
    this.subtitle.widget.visible = true;
    this.subtitle.repaint();
  }

  setSubtitleProgress(shown: number, waiting: boolean): void {
    const s = this.sub;
    if (!s) return;
    const chars = Math.floor(shown);
    if (chars === s.chars && waiting === s.waiting) return;
    s.chars = chars;
    s.waiting = waiting;
    this.subtitle.repaint();
  }

  setCard(title: string | null, subtitle = ''): void {
    if (title === null) {
      this.card.widget.visible = false;
      return;
    }
    this.cardText = { title, subtitle };
    this.card.repaint();
    this.card.widget.visible = true;
  }

  setResult(data: { heading: string; gained: string; missed: string } | null): void {
    if (data === null) {
      this.result.widget.visible = false;
      return;
    }
    this.resultData = data;
    this.result.repaint();
    this.result.widget.visible = true;
  }

  setToast(data: { title: string; body: string } | null): void {
    if (data === null) {
      this.toast.widget.visible = false;
      return;
    }
    this.toastData = data;
    this.toast.repaint();
    this.toast.widget.visible = true;
  }

  setReflection(lines: string[] | null): void {
    if (lines === null) {
      this.reflection.widget.visible = false;
      return;
    }
    this.reflectionLines = lines;
    this.reflection.repaint();
    this.reflection.widget.visible = true;
  }

  setCounter(data: { label: string; value: number; total: number } | null): void {
    if (data === null) {
      this.counter.widget.visible = false;
      return;
    }
    const changed = data.value !== this.counterData.value;
    this.counterData = { ...data, pulse: changed ? 1 : this.counterData.pulse };
    this.counter.repaint();
    this.counter.widget.visible = true;
  }

  clear(): void {
    this.setControlsTip(false);
    this.setPrompt(null);
    this.setObjective(null);
    this.setSubtitle(null);
    this.setCard(null);
    this.setResult(null);
    this.setToast(null);
    this.setReflection(null);
    this.setCounter(null);
    this.setHint(null);
  }

  setHint(hints: Hints | null): void {
    this.storyHints = hints;
    if (this.controlsOpen) return;
    if (hints === null) {
      this.hint.widget.visible = false;
      return;
    }
    this.hints = hints;
    this.hint.repaint();
    this.hint.widget.visible = true;
  }

  setControlsTip(on: boolean): void {
    this.inPlay = on;
    if (!on && this.controlsOpen) this.toggleControls();
  }

  toggleControls(): void {
    this.controlsOpen = !this.controlsOpen;
    const story = this.storyHints;
    if (this.controlsOpen) {
      this.hints = KEYBINDS;
      this.hint.repaint();
      this.hint.widget.visible = true;
    } else this.setHint(story);
    this.keysTip.repaint();
  }

  choose(title: string, options: ChoiceOption[], signal?: AbortSignal): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Cancelled());
        return;
      }
      const close = (): void => {
        this.choice = null;
        this.choiceTitle.widget.visible = false;
        for (const o of this.options) o.widget.visible = false;
      };
      const onAbort = (): void => {
        close();
        reject(new Cancelled());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.choice = {
        title, options, hover: -1,
        pick: (i) => {
          signal?.removeEventListener('abort', onAbort);
          close();
          resolve(i);
        },
      };
      while (this.options.length < options.length) {
        const index = this.options.length;
        const widget = new Widget(380, 200);
        const item: Painted = { widget, repaint: () => this.paintOption(index) };
        widget.panel.setDensity(this.density);
        widget.slide = 18;
        this.options.push(item);
        this.root.add(widget.panel.mesh);
      }
      this.choiceTitle.repaint();
      this.choiceTitle.widget.visible = true;
      this.layoutChoice();
      options.forEach((_, i) => {
        const o = this.options[i]!;
        o.widget.visible = true;
        o.repaint();
      });
    });
  }

  get choosing(): boolean {
    return this.choice !== null;
  }

  update(dt: number): void {
    this.time += dt;
    const { vw, vh } = this;
    const edge = 22;
    this.reticle.widget.x = this.reticle.widget.y = 0;
    this.prompt.widget.x = 0;
    this.prompt.widget.y = -92;
    this.objective.widget.x = -vw / 2 + this.objective.widget.panel.width / 2;
    this.objective.widget.y = vh / 2 - this.objective.widget.panel.height / 2 - edge + PAD;
    this.subtitle.widget.x = 0;
    this.subtitle.widget.y = -vh / 2 + this.subtitle.widget.panel.height / 2 + Math.max(18, vh * 0.045) - PAD;
    this.card.widget.x = this.card.widget.y = 0;
    this.result.widget.x = 0;
    this.result.widget.y = 20;
    this.toast.widget.x = 0;
    this.toast.widget.y = vh / 2 - this.toast.widget.panel.height / 2 - edge + PAD;
    this.reflection.widget.x = 0;
    this.reflection.widget.y = 30;
    const corner = this.mode === 'touch' ? 62 / this.uiScale : 0;
    const counter = this.counter.widget, objective = this.objective.widget.panel;
    const stacked = this.objective.widget.visible && objective.width + counter.panel.width + corner + (edge - PAD) * 2 > vw;
    counter.x = stacked ? -vw / 2 + counter.panel.width / 2 + edge - PAD : vw / 2 - counter.panel.width / 2 - edge + PAD - corner;
    counter.y = vh / 2 - counter.panel.height / 2 - edge + PAD - (stacked ? objective.height - PAD * 2 + 8 : 0);
    this.hint.widget.x = -vw / 2 + this.hint.widget.panel.width / 2;
    this.hint.widget.y = 30;
    const keys = this.inPlay && this.mode === 'mouse' && !this.follow;
    if (keys && this.input.pressed.has('controls')) this.toggleControls();
    if (!keys && this.controlsOpen) this.toggleControls();
    this.keysTip.widget.visible = keys;
    this.keysTip.widget.x = 0;
    this.keysTip.widget.y = vh / 2 - this.keysTip.widget.panel.height / 2 - 14 + PAD;

    if (this.counterData.pulse > 0) {
      this.counterData.pulse = Math.max(0, this.counterData.pulse - dt * 1.8);
      this.counter.repaint();
    }
    if (this.sub?.waiting && Math.floor(this.time * 3) !== this.lastSubPaint) {
      this.lastSubPaint = Math.floor(this.time * 3);
      this.subtitle.repaint();
    }
    this.reticle.widget.visible = this.reticleWanted && !this.follow && (this.focused || !this.sub);
    if (this.follow) {
      this.placeInWorld(1 - Math.exp(-2.4 * dt));
      this.rayPoint = null;
      if (this.ray) {
        this.root.updateWorldMatrix(true, false);
        const origin = this.root.getWorldPosition(_a);
        this.plane.setFromNormalAndCoplanarPoint(_b.set(0, 0, 1).transformDirection(this.root.matrixWorld), origin);
        const hit = this.ray.intersectPlane(this.plane, _c);
        if (hit) {
          const local = this.root.worldToLocal(hit);
          this.rayPoint = { x: local.x, y: local.y };
        }
      }
    }
    this.updateChoice();
    for (const item of this.items) item.widget.update(dt);
    for (const o of this.options) o.widget.update(dt);
    const pulse = this.counterData.pulse;
    this.counter.widget.panel.mesh.scale.set(this.counter.widget.panel.width * (1 + 0.12 * pulse), this.counter.widget.panel.height * (1 + 0.12 * pulse), 1);
  }

  private toLayout(px: number, py: number): { x: number; y: number } {
    const w = this.vw * this.uiScale, h = this.vh * this.uiScale;
    return { x: (px - w / 2) / this.uiScale, y: (h / 2 - py) / this.uiScale };
  }

  private layoutChoice(): void {
    const c = this.choice;
    if (!c) return;
    const n = c.options.length;
    const wide = this.vw >= 940;
    const gap = 18;
    const cardW = wide ? Math.min(400, (this.vw - 60 - gap * (n - 1)) / n) : Math.min(560, this.vw - 36);
    let tallest = 0;
    const probe = this.options[0]!.widget.panel;
    probe.paint((ctx) => {
      for (const o of c.options) {
        ctx.font = font(400, 16.5);
        const lines = o.detail ? wrap(ctx, o.detail, cardW - 56) : [];
        ctx.font = font(600, 22);
        const titleLines = wrap(ctx, o.title, cardW - 110);
        tallest = Math.max(tallest, 46 + titleLines.length * 28 + (lines.length ? 10 + lines.length * 23 : 0) + 26);
      }
    });
    const cardH = Math.max(wide ? 132 : 96, tallest);
    const totalW = wide ? n * cardW + (n - 1) * gap : cardW;
    const totalH = wide ? cardH : n * cardH + (n - 1) * gap;
    const baseY = wide ? -this.vh * 0.2 : -this.vh / 2 + totalH / 2 + 26;
    c.options.forEach((_, i) => {
      const w = this.options[i]!.widget;
      w.panel.resize(cardW + PAD * 2, cardH + PAD * 2);
      w.x = wide ? -totalW / 2 + cardW / 2 + i * (cardW + gap) : 0;
      w.y = wide ? baseY : baseY + totalH / 2 - cardH / 2 - i * (cardH + gap);
      this.options[i]!.repaint();
    });
    this.choiceTitle.widget.x = 0;
    this.choiceTitle.widget.y = (wide ? baseY + cardH / 2 : baseY + totalH / 2) + 58;
  }

  private updateChoice(): void {
    const c = this.choice;
    if (!c?.pick) return;
    const input = this.input;
    let hover = -1;
    if (this.follow ? this.rayPoint : input.pointer.active || input.tap) {
      const p = input.tap ?? input.pointer;
      const l = this.follow && this.rayPoint ? this.rayPoint : this.toLayout(p.x, p.y);
      c.options.forEach((_, i) => {
        const w = this.options[i]!.widget;
        if (Math.abs(l.x - w.x) <= w.panel.width / 2 - PAD && Math.abs(l.y - w.y) <= w.panel.height / 2 - PAD) hover = i;
      });
    }
    if (hover !== c.hover) {
      const prev = c.hover;
      c.hover = hover;
      if (prev >= 0) this.options[prev]?.repaint();
      if (hover >= 0) {
        this.options[hover]?.repaint();
        this.onHover.emit();
      }
    }
    const keys = ['choice1', 'choice2', 'choice3'] as const;
    for (let i = 0; i < c.options.length; i++) {
      if (input.pressed.has(keys[i]!)) {
        c.pick(i);
        return;
      }
    }
    const clicked = this.mode === 'touch' ? input.released.has('primary') && input.wasTap : input.pressed.has('primary');
    if (clicked && hover >= 0 && this.options[hover]!.widget.alpha > 0.6) c.pick(hover);
  }

  private paintReticle(): void {
    this.reticle.widget.panel.paint((ctx, w, h) => {
      const cx = w / 2, cy = h / 2;
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 4;
      if (this.focused) {
        ctx.strokeStyle = this.theme.accent;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(cx, cy, 13, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = this.focused ? this.theme.accent : 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(cx, cy, this.focused ? 3 : 2.4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  private paintPrompt(): void {
    const widget = this.prompt.widget;
    const label = ACTION_LABELS[this.mode][this.promptAction];
    widget.panel.paint((ctx) => {
      ctx.font = font(500, 18);
      const textW = ctx.measureText(this.promptText).width;
      ctx.font = font(600, 15);
      const capW = Math.max(30, ctx.measureText(label).width + 18);
      const total = capW + 12 + textW + 36;
      widget.panel.resize(Math.ceil(total) + PAD * 2, 50 + PAD * 2);
    });
    widget.panel.paint((ctx, w, h) => {
      glass(ctx, PAD, PAD, w - PAD * 2, h - PAD * 2, this.theme, { radius: 25, glow: 0.7 });
      const capW = keyCap(ctx, label, PAD + 16, PAD + 10, 30, this.theme);
      ctx.font = font(500, 18);
      ctx.fillStyle = this.theme.text;
      ctx.textBaseline = 'middle';
      ctx.fillText(this.promptText, PAD + 16 + capW + 12, h / 2 + 1);
    });
  }

  private paintObjective(): void {
    const widget = this.objective.widget;
    let lines: string[] = [];
    const side: string[][] = [];
    widget.panel.paint((ctx) => {
      ctx.font = font(500, 18);
      lines = wrap(ctx, this.objectiveText, 470 - 74);
      ctx.font = font(500, 16);
      for (const t of this.sideTasks) side.push(wrap(ctx, t, 470 - 74));
    });
    const sideH = side.reduce((h, l) => h + 26 + l.length * 22, side.length ? 8 : 0);
    widget.panel.resize(470 + PAD * 2, 34 + lines.length * 25 + sideH + PAD * 2);
    widget.panel.paint((ctx, w, h) => {
      fade(ctx, 0, PAD, w, h - PAD * 2, this.theme);
      ctx.fillStyle = this.theme.accent;
      if (this.objectiveDone) {
        ctx.strokeStyle = this.theme.accent;
        ctx.lineWidth = 3.5;
        ctx.lineCap = ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(PAD + 19, PAD + 30);
        ctx.lineTo(PAD + 25, PAD + 36);
        ctx.lineTo(PAD + 36, PAD + 22);
        ctx.stroke();
      } else {
        ctx.save();
        ctx.translate(PAD + 27, PAD + 30);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-6, -6, 12, 12);
        ctx.restore();
      }
      ctx.font = font(500, 18);
      ctx.fillStyle = this.objectiveDone ? this.theme.accent : this.theme.text;
      ctx.textBaseline = 'middle';
      lines.forEach((line, i) => ctx.fillText(line, PAD + 50, PAD + 30 + i * 25));
      let y = PAD + 30 + lines.length * 25 + 8;
      side.forEach((tl) => {
        ctx.font = font(600, 11);
        ctx.fillStyle = this.theme.accent;
        ctx.globalAlpha = 0.8;
        ctx.fillText('SIDE TASK', PAD + 50, y + 4);
        ctx.globalAlpha = 1;
        y += 22;
        ctx.save();
        ctx.translate(PAD + 27, y);
        ctx.rotate(Math.PI / 4);
        ctx.strokeStyle = this.theme.accent;
        ctx.lineWidth = 1.6;
        ctx.strokeRect(-5, -5, 10, 10);
        ctx.restore();
        ctx.font = font(500, 16);
        ctx.fillStyle = this.theme.text;
        tl.forEach((line, i) => ctx.fillText(line, PAD + 50, y + i * 22));
        y += tl.length * 22 + 4;
      });
    });
  }

  private paintSubtitle(): void {
    const s = this.sub;
    if (!s) return;
    this.subtitle.widget.panel.paint((ctx, w, h) => {
      const x = PAD, y = PAD + 14, bw = w - PAD * 2, bh = h - PAD * 2 - 14;
      glass(ctx, x, y, bw, bh, this.theme, { radius: 22 });
      ctx.font = font(600, 14);
      let nameW = 0;
      for (const ch of s.line.speaker.toUpperCase()) nameW += ctx.measureText(ch).width + 2.2;
      const chipW = nameW + 46, chipH = 30, chipX = x + 24, chipY = y - chipH / 2;
      ctx.fillStyle = 'rgba(14, 12, 30, 0.96)';
      roundRect(ctx, chipX, chipY, chipW, chipH, 15);
      ctx.fill();
      ctx.strokeStyle = s.line.color;
      ctx.lineWidth = 1.5;
      roundRect(ctx, chipX + 0.75, chipY + 0.75, chipW - 1.5, chipH - 1.5, 15);
      ctx.stroke();
      ctx.fillStyle = s.line.color;
      ctx.beginPath();
      ctx.arc(chipX + 16, chipY + chipH / 2, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      spaced(ctx, s.line.speaker.toUpperCase(), chipX + 29, chipY + chipH / 2 + 1, 2.2);
      ctx.font = font(400, 23);
      ctx.fillStyle = this.theme.text;
      let left = s.chars;
      s.lines.forEach((line, i) => {
        if (left <= 0) return;
        ctx.fillText(line.slice(0, left), x + 38, y + 50 + i * 32);
        left -= line.length + 1;
      });
      if (s.waiting) {
        const pulse = 0.45 + 0.55 * Math.abs(Math.sin(this.time * 3.2));
        ctx.fillStyle = this.theme.accent;
        ctx.globalAlpha = pulse;
        ctx.beginPath();
        const ax = x + bw - 34, ay = y + bh - 24;
        ctx.moveTo(ax, ay - 7);
        ctx.lineTo(ax + 11, ay);
        ctx.lineTo(ax, ay + 7);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    });
  }

  private paintCard(): void {
    this.card.widget.panel.paint((ctx, w, h) => {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#ffffff';
      ctx.font = displayFont(400, 84);
      spaced(ctx, this.cardText.title.toUpperCase(), w / 2, h / 2 - 26, 18, 'center');
      ctx.fillStyle = this.theme.accent;
      ctx.fillRect(w / 2 - 44, h / 2 + 34, 88, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.86)';
      ctx.font = font(400, 21);
      spaced(ctx, this.cardText.subtitle.toUpperCase(), w / 2, h / 2 + 70, 7, 'center');
    });
  }

  private paintResult(): void {
    const widget = this.result.widget;
    const d = this.resultData;
    let a: string[] = [], b: string[] = [];
    widget.panel.paint((ctx) => {
      ctx.font = font(400, 21);
      a = wrap(ctx, d.gained, 760 - 130);
      b = wrap(ctx, d.missed, 760 - 130);
    });
    const bh = 92 + (a.length + b.length) * 30 + 34;
    widget.panel.resize(760 + PAD * 2, bh + PAD * 2);
    widget.panel.paint((ctx, w) => {
      glass(ctx, PAD, PAD, w - PAD * 2, bh, this.theme, { radius: 24 });
      ctx.fillStyle = this.theme.accent;
      ctx.font = font(600, 14);
      ctx.textBaseline = 'middle';
      spaced(ctx, d.heading.toUpperCase(), w / 2, PAD + 36, 4, 'center');
      ctx.font = font(400, 21);
      let y = PAD + 82;
      const row = (lines: string[], gained: boolean): void => {
        const cx = PAD + 52, cy = y;
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = gained ? this.theme.accent : this.theme.dim;
        ctx.beginPath();
        ctx.arc(cx, cy, 12, 0, Math.PI * 2);
        if (gained) ctx.stroke();
        else {
          ctx.setLineDash([4, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (gained) {
          ctx.beginPath();
          ctx.moveTo(cx - 5.5, cy + 0.5);
          ctx.lineTo(cx - 1.5, cy + 4.5);
          ctx.lineTo(cx + 6, cy - 4.5);
          ctx.stroke();
        }
        ctx.fillStyle = gained ? this.theme.text : this.theme.dim;
        lines.forEach((line, i) => ctx.fillText(line, PAD + 84, y + i * 30));
        y += lines.length * 30 + 18;
      };
      row(a, true);
      row(b, false);
    });
  }

  private paintToast(): void {
    this.toast.widget.panel.paint((ctx, w, h) => {
      glass(ctx, PAD, PAD, w - PAD * 2, h - PAD * 2, this.theme, { radius: 20, border: this.theme.accent });
      const ix = PAD + 24, iy = PAD + 26;
      ctx.strokeStyle = this.theme.accent;
      ctx.lineWidth = 2;
      roundRect(ctx, ix, iy, 40, 30, 5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ix + 2, iy + 3);
      ctx.lineTo(ix + 20, iy + 17);
      ctx.lineTo(ix + 38, iy + 3);
      ctx.stroke();
      ctx.fillStyle = '#ff6b8a';
      ctx.beginPath();
      ctx.arc(ix + 40, iy, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.theme.text;
      ctx.font = font(600, 18);
      ctx.fillText(this.toastData.title, PAD + 84, PAD + 30);
      ctx.fillStyle = this.theme.dim;
      ctx.font = font(400, 15.5);
      ctx.fillText(this.toastData.body, PAD + 84, PAD + 55);
    });
  }

  private paintReflection(): void {
    const widget = this.reflection.widget;
    let wrapped: string[] = [];
    const maxW = Math.min(1000, this.vw - 60);
    widget.panel.paint((ctx) => {
      ctx.font = displayFont(400, 38, true);
      wrapped = this.reflectionLines.flatMap((l) => (l === '' ? [''] : wrap(ctx, l, maxW - 60)));
    });
    widget.panel.resize(maxW, wrapped.length * 50 + 70);
    widget.panel.paint((ctx, w, h) => {
      const band = ctx.createLinearGradient(0, 0, 0, h);
      band.addColorStop(0, 'rgba(6, 7, 16, 0)');
      band.addColorStop(0.3, 'rgba(6, 7, 16, 0.4)');
      band.addColorStop(0.7, 'rgba(6, 7, 16, 0.4)');
      band.addColorStop(1, 'rgba(6, 7, 16, 0)');
      const sides = ctx.createLinearGradient(0, 0, w, 0);
      sides.addColorStop(0, 'rgba(0,0,0,0)');
      sides.addColorStop(0.16, 'rgba(0,0,0,1)');
      sides.addColorStop(0.84, 'rgba(0,0,0,1)');
      sides.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = band;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = sides;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.75)';
      ctx.shadowBlur = 16;
      ctx.font = displayFont(400, 38, true);
      ctx.fillStyle = '#ffffff';
      wrapped.forEach((line, i) => ctx.fillText(line, w / 2, h / 2 + (i - (wrapped.length - 1) / 2) * 50));
    });
  }

  private paintCounter(): void {
    const d = this.counterData;
    this.counter.widget.panel.paint((ctx, w, h) => {
      glass(ctx, PAD, PAD, w - PAD * 2, h - PAD * 2, this.theme, { radius: 31, glow: 0.6 + d.pulse });
      ctx.fillStyle = this.theme.accent;
      sparkle(ctx, PAD + 30, h / 2, 10);
      ctx.fillStyle = this.theme.text;
      ctx.font = font(600, 13.5);
      ctx.textBaseline = 'middle';
      spaced(ctx, d.label.toUpperCase(), PAD + 50, h / 2 + 1, 2.4);
      for (let i = 0; i < d.total; i++) {
        const x = w - PAD - 26 - (d.total - 1 - i) * 24;
        ctx.beginPath();
        ctx.arc(x, h / 2, 7, 0, Math.PI * 2);
        if (i < d.value) {
          ctx.fillStyle = this.theme.accent;
          ctx.fill();
        } else {
          ctx.strokeStyle = this.theme.dim;
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
      }
    });
  }

  private paintHint(): void {
    const widget = this.hint.widget;
    const rows = this.hints?.[this.mode] ?? [];
    widget.panel.resize(400 + PAD * 2, 26 + rows.length * 36 + PAD * 2);
    widget.panel.paint((ctx, w, h) => {
      fade(ctx, 0, PAD, w, h - PAD * 2, this.theme);
      rows.forEach(([key, text], i) => {
        const y = PAD + 16 + i * 36;
        const capW = keyCap(ctx, key, PAD + 18, y, 26, this.theme);
        ctx.font = font(400, 16);
        ctx.fillStyle = this.theme.text;
        ctx.textBaseline = 'middle';
        ctx.fillText(text, PAD + 18 + capW + 12, y + 14);
      });
    });
  }

  private paintKeysTip(): void {
    const label = this.controlsOpen ? 'Hide controls' : 'Controls';
    this.keysTip.widget.panel.paint((ctx, w, h) => {
      ctx.font = font(500, 15);
      const textW = ctx.measureText(label).width, capH = 24;
      ctx.font = font(600, Math.round(capH * 0.52));
      const capW = Math.max(capH, ctx.measureText('K').width + capH * 0.6);
      const x = (w - (capW + 10 + textW)) / 2, y = h / 2 - capH / 2;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = 8;
      keyCap(ctx, 'K', x, y, capH, this.theme);
      ctx.font = font(500, 15);
      ctx.fillStyle = this.theme.text;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(label, x + capW + 10, h / 2 + 1);
    });
  }

  private paintChoiceTitle(): void {
    const title = this.choice?.title ?? '';
    this.choiceTitle.widget.panel.paint((ctx, w, h) => {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const room = Math.min(w, this.vw) - 76;
      let size = 17, gap = 5, width = 0;
      for (;;) {
        ctx.font = font(600, size);
        width = -gap;
        for (const ch of title.toUpperCase()) width += ctx.measureText(ch).width + gap;
        if (width <= room || size <= 11) break;
        size -= 1;
        gap = Math.max(1.5, gap - 0.6);
      }
      const bw = width + 56, bh = size + 30;
      glass(ctx, w / 2 - bw / 2, h / 2 - bh / 2, bw, bh, this.theme, { radius: bh / 2, glow: 0.5 });
      ctx.fillStyle = this.theme.text;
      spaced(ctx, title.toUpperCase(), w / 2, h / 2 + 1, gap, 'center');
    });
  }

  private paintOption(index: number): void {
    const c = this.choice;
    const item = this.options[index];
    if (!c || !item) return;
    const o = c.options[index];
    if (!o) return;
    const hover = c.hover === index;
    const loud = o.emphasis === 'loud', quiet = o.emphasis === 'quiet';
    item.widget.panel.paint((ctx, w, h) => {
      const bw = w - PAD * 2, bh = h - PAD * 2;
      ctx.globalAlpha = quiet && !hover ? 0.5 : 1;
      ctx.fillStyle = 'rgba(10, 11, 22, 0.62)';
      roundRect(ctx, PAD, PAD, bw, bh, 22);
      ctx.fill();
      glass(ctx, PAD, PAD, bw, bh, this.theme, { radius: 22, glow: hover || loud ? (loud ? 2.4 : 1.6) : 0.8, border: hover || loud ? this.theme.accent : undefined, borderWidth: hover || loud ? 2.5 : 1.5, wash: loud ? 'rgba(255,255,255,0.14)' : hover ? 'rgba(255,255,255,0.09)' : undefined });
      const bx = PAD + 22, by = PAD + 22;
      ctx.fillStyle = hover || loud ? this.theme.accent : 'rgba(255,255,255,0.12)';
      roundRect(ctx, bx, by, 36, 36, 11);
      ctx.fill();
      ctx.fillStyle = hover || loud ? '#1b1430' : this.theme.text;
      ctx.font = font(700, 18);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.mode === 'touch' ? 'ABC'[index] ?? '' : String(index + 1), bx + 18, by + 19);
      ctx.textAlign = 'left';
      ctx.fillStyle = quiet ? this.theme.dim : this.theme.text;
      ctx.font = font(loud ? 700 : quiet ? 400 : 600, loud ? 25 : quiet ? 17 : 22);
      const titleLines = wrap(ctx, o.title, bw - 110);
      titleLines.forEach((line, i) => ctx.fillText(line, bx + 52, by + 19 + i * 28));
      if (o.detail) {
        ctx.font = font(400, 16.5);
        ctx.fillStyle = this.theme.dim;
        const y0 = by + 19 + titleLines.length * 28 + 12;
        wrap(ctx, o.detail, bw - 56).forEach((line, i) => ctx.fillText(line, PAD + 28, y0 + i * 23));
      }
      ctx.globalAlpha = 1;
    });
    const size = (quiet ? 0.78 : loud ? 1.06 : 1) * (hover ? 1.025 : 1);
    item.widget.panel.mesh.scale.set(item.widget.panel.width * size, item.widget.panel.height * size, 1);
  }

}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
