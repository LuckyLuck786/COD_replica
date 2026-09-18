// Player movement, stance, camera and health.
import * as THREE from 'three';
import { moveEntity } from '../engine/physics.js';

const STAND_H = 1.78, CROUCH_H = 1.16, R = 0.36;
const EYE_OFF = -0.20;                      // eye sits this far below the top of the box

export const SPEEDS = { walk: 5.3, sprint: 7.9, crouch: 2.9, ads: 3.5, air: 0.55 };

export class Player {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3(0, 0, 24);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI; this.pitch = 0;
    this.height = STAND_H;
    this.crouching = false;
    this.sprinting = false;
    this.grounded = true;
    this.hp = 100;
    this.dead = false;
    this.deathAt = 0;
    this.lastHurt = -99;
    this.kills = 0; this.deaths = 0; this.shots = 0; this.hits = 0; this.headshots = 0;
    this.streak = 0; this.bestStreak = 0;
    this.bobPhase = 0;
    this.stepPhase = 0;
    this.landDip = 0;
    this.shake = 0;
    this.slideTimer = 0;
    this.slideCooldown = 0;
    this.moveSpeed = 0;
  }

  get eyeY() { return this.pos.y + this.height + EYE_OFF; }

  respawn(point) {
    this.pos.copy(point); this.pos.y += 0.05;
    this.vel.set(0, 0, 0);
    this.hp = 100; this.dead = false;
    this.pitch = 0;
    this.height = STAND_H; this.crouching = false;
    this.streak = 0;
  }

  hurt(amount, now, fromDir) {
    if (this.dead) return false;
    this.hp -= amount;
    this.lastHurt = now;
    this.shake = Math.min(0.9, this.shake + 0.25);
    if (this.hp <= 0) {
      this.hp = 0; this.dead = true; this.deathAt = now; this.deaths++;
      this.streak = 0;
      return true;
    }
    return false;
  }

  update(dt, now, input, colliders, ctx) {
    // ---- health regeneration ----
    if (!this.dead && this.hp < 100 && now - this.lastHurt > 4.2) {
      this.hp = Math.min(100, this.hp + 26 * dt);
    }
    if (this.dead) {
      this.camera.position.set(this.pos.x, this.pos.y + 0.35, this.pos.z);
      this.camera.rotation.set(0, this.yaw, -0.7, 'YXZ');
      return;
    }

    // ---- stance ----
    const mv = ctx.move;
    const wasSprinting = this.sprinting;
    const wantCrouch = mv.crouch;
    const canStand = !ctx.blockedStanding;
    this.crouching = wantCrouch || !canStand;
    const targetH = this.crouching ? CROUCH_H : STAND_H;
    this.height += (targetH - this.height) * Math.min(1, 12 * dt);

    // ---- wish direction ----
    const f = Number(mv.forward) - Number(mv.back);
    const s = Number(mv.right) - Number(mv.left);
    // forward = (-sin yaw, 0, -cos yaw), right = (cos yaw, 0, -sin yaw)
    const wish = new THREE.Vector3(
      -Math.sin(this.yaw) * f + Math.cos(this.yaw) * s,
      0,
      -Math.cos(this.yaw) * f - Math.sin(this.yaw) * s
    );
    const moving = wish.lengthSq() > 0.0001;
    if (moving) wish.normalize();

    this.sprinting = mv.sprint && f > 0 && this.grounded && !ctx.ads && !this.crouching && this.slideTimer <= 0;

    // ---- slide (sprint + crouch) ----
    this.slideCooldown -= dt;
    // slide: crouch pressed while sprinting (crouching cancels sprint, so use last frame's state)
    if (wasSprinting && mv.crouchPressed && f > 0 && this.slideCooldown <= 0 && this.grounded) {
      this.slideTimer = 0.55; this.slideCooldown = 1.6;
      this.vel.x = wish.x * 11.5; this.vel.z = wish.z * 11.5;
    }
    if (this.slideTimer > 0) this.slideTimer -= dt;

    let speed = SPEEDS.walk;
    if (this.crouching) speed = SPEEDS.crouch;
    else if (this.sprinting) speed = SPEEDS.sprint;
    else if (ctx.ads) speed = SPEEDS.ads;
    if (ctx.reloading) speed *= 0.92;

    if (this.slideTimer > 0) {
      // decelerate through the slide, no steering authority
      this.vel.x *= (1 - 2.6 * dt);
      this.vel.z *= (1 - 2.6 * dt);
    } else if (this.grounded) {
      const accel = 46;
      this.vel.x += (wish.x * speed - this.vel.x) * Math.min(1, accel * dt / 6);
      this.vel.z += (wish.z * speed - this.vel.z) * Math.min(1, accel * dt / 6);
      if (!moving) { this.vel.x *= (1 - 12 * dt); this.vel.z *= (1 - 12 * dt); }
    } else {
      this.vel.x += wish.x * speed * SPEEDS.air * dt * 6;
      this.vel.z += wish.z * speed * SPEEDS.air * dt * 6;
      const hs = Math.hypot(this.vel.x, this.vel.z);
      const cap = SPEEDS.sprint * 1.15;
      if (hs > cap) { this.vel.x *= cap / hs; this.vel.z *= cap / hs; }
    }

    // ---- jump ----
    if (mv.jump && this.grounded && this.slideTimer <= 0) {
      this.vel.y = 7.4;
      this.grounded = false;
    }
    this.vel.y -= 23 * dt;

    const wasAir = !this.grounded;
    const res = moveEntity(this.pos, this.vel, dt, colliders, R, this.height, 0.92);
    this.grounded = res.grounded;
    if (this.grounded && wasAir && this.vel.y <= 0) {
      const impact = Math.min(1, Math.abs(ctx.lastFallSpeed || 0) / 18);
      this.landDip = impact;
      if (impact > 0.25) ctx.onLand?.(impact);
    }
    this.moveSpeed = Math.hypot(this.vel.x, this.vel.z);

    // arena bounds
    const b = ctx.bounds;
    this.pos.x = Math.max(-b, Math.min(b, this.pos.x));
    this.pos.z = Math.max(-b, Math.min(b, this.pos.z));
    if (this.pos.y < -10) { this.pos.set(0, 6, 0); this.vel.set(0, 0, 0); }

    // ---- footsteps ----
    if (this.grounded && this.moveSpeed > 1.2) {
      this.stepPhase += dt * this.moveSpeed * (this.crouching ? 0.35 : 0.62);
      if (this.stepPhase > 1) { this.stepPhase = 0; ctx.onStep?.(this.sprinting); }
    }

    // ---- camera ----
    this.landDip *= (1 - 8 * dt);
    this.shake *= (1 - 5 * dt);
    this.bobPhase += dt * (this.sprinting ? 12.5 : 8.5) * Math.min(this.moveSpeed / 5, 1.2);
    const bobAmp = ctx.bobScale * (1 - ctx.adsBlend * 0.9) * Math.min(this.moveSpeed / 5.3, 1);
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.032 * bobAmp;
    const bobX = Math.cos(this.bobPhase) * 0.026 * bobAmp;
    const shakeX = (Math.random() - .5) * this.shake * 0.05;
    const shakeY = (Math.random() - .5) * this.shake * 0.05;
    const slideDip = this.slideTimer > 0 ? 0.42 : 0;

    this.camera.position.set(
      this.pos.x + bobX + shakeX,
      this.eyeY + bobY - this.landDip * 0.22 - slideDip + shakeY,
      this.pos.z
    );
    const roll = (this.sprinting ? Math.sin(this.bobPhase * 0.5) * 0.012 : 0)
      + (-s * 0.014 * (1 - ctx.adsBlend))
      + (this.slideTimer > 0 ? 0.10 : 0);
    this.camera.rotation.set(
      this.pitch - ctx.recoilPitch,
      this.yaw + ctx.recoilYaw,
      roll,
      'YXZ'
    );
  }
}

export const PLAYER_DIMS = { r: R, stand: STAND_H, crouch: CROUCH_H };
