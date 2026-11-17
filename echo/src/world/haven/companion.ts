import * as THREE from 'three';
import type { Character } from '../../characters/Character';
import { angleDelta, damp } from '../../core/math';
import type { Colliders } from '../colliders';

/**
 * Lumi on the move: the Echo companion being a little too keen to be your friend. It leads the tour, and in free
 * time it keeps near the player without quite walking
 * with them: it drifts off to look at blossom and at things in the grass, and the moment the player comes close it
 * stops whatever it was doing and watches them.
 */

/** A floating "!" over the head, like a notification: talk to me. */
const buildAlert = (): { group: THREE.Group; material: THREE.MeshBasicMaterial } => {
  const group = new THREE.Group();
  group.name = 'companion alert';
  const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.86, 0.05, 0.06), transparent: true, depthWrite: false, toneMapped: false });
  const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.16, 4, 12), material);
  bar.position.y = 0.13;
  bar.scale.set(1, 1, 0.6);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 10), material);
  dot.scale.set(1, 1, 0.6);
  // a soft disc behind, so it reads against the bright sky
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.19, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
  disc.position.set(0, 0.09, -0.03);
  group.add(disc, bar, dot);
  group.renderOrder = 5;
  return { group, material };
};

/** A small caption over the head, such as "Birthday tomorrow". */
const buildLabel = (): { sprite: THREE.Sprite; set: (text: string | null) => void } => {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 112;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
  sprite.scale.set(0.82, 0.18, 1);
  sprite.renderOrder = 5;
  sprite.visible = false;
  const set = (text: string | null): void => {
    sprite.visible = !!text;
    if (!text) return;
    const g = canvas.getContext('2d')!;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.font = '600 46px system-ui, "Segoe UI", sans-serif';
    const w = Math.min(500, g.measureText(text).width + 64), x = (canvas.width - w) / 2;
    g.fillStyle = 'rgba(18, 22, 34, 0.82)';
    g.beginPath();
    g.roundRect(x, 18, w, 76, 38);
    g.fill();
    g.strokeStyle = 'rgba(143, 234, 255, 0.9)';
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = '#e9fbff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, canvas.width / 2, 58);
    texture.needsUpdate = true;
  };
  return { sprite, set };
};

/** A ring on the ground around Lumi while it leads: faint and beckoning far off, bright once you are with it. */
const buildFollowRing = (radius: number): { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial } => {
  const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.44, 0.9, 1), transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.RingGeometry(radius - 0.07, radius, 72), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.04;
  mesh.renderOrder = 3;
  return { mesh, material };
};

/** Close enough that Lumi stops and watches you. */
const NEAR = 2.3;
/** Further than this and Lumi comes after you. */
const FAR = 4.6;
/** Leading: the player counts as following within this distance. */
export const FOLLOW_RADIUS = 2.4;
/** Leading: further back than this and Lumi stops to wait. */
const LEFT_BEHIND = 6;
const SPEED = 1.5;
const RADIUS = 0.3;

export type CompanionMode = 'still' | 'roam' | 'lead';

export class Companion {
  readonly person: Character;
  /** Where to aim to talk: the middle of the chest, kept up to date. */
  readonly chest = new THREE.Vector3();
  /** still: where the story put it. roam: keeps near the player and wanders. lead: goes to a point and waits there for the player. */
  mode: CompanionMode = 'still';
  /** Leading: Lumi has reached the point it was going to. */
  arrived = false;
  /** Leading: the player is close enough to count as following. */
  followed = false;
  private readonly alert: ReturnType<typeof buildAlert>;
  private readonly label = buildLabel();
  private readonly ring = buildFollowRing(FOLLOW_RADIUS);
  private alertShown = 0;
  private alertOn = false;
  private ringShown = 0;
  private readonly pos = new THREE.Vector3();
  private readonly goal = new THREE.Vector3();
  private readonly gaze = new THREE.Vector3();
  private curiosity: THREE.Vector3 | null = null;
  /** Leading: something to point at once there. */
  private showing: THREE.Vector3 | null = null;
  private linger = 0;
  private beckonIn = 0;
  /** Leading: seconds spent close to the goal without getting nearer, as when the player stands on the spot. */
  private stuck = 0;
  private yaw = 0;
  private time = 0;

  constructor(
    person: Character,
    /** Things worth a look: blossom, flowers, crystals in the grass. */
    private readonly curiosities: readonly THREE.Vector3[],
    private readonly groundAt: (x: number, z: number) => number,
    private readonly colliders: Colliders,
  ) {
    this.person = person;
    this.alert = buildAlert();
    person.root.add(this.alert.group);
    this.alert.group.visible = false;
    person.root.add(this.label.sprite);
    person.root.add(this.ring.mesh);
  }

  /** The "!" over Lumi's head. */
  setAlert(on: boolean): void {
    this.alertOn = on;
  }

  /** The caption over Lumi's head, or null for none. */
  setLabel(text: string | null): void {
    this.label.set(text);
  }

  /** Leads the player to (x, z), where Lumi turns to show them `show`. */
  leadTo(x: number, z: number, show: THREE.Vector3 | null): void {
    this.mode = 'lead';
    this.goal.set(x, 0, z);
    this.showing = show;
    this.arrived = false;
    this.stuck = 0;
    this.beckonIn = 1.2;
  }

  /** Puts Lumi at a point, facing `yaw` (0 faces +Z). */
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
    // the alert bobs and always faces the camera; the label sits under it
    this.alertShown = damp(this.alertShown, this.alertOn ? 1 : 0, 7, dt);
    const a = this.alert.group;
    a.visible = this.alertShown > 0.01;
    const top = p.eyeHeight + 0.42;
    this.label.sprite.position.y = top;
    if (a.visible) {
      a.position.y = top + (this.label.sprite.visible ? 0.3 : 0.12) + Math.sin(this.time * 2.6) * 0.05;
      a.scale.setScalar(this.alertShown * (1 + 0.06 * Math.sin(this.time * 5.2)));
      a.quaternion.copy(p.root.quaternion).invert().multiply(camera.quaternion);
    }
    this.chest.set(this.pos.x, this.pos.y + p.eyeHeight * 0.75, this.pos.z);

    const toPlayer = Math.hypot(player.x - this.pos.x, player.z - this.pos.z);
    this.followed = this.mode === 'lead' && toPlayer < FOLLOW_RADIUS;
    // the follow ring: a slow pulse while Lumi waits for you, bright and still once you are with it
    const ringWant = this.mode !== 'lead' ? 0 : this.followed ? 0.95 : 0.3 + 0.25 * Math.sin(this.time * 4);
    this.ringShown = damp(this.ringShown, ringWant, 6, dt);
    this.ring.material.opacity = this.ringShown;
    this.ring.mesh.visible = this.ringShown > 0.01;
    this.ring.mesh.scale.setScalar(this.followed ? 1 : 1 + 0.04 * Math.sin(this.time * 4));
    if (this.mode === 'still') return;

    let look: THREE.Vector3 | null = null;
    let goal: THREE.Vector3 | null = this.goal;
    if (this.mode === 'lead') {
      const left = Math.hypot(this.goal.x - this.pos.x, this.goal.z - this.pos.z);
      this.stuck = left < 1.6 && toPlayer < 1.4 ? this.stuck + dt : 0;
      const there = left < 0.2 || this.stuck > 0.6;
      this.arrived = there;
      // waits only for a player who is behind it, not one who has gone on ahead
      const playerLeft = Math.hypot(this.goal.x - player.x, this.goal.z - player.z);
      if (!there && toPlayer > LEFT_BEHIND && playerLeft > left) {
        // too far ahead: stop, turn round and wave the player on
        goal = null;
        look = eye;
      } else if (there) {
        look = this.followed && this.showing ? this.showing : eye;
      }
      if (!this.followed && (there || goal === null)) {
        this.beckonIn -= dt;
        if (this.beckonIn <= 0) {
          p.play('beckon');
          this.beckonIn = 3.2;
        }
      }
    } else if (toPlayer < NEAR) {
      // close: stop, turn and watch
      this.goal.copy(this.pos);
      this.curiosity = null;
      this.linger = 0;
      look = eye;
    } else if (toPlayer > FAR) {
      // left behind: catch up, to a spot a little to one side of the player
      const ang = Math.atan2(this.pos.x - player.x, this.pos.z - player.z);
      this.goal.set(player.x + Math.sin(ang) * 2.8, 0, player.z + Math.cos(ang) * 2.8);
      this.curiosity = null;
      look = eye;
    } else {
      // in between: distracted by whatever is nearby
      this.linger -= dt;
      if (!this.curiosity || this.linger <= 0) this.pickCuriosity(player);
      look = this.curiosity;
    }

    // glide toward the goal
    let moving = false, d = 0;
    if (goal) {
      const dx = goal.x - this.pos.x, dz = goal.z - this.pos.z;
      d = Math.hypot(dx, dz);
      if (d > 0.12) {
        const step = Math.min(d, SPEED * dt * Math.min(1, d / 0.6 + 0.25));
        const next = { x: this.pos.x + (dx / d) * step, z: this.pos.z + (dz / d) * step };
        this.colliders.resolve(next, RADIUS);
        // never into the player
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

    // face where it is going, or what it is looking at
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

  /** Something near the player to wander over to and stare at for a while. */
  private pickCuriosity(player: THREE.Vector3): void {
    const near = this.curiosities.filter((c) => c !== this.curiosity && Math.hypot(c.x - player.x, c.z - player.z) < FAR + 0.6);
    const pool = near.length ? near : this.curiosities;
    const c = pool[Math.floor(Math.random() * pool.length)] ?? null;
    this.curiosity = c;
    this.linger = 3 + Math.random() * 3.5;
    if (!c) return;
    // stand a step short of it, on the side facing Lumi
    const ang = Math.atan2(this.pos.x - c.x, this.pos.z - c.z);
    const back = c.y > 1.2 ? 1.9 : 0.8;
    this.goal.set(c.x + Math.sin(ang) * back, 0, c.z + Math.cos(ang) * back);
  }
}
