import * as THREE from 'three';
import { clamp } from '../core/math';
import { Signal } from '../core/tasks';

export type Action = 'primary' | 'interact' | 'advance' | 'pause' | 'choice1' | 'choice2' | 'choice3' | 'headset' | 'controls';
export type InputMode = 'mouse' | 'touch' | 'xr';

const KEY_ACTIONS: Record<string, Action> = {
  KeyE: 'interact', KeyF: 'interact', Space: 'advance', Enter: 'advance', Digit1: 'choice1', Digit2: 'choice2', Digit3: 'choice3',
  Numpad1: 'choice1', Numpad2: 'choice2', Numpad3: 'choice3', KeyQ: 'headset', KeyP: 'pause', KeyK: 'controls',
  // with the mouse captured the browser keeps Escape for itself (and the game pauses as the mouse is let go); with a free cursor it arrives here
  Escape: 'pause',
};
export const ACTION_LABELS: Record<InputMode, Record<'interact' | 'headset', string>> = {
  mouse: { interact: 'E', headset: 'Q' },
  touch: { interact: 'TAP', headset: 'TAP' },
  xr: { interact: 'TRIGGER', headset: 'B' },
};

const MOVE_KEYS: Record<string, [x: number, y: number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};

export interface PointerState {
  x: number;
  y: number;
  active: boolean;
}

const isTap = (travelPx: number, startedMs: number): boolean => travelPx < 14 && performance.now() - startedMs < 320;

export class Input {
  readonly move = new THREE.Vector2();
  readonly look = new THREE.Vector2();
  readonly pressed = new Set<Action>();
  readonly released = new Set<Action>();
  readonly held = new Set<Action>();
  readonly pointer: PointerState = { x: 0, y: 0, active: false };
  xrRay: THREE.Ray | null = null;
  tap: { x: number; y: number } | null = null;
  mode: InputMode = 'mouse';
  wantsLock = false;
  /** On a touch screen the left of the picture is a walking stick. Off, a finger anywhere is the pointer: a game played by pointing. */
  sticks = true;
  sensitivity = 1;
  readonly onModeChange = new Signal<InputMode>();
  readonly onLockLost = new Signal();
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

  freePointer(): void {
    this.wantsLock = false;
    if (this.locked) document.exitPointerLock();
  }

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
        if (this.sticks && p.x < w * 0.42 && this.stickId === null) {
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

  get wasTap(): boolean {
    return this.touchTap;
  }

  get stickView(): { ox: number; oy: number; dx: number; dy: number } | null {
    return this.stickId === null ? null : { ox: this.stickOrigin.x, oy: this.stickOrigin.y, dx: this.stick.x, dy: this.stick.y };
  }

  useXR(active: boolean): void {
    this.xr = active;
    this.xrMove.set(0, 0);
    this.setMode(active ? 'xr' : 'mouse');
  }

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

  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.look.set(0, 0);
    this.tap = null;
    this.touchTap = false;
  }

  flush(): void {
    this.pressed.clear();
    this.released.clear();
  }

  inject(action: Action): void {
    this.pressed.add(action);
    this.released.add(action);
  }
}
