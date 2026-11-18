import * as THREE from 'three';
import { Rng, TAU } from '../core/math';
import { GLSL_OUTPUT } from './glsl';

export interface BurstOptions {
  count: number;
  color: THREE.Color;
  color2?: THREE.Color;
  speed?: number;
  spread?: number;
  life?: number;
  gravity?: number;
  size?: number;
  drift?: THREE.Vector3;
  toward?: THREE.Vector3;
}

const VS = `
attribute vec4 aState;   // age01, size, -, -
attribute vec3 aColor;
uniform float uPixel;
varying vec3 vColor; varying float vFade;
void main(){
  vColor = aColor;
  float a = aState.x;
  vFade = a >= 1.0 ? 0.0 : (1.0 - a) * (1.0 - a) * smoothstep(0.0, 0.06, a);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(aState.y * uPixel * 0.85 / max(-mv.z, 0.3), 96.0) * (0.5 + 0.5 * (1.0 - a));
}`;
const FS = `
varying vec3 vColor; varying float vFade;
void main(){
  vec2 q = gl_PointCoord - 0.5; float r = length(q) * 2.0;
  float core = exp(-r * r * 6.0);
  float star = max(0.0, 1.0 - abs(q.x) * 9.0) * max(0.0, 1.0 - abs(q.y) * 2.2) + max(0.0, 1.0 - abs(q.y) * 9.0) * max(0.0, 1.0 - abs(q.x) * 2.2);
  gl_FragColor = vec4(vColor * (core + star * 0.35) * vFade, 1.0);
  ${GLSL_OUTPUT}
}`;

export class Bursts {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly state: Float32Array;
  private readonly color: Float32Array;
  private readonly life: Float32Array;
  private readonly grav: Float32Array;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly uniforms = { uPixel: { value: 1080 } };
  private readonly rng = new Rng(99);
  private cursor = 0;
  private live = 0;

  constructor(private readonly capacity = 900) {
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.state = new Float32Array(capacity * 4).fill(1);
    this.color = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity).fill(1);
    this.grav = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) this.state[i * 4] = 1;
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aState', new THREE.BufferAttribute(this.state, 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(this.geometry, new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(at: THREE.Vector3, o: BurstOptions): void {
    const rng = this.rng;
    const speed = o.speed ?? 3, spread = o.spread ?? 0.7, size = o.size ?? 0.12;
    for (let n = 0; n < o.count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      const y = rng.range(-1, 1), a = rng.range(0, TAU), r = Math.sqrt(1 - y * y);
      let dx = Math.cos(a) * r, dy = y, dz = Math.sin(a) * r;
      if (o.toward && dx * o.toward.x + dy * o.toward.y + dz * o.toward.z < 0) {
        dx = -dx;
        dy = -dy;
        dz = -dz;
      }
      const s = speed * (1 - spread + spread * rng.next());
      this.pos.set([at.x, at.y, at.z], i * 3);
      this.vel.set([dx * s + (o.drift?.x ?? 0), dy * s + (o.drift?.y ?? 0), dz * s + (o.drift?.z ?? 0)], i * 3);
      this.state[i * 4] = 0;
      this.state[i * 4 + 1] = size * rng.range(0.5, 1.3);
      const c = o.color2 ? _c.copy(o.color).lerp(o.color2, rng.next()) : o.color;
      this.color.set([c.r, c.g, c.b], i * 3);
      this.life[i] = (o.life ?? 1) * rng.range(0.6, 1.2);
      this.grav[i] = o.gravity ?? 2;
    }
    this.live = Math.max(this.live, 1);
  }

  update(dt: number, pixelHeight: number): void {
    this.uniforms.uPixel.value = pixelHeight;
    if (this.live === 0) return;
    let live = 0;
    const drag = Math.exp(-1.6 * dt);
    for (let i = 0; i < this.capacity; i++) {
      const age = this.state[i * 4]!;
      if (age >= 1) continue;
      live++;
      this.state[i * 4] = Math.min(1, age + dt / this.life[i]!);
      const k = i * 3;
      this.vel[k]! *= drag;
      this.vel[k + 1] = this.vel[k + 1]! * drag - this.grav[i]! * dt;
      this.vel[k + 2]! *= drag;
      this.pos[k]! += this.vel[k]! * dt;
      this.pos[k + 1]! += this.vel[k + 1]! * dt;
      this.pos[k + 2]! += this.vel[k + 2]! * dt;
    }
    this.live = live;
    this.geometry.attributes.position!.needsUpdate = true;
    this.geometry.attributes.aState!.needsUpdate = true;
    this.geometry.attributes.aColor!.needsUpdate = true;
  }
}

const _c = new THREE.Color();
