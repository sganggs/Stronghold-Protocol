// server/sim/snapshot.js — compact serialization for clients (DESIGN §8.2).
//
// b.snap  = { fieldId, t, units: [[id, x, y, hp, maxHp, sp, spMax, flags, anim]], dp, killed, total, resolved }
//   (hp of a countdown summon — unit.countdown, content/tokens.js startCountdown — is maxHp × the share of its life left)
// UnitInfo = { id, kind, side, ownerId, defId, name, tier, golden, spine, avatar, x, y, facing, dir, maxHp, motion?, boss?, uid?,
//   form?, skillIndex?, ammoSkill?, moduleId?, items?, standInFor?, diy?, skin? }  (ammoSkill = an ally whose skill is an ammo
//   magazine: the HP bar shows its rounds as cells, b.snap `ammo`; standInFor = the replaced operator's charId of a 补位
//   stand-in; diy = a 自选 piece's pick { charId, skillIndex, uniEquipId } — defId is its slot, spine / avatar the operator's;
//   skin = the owning player's chosen skinId, docs/SKINS.md — the client draws that appearance instead of the operator's,
//   falling back to the default model when it is not installed;
//   form = the unit's current model form — an enemy's, content/enemies/helpers.js setForm:
//   掠海漂移体 'crawl', 暴鸰 'bombed', 转译基底·α's forms …; a 傀儡师 fighting as its 替身 'doll', professions.js — a view built
//   after the change, a field opened mid-battle, draws it: render/units.js FORMS)
//   dir = 'UP'|'RIGHT'|'DOWN'|'LEFT' (allies: the deploy direction, sim/dir.js); facing = its horizontal sign (±1).
//   items = an ally operator's equipped item ids (absent without any).
// flags bits & anim codes come from shared/constants.js (UF / ANIM); an enemy's stealth bit = its 隐匿 is on (not while it
// is blocked or revealed, nor in the seconds after a block before it hides again — targeting.js enemyStealthed), an
// ally's = 隐匿 / 迷彩 whatever it blocks.

import { UF, ANIM } from '../../shared/constants.js';
import { DIE_ANIM_TIME, ATTACK_ANIM_TIME, DEPLOY_ANIM_TIME } from './constants.js';
import { enemyStealthed } from './targeting.js';

const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;

/** Static per-unit info sent on spawn / in m.field. */
export function unitInfo(u) {
  const d = u.def || {};
  return {
    id: u.id,
    kind: u.kind,
    side: u.side,
    ownerId: u.ownerId ?? null,
    defId: u.defId,
    name: u.name,
    tier: d.tier ?? (d.rank === 'BOSS' ? 3 : d.rank === 'ELITE' ? 2 : 1),
    golden: !!d.golden,
    // The unit's OWN attack interval in game seconds (units.js `s.interval`: bat × batPct × 100 / aspd, i.e. with the buffs
    // this record carries). The renderer stretches the attack clip over it (render/attackRate.js): without it a view started
    // from the operator's base-record guess and swung in slow motion until two attacks had been measured.
    atkInterval: Number.isFinite(u.s?.interval) && u.s.interval > 0 ? r2(u.s.interval) : undefined,
    spine: d.spine ?? d.charId ?? u.defId,
    // 皮肤 (docs/SKINS.md): the owning player's chosen skinId. `undefined` (not null) on purpose — JSON.stringify drops
    // it, so an install with no skins produces the exact same wire format as before and the §8.2 contract holds; the key
    // only appears where a skin is actually in play.
    skin: u.skin ?? undefined,
    avatar: d.avatar ?? d.charId ?? u.defId,
    ...(d.voice ? { voice: d.voice } : {}),
    x: r2(u.x),
    y: r2(u.y),
    facing: u.facing ?? 1,
    dir: u.dir ?? 'RIGHT',
    maxHp: Math.max(1, Math.round(u.s.maxHp)),
    motion: u.motion === 'FLY' ? 'FLY' : undefined,
    boss: u.isBoss ? true : undefined,
    // the unit's current model form (an enemy's content/enemies/helpers.js setForm, a 傀儡师's 替身 — render/units.js FORMS): a
    // view built mid-battle (fieldMeta — a watched teammate's field, 联防 observers, a reconnect) starts on that clip set
    form: typeof u.form === 'string' ? u.form : undefined,
    uid: u.uid ?? undefined,
    // DESIGN §16: the equipped skill's index (the renderer / audio pick that skill's Spine clip and sound)
    skillIndex: u.side === 'ally' && Number.isInteger(d.skill?.index) ? d.skill.index : undefined,
    // an ally whose skill is an ammo magazine: the renderer shows it as the segmented bar under the HP bar (b.snap `ammo`) and
    // draws no sustained skill aura for it — known from the unit's first appearance, before any snapshot or skill event
    ammoSkill: u.side === 'ally' && u.skill?.kind === 'ammo' ? true : undefined,
    // DESIGN §16: an elite ally's equipped module (uniEquipId | 'none'; display only — a teammate's unit in a shared
    // field shows its owner's module in the detail card)
    moduleId: u.side === 'ally' && d.golden && typeof d.loadout?.moduleId === 'string' ? d.loadout.moduleId : undefined,
    // an ally operator's equipped item ids (display: a 变形同构体 wearer counts for the bond it grants — the bond popup's
    // member list and the detail card's bond chips of a teammate's unit)
    items: u.side === 'ally' && u.kind === 'op' && Array.isArray(u.items) && u.items.length ? [...u.items] : undefined,
    // 补位: the replaced operator's charId when the chess fights as its stand-in (spine / avatar are the stand-in's; the
    // detail card composes the stand-in record, shared/standIn.js standInRecord)
    standInFor: u.side === 'ally' && u.kind === 'op' && typeof d.standInFor === 'string' ? d.standInFor : undefined,
    // 自选: the pick of a DIY slot's piece (the detail card composes its record, shared/diy.js diyRecord)
    diy: u.side === 'ally' && u.kind === 'op' && d.diyFor && d.loadout?.diy ? { ...d.loadout.diy } : undefined,
    // 0.2.2: an ally operator's potential below 6 and its 练度 tier (a teammate's unit shows ITS owner's numbers; absent:
    // full potential, no 练度 — a stand-in, a prototype 自选 pick)
    potential: u.side === 'ally' && u.kind === 'op' && d.loadout?.potentialIsDefault === false ? d.loadout.potential : undefined,
    cultivate: u.side === 'ally' && u.kind === 'op' && Number.isInteger(u.cultivate) ? u.cultivate : undefined,
  };
}

/** Status flag bitmask. */
export function flagsOf(u) {
  const f = u.s.flags;
  let bits = 0;
  if (u.side === 'enemy' ? !!u.blockedBy : u.blocking.length > 0) bits |= UF.BLOCKED;
  if (f.stun && !f.freeze && !f.sleep) bits |= UF.STUNNED;
  if (f.freeze) bits |= UF.FROZEN;
  // 隐匿 or 迷彩 (buffs.js camou), shown the see-through way. An ally keeps it while blocking (targeting.js
  // canTargetAlly); an enemy's 隐匿 is off while it is blocked or revealed and until it hides again after a block (PRTS
  // 作战机制 §隐匿 "在被阻挡时开关会被关掉从而失去隐匿，阻挡状态解除后3s开关重新被开启"; targeting.js enemyStealthed): a
  // blocked 逐火 余烬 is drawn solid while the team beats it, and for 3 s after it slips away
  if (u.side === 'enemy' ? (f.stealth && enemyStealthed(u)) || f.camou : f.stealth || f.camou) bits |= UF.STEALTH;
  if (u.skill && u.skill.active && u.skill.kind !== 'passive') bits |= UF.SKILL;
  if (u.s.shield > 0 || u.buffs.some((b) => b.shieldHits > 0)) bits |= UF.SHIELD;
  if (f.invulnerable) bits |= UF.INVULN;
  if (f.cold) bits |= UF.COLD;
  if (f.sleep) bits |= UF.SLEEP;
  if (u.motion === 'FLY') bits |= UF.FLYING;
  return bits;
}

/** Animation code. */
export function animOf(u, t) {
  if (!u.alive) return ANIM.DIE;
  if (u.s.flags.stun) return ANIM.STUN;
  if (t - u.deployedAt < DEPLOY_ANIM_TIME && u.side === 'ally') return ANIM.DEPLOY;
  if (t < (u.skillAnimUntil ?? -1)) return ANIM.SKILL;
  if (t - u.lastAttackAt < ATTACK_ANIM_TIME) return u.skill && u.skill.active && u.skill.kind !== 'passive' ? ANIM.SKILL : ANIM.ATTACK;
  if (u.side === 'enemy' && u.moving && !u.blockedBy) return ANIM.MOVE;
  return ANIM.IDLE;
}

/** Snapshot tuple for one unit. */
export function unitTuple(u, t) {
  const sk = u.skill;
  let spMax = sk && !sk.noSkill ? sk.spCost : 0;
  let sp = sk && !sk.noSkill ? sk.sp : 0;
  if (sk && sk.active && sk.isTimed) {
    // show remaining duration/ammo as a draining bar — ammo out of the activation's real total (base + bullets added:
    // 拉特兰, 逃犯引渡手续, refills; community report #35), so every bullet shortens it
    if (sk.kind === 'ammo') sp = spMax * (sk.ammoLeft / Math.max(1, sk.ammoMax || sk.ammo || 0, sk.ammoLeft));
    else if (Number.isFinite(sk.timeLeft) && sk.duration > 0) {
      if (spMax === 0) spMax = sk.duration;
      sp = spMax * (sk.timeLeft / sk.duration);
    }
  }
  // hp is rounded up (a living unit never shows 0) but never above the rounded max HP. A countdown summon (医疗探机, 海嗣 …:
  // content/tokens.js startCountdown) shows the share of its life left instead — its bar runs down like a timer and it
  // leaves when it is empty (community report of 2026-10-06; its HP itself never moves: 无敌, 禁疗)
  const maxHp = Math.max(1, Math.round(u.s.maxHp));
  const cd = u.alive ? u.countdown : null;
  const left = cd ? Math.max(0, Math.min(1, (cd.until - t) / Math.max(1e-9, cd.until - cd.from))) : 1;
  const hp = u.alive ? Math.min(Math.max(1, Math.ceil(cd ? maxHp * left : u.hp)), maxHp) : 0;
  return [u.id, r2(u.x), r2(u.y), hp, maxHp, r1(sp), spMax, flagsOf(u), animOf(u, t)];
}

/**
 * The optional HUD readouts of b.snap (events.js snapshot(); each only for a living, deployed, visible unit and only
 * when it has one). They ride beside the 9-field tuples — the tuple, and the SP fraction the ammo skill still puts in
 * it, stay as they are.
 *
 * `ammoView(u)` = `[rounds left, rounds in the magazine]` of a running ammo skill (whole numbers; the magazine is the
 * activation's real total — extra bullets and refills included — that unitTuple's SP fraction runs on): the segmented
 * yellow bar under the HP bar (隐现's S2 holds 14 rounds, skill_table skchr_inside_2 `attack@trigger_time`).
 */
export function ammoView(u) {
  const sk = u.skill;
  if (u.side !== 'ally' || !sk || !sk.active || sk.kind !== 'ammo') return null;
  const left = Math.max(0, Math.ceil(sk.ammoLeft - 1e-9));
  return [left, Math.max(1, Math.ceil((sk.ammoMax || sk.ammo || 0) - 1e-9), left)];
}

/** 琳琅诗怀雅's skill purse: zero is a balance; no purse is null. Display only. */
export function coinView(u) {
  const n = u.mem?.coins, max = u.skill?.bb?.sp;
  if (u.side !== 'ally' || !Number.isSafeInteger(n) || n < 0 || !Number.isSafeInteger(max) || max < 1) return null;
  return [Math.min(n, max), max];
}

/**
 * `mysticView(u)` = `[stored attack energies, the trait's maximum]` of a 秘术师 (professions.js installMystic keeps the
 * count in `trait.stored` — the trait's storeEnergy adds one when the attack finds no target, releaseEnergy empties the
 * lot into the next one — and the cap is `profile.storeMax`: the trait's 最多3个, 4 for 深靛's MSC-X module, TUNE
 * mystic): the number under the HP bar. Zero is a count. Kits that keep a store of their own (维伊's 转置能量, 黑键's
 * elite energies) replace `storeEnergy` and never set `trait.stored`: no row. Display only.
 */
export function mysticView(u) {
  const n = u.trait?.stored, max = u.profile?.storeMax;
  if (u.side !== 'ally' || !Number.isSafeInteger(n) || n < 0 || !Number.isSafeInteger(max) || max < 1) return null;
  return [Math.min(n, max), max];
}

/**
 * `wolfView(u)` = `[狼影 left, the talent's maximum]` of 伺夜's 狼群 pack (content/tokens.js wolfPack and the managed kit
 * chess_char_3_19-vigil.js keep the count in `mem.shadows` and the maximum in `mem.wolfCapacity`): the pips under the HP
 * bar. A pack in its 战术点形态 is not alive and shows nothing.
 */
export function wolfView(u) {
  const cap = u.mem?.wolfCapacity, n = u.mem?.shadows;
  if (u.side !== 'ally' || !(cap >= 1) || !Number.isFinite(n)) return null;
  const max = Math.round(cap);
  return [Math.max(0, Math.min(max, Math.round(n))), max];
}

/**
 * `negView(u)` = the share (0.01–1) of its cap that a unit's negative-HP pool holds, null without a pool: 斩业星熊's 我执
 * (kits/ops/op-hsgma2.js sets `unit.negFill`, the pool read when the snapshot is taken) — the red bar over the drained HP
 * bar. The pool itself, and the 1-HP floor she stands on, are the sim's and are not touched.
 */
export function negView(u) {
  if (typeof u.negFill !== 'function') return null;
  const v = u.negFill();
  return v > 0 ? Math.min(1, Math.max(0.01, r2(v))) : null;
}

/**
 * `layerView(u)` = the hit-negating 护盾 layers a unit holds (the sum of its buffs' shieldHits — 泥岩's 沃土予身), null
 * without any. Display only: render/vfx/talentfx.js shows the official effect of that many layers (mudrok_buff_03 / 02 /
 * 01_start).
 */
export function layerView(u) {
  let n = 0;
  for (const b of u.buffs) if (b.shieldHits > 0) n += b.shieldHits;
  return n >= 1 ? Math.min(999, Math.floor(n)) : null;
}

/**
 * `chargeView(u)` = `[charges stored, the skill's maximum]` of an ally whose skill stores charges (maxCharges > 1, 卡涅利安):
 * the 技能充能 the official sand armour shows (render/vfx/skillfx.js, the `[eff_cond]` buffs). Display only.
 */
export function chargeView(u) {
  const sk = u.skill;
  if (u.side !== 'ally' || !sk || sk.noSkill || !(sk.maxCharges > 1)) return null;
  return [Math.max(0, Math.min(sk.maxCharges, Math.floor(sk.charges || 0))), sk.maxCharges];
}

/** Units included in a snapshot: deployed & visible, plus recently dead ones (DIE animation). */
export function snapshotUnits(units, t) {
  const out = [];
  for (const u of units) {
    if (u.hidden) continue;
    if (u.alive && u.deployed) out.push(unitTuple(u, t));
    else if (!u.alive && t - u.deathAt < DIE_ANIM_TIME && u.deathAt > -Infinity) out.push(unitTuple(u, t));
  }
  return out;
}
