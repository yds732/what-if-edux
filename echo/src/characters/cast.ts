import type { CharacterSpec } from './Character';

/**
 * Everyone in the story. What each of them looks like is their generated figure (see assets/catalog.mjs); here
 * is how the face drawn on that figure looks and rests, and for Haven's companions the colour of their light.
 *
 * All faces share one calm, natural style (see head.ts), set from Leo: brown eyes, straight dark brows, a closed
 * mouth with the faintest smile. Everyone else is a small step from him: their own eye and brow colour, a resting
 * mouth a touch warmer or more reserved. Haven's companions rest a little warmer still, but in the same style.
 */
export const CAST = {
  teacher: { name: 'Teacher', face: { eyeColor: 0x4a3122, browColor: 0x2a1c18, eyeScale: 0.94 }, rest: { mouthSmile: 0.32, mouthWidth: 1.05 } },
  jamie: { name: 'Jamie', face: { eyeColor: 0x5a4128, browColor: 0x55392a }, rest: { mouthSmile: 0.25 } },
  lumi: { name: 'Lumi', aura: 0x6fe6ff, face: { eyeColor: 0x4f86ad, browColor: 0xb9b6cf, glintColor: 0xbff3ff, eyeScale: 1.04 }, rest: { mouthSmile: 0.4, blush: 0.08 } },
  kai: { name: 'Kai', aura: 0xffc063, face: { eyeColor: 0x5e3a1a, browColor: 0x241a1c, glintColor: 0xffe6b8 }, rest: { mouthSmile: 0.38, mouthWidth: 1.05, blush: 0.05 } },
  nova: { name: 'Nova', aura: 0xff7fd8, face: { eyeColor: 0x5e3a50, browColor: 0x5e3a2c, glintColor: 0xffd0f2 }, rest: { mouthSmile: 0.38, blush: 0.08 } },
  // ---- classmates ----
  priya: { name: 'Priya', face: { eyeColor: 0x3a2416, browColor: 0x1d1512 }, rest: { mouthSmile: 0.28, mouthWidth: 0.95 } },
  theo: { name: 'Theo', face: { eyeColor: 0x4a6a84, browColor: 0x9a6a36 }, rest: { mouthSmile: 0.3 } },
  amara: { name: 'Amara', face: { eyeColor: 0x2e1c12, browColor: 0x18110f }, rest: { mouthSmile: 0.22, mouthWidth: 1.04 } },
  yusra: { name: 'Yusra', face: { eyeColor: 0x553a22, browColor: 0x33251e }, rest: { mouthSmile: 0.2, mouthWidth: 0.94 } },
  // the baseline face
  leo: { name: 'Leo', face: { eyeColor: 0x3f2618, browColor: 0x1c1a20 }, rest: { mouthSmile: 0.25 } },
  mina: { name: 'Mina', face: { eyeColor: 0x382416, browColor: 0x2b2026 }, rest: { mouthSmile: 0.22, mouthWidth: 0.92 } },
  // ---- the three voices of the Friday consultation ----
  alex: { name: 'Alex', face: { eyeColor: 0x4f5a3a, browColor: 0x3a2a22 }, rest: { mouthSmile: 0.18 } },
  sam: { name: 'Sam', face: { eyeColor: 0x2e1e14, browColor: 0x1a1312 }, rest: { mouthSmile: 0.12, mouthWidth: 0.95 } },
  riley: { name: 'Riley', face: { eyeColor: 0x4a6a8a, browColor: 0x8a4122 }, rest: { mouthSmile: 0.35 } },
} satisfies Record<string, CharacterSpec>;

export type CastName = keyof typeof CAST;
export const isCastName = (v: string): v is CastName => v in CAST;
