// HUD: health, ammo, weapon, crosshair, hitmarkers, scope overlay, killfeed, damage-direction
// arrows, grenade count/cook ring, incoming-grenade markers, clutch tag, killstreak box, stance
// tags, FPS/resolution readout, and a rotating minimap.
// Every per-frame write goes through _text/_style/_cls, which skip writes when the value is
// unchanged (a DOM write forces style recalculation even when identical to the last value).

function q(id) { return document.getElementById(id); }

function _text(el, v) { if (!el) return; if (el.__last !== v) { el.textContent = v; el.__last = v; } }
function _style(el, prop, v) { if (!el) return; const k = '__s_' + prop; if (el[k] !== v) { el.style[prop] = v; el[k] = v; } }
function _cls(el, cls, on) { if (!el) return; const k = '__c_' + cls; if (el[k] !== on) { el.classList.toggle(cls, on); el[k] = on; } }

export class HUD {
  constructor() {
    this.healthFill = q('hud-health-fill');
    this.healthText = q('hud-health-text');
    this.ammoText = q('hud-ammo');
    this.reserveText = q('hud-reserve');
    this.weaponName = q('hud-weapon-name');
    this.crosshair = q('hud-crosshair');
    this.hitmarker = q('hud-hitmarker');
    this.scopeOverlay = q('hud-scope');
    this.killfeed = q('hud-killfeed');
    this.damageArrows = q('hud-damage-arrows');
    this.grenadeCount = q('hud-grenade-count');
    this.cookRing = q('hud-cook-ring');
    this.incomingWrap = q('hud-incoming');
    this.clutchTag = q('hud-clutch-tag');
    this.streakBox = q('hud-streak-box');
    this.stanceTags = q('hud-stance');
    this.fpsText = q('hud-fps');
    this.minimap = q('hud-minimap');
    this.minimapCtx = this.minimap ? this.minimap.getContext('2d') : null;
    this._minimapAt = 0;
    this._hitmarkerT = 0;
  }

  setHealth(hp, max) {
    _style(this.healthFill, 'width', Math.max(0, (hp / max) * 100) + '%');
    _text(this.healthText, Math.max(0, Math.round(hp)));
    _cls(this.healthFill, 'low', hp < max * 0.3);
  }

  setAmmo(mag, reserve, weaponName) {
    _text(this.ammoText, mag);
    _text(this.reserveText, reserve);
    _text(this.weaponName, weaponName);
    _cls(this.ammoText, 'empty', mag === 0);
  }

  setCrosshair(spread, ads) {
    _cls(this.crosshair, 'hidden', ads);
    const px = Math.round(8 + spread * 260);
    _style(this.crosshair, 'width', px + 'px');
    _style(this.crosshair, 'height', px + 'px');
  }

  hitmarker_(kind) {
    // kind: 'normal' | 'head' | 'kill'
    _cls(this.hitmarker, 'show', true);
    _cls(this.hitmarker, 'head', kind === 'head');
    _cls(this.hitmarker, 'kill', kind === 'kill');
    this._hitmarkerT = 0.25;
  }

  setScope(active, zoomPct) {
    _cls(this.scopeOverlay, 'show', active);
    if (active) _style(this.scopeOverlay, 'transform', `scale(${1 + zoomPct * 0.001})`);
  }

  addKillfeed(text, cls = '') {
    if (!this.killfeed) return;
    const row = document.createElement('div');
    row.className = 'killfeed-row' + (cls ? ' ' + cls : '');
    row.textContent = text;
    this.killfeed.appendChild(row);
    setTimeout(() => row.remove(), 4500);
    while (this.killfeed.children.length > 5) this.killfeed.removeChild(this.killfeed.firstChild);
  }

  showDamageArrow(angleRad) {
    if (!this.damageArrows) return;
    const arrow = document.createElement('div');
    arrow.className = 'dmg-arrow';
    arrow.style.transform = `rotate(${angleRad}rad)`;
    this.damageArrows.appendChild(arrow);
    setTimeout(() => arrow.remove(), 900);
  }

  setGrenades(count, max) { _text(this.grenadeCount, `${count}/${max}`); }
  setCookProgress(frac) {
    _cls(this.cookRing, 'show', frac > 0);
    _style(this.cookRing, 'background', `conic-gradient(#ffb02e ${frac * 360}deg, transparent 0deg)`);
  }

  setIncomingMarkers(list) {
    if (!this.incomingWrap) return;
    this.incomingWrap.innerHTML = '';
    for (const angle of list) {
      const m = document.createElement('div');
      m.className = 'incoming-marker';
      m.style.transform = `rotate(${angle}rad) translate(0, -120px)`;
      this.incomingWrap.appendChild(m);
    }
  }

  setClutch(active) { _cls(this.clutchTag, 'show', active); }

  setStreakBox(text) { _text(this.streakBox, text); _cls(this.streakBox, 'show', !!text); }

  setStance(tags) { _text(this.stanceTags, tags.join(' · ')); }

  setFps(fps, resPct, show) {
    _cls(this.fpsText, 'hidden', !show);
    if (show) _text(this.fpsText, `${Math.round(fps)} FPS · ${Math.round(resPct * 100)}%`);
  }

  drawMinimap(now, player, bots, mapHalfSize) {
    if (!this.minimapCtx) return;
    if (now - this._minimapAt < 1 / 20) return;
    this._minimapAt = now;
    const ctx = this.minimapCtx;
    const size = this.minimap.width;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-player.yaw);
    ctx.fillStyle = 'rgba(20,24,18,0.7)';
    ctx.beginPath(); ctx.arc(0, 0, size / 2, 0, Math.PI * 2); ctx.fill();
    const scale = (size / 2 - 6) / mapHalfSize;
    for (const b of bots) {
      if (b.dead) continue;
      const dx = (b.pos.x - player.pos.x) * scale;
      const dz = (b.pos.z - player.pos.z) * scale;
      ctx.fillStyle = '#ff4433';
      ctx.beginPath(); ctx.arc(dx, dz, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = '#7ee081';
    ctx.beginPath();
    ctx.moveTo(size / 2, size / 2 - 6);
    ctx.lineTo(size / 2 - 4, size / 2 + 4);
    ctx.lineTo(size / 2 + 4, size / 2 + 4);
    ctx.closePath(); ctx.fill();
  }

  update(dt) {
    if (this._hitmarkerT > 0) {
      this._hitmarkerT -= dt;
      if (this._hitmarkerT <= 0) { _cls(this.hitmarker, 'show', false); _cls(this.hitmarker, 'head', false); _cls(this.hitmarker, 'kill', false); }
    }
  }
}
