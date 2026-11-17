import * as THREE from 'three';
import { makeLook } from '../../render/PostPipeline';
import { bakeRoomEnvironment } from '../../render/env';
import { World, type BuildContext, type FrameContext } from '../World';
import { SUBJECTS } from './subjects';

/** Something to look at in the studio: an object and, optionally, how it moves. */
export interface Subject {
  readonly object: THREE.Object3D;
  update?(frame: FrameContext): void;
}
export type SubjectFactory = (ctx: BuildContext, params: URLSearchParams) => Subject | Promise<Subject>;

const primitives: SubjectFactory = () => {
  const g = new THREE.Group();
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, 0);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  mk(new THREE.SphereGeometry(0.35, 48, 32), new THREE.MeshStandardMaterial({ color: 0xe8dccf, roughness: 0.55 }), -1.2, 0.35);
  mk(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0x6f7fd8, roughness: 0.3, metalness: 0.1 }), -0.3, 0.3);
  mk(new THREE.TorusKnotGeometry(0.25, 0.09, 160, 24), new THREE.MeshPhysicalMaterial({ color: 0xd8a03a, roughness: 0.25, metalness: 1 }), 0.6, 0.45);
  mk(new THREE.SphereGeometry(0.2, 32, 24), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffc46b, emissiveIntensity: 6 }), 1.4, 0.6);
  return { object: g };
};

/** Asset viewer: a seamless backdrop under three-point light. `?shot=studio&subject=<name>`. */
export class StudioWorld extends World {
  readonly id = 'studio';
  readonly theme = 'real' as const;
  static readonly subjects: Record<string, SubjectFactory> = { primitives, ...SUBJECTS };
  private subject: Subject | null = null;

  constructor(private readonly params: URLSearchParams) {
    super();
    Object.assign(this.look, makeLook({ exposure: 1.0, bloom: 0.07, ao: 0.9, saturation: 1.1, contrast: 0.18, vignette: 0.25 }));
    this.far = 120;
  }

  async build(ctx: BuildContext): Promise<void> {
    const scene = this.scene;
    scene.background = new THREE.Color(0x8d8aa6);
    scene.environment = bakeRoomEnvironment(ctx.renderer);
    scene.environmentIntensity = 0.55;
    scene.fog = new THREE.Fog(0x8d8aa6, 14, 40);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: 0x8d8aa6, roughness: 0.92 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const key = new THREE.DirectionalLight(0xfff1e0, 3.2);
    key.position.set(-3.5, 6, 4.5);
    key.castShadow = true;
    key.shadow.mapSize.set(ctx.quality.shadowMapSize, ctx.quality.shadowMapSize);
    const c = key.shadow.camera;
    c.left = c.bottom = -4;
    c.right = c.top = 4;
    c.near = 0.5;
    c.far = 20;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    const rim = new THREE.DirectionalLight(0x9db8ff, 2.2);
    rim.position.set(4, 3.5, -5);
    scene.add(key, rim, new THREE.HemisphereLight(0xcfd6ff, 0x5a5468, 0.9));

    const name = this.params.get('subject') ?? 'primitives';
    const factory = StudioWorld.subjects[name];
    if (!factory) throw new Error(`unknown studio subject "${name}" (have: ${Object.keys(StudioWorld.subjects).join(', ')})`);
    await ctx.step(`studio: ${name}`);
    this.subject = await factory(ctx, this.params);
    scene.add(this.subject.object);
  }

  override update(frame: FrameContext): void {
    super.update(frame);
    this.subject?.update?.(frame);
  }
}
