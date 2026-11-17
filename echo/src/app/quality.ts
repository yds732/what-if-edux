import { clamp } from '../core/math';

export type Tier = 'low' | 'medium' | 'high' | 'ultra';
export const TIERS: readonly Tier[] = ['low', 'medium', 'high', 'ultra'];

export interface QualitySettings {
  readonly tier: Tier;
  /** Upper bound on scene pixels before `scale` is applied. */
  readonly maxPixels: number;
  readonly msaa: 0 | 2 | 4;
  readonly ao: boolean;
  /** Light shafts and depth of field: the cinematic lens. */
  readonly shafts: boolean;
  readonly dof: boolean;
  readonly bloomLevels: number;
  readonly shadowMapSize: number;
  /** 0..1 multiplier on instance counts: grass, petals, fireflies, far islands. */
  readonly density: number;
  readonly anisotropy: number;
  /** Real-time shadow maps. Without them, people stand on soft painted shadows instead. */
  readonly shadows: boolean;
}

const PRESETS: Record<Tier, QualitySettings> = {
  low: { tier: 'low', shafts: false, dof: false, maxPixels: 0.9e6, msaa: 0, ao: false, bloomLevels: 4, shadowMapSize: 1024, density: 0.4, anisotropy: 2, shadows: false },
  medium: { tier: 'medium', shafts: true, dof: true, maxPixels: 1.6e6, msaa: 2, ao: true, bloomLevels: 5, shadowMapSize: 2048, density: 0.7, anisotropy: 4, shadows: true },
  high: { tier: 'high', shafts: true, dof: true, maxPixels: 2.6e6, msaa: 4, ao: true, bloomLevels: 5, shadowMapSize: 2048, density: 1, anisotropy: 8, shadows: true },
  ultra: { tier: 'ultra', shafts: true, dof: true, maxPixels: 4.2e6, msaa: 4, ao: true, bloomLevels: 6, shadowMapSize: 4096, density: 1, anisotropy: 16, shadows: true },
};

export const isTier = (v: string | null): v is Tier => v !== null && (TIERS as readonly string[]).includes(v);

/** Graphics that share a laptop's memory and power budget, and software renderers: by the name the GPU reports. */
const MODEST_GPU = /Intel|Radeon\(TM\) Graphics|Radeon Graphics|Vega \d|Mali|Adreno|PowerVR|Microsoft Basic|SwiftShader|llvmpipe/i;

/** Where a desktop-class machine starts, from its GPU's name ('' when the browser will not say). */
export const tierForGpu = (renderer: string): Tier => (MODEST_GPU.test(renderer) ? 'medium' : 'high');

const gpuName = (): string => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  // Firefox gives the name under RENDERER itself; elsewhere that is a generic string, which simply reads as unknown
  const name = gl ? String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : '';
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return name;
};

/**
 * First guess before any frame has been timed: headsets and phones start low; tablets and laptops on integrated
 * graphics medium; everything else high. The resolution governor takes it from there.
 */
export const detectTier = (): Tier => (detected ??= probeTier());
let detected: Tier | null = null;

const probeTier = (): Tier => {
  // a standalone headset draws everything twice on a phone's GPU
  if (/OculusBrowser|Quest|Pico|VisionOS/i.test(navigator.userAgent)) return 'low';
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 820;
  if (coarse && small) return 'low';
  if (coarse) return 'medium';
  return tierForGpu(gpuName());
};

export const settingsFor = (tier: Tier): QualitySettings => PRESETS[tier];

/**
 * Keeps the frame time near the display's refresh by scaling the internal resolution. Scene targets shrink; the
 * canvas, the final composite and the HUD stay at native resolution, so text never softens.
 */
export class ResolutionGovernor {
  /** Fraction of `maxPixels` actually rendered, as a linear scale on each axis. */
  scale = 1;
  private acc = 0;
  private frames = 0;
  private slowWindows = 0;
  private goodMs = 0;
  private upWait = 4000;
  private probing = 0;
  private static readonly STEPS = [1, 0.87, 0.76, 0.66, 0.58, 0.5];
  private level = 0;

  constructor(private readonly onChange: (scale: number) => void, private readonly fixed: number | null = null) {
    if (fixed !== null) this.scale = clamp(fixed, 0.3, 1);
  }

  /** Feed every rendered frame's wall time in ms. */
  sample(frameMs: number, targetMs = 1000 / 60): void {
    if (this.fixed !== null) return;
    if (frameMs > 250) {
      this.acc = 0;
      this.frames = 0;
      return; // a stall or a tab switch, not a slow GPU
    }
    this.acc += frameMs;
    this.frames++;
    if (this.acc < 750) return;
    const avg = this.acc / this.frames;
    const span = this.acc;
    this.acc = 0;
    this.frames = 0;

    const steps = ResolutionGovernor.STEPS;
    if (avg > targetMs * 1.2) {
      this.goodMs = 0;
      if (++this.slowWindows >= 2 && this.level < steps.length - 1) {
        this.slowWindows = 0;
        if (this.probing) {
          this.upWait = Math.min(this.upWait * 2, 64000);
          this.probing = 0;
        }
        this.setLevel(this.level + 1);
      }
      return;
    }
    this.slowWindows = 0;
    this.goodMs = avg < targetMs * 1.08 ? this.goodMs + span : 0;
    if (this.probing && (this.probing += span) > 8000) {
      this.probing = 0;
      this.upWait = 4000;
    }
    if (this.level > 0 && this.goodMs >= this.upWait) {
      this.goodMs = 0;
      this.probing = 1;
      this.setLevel(this.level - 1);
    }
  }

  private setLevel(level: number): void {
    this.level = level;
    this.scale = ResolutionGovernor.STEPS[level] ?? 0.5;
    this.onChange(this.scale);
  }
}
