// Static geometry batching — the draw-call killer. Bakes each mesh's world transform (and
// optionally its material colour into a vertex-colour attribute) so a whole model, or a whole
// level's worth of one material, becomes a single draw call.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function normalize(geom, color) {
  const g = geom.index ? geom : geom.toNonIndexed();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.getAttribute('position'));
  if (g.getAttribute('normal')) out.setAttribute('normal', g.getAttribute('normal'));
  else out.computeVertexNormals();
  if (g.getAttribute('uv')) out.setAttribute('uv', g.getAttribute('uv'));
  else out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  if (g.index) out.setIndex(g.index);
  if (color) {
    const n = out.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
    out.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  return out;
}

function bake(mesh, useVertexColors) {
  mesh.updateMatrixWorld(true);
  const geom = mesh.geometry.clone();
  geom.applyMatrix4(mesh.matrixWorld);
  const color = useVertexColors ? (mesh.material.color || new THREE.Color(1, 1, 1)) : null;
  return normalize(geom, color);
}

/**
 * Groups meshes by their material's `.name` (or the material object identity when unnamed),
 * bakes world transforms, and returns one merged mesh per group.
 */
export function mergeByMaterial(root, meshes, opts = {}) {
  const groups = new Map();
  for (const mesh of meshes) {
    const mat = mesh.material;
    const key = mat.name || mat.uuid;
    if (!groups.has(key)) groups.set(key, { mat, geoms: [] });
    groups.get(key).geoms.push(bake(mesh, false));
  }
  const results = [];
  for (const { mat, geoms } of groups.values()) {
    const merged = mergeGeometries(geoms, false);
    const out = new THREE.Mesh(merged, mat);
    out.castShadow = opts.castShadow ?? true;
    out.receiveShadow = opts.receiveShadow ?? true;
    root.add(out);
    results.push(out);
  }
  return results;
}

/**
 * Bakes each mesh's material colour into a vertex-colour attribute, then merges everything into
 * ONE mesh using a single shared material — a whole model (soldier, gun) in one draw call.
 */
export function mergeWithColors(root, meshes, material) {
  const geoms = meshes.map((m) => bake(m, true));
  const merged = mergeGeometries(geoms, false);
  const out = new THREE.Mesh(merged, material);
  out.castShadow = true;
  out.receiveShadow = true;
  if (root) root.add(out);
  return out;
}
