// Cuts a turnaround sheet into its separate views, by finding the empty background between the figures.
import sharp from 'sharp';

/** Returns one square PNG per figure found on the sheet, left to right, all at the same scale. */
export const splitViews = async (sheet, { expect = 4, out = 1024, tolerance = 26, margin = 0.06 } = {}) => {
  const { data, info } = await sharp(sheet).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const at = (x, y) => (y * W + x) * C;
  // the background is whatever the corners are
  const corners = [at(2, 2), at(W - 3, 2), at(2, H - 3), at(W - 3, H - 3)];
  const bg = [0, 1, 2].map((c) => Math.round(corners.reduce((sum, i) => sum + data[i + c], 0) / corners.length));
  const isFigure = (i) => Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > tolerance;

  const columns = new Uint32Array(W), rows = new Uint32Array(H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isFigure(at(x, y))) { columns[x]++; rows[y]++; }
  // runs of occupied columns; specks and hairline gaps are noise
  const runs = [];
  const minCount = Math.max(2, Math.round(H * 0.004));
  for (let x = 0, start = -1; x <= W; x++) {
    const filled = x < W && columns[x] >= minCount;
    if (filled && start < 0) start = x;
    if (!filled && start >= 0) {
      const last = runs[runs.length - 1];
      if (last && start - last[1] < W * 0.01) last[1] = x; // close a hairline gap inside one figure
      else runs.push([start, x]);
      start = -1;
    }
  }
  const figures = runs.filter(([a, b]) => b - a > W * 0.03);
  if (figures.length !== expect) throw new Error(`expected ${expect} views on the sheet, found ${figures.length} (widths: ${figures.map(([a, b]) => b - a).join(', ')})`);

  let top = 0, bottom = H - 1;
  while (top < H && rows[top] < 2) top++;
  while (bottom > 0 && rows[bottom] < 2) bottom--;
  // one square size for every view, so the figure is the same size in each
  const tall = bottom - top + 1, wide = Math.max(...figures.map(([a, b]) => b - a));
  const side = Math.ceil(Math.max(tall, wide) * (1 + margin * 2));
  const background = { r: bg[0], g: bg[1], b: bg[2] };
  const views = [];
  for (const [i, [a, b]] of figures.entries()) {
    const cx = (a + b) / 2, cy = (top + bottom) / 2;
    const left = Math.round(cx - side / 2), topEdge = Math.round(cy - side / 2);
    // a view owns the sheet out to half-way across the gap on each side: its neighbours must not creep into its square
    const ownLeft = i === 0 ? 0 : Math.ceil((figures[i - 1][1] + a) / 2), ownRight = i === figures.length - 1 ? W : Math.floor((b + figures[i + 1][0]) / 2);
    // take what exists of the square from the sheet, then pad the rest with background
    const x0 = Math.max(ownLeft, left), y0 = Math.max(0, topEdge), x1 = Math.min(ownRight, left + side), y1 = Math.min(H, topEdge + side);
    // two passes: sharp resizes before it pads whatever order the calls are written in, and the padding has to come first
    const square = await sharp(sheet)
      .removeAlpha()
      .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
      .extend({ left: x0 - left, top: y0 - topEdge, right: left + side - x1, bottom: topEdge + side - y1, background })
      .png()
      .toBuffer();
    views.push(await sharp(square).resize(out, out, { kernel: 'lanczos3' }).png().toBuffer());
  }
  return views;
};
