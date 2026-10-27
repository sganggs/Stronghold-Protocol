// public/js/render/fx/numbers.js — FxSystem damage numbers and screen-space labels.
// Installed on FxSystem.prototype by ./system.js (a method container: never instantiated; `this` is the effect system).

import { resourceFloat } from '../resourceNumbers.js';
import { DMG_STYLE, HIT_TINT, dmgStyleKey } from '../style.js';
import { camKey } from './camera.js';
import { clamp, easeOut } from './limits.js';

const MAX_NUMBERS = 90;

const NUM_RISE = 0.45;        // tiles a damage number rises over NUM_RISE_T (easeOut), then it stays

const NUM_RISE_T = 0.9;       // seconds of the rise

const NUM_LIFE = 0.9;         // seconds a number lives (a merged running total lives longer, ≤ NUM_MAX_LIFE)

const NUM_MAX_LIFE = 1.8;

const NUM_FADE_T = 0.27;      // fade-out at the end of its life

const NUM_LINE_EM = 0.95;     // vertical room of one line of digits, in em of the 24 px bitmap font

const NUM_MAX_LINES = 5;      // a number starts at most this many lines above the head

const NUM_DIGIT_EM = 0.66;    // advance of one digit of the damage font, in em (Bender 700: 0.56–0.66, the widest kept)

const NUM_POP = 1.35;         // birth / merge pop scale (the layout reserves the popped size)

const NUM_GAP_PX = 7;         // horizontal gap between two numbers side by side (never read as one number)

const NUM_MERGE_GAP = 0.3;    // s: same-style hits on one unit closer than this join its running total

const NUM_PER_TARGET = 4;     // live numbers per unit (then hits join / the oldest fades)

const NUM_CROWD = 6;          // more live numbers than this around a spot → shorter lives there

const NUM_LANES = Object.freeze([0, -1, 1, -2, 2]);   // lane order (lane widths from the unit's head)

/** Screen scale of a number's text (24 px font) at `s` px per tile. */
const numScale = (s, big, style) => clamp(s / 115, 0.42, 1.05) * (big ? 1.35 : 1) * (style === 'heal' ? 0.9 : ['cost', 'costLoss', 'sp'].includes(style) ? 0.8 : 1);

/** Characters of a damage number as drawn (heals get a '+'; a yellow MISS is four letters). */
const numChars = (v, style) => (style === 'miss' ? 4 : String(Math.round(v)).length + (style === 'heal' ? 1 : 0));

// [ASSUMED] PRTS says a red number sits at a random spot in a range above the model and gives no pixels.
const OFFICIAL_JITTER_X = 0.7;   // tiles, full width (±0.35)
const OFFICIAL_LIFT_MIN = 0.15;  // tiles above the head
const OFFICIAL_LIFT_SPAN = 0.4;

/** Sub-professions whose attacks splash around the struck target (the 阵法术师 / 轰击术师 strike every enemy in range). */
const SPLASH_SUBS = new Set(['aoesniper', 'splashcaster', 'bombarder', 'fortress', 'hammer']);

export class FxNumbers {
  // ---- hits / numbers -----------------------------------------------------------------------------------------

  /**
   * b.ev 'dmg' visual: glow + sparks in the hit colour; a melee blow (atk 'none' just before) adds its slash.
   * `o.noSpark`: the official effects drew this hit (render/vfx/wiring.js) — only the number (and the splash ring) stay.
   */
  damage(view, amount, type, srcView, mark, o) {
    if (!view) return;
    const style = dmgStyleKey(type);
    const p = this._chest(view);
    const px = p.x, py = p.y, s = p.s;
    const tint = HIT_TINT[style] || 0xffffff;
    const big = view.maxHp > 0 && amount >= view.maxHp * 0.18;
    const melee = !!srcView && this._slashAt === srcView.id;
    if (melee) this._slashAt = null;
    if (!o?.noSpark) {
      this.particle('glow', px, py, { tint, life: 0.18, s0: (s / 128) * (big ? 1.0 : 0.6), s1: (s / 128) * (big ? 1.5 : 0.9), a0: 0.9, a1: 0 });
      if (melee) this._slash(view, srcView, px, py, s, style, big);
      this.burst(px, py, s, big ? 8 : melee ? 6 : 4, tint, { speed: melee ? 2.8 : 2.4, size: big ? 0.6 : 0.46 });
    }
    if (srcView && this.ctx.subProfOf && SPLASH_SUBS.has(this.ctx.subProfOf(srcView.info?.defId, srcView.info))) {
      if (!this._lastRing || this.time - this._lastRing > 0.08) {
        this._lastRing = this.time;
        this.ring(view.x, view.y, view.z || 0, 0.1, 1.1, tint, 0.3);
      }
    }
    view.onHit?.();
    if (this.ctx.settings?.damageNumbers === false) return;
    // Official mode (设置「官方伤害数字」): only a sim-marked red integer. Sparks and the slash stay.
    if (this.ctx.settings?.officialDamageNumbers) {
      if (mark === 'r') this.officialNumber(view, amount, 'crit');
      return;
    }
    this.number(view, amount, style, big);
  }

  /**
   * Melee blow on `view` by `src`: a crescent swept across the victim, bulging along the blow (attacker → victim on
   * screen, a little random tilt / mirroring), in the hit colour with a white-hot inner stroke.
   */
  _slash(view, src, px, py, s, style, big) {
    const q = this._chest(src, this._q);
    const dx = px - q.x, dy = py - q.y;
    const ang = Math.abs(dx) + Math.abs(dy) > 1 ? Math.atan2(dy, dx) : (src.x > view.x ? Math.PI : 0);
    const rot = ang + Math.PI / 2 + (Math.random() - 0.5) * 0.9;
    const flip = Math.random() < 0.5 ? -1 : 1;
    const k = big ? 1.25 : 1;
    const a = this.particle('slash', px, py, { tint: style === 'phys' ? 0xffe2b0 : HIT_TINT[style] || 0xffffff, life: 0.2, s0: (s / 128) * 1.05 * k, s1: (s / 128) * 1.3 * k, a0: 1, a1: 0, rot });
    a.sx = flip;
    const b = this.particle('slash', px, py, { tint: 0xffffff, life: 0.12, s0: (s / 128) * 0.8 * k, s1: (s / 128) * 1.0 * k, a0: 0.85, a1: 0, rot });
    b.sx = flip;
  }

  /** b.ev 'heal' visual: a green glow and rising crosses (`o.noSpark`: the official heal hit drew it; the number stays). */
  heal(view, amount, o) {
    if (!view) return;
    const p = this._chest(view);
    const s = p.s;
    if (!o?.noSpark) this.particle('glow', p.x, p.y, { tint: 0x62f08a, life: 0.3, s0: (s / 128) * 0.5, s1: (s / 128) * 0.9, a0: 0.55, a1: 0 });
    for (let i = 0; i < (o?.noSpark ? 0 : this.quality === 'low' ? 1 : 3); i++) {
      this.particle('plus', p.x + (Math.random() - 0.5) * s * 0.5, p.y + (Math.random() - 0.2) * s * 0.3, {
        tint: 0x7dffa8, vy: -s * 0.9, life: 0.7, s0: s / 64 * 0.32, s1: s / 64 * 0.2, a0: 0.95, a1: 0, fadeIn: 0.08,
      });
    }
    if (this.ctx.settings?.damageNumbers !== false && !this.ctx.settings?.officialDamageNumbers) this.number(view, amount, 'heal', false);
  }

  resourceNumber(view, event) {
    const receipt = resourceFloat(event, this.ctx.settings);
    if (receipt) this.officialNumber(view, Math.abs(event[3]), receipt.type, receipt.text);
  }

  /**
   * One official popup: a red integer (including 0) or the yellow MISS. It does not join a running total.
   * Position is client-side only — the sim stays deterministic.
   */
  officialNumber(view, amount, style, label = null) {
    if (!view) return;
    const miss = style === 'miss';
    const n = miss ? 0 : Math.round(amount);
    if (!miss && (!Number.isFinite(n) || n < 0)) return;
    const now = this.time;
    const cam = this.ctx.cam();
    const base = (view.z || 0) + (view.hover || 0) + (view._headTiles || 1.2) * 0.8;
    const a = cam.project(view.x, view.y, base, this._p);
    const ax = a.x, ay = a.y, s = a.s > 0 ? a.s : 100;
    const pxPerZ = ay - cam.project(view.x, view.y, base + 1, this._q).y;
    const tile = pxPerZ > 1e-3 ? pxPerZ : s;
    const cx = label ? ax : ax + (Math.random() - 0.5) * OFFICIAL_JITTER_X * tile;
    const cy = ay - (label ? 0.2 : OFFICIAL_LIFT_MIN + Math.random() * OFFICIAL_LIFT_SPAN) * tile;
    const sc = numScale(s, false, style);
    const w = (label ? label.length : numChars(n, style)) * NUM_DIGIT_EM * 24 * sc * NUM_POP + NUM_GAP_PX;
    const h = 24 * NUM_LINE_EM * sc * NUM_POP;
    const maxNums = this.load >= 2 ? MAX_NUMBERS >> 1 : MAX_NUMBERS;
    while (this.nums.length >= maxNums) this._releaseNum(this.nums.shift());
    const t = this._takeNum(style);
    t.text.visible = true;
    t.text.alpha = 1;
    t.text.text = label || (miss ? 'MISS' : String(n));
    Object.assign(t, {
      unit: view, style, value: n, life: 0, end: NUM_LIFE, born: now, lastHit: now, pop: 1, big: false, fading: false,
      official: true, label, ox: cx - ax, oy: cy - ay, x0: view.x, y0: view.y, z0: base,
      risePx: NUM_RISE * tile * 0.5, _x: cx, _y: cy, _w: w, _h: h,
    });
    this.nums.push(t);
  }

  /**
   * A damage / heal number over `view` (see the header). Layout in screen space, against EVERY live number (the
   * '41509' / '201625' overlaps were numbers of neighbouring units standing side by side):
   *   * merge: a same-style hit on the same unit within NUM_MERGE_GAP of that number's last hit (and while it is still
   *     young) adds to it — a running total that re-pops and lives a little longer;
   *   * cap: a unit shows at most NUM_PER_TARGET numbers; past it the hit joins the unit's youngest same-style number,
   *     else the unit's oldest number fades out at once;
   *   * lanes: the new number takes the lowest free slot of its unit's lanes (centre, then beside the head, 0 / ±1 / ±2
   *     lane widths), stacking upwards at most NUM_MAX_LINES lines; a slot is free when no live number of any unit
   *     overlaps it now or later (a younger number rises faster: below an older one it must keep that one's rise so
   *     far as a margin) with a gap wide enough that two numbers never read as one;
   *   * crowded (> NUM_CROWD numbers near it): it lives shorter; a pair that still ends up overlapping (units walking
   *     into each other) resolves by fading the older one quickly (_updateNums).
   */
  number(view, amount, style, big) {
    const n = Math.round(amount);
    if (!(n > 0) || !view) return;
    const now = this.time;
    const cam = this.ctx.cam();
    const base = (view.z || 0) + (view.hover || 0) + (view._headTiles || 1.2) * 0.8;
    const a = cam.project(view.x, view.y, base, this._p);
    const ax = a.x, ay = a.y, s = a.s > 0 ? a.s : 100;
    const pxPerZ = ay - cam.project(view.x, view.y, base + 1, this._q).y;
    const risePx = NUM_RISE * (pxPerZ > 1e-3 ? pxPerZ : s * 0.5);
    // the live boxes only change between frames: laid out once per frame / camera, not once per hit (a heavy AoE
    // lands dozens of hits in one frame — re-projecting every live number for each was O(hits × numbers))
    this._layoutNumsOnce(cam);
    // 1. merge into this unit's running total of the same style
    let mine = 0, youngest = null, oldest = null;
    for (const t of this.nums) {
      if (t.unit !== view || t.fading || t.official) continue;
      mine++;
      if (!oldest || t.born < oldest.born) oldest = t;
      if (t.style === style && (!youngest || t.born > youngest.born)) youngest = t;
    }
    const merge = youngest && now - youngest.lastHit < NUM_MERGE_GAP && youngest.life < NUM_RISE_T * 0.55 ? youngest
      : (mine >= NUM_PER_TARGET && youngest ? youngest : null);
    if (merge && this._growFits(merge, n, big)) {
      merge.value += n;
      merge.text.text = (style === 'heal' ? '+' : '') + merge.value;
      merge.pop = 1;
      merge.big = merge.big || big;
      merge.lastHit = now;
      merge.end = Math.min(merge.life + NUM_LIFE * 0.75, Math.max(merge.end, merge.life + NUM_LIFE * 0.6), NUM_MAX_LIFE);
      this._sizeNum(merge);
      return;
    }
    if (mine >= NUM_PER_TARGET && oldest) this._fadeNum(oldest, 0.1);
    // 2. a free slot among the unit's lanes
    const sc = numScale(s, big, style);
    const w = numChars(n, style) * NUM_DIGIT_EM * 24 * sc * NUM_POP + NUM_GAP_PX;
    const h = 24 * NUM_LINE_EM * sc * NUM_POP;
    const lane = Math.max(w, 24 * NUM_DIGIT_EM * sc * 3.2) * 0.62;
    let best = null;
    for (const k of NUM_LANES) {
      const cx = ax + k * lane;
      const cy = this._numSlotPx(cx, ay, w, h, risePx);
      const lift = ay - cy;
      if (!best || lift < best.lift - 0.5) best = { cx, cy, lift, k };
      if (lift <= h * 1.2) break;              // low enough: keep the nearest lane
    }
    const cap = h * NUM_MAX_LINES;
    let { cx, cy } = best;
    if (ay - cy > cap) {
      // over capacity (a knot of units under fire): join this unit's latest same-style total when it fits, else take
      // the capped spot and drop whatever is there (crowded numbers give way at once)
      let same = null;
      for (const t of this.nums) if (t.unit === view && t.style === style && !t.fading && (!same || t.born > same.born)) same = t;
      if (same && this._growFits(same, n, big)) {
        same.value += n;
        same.text.text = (style === 'heal' ? '+' : '') + same.value;
        same.pop = 1;
        same.big = same.big || big;
        same.lastHit = now;
        this._sizeNum(same);
        return;
      }
      // (released at once, not merely ended: they would vanish before the next render anyway, and as obstacles they
      // made every further hit of the same frame search a crowd that is no longer there — a knot under AoE)
      cx = ax; cy = ay - cap;
      let keep = 0;
      for (const t of this.nums) {
        if (Math.abs(t._x - cx) < (t._w + w) / 2 && t._y > cy - h && t._y - t._h < cy) { this._releaseNum(t); continue; }
        this.nums[keep++] = t;
      }
      this.nums.length = keep;
    }
    // 3. crowding: numbers around this spot → a shorter life for everyone new here
    let near = 0;
    for (const t of this.nums) if (!t.fading && Math.abs(t._x - cx) < 150 && Math.abs(t._y - cy) < 110) near++;
    const life = near >= NUM_CROWD ? NUM_LIFE * 0.62 : NUM_LIFE;
    const maxNums = this.load >= 2 ? MAX_NUMBERS >> 1 : MAX_NUMBERS;
    while (this.nums.length >= maxNums) this._releaseNum(this.nums.shift());
    const t = this._takeNum(style);
    t.text.visible = true;
    t.text.alpha = 1;
    t.text.text = (style === 'heal' ? '+' : '') + n;
    Object.assign(t, {
      unit: view, style, label: null, value: n, life: 0, end: life, born: now, lastHit: now, pop: 1, big: !!big, fading: false,
      ox: cx - ax, oy: cy - ay, x0: view.x, y0: view.y, z0: base, risePx, _x: cx, _y: cy, _w: w, _h: h,
    });
    this.nums.push(t);
  }

  /** Whether a merged number's grown text still fits among its neighbours (else a new number is made). */
  _growFits(t, add, big) {
    const sc = numScale(t._s || 100, t.big || big, t.style);
    const w = numChars(t.value + add, t.style) * NUM_DIGIT_EM * 24 * sc * NUM_POP + NUM_GAP_PX;
    for (const o of this.nums) {
      if (o === t || o.fading) continue;
      if (Math.abs(o._x - t._x) < (o._w + w) / 2 && Math.abs(o._y - t._y) < (o._h + t._h) / 2) return false;
    }
    return true;
  }

  /**
   * Lowest (largest screen y) bottom for a number of size w×h centred at x, starting at y0, clear of every live number
   * now and later: above one it must sit on its top; below one it must leave that one's rise so far as a margin
   * (the new number rises faster and would catch up).
   */
  _numSlotPx(x, y0, w, h, risePx) {
    let y = y0;
    for (let pass = 0; pass <= this.nums.length; pass++) {
      let moved = false;
      for (const t of this.nums) {
        if (t.fading && t.text.alpha < 0.3) continue;   // almost gone
        if (Math.abs(t._x - x) >= (t._w + w) / 2) continue;
        const top = t._y - t._h, bottom = t._y;
        const risen = t.risePx * easeOut(Math.min(1, t.life / NUM_RISE_T));
        if (y <= top) continue;                                   // entirely above it (bottom at or over its top)
        if (y - h >= bottom + risen) continue;                    // below it, for good
        y = top;
        moved = true;
      }
      if (!moved) break;
    }
    return y;
  }

  /** Screen boxes of the live numbers (their current anchor, rise and size) → t._x, t._y (bottom), t._w, t._h. */
  _layoutNums(cam) {
    const p = this._p;
    for (const t of this.nums) {
      const u = t.unit;
      if (u && !u.destroyed) { t.x0 = u.x; t.y0 = u.y; }
      cam.project(t.x0, t.y0, t.z0, p);
      t._s = p.s;
      const k = Math.min(1, t.life / NUM_RISE_T);
      t._x = p.x + t.ox;
      t._y = p.y + t.oy - t.risePx * easeOut(k);
      this._sizeNum(t);
    }
    this._laidAt = this.time;
    this._laidCam = cam;
    this._laidKey = camKey(cam);
  }

  /** `_layoutNums` unless the boxes are already current: same frame (fx time) and the same camera framing. */
  _layoutNumsOnce(cam) {
    if (this._laidAt === this.time && this._laidCam === cam && this._laidKey === camKey(cam)) return;
    this._layoutNums(cam);
  }

  /** A number's box size from its value, style, pop and the scale of its last layout (t._s px per tile). */
  _sizeNum(t) {
    const sc = numScale(t._s || 100, t.big, t.style);
    const pop = 1 + t.pop * (NUM_POP - 1);
    t._w = (t.label ? t.label.length : numChars(t.value, t.style)) * NUM_DIGIT_EM * 24 * sc * pop + NUM_GAP_PX;
    t._h = 24 * NUM_LINE_EM * sc * pop;
    t._sc = sc;
  }

  _fadeNum(t, within) {
    if (t.fading) return;
    t.fading = true;
    t.fadeFrom = t.text.alpha;
    t.end = Math.min(t.end, t.life + within);
    t.fadeT0 = t.life;
  }

  _takeNum(style) {
    const P = this.P;
    const font = DMG_STYLE[style]?.font || DMG_STYLE.phys.font;
    const pool = this._numPools || (this._numPools = new Map());
    const list = pool.get(font);
    let t = list && list.length ? list.pop() : null;
    if (!t) {
      const text = new P.BitmapText('0', { fontName: font, fontSize: 24, align: 'center' });
      text.anchor.set(0.5, 1);
      this.ctx.layers.text.addChild(text);
      t = { text, font };
    }
    return t;
  }

  _releaseNum(t) {
    t.text.visible = false;
    t.unit = null;
    const pool = this._numPools || (this._numPools = new Map());
    let list = pool.get(t.font);
    if (!list) pool.set(t.font, list = []);
    if (list.length < 30) list.push(t); else t.text.destroy();
  }

  _updateNums(dt) {
    const cam = this.ctx.cam();
    let w = 0;
    for (const t of this.nums) {
      t.life += dt;
      if (t.life >= t.end) { this._releaseNum(t); continue; }
      t.pop = Math.max(0, t.pop - dt * 6);
      this.nums[w++] = t;
    }
    this.nums.length = w;
    this._layoutNums(cam);
    // a pair still overlapping (their units walked into each other): the older one gives way
    const L = this.nums;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (a.fading) continue;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (b.fading) continue;
        if (Math.abs(a._x - b._x) < (a._w + b._w) / 2 - NUM_GAP_PX * 0.5 && Math.abs((a._y - a._h / 2) - (b._y - b._h / 2)) < (a._h + b._h) / 2 * 0.9) {
          this._fadeNum(a.born <= b.born ? a : b, 0.06);
          if (a.fading) break;
        }
      }
    }
    for (const t of L) {
      const tx = t.text;
      tx.scale.set(t._sc * (1 + t.pop * (NUM_POP - 1)));
      tx.position.set(t._x, t._y);
      let alpha = 1;
      const left = t.end - t.life;
      if (t.fading) alpha = (t.fadeFrom ?? 1) * clamp(left / Math.max(0.01, t.end - t.fadeT0), 0, 1);
      else if (left < NUM_FADE_T) alpha = left / NUM_FADE_T;
      tx.alpha = alpha;
    }
  }

  /** Floating label ('!', '+10') at a screen point, using the damage-number pool. */
  numberAt(x, y, label, tint, life = 0.8) {
    const P = this.P;
    if (this.labels.length >= 24) { const o = this.labels.shift(); o.t.destroy(); }
    const t = new P.BitmapText(String(label), { fontName: DMG_STYLE.true.font, fontSize: 26, align: 'center' });
    t.anchor.set(0.5, 1);
    t.tint = tint;
    t.position.set(x, y);
    this.ctx.layers.text.addChild(t);
    this.labels.push({ t, y0: y, life: 0, max: life });
  }

  _updateLabels(dt) {
    let w = 0;
    for (const l of this.labels) {
      l.life += dt;
      if (l.life >= l.max) { l.t.destroy(); continue; }
      const k = l.life / l.max;
      l.t.position.y = l.y0 - 22 * easeOut(k);
      l.t.alpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      l.t.scale.set(k < 0.12 ? 0.6 + (k / 0.12) * 0.5 : 1.1 - Math.min(0.1, k - 0.12));
      this.labels[w++] = l;
    }
    this.labels.length = w;
  }
}
