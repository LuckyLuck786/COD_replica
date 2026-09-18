// All DOM HUD updates: health, ammo, crosshair, hitmarkers, killfeed, damage arrows, minimap.
const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(world) {
    this.el = {
      hud: $('hud'), cross: $('crosshair'), hit: $('hitmarker'), scope: $('scope'),
      hp: $('healthfill'), hpNum: $('healthnum'), ammo: $('ammo'), mag: $('ammo-mag'),
      res: $('ammo-res'), wname: $('weaponname'), reload: $('reloadhint'), slots: $('weaponslots'),
      you: $('score-you'), them: $('score-them'), timer: $('timer'), feed: $('killfeed'),
      streak: $('streak-banner'), vig: $('hurt-vignette'), flash: $('flash'), dmg: $('dmg-indicators'),
      stance: $('stancetag'), motion: $('motiontag'), perf: $('perfstat'), uav: $('uavtag'),
      mini: $('minimap'),
      gren: $('grenades'), grenCount: $('gren-count'), cook: $('cookring'), cookText: $('cooktext'),
      danger: $('danger'), clutch: $('clutchtag'), sReady: $('streak-ready'), sNext: $('streak-next'),
      swapHint: $('swaphint'),
    };
    this._dangerKey = '';
    this._streakKey = '';
    this._cache = new Map();
    this._miniAt = 0;
    this.mctx = this.el.mini.getContext('2d');
    this.hitUntil = 0;
    this.indicators = [];
    this.feedItems = [];
    this.streakUntil = 0;

    // static minimap footprints (anything low enough to read as a wall/crate)
    this.foot = world.colliders
      .filter(c => c.max.y > 0.6 && (c.max.x - c.min.x) < 200 && (c.max.z - c.min.z) < 200)
      .map(c => ({ x: c.min.x, z: c.min.z, w: c.max.x - c.min.x, d: c.max.z - c.min.z, h: c.max.y }));
  }

  // Writing to the DOM forces style work even when the value is identical, so every
  // per-frame write goes through these and is skipped when nothing changed.
  _text(el, v) { if (this._cache.get(el) !== v) { this._cache.set(el, v); el.textContent = v; } }
  _style(el, prop, v) {
    const k = el.id + '|' + prop;
    if (this._cache.get(k) !== v) { this._cache.set(k, v); el.style.setProperty(prop, v); }
  }
  _cls(el, name, on) {
    const k = el.id + '.' + name;
    if (this._cache.get(k) !== on) { this._cache.set(k, on); el.classList.toggle(name, on); }
  }

  buildSlots(loadout) {
    this.el.slots.innerHTML = '';
    loadout.slots.forEach((s, i) => {
      const d = document.createElement('div');
      d.className = 'slot' + (i === loadout.index ? ' active' : '');
      d.textContent = s.def.name.split(' ')[0];
      this.el.slots.appendChild(d);
    });
  }

  setSlot(i) {
    [...this.el.slots.children].forEach((c, j) => c.classList.toggle('active', i === j));
  }

  hitmark(kind, now) {
    this.el.hit.className = 'on' + (kind === 'kill' ? ' kill' : kind === 'head' ? ' head' : '');
    this.hitUntil = now + 0.13;
  }

  kill(killer, victim, weapon, isPlayer) {
    const d = document.createElement('div');
    d.className = 'kf';
    d.innerHTML = `<span class="${isPlayer ? 'k' : 'v'}">${killer}</span><span class="w">${weapon}</span><span class="v">${victim}</span>`;
    this.el.feed.appendChild(d);
    this.feedItems.push({ el: d, until: performance.now() / 1000 + 6 });
    while (this.el.feed.children.length > 5) {
      this.el.feed.removeChild(this.el.feed.firstChild);
      this.feedItems.shift();
    }
  }

  damageFrom(angleRad) {
    const d = document.createElement('div');
    d.className = 'dmgind';
    d.style.transform = `rotate(${angleRad}rad)`;
    this.el.dmg.appendChild(d);
    this.indicators.push({ el: d, until: performance.now() / 1000 + 1.4 });
  }

  banner(text, now, dur = 2.4) {
    this.el.streak.textContent = text;
    this.el.streak.classList.add('on');
    this.streakUntil = now + dur;
  }

  screenFlash(a = 0.5) {
    this.el.flash.style.transition = 'none';
    this.el.flash.style.opacity = a;
    requestAnimationFrame(() => {
      this.el.flash.style.transition = 'opacity .35s';
      this.el.flash.style.opacity = 0;
    });
  }

  update(now, st) {
    const e = this.el;

    // health
    const hp = Math.ceil(Math.max(0, st.hp));
    this._style(e.hp, 'width', hp + '%');
    this._cls(e.hp, 'low', st.hp < 35);
    this._text(e.hpNum, String(hp));
    this._style(e.vig, 'opacity', st.hp < 60 ? ((60 - st.hp) / 60 * 0.9).toFixed(2) : '0');

    // ammo
    this._text(e.mag, String(st.ammo));
    this._text(e.res, String(st.reserve));
    this._cls(e.ammo, 'empty', st.ammo === 0);
    this._text(e.wname, st.weaponName);
    this._cls(e.reload, 'hidden', !(st.ammo === 0 || st.reloading));
    if (st.reloading) this._text(e.reload, 'RELOADING…');
    else if (st.ammo === 0) this._text(e.reload, st.reserve > 0 ? `PRESS ${st.reloadKey} TO RELOAD` : 'NO AMMO');

    // crosshair (rounded, so tiny spread changes don't restyle every frame)
    this._style(e.cross, '--gap', Math.round(Math.max(3, st.spreadPx)) + 'px');
    this._style(e.cross, 'opacity', st.scoped ? '0' : '1');
    this._cls(e.scope, 'hidden', !st.scoped);

    if (now > this.hitUntil && e.hit.className) e.hit.className = '';

    // stance / motion tags
    this._text(e.stance, st.dead ? 'DOWN' : st.crouching ? 'CROUCH' : st.sprinting ? 'SPRINT' : 'STAND');
    this._cls(e.motion, 'hidden', !st.motion);

    // score / timer
    this._text(e.you, String(st.scoreYou));
    this._text(e.them, String(st.scoreThem));
    if (st.timerText) this._text(e.timer, st.timerText);
    else {
      const m = Math.floor(st.timeLeft / 60), s = Math.floor(st.timeLeft % 60);
      this._text(e.timer, `${m}:${String(s).padStart(2, '0')}`);
    }
    this._text(e.perf, st.showFps ? `${st.fps} FPS${st.resPct ? ` · RES ${st.resPct}%` : ''}` : '');
    this._cls(e.uav, 'hidden', !st.uav);

    if (now > this.streakUntil) this._cls(e.streak, 'on', false);

    // expiring elements
    const t = performance.now() / 1000;
    if (this.indicators.length) {
      this.indicators = this.indicators.filter(i => {
        if (t > i.until) { i.el.remove(); return false; }
        if (t > i.until - 0.4) i.el.style.opacity = 0;
        return true;
      });
    }
    if (this.feedItems.length) {
      this.feedItems = this.feedItems.filter(i => {
        if (t > i.until) { i.el.remove(); return false; }
        return true;
      });
    }

    // grenades
    this._text(e.grenCount, st.grenInfinite ? '∞' : String(st.grenades));
    this._cls(e.gren, 'empty', !st.grenInfinite && st.grenades <= 0);
    this._cls(e.gren, 'inf', !!st.grenInfinite);
    if (st.cook > 0) {
      this._cls(e.cook, 'hidden', false);
      this._style(e.cook, '--p', st.cook.toFixed(2));
      this._cls(e.cook, 'hot', st.cook > 0.7);
      this._text(e.cookText, `FUSE ${st.cookLeft.toFixed(1)}s`);
    } else this._cls(e.cook, 'hidden', true);

    // incoming grenade warnings (rebuilt only when the set changes)
    const key = st.dangers.map(d => d.angle.toFixed(1) + '/' + Math.round(d.dist)).join(',');
    if (key !== this._dangerKey) {
      this._dangerKey = key;
      e.danger.innerHTML = st.dangers.map(d => {
        const r = 70 + d.dist * 5;
        const x = Math.sin(d.angle) * r, y = -Math.cos(d.angle) * r;
        return `<div class="dangerind" style="transform:translate(${x.toFixed(0)}px,${y.toFixed(0)}px)"><i class="nade"></i></div>`;
      }).join('');
    }

    this._cls(e.clutch, 'hidden', !st.clutch);
    this._text(e.swapHint, st.swapHint);

    // killstreaks
    const sk = st.streakReady.join('|') + '#' + st.streakNext;
    if (sk !== this._streakKey) {
      this._streakKey = sk;
      e.sReady.innerHTML = st.streakReady.map((n, i) =>
        `<span class="sr">${i === 0 ? st.streakKey + ' ▸ ' : ''}${n}</span>`).join('');
      e.sNext.innerHTML = st.streakNext;
    }

    // the minimap only needs ~20 updates a second
    if (t - this._miniAt > 0.05) { this._miniAt = t; this.minimap(st); }
  }

  minimap(st) {
    const c = this.mctx, W = 180, HH = 90, scale = 2.05;
    c.clearRect(0, 0, W, W);
    c.save();
    c.translate(HH, HH);
    c.rotate(st.yaw);            // rotating map, player always faces up
    c.translate(-st.px * scale, -st.pz * scale);

    c.fillStyle = 'rgba(150,165,158,.16)';
    c.strokeStyle = 'rgba(190,205,198,.30)';
    c.lineWidth = 1;
    for (const f of this.foot) {
      const dx = f.x + f.w / 2 - st.px, dz = f.z + f.d / 2 - st.pz;
      if (dx * dx + dz * dz > 3200) continue;
      c.fillRect(f.x * scale, f.z * scale, f.w * scale, f.d * scale);
      c.strokeRect(f.x * scale, f.z * scale, f.w * scale, f.d * scale);
    }

    // live grenades
    for (const g of st.nades || []) {
      c.fillStyle = g.enemy ? '#ffb02e' : '#7ee081';
      c.fillRect(g.x * scale - 2, g.z * scale - 2, 4, 4);
    }

    // hostiles
    for (const b of st.blips) {
      c.fillStyle = '#ff4433';
      c.beginPath();
      c.arc(b.x * scale, b.z * scale, 3.2, 0, 7);
      c.fill();
    }
    c.restore();

    // player arrow
    c.save();
    c.translate(HH, HH);
    c.fillStyle = '#7ee081';
    c.beginPath(); c.moveTo(0, -6); c.lineTo(4.5, 5); c.lineTo(0, 2.5); c.lineTo(-4.5, 5);
    c.closePath(); c.fill();
    c.restore();
  }
}
