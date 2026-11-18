import type { Rng } from '../../core/math';

export const SIZE = 7;
export type Kind = number;
export const PRISM: Kind = -1;
export type Power = 'none' | 'beamH' | 'beamV' | 'burst' | 'prism';

export interface Gem {
  readonly id: number;
  readonly kind: Kind;
  readonly power: Power;
}

export interface At {
  readonly x: number;
  readonly y: number;
}

export interface Wave {
  readonly chain: number;
  readonly cleared: readonly (At & { readonly gem: Gem; readonly by: 'match' | 'beam' | 'burst' | 'prism' })[];
  readonly fired: readonly (At & { readonly power: Power; readonly kind: Kind })[];
  readonly made: readonly (At & { readonly gem: Gem })[];
  readonly falls: readonly { readonly gem: Gem; readonly x: number; readonly fromY: number; readonly toY: number }[];
}

const key = (x: number, y: number): number => y * SIZE + x;
const inside = (x: number, y: number): boolean => x >= 0 && x < SIZE && y >= 0 && y < SIZE;
export const adjacent = (a: At, b: At): boolean => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

interface Run {
  readonly cells: At[];
  readonly horizontal: boolean;
  readonly kind: Kind;
}

export class Board {
  readonly cells: Gem[][] = [];
  private nextId = 1;

  constructor(private readonly rng: Rng, readonly kinds = 5) {
    this.fill();
  }

  at(x: number, y: number): Gem {
    return this.cells[x]![y]!;
  }

  private gem(kind: Kind, power: Power = 'none'): Gem {
    return { id: this.nextId++, kind, power };
  }

  fill(): void {
    do {
      for (let x = 0; x < SIZE; x++) {
        this.cells[x] = [];
        for (let y = 0; y < SIZE; y++) {
          let kind: Kind;
          do kind = this.rng.int(0, this.kinds - 1);
          while ((x >= 2 && this.cells[x - 1]![y]!.kind === kind && this.cells[x - 2]![y]!.kind === kind) || (y >= 2 && this.cells[x]![y - 1]!.kind === kind && this.cells[x]![y - 2]!.kind === kind));
          this.cells[x]![y] = this.gem(kind);
        }
      }
    } while (!this.findMove());
  }

  private runs(): Run[] {
    const found: Run[] = [];
    for (const horizontal of [true, false]) {
      for (let line = 0; line < SIZE; line++) {
        let start = 0;
        for (let i = 1; i <= SIZE; i++) {
          const kind = (n: number): Kind => (horizontal ? this.cells[n]![line]! : this.cells[line]![n]!).kind;
          if (i < SIZE && kind(i) === kind(start) && kind(start) !== PRISM) continue;
          if (i - start >= 3 && kind(start) !== PRISM) {
            const cells: At[] = [];
            for (let n = start; n < i; n++) cells.push(horizontal ? { x: n, y: line } : { x: line, y: n });
            found.push({ cells, horizontal, kind: kind(start) });
          }
          start = i;
        }
      }
    }
    return found;
  }

  private swapCells(a: At, b: At): void {
    const t = this.cells[a.x]![a.y]!;
    this.cells[a.x]![a.y] = this.cells[b.x]![b.y]!;
    this.cells[b.x]![b.y] = t;
  }

  canSwap(a: At, b: At): boolean {
    if (!inside(a.x, a.y) || !inside(b.x, b.y) || !adjacent(a, b)) return false;
    if (this.at(a.x, a.y).power === 'prism' || this.at(b.x, b.y).power === 'prism') return true;
    this.swapCells(a, b);
    const made = this.runs().length > 0;
    this.swapCells(a, b);
    return made;
  }

  findMove(): [At, At] | null {
    for (let x = 0; x < SIZE; x++) for (let y = 0; y < SIZE; y++) {
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        const a = { x, y }, b = { x: x + dx, y: y + dy };
        if (this.canSwap(a, b)) return [a, b];
      }
    }
    return null;
  }

  moves(): [At, At][] {
    const all: [At, At][] = [];
    for (let x = 0; x < SIZE; x++) for (let y = 0; y < SIZE; y++) {
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        const a = { x, y }, b = { x: x + dx, y: y + dy };
        if (this.canSwap(a, b)) all.push([a, b]);
      }
    }
    return all;
  }

  shuffle(): void {
    const all = this.cells.flat();
    do {
      for (let i = all.length - 1; i > 0; i--) {
        const j = this.rng.int(0, i), t = all[i]!;
        all[i] = all[j]!;
        all[j] = t;
      }
      all.forEach((gem, i) => (this.cells[i % SIZE]![Math.floor(i / SIZE)] = gem));
    } while (this.runs().length > 0 || !this.findMove());
  }

  swap(a: At, b: At): Wave[] | null {
    if (!this.canSwap(a, b)) return null;
    const ga = this.at(a.x, a.y), gb = this.at(b.x, b.y);
    this.swapCells(a, b);
    const waves: Wave[] = [];
    if (ga.power === 'prism' || gb.power === 'prism') {
      const prismAt = ga.power === 'prism' ? b : a, other = ga.power === 'prism' ? gb : ga;
      const start = new Map<number, 'match' | 'beam' | 'burst' | 'prism'>([[key(prismAt.x, prismAt.y), 'prism']]);
      for (let x = 0; x < SIZE; x++) for (let y = 0; y < SIZE; y++) if (other.power === 'prism' || this.at(x, y).kind === other.kind) start.set(key(x, y), 'prism');
      waves.push(this.resolve(start, [], 1, [{ ...prismAt, power: 'prism', kind: other.kind }]));
    }
    for (let chain = waves.length + 1; ; chain++) {
      const runs = this.runs();
      if (runs.length === 0) break;
      const cleared = new Map<number, 'match' | 'beam' | 'burst' | 'prism'>();
      for (const run of runs) for (const c of run.cells) cleared.set(key(c.x, c.y), 'match');
      waves.push(this.resolve(cleared, this.powersFrom(runs, chain === 1 ? [b, a] : []), chain, []));
    }
    return waves;
  }

  private powersFrom(runs: Run[], moved: At[]): (At & { power: Power; kind: Kind })[] {
    const made: (At & { power: Power; kind: Kind })[] = [];
    const used = new Set<Run>();
    const place = (cells: At[]): At => moved.find((m) => cells.some((c) => c.x === m.x && c.y === m.y)) ?? cells[Math.floor(cells.length / 2)]!;
    for (const h of runs.filter((r) => r.horizontal)) {
      for (const v of runs.filter((r) => !r.horizontal && r.kind === h.kind)) {
        const cross = h.cells.find((c) => v.cells.some((d) => d.x === c.x && d.y === c.y));
        if (!cross || used.has(h) || used.has(v)) continue;
        used.add(h).add(v);
        made.push({ ...cross, power: h.cells.length >= 5 || v.cells.length >= 5 ? 'prism' : 'burst', kind: h.kind });
      }
    }
    for (const run of runs) {
      if (used.has(run) || run.cells.length < 4) continue;
      const at = place(run.cells);
      made.push({ ...at, power: run.cells.length >= 5 ? 'prism' : run.horizontal ? 'beamH' : 'beamV', kind: run.kind });
    }
    return made;
  }

  private resolve(start: Map<number, 'match' | 'beam' | 'burst' | 'prism'>, powers: (At & { power: Power; kind: Kind })[], chain: number, firedAlready: (At & { power: Power; kind: Kind })[]): Wave {
    const cleared = new Map(start);
    const fired: (At & { power: Power; kind: Kind })[] = [...firedAlready];
    const done = new Set<number>(firedAlready.map((f) => key(f.x, f.y)));
    for (let again = true; again; ) {
      again = false;
      for (const [k] of [...cleared]) {
        const x = k % SIZE, y = Math.floor(k / SIZE), gem = this.at(x, y);
        if (gem.power === 'none' || done.has(k)) continue;
        done.add(k);
        again = true;
        const add = (cx: number, cy: number, by: 'beam' | 'burst' | 'prism'): void => {
          if (inside(cx, cy) && !cleared.has(key(cx, cy))) cleared.set(key(cx, cy), by);
        };
        let kind = gem.kind;
        if (gem.power === 'beamH') for (let i = 0; i < SIZE; i++) add(i, y, 'beam');
        else if (gem.power === 'beamV') for (let i = 0; i < SIZE; i++) add(x, i, 'beam');
        else if (gem.power === 'burst') for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) add(x + dx, y + dy, 'burst');
        else {
          const counts = new Map<Kind, number>();
          for (const g of this.cells.flat()) if (g.kind !== PRISM) counts.set(g.kind, (counts.get(g.kind) ?? 0) + 1);
          kind = [...counts].sort((p, q) => q[1] - p[1])[0]?.[0] ?? 0;
          for (let cx = 0; cx < SIZE; cx++) for (let cy = 0; cy < SIZE; cy++) if (this.at(cx, cy).kind === kind) add(cx, cy, 'prism');
        }
        fired.push({ x, y, power: gem.power, kind });
      }
    }

    const gone = [...cleared].map(([k, by]) => ({ x: k % SIZE, y: Math.floor(k / SIZE), gem: this.at(k % SIZE, Math.floor(k / SIZE)), by }));
    const made = powers.map((p) => ({ x: p.x, y: p.y, gem: this.gem(p.power === 'prism' ? PRISM : p.kind, p.power) }));
    const keep = new Map(made.map((m) => [key(m.x, m.y), m.gem]));

    const falls: { gem: Gem; x: number; fromY: number; toY: number }[] = [];
    for (let x = 0; x < SIZE; x++) {
      const column: { gem: Gem; fromY: number }[] = [];
      for (let y = 0; y < SIZE; y++) {
        const k = key(x, y), replaced = keep.get(k);
        if (replaced) column.push({ gem: replaced, fromY: y });
        else if (!cleared.has(k)) column.push({ gem: this.at(x, y), fromY: y });
      }
      for (let n = 0; column.length < SIZE; n++) column.push({ gem: this.gem(this.rng.int(0, this.kinds - 1)), fromY: SIZE + n });
      column.forEach((c, y) => {
        this.cells[x]![y] = c.gem;
        if (c.fromY !== y) falls.push({ gem: c.gem, x, fromY: c.fromY, toY: y });
      });
    }
    return { chain, cleared: gone, fired, made, falls };
  }
}

export interface Goal {
  readonly kind: Kind;
  readonly count: number;
}

export interface Level {
  readonly name: string;
  readonly moves: number;
  readonly goals: readonly Goal[];
}

export const LEVELS: readonly Level[] = [
  { name: 'First Light', moves: 14, goals: [{ kind: 2, count: 14 }, { kind: 3, count: 14 }, { kind: 4, count: 14 }] },
  { name: 'Evening', moves: 17, goals: [{ kind: 0, count: 20 }, { kind: 1, count: 20 }, { kind: 2, count: 20 }, { kind: 3, count: 20 }] },
  { name: 'Festival', moves: 20, goals: [{ kind: 0, count: 27 }, { kind: 1, count: 27 }, { kind: 2, count: 27 }, { kind: 3, count: 27 }, { kind: 4, count: 27 }] },
];

export class Game {
  readonly board: Board;
  movesLeft: number;
  readonly gathered: number[];
  bestChain = 0;

  constructor(readonly level: Level, rng: Rng) {
    this.board = new Board(rng);
    this.movesLeft = level.moves;
    this.gathered = level.goals.map(() => 0);
  }

  get won(): boolean {
    return this.level.goals.every((g, i) => this.gathered[i]! >= g.count);
  }

  get over(): boolean {
    return this.won || this.movesLeft <= 0;
  }

  play(a: At, b: At): Wave[] | null {
    if (this.over) return null;
    const waves = this.board.swap(a, b);
    if (!waves) return null;
    this.movesLeft--;
    for (const wave of waves) {
      this.bestChain = Math.max(this.bestChain, wave.chain);
      for (const c of wave.cleared) {
        const i = this.level.goals.findIndex((g) => g.kind === c.gem.kind);
        if (i >= 0) this.gathered[i] = Math.min(this.level.goals[i]!.count, this.gathered[i]! + 1);
      }
    }
    if (!this.board.findMove()) this.board.shuffle();
    return waves;
  }

  get stars(): 0 | 1 | 2 | 3 {
    if (!this.won) return 0;
    const spare = this.movesLeft / this.level.moves;
    return spare >= 0.28 ? 3 : spare >= 0.1 ? 2 : 1;
  }
}

export const bestMove = (game: Game, rng: Rng, care = 1): [At, At] | null => {
  const moves = game.board.moves();
  if (moves.length === 0) return null;
  if (!rng.chance(care)) return rng.pick(moves);
  const need = new Set(game.level.goals.filter((g, i) => game.gathered[i]! < g.count).map((g) => g.kind));
  let best = moves[0]!, bestScore = -1;
  for (const move of moves) {
    const [a, b] = move, ga = game.board.at(a.x, a.y), gb = game.board.at(b.x, b.y);
    let score = ga.power !== 'none' || gb.power !== 'none' ? 6 : 0;
    for (const [at, gem] of [[b, ga], [a, gb]] as const) {
      if (gem.kind === PRISM) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        let run = 1;
        for (const s of [-1, 1]) {
          for (let n = 1; n < SIZE; n++) {
            const x = at.x + dx * n * s, y = at.y + dy * n * s;
            if (!inside(x, y)) break;
            const there = x === a.x && y === a.y ? gb : x === b.x && y === b.y ? ga : game.board.at(x, y);
            if (there.kind !== gem.kind) break;
            run++;
          }
        }
        if (run >= 3) score += (need.has(gem.kind) ? 3 : 1) * run + (run >= 4 ? 5 : 0);
      }
    }
    score += rng.range(0, 0.5);
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
};
