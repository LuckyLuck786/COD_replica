// Weapon table, viewmodel construction, and the Loadout that drives ADS blend, recoil,
// sway/bob, muzzle flash, and grenade-lowering.
import * as THREE from 'three';
import { mergeWithColors } from '../engine/merge.js';
import { audio } from '../engine/audio.js';

export const WEAPONS = {
  R91: {
    id: 'R91', name: 'R-91 RANGER', type: 'auto', profile: 'rifle', sight: 'holo',
    rpm: 690, dmg: 31, headMult: 2.4, limbMult: 0.85, mag: 30, reserve: 180,
    reload: 2.05, ads: 0.22, range: 46, falloff: 0.55,
    spread: { hip: 0.028, ads: 0.004, move: 0.02, air: 0.05, max: 0.12, bloom: 0.012, decay: 6 },
    recoil: { v: 0.9, h: 0.35, recover: 7, kick: 0.03 },
    sightY: 0.052,
  },
  V9: {
    id: 'V9', name: 'VECTOR-9', type: 'auto', profile: 'smg', sight: 'reflex',
    rpm: 940, dmg: 23, headMult: 2.0, limbMult: 0.8, mag: 32, reserve: 224,
    reload: 1.72, ads: 0.17, range: 26, falloff: 0.8,
    spread: { hip: 0.034, ads: 0.006, move: 0.024, air: 0.06, max: 0.14, bloom: 0.010, decay: 7 },
    recoil: { v: 0.7, h: 0.5, recover: 8, kick: 0.025 },
    sightY: 0.048,
  },
  M7: {
    id: 'M7', name: 'M7 LONGSHOT', type: 'bolt', profile: 'sniper', sight: 'scope',
    rpm: 48, dmg: 118, headMult: 2.0, limbMult: 1.0, mag: 5, reserve: 35,
    reload: 2.9, ads: 0.42, range: 120, falloff: 0.15,
    spread: { hip: 0.085, ads: 0.0, move: 0.03, air: 0.08, max: 0.16, bloom: 0.02, decay: 4 },
    recoil: { v: 2.4, h: 0.4, recover: 3.5, kick: 0.09 },
    sightY: 0.06,
  },
  P8: {
    id: 'P8', name: 'P8 SIDEARM', type: 'semi', profile: 'pistol', sight: 'iron',
    rpm: 420, dmg: 27, headMult: 2.2, limbMult: 0.8, mag: 12, reserve: 72,
    reload: 1.42, ads: 0.15, range: 24, falloff: 0.9,
    spread: { hip: 0.026, ads: 0.005, move: 0.018, air: 0.045, max: 0.1, bloom: 0.01, decay: 8 },
    recoil: { v: 0.6, h: 0.3, recover: 9, kick: 0.02 },
    sightY: 0.045,
  },
};

export const WEAPON_ORDER = ['R91', 'V9', 'M7', 'P8'];

function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  return m;
}

/** Builds a viewmodel from boxes (receiver, barrel, rail, grip, mag, stock, foregrip, handle) + sight, merged into one mesh. */
export function buildViewmodel(weapon) {
  const matBody = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.5, metalness: 0.6 });
  const matSight = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.7 });
  const group = new THREE.Group();
  const parts = [];

  const receiver = box(0.06, 0.08, 0.32, matBody); receiver.position.set(0, 0, 0); parts.push(receiver);
  const barrel = box(0.03, 0.03, weapon.profile === 'sniper' ? 0.42 : 0.26, matBody);
  barrel.position.set(0, 0.01, -0.32); parts.push(barrel);
  const rail = box(0.04, 0.02, 0.2, matSight); rail.position.set(0, 0.06, -0.05); parts.push(rail);
  const grip = box(0.035, 0.14, 0.05, matBody); grip.position.set(0, -0.09, 0.08); grip.rotation.x = 0.25; parts.push(grip);
  const mag = box(0.04, weapon.profile === 'sniper' ? 0.08 : 0.16, 0.06, matBody);
  mag.position.set(0, -0.13, -0.02); mag.rotation.x = -0.15; parts.push(mag);
  const stock = box(0.05, 0.07, weapon.profile === 'pistol' ? 0.02 : 0.2, matBody);
  stock.position.set(0, 0, weapon.profile === 'pistol' ? 0.05 : 0.24); parts.push(stock);
  const foregrip = box(0.03, 0.1, 0.04, matBody);
  foregrip.position.set(0, -0.07, -0.22); parts.push(foregrip);
  const handle = box(0.02, 0.03, 0.05, matSight);
  handle.position.set(0.04, 0.03, -0.02); parts.push(handle);

  const sight = box(0.05, 0.05, 0.06, matSight);
  sight.position.set(0, 0.065 + weapon.sightY, -0.05);
  parts.push(sight);

  for (const p of parts) group.add(p);
  group.updateMatrixWorld(true);
  const merged = mergeWithColors(null, parts, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.5 }));
  merged.name = 'viewmodel-' + weapon.id;
  return merged;
}

export class Loadout {
  constructor(camera, vmScene) {
    this.camera = camera;
    this.vmScene = vmScene;
    this.weaponId = WEAPON_ORDER[0];
    this.holderScale = 0.74;
    this.ammo = {};
    this.reserve = {};
    for (const id of WEAPON_ORDER) { this.ammo[id] = WEAPONS[id].mag; this.reserve[id] = WEAPONS[id].reserve; }
    this.viewmodels = {};
    for (const id of WEAPON_ORDER) {
      const vm = buildViewmodel(WEAPONS[id]);
      vm.visible = false;
      this.vmScene.add(vm);
      this.viewmodels[id] = vm;
    }
    this.reset();
  }

  get weapon() { return WEAPONS[this.weaponId]; }
  get currentAmmo() { return this.ammo[this.weaponId]; }
  get currentReserve() { return this.reserve[this.weaponId]; }

  reset() {
    // Clears EVERY timer. A restart that leaves nextShot/boltUntil/swapUntil at old absolute
    // times makes the gun silently refuse to fire after G.time resets to 0 (Bug 3).
    this.nextShot = 0;
    this.boltUntil = 0;
    this.swapUntil = 0;
    this.reloading = false;
    this.reloadEndsAt = 0;
    this.adsBlend = 0;
    this.spread = this.weapon ? this.weapon.spread.hip : 0.03;
    this.recoilAccum = { v: 0, h: 0 };
    this.sway = new THREE.Vector2();
    this.bobPhase = 0;
    this.lowered = 0;
    this.muzzleFlashT = 0;
    this.scoped = false;
    this.fireBufferedAt = -1;
    for (const id of WEAPON_ORDER) { this.ammo[id] = WEAPONS[id].mag; this.reserve[id] = WEAPONS[id].reserve; }
    Object.values(this.viewmodels).forEach((v) => (v.visible = false));
    if (this.viewmodels[this.weaponId]) this.viewmodels[this.weaponId].visible = true;
  }

  switchTo(id) {
    if (id === this.weaponId) return;
    if (this.viewmodels[this.weaponId]) this.viewmodels[this.weaponId].visible = false;
    this.weaponId = id;
    this.viewmodels[id].visible = true;
    this.spread = this.weapon.spread.hip;
    this.reloading = false;
    this.adsBlend = 0;
    audio.swap();
  }

  next() {
    const i = WEAPON_ORDER.indexOf(this.weaponId);
    this.switchTo(WEAPON_ORDER[(i + 1) % WEAPON_ORDER.length]);
  }

  startReload(now) {
    if (this.reloading) return false;
    if (this.currentAmmo >= this.weapon.mag || this.currentReserve <= 0) return false;
    this.reloading = true;
    this.reloadEndsAt = now + this.weapon.reload;
    audio.reloadOut();
    return true;
  }

  canFire(now, ads) {
    if (this.reloading) return false;
    if (now < this.nextShot) return false;
    if (this.weapon.type === 'bolt' && now < this.boltUntil) return false;
    if (this.currentAmmo <= 0) return false;
    return true;
  }

  fire(now) {
    const w = this.weapon;
    this.ammo[this.weaponId]--;
    this.nextShot = now + 60 / w.rpm;
    if (w.type === 'bolt') this.boltUntil = now + 60 / w.rpm;
    this.recoilAccum.v += w.recoil.v;
    this.recoilAccum.h += w.recoil.h * (Math.random() > 0.5 ? 1 : -1);
    this.muzzleFlashT = 0.05;
    this.spread = Math.min(w.spread.max, this.spread + w.spread.bloom);
    audio.shot(w.profile);
    if (this.currentAmmo === 0 && this.reserve[this.weaponId] > 0) {
      // auto-reload handled by caller via settings.autoReload
    }
    return { dmg: w.dmg, headMult: w.headMult, limbMult: w.limbMult, range: w.range, falloff: w.falloff };
  }

  dryFire() { audio.dryFire(); }

  update(dt, now, ctx) {
    const w = this.weapon;
    if (this.reloading && now >= this.reloadEndsAt) {
      const need = w.mag - this.ammo[this.weaponId];
      const take = Math.min(need, this.reserve[this.weaponId]);
      this.ammo[this.weaponId] += take;
      this.reserve[this.weaponId] -= take;
      this.reloading = false;
      audio.reloadIn();
    }

    const targetAds = ctx.ads ? 1 : 0;
    this.adsBlend += (targetAds - this.adsBlend) * Math.min(1, dt * 10);
    this.scoped = w.profile === 'sniper' && this.adsBlend > 0.9;

    const targetSpreadBase = ctx.ads ? w.spread.ads : w.spread.hip;
    let target = targetSpreadBase;
    if (ctx.moving) target += w.spread.move;
    if (!ctx.onGround) target += w.spread.air;
    this.spread += (Math.max(target, this.spread - w.spread.decay * dt) - this.spread) * 0;
    this.spread = Math.max(target, this.spread - w.spread.decay * dt);

    this.recoilAccum.v *= Math.exp(-dt * w.recoil.recover);
    this.recoilAccum.h *= Math.exp(-dt * w.recoil.recover);

    this.muzzleFlashT = Math.max(0, this.muzzleFlashT - dt);

    const targetLowered = ctx.grenadeLower ? 1 : 0;
    this.lowered += (targetLowered - this.lowered) * Math.min(1, dt * 8);

    this._updateViewmodel(dt, ctx);
  }

  _updateViewmodel(dt, ctx) {
    const vm = this.viewmodels[this.weaponId];
    if (!vm) return;
    const w = this.weapon;
    const s = this.holderScale;
    const adsPos = new THREE.Vector3(0, -w.sightY + 0.065, 0.05);
    const hipPos = new THREE.Vector3(0.14, -0.14, -0.22);
    const pos = hipPos.clone().lerp(adsPos, this.adsBlend);

    if (ctx.moving && ctx.onGround) this.bobPhase += dt * (ctx.sprinting ? 14 : 10);
    const bob = ctx.moving && ctx.onGround ? Math.sin(this.bobPhase) * 0.008 * (1 - this.adsBlend) : 0;
    const bobX = ctx.moving && ctx.onGround ? Math.cos(this.bobPhase * 0.5) * 0.006 * (1 - this.adsBlend) : 0;

    pos.y += bob - this.lowered * 0.35;
    pos.x += bobX + this.sway.x;
    pos.z += this.lowered * 0.15;

    vm.position.copy(pos);
    vm.scale.setScalar(s);
    vm.rotation.set(-this.recoilAccum.v * 0.4 + this.sway.y, this.recoilAccum.h * 0.3, this.recoilAccum.h * 0.15);
  }

  addSway(dx, dy) {
    this.sway.x = THREE.MathUtils.clamp(this.sway.x - dx * 0.0006, -0.03, 0.03);
    this.sway.y = THREE.MathUtils.clamp(this.sway.y - dy * 0.0006, -0.03, 0.03);
  }
}
