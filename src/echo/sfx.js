// Small synthesised sounds, so the scene needs no audio files.
export function createSfx() {
  let ctx = null;
  let out = null;

  function unlock() {
    if (!ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      out = ctx.createGain();
      out.gain.value = 0.6;
      out.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function tone(freq, at, dur, { gain = 0.08, type = 'sine', to = null } = {}) {
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  return {
    unlock,
    notify() { tone(784, 0, 0.35, { gain: 0.06 }); tone(1175, 0.16, 0.5, { gain: 0.05 }); },
    confirm() { tone(660, 0, 0.12, { gain: 0.08 }); tone(990, 0.07, 0.2, { gain: 0.06 }); },
    tick() { tone(1200, 0, 0.06, { gain: 0.04, type: 'triangle' }); },
    send() { tone(520, 0, 0.18, { gain: 0.05, to: 780 }); },
    receive() { tone(880, 0, 0.14, { gain: 0.05 }); tone(1320, 0.1, 0.2, { gain: 0.04 }); },
    whoosh() { tone(220, 0, 1.2, { gain: 0.04, to: 880 }); },
  };
}
