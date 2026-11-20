import type { Line, SpeakerId } from '../story/script';
import type { Mixer } from './mixer';
import { dB } from './synth';
import { voiceFile } from './voiceFile';

const keyUrls = Object.values(import.meta.glob<string>('./keys/*.wav', { eager: true, query: '?url', import: 'default' }));
let keys: Promise<AudioBuffer[]> | undefined;
export const loadKeys = (ctx: BaseAudioContext): Promise<AudioBuffer[]> =>
  keys ??= Promise.all(keyUrls.map(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Keystroke sample: HTTP ${response.status}`);
    return ctx.decodeAudioData(await response.arrayBuffer());
  }));

const trimDb: Record<Exclude<SpeakerId, 'you'>, number> = {
  teacher: 0, jamie: 0, lumi: -4, kai: -2, nova: -3, alex: 6, sam: -9, riley: 0,
};

export class RecordedVoice {
  private readonly controller = new AbortController();
  private source: AudioBufferSourceNode | null = null;
  private paused = false;
  done = false;
  readonly ready: Promise<void>;

  constructor(mixer: Mixer, line: Line<Exclude<SpeakerId, 'you'>>, private readonly speed: number) {
    this.ready = this.load(mixer, line).catch((error) => {
      if (this.controller.signal.aborted) return;
      this.stop();
      throw error;
    });
  }

  private async load(mixer: Mixer, line: Line<Exclude<SpeakerId, 'you'>>): Promise<void> {
    const { signal } = this.controller;
    const file = voiceFile(line);
    const response = await fetch(`${import.meta.env.BASE_URL}assets/voices/${file}`, { signal });
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    const buffer = await mixer.ctx.decodeAudioData(await response.arrayBuffer());
    if (signal.aborted) return;
    const source = mixer.ctx.createBufferSource();
    this.source = source;
    source.buffer = buffer;
    source.playbackRate.value = this.paused ? 0 : this.speed;
    const gain = mixer.ctx.createGain();
    gain.gain.value = dB(trimDb[line.who]);
    source.connect(gain).connect(mixer.buses.voice);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      this.source = null;
      this.done = true;
    };
    source.start();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (this.source) this.source.playbackRate.value = paused ? 0 : this.speed;
  }

  stop(): void {
    if (this.done) return;
    this.done = true;
    this.controller.abort();
    this.source?.stop();
  }
}
