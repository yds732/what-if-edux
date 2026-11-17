/**
 * Player collision on the ground plane. Every world is a walkable region minus a handful of obstacles, so the
 * player is a circle resolved against boxes, circles and an outer boundary: no physics engine, no tunnelling.
 */

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

export class Colliders {
  bounds: Bounds | null = null;
  readonly obstacles: Obstacle[] = [];

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

  /** Moves `p` (a circle of `radius`) out of every obstacle and back inside the bounds. Mutates and returns `p`. */
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
          // into the box's frame
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
            // centre is inside the box: leave through the nearest face
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
      const b = this.bounds;
      if (b) {
        if (b.kind === 'rect') {
          const x = Math.max(b.minX + radius, Math.min(b.maxX - radius, p.x));
          const z = Math.max(b.minZ + radius, Math.min(b.maxZ - radius, p.z));
          if (x !== p.x || z !== p.z) moved = true;
          p.x = x;
          p.z = z;
        } else {
          const dx = p.x - b.cx, dz = p.z - b.cz;
          const max = b.r - radius;
          const d2 = dx * dx + dz * dz;
          if (d2 > max * max) {
            const d = Math.sqrt(d2);
            p.x = b.cx + (dx / d) * max;
            p.z = b.cz + (dz / d) * max;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    return p;
  }
}
