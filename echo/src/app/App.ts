import * as THREE from 'three';
import { clamp } from '../core/math';
import { Tasks } from '../core/tasks';
import { PostPipeline, makeLook, type Look, type ScreenFx, type WorldWipe } from '../render/PostPipeline';
import type { World } from '../world/World';
import { ResolutionGovernor, settingsFor, type QualitySettings, type Tier } from './quality';

export interface System {
  update(dt: number, time: number): void;
}

export interface AppOptions {
  readonly canvas: HTMLCanvasElement;
  readonly tier: Tier;
  readonly fixedScale: number | null;
  readonly maxDpr: number;
}

const MAX_DT = 1 / 20;
const BASE_VFOV = 62;

export class App {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(BASE_VFOV, 1, 0.05, 200);
  readonly rig = new THREE.Group();
  overlay: { scene: THREE.Scene; camera: THREE.Camera } | null = null;
  onResize: ((width: number, height: number, dpr: number) => void) | null = null;
  readonly tasks = new Tasks();
  readonly fx: ScreenFx = { fade: 0, fadeColor: new THREE.Color(0, 0, 0), dim: 0, flash: 0, kick: 0, focus: 7 };
  readonly post: PostPipeline;
  readonly senses: System[] = [];
  readonly systems: System[] = [];
  readonly info = { frameMs: 0, calls: 0, triangles: 0, scale: 1, tier: 'high' as Tier, gpu: '?', width: 0, height: 0 };

  quality: QualitySettings;
  world: World | null = null;
  wipe: WorldWipe | null = null;
  lookOverride: Look | null = null;
  focus: number | null = null;
  fovKick = 0;
  private readonly motion = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.25 : 1;
  zoom = 0;
  time = 0;
  paused = false;

  private readonly governor: ResolutionGovernor;
  private readonly xrFade: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly maxDpr: number;
  private readonly fallbackLook = makeLook();
  private lastFrameAt = 0;
  private lastDt = 1 / 60;
  private sizeDirty = true;

  constructor(opts: AppOptions) {
    this.canvas = opts.canvas;
    this.maxDpr = opts.maxDpr;
    this.quality = settingsFor(opts.tier);
    this.info.tier = opts.tier;

    const renderer = new THREE.WebGLRenderer({ canvas: opts.canvas, antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.shadowMap.enabled = this.quality.shadows;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.info.autoReset = false;
    this.renderer = renderer;
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.info.gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '?';

    this.post = new PostPipeline(renderer, this.quality);
    this.post.motion = this.motion;
    this.governor = new ResolutionGovernor(() => (this.sizeDirty = true), opts.fixedScale);
    this.rig.add(this.camera);
    this.xrFade = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
    this.xrFade.renderOrder = 900;
    this.xrFade.visible = false;
    this.camera.add(this.xrFade);
    addEventListener('resize', () => (this.sizeDirty = true));
  }

  setWorld(world: World): void {
    this.world?.scene.remove(this.rig);
    this.world = world;
    world.scene.add(this.rig);
    if (!this.wipe) this.governor.reset();
    this.camera.near = world.near;
    this.camera.far = world.far;
    this.camera.updateProjectionMatrix();
  }

  setQuality(tier: Tier): void {
    this.quality = settingsFor(tier);
    this.info.tier = tier;
    this.post.setQuality(this.quality);
    this.sizeDirty = true;
  }

  private resize(): void {
    if (this.renderer.xr.isPresenting) return;
    this.sizeDirty = false;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w < 2 || h < 2) return;
    const dpr = Math.min(devicePixelRatio || 1, this.maxDpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    const bw = w * dpr, bh = h * dpr;
    const cap = Math.min(1, Math.sqrt(this.quality.maxPixels / (bw * bh)));
    const floor = this.governor.isFixed ? 0 : Math.min(1, 0.85 / dpr);
    const scale = Math.max(floor, cap * this.governor.scale);
    this.post.setSize(bw * scale, bh * scale);
    this.camera.aspect = w / h;
    this.info.scale = scale;
    this.info.width = this.post.sceneWidth;
    this.info.height = this.post.sceneHeight;
    this.onResize?.(w, h, dpr);
  }

  private applyFov(): void {
    const aspect = this.camera.aspect;
    const base = aspect >= 1.2 ? BASE_VFOV : clamp(2 * Math.atan(Math.tan((BASE_VFOV * Math.PI) / 360) * (1.2 / aspect)) * (180 / Math.PI), BASE_VFOV, 96);
    const fov = base + this.fovKick * this.motion - this.zoom;
    if (Math.abs(fov - this.camera.fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  step(dt: number): void {
    this.lastDt = dt;
    if (this.paused) return;
    this.time += dt;
    for (const s of this.senses) s.update(dt, this.time);
    this.tasks.update(dt);
    for (const s of this.systems) s.update(dt, this.time);
    const world = this.world;
    if (world) world.update({ dt, time: this.time, camera: this.camera, pixelHeight: this.canvas.clientHeight || 720 });
  }

  render(): void {
    const world = this.world;
    if (!world) return;
    if (this.sizeDirty) {
      this.resize();
      this.camera.updateProjectionMatrix();
    }
    this.applyFov();
    const r = this.renderer;
    r.info.reset();
    const look = this.lookOverride ?? world.look ?? this.fallbackLook;
    const inHeadset = r.xr.isPresenting;
    this.xrFade.visible = inHeadset && this.fx.fade > 0.003;
    if (this.xrFade.visible) {
      this.xrFade.material.color.copy(this.fx.fadeColor);
      this.xrFade.material.opacity = this.fx.fade;
    }
    if (inHeadset) {
      r.toneMappingExposure = look.exposure;
      // WebXRManager has already bound the headset's framebuffer for this frame.
      r.render(world.scene, this.camera);
    } else {
      this.fx.focus += ((this.focus ?? world.restFocus) - this.fx.focus) * (1 - Math.exp(-3 * this.lastDt));
      this.post.render({ scene: world.scene, camera: this.camera, look, time: this.time, fx: this.fx, wipe: this.wipe, overlay: this.overlay, prepass: world.prepass, shafts: world.shafts });
      this.fx.flash *= Math.exp(-5 * this.lastDt);
      this.fx.kick *= Math.exp(-6 * this.lastDt);
    }
    this.info.calls = r.info.render.calls;
    this.info.triangles = r.info.render.triangles;
  }

  sampleFrame(elapsedMs: number): void {
    this.info.frameMs += (elapsedMs - this.info.frameMs) * 0.1;
    if (!this.renderer.xr.isPresenting && !this.paused && !document.hidden) this.governor.sample(elapsedMs);
  }

  start(): void {
    this.lastFrameAt = 0;
    this.renderer.setAnimationLoop((now: number) => {
      const elapsed = this.lastFrameAt ? now - this.lastFrameAt : 1000 / 60;
      this.lastFrameAt = now;
      this.sampleFrame(elapsed);
      this.step(Math.min(elapsed / 1000, MAX_DT));
      this.render();
    });
  }

  stop(): void {
    this.renderer.setAnimationLoop(null);
  }

  renderAt(seconds: number, fps = 60): void {
    const dt = 1 / fps;
    while (this.time + dt * 0.5 < seconds) this.step(dt);
    this.render();
  }
}
