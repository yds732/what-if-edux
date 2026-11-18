import * as THREE from 'three';
import { clamp01 } from '../core/math';
import { GLSL_OUTPUT } from '../render/glsl';
import { getHaloTexture } from '../world/haven/atmosphere';

/**
 * Effects the arcade's games share: the streak a fast thing leaves behind it, the ring where something lands, many
 * copies of a model in one draw, the soft shadow that says how high a ball is, and a way to give a copy of a model
 * its own colour.
 */

const TRAIL_VS = /* glsl */ `
attribute float aAge; attribute float aSide;
varying float vAge; varying float vSide;
void main(){
  vAge = aAge; vSide = aSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const TRAIL_FS = /* glsl */ `
uniform vec3 uColor, uHot; uniform float uGain;
varying float vAge; varying float vSide;
void main(){
  float across = 1.0 - abs(vSide);
  float a = pow(clamp(1.0 - vAge, 0.0, 1.0), 1.6) * across * across;
  gl_FragColor = vec4(mix(uColor, uHot, pow(clamp(1.0 - vAge, 0.0, 1.0), 4.0)) * a * uGain, 1.0);
  ${GLSL_OUTPUT}
}`;

const _to = new THREE.Vector3();
const _along = new THREE.Vector3();
const _side = new THREE.Vector3();
const _eye = new THREE.Vector3();

/**
 * A ribbon of light behind something that moves: where it has been over the last `life` seconds, turned to face
 * the camera, thinning and fading toward its tail.
 */
export class Trail {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** Half the ribbon's width at its head, in metres. */
  width: number;
  readonly uniforms = { uColor: { value: new THREE.Color(0.45, 0.84, 1.0) }, uHot: { value: new THREE.Color(1, 0.97, 0.9) }, uGain: { value: 2.4 } };
  private readonly points: THREE.Vector3[] = [];
  private readonly born: number[] = [];
  private readonly position: Float32Array;
  private readonly age: Float32Array;
  private clock = 0;

  constructor(private readonly capacity = 56, width = 0.03, private readonly life = 0.32) {
    this.width = width;
    this.position = new Float32Array(capacity * 2 * 3);
    this.age = new Float32Array(capacity * 2).fill(1);
    const side = new Float32Array(capacity * 2), index: number[] = [];
    for (let i = 0; i < capacity; i++) {
      side.set([-1, 1], i * 2);
      if (i < capacity - 1) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAge', new THREE.BufferAttribute(this.age, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setIndex(index);
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: TRAIL_VS, fragmentShader: TRAIL_FS, uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  /** Forgets where the thing has been: it was put somewhere new, and must not streak across the gap. */
  clear(): void {
    this.points.length = this.born.length = 0;
    this.age.fill(1);
    this.mesh.geometry.attributes.aAge!.needsUpdate = true;
  }

  /** Call every frame with where the thing is now. */
  update(head: THREE.Vector3, camera: THREE.Camera, dt: number): void {
    this.clock += dt;
    this.points.unshift(head.clone());
    this.born.unshift(this.clock);
    while (this.points.length > this.capacity || (this.born.length > 0 && this.clock - this.born[this.born.length - 1]! > this.life)) {
      this.points.pop();
      this.born.pop();
    }
    camera.getWorldPosition(_eye);
    const n = this.points.length;
    for (let i = 0; i < this.capacity; i++) {
      const k = Math.min(i, n - 1), p = this.points[k]!;
      const age = i < n ? (this.clock - this.born[k]!) / this.life : 1;
      // across the ribbon: at right angles to its run and to the line of sight
      _along.subVectors(this.points[Math.max(0, k - 1)]!, this.points[Math.min(n - 1, k + 1)]!);
      _side.crossVectors(_along, _to.subVectors(_eye, p));
      const length = _side.length();
      if (length > 1e-6) _side.multiplyScalar((this.width * (1 - 0.8 * clamp01(age))) / length);
      else _side.set(0, 0, 0);
      this.position.set([p.x - _side.x, p.y - _side.y, p.z - _side.z, p.x + _side.x, p.y + _side.y, p.z + _side.z], i * 6);
      this.age[i * 2] = this.age[i * 2 + 1] = age;
    }
    this.mesh.geometry.attributes.position!.needsUpdate = true;
    this.mesh.geometry.attributes.aAge!.needsUpdate = true;
  }
}

const RING_VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RING_FS = /* glsl */ `
uniform vec3 uColor; uniform float uAge;
varying vec2 vUv;
void main(){
  float r = length(vUv * 2.0 - 1.0);
  float at = 0.12 + 0.82 * (1.0 - pow(1.0 - uAge, 3.0));
  float band = exp(-pow((r - at) / (0.035 + 0.05 * uAge), 2.0));
  float fill = (1.0 - smoothstep(0.0, at, r)) * 0.22 * (1.0 - uAge);
  float a = (band + fill) * pow(1.0 - uAge, 1.5);
  gl_FragColor = vec4(uColor * a, 1.0);
  ${GLSL_OUTPUT}
}`;

interface RingSlot {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  life: number;
  age: number;
}

/** Rings of light that spread from where something landed and are gone in a moment. A fixed pool: the oldest is reused. */
export class Rings {
  readonly group = new THREE.Group();
  private readonly slots: RingSlot[] = [];
  private next = 0;

  constructor(count = 10) {
    const quad = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(quad, new THREE.ShaderMaterial({
        vertexShader: RING_VS, fragmentShader: RING_FS, uniforms: { uColor: { value: new THREE.Color() }, uAge: { value: 1 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      }));
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.group.add(mesh);
      this.slots.push({ mesh, life: 1, age: 1 });
    }
  }

  /** A ring `size` metres across, lying on the plane whose normal is `normal` (straight up if left out). */
  emit(at: THREE.Vector3, size: number, color: THREE.Color, life = 0.45, normal?: THREE.Vector3): void {
    const slot = this.slots[this.next]!;
    this.next = (this.next + 1) % this.slots.length;
    slot.life = life;
    slot.age = 0;
    slot.mesh.position.copy(at);
    slot.mesh.scale.setScalar(size);
    slot.mesh.quaternion.setFromUnitVectors(_side.set(0, 0, 1), normal ?? _along.set(0, 1, 0));
    slot.mesh.material.uniforms.uColor!.value.copy(color);
    slot.mesh.visible = true;
  }

  update(dt: number): void {
    for (const slot of this.slots) {
      if (!slot.mesh.visible) continue;
      slot.age += dt / slot.life;
      slot.mesh.material.uniforms.uAge!.value = Math.min(1, slot.age);
      if (slot.age >= 1) slot.mesh.visible = false;
    }
  }
}

const _batch = new THREE.Matrix4();
const UNTINTED = new THREE.Color(1, 1, 1);

/**
 * Many copies of one model drawn as a single batch: forty-nine jewels are five draws, not forty-nine. Each frame
 * `begin`, `add` every copy that is to be seen (where it is, and a tint: above 1 it glows), then `end`.
 */
export class Batch {
  private readonly meshes: { mesh: THREE.InstancedMesh; base: THREE.Matrix4 }[] = [];
  private count = 0;

  constructor(model: THREE.Object3D, readonly capacity: number, parent: THREE.Object3D, shadows = true) {
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const mesh = new THREE.InstancedMesh(o.geometry as THREE.BufferGeometry, o.material as THREE.Material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      // every copy has a tint from the start: adding one later would mean compiling the material again
      for (let i = 0; i < capacity; i++) mesh.setColorAt(i, UNTINTED);
      mesh.count = 0;
      parent.add(mesh);
      this.meshes.push({ mesh, base: o.matrixWorld.clone() });
    });
  }

  begin(): void {
    this.count = 0;
  }

  add(matrix: THREE.Matrix4, tint: THREE.Color = UNTINTED): void {
    if (this.count >= this.capacity) return;
    for (const { mesh, base } of this.meshes) {
      mesh.setMatrixAt(this.count, _batch.multiplyMatrices(matrix, base));
      mesh.setColorAt(this.count, tint);
    }
    this.count++;
  }

  end(): void {
    for (const { mesh } of this.meshes) {
      mesh.count = this.count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}

/**
 * The soft dark patch under something in the air. A shadow map cannot draw a ball three centimetres across; this
 * can, and it is what tells the eye how high the ball is and where it will come down.
 */
export class BlobShadow {
  readonly mesh: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;

  constructor(private readonly radius: number, private readonly strength = 0.62) {
    this.mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ map: getHaloTexture(), color: 0x000000, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, fog: false }));
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 1;
  }

  /** Lays the shadow on a surface at `surface` under a thing at (x, y, z). */
  place(x: number, y: number, z: number, surface: number): void {
    const height = Math.max(0, y - surface);
    this.mesh.position.set(x, surface + 0.003, z);
    // higher is wider and fainter
    this.mesh.scale.setScalar(this.radius * (2.4 + height * 3.2));
    this.mesh.material.opacity = this.strength / (1 + height * 3.5);
  }
}

/**
 * Gives a material of a generated model another colour: paint within `width` of the hue `from` (0..1 around the
 * wheel) is turned to the hue `to`, keeping its light and shade. Call on a copy's own material (see `ownMaterials`).
 */
export const repaint = (material: THREE.MeshStandardMaterial, from: number, to: number, width = 0.12): void => {
  const uniforms = { uRepaint: { value: new THREE.Vector3(from, to, width) } };
  const before = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uRepaint;
vec3 rpHsv(vec3 c){
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 rpRgb(vec3 c){
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  // judged in display space, where the painted hues were chosen
  vec3 s = pow(max(diffuseColor.rgb, 0.0), vec3(1.0 / 2.2)), hsv = rpHsv(s);
  float near = 1.0 - smoothstep(uRepaint.z * 0.6, uRepaint.z, abs(fract(hsv.x - uRepaint.x + 0.5) - 0.5));
  float k = near * smoothstep(0.12, 0.3, hsv.y);
  diffuseColor.rgb = pow(mix(s, rpRgb(vec3(uRepaint.y, hsv.y, hsv.z)), k), vec3(2.2));
}`);
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|arcade-repaint`;
  material.needsUpdate = true;
};

/** Gives a copy of a model materials of its own, so that changing them leaves every other copy as it was. */
export const ownMaterials = (object: THREE.Object3D): THREE.MeshStandardMaterial[] => {
  const made: THREE.MeshStandardMaterial[] = [];
  object.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const source = o.material as THREE.MeshStandardMaterial;
    const own = source.clone();
    // a clone copies what a material is made of, but not the hooks that repaint it or make its paint glow
    own.onBeforeCompile = source.onBeforeCompile;
    own.customProgramCacheKey = source.customProgramCacheKey;
    o.material = own;
    made.push(own);
  });
  return made;
};
