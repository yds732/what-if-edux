import * as THREE from 'three';
import type { Character } from '../../characters/Character';
import { angleDelta, damp } from '../../core/math';
import type { Colliders } from '../colliders';

const buildAlert = (): { group: THREE.Group; material: THREE.MeshBasicMaterial } => {
  const group = new THREE.Group();
  group.name = 'companion alert';
  const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.86, 0.05, 0.06), transparent: true, depthWrite: false, toneMapped: false });
  const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.15, 4, 12), material);
  bar.position.y = 0.17;
  bar.scale.set(1, 1, 0.6);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.034, 16, 10), material);
  dot.scale.set(1, 1, 0.6);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.19, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
  disc.position.set(0, 0.12, -0.03);
  group.add(disc, bar, dot);
  group.renderOrder = 5;
  return { group, material };
};

const buildLabel = (): { sprite: THREE.Sprite; rows: () => number; set: (text: string | null) => void } => {
  const ROW = 112, canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = ROW * 2;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
  sprite.scale.set(0.82, 0.36, 1);
  sprite.center.set(0.5, 0);
  sprite.renderOrder = 5;
  sprite.visible = false;
  let rows = 0;
  const set = (text: string | null): void => {
    const lines = text ? text.split('\n').filter(Boolean).slice(0, 2) : [];
    rows = lines.length;
    sprite.visible = rows > 0;
    if (!rows) return;
    const g = canvas.getContext('2d')!;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.font = '600 46px system-ui, "Segoe UI", "Segoe UI Emoji", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((line, i) => {
      const top = canvas.height - ROW * (lines.length - i);
      const w = Math.min(500, g.measureText(line).width + 64), x = (canvas.width - w) / 2;
      g.fillStyle = 'rgba(18, 22, 34, 0.82)';
      g.beginPath();
      g.roundRect(x, top + 18, w, 76, 38);
      g.fill();
      g.strokeStyle = 'rgba(143, 234, 255, 0.9)';
      g.lineWidth = 3;
      g.stroke();
      g.fillStyle = '#e9fbff';
      g.fillText(line, canvas.width / 2, top + 58);
    });
    texture.needsUpdate = true;
  };
  return { sprite, rows: () => rows, set };
};

const NEAR = 2.3;
const FAR = 4.6;
const SPEED = 1.5;
const RADIUS = 0.3;

export type CompanionMode = 'still' | 'roam';

export class Companion {
  readonly person: Character;
  readonly chest = new THREE.Vector3();
  mode: CompanionMode = 'still';
  private readonly alert: ReturnType<typeof buildAlert>;
  private readonly label = buildLabel();
  private alertShown = 0;
  private alertOn = false;
  private readonly pos = new THREE.Vector3();
  private readonly goal = new THREE.Vector3();
  private readonly gaze = new THREE.Vector3();
  private curiosity: THREE.Vector3 | null = null;
  private linger = 0;
  private yaw = 0;
  private time = 0;

  constructor(
    person: Character,
    private readonly curiosities: readonly THREE.Vector3[],
    private readonly groundAt: (x: number, z: number) => number,
    private readonly colliders: Colliders,
  ) {
    this.person = person;
    this.alert = buildAlert();
    person.root.add(this.alert.group);
    this.alert.group.visible = false;
    person.root.add(this.label.sprite);
  }

  setAlert(on: boolean): void {
    this.alertOn = on;
  }

  setLabel(text: string | null): void {
    this.label.set(text);
  }

  placeAt(x: number, z: number, yaw: number): void {
    this.pos.set(x, this.groundAt(x, z), z);
    this.yaw = yaw;
    this.goal.copy(this.pos);
    this.curiosity = null;
    this.person.place(this.pos.x, this.pos.y, this.pos.z, yaw);
  }

  update(dt: number, player: THREE.Vector3, eye: THREE.Vector3, camera: THREE.Camera): void {
    this.time += dt;
    const p = this.person;
    if (this.mode === 'still') {
      this.pos.copy(p.root.position);
      this.yaw = p.root.rotation.y;
    }
    this.alertShown = damp(this.alertShown, this.alertOn ? 1 : 0, 7, dt);
    const a = this.alert.group;
    a.visible = this.alertShown > 0.01;
    const top = p.eyeHeight + 0.42;
    this.label.sprite.position.y = top - 0.09;
    if (a.visible) {
      a.position.y = top + (this.label.rows() ? 0.12 + 0.18 * this.label.rows() : 0.12) + Math.sin(this.time * 2.6) * 0.05;
      a.scale.setScalar(this.alertShown * (1 + 0.06 * Math.sin(this.time * 5.2)));
      a.quaternion.copy(p.root.quaternion).invert().multiply(camera.quaternion);
    }
    this.chest.set(this.pos.x, this.pos.y + p.eyeHeight * 0.75, this.pos.z);

    const toPlayer = Math.hypot(player.x - this.pos.x, player.z - this.pos.z);
    if (this.mode === 'still') return;

    let look: THREE.Vector3 | null = null;
    const goal: THREE.Vector3 = this.goal;
    if (toPlayer < NEAR) {
      this.goal.copy(this.pos);
      this.curiosity = null;
      this.linger = 0;
      look = eye;
    } else if (toPlayer > FAR) {
      const ang = Math.atan2(this.pos.x - player.x, this.pos.z - player.z);
      this.goal.set(player.x + Math.sin(ang) * 2.8, 0, player.z + Math.cos(ang) * 2.8);
      this.curiosity = null;
      look = eye;
    } else {
      this.linger -= dt;
      if (!this.curiosity || this.linger <= 0) this.pickCuriosity(player);
      look = this.curiosity;
    }

    let moving = false, d = 0;
    {
      const dx = goal.x - this.pos.x, dz = goal.z - this.pos.z;
      d = Math.hypot(dx, dz);
      if (d > 0.12) {
        const step = Math.min(d, SPEED * dt * Math.min(1, d / 0.6 + 0.25));
        const next = { x: this.pos.x + (dx / d) * step, z: this.pos.z + (dz / d) * step };
        this.colliders.resolve(next, RADIUS);
        const px = next.x - player.x, pz = next.z - player.z, pd = Math.hypot(px, pz);
        if (pd < 1.1 && pd > 1e-4) {
          next.x = player.x + (px / pd) * 1.1;
          next.z = player.z + (pz / pd) * 1.1;
        }
        this.pos.x = next.x;
        this.pos.z = next.z;
        moving = step > 1e-4;
      }
    }
    this.pos.y = damp(this.pos.y, this.groundAt(this.pos.x, this.pos.z), 10, dt);

    const faceTo = moving && d > 0.5 ? goal : look;
    if (faceTo) {
      const want = Math.atan2(faceTo.x - this.pos.x, faceTo.z - this.pos.z);
      this.yaw += angleDelta(this.yaw, want) * Math.min(1, dt * (look === eye ? 5 : 3));
    }
    p.place(this.pos.x, this.pos.y, this.pos.z, this.yaw);
    if (look === eye) p.lookAtPoint(eye);
    else if (look) p.lookAtPoint(this.gaze.copy(look));
    else p.lookAtPoint(null);
  }

  private pickCuriosity(player: THREE.Vector3): void {
    const near = this.curiosities.filter((c) => c !== this.curiosity && Math.hypot(c.x - player.x, c.z - player.z) < FAR + 0.6);
    const pool = near.length ? near : this.curiosities;
    const c = pool[Math.floor(Math.random() * pool.length)] ?? null;
    this.curiosity = c;
    this.linger = 3 + Math.random() * 3.5;
    if (!c) return;
    const ang = Math.atan2(this.pos.x - c.x, this.pos.z - c.z);
    const back = c.y > 1.2 ? 1.9 : 0.8;
    this.goal.set(c.x + Math.sin(ang) * back, 0, c.z + Math.cos(ang) * back);
  }
}
