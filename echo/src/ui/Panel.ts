import * as THREE from 'three';
import { damp } from '../core/math';

const unitQuad = new THREE.PlaneGeometry(1, 1);

export class Panel {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private density = 0;
  width: number;
  height: number;

  constructor(width: number, height: number, opts: { world?: boolean; additive?: boolean } = {}) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is unavailable');
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.premultiplyAlpha = true;
    this.texture.generateMipmaps = !!opts.world;
    this.texture.minFilter = opts.world ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    this.texture.anisotropy = opts.world ? 8 : 1;
    const material = new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, premultipliedAlpha: true, depthWrite: false, depthTest: !!opts.world, toneMapped: false, fog: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending, side: opts.world ? THREE.DoubleSide : THREE.FrontSide,
    });
    this.mesh = new THREE.Mesh(unitQuad, material);
    if (!opts.world) this.mesh.renderOrder = 1000;
    this.mesh.scale.set(width, height, 1);
    this.setDensity(2);
  }

  setDensity(density: number): boolean {
    const d = Math.min(4, Math.max(0.5, density));
    const w = Math.max(2, Math.round(this.width * d)), h = Math.max(2, Math.round(this.height * d));
    if (d === this.density && w === this.canvas.width && h === this.canvas.height) return false;
    this.density = d;
    this.canvas.width = w;
    this.canvas.height = h;
    this.texture.dispose();
    return true;
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.mesh.scale.set(width, height, 1);
    const d = this.density;
    this.density = 0;
    this.setDensity(d);
  }

  paint(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.density, 0, 0, this.density, 0, 0);
    draw(ctx, this.width, this.height);
    this.texture.needsUpdate = true;
  }

  set opacity(v: number) {
    this.mesh.material.opacity = v;
    this.mesh.visible = v > 0.003;
  }
  get opacity(): number {
    return this.mesh.material.opacity;
  }

  dispose(): void {
    this.texture.dispose();
    this.mesh.material.dispose();
  }
}

export class Widget {
  readonly panel: Panel;
  x = 0;
  y = 0;
  visible = false;
  slide = 10;
  rate = 9;
  private shown = 0;

  constructor(width: number, height: number) {
    this.panel = new Panel(width, height);
    this.panel.opacity = 0;
  }

  get alpha(): number {
    return this.shown;
  }

  snap(): void {
    this.shown = this.visible ? 1 : 0;
    this.layout();
  }

  update(dt: number): void {
    const target = this.visible ? 1 : 0;
    if (Math.abs(this.shown - target) < 0.002) this.shown = target;
    else this.shown = damp(this.shown, target, this.rate, dt);
    this.layout();
  }

  private layout(): void {
    this.panel.opacity = this.shown;
    this.panel.mesh.position.set(this.x, this.y - (1 - this.shown) * this.slide, 0);
  }

  contains(px: number, py: number): boolean {
    return Math.abs(px - this.x) <= this.panel.width / 2 && Math.abs(py - this.y) <= this.panel.height / 2;
  }
}
