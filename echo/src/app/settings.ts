import { clamp } from '../core/math';
import { detectTier, isTier, type Tier } from './quality';

export interface Settings {
  quality: Tier | 'auto';
  volume: number;
  autoAdvance: boolean;
  sensitivity: number;
  skin: number;
}

export const SKIN_TONES = [0xf2cdb0, 0xe0ac86, 0xc48a66, 0x9a6744, 0x6b4330] as const;

const KEY = 'echo-between-two-worlds/settings';
const DEFAULTS: Settings = { quality: 'auto', volume: 0.8, autoAdvance: true, sensitivity: 1, skin: 1 };

const numberIn = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;

export const loadSettings = (): Settings => {
  let saved: Partial<Record<keyof Settings, unknown>> = {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (parsed !== null && typeof parsed === 'object') saved = parsed;
  } catch {
  }
  const quality = saved.quality;
  return {
    quality: quality === 'auto' || (typeof quality === 'string' && isTier(quality)) ? quality : DEFAULTS.quality,
    volume: numberIn(saved.volume, DEFAULTS.volume, 0, 1),
    autoAdvance: typeof saved.autoAdvance === 'boolean' ? saved.autoAdvance : DEFAULTS.autoAdvance,
    sensitivity: numberIn(saved.sensitivity, DEFAULTS.sensitivity, 0.4, 2),
    skin: Math.round(numberIn(saved.skin, DEFAULTS.skin, 0, SKIN_TONES.length - 1)),
  };
};

export const saveSettings = (settings: Settings): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
  }
};

export const tierFor = (settings: Settings): Tier => (settings.quality === 'auto' ? detectTier() : settings.quality);
