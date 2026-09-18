// Pooled bullet tracers, impact sparks, bullet holes, blood, explosions and smoke.
// Everything is allocated once up front and reused, so combat never creates garbage
// or new GPU objects, and the number of lights never changes (that forces shader recompiles).
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.onFlash = () => {};      // (pos, intensity) — drives the one shared dynamic light

    // ---- tracers ----
    const tgeo = new THREE.BoxGeometry(0.022, 0.022, 1);
    this.tracers = [];
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(tgeo, new THREE.MeshBasicMaterial({
        color: 0xffd98a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      m.visible = false; m.frustumCulled = false;
      scene.add(m);
      this.tracers.push({ mesh: m, until: 0 });
    }
    this.tIdx = 0;

    // ---- sparks / blood (one point cloud) ----
    this.maxP = 320;
    const pgeo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(this.maxP * 3).fill(-9999);
    this.pCol = new Float32Array(this.maxP * 3);
    pgeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    pgeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.points = new THREE.Points(pgeo, new THREE.PointsMaterial({
      size: 0.09, vertexColors: true, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.parts = [];
    for (let i = 0; i < this.maxP; i++) this.parts.push({ alive: false, v: new THREE.Vector3(), p: new THREE.Vector3(), life: 0, g: 1 });
    this.pIdx = 0;
    this.liveParts = 0;

    // ---- bullet holes & scorch marks: ONE instanced draw call ----
    this.maxHoles = 64;
    this.holes = new THREE.InstancedMesh(new THREE.CircleGeometry(0.055, 8), new THREE.MeshBasicMaterial({
      color: 0x111111, transparent: true, opacity: 0.8, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4,
    }), this.maxHoles);
    for (let i = 0; i < this.maxHoles; i++) this.holes.setMatrixAt(i, HIDDEN);
    this.holes.frustumCulled = false;
    scene.add(this.holes);
    this.hIdx = 0;

    // ---- explosions (no lights of their own) ----
    const sphere = new THREE.SphereGeometry(1, 12, 8);
    const ring = new THREE.RingGeometry(0.9, 1, 32);
    this.booms = [];
    for (let i = 0; i < 6; i++) {
      const core = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({
        color: 0xffc46b, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      const shell = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({
        color: 0xff6a1f, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      const wave = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({
        color: 0xffe2b0, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
      }));
      wave.rotation.x = -Math.PI / 2;
      for (const o of [core, shell, wave]) { o.visible = false; o.frustumCulled = false; scene.add(o); }
      this.booms.push({ core, shell, wave, t: 99, scale: 1 });
    }
    this.bIdx = 0;

    // ---- smoke (normal blending, so it darkens instead of glowing) ----
    this.maxS = 60;
    const sgeo = new THREE.BufferGeometry();
    this.sPos = new Float32Array(this.maxS * 3).fill(-9999);
    sgeo.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3));
    // soft round puff (points are square without a texture)
    const pc = document.createElement('canvas');
    pc.width = pc.height = 32;
    const px = pc.getContext('2d');
    const grd = px.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    px.fillStyle = grd; px.fillRect(0, 0, 32, 32);
    this.smokePts = new THREE.Points(sgeo, new THREE.PointsMaterial({
      size: 1.8, color: 0x4a4642, map: new THREE.CanvasTexture(pc), transparent: true, opacity: 0.55,
      depthWrite: false, sizeAttenuation: true,
    }));
    this.smokePts.frustumCulled = false;
    scene.add(this.smokePts);
    this.smoke = [];
    for (let i = 0; i < this.maxS; i++) this.smoke.push({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0 });
    this.sIdx = 0;
    this.liveSmoke = 0;
  }

  /** All pooled objects, so the renderer can compile their shaders before the first fight. */
  warmupObjects() {
    return [...this.tracers.map(t => t.mesh), ...this.booms.flatMap(b => [b.core, b.shell, b.wave])];
  }

  _decal(pos, normal, size) {
    _p.copy(pos).addScaledVector(normal, 0.012);
    _q.setFromUnitVectors(_z, normal);
    _s.setScalar(size);
    _m.compose(_p, _q, _s);
    this.holes.setMatrixAt(this.hIdx, _m);
    this.hIdx = (this.hIdx + 1) % this.maxHoles;
    this.holes.instanceMatrix.needsUpdate = true;
  }

  /** Big frag / airstrike blast at a world position. */
  explosion(pos, scale = 1) {
    const b = this.booms[this.bIdx = (this.bIdx + 1) % this.booms.length];
    b.t = 0; b.scale = scale;
    b.core.position.copy(pos); b.shell.position.copy(pos);
    b.wave.position.set(pos.x, pos.y + 0.05, pos.z);
    for (const o of [b.core, b.shell, b.wave]) o.visible = true;
    this.onFlash(pos, 70 * scale);

    for (let i = 0; i < 32; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5)
        .normalize().multiplyScalar((6 + Math.random() * 12) * scale);
      this._spawnParticle(pos, v, Math.random() < 0.5 ? [1, 0.75, 0.3] : [1, 0.45, 0.12], 0.4 + Math.random() * 0.4, 1.1);
    }
    for (let i = 0; i < 10; i++) {
      const s = this.smoke[this.sIdx = (this.sIdx + 1) % this.maxS];
      if (!s.alive) this.liveSmoke++;
      s.alive = true;
      s.p.set(pos.x + (Math.random() - 0.5) * 1.5 * scale, pos.y + Math.random() * 0.8, pos.z + (Math.random() - 0.5) * 1.5 * scale);
      s.v.set((Math.random() - 0.5) * 2.2, 0.8 + Math.random() * 1.8, (Math.random() - 0.5) * 2.2);
      s.life = 1.8 + Math.random() * 1.2;
    }
    this._decal(_p.set(pos.x, Math.max(0.015, pos.y - 0.2), pos.z), UP, 26 * scale);
  }

  tracer(from, to) {
    const t = this.tracers[this.tIdx = (this.tIdx + 1) % this.tracers.length];
    const len = from.distanceTo(to);
    if (len < 0.05) return;
    t.mesh.visible = true;
    t.mesh.material.opacity = 0.85;
    t.mesh.position.lerpVectors(from, to, 0.5);
    t.mesh.scale.set(1, 1, len);
    t.mesh.lookAt(to);
    t.until = this.time + 0.055;
  }

  _spawnParticle(pos, vel, color, life, gravity = 1) {
    const p = this.parts[this.pIdx = (this.pIdx + 1) % this.maxP];
    if (!p.alive) this.liveParts++;
    p.alive = true; p.p.copy(pos); p.v.copy(vel); p.life = life; p.g = gravity;
    const i = this.pIdx * 3;
    this.pCol[i] = color[0]; this.pCol[i + 1] = color[1]; this.pCol[i + 2] = color[2];
  }

  impact(point, normal, kind = 'world') {
    const n = normal || UP;
    if (kind === 'blood') {
      for (let i = 0; i < 7; i++) {
        this._spawnParticle(point,
          _p.set((Math.random() - .5) * 3.2, Math.random() * 2.4, (Math.random() - .5) * 3.2),
          [0.75, 0.06, 0.06], 0.4 + Math.random() * 0.2, 1.6);
      }
      return;
    }
    for (let i = 0; i < 6; i++) {
      _p.copy(n).multiplyScalar(1.6 + Math.random() * 2.2);
      _p.x += (Math.random() - .5) * 2.6; _p.y += Math.random() * 1.8; _p.z += (Math.random() - .5) * 2.6;
      this._spawnParticle(point, _p, [1.0, 0.72, 0.28], 0.2 + Math.random() * 0.2, 1.3);
    }
    this._decal(point, n, 0.7 + Math.random() * 0.6);
  }

  update(dt) {
    this.time += dt;
    for (const t of this.tracers) {
      if (!t.mesh.visible) continue;
      if (this.time > t.until) { t.mesh.visible = false; continue; }
      t.mesh.material.opacity *= 0.72;
    }

    // skip the particle buffers entirely when nothing is alive
    if (this.liveParts > 0) {
      for (let i = 0; i < this.maxP; i++) {
        const p = this.parts[i];
        if (!p.alive) continue;
        const j = i * 3;
        p.life -= dt;
        if (p.life <= 0) { p.alive = false; this.liveParts--; this.pPos[j + 1] = -9999; continue; }
        p.v.y -= 9.8 * p.g * dt;
        p.v.multiplyScalar(1 - 1.6 * dt);
        p.p.addScaledVector(p.v, dt);
        this.pPos[j] = p.p.x; this.pPos[j + 1] = p.p.y; this.pPos[j + 2] = p.p.z;
      }
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.color.needsUpdate = true;
    }

    for (const b of this.booms) {
      if (b.t > 1.2) continue;
      b.t += dt;
      const t = b.t, k = b.scale;
      if (t > 1.2) { b.core.visible = b.shell.visible = b.wave.visible = false; continue; }
      const grow = 1 - Math.pow(1 - Math.min(t / 0.35, 1), 3);
      b.core.scale.setScalar((0.4 + grow * 2.2) * k);
      b.core.material.opacity = Math.max(0, 1 - t / 0.3);
      b.shell.scale.setScalar((0.6 + grow * 3.6) * k);
      b.shell.material.opacity = Math.max(0, 0.75 - t / 0.55);
      if (b.shell.material.opacity <= 0) b.shell.visible = false;
      if (b.core.material.opacity <= 0) b.core.visible = false;
      b.wave.scale.setScalar((1 + t * 22) * k);
      b.wave.material.opacity = Math.max(0, 0.6 - t * 1.6);
      if (b.wave.material.opacity <= 0) b.wave.visible = false;
    }

    if (this.liveSmoke > 0) {
      for (let i = 0; i < this.maxS; i++) {
        const s = this.smoke[i];
        if (!s.alive) continue;
        const j = i * 3;
        s.life -= dt;
        if (s.life <= 0) { s.alive = false; this.liveSmoke--; this.sPos[j + 1] = -9999; continue; }
        s.v.multiplyScalar(1 - 1.2 * dt);
        s.p.addScaledVector(s.v, dt);
        this.sPos[j] = s.p.x; this.sPos[j + 1] = s.p.y; this.sPos[j + 2] = s.p.z;
      }
      this.smokePts.geometry.attributes.position.needsUpdate = true;
    }
  }
}
