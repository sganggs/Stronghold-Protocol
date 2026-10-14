// public/js/render/fx/arrivals.js — FxSystem deploy, promotion, death, crates and pops.
// Installed on FxSystem.prototype by ./system.js (a method container: never instantiated; `this` is the effect system).

import { COLORS, DMG_STYLE } from '../style.js';
import { SKILL_GOLD, easeOut } from './limits.js';

export class FxArrivals {
  /**
   * A unit arrives: a pillar, a ring and a few sparks. `o.beam` (the operators carried onto the 联防 field; render/app.js
   * syncBattle): it beams in instead — a tall pale-blue column from above with a white-hot core, a flash and a
   * shockwave at its feet (the event's 联防, video 8:42).
   * @param {any} view @param {{ beam?: boolean }} [o]
   */
  deploy(view, o = null) {
    if (!view) return;
    const p = this._proj(view.x, view.y, view.z || 0);
    const s = p.s;
    if (o && o.beam) {
      const ice = 0xa9e6ff;
      this.particle('pillar', p.x, p.y, { tint: ice, life: 0.62, s0: (s / 64) * 2.7, s1: (s / 64) * 3, a0: 0.8, a1: 0, sx: 0.34, ay: 1 });
      this.particle('pillar', p.x, p.y, { tint: 0xffffff, life: 0.42, s0: (s / 64) * 2.5, s1: (s / 64) * 2.7, a0: 1, a1: 0, sx: 0.11, ay: 1 });
      this.particle('glow', p.x, p.y - s * 0.1, { tint: 0xe8f8ff, life: 0.34, s0: (s / 128) * 1.1, s1: (s / 128) * 2.1, a0: 1, a1: 0 });
      this.ring(view.x, view.y, view.z || 0, 0.12, 1.05, ice, 0.5, 'shock');
      this.ring(view.x, view.y, view.z || 0, 0.1, 0.75, 0xffffff, 0.36);
      this.burst(p.x, p.y, s, this.rich ? 10 : 5, 0xdff6ff, { speed: 1.7, up: 0.7, life: 0.55, tex: 'dot' });
      return;
    }
    const col = view.isEnemy ? 0xff6a5a : 0x9ff0dc;
    this.particle('pillar', p.x, p.y, { tint: col, life: 0.45, s0: s / 64 * 0.7, s1: s / 64 * 0.2, a0: 0.9, a1: 0, sx: 1, ay: 1 });
    this.ring(view.x, view.y, view.z || 0, 0.1, 0.8, col, 0.45);
    this.burst(p.x, p.y, s, 6, col, { speed: 1.6, up: 0.4, life: 0.4, tex: 'dot' });
  }

  /**
   * Promotion (精锐晋升, a merge) at the elite's spot — the board tile of the consumed copy it replaced (PRTS 卫戍协议/
   * 帮助 "若消耗已部署至作战区的干员，则发送至作战区对应位置") or its bench slot: a gold pillar with a white core, a shockwave
   * and a hex ring on the ground, rising motes; `from` = world points of the other consumed copies (gold streaks from
   * them to the elite). Counted in `promotions` (render/app.js setPrep; tests).
   * @param {any} view
   * @param {Array<{ x: number, y: number, z?: number }>} [from]
   */
  promote(view, from = []) {
    if (!view) return;
    this.promotions = (this.promotions || 0) + 1;
    const z = view.z || 0;
    const g = this._proj(view.x, view.y, z, this._g);
    const gx = g.x, gy = g.y, s = g.s;
    for (const f of from) if (f && Number.isFinite(f.x) && Number.isFinite(f.y)) this.streak(f.x, f.y, view.x, view.y, Math.max(z, f.z || 0) + 0.3, SKILL_GOLD, 0.45);
    this.particle('pillar', gx, gy, { tint: SKILL_GOLD, life: 0.8, s0: (s / 64) * 1.1, s1: (s / 64) * 1.4, a0: 0.95, a1: 0, sx: 0.85, ay: 1 });
    this.particle('pillar', gx, gy, { tint: 0xffffff, life: 0.42, s0: (s / 64) * 0.9, s1: (s / 64) * 1.2, a0: 0.9, a1: 0, sx: 0.3, ay: 1 });
    this.ring(view.x, view.y, z, 0.15, 1.6, 0xffe7a0, 0.5, 'shock');
    this.ring(view.x, view.y, z, 0.3, 1.2, SKILL_GOLD, 0.7, 'hex');
    const c = this._chest(view, this._q);
    this.burst(c.x, c.y, s, this.rich ? 12 : 5, 0xffe28a, { speed: 1.5, up: 1.8, life: 0.8, tex: 'dot', size: 0.36 });
  }

  death(view) {
    if (!view) return;
    const p = this._chest(view);
    const s = p.s;
    const col = view.isEnemy ? 0xff7a52 : 0xbfeee2;
    const n = this.quality === 'low' ? 5 : 12;
    for (let i = 0; i < n; i++) {
      this.particle(i % 3 ? 'dot' : 'shard', p.x + (Math.random() - 0.5) * s * 0.5, p.y + (Math.random() - 0.3) * s * 0.6, {
        tint: col, vx: (Math.random() - 0.5) * s * 0.6, vy: -s * (0.4 + Math.random() * 0.8), drag: 1.5,
        life: 0.7 + Math.random() * 0.5, s0: s / 32 * 0.12, s1: 0, a0: 0.9, a1: 0, spin: (Math.random() - 0.5) * 6,
      });
    }
    this.particle('smoke', p.x, p.y, { add: false, tint: 0x1a1a1a, life: 0.8, s0: s / 128 * 0.6, s1: s / 128 * 1.4, a0: 0.5, a1: 0 });
  }

  crateBreak(x, y, z, tint = null) {
    const p = this._proj(x, y, (z || 0) + 0.35);
    const s = p.s;
    for (let i = 0; i < (this.quality === 'low' ? 4 : 10); i++) {
      this.particle('shard', p.x, p.y, {
        add: false, tint: tint ?? (i % 2 ? 0xc89a5a : 0x9a6d38), vx: (Math.random() - 0.5) * s * 2.2, vy: -s * (0.6 + Math.random()), g: s * 4,
        life: 0.6, s0: s / 32 * 0.25, s1: s / 32 * 0.15, a0: 1, a1: 0.2, spin: (Math.random() - 0.5) * 14,
      });
    }
    this.particle('smoke', p.x, p.y, { add: false, tint: 0x8a7a60, life: 0.7, s0: s / 128 * 0.6, s1: s / 128 * 1.5, a0: 0.45, a1: 0 });
  }

  /** Screen-space pop (bond layer gain / bounty coins). `icon` = texture or null. */
  pop(icon, label, tint, i = 0) {
    const P = this.P;
    const size = this.ctx.screenSize();
    const top = this.ctx.fieldTop ? this.ctx.fieldTop() : size.height * 0.2;
    const c = new P.Container();
    const x = size.width / 2 + (i % 5 - 2) * 70;
    c.position.set(x, top);
    if (icon) {
      const glow = new P.Sprite(this.tex.glow);
      glow.anchor.set(0.5); glow.tint = tint; glow.blendMode = P.BLEND_MODES.ADD; glow.scale.set(0.9);
      const sp = new P.Sprite(icon);
      sp.anchor.set(0.5);
      sp.tint = tint;
      // 46 px along its longer side. A bond icon (app.js 'layer': PIXI.Texture.from(url)) is a 1×1 placeholder until
      // its image has loaded: sized from that it was drawn 46× too big, ~5000 px over the whole screen for the pop's
      // 1.4 s (user playtest #4 item 13) — so it is sized once its texture is valid, and hidden until then.
      const fit = () => {
        if (sp.destroyed) return;
        sp.scale.set(46 / Math.max(1, icon.width, icon.height));
        sp.visible = true;
      };
      if (icon.valid) fit();
      else { sp.visible = false; icon.once('update', fit); }
      c.addChild(glow, sp);
    }
    if (label) {
      const t = new P.BitmapText(label, { fontName: DMG_STYLE.heal.font, fontSize: 26 });
      t.anchor.set(0, 0.5);
      t.position.set(26, 0);
      if (tint === COLORS.gold) t.tint = 0xffe066;
      c.addChild(t);
    }
    this.ctx.layers.screen.addChild(c);
    this.pops.push({ c, t: 0, dur: 1.4, y0: top });
    if (this.pops.length > 12) { const o = this.pops.shift(); o.c.destroy({ children: true }); }
  }

  _updatePops(dt) {
    let w = 0;
    for (const p of this.pops) {
      p.t += dt;
      if (p.t >= p.dur) { p.c.destroy({ children: true }); continue; }
      const k = p.t / p.dur;
      p.c.position.y = p.y0 - 40 * easeOut(k);
      p.c.alpha = k < 0.15 ? k / 0.15 : k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      const s = k < 0.15 ? 0.6 + (k / 0.15) * 0.5 : 1.1 - Math.min(0.1, (k - 0.15));
      p.c.scale.set(s);
      this.pops[w++] = p;
    }
    this.pops.length = w;
  }
}
