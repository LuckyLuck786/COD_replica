# AIMBOT nerf gun × Blackout Arena

Firmware and setup for the gun described in `WIRING_GUIDE.md`:
Raspberry Pi Pico · MPU-6500 · joystick · potentiometer · Trigger / Clutch / Reload / Prime / Aux.

The gun is a **USB mouse + keyboard**. Nothing is installed on the PC, and the same firmware
works in any other game.

---

## 1. Flash the firmware

Wiring is exactly the wiring guide's, so if `WIRING_TEST.ino` passes, you're ready.

**Quick way:** hold BOOTSEL, plug the Pico in, and drag
[`AIMBOT_master_v5.uf2`](AIMBOT_master_v5.uf2) onto the `RPI-RP2` drive. That build uses the
default axis settings below.

**Arduino IDE (needed once you change any setting):** open
[`AIMBOT_master_v5/AIMBOT_master_v5.ino`](AIMBOT_master_v5/AIMBOT_master_v5.ino).
- Board package: *Raspberry Pi Pico/RP2040* (Earle Philhower). It built clean against 6.1.0.
- Board: *Raspberry Pi Pico*
- Tools → **USB Stack: "Pico SDK"** (this gives mouse, keyboard and serial at the same time)

Keep the gun **still for ~2 seconds after plugging in**. The LED blinks while it measures the
gyro's resting offset.

## 2. Set the aim axes — after the sensor is mounted

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

**Serial telemetry format** (for your own tools):
`T gx×10 gy×10 gz×10 joyX joyY pot mask sens×100 mpuOk` at 25 Hz, where the mask bits are
1 trigger · 2 clutch · 4 reload · 8 stick click · 16 prime · 32 aux. There's also an info
line, `I …`, every 2 s. Both are sent only while a program has the port open.
