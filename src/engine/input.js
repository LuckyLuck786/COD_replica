// The heart of the motion control: bindable actions with press-latching (so a microcontroller's
// press-and-release inside one frame is never lost), pointer lock, rebind capture, the One-Euro
// gyro look pipeline, and an optional WebSerial telemetry link (never drives gameplay).
import { DEFAULT_BINDS } from './controls.js';

const MOUSE_CODE = (btn) => `Mouse${btn}`;

/** event.code, rebuilt from event.key when a device/IME leaves it empty ('g' -> 'KeyG'). */
export function codeOf(e) {
  if (e.code) return e.code;
  const k = e.key;
  if (!k) return '';
  if (k.length === 1 && /[a-zA-Z]/.test(k)) return 'Key' + k.toUpperCase();
  if (k.length === 1 && /[0-9]/.test(k)) return 'Digit' + k;
  const map = { ' ': 'Space', Shift: 'ShiftLeft', Control: 'ControlLeft', Alt: 'AltLeft' };
  return map[k] || k;
}

class OneEuro {
  constructor(minCutoff, beta) {
    this.minCutoff = minCutoff; this.beta = beta;
    this.xPrev = null; this.dxPrev = 0;
  }
  alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / Math.max(dt, 1e-4));
  }
  filter(x, dt) {
    if (this.xPrev == null) { this.xPrev = x; return x; }
    const dx = (x - this.xPrev) / Math.max(dt, 1e-4);
    const aD = this.alpha(1.0, dt);
    this.dxPrev = aD * dx + (1 - aD) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxPrev);
    const a = this.alpha(cutoff, dt);
    const xFilt = a * x + (1 - a) * this.xPrev;
    this.xPrev = xFilt;
    return xFilt;
  }
}

export class Input {
  constructor(settings) {
    this.S = settings;
    this.held = new Set();
    this.pressedCodes = new Set();
    this.releasedCodes = new Set();
    this.since = new Map();
    this._rawDX = 0; this._rawDY = 0;
    this._captureCb = null;
    this._captureEndedAt = 0;
    this.locked = false;
    this.acceptUnlocked = false;
    this.onLockError = null;
    this.el = null;

    this._filtX = new OneEuro(settings.aim.minCutoff, settings.aim.beta);
    this._filtY = new OneEuro(settings.aim.minCutoff, settings.aim.beta);
    this._restSince = 0;
    this._biasX = 0; this._biasY = 0;

    this.tele = { hz: 0, raw: 0, filt: 0, jitter: 0, drift: 0, peak: 0, rawTrace: [], filtTrace: [] };
    this._jitterSamples = [];

    this.serial = null;
    this.teleLive = false;
    this._lastTeleAt = 0;
    this._serialState = { gx: 0, gy: 0, gz: 0, joyX: 0, joyY: 0, pot: 0, mask: 0, sens: 1, mpuOk: false, info: '' };

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onLockChange = this._onLockChange.bind(this);
    this._onLockErrorInternal = this._onLockErrorInternal.bind(this);
  }

  attach(el) {
    this.el = el;
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    el.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('pointerlockerror', this._onLockErrorInternal);
  }

  // ---------------------------------------------------------------- press latching
  _press(code) {
    if (!code) return;
    if (this._captureCb) {
      if (code === 'Escape') { this._captureCb = null; return; }
      if (code === 'Backspace' || code === 'Delete') { this._captureCb(''); this._captureCb = null; this._captureEndedAt = performance.now(); return; }
      this._captureCb(code); this._captureCb = null; this._captureEndedAt = performance.now();
      return;
    }
    if (!this.held.has(code)) {
      this.held.add(code);
      this.pressedCodes.add(code);
      this.since.set(code, performance.now());
    }
  }

  _release(code) {
    if (!code) return;
    if (this.held.has(code)) {
      this.held.delete(code);
      this.releasedCodes.add(code);
    }
  }

  _onKeyDown(e) { this._press(codeOf(e)); }
  _onKeyUp(e) { this._release(codeOf(e)); }

  _onMouseDown(e) {
    if (performance.now() - this._captureEndedAt < 150) return; // guard the click that follows a capture
    if (!this.locked && !this.acceptUnlocked) { this.requestLock(); return; }
    this._press(MOUSE_CODE(e.button));
  }
  _onMouseUp(e) { this._release(MOUSE_CODE(e.button)); }

  _onMouseMove(e) {
    this._rawDX += e.movementX || 0;
    this._rawDY += e.movementY || 0;
  }

  // ---------------------------------------------------------------- pointer lock
  requestLock() {
    if (!this.el) return;
    const p = this.el.requestPointerLock({ unadjustedMovement: true });
    if (p && p.catch) {
      p.catch(() => {
        const p2 = this.el.requestPointerLock();
        if (p2 && p2.catch) p2.catch((err) => this.onLockError && this.onLockError(err));
      });
    }
  }
  _onLockChange() { this.locked = document.pointerLockElement === this.el; }
  _onLockErrorInternal(e) { this.onLockError && this.onLockError(e); }

  // ---------------------------------------------------------------- rebinding
  captureNext(cb) { this._captureCb = cb; }

  // ---------------------------------------------------------------- action API
  _codesFor(action) {
    const b = this.S.binds[action] || DEFAULT_BINDS[action] || ['', ''];
    return b;
  }
  isDown(action) {
    const [a, b] = this._codesFor(action);
    return (a && this.held.has(a)) || (b && this.held.has(b));
  }
  wasPressed(action) {
    const [a, b] = this._codesFor(action);
    return (a && this.pressedCodes.has(a)) || (b && this.pressedCodes.has(b));
  }
  wasReleased(action) {
    const [a, b] = this._codesFor(action);
    return (a && this.releasedCodes.has(a)) || (b && this.releasedCodes.has(b));
  }
  heldFor(action) {
    const [a, b] = this._codesFor(action);
    const ta = a && this.since.has(a) ? performance.now() - this.since.get(a) : -1;
    const tb = b && this.since.has(b) ? performance.now() - this.since.get(b) : -1;
    if (!this.isDown(action)) return -1;
    return Math.max(ta, tb);
  }
  endFrame() {
    this.pressedCodes.clear();
    this.releasedCodes.clear();
  }

  // ---------------------------------------------------------------- the look pipeline
  /**
   * ctx: { ads, scope, targetSlowdown, assist: {x, y} in degrees already computed by aim-assist,
   *        useSerial }
   * Returns { dx, dy } in degrees this frame.
   */
  consumeLook(dt, ctx = {}) {
    const S = this.S.aim;
    let rawX, rawY;
    if (ctx.useSerial && this.teleLive) {
      rawX = this._serialState.gy; // yaw-ish channel already scaled by firmware; treated as counts/deg proxy
      rawY = this._serialState.gx;
    } else {
      rawX = this._rawDX; rawY = this._rawDY;
      this._rawDX = 0; this._rawDY = 0;
    }

    // 1. Spike rejection — clamp magnitude (I2C glitches / USB HID hiccups).
    const mag = Math.hypot(rawX, rawY);
    if (mag > S.maxRate) {
      const k = S.maxRate / mag;
      rawX *= k; rawY *= k;
    }

    // 2. Deadzone, subtractive so it stays smooth (no jump when crossing the threshold).
    const dz = S.deadzone;
    const sub = (v) => (v > 0 ? Math.max(0, v - dz) : -Math.max(0, -v - dz));
    let x = sub(rawX), y = sub(rawY);

    // 3. One-Euro filter on the rate (framerate independent).
    if (S.motionMode) {
      this._filtX.minCutoff = S.minCutoff; this._filtX.beta = S.beta;
      this._filtY.minCutoff = S.minCutoff; this._filtY.beta = S.beta;
      x = this._filtX.filter(x, dt);
      y = this._filtY.filter(y, dt);
    }

    // 4. Degrees.
    const degPerCount = S.sensitivity * 0.055;
    let degX = x * degPerCount, degY = y * degPerCount;

    // 5. Drift-bias cancellation while at rest (> 0.25 s), bounded by driftComp.
    const atRest = mag < dz * 1.5;
    if (atRest) {
      this._restSince += dt;
      if (this._restSince > 0.25) {
        const k = 1 - Math.exp(-dt / 0.9);
        this._biasX += (degX - this._biasX) * k;
        this._biasY += (degY - this._biasY) * k;
      }
    } else {
      this._restSince = 0;
    }
    const clampBias = (b) => Math.max(-S.driftComp, Math.min(S.driftComp, b));
    degX -= clampBias(this._biasX);
    degY -= clampBias(this._biasY);

    // 6. Optional acceleration (default 0 = 1:1 with the gun).
    if (S.accel > 0) {
      const speed = Math.hypot(degX, degY);
      const k = 1 + S.accel * speed * 0.02;
      degX *= k; degY *= k;
    }

    // 7. ADS / scope / target-slowdown scaling.
    let scale = 1;
    if (ctx.scope) scale = S.scopeSensScale;
    else if (ctx.ads) scale = S.adsSensScale;
    if (ctx.targetSlowdown) scale *= (1 - S.aimSlowdown * ctx.targetSlowdown);
    degX *= scale; degY *= scale;

    // Invert-Y applies only to the user's own motion, never to the assist added below.
    if (S.invertY) degY = -degY;

    // 8. Aim assist added AFTER the user's own motion.
    if (ctx.assist) { degX += ctx.assist.x || 0; degY += ctx.assist.y || 0; }

    // Telemetry for the tuning screen.
    this.tele.raw = mag; this.tele.filt = Math.hypot(degX, degY);
    this.tele.drift = Math.hypot(this._biasX, this._biasY);
    this.tele.peak = Math.max(this.tele.peak * 0.98, this.tele.filt);
    this._jitterSamples.push(atRest ? this.tele.filt : 0);
    if (this._jitterSamples.length > 60) this._jitterSamples.shift();
    const mean = this._jitterSamples.reduce((a, b) => a + b, 0) / Math.max(1, this._jitterSamples.length);
    this.tele.jitter = Math.sqrt(this._jitterSamples.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, this._jitterSamples.length));
    this.tele.rawTrace.push(mag); if (this.tele.rawTrace.length > 260) this.tele.rawTrace.shift();
    this.tele.filtTrace.push(this.tele.filt); if (this.tele.filtTrace.length > 260) this.tele.filtTrace.shift();
    this.tele.hz = dt > 0 ? 1 / dt : 0;

    return { dx: degX, dy: degY };
  }

  // ---------------------------------------------------------------- WebSerial telemetry
  async connectSerial() {
    if (!('serial' in navigator)) return false;
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      this.serial = port;
      this._pumpSerial(port);
      return true;
    } catch (e) {
      return false;
    }
  }

  async _pumpSerial(port) {
    const decoder = new TextDecoderStream();
    const readableClosed = port.readable.pipeTo(decoder.writable);
    const reader = decoder.readable.getReader();
    let buf = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          this._parseSerialLine(line);
        }
      }
    } catch (e) { /* device unplugged */ }
    reader.releaseLock();
    readableClosed.catch(() => {});
  }

  _parseSerialLine(line) {
    const parts = line.split(/\s+/);
    if (parts[0] === 'T' && parts.length >= 10) {
      const n = parts.slice(1).map(Number);
      this._serialState = {
        gx: n[0] / 10, gy: n[1] / 10, gz: n[2] / 10,
        joyX: n[3], joyY: n[4], pot: n[5], mask: n[6], sens: n[7] / 100, mpuOk: !!n[8],
        info: this._serialState.info,
      };
      this.teleLive = true;
      this._lastTeleAt = performance.now();
    } else if (parts[0] === 'I') {
      this._serialState.info = line.slice(2);
    } else if (parts[0] === 'M' && parts.length >= 3) {
      this._rawDX += Number(parts[1]); this._rawDY += Number(parts[2]);
    } else if (parts[0] === 'A' && parts.length >= 3) {
      this._rawDX += Number(parts[1]); this._rawDY += Number(parts[2]);
    }
  }

  updateTeleLive() {
    if (this.teleLive && performance.now() - this._lastTeleAt > 1000) this.teleLive = false;
  }

  get serialState() { return this._serialState; }
}
