import { clamp, clamp01, type Rng } from '../../core/math';
import { KaiBrain, type Level } from './opponent';
import { TABLE, heightAt, solveServe, stepBall, v, STEP, type Ball, type Contact, type Side, type V3 } from './physics';
import { onBlade, playerShot, type Swing } from './player';
import { Rally } from './rules';

export interface CourtEvents {
  contact?(contact: Contact): void;
  struck?(by: Side, power: number, clean: boolean): void;
  decided?(winner: Side): void;
}

const H = TABLE.height;

export class Court {
  readonly ball: Ball = { p: v(0, H + 0.3, 1.6), v: v(), w: v() };
  readonly rally = new Rally();
  readonly brain: KaiBrain;
  live = false;

  constructor(private readonly rng: Rng, brainRng: Rng, private readonly events: CourtEvents = {}) {
    this.brain = new KaiBrain(brainRng);
  }

  reset(): void {
    this.live = false;
    this.brain.reset();
    this.ball.v = v();
    this.ball.w = v();
  }

  serveYou(aimX: number, level: Level, ease: number): boolean {
    const shot = solveServe('you', this.ball.p, aimX) ?? solveServe('you', v(0, H + 0.4, 1.6), 0);
    if (!shot) return false;
    this.ball.v = { ...shot.v };
    this.ball.w = { ...shot.w };
    this.rally.serve('you');
    this.live = true;
    this.brain.incoming(level, ease, true);
    return true;
  }

  serveKai(level: Level): boolean {
    const shot = this.brain.serve(this.ball.p, level);
    if (!shot) return false;
    this.ball.v = { ...shot.v };
    this.ball.w = { ...shot.w };
    this.rally.serve('kai');
    this.live = true;
    return true;
  }

  batHeight(batZ: number): number | null {
    const { ball, rally } = this;
    if (!this.live || rally.lastHitter !== 'kai' || ball.v.z <= 0) return null;
    const pass = ball.p.z < batZ ? heightAt(ball, batZ) : ball.p.y;
    return pass === null ? null : clamp(pass, H + 0.07, H + 0.78);
  }

  step(dt: number, bat: V3, swing: (offX: number, offY: number) => Swing, level: Level, ease: number): void {
    const { ball, rally, brain, events } = this;
    const steps = Math.max(1, Math.round(dt / STEP)), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const contact = stepBall(ball, h);
      if (contact) {
        events.contact?.(contact);
        if (this.live) this.settle(rally.contact(contact, ball.p.z));
      }
      if (!this.live) continue;
      if (ball.p.y < -2 || Math.abs(ball.p.z) > 9 || Math.abs(ball.p.x) > 7) {
        this.settle(rally.lose());
        continue;
      }
      if (rally.canHit('you') && ball.v.z > 0 && onBlade(ball, bat.x, bat.y, bat.z)) {
        const struck = playerShot(ball, swing(ball.p.x - bat.x, ball.p.y - bat.y), this.rng);
        if (struck) {
          ball.v = { ...struck.shot.v };
          ball.w = { ...struck.shot.w };
          rally.struck('you');
          brain.incoming(level, ease);
          events.struck?.('you', struck.power, struck.clean);
        }
      }
      const reply = brain.update(h, ball, level, ease, bat.x);
      if (reply && rally.canHit('kai')) {
        ball.v = { ...reply.v };
        ball.w = { ...reply.w };
        rally.struck('kai');
        events.struck?.('kai', clamp01((Math.hypot(reply.v.x, reply.v.z) - 3.0) / 5.6), true);
      }
    }
    if (!this.live) brain.update(dt, ball, level, ease, bat.x);
  }

  private settle(winner: Side | null): void {
    if (!winner || !this.live) return;
    this.live = false;
    this.brain.stand();
    this.events.decided?.(winner);
  }
}
