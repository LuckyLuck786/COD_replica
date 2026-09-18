// Procedural WebAudio SFX. No asset files — everything is a 2.5 s white-noise buffer plus
// oscillators through a compressor, so the game runs with zero downloads.
export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.7;
    this.noiseBuf = null;
  }

  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 6;
    comp.connect(this.ctx.destination);
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp);

    const len = Math.floor(this.ctx.sampleRate * 2.5);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  noise(dur, filterHz, filterType = 'lowpass', gain = 1) {
    this.ensure();
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = filterType; filt.frequency.value = filterHz;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t); src.stop(t + dur);
    return { g, t };
  }

  tone(freq, dur, type = 'sine', gain = 0.4, glideTo = null) {
    this.ensure();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type; osc.frequency.setValueAtTime(freq, t);
    if (glideTo != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + dur);
  }

  shot(profile = 'rifle', dist = 0) {
    const atten = Math.max(0.15, 1 - dist / 60);
    const P = {
      rifle:  { dur: 0.16, hz: 1800, g: 0.9 },
      smg:    { dur: 0.10, hz: 2400, g: 0.75 },
      sniper: { dur: 0.30, hz: 900,  g: 1.1 },
      pistol: { dur: 0.09, hz: 2000, g: 0.6 },
    }[profile] || { dur: 0.14, hz: 1800, g: 0.8 };
    this.noise(P.dur, P.hz, 'lowpass', P.g * atten);
    this.tone(P.hz * 0.25, 0.05, 'square', 0.3 * atten);
  }

  hit(head = false) { this.tone(head ? 1400 : 900, 0.05, 'square', 0.35); }
  kill() { this.tone(500, 0.18, 'sawtooth', 0.3, 200); }
  hurt() { this.noise(0.2, 500, 'lowpass', 0.4); }
  reloadOut() { this.noise(0.06, 3000, 'highpass', 0.3); }
  reloadIn() { this.noise(0.08, 2200, 'bandpass', 0.35); }
  bolt() { this.noise(0.05, 3500, 'highpass', 0.25); }
  dryFire() { this.tone(200, 0.04, 'square', 0.2); }
  swap() { this.noise(0.07, 2000, 'bandpass', 0.3); }
  step() { this.noise(0.04, 500, 'lowpass', 0.15); }
  land() { this.noise(0.08, 300, 'lowpass', 0.3); }
  ric() { this.tone(1800, 0.12, 'sine', 0.2, 3000); }
  explosion(dist = 0) {
    const atten = Math.max(0.2, 1 - dist / 80);
    this.noise(0.9, 400, 'lowpass', 1.2 * atten);
    this.tone(60, 0.5, 'sine', 0.8 * atten, 20);
  }
  clink() { this.tone(2200, 0.05, 'triangle', 0.15); }
  pin() { this.tone(1200, 0.04, 'square', 0.15); }
  throwNade(dist = 0) { this.noise(0.08, 1500, 'bandpass', 0.3); }
  fuseTick(n = 0) { this.tone(1000 + n * 40, 0.04, 'square', 0.15); }
  danger() { this.tone(300, 0.3, 'square', 0.25, 250); }
  jet() { this.noise(0.6, 800, 'bandpass', 0.4); }
  denied() { this.tone(150, 0.15, 'square', 0.2); }
  ui() { this.tone(700, 0.04, 'sine', 0.2); }
  streak() { this.tone(400, 0.3, 'sawtooth', 0.4, 900); }
}

export const audio = new Audio();
