import type { Game } from '../../app/Game';
import type { ChapterId } from '../state';
import { friday } from './friday';
import { monday } from './monday';
import { thursday } from './thursday';
import { tuesday } from './tuesday';
import { wednesday } from './wednesday';

export const CHAPTER_RUNNERS: Record<ChapterId, (game: Game) => Promise<void>> = { monday, tuesday, wednesday, thursday, friday };
