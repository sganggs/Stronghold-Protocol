// render/vfx/funnelfx.js — the 驭械术士's floating units (浮游单元) in a battle (DESIGN §33.18): the plans of
// render/vfx/funnels.js played on the signals the field view already receives. render/vfx/wiring.js owns one
// (`FxWiring.funnels`) and calls it from its entry points; client only — no sim, protocol or golden change.
//
//   const f = new FunnelFx(wiring)
//   f.of(v)                               the unit's plan and state (resolved once per battle id), or null
//   f.owns(unitKey, binding)              a TalentFx binding that is a floating unit's look (FunnelFx draws it)
//   f.castStart(src, tgt, kind, info)     the funnel shot's casts that start with the owner's wind-up
//   f.attack(src, tgt, kind, time, again, wound) → { skipBody } | null   the owner's 'atk': its units' part
//   f.damage(v, time, type)               an HP 'dmg' on v: an attached unit's hit lands (its lunge)
//   f.skill(v, on) / f.simFx(kind, x, y, extra) / f.sync(views) / f.release(v) / f.keys(views) / f.clear()
//
// What plays when (funnels.js header for the client's structure):
//   * Home. While a unit is home, its loop follows its Special point (the prefab's FollowMountPoint, with the point's
//     rotation) where the model draws the point's bone (render/vfx/mounts.js, UnitView.boneOffset — DESIGN §32.14.36:
//     the wiring follows every FollowMountPoint so): in a mode whose attack holds units, the first n of them with an
//     idle loop — n: the units the skill releases (1 + its blackboard attack@cnt, the sim kit's count), else the units
//     one attack showed (荒芜拉普兰德: her normal attack's hits after the body hit; before the first, 1 + the equipped
//     skill's passive "浮游单元+N" — funnels.js initialCount) —, their back loop for a unit facing back, the overload
//     loop in an overload; in the modes of a general funnel shot, the passive ability's loop (至简's drone, 耶拉's token,
//     洛洛's and 澄闪's drone). One key on one point plays once, so a mode switch to the same loop keeps it running.
//   * An attack ('atk') of an attached mode (荒芜拉普兰德's normal attack, S1, S2: the sim deals the units' hits with the
//     owner's attack): each unit lands with its damage — the k-th HP 'dmg' on the target after the body hit is unit k's
//     hit (several targets of one attack, S2: target j is unit j's, each of its hits) — playing its hit group there (the
//     wolf lunging through the target); LUNGE_S later it is home again (its `_appearEffect`). A normal attack's units
//     (MultiFunnelsNormalAttack) leave home with the attack (their `_disappearEffect`), a skill mode's with their hit. The
//     body shot flies at the attack's first target only. A mode a 'drone' fx shows to be remote: her own shot only.
//   * A funnel shot (the general ability, a skill's own: 洛洛 / 至简 / 耶拉 / 澄闪's normal attack, 至简 S2) flies its projectile
//     from its mount to the target in the sim's flight time (its hit on arrival), its casts on the unit with the wind-up.
//   * A remote unit (a skill's units on their own clock: 洛洛 S2, 耶拉 S2, 澄闪's skills — the kit's 'drone' fx, one per hit
//     at the lock): the unit of the fx (the k-th of the owner's fx in a frame is unit k) leaves home at its first hit
//     and plays its hit groups in turn on the enemy there (the overload groups after the kit's 'overload'; each prefab
//     carries the unit beside the target, so the previous one stops); it comes back (appear) RETURN_S after its last
//     hit, or at the skill's end.
//   * 荒芜拉普兰德 S3 (the dispersed units; the kit's 'drones' / 'droneLock' / 'drone'): each unit is a flight of its own
//     — the wolf (`main`) spreads from her (the sim kit's speeds, which are the client's: spread 0.1 → 2 at 1.9, chase
//     2 → 4 at 1), chases the enemy a 'droneLock' names (the trace mark over it), latches on (the latched mark) and lunges
//     at each 'drone' at its target; a lost target sends it to a point near it, a pulse elsewhere pulls it towards the
//     sim's place; the skill's end stops them. Her start buff loop plays with the release.
//   * The kit fx the units stand for are not drawn procedurally (the light pillar of 'drone' / 'drones', the reticle of
//     'droneLock', the chevrons of 'overload'): simFx returns true when the unit's effects are there.
// [ASSUMED] (the client's choices are engine code): RETURN_S, LUNGE_S, the appear / disappear moments at a skill's start and
// end, the hits at the sim's damage moment (AttachToTarget's 0.5 s delay not added), a unit's flight height, the S3
// pulse correction, the S3 hover (the sim kit's 0.9 radius; the client's HoveringInPlaceMovement says 1.25).

import { funnelPlan, planKeys, initialCount } from './funnels.js';
import { skillRecordOf } from './skills.js';
import { later } from './skillfx.js';
import { unitPoint } from './mounts.js';

/** Battle seconds a remote unit with no hit stays out before it comes back [ASSUMED]. */
export const RETURN_S = 2;
/** Battle seconds an attached unit's hit plays before it is home again (whitw2_token_hit_0X's clip: 0.83 s) [ASSUMED]. */
export const LUNGE_S = 0.85;
/** Tiles within which a kit fx's point is on an enemy view. */
const SNAP = 0.6;
/** Battle seconds after an 'atk' within which the target's damage belongs to it (the flight plus a margin). */
const HIT_WINDOW = 0.35;
/** 荒芜拉普兰德 S3 as the sim kit flies it (server/sim/content/kits/ops/chess_char_6_18-whitw2.js WHITW2_*): the spread and
 * chase are the client's own (projectile_chr_whitw2_funnel_s3_X); the hover radius is the kit's (the client: 1.25). */
const S3 = Object.freeze({ spread: { v0: 0.1, acc: 1.9, max: 2 }, chase: { v0: 2, acc: 1, max: 4 }, orbit: { r: 0.9, v: 1 }, side: 1.5, times: 1.3 });
/** Height of a dispersed unit over the ground (tiles), as a HitPoint (0.25) [ASSUMED]. */
const FLY_H = 0.3;
const DIR_ANGLE = { RIGHT: 0, UP: Math.PI / 2, LEFT: Math.PI, DOWN: -Math.PI / 2 };

const idOf = (v) => v?.info?.id ?? v?.id;
const alive = (v) => !!v && !v.destroyed && v.alive !== false;
/** A seeded value in [0, 1) of a unit and a counter (replays show the same). */
function rnd(id, n) {
  let h = 2166136261;
  for (const c of String(id ?? '')) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h = Math.imul(h ^ (n | 0), 2654435761);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export class FunnelFx {
  /** @param {import('./wiring.js').FxWiring} w */
  constructor(w) {
    this.w = w;
    this.units = new Map();   // battle id → U | null
    this.plans = new Map();   // index unit key → FunnelPlan | null
    this.views = [];          // the views of the last frame (a kit fx's point → its enemy)
    this.sweep = 0;
    this.tier = null;
    this.wasActive = false;
  }

  active() { return !!this.w.ofx.active && !!this.w.idx; }

  /** The record of a battle unit, or null when it has no floating unit. */
  of(v) {
    if (!v || !this.w.idx) return null;
    const id = idOf(v);
    if (id == null) return null;
    let U = this.units.get(id);
    if (U === undefined) {
      U = null;
      const info = v.info || null;
      if (info && info.side !== 'enemy' && info.kind !== 'device' && info.kind !== 'item') {
        const key = this.w.unitKeyOf(v);
        const plan = this._plan(key);
        if (plan) {
          const rec = this._record(info);
          const si = Number.isInteger(info.diy?.skillIndex) ? info.diy.skillIndex : Number.isInteger(info.skillIndex) ? info.skillIndex : undefined;
          const srec = skillRecordOf(rec, si);
          U = {
            id, key, v, plan, rec, srec, dmgType: rec && typeof rec.dmgType === 'string' ? rec.dmgType : null,
            attachN: 0,             // units one attach attack showed (0: initialCount)
            home: new Map(),        // `${key}|${mount}` → { h, key, mount, unit }
            out: new Map(),         // `${mode}|${i}` → { until, hit (a remote unit's playing hit), n (its hits) }
            pend: new Map(),        // target id → { mode, t, window, n, body, units } (an attach attack's damage on it)
            remote: new Set(),      // modes whose units hit on the kit's 'drone' fx (not with her attack)
            frame: -1, targets: [], // the 'atk' targets of the unit's attack this frame
            fxFrame: -1, fxK: 0,    // the kit's 'drone' fx of this frame
            overload: false, skillOn: null, remoteN: 0, s3: null, appearNext: false, lastMode: null,
          };
        }
      }
      this.units.set(id, U);
    }
    if (U) U.v = v;
    return U;
  }

  /** The unit's data record (FxWiring opts.record: render/app.js ctx.lookupDef), or null. */
  _record(info) {
    try { return typeof this.w.opts.record === 'function' ? this.w.opts.record(info) || null : null; } catch { return null; }
  }

  /** The plan of an index unit, once per battle. */
  _plan(key) {
    if (!key || !this.w.idx) return null;
    let p = this.plans.get(key);
    if (p === undefined) { p = funnelPlan(this.w.idx, key); this.plans.set(key, p); }
    return p;
  }

  /** Whether the unit's skill is on: the last 'skill' event, else the skills' state (UF.SKILL of a view built late). */
  _on(U) { return U.skillOn != null ? U.skillOn : !!(U.v && this.w.skills.state(U.v).on); }

  /** Whether `key` can play (the effect was extracted). */
  _has(key) { return !!key && this.w.ofx.lib.has(key); }

  /** The unit's attack mode now (FxWiring.mode: the skill's mode while on, else Default). */
  _mode(U, v) {
    const u = this.w.unitOf(v);
    const m = u ? this.w.mode(u, v) : null;
    return m?.name || 'Default';
  }

  /**
   * How many of a mode's units are out / float at home (module header): those one attack showed (the hits after the body
   * hit), else 1 + the equipped skill's passive units; with the skill on at least the units it releases — the kit's
   * 'drones' count, else 1 + the skill's blackboard attack@cnt (the sim kits' count).
   */
  _count(U, m) {
    const n = m.funnels.length;
    let k = U.attachN || initialCount(U.srec, n);
    if (this._on(U)) {
      const c = Number(U.srec?.bb?.['attack@cnt']);
      if (U.remoteN > 0) k = Math.max(k, U.remoteN);
      else if (Number.isFinite(c) && c >= 0) k = Math.max(k, 1 + Math.floor(c));
    }
    return Math.max(1, Math.min(n, k));
  }

  /** A TalentFx binding that is the floating unit's look (the passive general ability FunnelFx draws instead). */
  owns(unitKey, b) {
    if (!b || b.source !== 'ability' || !b.node) return false;
    const plan = this._plan(unitKey);
    return !!plan && plan.idleNodes.has(b.node);
  }

  // ---- home ---------------------------------------------------------------------------------------------------------

  /** The loops that float at home now: [{ key, mount, unit }] (module header). */
  _want(U, v, mode) {
    const out = [];
    const back = !!this.w.pose(v).back;
    const m = U.plan.modes[mode];
    const d = U.plan.dispersed;
    if (d && U.s3) return out;                       // every unit is out
    if (m) {
      if (!m.idle) return out;                       // no home loop in this mode (荒芜拉普兰德 S2)
      const n = this._count(U, m);
      for (const f of m.funnels.slice(0, n)) {
        if (!f.idle || U.out.has(`${mode}|${f.i}`)) continue;
        let key = U.overload && f.overload ? f.overload : f.idle;
        if (back && f.back && !(U.overload && f.overload)) key = f.back;
        if (!this._has(key)) continue;
        out.push({ key, mount: this._mountOf(key), unit: f });
      }
      return out;
    }
    if (d && d.modes.includes(mode)) return out;
    for (const g of U.plan.general) {
      if (!g.modes.includes(mode)) continue;
      for (const e of g.idle) if (this._has(e.key)) out.push({ key: e.key, mount: e.mount, unit: null });
    }
    return out;
  }

  /** A prefab's FollowMountPoint (index.json prefabs[key].follow), or null. */
  _mountOf(key) {
    const s = this.w.idx?.prefabs?.[key];
    return Number.isInteger(s?.follow) ? s.follow : null;
  }

  /** Play a one-shot of a unit on its home point (its appear / disappear). */
  _homeShot(U, key) {
    if (!this._has(key) || !U.v) return null;
    return this.w.playOn(key, U.v, { follow: true });
  }

  /** Reconcile the home loops with what should float (sync). */
  _syncHome(U, v, mode) {
    const want = this._want(U, v, mode);
    const keys = new Set(want.map((e) => `${e.key}|${e.mount}`));
    for (const [k, t] of U.home) if (!keys.has(k) || !t.h.alive) { if (!keys.has(k)) t.h.stop(); U.home.delete(k); }
    for (const e of want) {
      const k = `${e.key}|${e.mount}`;
      const cur = U.home.get(k);
      if (cur) { cur.unit = e.unit; continue; }   // the same loop on the same point (a mode switch): kept
      // a unit shown where nothing of its own floated (a skill's added unit, the units back from the hunt): its appear
      if (U.appearNext && e.unit?.appear) this._homeShot(U, e.unit.appear);
      const h = this.w.playOn(e.key, v, { follow: true, loop: true, important: true });
      if (h) U.home.set(k, { h, key: e.key, mount: e.mount, unit: e.unit });
    }
    U.appearNext = false;
  }

  /**
   * A unit leaves home (to attack): its disappear, its loop gone at once (FunnelEffectEmitter `_setActiveFalseWhenPause`:
   * the client deactivates it — a stop would leave its mesh particle up for its lifetime); out until `until`.
   */
  _leave(U, mode, f, until) {
    const slot = `${mode}|${f.i}`;
    const o = U.out.get(slot);
    if (o) { o.until = Math.max(o.until, until); return o; }
    const rec = { until, hit: null, n: 0 };
    U.out.set(slot, rec);
    for (const [k, t] of U.home) if (t.unit === f || (t.unit == null && t.mount === this._mountOf(f.idle))) { t.h.kill(); U.home.delete(k); }
    if (f.disappear) this._homeShot(U, f.disappear);
    return rec;
  }

  /** A unit comes back: its appear (when it floats at home in the mode now), its hit stops. */
  _back(U, slot, f) {
    const o = U.out.get(slot);
    U.out.delete(slot);
    if (o?.hit) o.hit.stop();
    if (f?.appear && U.v && alive(U.v)) {
      const mode = this._mode(U, U.v);
      if (this._want(U, U.v, mode).some((e) => e.unit === f)) this._homeShot(U, f.appear);
    }
  }

  // ---- attacks ----------------------------------------------------------------------------------------------------

  /** The funnel shot of the owner's attack now: the skill's own while it is on, else the general one of the mode. */
  _shot(U, mode) {
    const on = this.w.skills.state(U.v).on;
    const sid = this.w.skills.of(U.v)?.skillId;
    if (on && sid && U.plan.skills[sid]) return U.plan.skills[sid];
    return U.plan.general.find((g) => g.modes.includes(mode)) || null;
  }

  /** The owner's wind-up began: the funnel shot's casts that start with it. */
  castStart(src, tgt, kind, info = {}) {
    const U = this.active() ? this.of(src) : null;
    if (!U || !tgt) return false;
    const mode = this._mode(U, src);
    if (U.plan.modes[mode]) return false;
    const g = this._shot(U, mode);
    return this._casts(U, g, 'start', info) > 0;
  }

  /** A funnel shot's cast rows for a phase ('start' | 'strike' | 'all') on its unit. */
  _casts(U, g, phase, info = {}) {
    let n = 0;
    for (const e of g?.cast || []) {
      if (phase !== 'all' && e.phase !== phase) continue;
      const h = this.w.playOn(e.key, U.v, { follow: true, skip: phase === 'start' ? info.skip : 0 });
      if (!h) continue;
      n++;
      if (e.loop) later(this.w.ofx, phase === 'start' && info.left > 0 ? Math.min(3, info.left) : 0.6, () => h.stop());
    }
    return n;
  }

  /**
   * b.ev 'atk' of `src` (FxWiring.attack, after the mode's own casts): its units' part (module header). Returns
   * { skipBody } (the body shot of another target of the same attack is not flown), or null for a unit with none.
   */
  attack(src, tgt, kind, time, again = false, wound = false) {
    const U = this.active() ? this.of(src) : null;
    if (!U || !tgt || !kind || kind === 'none') return null;
    const mode = this._mode(U, src);
    const m = U.plan.modes[mode];
    if (!m) {
      // the funnel shot (the general ability or the skill's own) at the attack's first target
      const g = this._shot(U, mode);
      if (!g || again) return { skipBody: false };
      this._casts(U, g, wound ? 'strike' : 'all');
      const proj = g.projectileKey ? this.w.idx.projectiles[g.projectileKey] : null;
      if (proj) this.w._fly(proj, src, tgt, kind, time, g.mount != null ? { mount: g.mount } : {});
      return { skipBody: false };
    }
    // a mode whose units hit on the kit's 'drone' fx (洛洛 S2, 耶拉 S2): her attack is her own shot only
    if (U.remote.has(mode)) return { skipBody: false };
    const fr = this.w.skills.frame;
    if (U.frame !== fr) { U.frame = fr; U.targets = []; }
    const j = U.targets.length;
    U.targets.push(tgt);
    const tid = idOf(tgt);
    const window = this.w._flightTime(src, tgt, kind) + HIT_WINDOW;
    if (j === 0) {
      // one target: the body hit, then the units' (their count: the hits after it); a normal attack's units
      // (MultiFunnelsNormalAttack) leave with it, a skill mode's with their own hit (its units may be remote: a 'drone'
      // fx then shows it, and its hits are not taken for theirs)
      U.pend.set(tid, { mode, t: time, window, n: 0, body: true, units: [] });
      const back = this.w.ofx.time + window + LUNGE_S;
      if (m.idle && m.cls === 'MultiFunnelsNormalAttack') for (const f of m.funnels.slice(0, this._count(U, m))) this._leave(U, mode, f, back);
    } else {
      // several targets in one attack (S2's locks — one enemy may hold several): the j-th 'atk' is unit j's, and the
      // first target's hits are then units too (no body hit)
      if (j === 1) { const p0 = U.pend.get(idOf(U.targets[0])); if (p0 && p0.t === time && p0.body) { p0.body = false; p0.units = [0]; } }
      const p = U.pend.get(tid);
      if (p && p.t === time && !p.body) p.units.push(j);
      else U.pend.set(tid, { mode, t: time, window, n: 0, body: false, units: [j] });
    }
    return { skipBody: j > 0 };
  }

  /**
   * b.ev 'dmg' (an HP hit) on v: an attached unit's hit lands — its group plays on v (module header). The 'dmg' names no
   * source: the hits of one attack are those of the owner's damage type (its data record's: the 驭械术士's arts; none known,
   * every HP hit) in the tick of the first one (the sim deals the body hit and the units' with the attack, in one call);
   * another tick's ends the record.
   */
  damage(v, time, type = null) {
    if (!this.active() || !v) return false;
    const tid = idOf(v);
    let drew = false;
    for (const U of this.units.values()) {
      const p = U?.pend.get(tid);
      if (!p) continue;
      if (time - p.t > p.window || U.remote.has(p.mode) || (p.n > 0 && time !== p.t1)) { U.pend.delete(tid); continue; }
      if (type != null && U.dmgType && type !== U.dmgType) continue;
      if (p.n === 0) p.t1 = time;
      p.n++;
      if (p.body && p.n < 2) continue;              // the body hit
      // the units in turn after it; the units of this target's 'atk's (several targets of one attack)
      const k = p.body ? p.n - 2 : p.units[Math.min(p.n - 1, p.units.length - 1)] ?? 0;
      const m = U.plan.modes[p.mode];
      const f = m && m.funnels[Math.min(k, m.funnels.length - 1)];
      if (!f) continue;
      if (p.body) U.attachN = Math.max(U.attachN, Math.min(m.funnels.length, p.n - 1));
      const g = f.hits[0] || [];
      for (const key of g) if (this.w.playOn(key, v, { flipFrom: U.v || undefined })) drew = true;
      const o = U.out.get(`${p.mode}|${f.i}`);
      if (o) o.until = Math.max(o.until, this.w.ofx.time + LUNGE_S);
      else if (m.idle && k < this._count(U, m)) this._leave(U, p.mode, f, this.w.ofx.time + LUNGE_S);
    }
    return drew;
  }

  // ---- remote units (the kit's 'drone' fx) --------------------------------------------------------------------------

  /** The live enemy view nearest to (x, y) within SNAP, or null. */
  _enemyAt(x, y) {
    let best = null, bd = SNAP;
    for (const v of this.views) {
      if (!v || !v.isEnemy || !alive(v)) continue;
      const d = Math.hypot(v.x - x, v.y - y);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  /** A remote unit's hit at (x, y): the next of its groups on the enemy there (module header). */
  _remoteHit(U, x, y) {
    const v = U.v;
    const mode = this._mode(U, v);
    const m = U.plan.modes[mode];
    if (!m) return false;
    // its units hit on their own: her attacks in this mode are her own shot (their pending hits are dropped)
    if (!U.remote.has(mode)) { U.remote.add(mode); for (const [tid, p] of U.pend) if (p.mode === mode) U.pend.delete(tid); }
    const fr = this.w.skills.frame;
    if (U.fxFrame !== fr) { U.fxFrame = fr; U.fxK = 0; }
    const n = this._count(U, m);
    const f = m.funnels[(U.fxK++) % Math.max(1, n)];
    if (!f) return false;
    const now = this.w.ofx.time;
    const fresh = !U.out.has(`${mode}|${f.i}`);
    const o = this._leave(U, mode, f, now + RETURN_S);
    o.until = now + RETURN_S;
    // units of one skill hitting in step with the same groups (澄闪's) start their sequences one apart [ASSUMED]
    if (fresh) o.n = f.i;
    const groups = U.overload && f.overloadHits ? f.overloadHits : f.hits;
    const g = groups.length ? groups[o.n % groups.length] : [];
    o.n++;
    const tgt = this._enemyAt(x, y) || { id: `fx:${idOf(v)}`, x, y, z: 0 };
    if (o.hit) { o.hit.stop(); o.hit = null; }
    let drew = false;
    // the hit prefab carries the unit beside the target — AttachToTarget at its HitPoint: it goes where the enemy goes —,
    // moved by its FunnelHitEffect's random range (±x, ±y in the battle frame) once per hit
    const skin = this.w.skinOf(this.w.unitOf(tgt));
    o.seed = (o.seed || 0) + 1;
    for (const key of g) {
      const j = this._jitter(key, `${U.id}|${f.i}`, o.seed);
      const track = tgt.info ? (fx) => {
        if (alive(tgt)) unitPoint(skin, 'hit', this.w.pose(tgt), fx.anchor);
        else if (fx.jit) return;
        fx.anchor[0] += j[0]; fx.anchor[1] += j[1]; fx.anchor[2] += j[2]; fx.jit = true;
      } : null;
      const h = this.w.playOn(key, tgt, { flipFrom: v, loop: true, important: true, track });
      if (h) { drew = true; o.hit = h; }
    }
    return drew || g.some((k) => this._has(k));
  }

  /** A hit prefab's FunnelHitEffect offset (its `_randomRange`, uniform ±), seeded by the unit and its hit count. */
  _jitter(key, id, n) {
    const def = this.w.ofx.lib.def(key);
    const bs = def?.desc?.nodes?.[0]?.behaviours;
    const fh = Array.isArray(bs) ? bs.find((b) => b?.class === 'FunnelHitEffect') : null;
    const r = Array.isArray(fh?.fields?._randomRange) ? fh.fields._randomRange.map((x) => Math.abs(Number(x) || 0)) : null;
    if (!r) return [0, 0, 0];
    return r.slice(0, 3).map((x, i) => (x > 0 ? (rnd(id, n * 3 + i) * 2 - 1) * x : 0));
  }

  // ---- 荒芜拉普兰德 S3: the dispersed units -----------------------------------------------------------------------------

  /** The kit released `n` units ('drones'): flights from her, evenly spread with one along her facing. */
  _release(U, n) {
    const d = U.plan.dispersed;
    const v = U.v;
    if (!d || !v || !(n > 0)) return false;
    const first = !U.s3;
    if (first) U.s3 = { drones: [], n: 0, drawable: d.units.some((u) => this._has(u.main)) };
    const a0 = DIR_ANGLE[String(v.dir || '').toUpperCase()] ?? ((v.visFacing ?? 1) < 0 ? Math.PI : 0);
    for (let i = 0; i < n; i++) {
      const a = a0 + (2 * Math.PI * i) / n;
      const k = U.s3.drones.length;
      const unit = d.units[Math.min(k, d.units.length - 1)];
      const dr = { k, unit, x: v.x, y: v.y, hx: Math.cos(a), hy: Math.sin(a), v: S3.spread.v0, age: 0, phase: 'spread', t: null, orbit: null,
        idleT: 0, h: null, trace: null, latched: null, latchedKey: d.marks.latched, seed: U.s3.n++ };
      dr.h = this._flight(U, dr);
      U.s3.drones.push(dr);
    }
    if (first) {
      // the units leave home; her release loop (WolvesDispersed's BuffToOwner: its LIMITED time)
      for (const [, t] of U.home) { if (t.unit?.disappear) this._homeShot(U, t.unit.disappear); t.h.kill(); }
      U.home.clear();
      for (const e of d.start) {
        const h = this.w.playOn(e.key, v, { follow: true, loop: true, important: true });
        if (h) later(this.w.ofx, e.s > 0 ? e.s : 0.6, () => h.stop());
      }
    }
    return U.s3.drawable;
  }

  /** A dispersed unit's flying effect, placed each frame at the unit and turned along its heading. */
  _flight(U, dr) {
    const key = dr.unit?.main;
    if (!this._has(key)) return null;
    const def = this.w.ofx.lib.def(key);
    const pos = this._flyPos(dr);
    return this.w.ofx.spawn(key, { pos, groundZ: pos[2], rootRot: [0, 0, 0, 1] }, {
      loop: true, important: true,
      track: (fx) => {
        const p = this._flyPos(dr);
        fx.anchor[0] = p[0]; fx.anchor[1] = p[1]; fx.anchor[2] = p[2];
        const flip = !!(def ? def.flipIfLeft : this.w.ofx.lib.def(key)?.flipIfLeft);
        if (flip && dr.hx < 0) { fx.mirror = true; fx.yaw = Math.atan2(dr.hy, -dr.hx); } else { fx.mirror = false; fx.yaw = Math.atan2(dr.hy, dr.hx); }
        fx.pitch = 0;
      },
    });
  }

  /** The Unity point of a dispersed unit: its target's HitPoint while latched, else FLY_H over the ground under it. */
  _flyPos(dr) {
    if (dr.phase === 'lock' && dr.t && alive(dr.t)) {
      const u = this.w.unitOf(dr.t);
      return unitPoint(this.w.skinOf(u), 'hit', this.w.pose(dr.t), [0, 0, 0]);
    }
    const hAt = this.w.ofx.ctx?.heightAt;
    const g = typeof hAt === 'function' ? Math.max(0, Number(hAt(Math.round(dr.y), Math.round(dr.x))) || 0) : 0;
    return [dr.x - 10, dr.y - 9, -(g + FLY_H)];
  }

  /** The kit's 'droneLock' (a unit picks `tgt`): the free unit nearest to it chases it, the trace mark over it. */
  _lock(U, tgt, x, y) {
    const D = U.s3?.drones;
    if (!D || !D.length) return false;
    const tx = tgt ? tgt.x : x, ty = tgt ? tgt.y : y;
    const free = (dr) => dr.phase === 'spread' || dr.phase === 'seek' || !dr.t || !alive(dr.t);
    let best = null, bd = Infinity;
    for (const dr of D) {
      if (!free(dr)) continue;
      const d = Math.hypot(dr.x - tx, dr.y - ty);
      if (d < bd) { bd = d; best = dr; }
    }
    if (!best) return true;
    if (best.t && !alive(best.t)) this._lost(U, best);
    this._marks(best, null);
    best.t = tgt || null;
    best.phase = tgt ? 'chase' : 'seek';
    best.v = S3.chase.v0;
    best.orbit = null;
    if (tgt && this._has(U.plan.dispersed.marks.trace)) best.trace = this.w.playOn(U.plan.dispersed.marks.trace, tgt, { follow: true, loop: true, important: true });
    return true;
  }

  /** Stop a dispersed unit's marks (and start the latched one on `tgt`). */
  _marks(dr, latchOn) {
    if (dr.trace && !latchOn) { dr.trace.stop(); dr.trace = null; }
    if (dr.latched) { dr.latched.stop(); dr.latched = null; }
    if (latchOn && this._has(dr.latchedKey)) dr.latched = this.w.playOn(dr.latchedKey, latchOn, { follow: true, loop: true, important: true });
  }

  /** A unit's target fell or left: it reappears near that spot and waits for its next lock (the sim's draw is its own). */
  _lost(U, dr) {
    const h = S3.side / 2;
    const at = dr.t ? { x: dr.t.x, y: dr.t.y } : { x: dr.x, y: dr.y };
    dr.x = at.x + (rnd(U.id, dr.seed * 7 + 1) * 2 - 1) * h;
    dr.y = at.y + (rnd(U.id, dr.seed * 7 + 2) * 2 - 1) * h;
    dr.seed += 3;
    this._marks(dr, null);
    dr.t = null; dr.phase = 'seek'; dr.orbit = null; dr.idleT = 0;
  }

  /** One frame of the dispersed units (the sim kit's flyDrone, mirrored). */
  _stepS3(U, dt) {
    const D = U.s3?.drones;
    if (!D || !(dt > 0)) return;
    const acc = (dr, lim) => { const v1 = Math.min(lim.max, dr.v + lim.acc * dt), s = ((dr.v + v1) / 2) * dt; dr.v = v1; return s; };
    const times = Number(U.srec?.bb?.['attack@times']);
    const spreadT = Number.isFinite(times) && times >= 0 ? times : S3.times;
    for (const dr of D) {
      if (dr.phase === 'spread') {
        const s = acc(dr, S3.spread);
        dr.x += dr.hx * s; dr.y += dr.hy * s;
        dr.age += dt;
        if (dr.age >= spreadT) { dr.phase = 'seek'; dr.idleT = 0; }
        continue;
      }
      if ((dr.phase === 'chase' || dr.phase === 'lock') && !alive(dr.t)) this._lost(U, dr);
      if (dr.phase === 'seek') {
        // no lock yet: it circles counter-clockwise, its heading the tangent (after a beat: the lock comes in the same tick)
        dr.idleT = (dr.idleT || 0) + dt;
        if (dr.idleT < 0.25) continue;
        const { r, v } = S3.orbit;
        if (!dr.orbit) dr.orbit = { cx: dr.x - dr.hy * r, cy: dr.y + dr.hx * r };
        const a = Math.atan2(dr.y - dr.orbit.cy, dr.x - dr.orbit.cx) + (v / r) * dt;
        dr.x = dr.orbit.cx + r * Math.cos(a); dr.y = dr.orbit.cy + r * Math.sin(a);
        dr.hx = -Math.sin(a); dr.hy = Math.cos(a);
        continue;
      }
      if (dr.phase === 'chase') {
        const s = acc(dr, S3.chase);
        const dx = dr.t.x - dr.x, dy = dr.t.y - dr.y, L = Math.hypot(dx, dy);
        if (L > s + 0.12) {
          if (L > 1e-9) { dr.hx = dx / L; dr.hy = dy / L; }
          dr.x += dr.hx * s; dr.y += dr.hy * s;
          continue;
        }
        dr.phase = 'lock';
        this._marks(dr, dr.t);
      }
      if (dr.phase === 'lock' && dr.t) { dr.x = dr.t.x; dr.y = dr.t.y; }
    }
  }

  /**
   * The kit's 'drone' of a dispersed unit: the hit of the one on that target (latched — or still chasing it: the sim's
   * unit is there already, so it latches now), else the sim's place of a free one.
   */
  _pulse(U, x, y) {
    const D = U.s3?.drones;
    if (!D) return false;
    let best = null, bd = 0.5;
    for (const dr of D) {
      if ((dr.phase !== 'lock' && dr.phase !== 'chase') || !dr.t || !alive(dr.t)) continue;
      const d = Math.hypot(dr.t.x - x, dr.t.y - y) + (dr.phase === 'chase' ? 0.01 : 0);
      if (d < bd) { bd = d; best = dr; }
    }
    if (best) {
      if (best.phase === 'chase') { best.phase = 'lock'; this._marks(best, best.t); }
      for (const key of best.unit?.hits?.[0] || []) this.w.playOn(key, best.t, { flipFrom: U.v || undefined });
      return U.s3.drawable;
    }
    // a free unit's pulse (the sim's place, once a second): the nearest one drifts halfway there
    let near = null; bd = 2;
    for (const dr of D) {
      if (dr.phase === 'lock') continue;
      const d = Math.hypot(dr.x - x, dr.y - y);
      if (d < bd) { bd = d; near = dr; }
    }
    if (near && bd > 0.25) { near.x += (x - near.x) / 2; near.y += (y - near.y) / 2; if (near.orbit) near.orbit = null; }
    return U.s3.drawable;
  }

  /** The skill ended (or the unit left): the dispersed units vanish, their marks stop. */
  _endS3(U) {
    if (!U.s3) return;
    for (const dr of U.s3.drones) { dr.h?.stop(); this._marks(dr, null); }
    U.s3 = null;
    U.appearNext = true;
  }

  // ---- signals ------------------------------------------------------------------------------------------------------

  /** b.ev ['skill', id, on]: the units of the skill's mode (module header). */
  skill(v, on) {
    const U = this.of(v);
    if (!U) return false;
    const was = U.skillOn;
    U.skillOn = !!on;
    if (!this.active()) return false;
    if (on && !was) {
      U.overload = false;
      // the mode the skill switches to: its units are shown with their appear; the home ones leave for a mode with none
      const m = U.plan.modes[this._mode(U, v)];
      if (m && !m.idle) {
        for (const [, t] of U.home) { if (t.unit?.disappear) this._homeShot(U, t.unit.disappear); t.h.kill(); }
        U.home.clear();
      } else if (m) U.appearNext = true;
      return false;
    }
    if (!on && was) {
      // the units out come back to her (their appear where the mode now shows a unit on that point)
      const mode = this._mode(U, v);
      const mounts = new Set(this._want(U, v, mode).map((e) => e.mount));
      for (const [slot, o] of [...U.out]) {
        const [m0, i] = slot.split('|');
        const f = U.plan.modes[m0]?.funnels[Number(i)];
        if (o.hit) o.hit.stop();
        U.out.delete(slot);
        if (f?.appear && mounts.has(this._mountOf(f.appear))) this._homeShot(U, f.appear);
      }
      if (U.s3) this._endS3(U);
      const prev = U.lastMode ? U.plan.modes[U.lastMode] : null;
      if (prev && !prev.idle) U.appearNext = true;
      U.overload = false;
      U.remoteN = 0;
    }
    return false;
  }

  /** b.ev ['fx', kind, x, y, extra] of a kit (module header): true when the units stand for it. */
  simFx(kind, x, y, extra) {
    if (!this.active() || !extra || typeof extra !== 'object') return false;
    if (kind === 'droneLock') {
      const U = extra.src != null ? this.of(this.w.view(extra.src)) : null;
      if (!U) return false;
      if (U.plan.dispersed && U.s3) return this._lock(U, this.w.view(extra.id), x, y) && U.s3.drawable;
      return this._drawable(U) && !!this._remoteMode(U);
    }
    const U = extra.id != null ? this.of(this.w.view(extra.id)) : null;
    if (!U) return false;
    if (kind === 'drones') {
      const n = Math.max(0, Math.floor(Number(extra.n) || 0));
      if (U.plan.dispersed && this._dispersedMode(U)) return this._release(U, n);
      if (this._remoteMode(U)) { U.remoteN = (U.remoteN || 0) + n; return this._drawable(U); }
      return false;
    }
    if (kind === 'drone') {
      if (U.s3) return this._pulse(U, Number(x), Number(y));
      if (this._remoteMode(U)) return this._remoteHit(U, Number(x), Number(y));
      return false;
    }
    if (kind === 'overload') {
      const m = this._remoteMode(U);
      if (!m || !m.funnels.some((f) => (f.overload && this._has(f.overload)) || (f.overloadHits || []).some((g) => g.some((k) => this._has(k))))) return false;
      U.overload = true;
      for (const [, t] of U.home) t.h.kill();   // the overload look replaces the home loop
      U.home.clear();
      return true;
    }
    return false;
  }

  /** The unit's current mode when its units fly on their own (a funnel mode the kit's 'drone' fx drive). */
  _remoteMode(U) {
    if (!U.v) return null;
    const m = U.plan.modes[this._mode(U, U.v)];
    return m && m.funnels.some((f) => f.hits.length) ? m : null;
  }

  /** Whether the unit is in its dispersed units' mode. */
  _dispersedMode(U) {
    const d = U.plan.dispersed;
    return !!d && !!U.v && (d.modes.includes(this._mode(U, U.v)) || !!U.skillOn);
  }

  /** Whether any of the unit's floating-unit effects was extracted. */
  _drawable(U) {
    if (U.drawable === undefined) U.drawable = planKeys(U.plan, this.w.idx.projectiles).some((k) => this._has(k));
    return U.drawable;
  }

  /** Once per frame: the home loops, the units coming back, the dispersed flights. */
  sync(views) {
    this.views = views;
    const active = this.active();
    const tier = this.w.ofx.tier;
    if (this.tier === null) { this.tier = tier; this.wasActive = active; }
    if (tier !== this.tier || active !== this.wasActive) {
      // the effects were cleared (a tier switch) or are not drawn: everything starts again below, quietly
      for (const U of this.units.values()) if (U) this._stopAll(U, false);
      this.tier = tier;
      this.wasActive = active;
    }
    if (!active) return;
    const now = this.w.ofx.time;
    const sweep = ++this.sweep;
    for (const v of views) {
      const U = this.of(v);
      if (!U) continue;
      U.seen = sweep;
      const up = alive(v) && !v.down;
      if (!up) { if (U.home.size || U.out.size || U.s3) this._stopAll(U, true); continue; }
      const dt = U.lastT != null ? Math.max(0, Math.min(0.25, now - U.lastT)) : 0;
      U.lastT = now;
      const mode = this._mode(U, v);
      for (const [slot, o] of [...U.out]) {
        if (now < o.until) continue;
        const [m, i] = slot.split('|');
        this._back(U, slot, U.plan.modes[m]?.funnels[Number(i)]);
      }
      // the dispersed units' release came as a kit fx: a view built mid-skill (or a late fx the field view dropped) never
      // saw it — the units the skill releases (1 + attack@cnt) leave her after a beat [ASSUMED]
      const d = U.plan.dispersed;
      if (d && !U.s3 && d.modes.includes(mode) && this._on(U)) {
        if (U.s3Wait == null) U.s3Wait = now;
        else if (now - U.s3Wait > 0.4) { const c = Number(U.srec?.bb?.['attack@cnt']); this._release(U, 1 + (Number.isFinite(c) && c > 0 ? Math.floor(c) : 0)); }
      } else U.s3Wait = null;
      if (U.s3) this._stepS3(U, dt);
      this._syncHome(U, v, mode);
      U.lastMode = mode;
    }
    // a view gone from the field (removed after its death, a retreat): its effects stop
    for (const U of this.units.values()) if (U && U.seen !== sweep && (U.home.size || U.out.size || U.s3)) this._stopAll(U, true);
  }

  /** Stop every effect of a unit (its death / leak / retreat; `reset`: its next deployment starts afresh). */
  _stopAll(U, reset) {
    for (const t of U.home.values()) t.h.stop();
    U.home.clear();
    for (const o of U.out.values()) o.hit?.stop();
    U.out.clear();
    U.pend.clear();
    if (U.s3) { for (const dr of U.s3.drones) { dr.h?.stop(); this._marks(dr, null); } U.s3 = null; }
    U.overload = false;
    U.lastT = null;
    if (reset) { U.attachN = 0; U.skillOn = null; U.remoteN = 0; U.appearNext = false; }
  }

  release(v) {
    const id = idOf(v);
    const U = id != null ? this.units.get(id) : null;
    if (U) this._stopAll(U, true);
  }

  /** Every key the battle's units' floating units can play (preloading). */
  keys(views) {
    const out = new Set();
    for (const v of views) {
      const U = this.of(v);
      if (U) for (const k of planKeys(U.plan, this.w.idx.projectiles)) out.add(k);
    }
    return [...out];
  }

  /** Battle reset. */
  clear() {
    this.units.clear();
    this.plans.clear();
    this.views = [];
  }
}
