import { bell, drip, shape, sparkle, thump, tick } from './instruments';
import type { SfxSpec } from './sfx';
import { SLACK, dB, glide, mtof, pentatonic, swell, type Patch } from './synth';

export type ArcadeSfx =
  | 'portalEnter' | 'portalExit' | 'arcadeWin' | 'arcadeLose' | 'arcadeStar' | 'arcadeCount' | 'arcadeGo'
  | 'ballTable' | 'ballBat' | 'ballNet' | 'ballSmash' | 'ballOut' | 'pointWon' | 'pointLost' | 'serveToss'
  | 'spriteIn' | 'spriteBack' | 'moveEmber' | 'moveTide' | 'moveBloom' | 'moveKnock' | 'spriteHit' | 'spriteStrong' | 'spriteFell' | 'spriteMend' | 'spriteShell' | 'spriteDazzle'
  | 'gemPick' | 'gemSwap' | 'gemBack' | 'gemClear' | 'gemLand' | 'gemGather' | 'gemBeam' | 'gemBurst' | 'gemPrism' | 'gemPower' | 'lanternLit'
  | 'hookCast' | 'hookSplash' | 'woodGet' | 'glowGet' | 'tileLay' | 'wyrmRise' | 'wyrmKnock' | 'wyrmFlee' | 'wyrmLunge' | 'wyrmBite' | 'lanternLow' | 'thunder' | 'landHo'
  | 'sparkThrow' | 'lingLit' | 'bruteLit' | 'gateMore' | 'gateLess' | 'gateQuick' | 'flockDim' | 'mawComes' | 'mawStruck' | 'dawnBreaks';

const rush = (p: Patch, into: boolean): void => {
  const t = p.t, dur = into ? 0.7 : 0.55, m = p.mix(0.4);
  const air = p.filter('bandpass', 600, 1.4), g = p.gain(0);
  glide(air.frequency, t, into ? 300 : 4200, into ? 4800 : 380, dur);
  swell(g.gain, t, dB(-8), dur * (into ? 0.7 : 0.1), 0.02, dur * (into ? 0.25 : 0.85));
  p.noise('pink', t, t + dur + 0.2).connect(air).connect(g).connect(m);
  const low = p.osc('sine', 80, t, t + dur + SLACK), lg = p.gain(0);
  glide(low.frequency, t, into ? 60 : 150, into ? 150 : 55, dur);
  swell(lg.gain, t, dB(-12), dur * 0.4, 0.05, dur * 0.5);
  low.connect(lg).connect(m);
};

export const ARCADE_SFX: Record<ArcadeSfx, SfxSpec> = {
  portalEnter: {
    bus: 'sfx', level: -5.5,
    build: (p, c) => {
      rush(p, true);
      const t = p.t, m = p.mix(0.5), pool = pentatonic(c.root, 67, 96);
      sparkle(p, m, t + 0.12, [0, 2, 4, 5, 7, 9].map((k) => mtof(pool[Math.min(k, pool.length - 1)]!)), 0.07, dB(-17), 0.9);
      bell(p, m, t + 0.56, mtof(c.root + 24), { level: dB(-13), dur: 2.4, ratio: 3.5, index: 1.3 });
    },
  },
  portalExit: {
    bus: 'sfx', level: -5,
    build: (p, c) => {
      rush(p, false);
      const t = p.t, m = p.mix(0.5), pool = pentatonic(c.root, 67, 91);
      sparkle(p, m, t + 0.05, [6, 4, 3, 1].map((k) => mtof(pool[Math.min(k, pool.length - 1)]!)), 0.08, dB(-19), 0.8);
    },
  },
  arcadeWin: {
    bus: 'sfx', level: -8.5,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.5), root = c.root + 12;
      [[0, [0, 4, 7]], [0.16, [2, 7, 11]], [0.34, [4, 7, 12, 16]]].forEach(([at, chord], n) => {
        for (const semis of chord as number[]) bell(p, m, t + (at as number), mtof(root + semis), { level: dB(-17), dur: n === 2 ? 2.6 : 0.7, ratio: 3.5, index: 1.3 });
      });
      p.tone('sine', mtof(root - 24), t + 0.34, 0.9, dB(-14), 0.01).amp.connect(m);
      const pool = pentatonic(c.root, 84, 103);
      sparkle(p, m, t + 0.5, [0, 2, 4, 3, 5, 7, 6, 8, 9].map((k) => mtof(pool[Math.min(k, pool.length - 1)]!)), 0.05, dB(-20), 0.5);
    },
  },
  arcadeLose: {
    bus: 'sfx', level: -5,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.5), root = c.root + 12;
      bell(p, m, t, mtof(root + 7), { level: dB(-16), dur: 1.4, ratio: 2, index: 0.7 });
      bell(p, m, t + 0.22, mtof(root + 4), { level: dB(-17), dur: 1.9, ratio: 2, index: 0.7 });
      p.tone('sine', mtof(root - 12), t + 0.22, 1.2, dB(-19), 0.02).amp.connect(m);
    },
  },
  arcadeStar: {
    bus: 'ui', level: 0.5,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.3), f = mtof(c.root + 24);
      bell(p, m, t, f, { level: dB(-12), dur: 1.1, ratio: 3.5, index: 1.5 });
      bell(p, m, t, f * 1.5, { level: dB(-20), dur: 0.8, ratio: 2, index: 0.8 });
      tick(p, m, t, dB(-16), 6000, 0.04);
    },
  },
  arcadeCount: {
    bus: 'ui', level: -8,
    build: (p, c) => bell(p, p.mix(0.15), p.t, mtof(c.root + 12), { level: dB(-12), dur: 0.35, ratio: 2, index: 0.6 }),
  },
  arcadeGo: {
    bus: 'ui', level: -5,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.3);
      for (const semis of [0, 7, 12]) bell(p, m, t, mtof(c.root + 12 + semis), { level: dB(-15), dur: 0.9, ratio: 3.5, index: 1.2 });
    },
  },

  ballTable: {
    bus: 'sfx', level: -4,
    build: (p) => {
      const t = p.t, m = p.mix(0.16);
      thump(p, m, t, 1180, 760, 0.05, dB(-9));
      p.tone('sine', 2650, t, 0.022, dB(-17)).amp.connect(m);
      tick(p, m, t, dB(-17), 4200, 0.012);
    },
  },
  ballBat: {
    bus: 'sfx', level: -3,
    build: (p) => {
      const t = p.t, m = p.mix(0.1);
      thump(p, m, t, 640, 330, 0.07, dB(-8));
      p.tone(shape(p.kit, 'hollow'), 410, t, 0.05, dB(-17)).amp.connect(m);
      p.hiss('pink', t, 0.03, dB(-14)).amp.connect(p.filter('bandpass', 1500, 1.2)).connect(m);
    },
  },
  ballSmash: {
    bus: 'sfx', level: -2,
    build: (p) => {
      const t = p.t, m = p.mix(0.3);
      thump(p, m, t, 820, 210, 0.11, dB(-6));
      tick(p, m, t, dB(-9), 2600, 0.03);
      const air = p.filter('bandpass', 2400, 2), g = p.gain(0);
      glide(air.frequency, t, 3200, 900, 0.32);
      swell(g.gain, t, dB(-12), 0.02, 0.04, 0.3);
      p.noise('pink', t, t + 0.45).connect(air).connect(g).connect(m);
    },
  },
  ballNet: {
    bus: 'sfx', level: 0.5,
    build: (p) => {
      const t = p.t, m = p.mix(0.1);
      thump(p, m, t, 240, 120, 0.09, dB(-11));
      p.hiss('pink', t, 0.11, dB(-13)).amp.connect(p.filter('lowpass', 1400, 0)).connect(m);
    },
  },
  ballOut: {
    bus: 'sfx', level: -9,
    build: (p) => {
      const t = p.t, m = p.mix(0.2);
      [0, 0.16, 0.27].forEach((at, i) => thump(p, m, t + at, 520 - 60 * i, 300, 0.05, dB(-12 - 5 * i)));
    },
  },
  pointWon: {
    bus: 'sfx', level: -4,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.45), root = c.root + 12;
      [0, 7, 12].forEach((semis, i) => bell(p, m, t + 0.07 * i, mtof(root + semis), { level: dB(-15), dur: 1.5, ratio: 3.5, index: 1.3 }));
      const pool = pentatonic(c.root, 86, 100);
      sparkle(p, m, t + 0.2, [0, 2, 4, 5].map((k) => mtof(pool[Math.min(k, pool.length - 1)]!)), 0.05, dB(-21), 0.4);
    },
  },
  pointLost: {
    bus: 'sfx', level: -2,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.4);
      bell(p, m, t, mtof(c.root + 7), { level: dB(-15), dur: 1.3, ratio: 2, index: 0.6 });
      bell(p, m, t + 0.12, mtof(c.root + 4), { level: dB(-19), dur: 1.1, ratio: 2, index: 0.5 });
    },
  },
  serveToss: {
    bus: 'sfx', level: 7,
    build: (p) => {
      const t = p.t, air = p.filter('bandpass', 1800, 2), g = p.gain(0);
      glide(air.frequency, t, 900, 2600, 0.18);
      swell(g.gain, t, dB(-12), 0.05, 0.02, 0.14);
      p.noise('pink', t, t + 0.26).connect(air).connect(g).connect(p.mix(0.1));
    },
  },

  spriteIn: {
    bus: 'sfx', level: -2,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.4), pool = pentatonic(c.root, 72, 96);
      sparkle(p, m, t, [0, 2, 4, 6].map((k) => mtof(pool[Math.min(k, pool.length - 1)]!)), 0.045, dB(-15), 0.6);
      thump(p, m, t + 0.16, 420, 180, 0.12, dB(-13));
    },
  },
  spriteBack: {
    bus: 'sfx', level: 4,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.4), pool = pentatonic(c.root, 72, 91);
      sparkle(p, m, t, [5, 3, 1].map((k) => mtof(pool[Math.min(k, pool.length - 1)]!)), 0.05, dB(-16), 0.5);
    },
  },
  moveEmber: {
    bus: 'sfx', level: 0,
    build: (p) => {
      const t = p.t, m = p.mix(0.25), fire = p.filter('bandpass', 500, 1.1), g = p.gain(0);
      glide(fire.frequency, t, 380, 2400, 0.4);
      swell(g.gain, t, dB(-8), 0.07, 0.2, 0.3);
      p.noise('pink', t, t + 0.7).connect(fire).connect(g).connect(m);
      thump(p, m, t, 150, 70, 0.4, dB(-12));
    },
  },
  moveTide: {
    bus: 'sfx', level: 0,
    build: (p) => {
      const t = p.t, m = p.mix(0.3), jet = p.filter('bandpass', 3000, 2.2), g = p.gain(0);
      glide(jet.frequency, t, 4200, 900, 0.45);
      swell(g.gain, t, dB(-9), 0.03, 0.18, 0.3);
      p.noise('white', t, t + 0.6).connect(jet).connect(g).connect(m);
      for (const [at, f] of [[0.05, 760], [0.14, 980], [0.22, 620]] as const) {
        const { osc, amp } = p.tone('sine', f, t + at, 0.09, dB(-16));
        glide(osc.frequency, t + at, f, f * 1.5, 0.04);
        amp.connect(m);
      }
    },
  },
  moveBloom: {
    bus: 'sfx', level: 3,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.45), air = p.filter('bandpass', 1700, 0.9), g = p.gain(0);
      swell(g.gain, t, dB(-12), 0.09, 0.2, 0.3);
      p.lfo(19, 500, t, t + 0.7).connect(air.frequency);
      p.noise('pink', t, t + 0.7).connect(air).connect(g).connect(m);
      const pool = pentatonic(c.root, 84, 103);
      sparkle(p, m, t + 0.04, [3, 5, 4, 7, 6, 8].map((k) => mtof(pool[Math.min(k, pool.length - 1)]!)), 0.04, dB(-20), 0.35);
    },
  },
  moveKnock: {
    bus: 'sfx', level: -1,
    build: (p) => {
      const t = p.t, m = p.mix(0.12);
      thump(p, m, t, 330, 120, 0.14, dB(-8));
      tick(p, m, t, dB(-15), 2600, 0.03);
    },
  },
  spriteHit: {
    bus: 'sfx', level: -1,
    build: (p) => {
      const t = p.t, m = p.mix(0.2);
      thump(p, m, t, 260, 90, 0.18, dB(-8));
      p.hiss('pink', t, 0.09, dB(-13)).amp.connect(p.filter('bandpass', 1200, 1)).connect(m);
    },
  },
  spriteStrong: {
    bus: 'sfx', level: -5.5,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.4);
      thump(p, m, t, 300, 70, 0.26, dB(-7));
      tick(p, m, t, dB(-11), 3000, 0.04);
      for (const semis of [0, 7, 12]) bell(p, m, t + 0.02, mtof(c.root + 12 + semis), { level: dB(-17), dur: 1.1, ratio: 3.5, index: 1.4 });
    },
  },
  spriteFell: {
    bus: 'sfx', level: -3,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.55), pool = pentatonic(c.root, 67, 88);
      [6, 4, 2].forEach((k, i) => bell(p, m, t + 0.13 * i, mtof(pool[Math.min(k, pool.length - 1)]!), { level: dB(-15), dur: 1.6, ratio: 2, index: 0.7 }));
      p.tone('sine', mtof(c.root - 12), t + 0.26, 1.2, dB(-18), 0.02).amp.connect(m);
    },
  },
  spriteMend: {
    bus: 'sfx', level: 1.5,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.5), pool = pentatonic(c.root, 76, 100);
      sparkle(p, m, t, [0, 1, 2, 3, 4, 5, 6].map((k) => mtof(pool[Math.min(k, pool.length - 1)]!)), 0.06, dB(-17), 0.8);
    },
  },
  spriteShell: {
    bus: 'sfx', level: -2,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.35);
      thump(p, m, t, 200, 110, 0.16, dB(-10));
      p.tone(shape(p.kit, 'glass'), mtof(c.root + 12), t + 0.03, 0.9, dB(-17), 0.02).amp.connect(m);
      p.tone(shape(p.kit, 'glass'), mtof(c.root + 19), t + 0.03, 0.9, dB(-20), 0.02).amp.connect(m);
    },
  },
  spriteDazzle: {
    bus: 'sfx', level: 4.5,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.45), pool = pentatonic(c.root, 88, 103);
      sparkle(p, m, t, [4, 1, 5, 2, 6, 3].map((k) => mtof(pool[Math.min(k, pool.length - 1)]!)), 0.035, dB(-18), 0.3);
    },
  },

  gemPick: {
    bus: 'ui', level: -6,
    build: (p, c) => bell(p, p.mix(0.2), p.t, mtof(c.root + 24), { level: dB(-14), dur: 0.5, ratio: 2, index: 0.7 }),
  },
  gemSwap: {
    bus: 'sfx', level: -5,
    build: (p) => {
      const t = p.t, m = p.mix(0.15), air = p.filter('bandpass', 2200, 1.5), g = p.gain(0);
      glide(air.frequency, t, 1400, 3200, 0.12);
      swell(g.gain, t, dB(-13), 0.03, 0.02, 0.1);
      p.noise('pink', t, t + 0.2).connect(air).connect(g).connect(m);
      p.tone(shape(p.kit, 'glass'), 1320, t + 0.09, 0.12, dB(-18)).amp.connect(m);
    },
  },
  gemBack: {
    bus: 'sfx', level: -8,
    build: (p) => {
      const t = p.t, m = p.mix(0.15);
      p.tone(shape(p.kit, 'glass'), 520, t, 0.14, dB(-15)).amp.connect(m);
      p.tone(shape(p.kit, 'glass'), 440, t + 0.09, 0.2, dB(-16)).amp.connect(m);
    },
  },
  gemClear: {
    bus: 'sfx', level: -3,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.4), root = c.root + 12;
      [0, 4, 7].forEach((semis, i) => bell(p, m, t + 0.018 * i, mtof(root + semis), { level: dB(-16), dur: 0.9, ratio: 3.5, index: 1.2 }));
      tick(p, m, t, dB(-15), 5200, 0.03);
    },
  },
  gemLand: {
    bus: 'sfx', level: -9,
    build: (p) => {
      const t = p.t, m = p.mix(0.1);
      thump(p, m, t, 700, 380, 0.05, dB(-12));
      p.tone('sine', 2400, t, 0.03, dB(-20)).amp.connect(m);
    },
  },
  gemGather: {
    bus: 'sfx', level: -7,
    build: (p, c) => bell(p, p.mix(0.35), p.t, mtof(c.root + 24), { level: dB(-15), dur: 0.5, ratio: 2, index: 0.8 }),
  },
  gemBeam: {
    bus: 'sfx', level: -1,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.4), air = p.filter('bandpass', 2000, 3), g = p.gain(0);
      glide(air.frequency, t, 900, 7000, 0.28);
      swell(g.gain, t, dB(-10), 0.02, 0.1, 0.22);
      p.noise('white', t, t + 0.4).connect(air).connect(g).connect(m);
      for (const semis of [0, 7, 12]) bell(p, m, t + 0.04, mtof(c.root + 12 + semis), { level: dB(-17), dur: 1.2, ratio: 3.5, index: 1.4 });
    },
  },
  gemBurst: {
    bus: 'sfx', level: -6.5,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.4);
      thump(p, m, t, 240, 70, 0.3, dB(-8));
      tick(p, m, t, dB(-11), 2400, 0.05);
      for (const semis of [0, 4, 7, 11]) bell(p, m, t + 0.03, mtof(c.root + 12 + semis), { level: dB(-18), dur: 1.3, ratio: 3.5, index: 1.3 });
    },
  },
  gemPrism: {
    bus: 'sfx', level: -3.5,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.55), pool = pentatonic(c.root, 72, 103);
      sparkle(p, m, t, pool.filter((_, i) => i % 2 === 0).map(mtof), 0.035, dB(-17), 0.6);
      for (const semis of [0, 7, 12, 16]) bell(p, m, t + 0.3, mtof(c.root + 12 + semis), { level: dB(-17), dur: 2.2, ratio: 3.5, index: 1.4 });
      p.tone('sine', mtof(c.root - 12), t + 0.3, 1.0, dB(-15), 0.01).amp.connect(m);
    },
  },
  gemPower: {
    bus: 'sfx', level: 2,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.4), pool = pentatonic(c.root, 79, 100);
      sparkle(p, m, t, [0, 2, 4, 6].map((k) => mtof(pool[Math.min(k, pool.length - 1)]!)), 0.04, dB(-16), 0.5);
    },
  },
  lanternLit: {
    bus: 'sfx', level: -7.5,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.5), air = p.filter('lowpass', 900, 0), g = p.gain(0);
      swell(g.gain, t, dB(-14), 0.2, 0.2, 0.6);
      p.noise('pink', t, t + 1.1).connect(air).connect(g).connect(m);
      bell(p, m, t + 0.1, mtof(c.root), { level: dB(-12), dur: 2.6, ratio: 2, index: 0.9 });
      bell(p, m, t + 0.22, mtof(c.root + 7), { level: dB(-15), dur: 2.2, ratio: 2, index: 0.8 });
      bell(p, m, t + 0.34, mtof(c.root + 12), { level: dB(-16), dur: 2.0, ratio: 3.5, index: 1.1 });
    },
  },

  hookCast: {
    bus: 'sfx', level: 2,
    build: (p) => {
      const t = p.t, m = p.mix(0.12), air = p.filter('bandpass', 1200, 2.2), g = p.gain(0);
      glide(air.frequency, t, 700, 2900, 0.22);
      swell(g.gain, t, dB(-11), 0.04, 0.03, 0.18);
      p.noise('pink', t, t + 0.32).connect(air).connect(g).connect(m);
      p.tone('sine', 1900, t, 0.05, dB(-22)).amp.connect(m);
    },
  },
  hookSplash: {
    bus: 'sfx', level: -1,
    build: (p) => {
      const t = p.t, m = p.mix(0.2);
      drip(p, m, t, 520, dB(-9));
      thump(p, m, t, 300, 110, 0.1, dB(-13));
      p.hiss('pink', t + 0.01, 0.16, dB(-15)).amp.connect(p.filter('bandpass', 2600, 0.8)).connect(m);
    },
  },
  woodGet: {
    bus: 'sfx', level: -3,
    build: (p) => {
      const t = p.t, m = p.mix(0.14);
      thump(p, m, t, 430, 250, 0.06, dB(-8));
      thump(p, m, t + 0.07, 360, 220, 0.07, dB(-11));
      tick(p, m, t, dB(-18), 3000, 0.015);
    },
  },
  glowGet: {
    bus: 'sfx', level: -4,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.45), pool = pentatonic(c.root, 79, 98);
      bell(p, m, t, mtof(c.root + 19), { level: dB(-13), dur: 1.4, ratio: 3.5, index: 1.2 });
      sparkle(p, m, t + 0.06, [1, 3, 5].map((k) => mtof(pool[Math.min(k, pool.length - 1)]!)), 0.05, dB(-20), 0.5);
    },
  },
  tileLay: {
    bus: 'sfx', level: -3,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.3);
      thump(p, m, t, 330, 150, 0.12, dB(-7));
      thump(p, m, t + 0.11, 410, 230, 0.07, dB(-10));
      const rope = p.filter('bandpass', 900, 5), g = p.gain(0);
      glide(rope.frequency, t + 0.14, 500, 1500, 0.16);
      swell(g.gain, t + 0.14, dB(-17), 0.03, 0.02, 0.12);
      p.noise('pink', t + 0.14, t + 0.36).connect(rope).connect(g).connect(m);
      bell(p, m, t + 0.22, mtof(c.root + 12), { level: dB(-15), dur: 1.2, ratio: 3.5, index: 1.2 });
      bell(p, m, t + 0.22, mtof(c.root + 19), { level: dB(-18), dur: 1.2, ratio: 3.5, index: 1.2 });
    },
  },
  wyrmRise: {
    bus: 'sfx', level: -7,
    build: (p) => {
      const t = p.t, m = p.mix(0.35), water = p.filter('lowpass', 500, 0.7), g = p.gain(0);
      glide(water.frequency, t, 260, 1800, 0.7);
      swell(g.gain, t, dB(-9), 0.5, 0.1, 0.5);
      p.noise('pink', t, t + 1.3).connect(water).connect(g).connect(m);
      const low = p.osc(shape(p.kit, 'hollow'), 55, t, t + 1.2 + SLACK), lg = p.gain(0);
      glide(low.frequency, t, 48, 98, 0.8);
      swell(lg.gain, t, dB(-12), 0.45, 0.2, 0.4);
      low.connect(lg).connect(m);
    },
  },
  wyrmKnock: {
    bus: 'sfx', level: -1,
    build: (p) => {
      const t = p.t, m = p.mix(0.22);
      thump(p, m, t, 520, 170, 0.13, dB(-6));
      const yelp = p.osc('sine', 500, t + 0.03, t + 0.3 + SLACK), yg = p.gain(0);
      glide(yelp.frequency, t + 0.03, 420, 900, 0.16);
      swell(yg.gain, t + 0.03, dB(-16), 0.02, 0.05, 0.14);
      yelp.connect(yg).connect(m);
      p.hiss('pink', t + 0.02, 0.2, dB(-15)).amp.connect(p.filter('bandpass', 2200, 0.8)).connect(m);
    },
  },
  wyrmFlee: {
    bus: 'sfx', level: -6.5,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.4);
      const slide = p.osc('sine', 700, t, t + 0.6 + SLACK), sg = p.gain(0);
      glide(slide.frequency, t, 820, 150, 0.45);
      swell(sg.gain, t, dB(-14), 0.02, 0.1, 0.36);
      slide.connect(sg).connect(m);
      thump(p, m, t + 0.36, 240, 80, 0.2, dB(-10));
      p.hiss('pink', t + 0.36, 0.4, dB(-13)).amp.connect(p.filter('bandpass', 1800, 0.7)).connect(m);
      [0, 4, 7].forEach((semis, i) => bell(p, m, t + 0.42 + 0.07 * i, mtof(c.root + 12 + semis), { level: dB(-16), dur: 1.3, ratio: 3.5, index: 1.3 }));
    },
  },
  wyrmLunge: {
    bus: 'sfx', level: 5.5,
    build: (p) => {
      const t = p.t, m = p.mix(0.2), rush2 = p.filter('bandpass', 700, 1.3), g = p.gain(0);
      glide(rush2.frequency, t, 400, 3000, 0.5);
      swell(g.gain, t, dB(-8), 0.4, 0.04, 0.12);
      p.noise('pink', t, t + 0.66).connect(rush2).connect(g).connect(m);
    },
  },
  wyrmBite: {
    bus: 'sfx', level: -1,
    build: (p) => {
      const t = p.t, m = p.mix(0.25);
      thump(p, m, t, 700, 120, 0.1, dB(-6));
      [0, 0.035, 0.08, 0.13].forEach((at, i) => tick(p, m, t + at, dB(-10 - 2 * i), 2400 + 500 * i, 0.03));
      thump(p, m, t + 0.14, 200, 60, 0.3, dB(-9));
      p.hiss('pink', t + 0.14, 0.5, dB(-13)).amp.connect(p.filter('bandpass', 1500, 0.6)).connect(m);
    },
  },
  lanternLow: {
    bus: 'sfx', level: -2,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.45);
      bell(p, m, t, mtof(c.root + 7), { level: dB(-14), dur: 1.5, ratio: 2, index: 0.6 });
      bell(p, m, t + 0.3, mtof(c.root + 5), { level: dB(-16), dur: 1.7, ratio: 2, index: 0.5 });
    },
  },
  thunder: {
    bus: 'sfx', level: -4.5,
    build: (p) => {
      const t = p.t, m = p.mix(0.6), sky = p.filter('lowpass', 900, 0.4), g = p.gain(0);
      glide(sky.frequency, t, 1400, 120, 1.6);
      swell(g.gain, t, dB(-5), 0.03, 0.3, 2.2);
      p.noise('brown', t, t + 2.8).connect(sky).connect(g).connect(m);
      thump(p, m, t, 110, 38, 0.6, dB(-9));
    },
  },
  landHo: {
    bus: 'sfx', level: -4,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.6);
      [[0, 0], [0.55, 7]].forEach(([at, semis]) => {
        const horn = p.tone(shape(p.kit, 'hollow'), mtof(c.root - 12 + semis!), t + at!, 1.5, dB(-13), 0.18);
        horn.amp.connect(p.filter('lowpass', 900, 0.5)).connect(m);
      });
      bell(p, m, t + 1.1, mtof(c.root + 24), { level: dB(-17), dur: 2.4, ratio: 3.5, index: 1.2 });
    },
  },

  sparkThrow: {
    bus: 'sfx', level: -6,
    build: (p) => {
      const t = p.t, m = p.mix(0.08);
      tick(p, m, t, dB(-12), 5200, 0.016);
      p.tone('sine', 1500, t, 0.03, dB(-22)).amp.connect(m);
    },
  },
  lingLit: {
    bus: 'sfx', level: -8,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.3), pool = pentatonic(c.root, 76, 96);
      thump(p, m, t, 520, 240, 0.05, dB(-14));
      bell(p, m, t + 0.01, mtof(pool[Math.floor(Math.random() * pool.length)]!), { level: dB(-16), dur: 0.5, ratio: 3.5, index: 1.1 });
    },
  },
  bruteLit: {
    bus: 'sfx', level: -7,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.45);
      thump(p, m, t, 260, 60, 0.3, dB(-7));
      p.hiss('pink', t, 0.3, dB(-14)).amp.connect(p.filter('bandpass', 1400, 0.8)).connect(m);
      [0, 7, 12, 16].forEach((semis, i) => bell(p, m, t + 0.05 + 0.04 * i, mtof(c.root + 12 + semis), { level: dB(-16), dur: 1.4, ratio: 3.5, index: 1.3 }));
    },
  },
  gateMore: {
    bus: 'sfx', level: -4,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.4), pool = pentatonic(c.root, 72, 100);
      sparkle(p, m, t, [0, 2, 3, 5, 7, 9].map((k) => mtof(pool[Math.min(k, pool.length - 1)]!)), 0.04, dB(-14), 0.5);
      bell(p, m, t + 0.24, mtof(c.root + 24), { level: dB(-14), dur: 1.3, ratio: 3.5, index: 1.3 });
    },
  },
  gateLess: {
    bus: 'sfx', level: -3,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.4);
      bell(p, m, t, mtof(c.root + 7), { level: dB(-14), dur: 1.0, ratio: 2, index: 0.6 });
      bell(p, m, t + 0.13, mtof(c.root + 3), { level: dB(-16), dur: 1.2, ratio: 2, index: 0.5 });
      p.hiss('pink', t, 0.18, dB(-20)).amp.connect(p.filter('lowpass', 900, 0)).connect(m);
    },
  },
  gateQuick: {
    bus: 'sfx', level: -4,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.35), air = p.filter('bandpass', 900, 1.6), g = p.gain(0);
      glide(air.frequency, t, 600, 4200, 0.3);
      swell(g.gain, t, dB(-12), 0.2, 0.03, 0.14);
      p.noise('pink', t, t + 0.42).connect(air).connect(g).connect(m);
      for (const semis of [12, 19, 24]) bell(p, m, t + 0.22, mtof(c.root + semis), { level: dB(-17), dur: 1.1, ratio: 3.5, index: 1.4 });
    },
  },
  flockDim: {
    bus: 'sfx', level: -4,
    build: (p) => {
      const t = p.t, m = p.mix(0.2);
      p.hiss('pink', t, 0.14, dB(-12)).amp.connect(p.filter('bandpass', 1900, 1.2)).connect(m);
      thump(p, m, t, 300, 150, 0.08, dB(-15));
    },
  },
  mawComes: {
    bus: 'sfx', level: -6,
    build: (p) => {
      const t = p.t, m = p.mix(0.5);
      const low = p.osc(shape(p.kit, 'hollow'), 49, t, t + 2.4 + SLACK), lg = p.gain(0);
      glide(low.frequency, t, 62, 41, 1.8);
      swell(lg.gain, t, dB(-9), 0.9, 0.5, 0.9);
      low.connect(lg).connect(m);
      const air = p.filter('bandpass', 400, 0.8), g = p.gain(0);
      glide(air.frequency, t, 900, 220, 1.6);
      swell(g.gain, t, dB(-13), 0.7, 0.3, 0.9);
      p.noise('pink', t, t + 2.2).connect(air).connect(g).connect(m);
    },
  },
  mawStruck: {
    bus: 'sfx', level: -8,
    build: (p) => {
      const t = p.t, m = p.mix(0.3);
      thump(p, m, t, 190, 70, 0.14, dB(-9));
      p.tone('sine', 620, t, 0.12, dB(-20)).amp.connect(m);
    },
  },
  dawnBreaks: {
    bus: 'sfx', level: -11.5,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.65), root = c.root + 12;
      thump(p, m, t, 180, 40, 0.5, dB(-8));
      [[0, [0, 7]], [0.14, [4, 12]], [0.3, [7, 16]], [0.5, [12, 19, 24]]].forEach(([at, chord], n) => {
        for (const semis of chord as number[]) bell(p, m, t + (at as number), mtof(root + semis), { level: dB(-16), dur: n === 3 ? 3.2 : 1.2, ratio: 3.5, index: 1.3 });
      });
      const pool = pentatonic(c.root, 84, 106);
      sparkle(p, m, t + 0.55, [0, 2, 4, 5, 7, 8, 9, 10].map((k) => mtof(pool[Math.min(k, pool.length - 1)]!)), 0.06, dB(-20), 0.8);
      const air = p.filter('highpass', 2000, 0), g = p.gain(0);
      swell(g.gain, t, dB(-16), 0.5, 0.4, 1.6);
      p.noise('pink', t, t + 2.8).connect(air).connect(g).connect(m);
    },
  },
};
