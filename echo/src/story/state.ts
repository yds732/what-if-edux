import type { Policy } from './script';

export const CHAPTERS = ['monday', 'wednesday', 'thursday', 'friday'] as const;
export type ChapterId = (typeof CHAPTERS)[number];
export const isChapter = (v: string | null): v is ChapterId => v !== null && (CHAPTERS as readonly string[]).includes(v);

export interface StoryState {
  tuesdayChoice: 'meet' | 'haven' | null;
  thursdayChoice: 'help' | 'haven' | null;
  policyChoice: Policy | null;
  lumiGift: 'none' | 'asked' | 'carrying' | 'given';
  streak: number;
  streakBest: number;
  streakLost: boolean;
  streakBroke: boolean;
  leaveAsks: number;
  stayedOn: number;
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

export const saveProgress = (chapter: ChapterId, state: StoryState): void => {
  try {
    const save: Save = { version: 1, chapter, state: { ...state } };
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
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
  }
};
