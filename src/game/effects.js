// All pooled, allocated once at load: tracers, a shared spark/blood point cloud, instanced
// decals, pooled explosions, and a smoke point cloud. No lights of their own — onFlash() drives
// the game's single shared dynamic light instead (Performance Rule 2).
import * as THREE from 'three';

const TRACER_COUNT = 16;
const PARTICLE_COUNT = 320;
const DECAL_COUNT = 64;
const EXPLOSION_COUNT = 6;
const SMOKE_COUNT = 60;

function softDot(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

class Effects {
  constructor() {
    this.root = new THREE.Group();
    this.onFlash = null;
    this._buildTracers();
    this._buildParticles();
    this._buildDecals();
    this._buildExplosions();
    this._buildSmoke();
  }

  _buildTracers() {
    this.tracers = [];
    const mat = new THREE.LineBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.9 });
    for (let i = 0; i < TRACER_COUNT; i++) {
      const geom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geom, mat.clone());
      line.visible = false;
      line.frustumCulled = false;
      this.root.add(line);
      this.tracers.push({ line, t: 0, life: 0.06 });
    }
  }

  spawnTracer(from, to) {
    const slot = this.tracers.find((t) => !t.line.visible) || this.tracers[0];
    const pos = slot.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    slot.line.visible = true;
    slot.t = slot.life;
  }

  _buildParticles() {
    const geom = new THREE.BufferGeometry();
    const pos = new Float32Array(PARTICLE_COUNT * 3);
    const col = new Float32Array(PARTICLE_COUNT * 3);
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 0.05, vertexColors: true, map: softDot(), transparent: true, depthWrite: false });
    this.particles = new THREE.Points(geom, mat);
    this.particles.frustumCulled = false;
    this.root.add(this.particles);
    this._pv = []; // velocity + life per particle
    for (let i = 0; i < PARTICLE_COUNT; i++) this._pv.push({ vx: 0, vy: 0, vz: 0, life: 0 });
    this._pCursor = 0;
  }

  spawnBurst(pos, color, count = 12, speed = 4, spread = true) {
    const c = new THREE.Color(color);
    const posAttr = this.particles.geometry.attributes.position;
    const colAttr = this.particles.geometry.attributes.color;
    for (let i = 0; i < count; i++) {
      const idx = this._pCursor;
      this._pCursor = (this._pCursor + 1) % PARTICLE_COUNT;
      const dir = new THREE.Vector3((Math.random() - 0.5), Math.random() * (spread ? 1 : 0.3), (Math.random() - 0.5)).normalize();
      this._pv[idx] = { vx: dir.x * speed * Math.random(), vy: dir.y * speed * Math.random() + 1, vz: dir.z * speed * Math.random(), life: 0.4 + Math.random() * 0.4 };
      posAttr.setXYZ(idx, pos.x, pos.y, pos.z);
      colAttr.setXYZ(idx, c.r, c.g, c.b);
    }
    posAttr.needsUpdate = true; colAttr.needsUpdate = true;
  }

  _buildDecals() {
    const geom = new THREE.CircleGeometry(0.08, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.decals = new THREE.InstancedMesh(geom, mat, DECAL_COUNT);
    this.decals.count = DECAL_COUNT;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < DECAL_COUNT; i++) this.decals.setMatrixAt(i, zero);
    this.decals.instanceMatrix.needsUpdate = true;
    this.root.add(this.decals);
    this._decalCursor = 0;
  }

  spawnDecal(pos, normal) {
    const m = new THREE.Matrix4();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
    m.compose(pos.clone().addScaledVector(normal, 0.01), quat, new THREE.Vector3(1, 1, 1));
    this.decals.setMatrixAt(this._decalCursor, m);
    this.decals.instanceMatrix.needsUpdate = true;
    this._decalCursor = (this._decalCursor + 1) % DECAL_COUNT;
  }

  _buildExplosions() {
    this.explosions = [];
    for (let i = 0; i < EXPLOSION_COUNT; i++) {
      const core = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0 }));
      const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff5522, transparent: true, opacity: 0, side: THREE.BackSide }));
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 1, 24), new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      const group = new THREE.Group();
      group.add(core, shell, ring);
      group.visible = false;
      this.root.add(group);
      this.explosions.push({ group, core, shell, ring, t: 0, life: 0.6 });
    }
  }

  spawnExplosion(pos) {
    const slot = this.explosions.find((e) => !e.group.visible) || this.explosions[0];
    slot.group.position.copy(pos);
    slot.group.visible = true;
    slot.t = 0;
    if (this.onFlash) this.onFlash(pos, 3);
  }

  _buildSmoke() {
    const geom = new THREE.BufferGeometry();
    const pos = new Float32Array(SMOKE_COUNT * 3);
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ size: 0.8, color: 0x888888, map: softDot(), transparent: true, opacity: 0.35, depthWrite: false });
    this.smoke = new THREE.Points(geom, mat);
    this.smoke.frustumCulled = false;
    this.root.add(this.smoke);
    this._sv = [];
    for (let i = 0; i < SMOKE_COUNT; i++) this._sv.push({ vx: 0, vy: 0, vz: 0, life: 0 });
    this._sCursor = 0;
  }

  spawnSmoke(pos, count = 8) {
    const posAttr = this.smoke.geometry.attributes.position;
    for (let i = 0; i < count; i++) {
      const idx = this._sCursor;
      this._sCursor = (this._sCursor + 1) % SMOKE_COUNT;
      this._sv[idx] = { vx: (Math.random() - 0.5) * 0.5, vy: 0.4 + Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.5, life: 1.5 + Math.random() };
      posAttr.setXYZ(idx, pos.x, pos.y, pos.z);
    }
    posAttr.needsUpdate = true;
  }

  warmupObjects() {
    // Expose everything, temporarily visible, so the renderer can compile every shader at load
    // (Performance Rule 6 / Bug 14 — a mid-fight light-count/material change forces a recompile).
    const flags = [];
    for (const t of this.tracers) { flags.push([t.line, t.line.visible]); t.line.visible = true; }
    for (const e of this.explosions) { flags.push([e.group, e.group.visible]); e.group.visible = true; e.core.material.opacity = 0.01; e.shell.material.opacity = 0.01; e.ring.material.opacity = 0.01; }
    flags.push([this.particles, this.particles.visible]);
    flags.push([this.decals, this.decals.visible]);
    flags.push([this.smoke, this.smoke.visible]);
    return () => { for (const [obj, v] of flags) obj.visible = v; };
  }

  update(dt) {
    for (const t of this.tracers) {
      if (!t.line.visible) continue;
      t.t -= dt;
      t.line.material.opacity = Math.max(0, t.t / t.life) * 0.9;
      if (t.t <= 0) t.line.visible = false;
    }

    const posAttr = this.particles.geometry.attributes.position;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = this._pv[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vy -= 9 * dt;
      posAttr.array[i * 3] += p.vx * dt;
      posAttr.array[i * 3 + 1] += p.vy * dt;
      posAttr.array[i * 3 + 2] += p.vz * dt;
      if (p.life <= 0) posAttr.setY(i, -1000);
    }
    posAttr.needsUpdate = true;

    for (const e of this.explosions) {
      if (!e.group.visible) continue;
      e.t += dt;
      const k = e.t / e.life;
      if (k >= 1) { e.group.visible = false; continue; }
      e.core.scale.setScalar(1 + k * 4);
      e.core.material.opacity = Math.max(0, 1 - k * 2);
      e.shell.scale.setScalar(2 + k * 8);
      e.shell.material.opacity = Math.max(0, 0.7 - k);
      e.ring.scale.setScalar(1 + k * 10);
      e.ring.material.opacity = Math.max(0, 0.5 - k * 0.5);
    }

    const smokeAttr = this.smoke.geometry.attributes.position;
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const p = this._sv[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      smokeAttr.array[i * 3] += p.vx * dt;
      smokeAttr.array[i * 3 + 1] += p.vy * dt;
      smokeAttr.array[i * 3 + 2] += p.vz * dt;
      if (p.life <= 0) smokeAttr.setY(i, -1000);
    }
    smokeAttr.needsUpdate = true;
  }
}

export const fx = new Effects();
