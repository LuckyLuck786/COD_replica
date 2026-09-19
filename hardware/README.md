# AIMBOT nerf gun × Blackout Arena

Firmware and setup for the gun described in `WIRING_GUIDE.md`:
Raspberry Pi Pico · MPU-6500 · joystick · potentiometer · Trigger / Clutch / Reload / Prime / Aux.

The gun is a **USB mouse + keyboard**. Nothing is installed on the PC, and the same firmware
works in any other game.

---

## 0. Which firmware

Two complete sketches live in this folder. Both are the real firmware that was flashed to the
gun; they are kept side by side so the older, documented build stays reproducible.

| Sketch | Source | Status |
|---|---|---|
| **AIMBOT v11.0** | [`AIMBOT_master_v11/AIMBOT_master_v11.ino`](AIMBOT_master_v11/AIMBOT_master_v11.ino) | **Current.** Auto button polarity, tilt-compensated aim, on-Pico One-Euro filter, dt clamp, optional MPU data-ready interrupt. See §7 |
| AIMBOT v5 | [`AIMBOT_master_v5/AIMBOT_master_v5.ino`](AIMBOT_master_v5/AIMBOT_master_v5.ino) | Previous release. The prebuilt [`AIMBOT_master_v5.uf2`](AIMBOT_master_v5.uf2) is **this** version |

Sections 2–6 below describe the v5 sketch (axis setup, its constants, its serial format).
**§7 lists everything v11 changes**, including one thing you must know before connecting v11 to
the game's serial Gun Check.

There is no prebuilt `.uf2` for v11 yet — build it from source in the Arduino IDE.

---

## 1. Flash the firmware

Wiring is exactly the wiring guide's, so if `WIRING_TEST.ino` passes, you're ready.

**Quick way (v5 only):** hold BOOTSEL, plug the Pico in, and drag
[`AIMBOT_master_v5.uf2`](AIMBOT_master_v5.uf2) onto the `RPI-RP2` drive. That build uses the
default axis settings below.

**Arduino IDE (needed for v11, and for v5 once you change any setting):** open either
[`AIMBOT_master_v11/AIMBOT_master_v11.ino`](AIMBOT_master_v11/AIMBOT_master_v11.ino) (current)
or [`AIMBOT_master_v5/AIMBOT_master_v5.ino`](AIMBOT_master_v5/AIMBOT_master_v5.ino).
- Board package: *Raspberry Pi Pico/RP2040* (Earle Philhower). It built clean against 6.1.0.
- Board: *Raspberry Pi Pico*
- Tools → **USB Stack: "Pico SDK"** (this gives mouse, keyboard and serial at the same time)
- Both sketches use only `Wire`, `Mouse` and `Keyboard` — no extra libraries to install.

Keep the gun **still for ~2 seconds after plugging in**. The LED blinks while it measures the
gyro's resting offset.

## 2. Set the aim axes — after the sensor is mounted

> **v5 only.** v11 works out the axes from gravity at runtime and prints no axis line — skip to
> §7 and set `FORWARD_X/Y/Z` instead.

Which gyro axis means "left/right" depends on how the MPU-6500 sits in the gun.

1. Set `#define DEBUG_MODE true` and upload. In this mode the sketch sends **no** mouse or
   keyboard input, so it's safe.
2. Open Serial Monitor at 115200.
3. **Swing the gun to the RIGHT.** The line tells you, for example,
   `If swinging RIGHT: YAW_AXIS=2 YAW_SIGN=-1.0`.
4. **Tilt the barrel UP.** Copy the `If tilting UP: PITCH_AXIS=… PITCH_SIGN=…` values.
5. Put those four values at the top of the sketch, set `DEBUG_MODE false`, and upload again.

The same debug line also shows the pot %, joystick values and all six buttons.

---

## 3. What each component does

| Component | Pin | Firmware sends | In Blackout Arena |
|---|---|---|---|
| **Trigger** | GP10 | left click (held) | Fire. Also aims down sights while held. **Sniper:** squeeze to scope in, release to fire |
| **Clutch** | GP11 | `F` (held), and aim output stops | Re-levels the view. Hold it, re-point the gun, let go — like lifting a mouse. **Hold 3 s still:** recalibrates the gyro |
| **Reload** | GP12 | `R` (held) | **Tap:** reload · **hold:** switch weapon |
| **Prime** | GP14 | `G` (held) | **Grenade.** Hold to pull the pin and cook (the fuse ticks every second); release to throw. An arc and landing ring show where it will go. Held past 3.2 s, it goes off in your hand |
| **Aux** | GP16 | `3` | Calls in your earned killstreak |
| **Stick click** | GP13 | tap → `Space` · hold → `C` (held) | Jump · crouch (while sprinting = slide) |
| **Joystick** | GP26 / GP27 | `W A S D` | Move |
| **Stick pushed all the way forward** | GP27 | Left Shift (held) | Sprint |
| **MPU-6500** | GP4 / GP5 | mouse movement | Aim |
| **Potentiometer** | GP28 | (scales the aim speed on the Pico) | Sensitivity dial, ×0.33 to ×3, centre = ×1 |

**Killstreaks** (earned by kills without dying, then called in with Aux):
3 kills → **UAV** (every hostile on your minimap for 25 s) ·
5 → **Airstrike** (six bombs along your line of aim) ·
7 → **Resupply** (full ammo, 4 frags, full health).
In the Firing Range, Aux calls a free practice airstrike at your crosshair.

**Grenades:** 2 per life, up to 4. In the Firing Range they're unlimited and can't hurt you,
and plates knocked down by a blast count as hits. A live frag has a blinking red beacon. A level
throw lands about 12 m out; aim higher to lob further. Hostiles dodge live grenades and lob
their own at you when you're hiding behind cover. Incoming frags show as red markers around your
crosshair, with a beep.

---

## 4. Checking the gun: GUN CHECK

Main menu → **GUN CHECK** → **START**. There's a tile for each component. It lights while
pressed and ticks once it has worked: every button, all four stick directions, full-push
sprint, and a 12° swing each way on the gyro. **Esc** ends the check and shows a pass/fail
summary.

**Optional USB serial.** Press *Connect gun over USB serial* (Chrome/Edge) and choose the Pico.
Close the Arduino Serial Monitor first, because only one program can hold the port. You then
also get:
- a **PIN** light on every button tile, read straight from the GPIO
- the live joystick position, gyro rates (°/s) and the sensor's WHO_AM_I
- the **potentiometer** — its only way into the game, because it sends no key

**Reading the tiles:**

| You see | Meaning |
|---|---|
| PIN lights, key light doesn't | Wiring is fine. The firmware isn't sending the key, or the game binding was changed — see the ⚠ in Settings → Controls |
| Neither lights | Wiring. Check that button's two legs are on *opposite* sides (wiring guide, part 6) |
| Gyro tile never moves | Sensor not responding (the tile says so over serial), or `DEBUG_MODE` is still on |
| Pot stuck at one value | An outer leg isn't connected (wiring guide, part 5) |

---

## 5. Remapping

**Settings → Controls** lists every action and its gun component. Click a binding, then press
the gun button (or any key / mouse button). **Esc** cancels and **Backspace** clears. Each
action has a second slot for a keyboard fallback. The **GUN SENDS** column shows what this
firmware outputs; a ⚠ means the gun no longer triggers that action.

If your own firmware (e.g. an earlier `AIMBOT_master_v4`) sends different keys, remap them
here instead of reflashing. Or change the `K_…` constants at the top of the sketch.

The same tab also sets behaviour:
- **ADS mode:** trigger / hold / toggle / off
- **Hold Reload to swap** on or off, and the hold time
- **Grenade cooking** on or off, and whether the throw arc shows
- **Clutch** re-level and freeze
- **Crouch:** hold or toggle

---

## 6. Tuning

**Aim feel:** start in **Aim Tuning** (main menu).
1. Lay the gun down and run the 5 s drift test.
2. Raise **Noise Deadzone** until the green trace is flat.
3. Raise **Speed Response** if fast swings feel laggy.
4. Run the 30 s tracking test.

If the drift test reports drift, hold the clutch for 3 s with the gun still.

**Firmware constants:**
| Constant | Default | Effect |
|---|---|---|
| `COUNTS_PER_DEG` | 8.0 | Overall speed. At pot centre and in-game sensitivity 2.4 this is about 1:1 |
| `POT_RANGE` | 3.0 | The pot sweeps ×(1/3) … ×3 |
| `POT_REVERSED` | false | Flip if turning the knob "up" slows the aim |
| `GYRO_DEADBAND` | 0.3 °/s | Tiny floor; the game does the real filtering |
| `JOY_ON` / `JOY_OFF` | 700 / 450 | Stick press/release thresholds (hysteresis stops flicker) |
| `JOY_SPRINT_ON` | 1600 | How far forward counts as sprint |
| `JOYSW_HOLD_MS` | 250 | Stick click: shorter = jump, longer = crouch |
| `JOY_INVERT_X/Y` | false | If the stick directions come out mirrored |

The gyro runs at **±1000 °/s**, not the ±250 used in the wiring test. A fast swing of a gun
easily exceeds 250 °/s, which would clip and make the aim lag behind.

**Serial telemetry format — v5** (for your own tools):
`T gx×10 gy×10 gz×10 joyX joyY pot mask sens×100 mpuOk` at 25 Hz, where the mask bits are
1 trigger · 2 clutch · 4 reload · 8 stick click · 16 prime · 32 aux. There's also an info
line, `I …`, every 2 s. Both are sent only while a program has the port open.

This is the format `src/engine/input.js` parses. **v11 sends a different line — see §7.4.**

---

## 7. AIMBOT v11 — what changed

Source: [`AIMBOT_master_v11/AIMBOT_master_v11.ino`](AIMBOT_master_v11/AIMBOT_master_v11.ino).
Built for DSU DevHack 3.0. It keeps the same keys and the same five buttons, so **the game needs
no rebinding** — everything in §3 and §5 still applies. What changed is how aim is produced.

### 7.1 Mode switches (top of the sketch)

| Switch | Default | Effect |
|---|---|---|
| `TELEMETRY` | `true` | Emit the serial line at 50 Hz |
| `DEBUG_MODE` | `false` | `true` disables all mouse/keyboard output — safe for bench testing |
| `GYRO_RANGE_500` | `false` | `false` = ±250 °/s, `true` = ±500 °/s |
| `USE_INT` | `false` | `false` = 250 Hz timer polling. `true` = try the MPU data-ready interrupt |

**Leave `USE_INT` at `false` unless you have actually wired the INT pin.** With it off the
sketch polls on a timer, which is the known-good behaviour. Turning it on makes the sketch probe
GP15 at boot and print an honest verdict; if the probe fails it falls back to polling by itself.

### 7.2 Wiring differences from v5

v11 adds one optional pin and states a different supply for the sensor:

| | v5 / wiring guide | v11 header |
|---|---|---|
| MPU-6500 `VCC` | 3V3(OUT), pin 36 | **VBUS, pin 40 (5 V)** |
| Joystick / pot `VCC` | 3V3(OUT), pin 36 | 3V3(OUT), pin 36 |
| Joystick / pot `GND` | (−) rail | AGND, pin 33 |
| MPU `INT` | not used | **GP15, pin 20 — optional, leave unconnected if unused** |

> ⚠ **Check your MPU-6500 board before moving its VCC to VBUS.** Only breakouts with an onboard
> 3.3 V regulator tolerate 5 V. A bare MPU-6500 is a 3.3 V part. If yours ran correctly on 3V3
> with v5, leave it on 3V3 — v11 does not require the change. I2C stays on GP4/GP5 either way.

`NCS` on the sensor is the SPI chip select and stays unconnected.

### 7.3 Behaviour changes

- **Automatic button polarity.** At boot the sketch samples all six buttons for ~40 ms and takes
  whatever it sees as "at rest", so a button wired to the opposite rail still works.
  **Do not hold any button while plugging the gun in.**
- **Tilt-compensated aim replaces the manual axis setup.** v11 tracks gravity from the
  accelerometer and projects the gyro onto the true yaw/pitch axes, so the §2 `DEBUG_MODE` axis
  procedure is no longer needed. Roll the gun and aim stays level. Set `FORWARD_X/Y/Z` to the
  barrel direction in sensor coordinates (default `1, 0, 0`); `YAW_INVERT` / `PITCH_INVERT`
  flip a reversed axis.
- **Filtering moved onto the Pico.** A One-Euro filter runs in the firmware, feeding a
  sub-pixel accumulator so slow movement is not truncated to zero. The game's own filter still
  runs on top; if aim feels over-smoothed, lower the in-game Speed Response first.
- **Continuous drift correction (ZUPT).** While the gun is still the gyro bias is re-learned
  automatically, so drift no longer builds up over a match.
- **`dt` is clamped to 1–50 ms.** This is the fix for the v10 bug where a bad timing source made
  `dt` microscopic and the aim accumulator never advanced — the cursor froze while every button
  still worked. It cannot recur.
- **Output watchdog.** In INT mode, if the gyro is clearly moving but no mouse report has gone
  out for 1.5 s, the sketch reverts to timer polling on its own and says so on serial.
- **Gyro recalibration is Clutch + Reload held 2 s** (v5: Clutch alone held 3 s).
- **Clutch + Trigger together taps Space** — a respawn shortcut. Holding the clutch still
  freezes aim as before, and the trigger does not fire while the clutch is down.
- **Sprint fires on any full stick push**, not just forward.
- **Sensitivity** is `sensX`/`sensY` (12.0) scaled by the pot over ×0.2 … ×3.2.
- The joystick uses one threshold (`DEADZONE` 500) rather than v5's press/release hysteresis.

The default gyro range is **±250 °/s**, not the ±1000 v5 used. A hard swing can exceed that and
clip. If fast turns feel like they stop short, set `GYRO_RANGE_500` to `true`.

### 7.4 v11 serial telemetry — not yet read by the game

v11 emits a CSV line at 50 Hz:

```
AIMBOT,trig,clutch,reload,stick,prime,aux,joyX,joyY,pot,yaw,pitch,mouseX,mouseY
```

Buttons are 0/1, `joyX`/`joyY`/`pot` are raw 12-bit ADC counts, `yaw`/`pitch` are °/s after
deadband, and `mouseX`/`mouseY` are the counts sent to the host that tick.

> ⚠ **Do not use "Connect gun over USB serial" in GUN CHECK while v11 is flashed.**
> `src/engine/input.js` keys on the line's first character. `AIMBOT,…` starts with `A`, which is
> the tag for an *absolute aim* frame, so the parser reads the trigger and clutch states as yaw
> and pitch in degrees and feeds them into your view. The tiles will be wrong **and the aim will
> be nudged by button presses.**
>
> Everything else is unaffected: the gun is a normal USB mouse + keyboard, so GUN CHECK without
> the serial link, and the game itself, work exactly as described above. Only the optional
> serial diagnostics are affected.
>
> To get the serial tiles back, either flash v5, or change `sendTelemetry()` in v11 to emit the
> v5 `T …` line documented at the end of §6.
