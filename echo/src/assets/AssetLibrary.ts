import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { QualitySettings, Tier } from '../app/quality';
import { addGlow, type Glow } from './glow';
import { loadGltf } from './gltf';

export type AssetTier = 'high' | 'medium' | 'low';
const ASSET_TIER: Record<Tier, AssetTier> = { low: 'low', medium: 'medium', high: 'high', ultra: 'high' };

interface TierFile {
  readonly file: string;
  readonly triangles: number;
  readonly bytes: number;
}

export interface RigMap {
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

export interface AssetEntry {
  readonly kind: 'character' | 'prop';
  readonly world: 'real' | 'haven';
  readonly tiers: Record<AssetTier, TierFile>;
  readonly height?: number;
  readonly rig?: RigMap;
  readonly glow?: Glow;
  readonly face?: { readonly up?: number; readonly out?: number; readonly size?: number };
  readonly size?: readonly [number, number, number];
}

export interface PictureEntry {
  readonly world: 'real' | 'haven';
  readonly file: string;
  readonly normal?: string;
  readonly size: readonly [number, number];
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
  readonly scene: THREE.Group;
}

export class AssetLibrary {
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

  async has(id: string): Promise<boolean> {
    return id in (await this.entries());
  }

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

  get loaded(): number {
    let loaded = 0;
    for (const n of this.fetched.values()) loaded += n;
    return Math.min(loaded, this.expected);
  }

  private report(): void {
    this.onProgress?.(this.loaded, this.expected);
  }

  async instance(id: string): Promise<THREE.Group> {
    return cloneSkinned((await this.model(id)).scene) as THREE.Group;
  }

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
