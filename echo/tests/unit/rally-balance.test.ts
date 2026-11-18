import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/math';
import { Court } from '../../src/arcade/rally/court';
import { KaiBrain, LEVELS } from '../../src/arcade/rally/opponent';
import { TABLE, v, type Side } from '../../src/arcade/rally/physics';
import { PlayerBot } from '../../src/arcade/rally/player';
import { matchWinner, serverFor, type Score } from '../../src/arcade/rally/rules';

const H = TABLE.height, FRAME = 1 / 60;

interface Tally {
  wins: number;
  matches: number;
  points: number;
  shots: number;
  /** Seconds a player has between Kai striking the ball and it reaching their bat, summed and counted. */
  window: number;
  windows: number;
  /** How points ended: a shot the other never reached, or a mistake (net, out) by whoever hit last. */
  yourWinners: number;
  kaiMistakes: number;
  kaiWinners: number;
  yourMistakes: number;
}

/** Plays whole games between Kai at a level and a stand-in for a person, and counts what happened. */
const play = (level: number, skill: number, matches: number): Tally => {
  const tally: Tally = { wins: 0, matches, points: 0, shots: 0, window: 0, windows: 0, yourWinners: 0, kaiMistakes: 0, kaiWinners: 0, yourMistakes: 0 };
  for (let m = 0; m < matches; m++) {
    const seed = 1000 * level + 17 * m + Math.round(skill * 100);
    const bot = new PlayerBot(new Rng(seed + 2), skill);
    let winner: Side | null = null, struckAt = -1, clock = 0, lastBy: Side = 'you';
    const court = new Court(new Rng(seed), new Rng(seed + 1), {
      struck: (by) => {
        lastBy = by;
        if (by === 'kai') {
          bot.incoming();
          struckAt = clock;
        } else if (struckAt >= 0) {
          tally.window += clock - struckAt;
          tally.windows++;
          struckAt = -1;
        }
      },
      decided: (side) => (winner = side),
    });
    const score: Score = { you: 0, kai: 0 };
    while (!matchWinner(score)) {
      const server = serverFor(score), at = LEVELS[level]!, ease = KaiBrain.ease(score.kai, score.you, at);
      winner = null;
      struckAt = -1;
      court.reset();
      bot.rest();
      if (server === 'you') {
        court.ball.p = v(bot.x, H + 0.4, bot.z - 0.06);
        expect(court.serveYou(-bot.x * 0.55, at, ease)).toBe(true);
        lastBy = 'you';
      } else {
        court.ball.p = v(court.brain.x - 0.3, H + 0.34, -1.5);
        expect(court.serveKai(at)).toBe(true);
        bot.incoming();
        struckAt = clock;
        lastBy = 'kai';
      }
      let y = H + 0.2;
      for (let t = 0; t < 240 && winner === null; t += FRAME) {
        clock += FRAME;
        bot.update(FRAME, court.ball, court.rally.lastHitter === 'kai', court.rally.awaitingServeBounce());
        // the bat rises to the ball as it does in the game, a little behind it
        y += ((court.batHeight(bot.z) ?? H + 0.2) - y) * (1 - Math.exp(-16 * FRAME));
        court.step(FRAME, { x: bot.x, y, z: bot.z }, (ox, oy) => bot.swing(ox, oy, court.brain.x), at, ease);
      }
      expect(winner, 'every point ends').not.toBeNull();
      score[winner!]++;
      tally.points++;
      tally.shots += court.rally.length;
      if (winner === 'you') lastBy === 'you' ? tally.yourWinners++ : tally.kaiMistakes++;
      else lastBy === 'kai' ? tally.kaiWinners++ : tally.yourMistakes++;
    }
    if (matchWinner(score) === 'you') tally.wins++;
  }
  return tally;
};

describe('Moonlight Rally, played by a stand-in for a person', () => {
  const pct = (n: number, t: Tally): string => `${Math.round((100 * n) / t.points)}%`;
  const report = (name: string, t: Tally): string =>
    `${name}: wins ${t.wins}/${t.matches}, ${(t.shots / t.points).toFixed(1)} shots a point, ${(t.window / Math.max(1, t.windows)).toFixed(2)} s to reach the ball; points: your winners ${pct(t.yourWinners, t)}, Kai's mistakes ${pct(t.kaiMistakes, t)}, Kai's winners ${pct(t.kaiWinners, t)}, your mistakes ${pct(t.yourMistakes, t)}`;
  // every level against a capable player and against someone new to it: played once, read by each test
  const table = LEVELS.map((level, i) => {
    const capable = play(i, 1, 40), fresh = play(i, 0.5, 40);
    console.log(report(`${level.name}, capable player`, capable));
    console.log(report(`${level.name}, new player    `, fresh));
    return { capable, fresh };
  });
  const rate = (t: Tally): number => t.wins / t.matches;
  const window = (t: Tally): number => t.window / t.windows;

  it('gives a player time to reach the ball, less of it at each level', () => {
    const [friendly, keen, fierce] = table.map((row) => window(row.capable)) as [number, number, number];
    // the first level leaves most of a second; the last still more than a reaction time and a move
    expect(friendly).toBeGreaterThan(0.8);
    expect(fierce).toBeGreaterThan(0.52);
    expect(friendly).toBeGreaterThan(keen);
    expect(keen).toBeGreaterThan(fierce);
  });

  it('is won by a capable player at the first level, and is a real game at the last', () => {
    expect(rate(table[0]!.capable)).toBeGreaterThan(0.85);
    expect(rate(table[2]!.capable)).toBeGreaterThan(0.15);
    expect(rate(table[2]!.capable)).toBeLessThan(0.9);
  });

  it('gets harder with each level', () => {
    expect(rate(table[0]!.capable)).toBeGreaterThanOrEqual(rate(table[1]!.capable));
    expect(rate(table[1]!.capable)).toBeGreaterThan(rate(table[2]!.capable));
    expect(rate(table[0]!.fresh)).toBeGreaterThan(rate(table[1]!.fresh));
    expect(rate(table[1]!.fresh)).toBeGreaterThan(rate(table[2]!.fresh));
  });

  it('can be won at the first level by someone new to it', () => {
    expect(rate(table[0]!.fresh)).toBeGreaterThan(0.55);
  });

  it('is lost by a player who does nothing', () => {
    expect(play(0, 0, 4).wins).toBe(0);
  });

  it('has rallies, but not endless ones', () => {
    for (const row of table) {
      expect(row.capable.shots / row.capable.points).toBeGreaterThan(3.5);
      expect(row.capable.shots / row.capable.points).toBeLessThan(16);
    }
  });

  it("is decided by both players, not only by Kai's mistakes", () => {
    const t = table[1]!.capable;
    expect(t.yourWinners + t.kaiWinners + t.yourMistakes).toBeGreaterThan(t.points * 0.3);
  });
});
