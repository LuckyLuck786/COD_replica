// Default settings and the schema that auto-builds the Settings screen.
// Stored in localStorage under STORAGE_KEY; load() merges new actions into saved
// bindings and migrates old quality names.

import { DEFAULT_BINDS } from './engine/controls.js';

export const STORAGE_KEY = 'blackout-arena.aimbot.v2';

export const DEFAULTS = {
  controls: {
    adsMode: 'trigger',          // 'trigger' | 'hold' | 'toggle'
    reloadHoldSwap: true,
    swapHoldTime: 0.45,
    grenadeCook: true,
    grenadeArc: true,
    clutchRelevel: true,
    clutchFreeze: true,
    crouchMode: 'hold',          // 'hold' | 'toggle'
  },
  aim: {
    sensitivity: 2.4,
    adsSensScale: 0.62,
    scopeSensScale: 0.38,
    invertY: false,
    motionMode: true,
    minCutoff: 1.1,
    beta: 0.010,
    deadzone: 0.35,
    driftComp: 0.55,
    accel: 0,
    maxRate: 90,
    aimAssist: 0.55,
    aimSlowdown: 0.45,
  },
  video: {
    quality: 'balanced',        // 'performance' | 'balanced' | 'quality'
    dynamicRes: true,
    fov: 85,
    renderScale: 1,
    shadows: true,
    bloom: false,
    viewBob: 0.5,
    showFps: true,
  },
  gameplay: {
    difficulty: 'regular',       // 'recruit' | 'regular' | 'veteran' | 'hardened'
    botCount: 6,
    botGrenades: true,
    scoreLimit: 30,
    matchMinutes: 10,
    autoReload: true,
    hitSound: true,
    masterVolume: 0.7,
  },
};

const QUALITY_MIGRATE = { low: 'performance', med: 'balanced', medium: 'balanced', high: 'quality', ultra: 'quality' };

/** Schema drives the auto-built options UI: [group][key] = { type, min, max, step, label, opts }. */
export const SCHEMA = {
  controls: {
    adsMode:         { type: 'select', label: 'ADS Mode', opts: [['trigger', 'Squeeze To Scope'], ['hold', 'Hold To Aim'], ['toggle', 'Toggle Aim']] },
    reloadHoldSwap:  { type: 'bool',   label: 'Hold Reload To Swap Weapon' },
    swapHoldTime:    { type: 'range',  label: 'Swap Hold Time', min: 0.2, max: 1.0, step: 0.05 },
    grenadeCook:     { type: 'bool',   label: 'Grenade Cook (hold to cook)' },
    grenadeArc:      { type: 'bool',   label: 'Show Grenade Arc Preview' },
    clutchRelevel:   { type: 'bool',   label: 'Clutch Re-levels View' },
    clutchFreeze:    { type: 'bool',   label: 'Clutch Freezes Aim' },
    crouchMode:      { type: 'select', label: 'Crouch Mode', opts: [['hold', 'Hold'], ['toggle', 'Toggle']] },
  },
  aim: {
    sensitivity:     { type: 'range', label: 'Sensitivity', min: 0.2, max: 6, step: 0.05 },
    adsSensScale:    { type: 'range', label: 'ADS Sensitivity Scale', min: 0.1, max: 1, step: 0.01 },
    scopeSensScale:  { type: 'range', label: 'Scope Sensitivity Scale', min: 0.05, max: 1, step: 0.01 },
    invertY:         { type: 'bool',  label: 'Invert Y' },
    motionMode:      { type: 'bool',  label: 'Motion Controller Mode (One-Euro Filter)' },
    minCutoff:       { type: 'range', label: 'Filter Min Cutoff', min: 0.1, max: 5, step: 0.05 },
    beta:            { type: 'range', label: 'Filter Beta', min: 0, max: 0.2, step: 0.001 },
    deadzone:        { type: 'range', label: 'Deadzone (deg/s)', min: 0, max: 3, step: 0.05 },
    driftComp:       { type: 'range', label: 'Drift Compensation Cap', min: 0, max: 3, step: 0.05 },
    accel:           { type: 'range', label: 'Acceleration', min: 0, max: 2, step: 0.05 },
    maxRate:         { type: 'range', label: 'Spike Rejection Max Rate', min: 20, max: 400, step: 5 },
    aimAssist:       { type: 'range', label: 'Aim Assist', min: 0, max: 1, step: 0.05 },
    aimSlowdown:     { type: 'range', label: 'Target Slowdown', min: 0, max: 1, step: 0.05 },
  },
  video: {
    quality:         { type: 'select', label: 'Quality Preset', opts: [['performance', 'Performance'], ['balanced', 'Balanced'], ['quality', 'Quality']] },
    dynamicRes:      { type: 'bool',  label: 'Dynamic Resolution' },
    fov:             { type: 'range', label: 'Field Of View', min: 60, max: 110, step: 1 },
    renderScale:     { type: 'range', label: 'Render Scale', min: 0.5, max: 2, step: 0.05 },
    shadows:         { type: 'bool',  label: 'Shadows' },
    bloom:           { type: 'bool',  label: 'Bloom (Quality preset only)' },
    viewBob:         { type: 'range', label: 'View Bob', min: 0, max: 1, step: 0.05 },
    showFps:         { type: 'bool',  label: 'Show FPS' },
  },
  gameplay: {
    difficulty:      { type: 'select', label: 'Bot Difficulty', opts: [['recruit', 'Recruit'], ['regular', 'Regular'], ['veteran', 'Veteran'], ['hardened', 'Hardened']] },
    botCount:        { type: 'range', label: 'Bot Count', min: 0, max: 11, step: 1 },
    botGrenades:     { type: 'bool',  label: 'Bots Use Grenades' },
    scoreLimit:      { type: 'range', label: 'Score Limit', min: 10, max: 100, step: 5 },
    matchMinutes:    { type: 'range', label: 'Match Minutes', min: 3, max: 20, step: 1 },
    autoReload:      { type: 'bool',  label: 'Auto-Reload When Empty' },
    hitSound:        { type: 'bool',  label: 'Hit Marker Sound' },
    masterVolume:    { type: 'range', label: 'Master Volume', min: 0, max: 1, step: 0.05 },
  },
};

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

export function load() {
  const s = { ...deepClone(DEFAULTS), binds: deepClone(DEFAULT_BINDS) };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      for (const group of Object.keys(DEFAULTS)) {
        if (saved[group]) Object.assign(s[group], saved[group]);
      }
      if (s.video.quality && QUALITY_MIGRATE[s.video.quality]) {
        s.video.quality = QUALITY_MIGRATE[s.video.quality];
      }
      if (saved.binds) {
        // merge new actions introduced since the save was written
        for (const action of Object.keys(DEFAULT_BINDS)) {
          s.binds[action] = saved.binds[action] || deepClone(DEFAULT_BINDS[action]);
        }
      }
    }
  } catch (e) { /* corrupt or missing save: defaults stand */ }
  return s;
}

export function save(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch (e) { /* storage unavailable (private mode, quota) — settings just won't persist */ }
}
