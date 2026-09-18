// BLACKOUT ARENA — AIMBOT nerf-gun edition.
// Entry point: renderer, post-processing, match logic, grenades, killstreaks, menus,
// button remapping, the Gun Check and aim tuning.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { S, SCHEMA, load, save, reset, resetBinds } from './settings.js';
import { Input } from './engine/input.js';
import { ACTIONS, FIRMWARE_SENDS, codeName } from './engine/controls.js';
import { Audio } from './engine/audio.js';
import { blocked, groundHeight, rayBoxes, clearLine } from './engine/physics.js';
import { buildMap } from './game/map.js';
import { Player, PLAYER_DIMS } from './game/player.js';
import { Loadout } from './game/weapons.js';
import { BotManager } from './game/bots.js';
import { Effects } from './game/effects.js';
import { HUD } from './game/hud.js';
import { Grenades, FRAG } from './game/grenades.js';

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const keyOf = (action) => codeName((S.binds[action] || []).find(Boolean) || '');

load();

// ============================================================ RENDERER
const canvas = $('view');
let renderer;
try {
  // antialiasing is fixed when the context is created, so the PERFORMANCE preset applies it on load
  renderer = new THREE.WebGLRenderer({
    canvas, antialias: S.quality !== 'performance', powerPreference: 'high-performance',
    stencil: false, desynchronized: true,
  });
} catch (err) {
  throw new Error('WebGL could not be started: ' + err.message +
    '\nThe browser is blocking or lacks GPU access (hardware acceleration off, or a privacy shield blocking WebGL).');
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// The level never moves, so its shadows are rendered once instead of every frame.
renderer.shadowMap.autoUpdate = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(S.fov, innerWidth / innerHeight, 0.06, 420);
scene.add(camera);

// sky gradient
{
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d').createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0, '#2d4a63'); g.addColorStop(0.45, '#7d98a8');
  g.addColorStop(0.72, '#c9c2a8'); g.addColorStop(1.0, '#8b8574');
  const ctx = c.getContext('2d'); ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = tex;
  scene.environment = tex;
}
scene.fog = new THREE.Fog(0x9aa6a4, 55, 210);

scene.add(new THREE.HemisphereLight(0xbcd2e8, 0x4a463c, 1.15));
const sun = new THREE.DirectionalLight(0xfff0dc, 2.35);
sun.position.set(48, 62, 26);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 200;
const SC = 46;
sun.shadow.camera.left = -SC; sun.shadow.camera.right = SC;
sun.shadow.camera.top = SC; sun.shadow.camera.bottom = -SC;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.03;
scene.add(sun);
scene.add(sun.target);
const fill = new THREE.DirectionalLight(0x8fb4d8, 0.5);
fill.position.set(-40, 30, -30);
scene.add(fill);

// ---- viewmodel gets its own scene + camera so the gun never clips into walls
const vmScene = new THREE.Scene();
const vmCam = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.01, 6);
vmScene.add(vmCam);
vmScene.add(new THREE.HemisphereLight(0xd6e6f5, 0x3a4145, 1.9));
const vmKey = new THREE.DirectionalLight(0xfff2e0, 2.6);
vmKey.position.set(1.4, 2.2, 1.6);
vmScene.add(vmKey);
const vmRim = new THREE.DirectionalLight(0x9ec4e8, 1.4);   // cool rim so the silhouette reads
vmRim.position.set(-1.6, 0.8, -1.2);
vmScene.add(vmRim);
vmScene.environment = scene.environment;   // metals are black without an environment

// ---- quality presets
//   performance : native resolution capped at 1x, no shadows, no bloom
//   balanced    : up to 1.25x, baked shadows, no bloom          (default)
//   quality     : up to 2x, sharper baked shadows, optional bloom
const PRESET = {
  performance: { dpr: 1.0, shadows: false, map: 1024, bloom: false, lite: true },
  balanced:    { dpr: 1.25, shadows: true, map: 1024, bloom: false, lite: true },
  quality:     { dpr: 2.0, shadows: true, map: 2048, bloom: true, lite: false },
};
const preset = () => PRESET[S.quality] || PRESET.balanced;

let composer = null;
function buildComposer() {
  composer?.dispose?.();
  composer = null;
  // Post-processing only when bloom is actually wanted; rendering straight to the canvas
  // is cheaper and keeps the browser's multisample antialiasing.
  if (!(preset().bloom && S.bloom)) return;
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.3, 0.5, 0.92));
  composer.addPass(new OutputPass());
  composer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(pixelRatio());
}
// ---- automatic resolution: keep frame time under the display's refresh interval
const DYN = { scale: 1, acc: 0, n: 0, changedAt: 0, hz: 60, samples: [], slow: 0, min: 0.7 };
function pixelRatio() {
  return Math.min(devicePixelRatio || 1, preset().dpr) * S.renderScale * (S.dynamicRes ? DYN.scale : 1);
}
function setDynScale(v, nowReal) {
  v = clamp(Math.round(v * 100) / 100, DYN.min, 1);
  if (v === DYN.scale) return;
  DYN.scale = v;
  DYN.changedAt = nowReal;
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(innerWidth, innerHeight, false);
  composer?.setPixelRatio(pixelRatio());
}
function dynamicResolution(rawDt, nowReal) {
  // learn the refresh rate from the first frames (menu load is light)
  if (DYN.samples.length < 90) {
    if (rawDt > 0.002 && rawDt < 0.05) DYN.samples.push(rawDt);
    if (DYN.samples.length === 90) {
      const sorted = [...DYN.samples].sort((a, b) => a - b);
      const hz = 1 / sorted[45];
      DYN.hz = [60, 75, 90, 100, 120, 144, 165, 180, 240, 360].reduce((a, b) => Math.abs(b - hz) < Math.abs(a - hz) ? b : a);
    }
    return;
  }
  if (!S.dynamicRes || G.state !== 'playing' || document.hidden || rawDt > 0.25) { DYN.acc = 0; DYN.n = 0; return; }
  DYN.acc += rawDt; DYN.n++;
  if (DYN.acc < 0.5) return;
  const avg = DYN.acc / DYN.n;
  DYN.acc = 0; DYN.n = 0;
  const budget = 1 / DYN.hz;
  // two slow windows in a row before trimming, so one explosion spike doesn't blur the screen;
  // never below 70 % so the image stays crisp
  DYN.slow = avg > budget * 1.12 ? DYN.slow + 1 : 0;
  if (DYN.slow >= 2 && DYN.scale > DYN.min && nowReal - DYN.changedAt > 0.9) {
    setDynScale(DYN.scale - (avg > budget * 1.5 ? 0.1 : 0.05), nowReal);
    DYN.slow = 0;
  } else if (avg < budget * 1.03 && DYN.scale < 1 && nowReal - DYN.changedAt > 4) {
    setDynScale(DYN.scale + 0.05, nowReal);
  }
}
let shadowState = null;
function applyVideo() {
  const P = preset();
  world.setLite(P.lite);
  bots.setLite(P.lite);
  if (!S.dynamicRes) DYN.scale = 1;
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(innerWidth, innerHeight, false);
  const shadows = P.shadows && S.shadows;
  sun.castShadow = shadows;
  const key = shadows + ':' + P.map;
  if (key !== shadowState) {
    renderer.shadowMap.enabled = shadows;
    if (shadowState !== null) {
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    }
    sun.shadow.mapSize.set(P.map, P.map);
    shadowState = key;
  }
  renderer.shadowMap.needsUpdate = true;
  camera.fov = S.fov; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  vmCam.aspect = camera.aspect; vmCam.updateProjectionMatrix();
  buildComposer();
}
let resizeTimer = 0;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(applyVideo, 120); });


// ============================================================ WORLD
const built = buildMap(scene);
const world = {
  scene,
  colliders: built.colliders,
  solids: built.solids,
  waypoints: built.waypoints,
  bounds: built.bounds,
  setLite: built.setLite,
  ray: new THREE.Raycaster(),
};
const spawns = built.spawns;

const audio = new Audio();
const input = new Input(canvas);
const player = new Player(camera);
const loadout = new Loadout(vmCam);
const bots = new BotManager(world);
const fx = new Effects(scene);
const hud = new HUD(world);
const grenades = new Grenades({ scene, vmCam, colliders: world.colliders, audio });

// The ONLY dynamic light in the level. It is always present (a changing light count
// recompiles every shader) and is shared by muzzle flashes and explosions.
const flashLightWorld = new THREE.PointLight(0xffb866, 0, 24, 2);
scene.add(flashLightWorld);
fx.onFlash = (pos, intensity) => {
  if (intensity < flashLightWorld.intensity) return;
  flashLightWorld.position.set(pos.x, pos.y + 1, pos.z);
  flashLightWorld.intensity = intensity;
};

// ============================================================ MATCH STATE
const STREAKS = [
  { kills: 3, id: 'uav', name: 'UAV' },
  { kills: 5, id: 'airstrike', name: 'AIRSTRIKE' },
  { kills: 7, id: 'resupply', name: 'RESUPPLY' },
];

const G = {
  mode: 'menu',           // menu | tdm | range | track
  state: 'menu',          // menu | playing | paused | over | calib | gun
  time: 0,
  timeLeft: 600,
  scoreYou: 0,
  scoreThem: 0,
  uavUntil: 0,
  respawnAt: 0,
  fps: 60,
  frames: 0, fpsTimer: 0,
  trackTime: 0, trackOn: 0,
  rangeHits: 0, rangeShots: 0,
  streakQueue: [],
  strikes: [],
  practiceStrikeAt: 0,
  nadeKills: 0, streakKills: 0,
  dangerBeepAt: 0,
};

const RANGE_SPAWN = new THREE.Vector3(0, 0, 24);

// per-match control state
const C = {
  adsToggle: false, adsLinger: 0,
  crouchToggle: false,
  pendingShotUntil: 0, snipeArmed: false,
  reloadArmed: false, reloadDownAt: 0,
};

function pickSpawn(awayFrom = null) {
  let best = spawns[0], bestD = -1;
  for (const s of spawns) {
    const ref = awayFrom || player.pos;
    let d = s.distanceTo(ref);
    for (const b of bots.bots) if (!b.dead) d = Math.min(d, s.distanceTo(b.pos) * 1.1);
    const j = d + Math.random() * 6;
    if (j > bestD) { bestD = j; best = s; }
  }
  const p = best.clone();
  p.y = groundHeight(p.x, p.z, world.colliders) + 0.05;
  return p;
}

const api = {
  pickSpawn: () => pickSpawn(),
  blockedAt: (p) => blocked({ x: p.x, y: p.y, z: p.z }, 0.42, 1.4, world.colliders),
  botShoot,
  grenadeThreat: (pos) => {
    let best = null, bd = 6.5;
    for (const g of grenades.live) {
      const d = g.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = g.pos; }
    }
    return best;
  },
  // Lob a frag at a point, trying flatter throws first and going higher until the arc
  // clears whatever cover is in the way. Returns false if no arc works.
  botGrenade: (bot, target) => {
    const from = bot.eye;
    const flat = Math.hypot(target.x - from.x, target.z - from.z);
    for (let T = clamp(flat / 13, 0.7, 1.7); T <= 2.6; T += 0.3) {
      const v = new THREE.Vector3((target.x - from.x) / T, 0, (target.z - from.z) / T);
      v.y = ((target.y + 0.2) - from.y + 0.5 * 20 * T * T) / T;
      if (!grenades.clearArc(from, v, T)) continue;
      grenades.spawn(from, v, T + 0.7 + Math.random() * 0.4, 'bot', bot);
      audio.throwNade(from.distanceTo(camera.position));
      return true;
    }
    return false;
  },
};

// ============================================================ TARGETS (range / tracking)
class Targets {
  constructor() {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.items = [];
    this.mover = null;
  }
  clear() {
    for (const t of this.items) this.group.remove(t.mesh);
    this.items = [];
    if (this.mover) { this.group.remove(this.mover.mesh); this.mover = null; }
  }
  makePlate(x, y, z) {
    const g = new THREE.Group();
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 0.1),
      new THREE.MeshStandardMaterial({ color: 0xdad3c2, roughness: .9 }));
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 20),
      new THREE.MeshStandardMaterial({ color: 0xc23b28, roughness: .8 }));
    ring.rotation.x = Math.PI / 2; ring.position.z = 0.06;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, y, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x4a4a44, roughness: .8 }));
    post.position.y = -y / 2 - 0.65;
    g.add(face, ring, post);
    g.position.set(x, y + 0.65, z);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.userData.plate = g; } });
    this.group.add(g);
    const item = { mesh: g, down: false, resetAt: 0 };
    g.userData.item = item;
    this.items.push(item);
    return item;
  }
  makeMover() {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14),
      new THREE.MeshStandardMaterial({ color: 0xff5a3c, emissive: 0x8c1f10, emissiveIntensity: .8, roughness: .5 }));
    m.castShadow = true;
    this.group.add(m);
    this.mover = { mesh: m, t: 0 };
    return this.mover;
  }
  hit(item, now) {
    if (item.down) return;
    item.down = true; item.resetAt = now + 1.2;
  }
  update(dt, now) {
    for (const it of this.items) {
      const target = it.down ? -Math.PI / 2 : 0;
      it.mesh.rotation.x += (target - it.mesh.rotation.x) * Math.min(1, 14 * dt);
      if (it.down && now > it.resetAt) it.down = false;
    }
    if (this.mover) {
      this.mover.t += dt;
      const t = this.mover.t;
      this.mover.mesh.position.set(
        Math.sin(t * 0.9) * 11 + Math.sin(t * 2.3) * 2.4,
        2.4 + Math.sin(t * 1.7) * 1.1,
        13 + Math.cos(t * 0.6) * 3
      );
    }
  }
  get meshes() {
    const out = [];
    this.group.traverse(o => { if (o.isMesh) out.push(o); });
    return out;
  }
}
const targets = new Targets();

// ============================================================ COMBAT
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const ray = new THREE.Raycaster();

function cameraDir(out) { return camera.getWorldDirection(out); }

function coneDir(base, cone) {
  if (cone <= 0) return base;
  const right = _v2.crossVectors(base, UP).normalize();
  const up = _v3.crossVectors(right, base).normalize();
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * cone;
  return base.addScaledVector(right, Math.tan(r) * Math.cos(a))
             .addScaledVector(up, Math.tan(r) * Math.sin(a)).normalize();
}

// Only moving things are raycast as meshes; the level itself is tested against its boxes.
function shootTargets() {
  if (G.mode === 'tdm') return bots.hitMeshes;
  return targets.meshes.filter(m => !m.userData.plate?.userData.item?.down);
}

/** Screen-space angle (0 = straight ahead, + = to the right) of a world point. */
function screenAngle(x, z) {
  return (player.yaw - Math.PI) - Math.atan2(x - player.pos.x, z - player.pos.z);
}

function creditKill(bot, weapon, now) {
  player.kills++; player.streak++; G.scoreYou++;
  player.bestStreak = Math.max(player.bestStreak, player.streak);
  hud.hitmark('kill', now); audio.kill();
  hud.kill('YOU', bot.name, weapon, true);
  for (const s of STREAKS) {
    if (player.streak === s.kills) {
      G.streakQueue.push(s);
      hud.banner(`${s.name} READY — PRESS ${keyOf('streak')}`, now, 2.6);
      audio.streak();
    }
  }
  if (player.streak >= 3 && !STREAKS.some(s => s.kills === player.streak)) {
    hud.banner(`${player.streak} KILLSTREAK`, now, 1.2);
  }
  if (G.scoreYou >= S.scoreLimit) endMatch(true);
}

function playerShoot(now) {
  const d = loadout.def;
  const cone = loadout.fire(now, { moveSpeed: player.moveSpeed, airborne: !player.grounded });
  player.shots++; G.rangeShots++;
  audio.shot(d.kind === 'sniper' ? 'sniper' : d.kind === 'smg' ? 'smg' : d.kind === 'pistol' ? 'pistol' : 'rifle');
  player.shake = Math.min(0.7, player.shake + (d.kind === 'sniper' ? 0.55 : 0.10));

  const origin = camera.getWorldPosition(new THREE.Vector3());
  const dir = coneDir(cameraDir(_v1).clone(), cone);
  const wall = rayBoxes(world.colliders, origin, dir, 300);
  ray.set(origin, dir);
  ray.far = wall ? wall.distance : 300;
  const hits = ray.intersectObjects(shootTargets(), false);

  const muzzleWorld = loadout.cur.muzzle.getWorldPosition(new THREE.Vector3());
  if (flashLightWorld.intensity < 22) {
    flashLightWorld.position.copy(origin).addScaledVector(dir, 0.6);
    flashLightWorld.intensity = 22;
  }

  const h = hits[0];
  const end = h ? h.point : wall ? wall.point : origin.clone().addScaledVector(dir, 220);
  fx.tracer(muzzleWorld, end);

  if (!h) {
    if (wall) { fx.impact(wall.point, wall.normal); audio.ric(wall.distance); }
    return;
  }
  const bot = h.object.userData.bot;
  const plate = h.object.userData.plate;

  if (bot && !bot.dead) {
    const zone = h.object.userData.zone || 'body';
    let dmg = d.damage * (zone === 'head' ? d.headMult : zone === 'limb' ? d.limbMult : 1);
    if (h.distance > d.range) dmg *= d.falloff;
    player.hits++; if (zone === 'head') player.headshots++;
    fx.impact(h.point, h.face?.normal || UP, 'blood');
    if (bot.damage(dmg, now)) creditKill(bot, d.name.split(' ')[0], now);
    else { hud.hitmark(zone === 'head' ? 'head' : 'hit', now); audio.hit(zone === 'head'); }
  } else if (plate) {
    const item = plate.userData.item;
    if (item && !item.down) {
      targets.hit(item, now);
      G.rangeHits++; player.hits++;
      hud.hitmark('hit', now); audio.hit(false);
      fx.impact(h.point, h.face?.normal || UP);
    }
  } else if (h.object === targets.mover?.mesh) {
    G.rangeHits++; player.hits++;
    hud.hitmark('hit', now); audio.hit(false);
    fx.impact(h.point, h.face?.normal || UP, 'blood');
  }
}

function botShoot(bot, target, D, dist) {
  const from = bot.muzzle.getWorldPosition(new THREE.Vector3());
  const to = new THREE.Vector3(target.pos.x, target.eyeY - 0.25, target.pos.z);
  const dir = new THREE.Vector3().subVectors(to, from).normalize();

  audio.shot('rifle', dist);

  // angular size of the player at this range vs. the bot's aim error
  const halfSize = Math.atan2(0.55, Math.max(dist, 1));
  const err = (Math.random() + Math.random() + Math.random() - 1.5) * 1.4 * D.spread;
  const errYaw = err, errPitch = (Math.random() - 0.5) * 2 * D.spread;
  const hit = Math.hypot(errYaw, errPitch) < halfSize && !target.dead;

  if (hit) {
    fx.tracer(from, to);
    const dmg = 17 * D.dmg * (dist > 30 ? 0.72 : 1);
    const died = target.hurt(dmg, G.time, dir);
    audio.hurt();
    hud.damageFrom(screenAngle(bot.pos.x, bot.pos.z));
    if (died) onPlayerDeath(bot.name, 'R-91', false);
  } else {
    const miss = to.clone()
      .addScaledVector(new THREE.Vector3(-dir.z, 0, dir.x), Math.tan(errYaw) * dist)
      .addScaledVector(UP, Math.tan(errPitch) * dist);
    const md = new THREE.Vector3().subVectors(miss, from).normalize();
    const h = rayBoxes(world.colliders, from, md, 120);
    fx.tracer(from, h ? h.point : miss);
    if (h) {
      fx.impact(h.point, h.normal);
      audio.ric(camera.position.distanceTo(h.point));
    }
  }
}

function onPlayerDeath(killer, weapon, suicide) {
  if (!suicide) G.scoreThem++;
  hud.kill(killer, 'YOU', weapon, false);
  hud.screenFlash(0.35);
  G.respawnAt = G.time + 2.6;
  // dying with the pin pulled drops the live grenade at your feet
  if (grenades.cooking) {
    grenades.cooking = false;
    grenades.hand.visible = false;
    grenades.arc.visible = false;
    grenades.landMarker.visible = false;
    grenades.spawn(player.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), new THREE.Vector3(),
      Math.max(0.2, FRAG.fuse - (G.time - grenades.cookStart)), 'player', null);
  }
  if (G.scoreThem >= S.scoreLimit) endMatch(false);
}

/** Line of sight from an explosion to a point (world geometry only). */
function exposed(from, to) {
  return clearLine(world.colliders, from, to, 0.25);
}

/**
 * Blast damage + effects. o = { radius, damage, owner: 'player'|'bot', ownerName,
 * weapon, self (can the player hurt themselves), scale }
 */
function explode(pos, o) {
  const now = G.time;
  fx.explosion(pos, o.scale || 1);
  const listen = camera.position.distanceTo(pos);
  audio.explosion(listen);
  player.shake = Math.min(1.4, player.shake + Math.max(0, 1.3 - listen / 14));
  if (listen < 6) hud.screenFlash(0.25 * (1 - listen / 6));

  const from = pos.clone(); from.y += 0.35;
  const falloff = (d) => o.damage * Math.pow(1 - d / o.radius, 0.8);

  if (G.mode === 'tdm' && o.owner === 'player') {
    let any = false;
    for (const b of bots.bots) {
      if (b.dead) continue;
      const chest = new THREE.Vector3(b.pos.x, b.pos.y + 1.1, b.pos.z);
      const d = chest.distanceTo(pos);
      if (d >= o.radius || !exposed(from, chest)) continue;
      any = true;
      if (b.damage(falloff(d), now)) {
        creditKill(b, o.weapon, now);
        if (o.weapon === 'FRAG') G.nadeKills++; else G.streakKills++;
      }
    }
    if (any && !hud.el.hit.classList.contains('kill')) { hud.hitmark('hit', now); audio.hit(false); }
  }

  // practice modes never hurt you: the range is for learning the throw
  if (!player.dead && G.mode === 'tdm' && (o.owner !== 'player' || o.self)) {
    const chest = new THREE.Vector3(player.pos.x, player.pos.y + 1.1, player.pos.z);
    const d = chest.distanceTo(pos);
    if (d < o.radius && exposed(from, chest)) {
      const dmg = falloff(d) * (o.owner === 'player' ? (o.selfScale ?? 0.6) : 1);
      audio.hurt();
      hud.damageFrom(screenAngle(pos.x, pos.z));
      if (player.hurt(dmg, now)) {
        const suicide = o.owner === 'player';
        onPlayerDeath(suicide ? 'YOU' : (o.ownerName || 'HOSTILE'), o.weapon, suicide);
      }
    }
  }

  if (G.mode === 'range') {
    let n = 0;
    for (const it of targets.items) {
      if (!it.down && it.mesh.position.distanceTo(pos) < o.radius) { targets.hit(it, now); n++; }
    }
    if (n) { G.rangeHits += n; hud.hitmark('hit', now); audio.hit(false); }
  }
}

grenades.onExplode = (pos, owner, ownerRef, info) => {
  explode(pos, {
    radius: FRAG.radius, damage: FRAG.damage, owner,
    ownerName: ownerRef?.name, weapon: 'FRAG', self: true, scale: 1,
    // a grenade that goes off in your hand is always fatal
    selfScale: info.inHand ? 10 : 0.6,
  });
  if (info.inHand) hud.banner('HELD IT TOO LONG', G.time, 1.4);
};

// ============================================================ KILLSTREAKS
function aimPoint(maxDist = 90) {
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const dir = cameraDir(new THREE.Vector3());
  const h = rayBoxes(world.colliders, origin, dir, maxDist);
  const p = h ? h.point : origin.addScaledVector(dir, maxDist);
  p.x = clamp(p.x, -world.bounds, world.bounds);
  p.z = clamp(p.z, -world.bounds, world.bounds);
  p.y = groundHeight(p.x, p.z, world.colliders, p.y + 0.5) + 0.1;
  return p;
}

function callAirstrike(now, damage) {
  const target = aimPoint();
  const fwd = cameraDir(new THREE.Vector3()); fwd.y = 0;
  if (fwd.lengthSq() < 0.01) fwd.set(0, 0, -1);
  fwd.normalize();
  for (let i = 0; i < 6; i++) {
    const p = target.clone().addScaledVector(fwd, (i - 2.5) * 3.4);
    p.x += (Math.random() - 0.5) * 1.6; p.z += (Math.random() - 0.5) * 1.6;
    p.x = clamp(p.x, -world.bounds, world.bounds);
    p.z = clamp(p.z, -world.bounds, world.bounds);
    p.y = groundHeight(p.x, p.z, world.colliders) + 0.1;
    G.strikes.push({ at: now + 1.4 + i * 0.16, pos: p, damage });
  }
  audio.jet();
}

function useStreak(now) {
  if (G.mode === 'range') {
    if (now < G.practiceStrikeAt) { audio.denied(); return; }
    G.practiceStrikeAt = now + 4;
    callAirstrike(now, 200);
    hud.banner('PRACTICE AIRSTRIKE — AT YOUR CROSSHAIR', now, 1.6);
    return;
  }
  if (G.mode !== 'tdm') return;
  const s = G.streakQueue.shift();
  if (!s) {
    const next = STREAKS.find(x => x.kills > player.streak);
    audio.denied();
    hud.banner(next ? `NO KILLSTREAK — ${next.kills - player.streak} MORE FOR ${next.name}` : 'NO KILLSTREAK READY', now, 1.4);
    return;
  }
  audio.streak();
  if (s.id === 'uav') {
    G.uavUntil = now + 25;
    hud.banner('UAV ONLINE — HOSTILES ON YOUR MAP', now);
  } else if (s.id === 'airstrike') {
    callAirstrike(now, 220);
    hud.banner('AIRSTRIKE INBOUND', now);
  } else if (s.id === 'resupply') {
    for (const w of loadout.slots) { w.ammo = w.def.mag; w.reserve = w.def.reserve; }
    grenades.refill(FRAG.max);
    player.hp = 100;
    hud.banner('RESUPPLY — AMMO, FRAGS & HEALTH', now);
  }
}

// ============================================================ AIM ASSIST
function computeAssist() {
  if (G.mode !== 'tdm' || player.dead) return { slow: 0, yaw: 0, pitch: 0 };
  const camPos = camera.getWorldPosition(_v1);
  const fwd = cameraDir(_v2).clone();
  let best = null, bestAng = 0.13;

  for (const b of bots.bots) {
    if (b.dead) continue;
    const c = _v3.set(b.pos.x, b.pos.y + 1.25, b.pos.z);
    const to = c.clone().sub(camPos);
    const dist = to.length();
    if (dist > 65) continue;
    to.divideScalar(dist);
    const ang = fwd.angleTo(to);
    if (ang < bestAng && clearLine(world.colliders, camPos, c, 0.4)) { bestAng = ang; best = { to, ang }; }
  }
  if (!best) return { slow: 0, yaw: 0, pitch: 0 };

  const k = 1 - best.ang / 0.13;
  const slow = S.aimSlowdown * k * (0.35 + loadout.ads * 0.65);

  // rotational magnetism toward the target, gated on player intent
  const desiredYaw = Math.atan2(-best.to.x, -best.to.z);
  const desiredPitch = Math.asin(clamp(best.to.y, -1, 1));
  let dy = desiredYaw - player.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  const dp = desiredPitch - player.pitch;

  const intent = (Math.abs(input.stats.raw) > 0.6 || input.isDown('fire')) ? 1 : 0.25;
  const strength = S.aimAssist * k * intent * (0.6 + loadout.ads * 0.7);
  return {
    slow,
    yaw: -clamp(dy, -0.5, 0.5) * strength * 2.6,
    pitch: -clamp(dp, -0.5, 0.5) * strength * 2.2,
  };
}

// ============================================================ LOOK
let lastLook = { yaw: 0, pitch: 0 };
function updateLook(dt) {
  const assist = computeAssist();
  let sensScale = 1;
  if (loadout.ads > 0.1) {
    const scoped = loadout.def.size.sight === 'scope';
    sensScale = 1 + (loadout.ads * ((scoped ? S.scopeSensScale : S.adsSensScale) - 1));
  }
  const look = input.consumeLook(dt, {
    sensScale,
    slow: assist.slow,
    assistYaw: assist.yaw,
    assistPitch: assist.pitch,
    freeze: S.clutchFreeze && input.isDown('clutch'),
  });
  player.yaw -= look.yaw;
  player.pitch -= look.pitch;
  player.pitch = clamp(player.pitch, -1.52, 1.52);
  lastLook = look;
}

// ============================================================ LOOP
let prev = performance.now() / 1000;
function frame() {
  requestAnimationFrame(frame);
  const nowReal = performance.now() / 1000;
  const rawDt = nowReal - prev;
  const dt = Math.min(0.05, rawDt);
  prev = nowReal;
  dynamicResolution(rawDt, nowReal);

  G.frames++; G.fpsTimer += dt;
  if (G.fpsTimer >= 0.5) { G.fps = Math.round(G.frames / G.fpsTimer); G.frames = 0; G.fpsTimer = 0; }

  const live = G.state === 'playing' || G.state === 'gun';
  input.acceptUnlocked = live;
  input.gameActive = live;
  if (G.state === 'playing') { G.time += dt; step(dt); }
  else if (G.state === 'calib') calibStep(dt);
  else if (G.state === 'gun') gunStep(dt);

  vmCam.position.copy(camera.position);
  vmCam.quaternion.copy(camera.quaternion);
  flashLightWorld.intensity *= Math.pow(0.0001, dt);

  // do not draw into a zero-size / hidden framebuffer
  if (document.hidden || renderer.domElement.width === 0 || renderer.domElement.height === 0) return;

  if (composer) composer.render();
  else renderer.render(scene, camera);
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(vmScene, vmCam);
  renderer.autoClear = true;
}

function throwAim() {
  const cam = camera.getWorldPosition(new THREE.Vector3());
  const dir = cameraDir(new THREE.Vector3());
  const right = new THREE.Vector3().crossVectors(dir, UP).normalize();
  const hand = cam.clone().addScaledVector(dir, 0.45).addScaledVector(right, 0.18).addScaledVector(UP, -0.1);
  // pressed up against a wall or crate: never start the grenade inside it
  const off = hand.clone().sub(cam);
  const len = off.length();
  const hit = rayBoxes(world.colliders, cam, off.divideScalar(len), len);
  const origin = hit ? cam.clone().addScaledVector(off, Math.max(0, hit.distance - 0.15)) : hand;
  return { origin, dir, carry: player.vel.clone() };
}

function doReload(now) {
  if (grenades.lowered) return;
  if (loadout.startReload(now)) audio.reloadOut();
}

/** Every gun button, turned into game behaviour. Runs after the camera is placed. */
function handleGunActions(now) {
  const w = loadout.cur, d = loadout.def;

  if (player.dead) {
    C.snipeArmed = false; C.pendingShotUntil = 0; C.reloadArmed = false;
    return;
  }

  // ---- clutch ----
  if (input.wasPressed('clutch') && S.clutchRelevel) {
    player.pitch = 0;
    input.resetLook();
    hud.banner('RE-LEVELED', now, 0.6);
  }

  // ---- grenade (PRIME) ----
  if (input.wasPressed('grenade') && !grenades.cooking) {
    if (!grenades.startCook(now)) { audio.denied(); hud.banner('NO GRENADES', now, 0.8); }
    else {
      w.reloading = false;
      if (!S.grenadeCook) grenades.release(now, throwAim());
    }
  }
  if (grenades.cooking && S.grenadeCook && !input.isDown('grenade')) grenades.release(now, throwAim());

  // ---- reload / swap (RELOAD: tap vs hold) ----
  if (input.wasPressed('reload')) {
    if (S.reloadHoldSwap) { C.reloadArmed = true; C.reloadDownAt = now; }
    else doReload(now);
  }
  if (C.reloadArmed) {
    if (input.isDown('reload') && now - C.reloadDownAt >= S.swapHoldTime) {
      C.reloadArmed = false;
      if (loadout.next(now)) { audio.swap(); hud.setSlot(loadout.index); }
    } else if (!input.isDown('reload')) {
      C.reloadArmed = false;
      doReload(now);
    }
  }
  if (input.wasPressed('swap') && loadout.next(now)) { audio.swap(); hud.setSlot(loadout.index); }

  // ---- killstreak (AUX) ----
  if (input.wasPressed('streak')) useStreak(now);

  // ---- fire (TRIGGER) ----
  const pressed = input.wasPressed('fire');
  const down = input.isDown('fire');
  const released = input.wasReleased('fire');
  const scopeOnRelease = d.bolt && S.adsMode === 'trigger';
  if (grenades.lowered || loadout.lower > 0.3) {
    C.snipeArmed = false; C.pendingShotUntil = 0;
    return;
  }
  let request = false;
  if (scopeOnRelease) {
    if (pressed) C.snipeArmed = true;
    if (released && C.snipeArmed) { C.snipeArmed = false; C.pendingShotUntil = now + 0.15; }
    request = now < C.pendingShotUntil;
  } else if (d.auto) {
    request = down || pressed;
  } else {
    // semi-auto: a tap during the cooldown is buffered briefly instead of being dropped
    if (pressed) C.pendingShotUntil = now + 0.15;
    request = now < C.pendingShotUntil;
  }
  if (request) {
    if (loadout.canFire(now)) {
      playerShoot(now);
      if (!d.auto) C.pendingShotUntil = 0;
    } else if (w.ammo <= 0 && !w.reloading && now >= w.nextShot) {
      if (S.autoReload && w.reserve > 0) doReload(now);
      else if (pressed || released) audio.dryFire();
      C.pendingShotUntil = 0;
    }
  }
}

function wantsAds(now) {
  if (S.adsMode === 'off' || player.sprinting || grenades.lowered) return false;
  if (S.adsMode === 'toggle') {
    if (input.wasPressed('aim')) C.adsToggle = !C.adsToggle;
    return C.adsToggle;
  }
  if (S.adsMode === 'trigger') {
    if (input.isDown('fire')) C.adsLinger = now + 0.3;
    return input.isDown('fire') || now < C.adsLinger || input.isDown('aim');
  }
  return input.isDown('aim');
}

function step(dt) {
  const now = G.time;
  // raycasts (bullets, line of sight, aim assist) read matrixWorld, so refresh it first
  scene.updateMatrixWorld();

  // --- respawn ---
  if (player.dead && now >= G.respawnAt && G.state === 'playing') {
    player.respawn(G.mode === 'tdm' ? pickSpawn() : RANGE_SPAWN.clone());
    player.yaw = Math.atan2(player.pos.x, player.pos.z);
    for (const w of loadout.slots) { w.ammo = w.def.mag; w.reloading = false; }
    grenades.refill(FRAG.perLife);
    C.crouchToggle = false; C.adsToggle = false;
  }

  updateLook(dt);

  const w = loadout.cur, d = loadout.def;

  loadout.update(dt, now, {
    wantAds: wantsAds(now),
    lowered: grenades.lowered,
    lookYaw: lastLook.yaw, lookPitch: lastLook.pitch,
    grounded: player.grounded, moveSpeed: player.moveSpeed,
    sprinting: player.sprinting, bobScale: S.viewBob, landDip: player.landDip,
  });

  // --- movement (joystick) ---
  if (S.crouchMode === 'toggle' && input.wasPressed('crouch')) C.crouchToggle = !C.crouchToggle;
  player.update(dt, now, input, world.colliders, {
    move: {
      forward: input.isDown('forward'), back: input.isDown('back'),
      left: input.isDown('left'), right: input.isDown('right'),
      sprint: input.isDown('sprint'),
      crouch: S.crouchMode === 'toggle' ? C.crouchToggle : input.isDown('crouch'),
      crouchPressed: input.wasPressed('crouch'),
      jump: input.isDown('jump') || input.wasPressed('jump'),
    },
    ads: loadout.ads > 0.5,
    adsBlend: loadout.ads,
    reloading: w.reloading,
    bounds: world.bounds,
    bobScale: S.viewBob,
    recoilPitch: loadout.recoilPitch,
    recoilYaw: loadout.recoilYaw,
    blockedStanding: blocked({ x: player.pos.x, y: player.pos.y, z: player.pos.z }, PLAYER_DIMS.r, PLAYER_DIMS.stand, world.colliders),
    lastFallSpeed: player.vel.y,
    onStep: (run) => audio.step(run),
    onLand: () => audio.land(),
  });

  // --- buttons: after player.update so shots and throws use this frame's camera ---
  camera.updateMatrixWorld(true);
  if (G.state === 'playing') handleGunActions(now);

  // --- world actors ---
  if (G.mode === 'tdm') bots.update(dt, now, player, api);
  targets.update(dt, now);
  grenades.update(dt, now, {
    aim: throwAim(),
    showArc: S.grenadeArc,
    listener: camera.position,
  });
  for (let i = G.strikes.length - 1; i >= 0; i--) {
    const s = G.strikes[i];
    if (now >= s.at) {
      G.strikes.splice(i, 1);
      explode(s.pos, { radius: 6.5, damage: s.damage, owner: 'player', weapon: 'AIRSTRIKE', self: false, scale: 1.35 });
    }
  }
  fx.update(dt);

  // --- match timer ---
  if (G.mode === 'tdm' && G.state === 'playing') {
    G.timeLeft -= dt;
    if (G.timeLeft <= 0) endMatch(G.scoreYou >= G.scoreThem);
  }

  // --- tracking test scoring ---
  if (G.mode === 'track' && targets.mover) {
    G.trackTime += dt;
    const camPos = camera.getWorldPosition(_v1);
    const to = targets.mover.mesh.position.clone().sub(camPos);
    const dist = to.length();
    const ang = cameraDir(_v2).clone().angleTo(to.normalize());
    if (ang < Math.atan2(0.42, Math.max(dist, 1))) G.trackOn += dt;
    if (G.trackTime >= 30) finishTrackTest();
  }

  updateHud(now);
  input.endFrame();
}

function updateHud(now) {
  const w = loadout.cur, d = loadout.def;
  const uav = now < G.uavUntil;
  const blips = [];
  if (G.mode === 'tdm') {
    for (const b of bots.bots) {
      if (b.dead) continue;
      if (uav || b.pos.distanceTo(player.pos) < 13) blips.push({ x: b.pos.x, z: b.pos.z });
    }
  }
  const coneNow = (loadout.ads > 0.85 ? d.spread.ads : d.spread.hip)
    + player.moveSpeed * d.spread.move * 0.06 + (player.grounded ? 0 : d.spread.air)
    + Math.max(0, w.spread - d.spread.hip);
  const spreadPx = Math.tan(coneNow) / Math.tan(camera.fov * DEG / 2) * (innerHeight / 2);

  // grenade warnings
  const dangers = [];
  let enemyClose = false;
  for (const g of grenades.live) {
    const dist = g.pos.distanceTo(player.pos);
    if (dist > 10 || (g.owner === 'player' && dist > 6)) continue;
    dangers.push({ angle: screenAngle(g.pos.x, g.pos.z), dist });
    if (g.owner === 'bot' && dist < 8) enemyClose = true;
  }
  if (enemyClose && now > G.dangerBeepAt) { audio.danger(); G.dangerBeepAt = now + 0.45; }

  // killstreak box
  let streakNext = '';
  if (G.mode === 'range') streakNext = `${keyOf('streak')} ▸ PRACTICE AIRSTRIKE`;
  else if (G.mode === 'tdm') {
    const next = STREAKS.find(s => s.kills > player.streak);
    if (next) {
      const pips = Array.from({ length: next.kills }, (_, i) => `<i class="${i < player.streak ? 'on' : ''}"></i>`).join('');
      streakNext = `NEXT: ${next.name} <span class="pips">${pips}</span>`;
    }
  }

  const reloadKey = keyOf('reload');
  let swapHint = S.reloadHoldSwap ? `HOLD ${reloadKey} TO SWAP` : `${keyOf('swap')} TO SWAP`;
  if (C.reloadArmed && input.isDown('reload') && now - C.reloadDownAt > 0.1) {
    swapHint = `SWAPPING ${Math.min(100, Math.round((now - C.reloadDownAt) / S.swapHoldTime * 100))}%`;
  }

  hud.update(now, {
    hp: player.hp, ammo: w.ammo, reserve: w.reserve, weaponName: d.name, reloading: w.reloading, reloadKey,
    spreadPx, scoped: d.size.sight === 'scope' && loadout.ads > 0.9,
    dead: player.dead, crouching: player.crouching, sprinting: player.sprinting,
    motion: S.motionMode,
    scoreYou: G.mode === 'tdm' ? G.scoreYou : G.rangeHits,
    scoreThem: G.mode === 'tdm' ? G.scoreThem : G.rangeShots,
    timeLeft: Math.max(0, G.mode === 'tdm' ? G.timeLeft : (G.mode === 'track' ? 30 - G.trackTime : 0)),
    timerText: G.mode === 'range'
      ? (G.rangeShots ? (G.rangeHits / G.rangeShots * 100).toFixed(0) + '%' : '--%')
      : null,
    fps: G.fps, showFps: S.showFps, uav,
    resPct: S.dynamicRes && DYN.scale < 1 ? Math.round(DYN.scale * 100) : 0,
    px: player.pos.x, pz: player.pos.z, yaw: player.yaw, blips,
    nades: grenades.live.map(g => ({ x: g.pos.x, z: g.pos.z, enemy: g.owner === 'bot' })),
    grenades: grenades.count, grenInfinite: grenades.infinite,
    cook: grenades.cookProgress(now), cookLeft: Math.max(0, FRAG.fuse - (now - grenades.cookStart)),
    dangers,
    clutch: input.isDown('clutch'),
    swapHint,
    streakReady: G.streakQueue.map(s => s.name),
    streakKey: keyOf('streak'),
    streakNext,
  });
}

// ============================================================ MATCH FLOW
function startMatch(mode) {
  G.mode = mode;
  G.time = 0;
  G.scoreYou = 0; G.scoreThem = 0;
  G.timeLeft = S.matchMinutes * 60;
  G.uavUntil = 0;
  G.rangeHits = 0; G.rangeShots = 0;
  G.trackTime = 0; G.trackOn = 0;
  G.streakQueue = []; G.strikes = []; G.practiceStrikeAt = 0;
  G.nadeKills = 0; G.streakKills = 0; G.dangerBeepAt = 0;
  Object.assign(C, { adsToggle: false, adsLinger: 0, crouchToggle: false, pendingShotUntil: 0, snipeArmed: false, reloadArmed: false, reloadDownAt: 0 });
  player.kills = 0; player.deaths = 0; player.shots = 0; player.hits = 0; player.headshots = 0;
  player.bestStreak = 0;
  player.respawn(mode === 'tdm' ? pickSpawn() : RANGE_SPAWN.clone());
  player.yaw = Math.atan2(player.pos.x, player.pos.z);   // face the middle of the arena
  loadout.reset();
  grenades.reset();
  grenades.infinite = mode !== 'tdm';
  hud.buildSlots(loadout);
  input.resetLook();
  input.clearEdges();

  targets.clear();
  if (mode === 'tdm') {
    bots.setCount(S.botCount, api);
    bots.reset(api);
  } else {
    bots.setCount(0, api);
  }
  if (mode === 'range') {
    for (const [x, y, z] of [[-7, 1.2, 14], [-3.5, 1.6, 10], [0, 1.2, 16], [3.5, 1.6, 10], [7, 1.2, 14], [-11, 2.0, 8], [11, 2.0, 8]])
      targets.makePlate(x, y, z);
    targets.makeMover();
  }
  if (mode === 'track') targets.makeMover();

  const practice = mode !== 'tdm';
  document.querySelector('#topbar .team.you .lbl').textContent = practice ? 'HITS' : 'YOU';
  document.querySelector('#topbar .team.them .lbl').textContent = practice ? 'SHOTS' : 'HOSTILES';

  G.state = 'playing';
  showOverlay(null);
  $('hud').classList.remove('hidden');
  if (mode === 'range') {
    hud.banner(`TRIGGER FIRE · ${keyOf('grenade')} GRENADE · ${keyOf('streak')} AIRSTRIKE`, 0, 4);
  }
  audio.resume();
  input.captureUnlocked = false;
  input.requestLock();
}

function endMatch(won) {
  if (G.state === 'over') return;
  G.state = 'over';
  input.exitLock();
  const acc = player.shots ? (player.hits / player.shots * 100).toFixed(1) : '0.0';
  $('end-title').textContent = won ? 'VICTORY' : 'DEFEAT';
  $('end-title').style.color = won ? 'var(--green)' : 'var(--red)';
  const stat = (l, v) => `<div class="stat"><label>${l}</label><b>${v}</b></div>`;
  $('end-stats').innerHTML = [
    stat('KILLS', player.kills), stat('DEATHS', player.deaths), stat('ACCURACY', acc + '%'),
    stat('BEST STREAK', player.bestStreak), stat('HEADSHOTS', player.headshots),
    stat('FRAG KILLS', G.nadeKills), stat('AIRSTRIKE KILLS', G.streakKills),
    stat('SCORE', `${G.scoreYou} – ${G.scoreThem}`),
  ].join('');
  showOverlay('menu-end');
  $('hud').classList.add('hidden');
}

function finishTrackTest() {
  const pct = (G.trackOn / Math.max(G.trackTime, 0.001) * 100).toFixed(1);
  G.state = 'calib';
  input.exitLock();
  input.captureUnlocked = true;
  showOverlay('menu-calib');
  $('hud').classList.add('hidden');
  const grade = pct > 55 ? 'ok' : pct > 32 ? 'warn' : 'bad';
  $('calibresult').innerHTML = `TRACKING TEST: <span class="${grade}">${pct}% time on target</span> over 30s.<br>` +
    (pct > 55 ? 'Excellent — your filter settings are dialled in.'
      : pct > 32 ? 'Decent. Try lowering Min Cutoff slightly, or raising Speed Response if it feels laggy.'
        : 'Rough tracking. Turn the pot down, raise Min Cutoff a little, and increase the Noise Deadzone.');
}

function pause() {
  if (G.state !== 'playing') return;
  G.state = 'paused';
  input.releaseAll();
  showOverlay('menu-pause');
  input.exitLock();
}
function resume() {
  if (G.state !== 'paused') return;
  showOverlay('clickcatch');
}

// ============================================================ UI
const overlay = $('overlay');
const panels = ['menu-main', 'menu-pause', 'menu-settings', 'menu-gunprep', 'gun-live', 'menu-calib', 'menu-end', 'clickcatch'];
function showOverlay(id) {
  overlay.classList.toggle('passthru', id === 'gun-live');
  if (!id) { overlay.classList.add('gone'); return; }
  overlay.classList.remove('gone');
  for (const p of panels) $(p).classList.toggle('hidden', p !== id);
}

$('clickcatch').addEventListener('click', () => {
  showOverlay(null);
  G.state = 'playing';
  input.clearEdges();
  input.captureUnlocked = false;
  input.requestLock();
});

input.onLockError = () => {
  if (G.state === 'playing') hud.banner('CLICK THE GAME TO CAPTURE THE MOUSE', G.time, 3);
};
input.onLockChange = (locked) => {
  if (locked) return;
  if (G.state === 'playing') pause();
  else if (G.state === 'gun') endGunCheck();
};
input.onKeyPress = (code) => {
  if (code !== 'Escape') return;
  if (G.state === 'playing') pause();
  else if (G.state === 'gun') endGunCheck();
};

// mouse wheel still cycles weapons for desk testing
addEventListener('wheel', (e) => {
  if (G.state !== 'playing') return;
  const n = (loadout.index + (e.deltaY > 0 ? 1 : -1) + loadout.slots.length) % loadout.slots.length;
  if (loadout.switchTo(n, G.time)) { audio.swap(); hud.setSlot(n); }
}, { passive: true });

// ---- generic option rows ----
function buildOption(item) {
  const row = document.createElement('div');
  row.className = 'opt';
  const lab = document.createElement('label');
  lab.innerHTML = item.n + (item.d ? `<small>${item.d}</small>` : '');
  row.appendChild(lab);
  const changed = () => {
    save();
    if (['fov', 'renderScale', 'quality', 'bloom', 'shadows'].includes(item.k)) applyVideo();
    if (item.k === 'masterVolume') audio.setVolume(S[item.k]);
    buildControlsList();
  };

  if (item.t === 'bool') {
    const sw = document.createElement('div');
    sw.className = 'sw' + (S[item.k] ? ' on' : '');
    sw.onclick = () => { S[item.k] = !S[item.k]; sw.classList.toggle('on', S[item.k]); audio.ui(); changed(); };
    row.appendChild(sw);
    row.appendChild(document.createElement('output'));
  } else if (item.t === 'select') {
    const sel = document.createElement('select');
    for (const o of item.opts) {
      const op = document.createElement('option');
      op.value = o; op.textContent = o.toUpperCase();
      sel.appendChild(op);
    }
    sel.value = S[item.k];
    sel.onchange = () => { S[item.k] = sel.value; changed(); };
    row.appendChild(sel);
    row.appendChild(document.createElement('output'));
  } else {
    const r = document.createElement('input');
    r.type = 'range'; r.min = item.min; r.max = item.max; r.step = item.step; r.value = S[item.k];
    const out = document.createElement('output');
    const fmt = () => out.textContent = (+S[item.k]).toFixed(item.step < 0.01 ? 3 : item.step < 1 ? 2 : 0);
    r.oninput = () => { S[item.k] = parseFloat(r.value); fmt(); changed(); };
    fmt();
    row.appendChild(r); row.appendChild(out);
  }
  return row;
}

// ---- button mapping table ----
let listening = null;
function assignBind(action, slot, code) {
  if (code) {
    // a code can only do one thing: swap it out of wherever it was
    for (const a in S.binds) {
      for (let s = 0; s < 2; s++) {
        if ((a !== action || s !== slot) && S.binds[a][s] === code) S.binds[a][s] = S.binds[action][slot] || '';
      }
    }
  }
  S.binds[action][slot] = code;
  save();
}

function buildBindTable() {
  const host = $('bind-table');
  host.innerHTML = `<div class="bindrow head"><span>ACTION</span><span>GUN COMPONENT</span><span>BINDING</span><span>ALTERNATE</span><span>GUN SENDS</span></div>`;
  for (const a of ACTIONS) {
    const row = document.createElement('div');
    row.className = 'bindrow';
    const sends = FIRMWARE_SENDS[a.id];
    const broken = sends && !S.binds[a.id].includes(sends);
    row.innerHTML = `<span>${a.name}</span><span class="part">${a.part}<small>${a.pin || '&nbsp;'}</small></span>`;
    for (let slot = 0; slot < 2; slot++) {
      const b = document.createElement('button');
      const code = S.binds[a.id][slot];
      b.className = 'bindbtn' + (code ? '' : ' empty');
      b.textContent = codeName(code);
      b.onclick = () => {
        if (performance.now() - (input.captureEndedAt || 0) < 300) return;
        if (listening) { input.cancelCapture(); buildBindTable(); }
        listening = b;
        b.classList.add('listening');
        b.textContent = 'PRESS…';
        input.captureNext((got) => {
          listening = null;
          if (got === 'Backspace' || got === 'Delete') got = '';
          if (got !== null) { assignBind(a.id, slot, got); audio.ui(); }
          buildBindTable();
          buildControlsList();
        });
      };
      row.appendChild(b);
    }
    const s = document.createElement('span');
    s.className = 'sends' + (broken ? ' bad' : '');
    s.textContent = sends ? (broken ? `⚠ ${codeName(sends)}` : codeName(sends)) : '—';
    if (broken) s.title = `The gun sends ${codeName(sends)} for this, but nothing in the game is bound to it.`;
    row.appendChild(s);
    host.appendChild(row);
  }
}

// ---- main-menu control summary ----
function buildControlsList() {
  const rows = ACTIONS.filter(a => a.pin).map(a =>
    `<div class="kv"><b>${a.part.toUpperCase()}</b><span>${a.name}<small>${keyOf(a.id)}</small></span></div>`);
  const adsNote = {
    trigger: 'Aim: automatic while the trigger is held',
    hold: `Aim: hold ${keyOf('aim')}`, toggle: `Aim: press ${keyOf('aim')}`, off: 'Aim: hip-fire only',
  }[S.adsMode];
  rows.push(`<div class="kv"><b>MPU-6500</b><span>Aim the gun</span></div>`);
  rows.push(`<div class="kv"><b>POTENTIOMETER</b><span>Sensitivity dial (on the gun)</span></div>`);
  rows.push(`<div class="kv"><b>ADS</b><span>${adsNote}</span></div>`);
  $('controls-list').innerHTML = rows.join('');
}

function buildSettings() {
  for (const tab of ['input', 'video', 'game']) {
    const host = $('tab-' + tab);
    host.innerHTML = '';
    for (const item of SCHEMA[tab]) host.appendChild(buildOption(item));
  }
  const co = $('controls-opts');
  co.innerHTML = '';
  for (const item of SCHEMA.controls) co.appendChild(buildOption(item));
  buildBindTable();
  const cal = $('calib-sliders');
  cal.innerHTML = '';
  for (const item of SCHEMA.input.filter(i => i.motion || i.k === 'sensitivity')) cal.appendChild(buildOption(item));
}
buildSettings();
buildControlsList();

document.querySelectorAll('.tab').forEach(t => {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    for (const n of ['controls', 'input', 'video', 'game']) $('tab-' + n).classList.toggle('hidden', n !== t.dataset.tab);
  };
});

// the click that follows a captured mouse button must not also press a menu button
document.addEventListener('click', (e) => {
  if (performance.now() - (input.captureEndedAt || 0) < 300) { e.stopPropagation(); e.preventDefault(); }
}, true);

let settingsReturn = 'menu-main';
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  audio.resume(); audio.ui();
  if (listening) { input.cancelCapture(); listening = null; buildBindTable(); }
  switch (act) {
    case 'play': startMatch('tdm'); break;
    case 'range': startMatch('range'); break;
    case 'calib':
      G.state = 'calib'; input.captureUnlocked = true;
      $('hud').classList.add('hidden');
      showOverlay('menu-calib');
      break;
    case 'gunprep':
      G.state = 'menu';
      showOverlay('menu-gunprep');
      break;
    case 'gunstart': startGunCheck(); break;
    case 'settings':
      settingsReturn = G.state === 'paused' ? 'menu-pause' : 'menu-main';
      buildSettings(); showOverlay('menu-settings');
      break;
    case 'back':
      if (G.state === 'calib') { G.state = 'menu'; input.captureUnlocked = false; showOverlay('menu-main'); }
      else if (!$('menu-gunprep').classList.contains('hidden')) showOverlay('menu-main');
      else showOverlay(settingsReturn);
      buildControlsList();
      break;
    case 'resume': resume(); break;
    case 'restart': startMatch(G.mode === 'menu' ? 'tdm' : G.mode); break;
    case 'quit':
      G.state = 'menu'; G.mode = 'menu';
      $('hud').classList.add('hidden');
      showOverlay('menu-main');
      break;
    case 'reset-settings': reset(); buildSettings(); buildControlsList(); applyVideo(); break;
    case 'reset-binds': resetBinds(); buildBindTable(); buildControlsList(); break;
    case 'serial': doSerial(); break;
    case 'drifttest': startDriftTest(); break;
    case 'tracktest': startMatch('track'); break;
  }
});

function serialStatus(html) {
  document.querySelectorAll('.serialstatus').forEach(el => { el.innerHTML = html; });
}
async function doSerial() {
  if (input.serial.connected) {
    await input.disconnectSerial();
    serialStatus('Serial disconnected.');
    return;
  }
  try {
    serialStatus('Pick the Pico in the browser prompt…');
    await input.connectSerial();
    serialStatus('<span class="ok">CONNECTED.</span> Waiting for telemetry from AIMBOT_master_v5… ' +
      '(press the button again to disconnect)');
    setTimeout(() => {
      if (!input.serial.connected) return;
      serialStatus(input.teleLive
        ? `<span class="ok">CONNECTED — telemetry live.</span> ${input.teleInfo}`
        : '<span class="warn">Port open but no telemetry.</span> Is AIMBOT_master_v5 flashed, and is the Arduino Serial Monitor closed?');
    }, 2500);
  } catch (err) {
    serialStatus(`<span class="warn">${err.message}</span>`);
  }
}

// ============================================================ GUN CHECK
const GUN_TILES = [
  { id: 'trigger', name: 'TRIGGER', pin: 'GP10', bit: 1, actions: ['fire'] },
  { id: 'clutch', name: 'CLUTCH', pin: 'GP11', bit: 2, actions: ['clutch'] },
  { id: 'reload', name: 'RELOAD', pin: 'GP12', bit: 4, actions: ['reload'] },
  { id: 'prime', name: 'PRIME · GRENADE', pin: 'GP14', bit: 16, actions: ['grenade'] },
  { id: 'aux', name: 'AUX · KILLSTREAK', pin: 'GP16', bit: 32, actions: ['streak'] },
  { id: 'joysw', name: 'STICK CLICK', pin: 'GP13', bit: 8, actions: ['jump', 'crouch'], labels: ['TAP→JUMP', 'HOLD→CROUCH'] },
  { id: 'stick', name: 'JOYSTICK', pin: 'GP26 · GP27', actions: ['forward', 'back', 'left', 'right'], labels: ['↑', '↓', '←', '→'] },
  { id: 'sprint', name: 'STICK FULL PUSH', pin: 'GP27', actions: ['sprint'], labels: ['SPRINT'] },
  { id: 'gyro', name: 'MPU-6500 AIM', pin: 'GP4 SDA · GP5 SCL', gyro: true },
  { id: 'pot', name: 'POTENTIOMETER', pin: 'GP28', pot: true },
];
const GYRO_PASS_DEG = 12;
let gun = null;

function startGunCheck() {
  gun = {
    tiles: GUN_TILES.map(t => ({
      ...t, seen: new Set(), pinSeen: false, passed: false,
      yaw: 0, pitch: 0, yLo: 0, yHi: 0, pLo: 0, pHi: 0, dirs: new Set(),
      potLo: Infinity, potHi: -Infinity,
    })),
  };
  const host = $('gl-tiles');
  host.innerHTML = '';
  for (const t of gun.tiles) {
    const el = document.createElement('div');
    el.className = 'tile';
    let leds = '';
    if (t.actions) {
      const labels = t.labels || t.actions.map(a => codeName(S.binds[a][0]));
      leds = t.actions.map((a, i) => `<span class="led" data-a="${a}">${labels[i]}</span>`).join('');
      if (t.bit) leds += `<span class="led na" data-pin="1">PIN</span>`;
    } else if (t.gyro) {
      leds = ['←', '→', '↑', '↓'].map(l => `<span class="led" data-d="${l}">${l}</span>`).join('');
    } else if (t.pot) {
      leds = `<span class="led" data-lo="1">LOW</span><span class="led" data-hi="1">HIGH</span>`;
    }
    el.innerHTML = `<div class="tn">${t.name}</div><div class="tp">${t.pin}</div>
      <div class="leds">${leds}</div><div class="ts"></div>`;
    t.el = el;
    host.appendChild(el);
  }
  G.state = 'gun';
  document.activeElement?.blur?.();
  showOverlay('gun-live');
  input.resetLook();
  input.clearEdges();
  audio.resume();
  input.requestLock();
}

function gunStep(dt) {
  input.consumeLook(dt, { sensScale: 1, freeze: false });
  const degPerCount = S.sensitivity * 0.055;
  const tele = input.teleLive ? input.tele : null;
  let passed = 0, skipped = 0;

  for (const t of gun.tiles) {
    let active = false, status = '';
    if (t.actions) {
      for (const a of t.actions) {
        const on = input.isDown(a);
        if (input.wasPressed(a)) t.seen.add(a);
        active ||= on;
        const led = t.el.querySelector(`[data-a="${a}"]`);
        led.classList.toggle('on', on);
        led.classList.toggle('seen', t.seen.has(a));
      }
      if (t.bit) {
        const led = t.el.querySelector('[data-pin]');
        const pinOn = tele ? (tele.mask & t.bit) !== 0 : false;
        if (pinOn) t.pinSeen = true;
        led.classList.toggle('na', !tele);
        led.classList.toggle('on', pinOn);
        led.classList.toggle('seen', t.pinSeen);
        active ||= pinOn;
        if (tele && t.pinSeen && t.seen.size === 0) status = '<span class="warn">Pin works but no key reached the game — check the binding or firmware.</span>';
      }
      t.passed = t.seen.size === t.actions.length;
      if (!status) {
        const keys = t.actions.map(a => codeName(S.binds[a][0])).join(' / ');
        status = t.passed ? `receiving ${keys}` : `waiting for ${keys}`;
      }
    } else if (t.gyro) {
      t.yaw += input.lastCounts.x * degPerCount;
      t.pitch += input.lastCounts.y * degPerCount;
      t.yLo = Math.min(t.yLo, t.yaw); t.yHi = Math.max(t.yHi, t.yaw);
      t.pLo = Math.min(t.pLo, t.pitch); t.pHi = Math.max(t.pHi, t.pitch);
      if (t.yaw - t.yLo >= GYRO_PASS_DEG) t.dirs.add('→');
      if (t.yHi - t.yaw >= GYRO_PASS_DEG) t.dirs.add('←');
      if (t.pHi - t.pitch >= GYRO_PASS_DEG) t.dirs.add('↑');
      if (t.pitch - t.pLo >= GYRO_PASS_DEG) t.dirs.add('↓');
      active = Math.abs(input.lastCounts.x) + Math.abs(input.lastCounts.y) > 1.5;
      for (const l of ['←', '→', '↑', '↓']) t.el.querySelector(`[data-d="${l}"]`).classList.toggle('seen', t.dirs.has(l));
      t.passed = t.dirs.size === 4;
      status = tele && !tele.mpuOk
        ? '<span class="bad">Firmware reports the MPU-6500 is not responding.</span>'
        : t.passed ? 'swinging the gun moves the view' : `swing ${GYRO_PASS_DEG}° each way · ${input.stats.hz} reports/s`;
    } else if (t.pot) {
      if (tele) {
        t.potLo = Math.min(t.potLo, tele.pot); t.potHi = Math.max(t.potHi, tele.pot);
        const lo = t.potLo < 4095 * 0.15, hi = t.potHi > 4095 * 0.85;
        t.el.querySelector('[data-lo]').classList.toggle('seen', lo);
        t.el.querySelector('[data-hi]').classList.toggle('seen', hi);
        t.passed = lo && hi;
        status = `${Math.round(tele.pot / 40.95)}% · sensitivity ×${tele.sens.toFixed(2)} — turn it fully both ways`;
        active = false;
      } else if (t.passed) {
        status = 'full sweep seen (serial now quiet)';
      } else {
        status = 'connect USB serial to test (it has no key)';
        skipped++;
      }
    }
    if (t.passed) passed++;
    t.el.classList.toggle('active', active);
    t.el.classList.toggle('pass', t.passed);
    t.el.querySelector('.ts').innerHTML = status;
  }

  const total = gun.tiles.length;
  const cnt = $('gl-count');
  cnt.textContent = `${passed} / ${total} PASSED` + (skipped ? ` · ${skipped} NEEDS SERIAL` : '');
  cnt.classList.toggle('done', passed === total || passed === total - skipped);

  const sEl = $('gl-serial');
  sEl.textContent = tele ? `SERIAL: LIVE ${input.teleInfo ? '· ' + input.teleInfo : ''}` : (input.serial.connected ? 'SERIAL: OPEN, NO DATA' : 'SERIAL: NOT CONNECTED');
  sEl.classList.toggle('on', !!tele);
  $('gl-raw').classList.toggle('hidden', !tele);
  if (tele) {
    const nx = clamp(tele.jx / 2048, -1, 1), ny = clamp(tele.jy / 2048, -1, 1);
    const dot = $('gl-stick').firstElementChild;
    dot.style.left = (39 - nx * 39) + 'px';     // firmware convention: +x = LEFT
    dot.style.top = (39 - ny * 39) + 'px';      // +y = UP
    $('gl-stick-v').textContent = `x ${tele.jx} · y ${tele.jy}`;
    $('gl-pot').style.width = (tele.pot / 40.95).toFixed(1) + '%';
    $('gl-pot-v').textContent = `${Math.round(tele.pot / 40.95)}% · ×${tele.sens.toFixed(2)}`;
    $('gl-gx').textContent = tele.gx.toFixed(1);
    $('gl-gy').textContent = tele.gy.toFixed(1);
    $('gl-gz').textContent = tele.gz.toFixed(1);
    $('gl-info').textContent = tele.mpuOk ? (input.teleInfo || 'MPU OK') : 'MPU NOT RESPONDING';
  }
  input.endFrame();
}

function endGunCheck() {
  if (G.state !== 'gun') return;
  G.state = 'menu';
  input.exitLock();
  input.releaseAll();
  const items = gun.tiles.map(t => {
    const cls = t.passed ? 'ok' : (t.pot && !input.teleLive ? 'skip' : 'no');
    const txt = t.passed ? 'PASS' : cls === 'skip' ? 'NOT TESTED' : 'NOT SEEN';
    return `<div class="sumitem ${cls}">${t.name} — ${txt}</div>`;
  }).join('');
  const passed = gun.tiles.filter(t => t.passed).length;
  $('gun-summary').innerHTML = `<div class="sumhead">LAST RUN: ${passed} / ${gun.tiles.length} PASSED</div><div class="sumgrid">${items}</div>`;
  showOverlay('menu-gunprep');
}

// ============================================================ AIM TUNING SCREEN
let drift = null;
function startDriftTest() {
  drift = { t: 0, yaw: 0, pitch: 0 };
  $('calibresult').innerHTML = '<span class="warn">LAY THE GUN DOWN AND DON\'T TOUCH IT…</span>';
}

const traceCanvas = $('trace');
const tctx = traceCanvas.getContext('2d');

function calibStep(dt) {
  const look = input.consumeLook(dt, { sensScale: 1 });

  if (drift) {
    drift.t += dt;
    drift.yaw += look.yaw; drift.pitch += look.pitch;
    if (drift.t >= 5) {
      const deg = Math.hypot(drift.yaw, drift.pitch) / DEG;
      const rate = deg / drift.t;
      const grade = rate < 0.4 ? 'ok' : rate < 1.6 ? 'warn' : 'bad';
      $('calibresult').innerHTML = `DRIFT TEST: <span class="${grade}">${rate.toFixed(2)} deg/sec</span> ` +
        `(${deg.toFixed(1)}° over 5s).<br>` +
        (rate < 0.4 ? 'Rock solid — the boot-time gyro calibration on the Pico is good.'
          : rate < 1.6 ? 'Mild drift. Raise Drift Compensation to about ' + Math.ceil(rate * 1.4) + ', or hold the clutch for 3 s with the gun still to recalibrate.'
            : 'Heavy drift. Lay the gun flat and hold the clutch for 3 s to recalibrate the MPU-6500, then raise the Noise Deadzone.');
      drift = null;
    }
  }

  $('c-drift').textContent = input.stats.drift.toFixed(2);
  $('c-jitter').textContent = input.stats.jitter.toFixed(2);
  $('c-peak').textContent = Math.round(input.stats.peak);
  $('c-hz').textContent = input.stats.hz;

  const W = traceCanvas.width, H = traceCanvas.height;
  tctx.clearRect(0, 0, W, H);
  tctx.strokeStyle = 'rgba(255,255,255,.08)';
  tctx.beginPath(); tctx.moveTo(0, H / 2); tctx.lineTo(W, H / 2); tctx.stroke();
  const draw = (arr, color) => {
    tctx.strokeStyle = color; tctx.lineWidth = 1.4; tctx.beginPath();
    for (let i = 0; i < arr.length; i++) {
      const x = i / (input.trace.max - 1) * W;
      const y = H / 2 - clamp(arr[i] * 6, -H / 2 + 4, H / 2 - 4);
      i ? tctx.lineTo(x, y) : tctx.moveTo(x, y);
    }
    tctx.stroke();
  };
  draw(input.trace.raw, '#ff6a4d');
  draw(input.trace.filt, '#7ee081');
  input.endFrame();
}

// ============================================================ BOOT
applyVideo();
// Compile every shader the game can need up front, so the first shot, grenade or
// explosion doesn't hitch while the GPU builds a program.
{
  const hidden = [];
  const show = (o) => o.traverse(c => { if (!c.visible) { hidden.push(c); c.visible = true; } });
  fx.warmupObjects().forEach(show);
  loadout.slots.forEach(w => show(w.group));
  show(grenades.hand); show(grenades.arc); show(grenades.landMarker);
  bots.setCount(1, api);
  renderer.compile(scene, camera);
  renderer.compile(vmScene, vmCam);
  bots.setCount(0, api);
  hidden.forEach(o => { o.visible = false; });
  loadout.slots.forEach((w, i) => { w.group.visible = i === 0; });
}
hud.buildSlots(loadout);
player.pos.set(0, 0, 26);
camera.position.set(0, 1.6, 26);
showOverlay('menu-main');
$('loading').classList.add('hidden');
requestAnimationFrame(frame);

// exposed for debugging from the console
window.BA = {
  S, G, C, DYN, player, loadout, bots, input, world, grenades, startMatch, startGunCheck, endGunCheck, setDynScale, dynamicResolution,
  renderer, scene, get composer() { return composer; }, renderFrame: () => { if (composer) composer.render(); else renderer.render(scene, camera); renderer.autoClear = false; renderer.clearDepth(); renderer.render(vmScene, vmCam); renderer.autoClear = true; },
  shoot: () => playerShoot(G.time),
  useStreak: () => useStreak(G.time),
  // deterministic ticks, handy for testing without relying on requestAnimationFrame
  tick: (dt = 1 / 60) => { G.time += dt; step(dt); },
  gunTick: (dt = 1 / 60) => gunStep(dt),
};
