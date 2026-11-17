import { afterEach, describe, expect, it, vi } from 'vitest';
import { Autopilot } from '../../src/app/Game';
import { numberParam } from '../../src/app/params';
import { SKIN_TONES, loadSettings } from '../../src/app/settings';
import { ResolutionGovernor, tierForGpu } from '../../src/app/quality';
import { Rng, angleDelta, damp } from '../../src/core/math';
import { Cancelled, Signal, Tasks } from '../../src/core/tasks';
import { DAYS, FRIDAY, MONDAY, SPEAKERS, THURSDAY, TUESDAY, WEDNESDAY, type Line } from '../../src/story/script';
import { CHAPTERS, freshState, isChapter } from '../../src/story/state';
import { wrapText } from '../../src/ui/draw';
import { Colliders } from '../../src/world/colliders';

describe('Colliders', () => {
  it('keeps a circle outside a box and slides it along the face', () => {
    const c = new Colliders().box(0, 0, 1, 1);
    const p = c.resolve({ x: 0.9, z: 0.2 }, 0.3);
    expect(p.x).toBeCloseTo(1.3);
    expect(p.z).toBeCloseTo(0.2);
  });
  it('pushes out of a rotated box', () => {
    const c = new Colliders().box(0, 0, 2, 0.2, Math.PI / 2);
    const p = c.resolve({ x: 0.1, z: 1.5 }, 0.3);
    expect(Math.abs(p.x)).toBeGreaterThanOrEqual(0.5 - 1e-6);
  });
  it('keeps a circle outside a round obstacle, even from dead centre', () => {
    const c = new Colliders().circle(2, 2, 0.5);
    const p = c.resolve({ x: 2, z: 2 }, 0.25);
    expect(Math.hypot(p.x - 2, p.z - 2)).toBeCloseTo(0.75);
  });
  it('holds the player inside rectangular and circular bounds', () => {
    const rect = new Colliders();
    rect.bounds = { kind: 'rect', minX: -2, maxX: 2, minZ: -3, maxZ: 3 };
    expect(rect.resolve({ x: 5, z: -9 }, 0.3)).toEqual({ x: 1.7, z: -2.7 });
    const round = new Colliders();
    round.bounds = { kind: 'circle', cx: 0, cz: 0, r: 5 };
    const p = round.resolve({ x: 30, z: 0 }, 0.5);
    expect(p.x).toBeCloseTo(4.5);
  });
  it('settles in a corner between two obstacles instead of oscillating', () => {
    const c = new Colliders().box(0, 0, 1, 1).box(2.2, 0, 1, 1);
    c.bounds = { kind: 'rect', minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
    const p = c.resolve({ x: 1.1, z: 0 }, 0.3);
    expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
  });
  it('forgets an obstacle that is removed', () => {
    const c = new Colliders().circle(0, 0, 1);
    c.remove(c.obstacles[0]!);
    expect(c.resolve({ x: 0.1, z: 0 }, 0.2)).toEqual({ x: 0.1, z: 0 });
  });
});

describe('Tasks', () => {
  it('waits on game time, not wall time', async () => {
    const tasks = new Tasks();
    let done = false;
    void tasks.wait(1).then(() => (done = true));
    tasks.update(0.5);
    await Promise.resolve();
    expect(done).toBe(false);
    tasks.update(0.6);
    await Promise.resolve();
    expect(done).toBe(true);
  });
  it('ends a tween on exactly 1', async () => {
    const tasks = new Tasks();
    const seen: number[] = [];
    const p = tasks.tween(1, (k) => seen.push(k), (t) => t);
    for (let i = 0; i < 7; i++) tasks.update(0.2);
    await p;
    expect(seen[0]).toBe(0);
    expect(seen[seen.length - 1]).toBe(1);
  });
  it('rejects with Cancelled when its signal aborts, and stops stepping', async () => {
    const tasks = new Tasks();
    const controller = new AbortController();
    let steps = 0;
    const p = tasks.until(() => {
      steps++;
      return false;
    }, controller.signal);
    tasks.update(0.1);
    controller.abort();
    tasks.update(0.1);
    await expect(p).rejects.toBeInstanceOf(Cancelled);
    expect(steps).toBe(1);
  });
  it('rejects at once for a signal that is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new Tasks().wait(1, controller.signal)).rejects.toBeInstanceOf(Cancelled);
  });
});

describe('Signal', () => {
  it('delivers to listeners and lets them unsubscribe', () => {
    const s = new Signal<number>();
    const got: number[] = [];
    const off = s.on((v) => got.push(v));
    s.emit(1);
    off();
    s.emit(2);
    expect(got).toEqual([1]);
  });
});

describe('math', () => {
  it('Rng is repeatable for a seed', () => {
    const a = new Rng(42), b = new Rng(42);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });
  it('damp approaches without overshooting at any frame rate', () => {
    let slow = 0, fast = 0;
    for (let i = 0; i < 30; i++) slow = damp(slow, 1, 8, 1 / 30);
    for (let i = 0; i < 120; i++) fast = damp(fast, 1, 8, 1 / 120);
    expect(slow).toBeCloseTo(fast, 5);
    expect(slow).toBeLessThan(1);
  });
  it('angleDelta takes the short way round', () => {
    expect(angleDelta(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(-0.2);
    expect(angleDelta(-3, 3)).toBeCloseTo(-(2 * Math.PI - 6));
  });
});

describe('wrapText', () => {
  const measure = (s: string): number => s.length;
  it('breaks on words and never mid-word', () => {
    expect(wrapText(measure, 'one two three four', 9)).toEqual(['one two', 'three', 'four']);
  });
  it('keeps explicit line breaks and a single over-long word', () => {
    expect(wrapText(measure, 'a\nbb', 10)).toEqual(['a', 'bb']);
    expect(wrapText(measure, 'supercalifragilistic', 5)).toEqual(['supercalifragilistic']);
  });
});

describe('ResolutionGovernor', () => {
  it('drops the scale after sustained slow frames and recovers after sustained fast ones', () => {
    const changes: number[] = [];
    const g = new ResolutionGovernor((s) => changes.push(s));
    for (let i = 0; i < 200; i++) g.sample(34);
    expect(g.scale).toBeLessThan(1);
    const low = g.scale;
    for (let i = 0; i < 4000; i++) g.sample(16.6);
    expect(g.scale).toBeGreaterThan(low);
    expect(changes.length).toBeGreaterThan(1);
  });
  it('ignores a stall and stays put when pinned', () => {
    const g = new ResolutionGovernor(() => undefined);
    for (let i = 0; i < 50; i++) g.sample(900);
    expect(g.scale).toBe(1);
    const pinned = new ResolutionGovernor(() => undefined, 0.6);
    for (let i = 0; i < 300; i++) pinned.sample(40);
    expect(pinned.scale).toBe(0.6);
  });
  it('starts a new world at full resolution and ignores its slow first seconds', () => {
    const g = new ResolutionGovernor(() => undefined);
    for (let i = 0; i < 200; i++) g.sample(34);
    expect(g.scale).toBeLessThan(1);
    g.reset(3000);
    expect(g.scale).toBe(1);
    // 2.7 s of loading stalls: none of it counts
    for (let i = 0; i < 80; i++) g.sample(34);
    expect(g.scale).toBe(1);
    // slowness that lasts past the settling time still counts
    for (let i = 0; i < 200; i++) g.sample(34);
    expect(g.scale).toBeLessThan(1);
  });
});

describe('the script', () => {
  const allLines: Line[] = [
    ...MONDAY.intro, ...MONDAY.thanks, ...TUESDAY.welcome, ...TUESDAY.invite, ...TUESDAY.retry, ...TUESDAY.success, ...TUESDAY.message,
    ...TUESDAY.meet.reply, ...TUESDAY.meet.scene, ...TUESDAY.meet.thanks, ...TUESDAY.stay.reply, ...TUESDAY.stay.back, ...TUESDAY.stay.cheers,
    ...WEDNESDAY.intro, ...WEDNESDAY.greeting, ...WEDNESDAY.greetingMet, ...WEDNESDAY.greetingStayed, ...WEDNESDAY.discussion, ...WEDNESDAY.evening,
    ...WEDNESDAY.pause, ...WEDNESDAY.offer, ...THURSDAY.intro, ...THURSDAY.oneMore, ...THURSDAY.message, ...THURSDAY.help.reply, ...THURSDAY.help.call,
    ...THURSDAY.haven.reply, ...THURSDAY.haven.back, ...THURSDAY.haven.cheers, ...FRIDAY.intro, ...FRIDAY.voices, ...FRIDAY.framing, ...FRIDAY.closing,
  ];
  it('gives every line a known speaker and some words', () => {
    for (const line of allLines) {
      expect(SPEAKERS[line.who], line.who).toBeDefined();
      expect(line.text.trim().length).toBeGreaterThan(0);
    }
  });
  it('offers three policies, each with a future that names a gain, a cost and a question', () => {
    expect(FRIDAY.vote.options).toHaveLength(3);
    expect(FRIDAY.vote.policies).toEqual(['expand', 'combined', 'investigate']);
    for (const policy of FRIDAY.vote.policies) {
      const f = FRIDAY.futures[policy];
      for (const text of [f.title, f.summary, f.gain.head, f.gain.body, f.cost.head, f.cost.body, f.question]) expect(text.length).toBeGreaterThan(3);
    }
  });
  it('gives both decisions two options, and both outcomes of each a gain and a cost', () => {
    expect(TUESDAY.decision.options).toHaveLength(2);
    expect(THURSDAY.decision.options).toHaveLength(2);
    for (const r of [TUESDAY.meet.result, TUESDAY.stay.result, THURSDAY.help.result, THURSDAY.haven.result]) {
      expect(r.gained.length).toBeGreaterThan(10);
      expect(r.missed.length).toBeGreaterThan(10);
    }
  });
  it('has a title card for every part of the week', () => {
    for (const d of Object.values(DAYS)) expect(d.day.length && d.place.length).toBeTruthy();
  });
});

describe('story state', () => {
  it('starts with nothing decided and no score to keep', () => {
    expect(freshState()).toEqual({ tuesdayChoice: null, thursdayChoice: null, policyChoice: null });
  });
  it('knows the five days in order', () => {
    expect(CHAPTERS).toEqual(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
    expect(isChapter('wednesday')).toBe(true);
    expect(isChapter('saturday')).toBe(false);
    expect(isChapter(null)).toBe(false);
  });
});

describe('Autopilot', () => {
  it('answers each decision from its plan', async () => {
    const auto = new Autopilot();
    auto.plan = { tuesday: 'haven', thursday: 'help', policy: 'investigate', misses: 0 };
    expect(await auto.choose(TUESDAY.decision.title, 2)).toBe(1);
    expect(await auto.choose(THURSDAY.decision.title, 2)).toBe(0);
    expect(await auto.choose(FRIDAY.vote.title, 3)).toBe(2);
    expect(await auto.choose(TUESDAY.meet.posterTitle, 3)).toBe(0);
  });
});

describe('numberParam', () => {
  const p = new URLSearchParams('speed=8&dpr=abc&scale=&after=-3&misses=1e9&t=2.5');
  it('reads a number and keeps it in range', () => {
    expect(numberParam(p, 'speed', 1, 1, 16)).toBe(8);
    expect(numberParam(p, 't', 0, 0, 10)).toBe(2.5);
    expect(numberParam(p, 'after', 1.2, 0, 600)).toBe(0);
    expect(numberParam(p, 'misses', 0, 0, 99)).toBe(99);
  });
  it('falls back when the value is missing, empty or not a number', () => {
    expect(numberParam(p, 'absent', 2, 0.5, 3)).toBe(2);
    expect(numberParam(p, 'scale', 1, 0.3, 1)).toBe(1);
    expect(numberParam(p, 'dpr', 2, 0.5, 3)).toBe(2);
  });
});

describe('tierForGpu', () => {
  it('starts integrated and software graphics on medium', () => {
    for (const name of [
      'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)',
      'Mali-G78',
    ]) expect(tierForGpu(name), name).toBe('medium');
  });
  it('starts discrete and Apple graphics, and a GPU that will not give its name, on high', () => {
    for (const name of [
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 Ti (0x00002203) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (AMD, AMD Radeon RX 6600 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)',
      '',
    ]) expect(tierForGpu(name), name).toBe('high');
  });
});

describe('loadSettings', () => {
  const stored = (value: string | null): void => {
    vi.stubGlobal('localStorage', { getItem: () => value, setItem: () => undefined, removeItem: () => undefined });
  };
  afterEach(() => vi.unstubAllGlobals());

  it('gives the defaults when nothing is saved or storage is missing', () => {
    const fresh = loadSettings();
    expect(fresh).toEqual({ quality: 'auto', volume: 0.8, autoAdvance: true, sensitivity: 1, skin: 1 });
    stored(null);
    expect(loadSettings()).toEqual(fresh);
  });
  it('keeps what is valid', () => {
    stored(JSON.stringify({ quality: 'low', volume: 0.25, autoAdvance: false, sensitivity: 1.5, skin: 3 }));
    expect(loadSettings()).toEqual({ quality: 'low', volume: 0.25, autoAdvance: false, sensitivity: 1.5, skin: 3 });
  });
  it('replaces what is damaged or out of range, field by field', () => {
    stored(JSON.stringify({ quality: 'banana', volume: 9, autoAdvance: 'yes', sensitivity: null, skin: 40 }));
    expect(loadSettings()).toEqual({ quality: 'auto', volume: 1, autoAdvance: true, sensitivity: 1, skin: SKIN_TONES.length - 1 });
    for (const junk of ['not json', '[]', 'null', '42']) {
      stored(junk);
      expect(loadSettings().volume, junk).toBe(0.8);
    }
  });
});
