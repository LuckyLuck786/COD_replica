// BLACKOUT ARENA — renderer, match logic, grenades/streak glue, menus, remapping UI, Gun Check,
// aim tuning. Owns the render path and every screen.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import * as settingsMod from './settings.js';
import { ACTIONS, DEFAULT_BINDS, codeName } from './engine/controls.js';
import { Input } from './engine/input.js';
import { rayBoxes, clearLine } from './engine/physics.js';
import { audio } from './engine/audio.js';
import { GameMap } from './game/map.js';
import { Player } from './game/player.js';
import { Loadout, WEAPONS, WEAPON_ORDER } from './game/weapons.js';
import { BotManager } from './game/bots.js';
import { Grenades, FRAG } from './game/grenades.js';
import { fx } from './game/effects.js';
import { HUD } from './game/hud.js';

// ============================================================ settings + state
let S = settingsMod.load();
const G = {
  time: 0,
  mode: 'menu',      // 'menu' | 'playing' | 'paused' | 'over' | 'calib' | 'gun'
  matchMode: 'tdm',  // 'tdm' | 'range' | 'track'
  score: { player: 0, bots: 0 },
  matchEndsAt: 0,
  streaksEarned: 0,
  streakQueue: [],
  killstreakThresholds: [3, 5, 7],
  killStreakCount: 0,
  rangePlatesHit: 0,
  trackScore: 0,
  trackEndsAt: 0,
  cooking: false,
  cookStartedAt: 0,
  clutchActive: false,
  airstrikeQueue: [],
};

// ============================================================ boot
const boot = document.getElementById('boot-watchdog');
const bootMsg = document.getElementById('boot-msg');
function bootFail(msg) {
  bootMsg.textContent = msg;
  bootMsg.style.color = '#ff4433';
}
const bootWatchdog = setTimeout(() => bootFail('Still loading — WebGL2 may be unavailable, or a script failed. Check the console.'), 8000);

let renderer;
try {
  const canvas = document.getElementById('gl');
  renderer = new THREE.WebGLRenderer({
    canvas, antialias: S.video.quality === 'quality', desynchronized: true, powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false; // the level never moves — baked once, needsUpdate after changes
} catch (e) {
  bootFail('WebGL failed to initialize: ' + e.message);
  throw e;
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1016);
scene.fog = new THREE.Fog(0x0d1016, 40, 110);

const camera = new THREE.PerspectiveCamera(S.video.fov, 1, 0.05, 500);

// exactly one dynamic light, always present (Performance Rule 2)
const sun = new THREE.DirectionalLight(0xfff2d8, 2.2);
sun.position.set(30, 40, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -35; sun.shadow.camera.right = 35;
sun.shadow.camera.top = 35; sun.shadow.camera.bottom = -35;
sun.shadow.camera.far = 120;
scene.add(sun);
const hemi = new THREE.HemisphereLight(0x8899aa, 0x1a1812, 0.55);
scene.add(hemi);
const env = new THREE.PMREMGenerator(renderer).fromScene(new THREE.Scene(), 0.04);
scene.environment = env.texture;

const vmScene = new THREE.Scene();
const vmCamera = new THREE.PerspectiveCamera(72, 1, 0.01, 10);
vmScene.environment = scene.environment; // metals render black without an environment map (Bug 13)
const vmLight = new THREE.HemisphereLight(0xffffff, 0x222222, 1.1);
vmScene.add(vmLight);

const world = new GameMap();
scene.add(world.root);
world.root.add(fx.root);

const player = new Player(world.colliders);
const loadout = new Loadout(vmCamera, vmScene);
const grenades = new Grenades(world.colliders, (pos, g) => explode(pos, g));
world.root.add(grenades.root);

const bots = new BotManager(world.colliders, world.waypoints);
for (const b of []) {} // placeholder — bots added via setCount at match start
scene.add((() => { const g = new THREE.Group(); g.name = 'bots'; return g; })());
const botsGroup = scene.getObjectByName('bots');

const hud = new HUD();
const input = new Input(S);
input.acceptUnlocked = true;
input.attach(document.getElementById('view'));
input.onLockError = () => hud && hud.addKillfeed && hud.addKillfeed('POINTER LOCK REFUSED — click the view');

// ---------------------------------------------------------------- post-processing
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.5, 0.85);
bloomPass.enabled = false;
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// ============================================================ dynamic resolution
const DYN = { scale: 1, learnFrames: 0, refreshHz: 60, goodWindowT: 0, badWindowT: 0, windowBad: 0 };
function setDynScale(v, t) { DYN.scale = Math.max(0.7, Math.min(1, v)); resizeRenderer(); }
function dynamicResolution(dt, t) {
  if (!S.video.dynamicRes) return;
  if (dt > 0.25 || document.hidden) return; // ignore hidden tabs and big spikes
  if (DYN.learnFrames < 90) { DYN.learnFrames++; return; }
  const budget = 1 / DYN.refreshHz;
  if (dt > budget * 1.12) {
    DYN.badWindowT += dt;
    if (DYN.badWindowT > 0.5) {
      const drop = dt > budget * 1.4 ? 0.1 : 0.05;
      setDynScale(DYN.scale - drop, t);
      DYN.badWindowT = 0; DYN.goodWindowT = 0;
    }
  } else {
    DYN.badWindowT = 0;
    DYN.goodWindowT += dt;
    if (DYN.goodWindowT > 4) { setDynScale(DYN.scale + 0.05, t); DYN.goodWindowT = 0; }
  }
}

function resizeRenderer() {
  const w = window.innerWidth, h = window.innerHeight;
  const scale = S.video.renderScale * DYN.scale;
  renderer.setPixelRatio(Math.min(2, (window.devicePixelRatio || 1) * scale));
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  vmCamera.aspect = w / h; vmCamera.updateProjectionMatrix();
}
window.addEventListener('resize', resizeRenderer);
resizeRenderer();

// ============================================================ quality presets
function applyVideo() {
  camera.fov = S.video.fov; camera.updateProjectionMatrix();
  const lite = S.video.quality === 'performance' || S.video.quality === 'balanced';
  world.setLite(lite);
  renderer.shadowMap.enabled = S.video.quality !== 'performance' && S.video.shadows;
  sun.castShadow = renderer.shadowMap.enabled;
  bloomPass.enabled = S.video.quality === 'quality' && S.video.bloom;
  renderer.antialias = S.video.quality === 'quality';
  sun.shadow.needsUpdate = true;
  renderer.shadowMap.needsUpdate = true;
  resizeRenderer();
}
applyVideo();

// ============================================================ fx flash -> shared light
fx.onFlash = (pos, intensity) => {
  const orig = sun.intensity;
  sun.intensity = orig + intensity;
  setTimeout(() => { sun.intensity = orig; }, 90);
};

// ============================================================ warm-up compile
{
  const restore = fx.warmupObjects();
  renderer.compile(scene, camera);
  renderer.compile(vmScene, vmCamera);
  restore();
  renderer.shadowMap.needsUpdate = true;
}
clearTimeout(bootWatchdog);
boot.classList.add('hidden');

// ============================================================ menus / screens
const els = {
  hud: document.getElementById('hud'),
  capture: document.getElementById('capture-overlay'),
  main: document.getElementById('menu-main'),
  pause: document.getElementById('menu-pause'),
  settings: document.getElementById('menu-settings'),
  guncheck: document.getElementById('menu-guncheck'),
  aimtuning: document.getElementById('menu-aimtuning'),
  endmatch: document.getElementById('menu-endmatch'),
};
function showOnly(name) {
  for (const k of Object.keys(els)) {
    if (k === 'hud' || k === 'capture') continue;
    els[k].classList.toggle('hidden', k !== name);
  }
}
showOnly('main');
buildControlsList();

document.body.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  audio.ui();
  handleMenuAction(btn.dataset.action);
});

function handleMenuAction(action) {
  switch (action) {
    case 'start-tdm': startMatch('tdm'); break;
    case 'start-range': startMatch('range'); break;
    case 'start-track': startMatch('track'); break;
    case 'open-guncheck': startGunCheck(); break;
    case 'close-guncheck': endGunCheck(); break;
    case 'guncheck-connect': input.connectSerial(); break;
    case 'open-aimtuning': G.mode = 'calib'; showOnly('aimtuning'); break;
    case 'close-aimtuning': G.mode = G.matchMode && G._wasPlaying ? 'playing' : 'menu'; showOnly(G.mode === 'playing' ? null : 'main'); if (G.mode !== 'playing') showOnly('main'); break;
    case 'open-settings': buildSettingsUI(); showOnly('settings'); break;
    case 'close-settings': showOnly(G._prevMenu || 'main'); break;
    case 'resume': resumeMatch(); break;
    case 'quit': quitToMenu(); break;
    case 'rematch': startMatch(G.matchMode); break;
  }
}

function buildControlsList() {
  const el = document.getElementById('menu-controls-list');
  el.innerHTML = ACTIONS.filter((a) => a.pin).map((a) => {
    const b = S.binds[a.id] || DEFAULT_BINDS[a.id];
    return `<div>${a.name}: <b>${codeName(b[0])}</b></div>`;
  }).join('');
}

// ---------------------------------------------------------------- settings UI
function buildSettingsUI(tab = 'controls') {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  const body = document.getElementById('settings-body');
  body.innerHTML = '';
  if (tab === 'controls') {
    for (const a of ACTIONS) {
      const row = document.createElement('div');
      row.className = 'setting-row';
      const binds = S.binds[a.id] || ['', ''];
      row.innerHTML = `<span>${a.name}</span><span>
        <button class="bind-btn" data-bind="${a.id}" data-slot="0">${codeName(binds[0])}</button>
        <button class="bind-btn" data-bind="${a.id}" data-slot="1">${codeName(binds[1])}</button>
      </span>`;
      body.appendChild(row);
    }
    body.querySelectorAll('[data-bind]').forEach((btn) => {
      btn.addEventListener('click', () => {
        btn.classList.add('capturing'); btn.textContent = '…';
        input.captureNext((code) => {
          const action = btn.dataset.bind, slot = Number(btn.dataset.slot);
          // conflicts swapped: clear this code from any other binding first
          for (const other of Object.keys(S.binds)) {
            for (let i = 0; i < 2; i++) if (S.binds[other][i] === code) S.binds[other][i] = '';
          }
          S.binds[action][slot] = code;
          settingsMod.save(S);
          buildSettingsUI('controls');
          buildControlsList();
        });
      });
    });
  } else {
    const schema = settingsMod.SCHEMA[tab];
    for (const key of Object.keys(schema)) {
      const def = schema[key];
      const row = document.createElement('div');
      row.className = 'setting-row';
      const val = S[tab][key];
      if (def.type === 'bool') {
        row.innerHTML = `<span>${def.label}</span><input type="checkbox" ${val ? 'checked' : ''} />`;
        row.querySelector('input').addEventListener('change', (e) => { S[tab][key] = e.target.checked; onSettingChange(tab); });
      } else if (def.type === 'range') {
        row.innerHTML = `<span>${def.label}</span><span><input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${val}" /><b class="range-val">${val}</b></span>`;
        const input_ = row.querySelector('input');
        const label = row.querySelector('.range-val');
        input_.addEventListener('input', (e) => { S[tab][key] = Number(e.target.value); label.textContent = S[tab][key]; onSettingChange(tab); });
      } else if (def.type === 'select') {
        row.innerHTML = `<span>${def.label}</span><select>${def.opts.map(([v, l]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
        row.querySelector('select').addEventListener('change', (e) => { S[tab][key] = e.target.value; onSettingChange(tab); });
      }
      body.appendChild(row);
    }
  }
  tabs.forEach((t) => t.onclick = () => buildSettingsUI(t.dataset.tab));
}
function onSettingChange(tab) {
  settingsMod.save(S);
  if (tab === 'video') applyVideo();
}

function buildGunCheckTiles() {
  const wrap = document.getElementById('guncheck-tiles');
  const tiles = ['Trigger', 'Clutch', 'Reload', 'Prime', 'Aux', 'Stick Click', 'Joystick', 'MPU-6500', 'Stick Full Push', 'Potentiometer'];
  wrap.innerHTML = tiles.map((t) => `<div class="guncheck-tile" data-tile="${t}"><div>${t}</div><div class="pin-light"></div><div class="status">—</div></div>`).join('');
}
buildGunCheckTiles();

// ============================================================ match flow
function startMatch(mode) {
  G.matchMode = mode;
  G.mode = 'playing';
  G.time = 0;
  G.score.player = 0; G.score.bots = 0;
  G.streaksEarned = 0; G.streakQueue = []; G.killStreakCount = 0;
  G.rangePlatesHit = 0;
  G.trackScore = 0;
  G.matchEndsAt = performance.now() / 1000 + S.gameplay.matchMinutes * 60;
  G.trackEndsAt = performance.now() / 1000 + 30;
  G.cooking = false;
  G.clutchActive = false;
  G.airstrikeQueue = [];
  loadout.reset();

  const spawn = mode === 'range' ? world.rangeSpawn.clone() : world.randomSpawn();
  player.spawn(spawn);

  const botCount = mode === 'tdm' ? S.gameplay.botCount : 0;
  bots.setCount(botCount, S.gameplay.difficulty, () => world.randomSpawn(player.pos));
  botsGroup.clear();
  for (const b of bots.bots) botsGroup.add(b.mesh);

  showOnly(null); els.hud.classList.remove('hidden');
  input.requestLock();
  hud.addKillfeed(mode === 'tdm' ? 'MATCH START' : mode === 'range' ? 'FIRING RANGE' : 'TRACK: FOLLOW THE TARGET');
}

function pauseMatch() {
  if (G.mode !== 'playing') return;
  G.mode = 'paused';
  G._prevMenu = 'pause';
  showOnly('pause');
}
function resumeMatch() { G.mode = 'playing'; showOnly(null); input.requestLock(); }
function quitToMenu() { G.mode = 'menu'; showOnly('main'); buildControlsList(); }

function endMatch(titleText) {
  G.mode = 'over';
  document.getElementById('endmatch-title').textContent = titleText;
  document.getElementById('endmatch-stats').textContent =
    `SCORE  YOU ${G.score.player} — ${G.score.bots} BOTS`;
  showOnly('endmatch');
}

// ============================================================ Gun Check
function startGunCheck() {
  G.mode = 'gun'; G.gunCheckPass = {};
  showOnly('guncheck');
}
function endGunCheck() { G.mode = 'menu'; showOnly('main'); }

function updateGunCheck() {
  const st = input.serialState;
  const tiles = document.querySelectorAll('.guncheck-tile');
  const pinMap = { Trigger: 1, Clutch: 2, Reload: 4, Prime: 16, Aux: 32, 'Stick Click': 8 };
  for (const tile of tiles) {
    const name = tile.dataset.tile;
    let pass = G.gunCheckPass[name];
    if (name in pinMap) {
      const keyAction = { Trigger: 'fire', Clutch: 'clutch', Reload: 'reload', Prime: 'grenade', Aux: 'streak', 'Stick Click': 'jump' }[name];
      if (input.isDown(keyAction) || input.wasPressed(keyAction) || (name === 'Aux' && input.wasPressed('streak'))) pass = true;
      const pinOn = input.teleLive ? !!(st.mask & pinMap[name]) : false;
      tile.querySelector('.pin-light').classList.toggle('on', pinOn);
      if (input.teleLive && pinOn && !pass) tile.querySelector('.status').textContent = 'PIN OK, NO KEY';
    } else if (name === 'Joystick') {
      if (input.isDown('forward') || input.isDown('back') || input.isDown('left') || input.isDown('right')) pass = true;
    } else if (name === 'Stick Full Push') {
      if (input.isDown('sprint')) pass = true;
    } else if (name === 'MPU-6500') {
      G._mpuSwing = (G._mpuSwing || 0) + Math.abs(input.tele.filt || 0) * 0.001;
      if (G._mpuSwing > 12) pass = true;
    } else if (name === 'Potentiometer') {
      if (input.teleLive && st.pot) pass = true;
    }
    if (pass) { G.gunCheckPass[name] = true; tile.classList.add('pass'); tile.querySelector('.status').textContent = 'PASS'; }
  }
}

// ============================================================ shooting / hit detection
function botsHitList() {
  const list = [];
  for (const b of bots.bots) if (!b.dead) list.push(...b.hitboxes);
  return list;
}
const raycaster = new THREE.Raycaster();

function shoot() {
  const w = loadout.weapon;
  if (!loadout.canFire(G.time, isAdsActive())) { loadout.dryFire(); return; }
  const shot = loadout.fire(G.time);
  audio.shot(w.profile, 0);

  const origin = camera.position.clone();
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const spread = loadout.spread;
  dir.x += (Math.random() - 0.5) * spread;
  dir.y += (Math.random() - 0.5) * spread;
  dir.z += (Math.random() - 0.5) * spread;
  dir.normalize();

  const wallHit = rayBoxes(world.colliders, origin, dir, w.range);
  const maxDist = wallHit ? wallHit.distance : w.range;

  raycaster.set(origin, dir);
  raycaster.far = maxDist;
  const hits = raycaster.intersectObjects(botsHitList(), false);

  let endPoint = wallHit ? wallHit.point : origin.clone().addScaledVector(dir, w.range);

  if (hits.length) {
    const hit = hits[0];
    const bot = hit.object.userData.bot;
    const zone = hit.object.userData.zone;
    const distFrac = hit.distance / w.range;
    const falloff = 1 - Math.min(1, distFrac) * w.falloff;
    const mult = zone === 'head' ? w.headMult : zone === 'limb' ? w.limbMult : 1;
    const dmg = shot.dmg * mult * falloff;
    bot.damage(dmg, zone, G.time);
    endPoint = hit.point;
    hud.hitmarker_(bot.dead ? 'kill' : zone === 'head' ? 'head' : 'normal');
    audio.hit(zone === 'head');
    fx.spawnBurst(hit.point, 0xaa2222, 10, 3);
    if (bot.dead) onKill('bot', 'gun');
  } else if (wallHit) {
    fx.spawnDecal(wallHit.point, wallHit.normal);
    fx.spawnBurst(wallHit.point, 0xcccccc, 6, 2, false);
    audio.ric();
  }
  fx.spawnTracer(origin.clone().addScaledVector(dir, 0.3), endPoint);

  if (loadout.currentAmmo === 0 && S.gameplay.autoReload) loadout.startReload(G.time);
}

function onKill(who, cause) {
  if (who === 'bot') {
    G.score.player++;
    G.killStreakCount++;
    hud.addKillfeed(`YOU ☠ BOT (${cause.toUpperCase()})`);
    audio.kill();
    for (const t of G.killstreakThresholds) if (G.killStreakCount === t) G.streakQueue.push(t);
    if (G.matchMode === 'tdm' && G.score.player >= S.gameplay.scoreLimit) endMatch('VICTORY');
    respawnBot();
  }
}

function respawnBot() {
  setTimeout(() => {
    const dead = bots.bots.find((b) => b.dead);
    if (dead && G.mode === 'playing') dead.spawn(world.randomSpawn(player.pos));
  }, 2500);
}

function isAdsActive() {
  if (S.controls.adsMode === 'trigger') return input.isDown('fire') && loadout.weapon.type === 'bolt';
  if (S.controls.adsMode === 'toggle') return G._adsToggle;
  return input.isDown('aim');
}

// ============================================================ grenades / explosions
function explode(pos, g) {
  fx.spawnExplosion(pos);
  fx.spawnSmoke(pos, 10);
  audio.explosion(pos.distanceTo(player.pos));
  const noSelfDamage = G.matchMode !== 'tdm';

  const dPlayer = pos.distanceTo(player.pos);
  if (dPlayer < FRAG.radius) {
    const dmg = FRAG.damage * Math.pow(1 - dPlayer / FRAG.radius, 0.8);
    const exposed = clearLine(world.colliders, pos, player.camera.position);
    if (exposed && !(noSelfDamage && g.owner === 'player')) {
      const selfScale = g.owner === 'player' && dPlayer < 0.6 ? 999 : 1; // held to zero is always fatal
      player.damage(dmg * selfScale, G.time);
      hud.showDamageArrow(Math.atan2(pos.x - player.pos.x, pos.z - player.pos.z) - player.yaw);
      if (player.dead) onPlayerDeath();
    }
  }

  for (const b of bots.bots) {
    if (b.dead) continue;
    const d = b.pos.distanceTo(pos);
    if (d >= FRAG.radius) continue;
    const exposed = clearLine(world.colliders, pos, b.pos.clone().add(new THREE.Vector3(0, 1, 0)));
    if (!exposed) continue;
    const dmg = FRAG.damage * Math.pow(1 - d / FRAG.radius, 0.8);
    b.damage(dmg, 'body', G.time);
    if (b.dead) { hud.addKillfeed('YOU ☠ BOT (FRAG)'); G.score.player++; onKill('bot', 'frag'); }
  }

  if (G.matchMode === 'range') {
    // range plates knocked down count as hits
    G.rangePlatesHit++;
  }
}

function onPlayerDeath() {
  hud.addKillfeed('YOU DIED');
  setTimeout(() => {
    if (G.mode === 'playing') player.spawn(G.matchMode === 'range' ? world.rangeSpawn.clone() : world.randomSpawn());
  }, 1800);
}

// ============================================================ killstreaks
function useStreak() {
  if (!G.streakQueue.length) { hud.addKillfeed(`NO KILLSTREAK — ${3 - (G.killStreakCount % 3 || 3)} MORE FOR NEXT`); audio.denied(); return; }
  const tier = G.streakQueue.shift();
  audio.streak();
  if (tier === 3) { hud.setStreakBox('UAV ACTIVE'); setTimeout(() => hud.setStreakBox(''), 25000); }
  else if (tier === 5) queueAirstrike();
  else if (tier === 7) { loadout.reserve[loadout.weaponId] += loadout.weapon.reserve; hud.addKillfeed('RESUPPLY'); }
}

function queueAirstrike() {
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
  const origin = player.pos.clone();
  for (let i = 0; i < 6; i++) {
    const pos = origin.clone().addScaledVector(dir, 6 + i * 3.4);
    G.airstrikeQueue.push({ at: G.time + 1.4 + i * 0.16, pos });
  }
}
function updateAirstrike() {
  for (let i = G.airstrikeQueue.length - 1; i >= 0; i--) {
    if (G.time >= G.airstrikeQueue[i].at) {
      const { pos } = G.airstrikeQueue.splice(i, 1)[0];
      explode(pos, { owner: 'player' });
    }
  }
}

// ============================================================ per-frame gun actions
function handleGunActions(now) {
  if (G.mode === 'gun') { updateGunCheck(); return; }
  if (G.mode !== 'playing') return;

  // clutch: re-level view + freeze aim
  const clutchDown = input.isDown('clutch');
  if (S.controls.clutchRelevel && input.wasPressed('clutch')) player.pitch *= 0.15;
  G.clutchActive = clutchDown && S.controls.clutchFreeze;
  hud.setClutch(clutchDown);

  // grenade cook/throw
  if (S.controls.grenadeCook) {
    if (input.wasPressed('grenade') && grenades.countFor('player') < FRAG.max) {
      G.cooking = true; G.cookStartedAt = now;
    }
    if (G.cooking) {
      const frac = Math.min(1, (now - G.cookStartedAt) / FRAG.fuse);
      hud.setCookProgress(frac);
      if (S.controls.grenadeArc) {
        const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
        grenades.showArcPreview(camera.position, dir, FRAG.throwSpeed, FRAG.upBoost);
      }
      if (frac >= 1) {
        // held past fuse: kills you, gives the enemy no point
        player.damage(9999, now);
        onPlayerDeath();
        G.cooking = false;
        grenades.hideArcPreview();
        hud.setCookProgress(0);
      } else if (input.wasReleased('grenade')) {
        const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
        const origin = camera.position.clone().addScaledVector(dir, 0.4);
        grenades.throwGrenade(origin, dir, 'player', frac);
        G.cooking = false;
        grenades.hideArcPreview();
        hud.setCookProgress(0);
      }
    }
  } else if (input.wasPressed('grenade') && grenades.countFor('player') < FRAG.max) {
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    grenades.throwGrenade(camera.position.clone().addScaledVector(dir, 0.4), dir, 'player', 0);
  }
  hud.setGrenades(FRAG.max - grenades.countFor('player'), FRAG.max);

  // reload tap vs hold-to-swap
  if (input.wasPressed('reload')) G._reloadDownAt = now;
  if (S.controls.reloadHoldSwap && input.isDown('reload') && now - (G._reloadDownAt || now) >= S.controls.swapHoldTime && !G._reloadSwapped) {
    loadout.next(); G._reloadSwapped = true;
  }
  if (input.wasReleased('reload')) {
    if (!G._reloadSwapped) loadout.startReload(now);
    G._reloadSwapped = false;
  }
  if (input.wasPressed('swap')) loadout.next();

  // ADS toggle mode
  if (S.controls.adsMode === 'toggle' && input.wasPressed('aim')) G._adsToggle = !G._adsToggle;

  // firing — 0.15 s input buffer for semi-autos; sniper: press = scope, release = fire
  const w = loadout.weapon;
  if (w.type === 'bolt') {
    if (input.wasReleased('fire') && G._sniperScoping) { shoot(); G._sniperScoping = false; }
    if (input.isDown('fire')) G._sniperScoping = true; else if (!input.isDown('fire')) G._sniperScoping = G._sniperScoping && false;
  } else {
    if (input.wasPressed('fire')) G._fireBufferedAt = now;
    const buffered = G._fireBufferedAt != null && now - G._fireBufferedAt < 0.15;
    if ((input.isDown('fire') && w.type === 'auto') || (buffered && w.type === 'semi')) {
      if (loadout.canFire(now, isAdsActive())) { shoot(); G._fireBufferedAt = null; }
    }
  }

  // killstreak call-in
  if (input.wasPressed('streak')) {
    if (G.matchMode === 'range') {
      if (now >= (G._rangeStreakCd || 0)) { queueAirstrike(); G._rangeStreakCd = now + 4; useStreakSilent(); }
    } else useStreak();
  }
}
function useStreakSilent() { if (G.streakQueue.length) G.streakQueue.shift(); }

// ============================================================ frame loop
let lastT = performance.now() / 1000;
let fpsSamples = [];

function tick(dt) {
  G.time += dt;
  const now = G.time;
  input.updateTeleLive();

  if (G.mode === 'gun') { updateGunCheck(); input.endFrame(); return; }
  if (G.mode !== 'playing') { input.endFrame(); return; }

  if (input.wasPressed('swap') === undefined) {} // no-op guard
  if (document.pointerLockElement == null && !input.acceptUnlocked) { /* keep simulating */ }

  scene.updateMatrixWorld();
  handleRespawnChecks();

  const ads = isAdsActive();
  const scope = loadout.scoped;
  const look = input.consumeLook(dt, { ads, scope, targetSlowdown: 0 });
  if (!G.clutchActive) player.applyLook(look.dx, look.dy);
  loadout.addSway(look.dx, look.dy);

  player.update(dt, input, now, ads);

  loadout.update(dt, now, {
    ads, moving: input.isDown('forward') || input.isDown('back') || input.isDown('left') || input.isDown('right'),
    onGround: player.onGround, sprinting: player.sprinting, grenadeLower: G.cooking,
  });

  camera.position.copy(player.camera.position);
  camera.rotation.copy(player.camera.rotation);
  camera.updateMatrixWorld(true); // camera must be placed before shots use this frame's aim (Bug 9)

  handleGunActions(now);

  for (const b of bots.bots) {
    b.update(dt, now, player, grenades.live, (bot, dir, up) => {
      if (!S.gameplay.botGrenades) return true;
      if (!grenades.clearArc(bot.pos.clone().add(new THREE.Vector3(0, 1.4, 0)), dir, FRAG.throwSpeed, up)) return false;
      grenades.throwGrenade(bot.pos.clone().add(new THREE.Vector3(0, 1.4, 0)), dir, bot.id, 0);
      return true;
    }, (bot, targetPos, angErr, dist) => {
      const dir = new THREE.Vector3().subVectors(targetPos, bot.pos).normalize();
      dir.x += angErr; dir.z += angErr * 0.6;
      const hit = clearLine(world.colliders, bot.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), player.camera.position) && Math.abs(angErr) < 0.05;
      audio.shot('rifle', dist);
      fx.spawnTracer(bot.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), player.camera.position.clone());
      if (hit) {
        player.damage(bot.diff.dmg * 8, now);
        hud.showDamageArrow(Math.atan2(bot.pos.x - player.pos.x, bot.pos.z - player.pos.z) - player.yaw);
        if (player.dead) onPlayerDeath();
      }
    });
  }

  grenades.update(dt, now);
  updateAirstrike();
  fx.update(dt);
  updateHUD(now);
  input.endFrame();
}

function handleRespawnChecks() {
  if (G.matchMode === 'tdm' && performance.now() / 1000 > G.matchEndsAt) endMatch('TIME UP');
  if (G.matchMode === 'track' && performance.now() / 1000 > G.trackEndsAt) endMatch('TRACKING COMPLETE');
}

function updateHUD(now) {
  hud.setHealth(player.health, 100);
  hud.setAmmo(loadout.currentAmmo, loadout.currentReserve, loadout.weapon.name);
  hud.setCrosshair(loadout.spread, isAdsActive() && loadout.weapon.type !== 'bolt');
  hud.setScope(loadout.scoped, S.aim.scopeSensScale * 100);
  const tags = [];
  if (player.crouched) tags.push('CROUCH');
  if (player.sprinting) tags.push('SPRINT');
  if (player.sliding) tags.push('SLIDE');
  hud.setStance(tags);
  hud.update(1 / 60);
  hud.drawMinimap(now, player, bots.bots, 31);
}

// ============================================================ render frame
function renderFrame() {
  if (document.hidden || renderer.domElement.width === 0 || renderer.domElement.height === 0) return;
  vmCamera.position.copy(camera.position);
  vmCamera.rotation.copy(camera.rotation);
  if (bloomPass.enabled) composer.render();
  else renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(vmScene, vmCamera);
}

function frame(now) {
  requestAnimationFrame(frame);
  const t = now / 1000;
  const dt = Math.min(0.1, t - lastT);
  lastT = t;

  fpsSamples.push(1 / Math.max(dt, 1e-4));
  if (fpsSamples.length > 30) fpsSamples.shift();
  const fps = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
  hud.setFps(fps, S.video.renderScale * DYN.scale, S.video.showFps);

  dynamicResolution(dt, t);
  tick(dt);
  renderFrame();
}
requestAnimationFrame(frame);

// ============================================================ keyboard: pause / escape
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (G.mode === 'playing') pauseMatch();
    else if (G.mode === 'paused') resumeMatch();
  }
});

// ============================================================ debug hooks (required by acceptance tests)
window.BA = {
  tick, gunTick: tick, shoot, useStreak,
  startMatch, startGunCheck, endGunCheck,
  dynamicResolution, setDynScale, renderFrame,
  S, G, C: S.controls, DYN,
  player, loadout, bots, input, world, grenades, renderer, scene, composer,
};
