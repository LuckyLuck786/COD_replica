/* ============================================================
   AIMBOT v11.0 — MASTER CODE
   Raspberry Pi Pico + MPU-6500
   Team: Prompt Engineers | DSU DevHack 3.0

   ============================================================
   FIXES THE v10 "CURSOR FROZEN / 0 reports/s" BUG
   ============================================================
   CAUSE: v10 set the INT pin to plain INPUT with no pull resistor.
   An unconnected or poorly soldered INT wire left GP15 FLOATING,
   reading random HIGH/LOW noise. probeINT() saw those random
   HIGHs and wrongly reported "INT WORKING". The main loop then
   ran at the noise rate instead of 250Hz, making dt microscopic:

       accumX += fx * dt * sensX * sensMult;   // dt ~ 0.000001
       mx = (int)accumX;                        // always 0

   So Mouse.move() was never called. Every button still worked,
   which is why Gun Check showed 8/10 with 0 reports/s.

   FOUR FIXES:
   1. INT_PIN is now INPUT_PULLDOWN. An unconnected wire reads a
      solid LOW. The MPU drives push-pull HIGH, which easily
      overcomes the pulldown, so a REAL signal still registers.
   2. probeINT() now counts pulses over 400ms and requires a
      plausible rate (30..300). Noise or silence both fail.
   3. dt is CLAMPED to [0.001 .. 0.05] s no matter what. Even if
      timing goes wrong again, the accumulator still advances and
      the cursor still moves. This alone makes the freeze
      impossible to reproduce.
   4. Output watchdog: if INT mode is on and the gyro is clearly
      moving but no mouse report has gone out for 1.5s, it
      automatically reverts to timer polling.

   ============================================================
   USE_INT DEFAULTS TO false — READ THIS
   ============================================================
   Flash as-is first and confirm the cursor moves again. That is
   identical to your known-good v9 behaviour.
   THEN, if you want the interrupt, change USE_INT to true and
   reflash. The startup log will now tell you honestly whether
   the INT wire is actually working.
   ============================================================

   PIN MAP
     TRIGGER GP10(14)  CLUTCH GP11(15)  RELOAD GP12(16)
     STICK   GP13(17)  PRIME  GP14(19)  AUX    GP16(21)
     INT     GP15(20)  (optional - leave unconnected if unused)
     JOY VRx GP26(31)  VRy GP27(32)  POT GP28(34)
     MPU SDA GP4(6)  SCL GP5(7)  VCC -> VBUS(40)  GND -> GND(38)
     Joy VCC -> 3V3(36)   Joy/Pot GND -> AGND(33)
     NCS: leave unconnected (it is the SPI select, not an extra)
   ============================================================ */

#include <Wire.h>
#include <Mouse.h>
#include <Keyboard.h>

/* ===================== MODE SWITCHES ===================== */
#define TELEMETRY       true
#define DEBUG_MODE      false     // true = HID disabled (cursor safe)
#define GYRO_RANGE_500  false
#define USE_INT         false     // <-- start false. Flip to true to try INT.
/* ========================================================= */

const int MPU_ADDR = 0x68;

// ---- PINS ----
#define TRIGGER_PIN 10
#define CLUTCH_PIN  11
#define RELOAD_PIN  12
#define JOY_SW_PIN  13
#define PRIME_PIN   14
#define AUX_PIN     16
#define INT_PIN     15
#define JOY_X  A0
#define JOY_Y  A1
#define POT_PIN A2

// ---- KEYBINDS ----
#define KEY_CLUTCH     'f'
#define KEY_RELOAD     'r'
#define KEY_GRENADE    'g'
#define KEY_KILLSTREAK '3'
#define KEY_JUMP       ' '
#define KEY_CROUCH     'c'
#define KEY_RESPAWN    ' '

// ---- JOYSTICK ----
const int DEADZONE  = 500;
const int SPRINT_TH = 1400;
const uint32_t HOLD_MS     = 300;
const uint32_t MIN_HOLD_MS = 120;

// ---- TILT COMPENSATION ----
#define USE_TILT_COMP true
const float FORWARD_X = 1.0;
const float FORWARD_Y = 0.0;
const float FORWARD_Z = 0.0;
#define YAW_INVERT   false
#define PITCH_INVERT false

// ---- SENSITIVITY ----
float sensX = 12.0;
float sensY = 12.0;

#if GYRO_RANGE_500
  const float   GYRO_SENS = 65.5;
  const uint8_t GYRO_CFG  = 0x08;
#else
  const float   GYRO_SENS = 131.0;
  const uint8_t GYRO_CFG  = 0x00;
#endif

const float SOFT_DEADBAND = 0.3;
const float GRAV_ALPHA    = 0.02;
const float ONE_G         = 16384.0;
const float GRAV_TOLER    = 0.20;
const float STILL_RATE    = 1.5;
const float ZUPT_GAIN     = 0.0015;

/* *** THE CRITICAL SAFETY CLAMP ***
   dt can never be small enough to stall the movement accumulator,
   nor large enough to make the filter jump.                      */
const float DT_MIN = 0.001;    // 1 ms
const float DT_MAX = 0.050;    // 50 ms

const uint32_t INT_STALL_US   = 200000;   // no INT for 200ms -> give up on it
const uint32_t OUT_STALL_MS   = 1500;     // moving but no output -> give up

/* ---------------- 1 EURO FILTER ---------------- */
class OneEuroFilter {
  float mincutoff, beta, dcutoff;
  float xPrev, dxPrev;
  bool first = true;
  float alpha(float cutoff, float dt) {
    float tau = 1.0 / (2 * PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }
public:
  OneEuroFilter(float mc = 6.0, float b = 0.06, float dc = 1.0)
    : mincutoff(mc), beta(b), dcutoff(dc) {}
  float filter(float x, float dt) {
    if (dt <= 0) dt = DT_MIN;
    if (first) { xPrev = x; dxPrev = 0; first = false; return x; }
    float dx = (x - xPrev) / dt;
    float ad = alpha(dcutoff, dt);
    float dxHat = ad * dx + (1 - ad) * dxPrev;
    dxPrev = dxHat;
    float cutoff = mincutoff + beta * fabs(dxHat);
    float a = alpha(cutoff, dt);
    float xHat = a * x + (1 - a) * xPrev;
    xPrev = xHat;
    return xHat;
  }
  void reset() { first = true; }
};
OneEuroFilter filtX(6.0, 0.06);
OneEuroFilter filtY(6.0, 0.06);

/* ---------- AUTO BUTTON POLARITY ---------- */
const uint8_t BTN_PINS[6] = {TRIGGER_PIN, CLUTCH_PIN, RELOAD_PIN,
                             JOY_SW_PIN, PRIME_PIN, AUX_PIN};
const char*   BTN_NAME[6] = {"TRIGGER", "CLUTCH", "RELOAD",
                             "STICK  ", "PRIME  ", "AUX    "};
bool restState[6];

int btnIndex(uint8_t pin) {
  for (int i = 0; i < 6; i++) if (BTN_PINS[i] == pin) return i;
  return 0;
}
bool pressed(uint8_t pin) {
  return digitalRead(pin) != restState[btnIndex(pin)];
}

// ---- STATE ----
bool  mpuReady = false;
bool  intMode  = false;
float biasX = 0, biasY = 0, biasZ = 0;
float gravX = 0, gravY = 0, gravZ = ONE_G;
float accumX = 0, accumY = 0;
uint32_t lastMicros = 0, lastSampleMicros = 0;
uint32_t lastInitTry = 0, lastTelem = 0;
uint32_t lastMoveMs = 0, movingSinceMs = 0;
uint32_t stillCount = 0;

int  centerX = 2048, centerY = 2048;
bool wP=false, aP=false, sP=false, dP=false;
bool triggerHeld=false, reloadHeld=false;
bool clutchKeyHeld=false, sprintHeld=false, crouchHeld=false;
bool respawnFired = false;

bool     primeKeyDown = false, auxKeyDown = false;
uint32_t primeDownAt  = 0,     auxDownAt  = 0;

bool     swDown = false, swCrouchLatched = false;
uint32_t swDownAt = 0;

int   tJX=0, tJY=0, tPOT=0, tMX=0, tMY=0;
float tYaw=0, tPitch=0;

/* ---------- SHORT TAPS ---------- */
struct KeyTap { char key; uint32_t t0; bool active; };
KeyTap taps[2] = {{0,0,false},{0,0,false}};
void startTap(int slot, char k) {
  if (!taps[slot].active) {
    Keyboard.press(k);
    taps[slot].key = k; taps[slot].t0 = millis(); taps[slot].active = true;
  }
}
void updateTaps() {
  for (int i = 0; i < 2; i++)
    if (taps[i].active && millis() - taps[i].t0 > MIN_HOLD_MS) {
      Keyboard.release(taps[i].key);
      taps[i].active = false;
    }
}

/* ---------- MPU ---------- */
bool readMPU(int16_t &ax, int16_t &ay, int16_t &az,
             int16_t &gx, int16_t &gy, int16_t &gz) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(MPU_ADDR, 14) != 14) return false;
  ax = (Wire.read() << 8) | Wire.read();
  ay = (Wire.read() << 8) | Wire.read();
  az = (Wire.read() << 8) | Wire.read();
  Wire.read(); Wire.read();
  gx = (Wire.read() << 8) | Wire.read();
  gy = (Wire.read() << 8) | Wire.read();
  gz = (Wire.read() << 8) | Wire.read();
  return true;
}
uint8_t whoAmI() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x75);
  if (Wire.endTransmission(false) != 0) return 0xFF;
  if (Wire.requestFrom(MPU_ADDR, 1) != 1) return 0xFF;
  return Wire.read();
}

bool initMPU() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B); Wire.write(0x00);
  if (Wire.endTransmission() != 0) return false;
  delay(50);
  Wire.beginTransmission(MPU_ADDR); Wire.write(0x1B); Wire.write(GYRO_CFG); Wire.endTransmission();
  Wire.beginTransmission(MPU_ADDR); Wire.write(0x1C); Wire.write(0x00);     Wire.endTransmission();
  Wire.beginTransmission(MPU_ADDR); Wire.write(0x1A); Wire.write(0x02);     Wire.endTransmission(); // DLPF 92Hz
  Wire.beginTransmission(MPU_ADDR); Wire.write(0x19); Wire.write(0x03);     Wire.endTransmission(); // 250Hz out

#if USE_INT
  Wire.beginTransmission(MPU_ADDR); Wire.write(0x37); Wire.write(0x30); Wire.endTransmission(); // latch + any-read-clear
  Wire.beginTransmission(MPU_ADDR); Wire.write(0x38); Wire.write(0x01); Wire.endTransmission(); // data-ready enable
#else
  Wire.beginTransmission(MPU_ADDR); Wire.write(0x38); Wire.write(0x00); Wire.endTransmission(); // INT off
#endif
  delay(50);

  int16_t ax, ay, az, gx, gy, gz;
  if (!readMPU(ax, ay, az, gx, gy, gz)) return false;
  gravX = ax; gravY = ay; gravZ = az;
  return true;
}

/* Strict INT probe: count rising edges over 400ms.
   At 250Hz we expect ~100. Noise or silence both fail this. */
bool probeINT() {
  int16_t ax, ay, az, gx, gy, gz;
  readMPU(ax, ay, az, gx, gy, gz);
  int pulses = 0;
  bool wasHigh = (digitalRead(INT_PIN) == HIGH);
  uint32_t t0 = millis();
  while (millis() - t0 < 400) {
    bool nowHigh = (digitalRead(INT_PIN) == HIGH);
    if (nowHigh && !wasHigh) {
      pulses++;
      readMPU(ax, ay, az, gx, gy, gz);   // clears the latch
    }
    wasHigh = nowHigh;
    delayMicroseconds(200);
  }
  Serial.print("(edges in 400ms: "); Serial.print(pulses); Serial.print(") ");
  return (pulses >= 30 && pulses <= 300);
}

void calibrateGyro() {
  long sx = 0, sy = 0, sz = 0; int good = 0;
  for (int i = 0; i < 250; i++) {
    int16_t ax, ay, az, gx, gy, gz;
    if (readMPU(ax, ay, az, gx, gy, gz)) { sx += gx; sy += gy; sz += gz; good++; }
    delay(4);
  }
  if (good > 10) {
    biasX = (float)sx / good;
    biasY = (float)sy / good;
    biasZ = (float)sz / good;
  }
  filtX.reset(); filtY.reset();
  accumX = 0; accumY = 0;
  stillCount = 0;
}

float softDeadband(float v) {
  if (v >  SOFT_DEADBAND) return v - SOFT_DEADBAND;
  if (v < -SOFT_DEADBAND) return v + SOFT_DEADBAND;
  return 0;
}

/* ---------- INPUT HELPERS ---------- */
void setKey(bool want, bool &state, char k) {
  if (want && !state)      { Keyboard.press(k);   state = true;  }
  else if (!want && state) { Keyboard.release(k); state = false; }
}
void setKeyCode(bool want, bool &state, uint8_t code) {
  if (want && !state)      { Keyboard.press(code);   state = true;  }
  else if (!want && state) { Keyboard.release(code); state = false; }
}
void holdKey(bool want, bool &down, uint32_t &downAt, char k) {
  if (want && !down) { Keyboard.press(k); down = true; downAt = millis(); }
  else if (!want && down && millis() - downAt >= MIN_HOLD_MS) {
    Keyboard.release(k); down = false;
  }
}

void handleJoystick() {
  tJX = analogRead(JOY_X);
  tJY = analogRead(JOY_Y);
  int x = tJX - centerX;
  int y = tJY - centerY;
  setKey(y >  DEADZONE, wP, 'w');
  setKey(y < -DEADZONE, sP, 's');
  setKey(x >  DEADZONE, aP, 'a');
  setKey(x < -DEADZONE, dP, 'd');
  bool fullPush = (y > SPRINT_TH) || (y < -SPRINT_TH) || (abs(x) > SPRINT_TH);
  setKeyCode(fullPush, sprintHeld, KEY_LEFT_SHIFT);
}

void handleStickClick() {
  bool now = pressed(JOY_SW_PIN);
  if (now && !swDown) {
    swDown = true; swDownAt = millis(); swCrouchLatched = false;
  } else if (now && swDown) {
    if (!swCrouchLatched && millis() - swDownAt > HOLD_MS) {
      Keyboard.press(KEY_CROUCH); crouchHeld = true; swCrouchLatched = true;
    }
  } else if (!now && swDown) {
    swDown = false;
    if (swCrouchLatched) { Keyboard.release(KEY_CROUCH); crouchHeld = false; }
    else startTap(1, KEY_JUMP);
  }
}

void handleButtons() {
  bool t = pressed(TRIGGER_PIN);
  bool c = pressed(CLUTCH_PIN);

  if (c && t) {
    if (!respawnFired) { startTap(0, KEY_RESPAWN); respawnFired = true; }
  } else respawnFired = false;

  bool wantFire = t && !c;
  if (wantFire && !triggerHeld)      { Mouse.press(MOUSE_LEFT);   triggerHeld = true; }
  else if (!wantFire && triggerHeld) { Mouse.release(MOUSE_LEFT); triggerHeld = false; }

  setKey(c, clutchKeyHeld, KEY_CLUTCH);
  setKey(pressed(RELOAD_PIN), reloadHeld, KEY_RELOAD);
  holdKey(pressed(PRIME_PIN), primeKeyDown, primeDownAt, KEY_GRENADE);
  holdKey(pressed(AUX_PIN),   auxKeyDown,   auxDownAt,   KEY_KILLSTREAK);
}

/* ---------- TELEMETRY ---------- */
void sendTelemetry() {
  Serial.print("AIMBOT,");
  Serial.print(pressed(TRIGGER_PIN) ? 1 : 0); Serial.print(',');
  Serial.print(pressed(CLUTCH_PIN)  ? 1 : 0); Serial.print(',');
  Serial.print(pressed(RELOAD_PIN)  ? 1 : 0); Serial.print(',');
  Serial.print(pressed(JOY_SW_PIN)  ? 1 : 0); Serial.print(',');
  Serial.print(pressed(PRIME_PIN)   ? 1 : 0); Serial.print(',');
  Serial.print(pressed(AUX_PIN)     ? 1 : 0); Serial.print(',');
  Serial.print(tJX);  Serial.print(',');
  Serial.print(tJY);  Serial.print(',');
  Serial.print(tPOT); Serial.print(',');
  Serial.print(tYaw, 2);   Serial.print(',');
  Serial.print(tPitch, 2); Serial.print(',');
  Serial.print(tMX);  Serial.print(',');
  Serial.println(tMY);
}

/* ---------- SETUP ---------- */
void setup() {
  Serial.begin(115200);

  for (int i = 0; i < 6; i++) pinMode(BTN_PINS[i], INPUT_PULLUP);
  pinMode(INT_PIN, INPUT_PULLDOWN);   // *** FIX: never floats ***
  analogReadResolution(12);

  Wire.setSDA(4);
  Wire.setSCL(5);
  Wire.begin();
  Wire.setClock(100000);
  delay(1000);

  Mouse.begin();
  Keyboard.begin();

  centerX = analogRead(JOY_X);
  centerY = analogRead(JOY_Y);

  for (int i = 0; i < 6; i++) {
    int highCount = 0;
    for (int s = 0; s < 21; s++) {
      if (digitalRead(BTN_PINS[i]) == HIGH) highCount++;
      delay(2);
    }
    restState[i] = (highCount > 10) ? HIGH : LOW;
  }

  Serial.println();
  Serial.println("========== AIMBOT v11 STARTUP ==========");
  Serial.println("BUTTON POLARITY (do not hold buttons at boot):");
  for (int i = 0; i < 6; i++) {
    Serial.print("  ");
    Serial.print(BTN_NAME[i]);
    Serial.print(" rests ");
    Serial.println(restState[i] == HIGH
                   ? "HIGH  (normal)"
                   : "LOW   (inverted - auto-corrected)");
  }

  mpuReady = initMPU();
  if (mpuReady) {
    uint8_t w = whoAmI();
    Serial.print("SENSOR : OK  WHO_AM_I=0x");
    if (w < 0x10) Serial.print("0");
    Serial.println(w, HEX);

#if USE_INT
    Serial.print("INT    : probing GP15 (pin 20)... ");
    intMode = probeINT();
    Serial.println(intMode ? "WORKING - hardware data-ready @250Hz"
                           : "NOT VALID - using timer polling (aim still works)");
#else
    Serial.println("INT    : OFF (USE_INT false) - timer polling @250Hz");
#endif

    Serial.print("GYRO RANGE : +/-");
    Serial.println(GYRO_RANGE_500 ? "500 dps" : "250 dps");
    Serial.println("Calibrating - HOLD STILL 1 second...");
    calibrateGyro();
    Serial.println("Done. Auto drift correction is ON.");
  } else {
    Serial.println("SENSOR : NOT FOUND (VCC->VBUS pin40, SDA=GP4, SCL=GP5)");
  }
  Serial.println("========================================");

  lastMicros = micros();
  lastSampleMicros = lastMicros;
  lastMoveMs = millis();
  movingSinceMs = 0;
}

/* ---------- LOOP ---------- */
void loop() {
  handleJoystick();
  handleStickClick();
  handleButtons();
  updateTaps();

  if (!mpuReady && millis() - lastInitTry > 2000) {
    lastInitTry = millis();
    if (initMPU()) {
      mpuReady = true;
#if USE_INT
      intMode = probeINT();
#endif
      calibrateGyro();
    }
  }

  uint32_t now = micros();

  /* ---- Is a fresh sample available? ---- */
  bool haveSample = false;
  if (intMode) {
    // Hard floor of 2ms even in INT mode: noise can never spin the loop.
    if (now - lastMicros >= 2000 && digitalRead(INT_PIN) == HIGH) {
      haveSample = true;
    } else if (now - lastSampleMicros > INT_STALL_US) {
      intMode = false;
      Serial.println("INT stalled -> reverting to timer polling");
    }
  } else {
    if (now - lastMicros >= 4000) haveSample = true;   // 250Hz
  }
  if (!haveSample) return;

  /* *** dt CLAMP - the accumulator can never stall again *** */
  float dt = (now - lastMicros) / 1000000.0;
  if (dt < DT_MIN) dt = DT_MIN;
  if (dt > DT_MAX) dt = DT_MAX;

  lastMicros = now;
  lastSampleMicros = now;

  tPOT = analogRead(POT_PIN);

  float rateYaw = 0, ratePitch = 0;
  bool ok = false;

  if (mpuReady) {
    int16_t ax, ay, az, gx, gy, gz;
    ok = readMPU(ax, ay, az, gx, gy, gz);
    if (!ok) mpuReady = false;
    else {
      float wx = (gx - biasX) / GYRO_SENS;
      float wy = (gy - biasY) / GYRO_SENS;
      float wz = (gz - biasZ) / GYRO_SENS;

      if (fabs(wx) + fabs(wy) + fabs(wz) < STILL_RATE) {
        stillCount++;
        if (stillCount > 200) {
          biasX += ((float)gx - biasX) * ZUPT_GAIN;
          biasY += ((float)gy - biasY) * ZUPT_GAIN;
          biasZ += ((float)gz - biasZ) * ZUPT_GAIN;
        }
      } else stillCount = 0;

      float amag = sqrtf((float)ax * ax + (float)ay * ay + (float)az * az);
      if (fabsf(amag - ONE_G) < ONE_G * GRAV_TOLER) {
        gravX = gravX * (1 - GRAV_ALPHA) + ax * GRAV_ALPHA;
        gravY = gravY * (1 - GRAV_ALPHA) + ay * GRAV_ALPHA;
        gravZ = gravZ * (1 - GRAV_ALPHA) + az * GRAV_ALPHA;
      }

      if (USE_TILT_COMP) {
        float gm = sqrtf(gravX * gravX + gravY * gravY + gravZ * gravZ);
        if (gm > 1.0) {
          float nx = gravX / gm, ny = gravY / gm, nz = gravZ / gm;
          rateYaw = wx * nx + wy * ny + wz * nz;
          float rx = ny * FORWARD_Z - nz * FORWARD_Y;
          float ry = nz * FORWARD_X - nx * FORWARD_Z;
          float rz = nx * FORWARD_Y - ny * FORWARD_X;
          float rm = sqrtf(rx * rx + ry * ry + rz * rz);
          if (rm > 0.01) {
            rx /= rm; ry /= rm; rz /= rm;
            ratePitch = wx * rx + wy * ry + wz * rz;
          }
        }
      } else {
        rateYaw = wz; ratePitch = wy;
      }

      if (YAW_INVERT)   rateYaw   = -rateYaw;
      if (PITCH_INVERT) ratePitch = -ratePitch;
      rateYaw   = softDeadband(rateYaw);
      ratePitch = softDeadband(ratePitch);
    }
  }
  tYaw = rateYaw; tPitch = ratePitch;

  bool clutched = pressed(CLUTCH_PIN);
  if (clutched) {
    accumX = 0; accumY = 0;
    filtX.reset(); filtY.reset();
  }

  static uint32_t comboStart = 0;
  if (clutched && pressed(RELOAD_PIN) && mpuReady) {
    if (millis() - comboStart > 2000) { calibrateGyro(); comboStart = millis(); }
  } else comboStart = millis();

  float sensMult = 0.2 + (tPOT / 4095.0) * 3.0;

  int mx = 0, my = 0;
  if (ok && !clutched) {
    float fx = filtX.filter(rateYaw,   dt);
    float fy = filtY.filter(ratePitch, dt);
    accumX += fx * dt * sensX * sensMult;
    accumY += fy * dt * sensY * sensMult;
    mx = (int)accumX; accumX -= mx;
    my = (int)accumY; accumY -= my;
  }
  tMX = mx; tMY = my;

  /* ---- Output watchdog: moving but nothing coming out? ---- */
  bool reallyMoving = (fabs(rateYaw) > 5.0 || fabs(ratePitch) > 5.0) && !clutched;
  if (mx != 0 || my != 0) { lastMoveMs = millis(); movingSinceMs = 0; }
  else if (reallyMoving) {
    if (movingSinceMs == 0) movingSinceMs = millis();
    if (intMode && millis() - movingSinceMs > OUT_STALL_MS) {
      intMode = false;
      movingSinceMs = 0;
      Serial.println("No mouse output while moving -> reverting to timer polling");
    }
  } else movingSinceMs = 0;

#if !DEBUG_MODE
  if (mx != 0 || my != 0) Mouse.move(-mx, my);
#endif

#if TELEMETRY
  if (millis() - lastTelem >= 20) { lastTelem = millis(); sendTelemetry(); }
#endif
}
