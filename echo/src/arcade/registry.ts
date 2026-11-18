import type { Minigame } from './Minigame';

export const MINIGAME_IDS = ['rally', 'sprites', 'lanterns', 'drift', 'duskbreak'] as const;
export type MinigameId = (typeof MINIGAME_IDS)[number];
export const isMinigame = (v: string | null): v is MinigameId => v !== null && (MINIGAME_IDS as readonly string[]).includes(v);

export interface MinigameInfo {
  readonly title: string;
  /** One line under the title, on the card that opens the game and on its portal. */
  readonly tagline: string;
  /** The light of its portal, and the colour the picture goes through on the way in and out. */
  readonly color: number;
  /** Who keeps the game: they stand by its portal on the arcade isle. */
  readonly keeper: 'lumi' | 'kai' | 'nova';
  /** Fetches the game's code and makes its world. A game still being built has none, and its portal stays shut. */
  readonly load?: () => Promise<Minigame>;
}

/**
 * The games behind the five portals on Haven's arcade isle, in the order the portals stand. Each is its own module,
 * fetched (with its models) the first time its portal is entered.
 */
export const MINIGAMES: Record<MinigameId, MinigameInfo> = {
  rally: {
    title: 'Moonlight Rally', tagline: 'Table tennis with Kai, first to seven', color: 0xffb24a, keeper: 'kai',
    load: async () => new (await import('./rally/RallyWorld')).RallyWorld(),
  },
  sprites: {
    title: 'Sprite Duel', tagline: 'Three of Haven\'s sprites against Nova\'s', color: 0xff6fc8, keeper: 'nova',
    load: async () => new (await import('./sprites/SpriteWorld')).SpriteWorld(),
  },
  lanterns: {
    title: 'Lantern Lights', tagline: 'Line up the jewels, light the lanterns', color: 0x3fe0a0, keeper: 'lumi',
    load: async () => new (await import('./lanterns/LanternWorld')).LanternWorld(),
  },
  drift: {
    title: 'Driftlight', tagline: 'A raft, the tide, and a lighthouse to reach', color: 0x4fc8ff, keeper: 'lumi',
    load: async () => new (await import('./drift/DriftWorld')).DriftWorld(),
  },
  duskbreak: {
    title: 'Duskbreak', tagline: 'Lead the lantern sprites through the gloom', color: 0x9a6bff, keeper: 'lumi',
    load: async () => new (await import('./dusk/DuskWorld')).DuskWorld(),
  },
};
