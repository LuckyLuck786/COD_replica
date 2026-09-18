// Hostile AI: patrol -> hunt -> engage. Visuals are one vertex-coloured merged mesh with
// invisible hitbox meshes for head/body/limb (Raycaster ignores `visible`), an emissive visor,
// and a blob shadow disc (bots never enter the baked shadow map).
import * as THREE from 'three';
import { moveEntity, clearLine } from '../engine/physics.js';
import { mergeWithColors } from '../engine/merge.js';
import { audio } from '../engine/audio.js';

export const DIFFICULTY = {
  recruit:  { react: 0.62, spread: 0.075, dmg: 0.55, burst: [2, 4],  move: 0.80, hp: 100, nade: 0.10 },
  regular:  { react: 0.40, spread: 0.048, dmg: 0.80, burst: [3, 6],  move: 0.95, hp: 100, nade: 0.18 },
  veteran:  { react: 0.26, spread: 0.032, dmg: 1.00, burst: [4, 8],  move: 1.08, hp: 110, nade: 0.28 },
  hardened: { react: 0.16, spread: 0.021, dmg: 1.25, burst: [5, 10], move: 1.18, hp: 125, nade: 0.40 },
};

const RADIUS = 0.36, HEIGHT = 1.78, EYE = HEIGHT - 0.2, GRAVITY = 23, SPEED = 4.6;
const ENGAGE_DIST = 12;
const FLEE_DIST = 6.5;

function buildBotMesh() {
  const matBody = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
  const parts = [];
  const mk = (w, h, d, x, y, z, color) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color }));
    m.position.set(x, y, z);
    parts.push(m);
    return m;
  };
  mk(0.5, 0.9, 0.3, 0, 1.1, 0, 0x3a4a3a);   // torso
  mk(0.32, 0.32, 0.32, 0, 1.68, 0, 0x2e3a2e); // head
  mk(0.18, 0.7, 0.18, -0.32, 1.1, 0, 0x3a4a3a); // arm L
  mk(0.18, 0.7, 0.18, 0.32, 1.1, 0, 0x3a4a3a);  // arm R
  mk(0.2, 0.85, 0.2, -0.15, 0.42, 0, 0x2a352a); // leg L
  mk(0.2, 0.85, 0.2, 0.15, 0.42, 0, 0x2a352a);  // leg R
  const group = new THREE.Group();
  parts.forEach((p) => group.add(p));
  group.updateMatrixWorld(true);
  const merged = mergeWithColors(null, parts, matBody);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.05), new THREE.MeshStandardMaterial({ color: 0xff4433, emissive: 0xff4433, emissiveIntensity: 1.2 }));
  visor.position.set(0, 1.7, 0.16);

  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;

  const hbHead = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), new THREE.MeshBasicMaterial({ visible: false }));
  hbHead.position.set(0, 1.68, 0);
  const hbBody = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.95, 0.35), new THREE.MeshBasicMaterial({ visible: false }));
  hbBody.position.set(0, 1.1, 0);
  const hbLimbL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.6, 0.2), new THREE.MeshBasicMaterial({ visible: false }));
  hbLimbL.position.set(-0.28, 0.75, 0);
  const hbLimbR = hbLimbL.clone(); hbLimbR.position.x = 0.28;
  hbHead.userData.zone = 'head'; hbBody.userData.zone = 'body';
  hbLimbL.userData.zone = 'limb'; hbLimbR.userData.zone = 'limb';

  const root = new THREE.Group();
  root.add(merged, visor, shadow, hbHead, hbBody, hbLimbL, hbLimbR);
  return { root, hitboxes: [hbHead, hbBody, hbLimbL, hbLimbR], visor };
}

let botIdCounter = 0;

export class Bot {
  constructor(colliders, waypoints, difficultyName) {
    this.id = 'bot' + (botIdCounter++);
    this.colliders = colliders;
    this.waypoints = waypoints;
    this.setDifficulty(difficultyName);
    const built = buildBotMesh();
    this.mesh = built.root;
    this.hitboxes = built.hitboxes;
    for (const hb of this.hitboxes) hb.userData.bot = this;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.hp = this.diff.hp;
    this.dead = false;
    this.state = 'patrol';
    this.wpIndex = 0;
    this.strafeDir = 1;
    this.strafeSwitchAt = 0;
    this.nextFireAt = 0;
    this.burstLeft = 0;
    this.reactionUntil = 0;
    this.lastKnownTargetPos = null;
    this.waitUntil = 0;
    this.throwArcTries = 0;
  }

  setDifficulty(name) { this.diffName = name; this.diff = DIFFICULTY[name] || DIFFICULTY.regular; }

  spawn(pos) {
    // Every timer resets in spawn().
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.hp = this.diff.hp;
    this.dead = false;
    this.state = 'patrol';
    this.wpIndex = Math.floor(Math.random() * Math.max(1, this.waypoints.length));
    this.strafeDir = Math.random() > 0.5 ? 1 : -1;
    this.strafeSwitchAt = 0;
    this.nextFireAt = 0;
    this.burstLeft = 0;
    this.reactionUntil = 0;
    this.lastKnownTargetPos = null;
    this.waitUntil = 0;
    this.throwArcTries = 0;
    this.mesh.visible = true;
    this.mesh.position.copy(this.pos);
  }

  damage(amount, zone, now) {
    if (this.dead) return;
    const mult = zone === 'head' ? 1 : zone === 'limb' ? 1 : 1; // caller applies weapon head/limb mult before calling
    this.hp -= amount;
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.mesh.visible = false; }
  }

  _seesTarget(targetPos) {
    const eye = this.pos.clone(); eye.y += EYE - 1.78 + 1.6;
    return clearLine(this.colliders, eye, targetPos);
  }

  update(dt, now, target, liveGrenades, onThrowGrenade, onFire) {
    if (this.dead) return;

    // flee live grenades within 6.5 m
    let fleeing = false;
    for (const g of liveGrenades) {
      if (g.mesh.position.distanceTo(this.pos) < FLEE_DIST) {
        const away = this.pos.clone().sub(g.mesh.position).normalize();
        this.vel.x = away.x * SPEED * this.diff.move;
        this.vel.z = away.z * SPEED * this.diff.move;
        fleeing = true;
        break;
      }
    }

    const targetPos = target ? target.pos.clone().add(new THREE.Vector3(0, 1.4, 0)) : null;
    const dist = targetPos ? this.pos.distanceTo(targetPos) : Infinity;
    const canSee = targetPos && this._seesTarget(targetPos) && !target.dead;

    if (!fleeing) {
      if (canSee && dist < ENGAGE_DIST * 2.2) {
        if (this.state !== 'engage' && this.state !== 'hunt') this.reactionUntil = now + this.diff.react;
        this.state = dist < ENGAGE_DIST * 1.6 ? 'engage' : 'hunt';
        this.lastKnownTargetPos = targetPos.clone();
      } else if (this.state === 'engage' || this.state === 'hunt') {
        this.state = 'hunt'; // move toward last known position
      }

      if (this.state === 'patrol') this._patrol(dt);
      else if (this.state === 'hunt') this._hunt(dt, now, liveGrenades, onThrowGrenade, target);
      else if (this.state === 'engage') this._engage(dt, now, targetPos, canSee, onFire);
    }

    const r = moveEntity(this.pos, this.vel, dt, this.colliders, RADIUS, HEIGHT, 0.82);
    if (r.onGround) this.vel.y = 0; else this.vel.y -= GRAVITY * dt;

    // simple hop over obstructions: if barely moved while trying, add upward velocity
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
  }

  _faceToward(p) {
    const d = new THREE.Vector3().subVectors(p, this.pos);
    this.yaw = Math.atan2(-d.x, -d.z);
  }

  _moveToward(p, dt) {
    const d = new THREE.Vector3().subVectors(p, this.pos); d.y = 0;
    if (d.lengthSq() < 0.04) { this.vel.x = 0; this.vel.z = 0; return true; }
    d.normalize();
    this.vel.x = d.x * SPEED * this.diff.move;
    this.vel.z = d.z * SPEED * this.diff.move;
    this._faceToward(p);
    return false;
  }

  _patrol(dt) {
    if (!this.waypoints.length) return;
    const wp = this.waypoints[this.wpIndex];
    if (this._moveToward(wp, dt)) this.wpIndex = (this.wpIndex + 1) % this.waypoints.length;
  }

  _hunt(dt, now, liveGrenades, onThrowGrenade, target) {
    if (this.waitUntil > now) { this.vel.x = 0; this.vel.z = 0; return; }
    if (!this.lastKnownTargetPos) { this._patrol(dt); return; }
    const arrived = this._moveToward(this.lastKnownTargetPos, dt);

    // lob a frag at the last known position: try flatter arcs first, raise until clearArc says
    // clear, else wait 2 s and move.
    if (target && Math.random() < this.diff.nade * dt && this.throwArcTries < 4) {
      const dir = new THREE.Vector3().subVectors(this.lastKnownTargetPos, this.pos);
      const flatDist = Math.hypot(dir.x, dir.z);
      if (flatDist > 7 && flatDist < 26) {
        const upBoosts = [1.0, 2.0, 3.5, 5.0];
        const up = upBoosts[this.throwArcTries];
        const flat = dir.clone().setY(0).normalize();
        if (onThrowGrenade(this, flat, up)) { this.throwArcTries = 0; }
        else {
          this.throwArcTries++;
          if (this.throwArcTries >= 4) { this.waitUntil = now + 2; this.throwArcTries = 0; }
        }
      }
    }
    if (arrived) this.lastKnownTargetPos = null;
  }

  _engage(dt, now, targetPos, canSee, onFire) {
    // hold ~12 m, strafe, flip direction every 0.9-2.3 s
    if (now > this.strafeSwitchAt) { this.strafeDir *= -1; this.strafeSwitchAt = now + 0.9 + Math.random() * 1.4; }
    const toTarget = new THREE.Vector3().subVectors(targetPos, this.pos); toTarget.y = 0;
    const dist = toTarget.length();
    const dir = toTarget.clone().normalize();
    const strafeAxis = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(this.strafeDir);
    const radial = dist > ENGAGE_DIST ? 1 : dist < ENGAGE_DIST * 0.7 ? -1 : 0;
    this.vel.x = (strafeAxis.x * 0.8 + dir.x * radial * 0.6) * SPEED * this.diff.move;
    this.vel.z = (strafeAxis.z * 0.8 + dir.z * radial * 0.6) * SPEED * this.diff.move;
    this._faceToward(targetPos);

    if (!canSee || now < this.reactionUntil) return;

    if (this.burstLeft <= 0 && now >= this.nextFireAt) {
      const [lo, hi] = this.diff.burst;
      this.burstLeft = Math.floor(lo + Math.random() * (hi - lo));
      this.nextFireAt = now + 0.5 + Math.random() * 1.2;
    }
    if (this.burstLeft > 0 && now >= this.nextFireAt) {
      this.burstLeft--;
      this.nextFireAt = now + 0.09 + Math.random() * 0.05;
      // hit chance compares aim error against the player's angular size
      const angErr = (Math.random() - 0.5) * this.diff.spread * 2;
      onFire(this, targetPos, angErr, dist);
    }
  }
}

export class BotManager {
  constructor(colliders, waypoints) {
    this.colliders = colliders;
    this.waypoints = waypoints;
    this.bots = [];
  }

  setCount(n, difficultyName, spawnFn) {
    while (this.bots.length < n) {
      const b = new Bot(this.colliders, this.waypoints, difficultyName);
      this.bots.push(b);
    }
    while (this.bots.length > n) {
      const b = this.bots.pop();
      b.mesh.parent && b.mesh.parent.remove(b.mesh);
    }
    for (const b of this.bots) { b.setDifficulty(difficultyName); if (spawnFn) b.spawn(spawnFn()); }
  }
}
