import * as THREE from 'three';
import { merge, place, roundBox, tint, type V3 } from '../core/geo';

export type Finish = 'matte' | 'satin' | 'gloss' | 'metal' | 'glow';

const MATERIALS: Record<Finish, () => THREE.Material> = {
  matte: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
  satin: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }),
  gloss: () => new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.16, clearcoat: 0.6, clearcoatRoughness: 0.15 }),
  metal: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.9 }),
  glow: () => new THREE.MeshBasicMaterial({ vertexColors: true }),
};

export class Builder {
  private readonly parts: Record<Finish, THREE.BufferGeometry[]> = { matte: [], satin: [], gloss: [], metal: [], glow: [] };

  add(finish: Finish, color: THREE.ColorRepresentation, geometry: THREE.BufferGeometry): this {
    this.parts[finish].push(tint(geometry, color));
    return this;
  }

  box(finish: Finish, color: THREE.ColorRepresentation, size: V3, at: V3, opts: { r?: number; rot?: V3 } = {}): this {
    const g = opts.r ? roundBox(size[0], size[1], size[2], opts.r, 2) : new THREE.BoxGeometry(size[0], size[1], size[2]);
    g.deleteAttribute('uv');
    return this.add(finish, color, place(g, at, opts.rot));
  }

  cyl(finish: Finish, color: THREE.ColorRepresentation, radius: number, height: number, at: V3, opts: { top?: number; radial?: number; rot?: V3 } = {}): this {
    const g = new THREE.CylinderGeometry(opts.top ?? radius, radius, height, opts.radial ?? 20);
    g.deleteAttribute('uv');
    g.translate(0, height / 2, 0);
    return this.add(finish, color, place(g, at, opts.rot));
  }

  finish(parent: THREE.Object3D, opts: { glow?: number; shadows?: boolean } = {}): Partial<Record<Finish, THREE.Mesh>> {
    const out: Partial<Record<Finish, THREE.Mesh>> = {};
    for (const key of Object.keys(this.parts) as Finish[]) {
      const list = this.parts[key];
      if (list.length === 0) continue;
      const material = MATERIALS[key]();
      if (key === 'glow') (material as THREE.MeshBasicMaterial).color.setScalar(opts.glow ?? 2.5);
      const mesh = new THREE.Mesh(merge(list), material);
      if (key !== 'glow' && opts.shadows !== false) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
      parent.add(mesh);
      out[key] = mesh;
      this.parts[key] = [];
    }
    return out;
  }
}

export const makePoster = (width: number, height: number, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.Mesh => {
  const px = 512, py = Math.round((512 * height) / width);
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = py;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');
  paint(ctx, px, py);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8 }));
  mesh.receiveShadow = true;
  return mesh;
};
