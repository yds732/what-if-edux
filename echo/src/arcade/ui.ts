import { clamp01 } from '../core/math';
import type { Action, Input } from '../input/Input';
import type { Hud } from '../ui/Hud';
import { Widget } from '../ui/Panel';
import { displayFont, font, glass, spaced, sparkle, wrap, type Theme } from '../ui/draw';

/** Margin kept around every panel for its glow, as on the story's own HUD. */
export const PAD = 26;

export type Paint = (ctx: CanvasRenderingContext2D, w: number, h: number, el: UiEl) => void;

/**
 * One panel of a game's interface: a score, a button, a meter. It is placed from an edge or the centre of the
 * screen, so it keeps its place when the window changes shape; give it `onClick` and it is a button.
 */
export class UiEl {
  readonly widget: Widget;
  /** Which part of the screen it hangs from (-1 left or bottom, 0 centre, 1 right or top), and how far from there in layout pixels. */
  private ax = 0;
  private ay = 0;
  private dx = 0;
  private dy = 0;
  hover = false;
  disabled = false;
  onClick: (() => void) | null = null;
  /** A key that presses it. */
  key: Action | null = null;
  /** Grows from 0 to 1 while the pointer rests on it: buttons light up by it. */
  glow = 0;
  private readonly detach: () => void;

  constructor(readonly layer: UiLayer, width: number, height: number, private readonly paint: Paint) {
    this.widget = new Widget(width, height);
    this.detach = layer.hud.attach(this.widget, () => this.repaint());
    layer.els.add(this);
  }

  at(ax: number, ay: number, dx = 0, dy = 0): this {
    this.ax = ax;
    this.ay = ay;
    this.dx = dx;
    this.dy = dy;
    this.layout();
    return this;
  }

  show(on = true): this {
    if (on && !this.widget.visible) this.repaint();
    this.widget.visible = on;
    return this;
  }

  resize(width: number, height: number): this {
    this.widget.panel.resize(width, height);
    return this;
  }

  repaint(): void {
    this.widget.panel.paint((ctx, w, h) => this.paint(ctx, w, h, this));
  }

  layout(): void {
    const { w, h } = this.layer.hud.size, panel = this.widget.panel;
    // an edge is where the panel's own edge goes, less the margin it keeps for its glow
    this.widget.x = this.ax * (w / 2 - panel.width / 2 + PAD) + this.dx;
    this.widget.y = this.ay * (h / 2 - panel.height / 2 + PAD) + this.dy;
  }

  /** Whether a point in layout pixels is on the panel itself (not its glow margin). */
  contains(x: number, y: number): boolean {
    const panel = this.widget.panel;
    return Math.abs(x - this.widget.x) <= panel.width / 2 - PAD && Math.abs(y - this.widget.y) <= panel.height / 2 - PAD;
  }

  remove(): void {
    this.layer.els.delete(this);
    this.detach();
  }
}

/** A game's interface on the story's HUD: flat over the picture on a screen, on the floating sheet in a headset. */
export class UiLayer {
  readonly els = new Set<UiEl>();
  /** The pointer is on a button: the game under it should not act on the press. */
  hovering = false;
  /** Called when the pointer moves onto a button, and when one is pressed: the arcade makes the sounds. */
  onHover: (() => void) | null = null;
  onPress: (() => void) | null = null;

  constructor(readonly hud: Hud, private readonly input: Input) {}

  get theme(): Theme {
    return this.hud.theme;
  }

  add(width: number, height: number, paint: Paint): UiEl {
    return new UiEl(this, width, height, paint);
  }

  /** Takes every panel down: a game leaves nothing of its interface behind. */
  clear(): void {
    for (const el of [...this.els]) el.remove();
    this.hovering = false;
  }

  /** Places the panels and turns the pointer and keys into presses. Call once a frame, before the game reads its input. */
  update(dt: number): void {
    const input = this.input;
    const at = this.hud.pointerAt();
    const clicked = input.mode === 'touch' ? input.released.has('primary') && input.wasTap : input.pressed.has('primary');
    let hit: UiEl | null = null;
    this.hovering = false;
    for (const el of this.els) {
      el.layout();
      const live = !!el.onClick && !el.disabled && el.widget.visible && el.widget.alpha > 0.5;
      const hover = live && !!at && el.contains(at.x, at.y);
      if (hover !== el.hover) {
        el.hover = hover;
        if (hover) this.onHover?.();
      }
      const glow = clamp01(el.glow + (hover ? 1 : -1) * dt * 7);
      if (glow !== el.glow) {
        el.glow = glow;
        el.repaint();
      }
      if (hover) {
        this.hovering = true;
        hit = el;
      }
      if (live && el.key && input.pressed.has(el.key)) {
        input.pressed.delete(el.key);
        hit = el;
        this.press(el);
        return;
      }
    }
    if (hit && clicked) {
      // the press is spent here: it must not also swing a bat or swap a gem
      input.pressed.delete('primary');
      input.released.delete('primary');
      this.press(hit);
    }
  }

  private press(el: UiEl): void {
    this.onPress?.();
    el.onClick?.();
  }
}

// ---------------------------------------------------------------------------------------------------- painters

/** A button: a pane of glass with a label, lit while pointed at. `hint` is a key cap's worth of text on its right. */
export const paintButton = (label: string, opts: { primary?: boolean; hint?: string; size?: number } = {}): Paint => (ctx, w, h, el) => {
  const theme = el.layer.theme;
  const x = PAD, y = PAD, bw = w - PAD * 2, bh = h - PAD * 2, k = el.glow;
  glass(ctx, x, y, bw, bh, theme, {
    glow: 0.5 + 0.9 * k, border: opts.primary || k > 0.02 ? theme.accent : undefined, borderWidth: 1.5 + k,
    wash: opts.primary ? `rgba(255, 214, 140, ${0.14 + 0.16 * k})` : `rgba(255, 255, 255, ${0.1 * k})`,
  });
  ctx.globalAlpha = el.disabled ? 0.4 : 1;
  ctx.fillStyle = theme.text;
  ctx.font = font(600, opts.size ?? 19);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + bw / 2 - (opts.hint ? 14 : 0), y + bh / 2 + 1, bw - 24);
  if (opts.hint) {
    ctx.font = font(600, 12);
    ctx.fillStyle = theme.dim;
    ctx.textAlign = 'right';
    ctx.fillText(opts.hint, x + bw - 12, y + bh / 2 + 1);
  }
  ctx.globalAlpha = 1;
};

/** A short line of instruction in a slim pane: what to do now, in the words for the device in hand. */
export const paintHint = (text: () => string): Paint => (ctx, w, h, el) => {
  const theme = el.layer.theme;
  ctx.font = font(500, 17);
  const wide = Math.min(w - PAD * 2, ctx.measureText(text()).width + 54);
  glass(ctx, (w - wide) / 2, PAD, wide, h - PAD * 2, theme, { glow: 0.7, border: theme.accent });
  ctx.fillStyle = theme.accent;
  sparkle(ctx, (w - wide) / 2 + 20, h / 2, 6);
  ctx.fillStyle = theme.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text(), w / 2 + 8, h / 2 + 1, wide - 44);
};

/** Something said over the game: who, in their colour, and the words as far as they have been spoken. */
export const paintBark = (line: () => { name: string; color: string; text: string }): Paint => (ctx, w, h, el) => {
  const theme = el.layer.theme, { name, color, text } = line();
  ctx.font = font(700, 12.5);
  const nameWide = ctx.measureText(name.toUpperCase()).width + 2.2 * name.length;
  ctx.font = font(450, 18);
  const wide = Math.min(w - PAD * 2, nameWide + ctx.measureText(text).width + 62);
  const x = (w - wide) / 2;
  glass(ctx, x, PAD, wide, h - PAD * 2, theme, { glow: 0.6 });
  ctx.fillStyle = color;
  ctx.fillRect(x, PAD, 4, h - PAD * 2);
  ctx.textBaseline = 'middle';
  ctx.font = font(700, 12.5);
  spaced(ctx, name.toUpperCase(), x + 18, h / 2 + 1, 2.2);
  ctx.fillStyle = theme.text;
  ctx.font = font(450, 18);
  ctx.textAlign = 'left';
  ctx.fillText(text, x + 18 + nameWide + 14, h / 2 + 1, wide - nameWide - 44);
};

/** A row of stars, `earned` of them lit. `k` 0..1 brings them in one after another. */
export const paintStars = (ctx: CanvasRenderingContext2D, cx: number, cy: number, earned: number, theme: Theme, k = 1, size = 26): void => {
  for (let i = 0; i < 3; i++) {
    const x = cx + (i - 1) * size * 2.5, shown = clamp01(k * 3 - i);
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = theme.dim;
    sparkle(ctx, x, cy, size * 0.8);
    if (i < earned && shown > 0) {
      ctx.globalAlpha = shown;
      ctx.shadowColor = theme.accent;
      ctx.shadowBlur = 18;
      ctx.fillStyle = theme.accent;
      // each star lands a little large and settles
      sparkle(ctx, x, cy, size * (1 + 0.35 * (1 - shown)));
      ctx.shadowBlur = 0;
    }
  }
  ctx.globalAlpha = 1;
};

/** The card that ends a session: how it went, the stars it earned, and a line about it. */
export const paintResult = (data: { heading: string; summary: string; stars: number; reveal: () => number }): Paint => (ctx, w, h, el) => {
  const theme = el.layer.theme;
  glass(ctx, PAD, PAD, w - PAD * 2, h - PAD * 2, theme, { glow: 1.2, borderWidth: 2 });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = theme.accent;
  ctx.font = font(600, 13);
  spaced(ctx, 'HAVEN ARCADE', w / 2, PAD + 34, 4, 'center');
  ctx.fillStyle = theme.text;
  ctx.font = displayFont(500, 54);
  ctx.fillText(data.heading, w / 2, PAD + 86, w - PAD * 2 - 40);
  paintStars(ctx, w / 2, PAD + 152, data.stars, theme, data.reveal());
  ctx.fillStyle = theme.dim;
  ctx.font = font(400, 18);
  wrap(ctx, data.summary, w - PAD * 2 - 70).slice(0, 2).forEach((line, i) => ctx.fillText(line, w / 2, PAD + 206 + i * 26));
};

/** Small caps over a large number: a score, a count of moves. */
export const paintStat = (label: () => string, value: () => string, opts: { align?: 'left' | 'center' | 'right'; accent?: boolean } = {}): Paint => (ctx, w, h, el) => {
  const theme = el.layer.theme, align = opts.align ?? 'center';
  glass(ctx, PAD, PAD, w - PAD * 2, h - PAD * 2, theme, { glow: 0.5 });
  const x = align === 'left' ? PAD + 16 : align === 'right' ? w - PAD - 16 : w / 2;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = theme.dim;
  ctx.font = font(600, 11.5);
  ctx.textAlign = align;
  if (align === 'left') spaced(ctx, label().toUpperCase(), x, PAD + 19, 2.5);
  else if (align === 'center') spaced(ctx, label().toUpperCase(), x, PAD + 19, 2.5, 'center');
  else ctx.fillText(label().toUpperCase(), x, PAD + 19);
  ctx.fillStyle = opts.accent ? theme.accent : theme.text;
  ctx.font = font(700, 30);
  ctx.textAlign = align;
  ctx.fillText(value(), x, PAD + 50);
};
