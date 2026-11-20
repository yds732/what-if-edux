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
  lastHavenDay: ChapterId | null;
  streakBest: number;
  streakLost: boolean;
  streakBroke: boolean;
  leaveAsks: number;
  stayedOn: number;
  pings: number;
}

export const freshState = (): StoryState => ({
  tuesdayChoice: null, thursdayChoice: null, policyChoice: null, lumiGift: 'none',
  streak: 0, lastHavenDay: null, streakBest: 0, streakLost: false, streakBroke: false, leaveAsks: 0, stayedOn: 0, pings: 0,
});

const weekday = { monday: 1, wednesday: 3, thursday: 4, friday: 5 };

export const recordHavenVisit = (state: StoryState, day: ChapterId | null): boolean => {
  if (!day || state.lastHavenDay === day) return false;
  const yesterday = state.lastHavenDay && weekday[state.lastHavenDay] === weekday[day] - 1;
  state.streak = yesterday ? state.streak + 1 : 1;
  state.streakBest = Math.max(state.streakBest, state.streak);
  state.lastHavenDay = day;
  return true;
};

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
    const chapter = save.chapter as ChapterId;
    const state = { ...freshState(), ...save.state };
    if (save.state.lastHavenDay === undefined && state.streakBest > 0) {
      // Older chapter saves counted each visit, including Monday's return trip.
      state.lastHavenDay = chapter === 'friday' && state.thursdayChoice === 'haven' ? 'thursday'
        : chapter === 'friday' || chapter === 'thursday' ? 'wednesday' : 'monday';
      const longest = state.lastHavenDay === 'thursday' ? 2 : 1;
      state.streak = Math.min(state.streak, longest);
      state.streakBest = Math.min(state.streakBest, longest);
    }
    return { chapter, state };
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
