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
