// Persisted settings + the schema that auto-builds the options UI.
import { DEFAULT_BINDS } from './engine/controls.js';

const KEY = 'blackout-arena.aimbot.v2';

export const DEFAULTS = {
  // --- gun controls ---
  binds: DEFAULT_BINDS,
  adsMode: 'trigger',        // trigger | hold | toggle | off
  reloadHoldSwap: true,      // tap reload = reload, hold = next weapon
  swapHoldTime: 0.45,
  grenadeCook: true,         // hold prime to cook, release to throw
  grenadeArc: true,
  clutchRelevel: true,
  clutchFreeze: true,
  crouchMode: 'hold',

  // --- aim / motion ---
  sensitivity: 2.4,          // deg per mouse count (scaled by 0.055 internally)
  adsSensScale: 0.62,
  scopeSensScale: 0.38,
  invertY: false,
  motionMode: true,
  minCutoff: 1.1,
  beta: 0.010,
  deadzone: 0.35,
  driftComp: 0.55,
  accel: 0.0,
  maxRate: 90,
  aimAssist: 0.55,
  aimSlowdown: 0.45,

  // --- video ---
  quality: 'balanced',       // performance | balanced | quality
  fov: 85,
  renderScale: 1.0,
  dynamicRes: true,          // lower resolution automatically when frames fall behind
  bloom: false,
  shadows: true,
  viewBob: 0.5,
  showFps: true,

  // --- gameplay ---
  difficulty: 'regular',
  botCount: 6,
  botGrenades: true,
  scoreLimit: 30,
  matchMinutes: 10,
  autoReload: true,
  hitSound: true,
  masterVolume: 0.7,
};

export const SCHEMA = {
  controls: [
    { k: 'adsMode', t: 'select', n: 'Aim Down Sights', opts: ['trigger', 'hold', 'toggle', 'off'],
      d: 'TRIGGER (for the gun): aims while you hold the trigger; with the sniper, squeeze to scope in and release to fire. HOLD / TOGGLE use the "Aim" binding. OFF always hip-fires.' },
    { k: 'reloadHoldSwap', t: 'bool', n: 'Hold Reload to Swap Weapon',
      d: 'Tap Reload to reload, hold it to switch weapon. Off: Reload reloads the moment you press it.' },
    { k: 'swapHoldTime', t: 'range', n: 'Swap Hold Time (s)', min: 0.2, max: 1.2, step: 0.05 },
    { k: 'grenadeCook', t: 'bool', n: 'Cook Grenades',
      d: 'Hold Prime to pull the pin (the fuse starts), release to throw. Off: throws the moment you press.' },
    { k: 'grenadeArc', t: 'bool', n: 'Show Grenade Arc', d: 'Draws the predicted throw path while cooking.' },
    { k: 'clutchRelevel', t: 'bool', n: 'Clutch Re-levels View', d: 'Pressing the clutch snaps your view back to the horizon.' },
    { k: 'clutchFreeze', t: 'bool', n: 'Clutch Freezes Aim In-Game',
      d: 'Ignore aim movement while the clutch is held. The firmware already does this; this covers other firmware.' },
    { k: 'crouchMode', t: 'select', n: 'Crouch', opts: ['hold', 'toggle'],
      d: 'HOLD matches the firmware (hold the stick click). TOGGLE: each press flips crouch.' },
  ],
  input: [
    { k: 'motionMode', t: 'bool', n: 'Motion Mode', d: 'The gyro pipeline (One-Euro filter, drift compensation, spike rejection) for the MPU-6500.' },
    { k: 'sensitivity', t: 'range', n: 'Look Sensitivity', d: 'Multiplied by the potentiometer on the gun.', min: 0.2, max: 8, step: 0.05 },
    { k: 'adsSensScale', t: 'range', n: 'ADS Sensitivity', d: 'Multiplier while aiming down sights.', min: 0.1, max: 1.5, step: 0.01 },
    { k: 'scopeSensScale', t: 'range', n: 'Scoped Sensitivity', d: 'Multiplier while using the sniper scope.', min: 0.05, max: 1.2, step: 0.01 },
    { k: 'invertY', t: 'bool', n: 'Invert Vertical' },
    { k: 'minCutoff', t: 'range', n: 'Filter: Min Cutoff', d: 'Lower = steadier crosshair when you hold still. Raise if aiming feels laggy.', min: 0.1, max: 6, step: 0.05, motion: true },
    { k: 'beta', t: 'range', n: 'Filter: Speed Response', d: 'Higher = filter gets out of the way during fast swings.', min: 0, max: 0.08, step: 0.001, motion: true },
    { k: 'deadzone', t: 'range', n: 'Noise Deadzone', d: 'Ignores tiny counts caused by gyro noise while the gun is still.', min: 0, max: 3, step: 0.05, motion: true },
    { k: 'driftComp', t: 'range', n: 'Drift Compensation', d: 'Cancels steady gyro bias (deg/sec) when you are not moving the gun.', min: 0, max: 4, step: 0.05, motion: true },
    { k: 'maxRate', t: 'range', n: 'Spike Rejection', d: 'Clamps absurd single-frame jumps from I2C glitches.', min: 20, max: 400, step: 5, motion: true },
    { k: 'accel', t: 'range', n: 'Pointer Acceleration', d: '0 keeps aim 1:1 with the gun.', min: 0, max: 1, step: 0.01 },
    { k: 'aimAssist', t: 'range', n: 'Aim Magnetism', d: 'Gently pulls aim toward a target you are tracking.', min: 0, max: 1, step: 0.01 },
    { k: 'aimSlowdown', t: 'range', n: 'Target Slowdown', d: 'Reduces sensitivity while the crosshair is over a target.', min: 0, max: 0.9, step: 0.01 },
  ],
  video: [
    { k: 'quality', t: 'select', n: 'Quality Preset', opts: ['performance', 'balanced', 'quality'],
      d: 'PERFORMANCE: highest FPS — simple lighting, no shadows, no antialiasing (antialiasing change applies after a page reload). BALANCED: simple lighting, baked shadows. QUALITY: full PBR materials, up to 2x resolution, optional bloom — needs a strong GPU.' },
    { k: 'dynamicRes', t: 'bool', n: 'Auto Resolution (hold FPS)',
      d: 'Watches frame times and trims the render resolution the moment the game falls behind your monitor refresh rate, then restores it when there is headroom.' },
    { k: 'fov', t: 'range', n: 'Field of View', min: 60, max: 120, step: 1 },
    { k: 'renderScale', t: 'range', n: 'Render Scale', d: 'Below 1.0 renders fewer pixels for more FPS (slightly softer image).', min: 0.5, max: 1, step: 0.05 },
    { k: 'shadows', t: 'bool', n: 'Shadows', d: 'Baked once when the level loads, so they cost almost nothing per frame.' },
    { k: 'bloom', t: 'bool', n: 'Bloom (QUALITY preset only)', d: 'Glow on lights and explosions. The most expensive effect in the game.' },
    { k: 'viewBob', t: 'range', n: 'View Bob', min: 0, max: 1.5, step: 0.05 },
    { k: 'showFps', t: 'bool', n: 'Show FPS' },
  ],
  game: [
    { k: 'difficulty', t: 'select', n: 'Bot Difficulty', opts: ['recruit', 'regular', 'veteran', 'hardened'] },
    { k: 'botCount', t: 'range', n: 'Hostiles', min: 1, max: 12, step: 1 },
    { k: 'botGrenades', t: 'bool', n: 'Hostiles Throw Grenades' },
    { k: 'scoreLimit', t: 'range', n: 'Score Limit', min: 5, max: 75, step: 1 },
    { k: 'matchMinutes', t: 'range', n: 'Match Length (min)', min: 2, max: 20, step: 1 },
    { k: 'autoReload', t: 'bool', n: 'Auto Reload' },
    { k: 'hitSound', t: 'bool', n: 'Hit Sound' },
    { k: 'masterVolume', t: 'range', n: 'Volume', min: 0, max: 1, step: 0.02 },
  ],
};

const cloneBinds = (b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, [...v]]));

export const S = { ...DEFAULTS, binds: cloneBinds(DEFAULT_BINDS) };

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      Object.assign(S, saved);
      // new actions added in a later version still get their defaults
      S.binds = { ...cloneBinds(DEFAULT_BINDS), ...(saved.binds || {}) };
      // v2.0 quality names, and v2.0's heavy defaults, move to the faster v2.1 ones
      if (!['performance', 'balanced', 'quality'].includes(S.quality)) {
        S.quality = 'balanced';
        S.bloom = false;
      }
    }
  } catch (e) { /* private mode / blocked storage: defaults are fine */ }
  return S;
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ }
}

export function reset() {
  Object.assign(S, DEFAULTS, { binds: cloneBinds(DEFAULT_BINDS) });
  save();
}

export function resetBinds() {
  S.binds = cloneBinds(DEFAULT_BINDS);
  save();
}

export const DIFFICULTY = {
  recruit:  { react: 0.62, spread: 0.075, dmg: 0.55, burst: [2, 4], move: 0.80, hp: 100, nade: 0.10 },
  regular:  { react: 0.40, spread: 0.048, dmg: 0.80, burst: [3, 6], move: 0.95, hp: 100, nade: 0.18 },
  veteran:  { react: 0.26, spread: 0.032, dmg: 1.00, burst: [4, 8], move: 1.08, hp: 110, nade: 0.28 },
  hardened: { react: 0.16, spread: 0.021, dmg: 1.25, burst: [5, 10], move: 1.18, hp: 125, nade: 0.40 },
};
