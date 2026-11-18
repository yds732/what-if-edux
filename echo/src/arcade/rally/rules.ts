import { sideOf, type Contact, type Side } from './physics';

export const other = (side: Side): Side => (side === 'you' ? 'kai' : 'you');

export class Rally {
  lastHitter: Side = 'you';
  serving: Side | null = null;
  private serveBounced = false;
  received = 0;
  length = 0;
  winner: Side | null = null;

  serve(by: Side): void {
    this.lastHitter = this.serving = by;
    this.serveBounced = false;
    this.received = 0;
    this.length = 1;
    this.winner = null;
  }

  canHit(side: Side): boolean {
    return this.winner === null && this.lastHitter !== side && this.received === 1;
  }

  awaitingServeBounce(): boolean {
    return this.serving !== null && !this.serveBounced;
  }

  struck(by: Side): void {
    this.lastHitter = by;
    this.serving = null;
    this.received = 0;
    this.length++;
  }

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

  gone(): Side {
    return this.received >= 1 ? this.lastHitter : other(this.lastHitter);
  }

  lose(): Side {
    return (this.winner ??= this.gone());
  }
}

export const TO_WIN = 7, CAP = 9;

export interface Score {
  you: number;
  kai: number;
}

const done = (a: number, b: number): boolean => (a >= TO_WIN && a - b >= 2) || a >= CAP;

export const matchWinner = (s: Score): Side | null => (done(s.you, s.kai) ? 'you' : done(s.kai, s.you) ? 'kai' : null);
export const gamePoint = (s: Score): Side | null => (done(s.you + 1, s.kai) ? 'you' : done(s.kai + 1, s.you) ? 'kai' : null);
export const serverFor = (s: Score): Side => (Math.floor((s.you + s.kai) / 2) % 2 === 0 ? 'you' : 'kai');
export const starsFor = (s: Score): 0 | 1 | 2 | 3 => (matchWinner(s) !== 'you' ? 0 : s.kai <= 2 ? 3 : s.kai <= 4 ? 2 : 1);
