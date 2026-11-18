import type { Rng } from '../core/math';
import type { SfxName } from './GameAudio';
import { ARCADE_SFX } from './arcadeSfx';
import { bell, choir, formants, padChord, shape, sparkle, thump, tick } from './instruments';
import type { Space } from './mixer';
import { SLACK, dB, glide, mtof, notes, pentatonic, swell, swellEnd, type Patch } from './synth';

export interface SfxContext {
  readonly rng: Rng;
  readonly root: number;
  readonly space: Space;
}

export interface SfxSpec {
  readonly bus: 'sfx' | 'ui';
  readonly level: number;
  readonly build: (p: Patch, c: SfxContext) => void;
}

const holo = (p: Patch, opening: boolean): void => {
  const t = p.t, dur = opening ? 0.45 : 0.36, m = p.mix(0.12);
  const flutter = p.gain(0.7);
  p.lfo(31, 0.3, t, t + dur + SLACK).connect(flutter.gain);
  flutter.connect(m);
  [1, 1.5, 2, 3].forEach((k, i) => {
    const low = 540 * k, high = low * 1.5;
    const o = p.osc('sine', low, t, t + dur + SLACK), g = p.gain(0);
    glide(o.frequency, t, opening ? low : high, opening ? high : low, dur * 0.9);
    swell(g.gain, t, dB(-22 - 3 * i), dur * 0.3, dur * 0.2, dur * 0.5 - SLACK);
    o.connect(g).connect(flutter);
  });
  const air = p.filter('bandpass', 3000, 3), g = p.gain(0);
  glide(air.frequency, t, opening ? 1500 : 6000, opening ? 6000 : 1500, dur * 0.9);
  swell(g.gain, t, dB(-9), dur * 0.35, dur * 0.1, dur * 0.55 - SLACK);
  p.noise('pink', t, t + dur + SLACK).connect(air).connect(g).connect(m);
};

const headset = (p: Patch, on: boolean): void => {
  const t = p.t, dur = on ? 0.82 : 0.62, end = t + dur + 0.2, m = p.mix(on ? 0.35 : 0.1);
  const from = on ? 95 : 430, to = on ? 430 : 95;
  const whir = p.osc(shape(p.kit, 'reed'), from, t, end), body = p.filter('lowpass', from * 4, 7), g = p.gain(0);
  glide(whir.frequency, t, from, to, dur);
  glide(body.frequency, t, from * 4, to * 4, dur);
  p.lfo(27, 5, t, end).connect(whir.frequency);
  swell(g.gain, t, dB(-16), on ? 0.12 : 0.03, dur - 0.2, 0.22);
  whir.connect(body).connect(g).connect(m);

  const air = p.filter('bandpass', 1000, 1.2), rush = p.gain(0), peak = dB(-5);
  glide(air.frequency, t, on ? 400 : 5200, on ? 5200 : 400, dur);
  if (on) {
    rush.gain.setValueAtTime(0, t);
    rush.gain.linearRampToValueAtTime(peak * 0.01, t + 0.05);
    rush.gain.exponentialRampToValueAtTime(peak, t + dur);
    rush.gain.linearRampToValueAtTime(0, t + dur + 0.16);
  } else {
    rush.gain.setValueAtTime(0, t);
    rush.gain.linearRampToValueAtTime(peak, t + 0.03);
    rush.gain.exponentialRampToValueAtTime(peak * 0.003, t + dur);
    rush.gain.linearRampToValueAtTime(0, t + dur + 0.05);
  }
  p.noise('pink', t, end).connect(air).connect(rush).connect(m);
};

const makeCrackle = (ctx: BaseAudioContext, rng: Rng): AudioBuffer => {
  const rate = ctx.sampleRate, n = Math.floor(1.3 * rate);
  const buffer = ctx.createBuffer(1, n, rate), data = buffer.getChannelData(0);
  for (let i = 0; i < n; ) {
    const age = i / n, strength = (0.35 + 0.65 * rng.next()) * (1 - age) ** 1.3;
    const length = Math.floor(rate * rng.range(0.0006, 0.003));
    for (let k = 0; k < length && i + k < n; k++) data[i + k] = (rng.next() * 2 - 1) * strength * (1 - k / length);
    i += length + Math.floor(rate * rng.range(0.002, 0.006 + 0.06 * age));
  }
  return buffer;
};

export const SFX: Record<SfxName, SfxSpec> = {
  ...ARCADE_SFX,

  uiHover: {
    bus: 'ui',
    level: 4.5,
    build: (p) => {
      p.tone('sine', 2100, p.t, 0.035, dB(-25)).amp.connect(p.out);
      p.tone('triangle', 1400, p.t, 0.02, dB(-31)).amp.connect(p.out);
    },
  },

  uiSelect: {
    bus: 'ui',
    level: 3.5,
    build: (p) => {
      [74, 79].forEach((n, i) => p.tone(shape(p.kit, 'glass'), mtof(n), p.t + i * 0.085, 0.2 + 0.12 * i, dB(-16), 0.005).amp.connect(p.out));
    },
  },

  advance: {
    bus: 'ui',
    level: 5.5,
    build: (p) => {
      p.tone('sine', 1250, p.t, 0.03, dB(-30)).amp.connect(p.out);
      tick(p, p.out, p.t, dB(-32), 3000, 0.012);
    },
  },

  objective: {
    bus: 'ui',
    level: 1.5,
    build: (p) => {
      const m = p.mix(0.25);
      bell(p, m, p.t, mtof(76), { level: dB(-17), dur: 0.7, ratio: 2, index: 0.5 });
      bell(p, m, p.t + 0.13, mtof(83), { level: dB(-16), dur: 1.0, ratio: 2, index: 0.5 });
    },
  },

  taskDone: {
    bus: 'ui',
    level: -6,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.4), root = c.root + 12;
      [0, 4, 7, 12].forEach((semis, i) => bell(p, m, t + 0.07 * i, mtof(root + semis), { level: dB(-17), dur: 0.9, ratio: 2, index: 0.6 }));
      [0, 4, 7, 12, 16].forEach((semis) => bell(p, m, t + 0.3, mtof(root + semis), { level: dB(-21), dur: 1.8, ratio: 3.5, index: 1.1 }));
      const pool = pentatonic(c.root, 86, 103);
      sparkle(p, m, t + 0.34, [5, 3, 6, 2, 4, 1].map((k) => mtof(pool[Math.min(k, pool.length - 1)]!)), 0.05, dB(-22), 0.4);
    },
  },

  card: {
    bus: 'ui',
    level: -3.5,
    build: (p) => {
      const t = p.t, m = p.mix(0.35);
      const breath = p.filter('lowpass', 220, 2), g = p.gain(0);
      breath.frequency.setValueAtTime(220, t);
      breath.frequency.exponentialRampToValueAtTime(1300, t + 0.45);
      breath.frequency.exponentialRampToValueAtTime(260, t + 1.5);
      swell(g.gain, t, dB(-6), 0.4, 0.05, 1.1);
      p.noise('pink', t, swellEnd(t, 0.4, 0.05, 1.1)).connect(breath).connect(g).connect(m);
      bell(p, m, t + 0.08, mtof(43), { level: dB(-15), dur: 2.6, ratio: 2.76, index: 0.9, attack: 0.012 });
      bell(p, m, t + 0.08, mtof(55), { level: dB(-15), dur: 2.2, ratio: 3.5, index: 0.6, attack: 0.008 });
      bell(p, m, t + 0.08, mtof(67), { level: dB(-21), dur: 1.6, ratio: 3.5, index: 0.5, attack: 0.006 });
    },
  },

  result: {
    bus: 'ui',
    level: 0,
    build: (p) => {
      const t = p.t, m = p.mix(0.3), warm = p.filter('lowpass', 1800, 0);
      padChord(p, warm, warm, t, notes('G3 D4 A4 B4 D5'), { wave: shape(p.kit, 'soft'), level: dB(-30), detune: 5, attack: 0.35, hold: 0.3, release: 1.4 });
      warm.connect(m);
      bell(p, m, t + 0.3, mtof(86), { level: dB(-25), dur: 1.4, ratio: 2, index: 0.5 });
    },
  },

  notify: {
    bus: 'ui',
    level: 1.5,
    build: (p) => {
      [83, 79].forEach((n, i) => {
        const f = mtof(n), at = p.t + i * 0.16;
        p.tone('sine', f, at, i ? 0.55 : 0.3, dB(-13), 0.005).amp.connect(p.out);
        p.tone('sine', f * 2, at, 0.2, dB(-25)).amp.connect(p.out);
        p.tone('sine', f * 3, at, 0.1, dB(-28)).amp.connect(p.out);
      });
    },
  },

  pickup: {
    bus: 'sfx',
    level: 9,
    build: (p) => {
      const t = p.t;
      p.hiss('pink', t, 0.07, dB(-4)).amp.connect(p.filter('bandpass', 1500, 1.2)).connect(p.out);
      thump(p, p.out, t + 0.01, 210, 130, 0.07, dB(-20));
      p.tone('sine', 2600, t + 0.02, 0.025, dB(-30)).amp.connect(p.out);
    },
  },

  putDown: {
    bus: 'sfx',
    level: 2,
    build: (p) => {
      const t = p.t;
      thump(p, p.out, t, 150, 62, 0.11, dB(-17));
      p.hiss('brown', t, 0.06, dB(0)).amp.connect(p.filter('lowpass', 1400, 0)).connect(p.out);
      p.tone('sine', 1900, t + 0.004, 0.025, dB(-22)).amp.connect(p.out);
    },
  },

  sit: {
    bus: 'sfx',
    level: 2.5,
    build: (p) => {
      const t = p.t, cloth = p.filter('lowpass', 1000, 0);
      p.hiss('pink', t, 0.22, dB(-6), 0.05).amp.connect(cloth);
      p.hiss('pink', t + 0.16, 0.2, dB(-9), 0.04).amp.connect(cloth);
      cloth.connect(p.out);
      thump(p, p.out, t + 0.12, 110, 60, 0.13, dB(-17));
      const creak = p.tone('triangle', 300, t + 0.1, 0.12, dB(-31), 0.02);
      glide(creak.osc.frequency, t + 0.1, 300, 370, 0.1);
      creak.amp.connect(p.out);
    },
  },

  footstep: {
    bus: 'sfx',
    level: 8,
    build: (p, c) => {
      const t = p.t, r = c.rng, foot = p.pan(r.sign() * 0.14);
      foot.connect(p.out);
      if (c.space === 'haven') {
        p.hiss('pink', t, r.range(0.06, 0.08), dB(-2)).amp.connect(p.filter('bandpass', r.range(500, 800), 0.7)).connect(foot);
        thump(p, foot, t, r.range(100, 125), 62, 0.06, dB(-27));
        p.tone('sine', mtof(c.root + 24 + r.pick([0, 7, 12])), t, 0.16, dB(-26)).amp.connect(foot);
      } else {
        p.hiss('pink', t, r.range(0.06, 0.09), dB(0)).amp.connect(p.filter('bandpass', r.range(260, 380), 0.9)).connect(foot);
        thump(p, foot, t, r.range(95, 120), r.range(55, 70), 0.07, dB(-25));
        p.hiss('pink', t + 0.012, 0.05, dB(-6)).amp.connect(p.filter('bandpass', r.range(900, 1600), 0.8)).connect(foot);
      }
    },
  },

  bell: {
    bus: 'sfx',
    level: -3.5,
    build: (p) => {
      const t = p.t, ringing = 1.15, end = swellEnd(t, 0.012, ringing, 0.5);
      const hammer = p.gain(0.62), dome = p.gain(0), soft = p.filter('lowpass', 4200, 0);
      p.lfo(23, 0.38, t, end).connect(hammer.gain);
      swell(dome.gain, t, 1, 0.012, ringing, 0.5);
      for (const [ratio, strength] of [[1, 1], [2.02, 0.6], [2.76, 0.45], [4.1, 0.25], [5.43, 0.16]] as const) {
        p.osc('sine', 660 * ratio, t, end).connect(p.gain(dB(-17) * strength)).connect(hammer);
      }
      hammer.connect(dome).connect(soft).connect(p.out);
    },
  },

  phoneTap: {
    bus: 'sfx',
    level: 6,
    build: (p) => {
      const t = p.t;
      p.tone('sine', 2500, t, 0.035, dB(-20)).amp.connect(p.out);
      tick(p, p.out, t, dB(-14), 3500, 0.02);
      thump(p, p.out, t, 340, 260, 0.04, dB(-22));
    },
  },

  holoOpen: { bus: 'sfx', level: 0, build: (p) => holo(p, true) },
  holoClose: { bus: 'sfx', level: 0, build: (p) => holo(p, false) },

  vote: {
    bus: 'sfx',
    level: -1,
    build: (p) => {
      const t = p.t, m = p.mix(0.3);
      thump(p, p.out, t, 170, 55, 0.16, dB(-14));
      p.hiss('pink', t, 0.035, dB(-6)).amp.connect(p.filter('bandpass', 1300, 1)).connect(p.out);
      const bright = p.filter('lowpass', 3500, 0);
      glide(bright.frequency, t + 0.03, 3500, 900, 0.8);
      notes('G3 D4 G4 B4 D5').forEach((n, i) => {
        [-5, 5].forEach((cents, k) => p.tone(shape(p.kit, 'soft'), mtof(n), t + 0.03 + 0.007 * i + 0.003 * k, 1.5, dB(-23), 0.01, cents).amp.connect(bright));
      });
      bright.connect(m);
      bell(p, m, t + 0.03, mtof(79), { level: dB(-21), dur: 1.2 });
    },
  },

  poster: {
    bus: 'sfx',
    level: 1,
    build: (p) => {
      const t = p.t;
      const tip = p.filter('bandpass', 2600, 2.5), g = p.gain(0);
      tip.frequency.setValueAtTime(2600, t);
      tip.frequency.exponentialRampToValueAtTime(4600, t + 0.2);
      tip.frequency.exponentialRampToValueAtTime(3200, t + 0.38);
      swell(g.gain, t, dB(-6), 0.08, 0.18, 0.12);
      p.noise('white', t, swellEnd(t, 0.08, 0.18, 0.12)).connect(tip).connect(g).connect(p.out);
      const pop = p.tone('sine', 480, t + 0.44, 0.07, dB(-14));
      glide(pop.osc.frequency, t + 0.44, 480, 1150, 0.05);
      pop.amp.connect(p.out);
      tick(p, p.out, t + 0.44, dB(-22), 2500, 0.012);
    },
  },

  headsetOn: { bus: 'sfx', level: -4.5, build: (p) => headset(p, true) },
  headsetOff: { bus: 'sfx', level: -4.5, build: (p) => headset(p, false) },

  wipe: {
    bus: 'sfx',
    level: -4,
    build: (p) => {
      const t = p.t, top = 2.85, m = p.mix(0.4);
      const sweep = p.filter('bandpass', 220, 1.1), rush = p.gain(0), peak = dB(-10);
      glide(sweep.frequency, t, 220, 6500, top);
      rush.gain.setValueAtTime(0, t);
      rush.gain.linearRampToValueAtTime(peak * 0.03, t + 0.08);
      rush.gain.exponentialRampToValueAtTime(peak, t + top);
      rush.gain.linearRampToValueAtTime(0, t + top + 0.4);
      p.noise('pink', t, t + top + 0.4 + SLACK).connect(sweep).connect(rush).connect(m);
      [2, 3, 4, 5, 6, 8].forEach((h, i) => {
        const f = mtof(43) * h, from = t + 0.25 * i, end = swellEnd(from, 1.3, top - 1.3 - 0.25 * i, 0.5);
        const o = p.osc('sine', f, from, end), g = p.gain(0), tremble = p.gain(0.6);
        glide(o.frequency, from, f, f * 1.03, top);
        swell(g.gain, from, dB(-23 - i), 1.3, top - 1.3 - 0.25 * i, 0.5);
        p.lfo(3.5 + 0.9 * i, 0.4, from, end).connect(tremble.gain);
        o.connect(g).connect(tremble).connect(m);
      });
      for (const n of notes('D5 G5 A5 D6')) bell(p, m, t + top, mtof(n), { level: dB(-20), dur: 1.8, ratio: 2, index: 0.6, attack: 0.07 });
      p.hiss('pink', t + top, 0.6, dB(-13), 0.09).amp.connect(p.filter('lowpass', 2500, 0)).connect(m);
    },
  },

  orbAppear: {
    bus: 'sfx',
    level: 2,
    build: (p, c) => {
      const pool = pentatonic(c.root, 84, 100), from = c.rng.int(0, 2);
      sparkle(p, p.mix(0.4), p.t, [0, 2, 1, 3, 4].map((k) => mtof(pool[from + k]!)), 0.045, dB(-17), 0.4);
    },
  },

  orbTake: {
    bus: 'sfx',
    level: 1,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.35), f = mtof(c.root + 12);
      p.tone(shape(p.kit, 'glass'), f, t, 0.5, dB(-14), 0.005).amp.connect(m);
      [7, 12, 19].forEach((semis, i) => bell(p, m, t + 0.045 * (i + 1), f * 2 ** (semis / 12), { level: dB(-20), dur: 0.4, ratio: 2, index: 0.6 }));
      p.hiss('pink', t, 0.18, dB(-14), 0.02).amp.connect(p.filter('bandpass', 3000, 1.5)).connect(m);
    },
  },

  orbThrow: {
    bus: 'sfx',
    level: 3,
    build: (p) => {
      const t = p.t, m = p.mix(0.15);
      const air = p.filter('bandpass', 600, 1.6), g = p.gain(0);
      air.frequency.setValueAtTime(600, t);
      air.frequency.exponentialRampToValueAtTime(2600, t + 0.12);
      air.frequency.exponentialRampToValueAtTime(800, t + 0.34);
      swell(g.gain, t, dB(-3), 0.07, 0.03, 0.26);
      p.noise('white', t, swellEnd(t, 0.07, 0.03, 0.26)).connect(air).connect(g).connect(m);
      const zip = p.tone('sine', 520, t, 0.2, dB(-24), 0.02);
      glide(zip.osc.frequency, t, 520, 1250, 0.16);
      zip.amp.connect(m);
    },
  },

  ringHit: {
    bus: 'sfx',
    level: -2.5,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.45), root = c.root + 12;
      [0, 4, 7, 12, 16].forEach((semis, i) => {
        const at = t + 0.012 * i, f = mtof(root + semis);
        bell(p, m, at, f, { level: dB(-17), dur: 2.3 - 0.15 * i, ratio: 3.5, index: 1.4 });
        if (semis % 12 === 0 || semis === 7) bell(p, m, at, f, { level: dB(-23), dur: 2, ratio: 3.5, index: 1, cents: 7 });
      });
      p.tone('sine', mtof(root - 24), t, 0.5, dB(-15), 0.006).amp.connect(m);
      tick(p, m, t, dB(-12), 5000, 0.03);
      const pool = pentatonic(c.root, 84, 103);
      sparkle(p, m, t + 0.09, [0, 1, 2, 3, 4, 5, 6, 7, 5, 8, 6, 9].map((k) => mtof(pool[Math.min(k, pool.length - 1)]!)), 0.042, dB(-19), 0.45);
    },
  },

  ringRim: {
    bus: 'sfx',
    level: 2,
    build: (p) => {
      const t = p.t, m = p.mix(0.15);
      [[2217, -16], [3409, -18], [5121, -21], [6843, -25]].forEach(([f, level]) => p.tone('sine', f!, t, 0.2, dB(level!)).amp.connect(m));
      tick(p, m, t, dB(-16), 6000, 0.01);
    },
  },

  orbFizzle: {
    bus: 'sfx',
    level: 8,
    build: (p) => {
      const t = p.t, m = p.mix(0.2);
      const fizz = p.filter('bandpass', 5500, 2), spit = p.gain(0.5);
      glide(fizz.frequency, t, 5500, 1300, 0.5);
      p.lfo(37, 0.5, t, t + 0.6).connect(spit.gain);
      p.hiss('white', t, 0.55, dB(-6), 0.02).amp.connect(fizz).connect(spit).connect(m);
      const fall = p.tone('sine', 900, t, 0.45, dB(-26), 0.02);
      glide(fall.osc.frequency, t, 900, 280, 0.42);
      fall.amp.connect(m);
    },
  },

  bridgeBuild: {
    bus: 'sfx',
    level: 0,
    build: (p, c) => {
      const pool = pentatonic(c.root, 72, 96).slice(0, 10);
      sparkle(p, p.mix(0.4), p.t + 0.22, pool.map(mtof), 0.085, dB(-14), 0.6);
    },
  },

  bridgeComplete: {
    bus: 'sfx',
    level: -4,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.45), root = c.root + 12;
      [0, 4, 7, 12, 16, 19, 24].forEach((semis, i, all) => {
        bell(p, m, t + 0.07 * i, mtof(root + semis), { level: dB(-17), dur: i === all.length - 1 ? 1.9 : 1.1, ratio: 3.5, index: 1.3 });
      });
      const warm = p.filter('lowpass', 2400, 0);
      padChord(p, warm, warm, t + 0.1, [root - 12, root - 5, root, root + 4, root + 7], { wave: shape(p.kit, 'soft'), level: dB(-31), detune: 6, attack: 0.3, hold: 0.7, release: 0.9 });
      warm.connect(m);
      p.tone('sine', mtof(root - 24), t, 0.9, dB(-15), 0.008).amp.connect(m);
      const pool = pentatonic(c.root, 88, 103);
      sparkle(p, m, t + 0.55, Array.from({ length: 10 }, () => mtof(c.rng.pick(pool))), 0.06, dB(-21), 0.5);
    },
  },

  firework: {
    bus: 'sfx',
    level: -1.5,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.35);
      thump(p, m, t, 95, 38, 0.3, dB(-15));
      p.hiss('pink', t, 0.3, dB(0)).amp.connect(p.filter('lowpass', 600, 0)).connect(m);
      const sparks = p.gain(dB(-7));
      p.play(p.kit.buffer('crackle', makeCrackle), t + 0.22, c.rng.range(0.85, 1.2)).connect(p.filter('highpass', 2500, 0)).connect(sparks).connect(m);
      const glitter = p.filter('bandpass', 7500, 1.2), shiver = p.gain(0.6);
      p.lfo(17, 0.4, t + 0.3, t + 1.9).connect(shiver.gain);
      p.hiss('white', t + 0.3, 1.5, dB(-3), 0.2).amp.connect(glitter).connect(shiver).connect(m);
    },
  },

  gateOpen: {
    bus: 'sfx',
    level: -6.5,
    build: (p, c) => {
      const t = p.t, m = p.mix(0.5), root = c.root;
      const rise = { attack: 1.4, hold: 0.5, release: 1.5 }, end = swellEnd(t, rise.attack, rise.hold, rise.release);
      const sub = p.gain(0);
      swell(sub.gain, t, dB(-21), 1.3, 0.6, 1.5);
      p.osc('sine', mtof(root - 24), t, end).connect(sub);
      p.osc('sine', mtof(root - 12), t, end).connect(p.gain(0.7)).connect(sub);
      sub.connect(m);
      const opening = p.filter('lowpass', 500, 1);
      glide(opening.frequency, t, 500, 3200, 1.6);
      padChord(p, opening, opening, t, [root - 12, root - 5, root, root + 4, root + 7, root + 14], { wave: shape(p.kit, 'soft'), level: dB(-27), detune: 8, ...rise });
      opening.connect(m);
      choir(p, formants(p, m, 'ah'), t, [root, root + 4, root + 7, root + 12], { level: dB(-15), attack: 1.2, hold: 0.7, release: 1.5 });
      const air = p.filter('bandpass', 300, 1.2), rush = p.gain(0);
      glide(air.frequency, t, 300, 3500, 1.6);
      swell(rush.gain, t, dB(-6), 1.5, 0.1, 1.0);
      p.noise('pink', t, swellEnd(t, 1.5, 0.1, 1.0)).connect(air).connect(rush).connect(m);
      const pool = pentatonic(root, 84, 103);
      sparkle(p, m, t + 1.45, Array.from({ length: 10 }, (_, i) => mtof(pool[(i * 3) % pool.length]!)), 0.07, dB(-17), 0.7);
    },
  },

  cheer: {
    bus: 'sfx',
    level: -4,
    build: (p, c) => {
      const t = p.t, r = c.rng, m = p.mix(0.3);
      const jaw = p.filter('bandpass', 320, 4), tongue = p.filter('bandpass', 2400, 6), chest = p.filter('lowpass', 900, 0);
      jaw.frequency.setValueAtTime(320, t);
      jaw.frequency.exponentialRampToValueAtTime(620, t + 0.18);
      jaw.frequency.exponentialRampToValueAtTime(480, t + 0.7);
      tongue.frequency.setValueAtTime(2400, t);
      tongue.frequency.exponentialRampToValueAtTime(1900, t + 0.18);
      tongue.frequency.exponentialRampToValueAtTime(2250, t + 0.7);
      jaw.connect(m);
      tongue.connect(p.gain(0.6)).connect(m);
      chest.connect(p.gain(0.25)).connect(m);
      const pool = pentatonic(c.root, 62, 79);
      for (let i = 0; i < 7; i++) {
        const from = t + r.range(0, 0.09), length = r.range(0.5, 0.8), f = mtof(r.pick(pool)), end = swellEnd(from, 0.05, length - 0.3, 0.25);
        const voice = p.osc(shape(p.kit, 'reed'), f, from, end, r.range(-12, 12)), g = p.gain(0);
        voice.frequency.setValueAtTime(f * 0.75, from);
        voice.frequency.exponentialRampToValueAtTime(f, from + 0.12);
        voice.frequency.exponentialRampToValueAtTime(f * 0.94, from + length);
        swell(g.gain, from, dB(-16), 0.05, length - 0.3, 0.25);
        voice.connect(g);
        for (const mouth of [jaw, tongue, chest]) g.connect(mouth);
      }
      tick(p, m, t, dB(-16), 3000, 0.6);
      const high = pentatonic(c.root, 88, 100);
      sparkle(p, m, t + 0.1, [0, 2, 4, 3].map((k) => mtof(high[k]!)), 0.06, dB(-24), 0.4);
    },
  },

  fail: {
    bus: 'sfx',
    level: 1,
    build: (p, c) => {
      const t = p.t, soft = p.filter('lowpass', 2200, 0);
      [9, 7, 4].forEach((semis, i) => p.tone('triangle', mtof(c.root + 12 + semis), t + 0.19 * i, 0.5, dB(-16), 0.012).amp.connect(soft));
      soft.connect(p.mix(0.25));
    },
  },

  reveal: {
    bus: 'sfx',
    level: -2.5,
    build: (p) => {
      const t = p.t, m = p.mix(0.35);
      thump(p, m, t, 82, 36, 1.6, dB(-13));
      thump(p, m, t, 190, 74, 1.0, dB(-14));
      p.hiss('pink', t, 1.1, dB(-4), 0.01).amp.connect(p.filter('lowpass', 380, 0)).connect(m);
      notes('G4 D5 G5 D6 A6').forEach((n, i) => {
        const f = mtof(n), attack = 1.5 + 0.1 * i, end = swellEnd(t, attack, 0.2, 1);
        const o = p.osc('sine', f, t, end), g = p.gain(0), tremble = p.gain(0.65);
        glide(o.frequency, t, f, f * 1.06, 2.2);
        swell(g.gain, t, dB(-19 - i), attack, 0.2, 1);
        p.lfo(5 + i, 0.35, t, end).connect(tremble.gain);
        o.connect(g).connect(tremble).connect(m);
      });
      const air = p.filter('bandpass', 1200, 1.5), g = p.gain(0);
      glide(air.frequency, t, 1200, 7000, 2);
      swell(g.gain, t, dB(-9), 1.6, 0.1, 0.8);
      p.noise('pink', t, swellEnd(t, 1.6, 0.1, 0.8)).connect(air).connect(g).connect(m);
    },
  },
};
