// public/js/render/fx/zones.js — FxSystem blasts, zones, tile flashes and screen washes.
// Installed on FxSystem.prototype by ./system.js (a method container: never instantiated; `this` is the effect system).

import { NO_OPTS, clamp, easeOut } from './limits.js';

/** A zone lasting longer than this (real s) is a persistent area (炼金单元, fields): drawn dimmer than a skill's short burst. */
export const ZONE_PERSIST = 3;
/** Disc / edge alpha: a short zone, a persistent one (before the overlap damping), a telegraph. */
export const ZONE_ALPHA = Object.freeze({ short: [0.28, 0.75], persist: [0.16, 0.5], warn: [0.35, 0.75] });

/**
 * [disc, edge] alpha of zone `zn` among `zones` (additive blending). A persistent area is dimmer and shares its light with
 * the persistent areas overlapping it — ÷ √n for n of them, centres closer than ¾ of their radii summed —, so stacked
 * alchemy units read as one brighter area, not a white blot (community report of 2026-10-06 「炼金单元等范围持续性技能特效太亮
 * （尤其是多层叠加以后）」). Short bursts and telegraphs keep their full strength.
 */
export function zoneAlpha(zn, zones) {
  if (zn.warn) return ZONE_ALPHA.warn;
  if (!(zn.dur > ZONE_PERSIST)) return ZONE_ALPHA.short;
  let n = 1;
  for (const o of zones) {
    if (o === zn || o.warn || !(o.dur > ZONE_PERSIST)) continue;
    if (Math.hypot(o.x - zn.x, o.y - zn.y) < 0.75 * (o.r + zn.r)) n++;
  }
  const k = 1 / Math.sqrt(n);
  return [ZONE_ALPHA.persist[0] * k, ZONE_ALPHA.persist[1] * k];
}

export class FxZones {
  /**
   * An explosion on the ground at (x, y, z) of radius r tiles: fireball in `col`, a white flash, a shockwave and a
   * coloured ring on the ground, sparks and smoke. o.heavy (bombard, airstrike …): longer, more sparks, debris flying
   * and a scorch mark; o.small (shell impacts): no coloured ring, fewer sparks; o.tiles: flash those tiles too.
   */
  explosion(x, y, z, r, col, o = NO_OPTS) {
    const cam = this.ctx.cam();
    const g = cam.project(x, y, z + 0.3, this._g);
    const gx = g.x, gy = g.y, s = g.s;
    const R = Math.max(0.4, r), heavy = !!o.heavy, small = !!o.small, rich = this.rich;
    this.particle('glow', gx, gy, { tint: col, life: heavy ? 0.5 : small ? 0.3 : 0.4, s0: (s / 128) * (0.7 + R * 0.7), s1: (s / 128) * (1.2 + R * 1.2), a0: 1, a1: 0 });
    this.particle('flare', gx, gy, { tint: 0xfff4e0, life: heavy ? 0.28 : 0.18, s0: (s / 128) * (0.9 + R * 0.7), s1: (s / 128) * (0.3 + R * 0.2), a0: 1, a1: 0, rot: Math.random() * 3 });
    this.ring(x, y, z, 0.1, R * 1.1, 0xfff0d8, heavy ? 0.42 : 0.3, 'shock');
    if (!small) this.ring(x, y, z, 0.15, R, col, heavy ? 0.6 : 0.45);
    this.burst(gx, gy, s, Math.round((small ? 4 : 6) + R * (heavy ? 6 : 3)), col, { speed: 1.8 + R, life: heavy ? 0.6 : 0.45, up: 0.5 });
    this.smoke(gx, gy - s * 0.15, s * (0.35 + R * 0.35), o.smoke ?? 0x2a2522, heavy ? 0.5 : 0.35);
    if (rich && heavy) {
      // debris: dark chunks and hot embers thrown up, falling back
      for (let i = 0; i < 8; i++) {
        const a = -Math.PI * (0.15 + Math.random() * 0.7), v = s * (1.6 + Math.random() * 1.8);
        const hot = i % 2 === 0;
        this.particle(hot ? 'dot' : 'shard', gx, gy, {
          add: hot, tint: hot ? col : 0x2e2620, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: s * 5, life: 0.55 + Math.random() * 0.25,
          s0: (s / 32) * (hot ? 0.16 : 0.2), s1: (s / 32) * (hot ? 0.04 : 0.14), a0: 1, a1: hot ? 0 : 0.4, spin: (Math.random() - 0.5) * 14,
        });
      }
      // a scorch mark fading on the ground (flattened like the ground under the camera)
      const c = cam.project(x, y, z + 0.01, this._p);
      const cx = c.x, cy = c.y;
      const flat = clamp((cy - cam.project(x, y + 1, z + 0.01, this._q).y) / Math.max(1, c.s), 0.25, 1);
      this.particle('soft', cx, cy, { add: false, tint: 0x000000, life: 1.6, s0: (c.s / 128) * R * 1.5 * flat, s1: (c.s / 128) * R * 1.6 * flat, sx: 1 / flat, a0: 0.4, a1: 0 });
    }
    if (o.tiles) this.tileFlash(o.tiles, col, 0.45);
  }

  /** Dark (normal-blend) smoke puff. */
  smoke(x, y, size, tint, alpha = 0.45) {
    this.particle('smoke', x, y, { add: false, tint, life: 0.8, s0: size / 128 * 0.9, s1: size / 128 * 2, a0: alpha, a1: 0 });
  }

  /** Motion streak between two world points at height z (dash / pull / blink trails). */
  streak(x0, y0, x1, y1, z, tint, life = 0.3) {
    const cam = this.ctx.cam();
    const a = cam.project(x0, y0, z, this._p), ax = a.x, ay = a.y;
    const b = cam.project(x1, y1, z, this._q);
    const len = Math.hypot(b.x - ax, b.y - ay);
    if (len < 2) return;
    const th = Math.max(0.05, (b.s * 0.3) / 32);
    this.particle('streak', b.x, b.y, { tint, life, s0: th, s1: th * 0.5, sx: len / 128 / th, a0: 0.8, a1: 0, rot: Math.atan2(b.y - ay, b.x - ax), anchorX: 1 });
  }

  /** Light strike from the sky onto a point (lightning / skill strikes / columns). */
  strike(x, y, z, tint, wide = false) {
    const cam = this.ctx.cam();
    const g = cam.project(x, y, z);
    this.particle('pillar', g.x, g.y, { tint, life: 0.4, s0: g.s / 64 * (wide ? 1.2 : 0.7), s1: g.s / 64 * (wide ? 0.9 : 0.2), a0: 1, a1: 0, sx: wide ? 1 : 0.5, ay: 1 });
    this.particle('glow', g.x, g.y - g.s * 0.2, { tint, life: 0.3, s0: g.s / 128 * 0.8, s1: g.s / 128 * 1.6, a0: 0.9, a1: 0 });
    this.ring(x, y, z, 0.1, wide ? 1.2 : 0.7, tint, 0.35);
    this.burst(g.x, g.y - g.s * 0.2, g.s, 6, tint, { speed: 2.4, life: 0.35 });
  }

  /**
   * Persistent ground area: soft disc + pulsing edge ring for `dur` real seconds (telegraphs pulse faster). `key` (the
   * sim fx's `key`): a zone already up under that key is updated in place — moved, resized, its end `dur` from now —
   * instead of a second one stacked on it (引星棘刺 S2's drifting alchemy unit is re-sent every second: twelve layers of the
   * same zone used to pile up, community report of 2026-10-06 「炼金单元等范围持续性技能特效太亮（尤其是多层叠加以后）」).
   */
  zone(x, y, z, r, tint, dur, tex = 'soft', warn = false, key = null) {
    if (key != null) {
      const zn = this.zones.find((q) => q.key === key && q.t < q.dur);
      if (zn) {
        zn.x = x; zn.y = y; zn.z = z; zn.r = r; zn.tint = tint; zn.dur = zn.t + dur;
        this._onGround(zn.disc, y, z); this._onGround(zn.edge, y, z);
        return;
      }
    }
    const P = this.P;
    const disc = new P.Sprite(this.tex[tex === 'ring' ? 'soft' : tex] || this.tex.soft);
    disc.anchor.set(0.5); disc.blendMode = P.BLEND_MODES.ADD; disc.tint = tint;
    const edge = new P.Sprite(this.tex.ring);
    edge.anchor.set(0.5); edge.blendMode = P.BLEND_MODES.ADD; edge.tint = tint;
    this._onGround(disc, y, z); this._onGround(edge, y, z);
    this.zones.push({ disc, edge, x, y, z, r, t: 0, dur, warn, key, tint });
    if (this.zones.length > 24) this._freeZone(this.zones.shift());
  }

  _freeZone(zn) { zn.disc.destroy(); zn.edge.destroy(); }

  _updateZones(dt) {
    const cam = this.ctx.cam();
    const p = this._p, q = this._q;
    let w = 0;
    for (const zn of this.zones) {
      zn.t += dt;
      if (zn.t >= zn.dur) { this._freeZone(zn); continue; }
      this.zones[w++] = zn;
    }
    this.zones.length = w;
    for (const zn of this.zones) {
      const k = zn.t / zn.dur;
      const grow = Math.min(1, zn.t / 0.25);
      const rad = zn.r * (0.35 + 0.65 * easeOut(grow));
      cam.project(zn.x, zn.y, zn.z + 0.02, p);
      cam.project(zn.x, zn.y + rad, zn.z + 0.02, q);
      const rx = p.s * rad, ry = Math.max(1, p.y - q.y);
      const fade = k > 0.8 ? (1 - k) / 0.2 : 1;
      const pulse = zn.warn ? 0.55 + 0.45 * Math.abs(Math.sin(zn.t * 7)) : 0.8 + 0.2 * Math.sin(zn.t * 3);
      const [discA, edgeA] = zoneAlpha(zn, this.zones);
      zn.disc.tint = zn.edge.tint = zn.tint ?? zn.disc.tint;
      zn.disc.position.set(p.x, p.y); zn.disc.scale.set((rx * 2) / 128, (ry * 2) / 128); zn.disc.alpha = discA * fade * pulse;
      zn.edge.position.set(p.x, p.y); zn.edge.scale.set((rx * 2.1) / 128, (ry * 2.1) / 128); zn.edge.alpha = edgeA * fade * pulse;
    }
  }

  /** Flash a set of tiles ([[r,c]]) on the ground (telegraphed boxes, blast tiles). */
  tileFlash(tiles, tint, dur, warn = false, wall = null) {
    if (!Array.isArray(tiles) || !tiles.length) return;
    this.tileFlashes.push({ tiles: tiles.slice(0, 60), tint, dur: Math.max(0.2, dur), t: 0, warn, wall });
    if (this.tileFlashes.length > 12) this.tileFlashes.shift();
  }

  _updateTileFlashes(dt) {
    const g = this.tileGfx;
    g.clear();
    if (!this.tileFlashes.length) return;
    const cam = this.ctx.cam();
    const p = this._p;
    let w = 0;
    for (const f of this.tileFlashes) {
      f.t += dt;
      const wall = f.wall;
      if (wall && (wall.owner.destroyed || wall.owner.alive === false || !wall.owner.statuses?.has('skill'))) continue;
      if (!wall && f.t >= f.dur) continue;
      const k = wall ? 0 : f.t / f.dur;
      const a = (f.warn ? 0.35 + 0.35 * Math.abs(Math.sin(f.t * 7)) : 0.55 * (1 - k)) * (k > 0.85 ? (1 - k) / 0.15 : 1);
      for (const [r, c] of f.tiles) {
        const z = (this.ctx.heightAt ? this.ctx.heightAt(r, c) : 0) + 0.015;
        const pts = [];
        // YuS3EffectWithEdgeBehaviour._offset = 0.4. [ASSUMED] In the 2D/off fallback a narrow
        // ground strip represents the wall; width 0.16 keeps it inside the field's tile edges.
        const horizontal = wall?.axis === 'row', off = wall ? (wall.dir === 'LEFT' || wall.dir === 'DOWN' ? -0.4 : 0.4) : 0;
        const hx = wall ? (horizontal ? 0.5 : 0.08) : 0.46, hy = wall ? (horizontal ? 0.08 : 0.5) : 0.46;
        for (const [dx, dy] of [[-hx, hy], [hx, hy], [hx, -hy], [-hx, -hy]]) {
          cam.project(c + dx + (horizontal ? 0 : off), r + dy + (horizontal ? off : 0), z, p); pts.push(p.x, p.y);
        }
        g.lineStyle(Math.max(1, p.s * 0.03), f.tint, Math.min(1, a * 1.6));
        g.beginFill(f.tint, a * 0.6);
        g.drawPolygon(pts);
        g.endFill();
      }
      this.tileFlashes[w++] = f;
    }
    this.tileFlashes.length = w;
  }

  /** Full-screen colour pulse (field-wide telegraphs, cold wind). */
  flashScreen(tint, alpha = 0.4, dur = 0.6) {
    this.tintT = dur; this.tintDur = dur; this.tintA = alpha;
    this.tintSprite.tint = tint;
  }

  /**
   * Snow over the field (cold wind). `gust` — 盟约寒风, 谢拉格's field-wide wind: a blizzard sweeping the screen from the
   * bottom up, the official direction (the owner's confirmation of 2026-10-08; PR #386 by @leiming2333 after the
   * community report 「谢拉格的效果特性不明显，暴风雪应该从下向上刮」): snowflakes rise off the bottom edge on a crosswind
   * with gust streaks racing along, so it reads as wind driving up the field, not quiet snowfall (flake / streak counts,
   * speeds and lives are a visual choice [ASSUMED]; screen y grows downward, so a negative vy rises). Without `gust` (an
   * operator's own cold: 灵知 S3, 麦哲伦 S1's pulses) a short light flurry drifting down, as before.
   */
  snowfall(tint, gust = false) {
    const size = this.ctx.screenSize();
    const W = size.width, H = size.height, low = this.quality === 'low';
    if (!gust) {
      for (let i = 0; i < (low ? 10 : 26); i++) {
        this.particle('dot', Math.random() * W, Math.random() * H * 0.7, { tint, vx: 30 + Math.random() * 40, vy: 60 + Math.random() * 60, life: 1 + Math.random() * 0.6, s0: 0.25 + Math.random() * 0.3, s1: 0.1, a0: 0.8, a1: 0, fadeIn: 0.2 });
      }
      return;
    }
    // snowflakes: lifted off the bottom edge (a share starts below it), blown up-right and tumbled by the gust
    for (let i = 0; i < (low ? 22 : 48); i++) {
      const vy = -H * (0.55 + Math.random() * 0.5), vx = W * (0.04 + Math.random() * 0.1);
      this.particle('dot', Math.random() * W, H * (0.55 + Math.random() * 0.55), { tint, vx, vy, life: 1.4 + Math.random() * 0.9, s0: 0.22 + Math.random() * 0.34, s1: 0.08, a0: 0.9, a1: 0, fadeIn: 0.12, spin: (Math.random() - 0.5) * 6 });
    }
    // gust streaks: thin wind lines racing up through the field along their velocity
    for (let i = 0; i < (low ? 4 : 10); i++) {
      const vy = -H * (0.9 + Math.random() * 0.6), vx = W * (0.1 + Math.random() * 0.12);
      this.particle('streak', Math.random() * W, H * (0.6 + Math.random() * 0.5), { tint, vx, vy, life: 0.7 + Math.random() * 0.4, s0: 0.04 + Math.random() * 0.03, s1: 0.02, sx: 6 + Math.random() * 6, a0: 0.55, a1: 0, fadeIn: 0.08, rot: Math.atan2(vy, vx) });
    }
  }

  /** Leak: objective flash + red screen vignette pulse. */
  leak() {
    this.vigT = 0.9;
  }
}
