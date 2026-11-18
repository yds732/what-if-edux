export type Obstacle =
  | { readonly kind: 'box'; cx: number; cz: number; hx: number; hz: number; rot?: number }
  | { readonly kind: 'circle'; cx: number; cz: number; r: number };

export type Bounds =
  | { readonly kind: 'rect'; minX: number; maxX: number; minZ: number; maxZ: number }
  | { readonly kind: 'circle'; cx: number; cz: number; r: number };

export interface GroundPoint {
  x: number;
  z: number;
}

export class Walkway {
  reach = 1;
  private readonly cum: number[] = [0];

  constructor(readonly points: readonly { x: number; y: number; z: number }[], readonly halfWidth: number) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!;
      this.cum.push(this.cum[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z));
    }
  }

  get length(): number {
    return this.cum[this.cum.length - 1]!;
  }

  nearest(x: number, z: number): { d: number; y: number; x: number; z: number; past: number; tx: number; tz: number } | null {
    const limit = this.reach * this.length;
    if (limit <= 0) return null;
    let best: { d: number; y: number; x: number; z: number; past: number; tx: number; tz: number } | null = null;
    for (let i = 1; i < this.points.length; i++) {
      if (this.cum[i - 1]! >= limit) break;
      const a = this.points[i - 1]!, b = this.points[i]!;
      const seg = this.cum[i]! - this.cum[i - 1]!;
      const tMax = Math.min(1, (limit - this.cum[i - 1]!) / (seg || 1));
      const ex = b.x - a.x, ez = b.z - a.z;
      const raw = ((x - a.x) * ex + (z - a.z) * ez) / (seg * seg || 1);
      const t = Math.max(0, Math.min(tMax, raw));
      const px = a.x + ex * t, pz = a.z + ez * t;
      const d = Math.hypot(x - px, z - pz);
      const past = tMax < 1 || i === this.points.length - 1 ? Math.max(0, (raw - tMax) * seg) : 0;
      if (!best || d < best.d) best = { d, y: a.y + (b.y - a.y) * t, x: px, z: pz, past, tx: ex / (seg || 1), tz: ez / (seg || 1) };
    }
    return best;
  }
}

export class Colliders {
  bounds: Bounds | null = null;
  readonly obstacles: Obstacle[] = [];
  readonly walkways: Walkway[] = [];

  groundAt(x: number, z: number, radius: number): number | null {
    if (this.insideBounds(x, z, radius)) return null;
    for (const w of this.walkways) {
      const n = w.nearest(x, z);
      if (n && n.d <= w.halfWidth && n.past === 0) return n.y;
    }
    return null;
  }

  private clampToBounds(p: GroundPoint, radius: number): GroundPoint {
    const b = this.bounds;
    if (!b) return p;
    if (b.kind === 'rect') {
      p.x = Math.max(b.minX + radius, Math.min(b.maxX - radius, p.x));
      p.z = Math.max(b.minZ + radius, Math.min(b.maxZ - radius, p.z));
      return p;
    }
    const dx = p.x - b.cx, dz = p.z - b.cz, max = b.r - radius, d = Math.hypot(dx, dz);
    if (d > max) { p.x = b.cx + (dx / d) * max; p.z = b.cz + (dz / d) * max; }
    return p;
  }

  private insideBounds(x: number, z: number, radius: number): boolean {
    const b = this.bounds;
    if (!b) return true;
    if (b.kind === 'rect') return x >= b.minX + radius && x <= b.maxX - radius && z >= b.minZ + radius && z <= b.maxZ - radius;
    const max = b.r - radius;
    return (x - b.cx) ** 2 + (z - b.cz) ** 2 <= max * max;
  }

  box(cx: number, cz: number, hx: number, hz: number, rot = 0): this {
    this.obstacles.push({ kind: 'box', cx, cz, hx, hz, rot });
    return this;
  }

  circle(cx: number, cz: number, r: number): this {
    this.obstacles.push({ kind: 'circle', cx, cz, r });
    return this;
  }

  remove(obstacle: Obstacle): void {
    const i = this.obstacles.indexOf(obstacle);
    if (i >= 0) this.obstacles.splice(i, 1);
  }

  resolve(p: GroundPoint, radius: number): GroundPoint {
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const o of this.obstacles) {
        if (o.kind === 'circle') {
          const dx = p.x - o.cx, dz = p.z - o.cz;
          const min = o.r + radius;
          const d2 = dx * dx + dz * dz;
          if (d2 >= min * min) continue;
          const d = Math.sqrt(d2);
          if (d < 1e-6) {
            p.x = o.cx + min;
          } else {
            p.x = o.cx + (dx / d) * min;
            p.z = o.cz + (dz / d) * min;
          }
          moved = true;
        } else {
          const rot = o.rot ?? 0;
          const c = Math.cos(rot), s = Math.sin(rot);
          const wx = p.x - o.cx, wz = p.z - o.cz;
          const lx = wx * c + wz * s, lz = -wx * s + wz * c;
          const qx = Math.max(-o.hx, Math.min(o.hx, lx)), qz = Math.max(-o.hz, Math.min(o.hz, lz));
          let dx = lx - qx, dz = lz - qz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= radius * radius) continue;
          let nx: number, nz: number;
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2);
            dx /= d;
            dz /= d;
            nx = qx + dx * radius;
            nz = qz + dz * radius;
          } else {
            const ex = o.hx - Math.abs(lx), ez = o.hz - Math.abs(lz);
            if (ex < ez) {
              nx = Math.sign(lx || 1) * (o.hx + radius);
              nz = lz;
            } else {
              nx = lx;
              nz = Math.sign(lz || 1) * (o.hz + radius);
            }
          }
          p.x = o.cx + nx * c - nz * s;
          p.z = o.cz + nx * s + nz * c;
          moved = true;
        }
      }
      if (this.bounds && !this.insideBounds(p.x, p.z, radius)) {
        const inBounds = this.clampToBounds({ x: p.x, z: p.z }, radius);
        let best = inBounds, bestD = Math.hypot(inBounds.x - p.x, inBounds.z - p.z);
        for (const w of this.walkways) {
          const n = w.nearest(p.x, p.z);
          if (!n) continue;
          const room = Math.max(0.05, w.halfWidth - radius);
          if (n.past > 0) {
            const bx = p.x - n.tx * n.past, bz = p.z - n.tz * n.past;
            const sx = bx - n.x, sz = bz - n.z, side = Math.hypot(sx, sz), k = side > room ? room / side : 1;
            const cx = n.x + sx * k, cz = n.z + sz * k, d = Math.hypot(cx - p.x, cz - p.z);
            if (d < bestD) { bestD = d; best = { x: cx, z: cz }; }
            continue;
          }
          if (n.d <= room) { bestD = 0; best = { x: p.x, z: p.z }; break; }
          const k = room / n.d, d = n.d - room;
          if (d < bestD) { bestD = d; best = { x: n.x + (p.x - n.x) * k, z: n.z + (p.z - n.z) * k }; }
        }
        if (bestD > 0) { p.x = best.x; p.z = best.z; moved = true; }
      }
      if (!moved) break;
    }
    return p;
  }
}
