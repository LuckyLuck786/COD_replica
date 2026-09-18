# MASTER BUILD PROMPT — "BLACKOUT ARENA (AIMBOT nerf-gun edition)"

Hand this whole file to an AI coding agent (or follow it yourself) to rebuild this exact game
from nothing. It contains the brief, the hardware, the firmware, every file, every constant,
every algorithm, the bugs that were found while building it, and the tests that prove it works.

> **Prompt to paste, in one line:**
> *"Build the game described in BUILD_PROMPT.md exactly: same files, same constants, same
> behaviour, same performance rules. It must run offline from a folder, be driven by my
> AIMBOT nerf gun over USB HID, and pass every check in the Acceptance Tests section."*

---

## 0. WHAT THIS IS

A first-person arena shooter in the Call of Duty style, played with a **nerf gun** containing a
Raspberry Pi Pico. The gun is a USB mouse + keyboard, so the game needs no driver: gyro movement
arrives as mouse movement, and the buttons arrive as keys.

It is an **original game in that style** — not a copy of Call of Duty, whose maps, weapons, audio
and art are protected work. What is reproduced is the *feel*: time-to-kill, ADS, recoil,
movement, grenades, killstreaks, and the moment-to-moment loop.

**Non-negotiable constraints**

| Rule | Reason |
|---|---|
| Runs in a browser on WebGL2 | Works on Windows, macOS, Linux with nothing to compile |
| No build step, no npm, no bundler | Plain ES modules loaded from disk |
| three.js is **vendored into the folder** (r160.1) | The game runs fully offline |
| Must be served over `http://`, never `file://` | ES modules + pointer lock need an origin |
| No asset files at all | Textures are drawn on a `<canvas>` at load; audio is synthesised with WebAudio |
| Every gun button is rebindable in-game | His firmware may change |
| Target: high, stable FPS | See Section 12; this was a hard requirement after playtesting |

---

## 1. THE HARDWARE — the "AIMBOT" gun

### 1.1 Components

| Part | Detail |
|---|---|
| **Raspberry Pi Pico** | RP2040. Presents as USB HID mouse + keyboard + CDC serial |
| **MPU-6500** | 6-axis IMU (WHO_AM_I `0x70`). Gyro drives aiming. (Originally described as MPU9250; the build guide confirms MPU-6500) |
| **Analog joystick module** | 2 axes + push switch. Movement |
| **Potentiometer (10 kΩ)** | Aim-sensitivity dial |
| **5 × tactile push buttons** | Trigger, Clutch, Reload, Prime, Aux |
| Breadboard, jumper wires | Prototype wiring |
| A nerf gun body | Everything mounts inside |

### 1.2 Wiring (this exact pinout is assumed everywhere)

Power: **3V3(OUT), physical pin 36** → `(+)` rail. **GND, pin 38** → `(−)` rail.
**Never VBUS (pin 40) or VSYS (pin 39): the GPIO/ADC pins are not 5 V tolerant.**

| Signal | Pico pin | Physical pin |
|---|---|---|
| MPU-6500 `SDA` | GP4 | 6 |
| MPU-6500 `SCL` | GP5 | 7 |
| MPU-6500 `VCC` / `GND` | 3V3 rail / GND rail | — |
| Joystick `VRx` | GP26 (ADC0) | 31 |
| Joystick `VRy` | GP27 (ADC1) | 32 |
| Joystick `SW` | GP13 | 17 |
| Joystick `+5V` pin | **3.3 V** (not 5 V) | — |
| Potentiometer wiper (middle leg) | GP28 (ADC2) | 34 |
| Potentiometer outer legs | `(+)` and `(−)` | — |
| Trigger button | GP10 | 14 |
| Clutch button | GP11 | 15 |
| Reload button | GP12 | 16 |
| Prime button | GP14 | 19 |
| Aux button | GP16 | 21 |

Buttons use the Pico's internal pull-ups (`INPUT_PULLUP`): one leg to the GPIO, the other to
GND, and the two legs must come from **opposite sides** of a 4-pin tactile switch.

Joystick convention as measured by the wiring test: **X above centre = LEFT, Y above centre = UP**.

### 1.3 The Arduino code

Two sketches exist. Both are Arduino for the **Earle Philhower "Raspberry Pi Pico/RP2040"** core
(verified against version **6.1.0**), board *Raspberry Pi Pico*, **Tools → USB Stack: "Pico SDK"**
(that stack gives Mouse + Keyboard + Serial together).

**(a) `WIRING_TEST.ino` — his own diagnostic sketch (pre-existing).**
It verifies the build without touching the mouse: `Wire.setSDA(4) / setSCL(5)`, MPU at `0x68`,
gyro ±250 dps (`GYRO_SENS = 131.0`), `analogReadResolution(12)`, joystick centre learned from 20
samples, deadzone 500. Every 300 ms it prints four lines to Serial at 115200 — `MPU` (WHO_AM_I +
GX/GY/GZ), `BTN` (Trig/Clutch/Reload/JoySW/Prime/Aux), `JOY` (X/Y + direction) and `POT` (raw +
percent) — and retries `initMPU()` every 2 s while the sensor is silent. Run this first; if every
line responds, the wiring is proven.

**(b) `AIMBOT_master_v5.ino` — the game firmware, written for this project.**
Full source is in **Appendix A** and at `hardware/AIMBOT_master_v5/AIMBOT_master_v5.ino`.
A prebuilt `hardware/AIMBOT_master_v5.uf2` is included for BOOTSEL drag-and-drop flashing.
(An earlier `AIMBOT_master_v4.ino` of his was never seen by the build; v5 replaces it, and any
difference in the keys it sends can be absorbed by the in-game remapping screen.)

Behaviour required of the firmware:

1. **Boot:** reset + wake MPU (`PWR_MGMT_1 = 0x01`), `DLPF = 0x03` (~44 Hz), `SMPLRT_DIV = 0`,
   **`GYRO_CONFIG = 0x10` (±1000 °/s)** — a fast gun swing exceeds ±250 °/s and would clip —
   `ACCEL_CONFIG = 0x00`. Then average **500 gyro samples** while still to learn the bias, with
   the LED blinking. This single step removes almost all aim drift.
2. **Loop at 250 Hz** (`REPORT_US = 4000`).
3. **Aim:** `rate = gyro[AXIS] * SIGN − bias`, deadband 0.3 °/s, then
   `counts += rate × dt × COUNTS_PER_DEG × potMultiplier`, **carrying the fraction between
   reports** (truncating would throw away slow movement), clamped to ±127 per HID report.
4. **Potentiometer:** smoothed (`EMA 0.08`), mapped `pow(3, (p − 0.5) × 2)` → ×0.33 … ×3.
5. **Buttons:** 8 ms debounce. Trigger → left mouse held. Clutch → `F` held **and aim output
   stops** (ratchet: hold, re-point the gun, release). Reload → `R` held. Prime → `G` held.
   Aux → `3` tapped. Stick click: **tap (<250 ms) → Space, hold → `C` held**.
6. **Joystick → `W A S D`** with hysteresis (press 700, release 450) and **Left Shift when pushed
   fully forward** (1600 / 1350).
7. **Clutch held still for 3 s → re-run the gyro bias calibration.**
8. **Telemetry** (only while a program holds the port, so the Serial Monitor must be closed):
   `T gx×10 gy×10 gz×10 joyX joyY pot mask sens×100 mpuOk` at 25 Hz, and `I <info>` every 2 s.
   Mask bits: `1` trigger, `2` clutch, `4` reload, `8` stick click, `16` prime, `32` aux.
9. **`DEBUG_MODE true`** sends no HID at all and prints an axis-finding helper: swing right and
   tilt up, and it names the axis and sign to paste into `YAW_AXIS/YAW_SIGN/PITCH_AXIS/PITCH_SIGN`.
10. **Do not filter in the firmware.** The game runs a One-Euro filter; filtering twice adds lag.

---

## 2. THE CONTRACT: gun → key → in-game action

This mapping is the hinge between firmware and game. It lives in `src/engine/controls.js`.

| Gun component | Pin | Key/button sent | Action id | In-game meaning |
|---|---|---|---|---|
| Trigger | GP10 | Left click (held) | `fire` | Fire; also ADS while held; sniper = squeeze to scope, release to fire |
| Clutch | GP11 | `F` (held) | `clutch` | Re-level view + freeze aim |
| Reload | GP12 | `R` (held) | `reload` | Tap = reload, hold ≥ 0.45 s = next weapon |
| Prime | GP14 | `G` (held) | `grenade` | Hold = cook, release = throw |
| Aux | GP16 | `3` | `streak` | Call in earned killstreak |
| Stick click (tap) | GP13 | `Space` | `jump` | Jump |
| Stick click (hold) | GP13 | `C` (held) | `crouch` | Crouch; while sprinting = slide |
| Stick up/down/left/right | GP26/27 | `W`/`S`/`A`/`D` | `forward`/`back`/`left`/`right` | Move |
| Stick full forward | GP27 | Left Shift | `sprint` | Sprint |
| — | — | Right click | `aim` | ADS in HOLD/TOGGLE modes |
| — | — | `Q` | `swap` | Next weapon (desk testing) |
| MPU-6500 | GP4/5 | mouse movement | — | Aim |
| Potentiometer | GP28 | (scales on the Pico) | — | Sensitivity dial |

Each action has **two** binding slots (primary + alternate). Defaults: `crouch` also `ControlLeft`,
movement also the arrow keys. `Escape` is reserved for pause and is not bindable.

---

## 3. FILE TREE — build exactly this

```
blackout-arena/
├── index.html                      260 lines  shell, HUD markup, all menus, boot watchdog
├── css/style.css                   277 lines  HUD + menu styling, one amber/military theme
├── serve.py                         50 lines  threaded loopback static server (IPv4 + IPv6)
├── run.bat / run.sh                  7 lines  launchers (python → py → npx serve fallback)
├── README.md                       149 lines  player-facing readme
├── BUILD_PROMPT.md                           this document
├── src/
│   ├── main.js                    1615 lines  renderer, match logic, grenades/streak glue,
│   │                                          menus, remapping UI, Gun Check, aim tuning
│   ├── settings.js                 150 lines  defaults + schema that auto-builds the options UI
│   ├── engine/
│   │   ├── controls.js              63 lines  ACTIONS, FIRMWARE_SENDS, DEFAULT_BINDS, codeName
│   │   ├── input.js                409 lines  bindable actions, press latching, One-Euro gyro
│   │   │                                      pipeline, WebSerial telemetry
│   │   ├── physics.js              158 lines  swept AABB movement + rayBoxes/clearLine
│   │   ├── merge.js                 74 lines  static geometry batching (draw-call killer)
│   │   └── audio.js                106 lines  procedural WebAudio SFX
│   └── game/
│       ├── map.js                  299 lines  arena geometry, colliders, canvas textures
│       ├── player.js               182 lines  movement, stance, camera, health
│       ├── weapons.js              309 lines  weapon table, viewmodel, recoil/spread
│       ├── bots.js                 346 lines  hostile AI
│       ├── grenades.js             264 lines  frag cooking/throwing/bouncing/arc
│       ├── effects.js              242 lines  tracers, sparks, decals, explosions, smoke
│       └── hud.js                  238 lines  HUD, killfeed, damage arrows, minimap
├── vendor/three/                              three.js r160.1, vendored (1.3 MB)
│   ├── build/three.module.js
│   └── addons/postprocessing/{EffectComposer,Pass,ShaderPass,MaskPass,RenderPass,
│       UnrealBloomPass,OutputPass}.js
│     addons/shaders/{CopyShader,LuminosityHighPassShader,OutputShader,FXAAShader}.js
│     addons/utils/BufferGeometryUtils.js
└── hardware/
    ├── AIMBOT_master_v5/AIMBOT_master_v5.ino  381 lines  the firmware
    ├── AIMBOT_master_v5.uf2                   prebuilt, drag-and-drop flashable
    └── README.md                              145 lines  wiring, flashing, tuning, troubleshooting
```

Fetch the vendored three.js from `https://unpkg.com/three@0.160.1/…` at build time:
`build/three.module.js`, the seven postprocessing addons, the four shaders, and
`examples/jsm/utils/BufferGeometryUtils.js`. `index.html` maps them with an import map:

```html
<script type="importmap">
{ "imports": { "three": "./vendor/three/build/three.module.js",
               "three/addons/": "./vendor/three/addons/" } }
</script>
```

---

## 4. ENGINE MODULES

### 4.1 `engine/input.js` — the heart of the motion control

Codes are keyboard `event.code` values plus `'Mouse0'…'Mouse4'`.

* **`codeOf(e)`** — returns `event.code`, rebuilt from `event.key` when a device or tool leaves it
  empty (`'g'` → `KeyG`). Without this, rebinding silently fails on some input paths.
* **Press latching.** `held` (Set), `pressedCodes`, `releasedCodes`, `since` (Map). A
  microcontroller can press *and release* between two frames; polling "is it down" would lose the
  tap. Edges live until `endFrame()`.
  API: `isDown(a)`, `wasPressed(a)`, `wasReleased(a)`, `heldFor(a)`, `endFrame()`.
* **Pointer lock** requested with `{ unadjustedMovement: true }` (bypasses the Windows mouse
  acceleration curve, which fights the filter), falling back to a plain request, then
  `onLockError`. `acceptUnlocked` lets clicks still work when a browser refuses lock.
* **`captureNext(cb)`** — rebinding; grabs the next key or mouse button anywhere on the page.
  `Escape` cancels, `Backspace`/`Delete` clears. `captureEndedAt` guards the click that follows.
* **The look pipeline** (`consumeLook(dt, ctx)`), in order:
  1. **Spike rejection** — clamp magnitude to `S.maxRate` (I2C glitches).
  2. **Deadzone** — `S.deadzone`, subtractive so it stays smooth.
  3. **One-Euro filter on the RATE** (framerate independent):
     `alpha(cutoff, dt) = 1 / (1 + (1/(2π·cutoff))/dt)`;
     `cutoff = minCutoff + beta·|derivative|`. Heavy smoothing at rest, nearly none in a flick —
     a plain low-pass would lag every flick.
  4. **Degrees:** `degPerCount = S.sensitivity × 0.055`.
  5. **Drift-bias cancellation** — while at rest (> 0.25 s), learn bias with
     `k = 1 − exp(−dt/0.9)` and subtract it, bounded by `S.driftComp` °/s.
  6. **Optional acceleration** (`S.accel`, default 0 = 1:1 with the gun).
  7. **ADS / scope / target-slowdown scaling.**
  8. **Aim assist** added after the user's own motion, and **invert-Y applies only to the user's
     part**, never to the assist.
  Telemetry kept for the tuning screen: `hz`, `raw`, `filt`, `jitter` (RMS at rest), `drift`,
  `peak`, plus 260-sample raw/filtered traces.
* **WebSerial** (`connectSerial`): parses `T` (telemetry) and `I` (info); also accepts `M dx dy`
  and `A yaw pitch` if someone wants to aim over serial. **Telemetry never drives gameplay**, so
  HID input is never double-counted. `teleLive` = a frame arrived within 1 s.

### 4.2 `engine/physics.js`

* `moveEntity(pos, vel, dt, colliders, r, h, stepHeight)` — per-axis swept AABB with **step-up**.
  `EPS = 0.03` inset: `Box3.intersectsBox` counts touching faces as intersecting, so without the
  inset an entity standing on the ground is "inside" it forever.
  **Step-up must target the highest surface it is intersecting**, not the first collider found —
  otherwise the ground plane is picked and stairs become unclimbable.
* `blocked(pos, r, h, colliders)` — used for "can I stand up here".
* `groundHeight(x, z, colliders, maxY)` — spawn placement.
* **`rayBoxes(colliders, o, d, far)`** — slab-method ray vs all collision boxes, returns
  `{distance, point, normal}`; boxes containing the origin are ignored. Used for **bullets, line
  of sight, aim assist, blast exposure, airstrike targeting** — never mesh raycasts.
* `clearLine(colliders, a, b, pad = 0.15)`.

### 4.3 `engine/merge.js`

`mergeByMaterial(root, meshes, opts)` and `mergeWithColors(root, meshes, material)` (bakes each
part's material colour into a vertex-colour attribute → a whole model in one draw call). Both bake
world transforms, normalise attributes to position/normal/uv, index everything, then call
`mergeGeometries` from the vendored `BufferGeometryUtils`.

### 4.4 `engine/audio.js`

Procedural only: a 2.5 s white-noise buffer plus oscillators through a compressor.
`shot(profile, dist)` (rifle/smg/sniper/pistol), `hit(head)`, `kill`, `hurt`, `reloadOut/In`,
`bolt`, `dryFire`, `swap`, `step`, `land`, `ric`, `explosion(dist)`, `clink`, `pin`,
`throwNade(dist)`, `fuseTick(n)`, `danger`, `jet`, `denied`, `ui`, `streak`.

---

## 5. GAME MODULES

### 5.1 `game/map.js` — "BLACKOUT YARD"

A 62 × 62 m three-lane arena in the Shipment/Nuketown tradition. **Everything is axis-aligned**,
so collision is exact and cheap.

* **Textures** are drawn into canvases at load: `concrete`, `asphalt`, `metal` (ribbed),
  `wood`, `wall` — noise + blotches + lines, `RepeatWrapping`, anisotropy 8.
* **Materials** `M`: floor, concrete, wall, metalA/B/C (container colours), wood, steel, dark,
  glow (emissive), hazard. Each has a **Lambert twin** in `LITE` for the fast presets.
* `box(w,h,d,cx,y,cz,mat,opts)` adds a mesh **and** a `Box3` collider (y = bottom).
* Contents: perimeter walls (9 m); a central building 20 × 14 × 6.4 m with a doorway on each of
  the north and south walls, window slits east/west, an accessible roof with a lip, and a
  **stepped ramp** (9 steps, 0.78 m rise each — this is why step-up must work); 9 shipping
  containers including a stacked pair; a catwalk along the east wall; 19 crates; 8 barrels;
  4 sandbag lines; 5 emissive lamp panels; 46 skyline silhouettes outside the walls.
* 12 spawn points, 19 bot waypoints.
* **At the end, everything static is merged**: one mesh per material (~12 total) plus one for the
  skyline. `setLite(on)` swaps the whole set between PBR and Lambert.

### 5.2 `game/player.js`

Capsule-ish AABB: radius 0.36, standing 1.78, crouched 1.16, eye 0.20 below the top.
Speeds: walk 5.3, sprint 7.9, crouch 2.9, ADS 3.5, air control 0.55. Jump 7.4, gravity 23.
Health 100, regen 26/s after 4.2 s. Slide: crouch pressed **while last frame was sprinting**
(crouching cancels sprint, so checking the current frame never fires), 0.55 s, 1.6 s cooldown.
Camera: bob, land dip, shake, slide dip, strafe roll, and recoil applied as
`rotation.set(pitch − recoilPitch, yaw + recoilYaw, roll, 'YXZ')`.
Orientation maths used everywhere: `forward = (−sin yaw, 0, −cos yaw)`, `right = (cos yaw, 0, −sin yaw)`.

### 5.3 `game/weapons.js`

| Weapon | Type | RPM | Dmg | Head× | Mag/Reserve | Reload | ADS | Range | Hip spread |
|---|---|---|---|---|---|---|---|---|---|
| **R-91 RANGER** | auto rifle | 690 | 31 | 2.4 | 30 / 180 | 2.05 s | 0.22 s | 46 m | 0.028 |
| **VECTOR-9** | auto SMG | 940 | 23 | 2.0 | 32 / 224 | 1.72 s | 0.17 s | 26 m | 0.034 |
| **M7 LONGSHOT** | bolt sniper | 48 | 118 | 2.0 | 5 / 35 | 2.9 s | 0.42 s | 120 m | 0.085 |
| **P8 SIDEARM** | semi pistol | 420 | 27 | 2.2 | 12 / 72 | 1.42 s | 0.15 s | 24 m | 0.026 |

Each also carries `limbMult`, `falloff`, per-state spread (`ads/move/air/max/bloom/decay`) and
recoil (`v`, `h`, `recover`, `kick`).
Viewmodels are built from boxes (receiver, barrel, rail, grip, magazine, stock, foregrip,
charging handle) plus a sight — holo / reflex / iron / scope — then **merged into one mesh**. The
**ADS pose aligns the sight exactly on screen centre** using each weapon's `sightY` and the
holder scale (0.74). Rendered in a **separate scene with its own camera** (FOV 72, near 0.01) so
the gun can never clip into walls; its metals need `vmScene.environment` or they render black.
`Loadout` handles ADS blend, recoil recovery, sway, bob, muzzle flash, lowering for grenades, and
**`reset()` which clears every timer** (see Bug 3).

### 5.4 `game/bots.js`

Difficulty table (reaction, spread, damage, burst, move, hp, grenade chance):

| | react | spread | dmg | burst | move | hp | nade |
|---|---|---|---|---|---|---|---|
| recruit | 0.62 | 0.075 | 0.55 | 2–4 | 0.80 | 100 | 0.10 |
| regular | 0.40 | 0.048 | 0.80 | 3–6 | 0.95 | 100 | 0.18 |
| veteran | 0.26 | 0.032 | 1.00 | 4–8 | 1.08 | 110 | 0.28 |
| hardened | 0.16 | 0.021 | 1.25 | 5–10 | 1.18 | 125 | 0.40 |

States `patrol → hunt → engage`. Engage: hold ~12 m, strafe, flip direction every 0.9–2.3 s.
Line of sight via `clearLine`. Fire in bursts after a reaction delay; hit chance compares the aim
error against the player's angular size. Bots hop over obstructions, flee live grenades within
6.5 m, and in `hunt` lob a frag at your last known position (7–26 m) — **trying flatter arcs first
and raising them until `clearArc` says the throw clears cover**, else waiting 2 s and moving.
Visuals: parts merged into **one vertex-coloured mesh**, invisible hitbox meshes for head/body/limb
(`Raycaster` ignores `visible`), an emissive visor, and a **blob shadow disc** (bots never enter
the baked shadow map). Every timer resets in `spawn()`.

### 5.5 `game/grenades.js`

`FRAG = { fuse 3.2 s, radius 7.5 m, damage 160, throwSpeed 15, upBoost 3.0, perLife 2, max 4,
r 0.09 }`, gravity 20.
Cook → throw → per-axis bounce (0.32 vertical, 0.42 horizontal, 0.72 friction) → fuse → callback.
An arc preview (48 points) plus a landing ring, a blinking beacon on live grenades, a fuse tick
each second, and `clearArc()` for the bots. **Shared geometry and materials** — the first version
created new ones per throw and leaked GPU memory.

### 5.6 `game/effects.js`

Everything pooled, allocated once: 16 tracers, 320 spark/blood points (one cloud), **64 decals in
a single `InstancedMesh`**, 6 explosions (core + shell + ground ring), 60 smoke points with a
soft round canvas sprite. **No lights of their own** — `onFlash(pos, intensity)` drives the game's
single shared light. `warmupObjects()` exposes everything so shaders can be compiled at load.

### 5.7 `game/hud.js`

Health, ammo, weapon, dynamic crosshair, hitmarkers (normal/head/kill), scope overlay, killfeed,
damage-direction arrows, grenade count, cook ring, incoming-grenade markers, clutch tag,
killstreak box, stance tags, FPS/resolution readout, and a rotating minimap.
**Every per-frame write goes through `_text/_style/_cls`, which skip unchanged values** (a DOM
write forces style work even when identical), and the **minimap redraws at 20 Hz**.

---

## 6. `src/main.js` — how it all runs

**Boot order:** load settings → renderer → sky/lights → viewmodel scene → build map →
create player/loadout/bots/effects/HUD/grenades → `applyVideo()` → **warm-up compile** → menu.

**Renderer:** `outputColorSpace = SRGB`, `ACESFilmicToneMapping` at 1.06, `PCFShadowMap`,
**`shadowMap.autoUpdate = false`** (the level never moves — bake once, set `needsUpdate` after
changes), `antialias` chosen at construction from the preset, `desynchronized: true`.
A WebGL failure throws a readable message that the boot watchdog shows.

**Frame loop:** `requestAnimationFrame` → fps counter → auto-resolution → state step
(`playing` / `calib` / `gun`) → copy camera to the viewmodel camera → skip drawing when
`document.hidden` or the canvas is 0×0 → render (composer only when bloom is on) → clear depth →
render the viewmodel scene on top.

**`step(dt)` order matters:**
`scene.updateMatrixWorld()` → respawn → `updateLook` → `loadout.update` → `player.update` →
**`camera.updateMatrixWorld(true)` → `handleGunActions`** (so a shot or throw uses *this* frame's
aim, not last frame's) → bots → targets → grenades → airstrike queue → effects → timers → HUD →
`input.endFrame()`.

**`handleGunActions(now)`** implements: clutch re-level; grenade cook/throw; reload tap vs hold-to-
swap; killstreak; and firing with a **0.15 s input buffer** for semi-autos, plus the sniper's
`press = scope, release = fire` in trigger mode.

**`explode(pos, o)`** — `fx.explosion` + sound + shake + flash; damage falls off as
`damage × (1 − d/radius)^0.8` with a `clearLine` exposure test; credits kills; knocks range plates
down (and counts them as hits). **Self-damage only exists in deathmatch**; a grenade held to zero
is always fatal (`selfScale`).

**Killstreaks:** 3 = UAV (25 s), 5 = airstrike (6 bombs, 3.4 m apart along your aim, 0.16 s
apart after a 1.4 s delay), 7 = resupply. Earned streaks queue up; Aux spends the oldest. In the
Firing Range, Aux is a free practice airstrike on a 4 s cooldown.

**Modes:** `tdm`, `range`, `track` (the 30-second tracking test), plus states `menu`, `paused`,
`over`, `calib`, `gun`.

**Screens:** main menu (with a live control list built from the bindings), pause, settings
(Controls / Aim-Motion / Video / Gameplay tabs, auto-built from `SCHEMA` plus the binding table),
**Gun Check** (prep + live), **Aim Tuning**, end-of-match, and a click-to-capture overlay.

**Gun Check** — the demonstration piece. Ten tiles: Trigger, Clutch, Reload, Prime, Aux, Stick
click (tap→jump *and* hold→crouch), Joystick (all four), Stick full push, MPU-6500 (needs a 12°
swing each way, integrated from the raw counts) and Potentiometer (serial only — it sends no key).
With serial connected each button tile also shows a **PIN** light read from the GPIO, so
"pin lights but key doesn't" pinpoints firmware/binding vs wiring. The overlay is
`pointer-events: none` and the cursor is captured, so stray trigger pulls can't click menu buttons.

**Debug hooks** (`window.BA`) — required, the tests depend on them:
`tick(dt)`, `gunTick(dt)`, `shoot()`, `useStreak()`, `startMatch(mode)`, `startGunCheck()`,
`endGunCheck()`, `dynamicResolution(dt, t)`, `setDynScale(v, t)`, `renderFrame()`, plus
`S, G, C, DYN, player, loadout, bots, input, world, grenades, renderer, scene, composer`.

---

## 7. SETTINGS (defaults that must ship)

**Controls:** `adsMode 'trigger'`, `reloadHoldSwap true`, `swapHoldTime 0.45`, `grenadeCook true`,
`grenadeArc true`, `clutchRelevel true`, `clutchFreeze true`, `crouchMode 'hold'`.
**Aim:** `sensitivity 2.4`, `adsSensScale 0.62`, `scopeSensScale 0.38`, `invertY false`,
`motionMode true`, `minCutoff 1.1`, `beta 0.010`, `deadzone 0.35`, `driftComp 0.55`, `accel 0`,
`maxRate 90`, `aimAssist 0.55`, `aimSlowdown 0.45`.
**Video:** `quality 'balanced'`, `dynamicRes true`, `fov 85`, `renderScale 1`, `shadows true`,
`bloom false`, `viewBob 0.5`, `showFps true`.
**Gameplay:** `difficulty 'regular'`, `botCount 6`, `botGrenades true`, `scoreLimit 30`,
`matchMinutes 10`, `autoReload true`, `hitSound true`, `masterVolume 0.7`.

Stored in `localStorage` under `blackout-arena.aimbot.v2`; `load()` merges new actions into saved
bindings and migrates old quality names.

---

## 8. UI STYLE

One theme: amber `#ffb02e` on near-black, green `#7ee081` for friendly, red `#ff4433` for hostile,
condensed sans for labels, monospace for numbers, wide letter-spacing on headings. Panels: dark
translucent with a 2 px amber top border. Everything is CSS — no images.

---

## 9. SERVER AND LAUNCH

`serve.py` must be **threaded** (`ThreadingHTTPServer`, `daemon_threads`) and bind **both
`127.0.0.1` and `::1`** (loopback only, so no firewall prompt), send `Cache-Control: no-store`,
and force `text/javascript` for `.js`. Full source in **Appendix B**.
This matters: a single-threaded server made the game hang forever on load (Bug 4).
`run.bat` / `run.sh` try `python`, then `py`, then `npx serve`.

Run: `python serve.py` → `http://localhost:8080/`. Chrome/Edge/Brave recommended
(`unadjustedMovement` and WebSerial). In Brave, turn Shields off for localhost if anything stalls.

---

## 10. BUGS FOUND WHILE BUILDING — do not reintroduce these

| # | Bug | Cause | Fix |
|---|---|---|---|
| 1 | Stairs unclimbable | Step-up used the first intersecting collider, which was the ground plane | Step to the **highest** intersecting surface |
| 2 | Player glued to the ground | `Box3.intersectsBox` treats touching as intersecting | `EPS = 0.03` inset on the entity box |
| 3 | **Gun silently stops firing after a restart** | `G.time` restarts at 0 but weapon `nextShot`/`boltUntil`/`swapUntil` kept old values | `loadout.reset()` clears every timer; same for bots |
| 4 | **Page stuck on "Loading arena…"** | Single-threaded server blocked by one keep-alive connection | Threaded, dual-stack server + a boot watchdog that prints the real error |
| 5 | **Quick trigger taps did nothing** | Input was polled once per frame; a press+release inside one frame was lost | Latch every press until `endFrame()` |
| 6 | Clicks ignored when pointer lock was refused | Input required lock | `acceptUnlocked` while a match or Gun Check runs |
| 7 | Aim assist pushed aim **away** from targets | Target yaw computed with `atan2(x, z)` — 180° out for a `−Z` forward convention | `atan2(−x, −z)`, and assist must not be inverted by invert-Y |
| 8 | Slide never triggered | Crouch cancels sprint before the slide check | Check **last frame's** sprint state |
| 9 | Shots landed a frame late | Firing ran before the camera was placed | Fire after `player.update` + `camera.updateMatrixWorld(true)` |
| 10 | Rebinding cleared instead of set | Some key events arrive with an empty `event.code` | `codeOf()` falls back to `event.key` |
| 11 | Practice spawn sat on a sandbag wall | Shots flew over the targets | Range spawn at `(0, 0, 24)` |
| 12 | **Grenades "not working" in the Firing Range** | A self-kill respawned the player at a *deathmatch* corner, far from the targets; throws from against a wall started inside it; a slightly raised aim lobbed over the building out of sight | No self-damage in practice modes; respawn at `RANGE_SPAWN`; wall-safe throw origin; `throwSpeed 17.5 → 15`; beacon; plates count as hits |
| 13 | Viewmodel rendered black | Metals with no environment map | `vmScene.environment = scene.environment` |
| 14 | Stutter mid-fight | Light count changed at runtime → every shader recompiled | Exactly one dynamic light, always present; warm-up compile at load |

---

## 11. THE BUILD, IN ORDER (what was asked, and what each round changed)

1. **"Make a COD-like game that runs on any OS, with proper graphics, curated to my Pico +
   MPU9250 HID rig."** → the whole game: arena, weapons, bots, HUD, effects, motion pipeline,
   aim tuning screen, vendored three.js, launchers, hardware guide.
2. **"Start the server."**
3. **"It's stuck on loading."** → boot watchdog showing the real error, WebGL failure message.
4. **"Still not working — restart the server."** → found the single-threaded hang; threaded
   dual-stack `serve.py`.
5. **"Shooting doesn't work, with the gun or the mouse."** → Bugs 3, 5, 6 fixed; fire/aim made
   role-based.
6. **"Curate the whole game to my AIMBOT gun (wiring guide + wiring test given), and add
   grenades."** → the action/binding system, Controls tab, Gun Check screen, grenades,
   killstreaks, trigger-ADS, reload-hold-swap, clutch, stick-click jump/crouch, bot grenades,
   firmware `AIMBOT_master_v5` (compiled against his installed core), rewritten hardware guide.
   Bugs 7, 8, 10 fixed.
7. **"It lags a lot — I want very high FPS, sharp and simple."** → profiled: 12.8 ms/frame,
   ~440 draw calls, 17 lights. Merged static geometry, one shared dynamic light, baked shadows,
   box raycasts, pooled/instanced effects, HUD write-caching, quality presets. → 2.5 ms, ~45 calls.
8. **"More FPS, and the grenade doesn't work in the Firing Range."** → Lambert "lite" materials,
   automatic resolution, MSAA off on PERFORMANCE, low-latency canvas; Bug 12 fixed.

---

## 12. PERFORMANCE RULES (hard requirements)

1. **Draw calls stay ~45.** Merge all static geometry; one mesh per soldier; one mesh per gun.
2. **Exactly one dynamic light in the main scene**, always present. Never add per-effect lights,
   and never change the light count at runtime.
3. **Shadows are baked once** (`autoUpdate = false`). Moving things use blob shadows.
4. **World raycasts use `rayBoxes`/`clearLine`**, never mesh raycasts.
5. **Nothing is allocated during combat** — pool tracers, particles, decals, explosions, grenades.
6. **Compile every shader at load** (`renderer.compile`, with pooled objects temporarily visible).
7. **The HUD only writes to the DOM when a value changes**; minimap at 20 Hz.
8. **Presets:** PERFORMANCE (Lambert, 1×, no shadows, no MSAA), BALANCED (Lambert, 1.25×, baked
   shadows, MSAA), QUALITY (PBR, up to 2×, sharper shadows, optional bloom).
9. **Auto-resolution:** learn the refresh rate from the first 90 frames; if two consecutive 0.5 s
   windows average > 1.12 × the frame budget, drop the render scale by 0.05 (0.1 when badly over),
   floor **0.7**; restore +0.05 after 4 s of headroom. Ignore hidden tabs and frames > 0.25 s.

Measured (965 × 549 test window, 8 bots): **render 12.8 ms → 2.5 ms; draw calls ~440 → ~45;
lights 17 → 4; game logic 0.1 ms median, 1.8 ms at the 99th percentile.**

---

## 13. ACCEPTANCE TESTS

Drive the game exactly as the gun does — dispatch `KeyboardEvent`s with `code`, and `mousedown`
on `#view` — and step it deterministically with `BA.tick(1/60)` so nothing depends on
`requestAnimationFrame` (which pauses in hidden tabs).

| # | Test | Expected |
|---|---|---|
| 1 | Tap trigger (rifle) | exactly 1 shot |
| 2 | Hold trigger 0.5 s | ~5 shots, ADS reaches 1.0 |
| 3 | Press+release inside one frame | still fires (5 taps → 5 shots; pistol 4 → 4) |
| 4 | Hold trigger with the sniper | 0 shots while held, scope overlay on, **1 shot on release** |
| 5 | Tap `R` | reloads; magazine refills |
| 6 | Hold `R` 0.45 s | switches weapon, does **not** reload |
| 7 | Tap `G` | grenade thrown, count −1, explodes on the fuse |
| 8 | Hold `G` | cook progress rises, gun lowers, arc shows, firing blocked |
| 9 | Hold `G` past 3.2 s | it kills you, and gives the enemy no point |
| 10 | Frag next to a bot | bot dies, killfeed shows FRAG, counted in frag kills |
| 11 | Frag with a wall between | no damage |
| 12 | Aux with nothing earned | "NO KILLSTREAK — n MORE FOR …" |
| 13 | 3 / 5 / 7 kills | UAV, AIRSTRIKE, RESUPPLY queue in order; Aux spends the oldest |
| 14 | Airstrike | 6 bombs queued, explosions kill nearby bots |
| 15 | `F` (clutch) | pitch snaps to 0; aim frozen while held; tag shows |
| 16 | `W` / Shift / `C` | walk 5.3, sprint 7.9, sprint+crouch slides |
| 17 | `Space` tap | jumps |
| 18 | Walk into a container | blocked at its face |
| 19 | Walk up the building ramp | reaches roof height (~7.4) |
| 20 | Range: level throw | lands ~12 m ahead, in view, knocks plates, counts hits |
| 21 | Range: throw at your feet | **no damage** |
| 22 | Range: throw against a crate | grenade does not start inside it |
| 23 | Gun Check: every input | 10/10 tiles pass; PIN-only shows the binding warning |
| 24 | Rebinding | click slot, press a key/button → bound, saved, conflicts swapped |
| 25 | Quality presets | all three switch with no errors; bloom only in QUALITY |
| 26 | Auto-resolution | one spike ignored; sustained load trims to ≥ 0.7; restores after ~20 s |
| 27 | 2 minutes of simulated combat, 8 bots, grenades on | **zero errors**, logic ≤ ~2 ms p99 |
| 28 | Shader programs before vs after a fight | unchanged (no mid-match compiles) |

---

## APPENDIX A — `hardware/AIMBOT_master_v5/AIMBOT_master_v5.ino`

```cpp
/* ============================================================
   AIMBOT — MASTER v5   (Blackout Arena edition)
   Raspberry Pi Pico  ·  MPU-6500  ·  joystick  ·  potentiometer
   5 buttons: Trigger, Clutch, Reload, Prime, Aux

   The gun becomes a USB mouse + keyboard. Works in Blackout Arena
   and in any other PC game.

   BOARD SETUP (Arduino IDE)
     Board package : "Raspberry Pi Pico/RP2040" by Earle Philhower
     Board         : Raspberry Pi Pico  (or Pico W)
     USB Stack     : "Pico SDK"   (gives Mouse + Keyboard + Serial together)

   WIRING — identical to WIRING_GUIDE.md / WIRING_TEST.ino:
     3V3(OUT) pin 36 -> (+) rail        GND pin 38 -> (-) rail
     MPU-6500 : SDA->GP4 (pin 6)  SCL->GP5 (pin 7)
     Joystick : VRx->GP26 (31)  VRy->GP27 (32)  SW->GP13 (17)
     Pot      : wiper->GP28 (34), outer legs to (+) and (-)
     Buttons  : Trigger GP10(14)  Clutch GP11(15)  Reload GP12(16)
                Prime   GP14(19)  Aux    GP16(21)   (other leg -> GND)

   WHAT EACH COMPONENT SENDS            (game: Settings -> Controls)
     Trigger        left mouse button (held)          Fire
     Clutch         'f' (held) + freezes aim          Pause aim / re-level
                    hold 3 s with the gun still  ->   gyro recalibration
     Reload         'r' (held)                        tap = reload, hold = swap
     Prime          'g' (held)                        hold = cook, release = throw
     Aux            '3'                               call in killstreak
     Stick click    tap  -> space                     jump
                    hold -> 'c' (held)                crouch / slide
     Stick          w / a / s / d                     move
     Stick full fwd left shift (held)                 sprint
     MPU-6500       mouse movement                    aim
     Potentiometer  aim speed x0.33 ... x3.0          sensitivity dial

   USB SERIAL (115200) — optional, read by the game's GUN CHECK:
     T gx10 gy10 gz10 jx jy pot mask sens100 mpuOk      (~25 Hz)
     I <info>                                          (every 2 s)
   Only sent while a program has the port open. Close the Arduino
   Serial Monitor before connecting from the game.

   FIRST RUN: set DEBUG_MODE true, mount the sensor in the gun, and
   follow the axis test (Serial Monitor). Then set it back to false.
   ============================================================ */

#include <Wire.h>
#include <Mouse.h>
#include <Keyboard.h>

// ------------------------------------------------------------ mode
#define DEBUG_MODE false      // true = axis test on Serial, NO mouse/keyboard output

// ------------------------------------------------------------ pins
const int MPU_ADDR = 0x68;
#define TRIGGER_PIN 10
#define CLUTCH_PIN  11
#define RELOAD_PIN  12
#define JOY_SW_PIN  13
#define PRIME_PIN   14
#define AUX_PIN     16
#define JOY_X  A0     // GP26
#define JOY_Y  A1     // GP27
#define POT_PIN A2    // GP28

// ------------------------------------------------------------ aim axes
// Which gyro axis turns the view: 0 = X, 1 = Y, 2 = Z.
// These depend on how the sensor sits inside the gun — use DEBUG_MODE to find them.
//   YAW   : swing the gun to the RIGHT  -> use the axis & sign the axis test prints
//   PITCH : tilt the barrel UP          -> use the axis & sign the axis test prints
int   YAW_AXIS   = 2;
float YAW_SIGN   = -1.0;
int   PITCH_AXIS = 1;
float PITCH_SIGN = -1.0;

// ------------------------------------------------------------ aim tuning
const float COUNTS_PER_DEG = 8.0;    // mouse counts per degree at pot centre (~1:1 in Blackout Arena)
const float POT_RANGE      = 3.0;    // pot sweeps x(1/3) ... x3
const bool  POT_REVERSED   = false;  // flip if turning the knob "up" slows the aim
const float GYRO_DEADBAND  = 0.3;    // deg/s floor after bias removal (the game filters the rest)
const uint32_t REPORT_US   = 4000;   // 250 Hz output
const float GYRO_SENS      = 32.8;   // LSB per deg/s at +/-1000 dps (a fast swing exceeds 250 dps)

// ------------------------------------------------------------ joystick
// WIRING_TEST convention: X bigger than centre = LEFT, Y bigger than centre = UP
const bool JOY_INVERT_X   = false;
const bool JOY_INVERT_Y   = false;
const int  JOY_ON         = 700;     // counts from centre to press a direction
const int  JOY_OFF        = 450;     // ...and to release it (hysteresis)
const int  JOY_SPRINT_ON  = 1600;    // push this far forward to sprint
const int  JOY_SPRINT_OFF = 1350;
const uint32_t JOYSW_HOLD_MS = 250;  // stick click: shorter = jump, longer = crouch

// ------------------------------------------------------------ keys (match game Settings -> Controls)
const uint8_t K_CLUTCH  = 'f';
const uint8_t K_RELOAD  = 'r';
const uint8_t K_GRENADE = 'g';
const uint8_t K_STREAK  = '3';
const uint8_t K_JUMP    = ' ';
const uint8_t K_CROUCH  = 'c';
const uint8_t K_FWD     = 'w';
const uint8_t K_BACK    = 's';
const uint8_t K_LEFT    = 'a';
const uint8_t K_RIGHT   = 'd';
const uint8_t K_SPRINT  = KEY_LEFT_SHIFT;

const uint32_t CLUTCH_RECAL_MS = 3000;
const float    STILL_DPS       = 4.0;

// ============================================================ state
struct Btn { uint8_t pin; bool state; bool raw; uint32_t changedAt; };
Btn bTrig   = { TRIGGER_PIN };
Btn bClutch = { CLUTCH_PIN };
Btn bReload = { RELOAD_PIN };
Btn bJoySw  = { JOY_SW_PIN };
Btn bPrime  = { PRIME_PIN };
Btn bAux    = { AUX_PIN };

bool  mpuReady = false;
uint8_t whoAmIVal = 0xFF;
float bias[3] = { 0, 0, 0 };
float rate[3] = { 0, 0, 0 };
int   centerX = 2048, centerY = 2048;
float potSmooth = 2048;
float sensMult = 1.0;
float remX = 0, remY = 0;

bool kFwd = false, kBack = false, kLeft = false, kRight = false, kSprint = false;
bool kClutch = false, kReload = false, kGrenade = false, kCrouch = false, mTrig = false;
uint32_t joyDownAt = 0;
uint32_t clutchStillSince = 0;
bool     clutchRecalDone = false;

uint32_t lastTickUs = 0, lastTele = 0, lastInfo = 0, lastInit = 0, lastDebug = 0;

// ============================================================ helpers
bool updateBtn(Btn &b) {
  bool r = digitalRead(b.pin) == LOW;
  uint32_t now = millis();
  if (r != b.raw) { b.raw = r; b.changedAt = now; }
  if (r != b.state && now - b.changedAt >= 8) { b.state = r; return true; }   // 8 ms debounce
  return false;
}

void keyHold(uint8_t k, bool on, bool &flag) {
  if (on == flag) return;
  flag = on;
  if (DEBUG_MODE) return;
  if (on) Keyboard.press(k); else Keyboard.release(k);
}

void keyTap(uint8_t k) {
  if (DEBUG_MODE) return;
  Keyboard.press(k);
  delay(12);                 // long enough for every OS to register it
  Keyboard.release(k);
}

void mouseHold(bool on) {
  if (on == mTrig) return;
  mTrig = on;
  if (DEBUG_MODE) return;
  if (on) Mouse.press(MOUSE_LEFT); else Mouse.release(MOUSE_LEFT);
}

void writeReg(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg); Wire.write(val);
  Wire.endTransmission();
}

uint8_t whoAmI() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x75);
  if (Wire.endTransmission(false) != 0) return 0xFF;
  if (Wire.requestFrom(MPU_ADDR, 1) != 1) return 0xFF;
  return Wire.read();
}

void initMPU() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B); Wire.write(0x01);            // wake, PLL clock
  if (Wire.endTransmission() != 0) { mpuReady = false; return; }
  delay(50);
  writeReg(0x1A, 0x03);                          // DLPF ~44 Hz
  writeReg(0x19, 0x00);                          // 1 kHz internal rate
  writeReg(0x1B, 0x10);                          // gyro +/-1000 dps
  writeReg(0x1C, 0x00);                          // accel +/-2 g
  whoAmIVal = whoAmI();
  mpuReady = true;
}

bool readGyro(float &gx, float &gy, float &gz) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x43);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(MPU_ADDR, 6) != 6) return false;
  int16_t x = (Wire.read() << 8) | Wire.read();
  int16_t y = (Wire.read() << 8) | Wire.read();
  int16_t z = (Wire.read() << 8) | Wire.read();
  gx = x / GYRO_SENS; gy = y / GYRO_SENS; gz = z / GYRO_SENS;
  return true;
}

// Average the gyro while the gun is still. This is what stops the crosshair creeping.
void calibrateGyro(int samples) {
  float sx = 0, sy = 0, sz = 0;
  int n = 0;
  for (int i = 0; i < samples; i++) {
    float gx, gy, gz;
    if (readGyro(gx, gy, gz)) { sx += gx; sy += gy; sz += gz; n++; }
    digitalWrite(LED_BUILTIN, (i / 25) % 2);
    delay(3);
  }
  if (n > 0) { bias[0] = sx / n; bias[1] = sy / n; bias[2] = sz / n; }
  digitalWrite(LED_BUILTIN, LOW);
}

void centerJoystick() {
  long sx = 0, sy = 0;
  for (int i = 0; i < 20; i++) { sx += analogRead(JOY_X); sy += analogRead(JOY_Y); delay(5); }
  centerX = sx / 20;
  centerY = sy / 20;
}

char axisName(int a) { return "XYZ"[a]; }

// ============================================================ setup
void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  Btn *btns[] = { &bTrig, &bClutch, &bReload, &bJoySw, &bPrime, &bAux };
  for (Btn *b : btns) pinMode(b->pin, INPUT_PULLUP);

  analogReadResolution(12);

  Wire.setSDA(4);
  Wire.setSCL(5);
  Wire.begin();
  Wire.setClock(100000);            // safe on breadboard wiring
  delay(300);

  initMPU();
  centerJoystick();
  potSmooth = analogRead(POT_PIN);

  if (!DEBUG_MODE) {
    Mouse.begin();
    Keyboard.begin();
    Keyboard.releaseAll();
  }

  // keep the gun still for ~1.5 s after plugging in
  if (mpuReady) calibrateGyro(500);
  lastTickUs = micros();
}

// ============================================================ loop
void loop() {
  uint32_t nowUs = micros();
  if (nowUs - lastTickUs < REPORT_US) return;
  float dt = (nowUs - lastTickUs) / 1e6f;
  lastTickUs = nowUs;
  if (dt > 0.05f) dt = 0.05f;
  uint32_t now = millis();

  // ---------------- sensor ----------------
  if (!mpuReady && now - lastInit > 2000) { lastInit = now; initMPU(); if (mpuReady) calibrateGyro(300); }
  float g[3] = { 0, 0, 0 };
  if (mpuReady) {
    float gx, gy, gz;
    if (readGyro(gx, gy, gz)) {
      g[0] = gx - bias[0]; g[1] = gy - bias[1]; g[2] = gz - bias[2];
    } else {
      mpuReady = false;
    }
  }
  for (int i = 0; i < 3; i++) rate[i] = g[i];

  // ---------------- potentiometer -> sensitivity ----------------
  potSmooth += (analogRead(POT_PIN) - potSmooth) * 0.08f;
  float p = potSmooth / 4095.0f;
  if (POT_REVERSED) p = 1.0f - p;
  sensMult = pow(POT_RANGE, (p - 0.5f) * 2.0f);

  // ---------------- buttons ----------------
  updateBtn(bTrig);  updateBtn(bReload); updateBtn(bPrime);
  bool clutchEdge = updateBtn(bClutch);
  bool joyEdge    = updateBtn(bJoySw);
  bool auxEdge    = updateBtn(bAux);

  mouseHold(bTrig.state);
  keyHold(K_CLUTCH,  bClutch.state, kClutch);
  keyHold(K_RELOAD,  bReload.state, kReload);
  keyHold(K_GRENADE, bPrime.state,  kGrenade);
  if (auxEdge && bAux.state) keyTap(K_STREAK);

  // stick click: short tap = jump (on release), hold = crouch (held)
  if (joyEdge && bJoySw.state) joyDownAt = now;
  if (bJoySw.state && !kCrouch && now - joyDownAt >= JOYSW_HOLD_MS) keyHold(K_CROUCH, true, kCrouch);
  if (joyEdge && !bJoySw.state) {
    if (kCrouch) keyHold(K_CROUCH, false, kCrouch);
    else keyTap(K_JUMP);
  }

  // clutch held still for 3 s -> recalibrate the gyro
  float mag = fabs(g[0]) + fabs(g[1]) + fabs(g[2]);
  if (clutchEdge) { clutchStillSince = now; clutchRecalDone = false; }
  if (bClutch.state && mpuReady) {
    if (mag > STILL_DPS) clutchStillSince = now;
    if (!clutchRecalDone && now - clutchStillSince >= CLUTCH_RECAL_MS) {
      calibrateGyro(300);
      clutchRecalDone = true;
    }
  }

  // ---------------- joystick -> WASD + sprint ----------------
  int dx = analogRead(JOY_X) - centerX;      // + = LEFT
  int dy = analogRead(JOY_Y) - centerY;      // + = UP
  if (JOY_INVERT_X) dx = -dx;
  if (JOY_INVERT_Y) dy = -dy;
  keyHold(K_FWD,   kFwd   ? dy >  JOY_OFF : dy >  JOY_ON, kFwd);
  keyHold(K_BACK,  kBack  ? dy < -JOY_OFF : dy < -JOY_ON, kBack);
  keyHold(K_LEFT,  kLeft  ? dx >  JOY_OFF : dx >  JOY_ON, kLeft);
  keyHold(K_RIGHT, kRight ? dx < -JOY_OFF : dx < -JOY_ON, kRight);
  keyHold(K_SPRINT, kSprint ? dy > JOY_SPRINT_OFF : dy > JOY_SPRINT_ON, kSprint);

  // ---------------- gyro -> mouse ----------------
  if (!bClutch.state && mpuReady) {
    float yawRate   = rate[YAW_AXIS]   * YAW_SIGN;
    float pitchRate = rate[PITCH_AXIS] * PITCH_SIGN;
    if (fabs(yawRate)   < GYRO_DEADBAND) yawRate = 0;
    if (fabs(pitchRate) < GYRO_DEADBAND) pitchRate = 0;
    // carry the fraction, so slow aiming is never rounded away
    remX += yawRate   * dt * COUNTS_PER_DEG * sensMult;
    remY += pitchRate * dt * COUNTS_PER_DEG * sensMult;
    int mx = constrain((int)remX, -127, 127);
    int my = constrain((int)remY, -127, 127);
    remX -= mx; remY -= my;
    if ((mx || my) && !DEBUG_MODE) Mouse.move(mx, my, 0);
  } else {
    remX = remY = 0;            // clutch: the gun can be re-pointed without moving the view
  }

  // ---------------- telemetry for the game's GUN CHECK ----------------
  if (!DEBUG_MODE && Serial && now - lastTele >= 40) {
    lastTele = now;
    int mask = (bTrig.state ? 1 : 0) | (bClutch.state ? 2 : 0) | (bReload.state ? 4 : 0) |
               (bJoySw.state ? 8 : 0) | (bPrime.state ? 16 : 0) | (bAux.state ? 32 : 0);
    Serial.printf("T %d %d %d %d %d %d %d %d %d\n",
      (int)(rate[0] * 10), (int)(rate[1] * 10), (int)(rate[2] * 10),
      dx, dy, (int)potSmooth, mask, (int)(sensMult * 100), mpuReady ? 1 : 0);
  }
  if (!DEBUG_MODE && Serial && now - lastInfo >= 2000) {
    lastInfo = now;
    Serial.printf("I AIMBOT-v5 WHO=0x%02X YAW=%c%c PITCH=%c%c CPD=%.1f\n",
      whoAmIVal, axisName(YAW_AXIS), YAW_SIGN > 0 ? '+' : '-',
      axisName(PITCH_AXIS), PITCH_SIGN > 0 ? '+' : '-', COUNTS_PER_DEG);
  }

  // ---------------- DEBUG: axis test ----------------
  if (DEBUG_MODE && now - lastDebug >= 150) {
    lastDebug = now;
    if (!mpuReady) {
      Serial.println("MPU NOT RESPONDING -> check VCC=3V3, GND, SDA=GP4, SCL=GP5 (try swapping SDA/SCL)");
      return;
    }
    int dom = 0;
    for (int i = 1; i < 3; i++) if (fabs(rate[i]) > fabs(rate[dom])) dom = i;
    Serial.printf("GX %7.1f  GY %7.1f  GZ %7.1f  |", rate[0], rate[1], rate[2]);
    if (fabs(rate[dom]) > 30) {
      int s = rate[dom] > 0 ? 1 : -1;
      Serial.printf("  moving on %c.  If swinging RIGHT: YAW_AXIS=%d YAW_SIGN=%d.0", axisName(dom), dom, s);
      Serial.printf("  If tilting UP: PITCH_AXIS=%d PITCH_SIGN=%d.0", dom, -s);
    } else {
      Serial.print("  (still — swing RIGHT, then tilt the barrel UP)");
    }
    Serial.printf("  | pot %d%% x%.2f  joy %d,%d  btn %d%d%d%d%d%d\n",
      (int)(potSmooth / 40.95), sensMult, dx, dy,
      bTrig.state, bClutch.state, bReload.state, bJoySw.state, bPrime.state, bAux.state);
  }
}
```

---

## APPENDIX B — `serve.py`

```python
#!/usr/bin/env python3
"""Tiny static server for Blackout Arena. Works with any Python 3.7+ on any OS."""
import http.server, os, sys, socket, threading, webbrowser, functools

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css'}

    def end_headers(self):
        # never serve a stale module while you are editing
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


class Server(http.server.ThreadingHTTPServer):
    # Threaded, so one browser holding a keep-alive connection can't stall every other request.
    daemon_threads = True
    allow_reuse_address = True


class Server6(Server):
    address_family = socket.AF_INET6


handler = functools.partial(Handler, directory=ROOT)
# Loopback only. Listen on IPv4 and IPv6 so "localhost" works whichever one it resolves to.
httpd = Server(("127.0.0.1", PORT), handler)
try:
    httpd6 = Server6(("::1", PORT), handler)
    threading.Thread(target=httpd6.serve_forever, daemon=True).start()
except OSError:
    pass  # no IPv6 loopback on this machine

url = f"http://localhost:{PORT}/"
print(f"BLACKOUT ARENA serving at {url}\nPress Ctrl+C to stop.", flush=True)
try:
    webbrowser.open(url)
except Exception:
    pass
try:
    httpd.serve_forever()
except KeyboardInterrupt:
    print("\nstopped.")
```

---

## APPENDIX C — `src/engine/controls.js` (the gun ↔ game contract)

```js
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
```

---

## APPENDIX D — REBUILD CHECKLIST

1. `mkdir blackout-arena`, create the tree in Section 3.
2. Download three.js r160.1 into `vendor/three/` (build + 7 postprocessing addons + 4 shaders +
   BufferGeometryUtils).
3. Write `index.html` (import map, HUD markup, every menu, boot watchdog) and `css/style.css`.
4. Write the engine: `controls.js` (Appendix C) → `settings.js` → `input.js` → `physics.js` →
   `merge.js` → `audio.js`.
5. Write the game: `map.js` → `player.js` → `weapons.js` → `bots.js` → `grenades.js` →
   `effects.js` → `hud.js`.
6. Write `main.js` last; it wires everything and owns the render path, match flow and all screens.
7. Write `serve.py` (Appendix B), `run.bat`, `run.sh`, `README.md`.
8. Write the firmware (Appendix A); compile it with
   `arduino-cli compile --fqbn rp2040:rp2040:rpipico:usbstack=picosdk` and ship the `.uf2`.
9. Run every Acceptance Test in Section 13.
10. Verify the Performance Rules in Section 12 with `renderer.info` (draw calls) and a frame timer.

**If anything in this document conflicts with a memory of "how games are usually made", this
document wins. The constants here are tuned, not arbitrary.**
