import type { Policy } from './script';

export const CHAPTERS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;
export type ChapterId = (typeof CHAPTERS)[number];
export const isChapter = (v: string | null): v is ChapterId => v !== null && (CHAPTERS as readonly string[]).includes(v);

/** The three decisions the script tracks. There is deliberately no score. */
export interface StoryState {
  tuesdayChoice: 'meet' | 'haven' | null;
  thursdayChoice: 'help' | 'haven' | null;
  policyChoice: Policy | null;
  /** Lumi's birthday present: not asked for yet, asked for, a gem in hand, or given. */
  lumiGift: 'none' | 'asked' | 'carrying' | 'given';
  // ---- what Haven does to keep the player, counted so the end can show it back to them. Not a score. ----
  /** Days in a row spent with Lumi, the best run, whether a break is still to be mentioned, and whether one ever happened. */
  streak: number;
  streakBest: number;
  streakLost: boolean;
  streakBroke: boolean;
  /** Times Lumi asked the player not to leave, and times the player stayed. */
  leaveAsks: number;
  stayedOn: number;
  /** Messages Haven sent into the bedroom. */
  pings: number;
}

export const freshState = (): StoryState => ({
  tuesdayChoice: null, thursdayChoice: null, policyChoice: null, lumiGift: 'none',
  streak: 0, streakBest: 0, streakLost: false, streakBroke: false, leaveAsks: 0, stayedOn: 0, pings: 0,
});

interface Save {
  readonly version: 1;
  readonly chapter: ChapterId;
  readonly state: StoryState;
}

const KEY = 'echo-between-two-worlds/save';

/** Progress is saved at the start of each day, so "Continue" resumes a week in progress. */
export const saveProgress = (chapter: ChapterId, state: StoryState): void => {
  try {
    const save: Save = { version: 1, chapter, state: { ...state } };
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // storage can be unavailable (private mode, embedded frames): the game simply does not offer Continue
  }
};

export const loadProgress = (): { chapter: ChapterId; state: StoryState } | null => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const save = JSON.parse(raw) as Partial<Save>;
    if (save.version !== 1 || !isChapter(save.chapter ?? null) || !save.state) return null;
    return { chapter: save.chapter as ChapterId, state: { ...freshState(), ...save.state } };
  } catch {
    return null;
  }
};

export const clearProgress = (): void => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
};
