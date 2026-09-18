// Weapon definitions, the first-person viewmodel, and the fire/reload/recoil state machine.
import * as THREE from 'three';
import { mergeWithColors } from '../engine/merge.js';

const GUN_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 });

export const WEAPONS = [
  {
    id: 'ar', name: 'R-91 RANGER', kind: 'rifle', auto: true,
    rpm: 690, damage: 31, headMult: 2.4, limbMult: 0.85,
    mag: 30, reserve: 180, reload: 2.05, adsTime: 0.22,
    range: 46, falloff: 0.55, penetration: 0,
    spread: { hip: 0.028, ads: 0.0035, move: 0.030, air: 0.055, max: 0.075, bloom: 0.0055, decay: 0.10 },
    recoil: { v: 0.0072, h: 0.0030, recover: 7.0, kick: 0.030 },
    colors: { body: 0x4c5358, rail: 0x3a4145, grip: 0x2c3134, accent: 0x8a9298 },
    size: { len: 0.62, sight: 'holo', sightY: 0.090 },
  },
  {
    id: 'smg', name: 'VECTOR-9', kind: 'smg', auto: true,
    rpm: 940, damage: 23, headMult: 2.0, limbMult: 0.9,
    mag: 32, reserve: 224, reload: 1.72, adsTime: 0.17,
    range: 26, falloff: 0.62, penetration: 0,
    spread: { hip: 0.034, ads: 0.0062, move: 0.020, air: 0.048, max: 0.090, bloom: 0.0060, decay: 0.13 },
    recoil: { v: 0.0055, h: 0.0038, recover: 8.5, kick: 0.024 },
    colors: { body: 0x515759, rail: 0x373c3f, grip: 0x2a2e30, accent: 0xa9702f },
    size: { len: 0.46, sight: 'reflex', sightY: 0.090 },
  },
  {
    id: 'sniper', name: 'M7 LONGSHOT', kind: 'sniper', auto: false, bolt: true,
    rpm: 48, damage: 118, headMult: 2.0, limbMult: 0.72,
    mag: 5, reserve: 35, reload: 2.9, adsTime: 0.42,
    range: 120, falloff: 0.9, penetration: 1,
    spread: { hip: 0.085, ads: 0.0, move: 0.045, air: 0.10, max: 0.12, bloom: 0.010, decay: 0.30 },
    recoil: { v: 0.030, h: 0.006, recover: 3.4, kick: 0.11 },
    colors: { body: 0x585a4e, rail: 0x3b3d36, grip: 0x2b2d28, accent: 0x7d876c },
    size: { len: 0.86, sight: 'scope', sightY: 0.098 },
  },
  {
    id: 'pistol', name: 'P8 SIDEARM', kind: 'pistol', auto: false,
    rpm: 420, damage: 27, headMult: 2.2, limbMult: 0.85,
    mag: 12, reserve: 72, reload: 1.42, adsTime: 0.15,
    range: 24, falloff: 0.55, penetration: 0,
    spread: { hip: 0.026, ads: 0.0030, move: 0.022, air: 0.05, max: 0.06, bloom: 0.0075, decay: 0.16 },
    recoil: { v: 0.0090, h: 0.0035, recover: 9.0, kick: 0.038 },
    colors: { body: 0x484d50, rail: 0x363a3d, grip: 0x272a2c, accent: 0x969ba0 },
    size: { len: 0.28, sight: 'iron', sightY: 0.058 },
  },
];

// ---------------------------------------------------------------- viewmodel
function mat(c, rough = 0.5, metal = 0.7) {
  return new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });
}

function buildViewmodel(def) {
  const g = new THREE.Group();
  const C = def.colors;
  const body = mat(C.body, .52, .35), rail = mat(C.rail, .62, .28),
        grip = mat(C.grip, .88, .08), acc = mat(C.accent, .55, .32);
  const L = def.size.len;
  const parts = [];
  const add = (w, h, d, x, y, z, m) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z); g.add(b); parts.push(b); return b;
  };

  add(0.075, 0.085, L, 0, 0, -L / 2, body);                    // receiver
  add(0.045, 0.045, L * 0.75, 0, 0.005, -L - L * 0.30, rail);  // barrel
  add(0.06, 0.02, L * 0.55, 0, 0.052, -L * 0.55, rail);        // top rail
  add(0.055, 0.13, 0.075, 0, -0.10, -L * 0.25, grip)           // pistol grip
    .rotation.set(0.28, 0, 0);
  if (def.kind !== 'pistol') {
    add(0.05, 0.11, 0.10, 0, -0.085, -L * 0.62, acc);          // magazine
    add(0.065, 0.07, 0.15, 0, -0.005, 0.075, body);            // stock
    add(0.045, 0.05, 0.09, 0, -0.045, -L * 1.05, grip);        // foregrip
  } else {
    add(0.045, 0.10, 0.055, 0, -0.075, -L * 0.30, acc);
  }
  add(0.02, 0.02, 0.12, 0.048, -0.015, -L * 0.35, rail);       // charging handle

  // sights
  const sightY = 0.078;
  if (def.size.sight === 'scope') {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.30, 14), rail);
    tube.rotation.x = Math.PI / 2; tube.position.set(0, sightY + 0.02, -L * 0.55);
    g.add(tube); parts.push(tube);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.032, 16),
      new THREE.MeshStandardMaterial({ color: 0x0a2f3a, emissive: 0x123b48, emissiveIntensity: .8, roughness: .1, metalness: .9 }));
    lens.position.set(0, sightY + 0.02, -L * 0.40); lens.rotation.y = Math.PI;
    g.add(lens);
  } else if (def.size.sight === 'iron') {
    add(0.008, 0.026, 0.01, 0, sightY - 0.02, -L * 0.95, rail);
    add(0.030, 0.022, 0.01, 0, sightY - 0.022, -L * 0.06, rail);
  } else {
    add(0.058, 0.052, 0.062, 0, sightY + 0.012, -L * 0.52, rail);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.02, 12),
      new THREE.MeshStandardMaterial({ color: 0x0d1a12, emissive: 0x2fff77, emissiveIntensity: .55, roughness: .2 }));
    dot.position.set(0, sightY + 0.012, -L * 0.55 + 0.031); dot.rotation.y = Math.PI;
    g.add(dot);
  }

  // muzzle flash
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffe0a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), flashMat);
  flash.position.set(0, 0.005, -L * 1.72);
  flash.scale.set(1, 1, 2.1);
  g.add(flash);

  const muzzle = new THREE.Object3D();
  muzzle.position.copy(flash.position);
  g.add(muzzle);

  // the whole gun body becomes one draw call
  g.updateMatrixWorld(true);
  mergeWithColors(g, parts, GUN_MAT);
  for (const p of parts) p.geometry.dispose();
  return { group: g, flash, muzzle };
}

// ---------------------------------------------------------------- runtime
export class WeaponState {
  constructor(def) {
    this.def = def;
    this.ammo = def.mag;
    this.reserve = def.reserve;
    this.reloading = false;
    this.reloadEnd = 0;
    this.nextShot = 0;
    this.boltUntil = 0;
    this.spread = def.spread.hip;
    const vm = buildViewmodel(def);
    this.group = vm.group; this.flashMesh = vm.flash; this.muzzle = vm.muzzle;
    this.group.visible = false;
  }
  get full() { return this.ammo >= this.def.mag; }
}

export class Loadout {
  constructor(camera) {
    this.slots = WEAPONS.map(d => new WeaponState(d));
    this.index = 0;
    this.prevIndex = 1;
    this.holder = new THREE.Group();
    this.holder.scale.setScalar(0.74);
    // slight down/right offset — classic hip position
    this.holder.position.set(0.185, -0.185, -0.42);
    camera.add(this.holder);
    for (const s of this.slots) this.holder.add(s.group);
    this.slots[0].group.visible = true;

    this.ads = 0;               // 0..1
    this.lower = 0;             // 0..1, gun dropped out of view while a grenade is in hand
    this.swapUntil = 0;
    this.recoilPitch = 0; this.recoilYaw = 0;
    this.kick = 0; this.kickRot = 0;
    this.bobPhase = 0;
    this.flashUntil = 0;
    this.sway = new THREE.Vector2();

    this.flashLight = new THREE.PointLight(0xffcf8a, 0, 9, 2);
    this.holder.add(this.flashLight);
  }

  /** Restore a fresh loadout. Must run whenever the game clock is reset to 0, otherwise
   *  timers left over from the previous session (nextShot = 45s, say) block firing. */
  reset() {
    this.slots.forEach((s, i) => {
      s.ammo = s.def.mag; s.reserve = s.def.reserve;
      s.reloading = false; s.reloadEnd = 0;
      s.nextShot = 0; s.boltUntil = 0;
      s.spread = s.def.spread.hip;
      s.group.visible = i === 0;
    });
    this.index = 0; this.prevIndex = 1;
    this.swapUntil = 0; this.flashUntil = 0;
    this.ads = 0;
    this.recoilPitch = 0; this.recoilYaw = 0;
    this.kick = 0; this.kickRot = 0;
    this.lower = 0;
  }

  next(now) { return this.switchTo((this.index + 1) % this.slots.length, now); }

  get cur() { return this.slots[this.index]; }
  get def() { return this.slots[this.index].def; }

  switchTo(i, now) {
    if (i === this.index || i < 0 || i >= this.slots.length || now < this.swapUntil) return false;
    this.prevIndex = this.index;
    this.cur.group.visible = false;
    this.cur.reloading = false;
    this.index = i;
    this.cur.group.visible = true;
    this.swapUntil = now + 0.45;
    this.ads = 0;
    return true;
  }

  canFire(now, moving) {
    const w = this.cur;
    return !w.reloading && now >= w.nextShot && now >= this.swapUntil && now >= w.boltUntil && w.ammo > 0;
  }

  /** Consume a round. Returns the spread cone half-angle (radians) for this shot. */
  fire(now, ctx) {
    const w = this.cur, d = w.def;
    w.ammo--;
    w.nextShot = now + 60 / d.rpm;
    if (d.bolt) w.boltUntil = now + 0.95;

    const s = d.spread;
    const base = this.ads > 0.85 ? s.ads : s.hip;
    let cone = base + (ctx.moveSpeed || 0) * s.move * 0.06 + (ctx.airborne ? s.air : 0);
    cone = Math.min(cone + w.spread * 0, s.max);
    cone = Math.min(Math.max(cone, 0) + this._bloom(w), s.max);
    w.spread = Math.min(w.spread + s.bloom, s.max);

    const r = d.recoil;
    const adsDamp = 1 - this.ads * 0.35;
    this.recoilPitch += r.v * adsDamp * (0.85 + Math.random() * 0.3);
    this.recoilYaw += (Math.random() - 0.5) * 2 * r.h * adsDamp;
    this.kick = r.kick;
    this.kickRot = r.kick * 2.4;
    this.flashUntil = now + 0.045;
    return cone;
  }

  _bloom(w) { return Math.max(0, w.spread - w.def.spread.hip) * 0.9; }

  startReload(now) {
    const w = this.cur;
    if (w.reloading || w.full || w.reserve <= 0 || now < this.swapUntil) return false;
    w.reloading = true;
    w.reloadEnd = now + w.def.reload;
    return true;
  }

  finishReload() {
    const w = this.cur;
    const need = w.def.mag - w.ammo;
    const take = Math.min(need, w.reserve);
    w.ammo += take; w.reserve -= take;
    w.reloading = false;
  }

  update(dt, now, st) {
    const w = this.cur, d = w.def;

    if (w.reloading && now >= w.reloadEnd) this.finishReload();

    // spread decay
    w.spread = Math.max(d.spread.hip, w.spread - d.spread.decay * dt * 6);

    // ADS blend
    const want = st.wantAds && !st.lowered && !w.reloading && now >= this.swapUntil ? 1 : 0;
    this.lower += ((st.lowered ? 1 : 0) - this.lower) * Math.min(1, 14 * dt);
    const rate = dt / Math.max(d.adsTime, 0.01);
    this.ads += Math.sign(want - this.ads) * Math.min(rate, Math.abs(want - this.ads));
    this.ads = Math.min(1, Math.max(0, this.ads));

    // recoil recovery
    const rec = d.recoil.recover;
    this.recoilPitch -= this.recoilPitch * Math.min(1, rec * dt);
    this.recoilYaw -= this.recoilYaw * Math.min(1, rec * dt);
    this.kick -= this.kick * Math.min(1, 11 * dt);
    this.kickRot -= this.kickRot * Math.min(1, 10 * dt);

    // sway follows look input, damped
    this.sway.x += (Math.max(-1, Math.min(1, -st.lookYaw * 26)) - this.sway.x) * Math.min(1, 8 * dt);
    this.sway.y += (Math.max(-1, Math.min(1, -st.lookPitch * 26)) - this.sway.y) * Math.min(1, 8 * dt);

    // walk bob
    if (st.grounded && st.moveSpeed > 0.4) this.bobPhase += dt * (st.sprinting ? 13 : 9);
    const bobAmt = st.bobScale * (1 - this.ads * 0.85) * Math.min(st.moveSpeed / 6, 1);
    const bobX = Math.cos(this.bobPhase) * 0.012 * bobAmt;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.010 * bobAmt;

    // hip vs ADS pose
    const a = this.ads;
    const hipX = 0.185, hipY = -0.185, hipZ = -0.42;
    const scoped = d.size.sight === 'scope';
    // put the sight exactly on the screen centre when fully aimed
    const adsX = 0.0, adsY = -(d.size.sightY * this.holder.scale.y), adsZ = -0.50;
    this.holder.position.set(
      THREE.MathUtils.lerp(hipX, adsX, a) + bobX + this.sway.x * 0.018 * (1 - a * 0.8),
      THREE.MathUtils.lerp(hipY, adsY, a) + bobY + this.sway.y * 0.014 * (1 - a * 0.8) - st.landDip * 0.05
        - this.lower * 0.32,
      THREE.MathUtils.lerp(hipZ, adsZ, a) + this.kick
    );
    const sprintTilt = st.sprinting && !st.wantAds ? 1 : 0;
    this.holder.rotation.set(
      this.kickRot + this.sway.y * 0.05 * (1 - a) + sprintTilt * 0.22,
      this.sway.x * 0.06 * (1 - a) + sprintTilt * 0.5,
      sprintTilt * 0.35 * (1 - a)
    );

    // muzzle flash
    const on = now < this.flashUntil;
    w.flashMesh.material.opacity = on ? 0.9 : 0;
    w.flashMesh.rotation.z = Math.random() * Math.PI;
    this.flashLight.intensity = on ? 14 : 0;
    if (on) this.flashLight.position.copy(w.muzzle.position);

    // scoped weapons hide the viewmodel at full ADS (scope overlay takes over)
    if (scoped) w.group.visible = a < 0.92;
  }
}
