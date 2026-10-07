// public/js/render/fx/rings.js — FxSystem ground rings and skill auras.
// Installed on FxSystem.prototype by ./system.js (a method container: never instantiated; `this` is the effect system).

import { SKILL_GOLD, easeOut } from './limits.js';

export class FxRings {
  // ---- rings / auras -----------------------------------------------------------------------------------------

  /**
   * Ground ring going from r0 to r1 tiles over `dur` real seconds (easing out, fading). `mode` 'in': a warning closing
   * in — linear, brightening towards its end; 'pulse': throbbing at full size until its end.
   */
  ring(x, y, z, r0, r1, tint, dur = 0.4, tex = 'ring', mode = null) {
    const P = this.P;
    let r = this.ringFree.pop();
    if (!r) {
      const sp = new P.Sprite(this.tex[tex]);
      sp.anchor.set(0.5);
      sp.blendMode = P.BLEND_MODES.ADD;
      this.ctx.layers.groundFx.addChild(sp);
      r = { sp };
    }
    r.sp.texture = this.tex[tex] || this.tex.ring;
    r.sp.visible = true;
    r.sp.tint = tint;
    r.sp.alpha = 0;
    this._onGround(r.sp, y, z);
    r.x = x; r.y = y; r.z = z; r.r0 = r0; r.r1 = r1; r.t = 0; r.dur = Math.max(0.01, dur); r.mode = mode;
    this.rings.push(r);
    if (this.rings.length > 80) { const o = this.rings.shift(); o.sp.visible = false; this.ringFree.push(o); }
  }

  _updateRings(dt) {
    const cam = this.ctx.cam();
    const p = this._p, q = this._q;
    let w = 0;
    for (const r of this.rings) {
      r.t += dt;
      if (r.t >= r.dur) { r.sp.visible = false; this.ringFree.push(r); continue; }
      const u = r.t / r.dur;
      const k = r.mode === 'in' ? u : easeOut(u);
      const rad = r.r0 + (r.r1 - r.r0) * k;
      cam.project(r.x, r.y, r.z + 0.01, p);
      cam.project(r.x, r.y + rad, r.z + 0.01, q);
      const rx = p.s * rad, ry = Math.max(1, p.y - q.y);
      r.sp.position.set(p.x, p.y);
      r.sp.scale.set((rx * 2) / 128, (ry * 2) / 128);
      r.sp.alpha = r.mode === 'in' ? 0.35 + 0.65 * u
        : r.mode === 'pulse' ? (0.35 + 0.35 * Math.abs(Math.sin(r.t * 9))) * Math.min(1, (r.dur - r.t) / 0.06, r.t / 0.06)
          : 1 - u;
      this.rings[w++] = r;
    }
    this.rings.length = w;
  }

  /**
   * Skill activation (on) / end (off). On: a flash at the body, a gold light pillar with a white-hot core from the
   * feet, a shockwave and a hex ring on the ground, rising motes — then the active aura (_aura) until it ends.
   */
  skill(view, on) {
    if (!view) return;
    if (!on) { this._aura(view, false); return; }
    const z = (view.z || 0) + (view.hover || 0);
    const g = this._proj(view.x, view.y, z, this._g);
    const gx = g.x, gy = g.y, s = g.s;
    const c = this._chest(view, this._q);
    this.particle('pillar', gx, gy, { tint: SKILL_GOLD, life: 0.7, s0: (s / 64) * 1.05, s1: (s / 64) * 1.3, a0: 0.95, a1: 0, sx: 0.8, ay: 1 });
    this.particle('pillar', gx, gy, { tint: 0xffffff, life: 0.38, s0: (s / 64) * 0.9, s1: (s / 64) * 1.15, a0: 0.9, a1: 0, sx: 0.28, ay: 1 });
    this.particle('flare', c.x, c.y, { tint: 0xfff0b0, life: 0.3, s0: (s / 128) * 1.9, s1: (s / 128) * 0.6, a0: 1, a1: 0, rot: Math.random() });
    this.particle('glow', c.x, c.y, { tint: SKILL_GOLD, life: 0.36, s0: (s / 128) * 1.2, s1: (s / 128) * 2.4, a0: 0.9, a1: 0 });
    this.ring(view.x, view.y, z, 0.15, 1.7, 0xffe7a0, 0.45, 'shock');
    this.ring(view.x, view.y, z, 0.3, 1.25, SKILL_GOLD, 0.6, 'hex');
    this.burst(c.x, c.y, s, this.rich ? 10 : 4, 0xffe28a, { speed: 1.4, up: 1.6, life: 0.7, tex: 'dot', size: 0.34 });
    this._aura(view, true);
  }

  /** Active-skill aura: a soft gold glow and a slowly turning hex on the ground under the unit (fading in / out). */
  _aura(view, on) {
    if (view.info.ammoSkill) return; // ammunition is shown in the segmented bar below HP
    const P = this.P;
    let a = this.auras.get(view.id);
    if (on) {
      if (!a) {
        // the root is squashed onto the ground; the hex turns inside it (so it turns in the ground plane)
        const root = new P.Container();
        const disc = new P.Sprite(this.tex.soft);
        disc.anchor.set(0.5); disc.blendMode = P.BLEND_MODES.ADD; disc.tint = SKILL_GOLD;
        const hex = new P.Sprite(this.tex.hex);
        hex.anchor.set(0.5); hex.blendMode = P.BLEND_MODES.ADD; hex.tint = 0xffc94a;
        root.addChild(disc, hex);
        root.alpha = 0;
        this.ctx.layers.groundFx.addChild(root);
        a = { sp: root, disc, hex, view, t: 0, mote: 0 };
        this.auras.set(view.id, a);
      }
      a.view = view;
      a.off = false;
    } else if (a) a.off = true;
  }

  _updateAuras(dt) {
    if (!this.auras.size) return;
    const cam = this.ctx.cam();
    const p = this._p, q = this._q;
    const rich = this.rich;
    for (const [id, a] of this.auras) {
      a.t += dt;
      const v = a.view;
      const ending = a.off || !v || v.destroyed || v.alive === false;
      if (ending) {
        a.sp.alpha -= dt * 3;
        if (a.sp.alpha <= 0) { a.sp.destroy({ children: true }); this.auras.delete(id); continue; }
      } else a.sp.alpha = Math.min(1, a.sp.alpha + dt * 5);
      if (!v || v.destroyed) continue;
      const z = (v.z || 0) + 0.01;
      this._onGround(a.sp, v.y, v.z || 0);
      cam.project(v.x, v.y, z, p);
      cam.project(v.x, v.y + 0.55, z, q);
      a.sp.position.set(p.x, p.y);
      a.sp.scale.set((p.s * 0.95) / 128, (Math.max(1, p.y - q.y) * 1.72) / 128);
      a.hex.rotation = a.t * 0.9;
      a.hex.alpha = 0.8 + 0.2 * Math.sin(a.t * 4);
      a.disc.alpha = 0.42 + 0.1 * Math.sin(a.t * 4);
      // now and then a mote rises from the ring
      if (rich && !ending && (a.mote += dt) >= 0.3) {
        a.mote = 0;
        if (this._room()) {
          const ang = Math.random() * Math.PI * 2;
          const m = cam.project(v.x + Math.cos(ang) * 0.38, v.y + Math.sin(ang) * 0.3, z, this._g);
          const o = this._o();
          o.tint = 0xffe28a; o.vy = -m.s * 0.9; o.life = 0.75; o.s0 = (m.s / 32) * 0.14; o.s1 = 0; o.a0 = 0.9; o.fadeIn = 0.1;
          this.particle('dot', m.x, m.y, o);
        }
      }
    }
  }
}
