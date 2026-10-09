// public/js/render/fx/simfx.js — FxSystem placement of a sim fx event.
// Installed on FxSystem.prototype by ./system.js (a method container: never instantiated; `this` is the effect system).

import { SHOT_HEIGHT, bodyZ } from './camera.js';
import { fxSpec, tilesAround, wallTiles } from './kinds.js';
import { clamp } from './limits.js';

/**
 * An fx anchored on a unit (extra.id) is drawn at that unit's rendered position while the event's own (x, y) is within
 * this many tiles of it (it happens on the unit); farther away the fx happens at (x, y) — the sim puts the caster in
 * `id` of many area / target effects (an 'aoe' ahead of the caster, a 'crit' on the victim, 蕾缪安's 'bombard').
 */
const ANCHOR_SNAP = 0.75;

const num = (v, d) => { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN; return Number.isFinite(n) ? n : d; };

export class FxSim {
  // ---- sim fx (b.ev ['fx', kind, x, y, extra]) -------------------------------------------------------------

  /** Unit view of an fx's `id` / `src` / … (null when unknown or gone). */
  _viewOf(id) {
    if (id == null || !this.ctx.view) return null;
    const v = this.ctx.view(id);
    return v && !v.destroyed ? v : null;
  }

  /**
   * Where an fx happens: on its anchor unit `ex.id` (at the unit's rendered position, so it sticks to a moving unit)
   * when the event's (x, y) is that unit's spot (within ANCHOR_SNAP tiles) or has none; otherwise at (x, y) on the ground
   * — the sim often names the caster in `id` of an effect elsewhere ('aoe' at a target or ahead of the caster, 'crit'
   * on the victim, 'zone' where a skill lands), which used to be drawn on the caster.
   */
  _where(x, y, ex) {
    const v = this._viewOf(ex.id);
    if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) {
      const here = !Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(v.x - x, v.y - y) <= ANCHOR_SNAP;
      if (here) return { x: v.x, y: v.y, z: (v.z || 0) + (v.hover || 0), v };
    }
    return this._point(x, y);
  }

  /** An fx at the sim position (x, y), on the ground there. */
  _point(x, y) {
    return { x, y, z: Number.isFinite(x) && Number.isFinite(y) ? this._groundZ(x, y) : 0, v: null };
  }

  /**
   * b.ev 'fx': every kind the sim / content emits has a visual (FX_KINDS archetypes: blast, shell, zone, telegraph,
   * heal, sp, shield, shatter, summon, vanish, blink, move, wave, pinwheel, mark, reticle, buff, lift, sleep, crit, dodge,
   * counter, dp, coin, crate, down, beam, bolt, strike, volley, pillar, lp, chill, element, flame, qi), except kinds whose
   * archetype is 'none' (hitCap: a leader hit cancelled by 限伤 draws nothing); unknown kinds get a generic sparkle. `extra` keys used: id (anchor unit — or the shooter of a `pt` kind), r | radius, dur | duration,
   * t (shell flight, game s), src / from / to / target / targets (unit ids), fx, fy / fromX, fromY / tx, ty (positions),
   * element, n, scale, kind, tiles, hold ('lock': the reticle waits while the shooter's skill runs), dr / dc (a
   * direction in tiles: 'qi' points its blade that way).
   */
  simFx(kind, x, y, extra) {
    const ex = extra && typeof extra === 'object' ? extra : {};
    const spec = fxSpec(kind, ex);
    if (spec.a === 'none') return; // an event the screen does not show (hitCap)
    const at = spec.pt ? this._point(Number(x), Number(y)) : this._where(Number(x), Number(y), ex);
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return;
    // 蕾缪安 S2: the aimed snipe ('crit' on the locked enemy, from her) ends that aim lock
    if (kind === 'crit' && ex.src != null && ex.id != null) {
      for (const L of this.locks) if (L.src === ex.src && L.id === ex.id) this._releaseLock(L);
    }
    const col = spec.c;
    const r = clamp(num(ex.r ?? ex.radius, spec.r ?? 1), 0.3, 30);
    const ts = this.ctx.timeScale ? Math.max(0.25, this.ctx.timeScale()) : 2;
    const dur = num(ex.dur ?? ex.duration, spec.dur ?? 0) / ts;
    const cam = this.ctx.cam();
    const chest = (v, out = this._p) => (v ? this._chest(v, out) : cam.project(at.x, at.y, at.z + 0.5, out));
    const p = chest(at.v);
    const s = p.s;
    switch (spec.a) {
      case 'blast': {
        if (r >= 12) { this.flashScreen(col, 0.5); break; }
        if (kind === 'bombard') { this._touchLocks(ex.id ?? ex.src ?? null); this._landed(ex.id ?? ex.src ?? null, at.x, at.y, r); }
        this.explosion(at.x, at.y, at.z, r, col, { smoke: spec.smoke, heavy: !!spec.heavy, tiles: ex.tiles ? tilesAround(at.x, at.y, r, ex.tiles) : null });
        break;
      }
      case 'shell': {
        // 蕾缪安 S3: a shell fired now by `id` that lands at (x, y) after `t` game seconds (its 'bombard' explodes there)
        const flight = num(ex.t ?? ex.flight ?? ex.dur ?? ex.duration, 1) / ts;
        this._touchLocks(ex.id ?? ex.src ?? null);
        this.mortar(this._viewOf(ex.id ?? ex.src), at.x, at.y, r, flight);
        break;
      }
      // `key`: one zone the sim re-sends as it moves / grows (an update in place, never a second layer — zones.js)
      case 'zone': this.zone(at.x, at.y, at.z, r, col, Math.max(0.6, dur || 1.5), spec.tex, false, ex.key != null ? String(ex.key) : null); break;
      case 'wall': {
        // a line of burning tiles through the anchor tile along `axis` ('col' | 'row', from the sim event)
        const rect = this.ctx.fieldRect ? this.ctx.fieldRect() : null;
        this.tileFlash(wallTiles(Number(x), Number(y), ex.axis === 'row' ? 'row' : 'col', rect), col, Math.max(0.6, dur || 1.5));
        this.zone(at.x, at.y, at.z, 0.6, col, Math.max(0.6, dur || 1.5), spec.tex);
        break;
      }
      case 'telegraph': {
        const d = Math.max(0.4, dur || 1);
        if (r >= 12) { this.flashScreen(col, 0.45, d); break; }
        if (ex.tiles) this.tileFlash(tilesAround(at.x, at.y, r, ex.tiles), col, d, true);
        else this.zone(at.x, at.y, at.z, r, col, d, 'ring', true);
        break;
      }
      // 盟约寒风 (谢拉格's field-wide wind — the device emits it with no anchor unit): a blizzard up the field and a
      // stronger cold flash (PR #386); an operator's own cold (灵知 S3's start, 麦哲伦 S1's pulse every 3 s: `id` = the
      // unit) keeps the light flurry and the softer flash — a full-screen blizzard every pulse would bury the field
      case 'chill':
        if (ex.id == null) { this.flashScreen(col, 0.45, 1); this.snowfall(col, true); } else { this.flashScreen(col, 0.35, 0.8); this.snowfall(col); }
        break;
      case 'heal': this.heal(at.v || { x: at.x, y: at.y, z: at.z }, 0); break;
      case 'healAoe': {
        this.ring(at.x, at.y, at.z, 0.2, r, col, 0.6);
        const n = this.quality === 'low' ? 4 : 9;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, d = Math.random() * r * 0.85;
          const q = cam.project(at.x + Math.cos(a) * d, at.y + Math.sin(a) * d, at.z + 0.2);
          this.particle('plus', q.x, q.y, { tint: col, vy: -q.s * 0.9, life: 0.8, s0: q.s / 64 * 0.3, s1: q.s / 64 * 0.18, a0: 0.9, a1: 0, fadeIn: 0.1 });
        }
        break;
      }
      case 'sp': {
        for (let i = 0; i < (this.quality === 'low' ? 3 : 7); i++) {
          this.particle('dot', p.x + (Math.random() - 0.5) * s * 0.6, p.y + (Math.random() - 0.2) * s * 0.4, { tint: col, vy: -s * (0.6 + Math.random() * 0.6), life: 0.7, s0: s / 32 * 0.2, s1: 0, a0: 1, a1: 0, fadeIn: 0.05 });
        }
        this.particle('glow', p.x, p.y, { tint: col, life: 0.3, s0: s / 128 * 0.6, s1: s / 128 * 1.1, a0: 0.7, a1: 0 });
        break;
      }
      case 'shield': {
        this.particle('hex', p.x, p.y, { tint: col, life: 0.55, s0: s / 128 * 0.9, s1: s / 128 * 1.25, a0: 0.85, a1: 0, sx: 0.85 });
        this.particle('glow', p.x, p.y, { tint: col, life: 0.4, s0: s / 128 * 0.9, s1: s / 128 * 1.3, a0: 0.5, a1: 0 });
        break;
      }
      case 'shatter': {
        this.particle('hex', p.x, p.y, { tint: col, life: 0.25, s0: s / 128 * 1.1, s1: s / 128 * 1.5, a0: 0.9, a1: 0 });
        for (let i = 0; i < (this.quality === 'low' ? 5 : 12); i++) {
          const a = Math.random() * Math.PI * 2;
          this.particle('shard', p.x + Math.cos(a) * s * 0.3, p.y + Math.sin(a) * s * 0.3, { tint: col, vx: Math.cos(a) * s * 1.6, vy: Math.sin(a) * s * 1.2 - s * 0.3, g: s * 3, life: 0.55, s0: s / 32 * 0.16, s1: s / 32 * 0.05, a0: 1, a1: 0, spin: (Math.random() - 0.5) * 12 });
        }
        break;
      }
      case 'summon': {
        const g = cam.project(at.x, at.y, at.z);
        this.particle('pillar', g.x, g.y, { tint: col, life: 0.55, s0: g.s / 64 * 0.8, s1: g.s / 64 * 0.3, a0: 0.9, a1: 0, sx: 1, ay: 1 });
        this.ring(at.x, at.y, at.z, 0.1, 0.9, col, 0.5, 'hex');
        this.burst(g.x, g.y - g.s * 0.3, g.s, 8, col, { speed: 1.4, up: 0.8, life: 0.5, tex: 'dot' });
        break;
      }
      case 'vanish': {
        this.particle('glow', p.x, p.y, { tint: col, life: 0.4, s0: s / 128 * 0.7, s1: s / 128 * 1.5, a0: 0.8, a1: 0 });
        this.smoke(p.x, p.y, s * 0.7, 0x2c2436, 0.5);
        this.burst(p.x, p.y, s, 7, col, { speed: 1.5, tex: 'dot', life: 0.45 });
        break;
      }
      case 'blink': {
        const fx0 = num(ex.fx ?? ex.fromX, NaN), fy0 = num(ex.fy ?? ex.fromY, NaN);
        if (Number.isFinite(fx0) && Number.isFinite(fy0)) {
          const q = cam.project(fx0, fy0, at.z + 0.5, this._q);
          this.smoke(q.x, q.y, q.s * 0.6, 0x2c2436, 0.45);
          this.particle('glow', q.x, q.y, { tint: col, life: 0.3, s0: q.s / 128 * 0.8, s1: q.s / 128 * 0.2, a0: 0.8, a1: 0 });
          this.streak(fx0, fy0, at.x, at.y, at.z + 0.5, col, 0.3);
        }
        this.particle('glow', p.x, p.y, { tint: col, life: 0.35, s0: s / 128 * 0.3, s1: s / 128 * 1.2, a0: 0.9, a1: 0 });
        this.burst(p.x, p.y, s, 6, col, { speed: 1.4, tex: 'dot', life: 0.4 });
        break;
      }
      case 'move': {
        const fx0 = num(ex.fromX ?? ex.fx ?? ex.x0, NaN), fy0 = num(ex.fromY ?? ex.fy ?? ex.y0, NaN);
        const tx = num(ex.tx, NaN), ty = num(ex.ty, NaN);
        if (Number.isFinite(fx0) && Number.isFinite(fy0)) this.streak(fx0, fy0, at.x, at.y, at.z + 0.35, col, 0.35);
        else if (Number.isFinite(tx) && Number.isFinite(ty)) this.streak(at.x, at.y, tx, ty, at.z + 0.35, col, 0.35);
        const g = cam.project(at.x, at.y, at.z + 0.05);
        for (let i = 0; i < (this.quality === 'low' ? 2 : 5); i++) {
          this.particle('smoke', g.x + (Math.random() - 0.5) * g.s * 0.5, g.y, { add: false, tint: 0x6b6358, vx: (Math.random() - 0.5) * g.s * 0.6, vy: -g.s * 0.2, drag: 2, life: 0.5, s0: g.s / 128 * 0.25, s1: g.s / 128 * 0.55, a0: 0.45, a1: 0 });
        }
        break;
      }
      // a travelling blade (赤刃明霄陈 S3's 龙剑气): a short trail from where it was to where it is, plus a crescent head
      // turned the way it moves — the sim sends one of these every 0.12 s, and the trail outlives that gap so the
      // events join into one sweeping wave. A procedural stand-in (the official effect is a particle prefab this client
      // does not extract). Trail, head and heading share one height; the head is projected after streak(), which
      // reuses this._p / this._q (projected before it, the head was drawn at the trail's start, one event behind)
      case 'qi': {
        const z = at.z + 0.35;
        const fx0 = num(ex.fromX, NaN), fy0 = num(ex.fromY, NaN);
        if (Number.isFinite(fx0) && Number.isFinite(fy0)) this.streak(fx0, fy0, at.x, at.y, z, col, 0.34);
        const h = cam.project(at.x, at.y, z, this._p), hx = h.x, hy = h.y, hs = h.s;
        const dr = num(ex.dr, NaN), dc = num(ex.dc, NaN);
        let rot = 0;
        if (Number.isFinite(dr) && Number.isFinite(dc) && (dr || dc)) {
          const q = cam.project(at.x + dc * 0.5, at.y + dr * 0.5, z, this._q);
          // the `slash` sprite's crescent bulges along its local −y, so this turns that edge onto the travel direction
          rot = Math.atan2(q.x - hx, -(q.y - hy));
        }
        this.particle('slash', hx, hy, { tint: col, life: 0.3, s0: hs / 128 * 1.3, s1: hs / 128 * 2.0, a0: 0.9, a1: 0, rot });
        this.particle('glow', hx, hy, { tint: col, life: 0.26, s0: hs / 128 * 0.8, s1: hs / 128 * 1.5, a0: 0.55, a1: 0 });
        break;
      }
      case 'wave': {
        const k = clamp(num(ex.scale, 1), 0.5, 4);
        const rr = Math.max(0.8, r * (ex.scale ? Math.min(2, k / 2) : 1));
        for (let i = 0; i < 3; i++) this.ring(at.x, at.y, at.z, 0.15 + i * 0.15, rr * (0.7 + i * 0.25), col, 0.45 + i * 0.12);
        this.particle('glow', p.x, p.y, { tint: col, life: 0.3, s0: s / 128 * 0.5, s1: s / 128 * 1.2, a0: 0.7, a1: 0 });
        break;
      }
      case 'pinwheel': {
        // 圣聆初雪 S3 群山俯首: an icy burst expanding from her centre while a flat fan of blades whirls around her
        // in a flurry of snow (community report of 2026-10-09 「群山俯首没有特效：由干员中心扩大，风扇页平旋转，暴风雪」)
        for (let i = 0; i < 3; i++) this.ring(at.x, at.y, at.z, 0.15 + i * 0.2, r * (0.6 + i * 0.3), col, 0.5 + i * 0.15);
        const g0 = cam.project(at.x, at.y, at.z + 0.3, this._q);
        const blades = this.quality === 'low' ? 4 : 6;
        for (let i = 0; i < blades; i++) {
          const a = (i / blades) * Math.PI * 2 + Math.random() * 0.4;
          this.particle('streak', g0.x + Math.cos(a) * g0.s * 0.5, g0.y + Math.sin(a) * g0.s * 0.25, { tint: col, life: 0.8 + Math.random() * 0.3, s0: g0.s / 128 * 0.35, s1: g0.s / 128 * 0.15, sx: 3.5, a0: 0.9, a1: 0, rot: a + Math.PI / 2, spin: 7 + Math.random() * 3, fadeIn: 0.05 });
        }
        for (let i = 0; i < (this.quality === 'low' ? 8 : 16); i++) {
          const a = Math.random() * Math.PI * 2, d = Math.random() * g0.s * 0.9;
          this.particle('dot', g0.x + Math.cos(a) * d, g0.y + Math.sin(a) * d * 0.5, { tint: 0xffffff, vx: -Math.sin(a) * g0.s * 1.6, vy: Math.cos(a) * g0.s * 0.8 - g0.s * 0.5, life: 0.9 + Math.random() * 0.5, s0: 0.2 + Math.random() * 0.2, s1: 0.06, a0: 0.9, a1: 0, fadeIn: 0.08, spin: (Math.random() - 0.5) * 6 });
        }
        this.particle('glow', p.x, p.y, { tint: col, life: 0.4, s0: s / 128 * 0.8, s1: s / 128 * 1.6, a0: 0.8, a1: 0 });
        break;
      }
      case 'mark': case 'reticle': {
        if (kind === 'lock') {
          // `id` is always the locked enemy: the reticle sticks to its view even a little off the event's spot
          // (`hold`: 蕾缪安 S3 — the reticle waits while her skill runs, however long nothing is in range)
          const lv = at.v || this._viewOf(ex.id);
          this._touchLocks(ex.src ?? null);
          this._lock(lv, ex.src ?? null, lv ? lv.x : at.x, lv ? lv.y : at.y, lv ? bodyZ(cam, lv, SHOT_HEIGHT.aim) : at.z + 0.55, !!ex.hold);
          break;
        }
        const v = at.v;
        const hz = v ? (v.z || 0) + (v.hover || 0) + (v._headTiles || 1.2) + 0.25 : at.z + 1.4;
        const q = cam.project(at.x, at.y, hz, this._q);
        if (spec.a === 'mark') {
          this.particle('glow', q.x, q.y, { tint: col, life: 0.6, s0: q.s / 128 * 0.5, s1: q.s / 128 * 0.7, a0: 0.8, a1: 0 });
          this.numberAt(q.x, q.y, '!', col, 0.8);
        } else {
          this.particle('ring', p.x, p.y, { tint: col, life: 0.6, s0: s / 128 * 1.3, s1: s / 128 * 0.7, a0: 0.95, a1: 0, spin: 3 });
          this.particle('hex', p.x, p.y, { tint: col, life: 0.6, s0: s / 128 * 0.5, s1: s / 128 * 0.9, a0: 0.8, a1: 0, spin: -2 });
        }
        break;
      }
      case 'buff': {
        const g = cam.project(at.x, at.y, at.z + 0.05);
        const n = this.quality === 'low' ? 3 : 6;
        for (let i = 0; i < n; i++) {
          const ox = (Math.random() - 0.5) * g.s * 0.7;
          this.particle('chevron', g.x + ox, g.y - g.s * (0.1 + Math.random() * 0.5), { tint: col, vy: -g.s * (1 + Math.random() * 0.5), life: 0.65, s0: g.s / 64 * 0.22, s1: g.s / 64 * 0.12, a0: 0.95, a1: 0, rot: -Math.PI / 2, fadeIn: 0.06 });
        }
        this.ring(at.x, at.y, at.z, 0.2, 0.75, col, 0.4);
        this.particle('glow', p.x, p.y, { tint: col, life: 0.35, s0: s / 128 * 0.6, s1: s / 128 * 1.1, a0: 0.6, a1: 0 });
        break;
      }
      case 'lift': {
        const g = cam.project(at.x, at.y, at.z);
        this.ring(at.x, at.y, at.z, 0.2, 0.8, col, 0.5);
        for (let i = 0; i < (this.quality === 'low' ? 3 : 7); i++) {
          this.particle('streak', g.x + (Math.random() - 0.5) * g.s * 0.6, g.y - g.s * Math.random() * 0.4, { tint: col, vy: -g.s * 1.8, life: 0.4, s0: g.s / 128 * 0.4, s1: g.s / 128 * 0.2, a0: 0.8, a1: 0, rot: -Math.PI / 2, sx: 1 });
        }
        break;
      }
      case 'sleep': {
        const v = at.v;
        const hz = v ? (v.z || 0) + (v._headTiles || 1.2) : at.z + 1.2;
        const q = cam.project(at.x + 0.2, at.y, hz, this._q);
        for (let i = 0; i < 3; i++) this.particle('st_sleep', q.x + i * q.s * 0.12, q.y - i * q.s * 0.12, { add: false, vy: -q.s * 0.5, vx: q.s * 0.15, life: 0.9 + i * 0.2, s0: q.s / 32 * 0.22, s1: q.s / 32 * 0.32, a0: 1, a1: 0, fadeIn: 0.1 * i });
        break;
      }
      case 'crit': {
        this.particle('spark', p.x, p.y, { tint: col, life: 0.28, s0: s / 64 * 1.3, s1: s / 64 * 0.2, a0: 1, a1: 0, rot: Math.random() * Math.PI });
        this.particle('glow', p.x, p.y, { tint: 0xffffff, life: 0.18, s0: s / 128 * 0.9, s1: s / 128 * 1.4, a0: 0.9, a1: 0 });
        this.burst(p.x, p.y, s, 8, col, { speed: 3.2, life: 0.3, size: 0.5 });
        break;
      }
      case 'dodge': {
        this.particle('soft', p.x, p.y, { tint: 0xffffff, life: 0.3, s0: s / 128 * 0.5, s1: s / 128 * 0.9, a0: 0.5, a1: 0 });
        this.particle('slash', p.x, p.y, { tint: col, life: 0.22, s0: s / 128 * 0.8, s1: s / 128 * 1.1, a0: 0.7, a1: 0, rot: -0.5 });
        break;
      }
      case 'counter': {
        this.particle('spark', p.x, p.y, { tint: col, life: 0.22, s0: s / 64 * 0.9, s1: 0, a0: 1, a1: 0 });
        this.particle('slash', p.x, p.y, { tint: col, life: 0.22, s0: s / 128 * 0.9, s1: s / 128 * 1.2, a0: 0.9, a1: 0, rot: 0.6 });
        this.burst(p.x, p.y, s, 4, col, { speed: 2.4, life: 0.25 });
        break;
      }
      case 'dp': {
        const n = Math.round(num(ex.n, 0));
        this.particle('shard', p.x, p.y, { tint: col, vy: -s * 0.6, life: 0.9, s0: s / 32 * 0.28, s1: s / 32 * 0.22, a0: 1, a1: 0 });
        if (n > 0) this.numberAt(p.x + s * 0.2, p.y, `+${n}`, col, 0.7);
        break;
      }
      case 'coin': {
        for (let i = 0; i < 4; i++) this.particle('coin', p.x + (Math.random() - 0.5) * s * 0.4, p.y, { add: false, vx: (Math.random() - 0.5) * s, vy: -s * (1.2 + Math.random() * 0.6), g: s * 4, life: 0.7, s0: s / 48 * 0.2, s1: s / 48 * 0.16, a0: 1, a1: 0.2 });
        break;
      }
      case 'crate': this.crateBreak(at.x, at.y, at.z); break;
      case 'down': {
        this.smoke(p.x, p.y, s * 0.6, spec.smoke ?? 0x1a1a1a, 0.5);
        this.burst(p.x, p.y, s, 5, col, { speed: 1.2, tex: 'dot', life: 0.5, g: 2 });
        break;
      }
      case 'beam': case 'bolt': {
        const a = this._viewOf(ex.from ?? ex.src) || (spec.a === 'bolt' ? null : at.v);
        const b = this._viewOf(ex.to ?? ex.target) || (a === at.v ? null : at.v);
        if (a && b && a !== b) this._beam(a, b, col, spec.a === 'bolt' ? 0.28 : 0.4, spec.a === 'bolt' ? 1 : 0.4);
        else this.strike(at.x, at.y, at.z, col);
        break;
      }
      case 'flame': {
        // at the event's spot (the locked target), not snapped onto the dragon hovering 0.25 tile from it
        const fx0 = Number(x), fy0 = Number(y);
        this._flame(ex.id ?? ex.src ?? null, ex.target ?? ex.to ?? null, fx0, fy0, r, col, Math.max(0.2, dur || 0.5));
        break;
      }
      case 'strike': case 'pillar': this.strike(at.x, at.y, at.z, col, spec.a === 'pillar'); break;
      case 'volley': {
        const list = Array.isArray(ex.targets) ? ex.targets.slice(0, 12) : [];
        const src = this._viewOf(ex.src ?? ex.id);
        for (const id of list) {
          const t = this._viewOf(id);
          if (!t) continue;
          if (src && src !== t) this.attack(src, t, 'arrow');
          else { const q = this._chest(t, this._q); this.burst(q.x, q.y, q.s, 4, col, { speed: 2, life: 0.3 }); }
        }
        if (!list.length) this.burst(p.x, p.y, s, 6, col, { speed: 2.4, life: 0.35 });
        break;
      }
      case 'lp': this.leak(); break;
      case 'element': {
        const el = ex.element;
        const c2 = el === 'burn' ? 0xff7a33 : el === 'neural' ? 0xff5ad0 : el === 'necrosis' || el === 'apoptosis' ? 0x9dff6a : el === 'erosion' ? 0x6fe0ff : col;
        this.particle('glow', p.x, p.y, { tint: c2, life: 0.45, s0: s / 128 * 1.2, s1: s / 128 * 2.6, a0: 1, a1: 0 });
        this.ring(at.x, at.y, at.z, 0.2, 1.5, c2, 0.55);
        this.burst(p.x, p.y, s, 12, c2, { speed: 3, life: 0.5 });
        break;
      }
      default: {
        this.particle('spark', p.x, p.y, { tint: col, life: 0.35, s0: s / 64 * 0.6, s1: 0, a0: 0.9, a1: 0, rot: Math.random() });
        this.particle('glow', p.x, p.y, { tint: col, life: 0.3, s0: s / 128 * 0.4, s1: s / 128 * 0.9, a0: 0.6, a1: 0 });
        this.burst(p.x, p.y, s, 4, col, { speed: 1.6, tex: 'dot', life: 0.35 });
      }
    }
  }
}
