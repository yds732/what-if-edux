import { clamp, type Rng } from '../../core/math';
import { TABLE, predictArrival, solveServe, solveShot, v, type Ball, type Shot, type V3 } from './physics';

/**
 * How Kai plays: where he goes, whether he gets there, and what he sends back. No pictures here: the world moves
 * his body to match (see RallyWorld), and the same numbers can be played out in a test.
 *
 * Kai is one of Haven's companions, so he plays "exactly as hard as you want": his three levels are a ladder the
 * player climbs by winning, and within a game he eases off when he is ahead and sharpens when he is behind.
 */
export interface Level {
  readonly name: string;
  /** Seconds before he reads a shot and starts to move. */
  readonly react: number;
  /** How fast he crosses his end, m/s. */
  readonly speed: number;
  /** Chance that a ball he reaches goes into the net or off the table anyway. */
  readonly miss: number;
  /** How much a hard or a wide ball adds to that chance: 1 rattles him, less and he keeps his nerve. */
  readonly rattle: number;
  /** How hard he hits, from a block to a drive (0..1). */
  readonly power: readonly [number, number];
  /** How far from the middle, and from the player, he places the ball: 0 always down the middle, 1 the lines. */
  readonly wide: number;
  /** Pace of his serve. */
  readonly serve: number;
  /** How far he lets the score sway him: 1 eases off freely when ahead, 0 plays the same whatever the score. */
  readonly give: number;
}

export const LEVELS: readonly Level[] = [
  { name: 'Friendly', react: 0.32, speed: 2.2, miss: 0.2, rattle: 1, power: [0.12, 0.38], wide: 0.38, serve: 0.86, give: 1 },
  { name: 'Keen', react: 0.26, speed: 2.6, miss: 0.13, rattle: 0.75, power: [0.32, 0.62], wide: 0.62, serve: 1, give: 0.6 },
  { name: 'Fierce', react: 0.2, speed: 3.15, miss: 0.085, rattle: 0.4, power: [0.46, 0.84], wide: 0.85, serve: 1.1, give: 0.25 },
];

/** How fast across the ground his shot flies, for how hard he hits it: the same scale the player's shots are on. */
export const paceOf = (power: number): number => 3.0 + 5.6 * power;

/** Where Kai meets the ball: just past the end of the table. */
export const KAI_PLANE = -(TABLE.length / 2 + 0.14);
/** How far from his shoulder line the bat can be and still meet the ball: his arm, and the blade. */
const REACH = 0.36;
/** He takes the ball on his forehand: his body stands this far to the side of it (he is right-handed and faces +Z). */
export const FOREHAND = 0.3;
const END = 1.35;

export interface Plan {
  /** Where the ball will be met, and when (seconds from when the plan was made). */
  readonly at: V3;
  readonly time: number;
  /** Where his body has to be by then. */
  readonly standX: number;
  /** What he will do with it: a shot, or nothing, if he will not get there. */
  readonly shot: Shot | null;
  /** The shot is one of his mistakes: it is going into the net or off the table. */
  readonly error: boolean;
}

export class KaiBrain {
  /** Where he stands, across the table. */
  x = 0;
  plan: Plan | null = null;
  /** Seconds since the plan was made. */
  clock = 0;
  private wait = 0;
  /** A shot he has seen but not yet read; `serve` if it has still to bounce on the player's own half. */
  private pending: { serve: boolean } | null = null;

  constructor(private readonly rng: Rng) {}

  reset(): void {
    this.x = 0;
    this.plan = null;
    this.pending = null;
    this.wait = this.clock = 0;
  }

  /**
   * How much he holds back, from the score: 0 level, up to 1 as he pulls ahead, down to -0.5 as he falls behind.
   * It is what keeps a game with him close.
   */
  static ease(kai: number, you: number, level: Level): number {
    return clamp((kai - you - 1) / 4, -0.5, 1) * level.give;
  }

  /** The player has struck the ball toward him: he will read it after his reaction time. */
  incoming(level: Level, ease: number, serve = false): void {
    this.pending = { serve };
    this.wait = level.react * (1 + 0.5 * Math.max(0, ease));
    this.plan = null;
  }

  /** Forget the ball: the point is over. */
  stand(): void {
    this.pending = null;
    this.plan = null;
  }

  /**
   * Moves him for one frame. `ball` is the ball now and `playerX` where the player's bat is, which he plays away
   * from. Returns the shot to play in the frame the ball reaches him and he is there to meet it.
   */
  update(dt: number, ball: Ball, level: Level, ease: number, playerX: number): Shot | null {
    if (this.pending) {
      this.wait -= dt;
      if (this.wait <= 0) {
        const { serve } = this.pending;
        this.pending = null;
        this.read(ball, level, ease, playerX, serve);
      }
    }
    const plan = this.plan;
    const speed = level.speed * (1 - 0.3 * Math.max(0, ease));
    // between shots he drifts back toward the middle
    const want = plan ? plan.standX : 0, step = (plan ? speed : speed * 0.45) * dt;
    this.x += clamp(want - this.x, -step, step);
    if (!plan) return null;
    this.clock += dt;
    if (this.clock < plan.time) return null;
    this.plan = null;
    // there in time? The bat must be within his reach of where the ball is
    const there = Math.abs(this.x - FOREHAND - plan.at.x) <= REACH && Math.hypot(ball.p.x - plan.at.x, ball.p.y - plan.at.y, ball.p.z - plan.at.z) < 0.2;
    return there ? plan.shot : null;
  }

  private read(ball: Ball, level: Level, ease: number, playerX: number, serve: boolean): void {
    const arrival = predictArrival(ball, 'kai', KAI_PLANE, serve);
    this.clock = 0;
    if (!arrival) return;
    const at = arrival.ball.p;
    const standX = clamp(at.x + FOREHAND, -END, END);
    const rng = this.rng;
    // harder to handle: a fast ball, and one he has to run for
    const pace = Math.hypot(arrival.ball.v.x, arrival.ball.v.z), run = Math.abs(standX - this.x);
    const miss = level.miss * (1 + 1.2 * Math.max(0, ease)) * (1 + 0.5 * Math.min(ease, 0)) + level.rattle * (0.045 * Math.max(0, pace - 5) + 0.09 * Math.max(0, run - 0.6));
    const error = rng.chance(clamp(miss, 0.01, 0.75));

    // away from the player, as far as his level dares; a mistake goes long or wide instead
    const power = rng.range(level.power[0], level.power[1]) * (1 - 0.25 * Math.max(0, ease));
    const side = playerX > 0.08 ? -1 : playerX < -0.08 ? 1 : rng.sign();
    let aimX = side * level.wide * rng.range(0.35, 1) * (TABLE.width / 2 - 0.12);
    let aimZ = 0.45 + 0.68 * power + rng.range(-0.08, 0.08);
    if (error) {
      if (rng.chance(0.5)) aimZ = TABLE.length / 2 + rng.range(0.12, 0.5);
      else aimX = rng.sign() * (TABLE.width / 2 + rng.range(0.08, 0.3));
    }
    // topspin as he hits harder: toward +Z, that is a turn about +X
    const shot = solveShot(at, aimX, aimZ, paceOf(power), v(16 + 90 * power, 0, 0)) ?? solveShot(at, 0, 0.8, 4);
    this.plan = { at: { ...at }, time: arrival.time, standX, shot, error };
  }

  /** His serve, from where he stands. */
  serve(from: V3, level: Level): Shot | null {
    const aim = this.rng.range(-1, 1) * level.wide * (TABLE.width / 2 - 0.15);
    return solveServe('kai', from, aim, level.serve) ?? solveServe('kai', v(0, from.y, from.z), 0, 1);
  }
}
