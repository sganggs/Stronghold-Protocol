// render/vfx/talentfx.js — the official talent and ability effects in a battle (DESIGN §33.16; index.json version 3,
// §33.17): the bindings of render/vfx/talents.js played on the signals the field view already receives.
// render/vfx/wiring.js owns one (`FxWiring.talents`) and calls it from its entry points; client only — no sim, protocol
// or golden change.
//
//   const t = new TalentFx(wiring)
//   t.of(v)                  the unit's bindings and state (resolved once per battle id), or null
//   t.deployed(v)            'deploy' (an operator, a summon placed) / 'spawn' (an enemy, a summon): the deploy bindings'
//                            one-shots once per life ('born' triggers too); from then on the unit stands
//   t.release(v)             death / leak / retreat: every loop of the unit stops
//   t.form(v, form, extra)   a sim form fx: a 重生's knock-out ('reborn', 'stone') and stand-up ('form2', 'fly'), a husk's
//                            revival ('revived')
//   t.fx(kind, extra, x, y)  a kit fx naming the unit (`extra.id`): the nodes a template casts on it (talents.js
//                            triggerKinds: 'substitute', 'undying', 'swap', 'dollEnd'), a talent's added attack ('extraAttack'),
//                            and a point strike at the fx's (x, y) (talents.js POINT_TRIGGERS: 新约能天使's 火力电台
//                            'airstrike' with `talent: true` — PR #861; S3's unmarked 'airstrike' keeps the procedural blast)
//   t.skill(v, on)           the owner's skill turned on: its ON_SKILL_START triggers
//   t.sync(views)            once per frame: the loops of every binding in force (passive and deploy ones while the unit
//                            stands, a mode's copy while that mode is on, toggles while their checkers hold, a 重生's
//                            无敌 window, the buffs a 重生 leaves), their one-shots as they turn on and the end rows as
//                            they turn off
//   t.keys(views) / t.clear()
//
// What plays when (talents.js header for the `when` values): the loops are declared each frame from the bindings in
// force and reconciled with the ones playing (one effect key on one spot plays once, whichever binding wants it: a mode
// switch from a node's copy to another's keeps it running); a binding turning on plays its one-shot start and range rows
// (a deploy binding only at the deploy itself), turning off its end rows. A trigger casts a node's rows once (a held row
// for SKILL_CAST_S, a loop for TRIGGER_HOLD_S). [ASSUMED] (no client data says): TRIGGER_HOLD_S; a binding with no
// signal of its own (a template's cast at an event the client never sees, a talent attack no kit fx marks) never plays.

import { talentBindings, toggleOn, triggerKinds, pointKinds, bindable, bindingKeys, nodeUses } from './talents.js';
import { slotKey, lifeOf } from './skills.js';
import { UF } from '../../../../shared/constants.js';

/** Battle seconds a held (non-oneshot) row of a talent's single cast lasts (SkillFx's SKILL_CAST_S). */
export const TALENT_CAST_S = 0.6;
/** Battle seconds a looping row of a triggered node lasts [ASSUMED: the trigger names no end]. */
export const TRIGGER_HOLD_S = 3;
/** The sim's knock-out and stand-up forms of an enemy 重生 (content/enemies/archetypes.js reborn, statue, husk). */
const KO_FORMS = new Set(['reborn', 'stone']);
const UP_FORMS = new Set(['form2', 'fly']);
const DIRS = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
/** Buff events at which a template creates a per-layer buff (talentfx _layerOrder). */
const LAYER_EVENTS = new Set(['ON_BUFF_START', 'ON_BUFF_TRIGGER']);

const idOf = (v) => v?.info?.id ?? v?.id;
const uniq = (list) => { const seen = new Set(); return list.filter((e) => { const k = `${e.key}|${e.at}|${e.hold}`; if (seen.has(k)) return false; seen.add(k); return true; }); };
/** A use carried by a reborn talent's own buffs (`RebornTalent._buffs`): it plays after the stand-up. */
const isPost = (e) => /^\w*RebornTalent\._buffs\b/.test(e.from || '');

export class TalentFx {
  constructor(w) {
    this.w = w;
    this.units = new Map();   // battle id → U | null
    this.wasActive = false;
  }

  active() { return !!this.w.ofx.active && !!this.w.idx; }

  clear() {
    for (const U of this.units.values()) if (U) this._stopAll(U);
    this.units.clear();
  }

  // ---- resolution -------------------------------------------------------------------------------------------------

  /** The record of a battle unit, or null when none of its talents or abilities can play. */
  of(v) {
    if (!v || !this.w.idx) return null;
    const id = idOf(v);
    if (id == null) return null;
    let U = this.units.get(id);
    if (U === undefined) {
      U = null;
      const info = v.info || null;
      if (info && info.kind !== 'device' && info.kind !== 'item') {
        const key = this.w.unitKeyOf(v);
        let rec = null;
        try { rec = typeof this.w.opts.record === 'function' ? this.w.opts.record(info) || null : null; } catch { rec = null; }
        const all = key ? talentBindings(this.w.idx, key, { info, rec }) : [];
        // (a 驭械术士's floating unit — the passive general ability beside her funnel shot — is FunnelFx's to draw)
        const binds = all.filter((b) => (bindable(b).ok || b.when === 'attack') && !this.w.funnels?.owns(key, b));
        if (binds.length) {
          U = {
            id, key, v, binds, rec, standing: false, born: false,
            loops: new Map(),   // `${key}|${at}` → { h, e }
            act: new Map(),     // binding id → on last frame
            mem: new Map(),     // binding id → toggle memory
            held: [],           // a 重生's handler loops (until the stand-up)
            post: [],           // entries the 重生 left on (INFINITY buffs) — while the unit stands
            inv: null,          // { until, entries } the 无敌 window after a 重生
          };
        }
      }
      this.units.set(id, U);
    }
    if (U) U.v = v;
    return U;
  }

  // ---- playing ----------------------------------------------------------------------------------------------------

  _key(e, v) {
    if (!e.directionType || !Array.isArray(e.slots) || !e.slots.some(Boolean)) return e.key;
    return slotKey(e, DIRS[this.w._dirIndex(e.directionType, v)]);
  }

  /** Play an entry on a view: a loop follows the unit's mount point and is never dropped; a held row stops after a cast. */
  _play(e, v, o = {}) {
    if (!v) return null;
    const k = this._key(e, v);
    if (!k) return null;
    const loop = !!o.loop;
    const h = this.w.playOn(k, v, { follow: loop || e.hold === 'cast', loop, important: loop || e.hold === 'cast', toward: o.toward, flipFrom: o.flipFrom });
    if (h && !loop && (e.hold === 'cast' || e.loop)) this._later(o.holdS ?? TALENT_CAST_S, () => h.stop());
    return h;
  }

  _later(s, fn) {
    const ofx = this.w.ofx;
    (ofx.timers || (ofx.timers = [])).push({ at: ofx.time + Math.max(0, s), fn });
  }

  /** The one-shot rows of a binding: start / range rows that are not loops, its attacks' casts (on the owner). */
  _shots(b, v, { attacks = true } = {}) {
    let drew = false;
    const rows = [...b.plan.start, ...b.plan.range].filter((e) => e.hold !== 'skill' && !isPost(e));
    if (attacks) for (const a of b.plan.attacks) rows.push(...a.cast, ...a.range);
    for (const e of uniq(rows)) if (this._play(e, v)) drew = true;
    return drew;
  }

  /** The loop entries a binding keeps while it is in force (hold 'skill'), placed on the owner. */
  _loopsOf(b) {
    return [...b.plan.loop, ...b.plan.start, ...b.plan.range].filter((e) => e.hold === 'skill' && !isPost(e));
  }

  /**
   * The layer order of a binding's per-layer loops (DESIGN §33.16), bottom to top, or null: loops its buffs create with
   * CreateBuff(s) at a buff event whose prefabs pause one another (PauseAnotherEffect — 泥岩's talent: mudrok_t_1[init] /
   * [recharge] create a buff per 护盾 layer, mudrok_buff_01_start pauses _02 and _03, _02 pauses _03: the bottom one
   * pauses none). undefined while a prefab still loads (asked again next frame).
   */
  _layerOrder(b, loops) {
    if (b.layerOrder !== undefined) return b.layerOrder;
    const keys = [...new Set(loops.filter((e) => /^CreateBuffs?$/.test(e.action || '') && LAYER_EVENTS.has(e.event)).map((e) => e.key))];
    if (keys.length < 2) return (b.layerOrder = null);
    const defs = keys.map((k) => this.w.ofx.lib.def(k));
    if (defs.some((d) => d === undefined)) return undefined;
    const pauses = defs.map((d) => new Set((d?.pauses || []).map((q) => q.key).filter((k) => keys.includes(k))));
    if (!pauses.some((p) => p.size)) return (b.layerOrder = null);
    return (b.layerOrder = keys.map((k, i) => ({ k, n: pauses[i].size })).sort((x, y) => x.n - y.n).map((x) => x.k));
  }

  /**
   * The loops a binding keeps now: a per-layer stack (_layerOrder) on an ally plays its lowest n for the n hit-negating
   * layers the sim reports (b.snap `layers`; the top one shows — system.js pauses the rest): 1 → mudrok_buff_03_start,
   * 2 → _02, 3 → _01, none at 0; each layer gained plays the binding's start one-shots again (mudrok_buff_01_begin, the
   * [recharge] template's CreateEffect). An enemy keeps the whole stack while its barrier holds (鼠王, 泥岩 boss: the top
   * variant until 'shieldBreak' — our barrier is one part, the client's three [ASSUMED]).
   */
  _layerLoops(U, b, v, loops) {
    const order = this._layerOrder(b, loops);
    if (!order || v.isEnemy || v.info?.side === 'enemy') return loops;
    const n = Math.max(0, Number(v.layers) | 0);
    const mem = U.layerN || (U.layerN = new Map());
    const was = mem.get(b.id);
    mem.set(b.id, n);
    if (was !== undefined && n > was) this._shots(b, v, { attacks: false });
    const keep = new Set(order.slice(0, n));
    return loops.filter((e) => !order.includes(e.key) || keep.has(e.key));
  }

  _stopAll(U) {
    for (const t of U.loops.values()) t.h.stop();
    U.loops.clear();
    for (const h of U.held) h.stop();
    U.held = [];
    U.post = [];
    U.inv = null;
    U.act.clear();
    U.layerN?.clear();
  }

  // ---- signals ----------------------------------------------------------------------------------------------------

  /** 'deploy' / 'spawn': the unit stands; the deploy bindings' one-shots and 'born' triggers, once per life. */
  deployed(v) {
    const U = this.of(v);
    if (!U) return false;
    const first = !U.born;
    U.standing = true;
    U.born = true;
    if (!first || !this.active()) return false;
    let drew = false;
    for (const b of U.binds) {
      if (b.when === 'deploy' && this._modeOk(U, b)) { if (this._shots(b, v)) drew = true; U.act.set(b.id, true); }
      else if (triggerKinds(b).includes('born') && this._fire(U, b, v)) drew = true;
    }
    return drew;
  }

  /** Death / leak / retreat: the unit's loops stop; its next deploy is a new life. */
  release(v) {
    const id = idOf(v);
    const U = id != null ? this.units.get(id) : null;
    if (!U) return;
    this._stopAll(U);
    U.standing = false;
    U.born = false;
  }

  /** A triggered node casts: its rows once (held rows for a cast, loops for TRIGGER_HOLD_S). */
  _fire(U, b, v) {
    let drew = this._shots(b, v);
    for (const e of uniq(this._loopsOf(b))) {
      const h = this._play(e, v, { loop: true });
      if (h) { drew = true; this._later(TRIGGER_HOLD_S, () => h.stop()); }
    }
    return drew;
  }

  /**
   * A kit fx naming the unit (`extra.id`) at (x, y): the nodes its template triggers cast (talents.js triggerKinds) — a
   * talent strike's (pointKinds: 新约能天使's 'airstrike' marked `talent`) hits on the ground at (x, y) —, or a talent's added attack —
   * 'extraAttack' (守林人's 受选之人) plays the talent attack's casts on the owner and its hits on the target of the attack
   * just made (FxWiring.lastTarget). Returns true when something official drew (the procedural fx is skipped).
   */
  fx(kind, extra, x = NaN, y = NaN) {
    if (!this.active() || !extra || typeof extra !== 'object' || extra.id == null) return false;
    const U = this.units.get(extra.id) ?? (this.w.view(extra.id) ? this.of(this.w.view(extra.id)) : null);
    if (!U || !U.v) return false;
    // an arts barrier (the sim's artsBarrier: 'phase' kind 'artsBarrier' as it is raised, 'shieldBreak' as it breaks):
    // the loops of a barrier talent (its key names a shield) last while it holds [ASSUMED: the client's buff ends there]
    if (kind === 'shieldBreak') { U.broken = true; return false; }
    if (kind === 'phase' && extra.kind === 'artsBarrier') { U.broken = false; return false; }
    let drew = false;
    if (kind === 'extraAttack') {
      const tgt = this.w.lastTarget(U.id);
      for (const b of U.binds) {
        if (b.when !== 'attack' || !this._modeOk(U, b)) continue;
        for (const a of b.plan.attacks) {
          for (const e of uniq([...a.cast, ...a.range])) if (this._play(e, U.v, { toward: tgt || undefined })) drew = true;
          if (tgt) for (const e of uniq(a.hit[0] || [])) if (this._play(e, tgt, { flipFrom: U.v })) drew = true;
        }
      }
      return drew;
    }
    for (const b of U.binds) {
      if (!triggerKinds(b).includes(kind) || !this._modeOk(U, b, true)) continue;
      const point = pointKinds(b).includes(kind);
      if (point && !extra.talent) continue;   // the same kind of a skill's (新约能天使's S3 delivery)
      if (point ? this._strike(b, U.v, x, y) : this._fire(U, b, U.v)) drew = true;
    }
    return drew;
  }

  /** A talent strike at (x, y): its attacks' first hit group on the ground there (the struck spot), turned from `src`. */
  _strike(b, src, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const at = this.w.skills._ground(x, y);
    let drew = false;
    for (const a of b.plan.attacks) for (const e of uniq(a.hit[0] || [])) if (this._play(e, at, { flipFrom: src })) drew = true;
    return drew;
  }

  /** The owner's skill turned on: its ON_SKILL_START triggers. */
  skill(v, on) {
    const U = on ? this.of(v) : null;
    if (!U || !this.active()) return false;
    let drew = false;
    for (const b of U.binds) if (triggerKinds(b).includes('skill') && this._fire(U, b, v)) drew = true;
    return drew;
  }

  /**
   * A sim form fx of the unit: a 重生's knock-out — 'reborn' (the leaders' 重生) / 'stone' (守墓石像) — plays the reborn
   * talent's handler rows (its emitter's ON_CAST_START rows, held until the stand-up) and `_effects`; the stand-up —
   * 'form2' / 'fly' — stops them and plays the end rows, then the talent's buffs: the 无敌 loop for its blackboard time
   * (index v3 `life.key` → our record's talents.bb), an INFINITY buff while the unit stands, an IMMEDIATELY one once; a
   * husk's revival ('revived') plays its ManualTriggerRebornTalent's `_effects`. Returns true when something drew.
   */
  form(v, form, extra = null) {
    const U = this.of(v);
    if (!U || typeof form !== 'string') return false;
    const reborn = U.binds.filter((b) => b.when === 'reborn');
    if (!reborn.length || !this.active()) return false;
    let drew = false;
    if (KO_FORMS.has(form)) {
      for (const h of U.held) h.stop();
      U.held = [];
      for (const b of reborn) {
        if (b.class === 'ManualTriggerRebornTalent' || b.class === 'RallyPointRebornTalent') continue;
        for (const e of uniq([...b.plan.start, ...b.plan.range, ...b.plan.loop].filter((x) => !isPost(x)))) {
          // the handler's rows (ON_CAST_START … ON_CAST_END) last the 重生; a buff it gives once (IMMEDIATELY) plays once
          const held = e.life?.type !== 'IMMEDIATELY' && (e.hold === 'cast' || e.hold === 'skill' || e.loop);
          const h = this._play({ ...e, hold: held ? null : e.hold }, v, { loop: held });
          if (!h) continue;
          drew = true;
          if (held) U.held.push(h);
        }
      }
      // a 重生 without a stand-up fx (the battle ended): its loops end with the knock-out's duration, or after 10 s
      const dur = Number(extra?.dur);
      const held = U.held.slice();
      if (held.length) this._later(dur > 0 ? dur + 1 : 10, () => { for (const h of held) h.stop(); });
      return drew;
    }
    if (UP_FORMS.has(form) || form === 'revived') {
      for (const h of U.held) h.stop();
      U.held = [];
      const now = this.w.ofx.time;
      for (const b of reborn) {
        const manual = b.class === 'ManualTriggerRebornTalent';
        if ((form === 'revived') !== manual || b.class === 'RallyPointRebornTalent') continue;
        if (manual) { if (this._shots(b, v, { attacks: false })) drew = true; continue; }
        for (const e of uniq(b.plan.end)) if (this._play(e, v)) drew = true;
        for (const e of uniq([...b.plan.loop, ...b.plan.start, ...b.plan.range].filter(isPost))) {
          const life = lifeOf(e.life, U.rec?.talents?.bb, b.bb);
          if (life?.once) { if (this._play({ ...e, hold: null }, v)) drew = true; }
          else if (life?.s > 0) { U.inv = U.inv || { until: 0, entries: [] }; U.inv.until = Math.max(U.inv.until, now + life.s); U.inv.entries.push(e); drew = true; }
          else if (life?.skill || !e.life) { U.post.push(e); drew = true; }
        }
      }
      return drew;
    }
    return false;
  }

  // ---- the frame --------------------------------------------------------------------------------------------------

  /** The unit's attack mode now (FxWiring.mode: its skill's mode, a form's, else Default), once per frame. */
  _modeName(U) {
    if (U.modeAt === this.w.skills.frame) return U.modeName;
    const u = this.w.unitOf(U.v);
    const m = u ? this.w.mode(u, U.v) : null;
    U.modeAt = this.w.skills.frame;
    U.modeName = m?.name ?? null;
    return U.modeName;
  }

  /** Whether a binding's mode holds: a node in a mode only while that mode is on, a general ability while one of its. */
  _modeOk(U, b, triggered = false) {
    if (!b.mode && !b.modes) return true;
    // a triggered node in a mode casts as the trigger comes (the trigger often switches to that mode: 风丸's 替身)
    if (triggered) return true;
    const name = this._modeName(U);
    return b.modes ? b.modes.includes(name) : b.mode === name;
  }

  /** Whether a binding is in force now (its loops play): passive and deploy while standing, toggles while they hold. */
  _inForce(U, b, v, now) {
    if (U.broken && /shield|barrier/i.test(b.key || '')) return false;
    if (b.when === 'passive' || b.when === 'deploy') return this._modeOk(U, b);
    if (b.when === 'toggle') {
      if (!this._modeOk(U, b)) return false;
      let mem = U.mem.get(b.id);
      if (!mem) { mem = {}; U.mem.set(b.id, mem); }
      return toggleOn(b, v, mem, now, { bb: U.rec?.talents?.bb, prefix: b.bb }, UF) === true;
    }
    return false;
  }

  sync(views) {
    const active = this.active();
    if (!active) {
      if (this.wasActive) for (const U of this.units.values()) if (U) { for (const t of U.loops.values()) t.h.stop(); U.loops.clear(); }
      this.wasActive = false;
      return;
    }
    this.wasActive = true;
    const now = this.w.ofx.time;
    for (const v of views) {
      const U = this.of(v);
      if (!U) continue;
      const up = v.alive !== false && !v.destroyed && !v.down;
      if (!up) { if (U.standing || U.loops.size) this.release(v); continue; }
      if (!U.standing) { U.standing = true; U.born = true; }   // a view built mid-battle: its loops, not its deploy rows
      const want = new Map();
      for (const b of U.binds) {
        const on = this._inForce(U, b, v, now);
        const was = !!U.act.get(b.id);
        if (on && !was && b.when !== 'deploy') this._shots(b, v, { attacks: false });
        if (!on && was) for (const e of uniq(b.plan.end)) this._play(e, v);
        U.act.set(b.id, on);
        if (!on) continue;
        for (const e of this._layerLoops(U, b, v, this._loopsOf(b))) want.set(`${e.key}|${e.at}`, e);
      }
      for (const e of U.post) want.set(`${e.key}|${e.at}`, e);
      if (U.inv && now < U.inv.until) for (const e of U.inv.entries) want.set(`${e.key}|${e.at}`, e);
      else if (U.inv) U.inv = null;
      // (a prefab that does not loop plays once while it is wanted — its record stays, so it is not started again)
      for (const [k, t] of U.loops) if (!want.has(k) || (!t.h.alive && t.e.loop)) { if (!want.has(k)) t.h.stop(); U.loops.delete(k); }
      for (const [k, e] of want) {
        if (U.loops.has(k)) continue;
        const h = this._play(e, v, { loop: true });
        if (h) U.loops.set(k, { h, e });
      }
    }
  }

  /** Every key the battle's units' talents and abilities can play (preloading). */
  keys(views) {
    const out = new Set();
    for (const v of views) {
      const U = this.of(v);
      if (!U) continue;
      for (const b of U.binds) for (const k of bindingKeys(b)) out.add(k);
    }
    return [...out];
  }
}

export { nodeUses };
