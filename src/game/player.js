// Player movement, stance, camera, and health. A capsule-ish AABB moved through engine/physics.js.
import * as THREE from 'three';
import { moveEntity, blocked } from '../engine/physics.js';

const RADIUS = 0.36;
const STAND_H = 1.78;
const CROUCH_H = 1.16;
const EYE_OFFSET = 0.20; // below the top of the collision box
const STEP_HEIGHT = 0.82; // must clear the 0.78 m ramp steps

const WALK = 5.3, SPRINT = 7.9, CROUCH_SPEED = 2.9, ADS_SPEED = 3.5, AIR_CONTROL = 0.55;
const JUMP_V = 7.4, GRAVITY = 23;
const MAX_HP = 100, REGEN_RATE = 26, REGEN_DELAY = 4.2;
const SLIDE_TIME = 0.55, SLIDE_COOLDOWN = 1.6;

export class Player {
  constructor(colliders) {
    this.colliders = colliders;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.crouched = false;
    this.sprinting = false;
    this.wasSprinting = false; // last frame's sprint state — slide check must use THIS, not current
    this.sliding = false;
    this.slideT = 0;
    this.slideCooldown = 0;
    this.onGround = false;
    this.health = MAX_HP;
    this.lastDamageAt = -999;
    this.dead = false;

    this.bobT = 0;
    this.landDip = 0;
    this.shake = 0;
    this.slideDip = 0;
    this.strafeRoll = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;

    this.camera = new THREE.PerspectiveCamera(85, 1, 0.05, 500);
  }

  get height() { return this.sliding || this.crouched ? CROUCH_H : STAND_H; }
  get speed() {
    if (this.sliding) return SPRINT * 1.1;
    if (this.crouched) return CROUCH_SPEED;
    if (this.sprinting) return SPRINT;
    return WALK;
  }

  get forward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  get right() { return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }

  spawn(pos) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.health = MAX_HP;
    this.dead = false;
    this.sliding = false; this.slideT = 0; this.slideCooldown = 0;
    this.crouched = false; this.sprinting = false; this.wasSprinting = false;
    this.recoilPitch = 0; this.recoilYaw = 0;
    this.lastDamageAt = -999;
  }

  addRecoil(v, h) { this.recoilPitch += v; this.recoilYaw += h; }

  applyLook(dx, dy) {
    this.yaw -= dx * (Math.PI / 180);
    this.pitch -= dy * (Math.PI / 180);
    const lim = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  damage(amount, now) {
    if (this.dead) return;
    this.health -= amount;
    this.lastDamageAt = now;
    if (this.health <= 0) { this.health = 0; this.dead = true; }
  }

  update(dt, input, now, ads) {
    if (this.dead) return;

    // regen after a delay with no damage
    if (now - this.lastDamageAt > REGEN_DELAY && this.health < MAX_HP && this.health > 0) {
      this.health = Math.min(MAX_HP, this.health + REGEN_RATE * dt);
    }

    this.wasSprinting = this._sprintingLastFrame ?? false;

    const wantForward = input.isDown('forward');
    const wantBack = input.isDown('back');
    const wantLeft = input.isDown('left');
    const wantRight = input.isDown('right');
    const wantSprint = input.isDown('sprint') && wantForward && !ads;
    const wantCrouch = input.isDown('crouch');

    // Slide: crouch pressed while LAST frame was sprinting (crouching cancels sprint on the
    // current frame, so checking the current frame's sprint state never fires — Bug 8).
    if (input.wasPressed('crouch') && this.wasSprinting && !this.sliding && this.slideCooldown <= 0 && this.onGround) {
      this.sliding = true; this.slideT = 0;
    }
    if (this.sliding) {
      this.slideT += dt;
      this.slideDip = Math.sin(Math.min(1, this.slideT / SLIDE_TIME) * Math.PI) * 0.18;
      if (this.slideT >= SLIDE_TIME) { this.sliding = false; this.slideCooldown = SLIDE_COOLDOWN; }
    } else {
      this.slideDip *= 0.85;
    }
    if (this.slideCooldown > 0) this.slideCooldown -= dt;

    this.crouched = wantCrouch || this.sliding;
    this.sprinting = wantSprint && !this.sliding;
    this._sprintingLastFrame = this.sprinting;

    // movement direction
    const move = new THREE.Vector3();
    if (wantForward) move.add(this.forward);
    if (wantBack) move.sub(this.forward);
    if (wantLeft) move.sub(this.right);
    if (wantRight) move.add(this.right);
    if (move.lengthSq() > 0) move.normalize();

    const targetSpeed = this.speed;
    if (this.onGround) {
      this.vel.x = move.x * targetSpeed;
      this.vel.z = move.z * targetSpeed;
    } else {
      this.vel.x += move.x * targetSpeed * AIR_CONTROL * dt;
      this.vel.z += move.z * targetSpeed * AIR_CONTROL * dt;
    }

    // jump
    if (input.wasPressed('jump') && this.onGround && !this.crouched) {
      this.vel.y = JUMP_V;
      this.onGround = false;
    }

    this.vel.y -= GRAVITY * dt;

    const wasGrounded = this.onGround;
    const stepH = this.crouched ? STEP_HEIGHT * 0.6 : STEP_HEIGHT;
    const r = moveEntity(this.pos, this.vel, dt, this.colliders, RADIUS, this.height, stepH);
    this.onGround = r.onGround;
    if (this.onGround && this.vel.y < 0) this.vel.y = 0;
    if (this.onGround && !wasGrounded) { this.landDip = 0.12; }

    // if standing up would intersect something, force crouch
    if (!wantCrouch && !this.sliding) {
      if (blocked(this.pos, RADIUS, STAND_H, this.colliders)) this.crouched = true;
    }

    this._updateCamera(dt, move, ads);
  }

  _updateCamera(dt, move, ads) {
    // bob
    const moving = (move.lengthSq() > 0) && this.onGround;
    if (moving) this.bobT += dt * (this.sprinting ? 14 : this.crouched ? 7 : 10);
    const bobAmp = ads ? 0.01 : 0.045;
    const bobY = moving ? Math.sin(this.bobT) * bobAmp : 0;
    const bobX = moving ? Math.cos(this.bobT * 0.5) * bobAmp * 0.6 : 0;

    this.landDip *= Math.exp(-dt * 10);
    this.shake *= Math.exp(-dt * 8);

    const targetRoll = move.dot(this.right) * (ads ? 0.01 : 0.03);
    this.strafeRoll += (targetRoll - this.strafeRoll) * Math.min(1, dt * 8);

    this.recoilPitch *= Math.exp(-dt * 6);
    this.recoilYaw *= Math.exp(-dt * 6);

    const eyeH = this.height - EYE_OFFSET - this.landDip - this.slideDip;
    this.camera.position.set(this.pos.x, this.pos.y + eyeH + bobY, this.pos.z);
    this.camera.position.x += bobX;
    this.camera.rotation.set(
      this.pitch - this.recoilPitch + (Math.random() - 0.5) * this.shake,
      this.yaw + this.recoilYaw + (Math.random() - 0.5) * this.shake,
      this.strafeRoll,
      'YXZ'
    );
  }
}
