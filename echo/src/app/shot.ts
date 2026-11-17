import * as THREE from 'three';
import type { BuildContext, World } from '../world/World';
import { BedroomWorld } from '../world/bedroom/BedroomWorld';
import { ClassroomWorld } from '../world/classroom/ClassroomWorld';
import { HavenWorld } from '../world/haven/HavenWorld';
import { StudioWorld } from '../world/studio/StudioWorld';
import { AssetLibrary } from '../assets/AssetLibrary';
import { App } from './App';
import { numberParam } from './params';
import { isTier } from './quality';

type WorldFactory = (params: URLSearchParams) => World;

/** Worlds a capture can ask for by name: `?shot=<name>`. */
export const SHOT_WORLDS: Record<string, WorldFactory> = {
  studio: (p) => new StudioWorld(p),
  haven: () => new HavenWorld(),
  bedroom: () => new BedroomWorld(),
  classroom: () => new ClassroomWorld(),
};

const vec = (text: string | null, fallback: [number, number, number]): THREE.Vector3 => {
  const n = (text ?? '').split(',').map(Number);
  return n.length === 3 && n.every(Number.isFinite) ? new THREE.Vector3(n[0], n[1], n[2]) : new THREE.Vector3(...fallback);
};

/**
 * Capture mode: one world, one camera, an exact time. `?shot=studio&eye=0,1.5,3&at=0,1,0&t=2&q=high`
 * Add `live=1` to keep animating instead of holding the frame at `t`.
 */
export const runShot = async (canvas: HTMLCanvasElement, params: URLSearchParams): Promise<App> => {
  const name = params.get('shot') ?? 'studio';
  const factory = SHOT_WORLDS[name];
  if (!factory) throw new Error(`unknown shot world "${name}" (have: ${Object.keys(SHOT_WORLDS).join(', ')})`);
  const q = params.get('q');
  const app = new App({ canvas, tier: isTier(q) ? q : 'high', fixedScale: params.has('live') ? null : 1, maxDpr: numberParam(params, 'dpr', 1, 0.5, 3) });

  const world = factory(params);
  const ctx: BuildContext = { renderer: app.renderer, quality: app.quality, assets: new AssetLibrary(app.quality), step: () => new Promise((r) => setTimeout(r, 0)) };
  const t0 = performance.now();
  await world.build(ctx);
  app.setWorld(world);

  const eye = vec(params.get('eye'), [0, 1.5, 3.2]);
  const at = vec(params.get('at'), [0, 0.9, 0]);
  app.camera.position.copy(eye);
  app.camera.lookAt(at);
  if (params.has('fov')) {
    app.fovKick = numberParam(params, 'fov', 62, 10, 120) - 62;
  }
  app.post.warm();
  await app.renderer.compileAsync(world.scene, app.camera);

  const t = numberParam(params, 't', 0, 0, 3600);
  app.renderAt(t);
  app.renderAt(t); // second draw: shadow maps and any one-frame-late targets have settled
  window.__INFO = { ...app.info, buildMs: Math.round(performance.now() - t0), world: name };
  if (params.has('live')) app.start();
  (window as any).__world = world; window.__READY = true;
  return app;
};
