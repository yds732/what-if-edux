import * as THREE from 'three';
import type { App } from '../app/App';
import { handGeometry, mirrorX } from '../characters/body';
import { merge, sweep, tint, v3 } from '../core/geo';
import { damp } from '../core/math';
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

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();

const orientation = (pose: Pose, side: 1 | -1, out: THREE.Quaternion): THREE.Quaternion => {
  // the hand mesh has fingers along -Y; a right hand's palm faces +X
  _y.set(-pose.fingers[0] * side, -pose.fingers[1], -pose.fingers[2]).normalize();
  _x.set(pose.palm[0] * side, pose.palm[1], pose.palm[2]).multiplyScalar(side);
  _x.addScaledVector(_y, -_x.dot(_y)).normalize();
  _z.crossVectors(_x, _y);
  return out.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
};

class Hand {
  readonly group = new THREE.Group();
  /** A point just above the palm, for things the hand carries. */
  readonly palm = new THREE.Group();
  pose: HandPose = 'rest';
  private readonly targetQ = new THREE.Quaternion();
  private readonly targetP = new THREE.Vector3();

  constructor(readonly side: 1 | -1, material: THREE.Material) {
    const hand = handGeometry(1.0);
    const sleeve = merge([
      tint(sweep([v3(0, 0.012, 0), v3(0, 0.4, 0.02)], (t) => 0.039 + 0.016 * t, { radial: 12, steps: 6, startCap: 'flat', endCap: 'flat' }), 0xffffff),
      tint(sweep([v3(0, 0.0, 0), v3(0, 0.04, 0)], () => 0.043, { radial: 12, steps: 2, startCap: 'flat', endCap: 'flat' }), 0x999999),
    ]);
    // vertex colour marks what is skin (red channel 0) and what is cloth, so one material can dress both
    const geo = merge([tint(hand, 0x000000), sleeve]);
    if (side > 0) mirrorX(geo);
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    this.group.add(mesh, this.palm);
    this.palm.position.set(side * 0.062, -0.052, 0.004);
  }

  snap(): void {
    const p = POSES[this.pose];
    this.group.position.set(p.at[0] * this.side, p.at[1], p.at[2]);
    orientation(p, this.side, this.group.quaternion);
  }

  update(dt: number, swayX: number, swayY: number, bob: number, rate: number): void {
    const p = POSES[this.pose];
    this.targetP.set(p.at[0] * this.side + swayX, p.at[1] + swayY + bob, p.at[2]);
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
  private readonly material: THREE.MeshStandardMaterial;
  private readonly uniforms = { uSkin: { value: new THREE.Color(0xf7efe6) }, uSleeve: { value: new THREE.Color(0x3f6b6a) }, uCuff: { value: new THREE.Color(0xe9e4d8) }, uGlow: { value: 0 } };
  private swayX = 0;
  private swayY = 0;
  private glow = 0;
  private glowTarget = 0;
  private gripped = false;

  constructor(app: App, private readonly input: Input, private readonly player: Player) {
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uSkin, uSleeve, uCuff; uniform float uGlow;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float cloth = smoothstep(0.05, 0.3, vColor.r), cuff = cloth * (1.0 - smoothstep(0.5, 0.9, vColor.r));
          vec3 real = mix(uSkin, mix(uSleeve, uCuff, cuff), cloth);
          // in Haven the same hands are made of pale light
          vec3 haven = mix(vec3(0.9, 0.92, 1.0), mix(vec3(0.95, 0.94, 1.0), vec3(1.0, 0.82, 0.45), cuff), cloth);
          diffuseColor.rgb = mix(real, haven, uGlow);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float rimLight = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.2);
          totalEmissiveRadiance += uGlow * (vec3(0.5, 0.62, 1.0) * (0.16 + 1.1 * rimLight) + vec3(1.0, 0.75, 0.35) * 1.4 * cuff);
          // in the real world the hands are a neutral warm white that glows softly, so they belong to any player
          totalEmissiveRadiance += (1.0 - uGlow) * (1.0 - cloth) * vec3(1.0, 0.86, 0.68) * (0.14 + 0.55 * rimLight);`);
    };
    this.material.customProgramCacheKey = () => 'echo-hands';
    this.right = new Hand(1, this.material);
    this.left = new Hand(-1, this.material);
    this.root.add(this.right.group, this.left.group);
    this.right.snap();
    this.left.snap();
    app.camera.add(this.root);
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
  }

  update(dt: number): void {
    // hands trail the head a touch when it turns, and ride the walk
    this.swayX = damp(this.swayX, this.input.look.x * -1.6, 9, dt);
    this.swayY = damp(this.swayY, this.input.look.y * 1.2, 9, dt);
    const bob = Math.sin(this.player.travelled * 6.8) * 0.006;
    if (!this.gripped) {
      this.right.update(dt, this.swayX, this.swayY, bob, this.rate);
      this.left.update(dt, this.swayX, this.swayY, -bob, this.rate);
    }
    this.glow = damp(this.glow, this.glowTarget, 3, dt);
    this.uniforms.uGlow.value = this.glow;
  }
}
