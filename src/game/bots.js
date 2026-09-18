// Hostile bots: navigation, line of sight, cover, burst fire, hit zones, death and respawn.
import * as THREE from 'three';
import { moveEntity, groundHeight, clearLine } from '../engine/physics.js';
import { mergeWithColors } from '../engine/merge.js';
import { DIFFICULTY, S } from '../settings.js';

const NAMES = ['VIPER', 'KESTREL', 'RONIN', 'HAVOC', 'ZULU-4', 'BRAVO-7', 'NOMAD', 'SHRIKE',
  'CINDER', 'TALON', 'ECHO-2', 'WRAITH'];

const BOT_R = 0.42, BOT_H = 1.78, EYE = 1.58;

// Shared by every bot: materials and geometry are created once.
const SHARED = {
  body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.1 }),
  bodyLite: new THREE.MeshLambertMaterial({ vertexColors: true }),
  visor: new THREE.MeshBasicMaterial({ color: 0xff3a22 }),
  hitbox: new THREE.MeshBasicMaterial({ visible: false }),
  blob: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2 }),
  box: new THREE.BoxGeometry(1, 1, 1),
  disc: new THREE.CircleGeometry(0.55, 16),
};
const C = {
  cloth: new THREE.MeshBasicMaterial({ color: 0x2b3230 }),
  vest: new THREE.MeshBasicMaterial({ color: 0x1f2422 }),
  skin: new THREE.MeshBasicMaterial({ color: 0x8a6a52 }),
  accent: new THREE.MeshBasicMaterial({ color: 0x8c2b22 }),
  gun: new THREE.MeshBasicMaterial({ color: 0x24282a }),
};

function botMesh() {
  const g = new THREE.Group();
  const parts = [];
  const part = (w, h, d, x, y, z, colour) => {
    const b = new THREE.Mesh(SHARED.box, colour);
    b.scale.set(w, h, d); b.position.set(x, y, z);
    g.add(b); parts.push(b);
  };
  // invisible hit zones: raycasts still see them, the renderer skips them
  const hit = [];
  const zone = (w, h, d, x, y, z, name) => {
    const b = new THREE.Mesh(SHARED.box, SHARED.hitbox);
    b.scale.set(w, h, d); b.position.set(x, y, z);
    b.userData.zone = name;
    g.add(b); hit.push(b);
  };

  part(0.52, 0.62, 0.34, 0, 1.16, 0, C.vest);          // torso
  part(0.56, 0.30, 0.38, 0, 1.30, 0, C.accent);        // plate carrier
  part(0.44, 0.34, 0.30, 0, 0.80, 0, C.cloth);         // hips
  part(0.235, 0.26, 0.26, 0, 1.66, 0, C.skin);         // head
  part(0.27, 0.16, 0.29, 0, 1.735, 0, C.vest);         // helmet
  part(0.16, 0.56, 0.16, -0.34, 1.14, 0, C.cloth);     // arms
  part(0.16, 0.56, 0.16, 0.34, 1.14, 0, C.cloth);
  part(0.19, 0.66, 0.19, -0.13, 0.33, 0, C.cloth);     // legs
  part(0.19, 0.66, 0.19, 0.13, 0.33, 0, C.cloth);
  part(0.07, 0.10, 0.62, 0.28, 1.25, -0.36, C.gun);    // rifle
  part(0.04, 0.04, 0.36, 0.28, 1.26, -0.74, C.gun);

  g.updateMatrixWorld(true);
  const body = mergeWithColors(g, parts, SHARED.body);   // the whole soldier: one draw call

  const visor = new THREE.Mesh(SHARED.box, SHARED.visor);
  visor.scale.set(0.20, 0.075, 0.05); visor.position.set(0, 1.68, -0.15);
  g.add(visor);

  zone(0.56, 0.66, 0.38, 0, 1.16, 0, 'body');
  zone(0.44, 0.34, 0.30, 0, 0.80, 0, 'body');
  zone(0.27, 0.34, 0.29, 0, 1.68, 0, 'head');
  zone(0.16, 0.56, 0.16, -0.34, 1.14, 0, 'limb');
  zone(0.16, 0.56, 0.16, 0.34, 1.14, 0, 'limb');
  zone(0.19, 0.66, 0.19, -0.13, 0.33, 0, 'limb');
  zone(0.19, 0.66, 0.19, 0.13, 0.33, 0, 'limb');

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0.28, 1.26, -0.90);
  g.add(muzzle);

  // fake contact shadow: bots never enter the (static) shadow map
  const blob = new THREE.Mesh(SHARED.disc, SHARED.blob);
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  blob.renderOrder = 1;

  return { group: g, hit, muzzle, visor, body, blob };
}

let uid = 0;

export class Bot {
  constructor(world) {
    this.world = world;
    this.id = ++uid;
    this.name = NAMES[(this.id - 1) % NAMES.length];
    const m = botMesh();
    this.group = m.group;
    this.hitMeshes = m.hit;
    this.muzzle = m.muzzle;
    this.visor = m.visor;
    this.blob = m.blob;
    this.body = m.body;
    this.body.material = BotManager.lite ? SHARED.bodyLite : SHARED.body;
    for (const h of this.hitMeshes) h.userData.bot = this;
    world.scene.add(this.group);
    world.scene.add(this.blob);
    this._eye = new THREE.Vector3();
    this._aim = new THREE.Vector3();

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.hp = 100;
    this.dead = false;
    this.respawnAt = 0;
    this.state = 'patrol';
    this.target = null;
    this.losTimer = 0;
    this.reactTimer = 0;
    this.burst = 0;
    this.nextShot = 0;
    this.ammo = 30;
    this.reloadUntil = 0;
    this.strafeDir = Math.random() < .5 ? -1 : 1;
    this.strafeTimer = 0;
    this.wp = null;
    this.repathAt = 0;
    this.deathTime = 0;
    this.grounded = false;
    this.jumpCooldown = 0;
    this.nadeAt = 3 + Math.random() * 8;
  }

  get eye() { return this._eye.set(this.pos.x, this.pos.y + EYE, this.pos.z).clone(); }

  spawn(point) {
    this.pos.copy(point);
    this.pos.y = groundHeight(point.x, point.z, this.world.colliders) + 0.02;
    this.vel.set(0, 0, 0);
    this.hp = DIFFICULTY[S.difficulty].hp;
    this.dead = false;
    this.state = 'patrol';
    this.ammo = 30;
    this.group.visible = true;
    this.group.rotation.set(0, 0, 0);
    this.group.position.copy(this.pos);
    this.wp = null;
    this.losTimer = 0; this.reactTimer = 0; this.burst = 0;
    this.lastSeen = null;
    // timers are in match time, which restarts at 0 with every match
    this.nextShot = 0; this.reloadUntil = 0; this.repathAt = 0; this.nadeAt = 0;
    this.visor.visible = true;
    this.blob.visible = true;
  }

  die(now) {
    this.dead = true;
    this.deathTime = now;
    this.respawnAt = now + 3.4;
    this.visor.visible = false;
    this.blob.visible = false;
  }

  damage(amount, now) {
    if (this.dead) return false;
    this.hp -= amount;
    if (this.hp <= 0) { this.die(now); return true; }
    return false;
  }

  /** True if this bot can see the point (world geometry only). */
  canSee(point) {
    this._eye.set(this.pos.x, this.pos.y + EYE, this.pos.z);
    return clearLine(this.world.colliders, this._eye, point);
  }

  update(dt, now, player, api) {
    const D = DIFFICULTY[S.difficulty];

    if (this.dead) {
      // fall over, then sink
      const t = now - this.deathTime;
      this.group.rotation.z = Math.min(Math.PI / 2, t * 4.2);
      this.group.position.y = this.pos.y - Math.max(0, (t - 2.2)) * 0.9;
      return;
    }

    // ---------------- perception ----------------
    const toP = new THREE.Vector3().subVectors(player.pos, this.pos);
    const dist = toP.length();
    const seesPlayer = !player.dead && dist < 60 && this.canSee(this._aim.set(player.pos.x, player.pos.y + 1.3, player.pos.z));

    if (seesPlayer) {
      this.losTimer = Math.min(this.losTimer + dt, 3);
      this.lastSeen = player.pos.clone();
      if (this.state !== 'engage') { this.state = 'engage'; this.reactTimer = D.react * (0.75 + Math.random() * 0.5); }
    } else {
      this.losTimer = Math.max(0, this.losTimer - dt * 0.7);
      if (this.state === 'engage' && this.losTimer <= 0) this.state = 'hunt';
    }

    // ---------------- movement ----------------
    const speed = 4.4 * D.move;
    let desired = new THREE.Vector3();

    if (this.state === 'engage') {
      const flat = new THREE.Vector3(toP.x, 0, toP.z);
      const d = flat.length() || 1;
      flat.divideScalar(d);
      // hold a fighting distance, strafe for a moving target
      const ideal = 12;
      const push = d > ideal + 4 ? 1 : (d < ideal - 5 ? -1 : 0);
      const side = new THREE.Vector3(-flat.z, 0, flat.x).multiplyScalar(this.strafeDir);
      desired.addScaledVector(flat, push).addScaledVector(side, 0.85);
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) { this.strafeDir *= -1; this.strafeTimer = 0.9 + Math.random() * 1.4; }
      // the model faces its local -Z, so aim that axis at the target
      this.yaw = Math.atan2(-toP.x, -toP.z);
    } else {
      // patrol / hunt toward a waypoint
      if (!this.wp || now > this.repathAt || this.pos.distanceTo(this.wp) < 2.2) {
        const pool = this.world.waypoints;
        this.wp = (this.state === 'hunt' && this.lastSeen && Math.random() < 0.7)
          ? this.lastSeen.clone()
          : pool[Math.floor(Math.random() * pool.length)].clone();
        this.repathAt = now + 4 + Math.random() * 3;
      }
      const flat = new THREE.Vector3(this.wp.x - this.pos.x, 0, this.wp.z - this.pos.z);
      if (flat.lengthSq() > 0.01) { flat.normalize(); desired.copy(flat); this.yaw = Math.atan2(-flat.x, -flat.z); }
    }

    // a live grenade nearby beats everything else: run from it
    const threat = api.grenadeThreat(this.pos);
    if (threat) {
      desired.set(this.pos.x - threat.x, 0, this.pos.z - threat.z);
      if (desired.lengthSq() < 0.01) desired.set(this.strafeDir, 0, 0);
      desired.normalize();
    }

    // hunting someone who ducked out of sight: flush them out with a frag
    if (S.botGrenades && this.state === 'hunt' && this.lastSeen && now > this.nadeAt) {
      const d = this.pos.distanceTo(this.lastSeen);
      if (d > 7 && d < 26 && Math.random() < D.nade * dt * 3) {
        this.nadeAt = api.botGrenade(this, this.lastSeen)
          ? now + 12 + Math.random() * 8
          : now + 2;               // no clear arc from here; try again after moving
      }
    }

    // obstacle avoidance: probe ahead, slide around
    if (desired.lengthSq() > 0.001) {
      desired.normalize();
      const probe = new THREE.Vector3(this.pos.x + desired.x * 1.5, this.pos.y + 0.4, this.pos.z + desired.z * 1.5);
      if (api.blockedAt(probe)) {
        const side = new THREE.Vector3(-desired.z, 0, desired.x).multiplyScalar(this.strafeDir);
        desired.addScaledVector(side, 1.6).normalize();
      }
    }

    this.vel.x = desired.x * speed;
    this.vel.z = desired.z * speed;
    this.vel.y -= 22 * dt;

    const res = moveEntity(this.pos, this.vel, dt, this.world.colliders, BOT_R, BOT_H, 0.95);
    this.grounded = res.grounded;
    if (res.grounded && this.vel.y < 0) this.vel.y = 0;
    // hop over a stubborn obstruction
    this.jumpCooldown -= dt;
    if (res.hitWall && this.grounded && this.jumpCooldown <= 0) { this.vel.y = 7.2; this.jumpCooldown = 1.2; }

    // keep inside the arena
    const b = this.world.bounds;
    this.pos.x = Math.max(-b, Math.min(b, this.pos.x));
    this.pos.z = Math.max(-b, Math.min(b, this.pos.z));
    if (this.pos.y < -8) this.spawn(api.pickSpawn());

    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    this.blob.position.set(this.pos.x, this.pos.y + 0.02, this.pos.z);

    // ---------------- shooting ----------------
    if (now < this.reloadUntil) return;
    if (this.ammo <= 0) { this.reloadUntil = now + 2.2; this.ammo = 30; return; }

    if (this.state === 'engage' && seesPlayer && dist < 48) {
      this.reactTimer -= dt;
      if (this.reactTimer <= 0 && now >= this.nextShot) {
        if (this.burst <= 0) {
          this.burst = D.burst[0] + Math.floor(Math.random() * (D.burst[1] - D.burst[0] + 1));
          this.nextShot = now + 0.10;
          return;
        }
        this.burst--;
        this.ammo--;
        this.nextShot = now + 0.095 + Math.random() * 0.02;
        if (this.burst <= 0) this.nextShot = now + 0.45 + Math.random() * 0.65;
        api.botShoot(this, player, D, dist);
      }
    }
  }
}

export class BotManager {
  constructor(world) {
    this.world = world;
    this.bots = [];
  }

  setCount(n, api) {
    while (this.bots.length < n) {
      const b = new Bot(this.world);
      b.spawn(api.pickSpawn());
      this.bots.push(b);
    }
    while (this.bots.length > n) {
      const b = this.bots.pop();
      this.world.scene.remove(b.group);
      this.world.scene.remove(b.blob);
    }
  }

  setLite(on) {
    BotManager.lite = on;
    for (const b of this.bots) b.body.material = on ? SHARED.bodyLite : SHARED.body;
  }

  get hitMeshes() {
    const out = [];
    for (const b of this.bots) if (!b.dead) out.push(...b.hitMeshes);
    return out;
  }

  update(dt, now, player, api) {
    for (const b of this.bots) {
      if (b.dead && now >= b.respawnAt) { b.spawn(api.pickSpawn()); continue; }
      b.update(dt, now, player, api);
    }
  }

  reset(api) {
    for (const b of this.bots) { b.spawn(api.pickSpawn()); b.nadeAt = 6 + Math.random() * 10; }
  }
}

BotManager.lite = false;

export const BOT_DIMS = { r: BOT_R, h: BOT_H, eye: EYE };
