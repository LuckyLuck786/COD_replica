# AIMBOT gun — build guide

A Raspberry Pi Pico turns a nerf gun into a USB mouse + keyboard: a gyro drives aiming, a
joystick drives movement, five buttons map to fire/utility actions, and a potentiometer is an
aim-sensitivity dial. No driver is needed — to the PC it's just HID.

## Parts

| Part | Notes |
|---|---|
| Raspberry Pi Pico (RP2040) | Presents as USB HID mouse + keyboard + CDC serial |
| MPU-6500 6-axis IMU | WHO_AM_I `0x70`. Gyro drives aiming |
| Analog joystick module | 2 axes + push switch. Movement |
| Potentiometer, 10 kΩ | Aim-sensitivity dial |
| 5 × tactile push buttons | Trigger, Clutch, Reload, Prime, Aux |
| Breadboard, jumper wires | Prototype wiring |
| A nerf gun body | Everything mounts inside |

## Wiring

Power the breadboard rails from **3V3(OUT), physical pin 36** (`+`) and **GND, pin 38** (`-`).
**Never use VBUS (pin 40) or VSYS (pin 39)** — the GPIO/ADC pins are not 5 V tolerant.

| Signal | Pico pin | Physical pin |
|---|---|---|
| MPU-6500 `SDA` | GP4 | 6 |
| MPU-6500 `SCL` | GP5 | 7 |
| MPU-6500 `VCC` / `GND` | 3V3 rail / GND rail | — |
| Joystick `VRx` | GP26 (ADC0) | 31 |
| Joystick `VRy` | GP27 (ADC1) | 32 |
| Joystick `SW` | GP13 | 17 |
| Joystick `+5V` pin | **3.3 V**, not 5 V | — |
| Potentiometer wiper | GP28 (ADC2) | 34 |
| Potentiometer outer legs | `(+)` and `(−)` | — |
| Trigger button | GP10 | 14 |
| Clutch button | GP11 | 15 |
| Reload button | GP12 | 16 |
| Prime button | GP14 | 19 |
| Aux button | GP16 | 21 |

Buttons use the Pico's internal pull-ups (`INPUT_PULLUP`): one leg to the GPIO, the other to
GND — the two legs must come from **opposite sides** of a 4-pin tactile switch, or it will
always read as pressed (or never).

Joystick convention, as measured by `WIRING_TEST.ino`: **X above centre = LEFT, Y above centre =
UP**. If your movement feels mirrored, flip `JOY_INVERT_X` / `JOY_INVERT_Y` in the firmware
rather than re-wiring.

## Board setup (Arduino IDE)

1. Install the **"Raspberry Pi Pico/RP2040" by Earle Philhower** board package (verified
   against version 6.1.0).
2. Board: **Raspberry Pi Pico** (or Pico W).
3. **Tools → USB Stack → "Pico SDK"** — this is the one setting that matters most: it's the
   stack that gives you Mouse + Keyboard + Serial all at once. The default stack only gives you
   one of these.

## Step 1 — verify the wiring

Flash `WIRING_TEST.ino` first. It never touches the mouse/keyboard, so it's safe to run with the
Arduino Serial Monitor open. Every 300 ms it prints four lines at 115200 baud:

- `MPU` — WHO_AM_I plus raw gyro X/Y/Z
- `BTN` — Trigger/Clutch/Reload/JoySW/Prime/Aux state
- `JOY` — X/Y raw values plus the direction they resolve to
- `POT` — raw reading and percent

If every line responds correctly, the wiring is proven and you can move on. If `MPU` shows
"NOT RESPONDING", double check `SDA`→GP4, `SCL`→GP5, and that the sensor is on 3.3 V — it will
retry `initMPU()` every 2 seconds on its own.

## Step 2 — flash the game firmware

Flash `AIMBOT_master_v5/AIMBOT_master_v5.ino` (or drag the prebuilt `AIMBOT_master_v5.uf2` onto
the Pico while it's in BOOTSEL mode — hold BOOTSEL while plugging it in). **Close the Arduino
Serial Monitor before running the game** — the port can only be open in one program at a time,
and the game's Gun Check screen wants it for telemetry.

### First run: find your gyro axes

Set `DEBUG_MODE true` near the top of the sketch, reflash, and open the Serial Monitor. With
`DEBUG_MODE` on, the firmware sends **no mouse/keyboard input at all** — it's safe to test with
the gun in your hands. Swing the gun to the right, then tilt the barrel up; the console names the
axis and sign for each motion — copy those into `YAW_AXIS`/`YAW_SIGN`/`PITCH_AXIS`/`PITCH_SIGN`,
set `DEBUG_MODE` back to `false`, and reflash.

## What each part sends

| Gun part | Sends | In-game meaning |
|---|---|---|
| Trigger | Left mouse (held) | Fire; ADS while held on the sniper; hold-to-scope/release-to-fire |
| Clutch | `F` (held) | Freeze aim + re-level view. Hold it with the gun still for 3 s to re-run gyro calibration |
| Reload | `R` (held) | Tap = reload. Hold ≥ 0.45 s = swap weapon instead |
| Prime | `G` (held) | Hold = cook grenade, release = throw |
| Aux | `3` (tap) | Call in earned killstreak |
| Stick click | `Space` (tap) / `C` (hold) | Jump / crouch (and slide while sprinting) |
| Stick | `W A S D` | Move |
| Stick pushed fully forward | Left Shift (held) | Sprint |
| MPU-6500 | Mouse movement | Aim |
| Potentiometer | (scaled on the Pico) | Aim sensitivity, ×0.33 to ×3.0 |

The game's **Settings → Controls** tab lets you rebind any of these independently of what the
firmware sends, in case your firmware differs from `AIMBOT_master_v5`.

## Tuning

- **`COUNTS_PER_DEG`** — mouse counts per degree of gun rotation at the sensitivity dial's
  centre position. Raise it if the in-game sensitivity slider alone isn't enough range.
- **Sensitivity dial** — smoothed with an exponential moving average and mapped
  `pow(3, (p - 0.5) * 2)`, i.e. roughly ×0.33 at one end and ×3 at the other. Flip
  `POT_REVERSED` if turning it "up" slows the aim down instead.
- **Deadzone / drift** — the firmware does *not* filter the gyro signal beyond bias removal and
  a small deadband; the game applies a One-Euro filter and drift-bias cancellation on top. Don't
  add extra smoothing in the firmware — filtering twice adds input lag (see Aim Tuning in-game).
- **Joystick hysteresis** — `JOY_ON`/`JOY_OFF` (press/release thresholds) prevent a
  direction from chattering near the edge of the deadzone; `JOY_SPRINT_ON`/`JOY_SPRINT_OFF` do
  the same for the full-forward sprint gesture.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Aim slowly creeps even when the gun is still | Gyro bias not learned | Keep the gun still for ~1.5 s right after plugging in — that's when `calibrateGyro(500)` runs |
| Movement feels mirrored or inverted | Joystick wiring convention differs from `WIRING_TEST.ino`'s | Flip `JOY_INVERT_X`/`JOY_INVERT_Y`, don't re-wire |
| A button always reads pressed (or never) | The two legs of the tactile switch are on the *same* side | Use the opposite pair of legs on the 4-pin switch |
| Gun Check: pin light is on but the key tile never passes | Wiring and firmware are fine; the firmware's key doesn't match the in-game binding | Rebind the action in Settings → Controls, or edit the `K_*` constants in the firmware |
| No telemetry in Gun Check at all | Serial Monitor (or another program) still has the port open | Close it, then reconnect from the game |
| Fast swings feel clipped/capped | Gyro range too narrow | Confirm `GYRO_CONFIG = 0x10` (±1000 °/s) — a fast swing exceeds ±250 °/s |
