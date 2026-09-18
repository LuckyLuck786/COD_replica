# COD_replica

**BLACKOUT ARENA** — an original first-person arena shooter in the Call of Duty style, built to
run entirely offline from a folder and driven by a custom "AIMBOT" nerf-gun controller (a
Raspberry Pi Pico acting as a USB mouse + keyboard over gyro, joystick, and five buttons).

It is not a copy of any existing game's maps, weapons, audio, or art — those are original and
generated at runtime. What's reproduced is the *feel*: time-to-kill, ADS, recoil, movement,
grenades, and killstreaks.

## Quick start

Requires only Python 3.7+ (no build step, no npm, no bundler — three.js is vendored in the
repo). The game must be served over `http://`, not opened as a `file://` path — ES modules and
pointer lock both need a real origin.

```bash
python serve.py
```

or double-click `run.sh` (macOS/Linux) / `run.bat` (Windows). Then open
`http://localhost:8080/` if it doesn't open automatically. Chrome, Edge, or Brave are
recommended (for `unadjustedMovement` mouse input and WebSerial gun telemetry).

## Playing with a mouse and keyboard

The game plays fully with a normal mouse and keyboard — the AIMBOT gun is optional. Defaults:

| Action | Key |
|---|---|
| Move | `W A S D` (+ arrow keys) |
| Aim | Mouse |
| Fire | Left click |
| Aim down sights | Right click |
| Jump | `Space` |
| Crouch / slide | `C` (or Left Ctrl) |
| Sprint | Left Shift |
| Reload (hold = swap weapon) | `R` |
| Grenade (hold = cook) | `G` |
| Clutch (re-level view / freeze aim) | `F` |
| Call in killstreak | `3` |
| Next weapon | `Q` |

Every action is rebindable from **Settings → Controls** — click a slot, then press the new key
or mouse button. `Escape` is reserved for pause and can't be rebound.

## Playing with the AIMBOT gun

See `hardware/README.md` for the full build guide: parts list, wiring diagram, and firmware
flashing instructions. In short: the gun enumerates as a USB mouse + keyboard, so it needs no
driver. Plug it in, and it drives the game exactly like a mouse and keyboard would.

Use **Gun Check** (main menu) to verify every input end-to-end before playing — it lights up as
each button, the stick, the gyro, and the sensitivity dial are exercised, and (with the gun's
serial port connected) shows a raw GPIO pin light next to each button so a wiring problem and a
binding problem are never confused.

Use **Aim Tuning** to watch the raw vs. filtered gyro trace live and tune sensitivity, the
One-Euro filter's `minCutoff`/`beta`, deadzone, and drift compensation.

## Modes

- **Deathmatch** — score-limited or time-limited free-for-all against AI bots.
- **Firing Range** — no bots, no self-damage, stationary practice targets and a free killstreak
  every few seconds. Good for tuning aim and testing grenades.
- **Tracking Test** — a 30-second drill that scores how steadily you track a moving point;
  useful for comparing gun sensitivity settings.

## Settings

- **Controls** — ADS mode (squeeze/hold/toggle), reload-hold-to-swap, grenade cook, clutch
  behaviour, crouch mode.
- **Aim-Motion** — sensitivity, per-context sensitivity scales (ADS/scope), invert Y, the motion
  filter and its parameters, aim assist.
- **Video** — quality preset (Performance/Balanced/Quality), dynamic resolution, FOV, shadows,
  bloom, view bob, FPS counter.
- **Gameplay** — bot difficulty and count, score/time limits, auto-reload, hit sound, volume.

Settings are stored in your browser's `localStorage`, so they persist between sessions on the
same machine.

## Performance

The renderer targets a stable high frame rate on modest hardware: all static level geometry is
merged into a handful of draw calls, shadows are baked once (the level never moves), there's
exactly one dynamic light, and every particle/tracer/decal system is pooled — nothing is
allocated mid-fight. Dynamic resolution trims render scale under sustained load and restores it
once the frame is comfortably inside budget again. If it's still not smooth, drop the quality
preset to **Performance**.

## Troubleshooting

- **Stuck on "Loading arena…"** — make sure you're running `python serve.py` and not opening
  `index.html` directly; check the browser console for the real error.
- **Gun connects but nothing happens in-game** — open Gun Check; if the PIN light comes on but
  the key tile doesn't pass, the wiring is fine and the firmware's key mapping (or your in-game
  binding) doesn't match — see `hardware/README.md`.
- **Everything is black** — your GPU/browser may not support WebGL2; try Chrome/Edge, or update
  graphics drivers.
- **In Brave**, turn Shields off for `localhost` if the page stalls.

See `BUILD_PROMPT.md` for the full technical specification this game was built from.
