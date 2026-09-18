// "BLACKOUT YARD" — a compact three-lane arena in the Shipment/Nuketown tradition:
// short sightlines, layered cover, one raised catwalk, and a central building with two
// entrances. Everything is axis-aligned so collision stays exact and cheap.
import * as THREE from 'three';
import { mergeByMaterial } from '../engine/merge.js';

export const MAP_SIZE = 62;      // playable square, centred on origin
const H = MAP_SIZE / 2;

// ------------------------------------------------------------------ textures
function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  return t;
}

function noiseFill(ctx, w, h, base, amt, grain = 1) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amt;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  // blotches
  for (let i = 0; i < 26 * grain; i++) {
    const r = 8 + Math.random() * 46;
    const g = ctx.createRadialGradient(Math.random() * w, Math.random() * h, 0, Math.random() * w, Math.random() * h, r);
    g.addColorStop(0, `rgba(0,0,0,${0.03 + Math.random() * 0.07})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
}

export function makeTextures() {
  const concrete = canvasTex(256, 256, (c, w, h) => {
    noiseFill(c, w, h, '#8d8d87', 40);
    c.strokeStyle = 'rgba(0,0,0,.16)'; c.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(0, i * 64); c.lineTo(w, i * 64); c.stroke(); }
  }, [4, 4]);

  const asphalt = canvasTex(256, 256, (c, w, h) => {
    noiseFill(c, w, h, '#4a4b48', 55, 2);
    for (let i = 0; i < 300; i++) {
      c.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
      c.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  }, [16, 16]);

  const metal = canvasTex(128, 128, (c, w, h) => {
    noiseFill(c, w, h, '#6d7a72', 26);
    c.fillStyle = 'rgba(0,0,0,.18)';
    for (let x = 0; x < w; x += 12) c.fillRect(x, 0, 4, h);
    c.fillStyle = 'rgba(255,255,255,.05)';
    for (let x = 6; x < w; x += 12) c.fillRect(x, 0, 2, h);
  }, [2, 1]);

  const wood = canvasTex(128, 128, (c, w, h) => {
    noiseFill(c, w, h, '#96703f', 34);
    c.strokeStyle = 'rgba(60,36,12,.5)'; c.lineWidth = 3;
    for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(0, i * 30 + 8); c.lineTo(w, i * 30 + 12); c.stroke(); }
    c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 5;
    c.strokeRect(3, 3, w - 6, h - 6);
  }, [1, 1]);

  const wall = canvasTex(256, 256, (c, w, h) => {
    noiseFill(c, w, h, '#7b7c74', 34);
    c.fillStyle = 'rgba(0,0,0,.2)';
    for (let y = 0; y < h; y += 32) c.fillRect(0, y, w, 2);
    c.fillStyle = 'rgba(255,255,255,.04)';
    for (let y = 4; y < h; y += 32) c.fillRect(0, y, w, 3);
  }, [6, 3]);

  return { concrete, asphalt, metal, wood, wall };
}

// ------------------------------------------------------------------ builder
export function buildMap(scene) {
  const T = makeTextures();
  const colliders = [];      // THREE.Box3, used by player + bots
  const solids = [];         // meshes used for bullet/LOS raycasts
  const group = new THREE.Group();
  scene.add(group);

  const M = {
    floor:    new THREE.MeshStandardMaterial({ map: T.asphalt, roughness: .96, metalness: .02, color: 0xa8b0ad }),
    concrete: new THREE.MeshStandardMaterial({ map: T.concrete, roughness: .9, metalness: .04 }),
    wall:     new THREE.MeshStandardMaterial({ map: T.wall, roughness: .88, metalness: .05 }),
    metalA:   new THREE.MeshStandardMaterial({ map: T.metal, roughness: .72, metalness: .18, color: 0xc4553f }),
    metalB:   new THREE.MeshStandardMaterial({ map: T.metal, roughness: .72, metalness: .18, color: 0x5a86a5 }),
    metalC:   new THREE.MeshStandardMaterial({ map: T.metal, roughness: .72, metalness: .18, color: 0x7d9468 }),
    wood:     new THREE.MeshStandardMaterial({ map: T.wood, roughness: .95, metalness: 0 }),
    steel:    new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: .55, metalness: .45 }),
    dark:     new THREE.MeshStandardMaterial({ color: 0x3a4043, roughness: .85, metalness: .15 }),
    glow:     new THREE.MeshStandardMaterial({ color: 0xfff0cc, emissive: 0xffcf7a, emissiveIntensity: 2.6, roughness: .4 }),
    hazard:   new THREE.MeshStandardMaterial({ color: 0xffb02e, roughness: .7, metalness: .2 }),
  };

  // Lambert twins of every material: much cheaper per pixel (no specular / reflections).
  // PERFORMANCE and BALANCED use them; QUALITY keeps the full PBR set.
  const LITE = new Map();
  for (const m of Object.values(M)) {
    LITE.set(m, new THREE.MeshLambertMaterial({
      map: m.map || null, color: m.color, emissive: m.emissive, emissiveIntensity: m.emissiveIntensity,
    }));
  }

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);

  /** Axis-aligned box. cx/cz are centre, y is the BOTTOM. */
  function box(w, h, d, cx, y, cz, mat, opts = {}) {
    const m = new THREE.Mesh(boxGeo, mat);
    m.scale.set(w, h, d);
    m.position.set(cx, y + h / 2, cz);
    m.castShadow = opts.cast !== false;
    m.receiveShadow = true;
    group.add(m);
    if (opts.solid !== false) {
      colliders.push(new THREE.Box3(
        new THREE.Vector3(cx - w / 2, y, cz - d / 2),
        new THREE.Vector3(cx + w / 2, y + h, cz + d / 2)));
      solids.push(m);
    }
    return m;
  }

  /** Shipping container: hull + hazard stripe, one solid box. */
  function container(cx, cz, rotated, mat, y = 0) {
    const w = rotated ? 6.1 : 12.2, d = rotated ? 12.2 : 6.1;
    box(w, 5.2, d, cx, y, cz, mat);
    box(w * 1.01, .35, d * 1.01, cx, y + 5.2, cz, M.dark, { solid: false, cast: false });
    return { cx, cz, w, d };
  }

  // ---- ground -------------------------------------------------------------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP_SIZE * 3, MAP_SIZE * 3), M.floor);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  solids.push(ground);
  colliders.push(new THREE.Box3(new THREE.Vector3(-999, -2, -999), new THREE.Vector3(999, 0, 999)));

  // painted lane markings
  const paint = new THREE.MeshStandardMaterial({ color: 0xd8d2a8, roughness: 1 });
  for (const x of [-18, 18]) {
    for (let z = -H + 4; z < H - 4; z += 6) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 3), paint);
      p.rotation.x = -Math.PI / 2; p.position.set(x, 0.02, z);
      p.receiveShadow = true; group.add(p);
    }
  }

  // ---- perimeter walls ----------------------------------------------------
  const WH = 9;
  box(MAP_SIZE, WH, 1.4, 0, 0, -H, M.wall);
  box(MAP_SIZE, WH, 1.4, 0, 0, H, M.wall);
  box(1.4, WH, MAP_SIZE, -H, 0, 0, M.wall);
  box(1.4, WH, MAP_SIZE, H, 0, 0, M.wall);

  // ---- central building (two entrances, roof accessible via ramp) ----------
  const BX = 0, BZ = 0, BW = 20, BD = 14, BH = 6.4;
  const t = 0.9;
  // north wall split by a doorway
  box(7.0, BH, t, BX - 6.5, 0, BZ - BD / 2, M.concrete);
  box(7.0, BH, t, BX + 6.5, 0, BZ - BD / 2, M.concrete);
  box(6.0, 1.6, t, BX, BH - 1.6, BZ - BD / 2, M.concrete);
  // south wall split by a doorway
  box(7.0, BH, t, BX - 6.5, 0, BZ + BD / 2, M.concrete);
  box(7.0, BH, t, BX + 6.5, 0, BZ + BD / 2, M.concrete);
  box(6.0, 1.6, t, BX, BH - 1.6, BZ + BD / 2, M.concrete);
  // east / west walls with window slits
  for (const sx of [-1, 1]) {
    const x = BX + sx * BW / 2;
    box(t, 2.6, BD, x, 0, BZ, M.concrete);
    box(t, 2.2, BD, x, 4.2, BZ, M.concrete);
    box(t, 1.6, 3.2, x, 2.6, BZ - 4.4, M.concrete);
    box(t, 1.6, 3.2, x, 2.6, BZ + 4.4, M.concrete);
  }
  // roof + interior floor detail
  box(BW + 1.2, 0.6, BD + 1.2, BX, BH, BZ, M.concrete);
  box(2.4, 1.1, 2.4, BX - 5, 0, BZ + 3, M.wood);
  box(2.4, 1.1, 2.4, BX + 5, 0, BZ - 3, M.wood);
  // interior pillars
  box(1.0, BH, 1.0, BX - 5.5, 0, BZ, M.concrete);
  box(1.0, BH, 1.0, BX + 5.5, 0, BZ, M.concrete);
  // roof lip (cover for players on top)
  for (const sz of [-1, 1]) box(BW + 1.2, 1.0, 0.5, BX, BH + 0.6, BZ + sz * (BD / 2 + 0.35), M.steel);
  for (const sx of [-1, 1]) box(0.5, 1.0, BD + 1.2, BX + sx * (BW / 2 + 0.35), BH + 0.6, BZ, M.steel);

  // ramp to the roof (stepped so AABB collision stays exact)
  for (let i = 0; i < 9; i++) {
    box(3.4, 0.8 + i * 0.78, 1.5, BX + BW / 2 + 3.2, 0, BZ - 6 + i * 1.5, M.steel);
  }
  box(3.4, 0.4, 3.0, BX + BW / 2 + 3.2, 7.0, BZ + 7.4, M.steel);
  box(6.6, 0.4, 1.6, BX + BW / 2 - 0.2, 7.0, BZ + 8.0, M.steel);

  // ---- containers (three-lane cover) --------------------------------------
  container(-22, -18, false, M.metalA);
  container(22, -18, false, M.metalB);
  container(-22, 18, false, M.metalB);
  container(22, 18, false, M.metalC);
  container(-25, 0, true, M.metalC);
  container(25, 0, true, M.metalA);
  container(-8, -24, false, M.metalB);
  container(9, 24, false, M.metalA);
  // stacked pair — high ground on the west side
  container(-22, -18, false, M.metalC, 5.2);

  // catwalk along the east wall
  for (let i = 0; i < 8; i++) box(3.0, 0.7 + i * 0.62, 1.6, 27.5, 0, -12 + i * 1.6, M.steel);
  box(6.0, 0.5, 22, 27.0, 5.2, 6, M.steel);
  box(0.35, 1.2, 22, 24.2, 5.7, 6, M.dark);

  // ---- crates & barrels ---------------------------------------------------
  const crateSpots = [
    [-12, -8], [-12, -5.6], [-12.1, -8, 2.4], [13, 9], [13, 11.4], [13.1, 9, 2.4],
    [-30, -28], [-27.5, -28], [30, 28], [27.5, 28], [-4, -30], [5, -30], [-6, 31], [17, -27],
    [-30, 12], [-30, 14.4], [31, -10], [0, -20], [2.4, -20],
  ];
  for (const [x, z, y = 0] of crateSpots) box(2.4, 2.4, 2.4, x, y, z, M.wood);

  const barrelGeo = new THREE.CylinderGeometry(0.62, 0.62, 1.7, 14);
  for (const [x, z] of [[-16, 20], [-14.5, 21], [16, -21], [17.4, -20], [8, 14], [-9, -13], [30, 4], [-31, -6]]) {
    const b = new THREE.Mesh(barrelGeo, Math.random() > .5 ? M.hazard : M.metalA);
    b.position.set(x, 0.85, z); b.castShadow = b.receiveShadow = true;
    group.add(b); solids.push(b);
    colliders.push(new THREE.Box3(new THREE.Vector3(x - .62, 0, z - .62), new THREE.Vector3(x + .62, 1.7, z + .62)));
  }

  // sandbag lines
  for (const [x, z, rot] of [[-18, 6, false], [18, -6, false], [0, 26, true], [0, -26, true]]) {
    const w = rot ? 8 : 1.4, d = rot ? 1.4 : 8;
    box(w, 1.25, d, x, 0, z, M.concrete);
  }

  // ---- light fixtures ------------------------------------------------------
  // Emissive panels only. Real point lights cost every pixel on screen, every frame.
  const lampSpots = [[0, 3.2, 0], [-20, 4.4, -20], [20, 4.4, 20], [-20, 4.4, 20], [20, 4.4, -20]];
  for (const [x, y, z] of lampSpots) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.18, 0.7), M.glow);
    panel.position.set(x, y + 2.0, z);
    panel.castShadow = false;
    group.add(panel);
  }

  // ---- skyline silhouettes outside the walls (cheap depth) ----------------
  const sky = new THREE.MeshLambertMaterial({ color: 0x2f3944 });
  const skyMeshes = [];
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2;
    const r = 78 + Math.random() * 46;
    const h = 12 + Math.random() * 40;
    const m = new THREE.Mesh(boxGeo, sky);
    m.scale.set(9 + Math.random() * 14, h, 9 + Math.random() * 14);
    m.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
    group.add(m);
    skyMeshes.push(m);
  }

  // ---- batch everything static: ~250 draw calls become ~12 -----------------
  group.updateMatrixWorld(true);
  const statics = group.children.filter(o => o.isMesh && o !== ground && !skyMeshes.includes(o));
  const merged = mergeByMaterial(group, statics);
  mergeByMaterial(group, skyMeshes, { castShadow: false, receiveShadow: false });
  ground.matrixAutoUpdate = false;
  ground.updateMatrix();
  solids.length = 0;
  solids.push(ground, ...merged);

  // ---- spawns & bot navigation waypoints ----------------------------------
  const spawns = [
    [-27, -27], [27, -27], [-27, 27], [27, 27], [0, -28], [0, 28], [-29, 0], [29, 0],
    [-14, -22], [14, 22], [22, -8], [-22, 8],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z));

  const waypoints = [
    [-27, -27], [0, -27], [27, -27], [27, 0], [27, 27], [0, 27], [-27, 27], [-27, 0],
    [-14, -14], [14, -14], [14, 14], [-14, 14], [0, -18], [0, 18], [-18, 0], [18, 0],
    [-8, -8], [8, 8], [0, 0],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z));

  // swap between the PBR and Lambert sets
  const full = [ground, ...merged];
  const pbr = new Map(full.map(m => [m, m.material]));
  let lite = false;
  function setLite(on) {
    if (on === lite) return;
    lite = on;
    for (const m of full) m.material = on ? (LITE.get(pbr.get(m)) || pbr.get(m)) : pbr.get(m);
  }

  return { group, colliders, solids, spawns, waypoints, materials: M, bounds: H - 2, setLite };
}
