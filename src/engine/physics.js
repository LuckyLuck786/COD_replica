// Axis-aligned swept collision. Entities are boxes (radius r, height h) with pos = feet centre.
import * as THREE from 'three';

const tmp = new THREE.Box3();

// Small inset so a box resting exactly on a surface does not count as intersecting it
// (Box3.intersectsBox treats touching faces as an intersection).
const EPS = 0.03;

function entBox(pos, r, h, out = tmp) {
  out.min.set(pos.x - r, pos.y + EPS, pos.z - r);
  out.max.set(pos.x + r, pos.y + h - EPS, pos.z + r);
  return out;
}

function overlapsAny(pos, r, h, colliders) {
  const b = entBox(pos, r, h);
  for (const c of colliders) if (c.intersectsBox(b)) return c;
  return null;
}

const _list = [];
function overlapsAll(pos, r, h, colliders) {
  const b = entBox(pos, r, h);
  _list.length = 0;
  for (const c of colliders) if (c.intersectsBox(b)) _list.push(c);
  return _list;
}

/**
 * Try to resolve a horizontal move that ended up inside geometry.
 * Returns true if the entity can stay at the new position (possibly stepped up).
 * The step target is the HIGHEST surface it is intersecting — using any other
 * collider (the ground plane, say) would make stairs unclimbable.
 */
function tryStep(pos, r, h, colliders, stepHeight) {
  const hits = overlapsAll(pos, r, h, colliders);
  if (hits.length === 0) return true;
  let top = -Infinity;
  for (const c of hits) if (c.max.y > top) top = c.max.y;
  const rise = top - pos.y;
  if (rise <= 0 || rise > stepHeight) return false;
  const prevY = pos.y;
  pos.y = top + 0.002;
  if (!overlapsAny(pos, r, h, colliders)) return 'stepped';
  pos.y = prevY;
  return false;
}

/**
 * Move an entity, resolving collisions per axis. Mutates pos and vel.
 * Returns { grounded, hitWall, stepped }.
 */
export function moveEntity(pos, vel, dt, colliders, r, h, stepHeight = 0.9) {
  let grounded = false, hitWall = false, stepped = false;

  // ---- horizontal X ----
  if (vel.x !== 0) {
    const prevX = pos.x;
    pos.x += vel.x * dt;
    const ok = tryStep(pos, r, h, colliders, stepHeight);
    if (ok === 'stepped') { stepped = true; grounded = true; }
    else if (!ok) { pos.x = prevX; vel.x = 0; hitWall = true; }
  }

  // ---- horizontal Z ----
  if (vel.z !== 0) {
    const prevZ = pos.z;
    pos.z += vel.z * dt;
    const ok = tryStep(pos, r, h, colliders, stepHeight);
    if (ok === 'stepped') { stepped = true; grounded = true; }
    else if (!ok) { pos.z = prevZ; vel.z = 0; hitWall = true; }
  }

  // ---- vertical ----
  pos.y += vel.y * dt;
  const hits = overlapsAll(pos, r, h, colliders);
  if (hits.length) {
    if (vel.y <= 0) {
      let top = -Infinity;
      for (const c of hits) if (c.max.y > top) top = c.max.y;
      pos.y = top;
      grounded = true;
    } else {
      let bottom = Infinity;
      for (const c of hits) if (c.min.y < bottom) bottom = c.min.y;
      pos.y = bottom - h - 0.001;
    }
    vel.y = 0;
  }

  // ground probe, so contact is not lost on the frame after landing
  if (!grounded && vel.y <= 0.001) {
    if (overlapsAny({ x: pos.x, y: pos.y - 0.06, z: pos.z }, r, h, colliders)) grounded = true;
  }

  return { grounded, hitWall, stepped };
}

/** True if an entity box at this position would intersect world geometry. */
export function blocked(pos, r, h, colliders) {
  return overlapsAny(pos, r, h, colliders) !== null;
}

/** Height of the highest surface under a point (for spawn placement). */
export function groundHeight(x, z, colliders, maxY = 40) {
  let best = 0;
  for (const c of colliders) {
    if (x >= c.min.x && x <= c.max.x && z >= c.min.z && z <= c.max.z) {
      if (c.max.y <= maxY && c.max.y > best) best = c.max.y;
    }
  }
  return best;
}

/**
 * Nearest hit of a ray against the world's collision boxes (slab method).
 * Far cheaper than raycasting render meshes, and exact for this all-box world.
 * Boxes that contain the origin are ignored. Returns { distance, point, normal } or null.
 */
const AX = ['x', 'y', 'z'];
export function rayBoxes(colliders, o, d, far = Infinity) {
  let best = far, bestAxis = -1, bestSign = 0;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    let tmin = 0, tmax = best, enterAxis = -1, enterSign = 0, hit = true;
    for (let a = 0; a < 3; a++) {
      const k = AX[a];
      const lo = c.min[k], hi = c.max[k], oa = o[k], da = d[k];
      if (Math.abs(da) < 1e-9) {
        if (oa < lo || oa > hi) { hit = false; break; }
        continue;
      }
      let t1 = (lo - oa) / da, t2 = (hi - oa) / da, s = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
      if (t1 > tmin) { tmin = t1; enterAxis = a; enterSign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) { hit = false; break; }
    }
    if (hit && enterAxis >= 0 && tmin < best) { best = tmin; bestAxis = enterAxis; bestSign = enterSign; }
  }
  if (bestAxis < 0) return null;
  const normal = new THREE.Vector3();
  normal[AX[bestAxis]] = bestSign;
  return {
    distance: best,
    point: new THREE.Vector3(o.x + d.x * best, o.y + d.y * best, o.z + d.z * best),
    normal,
  };
}

/** True if nothing solid lies on the segment a -> b. */
export function clearLine(colliders, a, b, pad = 0.15) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < pad) return true;
  return rayBoxes(colliders, a, { x: dx / len, y: dy / len, z: dz / len }, len - pad) === null;
}
