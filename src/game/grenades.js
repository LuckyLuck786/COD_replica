// Frag grenades: cooking, throwing, bouncing physics, fuse, the in-hand viewmodel and the
// predicted-arc preview. Explosion *effects on the world* (damage, kills) are handed back to
// the game through the onExplode callback so this module stays about the grenade itself.
import * as THREE from 'three';

export const FRAG = {
  fuse: 3.2,          // seconds from pulling the pin
  radius: 7.5,        // lethal falloff radius (m)
  damage: 160,        // at the centre
  throwSpeed: 15,       // a level throw lands ~14 m out, in front of cover rather than over it
  upBoost: 3.0,
  perLife: 2,
  max: 4,
  r: 0.09,            // physics radius
};

const GRAV = 20;
const _v = new THREE.Vector3();

function inside(p, r, colliders) {
  for (const c of colliders) {
    if (p.x > c.min.x - r && p.x < c.max.x + r &&
        p.y > c.min.y - r && p.y < c.max.y + r &&
        p.z > c.min.z - r && p.z < c.max.z + r) return true;
  }
  return false;
}

// One set of GPU resources per model size, shared by every grenade ever thrown.
const NADE_MATS = {
  body: new THREE.MeshStandardMaterial({ color: 0x4d5a36, roughness: 0.75, metalness: 0.2 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.4, metalness: 0.8 }),
  band: new THREE.MeshStandardMaterial({ color: 0xc9a13a, roughness: 0.6 }),
};
const BEACON_MAT = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
const BEACON_GEO = new THREE.SphereGeometry(0.05, 6, 4);
const NADE_GEOS = new Map();
function nadeGeos(scale) {
  if (!NADE_GEOS.has(scale)) {
    NADE_GEOS.set(scale, {
      body: new THREE.SphereGeometry(0.075 * scale, 10, 8),
      top: new THREE.CylinderGeometry(0.022 * scale, 0.026 * scale, 0.04 * scale, 8),
      lever: new THREE.BoxGeometry(0.012 * scale, 0.11 * scale, 0.02 * scale),
      band: new THREE.TorusGeometry(0.076 * scale, 0.006 * scale, 4, 16),
    });
  }
  return NADE_GEOS.get(scale);
}

function nadeMesh(scale = 1, shadows = false) {
  const G = nadeGeos(scale);
  const g = new THREE.Group();
  const body = new THREE.Mesh(G.body, NADE_MATS.body);
  body.scale.y = 1.18;
  const top = new THREE.Mesh(G.top, NADE_MATS.metal);
  top.position.y = 0.095 * scale;
  const lever = new THREE.Mesh(G.lever, NADE_MATS.metal);
  lever.position.set(0.05 * scale, 0.05 * scale, 0);
  lever.rotation.z = -0.25;
  const band = new THREE.Mesh(G.band, NADE_MATS.band);
  band.rotation.x = Math.PI / 2;
  g.add(body, top, lever, band);
  return g;
}

export class Grenades {
  constructor({ scene, vmCam, colliders, audio }) {
    this.scene = scene;
    this.colliders = colliders;
    this.audio = audio;
    this.live = [];
    this.count = FRAG.perLife;
    this.infinite = false;
    this.cooking = false;
    this.cookStart = 0;
    this.lowerUntil = 0;
    this.onExplode = () => {};

    // in-hand model
    this.hand = nadeMesh(0.55);
    this.hand.visible = false;
    this.hand.position.set(0.22, -0.2, -0.5);
    vmCam.add(this.hand);

    // arc preview
    const n = 48;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.arc = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xffb02e, size: 0.09, transparent: true, opacity: 0.85, depthWrite: false,
    }));
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    scene.add(this.arc);
    this.arcN = n;

    this.landMarker = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 28),
      new THREE.MeshBasicMaterial({ color: 0xffb02e, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
    this.landMarker.rotation.x = -Math.PI / 2;
    this.landMarker.visible = false;
    scene.add(this.landMarker);
  }

  reset() {
    for (const g of this.live) this.scene.remove(g.mesh);
    this.live = [];
    this.count = FRAG.perLife;
    this.cooking = false;
    this.hand.visible = false;
    this.arc.visible = false;
    this.landMarker.visible = false;
    this.lowerUntil = 0;
  }

  refill(n = FRAG.perLife) { this.count = Math.min(FRAG.max, Math.max(this.count, n)); }
  add(n) { this.count = Math.min(FRAG.max, this.count + n); }

  get lowered() { return this.cooking || this._now < this.lowerUntil; }
  cookProgress(now) { return this.cooking ? Math.min(1, (now - this.cookStart) / FRAG.fuse) : 0; }

  /** Pull the pin. Returns false if there is nothing to throw. */
  startCook(now) {
    if (this.cooking || (!this.infinite && this.count <= 0)) return false;
    this.cooking = true;
    this.cookStart = now;
    this._lastBeep = -1;
    this.hand.visible = true;
    this.audio.pin?.();
    return true;
  }

  /** Throw the grenade being cooked. aim = {origin, dir, carry}. */
  release(now, aim) {
    if (!this.cooking) return;
    this.cooking = false;
    this.hand.visible = false;
    this.arc.visible = false;
    this.landMarker.visible = false;
    this.lowerUntil = now + 0.35;
    if (!this.infinite) this.count--;
    const fuseLeft = Math.max(0.15, FRAG.fuse - (now - this.cookStart));
    this.spawn(aim.origin, this.throwVelocity(aim), fuseLeft, 'player', null);
    this.audio.throwNade?.();
  }

  throwVelocity(aim) {
    return aim.dir.clone().multiplyScalar(FRAG.throwSpeed)
      .add(new THREE.Vector3(0, FRAG.upBoost, 0))
      .addScaledVector(aim.carry || new THREE.Vector3(), 0.5);
  }

  /** Put a live grenade in the world (used by the player and by bots). */
  spawn(pos, vel, fuse, owner, ownerRef) {
    const mesh = new THREE.Mesh(nadeGeos(1.6).body, NADE_MATS.body);
    // blinking beacon so a thrown frag can be followed in flight and on the ground
    const beacon = new THREE.Mesh(BEACON_GEO, BEACON_MAT);
    beacon.position.y = 0.13;
    mesh.add(beacon);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.live.push({ mesh, beacon, pos: pos.clone(), vel: vel.clone(), fuse, owner, ownerRef, spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, 0), clinkAt: 0, beepAt: 0 });
  }

  /** Where would a throw land? Fills the arc preview. */
  _preview(aim) {
    const pos = aim.origin.clone();
    const vel = this.throwVelocity(aim);
    const arr = this.arc.geometry.attributes.position.array;
    const step = 1 / 30;
    let landed = null;
    for (let i = 0; i < this.arcN; i++) {
      if (!landed) {
        vel.y -= GRAV * step;
        _v.copy(pos).addScaledVector(vel, step);
        if (inside(_v, FRAG.r, this.colliders)) landed = pos.clone();
        else pos.copy(_v);
      }
      const p = landed || pos;
      arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
    }
    this.arc.geometry.attributes.position.needsUpdate = true;
    this.arc.visible = true;
    if (landed) {
      this.landMarker.position.set(landed.x, landed.y + 0.03, landed.z);
      this.landMarker.visible = true;
    } else this.landMarker.visible = false;
  }

  /** Does a throw with this velocity fly for most of `flight` seconds without hitting anything? */
  clearArc(from, vel, flight) {
    const p = from.clone(), v = vel.clone(), step = 1 / 30;
    for (let t = 0; t < flight * 0.85; t += step) {
      v.y -= GRAV * step;
      p.addScaledVector(v, step);
      if (inside(p, FRAG.r, this.colliders)) return false;
    }
    return true;
  }

  /** Grenades near a point, for bot avoidance and the HUD danger indicator. */
  threats(pos, range) {
    return this.live.filter(g => g.pos.distanceTo(pos) < range);
  }

  update(dt, now, ctx) {
    this._now = now;

    // --- in hand ---
    if (this.cooking) {
      const t = now - this.cookStart;
      this.hand.position.set(0.22 + Math.sin(now * 3) * 0.003, -0.2 + Math.min(t * 0.3, 0.03), -0.5);
      this.hand.rotation.set(0.3, now * 0.2, 0);
      if (ctx.aim && ctx.showArc) this._preview(ctx.aim);
      else { this.arc.visible = false; this.landMarker.visible = false; }
      // beep each second so the fuse can be timed by ear
      const sec = Math.floor(t);
      if (sec !== this._lastBeep) { this._lastBeep = sec; this.audio.fuseTick?.(sec); }
      if (t >= FRAG.fuse) {
        // held it too long
        this.cooking = false;
        this.hand.visible = false;
        this.arc.visible = false;
        this.landMarker.visible = false;
        if (!this.infinite) this.count--;
        this.onExplode(ctx.aim.origin.clone(), 'player', null, { inHand: true });
      }
    }

    // --- in the world ---
    for (let i = this.live.length - 1; i >= 0; i--) {
      const g = this.live[i];
      g.fuse -= dt;
      if (g.fuse <= 0) {
        this.scene.remove(g.mesh);
        this.live.splice(i, 1);
        this.onExplode(g.pos.clone(), g.owner, g.ownerRef, {});
        continue;
      }
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / steps;
      for (let s = 0; s < steps; s++) {
        g.vel.y -= GRAV * h;
        let hit = false;
        for (const ax of ['x', 'y', 'z']) {
          const prev = g.pos[ax];
          g.pos[ax] += g.vel[ax] * h;
          if (inside(g.pos, FRAG.r, this.colliders)) {
            g.pos[ax] = prev;
            const speed = Math.abs(g.vel[ax]);
            g.vel[ax] *= ax === 'y' ? -0.32 : -0.42;
            if (ax === 'y') { g.vel.x *= 0.72; g.vel.z *= 0.72; }
            if (speed > 2 && now > g.clinkAt) { hit = true; g.clinkAt = now + 0.08; }
          }
        }
        if (hit) this.audio.clink?.(g.pos.distanceTo(ctx.listener));
      }
      if (g.vel.lengthSq() < 0.05) g.vel.set(0, g.vel.y, 0);
      g.mesh.position.copy(g.pos);
      g.beacon.visible = (g.fuse * (g.fuse < 1 ? 8 : 3)) % 1 > 0.4;
      g.mesh.rotation.x += g.spin.x * dt * Math.min(1, g.vel.length() / 4);
      g.mesh.rotation.y += g.spin.y * dt * Math.min(1, g.vel.length() / 4);
    }
  }
}
