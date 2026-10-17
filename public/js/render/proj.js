// public/js/render/proj.js — content-owned projectiles drawn from the stream (`b.snap.proj`) and the manifest.
//
// A content pack that adds its own projectile (`addProjectile({ ..., visual })`, docs/SIM.md) streams it as
// `[[id, x, y, visual]]` in every battle snapshot — the position is the sim's own hit-test position, so a client draws
// it exactly where the damage lands. Its look is the manifest's own `assets.fx.proj[visual]` entry: a picture, its size
// in tiles, how it turns. Nothing here is per-operator code: a pack ships art on the asset CDN plus one manifest entry,
// and the client draws it with no page JS of its own (the sandbox rule: plugin code never runs inside the game page).
//
// A projectile's id is stable for its whole flight, so the layer keeps one sprite per id and recycles it when the id
// leaves the stream (landed, expired, batch ended). A picture the manifest does not describe is simply not drawn — a
// placeholder in the middle of a battle would be worse than nothing; the sim's damage numbers still show.

/** Defaults of one `fx.proj` entry; a pack writes only what differs. `spin` is degrees per second (0 = upright). */
const PROJ_DEFAULTS = Object.freeze({
  w: 0.5, h: 0.5, anchorX: 0.5, anchorY: 0.5, spin: 0, tint: null, alpha: 1, lift: 0.5, fade: 0.12,
});

/** How many content projectiles one layer draws at once (the sim caps the stream itself, at 64). */
const MAX_SPRITES = 96;

const NAMED_TINTS = Object.freeze({ white: 0xffffff, black: 0x000000, gold: 0xffc600, mint: 0x5cf2c0 });

/**
 * `#rgb` / `#rrggbb` / 0xrrggbb / a few plain names → a PIXI tint number; null when unreadable (the sprite keeps its own
 * colours). A pack may write a colour the way its own tools do — the manifest is hand-readable JSON, so both the number
 * form and the CSS string form are accepted.
 */
export function tintOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value >>> 0;
  if (typeof value !== 'string') return null;
  const s = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return parseInt(s.slice(1), 16);
  if (/^#[0-9a-f]{3}$/.test(s)) {
    const [r, g, b] = [s[1], s[2], s[3]];
    return parseInt(r + r + g + g + b + b, 16);
  }
  return Object.prototype.hasOwnProperty.call(NAMED_TINTS, s) ? NAMED_TINTS[s] : null;
}

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/**
 * The look of one projectile `visual`, normalized from the manifest (`assets.fx.proj[visual]`): null when the manifest
 * has no such entry (or it has no picture), so an undescribed stream entry draws nothing.
 *
 * `src` is the picture (an absolute asset URL or one the manifest already resolved); `w`/`h` are board tiles; `lift` is
 * how far above the tile the sprite floats; `anchorX`/`anchorY` are its anchor inside the picture (0..1); `fade` is how
 * long (real seconds) it takes to disappear when it leaves the stream.
 */
export function projStyle(assets, visual) {
  const table = assets && assets.fx && assets.fx.proj;
  const raw = table && typeof table === 'object' && typeof visual === 'string' ? table[visual] : null;
  if (!raw || typeof raw !== 'object') return null;
  const src = typeof raw.src === 'string' && raw.src ? raw.src : null;
  if (!src) return null;
  return {
    visual,
    src,
    w: Math.max(0.02, num(raw.w, PROJ_DEFAULTS.w)),
    h: Math.max(0.02, num(raw.h, PROJ_DEFAULTS.h)),
    anchorX: Math.min(1, Math.max(0, num(raw.anchorX, PROJ_DEFAULTS.anchorX))),
    anchorY: Math.min(1, Math.max(0, num(raw.anchorY, PROJ_DEFAULTS.anchorY))),
    spin: num(raw.spin, PROJ_DEFAULTS.spin),
    tint: tintOf(raw.tint),
    alpha: Math.min(1, Math.max(0, num(raw.alpha, PROJ_DEFAULTS.alpha))),
    lift: num(raw.lift, PROJ_DEFAULTS.lift),
    fade: Math.max(0.02, num(raw.fade, PROJ_DEFAULTS.fade)),
  };
}

/**
 * Every content projectile of one battle field.
 *
 * `sync(list)` once per rendered frame with `interp.projAt(renderT)` (`[id, x, y, visual]` entries; null/empty fades
 * everything out), `update(dt)` once per frame to place, turn and fade them, `clear()` when the field view goes away.
 *
 * @param {any} P the PIXI namespace the field view already uses
 * @param {{ container: any, textureOf: (src: string) => any, assets: any,
 *           project: (x: number, y: number, z: number, out: object) => object, groundZ?: ((x: number, y: number) => number)|null }} o
 *   `textureOf` resolves a manifest picture through the renderer's own material cache (so one picture is loaded once);
 *   `project` is the field camera's own board→screen mapping; `groundZ` is the tile's drawn height (0 for a flat board).
 */
export class ProjLayer {
  constructor(P, o) {
    this.P = P;
    this.o = o;
    this.live = new Map();      // id → record
    this.free = [];
    this.time = 0;
    this._p = { x: 0, y: 0, s: 1 };   // reused projection output
  }

  /** The streamed list of the frame being drawn: new ids get a sprite, present ids are moved, gone ids start to fade. */
  sync(list) {
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    if (Array.isArray(list)) {
      for (const e of list) {
        if (!Array.isArray(e) || e.length < 4) continue;
        const id = e[0];
        if (!(typeof id === 'number' || typeof id === 'string')) continue;
        if (!Number.isFinite(e[1]) || !Number.isFinite(e[2])) continue;
        seen.add(id);
        let rec = this.live.get(id);
        if (!rec) {
          if (this.live.size >= MAX_SPRITES) continue;
          rec = this._take();
          rec.id = id;
          this.live.set(id, rec);
        }
        rec.x = e[1];
        rec.y = e[2];
        rec.visual = e[3];
        rec.out = 0;
      }
    }
    for (const rec of this.live.values()) if (!seen.has(rec.id)) this._retire(rec);
  }

  /** One frame: place every recorded projectile where the sim has it, turn it, fade the ones that left. */
  update(dt) {
    this.time += Math.max(0, Number(dt) || 0);
    if (!this.live.size) return;
    const step = Math.max(0, Number(dt) || 0);
    for (const [id, rec] of this.live) {
      const look = projStyle(this.o.assets, rec.visual);
      if (!look) { this._free(id); continue; }
      if (rec.out > 0) {
        rec.out += step;
        if (rec.out >= look.fade) { this._free(id); continue; }
      }
      const p = this.o.project(rec.x, rec.y, (this.o.groundZ ? num(this.o.groundZ(rec.x, rec.y), 0) : 0) + look.lift, this._p);
      const sp = rec.sp;
      if (sp.texture !== this._tex(rec, look)) sp.texture = this._tex(rec, look);
      sp.anchor.set(look.anchorX, look.anchorY);
      sp.position.set(p.x, p.y);
      sp.scale.set((look.w * p.s) / Math.max(1, sp.texture.width), (look.h * p.s) / Math.max(1, sp.texture.height));
      if (look.spin) sp.rotation = (this.time * look.spin * Math.PI) / 180;
      if (look.tint != null) sp.tint = look.tint;
      const k = rec.out > 0 ? Math.max(0, 1 - rec.out / look.fade) : 1;
      sp.alpha = look.alpha * k;
      sp.visible = true;
    }
  }

  /** Drop every projectile (the field view went away / the battle ended). */
  clear() {
    for (const id of [...this.live.keys()]) this._free(id);
    this.live.clear();
  }

  /** Records drawn right now (a render test's hook; the renderer itself never reads it). */
  get size() { return this.live.size; }

  _tex(rec, look) {
    const key = look.src;
    if (rec.texKey !== key) { rec.tex = this.o.textureOf(key); rec.texKey = key; }
    return rec.tex;
  }

  _take() {
    const rec = this.free.pop() || this._new();
    rec.id = null;
    rec.out = 0;
    rec.visual = null;
    rec.texKey = null;
    rec.sp.visible = false;
    return rec;
  }

  _new() {
    const P = this.P;
    const sp = new P.Sprite(P.Texture.EMPTY);
    sp.visible = false;
    this.o.container.addChild(sp);
    return { id: null, sp, x: 0, y: 0, visual: null, out: 0, tex: null, texKey: null };
  }

  _retire(rec) {
    if (rec.out > 0) return;   // already fading
    rec.out = 1e-6;
  }

  _free(id) {
    const rec = this.live.get(id);
    if (!rec) return;
    this.live.delete(id);
    rec.sp.visible = false;
    rec.sp.alpha = 0;
    rec.id = null;
    this.free.push(rec);
  }
}
