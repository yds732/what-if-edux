import { clamp, type Rng } from '../../core/math';
import { TABLE, predictArrival, solveServe, solveShot, v, type Ball, type Shot, type V3 } from './physics';

export interface Level {
  readonly name: string;
  readonly react: number;
  readonly speed: number;
  readonly miss: number;
  readonly rattle: number;
  readonly power: readonly [number, number];
  readonly wide: number;
  readonly serve: number;
  readonly give: number;
}

export const LEVELS: readonly Level[] = [
  { name: 'Friendly', react: 0.32, speed: 2.2, miss: 0.2, rattle: 1, power: [0.12, 0.38], wide: 0.38, serve: 0.86, give: 1 },
  { name: 'Keen', react: 0.26, speed: 2.6, miss: 0.13, rattle: 0.75, power: [0.32, 0.62], wide: 0.62, serve: 1, give: 0.6 },
  { name: 'Fierce', react: 0.2, speed: 3.15, miss: 0.085, rattle: 0.4, power: [0.46, 0.84], wide: 0.85, serve: 1.1, give: 0.25 },
];

export const paceOf = (power: number): number => 3.0 + 5.6 * power;

export const KAI_PLANE = -(TABLE.length / 2 + 0.14);
const REACH = 0.36;
export const FOREHAND = 0.3;
const END = 1.35;

export interface Plan {
  readonly at: V3;
  readonly time: number;
  readonly standX: number;
  readonly shot: Shot | null;
  readonly error: boolean;
}

export class KaiBrain {
  x = 0;
  plan: Plan | null = null;
  clock = 0;
  private wait = 0;
  private pending: { serve: boolean } | null = null;

  constructor(private readonly rng: Rng) {}

  reset(): void {
    this.x = 0;
    this.plan = null;
    this.pending = null;
    this.wait = this.clock = 0;
  }

  static ease(kai: number, you: number, level: Level): number {
    return clamp((kai - you - 1) / 4, -0.5, 1) * level.give;
  }

  incoming(level: Level, ease: number, serve = false): void {
    this.pending = { serve };
    this.wait = level.react * (1 + 0.5 * Math.max(0, ease));
    this.plan = null;
  }

  stand(): void {
    this.pending = null;
    this.plan = null;
  }

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
    const want = plan ? plan.standX : 0, step = (plan ? speed : speed * 0.45) * dt;
    this.x += clamp(want - this.x, -step, step);
    if (!plan) return null;
    this.clock += dt;
    if (this.clock < plan.time) return null;
    this.plan = null;
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
    const pace = Math.hypot(arrival.ball.v.x, arrival.ball.v.z), run = Math.abs(standX - this.x);
    const miss = level.miss * (1 + 1.2 * Math.max(0, ease)) * (1 + 0.5 * Math.min(ease, 0)) + level.rattle * (0.045 * Math.max(0, pace - 5) + 0.09 * Math.max(0, run - 0.6));
    const error = rng.chance(clamp(miss, 0.01, 0.75));

    const power = rng.range(level.power[0], level.power[1]) * (1 - 0.25 * Math.max(0, ease));
    const side = playerX > 0.08 ? -1 : playerX < -0.08 ? 1 : rng.sign();
    let aimX = side * level.wide * rng.range(0.35, 1) * (TABLE.width / 2 - 0.12);
    let aimZ = 0.45 + 0.68 * power + rng.range(-0.08, 0.08);
    if (error) {
      if (rng.chance(0.5)) aimZ = TABLE.length / 2 + rng.range(0.12, 0.5);
      else aimX = rng.sign() * (TABLE.width / 2 + rng.range(0.08, 0.3));
    }
    const shot = solveShot(at, aimX, aimZ, paceOf(power), v(16 + 90 * power, 0, 0)) ?? solveShot(at, 0, 0.8, 4);
    this.plan = { at: { ...at }, time: arrival.time, standX, shot, error };
  }

  serve(from: V3, level: Level): Shot | null {
    const aim = this.rng.range(-1, 1) * level.wide * (TABLE.width / 2 - 0.15);
    return solveServe('kai', from, aim, level.serve) ?? solveServe('kai', v(0, from.y, from.z), 0, 1);
  }
}
