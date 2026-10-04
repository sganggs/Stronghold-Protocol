// server/sim/content/items/battle.js — battle side of the 56 equipment items (research 04 §4, docs/DATA.md §5).
//
// Every operator's `unit.items` (equipped ids; merged items are golden `_b` ids with their own numbers) becomes a set of
// item grants. A grant = one concrete item record installed on one unit through `installItem(battle, unit, itemId)`:
// its behaviour registers hooks / timers / buffs through a Scope, and `grant.dispose()` removes all of it again (used
// by lendItemEffects: 萨尔贡 × 娜仁图亚 lends a carrier's items to its neighbours for 60 s).
//
// Numbers always come from the concrete record's buffs (support.buffsOf: `{ ...bb, ...bbStr }` per buff, looked up by
// the buff's bbStr.key — the flattened `params` of data/items.json lose duplicate keys such as 蒸汽之心 attack_speed).
//
// Stat rule (PRTS 盟约记录 "装备效果提供的属性加成均为直接乘算"; 直接乘算 = summed with every other percentage, PRTS 游戏数据
// 基础 — research 04 §2's additive reading; v2.5 had each item its own multiplier): atk/def/max_hp → support directMods
// (atkPct/defPct/hpPct += x; constants.js DIRECT_BONUS_STACKING); attack_speed → aspd (additive);
// magic_resistance → resFlat; respawn_time → redeployMul 1 + x; sp_recovery_per_sec → spRecoveryFlat;
// magic_resist_penetrate → resIgnorePct; taunt_level → taunt. Two different items on one unit both apply, and a
// normal + golden copy of the same item may coexist (different ids → different buff keys) and both apply.
//
// Gating: "若携带者为【X】盟约干员" = memberOf (support.isMember: own bonds + 变形同构体 grants; 调和 members only while the
// core bond is active). Combo partners (bbStr.equip_chess_id / other_equip) are item keys without the _a/_b suffix:
// either quality satisfies them; lent items count as carried. Both are evaluated live, at the moment of use.
//
// Hook priorities (non-default): 'fatal' — consumable death savers run LAST, so a skill's / talent's own undying (kits
// use 10 … −60) never wastes a charge: 坚固维式重锤's lock (异常效果 不死, once per deployment — deploymentOf) at
// PRIO_REVIVE −100 and its running windows, held by one battle-level hook, at PRIO_UNDYING_HELD −99 — before a 傀儡师's
// switch to its 替身 (professions.js, −100: PRTS 分支特性信息 傀儡师 "受到足以致命的伤害且未持有不死的情况下"), while the
// lock itself still comes after that switch (as in 0.1.1); then the M3茧甲 revive at PRIO_RESPAWN −101 — PRTS
// 卫戍协议：盟约 下半/PRTS盟约记录 备注 "“复活”的实现方式为：受益者因移动之外的原因退场时下次部署的再部署时间和费用归零": a
// revive acts on a knock-out, which a 不死 prevents, so the lock always comes first whatever the equip order (player
// report F1 after 0.1.0: with the 茧甲 equipped first the revive ran first and the first lethal hit showed no lock);
// 埃芒加德's band revive follows (bands/battle.js PRIO_BAND_REVIVE −110). Both revives stand in place for that redeploy,
// so each opens a new deployment for the lock (revivedInPlace).
// 骑士戒律's free in-skill undying runs early (20). Flat damage reduction 'hit' −10 (after the other damage modifiers).
// Proc damage dealt by items carries the tag 'item' and never re-triggers item procs.
//
// 蒸汽之心 (Victoria carrier) — LIVE model: the hammer types (灼燃/坚固/加速/战栗维式重锤) carried by the owner's operators
// that are on the field right now (cached ≤ 0.5 s, dropped whenever an operator deploys or leaves) are granted to the
// carrier; a hammer the carrier carries itself counts twice ("效果变为2倍"). Implemented as one shared hammer runtime
// per unit whose multiplier
// m = own copies of that hammer + (1 if 蒸汽之心 applies and the type is on the field): burn ×m of arts damage,
// undying duration ×m, ASPD ×m, tremble chance ×m. Granted hammers without an own copy use 蒸汽之心's blackboard.

import {
  num, itemRecord, itemKeyOf, buffsOf, isOp, onField, unitBonds, isMember, bondActive, isGroundOp, frontTile,
  alliesAround, passiveBuff, fxOn, battleStore, contentInfo, itemsOf, directMods,
} from '../support/index.js';
import { mitigate, hasHp, periodicDamage, isHpLoss } from '../../damage.js';

// =====================================================================================================================
// data helpers

/** Buff params `{ ...bb, ...bbStr }` of the record's buff whose bbStr.key is `bbKey` (null when absent). */
function bp(rec, bbKey) {
  for (const b of buffsOf(rec)) if (b.bbKey === bbKey) return b.p;
  return null;
}
/** Partner key of a combo buff (equip_chess_id / other_equip), without suffix. */
function partnerOf(p) {
  if (!p) return null;
  if (typeof p.equip_chess_id === 'string' && p.equip_chess_id) return itemKeyOf(p.equip_chess_id);
  if (typeof p.other_equip === 'string' && p.other_equip) return itemKeyOf(p.other_equip.split(',')[0].trim());
  return null;
}
const isProc = (dmg) => !!(dmg && dmg.tags && dmg.tags.indexOf('item') >= 0);
const procTags = (k) => ['item', `item:${k}`];
const chance = (battle, p) => p > 0 && (p >= 1 || battle.rng() < p);
/** An ally built from an enemy record — PRTS's 敌人类我方单位 (炎佑 enemy_9012_acloon). */
const ENEMY_RECORD = /^enemy_/;
/** 'fatal' priorities (see header). */
export const PRIO_REVIVE = -100;
/** A running 坚固 window (不死 held): before a 傀儡师's switch to its 替身 at −100 — see header. */
export const PRIO_UNDYING_HELD = PRIO_REVIVE + 1;
/** The items' 复活 (M3茧甲): acts on a knock-out, so after every 不死 (PRIO_REVIVE) — see header. */
export const PRIO_RESPAWN = PRIO_REVIVE - 1;
const PRIO_FREE_UNDYING = 20;

/** Stat keys of a stat buff → mods (直接乘算, see header). */
const STAT_BUFFS = new Set([
  'attr_common_global_buff', 'act1autochess_equip_acarm056_global_buff', 'act1autochess_equip_acarm050_global_buff',
  'magic_penetrate_global_buff', 'act1autochess_equip_acarm054_global_buff',
]);
function statMods(p) {
  const m = {};
  let any = false;
  const set = (k, v) => { m[k] = v; any = true; };
  // ATK / DEF / max HP "+X%" are 直接乘算 (support directMods: additive with every other percentage)
  for (const [k, v] of Object.entries(directMods({ atk: num(p.atk), def: num(p.def), hp: num(p.max_hp) ? Math.max(-0.99, num(p.max_hp)) : 0 }))) set(k, v);
  if (num(p.attack_speed)) set('aspd', num(p.attack_speed));
  if (num(p.magic_resistance)) set('resFlat', num(p.magic_resistance));
  if (num(p.respawn_time)) set('redeployMul', Math.max(0, 1 + num(p.respawn_time)));
  if (num(p.sp_recovery_per_sec)) set('spRecoveryFlat', num(p.sp_recovery_per_sec));
  if (num(p.magic_resist_penetrate)) set('resIgnorePct', num(p.magic_resist_penetrate));
  if (num(p.taunt_level)) set('taunt', num(p.taunt_level));
  return any ? m : null;
}

// ---- hammers (蒸汽之心) — derived from data: hammer records carry bbStr.big_hammer on their special buff
const STEAM_KEY = 'chess_item_6_05_e';
const STEAM_BUFF = 'act1autochess_equip_acarm079_global_buff';
function hammerTypeOf(p) {
  if (!p) return null;
  if (p.damage_scale != null) return 'burn';
  if (p.undeadable_duration != null) return 'undying';
  if (p.disarmed_duration != null) return 'tremble';
  if (p.attack_speed != null) return 'aspd';
  return null;
}
/** hammer item key → { type, bbKey } */
const HAMMERS = new Map();
function hammerInfo(key) {
  if (!HAMMERS.size) {
    const steam = itemRecord(`${STEAM_KEY}_a`);
    const sp = steam ? bp(steam, STEAM_BUFF) : null;
    const keys = sp ? Object.keys(sp).filter((k) => /^hammer_\d+$/.test(k)).map((k) => itemKeyOf(sp[k])) : [];
    for (const k of keys) {
      const rec = itemRecord(`${k}_a`);
      const b = rec ? buffsOf(rec).find((x) => x.p.big_hammer != null) : null;
      const type = b ? hammerTypeOf(b.p) : null;
      if (type) HAMMERS.set(k, { type, bbKey: b.bbKey });
    }
    if (!HAMMERS.size) HAMMERS.set('__none__', null);
  }
  return HAMMERS.get(key) ?? null;
}

// =====================================================================================================================
// membership / carrying

/** "若携带者为【X】盟约干员": own bonds (incl. 变形同构体 grants), or 调和 while the core bond X is active. */
export function memberOf(battle, u, bondId) {
  if (!isOp(u) || !bondId) return false;
  if (unitBonds(u).includes(bondId)) return true;
  return isMember(battle, u, bondId) && bondActive(battle, u.ownerId, bondId);
}

function runtime(battle) {
  return battleStore(battle, 'items:rt', () => {
    const rt = { grants: new Map(), hammers: new Map(), field: new Map(), lends: new Map() };
    // the per-player "hammers on the field" cache (蒸汽之心) is dropped whenever an operator enters or leaves the field:
    // a cache filled before the initial deployment must not hide the field's hammers for the first 0.5 s
    const drop = (c) => { if (c.unit && c.unit.kind === 'op') rt.field.clear(); };
    battle.on('deploy', drop);
    battle.on('death', drop);
    return rt;
  });
}
function grantsOf(rt, u) {
  let m = rt.grants.get(u);
  if (!m) { m = new Map(); rt.grants.set(u, m); }
  return m;
}
/** Does `u` carry an item of this key (own equipment or a lent grant)? */
export function carries(battle, u, key) {
  if (!key || !u) return false;
  for (const id of itemsOf(u)) if (itemKeyOf(id) === key) return true;
  const g = runtime(battle).grants.get(u);
  if (g) for (const x of g.values()) if (x.lent && x.key === key) return true;
  return false;
}

// =====================================================================================================================
// Scope: everything an item behaviour registers, removable at once

class Scope {
  constructor(battle, unit, tag) {
    this.b = battle;
    this.u = unit;
    this.tag = tag;
    this.hooks = [];
    this.scheds = [];
    this.buffs = [];
    this.fns = [];
    this.disposed = false;
  }
  key(part) { return `${this.tag}:${part}`; }
  on(name, fn, priority = 0) {
    const h = this.b.on(name, fn, { owner: this.u, priority });
    if (h) this.hooks.push(h);
    return h;
  }
  every(sec, fn, opts = {}) { const s = this.b.every(sec, fn, { owner: this.u, ...opts }); this.scheds.push(s); return s; }
  after(sec, fn) { const s = this.b.after(sec, fn, { owner: this.u }); this.scheds.push(s); return s; }
  /** Match-long stat buff on the carrier (persist, survives death/redeploy). */
  stat(part, mods, extra = {}) {
    const k = this.key(part);
    const r = passiveBuff(this.b, this.u, k, mods, extra);
    if (r) this.track(this.u, k);
    return r;
  }
  /** Any buff on any unit, removed at dispose. */
  buff(target, b) {
    const r = this.b.addBuff(target, b);
    if (r) this.track(target, b.key);
    return r;
  }
  track(target, key) { if (!this.buffs.some(([t, k]) => t === target && k === key)) this.buffs.push([target, key]); }
  onDispose(fn) { this.fns.push(fn); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const h of this.hooks) this.b.off(h);
    for (const s of this.scheds) s.cancel();
    for (const [t, k] of this.buffs) this.b.removeBuff(t, k);
    for (const f of this.fns) { try { f(); } catch { /* keep disposing */ } }
    this.hooks = []; this.scheds = []; this.buffs = []; this.fns = [];
  }
}

// =====================================================================================================================
// hammer runtime (shared per unit: own hammers + 蒸汽之心)

function fieldHammers(battle, rt, pid) {
  let c = rt.field.get(pid);
  if (!c) { c = { t: -Infinity, set: new Set() }; rt.field.set(pid, c); }
  if (battle.time - c.t >= 0.5 - 1e-9) {
    c.t = battle.time;
    c.set.clear();
    for (const a of battle.allyUnits) {
      if (a.kind !== 'op' || a.ownerId !== pid || !onField(a)) continue;
      for (const id of itemsOf(a)) { const h = hammerInfo(itemKeyOf(id)); if (h) c.set.add(h.type); }
    }
  }
  return c.set;
}

function hammerState(battle, rt, u) {
  let hs = rt.hammers.get(u);
  if (!hs) {
    // lockAt: the deployment (deploymentOf) whose 坚固 lock is spent — kept here, not in the grant's Scope, so a lend
    // that ends and comes back never resets it, and a redeploy while no hammer is held still re-arms it
    hs = { own: { burn: 0, undying: 0, aspd: 0, tremble: 0 }, params: {}, steam: 0, steamP: null, refs: 0, scope: null, aspdCur: 0, lockAt: null };
    rt.hammers.set(u, hs);
  }
  return hs;
}

// 坚固维式重锤's 不死 lock — once per DEPLOYMENT (the user's first-hand memory of the official mode, 2026-10-03: "每次部署
// 一次"; the text only says 首次). The lock belongs to the deployment, not to the grant that gave it: a borrower (萨尔贡 ×
// 娜仁图亚's 60 s lend) follows the same rule as an owner.

/**
 * The deployment `u` is in: every deploy bumps `deploySeq` (the redeploy after a knock-out, a 突袭 retreat + redeploy
 * [ASSUMED a deployment], 阿戈尔's 立刻复活), and an in-place 复活 (M3茧甲, 埃芒加德: revivedInPlace) opens a new one too
 * [ASSUMED] — PRTS (M3茧甲 / 埃芒加德 / 阿戈尔 备注) "“复活”的实现方式为：受益者因移动之外的原因退场时下次部署的再部署时间和
 * 费用归零": officially a revive is a 0-time / 0-cost redeploy; the remake keeps the unit standing instead.
 * Also read by 阿戈尔's devour (bonds/core.js): a unit whose deployment changed during the pass was knocked out.
 */
export function deploymentOf(u) { return `${u.deploySeq}:${u.mem.revives | 0}`; }

/** An in-place 复活 (M3茧甲, 埃芒加德) happened: a new deployment for the once-per-deployment lock (deploymentOf). */
export function revivedInPlace(u) { if (u && u.mem) u.mem.revives = (u.mem.revives | 0) + 1; }

/**
 * Does `u` hold 坚固维式重锤's 不死 right now — a window started in this deployment that has not run out? The window lives
 * on the unit (`mem.undyingUntil`, `mem.undyingAt`) and a battle-level hook holds it (hammerAcquire), so it outlives the
 * grant that started it — a lend running out mid-window leaves the 不死 for its 8 s [ASSUMED: the 异常效果 outlasts its
 * source] — and ends with the deployment. 信仰搅拌机 S2 steps aside while it holds (kits/tier4.js).
 */
export function holdsUndying(battle, u) {
  return !!u && u.mem.undyingAt != null && battle.time < u.mem.undyingUntil && u.mem.undyingAt === deploymentOf(u);
}
/** Effective multiplier of a hammer type on `u` and its params (null when the type does not apply). */
function hammerMul(battle, rt, u, hs, type) {
  const own = hs.own[type];
  const steam = hs.steam > 0 && memberOf(battle, u, 'victoriaShip') && fieldHammers(battle, rt, u.ownerId).has(type) ? 1 : 0;
  return own + steam;
}
const hammerParams = (hs, type) => hs.params[type] ?? hs.steamP ?? null;

function hammerRefresh(battle, rt, u, hs) {
  if (!hs.scope) return;
  const p = hammerParams(hs, 'aspd');
  const v = p ? num(p.attack_speed) * hammerMul(battle, rt, u, hs, 'aspd') : 0;
  if (v === hs.aspdCur) return;
  hs.aspdCur = v;
  const k = hs.scope.key('aspd');
  if (v) hs.scope.stat('aspd', { aspd: v });
  else battle.removeBuff(u, k);
}

function hammerAcquire(battle, rt, u) {
  const hs = hammerState(battle, rt, u);
  hs.refs++;
  if (hs.scope) return hs;
  // every running 坚固 window of the battle (holdsUndying): one hook that no grant owns, ahead of every lock hook and of a
  // 傀儡师's switch to its 替身 (PRIO_UNDYING_HELD: a 本体 holding 不死 does not switch)
  if (!rt.undyingHook) {
    rt.undyingHook = battle.on('fatal', (c) => { if (!c.prevented && holdsUndying(battle, c.unit)) c.prevented = true; }, { priority: PRIO_UNDYING_HELD });
  }
  const S = new Scope(battle, u, `item:hammer#${u.id}`);
  hs.scope = S;
  hs.aspdCur = 0;
  S.every(0.5, () => hammerRefresh(battle, rt, u, hs), { immediate: true });
  // 灼燃: arts damage also deals burn (元素损伤) = damage_scale × damage × m — not on a killing blow (the hook runs
  // before the kill, at 0 HP: no burst on the corpse)
  S.on('damaged', (c) => {
    if (c.source !== u || c.type !== 'arts' || !(c.amount > 0) || isProc(c.dmg) || !c.target || c.target.side !== 'enemy' || !hasHp(c.target)) return;
    const p = hammerParams(hs, 'burn');
    if (!p) return;
    const m = hammerMul(battle, rt, u, hs, 'burn');
    if (m > 0) battle.dealDamage(u, c.target, { type: 'element', element: 'burn', amount: c.amount * num(p.damage_scale) * m, tags: procTags('hammer_burn') });
  });
  // 战栗: 地面干员 carrier (melee position, any tile — support isGroundOp), on attack prob × m ⇒ 战栗 disarmed_duration s
  S.on('attack', (c) => {
    if (c.attacker !== u || !isGroundOp(u)) return;
    const p = hammerParams(hs, 'tremble');
    if (!p) return;
    const m = hammerMul(battle, rt, u, hs, 'tremble');
    if (!(m > 0)) return;
    const pr = Math.min(1, num(p.prob) * m);
    for (const t of c.targets) {
      if (t && t.side === 'enemy' && t.alive && chance(battle, pr)) battle.applyStatus(t, 'tremble', { duration: num(p.disarmed_duration, 2), source: u });
    }
  });
  // 坚固: the first lethal hit of each deployment (deploymentOf) ⇒ HP never below 1 for undeadable_duration × m s — the
  // window, held by the battle-level hook above. A new deployment re-arms the lock and leaves a window still running
  // behind (the retreat ends the unit's states). Any lethal HP loss sets it off, an ally's (the 阿戈尔 battle-start
  // devour, "造成5000点物理伤害") or the carrier's own (源石溶剂) included.
  S.on('fatal', (c) => {
    if (c.unit !== u || c.prevented) return;
    const at = deploymentOf(u);
    if (hs.lockAt === at) return;
    const p = hammerParams(hs, 'undying');
    if (!p) return;
    const m = hammerMul(battle, rt, u, hs, 'undying');
    if (!(m > 0)) return;
    hs.lockAt = at;
    const dur = num(p.undeadable_duration, 8) * m;
    u.mem.undyingUntil = battle.time + dur;             // the carrier holds 不死 (holdsUndying)
    u.mem.undyingAt = at;
    c.prevented = true;
    fxOn(battle, 'undying', u, 'item:hammer', 'chess_item_3_09_e', { duration: dur });
  }, PRIO_REVIVE);
  return hs;
}
function hammerRelease(battle, rt, u, hs) {
  hs.refs = Math.max(0, hs.refs - 1);
  if (hs.refs > 0 || !hs.scope) { hammerRefresh(battle, rt, u, hs); return; }
  hs.scope.dispose();
  hs.scope = null;
  hs.aspdCur = 0;
}

// =====================================================================================================================
// item behaviours: key → (battle, u, rec, S, ctx) — register through S (disposed with the grant)

/** Damage mitigation estimate for flat DR / weakness damage (same formula as damage.js). */
function mitigated(amount, type, target, source, dmg) {
  const ss = source && source.s ? source.s : null;
  return mitigate(amount, type, target.s, {
    defIgnorePct: (dmg.defIgnorePct || 0) + (ss ? ss.defIgnorePct : 0),
    defIgnoreFlat: (dmg.defIgnoreFlat || 0) + (ss ? ss.defIgnoreFlat : 0),
    resIgnorePct: (dmg.resIgnorePct || 0) + (ss ? ss.resIgnorePct : 0),
    resIgnoreFlat: (dmg.resIgnoreFlat || 0) + (ss ? ss.resIgnoreFlat : 0),
  });
}

/** Per enemy target of an attack by `u` (heals excluded). */
function onAttackEnemies(S, u, fn) {
  S.on('attack', (c) => {
    if (c.attacker !== u) return;
    const ts = c.targets;
    for (let i = 0; i < ts.length; i++) { const t = ts[i]; if (t && t.side === 'enemy' && t.alive) fn(t, c); }
  });
}

/** Generic buff-key behaviours (shared by several items). */
const BY_BUFF = {
  // 源石溶剂: the text's "每秒流失 damage 点生命值" is officially 每秒受到 damage 点真实伤害 (PRTS 盟约记录 修正 "并非流失", 备注
  // "造成无来源真实持续环境伤害"; the `periodic_damage` template — also 狂暴宿主 "自身每秒受到N无来源真实伤害"): a damage instance,
  // not a 流失 — shields, damage-taken modifiers and the target-side `hit` effects apply, and it is a "受到伤害" for 受击回复
  // SP, the 重装 TAKE_DAMAGE trigger and 信仰搅拌机 S3's counters (player report D1). 无来源: hooks see no source; the carrier
  // keeps the credit (a carrier the drain finishes off is its own kill, as before). May kill.
  // The same 备注: "携带后，全场范围内的所有敌人类我方单位也会获得此装备的“每秒受到60真实伤害”效果（该效果的付与为我方阵营索敌，
  // 可对空，无视目标可选性）" — every enemy-record unit on our side of the whole field (炎佑 enemy_9012_acloon, a partner's
  // too; flying, 孤立) takes the same tick, credited to nobody, while a carrier is on the field [ASSUMED: it ends with its
  // carriers]; one effect per unit however many carriers (PRTS 作战机制 "同名buff的默认叠加策略buff只能表现出一个").
  periodic_damage(battle, u, p, S) {
    const d = num(p.damage);
    if (!(d > 0)) return;
    S.stat('drain', null, { interval: 1, onTick: ({ unit }) => {
      if (!unit.deployed) return;
      battle.dealDamage(unit, unit, periodicDamage(d));
      for (const a of battle.allies()) {
        if (a === unit || !ENEMY_RECORD.test(a.defId ?? '') || battle.time - (a.mem.solventAt ?? -Infinity) < 1 - 1e-6) continue;
        a.mem.solventAt = battle.time;
        battle.dealDamage(null, a, periodicDamage(d));
      }
    } });
  },
  // 奥术法阵: 攻击使目标失去特殊能力 silence s. PRTS 盟约记录 备注 (as 源石溶剂's): "携带后，全场范围内的所有敌人类我方单位也会获得
  // 此装备的“造成伤害时使目标失去特殊能力5秒”效果（该效果的付与为我方阵营索敌，可对空，无视目标可选性）" — the damage of every
  // enemy-record unit on our side (炎佑, a partner's too) silences its target while a carrier is on the field [ASSUMED: it
  // ends with its carriers]; one effect per damage instance however many carriers.
  silence_attachment(battle, u, p, S) {
    const d = num(p.silence);
    if (!(d > 0)) return;
    onAttackEnemies(S, u, (t) => battle.applyStatus(t, 'silence', { duration: d, source: u }));
    S.on('damaged', (c) => {
      const a = c.source, t = c.target;
      if (!a || a === u || a.side !== 'ally' || !ENEMY_RECORD.test(a.defId ?? '') || !t || t.side !== 'enemy' || !t.alive || !onField(u)) return;
      if (c.type === 'element') return; // an element 损伤 (the gauge) is no damage instance
      if (c.dmg) { if (c.dmg.arcaneSilence) return; c.dmg.arcaneSilence = true; }
      battle.applyStatus(t, 'silence', { duration: d, source: a });
    });
  },
  // 海沟实验体: 伤害减免 value per damage instance (after DEF/RES)
  halfidle_block_fixed_damage(battle, u, p, S) {
    const v = num(p.value);
    if (!(v > 0)) return;
    S.on('hit', (c) => {
      if (c.target !== u) return;
      const d = c.dmg;
      if (d.type === 'element') return;
      const base = mitigated(d.amount * d.mul, d.type, u, c.source, d);
      if (!(base > 0)) return;
      d.mul *= Math.max(0, base - v) / base;
    }, -10);
  },
  // 叙拉古正装: allies on the two tiles beside the carrier ("左右两格", perpendicular to its direction: the facing-RIGHT
  // offsets (±1, 0) rotated by its dir) get ASPD +attack_speed
  act2autochess_equip_acarm121_ability(battle, u, p, S) {
    const v = num(p.attack_speed);
    if (!v) return;
    const key = S.key('side');
    const mods = { aspd: v };
    const SIDES = [[1, 0], [-1, 0]];
    S.every(0.5, () => {
      if (!onField(u)) return;
      for (const a of alliesAround(battle, u, SIDES)) if (a.kind === 'op') S.buff(a, { key, duration: 0.6, mods, refresh: 'replace' });
    }, { immediate: true });
  },
};

/** Item-key behaviours. */
const BY_ITEM = {
  // 精准狙击镜: damage ×damage_scale against targets ≥ radius tiles away
  chess_item_3_02_e(battle, u, rec, S) {
    const p = bp(rec, 'act1autochess_equip_acarm063_global_buff');
    if (!p) return;
    const r = num(p.radius, 3), sc = num(p.damage_scale, 1);
    S.on('hit', (c) => {
      if (c.source !== u || !c.target || c.target.side !== 'enemy' || c.dmg.type === 'element') return;
      if (Math.hypot(c.target.x - u.x, c.target.y - u.y) >= r - 1e-6) c.dmg.mul *= sc;
    });
  },
  // 炎国短刀: each skill activation +atk (≤ atk_buff_cnt stacks) — one 直接乘算 bonus of atk × stacks
  chess_item_3_04_e(battle, u, rec, S) {
    const p = bp(rec, 'act1vautochess_equip_acarm024_global_buff');
    if (!p) return;
    let n = 0;
    const cap = Math.max(1, Math.floor(num(p.atk_buff_cnt, 10)));
    S.on('skillStart', (c) => {
      if (c.unit !== u || n >= cap || !chance(battle, num(p.prob, 1))) return;
      n++;
      S.stat('stacks', directMods({ atk: num(p.atk) * n }));
    });
  },
  // 迅捷作战粮: on deploy SP += sp_each_person × (1 + other operators sharing a bond)
  chess_item_3_05_e(battle, u, rec, S) {
    const p = bp(rec, 'act1autochess_equip_acarm051_global_buff');
    const each = p ? num(p.sp_each_person) : 0;
    if (!(each > 0)) return;
    S.on('deploy', (c) => {
      if (c.unit !== u || !u.skill) return;
      const mine = unitBonds(u);
      let n = 0;
      if (mine.length) {
        for (const a of battle.allyUnits) {
          if (a === u || a.kind !== 'op' || a.ownerId !== u.ownerId || a.removed) continue;
          if (!(c.initial ? !a.removed : onField(a))) continue;
          if (unitBonds(a).some((b) => mine.includes(b))) n++;
        }
      }
      u.skill.gainSp(each * (1 + n), 'item');
    });
  },
  // 歌利亚头盔: HP +init_max_hp; deploy with no operator on the tile in front ⇒ HP +ex_max_hp (until it leaves)
  chess_item_3_06_e(battle, u, rec, S) {
    const p = bp(rec, 'act1autochess_equip_acarm049_global_buff');
    if (!p) return;
    if (num(p.init_max_hp)) S.stat('hp', directMods({ hp: num(p.init_max_hp) }));
    const ex = num(p.ex_max_hp);
    if (!ex) return;
    const key = S.key('front');
    const check = (initial) => {
      const [fr, fc] = frontTile(u);
      let occupied = false;
      for (const a of battle.allyUnits) {
        if (a === u || a.kind !== 'op' || a.removed) continue;
        const here = initial ? a.homeR === fr && a.homeC === fc : onField(a) && a.tileR === fr && a.tileC === fc;
        if (here) { occupied = true; break; }
      }
      if (!occupied) S.buff(u, { key, mods: directMods({ hp: ex }), refresh: 'replace' });
      else battle.removeBuff(u, key);
    };
    S.on('deploy', (c) => { if (c.unit === u) check(!!c.initial); });
    if (onField(u)) check(false);
  },
  // 突袭手雷: within `duration` s after each deploy, attacks stun the target `stun` s
  chess_item_3_11_e(battle, u, rec, S) {
    const p = bp(rec, 'act1autochess_equip_acarm064_global_buff');
    if (!p) return;
    const win = num(p.duration), st = num(p.stun);
    if (!(win > 0 && st > 0)) return;
    onAttackEnemies(S, u, (t) => { if (battle.time - u.deployedAt <= win + 1e-9) battle.applyStatus(t, 'stun', { duration: st, source: u }); });
  },
  // 有限加速器: every attack or heal ⇒ ASPD +attack_speed (≤ max_buff_cnt stacks, whole battle)
  chess_item_4_03_e(battle, u, rec, S) {
    const p = bp(rec, 'act1vautochess_equip_acarm037_global_buff');
    if (!p || !num(p.attack_speed)) return;
    const key = S.key('stacks');
    const cap = Math.max(1, Math.floor(num(p.max_buff_cnt, 60)));
    const mods = { aspd: num(p.attack_speed) };
    S.on('attack', (c) => {
      if (c.attacker !== u) return;
      S.buff(u, { key, mods, refresh: 'stack', stacks: 1, maxStacks: cap, persist: true, allowDead: true });
    });
  },
  // 伪装服: first damage taken in the battle ⇒ 隐匿 `duration` s (a 流失 is not 受到伤害: damage.js isHpLoss)
  chess_item_4_04_e(battle, u, rec, S) {
    const p = bp(rec, 'act2autochess_equip_acarm055_global_buff');
    const d = p ? num(p.duration) : 0;
    if (!(d > 0)) return;
    let used = false;
    S.on('damaged', (c) => {
      if (used || c.target !== u || !(c.amount > 0) || !u.alive || isHpLoss(c.dmg)) return;
      used = true;
      battle.applyStatus(u, 'stealth', { duration: d, source: u });
      fxOn(battle, 'camouflage', u, 'item:chess_item_4_04_e', rec.id, { duration: d });
    });
  },
  // 防暴盾: while blocking, damage from units it does not block ×damage_scale
  chess_item_4_05_e(battle, u, rec, S) {
    const p = bp(rec, 'act1autochess_equip_acarm060_global_buff');
    if (!p) return;
    const sc = num(p.damage_scale, 1);
    S.on('hit', (c) => {
      // "受到来自非自身阻挡单位的伤害": only damage whose source is a unit the carrier does not block (terrain / sourceless
      // bursts and its own HP loss are not "from a unit")
      const src = c.source;
      if (c.target !== u || !u.blocking.length || c.dmg.type === 'element' || !src || src === u) return;
      if (u.blocking.indexOf(src) >= 0) return;
      c.dmg.mul *= sc;
    });
  },
  // 休眠子裔: each attacked target ⇒ heal self hp_ratio × max HP
  chess_item_4_06_e(battle, u, rec, S) {
    const p = bp(rec, 'act1vautochess_equip_acarm025_global_buff');
    const r = p ? num(p.hp_ratio) : 0;
    if (r > 0) onAttackEnemies(S, u, () => battle.heal(u, u, u.s.maxHp * r, { self: true }));
  },
  // 卡西米尔竞技旗: damage ×damage_scale for `interval` s after each deploy, then −damage_scale_minus every ex_interval s
  chess_item_4_07_e(battle, u, rec, S) {
    const p = bp(rec, 'act2autochess_equip_acarm120_global_buff');
    if (!p) return;
    const sc = num(p.damage_scale, 1), win = num(p.interval, 15), step = Math.max(0.1, num(p.ex_interval, 0.5)), minus = num(p.damage_scale_minus);
    S.on('hit', (c) => {
      if (c.source !== u || c.dmg.type === 'element') return;
      const t = battle.time - u.deployedAt;
      let m = sc;
      if (t > win + 1e-9) m = minus < 0 ? Math.max(1, sc + minus * Math.ceil((t - win) / step - 1e-9)) : 1;
      if (m !== 1) c.dmg.mul *= m;
    });
  },
  // 拉特兰桥夹: ammo skill down to 1 bullet ⇒ prob: +ceil(ammo_percent × ammo) bullets (≤ max_trigger_cnt per deploy)
  chess_item_4_08_e(battle, u, rec, S) {
    const p = bp(rec, 'act1autochess_equip_acarm057_global_buff');
    if (!p) return;
    const cap = Math.floor(num(p.max_trigger_cnt, 3));
    let seq = -1, n = 0;
    S.on('ammoUsed', (c) => {
      if (c.unit !== u || c.left !== 1 || !c.skill) return;
      if (u.deploySeq !== seq) { seq = u.deploySeq; n = 0; }
      if (n >= cap || !chance(battle, num(p.prob))) return;
      n++;
      c.skill.addAmmo(Math.max(1, Math.ceil(num(p.ammo_percent) * c.skill.ammo - 1e-9)));
      fxOn(battle, 'buff', u, 'item:chess_item_4_08_e', rec.id);
    });
  },
  // 浓缩嗅盐: while HP ratio > hp_ratio, immune to 晕眩/冻结 … special states
  chess_item_4_10_e(battle, u, rec, S) {
    const p = bp(rec, 'act1autochess_equip_acarm059_global_buff');
    if (!p) return;
    const thr = num(p.hp_ratio, 1);
    S.on('beforeStatus', (c) => { if (c.target === u && CC.has(c.status) && u.hpRatio > thr) c.cancel = true; });
  },
  // 护盾无人机: heals ⇒ prob: target gets 1 shield layer (≤ max_stack_cnt)
  chess_item_4_11_e(battle, u, rec, S) {
    const p = bp(rec, 'act1autochess_equip_acarm061_global_buff');
    if (!p) return;
    const pr = num(p.prob), cap = Math.max(1, Math.floor(num(p.max_stack_cnt, 1)));
    S.on('heal', (c) => {
      if (c.source !== u || !c.target || (c.opts && (c.opts.regen || c.opts.self)) || !(c.amount > 0)) return;
      const cur = c.target.findBuff(SHIELD_KEY);
      if (cur && cur.shieldHits >= cap) return;
      if (!chance(battle, pr)) return;
      if (addShieldLayer(battle, c.target, SHIELD_KEY, cap)) fxOn(battle, 'shield', c.target, 'item:chess_item_4_11_e', rec.id);
    });
  },
  // M3茧甲: knocked down in battle ⇒ revive at full HP (max_respawn_cnt per battle), in place — PRTS's form (退场, then a
  // 0-time / 0-cost redeploy) is not modelled, but it counts as a new deployment for 坚固维式重锤's lock (revivedInPlace)
  chess_item_4_12_e(battle, u, rec, S) {
    const p = bp(rec, 'act1autochess_equip_acarm068_global_buff');
    const max = p ? Math.floor(num(p.max_respawn_cnt, 1)) : 0;
    if (!(max > 0)) return;
    let used = 0;
    S.on('fatal', (c) => {
      if (c.unit !== u || c.prevented || used >= max) return;
      used++;
      c.prevented = true;
      u.hp = u.s.maxHp;
      revivedInPlace(u);
      fxOn(battle, 'revive', u, 'item:chess_item_4_12_e', rec.id, { left: max - used });
    }, PRIO_RESPAWN); // after the hammer's 不死 lock, whatever the equip order (header)
  },
  // 催泪瓦斯: on attack prob ⇒ 1 麻痹 stack
  chess_item_5_01_e(battle, u, rec, S) {
    const p = bp(rec, 'act1autochess_equip_acarm058_global_buff');
    const pr = p ? num(p.prob) : 0;
    if (pr > 0) onAttackEnemies(S, u, (t) => { if (chance(battle, pr)) battle.applyStatus(t, 'palsy', { value: 1, source: u }); });
  },
  // 谢拉格不融冰: on attack prob ⇒ 寒冷 `cold` s
  chess_item_5_02_e(battle, u, rec, S) {
    const p = bp(rec, 'act1vautochess_equip_acarm003_global_buff');
    if (!p) return;
    const pr = num(p.prob), d = num(p.cold);
    if (pr > 0 && d > 0) onAttackEnemies(S, u, (t) => { if (chance(battle, pr)) battle.applyStatus(t, 'cold', { duration: d, source: u }); });
  },
  // 双模机械臂: physical/arts damage becomes 弱点伤害 (whichever type the target resists less)
  chess_item_5_03_e(battle, u, rec, S) {
    S.on('hit', (c) => { if (c.source === u) weaknessRetype(c.dmg, u, c.target); }, 5);
  },
  // 天马之盔: with 天马之枪 ⇒ regen hp_recovery_per_sec_by_max_hp_ratio × max HP per second
  chess_item_5_09_e(battle, u, rec, S) {
    const p = bp(rec, 'act2autochess_equip_acarm118_global_buff');
    const partner = partnerOf(p);
    const r = p ? num(p.hp_recovery_per_sec_by_max_hp_ratio) : 0;
    if (!partner || !(r > 0)) return;
    S.stat('set', null, { interval: 1, onTick: ({ unit }) => { if (unit.deployed && carries(battle, unit, partner)) battle.heal(unit, unit, unit.s.maxHp * r, { self: true }); } });
  },
  // 天马之枪: with 天马之盔 ⇒ every damage instance also deals atk_scale × ATK true damage
  chess_item_6_01_e(battle, u, rec, S) {
    const p = bp(rec, 'act2autochess_equip_acarm117_global_buff');
    const partner = partnerOf(p);
    const sc = p ? num(p.atk_scale) : 0;
    if (!partner || !(sc > 0)) return;
    S.on('damaged', (c) => {
      if (c.source !== u || isProc(c.dmg) || c.type === 'element' || !c.target || c.target.side !== 'enemy' || !c.target.alive) return;
      if (!carries(battle, u, partner)) return;
      battle.dealDamage(u, c.target, { amount: u.s.atk * sc, type: 'true', canDodge: false, tags: procTags('pegasus') });
    });
  },
  // 铳骑之威 (拉特兰): on attack 35 % ⇒ extra bullet at 1 enemy in range, atk_scale_1 (with 拉特兰桥夹 atk_scale_2) × ATK phys
  chess_item_6_02_e(battle, u, rec, S) {
    const p = bp(rec, 'act1autochess_equip_acarm076_global_buff');
    if (!p) return;
    const partner = partnerOf(p);
    S.on('attack', (c) => {
      if (c.attacker !== u || !c.targets.some((t) => t && t.side === 'enemy') || !memberOf(battle, u, 'lateranoShip')) return;
      if (!chance(battle, num(p.prob))) return;
      const cands = battle.enemiesInKeys(u.rangeKeys, u, u.profile);
      const t = battle.rng.pick(cands);
      if (!t) return;
      const sc = partner && carries(battle, u, partner) ? num(p.atk_scale_2) : num(p.atk_scale_1);
      battle.fx('strike', { x: t.x, y: t.y, id: t.id, src: 'item:chess_item_6_02_e', key: rec.id, from: u.id });
      battle.dealDamage(u, t, { amount: u.s.atk * sc, type: 'phys', tags: procTags('gunknight') });
    });
  },
  // 天师古鼎 (炎): ASPD +attack_speed × min(operators gained this round, max_cnt) for the battle
  chess_item_6_03_e(battle, u, rec, S) {
    const p = bp(rec, 'act1autochess_equip_acarm077_global_buff');
    if (!p || !memberOf(battle, u, 'yanShip')) return;
    const k = Math.min(Math.floor(num(p.max_cnt, 3)), Math.max(0, Math.floor(num(contentInfo(battle, u.ownerId).roundStats?.gainedChess))));
    if (k > 0) S.stat('yan', { aspd: num(p.attack_speed) * k });
  },
  // 海沟实验体 (阿戈尔): hit taken ⇒ atk_scale × ATK arts to the source (lock_duration CD); + 阿戈尔重刃 ⇒ one more hit
  chess_item_6_04_e(battle, u, rec, S) {
    const p = bp(rec, 'act2autochess_equip_acarm078_global_buff');
    if (!p) return;
    const partner = partnerOf(p);
    const cd = num(p.lock_duration, 0.5), sc = num(p.atk_scale);
    let ready = -Infinity;
    S.on('damaged', (c) => {
      const src = c.source;
      if (c.target !== u || !src || src.side !== 'enemy' || !src.alive || battle.time < ready || isProc(c.dmg)) return;
      if (!u.alive || !memberOf(battle, u, 'egirShip')) return;
      ready = battle.time + cd;
      const hits = partner && carries(battle, u, partner) ? 2 : 1;
      for (let i = 0; i < hits && src.alive; i++) battle.dealDamage(u, src, { amount: u.s.atk * sc, type: 'arts', tags: procTags('trench') });
    });
  },
  // 蒸汽之心 (维多利亚): hammer effects of the field (see header)
  chess_item_6_05_e(battle, u, rec, S, g) {
    const rt = runtime(battle);
    const hs = hammerAcquire(battle, rt, u);
    hs.steam++;
    if (!hs.steamP) hs.steamP = bp(rec, STEAM_BUFF);
    hammerRefresh(battle, rt, u, hs);
    S.onDispose(() => { hs.steam = Math.max(0, hs.steam - 1); hammerRelease(battle, rt, u, hs); });
  },
  // 耶拉冈德之泪 (谢拉格): every interval s, cold/frozen enemies in range take atk_scale (+不融冰: atk_scale_ex) × ATK arts
  chess_item_6_06_e(battle, u, rec, S) {
    const p = bp(rec, 'act2autochess_equip_acarm102_ability');
    if (!p) return;
    const partner = partnerOf(p);
    S.every(Math.max(0.1, num(p.interval, 1)), () => {
      if (!onField(u) || !memberOf(battle, u, 'kjeragShip')) return;
      const sc = partner && carries(battle, u, partner) ? num(p.atk_scale_ex) : num(p.atk_scale);
      for (const e of battle.enemiesInKeys(u.rangeKeys, u, { canHitFly: true })) {
        const f = e.s.flags;
        if (f.cold || f.freeze) battle.dealDamage(u, e, { amount: u.s.atk * sc, type: 'arts', canDodge: false, tags: procTags('tears') });
      }
    });
  },
  // 黄沙罗盘: 初始技力 +init_sp each deploy; (萨尔贡) first skill end +sp; + 萨尔贡浓茶: each cast all 萨尔贡 +addition_sp
  chess_item_6_07_e(battle, u, rec, S) {
    const p = bp(rec, 'act1autochess_equip_acarm103_global_buff');
    if (!p) return;
    const partner = partnerOf(p);
    const init = num(p.init_sp);
    if (init > 0) {
      S.on('deploy', (c) => { if (c.unit === u && u.skill) u.skill.gainSp(init, 'init'); });
      if (onField(u) && u.skill) u.skill.gainSp(init, 'init');
    }
    let firstDone = false;
    S.on('skillEnd', (c) => {
      if (c.unit !== u || firstDone || c.reason === 'death' || !memberOf(battle, u, 'sargonShip')) return;
      firstDone = true;
      if (u.skill && u.alive) u.skill.gainSp(num(p.sp), 'item');
    });
    S.on('skillStart', (c) => {
      if (c.unit !== u || !partner || !memberOf(battle, u, 'sargonShip') || !carries(battle, u, partner)) return;
      const n = num(p.addition_sp);
      if (!(n > 0)) return;
      for (const a of battle.allyUnits) {
        if (a.kind === 'op' && a.ownerId === u.ownerId && onField(a) && a.skill && memberOf(battle, a, 'sargonShip')) a.skill.gainSp(n, 'item');
      }
    });
  },
  // 骑士戒律 (卡西米尔): skill start ⇒ 20 s aura: enemies in range ASPD ×attack_speed, move ×move_speed;
  //   + 卡西米尔竞技旗: during the (timed) skill ATK +atk, lethal damage does not retreat it — it retreats when the skill ends
  chess_item_6_10_e(battle, u, rec, S) {
    const p = bp(rec, 'act2autochess_equip_acarm119_global_buff');
    const a = bp(rec, 'act2autochess_equip_acarm119_ability');
    if (!p) return;
    const partner = partnerOf(p);
    const win = num(p.duration, 20);
    const aspdMul = a ? num(a.attack_speed, 1) : 1, moveMul = a ? num(a.move_speed, 1) : 1;
    const auraKey = S.key('aura'), comboKey = S.key('combo');
    let until = -Infinity, combo = false, doomed = false;
    S.on('skillStart', (c) => {
      if (c.unit !== u || !memberOf(battle, u, 'kazimierzShip')) return;
      until = battle.time + win;
      if (partner && carries(battle, u, partner) && c.skill && c.skill.isTimed) {
        combo = true;
        doomed = false;
        S.buff(u, { key: comboKey, mods: directMods({ atk: num(p.atk) }) });
      }
    });
    S.on('skillEnd', (c) => {
      if (c.unit !== u || !combo) return;
      combo = false;
      battle.removeBuff(u, comboKey);
      if (doomed && c.reason !== 'death') {
        doomed = false;
        battle.after(0, () => { if (u.alive) battle.retreat(u, { reason: 'retreat' }); });
      }
    });
    S.on('fatal', (c) => {
      if (c.unit !== u || c.prevented || !combo) return;
      c.prevented = true;
      doomed = true;
    }, PRIO_FREE_UNDYING);
    S.every(0.5, () => {
      if (battle.time >= until || !onField(u)) return;
      for (const e of battle.enemiesInKeys(u.rangeKeys, u, { canHitFly: true })) {
        S.buff(e, { key: auraKey, duration: 0.6, refresh: 'replace', mods: { aspd: -(1 - aspdMul) * num(e.base.aspd, 100), moveMul } });
      }
    }, { immediate: true });
  },
  // 家族徽章 (叙拉古): while 隐匿 ATK grows atk_per_sec/s up to +max_atk until the first damage after 隐匿 ends
  //   (or leaving the field); + 叙拉古正装 ⇒ that first hit also deals atk_scale × ATK true damage
  chess_item_6_11_e(battle, u, rec, S) {
    const p = bp(rec, 'act2autochess_equip_acarm122_global_buff');
    if (!p) return;
    const partner = partnerOf(p);
    const key = S.key('stealth');
    const per = num(p.atk_per_sec), max = num(p.max_atk, 1);
    const st = { bonus: 0, wasStealth: false, armed: false, seq: -1 };
    const TICKS = 0.25;
    S.every(TICKS, () => {
      if (u.deploySeq !== st.seq) { st.seq = u.deploySeq; st.bonus = 0; st.armed = false; st.wasStealth = false; }
      if (!onField(u) || !memberOf(battle, u, 'siracusaShip')) return;
      const stealth = !!u.s.flags.stealth;
      if (stealth && st.bonus < max) {
        st.bonus = Math.min(max, st.bonus + per * TICKS);
        S.buff(u, { key, mods: directMods({ atk: st.bonus }), refresh: 'replace' });
      }
      if (st.wasStealth && !stealth && st.bonus > 0) st.armed = true;
      st.wasStealth = stealth;
    });
    S.on('damaged', (c) => {
      if (c.source !== u || !st.armed || isProc(c.dmg) || !(c.amount > 0)) return;
      st.armed = false;
      if (partner && carries(battle, u, partner) && c.target && c.target.alive && c.target.side === 'enemy') {
        battle.dealDamage(u, c.target, { amount: u.s.atk * num(p.atk_scale), type: 'true', canDodge: false, tags: procTags('crest') });
        battle.fx('strike', { x: c.target.x, y: c.target.y, id: c.target.id, src: 'item:chess_item_6_11_e', key: rec.id, from: u.id });
      }
      st.bonus = 0;
      battle.removeBuff(u, key);
    });
    S.on('death', (c) => { if (c.unit === u) { st.bonus = 0; st.armed = false; } });
  },
};

/** 浓缩嗅盐 "免疫晕眩、冻结等特殊状态" — research 04 §4 list (stun/freeze/sleep/levitate/palsy). 寒冷 is a debuff, not a
 * control state: it still applies, but the freeze of a second 寒冷 is itself a `freeze` status and is cancelled. */
const CC = new Set(['stun', 'freeze', 'sleep', 'levitate', 'palsy']);
const SHIELD_KEY = 'item:shield_drone';

/**
 * 弱点伤害 (双模机械臂, band 陈 以己之长): a physical or arts DamageInfo from `source` becomes whichever of the two types
 * `target` resists less (same mitigation formula as damage.js, incl. the source's ignore stats). Mutates `dmg.type`.
 */
export function weaknessRetype(dmg, source, target) {
  if (!dmg || !target || !target.s || (dmg.type !== 'phys' && dmg.type !== 'arts')) return;
  const ph = mitigated(dmg.amount, 'phys', target, source, dmg);
  const ar = mitigated(dmg.amount, 'arts', target, source, dmg);
  const best = ar > ph + 1e-9 ? 'arts' : ph > ar + 1e-9 ? 'phys' : dmg.type;
  if (best !== dmg.type) dmg.type = best;
}

/**
 * "获得1层护盾（最多`cap`层）": one shield layer (negates one damage instance) under buff `key`. Returns true when a
 * layer was added (false at the cap).
 */
export function addShieldLayer(battle, target, key, cap = 1) {
  if (!target || !target.alive) return false;
  const cur = target.findBuff(key);
  const have = cur ? cur.shieldHits || 0 : 0;
  if (have >= cap) return false;
  battle.addBuff(target, { key, shieldHits: have + 1, visible: true, refresh: 'replace' });
  return true;
}

/** Does this record have a battle part? (stat buffs, known buff behaviours, hammer specials, item behaviours) */
export function hasBattleEffect(rec) {
  if (!rec || rec.itemType !== 'EQUIP') return false;
  const key = itemKeyOf(rec.id);
  if (BY_ITEM[key] || hammerInfo(key)) return true;
  return buffsOf(rec).some((b) => STAT_BUFFS.has(b.bbKey) || BY_BUFF[b.bbKey]);
}

// =====================================================================================================================
// grants

/**
 * Install the battle effects of item `itemId` on `u`. `lent` grants use their own buff keys (`@lend`).
 * Returns the grant `{ id, key, lent, dispose() }` or null when the item has no battle part.
 */
export function installItem(battle, u, itemId, { lent = false } = {}) {
  const rec = itemRecord(itemId);
  if (!isOp(u) || !hasBattleEffect(rec)) return null;
  const rt = runtime(battle);
  const gm = grantsOf(rt, u);
  const gid = lent ? `lend:${itemId}` : `own:${itemId}:${gm.size}`;
  const S = new Scope(battle, u, `item:${itemId}${lent ? '@lend' : ''}`);
  const key = itemKeyOf(itemId);
  const grant = { gid, id: itemId, key, lent, scope: S, timer: null, dispose: null };
  grant.dispose = () => {
    if (S.disposed) return;
    S.dispose();
    if (grant.timer) grant.timer.cancel();
    if (gm.get(gid) === grant) gm.delete(gid);
  };
  gm.set(gid, grant);
  try {
    for (const b of buffsOf(rec)) {
      if (STAT_BUFFS.has(b.bbKey)) {
        const mods = statMods(b.p);
        if (mods) S.stat(`stat:${b.bbKey}`, mods);
      } else if (BY_BUFF[b.bbKey]) BY_BUFF[b.bbKey](battle, u, b.p, S);
    }
    const h = hammerInfo(key);
    if (h) {
      const hs = hammerAcquire(battle, rt, u);
      hs.own[h.type]++;
      if (!hs.params[h.type]) hs.params[h.type] = bp(rec, h.bbKey);
      hammerRefresh(battle, rt, u, hs);
      S.onDispose(() => { hs.own[h.type] = Math.max(0, hs.own[h.type] - 1); hammerRelease(battle, rt, u, hs); });
    }
    if (BY_ITEM[key]) BY_ITEM[key](battle, u, rec, S, grant);
  } catch (e) {
    battle._handlerError?.(`item:${itemId}`, u, e);
  }
  return grant;
}

/** Battle install: every operator's equipped items. Nearly free when nobody carries equipment. */
export function install(battle) {
  let any = false;
  for (const u of battle.allyUnits) if (u.kind === 'op' && itemsOf(u).length) { any = true; break; }
  if (!any) return;
  for (const u of battle.allyUnits) {
    if (u.kind !== 'op') continue;
    for (const id of itemsOf(u)) installItem(battle, u, id);
  }
}

/**
 * 萨尔贡 × 娜仁图亚 (P1): temporarily grant `toUnit` the battle effects of every item `fromUnit` carries with
 * tier ≤ maxTier (meta-only / consume items skipped) for `duration` s. Lending the same item id to the same unit again
 * refreshes its timer (no stacking, whoever lends it). Returns the number of item effects lent (new + refreshed).
 */
export function lendItemEffects(battle, fromUnit, toUnit, { maxTier = 5, duration = 60 } = {}) {
  if (!battle || !isOp(fromUnit) || !isOp(toUnit) || fromUnit === toUnit) return 0;
  if (!toUnit.alive || toUnit.removed) return 0;
  const dur = num(duration, 60);
  if (!(dur > 0)) return 0;
  const rt = runtime(battle);
  const gm = grantsOf(rt, toUnit);
  let n = 0;
  for (const id of itemsOf(fromUnit)) {
    const rec = itemRecord(id);
    if (!rec || num(rec.tier, 99) > maxTier || !hasBattleEffect(rec)) continue;
    let g = gm.get(`lend:${id}`);
    if (!g) g = installItem(battle, toUnit, id, { lent: true });
    if (!g) continue;
    if (g.timer) g.timer.cancel();
    g.until = battle.time + dur;
    g.timer = battle.after(dur, () => g.dispose());
    n++;
  }
  if (n) fxOn(battle, 'buff', toUnit, 'item:lend', 'lend', { from: fromUnit.id, n, duration: dur });
  return n;
}

/** Active grants of a unit (tests / UI): [{ id, key, lent, until? }]. */
export function itemGrants(battle, u) {
  const g = runtime(battle).grants.get(u);
  return g ? [...g.values()].map((x) => ({ id: x.id, key: x.key, lent: x.lent, until: x.until })) : [];
}
