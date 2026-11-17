import * as THREE from 'three';
import { clamp } from '../core/math';
import { Signal } from '../core/tasks';

export type Action = 'primary' | 'interact' | 'advance' | 'pause' | 'choice1' | 'choice2' | 'choice3' | 'headset';
export type InputMode = 'mouse' | 'touch' | 'xr';

const KEY_ACTIONS: Record<string, Action> = {
  KeyE: 'interact', KeyF: 'interact', Space: 'advance', Enter: 'advance', Digit1: 'choice1', Digit2: 'choice2', Digit3: 'choice3',
  Numpad1: 'choice1', Numpad2: 'choice2', Numpad3: 'choice3', KeyQ: 'headset', KeyP: 'pause',
};
/** What a prompt tells the player to press for an action, in each way of playing. Kept beside the bindings it describes. */
export const ACTION_LABELS: Record<InputMode, Record<'interact' | 'headset', string>> = {
  mouse: { interact: 'E', headset: 'Q' },
  touch: { interact: 'TAP', headset: 'TAP' },
  xr: { interact: 'TRIGGER', headset: 'B' },
};

const MOVE_KEYS: Record<string, [x: number, y: number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};

export interface PointerState {
  /** Position in CSS pixels from the canvas's top-left. */
  x: number;
  y: number;
  /** True while a free cursor or a finger is on screen: the HUD hit-tests against it. */
  active: boolean;
}

/** A touch this short and this still was a tap. */
const isTap = (travelPx: number, startedMs: number): boolean => travelPx < 14 && performance.now() - startedMs < 320;

/**
 * One description of what the player wants this frame, whatever they are holding: keyboard and mouse, a touch
 * screen, or XR controllers. Systems read `move`, `look` and the action sets; nothing else touches the DOM.
 */
export class Input {
  /** x strafes right, y walks forward, each -1..1. */
  readonly move = new THREE.Vector2();
  /** Yaw and pitch to apply this frame, radians. Cleared by `endFrame`. */
  readonly look = new THREE.Vector2();
  readonly pressed = new Set<Action>();
  readonly released = new Set<Action>();
  readonly held = new Set<Action>();
  readonly pointer: PointerState = { x: 0, y: 0, active: false };
  /** In a headset: the ray the player points with, in world space. */
  xrRay: THREE.Ray | null = null;
  /** Position of the click or tap that produced this frame's `primary`, if it came from a free pointer or a finger. */
  tap: { x: number; y: number } | null = null;
  mode: InputMode = 'mouse';
  /** Mouse capture is wanted (in play, no menu open). The canvas re-captures on the next click. */
  wantsLock = false;
  sensitivity = 1;
  readonly onModeChange = new Signal<InputMode>();
  /** The browser took the mouse away (Esc): the game should pause. */
  readonly onLockLost = new Signal();
  /** A key, a button or a finger, going down or coming up: the moments a browser will let sound start. */
  readonly onGesture = new Signal();

  private readonly keys = new Set<string>();
  private readonly stick = new THREE.Vector2();
  private readonly xrMove = new THREE.Vector2();
  private xr = false;
  private stickId: number | null = null;
  private stickOrigin = new THREE.Vector2();
  private stickLast = new THREE.Vector2();
  private stickTravel = 0;
  private stickStart = 0;
  private lookId: number | null = null;
  private lookLast = new THREE.Vector2();
  private lookTravel = 0;
  private lookStart = 0;
  private touchTap = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    // a phone or tablet is a touch device from the first frame, before any finger has come down on the picture
    if (matchMedia('(pointer: coarse)').matches) this.mode = 'touch';
    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    addEventListener('blur', () => this.releaseAll());
    canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    addEventListener('mouseup', (e) => this.onMouseUp(e));
    addEventListener('mousemove', (e) => this.onMouseMove(e));
    document.addEventListener('pointerlockchange', () => {
      if (!this.locked && this.wantsLock && this.mode === 'mouse') this.onLockLost.emit();
    });
    canvas.addEventListener('touchstart', (e) => this.onTouch(e), { passive: false });
    canvas.addEventListener('touchmove', (e) => this.onTouch(e), { passive: false });
    canvas.addEventListener('touchend', (e) => this.onTouchEnd(e), { passive: false });
    canvas.addEventListener('touchcancel', (e) => this.onTouchEnd(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** Lets go of the mouse so the player can point at a menu or a choice. */
  freePointer(): void {
    this.wantsLock = false;
    if (this.locked) document.exitPointerLock();
  }

  /** Captures the mouse; only succeeds inside a user gesture, so call it from the click that asked for it. */
  capturePointer(): void {
    this.wantsLock = true;
    if (this.mode === 'mouse' && !this.locked) this.canvas.requestPointerLock()?.catch?.(() => undefined);
  }

  private setMode(mode: InputMode): void {
    if (this.xr) mode = 'xr';
    if (mode === this.mode) return;
    this.mode = mode;
    this.onModeChange.emit(mode);
  }

  private gesture(): void {
    this.onGesture.emit();
  }

  private down(a: Action): void {
    if (!this.held.has(a)) this.pressed.add(a);
    this.held.add(a);
  }
  private up(a: Action): void {
    if (this.held.delete(a)) this.released.add(a);
  }
  private releaseAll(): void {
    this.keys.clear();
    for (const a of [...this.held]) this.up(a);
    this.stick.set(0, 0);
    this.stickId = this.lookId = null;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (down) this.gesture();
    if (e.code in MOVE_KEYS) {
      if (down) this.keys.add(e.code);
      else this.keys.delete(e.code);
      e.preventDefault();
      return;
    }
    const action = KEY_ACTIONS[e.code];
    if (!action) return;
    if (e.code === 'Space') e.preventDefault();
    if (down && !e.repeat) {
      this.setMode('mouse');
      this.down(action);
    } else if (!down) this.up(action);
  }

  private canvasPoint(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    this.gesture();
    this.setMode('mouse');
    if (this.wantsLock && !this.locked) {
      // this click only takes the mouse back; it is not a game action
      this.capturePointer();
      return;
    }
    this.tap = this.locked ? null : this.canvasPoint(e.clientX, e.clientY);
    this.down('primary');
  }
  private onMouseUp(e: MouseEvent): void {
    this.gesture();
    if (e.button === 0) this.up('primary');
  }
  private onMouseMove(e: MouseEvent): void {
    if (this.mode === 'touch') return;
    if (this.locked) {
      const k = 0.0021 * this.sensitivity;
      // one frame of a stuck browser can deliver a huge jump: clamp it
      this.look.x -= clamp(e.movementX, -120, 120) * k;
      this.look.y -= clamp(e.movementY, -120, 120) * k;
      this.pointer.active = false;
    } else {
      const p = this.canvasPoint(e.clientX, e.clientY);
      this.pointer.x = p.x;
      this.pointer.y = p.y;
      this.pointer.active = true;
    }
  }

  private onTouch(e: TouchEvent): void {
    e.preventDefault();
    this.gesture();
    this.setMode('touch');
    const w = this.canvas.clientWidth;
    for (const t of Array.from(e.changedTouches)) {
      const p = this.canvasPoint(t.clientX, t.clientY);
      if (e.type === 'touchstart') {
        if (p.x < w * 0.42 && this.stickId === null) {
          this.stickId = t.identifier;
          this.stickOrigin.set(p.x, p.y);
          this.stickLast.set(p.x, p.y);
          this.stickTravel = 0;
          this.stickStart = performance.now();
          this.stick.set(0, 0);
        } else if (this.lookId === null) {
          this.lookId = t.identifier;
          this.lookLast.set(p.x, p.y);
          this.lookTravel = 0;
          this.lookStart = performance.now();
          this.pointer.x = p.x;
          this.pointer.y = p.y;
          this.pointer.active = true;
          // a hold on this side draws back a throw, so the press counts at once; whether it was a tap is known on release
          this.held.add('primary');
          this.pressed.add('primary');
        }
      } else if (t.identifier === this.stickId) {
        const r = 56;
        this.stickTravel += Math.abs(p.x - this.stickLast.x) + Math.abs(p.y - this.stickLast.y);
        this.stickLast.set(p.x, p.y);
        this.stick.set(clamp((p.x - this.stickOrigin.x) / r, -1, 1), clamp(-(p.y - this.stickOrigin.y) / r, -1, 1));
      } else if (t.identifier === this.lookId) {
        const dx = p.x - this.lookLast.x, dy = p.y - this.lookLast.y;
        this.lookTravel += Math.abs(dx) + Math.abs(dy);
        const k = 0.0052 * this.sensitivity;
        this.look.x -= dx * k;
        this.look.y -= dy * k;
        this.lookLast.set(p.x, p.y);
        this.pointer.x = p.x;
        this.pointer.y = p.y;
      }
    }
  }
  private onTouchEnd(e: TouchEvent): void {
    e.preventDefault();
    this.gesture();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        this.stickId = null;
        this.stick.set(0, 0);
        // a thumb that came down and went straight up was not steering: it was a tap on whatever is there
        if (isTap(this.stickTravel, this.stickStart)) {
          this.pointer.x = this.stickLast.x;
          this.pointer.y = this.stickLast.y;
          this.released.add('primary');
          this.tapped(this.stickLast);
        }
      } else if (t.identifier === this.lookId) {
        this.lookId = null;
        this.pointer.active = false;
        this.up('primary');
        if (isTap(this.lookTravel, this.lookStart)) this.tapped(this.lookLast);
      }
    }
  }

  private tapped(at: THREE.Vector2): void {
    this.touchTap = true;
    this.tap = { x: at.x, y: at.y };
  }

  /** True in the frame a finger lifts having barely moved or lingered: a tap, rather than a look, a hold or a push of the stick. */
  get wasTap(): boolean {
    return this.touchTap;
  }

  /** Where a touch stick is anchored and deflected, for drawing it; null when no thumb is down. */
  get stickView(): { ox: number; oy: number; dx: number; dy: number } | null {
    return this.stickId === null ? null : { ox: this.stickOrigin.x, oy: this.stickOrigin.y, dx: this.stick.x, dy: this.stick.y };
  }

  /** Entering or leaving a headset: while inside, the controllers are the input. */
  useXR(active: boolean): void {
    this.xr = active;
    this.xrMove.set(0, 0);
    this.setMode(active ? 'xr' : 'mouse');
  }

  /** For controller buttons: the same press and release a key produces. */
  press(action: Action): void {
    this.gesture();
    this.down(action);
  }
  release(action: Action): void {
    this.up(action);
  }
  setXRMove(x: number, y: number): void {
    this.xrMove.set(x, y);
  }

  /** Call once at the start of each frame, before systems read the state. */
  beginFrame(): void {
    let x = 0, y = 0;
    for (const code of this.keys) {
      const m = MOVE_KEYS[code];
      if (m) {
        x += m[0];
        y += m[1];
      }
    }
    x += this.stick.x + this.xrMove.x;
    y += this.stick.y + this.xrMove.y;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.move.set(x, y);
  }

  /** Call once at the end of each frame. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.look.set(0, 0);
    this.tap = null;
    this.touchTap = false;
  }

  /** Forgets presses that were never read: what was typed at a menu must not land in the game when it closes. */
  flush(): void {
    this.pressed.clear();
    this.released.clear();
  }

  /** For tests and the autopilot: presses and releases an action within one frame. */
  inject(action: Action): void {
    this.pressed.add(action);
    this.released.add(action);
  }
}
