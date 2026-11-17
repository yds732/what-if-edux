import * as THREE from 'three';
import type { App } from '../app/App';
import { clamp01, damp } from '../core/math';
import { Signal } from '../core/tasks';
import type { Input } from '../input/Input';
import type { Hands } from '../player/Hands';
import type { Interactable, Interaction } from '../player/Interaction';
import type { Player } from '../player/Player';
import type { Bursts } from '../render/Bursts';
import { GLSL_OUTPUT } from '../render/glsl';
import { makeHalo } from '../world/haven/atmosphere';
import type { Ring } from '../world/haven/bridge';
import { CHARGE_TIME, HAVEN_GRAVITY, ORB_RADIUS, assistForMisses, assistLaunch, crossRing, flightPoint, solveLaunch, speedForCharge, type Vec3 } from './throw';

type OrbState = 'none' | 'waiting' | 'coming' | 'held' | 'flying';

const GOLD = new THREE.Color(1.0, 0.8, 0.42);
const WHITE_GOLD = new THREE.Color(1.0, 0.95, 0.8);
const PREVIEW_DOTS = 30;
/** In the hand the orb is a fraction of its flying size, so it never hides what the player is aiming at. */
const HELD_SCALE = 0.4;

const PREVIEW_VS = /* glsl */ `
attribute float aT;
uniform float uPixel, uShow;
varying float vT;
void main(){
  vT = aT;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(0.2 * uPixel * 0.85 / max(-mv.z, 0.3), 5.0, 44.0) * (1.0 - 0.45 * aT) * uShow;
}`;
const PREVIEW_FS = /* glsl */ `
uniform vec3 uColor; uniform float uShow, uTime;
varying float vT;
void main(){
  vec2 q = gl_PointCoord - 0.5; float r = length(q) * 2.0;
  float a = exp(-r * r * 3.2) * (1.0 - vT * 0.85) * uShow * (0.75 + 0.25 * sin(uTime * 9.0 - vT * 22.0));
  gl_FragColor = vec4(uColor * a * 4.5, 1.0);
  ${GLSL_OUTPUT}
}`;

export interface ChallengeOptions {
  /** Rings that count, in any order. */
  readonly rings: readonly Ring[];
  /** Where a fresh orb appears. */
  readonly source: THREE.Vector3;
  /** Orbs before the attempt fails; null never runs out. */
  readonly orbs: number | null;
}

/**
 * The orb-throwing game: take an orb, hold to draw back, release to throw it through a ring. It owns the
 * orb, the aiming arc and the feel of a throw; what a hit means is up to whoever listens.
 */
export class StarBridgeGame {
  readonly onHit = new Signal<{ ring: Ring; index: number; offset: number }>();
  /** `closest` is how far, in metres, the nearest miss passed from a ring's edge. */
  readonly onMiss = new Signal<{ rim: boolean; closest: number }>();
  readonly onThrow = new Signal<number>();
  readonly onTake = new Signal();
  /** A fresh orb has condensed above the star. */
  readonly onAppear = new Signal();
  /** The last orb is spent and rings remain. */
  readonly onFail = new Signal();
  active = false;
  throws = 0;
  misses = 0;
  /** Set false to keep the player from throwing during dialogue. */
  canThrow = true;

  private options: ChallengeOptions | null = null;
  private readonly orb = new THREE.Group();
  private readonly core: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly star: THREE.Mesh;
  private readonly light = new THREE.PointLight(0xffc27a, 0, 9, 1.6);
  private readonly preview: THREE.Points;
  private readonly previewU = { uPixel: { value: 1080 }, uShow: { value: 0 }, uColor: { value: GOLD.clone() }, uTime: { value: 0 } };
  private readonly previewPos = new Float32Array(PREVIEW_DOTS * 3);
  private readonly pedestal: Interactable;
  private state: OrbState = 'none';
  private wait = 0;
  private charge = 0;
  private charging = false;
  private readonly velocity = new THREE.Vector3();
  private readonly prev = new THREE.Vector3();
  private age = 0;
  private closest = Infinity;
  private rimmed = false;
  private scale = 0;
  private orbsLeft: number | null = null;
  private fovKick = 0;
  private onTarget = false;

  constructor(
    private readonly app: App, private readonly input: Input, private readonly player: Player, private readonly hands: Hands,
    interaction: Interaction, private readonly bursts: Bursts, scene: THREE.Scene,
  ) {
    this.core = new THREE.Mesh(new THREE.SphereGeometry(ORB_RADIUS * 0.62, 24, 16), new THREE.MeshBasicMaterial({ color: WHITE_GOLD.clone().multiplyScalar(2.4) }));
    this.star = new THREE.Mesh(new THREE.OctahedronGeometry(ORB_RADIUS * 0.95, 0), new THREE.MeshBasicMaterial({ color: GOLD.clone().multiplyScalar(1.6), transparent: true, opacity: 0.38, depthWrite: false, blending: THREE.AdditiveBlending }));
    const shell = new THREE.Mesh(new THREE.SphereGeometry(ORB_RADIUS, 24, 16), new THREE.MeshBasicMaterial({ color: GOLD.clone().multiplyScalar(0.8), transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.orb.add(this.core, this.star, shell, makeHalo(0xffc27a, 1.5, 0.6), this.light);
    this.orb.visible = false;
    scene.add(this.orb);

    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.previewPos, 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('aT', new THREE.BufferAttribute(Float32Array.from({ length: PREVIEW_DOTS }, (_, i) => i / (PREVIEW_DOTS - 1)), 1));
    this.preview = new THREE.Points(pg, new THREE.ShaderMaterial({ vertexShader: PREVIEW_VS, fragmentShader: PREVIEW_FS, uniforms: this.previewU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.preview.frustumCulled = false;
    scene.add(this.preview);

    this.pedestal = {
      position: new THREE.Vector3(), radius: 0.34, reach: 4.2, prompt: 'Take a light orb', enabled: false,
      use: () => this.take(),
    };
    interaction.add(this.pedestal);
  }

  begin(options: ChallengeOptions): void {
    this.options = options;
    this.active = true;
    this.throws = 0;
    this.misses = 0;
    this.orbsLeft = options.orbs;
    this.pedestal.position.copy(options.source);
    for (const r of options.rings) if (r.state !== 'lit') r.setState('target');
    this.spawn(0.2);
  }

  end(): void {
    this.active = false;
    this.options = null;
    this.state = 'none';
    this.pedestal.enabled = false;
    this.charging = false;
    this.hands.pose('rest');
  }

  get holding(): boolean {
    return this.state === 'held';
  }

  /** 0..1 while a throw is being drawn back, otherwise 0. */
  get chargeLevel(): number {
    return this.charging ? this.charge : 0;
  }

  /** The orb waiting above the star, as something to look at and take. */
  get pedestalItem(): Interactable {
    return this.pedestal;
  }

  /** An orb is waiting to be taken. */
  get offering(): boolean {
    return this.state === 'waiting' && this.wait <= 0 && this.scale > 0.6;
  }

  /**
   * Autopilot: takes the waiting orb, or throws the held one at full power. `aimAt` is the ring to hit; pass
   * null to throw wide on purpose.
   */
  autoPlay(aimAt: Ring | null): void {
    if (this.offering) this.take();
    if (this.state !== 'held' || !this.options) return;
    this.charge = 1;
    const origin = this.orb.position;
    const speed = speedForCharge(1);
    const ideal = aimAt ? solveLaunch(origin, aimAt.center, speed) : null;
    const v = ideal ?? { x: speed * 0.7, y: speed * 0.5, z: speed * 0.5 };
    // turn the player to face the throw, then launch along it exactly as a released throw does
    this.player.yaw = Math.atan2(-v.x, -v.z);
    this.player.pitch = Math.atan2(v.y, Math.hypot(v.x, v.z));
    this.launch(_b.set(v.x, v.y, v.z).normalize());
  }

  /** How many orbs are left, or null when the supply is endless. */
  get remaining(): number | null {
    return this.orbsLeft;
  }

  private spawn(delay: number): void {
    this.state = 'waiting';
    this.wait = delay;
    this.scale = 0;
  }

  private take(): void {
    if (this.state !== 'waiting' || this.wait > 0) return;
    this.state = 'coming';
    this.pedestal.enabled = false;
    this.hands.pose('hold', 'rest');
    this.onTake.emit();
  }

  private palmWorld(out: THREE.Vector3): THREE.Vector3 {
    this.hands.right.palm.getWorldPosition(out);
    out.y += 0.045;
    return out;
  }

  /** Releases the held orb along the player's aim, or along `direction` when a scripted run supplies one. */
  private launch(direction?: THREE.Vector3): void {
    const o = this.options;
    if (!o) return;
    const origin = this.orb.position;
    const speed = speedForCharge(this.charge);
    const aim = (direction ? _a.copy(direction) : this.player.aim(_a)).multiplyScalar(speed);
    // gentle help toward the unlit ring the throw is already closest to
    let best: Vec3 | null = null, bestCos = -1;
    for (const r of o.rings) {
      if (r.state === 'lit') continue;
      const ideal = solveLaunch(origin, r.center, speed);
      if (!ideal) continue;
      const cos = (ideal.x * aim.x + ideal.y * aim.y + ideal.z * aim.z) / (speed * speed);
      if (cos > bestCos) {
        bestCos = cos;
        best = ideal;
      }
    }
    const v = assistLaunch(aim, best, assistForMisses(this.misses));
    this.velocity.set(v.x, v.y, v.z);
    this.state = 'flying';
    this.age = 0;
    this.closest = Infinity;
    this.rimmed = false;
    this.prev.copy(origin);
    this.throws++;
    if (this.orbsLeft !== null) this.orbsLeft--;
    this.hands.pose('release', 'rest');
    this.app.tasks.wait(0.35).then(() => {
      if (this.state !== 'held') this.hands.pose('rest');
    }, () => undefined);
    this.fovKick = 2.5;
    this.onThrow.emit(this.charge);
    this.charge = 0;
    this.charging = false;
  }

  private resolveMiss(): void {
    this.bursts.emit(this.orb.position, { count: 26, color: GOLD, color2: WHITE_GOLD, speed: 2.2, life: 0.7, size: 0.1, gravity: 1 });
    this.misses++;
    this.onMiss.emit({ rim: this.rimmed, closest: this.closest });
    this.afterThrow();
  }

  private afterThrow(): void {
    const o = this.options;
    if (!o) return;
    this.state = 'none';
    this.orb.visible = false;
    this.light.intensity = 0;
    const remaining = o.rings.some((r) => r.state !== 'lit');
    if (!remaining) return;
    if (this.orbsLeft !== null && this.orbsLeft <= 0) {
      this.onFail.emit();
      return;
    }
    this.spawn(0.55);
  }

  update(dt: number, time: number): void {
    const o = this.options;
    this.previewU.uTime.value = time;
    this.previewU.uPixel.value = this.app.canvas.clientHeight;
    this.fovKick = damp(this.fovKick, this.charging ? -4 * this.charge : 0, this.charging ? 6 : 9, dt);
    this.app.fovKick = Math.abs(this.fovKick) > 0.01 ? this.fovKick : 0;
    let showPreview = 0;
    this.onTarget = false;
    if (!this.active || !o) {
      this.previewU.uShow.value = damp(this.previewU.uShow.value, 0, 14, dt);
      this.orb.visible = false;
      return;
    }

    const orb = this.orb;
    this.star.rotation.y = time * 1.8;
    this.star.rotation.x = time * 1.1;
    const pulse = 1 + 0.06 * Math.sin(time * 5);

    switch (this.state) {
      case 'none':
        orb.visible = false;
        break;
      case 'waiting': {
        this.wait -= dt;
        if (this.wait > 0) break;
        // the orb condenses out of sparks above the star, then waits to be taken
        if (!orb.visible) {
          orb.visible = true;
          orb.position.copy(o.source);
          this.onAppear.emit();
          this.bursts.emit(o.source, { count: 22, color: GOLD, color2: WHITE_GOLD, speed: 1.4, life: 0.6, size: 0.09, gravity: -0.5 });
        }
        this.scale = damp(this.scale, 1, 7, dt);
        orb.position.set(o.source.x, o.source.y + Math.sin(time * 1.7) * 0.06, o.source.z);
        this.pedestal.position.copy(orb.position);
        this.pedestal.enabled = this.canThrow;
        // after the first one, orbs come to a player who is standing ready
        if (this.throws > 0 && this.canThrow && this.scale > 0.9 && this.player.distanceTo(o.source.x, o.source.z) < 3.4) this.take();
        break;
      }
      case 'coming': {
        this.scale = damp(this.scale, HELD_SCALE, 8, dt);
        const target = this.palmWorld(_a);
        orb.position.lerp(target, 1 - Math.exp(-9 * dt));
        if (orb.position.distanceTo(target) < 0.05) this.state = 'held';
        break;
      }
      case 'held': {
        this.scale = damp(this.scale, HELD_SCALE * (1 + 0.18 * this.charge), 10, dt);
        orb.position.copy(this.palmWorld(_a));
        const input = this.input;
        if (this.canThrow && input.pressed.has('primary')) {
          this.charging = true;
          this.charge = 0;
          this.hands.pose('windUp', 'rest');
        }
        if (this.charging) {
          this.charge = clamp01(this.charge + dt / CHARGE_TIME);
          if (!input.held.has('primary')) {
            this.launch();
            break;
          }
          showPreview = clamp01(this.charge * 6);
          this.updatePreview(o);
        }
        break;
      }
      case 'flying': {
        this.scale = damp(this.scale, 1, 10, dt);
        this.age += dt;
        // fixed sub-steps: the arc and the ring test are the same at any frame rate
        const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
        const h = dt / steps;
        let done = false;
        for (let s = 0; s < steps && !done; s++) {
          this.prev.copy(orb.position);
          this.velocity.y -= HAVEN_GRAVITY * h;
          orb.position.addScaledVector(this.velocity, h);
          for (let i = 0; i < o.rings.length; i++) {
            const ring = o.rings[i]!;
            if (ring.state === 'lit') continue;
            const c = crossRing(this.prev, orb.position, ring);
            const dPlane = Math.abs(_b.subVectors(orb.position, ring.center).dot(ring.normal));
            if (dPlane < 1.2) this.closest = Math.min(this.closest, Math.max(0, _b.length() - ring.radius));
            if (c?.kind === 'through') {
              this.hit(ring, i, c.offset);
              done = true;
              break;
            }
            if (c?.kind === 'rim') {
              // a clip off the hoop: sparks, and the orb is knocked off its line
              this.rimmed = true;
              this.velocity.multiplyScalar(0.45).addScaledVector(ring.normal, 2.5);
              this.bursts.emit(orb.position, { count: 16, color: WHITE_GOLD, speed: 3, life: 0.4, size: 0.08 });
            }
          }
        }
        if (done) break;
        this.bursts.emit(orb.position, { count: 2, color: GOLD, color2: WHITE_GOLD, speed: 0.5, life: 0.55, size: 0.085, gravity: 0.4, drift: _b.copy(this.velocity).multiplyScalar(0.12) });
        if (this.age > 6 || orb.position.y < -8 || orb.position.distanceTo(this.player.position) > 90) this.resolveMiss();
        break;
      }
    }
    orb.scale.setScalar(Math.max(0.001, this.scale * pulse));
    this.light.intensity = orb.visible ? 7 * this.scale : 0;
    this.previewU.uShow.value = damp(this.previewU.uShow.value, showPreview, 14, dt);
    this.previewU.uColor.value.lerp(this.onTarget ? WHITE_GOLD : GOLD, 1 - Math.exp(-10 * dt));
  }

  private hit(ring: Ring, index: number, offset: number): void {
    ring.setState('lit');
    this.misses = 0;
    this.bursts.emit(ring.center, { count: 110, color: GOLD, color2: WHITE_GOLD, speed: 6.5, life: 1.3, size: 0.16, gravity: 1.2 });
    this.bursts.emit(ring.center, { count: 40, color: WHITE_GOLD, speed: 2.2, life: 1.7, size: 0.22, gravity: -0.4 });
    this.app.fx.flash = Math.max(this.app.fx.flash, 0.22);
    this.app.fx.kick = Math.max(this.app.fx.kick, 0.5);
    this.onHit.emit({ ring, index, offset });
    this.afterThrow();
  }

  /** Lays the dots of the aiming arc along the flight the current charge would give. */
  private updatePreview(o: ChallengeOptions): void {
    const speed = speedForCharge(this.charge);
    const origin = this.orb.position;
    const aim = this.player.aim(_a).multiplyScalar(speed);
    let prev: Vec3 = origin;
    for (let i = 0; i < PREVIEW_DOTS; i++) {
      const p = flightPoint(origin, aim, (i + 1) * 0.085);
      this.previewPos.set([p.x, p.y, p.z], i * 3);
      for (const r of o.rings) if (r.state !== 'lit' && crossRing(prev, p, r)?.kind === 'through') this.onTarget = true;
      prev = p;
    }
    this.preview.geometry.attributes.position!.needsUpdate = true;
  }

  /** True while the drawn arc passes through a ring: the throw, released now, would score. */
  get aimedTrue(): boolean {
    return this.onTarget;
  }
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
