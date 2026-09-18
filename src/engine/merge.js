// Static-geometry batching. Every separate mesh is a separate draw call, so objects that never
// move independently are baked into as few meshes as possible.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();

/** Geometry of `mesh`, transformed into `root`'s space, reduced to position/normal/uv. */
function bakedGeometry(mesh, root) {
  mesh.updateWorldMatrix(true, false);
  root.updateWorldMatrix(true, false);
  _m.copy(root.matrixWorld).invert().multiply(mesh.matrixWorld);
  let g = mesh.geometry.clone();
  if (!g.index) g = g.toNonIndexed().clone();          // keep everything the same kind
  for (const name of Object.keys(g.attributes)) {
    if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  }
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  if (!g.index) {
    const idx = new Uint32Array(g.attributes.position.count).map((_, i) => i);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  g.applyMatrix4(_m);
  return g;
}

/**
 * Replace the given meshes (all children of `root`) with one mesh per material.
 * Returns the new meshes, already added to `root`.
 */
export function mergeByMaterial(root, meshes, { castShadow = true, receiveShadow = true } = {}) {
  const byMat = new Map();
  for (const m of meshes) {
    if (!byMat.has(m.material)) byMat.set(m.material, []);
    byMat.get(m.material).push(bakedGeometry(m, root));
    m.parent?.remove(m);
  }
  const out = [];
  for (const [mat, geos] of byMat) {
    const merged = new THREE.Mesh(mergeGeometries(geos, false), mat);
    merged.castShadow = castShadow;
    merged.receiveShadow = receiveShadow;
    merged.matrixAutoUpdate = false;
    root.add(merged);
    out.push(merged);
    for (const g of geos) g.dispose();
  }
  return out;
}

/**
 * Bake coloured parts into ONE mesh using vertex colours (one draw call for a whole model).
 * Each part's material colour becomes its vertex colour.
 */
export function mergeWithColors(root, meshes, material) {
  const geos = [];
  const col = new THREE.Color();
  for (const m of meshes) {
    const g = bakedGeometry(m, root);
    col.copy(m.material.color);
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    geos.push(g);
    m.parent?.remove(m);
  }
  const mesh = new THREE.Mesh(mergeGeometries(geos, false), material);
  for (const g of geos) g.dispose();
  root.add(mesh);
  return mesh;
}
