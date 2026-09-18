// Swept AABB movement with step-up, plus box-collider raycasts used for everything that needs
// "is there a wall here" — bullets, line of sight, aim assist, blast exposure, airstrike targeting.
import * as THREE from 'three';

// Box3.intersectsBox treats touching faces as intersecting. Without this inset an entity
// standing exactly on the ground would be "inside" it forever (Bug 2).
export const EPS = 0.03;

const _box = new THREE.Box3();
const _v = new THREE.Vector3();

function entityBox(pos, r, h, out) {
  out.min.set(pos.x - r + EPS, pos.y + EPS, pos.z - r + EPS);
  out.max.set(pos.x + r - EPS, pos.y + h - EPS, pos.z + r - EPS);
  return out;
}

/**
 * Per-axis swept AABB movement with step-up onto low ledges/stairs.
 * pos is mutated in place. vel is the desired velocity for this step (m/s); dt scales it.
 * Returns { onGround, steppedUp }.
 */
export function moveEntity(pos, vel, dt, colliders, r, h, stepHeight) {
  let onGround = false;

  // Y axis first so a falling entity can settle before X/Z sweeps see it as grounded.
  pos.y += vel.y * dt;
  entityBox(pos, r, h, _box);
  for (const c of colliders) {
    if (!_box.intersectsBox(c)) continue;
    if (vel.y <= 0 && pos.y < c.max.y && pos.y + h * 0.5 > c.max.y - h) {
      // landing on top
      pos.y = c.max.y;
      vel.y = 0;
      onGround = true;
    } else if (vel.y > 0) {
      pos.y = c.min.y - h;
      vel.y = 0;
    }
    entityBox(pos, r, h, _box);
  }

  for (const axis of ['x', 'z']) {
    const delta = vel[axis] * dt;
    if (delta === 0) continue;
    pos[axis] += delta;
    entityBox(pos, r, h, _box);
    for (const c of colliders) {
      if (!_box.intersectsBox(c)) continue;

      // Step-up: find the HIGHEST intersecting surface, not the first collider found.
      // Picking the first (often the ground plane) makes stairs unclimbable (Bug 1).
      let highest = -Infinity;
      for (const c2 of colliders) {
        const test = entityBox(pos, r, h, new THREE.Box3());
        if (test.intersectsBox(c2) && c2.max.y > highest) highest = c2.max.y;
      }
      const step = highest - pos.y;
      if (step > 0 && step <= stepHeight) {
        pos.y = highest;
        entityBox(pos, r, h, _box);
        if (!_box.intersectsBox(c)) continue;
      }

      // Blocked: undo this axis's movement.
      pos[axis] -= delta;
      entityBox(pos, r, h, _box);
      break;
    }
  }

  // Ground check via a thin probe just below the feet.
  if (!onGround) {
    _v.copy(pos); _v.y -= 0.05;
    entityBox(_v, r, h, _box);
    for (const c of colliders) {
      if (_box.intersectsBox(c) && Math.abs(c.max.y - pos.y) < 0.06) { onGround = true; break; }
    }
  }

  return { onGround };
}

/** Can this entity stand at pos without intersecting a collider? Used for "can I stand up here". */
export function blocked(pos, r, h, colliders) {
  entityBox(pos, r, h, _box);
  for (const c of colliders) if (_box.intersectsBox(c)) return true;
  return false;
}

/** Highest collider top at (x, z), used to place spawns and bot waypoints. */
export function groundHeight(x, z, colliders, maxY = 50) {
  let best = 0;
  for (const c of colliders) {
    if (x >= c.min.x && x <= c.max.x && z >= c.min.z && z <= c.max.z && c.max.y <= maxY) {
      if (c.max.y > best) best = c.max.y;
    }
  }
  return best;
}

const _o = new THREE.Vector3(), _d = new THREE.Vector3();

/**
 * Slab-method ray vs. all collision boxes. Boxes containing the origin are ignored (so firing
 * from inside your own hitbox-adjacent geometry doesn't self-intersect).
 * Returns { distance, point, normal } or null.
 */
export function rayBoxes(colliders, origin, dir, far = 1000) {
  _o.copy(origin); _d.copy(dir).normalize();
  let bestT = far, bestNormal = null;
  for (const b of colliders) {
    if (_o.x >= b.min.x && _o.x <= b.max.x && _o.y >= b.min.y && _o.y <= b.max.y &&
        _o.z >= b.min.z && _o.z <= b.max.z) continue; // origin inside: ignore

    let tmin = -Infinity, tmax = Infinity, normal = null;
    for (const axis of ['x', 'y', 'z']) {
      const o = _o[axis], dd = _d[axis], mn = b.min[axis], mx = b.max[axis];
      if (Math.abs(dd) < 1e-9) {
        if (o < mn || o > mx) { tmin = Infinity; break; }
        continue;
      }
      let t1 = (mn - o) / dd, t2 = (mx - o) / dd, sign = -1;
      if (t1 > t2) { [t1, t2] = [t2, t1]; sign = 1; }
      if (t1 > tmin) { tmin = t1; normal = { axis, sign }; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) { tmin = Infinity; break; }
    }
    if (tmin < bestT && tmin >= 0 && tmin !== Infinity) {
      bestT = tmin;
      bestNormal = normal;
    }
  }
  if (bestT >= far) return null;
  const point = _o.clone().addScaledVector(_d, bestT);
  const normal = new THREE.Vector3();
  if (bestNormal) normal[bestNormal.axis] = bestNormal.sign;
  return { distance: bestT, point, normal };
}

/** True if nothing blocks the straight line from a to b (with a small padding inset). */
export function clearLine(colliders, a, b, pad = 0.15) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const dist = dir.length();
  if (dist < 1e-6) return true;
  dir.normalize();
  const hit = rayBoxes(colliders, a, dir, dist - pad);
  return !hit;
}
