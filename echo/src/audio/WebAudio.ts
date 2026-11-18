import type * as THREE from 'three';
import { clamp01 } from '../core/math';
import type { SpeakerId } from '../story/script';
import { Bed, LOOKAHEAD, SPACES } from './beds';
import type { GameAudio, SfxName, SfxOptions, Soundscape } from './GameAudio';
import { shape } from './instruments';
import { Mixer } from './mixer';
import { SFX } from './sfx';
import { Patch, dB, mtof } from './synth';
import { loadKeySamples, speak } from './voices';

const SYLLABLE_GAP = 0.045;
const MIN_FADE = 0.05;
const CHARGE_GLIDE = 0.05;

interface ChargeTone {
  readonly patch: Patch;
  readonly base: number;
  readonly oscillators: readonly OscillatorNode[];
  readonly filter: BiquadFilterNode;
  readonly shimmer: GainNode;
  readonly amp: GainNode;
}

export class WebAudio implements GameAudio {
  private mixer: Mixer | null = null;
  private dead = false;
  private scape: Soundscape = 'silence';
  private fade = 1.5;
  private volume = 1;
  private paused = false;
  private bed: Bed | null = null;
  private readonly fading: Bed[] = [];
  private charge: ChargeTone | null = null;
  private chargeLevel = 0;
  private lastSyllable = -1;
  faults = 0;
  lastFault = '';

  unlock(context?: BaseAudioContext): void {
    if (this.dead) return;
    if (!this.mixer) {
      try {
        this.mixer = new Mixer(context ?? new AudioContext({ latencyHint: 'interactive' }));
      } catch (e) {
        this.dead = true;
        console.warn('ECHO: sound is unavailable on this device.', e);
        return;
      }
      void loadKeySamples(this.mixer.ctx);
      this.mixer.setVolume(this.volume);
      if (this.paused) this.mixer.setPaused(true);
      const scape = this.scape;
      this.scape = 'silence';
      this.setSoundscape(scape, this.fade);
    }
    this.mixer.wake();
  }

  private run(what: string, action: (mixer: Mixer) => void): void {
    const mixer = this.mixer;
    if (!mixer) return;
    try {
      action(mixer);
    } catch (e) {
      this.lastFault = `${what}: ${e instanceof Error ? e.message : String(e)}`;
      if (this.faults++ === 0) console.warn(`ECHO: a sound failed (${this.lastFault}).`);
    }
  }

  setSoundscape(scape: Soundscape, fadeSeconds = 1.5): void {
    if (scape === this.scape) return;
    this.scape = scape;
    this.fade = fadeSeconds;
    this.run(`soundscape ${scape}`, (mixer) => {
      const now = mixer.ctx.currentTime, fade = Math.max(fadeSeconds, MIN_FADE);
      if (this.bed) {
        this.bed.release(now, fade);
        this.fading.push(this.bed);
        this.bed = null;
      }
      if (scape === 'silence') return;
      mixer.setSpace(SPACES[scape], fade);
      this.bed = new Bed(mixer, scape, now, fade);
    });
  }

  sfx(name: SfxName, options: SfxOptions = {}): void {
    this.run(`sfx ${name}`, (mixer) => {
      const spec = SFX[name], root = this.bed?.rootAt(mixer.ctx.currentTime) ?? 60;
      mixer.play(spec.bus, (p) => spec.build(p, { rng: mixer.kit.rng, root, space: mixer.space }), { ...options, gain: (options.gain ?? 1) * dB(spec.level) });
    });
  }

  voice(speaker: SpeakerId, char: string): void {
    this.run(`voice ${speaker}`, (mixer) => {
      const now = mixer.ctx.currentTime;
      if (now - this.lastSyllable < SYLLABLE_GAP) return;
      this.lastSyllable = now;
      mixer.play('voice', (p) => speak(p, speaker, char));
    });
  }

  setCharge(amount: number): void {
    const level = clamp01(amount);
    if (Math.abs(level - this.chargeLevel) < 0.002 && (level > 0 || !this.charge)) return;
    this.chargeLevel = level;
    this.run('charge', (mixer) => {
      const now = mixer.ctx.currentTime;
      if (level === 0) {
        const tone = this.charge;
        if (!tone) return;
        this.charge = null;
        tone.amp.gain.setTargetAtTime(0, now, 0.03);
        tone.patch.release(now + 0.3);
        mixer.retire(tone.patch);
        return;
      }
      const tone = (this.charge ??= this.startCharge(mixer, now, mtof((this.bed?.rootAt(now) ?? 60) - 12)));
      for (const o of tone.oscillators) o.frequency.setTargetAtTime(tone.base * 2 ** (1.25 * level), now, CHARGE_GLIDE);
      tone.filter.frequency.setTargetAtTime(450 * 9 ** level, now, CHARGE_GLIDE);
      tone.shimmer.gain.setTargetAtTime(level * level, now, CHARGE_GLIDE);
      tone.amp.gain.setTargetAtTime(dB(-39 + 10 * level), now, CHARGE_GLIDE);
    });
  }

  private startCharge(mixer: Mixer, now: number, base: number): ChargeTone {
    const patch = new Patch(mixer.kit, now);
    const filter = patch.filter('lowpass', 450, 5), amp = patch.gain(0), shimmer = patch.gain(0);
    const oscillators = [-6, 6].map((cents) => patch.osc(shape(mixer.kit, 'soft'), base, now, undefined, cents));
    for (const o of oscillators) o.connect(filter);
    const octave = patch.osc('sine', base, now, undefined, 1200);
    oscillators.push(octave);
    octave.connect(shimmer).connect(patch.gain(0.35)).connect(amp);
    filter.connect(amp).connect(patch.mix(0.2));
    patch.out.connect(mixer.buses.sfx);
    return { patch, base, oscillators, filter, shimmer, amp };
  }

  update(_dt: number, camera: THREE.Camera): void {
    this.run('update', (mixer) => {
      mixer.setListener(camera.matrixWorld.elements);
      const now = mixer.ctx.currentTime;
      mixer.sweep(now);
      this.bed?.sweep(now);
      for (let i = this.fading.length - 1; i >= 0; i--) if (this.fading[i]!.sweep(now)) this.fading.splice(i, 1);
      this.bed?.compose(now, now + LOOKAHEAD);
    });
  }

  setVolume(master: number): void {
    this.volume = clamp01(master);
    this.run('volume', (mixer) => mixer.setVolume(this.volume));
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.run('pause', (mixer) => {
      mixer.setPaused(paused);
      if (!paused) mixer.wake();
    });
  }

  get engine(): Mixer | null {
    return this.mixer;
  }

  get stats(): { voices: number; patches: number; nodes: number; beds: number; faults: number } {
    const live = this.mixer?.kit.live;
    return { voices: this.mixer?.voices ?? 0, patches: live?.patches ?? 0, nodes: live?.nodes ?? 0, beds: (this.bed ? 1 : 0) + this.fading.length, faults: this.faults };
  }
}
