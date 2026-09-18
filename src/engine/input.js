// Input for the AIMBOT nerf gun.
//
// The gun's Pico enumerates as a USB HID mouse + keyboard, so every component arrives as an
// ordinary key or mouse event. This module turns those into named ACTIONS through the
// rebindable map in settings (S.binds), and runs the gyro look pipeline:
//   spike rejection -> deadzone -> One-Euro adaptive filter -> drift-bias cancellation ->
//   optional acceleration -> ADS scaling -> aim assist.
//
// Optional WebSerial link: the firmware's telemetry lines (T/I) expose raw gyro, joystick,
// potentiometer and pin states for the Gun Check screen. They never drive gameplay, so HID
// input is never double-counted.
import { S } from '../settings.js';

const DEG = Math.PI / 180;

/** event.code, rebuilt from event.key when a device or tool leaves it empty. */
function codeOf(e) {
  if (e.code) return e.code;
  const k = e.key || '';
  if (/^[a-z]$/i.test(k)) return 'Key' + k.toUpperCase();
  if (/^[0-9]$/.test(k)) return 'Digit' + k;
  const map = { ' ': 'Space', Shift: 'ShiftLeft', Control: 'ControlLeft', Alt: 'AltLeft', Escape: 'Escape',
    Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete',
    ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight' };
  return map[k] || '';
}

/** One-Euro filter: heavy smoothing while still, almost none during a fast flick. */
class OneEuro {
  constructor(dCutoff = 1.0) { this.dCutoff = dCutoff; this.xPrev = null; this.dxPrev = 0; }
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * Math.max(cutoff, 1e-4));
    return 1 / (1 + tau / Math.max(dt, 1e-5));
  }
  filter(x, dt, minCutoff, beta) {
    if (this.xPrev === null) { this.xPrev = x; this.dxPrev = 0; return x; }
    const dx = (x - this.xPrev) / Math.max(dt, 1e-5);
    const ad = OneEuro.alpha(this.dCutoff, dt);
    const edx = ad * dx + (1 - ad) * this.dxPrev;
    const cutoff = minCutoff + beta * Math.abs(edx);
    const a = OneEuro.alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;
    this.xPrev = xHat; this.dxPrev = edx;
    return xHat;
  }
  reset() { this.xPrev = null; this.dxPrev = 0; }
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.locked = false;
    // the aim-tuning screen reads raw pointer deltas without capturing the cursor
    this.captureUnlocked = false;
    // set while a match or the gun check runs, so input still works if the browser refuses
    // pointer lock (Brave shields, embedded frames, a denied permission)
    this.acceptUnlocked = false;
    // while true, game keys (Space, Tab, bound keys) don't reach page buttons
    this.gameActive = false;

    // Codes are keyboard `event.code` values plus 'Mouse0'..'Mouse4'.
    this.held = new Set();
    // The gun can press AND release between two frames. Edges are latched here until
    // endFrame(), so a quick tap is never lost.
    this.pressedCodes = new Set();
    this.releasedCodes = new Set();
    this.since = new Map();

    this.capture = null;            // pending rebind callback

    // accumulated raw counts since last consumeLook()
    this.accX = 0; this.accY = 0;
    this.lastCounts = { x: 0, y: 0 };
    this.filtX = new OneEuro(); this.filtY = new OneEuro();
    this.biasX = 0; this.biasY = 0;      // estimated drift, deg/sec
    this.restTime = 0;

    // telemetry
    this.stats = { hz: 0, raw: 0, filt: 0, jitter: 0, drift: 0, peak: 0 };
    this.trace = { raw: [], filt: [], max: 260 };
    this._events = 0; this._hzTimer = 0;
    this._restSamples = [];
    this._driftAccum = 0; this._driftTime = 0;

    this.serial = { port: null, reader: null, connected: false, mode: '-', lastYaw: null, lastPitch: null };
    this.tele = null;        // latest firmware telemetry frame
    this.teleInfo = '';      // latest firmware info line

    this.onLockChange = () => {};
    this.onLockError = () => {};
    this.onKeyPress = () => {};

    this._bind();
  }

  // ------------------------------------------------------------------ raw events
  _press(code) {
    if (this.held.has(code)) return;
    this.held.add(code);
    this.pressedCodes.add(code);
    this.since.set(code, performance.now() / 1000);
  }
  _release(code) {
    if (!this.held.has(code)) return;
    this.held.delete(code);
    this.releasedCodes.add(code);
  }
  releaseAll() { for (const c of [...this.held]) this._release(c); }

  _isBound(code) {
    for (const k in S.binds) if (S.binds[k].includes(code)) return true;
    return false;
  }

  _bind() {
    const c = this.canvas;
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === c;
      if (!this.locked) this.releaseAll();
      this.onLockChange(this.locked);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked && !this.captureUnlocked && !this.acceptUnlocked) return;
      this.accX += e.movementX || 0;
      this.accY += e.movementY || 0;
      this._events++;
    });

    // rebinding grabs the very next button, anywhere on the page
    document.addEventListener('mousedown', (e) => {
      if (!this.capture) return;
      e.preventDefault(); e.stopPropagation();
      this._finishCapture('Mouse' + e.button);
    }, true);
    document.addEventListener('contextmenu', (e) => {
      if (this.capture || this.gameActive) e.preventDefault();
    }, true);

    c.addEventListener('mousedown', (e) => {
      if (!this.locked && !this.acceptUnlocked) return;
      e.preventDefault();
      this._press('Mouse' + e.button);
    });
    window.addEventListener('mouseup', (e) => this._release('Mouse' + e.button));

    window.addEventListener('keydown', (e) => {
      const code = codeOf(e);
      if (!code) return;
      if (this.capture) {
        e.preventDefault(); e.stopPropagation();
        this._finishCapture(code);
        return;
      }
      if (this.gameActive && (code === 'Tab' || code === 'Space' || this._isBound(code))) e.preventDefault();
      if (e.repeat) return;
      this._press(code);
      this.onKeyPress(code);
    }, true);
    window.addEventListener('keyup', (e) => { const code = codeOf(e); if (code) this._release(code); });
    window.addEventListener('blur', () => this.releaseAll());
  }

  /** Wait for the next key or mouse button. cb(code) — code is null if cancelled with Esc. */
  captureNext(cb) { this.capture = cb; }
  cancelCapture() { this.capture = null; }
  _finishCapture(code) {
    const cb = this.capture;
    this.capture = null;
    this.captureEndedAt = performance.now();
    cb(code === 'Escape' ? null : code);
  }

  // unadjustedMovement disables OS pointer acceleration where supported (Chromium), which is
  // what you want for a gyro pointer — the OS curve would fight the filter below.
  requestLock() {
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) {
        p.catch(() => {
          try {
            const q = this.canvas.requestPointerLock();
            if (q && q.catch) q.catch(() => this.onLockError());
          } catch (e) { this.onLockError(); }
        });
      }
    } catch (e) { this.onLockError(); }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  // ------------------------------------------------------------------ actions
  _codes(action) { return (S.binds[action] || []).filter(Boolean); }

  isDown(action) { return this._codes(action).some(c => this.held.has(c)); }
  /** Pressed at any point since the last endFrame(), even if already released. */
  wasPressed(action) { return this._codes(action).some(c => this.pressedCodes.has(c)); }
  /** Released since the last endFrame() and not held down any more. */
  wasReleased(action) { return !this.isDown(action) && this._codes(action).some(c => this.releasedCodes.has(c)); }
  /** Seconds the action has been held (0 if up). */
  heldFor(action) {
    let t = 0;
    const now = performance.now() / 1000;
    for (const c of this._codes(action)) if (this.held.has(c)) t = Math.max(t, now - this.since.get(c));
    return t;
  }
  /** Any code at all pressed this frame — for diagnostics. */
  get pressedThisFrame() { return [...this.pressedCodes]; }
  endFrame() { this.pressedCodes.clear(); this.releasedCodes.clear(); }
  clearEdges() { this.endFrame(); }

  resetLook() {
    this.accX = this.accY = 0;
    this.filtX.reset(); this.filtY.reset();
    this.biasX = this.biasY = 0; this.restTime = 0;
    this.serial.lastYaw = this.serial.lastPitch = null;
  }

  /**
   * Turn accumulated raw counts into yaw/pitch deltas in radians.
   * ctx: { sensScale, assistYaw, assistPitch, slow, freeze }
   */
  consumeLook(dt, ctx = {}) {
    const sensScale = ctx.sensScale ?? 1;
    let rx = this.accX, ry = this.accY;
    this.accX = this.accY = 0;
    this.lastCounts.x = rx; this.lastCounts.y = ry;

    // --- telemetry: input report rate ---
    this._hzTimer += dt;
    if (this._hzTimer >= 0.5) { this.stats.hz = Math.round(this._events / this._hzTimer); this._events = 0; this._hzTimer = 0; }

    const rawMag = Math.hypot(rx, ry);
    this.stats.raw = rawMag;
    this.stats.peak = Math.max(this.stats.peak * 0.985, rawMag);

    if (ctx.freeze) return { yaw: 0, pitch: 0 };

    const motion = S.motionMode;

    // --- 1. spike rejection (I2C hiccups / USB batching) ---
    if (motion) {
      const cap = S.maxRate;
      if (rawMag > cap) { const k = cap / rawMag; rx *= k; ry *= k; }
    }

    // --- 2. deadzone: kill gyro noise while the gun is held still ---
    if (motion && S.deadzone > 0) {
      const dz = S.deadzone;
      if (rawMag < dz) { rx = 0; ry = 0; }
      else { const k = (rawMag - dz) / rawMag; rx *= k; ry *= k; }
    }

    // --- 3. adaptive smoothing, done on the RATE so it is framerate independent ---
    let vx = rx / Math.max(dt, 1e-5);
    let vy = ry / Math.max(dt, 1e-5);
    if (motion) {
      vx = this.filtX.filter(vx, dt, S.minCutoff, S.beta * 1000);
      vy = this.filtY.filter(vy, dt, S.minCutoff, S.beta * 1000);
    }
    this.stats.filt = Math.hypot(vx, vy) * dt;

    // --- 4. convert to degrees ---
    const degPerCount = S.sensitivity * 0.055;
    let dyawDeg = vx * degPerCount;
    let dpitchDeg = vy * degPerCount;

    // --- 5. drift-bias cancellation ---
    // While the gun is at rest, learn the steady gyro bias and subtract it (bounded).
    if (motion && S.driftComp > 0) {
      const atRest = rawMag < Math.max(S.deadzone * 2.2, 1.2);
      if (atRest) {
        this.restTime += dt;
        if (this.restTime > 0.25) {
          const k = 1 - Math.exp(-dt / 0.9);
          this.biasX += (dyawDeg - this.biasX) * k;
          this.biasY += (dpitchDeg - this.biasY) * k;
        }
      } else {
        this.restTime = 0;
      }
      const lim = S.driftComp;
      dyawDeg -= Math.max(-lim, Math.min(lim, this.biasX));
      dpitchDeg -= Math.max(-lim, Math.min(lim, this.biasY));
    }

    // drift measurement for the tuning screen (pre-compensation)
    if (rawMag < 1.2) { this._driftAccum += Math.hypot(this.biasX, this.biasY) * dt; this._driftTime += dt; }
    if (this._driftTime > 0.5) { this.stats.drift = this._driftAccum / this._driftTime; this._driftAccum = 0; this._driftTime = 0; }

    // jitter RMS while at rest
    if (rawMag < 3) {
      this._restSamples.push(rawMag);
      if (this._restSamples.length > 90) this._restSamples.shift();
      const m = this._restSamples.reduce((a, b) => a + b, 0) / this._restSamples.length;
      this.stats.jitter = Math.sqrt(this._restSamples.reduce((a, b) => a + (b - m) * (b - m), 0) / this._restSamples.length);
    }

    // --- 6. optional acceleration ---
    if (S.accel > 0) {
      const speed = Math.hypot(dyawDeg, dpitchDeg) / Math.max(dt, 1e-5);
      const gain = 1 + S.accel * Math.min(speed / 900, 2.2);
      dyawDeg *= gain; dpitchDeg *= gain;
    }

    // --- 7. scaling: ADS / scope / target slowdown ---
    const slow = 1 - (ctx.slow || 0);
    dyawDeg *= sensScale * slow;
    dpitchDeg *= sensScale * slow;

    // --- 8. aim assist (rotational magnetism, applied after user intent) ---
    let yaw = dyawDeg * dt * DEG;
    let pitch = dpitchDeg * dt * DEG * (S.invertY ? -1 : 1);
    if (ctx.assistYaw) yaw += ctx.assistYaw * dt;
    if (ctx.assistPitch) pitch += ctx.assistPitch * dt;

    // trace buffers for the tuning graph
    this.trace.raw.push(rawMag);
    this.trace.filt.push(Math.abs(vx * dt) + Math.abs(vy * dt));
    if (this.trace.raw.length > this.trace.max) { this.trace.raw.shift(); this.trace.filt.shift(); }

    return { yaw, pitch };
  }

  // ---------------------------------------------------------------- WebSerial
  // Lines from AIMBOT_master_v5 (115200 baud):
  //   T <gx10> <gy10> <gz10> <jx> <jy> <pot> <mask> <sens100> <mpuOk>   telemetry, ~25 Hz
  //   I <free text>                                                        info, every 2 s
  // Also accepted, for a firmware that wants to aim over serial instead of HID:
  //   M <dx> <dy>             relative counts
  //   A <yaw_deg> <pitch_deg> absolute orientation (differentiated here)
  async connectSerial() {
    if (!('serial' in navigator)) throw new Error('WebSerial is unavailable in this browser — use Chrome or Edge. The gun still plays fine without it.');
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    this.serial.port = port;
    this.serial.connected = true;
    // opening the port asserts DTR, which is what tells the firmware to start telemetry
    try { await port.setSignals({ dataTerminalReady: true }); } catch (e) {}
    this._readLoop(port);
    return true;
  }

  async _readLoop(port) {
    const dec = new TextDecoder();
    let buf = '';
    try {
      const reader = port.readable.getReader();
      this.serial.reader = reader;
      while (this.serial.connected) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          this._parseSerial(buf.slice(0, i).trim());
          buf = buf.slice(i + 1);
        }
        if (buf.length > 1024) buf = '';
      }
      reader.releaseLock();
    } catch (e) { /* unplugged */ }
    this.serial.connected = false;
  }

  _parseSerial(line) {
    if (!line) return;
    const tag = line[0].toUpperCase();
    if (tag === 'I') { this.teleInfo = line.slice(1).trim(); return; }
    const p = line.split(/[\s,]+/);
    if (tag === 'T' && p.length >= 8) {
      const n = p.slice(1).map(Number);
      this.tele = {
        gx: n[0] / 10, gy: n[1] / 10, gz: n[2] / 10,
        jx: n[3], jy: n[4], pot: n[5], mask: n[6] | 0,
        sens: (n[7] || 100) / 100, mpuOk: n[8] !== 0,
        at: performance.now(),
      };
    } else if (tag === 'M' && p.length >= 3) {
      this.accX += parseFloat(p[1]) || 0;
      this.accY += parseFloat(p[2]) || 0;
      this.serial.mode = 'relative';
      this._events++;
    } else if (tag === 'A' && p.length >= 3) {
      const yaw = parseFloat(p[1]), pitch = parseFloat(p[2]);
      if (Number.isFinite(yaw) && Number.isFinite(pitch)) {
        if (this.serial.lastYaw !== null) {
          let dy = yaw - this.serial.lastYaw;
          if (dy > 180) dy -= 360; if (dy < -180) dy += 360;
          const cpd = 1 / Math.max(S.sensitivity * 0.055, 1e-3);
          this.accX += dy * cpd;
          this.accY += (pitch - this.serial.lastPitch) * cpd;
        }
        this.serial.lastYaw = yaw; this.serial.lastPitch = pitch;
        this.serial.mode = 'absolute';
        this._events++;
      }
    }
  }

  /** Telemetry is considered live if a frame arrived in the last second. */
  get teleLive() { return !!this.tele && performance.now() - this.tele.at < 1000; }

  async disconnectSerial() {
    this.serial.connected = false;
    try { await this.serial.reader?.cancel(); } catch (e) {}
    try { await this.serial.port?.close(); } catch (e) {}
    this.serial.port = null;
  }
}
