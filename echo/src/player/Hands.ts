import * as THREE from 'three';
import type { App } from '../app/App';
import type { AssetLibrary } from '../assets/AssetLibrary';
import { TAU, damp } from '../core/math';
import type { Input } from '../input/Input';
import type { Player } from './Player';

/**
 * A pose in camera space (+x right, +y up, -z ahead), written for the RIGHT hand; the left mirrors it.
 * `fingers` is where the fingertips point and `palm` the way the palm faces.
 */
interface Pose {
  readonly at: readonly [number, number, number];
  readonly fingers: readonly [number, number, number];
  readonly palm: readonly [number, number, number];
}

export type HandPose = 'rest' | 'away' | 'hold' | 'windUp' | 'release' | 'reach' | 'cradle' | 'face' | 'offer';

const POSES: Record<HandPose, Pose> = {
  /** Low in the frame, relaxed: just enough to know you have a body. */
  rest: { at: [0.3, -0.37, -0.5], fingers: [-0.3, 0.2, -1], palm: [-0.75, 0.6, 0.25] },
  away: { at: [0.34, -0.72, -0.34], fingers: [-0.2, -0.2, -1], palm: [-0.8, 0.5, 0.2] },
  /** Palm up, something resting just above it. */
  hold: { at: [0.25, -0.27, -0.52], fingers: [-0.18, 0.28, -1], palm: [-0.12, 1, 0.18] },
  /** Drawn back beside the shoulder, loading a throw. */
  windUp: { at: [0.33, -0.2, -0.44], fingers: [0.0, 0.7, -0.7], palm: [-0.3, 0.6, 0.74] },
  /** Arm long, palm down: the end of a throw. */
  release: { at: [0.1, -0.08, -0.78], fingers: [-0.05, -0.25, -1], palm: [0, -1, 0.2] },
  reach: { at: [0.13, -0.17, -0.62], fingers: [-0.05, 0.08, -1], palm: [-0.2, -0.95, 0] },
  /** Both hands holding something between them. */
  cradle: { at: [0.16, -0.25, -0.44], fingers: [-0.32, 0.22, -1], palm: [-1, 0.1, 0] },
  /** Hands at the temples: settling a headset over the eyes. */
  face: { at: [0.165, -0.09, -0.2], fingers: [-0.12, 0.6, -0.75], palm: [-1, 0, 0.1] },
  /** Open, toward someone. */
  offer: { at: [0.22, -0.2, -0.56], fingers: [-0.2, 0.2, -1], palm: [-0.2, 0.95, 0.25] },
};

export type HandStyle = 'real' | 'haven';

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _v = new THREE.Vector3(), _m = new THREE.Matrix4();

const orientation = (pose: Pose, side: 1 | -1, out: THREE.Quaternion): THREE.Quaternion => {
  // the hand mesh has fingers along -Y; a right hand's palm faces +X
  _y.set(-pose.fingers[0] * side, -pose.fingers[1], -pose.fingers[2]).normalize();
  _x.set(pose.palm[0] * side, pose.palm[1], pose.palm[2]).multiplyScalar(side);
  _x.addScaledVector(_y, -_x.dot(_y)).normalize();
  _z.crossVectors(_x, _y);
  return out.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
};

/** Where the wrist is in the hand model, in metres from its origin. */
const WRIST = new THREE.Vector3(0, 0.064, 0.085);
/** The skin as the model's texture has it painted: what the player's chosen tone is measured against. */
const PAINTED_SKIN = new THREE.Color(0xe7a671);

/** Where the player's elbows are, about the camera: the sleeves run back to them, out of sight. */
const ELBOW = new THREE.Vector3(0.27, -0.5, 0.16);
const BACK = new THREE.Vector3(0, 0, -1);

/**
 * Gives the hand model a wrist. The model is one stiff piece; with two bones, and every vertex given to the hand,
 * the forearm or (through the cuff) a share of each, the sleeve can turn where the hand does not.
 *
 * @returns the forearm's bone, which lies along -Z from the wrist until it is turned
 */
const articulate = (model: THREE.Object3D): THREE.Bone => {
  const hand = new THREE.Bone(), forearm = new THREE.Bone();
  hand.position.copy(WRIST);
  hand.add(forearm);
  model.add(hand);
  model.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton([hand, forearm]);
  const meshes: THREE.Mesh[] = [];
  model.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes.push(o);
  });
  for (const mesh of meshes) {
    const geometry = mesh.geometry as THREE.BufferGeometry;
    // the two hands share their geometry: the first to arrive works the weights out
    if (!geometry.getAttribute('skinIndex')) {
      const position = geometry.getAttribute('position');
      const index = new Uint8Array(position.count * 4), weight = new Float32Array(position.count * 4);
      for (let i = 0; i < position.count; i++) {
        const z = _v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).z;
        const w = 1 - THREE.MathUtils.smoothstep(z, WRIST.z - 0.09, WRIST.z - 0.01);
        index[i * 4 + 1] = 1;
        weight[i * 4] = 1 - w;
        weight[i * 4 + 1] = w;
      }
      geometry.setAttribute('skinIndex', new THREE.BufferAttribute(index, 4));
      geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weight, 4));
    }
    const skinned = new THREE.SkinnedMesh(geometry, mesh.material);
    skinned.position.copy(mesh.position);
    skinned.quaternion.copy(mesh.quaternion);
    skinned.scale.copy(mesh.scale);
    skinned.castShadow = mesh.castShadow;
    skinned.frustumCulled = mesh.frustumCulled;
    mesh.parent!.add(skinned);
    mesh.parent!.remove(mesh);
    skinned.updateMatrixWorld(true);
    skinned.bind(skeleton);
  }
  return forearm;
};

class Hand {
  readonly group = new THREE.Group();
  /** A point just above the palm, for things the hand carries. */
  readonly palm = new THREE.Group();
  pose: HandPose = 'rest';
  private forearm: THREE.Bone | null = null;
  private readonly targetQ = new THREE.Quaternion();
  private readonly targetP = new THREE.Vector3();

  constructor(readonly side: 1 | -1) {
    this.group.add(this.palm);
    this.palm.position.set(side * 0.062, -0.052, 0.004);
  }

  /**
   * Puts the generated hand and sleeve on. The model is a right hand lying along Z, fingers to +Z and palm down;
   * here a hand has its wrist on the origin, its fingers along -Y and, on the right, its palm to +X. The left
   * hand is the right one in a mirror.
   */
  wear(model: THREE.Object3D): void {
    this.forearm = articulate(model);
    const fitted = new THREE.Group();
    fitted.quaternion.setFromRotationMatrix(_m.makeBasis(_x.set(0, 0, 1), _y.set(-1, 0, 0), _z.set(0, -1, 0)));
    model.position.copy(WRIST).negate();
    fitted.add(model);
    const sided = new THREE.Group();
    sided.scale.x = this.side;
    sided.add(fitted);
    this.group.add(sided);
  }

  /** Turns the forearm at the wrist to run back to the elbow, a point in the world. */
  aim(elbow: THREE.Vector3): void {
    if (!this.forearm) return;
    this.forearm.parent!.worldToLocal(_v.copy(elbow));
    this.forearm.quaternion.setFromUnitVectors(BACK, _v.normalize());
  }

  snap(): void {
    const p = POSES[this.pose];
    this.group.position.set(p.at[0] * this.side, p.at[1], p.at[2]);
    orientation(p, this.side, this.group.quaternion);
  }

  update(dt: number, swayX: number, swayY: number, bob: number, rate: number, swing = 0): void {
    const p = POSES[this.pose];
    this.targetP.set(p.at[0] * this.side + swayX, p.at[1] + swayY + bob, p.at[2] + swing);
    orientation(p, this.side, this.targetQ);
    const k = 1 - Math.exp(-rate * dt);
    this.group.position.lerp(this.targetP, k);
    this.group.quaternion.slerp(this.targetQ, k);
  }
}

/**
 * The player's own hands, hung on the camera. They rest low in view, lag a little behind the head, and take
 * poses on request: holding an orb, drawing back to throw, lifting a headset to the face.
 */
export class Hands {
  readonly root = new THREE.Group();
  readonly right: Hand;
  readonly left: Hand;
  /** Higher is snappier. */
  rate = 11;
  /** Settles once the hands have their models on. */
  readonly ready: Promise<void>;
  private readonly uniforms = { uSkin: { value: new THREE.Color(0xf7efe6) }, uPainted: { value: PAINTED_SKIN }, uGlow: { value: 0 } };
  private swayX = 0;
  /** How far into a walk the player is, 0 standing to 1 walking, and where they were last frame. */
  private walking = 0;
  private lastTravelled = 0;
  private swayY = 0;
  private glow = 0;
  private glowTarget = 0;
  private gripped = false;

  constructor(app: App, private readonly input: Input, private readonly player: Player, assets: AssetLibrary) {
    this.right = new Hand(1);
    this.left = new Hand(-1);
    this.root.add(this.right.group, this.left.group);
    this.right.snap();
    this.left.snap();
    // a little of the room's light comes back off the player's own body: without it, hands in a dark room go grey
    const bounce = new THREE.PointLight(0xffe6d0, 0.09, 1.3, 2);
    bounce.position.set(0, -0.1, -0.16);
    this.root.add(bounce);
    app.camera.add(this.root);
    this.ready = this.dress(assets);
  }

  private async dress(assets: AssetLibrary): Promise<void> {
    let material: THREE.MeshStandardMaterial | null = null;
    for (const hand of [this.right, this.left]) {
      const model = await assets.instance('hand');
      model.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        material ??= this.tone(o.material as THREE.MeshStandardMaterial);
        o.material = material;
        o.frustumCulled = false;
        o.castShadow = false;
      });
      hand.wear(model);
    }
  }

  /** One material for both hands: the painted skin takes the player's tone, and in Haven the hands turn to light. */
  private tone(painted: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    const material = painted.clone();
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uSkin, uPainted; uniform float uGlow;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          // skin is the warm paint and the sleeve the cool: the skin is retinted, keeping its shading
          float skin = smoothstep(0.03, 0.14, diffuseColor.r - diffuseColor.b);
          vec3 real = mix(diffuseColor.rgb, diffuseColor.rgb * uSkin / uPainted, skin);
          // in Haven the same hands are made of pale light
          float shade = 0.62 + 0.5 * dot(diffuseColor.rgb, vec3(0.3, 0.5, 0.2)) / mix(0.2, 0.5, skin);
          vec3 haven = mix(vec3(0.84, 0.85, 1.0), vec3(0.9, 0.92, 1.0), skin) * min(shade, 1.1);
          diffuseColor.rgb = mix(real, haven, uGlow);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float rimLight = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.2);
          totalEmissiveRadiance += uGlow * vec3(0.5, 0.62, 1.0) * (0.16 + 1.1 * rimLight);
          // in the real world the skin keeps a faint glow of its own tone, enough to read in a dim room without washing it out
          totalEmissiveRadiance += (1.0 - uGlow) * skin * uSkin * (0.06 + 0.3 * rimLight);`);
    };
    material.customProgramCacheKey = () => 'echo-hands';
    return material;
  }

  /** The real world's hand colour: a neutral warm white by default. */
  setSkin(color: THREE.ColorRepresentation): void {
    this.uniforms.uSkin.value.set(color);
  }

  /** The real world's sleeves and skin, or Haven's hands of light. */
  setStyle(style: HandStyle, immediate = false): void {
    this.glowTarget = style === 'haven' ? 1 : 0;
    if (immediate) this.glow = this.uniforms.uGlow.value = this.glowTarget;
  }

  /**
   * In a headset the hands leave the camera and sit on the controller grips; pass nulls to bring them back.
   * A hand whose controller is missing is hidden.
   */
  attach(leftGrip: THREE.Object3D | null, rightGrip: THREE.Object3D | null): void {
    this.gripped = !!(leftGrip || rightGrip);
    for (const [hand, grip] of [[this.left, leftGrip], [this.right, rightGrip]] as const) {
      if (this.gripped) {
        hand.group.visible = !!grip;
        if (!grip) continue;
        grip.add(hand.group);
        // fingers along the controller's forward, palm inward, thumb up
        hand.group.position.set(0, -0.01, 0.06);
        hand.group.quaternion.setFromRotationMatrix(_m.makeBasis(_x.set(-1, 0, 0), _y.set(0, 0, 1), _z.set(0, 1, 0)));
      } else {
        hand.group.visible = true;
        this.root.add(hand.group);
        hand.snap();
      }
    }
  }

  pose(right: HandPose, left: HandPose = right): void {
    this.right.pose = right;
    this.left.pose = left;
  }

  snap(): void {
    this.right.snap();
    this.left.snap();
    this.aimForearms();
  }

  update(dt: number): void {
    // hands trail the head a touch when it turns, and ride the walk
    this.swayX = damp(this.swayX, this.input.look.x * -1.6, 9, dt);
    this.swayY = damp(this.swayY, this.input.look.y * 1.2, 9, dt);
    // walking: the hands swing one after the other, forward and back in time with the steps (one full swing per two
    // steps), dipping a little at the bottom of each swing; they settle back when the player stops
    const speed = dt > 0 ? (this.player.travelled - this.lastTravelled) / dt : 0;
    this.lastTravelled = this.player.travelled;
    this.walking = damp(this.walking, Math.min(1, Math.max(0, speed) / 1.4), 6, dt);
    const phase = this.player.travelled * (TAU / 1.44);
    const swing = Math.sin(phase) * 0.045 * this.walking;
    const bob = -Math.abs(Math.cos(phase)) * 0.014 * this.walking;
    if (!this.gripped) {
      this.right.update(dt, this.swayX, this.swayY, bob, this.rate, swing);
      this.left.update(dt, this.swayX, this.swayY, bob, this.rate, -swing);
    }
    this.glow = damp(this.glow, this.glowTarget, 3, dt);
    this.uniforms.uGlow.value = this.glow;
    this.aimForearms();
  }

  /** The sleeves run back from wherever the hands are to the player's elbows. */
  private aimForearms(): void {
    this.root.updateWorldMatrix(true, true);
    for (const hand of [this.right, this.left]) hand.aim(this.root.localToWorld(_x.set(ELBOW.x * hand.side, ELBOW.y, ELBOW.z)));
  }
}
