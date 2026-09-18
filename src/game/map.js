// "BLACKOUT YARD" — a 62x62 m three-lane arena in the Shipment/Nuketown tradition.
// Everything is axis-aligned, so collision is exact and cheap. Textures are drawn into
// canvases at load (no asset files); at the end all static geometry is merged into ~12 draw calls.
import * as THREE from 'three';
import { mergeByMaterial } from '../engine/merge.js';

function canvasTexture(draw, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function noiseFill(ctx, size, base, variance) {
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = base + (Math.random() - 0.5) * variance;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, n));
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function makeTextures() {
  const concrete = canvasTexture((ctx, s) => {
    noiseFill(ctx, s, 150, 30);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    for (let i = 0; i < 20; i++) ctx.fillRect(Math.random() * s, Math.random() * s, Math.random() * 30, 2);
  });
  const asphalt = canvasTexture((ctx, s) => {
    noiseFill(ctx, s, 70, 25);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.moveTo(0, s / 2); ctx.lineTo(s, s / 2); ctx.stroke();
  });
  const metal = canvasTexture((ctx, s) => {
    noiseFill(ctx, s, 110, 15);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    for (let y = 0; y < s; y += 12) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke(); }
  });
  const wood = canvasTexture((ctx, s) => {
    noiseFill(ctx, s, 120, 20);
    ctx.strokeStyle = 'rgba(60,40,20,0.3)';
    for (let y = 0; y < s; y += 6) { ctx.beginPath(); ctx.moveTo(0, y + Math.random() * 3); ctx.lineTo(s, y + Math.random() * 3); ctx.stroke(); }
  });
  const wall = canvasTexture((ctx, s) => {
    noiseFill(ctx, s, 170, 20);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < s; y += 32) for (let x = 0; x < s; x += 64) ctx.strokeRect(x + (y % 64 === 0 ? 0 : 32), y, 64, 32);
  });
  return { concrete, asphalt, metal, wood, wall };
}

export class GameMap {
  constructor() {
    this.root = new THREE.Group();
    this.colliders = [];
    this.spawns = [];
    this.waypoints = [];
    this.rangeSpawn = new THREE.Vector3(0, 0, 24);
    this.staticMeshes = [];
    this.merged = [];
    this.mergedLite = [];
    this._buildMaterials();
    this._build();
  }

  _buildMaterials() {
    const T = makeTextures();
    for (const t of Object.values(T)) t.repeat.set(4, 4);
    this.T = T;
    const mk = (map, color, opts = {}) => {
      const { metal, ...rest } = opts;
      return new THREE.MeshStandardMaterial({ map, color, roughness: 0.9, metalness: metal ? 0.6 : 0.05, ...rest });
    };
    this.M = {
      floor: mk(T.concrete, 0x9a9a92, { name: 'floor' }),
      concrete: mk(T.concrete, 0x8d8d86, { name: 'concrete' }),
      wall: mk(T.wall, 0xb8b09a, { name: 'wall' }),
      metalA: mk(T.metal, 0x7a3b2e, { metal: true, name: 'metalA' }),
      metalB: mk(T.metal, 0x2e5a3b, { metal: true, name: 'metalB' }),
      metalC: mk(T.metal, 0x3b4a5a, { metal: true, name: 'metalC' }),
      wood: mk(T.wood, 0x8a6a45, { name: 'wood' }),
      steel: mk(T.metal, 0x555a60, { metal: true, name: 'steel' }),
      dark: mk(T.asphalt, 0x2a2a2a, { name: 'dark' }),
      glow: new THREE.MeshStandardMaterial({ color: 0xffb02e, emissive: 0xffb02e, emissiveIntensity: 1.6, name: 'glow' }),
      hazard: mk(T.metal, 0xd7a52a, { name: 'hazard' }),
    };
    this.MLite = {};
    for (const [k, m] of Object.entries(this.M)) {
      this.MLite[k] = m === this.M.glow
        ? m
        : new THREE.MeshLambertMaterial({ map: m.map, color: m.color, name: k + 'Lite' });
    }
  }

  box(w, h, d, cx, y, cz, mat, opts = {}) {
    const geom = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(cx, y + h / 2, cz);
    if (opts.rotY) mesh.rotation.y = opts.rotY;
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.root.add(mesh);
    this.staticMeshes.push(mesh);
    if (!opts.noCollide) {
      const box = new THREE.Box3().setFromObject(mesh);
      this.colliders.push(box);
    }
    return mesh;
  }

  _build() {
    const M = this.M;
    // floor
    this.box(62, 0.5, 62, 0, -0.25, 0, M.floor);

    // perimeter walls, 9 m tall
    this.box(62, 9, 1, 0, 0, -31, M.wall);
    this.box(62, 9, 1, 0, 0, 31, M.wall);
    this.box(1, 9, 62, -31, 0, 0, M.wall);
    this.box(1, 9, 62, 31, 0, 0, M.wall);

    // central building 20 x 14 x 6.4, doorways N/S, window slits E/W, roof + ramp
    const bw = 20, bh = 6.4, bd = 14;
    this.box(bw, bh, 1, 0, 0, -bd / 2, M.concrete, { noCollide: true }); // north wall (has doorway, drawn as two segments)
    this.box(7, bh, 1, -bw / 2 + 3.5, 0, -bd / 2, M.concrete);
    this.box(7, bh, 1, bw / 2 - 3.5, 0, -bd / 2, M.concrete);
    this.box(7, bh, 1, -bw / 2 + 3.5, 0, bd / 2, M.concrete);
    this.box(7, bh, 1, bw / 2 - 3.5, 0, bd / 2, M.concrete);
    this.box(1, bh, bd, -bw / 2, 0, 0, M.concrete);
    this.box(1, bh, bd, bw / 2, 0, 0, M.concrete);
    // roof with a lip
    this.box(bw + 0.6, 0.4, bd + 0.6, 0, bh, 0, M.concrete);
    // stepped ramp up the east side: 9 steps, 0.78 m rise each -> 7.02 m total (reaches roof ~7.4 with lip)
    const steps = 9, rise = 0.78, run = 1.0;
    for (let i = 0; i < steps; i++) {
      this.box(2.4, rise * (i + 1), run, bw / 2 + 1.5, 0, -bd / 2 + 1 + i * run, M.concrete);
    }

    // 9 shipping containers, including a stacked pair
    const containerSpots = [
      [-24, 0, -20, M.metalA], [-24, 0, -10, M.metalB], [-18, 0, 22, M.metalC],
      [18, 0, -22, M.metalA], [22, 0, -14, M.metalB], [24, 0, 18, M.metalC],
      [10, 0, 24, M.metalA], [-12, 0, 24, M.metalB],
    ];
    for (const [x, y, z, mat] of containerSpots) this.box(6, 2.9, 2.4, x, y, z, mat, { rotY: Math.random() > 0.5 ? 0 : Math.PI / 2 });
    // stacked pair
    this.box(6, 2.9, 2.4, -26, 0, 4, M.metalA);
    this.box(6, 2.9, 2.4, -26, 2.9, 4, M.metalB);

    // catwalk along the east wall
    this.box(2.2, 0.2, 26, 29, 3.2, 0, M.steel);
    this.box(0.15, 3.2, 0.15, 29, 0, 12, M.steel, { noCollide: true });
    this.box(0.15, 3.2, 0.15, 29, 0, -12, M.steel, { noCollide: true });

    // 19 crates, scattered
    const crateCount = 19;
    for (let i = 0; i < crateCount; i++) {
      const x = (Math.random() - 0.5) * 50, z = (Math.random() - 0.5) * 50;
      if (Math.abs(x) < 12 && Math.abs(z) < 9) continue;
      this.box(1.1, 1.1, 1.1, x, 0, z, M.wood, { rotY: Math.random() * Math.PI });
    }

    // 8 barrels (approximated as slim boxes for exact axis-aligned collision)
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2, r = 26;
      this.box(0.8, 1.2, 0.8, Math.cos(ang) * r, 0, Math.sin(ang) * r, M.hazard);
    }

    // 4 sandbag lines
    const sandbagLines = [[-8, -26, 10, 0], [8, -26, 10, 0], [-8, 26, 10, 0], [8, 26, 10, 0]];
    for (const [x, z, len, rot] of sandbagLines) this.box(len, 0.8, 1, x, 0, z, M.wood, { rotY: rot });

    // 5 emissive lamp panels
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      this.box(0.6, 1.6, 0.15, Math.cos(ang) * 29, 3, Math.sin(ang) * 29, M.glow, { noCollide: true });
    }

    // 46 skyline silhouettes outside the walls
    const skyline = [];
    for (let i = 0; i < 46; i++) {
      const ang = (i / 46) * Math.PI * 2;
      const r = 40 + Math.random() * 20;
      const h = 8 + Math.random() * 24;
      const m = this.box(4 + Math.random() * 3, h, 4 + Math.random() * 3, Math.cos(ang) * r, 0, Math.sin(ang) * r, M.dark, { noCollide: true });
      skyline.push(m);
    }
    this._skyline = skyline;

    // 12 spawn points around the perimeter, alternating "sides"
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const r = 24;
      this.spawns.push(new THREE.Vector3(Math.cos(ang) * r, 0.05, Math.sin(ang) * r));
    }

    // 19 bot waypoints, spread across the arena including inside the building
    for (let i = 0; i < 19; i++) {
      const x = (Math.random() - 0.5) * 56, z = (Math.random() - 0.5) * 56;
      this.waypoints.push(new THREE.Vector3(x, 0.05, z));
    }

    this._mergeStatics();
  }

  _mergeStatics() {
    const byMat = (matSet) => {
      const groups = new Map();
      for (const m of this.staticMeshes) {
        if (m.material.wireframe) continue;
        const key = m.material.name;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(m);
      }
      const out = [];
      for (const [key, meshes] of groups) {
        const mat = matSet[key] || meshes[0].material;
        const merged = mergeByMaterial(this.root, meshes, {})[0];
        for (const m of meshes) { this.root.remove(m); }
        out.push(merged);
      }
      return out;
    };
    // Merge once with PBR materials (the default set already assigned).
    this.merged = mergeByMaterial(this.root, this.staticMeshes, {});
    for (const m of this.staticMeshes) this.root.remove(m);
    this._litePairs = this.merged.map((m) => ({ pbr: m.material, lite: this.MLite[m.material.name] || m.material }));
  }

  setLite(on) {
    this.merged.forEach((mesh, i) => {
      mesh.material = on ? this._litePairs[i].lite : this._litePairs[i].pbr;
    });
  }

  randomSpawn(excludeNear = null, minDist = 8) {
    const candidates = this.spawns.filter((s) => !excludeNear || s.distanceTo(excludeNear) > minDist);
    const pool = candidates.length ? candidates : this.spawns;
    return pool[Math.floor(Math.random() * pool.length)].clone();
  }
}
