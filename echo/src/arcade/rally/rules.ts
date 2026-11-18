import { sideOf, type Contact, type Side } from './physics';

/**
 * The rules of a point, as a small state machine: who struck the ball last, what it has touched since, and so who
 * wins when it goes wrong. It knows nothing of how the ball flies or is drawn; it is told what the ball met.
 *
 * As at a real table: a serve bounces once on the server's half and then on the receiver's; after that every shot
 * must clear the net and land on the other half, and must be returned before it bounces twice.
 */
export const other = (side: Side): Side => (side === 'you' ? 'kai' : 'you');

export class Rally {
  lastHitter: Side = 'you';
  /** Who served, until the serve has been returned or has failed. */
  serving: Side | null = null;
  private serveBounced = false;
  /** Bounces on the receiver's half since the last hit. */
  received = 0;
  /** Shots played, the serve included. */
  length = 0;
  winner: Side | null = null;

  /** A new point: `by` has just served. */
  serve(by: Side): void {
    this.lastHitter = this.serving = by;
    this.serveBounced = false;
    this.received = 0;
    this.length = 1;
    this.winner = null;
  }

  /** Whether `side` may play the ball now: it has come over and bounced once on their half. */
  canHit(side: Side): boolean {
    return this.winner === null && this.lastHitter !== side && this.received === 1;
  }

  /** The serve is in flight toward `side` and has yet to make its first bounce, on the server's own half. */
  awaitingServeBounce(): boolean {
    return this.serving !== null && !this.serveBounced;
  }

  struck(by: Side): void {
    this.lastHitter = by;
    this.serving = null;
    this.received = 0;
    this.length++;
  }

  /** The ball has met something at `z` along the table. Returns the winner if that settles the point. */
  contact(contact: Contact, z: number): Side | null {
    if (this.winner) return null;
    if (contact === 'table') {
      const side = sideOf(z);
      if (this.serving && !this.serveBounced) {
        if (side === this.serving) this.serveBounced = true;
        else this.winner = other(this.serving);
      } else if (side === this.lastHitter) this.winner = other(this.lastHitter);
      else if (++this.received >= 2) this.winner = this.lastHitter;
    } else if (contact === 'floor') this.winner = this.gone();
    return this.winner;
  }

  /** Who wins if the ball is lost now: whoever hit it, if it had landed in; otherwise the other. */
  gone(): Side {
    return this.received >= 1 ? this.lastHitter : other(this.lastHitter);
  }

  /** Ends the point by decree: the ball left the world. */
  lose(): Side {
    return (this.winner ??= this.gone());
  }
}

/** Points to win; a game level at one short of it goes on until someone leads by two, and no further than CAP. */
export const TO_WIN = 7, CAP = 9;

export interface Score {
  you: number;
  kai: number;
}

const done = (a: number, b: number): boolean => (a >= TO_WIN && a - b >= 2) || a >= CAP;

export const matchWinner = (s: Score): Side | null => (done(s.you, s.kai) ? 'you' : done(s.kai, s.you) ? 'kai' : null);
/** Who is one point from the game, if anyone. */
export const gamePoint = (s: Score): Side | null => (done(s.you + 1, s.kai) ? 'you' : done(s.kai + 1, s.you) ? 'kai' : null);
/** The serve changes hands every two points. */
export const serverFor = (s: Score): Side => (Math.floor((s.you + s.kai) / 2) % 2 === 0 ? 'you' : 'kai');
/** Stars for a win: by how little Kai was allowed. */
export const starsFor = (s: Score): 0 | 1 | 2 | 3 => (matchWinner(s) !== 'you' ? 0 : s.kai <= 2 ? 3 : s.kai <= 4 ? 2 : 1);
