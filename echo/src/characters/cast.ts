import type { CharacterSpec } from './Character';
import { ADULT, KID, type Proportions } from './skeleton';

const kid = (o: Partial<Proportions> = {}): Proportions => ({ ...KID, ...o });

/**
 * Everyone in the story. Real-world people wear matte, lived-in colours; Haven's companions are pale, luminous
 * and a little too perfect.
 */
export const CAST = {
  teacher: {
    name: 'Teacher', proportions: ADULT, skin: 0xb98060,
    hair: { style: 'bun', color: 0x2a1c18, seed: 11 },
    outfit: { top: 'sweater', topColor: 0x4f7d78, accentColor: 0xf2ede4, bottom: 'skirt', bottomColor: 0x2c3352, shoeColor: 0x3d2f2a, lanyardColor: 0xe0703f },
    face: { browColor: 0x2a1c18, eyeScale: 0.92 }, rest: { mouthSmile: 0.45, blush: 0.15 },
  },
  jamie: {
    name: 'Jamie', proportions: kid(), skin: 0xedbe98,
    hair: { style: 'messy', color: 0x6a4630, seed: 3 },
    outfit: { top: 'hoodie', topColor: 0x8a94a6, accentColor: 0xe9e6e0, bottom: 'trousers', bottomColor: 0x2e3650, shoeColor: 0x4a6fa8 },
    face: { browColor: 0x55392a }, rest: { mouthSmile: 0.4, blush: 0.3 },
  },
  lumi: {
    name: 'Lumi', proportions: kid({ build: 0.97 }), skin: 0xf8e6dc, luminous: true,
    hair: { style: 'softBob', color: 0xe6e4f2, tipColor: 0x9fdcff, seed: 5 },
    outfit: { top: 'hoodie', topColor: 0xf1f0f7, accentColor: 0xcfd0ea, bottom: 'trousers', bottomColor: 0xd5d5ea, shoeColor: 0xe9e9f6, trimColor: 0x6fe6ff },
    face: { eyeColor: 0x1d1a40, browColor: 0xb9b6cf, glintColor: 0xbff3ff, eyeScale: 1.08 }, rest: { mouthSmile: 0.75, blush: 0.45, eyeSmile: 0.1 },
  },
  kai: {
    name: 'Kai', proportions: kid({ build: 1.04 }), skin: 0x7d5038, luminous: true,
    hair: { style: 'curls', color: 0x241a1c, tipColor: 0xffc978, seed: 9 },
    outfit: { top: 'hoodie', topColor: 0xeeecf4, accentColor: 0xd9d4e6, bottom: 'trousers', bottomColor: 0x4a4c6a, shoeColor: 0xe9e9f6, trimColor: 0xffc063 },
    face: { eyeColor: 0x1a1210, browColor: 0x241a1c, glintColor: 0xffe6b8 }, rest: { mouthSmile: 0.7, blush: 0.2 },
  },
  nova: {
    name: 'Nova', proportions: kid({ build: 0.96 }), skin: 0xdaa67e, luminous: true,
    hair: { style: 'longWavy', color: 0x744734, tipColor: 0xff9fdc, seed: 13 },
    outfit: { top: 'hoodie', topColor: 0xf0ecf8, accentColor: 0xd8cfee, bottom: 'trousers', bottomColor: 0xcfc8e6, shoeColor: 0xe9e9f6, trimColor: 0xff7fd8 },
    face: { eyeColor: 0x2a1626, browColor: 0x5e3a2c, glintColor: 0xffd0f2 }, rest: { mouthSmile: 0.7, blush: 0.4 },
  },
  // ---- classmates ----
  priya: {
    name: 'Priya', proportions: kid({ build: 0.96 }), skin: 0xb97f58,
    hair: { style: 'ponytail', color: 0x1d1512, seed: 21 },
    outfit: { top: 'sweater', topColor: 0xc9694e, accentColor: 0xf0e7da, bottom: 'trousers', bottomColor: 0x3a3f52, shoeColor: 0xd9d4c8 },
    face: { browColor: 0x1d1512 },
  },
  theo: {
    name: 'Theo', proportions: kid({ build: 1.06 }), skin: 0xf0c7a6,
    hair: { style: 'crop', color: 0xc08a4a, seed: 22 },
    outfit: { top: 'hoodie', topColor: 0x5e8f72, accentColor: 0xe9e6e0, bottom: 'trousers', bottomColor: 0x40434f, shoeColor: 0x8c4a3c },
    face: { browColor: 0x9a6a36 },
  },
  amara: {
    name: 'Amara', proportions: kid(), skin: 0x6b4330,
    hair: { style: 'buns', color: 0x18110f, seed: 23 },
    outfit: { top: 'sweater', topColor: 0xe0b34e, accentColor: 0xf3ecdb, bottom: 'trousers', bottomColor: 0x35405e, shoeColor: 0xe6e2d8 },
    face: { browColor: 0x18110f },
  },
  yusra: {
    name: 'Yusra', proportions: kid({ build: 0.98 }), skin: 0xd9a47c,
    hair: { style: 'hijab', color: 0x6f8fb8, seed: 24 },
    outfit: { top: 'sweater', topColor: 0xe8e2d6, accentColor: 0x6f8fb8, bottom: 'trousers', bottomColor: 0x3a4460, shoeColor: 0x596f96 },
    face: { browColor: 0x33251e },
  },
  leo: {
    name: 'Leo', proportions: kid({ build: 1.02 }), skin: 0xe9b58e,
    hair: { style: 'messy', color: 0x1c1a20, seed: 25 },
    outfit: { top: 'hoodie', topColor: 0x566a9c, accentColor: 0xe2dfd8, bottom: 'trousers', bottomColor: 0x2c2e3a, shoeColor: 0xc94f44 },
    face: { browColor: 0x1c1a20 },
  },
  mina: {
    name: 'Mina', proportions: kid({ build: 0.95 }), skin: 0xf3d2b4,
    hair: { style: 'softBob', color: 0x2b2026, seed: 26 },
    outfit: { top: 'sweater', topColor: 0xa98cc4, accentColor: 0xf1ecf5, bottom: 'trousers', bottomColor: 0x40405a, shoeColor: 0xe8e4ee },
    face: { browColor: 0x2b2026 },
  },
  // ---- the three voices of the Friday consultation ----
  alex: {
    name: 'Alex', proportions: kid({ build: 0.96 }), skin: 0xe7b48d,
    hair: { style: 'crop', color: 0x3a2a22, seed: 31 },
    outfit: { top: 'hoodie', topColor: 0x7a9a8a, accentColor: 0xeae6de, bottom: 'trousers', bottomColor: 0x33384a, shoeColor: 0x4d6a8c },
    face: { browColor: 0x3a2a22 }, rest: { mouthSmile: 0.15 },
  },
  sam: {
    name: 'Sam', proportions: kid(), skin: 0x8a5a40,
    hair: { style: 'curls', color: 0x1a1312, seed: 32 },
    outfit: { top: 'sweater', topColor: 0xd98a4e, accentColor: 0xf1e8d8, bottom: 'trousers', bottomColor: 0x2f3447, shoeColor: 0xd9d4c8 },
    face: { browColor: 0x1a1312 }, rest: { mouthSmile: 0.1 },
  },
  riley: {
    name: 'Riley', proportions: kid({ build: 1.0, legLength: 0.71 }), skin: 0xf2cdb0,
    hair: { style: 'ponytail', color: 0xb5562f, seed: 33 },
    outfit: { top: 'hoodie', topColor: 0x6b6fb0, accentColor: 0xeae6f2, bottom: 'trousers', bottomColor: 0x2e3045, shoeColor: 0xe6e2ea },
    face: { browColor: 0x8a4122 }, rest: { mouthSmile: 0.5 },
  },
} satisfies Record<string, CharacterSpec>;

export type CastName = keyof typeof CAST;
export const isCastName = (v: string): v is CastName => v in CAST;
