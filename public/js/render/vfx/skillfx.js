// render/vfx/skillfx.js — the official skill, talent and charge effects in a battle (DESIGN §33, 0.3.0 Phase 3b, 3c):
// the plans of render/vfx/skills.js played on the signals the field view already receives. render/vfx/wiring.js owns one
// (`FxWiring.skills`) and calls it from its event entry points; client only — no sim, protocol or golden change.
//
//   const s = new SkillFx(wiring)
//   s.of(v)                      the battle unit's record (plan, charge plan, state), resolved once per battle id
//   s.state(v, skillOn?)         { U, on, plan } — on: the look-ahead's value, else the last 'skill' event, else UF.SKILL
//   s.skill(v, on)               b.ev ['skill', id, on] — true when the official layer shows this skill (render/app.js
//                                then skips the procedural activation burst and aura) — or when its official plan has
//                                no cast rows and the unit's effects are installed: the client shows no burst there
//   s.attackFx(v, tgt, kind, skillOn) → the skill's part of one attack of the owner (FxWiring.attack / castStart), or null
//   s.casts(sk, src, tgt, phase, info) / s.landed(m, v, k)   its cast / range / aim rows and its hit groups (pickGroup)
//   s.trigger(v)                 b.ev 'dmg' on the owner while its skill is on
//   s.seen(v, heal, claimed)     b.ev 'dmg' (HP) / 'heal' in the frame's order: a kit hit of an open window (true: drawn)
//   s.released(src, tgt, kind, time)   a 秘术师's attack: the stored energies fly from their slots
//   s.deployed(v) / s.release(v) passive loops follow the deployment; a death / leak / retreat stops all of a unit's loops
//   s.status(v, key)             the status wiring started that loop on v: a skill's target loop of the same key hands over
//   s.cast(v, slot)              b.ev ['cast', id, slot]: that slot's enemy skill opens its window (index v2)
//   s.sync(views)                once per frame: loops of views built mid-battle (UF.SKILL), passive loops, ready loops,
//                                the stored-energy display (b.snap energy), target loops and marks past their time
//   s.simFx(kind, x, y, extra)   a kit 'fx' tuple the official layer stands for (true: the procedural one is skipped)
//   s.auraHit(v, claimed)        b.ev 'dmg' (HP) no attack owns: a hit of an enemy aura's tick of this frame (true: drawn)
//   s.bindsReached(src, proj)    a skill binding of the shooter's places the projectile's reached effects (FxWiring._arrive)
//   s.keys(views)                every key to preload; s.clear()
//
// What plays when (skills.js header for the roles and signals):
//   * ['skill', id, 1]: `start` and `range` play on the owner, `loop` starts (hold 'skill': it stops on ['skill', id, 0],
//     the unit's death / leak / retreat, the battle's reset — with the effect's own stop fade); the ready loop stops.
//     ['skill', id, 0]: the loops stop, `end` plays. An activation whose 1 and 0 came in the same frame with no 'atk' of
//     the owner between them (an instant skill whose kit deals the damage itself: 23 of the roster's 61 instant casts in
//     a survey of every kit) plays the cast and range of the attack that fits what its kit hit (a heal ability for heals)
//     once — a ReplacementSkill's at the frame's end, as its replaced attack may follow the 0 in that frame and carry
//     the skill. The skill's own casts (skills.js tagCasts: `when` 'start' / 'end') play their rows at its start / 0.
//   * Kit hits (history §32.14.43): 'dmg' names no source; an instant activation, a 'start' cast and a kit fx bound to a
//     plan attack open a window for the rest of the frame, and an HP 'dmg' on the owner's enemies (a heal ability's:
//     a 'heal' on its side) that no attack owns is a hit of that attack — its group by the target's hit count, its aims
//     and buffs on the first — standing for the procedural spark; a final attack's hits are the 0's frame's damage
//     before the 0. In an instant activation's frame its 'atk' is the skill's whatever kind the sim made it.
//   * A view built mid-battle (a reconnect, a watched field) has seen no 'skill' event: its loops follow the snapshot
//     flag UF.SKILL (no start one-shots). A passive (`kind: 'passive'`) is on while the unit is deployed: its loops start
//     at the 'deploy' event (or when the view first shows it), its start one-shots once per deployment.
//   * `ready` loops while sp ≥ spMax > 0 and the skill is off (b.snap; [ASSUMED] for a multi-charge skill).
//   * An attack of the owner while the skill is on (`attackFx`): with an attack ability of its own the skill's rows
//     replace the attack mode's — its cast / range on the owner (ON_CAST_START rows with the wind-up, the others at the
//     strike), `aim` on the target, its hit groups on the target (the k-th 'dmg' — or 'heal' — on that target in that
//     frame is hit k: pickGroup — group min(k, last), in turn with useLoopHitEffect, seeded with useRandomHitEffect, the
//     first only with oncePerTarget) and, for a ranged one, the skill's own projectile (skills.js skillProjectile); without one the
//     attack mode (plan.modeName) plays and the skill adds its `each` rows. `targets` entries of an attack's buffs
//     (skills.js targetsOf `hit`) loop on each target hit for the buff's duration (our record's blackboard), else while
//     the skill lasts; a status loop the status wiring draws for the same key takes over.
//   * `trigger`: a 'dmg' on the owner while on (at most once a frame).
//   * `cond`: the `[eff_cond]` loops (skills.js COND_BUFFS, condState) by the state each frame — the skill on (cast with
//     every charge: its start fx's `charged`), else the charges b.snap `charges` says it stores.
//   * The 秘术师 charge (b.snap energy, PR #636 — sent whatever 设置「秘术师能量」 says): each store plays its one-shots and
//     lights the next slot's loop (FollowMountPoint on its Special point); an attack releases them — the wiring flies the
//     attack's own projectile from the muzzle and this flies one per stored energy from its slot's mount point (the
//     sim's 1 + energy hits: none doubled); a death / redeploy dims them. Index v2 gives the slots (skills.js
//     chargeFromIndex); the transcribed table stands in for a version 1 index.
//   * An enemy's skill (index v2: its data record's skills[].prefabKey, the slots): ['cast', id, slot] opens that skill's
//     window, or — an enemy whose record has a single skill — the snapshot's anim turning SKILL does [ASSUMED]; the window
//     plays the plan's start, range and loops, the enemy's attacks in it use the plan's attack rows (state), and it ends
//     ENEMY_GRACE s after the anim leaves SKILL (or on death / leak) with its loops stopped and its end played. An enemy
//     in a form naming one of its modes (formMode) plays that mode's copy of the skill.
//   * Kit 'fx' tuples (simFx; the procedural fx is skipped when this returns true):
//       (0) ENEMY_FX_BINDINGS (skills.js, 0.3.1): an enemy's area — its zone's prefabs at the fx's point for its time
//           (萨卡兹枯朽战士's death pool by the frame's 'die', 萨卡兹枯朽战车's by its 'cast' — or by the zone's source id,
//           ahead of a death at the point), 鼠王's 沙狱 by its id, 假想敌：蚀裂's cloud by its kind), an aura's tick its
//           talent loops stand for (深溟巢涌者, 鼎沸: one HP hit inside the sim radius plays the aura's effect — auraHit),
//           a mode's loops (水遁忍者's spin);
//       (1) FX_BINDINGS (skills.js): a kit fx standing for an official effect no plan row places (克莱门莎 S3's mark,
//           泡泡 S2's counter on her attacker, 归溟幽灵鲨 S1's hit on the ally she swaps HP with);
//       (2) pulse: a fx tagged with its skill (`extra.skill`) while the skill is on, when the plan has `pulse` entries —
//           the owner's buff ticks for a fx on the owner, the skill's other hits for a fx away from it — plays them there;
//       (3) the start flash: a cast-flash fx (FLASH archetypes) on the owner in the frame of its official skill start;
//       (4) a cast-flash fx tagged with the skill on the owner while its official skill loops play;
//       (5) FX_COVER (skills.js): a kind the skill's official effects stand for, while the skill lasts (_lasts: on, its
//           activation frame, COVER_AFTER_S after its end, or a binding of the owner still held) and its plan's
//           effects are installed — the client shows the skill's own effects there and no such cue (audit R11);
//       (6) a summon's arrival ('summon' archetypes; a token's arrival burst) on a unit whose official birth effect
//           FxWiring.deploy drew in that frame (the burst only with the unit's own birth effect): it would repeat it.
//     FX_BINDINGS entries marked `during` bind only while the skill lasts; an entry with owner 'skill' (the fx names no
//     owner) is the unit's whose skill of that id lasts. With 官方特效 off or none of an entry's prefabs installed the
//     procedural fx stays (as the 驭械术士's floating units: render/vfx/funnelfx.js).
// [ASSUMED] (no client data says): the target-loop duration; a passive is on while deployed; held start rows of a skill
// stop after SKILL_CAST_S; at most one trigger effect per frame; a release's projectiles leave together with the shot;
// the start-flash and loop-cover archetypes; COVER_AFTER_S.

import {
  planFor, skillPlan, attackFx as planAttack, slotKey, planKeys, chargeKeys, chargeStep, skillProjectile, targetsOf, buffDuration,
  eventNum, FX_BINDINGS, bindingEffects, bindingKeys, lifeOf, COND_BUFFS, condState, BOUND_BY_SKILL, coverOf,
  ENEMY_FX_BINDINGS, ENEMY_FX_KINDS, OWNER_NEAR, auraTargets, enemyBindingKeys, modeLoopKeys,
} from './skills.js';
import { fxSpec } from '../fx/kinds.js';
import { UF, ANIM } from '../../../../shared/constants.js';

/** Battle seconds a held (non-oneshot) row of a skill's single cast lasts (FxWiring's CAST_LOOP_S for attacks). */
export const SKILL_CAST_S = 0.6;
/**
 * Battle seconds after a skill's end in which a kit fx still belongs to it (FX_COVER, FX_BINDINGS `during`): an instant
 * skill's kit lands its blast or shells a moment after the 0 (蕾缪安 S3's last shells 0.3–0.7 s, 溯光星源 S2's link
 * 0.1 s in the audit) [ASSUMED].
 */
export const COVER_AFTER_S = 1;
/** Kit fx kinds of a token's arrival (server/sim/content/tokens.js burst(), 沙之碑): its own birth effect is that look. */
const ARRIVAL = new Set(['summonBurst', 'summonStun', 'radiantSword', 'paperDoll', 'obelisk']);
/** The 驭械术士's kit fx: render/vfx/funnelfx.js decides them (its floating units). */
const FUNNEL_KINDS = new Set(['drone', 'drones', 'droneLock', 'overload']);
const lc = (k) => (typeof k === 'string' && k ? k.toLowerCase() : null);
/** Battle seconds after a release in which a stale energy reading is ignored (the next store takes an attack interval). */
const RELEASE_GUARD_S = 0.35;
/** A fx on the unit: its (x, y) within this many tiles (render/fx/simfx.js ANCHOR_SNAP). */
const ON_UNIT = 0.75;
/** Procedural archetypes (render/fx/kinds.js) that are a cast flash: an official skill start / loop stands for them. */
export const FLASH = Object.freeze(new Set(['blast', 'buff', 'wave', 'pillar', 'strike', 'element', 'shield', 'heal', 'healAoe', 'sp', 'generic']));
/** Archetypes that show a unit's state or a game fact (never replaced by a skill's pulse). */
const NOT_PULSE = new Set(['none', 'dp', 'coin', 'lp', 'crate', 'down', 'reticle', 'mark', 'summon', 'vanish', 'blink', 'move', 'sleep', 'lift', 'dodge', 'crit', 'telegraph', 'zone', 'wall', 'shell']);
const DIRS = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
/** Ability events a row starts with the cast (ON_ATTACHED, ON_CAST_START); the others at the strike. */
const CAST_START = new Set([0, 2]);
/** Battle seconds an enemy's skill window outlasts its start before the snapshot's anim may end it (the sim's 0.5 s). */
const ENEMY_GRACE = 0.3;
/**
 * Battle seconds an aura's looping buff effect stays on a unit after the last tick that hurt it (鼎沸's
 * enemy_cjhot_debuff: the client keeps it while the unit is in the aura — its ticks come every second) [ASSUMED].
 */
export const AURA_HOLD_S = 1.25;

/**
 * The index mode a unit's form (a sim setForm / a 傀儡师's 替身 — shared/protocol.js fxForm) fights in: the mode the data
 * ties to that form (`map`, render/vfx/talents.js formModes: a reborn talent's `reborn.mode` for 'form2', a husk's
 * modes, the 替身's switchMode for 'doll'), else the mode of that name (case-insensitive: 'stone' → Stone, 'fly' → Fly),
 * the second form of a reborn boss its Reborn mode; null else [ASSUMED: the form names are the remake's, not the
 * client's].
 */
export function formMode(unit, form, map = null) {
  if (typeof form !== 'string' || !form) return null;
  const modes = Array.isArray(unit?.modes) ? unit.modes : [];
  if (map && typeof map[form] === 'string' && modes.some((m) => m?.name === map[form])) return map[form];
  const f = form.toLowerCase();
  const hit = modes.find((m) => typeof m?.name === 'string' && m.name.toLowerCase() === f) || (f === 'form2' ? modes.find((m) => m?.name === 'Reborn') : null);
  return hit ? hit.name : null;
}

const idOf = (v) => v?.info?.id ?? v?.id;
/** A held entry that loops for its hold: hold 'skill' and a looping prefab (a one-shot prefab plays once at the start). */
const isLoop = (e) => e.hold === 'skill' && e.loop !== false;
/** The plan's attacks a normal attack can use: not the skill's own casts at its start / end (`when`, skills.js tagCasts). */
const perAttack = (plan) => (plan.attacks.some((a) => a.when) ? { ...plan, attacks: plan.attacks.filter((a) => !a.when) } : plan);
/**
 * The entries of a list with a key of their own (the first of each): the extractor may reach one effect by two paths
 * (a buff's `_buffs` and `_extraBuffs`, two nodes of one skill) — played once, as the one buff it is [ASSUMED].
 */
export function uniq(list) {
  if (!list || list.length < 2) return list || [];
  const seen = new Set();
  return list.filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)));
}
const beyond = (a, b) => ({ x: b.x + (b.x - a.x), y: b.y + (b.y - a.y) });

/** Run `fn` after `s` battle seconds on the effects' clock (FxWiring.tick runs the timers). */
export function later(ofx, s, fn) {
  if (!ofx.timers) ofx.timers = [];
  ofx.timers.push({ at: ofx.time + Math.max(0, s), fn });
}

/** Whether an attack ability's class is the kind of attack the sim made (a heal, a shot, a blow). */
export function fitsAttack(ability, { heal = false, ranged = false } = {}) {
  if (typeof ability !== 'string') return false;
  if (heal) return /Heal/.test(ability);
  if (/Heal/.test(ability) || !/Attack/.test(ability)) return false;
  return ranged ? /Ranged/.test(ability) : !/Ranged/.test(ability);
}

/** A 32-bit mix of a seed and a hit index (a random group per hit, the same at every replay). */
const mix = (seed, k) => { const h = Math.imul((seed >>> 0) ^ Math.imul(k + 1, 2654435761), 2246822519); return (h ^ (h >>> 13)) >>> 0; };

/**
 * The group hit k (0-based, of one cast on one target) plays (DESIGN §33.12, MultiHit — assumed engine code): group
 * min(k, last); with `loop` group k mod n; with `random` a seeded random one; with `once` only the first hit plays.
 */
export function pickGroup(groups, k, opts = {}, seed = 0) {
  const n = Array.isArray(groups) ? groups.length : 0;
  if (!n || (opts?.once && k > 0)) return [];
  if (opts?.random) return groups[mix(seed, k) % n] || [];
  if (opts?.loop) return groups[k % n] || [];
  return groups[Math.min(k, n - 1)] || [];
}

/**
 * When a plan row of an attack plays: 'start' with the cast (its ability event ON_ATTACHED / ON_CAST_START, a buff
 * template's ON_ABILITY_START, or no event), else 'strike' (ON_SPELL_ON, ON_BEFORE_ATTACK, …).
 */
export function castPhase(e) {
  if (e?.startEvent != null) return CAST_START.has(eventNum(e.startEvent)) ? 'start' : 'strike';
  if (e?.event) return e.event === 'ON_ABILITY_START' ? 'start' : 'strike';
  return 'start';
}

export class SkillFx {
  /** @param {import('./wiring.js').FxWiring} w */
  constructor(w) {
    this.w = w;
    this.units = new Map();    // battle id → unit record | null (nothing official to play)
    this.tloops = new Map();   // `${target id}|${key}` → { h, until, U, tgt, bySkill } (skills.js targetsOf `hit`)
    this.marks = [];           // FX_BINDINGS reached effects: { owner, r, c, until, h, cover }
    this.born = new Map();     // unit id → { frame, own } of its official birth effect (deployed: FxWiring.deploy's key)
    this.frame = 0;            // FxWiring.tick counts frames: events of one frame share a value
    this.sweep = 0;
    this.tier = null;
    this.wasActive = false;
    this.seq = 0;              // the order of the frame's events the kit hits read (hits seen, activations, kit fx)
    this.hitLog = [];          // the frame's HP 'dmg' / 'heal' events: { v, heal, claimed, seq } (seen)
    this.hitFrame = -1;
    this.windows = [];         // the frame's kit-hit windows: { U, a (null: an instant activation's, by the hit), inst, frame, n, sawHeal, sawDmg }
    this.gone = new Map();     // unit id → { frame, key, x, y }: the frame's deaths / leaks / retreats (an enemy's death zone)
    this.auraWins = [];        // the frame's aura ticks the official layer stands for: { frame, x, y, r, src, tg } (auraHit)
    this.aloops = new Map();   // `${target id}|${key}` → { h, until, v }: an aura's looping buff effect on a unit in it
    this.viewList = [];        // the battle's views as the last sync gave them (an enemy binding's 'near' owner)
    this.modeWins = new Map(); // unit id → { hs, seq }: the loops of a mode an enemy binding's fx started (_modeWin)
  }

  active() { return !!this.w.ofx.active && !!this.w.idx; }

  // ---- resolution -------------------------------------------------------------------------------------------------

  /** The record of a battle unit (resolved once per battle id), or null when nothing official belongs to it. */
  of(v) {
    if (!v || !this.w.idx) return null;
    const id = idOf(v);
    if (id == null) return null;
    let U = this.units.get(id);
    if (U === undefined) {
      U = null;
      const info = v.info || null;
      if (info && info.kind !== 'device' && info.kind !== 'item') {
        const unitKey = this.w.unitKeyOf(v);
        const rec = this._recordOf(info);
        const r = unitKey ? planFor(this.w.idx, { info, rec, unitKey }) : null;
        if (r && (r.plan || r.charge || r.enemy.length)) U = this._record(id, r, rec);
      }
      this.units.set(id, U);
    }
    if (U) U.v = v;
    return U;
  }

  /** The unit's data record (FxWiring opts.record: render/app.js ctx.lookupDef), or null. */
  _recordOf(info) {
    if (typeof this.w.opts.record !== 'function') return null;
    try { return this.w.opts.record(info) || null; } catch { return null; }
  }

  _record(id, r, rec = null) {
    const idx = this.w.idx, plan = r.plan;
    const has = (k) => !!k && this.w.ofx.lib.has(k);
    let draws = false;
    if (plan) {
      draws = [...plan.start, ...plan.loop, ...plan.range].some((e) => has(e.key) || (e.slots || []).some(has))
        || plan.attacks.some((a) => [...a.cast, ...a.range].some((e) => has(e.key)));
      const mode = plan.modeName ? (idx.units[r.unitKey]?.modes || []).find((m) => m.name === plan.modeName) : null;
      const a = mode?.attack;
      if (a && ((a.cast || []).length || (a.hit || []).length || a.projectileKey)) draws = true;
    }
    return {
      id, v: null, key: r.unitKey, skillId: r.skillId, plan, charge: r.charge, srec: r.srec,
      buffS: buffDuration(r.srec), tHit: plan ? targetsOf(idx, plan).hit : [], drawsStart: draws,
      on: null, startFrame: -1, offAt: -Infinity, atkN: 0, attacked: false, byFlag: false, loopsOn: false,
      loops: [], ready: [], readyOn: false, passiveOn: false, passiveShots: false, passiveDraws: false, passiveDone: false, timed: false,
      energy: 0, slotLoops: [], guardUntil: -Infinity, quiet: false, trigFrame: -1, seen: 0,
      // an enemy's skills by slot (index v2), how many its data record has, its skill window, plans of other modes
      enemy: r.enemy || [], enemySlots: Array.isArray(rec?.skills) ? rec.skills.length : 0, ewin: null, prevAnim: 0, modePlans: new Map(),
    };
  }

  /**
   * Whether a unit's skill is on, and its plan: `skillOn` (the wind-up's look-ahead) wins, then the last 'skill' event,
   * then the snapshot flag UF.SKILL; a passive is on while the unit stands.
   */
  state(v, skillOn) {
    const U = this.of(v);
    // an enemy's skill window (not one whose single attack the kit's own moment already stood for: _enemyFx)
    if (U?.ewin && !U.ewin.fired) return { U, on: true, plan: U.ewin.plan };
    let on = typeof skillOn === 'boolean' ? skillOn : U && U.on !== null ? U.on : !!((v?.flags | 0) & UF.SKILL);
    if (U && this._passive0(U)) on = v.alive !== false;
    return { U, on, plan: U ? U.plan : null };
  }

  /** A passive the sim keeps on while deployed (it never set UF.SKILL; a kit may run a PASSIVE skill as a timed one). */
  _passive0(U) { return U.plan?.kind === 'passive' && !U.timed; }

  _on(U) { return !!U && (U.ewin ? true : this._passive0(U) ? U.v?.alive !== false : U.on !== null ? U.on : !!((U.v?.flags | 0) & UF.SKILL)); }

  // ---- playing ----------------------------------------------------------------------------------------------------

  /** The key an entry plays for the unit's facing (a directional row's slot; skills.js slotKey). */
  _key(e, v) {
    if (!e.directionType || !Array.isArray(e.slots) || !e.slots.some(Boolean)) return e.key;
    return slotKey(e, DIRS[this.w._dirIndex(e.directionType, v)]);
  }

  /**
   * Play an entry on a view; held ones (skill / ready / deploy) follow the unit's mount point and are never dropped. A
   * held entry whose prefab does not loop (index.json prefabs[key].looping false: a buff's or a long ability's one-shot
   * effect) is no loop: it plays once, for its own life (stopped early only when its hold ends).
   */
  _play(e, v, o = {}) {
    if (!v) return null;
    const k = this._key(e, v);
    if (!k) return null;
    const held = e.hold === 'skill' || e.hold === 'ready' || e.hold === 'cast';
    const loop = (e.hold === 'skill' || e.hold === 'ready') && e.loop !== false;
    return this.w.playOn(k, v, { follow: held, loop, important: held || !!o.important, toward: o.toward, flipFrom: o.flipFrom, skip: o.skip, strike: !!o.strike });
  }

  /** Keep a started entry by its hold: the skill's loops, the ready loops, or stopped at the cast's end. */
  _keep(U, e, h, castS = SKILL_CAST_S) {
    if (!h) return;
    if (e.hold === 'skill') U.loops.push(h);
    else if (e.hold === 'ready') U.ready.push(h);
    else if (e.hold === 'cast' || e.loop) later(this.w.ofx, castS, () => h.stop());
  }

  _stopLoops(U) {
    for (const h of U.loops) h.stop();
    U.loops = [];
    U.loopsOn = false;
    U.byFlag = false;
  }

  _startReady(U, v) {
    U.readyOn = true;
    for (const e of uniq(U.plan.ready)) this._keep(U, e, this._play(e, v));
  }

  _stopReady(U) {
    for (const h of U.ready) h.stop();
    U.ready = [];
    U.readyOn = false;
  }

  /**
   * The loops of a skill that is on without its start (a view built mid-battle, the layer switched on): no one-shots —
   * a held entry whose prefab does not loop belongs to the start (isLoop) and is not played again.
   */
  _loopsOnly(U, v, byFlag) {
    U.loopsOn = true;
    U.byFlag = byFlag;
    for (const e of uniq([...U.plan.start, ...U.plan.range, ...U.plan.loop])) if (isLoop(e) && !e.birth) this._keep(U, e, this._play(e, v));
  }

  /** A passive's loops (while deployed) and, once per deployment, its start one-shots (a held one-shot prefab too). */
  _passive(U, v, shots) {
    let drew = false;
    if (!U.passiveOn) {
      U.passiveOn = true;
      U.loopsOn = true;
      for (const e of uniq([...U.plan.start, ...U.plan.range, ...U.plan.loop])) {
        if (!isLoop(e)) continue;
        const h = this._play(e, v);
        if (h) { drew = true; this._keep(U, e, h); }
      }
    }
    if (shots && !U.passiveShots) {
      U.passiveShots = true;
      for (const e of uniq([...U.plan.start, ...U.plan.range, ...U.plan.loop])) {
        if (isLoop(e)) continue;
        const h = this._play(e, v);
        if (h) { drew = true; this._keep(U, e, h); }
      }
      // the skill's own cast at the start (缄默德克萨斯 S2 / S3's appear strike, tagCasts 'start')
      if (this._castOnce(U, v, 'start')) drew = true;
    }
    U.passiveDraws = U.passiveDraws || drew || U.drawsStart;
    return U.passiveDraws;
  }

  // ---- the skill events -------------------------------------------------------------------------------------------

  /** b.ev ['skill', id, on] (module header). Returns true when the official layer shows this skill. */
  skill(v, on) {
    const U = this.of(v);
    if (!U || !U.plan) return false;
    const live = this.active();
    if (U.plan.kind === 'passive') {
      // a passive: its loops follow the deployment (the sim's 1 / 0 frame its 0.5 s clip) — unless the kit runs it as a
      // timed skill (UF.SKILL seen: `timed`), whose 0 ends it
      U.on = !!on;
      // a passive with nothing official to draw at that 1 (普罗旺斯 S1, 琳琅诗怀雅 S1: no cast rows) shows no procedural
      // burst either, as an active skill's cast does (R10, _noBurst) — the sim's 0.5 s window of a passive without a
      // duration is no cast in the client
      if (on) { U.passiveDone = false; return live ? (this._passive(U, v, true) || this._noBurst(U)) : false; }
      if (U.timed) {
        U.passiveDone = true;
        U.passiveOn = false;
        if (live) { this._stopLoops(U); for (const e of uniq(U.plan.end)) this._keep(U, e, this._play(e, v)); }
      }
      return live && U.passiveDraws;
    }
    if (on) {
      U.on = true;
      U.startFrame = this.frame;
      U.atkN = 0;
      U.attacked = false;
      if (!live) return false;
      this._stopReady(U);
      this._stopLoops(U);          // a cast while on (onEnd re-cast) starts afresh
      let drew = false;
      for (const e of uniq([...U.plan.start, ...U.plan.range, ...U.plan.loop])) {
        if (e.birth) continue;     // the deploy's (birthOf: FxWiring.deploy plays it)
        const h = this._play(e, v);
        if (h) { drew = true; this._keep(U, e, h); }
      }
      // the skill's own cast at its start (tagCasts 'start'): its rows now, its hits on the damage that follows
      if (this._castOnce(U, v, 'start')) drew = true;
      // an instant skill: what its kit hits in this frame without an attack are its attack's hits (kit hits)
      if (U.plan.kind === 'instant' && perAttack(U.plan).attacks.length) this._open(U, null, true);
      U.loopsOn = true;
      return drew || U.drawsStart || this._noBurst(U);
    }
    const was = U.on === true;
    U.on = false;
    U.offAt = this.w.ofx.time;
    if (!live) return false;
    // an instant skill whose kit made no attack between 1 and 0: its own attack's cast plays once (skills.js: one cast)
    // and its hits on what the kit hit in between (kit hits); a ReplacementSkill's replaced attack may still follow the
    // 0 in this frame — the fallback waits for the frame's end (instPending)
    if (was && !U.attacked && U.startFrame === this.frame && perAttack(U.plan).attacks.length) {
      if (/^ReplacementSkill/.test(U.plan.rootClass || '')) U.instPending = this.frame;
      else { this._instCast(U, v); this.windows = this.windows.filter((w) => !(w.inst && w.U === U)); }
    }
    // the skill's final attack (tagCasts 'end'): its rows, its hits on this frame's damage (the kit deals it before the 0)
    if (was) this._endCast(U, v);
    this._stopLoops(U);
    for (const e of uniq(U.plan.end)) this._keep(U, e, this._play(e, v));
    return U.drawsStart;
  }

  // ---- the skill's own casts and the kit's hits (history §32.14.43) ------------------------------------------------

  /** The next mark of the frame's event order (a new frame empties the hit log and closes the kit-hit windows). */
  _mark() {
    if (this.hitFrame !== this.frame) { this.hitLog = []; this.hitFrame = this.frame; this.windows = this.windows.filter((w) => w.frame === this.frame); }
    return ++this.seq;
  }

  /** Open a kit-hit window of this frame for attack `a` of U (null: an instant activation's — the hit's kind picks it). */
  _open(U, a, inst = false) {
    this._mark();
    this.windows.push({ U, a, inst, frame: this.frame, n: new Map(), sawHeal: false, sawDmg: false });
  }

  /**
   * b.ev 'dmg' (an HP hit) or 'heal' on v (FxWiring.damage / heal), in the frame's order. One no attack owns (`claimed`:
   * a waiting blow, a melee attacker, a floating unit's hit) is a kit hit of the frame's open windows — an instant
   * activation without an attack, a skill's own cast at its start, a kit fx bound to a plan attack: no event names the
   * source of a kit's damage, the frame's order does [ASSUMED: the kit hits in that frame]. Returns true when an official
   * hit stands for it (the procedural spark / generic heal is skipped).
   */
  seen(v, heal, claimed) {
    if (!v) return false;
    const seq = this._mark();
    this.hitLog.push({ v, heal: !!heal, claimed: !!claimed, seq });
    if (claimed || !this.windows.length || !this.active()) return false;
    let drew = false;
    for (const win of this.windows) {
      if (win.inst && win.U.attacked) continue;   // the activation made its attack: its rows are that attack's
      const a = win.a || this._instAttack(win.U, heal);
      if (!a || /Heal/.test(String(a.ability || '')) !== !!heal) continue;
      const r = this._kitHit(win, a, v);
      if (r === null) continue;
      if (heal) win.sawHeal = true; else win.sawDmg = true;
      if (r) drew = true;
    }
    return drew;
  }

  /** The attack of an instant activation a kit hit belongs to: a heal ability for a heal, another for damage. */
  _instAttack(U, heal) {
    const att = perAttack(U.plan).attacks;
    return (heal ? att.find((x) => /Heal/.test(x.ability)) : att.find((x) => !/Heal/.test(x.ability))) || null;
  }

  /**
   * One kit hit of attack `a` on t (damage on the owner's enemies, a heal ability's heal on its side; else null): hit k
   * of t in the window plays its group (pickGroup), the first one its aims and the attack's buffs (targetsOf `hit` of
   * its node).
   */
  _kitHit(win, a, t) {
    const U = win.U, own = U.v;
    const heal = /Heal/.test(String(a.ability || ''));
    if (!own || !t || t === own || t.destroyed || (!!t.isEnemy === !!own.isEnemy) !== heal) return null;
    const id = idOf(t);
    const k = win.n.get(id) || 0;
    win.n.set(id, k + 1);
    let drew = false;
    if (k === 0) {
      for (const e of uniq(a.aim || [])) {
        const h = this._play(e, t, { toward: beyond(own, t), flipFrom: own });
        if (h) { drew = true; if (e.hold === 'cast' || e.loop) later(this.w.ofx, SKILL_CAST_S, () => h.stop()); }
      }
      for (const e of uniq(U.tHit.filter((x) => x.node == null || x.node === a.node))) if (this._targetLoop(U, e, t)) drew = true;
    }
    for (const e of uniq(pickGroup(a.hit, k, a.hitOpts, U.atkN))) if (this._play(e, t, { flipFrom: own })) drew = true;
    return drew;
  }

  /** The cast / range rows of the plan's attacks cast `when` ('start' | 'end'); a start's hits are the frame's kit hits. */
  _castOnce(U, v, when) {
    let drew = false;
    for (const a of U.plan.attacks) {
      if (a.when !== when) continue;
      for (const e of uniq([...a.cast, ...a.range])) { const h = this._play(e, v); if (h) { drew = true; this._keep(U, e, h); } }
      if (when === 'start' && (a.hit.some((g) => g.length) || (a.aim || []).length || U.tHit.length)) this._open(U, a);
    }
    return drew;
  }

  /**
   * The skill ends: its final attacks' rows on the owner and their hits on what this frame damaged before the 0 (the kit
   * deals the end's damage first; tagCasts 'end').
   */
  _endCast(U, v) {
    for (const a of U.plan.attacks) {
      if (a.when !== 'end') continue;
      for (const e of uniq([...a.cast, ...a.range])) this._keep(U, e, this._play(e, v));
      if (this.hitFrame !== this.frame) continue;
      const win = { U, n: new Map() };
      const heal = /Heal/.test(String(a.ability || ''));
      for (const h of this.hitLog) if (!h.claimed && h.heal === heal) this._kitHit(win, a, h.v);
    }
  }

  /**
   * An instant activation without an attack: the attack that fits what its kit hit (a heal ability for heals, another for
   * damage, else the first) casts its rows on the owner; the hits played as they came (seen).
   */
  _instCast(U, v, win = this.windows.find((w) => w.inst && w.U === U)) {
    const att = perAttack(U.plan).attacks;
    if (!att.length) return;
    const a = (win?.sawDmg ? this._instAttack(U, false) : win?.sawHeal ? this._instAttack(U, true) : null) || att[0];
    for (const e of uniq([...a.cast, ...a.range])) this._keep(U, e, this._play(e, v));
  }

  /**
   * An official plan with no cast rows (start / loop / range, its attacks' cast / range): the client shows no activation
   * effect there (audit R10: 赫默 S2, 银灰 S1, 塑心 S3, …) — no procedural burst either while the unit's effects are
   * installed (a lite install without them keeps it).
   */
  _noBurst(U) {
    const p = U.plan;
    if (p.start.length || p.loop.length || p.range.length || p.attacks.some((a) => a.cast.length || a.range.length)) return false;
    if (U.unitOk === undefined) {
      const u = this.w.idx.units[U.key];
      const ks = new Set(planKeys(p));
      for (const k of u?.skills?.[U.skillId]?.effects || []) ks.add(lc(k));
      for (const m of u?.modes || []) for (const r of [...(m?.attack?.cast || []), ...(m?.attack?.hit || [])]) for (const k of r?.effects || []) ks.add(lc(k));
      for (const k of Array.isArray(u?.refs) ? u.refs : []) ks.add(lc(k));   // every prefab the unit references (its shots')
      ks.add(lc(u?.startEffect));
      U.unitOk = [...ks].some((k) => !!k && this.w.ofx.lib.has(k));
    }
    return U.unitOk;
  }

  /** The skill's plan has installed effects (FX_COVER: they stand for the kit fx only when they are drawn). */
  _planDrawn(U) {
    if (U.planOk === undefined) U.planOk = !!U.plan && planKeys(U.plan).some((k) => this.w.ofx.lib.has(k));
    return U.planOk;
  }

  /** A kit fx of the unit belongs to its skill (rule 5, `during` bindings): on, its activation frame, just ended, or held. */
  _lasts(U) {
    if (!U || !U.plan) return false;
    const now = this.w.ofx.time;
    return this._on(U) || U.startFrame === this.frame || now - U.offAt <= COVER_AFTER_S || this.marks.some((m) => m.owner === U.id && m.until > now);
  }

  /**
   * The unit's official birth effect (FxWiring.deploy's key: its skill's own start effect — birthOf —, its mode's
   * override, its own, else the generic one).
   */
  _birth(v) {
    if (!this.active() || !v || v.isEnemy) return;
    const u = this.w.unitOf(v);
    const m = u ? this.w.mode(u, v) : null;
    const own = this.birthOf(v)?.key || lc(m?.overrideStartEffect) || lc(u?.startEffect);
    const key = own || lc(this.w.idx.generic?.birth?.char);
    if (key && this.w.ofx.lib.has(key)) this.born.set(idOf(v), { frame: this.frame, own: !!own && key === own });
  }

  /**
   * The deploy effect the unit's skill gives it (0.3.1, audit R21): an AppearSkill's `_overrideStartEffect` (the plan's
   * start entry with `birth`, skills.js) comes before the mode's override and the unit's own start effect — the
   * client's Character.GetStartEffect — and `common_empty` (缄默德克萨斯 S2 / S3) means none. { key, drawn, own } or null
   * without one: `drawn` — the official layer stands for the deploy (the prefab is installed, or nothing is to be
   * drawn); `own` — the skill's start plays it at the deploy (a passive's start one-shots, a held one for its while:
   * 斯卡蒂 S2's loop), else FxWiring.deploy plays it and the skill's start leaves it out.
   */
  birthOf(v) {
    const U = this.of(v);
    const e = U?.plan ? U.plan.start.find((x) => x.birth) : null;
    if (!e) return null;
    const key = this._key(e, v);
    const empty = key === 'common_empty';
    return { key, entry: e, drawn: empty || (!!key && this.w.ofx.lib.has(key)), own: U.plan.kind === 'passive', empty };
  }

  /** b.ev 'deploy': a passive's loops and start one-shots; a redeployed 秘术师 starts with no energy. */
  deployed(v) {
    this._birth(v);
    const U = this.of(v);
    if (!U) return false;
    U.energy = 0;
    if (!U.plan || U.plan.kind !== 'passive') return false;
    U.passiveDone = false;
    if (!this.active() || (U.timed && !U.on)) return false;
    return this._passive(U, v, true);
  }

  // ---- enemy skills (index v2) ------------------------------------------------------------------------------------

  /**
   * b.ev ['cast', id, slot, dur?] (the sim's enemy skill slot, server/sim/content/enemies/helpers.js castSlot): the
   * enemy's skill of that slot of its data record (its prefabKey → index v2 `units[enemy].skills`) starts its window,
   * held for the skill's blackboard `duration` when the event carries one. A window the snapshot's SKILL anim opened for
   * the same slot a moment before is kept (the event and the snapshot come apart by up to a frame).
   */
  cast(v, slot, dur = 0) {
    const U = this.of(v);
    const entry = U?.enemy?.find((x) => x.slot === slot);
    // the skill cast in this frame (an enemy binding's 'cast' owner: the kit's zone comes in the same tick)
    if (entry) { U.castFrame = this.frame; U.castKey = lc(entry.prefabKey); }
    if (!entry || !this.active()) return false;
    const now = this.w.ofx.time;
    const hold = Math.max(ENEMY_GRACE, Number(dur) > 0 ? Number(dur) : 0);
    if (U.ewin && U.ewin.byAnim && U.ewin.slot === entry.slot && now - U.ewin.at < 0.25) {
      U.ewin.byAnim = false;
      U.ewin.until = Math.max(U.ewin.until, now + hold);
      return U.ewin.draws;
    }
    return this._enemyCast(U, v, entry, hold);
  }

  /** The plan of an enemy's skill in the mode its form names (formMode; the copies of a boss's skill differ by mode). */
  _enemyPlan(U, entry, v) {
    const mode = formMode(this.w.idx.units[U.key], this.w.formOf(v), this.w.formMap(U.key)) || 'Default';
    if (mode === 'Default') return entry.plan;
    const key = `${entry.slot}|${mode}`;
    let p = U.modePlans.get(key);
    if (!p) { p = skillPlan(this.w.idx, U.key, entry.prefabKey, { mode }); U.modePlans.set(key, p); }
    return p;
  }

  /**
   * An enemy's skill window starts: the plan's start and range play, its loops start (held until the window ends —
   * the snapshot's anim leaves SKILL — or the enemy dies); attacks in the window use its attack rows (state).
   */
  _enemyCast(U, v, entry, hold = ENEMY_GRACE) {
    if (U.ewin) this._enemyEnd(U, v);
    const plan = this._enemyPlan(U, entry, v);
    const at = this.w.ofx.time;
    // a skill whose root ability is an attack (RangedAttack, MeleeAttack …) is that one attack
    const attackRoot = /Attack$/.test(this.w.idx.units[U.key]?.skills?.[entry.prefabKey]?.rootAbility || '');
    const win = { plan, slot: entry.slot, at, until: at + hold, loops: [], draws: false, startFrame: this.frame, shown: false, attackRoot, fired: false };
    U.ewin = win;
    U.startFrame = this.frame;
    U.atkN = 0;
    for (const e of uniq([...plan.start, ...plan.range, ...plan.loop])) {
      const h = this._play(e, v);
      if (!h) continue;
      win.draws = true;
      if (e.hold === 'skill') win.loops.push(h); else this._keep(U, e, h);
    }
    return win.draws;
  }

  /** The window ends: its loops stop (with their fade), its end plays. */
  _enemyEnd(U, v) {
    const win = U.ewin;
    if (!win) return;
    U.ewin = null;
    for (const h of win.loops) h.stop();
    if (v && this.active()) for (const e of uniq(win.plan.end)) this._keep(U, e, this._play(e, v));
  }

  /**
   * Stop every loop of a unit (its death / leak / retreat, its view gone) and every target loop on it — an aura's buff
   * effect too; the frame keeps where it went (an enemy binding's 'died' owner: its death zone follows in this frame).
   */
  release(v) {
    const id = idOf(v);
    const U = id != null ? this.units.get(id) : null;
    if (U) this._releaseU(U);
    for (const [slot, t] of this.tloops) if (idOf(t.tgt) === id) { t.h.stop(); this.tloops.delete(slot); }
    for (const [slot, t] of this.aloops) if (idOf(t.v) === id) { t.h.stop(); this.aloops.delete(slot); }
    this._modeEnd(v);
    if (id != null && v && Number.isFinite(v.x) && Number.isFinite(v.y)) this.gone.set(id, { frame: this.frame, key: this.w.unitKeyOf(v), x: v.x, y: v.y });
  }

  _releaseU(U) {
    if (U.ewin) { for (const h of U.ewin.loops) h.stop(); U.ewin = null; }
    this._stopCond(U);
    this._stopLoops(U);
    this._stopReady(U);
    for (const hs of U.slotLoops) for (const h of hs || []) h.stop();
    U.slotLoops = [];
    U.energy = 0;
    U.passiveOn = false;
    U.passiveShots = false;
    U.passiveDone = false;
    U.on = null;
  }

  /** The status wiring draws `key` on v from now on: a skill's target loop of the same key hands over (never twice). */
  status(v, key) {
    const t = this.tloops.get(`${idOf(v)}|${key}`);
    if (t) { t.h.stop(); this.tloops.delete(`${idOf(v)}|${key}`); }
  }

  // ---- attacks ----------------------------------------------------------------------------------------------------

  /**
   * The skill's part of one attack of `src` on `tgt` (null when the skill is off or adds nothing): `fx` (skills.js
   * attackFx: cast / range / aim / hit groups, `each` merged), `replace` (the skill's own attack ability: its rows replace
   * the attack mode's), `projectile` (a ranged one's: the skill's own), `buffs` (targetsOf `hit`).
   */
  attackFx(src, tgt, kind, skillOn) {
    let st = this.state(src, skillOn);
    const U = st.U;
    // the frame of an instant skill's activation: a ReplacementSkill's replaced attack may come right after its 0 (the
    // activation's fallback waits for it: instPending)
    const inst = !!U && !U.ewin && U.plan?.kind === 'instant' && U.startFrame === this.frame;
    if (!st.on && inst && !U.attacked && U.instPending === this.frame) st = { ...st, on: true };
    if (!st.on || !st.plan) return null;
    const ranged = !!kind && kind !== 'none';
    const heal = !!tgt && !tgt.isEnemy && !src.isEnemy;
    // the skill's own casts at its start / end are no normal attack (tagCasts): the mode attacks while it is on
    const fx = planAttack(perAttack(st.plan), { heal, ranged });
    // the skill's own ability replaces the mode's rows when it is this kind of attack: a melee blow is no shield throw
    // (斩业星熊 S2: her MultiMelee mode attacks while the skill's AroundTargetRangedAttack throws on its own); in the frame
    // of an instant skill's activation its attack is the skill's whatever kind the sim made it (阿罗玛 S1's 'beam' is her
    // MeleeAttack, 夕 S1's 'bolt' her MultiMeleeAttack: their cast, aim and hits) — a heal stays a heal
    const fits = !!fx.ability && fitsAttack(fx.ability, { heal, ranged });
    const forced = !fits && inst && !!fx.ability && /Heal/.test(fx.ability) === heal;
    const replace = fits || forced;
    if (fx.ability && !replace) { fx.cast = fx.cast.filter((e) => e.ability !== fx.ability); fx.range = []; fx.aim = []; fx.hit = st.plan.each.hit[0].length ? [st.plan.each.hit[0]] : []; }
    // the projectile its ability fires (index v3: abilities[].projectileKey, a use's projectileKey), else the naming guess
    const projectile = fits && ranged ? fx.projectile || skillProjectile(this.w.idx, st.plan) : null;
    if (!replace && !fx.cast.length && !fx.hit.length && !st.U.tHit.length) return null;
    return { U: st.U, fx, replace, projectile, shot: replace ? fx.shot : null, buffs: st.U.tHit, late: forced };
  }

  /**
   * The skill's cast rows of an attack for a phase ('start' | 'strike' | 'all'; FxWiring._casts): cast and range on the
   * owner (not for another target of the same attack: `info.owner` false), aim on the target.
   */
  casts(sk, src, tgt, phase, info = {}) {
    const nth = sk.U.atkN;
    // a skill attack known only at the strike (attackFx `late`): the wind-up played the mode's rows, the strike all of its
    if (sk.late && phase === 'strike') phase = 'all';
    for (const [rows, onTarget] of [[sk.fx.cast, false], [sk.fx.range, false], [sk.fx.aim, true]]) {
      if (!onTarget && info.owner === false) continue;
      for (const e of uniq(rows)) {
        const first = castPhase(e) === 'start';
        if ((phase === 'start' && !first) || (phase === 'strike' && first) || (onTarget && !tgt)) continue;
        if ((e.firstOnly && nth > 0) || (e.afterFirst && nth === 0)) continue;
        const skip = phase === 'start' ? info.skip : 0;
        const h = onTarget ? this._play(e, tgt, { toward: beyond(src, tgt), flipFrom: src, skip }) : this._play(e, src, { toward: tgt, skip, strike: phase !== 'start' });
        if (h && (e.hold === 'cast' || e.loop)) later(this.w.ofx, phase === 'start' && info.left > 0 ? Math.min(3, info.left) : SKILL_CAST_S, () => h.stop());
      }
    }
  }

  /** The attack was made (FxWiring.attack, after its rows): the activation's attack count. */
  attacked(sk) { sk.U.atkN++; sk.U.attacked = true; }

  /**
   * Hit k (0-based: the k-th HP 'dmg' — or 'heal' — on v in the frame of the blow; FxWiring keeps the record `m` = {
   * groups, hitOpts, seed, buffs, U, src } and drops it once a later frame's damage arrives) of a skill attack landed:
   * its group (pickGroup: min(k, last), or k mod n / a seeded random one by the MultiHit settings); the first hit also
   * starts the buffs' loops.
   */
  landed(m, v, k) {
    let drew = false;
    for (const e of uniq(pickGroup(m.groups, k, m.hitOpts, m.seed))) if (this._play(e, v, { flipFrom: m.src })) drew = true;
    if (k === 0) for (const e of uniq(m.buffs)) if (this._targetLoop(m.U, e, v)) drew = true;
    return drew;
  }

  /** A buff an attack of the skill put on v (targetsOf `hit`): its loop for the buff's duration, else while on. */
  _targetLoop(U, e, v) {
    const key = this._key(e, v);
    if (!key || this.w.statusShows(v, key)) return null;
    // index v3: the buff's own life — LIMITED (its time or our record's blackboard key), INFINITY (while the skill
    // lasts), IMMEDIATELY (its effect once) — else the record's blackboard duration, else while a lasting skill lasts
    const life = lifeOf(e.life, U.srec?.bb);
    if (life?.once) {
      const h1 = this._play({ ...e, hold: null }, v, { flipFrom: U.v || undefined });
      if (h1 && e.loop) later(this.w.ofx, SKILL_CAST_S, () => h1.stop());
      return h1;
    }
    const lasting = U.plan.kind === 'lasting' || U.plan.kind === 'ammo';
    const dur = life?.s > 0 ? life.s : life?.skill ? 0 : U.buffS;
    if (!(dur > 0) && !lasting && !life?.skill) return null;
    const slot = `${idOf(v)}|${key}`;
    const until = dur > 0 ? this.w.ofx.time + dur : Infinity;
    const t = this.tloops.get(slot);
    if (t && t.h.alive) { t.until = Math.max(t.until, until); t.U = U; return t.h; }
    const h = this.w.playOn(key, v, { follow: true, loop: true, important: true, flipFrom: U.v || undefined });
    if (h) this.tloops.set(slot, { h, until, U, tgt: v, bySkill: !(dur > 0) });
    return h;
  }

  /** b.ev 'dmg' on v: its skill's `trigger` while the skill is on (once a frame). */
  trigger(v) {
    const id = idOf(v);
    const U = id != null ? this.units.get(id) : null;
    if (!U || !U.plan || !U.plan.trigger.length || !this.active() || !this._on(U) || U.trigFrame === this.frame) return false;
    U.trigFrame = this.frame;
    let drew = false;
    for (const e of uniq(U.plan.trigger)) { const h = this._play(e, v); if (h) { drew = true; this._keep(U, e, h); } }
    return drew;
  }

  // ---- the 秘术师 charge ------------------------------------------------------------------------------------------

  /**
   * An attack of a unit with stored energies (FxWiring.attack): one projectile per energy leaves its slot's mount point
   * for the target (the store ability's projectile of the current mode, chargePlan onRelease) and the slots go dark.
   * Returns the number flown.
   */
  released(src, tgt, kind, time) {
    const U = this.of(src);
    if (!U || !U.charge || !(U.energy > 0) || !tgt || !this.active()) return 0;
    const n = U.energy;
    const rel = U.charge.onRelease;
    const mode = this.w.mode(this.w.unitOf(src), src);
    const pk = rel.projectiles[mode?.name] || rel.projectiles[(mode?.name || '').replace(/_T\d+$/, '')] || rel.projectiles.Default;
    const proj = pk ? this.w.idx.projectiles[pk] : null;
    let flown = 0;
    for (let i = 0; i < n; i++) {
      if (proj && kind && kind !== 'none') { this.w._fly(proj, src, tgt, kind, time, { mount: rel.mountTypes?.[i] ?? null }); flown++; }
      for (const h of U.slotLoops[i] || []) h.stop();
      U.slotLoops[i] = null;
    }
    U.energy = 0;
    U.guardUntil = this.w.ofx.time + RELEASE_GUARD_S;
    return flown;
  }

  /** The stored count in the snapshot changed: the stores' one-shots, the slots' loops (skills.js chargeStep). */
  _charge(U, v, n) {
    if (n === U.energy) return;
    if (n > U.energy && this.w.ofx.time < U.guardUntil) return;   // the released energies' last reading
    const st = chargeStep(U.charge, U.energy, n);
    U.energy = n;
    if (!U.quiet) for (const k of st.gain) this.w.playOn(k, v, { follow: true });
    for (const i of st.light) {
      for (const h of U.slotLoops[i] || []) h.stop();
      U.slotLoops[i] = U.charge.slots[i].hold.map((k) => this.w.playOn(k, v, { follow: true, loop: true, important: true })).filter(Boolean);
    }
    for (const i of st.dim) { for (const h of U.slotLoops[i] || []) h.stop(); U.slotLoops[i] = null; }
  }

  // ---- the frame --------------------------------------------------------------------------------------------------

  /** Once per frame, after the views took the frame's sample (module header). */
  sync(views) {
    const active = this.active();
    const tier = this.w.ofx.tier;
    if (this.tier === null) { this.tier = tier; this.wasActive = active; }   // the first frame: nothing was cleared
    if (tier !== this.tier || active !== this.wasActive) {
      // the effects were cleared (a tier switch) or not drawn: what should run starts again below, quietly
      for (const U of this.units.values()) {
        if (!U) continue;
        for (const h of [...U.loops, ...U.ready, ...U.slotLoops.flat().filter(Boolean), ...(U.ewin ? U.ewin.loops : [])]) h.stop();
        this._stopCond(U);
        U.loops = []; U.ready = []; U.slotLoops = []; U.loopsOn = false; U.readyOn = false; U.passiveOn = false; U.energy = 0; U.quiet = true;
        U.ewin = null;
      }
      for (const t of this.tloops.values()) t.h.stop();
      this.tloops.clear();
      for (const t of this.aloops.values()) t.h.stop();
      this.aloops.clear();
      this.tier = tier;
      this.wasActive = active;
    }
    // the frame's end (every event of it is in): a ReplacementSkill whose replaced attack never came casts its rows now;
    // the kit-hit windows close, so do the frame's aura ticks and the deaths its zones were matched with
    if (!Array.isArray(views)) views = [...views];
    this.viewList = views;
    this.gone.clear();
    this.auraWins.length = 0;
    const wins = this.windows;
    this.windows = [];
    if (!active) return;
    for (const win of wins) {
      if (!win.inst || win.frame !== this.frame) continue;
      if (win.U.instPending === this.frame && !win.U.attacked && win.U.v) this._instCast(win.U, win.U.v, win);
      win.U.instPending = -1;
    }
    const sweep = ++this.sweep;
    const now = this.w.ofx.time;
    for (const v of views) {
      const U = this.of(v);
      if (!U) continue;
      U.seen = sweep;
      const up = v.alive !== false && !v.destroyed && !v.down;
      if (!up) { if (U.loopsOn || U.readyOn || U.passiveOn || U.energy || U.ewin) this._releaseU(U); continue; }
      if (U.enemy.length) {
        // an enemy's skill window: the snapshot's anim SKILL (the sim's 0.5 s after an ability fires); with no 'cast'
        // slot event, an enemy whose data record has a single skill opens that skill's window on it [ASSUMED]
        const anim = v.anim | 0;
        if (anim === ANIM.SKILL && U.prevAnim !== ANIM.SKILL && !U.ewin && U.enemySlots === 1 && U.enemy.length === 1) {
          this._enemyCast(U, v, U.enemy[0]);
          if (U.ewin) U.ewin.byAnim = true;   // a 'cast' event for it may follow (cast: kept, not restarted)
        }
        else if (U.ewin && anim !== ANIM.SKILL && now > U.ewin.until) this._enemyEnd(U, v);
        // a skill whose effects are its attack's rows with no 'atk' of the enemy in its first frame (the kit flies its
        // own projectile or blast): that attack's cast and range rows play now [ASSUMED: the skill is that attack]
        const win = U.ewin;
        if (win && !win.shown && this.frame > win.startFrame) {
          win.shown = true;
          const a = win.plan.attacks[0];
          if (a && U.atkN === 0 && !win.draws) for (const e of uniq([...a.cast, ...a.range])) { const h = this._play(e, v); if (h) this._keep(U, e, h); }
        }
        U.prevAnim = anim;
      }
      if (U.plan) {
        const flag = !!((v.flags | 0) & UF.SKILL);
        if (U.plan.kind === 'passive') {
          if (flag) U.timed = true;   // the kit runs it as a timed skill: its events start and end it
          if (!U.passiveOn && !U.passiveDone && (!U.timed || (U.on ?? flag))) this._passive(U, v, false);
        } else {
          const on = U.on !== null ? U.on : flag;
          if (on && !U.loopsOn) this._loopsOnly(U, v, U.on === null);
          else if (!on && U.loopsOn && U.byFlag) this._stopLoops(U);
          const ready = U.plan.ready.length > 0 && !on && !flag && v.spMax > 0 && v.sp >= v.spMax - 1e-3;
          if (ready !== U.readyOn) { if (ready) this._startReady(U, v); else this._stopReady(U); }
        }
      }
      if (U.charge) this._charge(U, v, Array.isArray(v.energy) ? Math.max(0, Math.floor(Number(v.energy[0]) || 0)) : 0);
      if (U.plan?.cond?.length) this._cond(U, v);
      U.quiet = false;
    }
    for (const U of this.units.values()) {
      if (U && U.seen !== sweep && (U.loopsOn || U.readyOn || U.passiveOn || U.energy || U.ewin)) this._releaseU(U);
    }
    for (const [slot, t] of this.tloops) {
      const tv = t.tgt;
      if (!tv || tv.destroyed || tv.alive === false || now >= t.until || (t.bySkill && !this._on(t.U)) || !t.h.alive) {
        t.h.stop();
        this.tloops.delete(slot);
      }
    }
    // an aura's buff effect leaves a unit AURA_HOLD_S after the last tick that hurt it (it left the aura, or the aura ended)
    for (const [slot, t] of this.aloops) {
      const tv = t.v;
      if (!tv || tv.destroyed || tv.alive === false || now >= t.until || !t.h.alive) { t.h.stop(); this.aloops.delete(slot); }
    }
    if (this.marks.length) this.marks = this.marks.filter((m) => m.until > now);
  }

  /**
   * The `[eff_cond]` loops of the skill (skills.js COND_BUFFS, plan.cond — 卡涅利安's sand armour), reconciled each frame
   * with the client graph's state now (condState): the skill on (and `charged` — its start fx said so, simFx), else the
   * charges it stores (b.snap `charges`): 1 → the half armour, 2 → the full one, none below.
   */
  _cond(U, v) {
    const on = this._on(U);
    if (!on) U.charged = false;
    const st = condState({ on, charged: !!U.charged, charges: v.charges });
    const want = new Map();
    if (st) for (const e of U.plan.cond) if (COND_BUFFS[e.buff]?.[st]?.includes(e.key)) want.set(e.key, e);
    const map = U.cond || (U.cond = new Map());
    for (const [k, t] of map) if (!want.has(k) || (!t.h.alive && t.e.loop)) { if (!want.has(k)) t.h.stop(); map.delete(k); }
    for (const [k, e] of want) {
      if (map.has(k)) continue;
      const h = this.w.playOn(k, v, { follow: true, loop: e.loop !== false, important: true });
      if (h) map.set(k, { h, e });
    }
  }

  _stopCond(U) {
    if (!U.cond) return;
    for (const t of U.cond.values()) t.h.stop();
    U.cond.clear();
  }

  // ---- kit fx -----------------------------------------------------------------------------------------------------

  /** b.ev ['fx', kind, x, y, extra]: true when the official layer stands for it (module header: bindings 1–4). */
  simFx(kind, x, y, extra) {
    if (!this.active() || !extra || typeof extra !== 'object' || typeof kind !== 'string') return false;
    const now = this.w.ofx.time;
    // a skill start cast with every charge stored (the kit's `charged`: 卡涅利安) — the `[eff_cond]` state (_cond)
    if (extra.charged === true && extra.id != null) { const C = this.units.get(extra.id); if (C) C.charged = true; }
    // (0) an enemy's area: its zone's official prefabs at the fx's point, an aura tick its talent loops stand for
    if (this._enemyFx(kind, x, y, extra)) return true;
    // (1) explicit bindings and what they cover
    for (const m of this.marks) {
      if (m.until > now && m.cover.includes(kind) && extra.id === m.owner && Math.round(y) === m.r && Math.round(x) === m.c) return true;
    }
    for (const field of ['src', 'id']) {
      const U = extra[field] != null ? this.units.get(extra[field]) : null;
      const bind = U ? FX_BINDINGS[U.skillId]?.[kind] : null;
      if (bind && bind.owner === field && (!bind.during || this._lasts(U))) return bind.attack ? this._boundAttack(U, bind) : this._bound(U, bind, x, y, extra);
    }
    // a binding whose fx names no owner: the unit whose skill of that id lasts
    for (const sid of BOUND_BY_SKILL[kind] || []) {
      for (const Uo of this.units.values()) if (Uo && Uo.skillId === sid && Uo.v && this._lasts(Uo)) return this._bound(Uo, FX_BINDINGS[sid][kind], x, y, extra);
    }
    // (6) a summon's arrival on a unit whose official birth effect drew in this frame
    if (extra.id != null && !FUNNEL_KINDS.has(kind) && (ARRIVAL.has(kind) || fxSpec(kind, extra).a === 'summon')) {
      const b = this.born.get(extra.id);
      if (b && b.frame === this.frame && (b.own || !ARRIVAL.has(kind))) return true;
    }
    const U = this.units.get(extra.id ?? extra.src);
    if (!U || !U.v || !(U.plan || U.ewin)) return this._covered(kind, extra);
    const plan = U.ewin ? U.ewin.plan : U.plan;
    const v = U.v;
    const a = fxSpec(kind, extra).a;
    const near = !Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(v.x - x, v.y - y) <= ON_UNIT;
    const on = this._on(U);
    // (2) the skill's pulse: the kit's own fx of the moment its plan's tick / hit rows have no event for
    if (extra.skill != null && on && plan.pulse.length && !NOT_PULSE.has(a)) {
      const list = plan.pulse.filter((e) => (e.at === 'owner') === near);
      if (list.length) {
        const at = near ? v : (this.w.view(extra.target ?? extra.to) || { id: 'fx:point', x, y, z: 0 });
        let drew = false;
        for (const e of uniq(list)) { const h = this._play(e, at, { flipFrom: near ? undefined : v }); if (h) { drew = true; this._keep(U, e, h); } }
        if (drew) return true;
      }
    }
    if (this._covered(kind, extra)) return true;
    if (!near || !FLASH.has(a)) return false;
    // (3) the frame of the official skill start, (4) a skill-tagged flash while the official loops play
    if (U.startFrame === this.frame && (U.ewin ? U.ewin.draws : U.drawsStart)) return true;
    return extra.skill != null && on && (U.loops.some((h) => h.alive) || !!U.ewin?.loops.some((h) => h.alive));
  }

  /** An FX_BINDINGS `attack` entry: that plan attack's rows on the owner now, its hits on the damage that follows. */
  _boundAttack(U, bind) {
    const a = U.plan?.attacks.find((x) => x.node === bind.attack);
    const v = U.v;
    if (!a || !v) return false;
    let drew = false;
    for (const e of uniq([...a.cast, ...a.range])) { const h = this._play(e, v); if (h) { drew = true; this._keep(U, e, h); } }
    if (a.hit.some((g) => g.length) || (a.aim || []).length || U.tHit.length) this._open(U, a);
    return drew;
  }

  /** (5) FX_COVER: the fx's owner (`src`, else `id`) has a skill that covers this kind, lasting, with its effects installed. */
  _covered(kind, extra) {
    for (const field of ['src', 'id']) {
      const U = extra[field] != null ? this.units.get(extra[field]) : null;
      if (U && U.v && coverOf(U.skillId, kind) && this._lasts(U) && this._planDrawn(U)) return true;
    }
    return false;
  }

  /**
   * An FX_BINDINGS entry: the projectile's reached effects (or its keys) where the fx happens, held as the binding
   * says; a binding's own `keys` at 'target' once on the unit the fx names.
   */
  _bound(U, bind, x, y, extra) {
    const keys = bindingEffects(this.w.idx, bind).filter((k) => this.w.ofx.lib.has(k));
    if (!keys.length) return false;
    if (bind.at === 'target') {
      // once on the unit the fx names (泡泡's attacker, 归溟幽灵鲨 S1's ally), else where it happens; turned by the owner's side
      const tv = this.w.view(extra[bind.target || 'target']) || { id: 'fx:point', x, y, z: 0 };
      let drew = false;
      for (const k of keys) if (this.w.playOn(k, tv, { flipFrom: U.v || undefined })) drew = true;
      return drew;
    }
    const tv = this.w.view(extra.id);
    const at = bind.at === 'point' || !tv ? this._ground(x, y, tv) : tv;
    if (bind.oneshot) {
      let drew = false;
      for (const k of keys) if (this.w.playOn(k, at, { important: true })) drew = true;
      return drew;
    }
    const bb = U.srec?.bb || {};
    const fxS = Number(extra.duration ?? extra.dur ?? extra.hold);
    const holdS = bind.hold === 'fx' ? (fxS > 0 ? fxS : bind.holdS || SKILL_CAST_S)
      : Number(bb[bind.hold]) > 0 ? Number(bb[bind.hold]) : bind.holdS || SKILL_CAST_S;
    let drew = false;
    for (const k of keys) {
      const h = this.w.playOn(k, at, { loop: true, important: true });
      if (!h) continue;
      drew = true;
      later(this.w.ofx, holdS, () => h.stop());
      this.marks.push({ owner: U.id, r: Math.round(y), c: Math.round(x), until: this.w.ofx.time + holdS, h, cover: bind.cover || [] });
    }
    return drew;
  }

  /**
   * Whether a skill binding of the shooter's places projectile `proj`'s reached effects (FX_BINDINGS `projectile` at
   * 'point', in force — `during`: while the skill lasts —): its kit's area fx plays them at the zone's point for the zone's
   * time, so the flight's arrival does not play them again (0.3.1: 锡人's flask drew twice — on the ground and, for 8 s,
   * at the target's HitPoint where the drawn flight ended).
   */
  bindsReached(src, proj) {
    const U = proj ? this.units.get(idOf(src)) : null;
    const binds = U ? FX_BINDINGS[U.skillId] : null;
    if (!binds) return false;
    for (const b of Object.values(binds)) {
      if (b.at === 'point' && b.projectile && this.w.idx?.projectiles?.[lc(b.projectile)] === proj && (!b.during || this._lasts(U))) return true;
    }
    return false;
  }

  /**
   * A kit fx's point on the ground: the field's tile height there (the board's heights: OfficialFx ctx.heightAt), else
   * the height of the unit `tv` the fx names (a test layer without a field). Before 0.3.1 a binding's area took its
   * owner's height — 锡人's flask on the road drew at the high ground's 0.42 tiles where he stood.
   */
  _ground(x, y, tv = null) {
    const hAt = this.w.ofx.ctx?.heightAt;
    const h = typeof hAt === 'function' && Number.isFinite(x) && Number.isFinite(y) ? Number(hAt(Math.round(y), Math.round(x))) : NaN;
    return { id: 'fx:point', x, y, z: Number.isFinite(h) ? Math.max(0, h) : tv ? tv.z || 0 : 0 };
  }

  // ---- enemies' areas (skills.js ENEMY_FX_BINDINGS; 0.3.1) ----------------------------------------------------------

  /**
   * An enemy's kit fx its official effects stand for (ENEMY_FX_BINDINGS: its zone's prefabs at the fx's point, an aura
   * tick its talent loops stand for): true when drawn (the procedural fx is skipped). A binding that draws nothing does
   * not claim the fx — the next candidate is tried (a missing 秽蚀轰击 prefab used to swallow the death pool).
   */
  _enemyFx(kind, x, y, extra) {
    const cands = ENEMY_FX_KINDS[kind];
    if (!cands) return false;
    const rows = [];
    for (const key of cands) {
      const bind = ENEMY_FX_BINDINGS[key][kind];
      if (bind.xkind && extra.kind !== bind.xkind) continue;
      const owner = this._enemyOwner(key, bind, x, y, extra);
      if (!owner) continue;
      rows.push({ key, bind, owner, rank: this._fxRank(bind, owner, extra) });
    }
    rows.sort((a, b) => a.rank - b.rank);
    for (const { key, bind, owner } of rows) {
      if (bind.endMode) { this._modeEnd(owner); return false; }   // (its procedural cue stays)
      const drew = bind.modeLoops ? this._modeWin(owner, key, bind)
        : bind.talent ? this._aura(owner, key, bind, x, y, extra)
        : this._zone(bind, x, y, extra);
      if (!drew) continue;
      // the kit's own moment stood for an attack-rooted skill of a window: that was its one attack — the enemy's next
      // attacks in the window are its own (0.3.1: the 'cast' of 鼠王's 【沙狱】 holds the window for the debuff's 15 s, and
      // every attack of the boss in it replayed the sandstorm on its target; 暴鸰's bomb, an 'atk' 0.27 s after its
      // 'cast', keeps its window's rows)
      const oid = owner !== true ? idOf(owner) : null;
      const W = oid != null ? this.units.get(oid)?.ewin : null;
      if (W && W.attackRoot) W.fired = true;
      return true;
    }
    return false;
  }

  /**
   * Who a matching binding is tried as. A zone that names its source (`extra.id` — 【污染秽蚀】 carries `pollution`'s
   * src) matches as owner 'id', ahead of a death at the point, so a 秽蚀轰击 pool on a tile where a 枯朽战士 also died
   * keeps the tank's prefab. A death within OWNER_NEAR is ahead of a cast the zone does not name: the cast has no
   * distance check (the pool is on the target, not the caster) and one render frame holds both.
   * [ASSUMED] a zone with no id belongs to the death at the point, else to the cast.
   */
  _fxRank(bind, owner, extra) {
    const oid = owner && owner !== true ? idOf(owner) : null;
    if (bind.owner === 'id' || (extra.id != null && oid != null && oid === extra.id)) return 0;
    if (bind.owner === 'died') return 1;
    if (bind.owner === 'cast') return 2;
    if (bind.owner === 'near') return 3;
    return 4;
  }

  /**
   * The enemy of index unit `key` a binding's fx belongs to (ENEMY_FX_BINDINGS `owner`): its view (or its record for
   * 'died' / 'cast', `true` for 'any'), else null — the fx is another unit's.
   */
  _enemyOwner(key, bind, x, y, extra) {
    const near = (p) => Number.isFinite(x) && Number.isFinite(y) && Math.hypot(p.x - x, p.y - y) <= OWNER_NEAR;
    switch (bind.owner) {
      case 'id': {
        const v = this.w.view(extra.id);
        return v && this.w.unitKeyOf(v) === key ? v : null;
      }
      case 'died':
        for (const [id, g] of this.gone) if (g.frame === this.frame && g.key === key && near(g)) return this.w.view(id) || { id, x: g.x, y: g.y };
        return null;
      case 'cast':
        for (const U of this.units.values()) if (U && U.key === key && U.castFrame === this.frame && U.castKey === bind.skill) return U.v || U;
        return null;
      case 'near': {
        let best = null, bd = Infinity;
        for (const v of this.viewList) {
          if (!v || v.destroyed || v.alive === false || this.w.unitKeyOf(v) !== key) continue;
          const d = Math.hypot(v.x - x, v.y - y);
          if (d <= OWNER_NEAR && d < bd) { bd = d; best = v; }
        }
        return best;
      }
      case 'any': return true;
      default: return null;
    }
  }

  /** An enemy's zone: its binding's prefabs at the fx's point on the ground, the looping ones for the zone's time. */
  _zone(bind, x, y, extra) {
    const keys = bindingEffects(this.w.idx, bind).filter((k) => this.w.ofx.lib.has(k));
    if (!keys.length) return false;
    const at = this._ground(x, y);
    const fxS = Number(extra.duration ?? extra.dur ?? extra.hold);
    const holdS = bind.hold === 'fx' && fxS > 0 ? fxS : bind.holdS || SKILL_CAST_S;
    let drew = false;
    for (const k of keys) {
      // (a one-shot plays its own life: `important` — no cap on what nobody stops)
      const h = this.w.playOn(k, at, bind.once ? { important: true } : { loop: true, important: true });
      if (!h) continue;
      drew = true;
      if (!bind.once) later(this.w.ofx, holdS, () => h.stop());
    }
    return drew;
  }

  /**
   * An aura's tick (a 'pulse' / 'boil' of an enemy whose talent is the aura): the unit's talent loops (TalentFx) stand
   * for it while they are drawn — and then one HP hit this frame on a unit inside the sim radius plays the aura's buff
   * effects on it (auraHit).
   */
  _aura(v, key, bind, x, y, extra) {
    const T = this.w.talents?.units?.get(idOf(v));
    if (!T || ![...T.loops.values()].some((t) => t.h && t.h.alive)) return false;
    const r = Number(extra.r ?? extra.radius);
    this.auraWins.push({ frame: this.frame, x, y, r: r > 0 ? r : 1, src: v, tg: auraTargets(this.w.idx, key, bind.talent) });
    return true;
  }

  /**
   * An fx that starts an enemy's mode (水遁忍者's 漩涡形态, its mode M1): the loops of the mode's talent (`modeLoops`) on the
   * unit for its record's blackboard time (`bbKey`), until an `endMode` fx or its death — true when they draw (else the
   * procedural cue stays). talents.js leaves that talent's loop unmapped (a buff its template creates at its tick, on a
   * condition it cannot read) and the sim sends no form for the mode [ASSUMED: the loop lasts the sim's spin].
   */
  _modeWin(v, key, bind) {
    const keys = modeLoopKeys(this.w.idx, key, bind.modeLoops).filter((k) => this.w.ofx.lib.has(k));
    if (!keys.length) return false;
    this._modeEnd(v);   // (a new spin over an old one)
    const hs = keys.map((k) => this.w.playOn(k, v, { follow: true, loop: true, important: true })).filter(Boolean);
    if (!hs.length) return false;
    const id = idOf(v);
    const s = Number(this._recordOf(v.info)?.talents?.bb?.[bind.bbKey]);
    const seq = (this.modeSeq = (this.modeSeq || 0) + 1);
    this.modeWins.set(id, { hs, seq });
    later(this.w.ofx, s > 0 ? s : bind.holdS || 0, () => { if (this.modeWins.get(id)?.seq === seq) this._modeEnd(v); });
    return true;
  }

  /** The end of a mode _modeWin started (its time, an `endMode` fx, the unit gone): its loops stop. */
  _modeEnd(v) {
    const id = idOf(v);
    const m = this.modeWins.get(id);
    if (!m) return;
    this.modeWins.delete(id);
    for (const h of m.hs) h.stop();
  }

  /**
   * b.ev 'dmg' (HP) on view v that no attack owns (`claimed` false): a hit of an aura tick of this frame whose sim
   * radius holds v (_aura) — the aura's buff effects on it: its one-shot each tick, its loop held AURA_HOLD_S past the
   * last tick. Each aura takes at most one such hit per unit in the frame; the hit it takes is still offered to the
   * next aura (two nests both play, and so does 鼎沸). True when one of them drew (the procedural spark is skipped).
   * A unit past the sim radius, or a second hit on the same unit, keeps its spark.
   * [ASSUMED] that one unclaimed HP hit inside the radius is the aura's tick — the client's buff trigger is not an event.
   */
  auraHit(v, claimed) {
    if (claimed || !this.auraWins.length || !v || v.isEnemy) return false;
    const now = this.w.ofx.time;
    const id = idOf(v);
    let any = false;
    for (const a of this.auraWins) {
      if (a.frame !== this.frame || a.src === v || !(Math.hypot(v.x - a.x, v.y - a.y) <= a.r)) continue;
      const took = a.took || (a.took = new Set());
      if (id != null && took.has(id)) continue;
      let drew = false;
      for (const k of a.tg.shots) if (this.w.playOn(k, v, { flipFrom: a.src })) drew = true;
      for (const k of a.tg.loops) {
        const slot = `${id}|${k}`;
        const t = this.aloops.get(slot);
        if (t && t.h.alive) { t.until = now + AURA_HOLD_S; drew = true; continue; }
        const h = this.w.playOn(k, v, { follow: true, loop: true, important: true });
        if (h) { this.aloops.set(slot, { h, until: now + AURA_HOLD_S, v }); drew = true; }
      }
      if (!drew) continue;
      if (id != null) took.add(id);
      any = true;
    }
    return any;
  }

  // ---- preload ----------------------------------------------------------------------------------------------------

  /** Every key the battle's units' skills, charges and bindings can play (FxWiring.begin / more). */
  keys(views) {
    const idx = this.w.idx;
    const out = new Set();
    const proj = (pk) => { const p = pk && idx.projectiles?.[pk]; if (p) for (const k of p.effects || []) out.add(String(k).toLowerCase()); };
    for (const v of views) {
      // an enemy's areas (ENEMY_FX_BINDINGS: its zones' prefabs, its aura's buff effects on the units in it)
      for (const k of enemyBindingKeys(idx, this.w.unitKeyOf(v))) out.add(k);
      const U = this.of(v);
      if (!U) continue;
      if (U.plan) {
        for (const k of planKeys(U.plan)) out.add(k);
        for (const pk of U.plan.projectiles) proj(pk);
        for (const k of bindingKeys(idx, U.skillId)) out.add(k);
      }
      for (const en of U.enemy) {
        for (const k of planKeys(en.plan)) out.add(k);
        for (const pk of en.plan.projectiles) proj(pk);
        // the copies of a boss's skill in its other modes (the forms it may take)
        for (const mode of new Set((en.plan && this.w.idx.units[U.key]?.skills?.[en.prefabKey]?.uses || []).map((x) => x.mode).filter((m) => typeof m === 'string' && m !== 'Default'))) {
          for (const k of planKeys(skillPlan(idx, U.key, en.prefabKey, { mode }))) out.add(k);
        }
      }
      if (U.charge) {
        for (const k of chargeKeys(U.charge)) out.add(k);
        for (const pk of Object.values(U.charge.onRelease.projectiles || {})) proj(pk);
      }
    }
    return [...out];
  }

  /** Battle reset: forget every unit (the effects themselves are cleared by OfficialFx.clear). */
  clear() {
    this.units.clear();
    this.tloops.clear();
    this.marks = [];
    this.hitLog = [];
    this.windows = [];
    this.born.clear();
    this.gone.clear();
    this.auraWins = [];
    this.aloops.clear();
    this.viewList = [];
    for (const m of this.modeWins.values()) for (const h of m.hs) h.stop();
    this.modeWins.clear();
  }
}
