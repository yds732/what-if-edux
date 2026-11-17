import type { CharacterSpec } from './Character';

/**
 * Everyone in the story. What each of them looks like is their generated figure (see assets/catalog.mjs); here
 * is how the face drawn on that figure looks and rests, and for Haven's companions the colour of their light.
 */
export const CAST = {
  teacher: { name: 'Teacher', face: { browColor: 0x2a1c18, eyeScale: 0.92 }, rest: { mouthSmile: 0.45, blush: 0.15 } },
  jamie: { name: 'Jamie', face: { browColor: 0x55392a }, rest: { mouthSmile: 0.4, blush: 0.3 } },
  lumi: { name: 'Lumi', aura: 0x6fe6ff, face: { eyeColor: 0x1d1a40, browColor: 0xb9b6cf, glintColor: 0xbff3ff, eyeScale: 1.08 }, rest: { mouthSmile: 0.75, blush: 0.45, eyeSmile: 0.1 } },
  kai: { name: 'Kai', aura: 0xffc063, face: { eyeColor: 0x1a1210, browColor: 0x241a1c, glintColor: 0xffe6b8 }, rest: { mouthSmile: 0.7, blush: 0.2 } },
  nova: { name: 'Nova', aura: 0xff7fd8, face: { eyeColor: 0x2a1626, browColor: 0x5e3a2c, glintColor: 0xffd0f2 }, rest: { mouthSmile: 0.7, blush: 0.4 } },
  // ---- classmates ----
  priya: { name: 'Priya', face: { browColor: 0x1d1512 } },
  theo: { name: 'Theo', face: { browColor: 0x9a6a36 } },
  amara: { name: 'Amara', face: { browColor: 0x18110f } },
  yusra: { name: 'Yusra', face: { browColor: 0x33251e } },
  leo: { name: 'Leo', face: { browColor: 0x1c1a20 } },
  mina: { name: 'Mina', face: { browColor: 0x2b2026 } },
  // ---- the three voices of the Friday consultation ----
  alex: { name: 'Alex', face: { browColor: 0x3a2a22 }, rest: { mouthSmile: 0.15 } },
  sam: { name: 'Sam', face: { browColor: 0x1a1312 }, rest: { mouthSmile: 0.1 } },
  riley: { name: 'Riley', face: { browColor: 0x8a4122 }, rest: { mouthSmile: 0.5 } },
} satisfies Record<string, CharacterSpec>;

export type CastName = keyof typeof CAST;
export const isCastName = (v: string): v is CastName => v in CAST;
