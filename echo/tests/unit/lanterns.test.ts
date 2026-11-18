import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/math';
import { Board, Game, LEVELS, PRISM, SIZE, adjacent, bestMove, type Gem, type Kind, type Power, type Wave } from '../../src/arcade/lanterns/board';

const lay = (board: Board, rows: string[], powers: Record<string, Power> = {}): void => {
  let id = 9000;
  rows.forEach((row, r) => {
    const y = SIZE - 1 - r;
    [...row].forEach((ch, x) => {
      const power = powers[`${x},${y}`] ?? 'none';
      (board.cells[x] as Gem[])[y] = { id: id++, kind: power === 'prism' ? PRISM : (Number(ch) as Kind), power };
    });
  });
};

const kindsOf = (wave: Wave): number[] => wave.cleared.map((c) => c.gem.kind).sort();
const noLines = (board: Board): boolean => {
  for (let x = 0; x < SIZE; x++) for (let y = 0; y < SIZE; y++) {
    const k = board.at(x, y).kind;
    if (k === PRISM) continue;
    if (x + 2 < SIZE && board.at(x + 1, y).kind === k && board.at(x + 2, y).kind === k) return false;
    if (y + 2 < SIZE && board.at(x, y + 1).kind === k && board.at(x, y + 2).kind === k) return false;
  }
  return true;
};

const QUIET = ['0123012', '2301230', '0123012', '2301230', '0123012', '2301230', '0123012'];

describe('a board', () => {
  it('is laid with no lines made and a move to be found', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const board = new Board(new Rng(seed));
      expect(noLines(board)).toBe(true);
      expect(board.findMove()).not.toBeNull();
    }
  });

  it('refuses a swap that makes nothing, and leaves the board as it was', () => {
    const board = new Board(new Rng(1));
    lay(board, QUIET);
    const before = board.cells.map((c) => c.map((g) => g.id).join()).join('|');
    expect(board.swap({ x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
    expect(board.swap({ x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
    expect(board.cells.map((c) => c.map((g) => g.id).join()).join('|')).toBe(before);
  });

  it('clears a line of three, drops what is above it, and fills from the top', () => {
    const board = new Board(new Rng(2));
    lay(board, QUIET.slice(0, 5).concat(['2341230', '4413012']));
    const waves = board.swap({ x: 2, y: 1 }, { x: 2, y: 0 })!;
    expect(waves).not.toBeNull();
    expect(kindsOf(waves[0]!).slice(0, 3)).toEqual([4, 4, 4]);
    expect(waves[0]!.cleared.filter((c) => c.gem.kind === 4).every((c) => c.y === 0 && c.x <= 2)).toBe(true);
    expect(waves[0]!.falls.filter((f) => f.fromY >= SIZE).length).toBeGreaterThanOrEqual(3);
    expect(noLines(board)).toBe(true);
    for (let x = 0; x < SIZE; x++) expect(board.cells[x]!.filter(Boolean)).toHaveLength(SIZE);
  });

  it('leaves a beam behind a line of four, where the moved jewel was', () => {
    const board = new Board(new Rng(3));
    lay(board, QUIET.slice(0, 5).concat(['2304230', '4440312']));
    const waves = board.swap({ x: 3, y: 1 }, { x: 3, y: 0 })!;
    expect(waves[0]!.made).toHaveLength(1);
    expect(waves[0]!.made[0]).toMatchObject({ x: 3, y: 0, gem: { kind: 4, power: 'beamH' } });
    expect(board.at(3, 0)).toMatchObject({ kind: 4, power: 'beamH' });
  });

  it('a beam clears its whole row when it is matched', () => {
    const board = new Board(new Rng(4));
    lay(board, QUIET.slice(0, 5).concat(['2341230', '4413012']), { '0,0': 'beamH' });
    const waves = board.swap({ x: 2, y: 1 }, { x: 2, y: 0 })!;
    expect(waves[0]!.fired).toEqual([{ x: 0, y: 0, power: 'beamH', kind: 4 }]);
    expect(waves[0]!.cleared.filter((c) => c.y === 0)).toHaveLength(SIZE);
  });

  it('leaves a burst where a line across meets a line up', () => {
    const board = new Board(new Rng(5));
    lay(board, ['0123012', '2301230', '0123012', '2341230', '4403012', '2341230', '0143012']);
    const waves = board.swap({ x: 2, y: 3 }, { x: 2, y: 2 })!;
    expect(waves[0]!.made[0]).toMatchObject({ x: 2, y: 2, gem: { power: 'burst' } });
  });

  it('a prism swapped with a jewel takes every jewel of that kind', () => {
    const board = new Board(new Rng(6));
    lay(board, QUIET, { '3,3': 'prism' });
    const kind = board.at(4, 3).kind;
    const count = board.cells.flat().filter((g) => g.kind === kind).length;
    const waves = board.swap({ x: 3, y: 3 }, { x: 4, y: 3 })!;
    expect(waves[0]!.cleared.filter((c) => c.gem.kind === kind)).toHaveLength(count);
    expect(waves[0]!.cleared.some((c) => c.gem.power === 'prism')).toBe(true);
  });

  it('only swaps neighbours', () => {
    expect(adjacent({ x: 1, y: 1 }, { x: 2, y: 1 })).toBe(true);
    expect(adjacent({ x: 1, y: 1 }, { x: 2, y: 2 })).toBe(false);
  });
});

const run = (level: number, seed: number, care: number): { won: boolean; left: number; stars: number; chain: number } => {
  const rng = new Rng(seed), game = new Game(LEVELS[level]!, new Rng(seed * 7 + 1));
  for (let i = 0; i < 200 && !game.over; i++) {
    const move = bestMove(game, rng, care)!;
    expect(move, 'there is always a move').not.toBeNull();
    const waves = game.play(move[0], move[1])!;
    expect(waves).not.toBeNull();
    expect(waves.length).toBeGreaterThan(0);
    expect(noLines(game.board)).toBe(true);
  }
  return { won: game.won, left: game.movesLeft, stars: game.stars, chain: game.bestChain };
};

describe('whole levels', () => {
  const tally = (level: number, care: number, games = 60): { wins: number; left: number; stars: number[] } => {
    let wins = 0, left = 0;
    const stars = [0, 0, 0, 0];
    for (let seed = 1; seed <= games; seed++) {
      const r = run(level, seed, care);
      if (r.won) wins++;
      left += r.left;
      stars[r.stars]!++;
    }
    return { wins: wins / games, left: left / games, stars };
  };
  const table = LEVELS.map((level, i) => {
    const careful = tally(i, 1), casual = tally(i, 0.4), careless = tally(i, 0);
    console.log(`${level.name}: careful wins ${Math.round(careful.wins * 100)}% (stars 0..3: ${careful.stars.join(' ')}; ${careful.left.toFixed(1)} moves to spare), casual ${Math.round(casual.wins * 100)}%, careless ${Math.round(careless.wins * 100)}%`);
    return { careful, casual, careless };
  });

  it('can be won by a careful player, with something to spare at first and less later', () => {
    expect(table[0]!.careful.wins).toBeGreaterThan(0.9);
    expect(table[1]!.careful.wins).toBeGreaterThan(0.8);
    expect(table[2]!.careful.wins).toBeGreaterThan(0.6);
    expect(table[0]!.careful.left).toBeGreaterThan(table[2]!.careful.left / LEVELS[2]!.moves * LEVELS[0]!.moves - 3);
  });

  it('are harder for a careless one, and harder each evening', () => {
    for (const row of table) expect(row.careless.wins).toBeLessThan(row.careful.wins);
    expect(table[2]!.careless.wins).toBeLessThan(0.5);
    expect(table[0]!.casual.wins).toBeGreaterThan(table[2]!.casual.wins);
  });

  it('give all three numbers of stars', () => {
    const stars = table.reduce((sum, row) => sum.map((n, i) => n + row.careful.stars[i]! + row.casual.stars[i]!), [0, 0, 0, 0]);
    for (const n of [1, 2, 3]) expect(stars[n]!, `${n} stars`).toBeGreaterThan(0);
  });
});
