// Fully procedural audio — no asset files, so the game stays a self-contained folder.
import { S } from '../settings.js';

export class Audio {
  constructor() { this.ctx = null; this.master = null; this.noiseBuf = null; }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = S.masterVolume;
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 8;
    this.master.connect(this.comp).connect(this.ctx.destination);

    const len = this.ctx.sampleRate * 2.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  resume() { this.init(); if (this.ctx?.state === 'suspended') this.ctx.resume(); }
  setVolume(v) { if (this.master) this.master.gain.value = v; }
  get t() { return this.ctx.currentTime; }

  _noise(dur, gain, filterType, f0, f1, q = 1) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const flt = this.ctx.createBiquadFilter();
    flt.type = filterType; flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, this.t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(f1, 40), this.t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, this.t);
    g.gain.exponentialRampToValueAtTime(0.0008, this.t + dur);
    src.connect(flt).connect(g).connect(this.master);
    src.start(); src.stop(this.t + dur + 0.02);
    return g;
  }

  _tone(type, f0, f1, dur, gain) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, this.t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), this.t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, this.t);
    g.gain.exponentialRampToValueAtTime(0.0008, this.t + dur);
    o.connect(g).connect(this.master);
    o.start(); o.stop(this.t + dur + 0.02);
  }

  shot(profile = 'rifle', dist = 0) {
    if (!this.ctx) return;
    const atten = 1 / (1 + dist * 0.09);
    const P = {
      rifle: { d: 0.20, g: 0.55, f0: 5200, f1: 260, body: 150 },
      smg:   { d: 0.14, g: 0.42, f0: 6200, f1: 340, body: 190 },
      sniper:{ d: 0.55, g: 0.80, f0: 3600, f1: 120, body: 90 },
      pistol:{ d: 0.16, g: 0.45, f0: 5600, f1: 300, body: 170 },
    }[profile] || {};
    this._noise(P.d, P.g * atten, 'lowpass', P.f0, P.f1);
    this._tone('triangle', P.body, P.body * 0.35, P.d * 0.8, 0.28 * atten);
    // tail / room reflection
    setTimeout(() => { if (this.ctx) this._noise(P.d * 2.4, 0.09 * atten, 'bandpass', 900, 300, 0.7); }, 38);
  }

  hit(head = false) { if (this.ctx && S.hitSound) this._tone('square', head ? 1750 : 1150, head ? 1200 : 780, 0.05, 0.16); }
  kill() { if (this.ctx) { this._tone('square', 1500, 900, 0.06, 0.18); setTimeout(() => this.ctx && this._tone('square', 1900, 1400, 0.08, 0.16), 65); } }
  hurt() { if (this.ctx) { this._noise(0.22, 0.30, 'lowpass', 900, 90); this._tone('sine', 90, 45, 0.3, 0.22); } }
  reloadOut() { if (this.ctx) { this._noise(0.06, 0.20, 'bandpass', 2600, 1500, 3); this._tone('square', 320, 190, 0.05, 0.07); } }
  reloadIn() { if (this.ctx) { this._noise(0.07, 0.24, 'bandpass', 1700, 800, 3); this._tone('square', 220, 140, 0.06, 0.09); } }
  bolt() { if (this.ctx) { this._noise(0.09, 0.22, 'bandpass', 3400, 900, 4); } }
  dryFire() { if (this.ctx) this._noise(0.04, 0.18, 'highpass', 3000, 2200, 2); }
  swap() { if (this.ctx) this._noise(0.10, 0.16, 'bandpass', 1400, 700, 2); }
  step(run) { if (this.ctx) this._noise(run ? 0.09 : 0.12, run ? 0.10 : 0.055, 'lowpass', 1100, 220); }
  land() { if (this.ctx) { this._noise(0.16, 0.16, 'lowpass', 700, 120); this._tone('sine', 110, 50, 0.14, 0.12); } }
  ric(dist = 0) { if (this.ctx) this._noise(0.10, 0.14 / (1 + dist * 0.12), 'bandpass', 3200, 1100, 5); }
  explosion(dist = 0) {
    if (!this.ctx) return;
    const a = 1 / (1 + dist * 0.05);
    this._noise(1.4, 0.95 * a, 'lowpass', 2400, 60);
    this._tone('sine', 70, 28, 0.9, 0.7 * a);
    this._tone('triangle', 140, 40, 0.5, 0.35 * a);
    setTimeout(() => this.ctx && this._noise(1.8, 0.22 * a, 'bandpass', 500, 120, 0.6), 90);
  }
  clink(dist = 0) { if (this.ctx) this._tone('square', 2100 + Math.random() * 500, 1500, 0.05, 0.08 / (1 + dist * 0.15)); }
  pin() { if (!this.ctx) return; this._noise(0.05, 0.25, 'highpass', 4200, 3000, 3); setTimeout(() => this.ctx && this._tone('square', 1300, 900, 0.04, 0.08), 70); }
  throwNade(dist = 0) { if (this.ctx) this._noise(0.22, 0.18 / (1 + dist * 0.1), 'bandpass', 900, 2600, 1.5); }
  fuseTick(n) { if (this.ctx) this._tone('sine', 880 + n * 140, 880 + n * 140, 0.05, 0.05); }
  danger() { if (this.ctx) this._tone('square', 1400, 1400, 0.07, 0.07); }
  jet() {
    if (!this.ctx) return;
    this._noise(2.4, 0.4, 'bandpass', 300, 2800, 0.8);
    this._tone('sawtooth', 180, 90, 2.0, 0.08);
  }
  denied() { if (this.ctx) { this._tone('square', 300, 220, 0.12, 0.08); } }
  ui() { if (this.ctx) this._tone('sine', 760, 620, 0.05, 0.07); }
  streak() {
    if (!this.ctx) return;
    [660, 880, 1320].forEach((f, i) => setTimeout(() => this.ctx && this._tone('sine', f, f, 0.16, 0.13), i * 110));
  }
}
