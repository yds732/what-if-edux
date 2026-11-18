import { clamp, clamp01, type Rng } from '../../core/math';
import { KaiBrain, type Level } from './opponent';
import { TABLE, heightAt, solveServe, stepBall, v, STEP, type Ball, type Contact, type Side, type V3 } from './physics';
import { onBlade, playerShot, type Swing } from './player';
import { Rally } from './rules';

/** What happens on the court, for whoever draws it and makes its sounds. */
export interface CourtEvents {
  /** The ball met the table, the net or the ground. */
  contact?(contact: Contact): void;
  /** A bat met the ball: whose, how hard (0..1), and whether it was a clean hit. */
  struck?(by: Side, power: number, clean: boolean): void;
  /** The point is over. */
  decided?(winner: Side): void;
}

const H = TABLE.height;

/**
 * One point of table tennis as it is played: the ball in flight, the rules watching it, Kai deciding what to do
 * about it, and the player's bat wherever the caller says it is. No pictures and no clock of its own, so the game
 * draws it frame by frame and a test can play a thousand points of it in a second.
 */
export class Court {
  readonly ball: Ball = { p: v(0, H + 0.3, 1.6), v: v(), w: v() };
  readonly rally = new Rally();
  readonly brain: KaiBrain;
  /** The ball is in play. */
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

  /** The player serves the ball from where it is, toward `aimX` across Kai's half. False if no serve gets there. */
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

  /** The height the player's bat should rise to at `batZ`, so as to be where the ball will pass: null when the ball is not theirs to play. */
  batHeight(batZ: number): number | null {
    const { ball, rally } = this;
    if (!this.live || rally.lastHitter !== 'kai' || ball.v.z <= 0) return null;
    const pass = ball.p.z < batZ ? heightAt(ball, batZ) : ball.p.y;
    return pass === null ? null : clamp(pass, H + 0.07, H + 0.78);
  }

  /**
   * Advances the court by `dt`. `bat` is the middle of the player's blade; `swing` is asked how the bat is moving
   * in the moment the ball is on it. `ease` is how much Kai is holding back.
   */
  step(dt: number, bat: V3, swing: (offX: number, offY: number) => Swing, level: Level, ease: number): void {
    const { ball, rally, brain, events } = this;
    // fixed steps: the flight is the same at any frame rate, and the same as the one Kai read
    const steps = Math.max(1, Math.round(dt / STEP)), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const contact = stepBall(ball, h);
      if (contact) {
        events.contact?.(contact);
        if (this.live) this.settle(rally.contact(contact, ball.p.z));
      }
      if (!this.live) continue;
      // a ball that never comes down anywhere that counts
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
        // how hard he hit it, on the scale the player's own shots are measured by
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
