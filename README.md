# BLACKOUT ARENA — AIMBOT nerf-gun edition

A first-person arena shooter in the Call of Duty mould, built to be played with the **AIMBOT
nerf gun**: Raspberry Pi Pico, MPU-6500 aiming, joystick movement, a potentiometer
sensitivity dial, and Trigger / Clutch / Reload / Prime / Aux buttons.

It has ADS, sprint/slide/crouch, recoil and spread bloom, headshots, **frag grenades**
(cook, throw, bounce), **killstreaks** (UAV, airstrike, resupply), bots that flank and throw
grenades, a killfeed, and a rotating minimap. It runs in the browser on WebGL2, so the same
folder works on Windows, macOS and Linux with nothing to compile.

**Gun setup, firmware and wiring notes: [`hardware/README.md`](hardware/README.md).**

**Pico firmware source lives in [`hardware/`](hardware/)** — the current build is
[`AIMBOT_master_v11`](hardware/AIMBOT_master_v11/AIMBOT_master_v11.ino) (tilt-compensated aim,
automatic button polarity, on-Pico One-Euro filtering), with the previous
[`AIMBOT_master_v5`](hardware/AIMBOT_master_v5/AIMBOT_master_v5.ino) and its ready-to-flash
`.uf2` kept alongside it.

**Rebuilding this game from scratch: [`BUILD_PROMPT.md`](BUILD_PROMPT.md)** — the complete
specification (hardware, firmware, every file, every constant, the bugs found, and the tests).

---

## Run it

```bash
python serve.py
```

Or double-click `run.bat` (Windows) / `./run.sh` (macOS, Linux). Either one starts a local
server and opens `http://localhost:8080/`.

**It must be served over http, not opened as a `file://` path** — ES modules and pointer lock
both require an origin. Any static server works (`npx serve`, `php -S`, VS Code Live Server…).

Use **Chrome or Edge** for the best result: they support `unadjustedMovement` on pointer lock,
which bypasses the OS mouse acceleration curve. Firefox and Safari run the game fine but apply
the OS curve to your motion input.

Click **DEPLOY**, and the game captures your pointer. `Esc` pauses and releases it.

---

## Controls

| Gun | Action |
|---|---|
| Trigger | Fire (aims while held; sniper: squeeze = scope, release = fire) |
| Clutch | Pause aim / re-level view (hold 3 s still = gyro recalibration) |
| Reload | Tap = reload · hold = switch weapon |
| Prime | Grenade — hold to cook, release to throw |
| Aux | Call in killstreak |
| Stick click | Tap = jump · hold = crouch (slide while sprinting) |
| Joystick | Move · full forward = sprint |
| MPU-6500 | Aim |
| Potentiometer | Sensitivity dial |

Every button can be remapped in **Settings → Controls**. On a keyboard the defaults are the
same keys the gun sends: `W A S D`, `Shift`, `Space`, `C`, `R`, `G`, `3`, `F`, plus left/right
mouse. `Esc` pauses.

---

## Modes

- **Deploy** — team deathmatch against bots. Score limit, match length, hostile count and
  difficulty are all in Settings → Gameplay.
- **Firing Range** — pop-up plates, a moving target, a live accuracy readout, unlimited grenades
  and a free practice airstrike on Aux.
- **Gun Check** — a live tile per gun component (and raw pins / gyro / pot over USB serial),
  ticked off as each one works.
- **Aim Tuning** — drift test, jitter readout, raw-vs-filtered trace, and a scored 30-second
  tracking test.

---

## How the gun talks to the game

The gun's Pico is a USB mouse + keyboard, so the browser gets ordinary input with no setup.
**Motion Mode** (on by default) runs the mouse movement through a pipeline built for a gyro:
spike rejection → noise deadzone → One-Euro adaptive filter → drift-bias cancellation → aim
magnetism and target slowdown. Every button press is latched, so a tap shorter than one frame
still counts.

An optional USB-serial link carries raw telemetry (pins, gyro, joystick, potentiometer) for the
Gun Check. It is diagnostics only and never moves the aim, so input is never counted twice.

⚠ That serial link currently expects the **v5** telemetry format. v11 sends a different line, so
leave *Connect gun over USB serial* alone while v11 is flashed — see
[§7.4 of the hardware guide](hardware/README.md#74-v11-serial-telemetry--not-yet-read-by-the-game).
The gun is a plain USB mouse + keyboard, so the game and the rest of GUN CHECK are unaffected.

---

## Performance

**Settings → Video → Quality Preset:**

| Preset | Lighting | Resolution | Shadows | Antialiasing | Bloom | Use it when |
|---|---|---|---|---|---|---|
| **PERFORMANCE** | simple | native, capped at 1× | off | off* | off | Maximum FPS, laptops, integrated GPUs |
| **BALANCED** (default) | simple | up to 1.25× | baked | on | off | Most PCs |
| **QUALITY** | full PBR | up to 2× | baked, sharper | on | optional | Strong dedicated GPU |

\* Antialiasing is fixed when the page loads, so switching to or from PERFORMANCE fully applies
after a reload.

**Auto Resolution** (on by default) learns your monitor's refresh rate (60 / 144 / 240 Hz). When
frames start falling behind it, it trims the render resolution in 5 % steps, never below 70 %.
It restores full resolution a few seconds after the load drops. While it's active, the FPS
counter shows `RES xx%`. **Render Scale** sets a fixed cap on top of that.

What keeps it fast (v2.1):
- **~45 draw calls per frame instead of ~440.** The level is baked into about a dozen meshes, each
  soldier is one mesh, and each gun is one mesh.
- **Simple lighting for the level** on PERFORMANCE and BALANCED: Lambert instead of physically
  based materials, roughly half the per-pixel cost.
- **One dynamic light instead of 17.** Muzzle flashes and explosions share it, and the lamps are
  emissive only. The light count never changes, so shaders never recompile mid-match.
- **Shadows rendered once at load** instead of every frame. Bots use a cheap contact shadow.
- **Bullets, line of sight and blast checks** test ray against collision box, not the render
  meshes.
- **Everything pooled:** tracers, sparks, decals (one instanced mesh), explosions, smoke,
  grenades. Nothing is created during combat.
- **All shaders are compiled while loading,** so the first shot or explosion doesn't stutter.
- **The HUD only touches the page when a value changes,** and the minimap redraws at 20 Hz.

---

## Layout

```
index.html            shell + HUD markup
css/style.css         HUD and menu styling
src/main.js           renderer, post-processing, match logic, menus, calibration
src/settings.js       persisted settings + the schema that builds the options UI
src/engine/input.js   rebindable actions, press latching, One-Euro gyro filter, WebSerial telemetry
src/engine/controls.js the gun's action map and what the firmware sends
src/engine/physics.js swept AABB collision with step-up
src/engine/audio.js   procedural WebAudio weapon and impact sound
src/game/map.js       arena geometry, colliders, procedural textures
src/game/player.js    movement, stance, camera, health
src/game/weapons.js   weapon table, viewmodel, recoil and spread
src/game/bots.js      hostile AI: navigation, line of sight, burst fire, hit zones
src/game/grenades.js  frag cooking, throwing, bounce physics, arc preview
src/game/effects.js   tracers, impacts, decals, blood, explosions, smoke
src/game/hud.js       HUD, killfeed, damage indicators, minimap
vendor/three/         three.js r160 (vendored, so the game runs fully offline)
hardware/             Pico firmware source and the gun guide:
  AIMBOT_master_v11/    current sketch — tilt-compensated aim, auto button polarity,
                        on-Pico One-Euro filter, optional MPU data-ready interrupt
  AIMBOT_master_v5/     previous sketch, matching AIMBOT_master_v5.uf2
  AIMBOT_master_v5.uf2  prebuilt v5 build — drag onto RPI-RP2 with BOOTSEL held
  README.md             wiring, flashing, tuning, and what changed in v11
```

No build step, no package manager, no network access at runtime.

---

## A note on the brief

This is an original game built in the Call of Duty *style*. It is not, and could not be, a copy
of Call of Duty itself — that is roughly a thousand people working for three years on a
proprietary engine, and its maps, weapons, audio and art are protected work. What is here is the
part that actually matters for your demonstration: the feel — time-to-kill, ADS behaviour,
recoil, movement, and the moment-to-moment loop — driven end-to-end by your own hardware.
