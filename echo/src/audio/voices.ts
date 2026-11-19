import type { Line } from '../story/script';
import type { Mixer } from './mixer';
import { voiceFile } from './voiceFile';

export class RecordedVoice {
  private readonly controller = new AbortController();
  private source: AudioBufferSourceNode | null = null;
  private paused = false;
  done = false;
  readonly ready: Promise<void>;

  constructor(mixer: Mixer, line: Line, private readonly speed: number) {
    this.ready = this.load(mixer, line).catch((error) => {
      if (this.controller.signal.aborted) return;
      this.stop();
      throw error;
    });
  }

  private async load(mixer: Mixer, line: Line): Promise<void> {
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
    source.connect(mixer.buses.voice);
    source.onended = () => {
      source.disconnect();
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
