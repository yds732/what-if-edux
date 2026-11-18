import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/math';
import { Battle, MAX_SPARK, PAIRS, SPRITES, SPRITE_IDS, STRONG, WEAK, chooseAction, chooseReplacement, effectiveness, expectedDamage, restOf, type Action, type BattleEvent, type Side, type SpriteId } from '../../src/arcade/sprites/battle';

const move = (index: 0 | 1 | 2): Action => ({ kind: 'move', index });
const of = <T extends BattleEvent['type']>(events: BattleEvent[], type: T): Extract<BattleEvent, { type: T }>[] => events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);

describe('the elements', () => {
  it('chase each other round: ember burns bloom, bloom drinks tide, tide douses ember', () => {
    expect(effectiveness('ember', 'bloom')).toBe(STRONG);
    expect(effectiveness('bloom', 'tide')).toBe(STRONG);
    expect(effectiveness('tide', 'ember')).toBe(STRONG);
    expect(effectiveness('bloom', 'ember')).toBe(WEAK);
    expect(effectiveness('ember', 'ember')).toBe(1);
    expect(effectiveness(null, 'tide')).toBe(1);
  });

  it('are shared two apiece among the six sprites', () => {
    for (const element of ['ember', 'tide', 'bloom']) expect(SPRITE_IDS.filter((id) => SPRITES[id].element === element)).toHaveLength(2);
    for (const id of SPRITE_IDS) {
      const [plain, own, special] = SPRITES[id].moves;
      expect(plain.cost).toBe(0);
      expect(plain.element).toBeNull();
      expect(own.element).toBe(SPRITES[id].element);
      expect(own.cost).toBe(1);
      expect(special.cost).toBe(2);
    }
  });
});

describe('a round', () => {
  it('lets the faster sprite strike first, and a fainted sprite does not strike back', () => {
    // Petalwing (speed 32) against Tufflet (speed 10)
    const battle = new Battle(['petalwing', 'cindle', 'nimbray'], ['tufflet', 'kilnip', 'dewbell'], new Rng(1));
    const events = battle.round(move(0), move(0));
    const moves = of(events, 'move');
    expect(moves.map((m) => m.side)).toEqual(['you', 'foe']);
    battle.out('you').hp = 1;
    battle.out('foe').hp = 1;
    const last = battle.round(move(0), move(0));
    expect(of(last, 'faint').map((f) => f.side)).toEqual(['foe']);
    expect(of(last, 'move')).toHaveLength(1);
  });

  it('hits harder with the right element and softer with the wrong one', () => {
    const battle = new Battle(['cindle', 'nimbray', 'petalwing'], ['petalwing', 'cindle', 'nimbray'], new Rng(2));
    const cindle = battle.out('you'), petalwing = battle.out('foe');
    const strong = expectedDamage(cindle, cindle.sprite.moves[1], petalwing);
    const backwards = expectedDamage(petalwing, petalwing.sprite.moves[1], cindle);
    const plain = expectedDamage(cindle, cindle.sprite.moves[0], petalwing);
    expect(strong).toBeGreaterThan(plain * 1.8);
    expect(backwards).toBeLessThan(strong * 0.5);
  });

  it('spends sparks, refuses a move that cannot be paid for, and gathers one a round', () => {
    const battle = new Battle(['cindle', 'nimbray', 'petalwing'], ['tufflet', 'kilnip', 'dewbell'], new Rng(3));
    expect(battle.out('you').spark).toBe(1);
    expect(battle.legal('you', move(2))).toBe(false);
    expect(() => battle.round(move(2), move(0))).toThrow();
    battle.round(move(0), move(0));
    expect(battle.out('you').spark).toBe(2);
    battle.round(move(2), move(0));
    // two spent, one gathered
    expect(battle.out('you').spark).toBe(1);
    for (let i = 0; i < 6 && !battle.winner && !battle.needsReplacement('you') && !battle.needsReplacement('foe'); i++) battle.round(move(0), move(0));
    expect(battle.out('you').spark).toBeLessThanOrEqual(MAX_SPARK);
  });

  it('brings a sprite in before anything is thrown, so the newcomer takes the hit', () => {
    const battle = new Battle(['cindle', 'tufflet', 'nimbray'], ['nimbray', 'kilnip', 'dewbell'], new Rng(4));
    const events = battle.round({ kind: 'switch', to: 1 }, move(1));
    expect(events[0]).toMatchObject({ type: 'switch', side: 'you', from: 0, to: 1 });
    expect(battle.out('you').sprite.id).toBe('tufflet');
    expect(of(events, 'damage')[0]!.side).toBe('you');
    expect(battle.teams.you[0]!.hp).toBe(SPRITES.cindle.hp);
    expect(battle.out('you').hp).toBeLessThan(SPRITES.tufflet.hp);
  });

  it('halves damage behind a shell, mends with rain, and smoulders with a scorch', () => {
    const battle = new Battle(['kilnip', 'dewbell', 'cindle'], ['nimbray', 'tufflet', 'petalwing'], new Rng(5));
    const kilnip = battle.out('you'), nimbray = battle.out('foe');
    const open = expectedDamage(nimbray, nimbray.sprite.moves[1], kilnip);
    kilnip.spark = 2;
    const events = battle.round(move(2), move(0));
    expect(of(events, 'status').some((s) => s.status === 'shield' && s.on && s.side === 'you')).toBe(true);
    expect(expectedDamage(nimbray, nimbray.sprite.moves[1], kilnip)).toBeCloseTo(open / 2, 5);

    const rain = new Battle(['dewbell', 'kilnip', 'cindle'], ['tufflet', 'nimbray', 'petalwing'], new Rng(6));
    rain.out('you').hp = 20;
    rain.out('you').spark = 2;
    rain.out('you').status.scorch = 3;
    const mended = rain.round(move(2), move(0));
    expect(of(mended, 'heal')[0]!.amount).toBe(Math.round(SPRITES.dewbell.hp * 0.45));
    expect(rain.out('you').status.scorch).toBe(0);

    const scorched = new Battle(['tufflet', 'kilnip', 'cindle'], ['dewbell', 'nimbray', 'petalwing'], new Rng(7));
    scorched.out('foe').status.scorch = 2;
    const before = scorched.out('foe').hp;
    const burning = scorched.round(move(0), move(0));
    expect(of(burning, 'scorch')).toHaveLength(1);
    expect(scorched.out('foe').hp).toBeLessThan(before - 7);
  });

  it('asks for a replacement when a sprite falls, and ends when a whole side has', () => {
    const battle = new Battle(['cindle', 'tufflet', 'nimbray'], ['petalwing', 'kilnip', 'dewbell'], new Rng(8));
    battle.out('foe').hp = 1;
    battle.round(move(0), move(0));
    expect(battle.needsReplacement('foe')).toBe(true);
    expect(battle.legal('you', move(0))).toBe(false);
    const to = chooseReplacement(battle, 'foe', new Rng(1));
    expect(battle.replace('foe', to)[0]).toMatchObject({ type: 'switch', side: 'foe', to });
    expect(battle.needsReplacement('foe')).toBe(false);
    for (const f of battle.teams.foe) f.hp = 1;
    for (let i = 0; i < 6 && !battle.winner; i++) {
      battle.round(move(0), move(0));
      if (battle.needsReplacement('foe') && battle.bench('foe').length) battle.replace('foe', battle.bench('foe')[0]!);
      if (battle.needsReplacement('you') && battle.bench('you').length) battle.replace('you', battle.bench('you')[0]!);
    }
    expect(battle.winner).toBe('you');
  });
});

/** Plays a whole duel between two ways of choosing, and says who won and in how many rounds. */
const duel = (team: SpriteId[], seed: number, you: (b: Battle, rng: Rng) => Action, skill: number): { winner: Side; rounds: number } => {
  const rng = new Rng(seed), battle = new Battle(team, restOf(team), new Rng(seed + 1));
  for (let i = 0; i < 200 && !battle.winner; i++) {
    battle.round(you(battle, rng), chooseAction(battle, 'foe', rng, skill));
    for (const side of ['you', 'foe'] as const) if (battle.needsReplacement(side)) battle.replace(side, chooseReplacement(battle, side, rng));
  }
  expect(battle.winner, 'every duel ends').not.toBeNull();
  return { winner: battle.winner!, rounds: battle.rounds };
};

describe('whole duels', () => {
  // a team is one sprite of each element: eight teams, each facing the three it left behind
  const TEAMS: SpriteId[][] = PAIRS.ember.flatMap((e) => PAIRS.tide.flatMap((w) => PAIRS.bloom.map((b) => [e, w, b])));
  const careful = (b: Battle, rng: Rng): Action => chooseAction(b, 'you', rng, 1);
  const careless = (b: Battle, rng: Rng): Action => rng.pick(b.options('you'));
  const tally = (you: (b: Battle, rng: Rng) => Action, skill: number): { wins: number; games: number; rounds: number } => {
    let wins = 0, games = 0, rounds = 0;
    for (const team of TEAMS) for (let seed = 0; seed < 24; seed++) {
      const d = duel(team, seed * 31 + 5, you, skill);
      games++;
      rounds += d.rounds;
      if (d.winner === 'you') wins++;
    }
    return { wins, games, rounds: rounds / games };
  };

  it('always end, in a sensible number of rounds', () => {
    const t = tally(careful, 0.6);
    console.log(`careful player against Nova at 0.6: ${t.wins}/${t.games}, ${t.rounds.toFixed(1)} rounds a duel`);
    expect(t.rounds).toBeGreaterThan(8);
    expect(t.rounds).toBeLessThan(28);
  });

  it('reward thought: a careful player beats a careless Nova, and loses more to a careful one', () => {
    const easy = tally(careful, 0), even = tally(careful, 1), random = tally(careless, 1);
    console.log(`careful against careless Nova: ${easy.wins}/${easy.games}; against careful Nova: ${even.wins}/${even.games}; careless player against careful Nova: ${random.wins}/${random.games}`);
    expect(easy.wins / easy.games).toBeGreaterThan(0.7);
    expect(even.wins / even.games).toBeGreaterThan(0.3);
    expect(even.wins / even.games).toBeLessThan(0.7);
    expect(random.wins / random.games).toBeLessThan(0.3);
  });

  it('do not turn on which three sprites were picked', () => {
    const share: Record<string, number> = Object.fromEntries(SPRITE_IDS.map((id) => [id, 0]));
    const GAMES = 80;
    const results = TEAMS.map((team) => {
      let won = 0;
      for (let seed = 0; seed < GAMES; seed++) if (duel(team, seed * 17 + 3, careful, 1).winner === 'you') won++;
      for (const id of team) share[id]! += won;
      console.log(`${team.join(', ')} v ${restOf(team).join(', ')}: ${won}/${GAMES}`);
      return won / GAMES;
    });
    console.log('how often a team with each sprite wins: ' + SPRITE_IDS.map((id) => `${id} ${Math.round((100 * share[id]!) / (GAMES * 4))}%`).join(', '));
    // no sprite carries a team or sinks one, and no choice of team is a foregone conclusion
    for (const id of SPRITE_IDS) {
      expect(share[id]! / (GAMES * 4), id).toBeGreaterThan(0.4);
      expect(share[id]! / (GAMES * 4), id).toBeLessThan(0.6);
    }
    for (const rate of results) {
      expect(rate).toBeGreaterThan(0.3);
      expect(rate).toBeLessThan(0.7);
    }
  });
});
