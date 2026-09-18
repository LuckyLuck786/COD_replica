// The AIMBOT nerf-gun control map. Every in-game action, the physical gun component that drives
// it, and the key/mouse code the AIMBOT firmware sends for that component.

export const ACTIONS = [
  { id: 'fire',    name: 'Fire',                   part: 'Trigger',             pin: 'GP10' },
  { id: 'clutch',  name: 'Clutch (pause aim / re-level)', part: 'Clutch',        pin: 'GP11' },
  { id: 'reload',  name: 'Reload  ·  hold = swap weapon', part: 'Reload',        pin: 'GP12' },
  { id: 'grenade', name: 'Grenade  ·  hold = cook', part: 'Prime',              pin: 'GP14' },
  { id: 'streak',  name: 'Call in killstreak',     part: 'Aux',                 pin: 'GP16' },
  { id: 'jump',    name: 'Jump',                   part: 'Stick click (tap)',   pin: 'GP13' },
  { id: 'crouch',  name: 'Crouch  ·  sprint + crouch = slide', part: 'Stick click (hold)', pin: 'GP13' },
  { id: 'forward', name: 'Move forward',           part: 'Stick up',            pin: 'GP27' },
  { id: 'back',    name: 'Move back',              part: 'Stick down',          pin: 'GP27' },
  { id: 'left',    name: 'Strafe left',            part: 'Stick left',          pin: 'GP26' },
  { id: 'right',   name: 'Strafe right',           part: 'Stick right',         pin: 'GP26' },
  { id: 'sprint',  name: 'Sprint',                 part: 'Stick pushed fully forward', pin: 'GP27' },
  { id: 'aim',     name: 'Aim down sights (HOLD/TOGGLE modes)', part: 'not on the gun', pin: '' },
  { id: 'swap',    name: 'Next weapon',            part: 'not on the gun',      pin: '' },
];

/** What AIMBOT_master_v5.ino sends for each component. */
export const FIRMWARE_SENDS = {
  fire: 'Mouse0', clutch: 'KeyF', reload: 'KeyR', grenade: 'KeyG', streak: 'Digit3',
  jump: 'Space', crouch: 'KeyC', forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  sprint: 'ShiftLeft',
};

/** Default bindings: [primary (the gun), alternate (keyboard/mouse fallback)]. */
export const DEFAULT_BINDS = {
  fire:    ['Mouse0', ''],
  clutch:  ['KeyF', ''],
  reload:  ['KeyR', ''],
  grenade: ['KeyG', ''],
  streak:  ['Digit3', ''],
  jump:    ['Space', ''],
  crouch:  ['KeyC', 'ControlLeft'],
  forward: ['KeyW', 'ArrowUp'],
  back:    ['KeyS', 'ArrowDown'],
  left:    ['KeyA', 'ArrowLeft'],
  right:   ['KeyD', 'ArrowRight'],
  sprint:  ['ShiftLeft', ''],
  aim:     ['Mouse2', ''],
  swap:    ['KeyQ', ''],
};

/** Bit positions in the firmware's telemetry button mask. */
export const PIN_BITS = { trigger: 1, clutch: 2, reload: 4, joysw: 8, prime: 16, aux: 32 };

const NAMED = {
  Mouse0: 'LEFT CLICK', Mouse1: 'MIDDLE CLICK', Mouse2: 'RIGHT CLICK', Mouse3: 'MOUSE 4', Mouse4: 'MOUSE 5',
  Space: 'SPACE', ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL',
  AltLeft: 'L-ALT', AltRight: 'R-ALT', Tab: 'TAB', Enter: 'ENTER', Backspace: 'BACKSPACE',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', CapsLock: 'CAPS',
};

export function codeName(code) {
  if (!code) return '—';
  if (NAMED[code]) return NAMED[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'NUM ' + code.slice(6);
  return code.toUpperCase();
}
