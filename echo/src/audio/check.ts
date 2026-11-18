import type * as THREE from 'three';
import { FRIDAY, MONDAY, TUESDAY, WEDNESDAY, type Line, type SpeakerId } from '../story/script';
import { SPACES, type BedName } from './beds';
import type { SfxName } from './GameAudio';
import { MAX_ONE_SHOTS, Mixer, type Space } from './mixer';
import { SFX } from './sfx';
import { dB } from './synth';
import { VOICES, loadKeySamples, syllablePitch } from './voices';
import { WebAudio } from './WebAudio';

const RATE = 48000;
const FRAME = 0.05;
const GATE_DB = -60;

export interface Row {
  group: string;
  name: string;
  peak: number;
  rms: number;
  active: number;
  seconds: number;
  note: string;
  problems: string[];
}

interface Level {
  peak: number;
  rms: number;
  active: number;
  step: number;
  sides: [number, number];
  finite: boolean;
}

const toDb = (linear: number): number => (linear > 0 ? 20 * Math.log10(linear) : -Infinity);
const round = (value: number, places = 1): number => (Number.isFinite(value) ? Number(value.toFixed(places)) : value);

const measure = (buffer: AudioBuffer, from = 0, to = buffer.duration): Level => {
  const rate = buffer.sampleRate, a = Math.max(0, Math.floor(from * rate)), b = Math.min(buffer.length, Math.floor(to * rate));
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const window = Math.floor(rate / 100), gate = dB(GATE_DB) ** 2;
  const sides: [number, number] = [0, 0];
  let step = 0, finite = true, activeWindows = 0, activePower = 0, activeCount = 0;
  for (let start = a; start < b; start += window) {
    const end = Math.min(b, start + window);
    let power = 0;
    channels.forEach((data, c) => {
      for (let i = start; i < end; i++) {
        const v = data[i]!;
        if (!Number.isFinite(v)) finite = false;
        if (Math.abs(v) > sides[c]!) sides[c] = Math.abs(v);
        if (i > a && Math.abs(v - data[i - 1]!) > step) step = Math.abs(v - data[i - 1]!);
        power += v * v;
      }
    });
    const count = (end - start) * channels.length;
    if (power / count > gate) {
      activeWindows++;
      activePower += power;
      activeCount += count;
    }
  }
  return { peak: toDb(Math.max(...sides)), rms: toDb(Math.sqrt(activeCount ? activePower / activeCount : 0)), active: activeWindows / 100, step, sides: [toDb(sides[0]), toDb(sides[1])], finite };
};

const cameraAt = (x = 0, y = 0, z = 0): THREE.Camera => ({ matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1] } }) as unknown as THREE.Camera;

const point = (x: number, y: number, z: number): THREE.Vector3 => ({ x, y, z }) as unknown as THREE.Vector3;

interface Take {
  buffer: AudioBuffer;
  audio: WebAudio;
}

let lastRender: AudioBuffer | null = null;

const render = async (seconds: number, script: (audio: WebAudio, time: number, frame: number) => boolean | void, frameSeconds = FRAME): Promise<Take> => {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * RATE), RATE);
  const audio = new WebAudio();
  audio.unlock(ctx);
  const camera = cameraAt();
  let failure: unknown = null;
  const frame = (i: number): void => {
    try {
      if (script(audio, i * frameSeconds, i) !== false) audio.update(frameSeconds, camera);
    } catch (e) {
      failure ??= e;
    }
  };
  const stopAt = (i: number): void => {
    if (i * frameSeconds >= seconds) return;
    void ctx.suspend(i * frameSeconds).then(() => {
      frame(i);
      stopAt(i + 1);
      void ctx.resume();
    });
  };
  frame(0);
  stopAt(1);
  const buffer = await ctx.startRendering();
  lastRender = buffer;
  if (failure) throw failure;
  audio.update(frameSeconds, camera);
  return { buffer, audio };
};

const at = (time: number, now: number, frameSeconds: number, action: () => void): void => {
  if (now >= time - 1e-9 && now < time + frameSeconds - 1e-9) action();
};

const row = (group: string, name: string, level: Level, seconds: number, note = ''): Row => {
  const problems: string[] = [];
  if (!level.finite) problems.push('contains NaN or Infinity');
  if (level.peak > 0) problems.push(`clips: peak ${round(level.peak)} dBFS`);
  return { group, name, peak: round(level.peak), rms: round(level.rms), active: round(level.active, 2), seconds, note, problems };
};

const expectPeak = (r: Row, [low, high]: readonly [number, number]): Row => {
  if (!(r.peak > GATE_DB)) r.problems.push('silent');
  else if (r.peak < low || r.peak > high) r.problems.push(`peak ${r.peak} dBFS is outside ${low}..${high}`);
  return r;
};

const expectFaultless = (r: Row, audio: WebAudio): Row => {
  if (audio.faults) r.problems.push(`${audio.faults} sound(s) failed to build: ${audio.lastFault}`);
  return r;
};

const SCAPE_PEAK: Record<BedName, readonly [number, number]> = {
  title: [-21, -15], haven: [-21, -15], havenEvening: [-22, -15], havenFestival: [-21, -15], ending: [-21, -15],
  classroomWarm: [-21, -15], bedroom: [-22, -15], unease: [-30, -18], classroom: [-42, -24],
};

const scape = async (name: BedName): Promise<Row> => {
  const seconds = 12;
  const { buffer, audio } = await render(seconds, (a, _t, frame) => {
    if (frame === 0) a.setSoundscape(name, 1.5);
  });
  const whole = measure(buffer), settled = measure(buffer, 2);
  const r = row('scape', name, { ...whole, rms: settled.rms }, seconds, `${SPACES[name]}, ${audio.stats.nodes} nodes`);
  if (settled.active < seconds - 2 - 0.1) r.problems.push(`falls silent for ${round(seconds - 2 - settled.active, 2)} s`);
  return expectFaultless(expectPeak(r, SCAPE_PEAK[name]), audio);
};

const movement = (buffer: AudioBuffer, from: number, to: number): number => {
  const levels: number[] = [];
  for (let t = from; t + 0.2 <= to; t += 0.2) levels.push(measure(buffer, t, t + 0.2).rms);
  const mean = levels.reduce((sum, v) => sum + v, 0) / levels.length;
  return Math.sqrt(levels.reduce((sum, v) => sum + (v - mean) ** 2, 0) / levels.length);
};

const arrival = async (): Promise<Row> => {
  const seconds = 12;
  const { buffer, audio } = await render(seconds, (a, t, frame) => {
    if (frame === 0) a.setSoundscape('bedroom', 1);
    at(2.6, t, FRAME, () => a.sfx('pickup'));
    at(3.5, t, FRAME, () => a.sfx('headsetOn'));
    at(4.25, t, FRAME, () => {
      a.setSoundscape('haven', 2.5);
      a.sfx('wipe');
    });
  });
  const crossing = measure(buffer, 4.25, 7.5), after = measure(buffer, 9, seconds);
  const r = row('story', 'headset on: bedroom to haven', measure(buffer), seconds, `wipe peaks at ${round(crossing.peak)} dBFS, haven settles at ${round(after.rms)} dB`);
  if (crossing.active < 3.2) r.problems.push('a gap between the two worlds');
  if (!(after.rms > -40)) r.problems.push('haven did not arrive');
  return expectFaultless(expectPeak(r, [-14, -6]), audio);
};

const turn = async (): Promise<Row> => {
  const seconds = 26;
  const { buffer, audio } = await render(seconds, (a, t, frame) => {
    if (frame === 0) a.setSoundscape('havenEvening', 1);
    at(13, t, FRAME, () => a.setSoundscape('unease', 3));
  });
  const evening = measure(buffer, 5, 13), unease = measure(buffer, 18, seconds);
  const before = movement(buffer, 5, 13), after = movement(buffer, 18, seconds);
  const r = row('story', 'the turn: evening to unease', measure(buffer), seconds, `level ${round(evening.rms)} to ${round(unease.rms)} dB; movement ${round(before, 2)} to ${round(after, 2)} dB`);
  if (Math.abs(unease.rms - evening.rms) > 5) r.problems.push('the level jumps at the turn');
  if (unease.peak > evening.peak + 1) r.problems.push('the turn is louder than what came before');
  if (!(after < 0.2 && after < before / 4)) r.problems.push(`the music should stop moving: ${round(before, 2)} dB of movement became ${round(after, 2)}`);
  return expectFaultless(r, audio);
};

const marathon = async (): Promise<Row> => {
  const seconds = 60, counts: number[] = [];
  const { buffer, audio } = await render(seconds, (a, t, frame) => {
    if (frame === 0) a.setSoundscape('havenFestival', 1.5);
    at(Math.round(t / 10) * 10, t, FRAME, () => counts.push(a.stats.nodes));
  });
  const settled = measure(buffer, 2);
  const r = row('limits', 'a minute of the festival', { ...measure(buffer), rms: settled.rms }, seconds, `nodes every 10 s: ${counts.slice(1).join(' ')}`);
  const early = counts[1] ?? 0, most = Math.max(...counts.slice(1));
  if (most > early * 1.4) r.problems.push(`nodes grow over time: ${early} at 10 s, ${most} later`);
  if (settled.active < seconds - 2 - 0.1) r.problems.push(`falls silent for ${round(seconds - 2 - settled.active, 2)} s`);
  return expectFaultless(expectPeak(r, [SCAPE_PEAK.havenFestival[0], SCAPE_PEAK.havenFestival[1] + 1.5]), audio);
};

const silence = async (): Promise<Row> => {
  const seconds = 12;
  const { buffer, audio } = await render(seconds, (a, t, frame) => {
    if (frame === 0) a.setSoundscape('haven', 1);
    at(3, t, FRAME, () => a.setSoundscape('silence', 1));
  });
  const before = measure(buffer, 1.5, 3), after = measure(buffer, seconds - 1), s = audio.stats;
  const r = row('scape', 'silence', measure(buffer), seconds, `after haven: last second peaks at ${round(after.peak)} dBFS`);
  if (!(before.peak > GATE_DB)) r.problems.push('haven was silent before the fade');
  if (after.peak > -80) r.problems.push(`not silent after the fade: ${round(after.peak)} dBFS`);
  if (s.beds || s.patches || s.nodes) r.problems.push(`left running: ${s.beds} beds, ${s.patches} patches, ${s.nodes} nodes`);
  return expectFaultless(r, audio);
};

const IN_HAVEN: ReadonlySet<SfxName> = new Set(['orbAppear', 'orbTake', 'orbThrow', 'ringHit', 'ringRim', 'orbFizzle', 'bridgeBuild', 'bridgeComplete', 'firework', 'gateOpen', 'cheer', 'fail']);
const LOUD: ReadonlySet<SfxName> = new Set(['ringHit', 'gateOpen']);
const FAINT: ReadonlySet<SfxName> = new Set(['uiHover', 'advance']);

const effect = async (name: SfxName, space: Space = IN_HAVEN.has(name) ? 'haven' : 'interior'): Promise<Row> => {
  const seconds = 9;
  const { buffer, audio } = await render(seconds, (a, _t, frame) => {
    if (frame === 0) a.engine?.setSpace(space, 0);
    if (frame === 1) a.sfx(name);
  });
  const s = audio.stats;
  const r = row('sfx', name, measure(buffer), seconds, `${SFX[name].bus} bus, ${space}`);
  if (s.voices || s.patches) r.problems.push(`still alive ${seconds} s later: ${s.voices} voices, ${s.patches} patches`);
  return expectFaultless(expectPeak(r, LOUD.has(name) ? [-8.5, -5.5] : FAINT.has(name) ? [-30, -17] : [-16, -8.5]), audio);
};

const crossings = (buffer: AudioBuffer): number => {
  const data = buffer.getChannelData(0);
  let count = 0;
  for (let i = 1; i < data.length; i++) if (data[i - 1]! < 0 !== data[i]! < 0) count++;
  return count / buffer.duration;
};

const options = async (): Promise<Row> => {
  const take = async (name: SfxName, o: { gain?: number; pitch?: number }): Promise<AudioBuffer> =>
    (await render(1.5, (a, _t, frame) => {
      if (frame === 1) a.sfx(name, o);
    })).buffer;
  const full = measure(await take('footstep', {})), soft = measure(await take('footstep', { gain: 0.35 }));
  const low = crossings(await take('orbThrow', { pitch: 0.85 })), high = crossings(await take('orbThrow', { pitch: 1.25 }));
  const drop = full.peak - soft.peak, expected = -20 * Math.log10(0.35);
  const r = row('sfx', 'gain and pitch options', soft, 1.5, `footstep at gain 0.35 is ${round(-drop)} dB; orbThrow at pitch 1.25 sits ${round(high / low, 2)}x higher than at 0.85`);
  if (Math.abs(drop - expected) > 0.5) r.problems.push(`gain 0.35 should take ${round(expected)} dB off, not ${round(drop)}`);
  if (!(high / low > 1.25)) r.problems.push('pitch does not raise the sound');
  return r;
};

const placement = async (): Promise<Row> => {
  const peaks: Level[] = [];
  for (const where of [undefined, point(8, 0, -2), point(0, 0, -70)]) {
    const { buffer } = await render(2, (a, _t, frame) => {
      if (frame === 1) a.sfx('ringHit', { at: where });
    });
    peaks.push(measure(buffer));
  }
  const [plain, right, far] = peaks as [Level, Level, Level];
  const lean = right.sides[1] - right.sides[0], drop = plain.peak - far.peak;
  const r = row('sfx', 'ringHit placed', right, 2, `right: R-L ${round(lean)} dB; 70 m ahead: ${round(-drop)} dB`);
  if (!(lean > 3 && lean < 12)) r.problems.push(`a sound on the right should lean right by 3..12 dB, not ${round(lean)}`);
  if (!(drop > 2 && drop < 7)) r.problems.push(`a distant sound should drop 2..7 dB, not ${round(drop)}`);
  return r;
};

const SAMPLE_LINES: Record<SpeakerId, Line> = {
  teacher: MONDAY.intro[0],
  jamie: WEDNESDAY.discussion[4],
  lumi: MONDAY.lumiHello[0],
  kai: TUESDAY.success[1],
  nova: TUESDAY.success[2],
  you: WEDNESDAY.discussion[1],
  alex: FRIDAY.voices[0],
  sam: FRIDAY.voices[2],
  riley: FRIDAY.voices[6],
};

const TYPE_SPEED = 46;

const voice = async (speaker: SpeakerId): Promise<Row> => {
  await loadKeySamples(new OfflineAudioContext(1, 1, 48000));
  const text = SAMPLE_LINES[speaker].text, frameSeconds = 1 / 60, seconds = round(text.length / TYPE_SPEED + 1.5, 2);
  let typed = 0, spoken = 0;
  const pitches: number[] = [];
  const { buffer, audio } = await render(seconds, (a, t, frame) => {
    if (frame === 0 && VOICES[speaker].kind === 'haven') a.engine?.setSpace('haven', 0);
    for (const shown = Math.min(text.length, Math.floor(t * TYPE_SPEED)); typed < shown; typed++) {
      const ch = text[typed] ?? ' ';
      if (typed % 3 !== 0 || !/[a-z0-9]/i.test(ch)) continue;
      a.voice(speaker, ch);
      pitches.push(syllablePitch(speaker, ch));
      spoken++;
    }
  }, frameSeconds);
  const low = Math.min(...pitches), high = Math.max(...pitches);
  const r = row('voice', speaker, measure(buffer), seconds, `${spoken} syllables, ${round(low, 0)}..${round(high, 0)} Hz around ${round(VOICES[speaker].base, 0)}`);
  for (const ch of 'abcxyz019') if (syllablePitch(speaker, ch) !== syllablePitch(speaker, ch)) r.problems.push(`pitch of "${ch}" is not repeatable`);
  if (!(low < VOICES[speaker].base && high > VOICES[speaker].base)) r.problems.push('the line does not move around the speaker\'s pitch');
  return expectFaultless(expectPeak(r, speaker === 'you' ? [-26, -15] : [-19, -10]), audio);
};

const charge = async (): Promise<Row> => {
  const seconds = 4;
  let idleNodes = -1;
  const { buffer, audio } = await render(seconds, (a, t, frame) => {
    if (frame === 0) a.engine?.setSpace('haven', 0);
    if (frame === 5) idleNodes = a.stats.nodes;
    a.setCharge(t < 0.5 ? 0 : t < 1.7 ? (t - 0.5) / 1.2 : t < 2 ? 1 : 0);
  });
  const rest = measure(buffer, 0, 0.5), rising = measure(buffer, 0.5, 1.7), full = measure(buffer, 1.75, 2), falling = measure(buffer, 2, 2.4), s = audio.stats;
  const r = row('charge', 'setCharge 0..1..0', measure(buffer), seconds, `full draw ${round(full.peak)} dBFS; largest step up ${round(rising.step, 4)}, held ${round(full.step, 4)}, down ${round(falling.step, 4)}`);
  if (rest.peak > -100) r.problems.push('sounds at zero charge');
  if (idleNodes !== 0) r.problems.push(`${idleNodes} nodes exist at zero charge`);
  if (!(full.peak > -30)) r.problems.push('inaudible at full charge');
  if (!(measure(buffer, 0.5, 0.9).rms < measure(buffer, 1.3, 1.7).rms)) r.problems.push('does not grow as the throw is drawn back');
  if (rising.step > full.step * 1.2 || falling.step > full.step * 1.2) r.problems.push('clicks while changing');
  if (s.patches || s.nodes) r.problems.push(`still running at zero charge: ${s.patches} patches, ${s.nodes} nodes`);
  return expectFaultless(expectPeak(r, [-26, -14]), audio);
};

const pause = async (): Promise<Row> => {
  const seconds = 9;
  const { buffer, audio } = await render(seconds, (a, t, frame) => {
    if (frame === 0) a.setSoundscape('haven', 1);
    at(3.5, t, FRAME, () => a.setPaused(true));
    at(5.5, t, FRAME, () => a.setPaused(false));
    return t < 3.5 || t >= 5.5;
  });
  const playing = measure(buffer, 2, 3.5), ducking = measure(buffer, 3.5, 3.7), paused = measure(buffer, 4.5, 5.5), resumed = measure(buffer, 7, 9);
  const r = row('pause', 'haven, paused 3.5..5.5 s', measure(buffer), seconds, `playing ${round(playing.rms)} dB, paused ${round(paused.peak)} dBFS peak, resumed ${round(resumed.rms)} dB`);
  if (paused.peak > -80) r.problems.push(`not silent while paused: ${round(paused.peak)} dBFS`);
  if (ducking.step > playing.step * 1.2) r.problems.push('clicks when pausing');
  if (Math.abs(resumed.rms - playing.rms) > 3) r.problems.push(`came back at ${round(resumed.rms)} dB, not ${round(playing.rms)}`);
  if (resumed.active < 1.9) r.problems.push('the music did not carry on after the pause');
  return expectFaultless(r, audio);
};

const flood = async (): Promise<Row> => {
  const seconds = 6;
  let most = 0;
  const { buffer, audio } = await render(seconds, (a, _t, frame) => {
    if (frame >= 2 && frame < 12) for (let i = 0; i < 6; i++) a.sfx(i % 2 ? 'uiSelect' : 'orbTake');
    most = Math.max(most, a.stats.voices);
  });
  const s = audio.stats;
  const r = row('limits', '60 one-shots in half a second', measure(buffer), seconds, `at most ${most} voices at once`);
  if (most !== MAX_ONE_SHOTS) r.problems.push(`expected the cap of ${MAX_ONE_SHOTS} voices to be reached and held, saw ${most}`);
  if (s.voices || s.patches || s.nodes) r.problems.push(`left running: ${s.voices} voices, ${s.patches} patches, ${s.nodes} nodes`);
  return expectFaultless(r, audio);
};

const unity = async (): Promise<Row> => {
  const ctx = new OfflineAudioContext(2, RATE, RATE), mixer = new Mixer(ctx);
  const tone = ctx.createOscillator(), level = ctx.createGain();
  level.gain.value = dB(-20);
  tone.connect(level).connect(mixer.buses.ui);
  tone.start();
  lastRender = await ctx.startRendering();
  const steady = measure(lastRender, 0.5);
  const r = row('limits', 'a -20 dBFS tone through the master chain', steady, 1, 'must come out at -20');
  if (Math.abs(steady.peak + 20) > 0.2) r.problems.push(`came out at ${round(steady.peak, 2)} dBFS`);
  return r;
};

const finale = async (): Promise<Row> => {
  const seconds = 12, frameSeconds = 1 / 60;
  const rockets = Array.from({ length: 18 }, (_, i) => ({ time: 3 + i / 3 + (i % 3) * 0.07, at: point(-24 + ((i * 37) % 48), 13 + ((i * 11) % 17), -58 + ((i * 23) % 40)) }));
  const cheers: SpeakerId[] = ['kai', 'nova', 'lumi'];
  let typed = 0;
  const { buffer, audio } = await render(seconds, (a, t, frame) => {
    if (frame === 0) a.setSoundscape('havenFestival', 1);
    at(2.9, t, frameSeconds, () => a.sfx('ringHit', { at: point(4, 6, -30) }));
    at(3, t, frameSeconds, () => a.sfx('gateOpen'));
    at(3, t, frameSeconds, () => a.sfx('bridgeComplete'));
    at(5.2, t, frameSeconds, () => a.sfx('cheer'));
    for (const rocket of rockets) at(rocket.time, t, frameSeconds, () => a.sfx('firework', { at: rocket.at }));
    if (t > 5.4) for (const shown = Math.floor((t - 5.4) * TYPE_SPEED); typed < shown; typed++) if (typed % 3 === 0) a.voice(cheers[Math.floor(typed / 40) % 3]!, 'abcdefghij'[typed % 10]!);
    if (t > 4 && t < 9 && frame % 22 === 0) a.sfx('footstep', { gain: 0.7 });
  }, frameSeconds);
  const r = row('limits', 'festival finale, everything at once', measure(buffer), seconds, 'must stay under 0 dBFS');
  if (r.peak > -1) r.problems.push(`too close to clipping: ${r.peak} dBFS`);
  return expectFaultless(r, audio);
};

export interface LiveReport {
  ok: boolean;
  state: string;
  sampleRate: number;
  ran: number;
  playing: number;
  paused: number;
  resumed: number;
  stats: WebAudio['stats'];
  problems: string[];
}

export const live = async (): Promise<LiveReport> => {
  const audio = new WebAudio(), problems: string[] = [];
  audio.setVolume(0.8);
  audio.setSoundscape('haven', 0.4);
  audio.sfx('uiSelect');
  if (audio.engine) problems.push('an audio context exists before unlock()');
  audio.unlock();
  audio.unlock();
  const engine = audio.engine;
  if (!engine) return { ok: false, state: 'none', sampleRate: 0, ran: 0, playing: -Infinity, paused: -Infinity, resumed: -Infinity, stats: audio.stats, problems: ['unlock() did not start an audio context'] };
  const ctx = engine.ctx, meter = ctx.createAnalyser(), samples = new Float32Array(2048);
  meter.fftSize = samples.length;
  engine.output.connect(meter);
  const camera = cameraAt(), started = ctx.currentTime;
  let running = true, gamePaused = false;
  const loop = (): void => {
    if (!running) return;
    if (!gamePaused) audio.update(1 / 60, camera);
    requestAnimationFrame(loop);
  };
  loop();
  const listen = async (wait: number, listenFor: number): Promise<number> => {
    await new Promise((resolve) => setTimeout(resolve, (wait - listenFor) * 1000));
    let loudest = -Infinity;
    const until = performance.now() + listenFor * 1000;
    while (performance.now() < until) {
      meter.getFloatTimeDomainData(samples);
      loudest = Math.max(loudest, toDb(Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length)));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return loudest;
  };

  for (const name of ['uiSelect', 'objective', 'footstep', 'orbTake'] as const) audio.sfx(name);
  audio.sfx('ringHit', { at: point(6, 3, -20) });
  for (const ch of 'hello') audio.voice('lumi', ch);
  audio.setCharge(0.6);
  const playing = await listen(1.6, 0.6);
  audio.setCharge(0);
  audio.setSoundscape('havenFestival', 0.5);
  audio.setPaused(true);
  gamePaused = true;
  const paused = await listen(1.2, 0.4);
  audio.setPaused(false);
  gamePaused = false;
  audio.sfx('bridgeBuild');
  const resumed = await listen(1.6, 0.6);
  audio.setSoundscape('silence', 0.2);
  running = false;

  const ran = ctx.currentTime - started;
  if (ctx.state !== 'running') problems.push(`context is ${ctx.state}`);
  if (ran < 3.5) problems.push(`the clock only advanced ${round(ran, 2)} s`);
  if (!(playing > -45)) problems.push(`quiet while playing: ${round(playing)} dB`);
  if (!(paused < -80)) problems.push(`not silent while paused: ${round(paused)} dB`);
  if (!(resumed > -45)) problems.push(`quiet after resuming: ${round(resumed)} dB`);
  if (audio.faults) problems.push(`${audio.faults} sound(s) failed to build: ${audio.lastFault}`);
  const report = { ok: problems.length === 0, state: ctx.state, sampleRate: ctx.sampleRate, ran: round(ran, 2), playing: round(playing), paused: round(paused), resumed: round(resumed), stats: audio.stats, problems };
  await (ctx as AudioContext).close();
  return report;
};

export const missing = (): string[] => {
  const scope = globalThis as { AudioContext?: unknown }, real = scope.AudioContext, problems: string[] = [];
  const warn = console.warn;
  scope.AudioContext = undefined;
  console.warn = () => undefined;
  try {
    const audio = new WebAudio();
    audio.unlock();
    audio.setSoundscape('haven');
    audio.sfx('ringHit');
    audio.voice('lumi', 'a');
    audio.setCharge(0.5);
    audio.update(1 / 60, cameraAt());
    audio.setVolume(0.5);
    audio.setPaused(true);
    if (audio.engine) problems.push('an engine exists without Web Audio');
  } catch (e) {
    problems.push(`threw without Web Audio: ${String(e)}`);
  } finally {
    scope.AudioContext = real;
    console.warn = warn;
  }
  return problems;
};

const PLAN: { name: string; run: () => Promise<Row> }[] = [
  ...(Object.keys(SCAPE_PEAK) as BedName[]).map((name) => ({ name: `scape ${name}`, run: () => scape(name) })),
  { name: 'scape silence', run: silence },
  ...(Object.keys(SFX) as SfxName[]).map((name) => ({ name: `sfx ${name}`, run: () => effect(name) })),
  { name: 'sfx footstep in haven', run: () => effect('footstep', 'haven') },
  { name: 'sfx options', run: options },
  { name: 'sfx placement', run: placement },
  ...(Object.keys(VOICES) as SpeakerId[]).map((name) => ({ name: `voice ${name}`, run: () => voice(name) })),
  { name: 'charge', run: charge },
  { name: 'pause', run: pause },
  { name: 'story arrival', run: arrival },
  { name: 'story turn', run: turn },
  { name: 'flood', run: flood },
  { name: 'unity', run: unity },
  { name: 'finale', run: finale },
  { name: 'marathon', run: marathon },
];

export const plan = (): string[] => PLAN.map((item) => item.name);

export const wav = (): string | null => {
  const buffer = lastRender;
  if (!buffer) return null;
  const channels = buffer.numberOfChannels, frames = buffer.length, bytes = new DataView(new ArrayBuffer(44 + frames * channels * 2));
  const text = (at: number, value: string): void => [...value].forEach((ch, i) => bytes.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  bytes.setUint32(4, bytes.byteLength - 8, true);
  text(8, 'WAVEfmt ');
  bytes.setUint32(16, 16, true);
  bytes.setUint16(20, 1, true);
  bytes.setUint16(22, channels, true);
  bytes.setUint32(24, buffer.sampleRate, true);
  bytes.setUint32(28, buffer.sampleRate * channels * 2, true);
  bytes.setUint16(32, channels * 2, true);
  bytes.setUint16(34, 16, true);
  text(36, 'data');
  bytes.setUint32(40, frames * channels * 2, true);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < frames; i++) bytes.setInt16(44 + (i * channels + c) * 2, Math.round(Math.max(-1, Math.min(1, data[i]!)) * 32767), true);
  }
  let binary = '';
  const raw = new Uint8Array(bytes.buffer);
  for (let i = 0; i < raw.length; i += 0x8000) binary += String.fromCharCode(...raw.subarray(i, i + 0x8000));
  return btoa(binary);
};

export const run = (index: number): Promise<Row> => {
  lastRender = null;
  return PLAN[index]!.run();
};
