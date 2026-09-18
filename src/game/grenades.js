// Frag grenades: cook -> throw -> per-axis bounce -> fuse -> explode callback. Shared geometry
// and materials across every live grenade — allocating new ones per throw leaked GPU memory.
import * as THREE from 'three';
import { rayBoxes, clearLine } from '../engine/physics.js';
import { audio } from '../engine/audio.js';

export const FRAG = {
  fuse: 3.2, radius: 7.5, damage: 160, throwSpeed: 15, upBoost: 3.0, perLife: 2, max: 4, r: 0.09,
};
const GRAVITY = 20;
const BOUNCE_V = 0.32, BOUNCE_H = 0.42, FRICTION = 0.72;
const ARC_POINTS = 48;

const sharedGeom = new THREE.SphereGeometry(FRAG.r, 10, 8);
const sharedMat = new THREE.MeshStandardMaterial({ color: 0x2f3a2a, roughness: 0.6, metalness: 0.3 });
const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff3322 });
const arcMat = new THREE.LineDashedMaterial({ color: 0xffb02e, dashSize: 0.2, gapSize: 0.15, transparent: true, opacity: 0.8 });
const ringGeom = new THREE.RingGeometry(FRAG.radius - 0.08, FRAG.radius, 32);
const ringMat = new THREE.MeshBasicMaterial({ color: 0xff5533, transparent: true, opacity: 0.35, side: THREE.DoubleSide });

export class Grenades {
  constructor(colliders, onExplode) {
    this.colliders = colliders;
    this.onExplode = onExplode;
    this.root = new THREE.Group();
    this.live = [];
    this._pool = [];

    this.arcLine = new THREE.Line(new THREE.BufferGeometry(), arcMat);
    this.arcLine.visible = false;
    this.landingRing = new THREE.Mesh(ringGeom, ringMat);
    this.landingRing.rotation.x = -Math.PI / 2;
    this.landingRing.visible = false;
    this.root.add(this.arcLine, this.landingRing);
  }

  _getMesh() {
    let mesh = this._pool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(sharedGeom, sharedMat);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), beaconMat);
      beacon.position.y = FRAG.r + 0.01;
      mesh.add(beacon);
      mesh.userData.beacon = beacon;
    }
    this.root.add(mesh);
    return mesh;
  }

  /** Simulates the arc for the preview (and for bots' clearArc test) without side effects. */
  simulateArc(origin, dir, speed, upBoost, steps = ARC_POINTS, dt = 0.05) {
    const pos = origin.clone();
    const vel = dir.clone().normalize().multiplyScalar(speed);
    vel.y += upBoost;
    const points = [pos.clone()];
    for (let i = 0; i < steps; i++) {
      vel.y -= GRAVITY * dt;
      pos.addScaledVector(vel, dt);
      points.push(pos.clone());
      const hit = rayBoxes(this.colliders, points[points.length - 2], vel.clone().normalize(), vel.clone().multiplyScalar(dt).length());
      if (hit || pos.y < 0) break;
    }
    return points;
  }

  /** Used by bots: does a throw along this direction clear the cover between thrower and target? */
  clearArc(origin, dir, speed, upBoost) {
    const points = this.simulateArc(origin, dir, speed, upBoost);
    for (let i = 1; i < points.length; i++) {
      if (!clearLine(this.colliders, points[i - 1], points[i], 0.05)) return false;
    }
    return true;
  }

  showArcPreview(origin, dir, speed, upBoost) {
    const points = this.simulateArc(origin, dir, speed, upBoost);
    this.arcLine.geometry.setFromPoints(points);
    this.arcLine.computeLineDistances();
    this.arcLine.visible = true;
    const land = points[points.length - 1];
    this.landingRing.position.set(land.x, land.y + 0.02, land.z);
    this.landingRing.visible = true;
  }

  hideArcPreview() {
    this.arcLine.visible = false;
    this.landingRing.visible = false;
  }

  countFor(ownerId) { return this.live.filter((g) => g.owner === ownerId).length; }

  throwGrenade(origin, dir, ownerId, cookFrac = 0) {
    const mesh = this._getMesh();
    mesh.position.copy(origin);
    const vel = dir.clone().normalize().multiplyScalar(FRAG.throwSpeed);
    vel.y += FRAG.upBoost;
    const g = {
      mesh, vel, owner: ownerId,
      fuseLeft: FRAG.fuse * (1 - cookFrac),
      lastTick: -1,
      exploded: false,
    };
    this.live.push(g);
    audio.throwNade();
    return g;
  }

  update(dt, now) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const g = this.live[i];
      g.fuseLeft -= dt;
      g.vel.y -= GRAVITY * dt;
      const next = g.mesh.position.clone().addScaledVector(g.vel, dt);

      for (const axis of ['x', 'y', 'z']) {
        const dir = new THREE.Vector3(); dir[axis] = Math.sign(g.vel[axis]) || 1;
        const hit = rayBoxes(this.colliders, g.mesh.position, new THREE.Vector3(
          axis === 'x' ? Math.sign(g.vel.x) : 0,
          axis === 'y' ? Math.sign(g.vel.y) : 0,
          axis === 'z' ? Math.sign(g.vel.z) : 0,
        ), Math.abs(g.vel[axis] * dt) + FRAG.r);
        if (hit && hit.distance < Math.abs(g.vel[axis] * dt) + FRAG.r) {
          if (axis === 'y') g.vel.y = -g.vel.y * BOUNCE_V;
          else g.vel[axis] = -g.vel[axis] * BOUNCE_H;
          g.vel.x *= FRICTION; g.vel.z *= FRICTION;
          audio.clink();
        }
      }
      if (next.y < FRAG.r) { next.y = FRAG.r; if (g.vel.y < 0) { g.vel.y = -g.vel.y * BOUNCE_V; g.vel.x *= FRICTION; g.vel.z *= FRICTION; } }
      g.mesh.position.copy(next);

      const secLeft = Math.ceil(g.fuseLeft);
      if (secLeft !== g.lastTick && secLeft >= 0) { g.lastTick = secLeft; audio.fuseTick(FRAG.fuse - secLeft); }

      if (g.fuseLeft <= 0 && !g.exploded) {
        g.exploded = true;
        this.onExplode(g.mesh.position.clone(), g);
        this.root.remove(g.mesh);
        this._pool.push(g.mesh);
        this.live.splice(i, 1);
      }
    }
  }
}
