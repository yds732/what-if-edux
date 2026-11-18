import * as THREE from 'three';
import { DEG, Rng, clamp, damp, lerp } from '../core/math';
import type { Model } from '../assets/AssetLibrary';
import type { BuildContext } from '../world/World';
import { addGlow } from '../assets/glow';
import { GeneratedBody } from './GeneratedBody';
import { addHologram, type Hologram } from './hologram';
import { GESTURES, POSES, type GestureName, type PoseName } from './motion';
import { FaceLayer, neutralFace, type FaceLook, type FaceState } from './head';
import { BONES, type BoneName, type Rig } from './skeleton';
import { characterYaw, type Anchor } from '../world/World';
import { getHaloTexture } from '../world/haven/atmosphere';

export interface CharacterSpec {
  readonly name: string;
  readonly face?: Partial<FaceLook>;
  readonly aura?: THREE.ColorRepresentation;
  readonly rest?: Partial<FaceState>;
  readonly scale?: number;
}

export type Mood = 'neutral' | 'happy' | 'delighted' | 'thinking' | 'worried' | 'sad' | 'surprised' | 'firm' | 'blank';

const MOODS: Record<Mood, Partial<FaceState>> = {
  neutral: {},
  happy: { mouthSmile: 0.55, mouthWidth: 1.06, eyeSmile: 0.1, eyeL: 0.94, eyeR: 0.94, browRaise: 0.12, blush: 0.08 },
  delighted: { mouthSmile: 0.65, mouthOpen: 0.2, mouthWidth: 1.12, eyeSmile: 0.25, eyeL: 0.8, eyeR: 0.8, browRaise: 0.3, blush: 0.15 },
  thinking: { mouthSmile: 0, mouthWidth: 0.8, browRaise: 0.35, browTilt: 0.1, gazeX: 0.6, gazeY: 0.5 },
  worried: { mouthSmile: -0.3, mouthWidth: 0.85, browRaise: 0.3, browTilt: 0.8, eyeL: 0.95, eyeR: 0.95 },
  sad: { mouthSmile: -0.45, mouthWidth: 0.9, browTilt: 0.7, browRaise: -0.1, eyeL: 0.75, eyeR: 0.75, gazeY: -0.5 },
  surprised: { mouthOpen: 0.35, mouthWidth: 0.7, mouthSmile: 0, eyeL: 1.18, eyeR: 1.18, browRaise: 0.8 },
  firm: { mouthSmile: -0.1, mouthWidth: 0.9, browTilt: -0.3, browRaise: -0.2 },
  blank: { mouthSmile: 0.45, eyeSmile: 0, browRaise: 0, browTilt: 0, blush: 0 },
};

const FACE_KEYS = ['eyeL', 'eyeR', 'eyeSmile', 'gazeX', 'gazeY', 'mouthOpen', 'mouthSmile', 'mouthWidth', 'browRaise', 'browTilt', 'blush'] as const;

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();

export class Character {
  readonly root = new THREE.Group();
  readonly rig: Rig;
  readonly spec: CharacterSpec;
  readonly eyeHeight: number;

  private readonly faceMat: FaceLayer;
  private readonly body: GeneratedBody;
  private readonly hologram: Hologram;
  private readonly face: FaceState;
  private readonly faceTarget: FaceState;
  private readonly restFace: FaceState;
  private readonly rng: Rng;
  private readonly head: THREE.Group;
  private readonly offsets = {} as Record<BoneName, THREE.Vector3>;
  private readonly bindY: number;

  private pose: PoseName = 'stand';
  private poseBlend = 12;
  private gesture: { name: GestureName; time: number; hold: boolean } | null = null;
  private lookAt: THREE.Vector3 | null = null;
  private lookYaw = 0;
  private lookPitch = 0;
  private blinkIn: number;
  private blink = 0;
  private talk = 0;
  private talkTarget = 0;
  private talkPhase = 0;
  private syllable = 0;
  private phase: number;
  private hover = 0;
  private liveliness = 1;
  private seatHeight = 0.36;
  onPose: ((bones: Rig['bones']) => void) | null = null;

  constructor(spec: CharacterSpec, model: Model, shadowMaps = true) {
    this.spec = spec;
    this.rng = new Rng(hashName(spec.name));
    this.phase = this.rng.range(0, 10);
    this.blinkIn = this.rng.range(1, 4);
    this.head = new THREE.Group();
    const body = (this.body = new GeneratedBody(model));
    this.rig = body.rig;
    this.root.add(body.root);
    const { centre, radius } = body.face;
    const toFace = new THREE.Matrix4().makeScale(1 / radius, 1 / radius, 1 / radius).multiply(_m.makeTranslation(-centre.x, -centre.y, -centre.z)).multiply(body.toCharacter);
    this.faceMat = new FaceLayer(spec.face ?? {}, toFace);
    this.faceMat.install(body.material);
    if (model.entry.glow) addGlow(body.material, model.entry.glow);
    this.hologram = addHologram(body.material);
    this.head.position.copy(centre).sub(this.rig.joints.head);
    this.eyeHeight = (centre.y - radius * 0.07) * (spec.scale ?? 1);
    this.rig.bones.head.add(this.head);
    for (const name of BONES) this.offsets[name] = this.rig.bones[name].position.clone();
    this.bindY = this.rig.bones.hips.position.y;

    this.root.add(this.rig.root);
    this.root.name = spec.name;
    if (!shadowMaps) {
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.34, 24), new THREE.MeshBasicMaterial({ map: getHaloTexture(), color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }));
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.012;
      shadow.renderOrder = 1;
      this.root.add(shadow);
    }
    if (spec.scale) this.root.scale.setScalar(spec.scale);

    this.restFace = { ...neutralFace(), ...spec.rest };
    this.face = { ...this.restFace };
    this.faceTarget = { ...this.restFace };
    this.faceMat.apply(this.face);
    this.applyPose(1e6);
  }

  static async create(ctx: BuildContext, spec: CharacterSpec, id: string, shadowMaps = ctx.quality.shadows, weight?: 'medium' | 'low'): Promise<Character> {
    return new Character(spec, await ctx.assets.model(id, weight), shadowMaps);
  }

  place(x: number, y: number, z: number, yawRad = 0): this {
    this.root.position.set(x, y, z);
    this.root.rotation.y = yawRad;
    return this;
  }

  placeAt(a: Anchor): this {
    return this.place(a.position.x, a.position.y, a.position.z, characterYaw(a));
  }

  setPose(pose: PoseName, opts: { immediate?: boolean; seat?: number } = {}): this {
    this.pose = pose;
    if (opts.seat !== undefined) this.seatHeight = opts.seat;
    if (opts.immediate) this.applyPose(1e6);
    return this;
  }

  play(name: GestureName, hold = false): this {
    this.gesture = { name, time: 0, hold };
    return this;
  }

  clearGesture(): this {
    this.gesture = null;
    return this;
  }

  setMood(mood: Mood, overrides: Partial<FaceState> = {}): this {
    Object.assign(this.faceTarget, this.restFace, MOODS[mood], overrides);
    return this;
  }

  get headRadius(): number {
    return this.body.face.radius;
  }

  wear(item: THREE.Object3D): this {
    this.head.add(item);
    return this;
  }

  lookAtPoint(target: THREE.Vector3 | null): this {
    this.lookAt = target;
    return this;
  }

  setTalking(amount: number): this {
    this.talkTarget = amount;
    return this;
  }

  setProjected(color: THREE.ColorRepresentation | null): this {
    this.hologram.amount.value = color === null ? 0 : 1;
    if (color !== null) this.hologram.color.set(color).multiplyScalar(2.6);
    return this;
  }

  setLiveliness(k: number): this {
    this.liveliness = k;
    return this;
  }

  headWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.head.getWorldPosition(out);
  }

  update(dt: number, time: number): void {
    const t = time + this.phase;
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blink = 1;
      this.blinkIn = this.rng.chance(0.18) ? 0.28 : this.rng.range(2.2, 6);
    }
    this.blink = Math.max(0, this.blink - dt * 7.5);
    const lid = 1 - Math.sin(Math.min(1, this.blink) * Math.PI);
    this.talk = damp(this.talk, this.talkTarget, 10, dt);
    if (this.talk > 0.02) {
      this.talkPhase += dt * (9 + 3 * Math.sin(t * 2.3));
      this.syllable = 0.25 + 0.75 * Math.abs(Math.sin(this.talkPhase) * Math.sin(this.talkPhase * 0.37 + 1.3));
    }
    const f = this.face, g = this.faceTarget;
    for (const k of FACE_KEYS) f[k] = damp(f[k], g[k], k === 'gazeX' || k === 'gazeY' ? 14 : 9, dt);
    const shown: FaceState = { ...f };
    shown.eyeL *= lid;
    shown.eyeR *= lid;
    shown.mouthOpen = clamp(f.mouthOpen + this.talk * this.syllable * 0.62, 0, 1);
    shown.gazeX = clamp(f.gazeX + this.lookYaw * 1.6, -1, 1);
    shown.gazeY = clamp(f.gazeY - this.lookPitch * 1.6, -1, 1);
    this.faceMat.apply(shown);

    this.hover = this.spec.aura === undefined ? 0 : Math.sin(t * 1.1) * 0.018 + 0.03;
    this.hologram.time.value = t;
    this.applyPose(dt, t);
  }

  private applyPose(dt: number, t = 0): void {
    const base = POSES[this.pose];
    const bones = this.rig.bones;
    const k = 1 - Math.exp(-this.poseBlend * dt);
    const live = this.liveliness;
    const gesture = this.gesture ? GESTURES[this.gesture.name] : null;
    let gw = 0, gt = 0;
    if (gesture && this.gesture) {
      this.gesture.time += dt;
      const u = this.gesture.time / gesture.duration;
      gt = gesture.loop ? u % 1 : Math.min(1, u);
      const fadeIn = clamp(this.gesture.time / 0.22, 0, 1);
      const fadeOut = gesture.loop || this.gesture.hold ? 1 : clamp((gesture.duration - this.gesture.time) / 0.3, 0, 1);
      gw = fadeIn * fadeOut;
      if (!gesture.loop && !this.gesture.hold && u >= 1) this.gesture = null;
    }

    let yaw = 0, pitch = 0;
    if (this.lookAt) {
      this.head.getWorldPosition(_v);
      const dx = this.lookAt.x - _v.x, dy = this.lookAt.y - _v.y, dz = this.lookAt.z - _v.z;
      this.root.getWorldQuaternion(_q).invert();
      _v.set(dx, dy, dz).applyQuaternion(_q);
      yaw = clamp(Math.atan2(_v.x, _v.z), -1.25, 1.25);
      pitch = clamp(Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), -0.6, 0.6);
    }
    this.lookYaw = damp(this.lookYaw, yaw, 6, dt);
    this.lookPitch = damp(this.lookPitch, pitch, 6, dt);

    const breath = Math.sin(t * 1.7) * live, sway = Math.sin(t * 0.63) * live, talk = this.talk;
    for (const name of BONES) {
      const b = base.bones[name];
      let x = b ? b[0] : 0, y = b ? b[1] : 0, z = b ? b[2] : 0;
      if (gesture) {
        const track = gesture.tracks[name];
        if (track) {
          const v = sampleTrack(track, gt);
          x = lerp(x, v[0], gw);
          y = lerp(y, v[1], gw);
          z = lerp(z, v[2], gw);
        }
      }
      switch (name) {
        case 'spine': x += breath * 0.5; z += sway * 0.9; break;
        case 'chest': x += breath * 0.9 - talk * 1.2 * Math.sin(t * 3.1); z -= sway * 0.6; y += this.lookYaw * 12; break;
        case 'neck': y += this.lookYaw * 20; x -= this.lookPitch * 16; z += sway * 0.5; break;
        case 'head':
          y += this.lookYaw * 25 + talk * 2.2 * Math.sin(t * 2.4);
          x += -this.lookPitch * 30 + talk * 2.6 * Math.sin(t * 4.3 + 1) + Math.sin(t * 0.9) * 0.8 * live;
          z += Math.sin(t * 0.47 + 2) * 1.2 * live;
          break;
        case 'armL': z += breath * 0.6 + talk * 1.5 * Math.sin(t * 2.7); x += sway * 1.2; break;
        case 'armR': z -= breath * 0.6 + talk * 1.5 * Math.sin(t * 2.7 + 1); x -= sway * 1.2; break;
        case 'foreL': x -= talk * 3 * (0.5 + 0.5 * Math.sin(t * 3.3)); break;
        case 'foreR': x -= talk * 3 * (0.5 + 0.5 * Math.sin(t * 2.9 + 2)); break;
        default: break;
      }
      _e.set(x * DEG, y * DEG, z * DEG, 'YXZ');
      _q.setFromEuler(_e);
      bones[name].quaternion.slerp(_q, k);
    }
    const hips = bones.hips;
    const seatedY = base.seated ? this.seatHeight + 0.07 - this.bindY : 0;
    const targetY = this.bindY + base.hipsY + seatedY + this.hover + (gesture?.hop ? gesture.hop(gt) * gw : 0);
    hips.position.y = lerp(hips.position.y, targetY, k);
    hips.position.x = lerp(hips.position.x, sway * 0.006 * (this.pose === 'stand' ? 1 : 0), k);
    hips.position.z = lerp(hips.position.z, base.hipsZ, k);
    this.onPose?.(bones);
    this.body.retarget();
  }
}

type Track = readonly (readonly [number, number, number, number])[];

const sampleTrack = (track: Track, t: number): [number, number, number] => {
  const first = track[0]!;
  if (t <= first[0]) return [first[1], first[2], first[3]];
  for (let i = 1; i < track.length; i++) {
    const b = track[i]!;
    if (t <= b[0]) {
      const a = track[i - 1]!;
      const u = (t - a[0]) / (b[0] - a[0]);
      const s = u * u * (3 - 2 * u);
      return [lerp(a[1], b[1], s), lerp(a[2], b[2], s), lerp(a[3], b[3], s)];
    }
  }
  const last = track[track.length - 1]!;
  return [last[1], last[2], last[3]];
};

const hashName = (name: string): number => {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return h >>> 0;
};
