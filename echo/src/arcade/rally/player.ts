import { clamp, type Rng } from '../../core/math';
import { TABLE, predictArrival, solveShot, v, type Ball, type Shot } from './physics';

/**
 * The player's side of the table as numbers: what a swing does to the ball, and a stand-in for a person at the
 * controls, for tests and for tuning the game without one.
 */

/** The bat meets the ball anywhere within this of the middle of the blade: generous, so that timing matters more than aim. */
export const BAT_REACH = 0.19;
/** Inside this it is a clean hit; outside, the ball comes off the edge. */
export const SWEET = 0.125;
/** Where the bat may go at the player's end: across, and how near to and far from the net. */
export const REACH = { x: 1.2, near: 1.12, far: 2.3 } as const;

export interface Swing {
  /** Where on the blade the ball landed: metres across and up from its middle. */
  readonly offX: number;
  readonly offY: number;
  /** How the bat was moving across the table, m/s. */
  readonly across: number;
  /** The hardest it was pushed toward the net in the moment before, m/s. */
  readonly drive: number;
}

export interface Struck {
  readonly shot: Shot;
  /** 0 a block, 1 flat out. */
  readonly power: number;
  /** Met inside the sweet part of the blade. */
  readonly clean: boolean;
}

/**
 * What the player's bat does to the ball. Pushed forward through the ball it drives harder and deeper; drawn
 * across it, or meeting the ball off-centre, it sends the ball wide. The shot is then solved to land where it was
 * aimed, so a ball only goes astray off the edge of the blade or from swinging flat out.
 */
export const playerShot = (ball: Ball, swing: Swing, rng: Rng): Struck | null => {
  const clean = Math.hypot(swing.offX, swing.offY) <= SWEET;
  let power = clamp(0.28 + 0.72 * clamp(swing.drive / 3.4, 0, 1), 0.2, 1);
  let aimX = clamp(swing.across * 0.24 + swing.offX * 1.7 + ball.p.x * 0.22, -0.62, 0.62);
  let aimZ = -(0.44 + 0.68 * power);
  if (!clean) {
    // off the edge of the blade: it goes somewhere near where it was meant
    power *= 0.7;
    aimX += rng.range(-0.5, 0.5);
    aimZ += rng.range(-0.45, 0.35);
  } else if (power > 0.9) {
    // flat out: brilliant, or just long
    const wild = (power - 0.9) / 0.1;
    aimX += rng.range(-0.2, 0.2) * wild;
    aimZ -= rng.range(0, 0.34) * wild;
  }
  // topspin with pace (toward -Z, a turn about -X), and a curl from the bat's movement across
  const spin = v(-(16 + 96 * power), clamp(swing.across * 16, -60, 60), 0);
  const shot = solveShot(ball.p, aimX, aimZ, 3.0 + 5.6 * power, spin) ?? solveShot(ball.p, 0, -0.8, 4);
  return shot ? { shot, power, clean } : null;
};

/**
 * A stand-in for a person: it sees a shot a reaction time after it is struck, moves its bat toward where the ball
 * will be no faster than a hand does, and is a little off. `skill` 1 is a capable player; 0 does not move at all.
 */
export class PlayerBot {
  /** Where its bat is, across the table and along it. */
  x = 0;
  readonly z = 1.62;
  private see = 0;
  private aim: number | null = null;
  private error = 0;

  constructor(private readonly rng: Rng, public skill = 1) {}

  /** Kai has just struck the ball (or served it). */
  incoming(): void {
    this.see = 0.26 + 0.12 * (1 - this.skill);
    this.aim = null;
  }

  rest(): void {
    this.aim = null;
    this.see = 0;
  }

  /** One frame: `ball` is the ball now, `serve` if Kai's serve has yet to bounce on his own half. */
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
        // a person is never exactly right: less so the further they have to go, and on a bad day
        const far = Math.abs(arrival.ball.p.x - this.x);
        this.error = this.rng.gauss() * (0.04 + 0.07 * (1 - this.skill) + 0.09 * far);
        // and now and then they simply read it wrong
        if (this.rng.chance(0.04 + 0.07 * (1 - this.skill))) this.error += this.rng.sign() * 0.3;
        this.aim = clamp(arrival.ball.p.x + this.error, -REACH.x, REACH.x);
      } else this.aim = this.x;
    }
    if (this.aim === null) return;
    const speed = 1.6 + 2.2 * this.skill;
    this.x += clamp(this.aim - this.x, -speed * dt, speed * dt);
  }

  /** How it swings when the ball arrives: harder with skill, and (a capable player's habit) across the table away from where Kai stands at `kaiX`. */
  swing(offX: number, offY: number, kaiX = 0): Swing {
    const away = this.rng.chance(0.35 + 0.45 * this.skill) ? (kaiX > 0 ? -1 : 1) : this.rng.sign();
    return { offX, offY, across: away * this.rng.range(0.2, 1) * (0.6 + 1.4 * this.skill), drive: 0.5 + 2.1 * this.skill * this.rng.range(0.45, 1) };
  }
}

/** Whether a ball at (x, y, z) is on a blade whose middle is at (bx, by, bz): on it across and up, and within the swing's depth along the table. */
export const onBlade = (ball: Ball, bx: number, by: number, bz: number): boolean =>
  Math.hypot(ball.p.x - bx, ball.p.y - by) <= BAT_REACH && Math.abs(ball.p.z - bz) <= 0.11;

/** The furthest the player's end reaches along the table: a ball past it is behind them. */
export const BEHIND = TABLE.length / 2 + 1.1;
