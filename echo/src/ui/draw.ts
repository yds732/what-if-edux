/** Canvas-2D drawing vocabulary for every panel: holographic glass, type, key caps. */

export const FONT = '"Inter Variable", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
/** The display face: names, titles and headings. */
export const DISPLAY = '"Cormorant Garamond", "EB Garamond", Georgia, "Times New Roman", serif';
export const displayFont = (weight: number, size: number, italic = false): string => `${italic ? 'italic ' : ''}${weight} ${size}px ${DISPLAY}`;
export const font = (weight: number, size: number): string => `${weight} ${size}px ${FONT}`;

export interface Theme {
  readonly glassTop: string;
  readonly glassBottom: string;
  readonly border: string;
  readonly accent: string;
  /** Soft outer light around panels. */
  readonly glow: string;
  readonly text: string;
  readonly dim: string;
}

export type ThemeName = 'real' | 'haven';

/** The real world's interface is cool and quiet; Haven's is warm, gilded and eager to please. */
export const THEMES: Record<ThemeName, Theme> = {
  real: {
    glassTop: 'rgba(22, 28, 42, 0.80)', glassBottom: 'rgba(12, 16, 28, 0.86)', border: 'rgba(190, 215, 255, 0.34)',
    accent: '#9fd0ff', glow: 'rgba(120, 170, 255, 0.28)', text: '#f2f6ff', dim: 'rgba(214, 226, 255, 0.66)',
  },
  haven: {
    glassTop: 'rgba(54, 34, 92, 0.78)', glassBottom: 'rgba(28, 18, 62, 0.86)', border: 'rgba(255, 224, 170, 0.5)',
    accent: '#ffd98a', glow: 'rgba(255, 190, 120, 0.34)', text: '#fff7ea', dim: 'rgba(255, 236, 214, 0.72)',
  },
};

export const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void => {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
};

export interface GlassOptions {
  radius?: number;
  /** 0..1 strength of the outer glow. */
  glow?: number;
  /** Overrides the border colour, for a selected or highlighted panel. */
  border?: string;
  borderWidth?: number;
  /** Extra fill laid over the glass, for hover states. */
  wash?: string;
}

/** A pane of holographic glass. Leave `pad` pixels of margin around it for the glow. */
export const glass = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, theme: Theme, o: GlassOptions = {}): void => {
  // panels are square-cornered, to match the menu buttons
  const r = 0 * (o.radius ?? 0);
  ctx.save();
  if ((o.glow ?? 1) > 0) {
    ctx.shadowColor = theme.glow;
    ctx.shadowBlur = 22 * (o.glow ?? 1);
  }
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, theme.glassTop);
  g.addColorStop(1, theme.glassBottom);
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.restore();
  if (o.wash) {
    ctx.fillStyle = o.wash;
    roundRect(ctx, x, y, w, h, r);
    ctx.fill();
  }
  // a line of light along the top edge, as if the pane caught the room
  const hl = ctx.createLinearGradient(0, y, 0, y + Math.min(h, 46));
  hl.addColorStop(0, 'rgba(255,255,255,0.13)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl;
  roundRect(ctx, x, y, w, Math.min(h, 46), r);
  ctx.fill();
  ctx.strokeStyle = o.border ?? theme.border;
  ctx.lineWidth = o.borderWidth ?? 1.5;
  roundRect(ctx, x + 0.75, y + 0.75, w - 1.5, h - 1.5, r);
  ctx.stroke();
};

const withAlpha = (rgba: string, a: number): string => rgba.replace(/[\d.]+\)$/, `${a})`);

/**
 * A soft shade behind text on the left of the screen: dark at the screen edge, thinning to nothing on the right,
 * with no border or glow, so it reads as shadow rather than as a box.
 */
export const fade = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, theme: Theme): void => {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, theme.glassBottom);
  g.addColorStop(0.45, withAlpha(theme.glassTop, 0.55));
  g.addColorStop(1, withAlpha(theme.glassTop, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
};

/** Greedy word wrap. `measure` returns the width of a string in the units of `maxWidth`. */
export const wrapText = (measure: (s: string) => number, text: string, maxWidth: number): string[] => {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next) > maxWidth) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
};

export const wrap = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => wrapText((s) => ctx.measureText(s).width, text, maxWidth);

/** Text with letter spacing, for small caps labels. Returns the width drawn. */
export const spaced = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number, align: 'left' | 'center' = 'left'): number => {
  let width = 0;
  for (const ch of text) width += ctx.measureText(ch).width + spacing;
  width -= spacing;
  let cx = align === 'center' ? x - width / 2 : x;
  const prev = ctx.textAlign;
  ctx.textAlign = 'left';
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
  ctx.textAlign = prev;
  return width;
};

/** A keyboard key drawn as a small cap. Returns its width. */
export const keyCap = (ctx: CanvasRenderingContext2D, label: string, x: number, y: number, h: number, theme: Theme): number => {
  ctx.save();
  ctx.font = font(600, Math.round(h * 0.52));
  const w = Math.max(h, ctx.measureText(label).width + h * 0.6);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  roundRect(ctx, x, y, w, h, h * 0.28);
  ctx.fill();
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 1.5;
  roundRect(ctx, x + 0.75, y + 0.75, w - 1.5, h - 1.5, h * 0.28);
  ctx.stroke();
  ctx.fillStyle = theme.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  ctx.restore();
  return w;
};

/** Four-point sparkle, Haven's mark. */
export const sparkle = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void => {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.3 : r;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
};
