import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { QualitySettings, Tier } from '../app/quality';
import { addGlow, type Glow } from './glow';
import { loadGltf } from './gltf';

/** Generated models come in three weights; the two top graphics tiers share the heaviest. */
export type AssetTier = 'high' | 'medium' | 'low';
const ASSET_TIER: Record<Tier, AssetTier> = { low: 'low', medium: 'medium', high: 'high', ultra: 'high' };

interface TierFile {
  readonly file: string;
  readonly triangles: number;
  readonly bytes: number;
}

/**
 * Which of a generated skeleton's bones is which, by their place in the skeleton's list of bones.
 * An arm is [shoulder, elbow, wrist] and a leg [hip, knee, ankle]; left and right are the figure's own.
 */
export interface RigMap {
  /** The root bone, which carries the whole figure. */
  readonly hips: number;
  readonly spine: number | null;
  readonly chest: number;
  readonly neck: number | null;
  readonly head: number;
  readonly armL: readonly number[];
  readonly armR: readonly number[];
  readonly legL: readonly number[];
  readonly legR: readonly number[];
}

/**
 * One line of public/assets/manifest.json, written by tools/assets/optimize.mjs. Every model stands on the
 * origin, in metres, facing +Z.
 */
export interface AssetEntry {
  readonly kind: 'character' | 'prop';
  readonly world: 'real' | 'haven';
  readonly tiers: Record<AssetTier, TierFile>;
  /** Characters: standing height in metres. */
  readonly height?: number;
  readonly rig?: RigMap;
  /** How the model's painted lights shine. A character's is applied by the character, which owns its material. */
  readonly glow?: Glow;
  /**
   * Characters: nudges the drawn face where the automatic fit from the nose is not quite right.
   * `up` and `out` are in head radii, `size` multiplies the radius.
   */
  readonly face?: { readonly up?: number; readonly out?: number; readonly size?: number };
  /** Props: width, height and depth in metres, as stored in the file. */
  readonly size?: readonly [number, number, number];
}

/** A flat picture in public/assets/manifest.json, written by tools/assets/picture.mjs. */
export interface PictureEntry {
  readonly world: 'real' | 'haven';
  readonly file: string;
  /** A repeating texture's relief map. */
  readonly normal?: string;
  /** Width and height in pixels. */
  readonly size: readonly [number, number];
  /** Whether it repeats: a floor does, a poster does not. */
  readonly tile: boolean;
}

export interface Picture {
  readonly entry: PictureEntry;
  readonly map: THREE.Texture;
  readonly normalMap: THREE.Texture | null;
}

interface Manifest {
  readonly assets: Record<string, AssetEntry>;
  readonly pictures: Record<string, PictureEntry>;
}

export interface Model {
  readonly id: string;
  readonly entry: AssetEntry;
  /** The loaded scene. Shared: take a copy with `AssetLibrary.instance` rather than adding this to a world. */
  readonly scene: THREE.Group;
}

/**
 * The generated models: fetched once, in the weight that suits the device, and handed out as copies that share
 * geometry and textures. Everything a world needs is asked for while it is being built, so the wait is up front.
 */
export class AssetLibrary {
  /** Bytes fetched and bytes expected, over everything asked for so far. */
  onProgress: ((loaded: number, total: number) => void) | null = null;

  private readonly tier: AssetTier;
  private manifest: Promise<Manifest> | null = null;
  private readonly pictures = new Map<string, Promise<Picture>>();
  private readonly textures = new THREE.TextureLoader();
  private readonly models = new Map<string, Promise<Model>>();
  private readonly fetched = new Map<string, number>();
  private expected = 0;

  constructor(private readonly quality: QualitySettings, private readonly base = `${import.meta.env.BASE_URL}assets/`) {
    this.tier = ASSET_TIER[quality.tier];
  }

  private contents(): Promise<Manifest> {
    this.manifest ??= fetch(`${this.base}manifest.json`).then(async (r) => {
      if (!r.ok) throw new Error(`the asset manifest could not be loaded (${r.status})`);
      return (await r.json()) as Manifest;
    });
    return this.manifest;
  }

  private async entries(): Promise<Record<string, AssetEntry>> {
    return (await this.contents()).assets;
  }

  /** Fetches a flat picture (once): a floor, a rug, a poster. A repeating one comes ready to repeat. */
  picture(id: string): Promise<Picture> {
    let pending = this.pictures.get(id);
    if (!pending) {
      pending = this.loadPicture(id);
      this.pictures.set(id, pending);
    }
    return pending;
  }

  private async loadPicture(id: string): Promise<Picture> {
    const entry = (await this.contents()).pictures[id];
    if (!entry) throw new Error(`there is no generated picture called "${id}"`);
    const [map, normalMap] = await Promise.all([this.textures.loadAsync(this.base + entry.file), entry.normal ? this.textures.loadAsync(this.base + entry.normal) : null]);
    map.colorSpace = THREE.SRGBColorSpace;
    for (const texture of [map, normalMap]) {
      if (!texture) continue;
      texture.anisotropy = this.quality.anisotropy;
      if (entry.tile) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    }
    return { entry, map, normalMap };
  }

  /** Whether a generated model exists for this id. */
  async has(id: string): Promise<boolean> {
    return id in (await this.entries());
  }

  /** Fetches a model (once) and prepares its materials for this device. */
  model(id: string): Promise<Model> {
    let pending = this.models.get(id);
    if (!pending) {
      pending = this.load(id);
      this.models.set(id, pending);
    }
    return pending;
  }

  private async load(id: string): Promise<Model> {
    const entry = (await this.entries())[id];
    if (!entry) throw new Error(`there is no generated asset called "${id}"`);
    const tier = entry.tiers[this.tier];
    this.expected += tier.bytes;
    const gltf = await loadGltf(this.base + tier.file, (loaded) => {
      this.fetched.set(id, loaded);
      this.report();
    });
    this.fetched.set(id, tier.bytes);
    this.report();
    gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = o.receiveShadow = true;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (entry.glow && entry.kind === 'prop') addGlow(m as THREE.MeshStandardMaterial, entry.glow);
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap'] as const) {
          const texture = (m as THREE.MeshStandardMaterial)[key];
          if (texture) texture.anisotropy = this.quality.anisotropy;
        }
      }
    });
    return { id, entry, scene: gltf.scene };
  }

  /** Bytes of models fetched so far, over the whole session. */
  get loaded(): number {
    let loaded = 0;
    for (const n of this.fetched.values()) loaded += n;
    return Math.min(loaded, this.expected);
  }

  private report(): void {
    this.onProgress?.(this.loaded, this.expected);
  }

  /** A copy of a model to place in a world. Copies share geometry and textures; skinned copies get their own bones. */
  async instance(id: string): Promise<THREE.Group> {
    return cloneSkinned((await this.model(id)).scene) as THREE.Group;
  }

  /** Many copies of a static model drawn as one batch: `transforms` are the world matrices of the copies. */
  async instanced(id: string, transforms: readonly THREE.Matrix4[]): Promise<THREE.Group> {
    const { scene } = await this.model(id);
    scene.updateMatrixWorld(true);
    const group = new THREE.Group();
    group.name = `${id} x${transforms.length}`;
    const m = new THREE.Matrix4();
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const batch = new THREE.InstancedMesh(o.geometry as THREE.BufferGeometry, o.material as THREE.Material, transforms.length);
      transforms.forEach((t, i) => batch.setMatrixAt(i, m.multiplyMatrices(t, o.matrixWorld)));
      batch.castShadow = batch.receiveShadow = true;
      batch.computeBoundingSphere();
      group.add(batch);
    });
    return group;
  }
}
