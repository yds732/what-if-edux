import { clamp, type Rng } from '../../core/math';
import { TABLE, predictArrival, solveShot, v, type Ball, type Shot } from './physics';

export const BAT_REACH = 0.19;
export const SWEET = 0.125;
export const REACH = { x: 1.2, near: 1.12, far: 2.3 } as const;

export interface Swing {
  readonly offX: number;
  readonly offY: number;
  readonly across: number;
  readonly drive: number;
}

export interface Struck {
  readonly shot: Shot;
  readonly power: number;
  readonly clean: boolean;
}

export const playerShot = (ball: Ball, swing: Swing, rng: Rng): Struck | null => {
  const clean = Math.hypot(swing.offX, swing.offY) <= SWEET;
  let power = clamp(0.28 + 0.72 * clamp(swing.drive / 3.4, 0, 1), 0.2, 1);
  let aimX = clamp(swing.across * 0.24 + swing.offX * 1.7 + ball.p.x * 0.22, -0.62, 0.62);
  let aimZ = -(0.44 + 0.68 * power);
  if (!clean) {
    power *= 0.7;
    aimX += rng.range(-0.5, 0.5);
    aimZ += rng.range(-0.45, 0.35);
  } else if (power > 0.9) {
    const wild = (power - 0.9) / 0.1;
    aimX += rng.range(-0.2, 0.2) * wild;
    aimZ -= rng.range(0, 0.34) * wild;
  }
  const spin = v(-(16 + 96 * power), clamp(swing.across * 16, -60, 60), 0);
  const shot = solveShot(ball.p, aimX, aimZ, 3.0 + 5.6 * power, spin) ?? solveShot(ball.p, 0, -0.8, 4);
  return shot ? { shot, power, clean } : null;
};

export class PlayerBot {
  x = 0;
  readonly z = 1.62;
  private see = 0;
  private aim: number | null = null;
  private error = 0;

  constructor(private readonly rng: Rng, public skill = 1) {}

  incoming(): void {
    this.see = 0.26 + 0.12 * (1 - this.skill);
    this.aim = null;
  }

  rest(): void {
    this.aim = null;
    this.see = 0;
  }

  update(dt: number, ball: Ball, mine: boolean, serve: boolean): void {
    if (this.skill <= 0) return;
    if (!mine) {
      this.x += clamp(0 - this.x, -1.2 * dt, 1.2 * dt);
      return;
    }
    this.see -= dt;
    if (this.see <= 0 && this.aim === null) {
      const arrival = predictArrival(ball, 'you', this.z, serve);
      if (arrival) {
        const far = Math.abs(arrival.ball.p.x - this.x);
        this.error = this.rng.gauss() * (0.04 + 0.07 * (1 - this.skill) + 0.09 * far);
        if (this.rng.chance(0.04 + 0.07 * (1 - this.skill))) this.error += this.rng.sign() * 0.3;
        this.aim = clamp(arrival.ball.p.x + this.error, -REACH.x, REACH.x);
      } else this.aim = this.x;
    }
    if (this.aim === null) return;
    const speed = 1.6 + 2.2 * this.skill;
    this.x += clamp(this.aim - this.x, -speed * dt, speed * dt);
  }

  swing(offX: number, offY: number, kaiX = 0): Swing {
    const away = this.rng.chance(0.35 + 0.45 * this.skill) ? (kaiX > 0 ? -1 : 1) : this.rng.sign();
    return { offX, offY, across: away * this.rng.range(0.2, 1) * (0.6 + 1.4 * this.skill), drive: 0.5 + 2.1 * this.skill * this.rng.range(0.45, 1) };
  }
}

export const onBlade = (ball: Ball, bx: number, by: number, bz: number): boolean =>
  Math.hypot(ball.p.x - bx, ball.p.y - by) <= BAT_REACH && Math.abs(ball.p.z - bz) <= 0.11;

export const BEHIND = TABLE.length / 2 + 1.1;
