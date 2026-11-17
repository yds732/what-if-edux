import type { Game } from '../../app/Game';
import type { ChapterId } from '../state';
import { friday } from './friday';
import { monday } from './monday';
import { thursday } from './thursday';
import { tuesday } from './tuesday';
import { wednesday } from './wednesday';

/** One async function per day; each leaves the picture faded out for the next. */
export const CHAPTER_RUNNERS: Record<ChapterId, (game: Game) => Promise<void>> = { monday, tuesday, wednesday, thursday, friday };
