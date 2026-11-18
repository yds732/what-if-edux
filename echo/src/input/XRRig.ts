import * as THREE from 'three';
import type { Game } from '../app/Game';
import { damp } from '../core/math';
import type { Action } from './Input';

const SNAP_TURN = Math.PI / 6;
const _m = new THREE.Matrix4();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();

interface Wand {
  readonly ray: ReturnType<THREE.WebXRManager['getController']>;
  readonly grip: ReturnType<THREE.WebXRManager['getControllerGrip']>;
  handedness: XRHandedness;
  gamepad: Gamepad | null;
}

export class XRRig {
  readonly onEnd: (() => void)[] = [];
  private readonly wands: Wand[] = [];
  private readonly laser: THREE.Mesh;
  private readonly held = new Map<string, boolean>();
  private turnArmed = true;
  private floor = 0;

  constructor(private readonly game: Game) {
    const renderer = game.app.renderer;
    for (const i of [0, 1]) {
      const wand: Wand = { ray: renderer.xr.getController(i), grip: renderer.xr.getControllerGrip(i), handedness: 'none', gamepad: null };
      wand.ray.addEventListener('connected', (e) => {
        const source = e.data;
        wand.handedness = source.handedness;
        wand.gamepad = source.gamepad ?? null;
        this.dressHands();
      });
      wand.ray.addEventListener('disconnected', () => {
        wand.handedness = 'none';
        wand.gamepad = null;
      });
      this.wands.push(wand);
    }
    const beam = new THREE.CylinderGeometry(0.0016, 0.0016, 1, 6, 1, true);
    beam.rotateX(-Math.PI / 2);
    beam.translate(0, 0, -0.5);
    this.laser = new THREE.Mesh(beam, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, fog: false }));
    this.laser.scale.z = 2.2;
  }

  static async supported(): Promise<boolean> {
    try {
      return !!navigator.xr && (await navigator.xr.isSessionSupported('immersive-vr'));
    } catch {
      return false;
    }
  }

  get presenting(): boolean {
    return this.game.app.renderer.xr.isPresenting;
  }

  async enter(): Promise<void> {
    const xr = navigator.xr;
    if (!xr) throw new Error('WebXR is not available in this browser');
    const { app, input, hud, hands } = this.game;
    const session = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
    app.renderer.xr.enabled = true;
    app.renderer.xr.setReferenceSpaceType('local-floor');
    app.renderer.xr.setFoveation(1);
    await app.renderer.xr.setSession(session);
    for (const w of this.wands) app.rig.add(w.ray, w.grip);
    input.useXR(true);
    hud.enterWorldSpace(app.rig, app.camera);
    hands.attach(null, null);
    this.dressHands();
    session.addEventListener('end', () => {
      for (const w of this.wands) app.rig.remove(w.ray, w.grip);
      input.useXR(false);
      input.xrRay = null;
      hud.exitWorldSpace();
      hands.attach(null, null);
      this.game.player.xrFloor = 0;
      this.game.player.aimFrom(null, null);
      app.renderer.xr.enabled = false;
      this.laser.removeFromParent();
      for (const fn of this.onEnd) fn();
    });
  }

  private dressHands(): void {
    if (!this.presenting) return;
    const left = this.wands.find((w) => w.handedness === 'left') ?? null;
    const right = this.wands.find((w) => w.handedness === 'right') ?? this.wands.find((w) => w.handedness !== 'left') ?? null;
    this.game.hands.attach(left?.grip ?? null, right?.grip ?? null);
    (right ?? left)?.ray.add(this.laser);
  }

  private button(key: string, pressed: boolean, action: Action): void {
    const was = this.held.get(key) ?? false;
    if (pressed === was) return;
    this.held.set(key, pressed);
    if (pressed) this.game.input.press(action);
    else this.game.input.release(action);
  }

  update(dt: number): void {
    if (!this.presenting) return;
    const { input, app, hud, player } = this.game;
    let moveX = 0, moveY = 0;
    let pointer: Wand | null = null;
    for (const w of this.wands) {
      const pad = w.gamepad;
      if (!pad) continue;
      const stickX = pad.axes[2] ?? pad.axes[0] ?? 0, stickY = pad.axes[3] ?? pad.axes[1] ?? 0;
      const b = (i: number): boolean => (pad.buttons[i]?.value ?? 0) > 0.55 || !!pad.buttons[i]?.pressed;
      if (w.handedness === 'left') {
        if (Math.hypot(stickX, stickY) > 0.18) {
          moveX += stickX;
          moveY -= stickY;
        }
        this.button('l-trigger', b(0), 'advance');
        this.button('l-x', b(4), 'advance');
        this.button('l-y', b(5), 'headset');
      } else {
        pointer = w;
        if (Math.abs(stickX) < 0.3) this.turnArmed = true;
        else if (this.turnArmed && Math.abs(stickX) > 0.65) {
          this.turnArmed = false;
          input.look.x -= Math.sign(stickX) * SNAP_TURN;
        }
        this.button('r-trigger', b(0), 'primary');
        this.button('r-grip', b(1), 'interact');
        this.button('r-a', b(4), 'advance');
        this.button('r-b', b(5), 'headset');
      }
    }
    input.setXRMove(moveX, moveY);

    const src = pointer ?? this.wands.find((w) => w.gamepad) ?? null;
    if (src) {
      src.ray.updateWorldMatrix(true, false);
      _m.copy(src.ray.matrixWorld);
      _o.setFromMatrixPosition(_m);
      _d.set(0, 0, -1).transformDirection(_m);
      (input.xrRay ??= new THREE.Ray()).set(_o, _d);
      player.aimFrom(_o, _d);
      hud.setRay(input.xrRay);
    } else {
      input.xrRay = null;
      player.aimFrom(null, null);
      hud.setRay(null);
    }

    const head = app.camera.position.y;
    if (head > 0.2) this.floor = damp(this.floor, player.eyeHeight - head, 3, dt);
    player.xrFloor = this.floor;
    _q.copy(app.camera.quaternion);
    player.headYaw = new THREE.Euler().setFromQuaternion(_q, 'YXZ').y;
  }
}
