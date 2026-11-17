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
  /** Pins the internal resolution scale (captures, benchmarks); null lets the governor steer it. */
  readonly fixedScale: number | null;
  readonly maxDpr: number;
}

const MAX_DT = 1 / 20;
const BASE_VFOV = 62;

/** The engine: renderer, camera rig, clock, the active world and the systems that run each frame. */
export class App {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(BASE_VFOV, 1, 0.05, 200);
  /** Moves through the world; the camera (and XR controllers) ride on it. */
  readonly rig = new THREE.Group();
  /** HUD drawn over the graded frame at native resolution, through its own camera. */
  overlay: { scene: THREE.Scene; camera: THREE.Camera } | null = null;
  /** Called after a resize with the canvas size in CSS pixels and the buffer's pixel ratio. */
  onResize: ((width: number, height: number, dpr: number) => void) | null = null;
  readonly tasks = new Tasks();
  readonly fx: ScreenFx = { fade: 0, fadeColor: new THREE.Color(0, 0, 0), dim: 0, flash: 0, kick: 0 };
  readonly post: PostPipeline;
  /** Whatever reads the player's hands. These run first, so the story sees this frame's presses as the systems do. */
  readonly senses: System[] = [];
  /** Updated in order after the story, before the frame is drawn. */
  readonly systems: System[] = [];
  readonly info = { frameMs: 0, calls: 0, triangles: 0, scale: 1, tier: 'high' as Tier, gpu: '?', width: 0, height: 0 };

  quality: QualitySettings;
  world: World | null = null;
  wipe: WorldWipe | null = null;
  /** When set, replaces the active world's look (transitions blend two worlds' looks here). */
  lookOverride: Look | null = null;
  /** Added to the base field of view by gameplay (drawing back a throw). */
  fovKick = 0;
  /** 1, or less where the player's device asks for reduced motion: flashes and camera punches step down. */
  private readonly motion = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.25 : 1;
  /** Degrees taken off the field of view by the story: leaning in to read a screen. */
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

    // `antialias` only matters for XR (its layer takes MSAA from the context); flat rendering resolves its own HDR target
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
    // a headset has no post pass to fade with: a small shell around the eyes does it instead
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
    if (this.renderer.xr.isPresenting) return; // the headset owns the framebuffer; try again when the session ends
    this.sizeDirty = false;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w < 2 || h < 2) return;
    const dpr = Math.min(devicePixelRatio || 1, this.maxDpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    const bw = w * dpr, bh = h * dpr;
    const cap = Math.min(1, Math.sqrt(this.quality.maxPixels / (bw * bh)));
    const scale = cap * this.governor.scale;
    this.post.setSize(bw * scale, bh * scale);
    this.camera.aspect = w / h;
    this.info.scale = scale;
    this.info.width = this.post.sceneWidth;
    this.info.height = this.post.sceneHeight;
    this.onResize?.(w, h, dpr);
  }

  private applyFov(): void {
    // hold the horizontal view on tall screens: a phone held upright widens vertically instead of cropping the sides
    const aspect = this.camera.aspect;
    const base = aspect >= 1.2 ? BASE_VFOV : clamp(2 * Math.atan(Math.tan((BASE_VFOV * Math.PI) / 360) * (1.2 / aspect)) * (180 / Math.PI), BASE_VFOV, 96);
    const fov = base + this.fovKick * this.motion - this.zoom;
    if (Math.abs(fov - this.camera.fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Advances every system by `dt` seconds of game time. */
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
      r.setRenderTarget(null);
      r.render(world.scene, this.camera);
    } else {
      this.post.render({ scene: world.scene, camera: this.camera, look, time: this.time, fx: this.fx, wipe: this.wipe, overlay: this.overlay, prepass: world.prepass });
      // flashes and lens kicks are impulses: whoever raises them need not lower them
      this.fx.flash *= Math.exp(-5 * this.lastDt);
      this.fx.kick *= Math.exp(-6 * this.lastDt);
    }
    this.info.calls = r.info.render.calls;
    this.info.triangles = r.info.render.triangles;
  }

  /** Feeds one displayed frame's wall time to the resolution governor and the frame-time readout. */
  sampleFrame(elapsedMs: number): void {
    this.info.frameMs += (elapsedMs - this.info.frameMs) * 0.1;
    if (!this.renderer.xr.isPresenting && !this.paused && !document.hidden) this.governor.sample(elapsedMs);
  }

  /** Starts the live loop. */
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

  /** Deterministic playback for captures and tests: fixed steps up to `seconds`, then one frame. */
  renderAt(seconds: number, fps = 60): void {
    const dt = 1 / fps;
    while (this.time + dt * 0.5 < seconds) this.step(dt);
    this.render();
  }
}
