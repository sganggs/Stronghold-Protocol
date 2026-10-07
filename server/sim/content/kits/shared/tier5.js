// server/sim/content/kits/shared/tier5.js — helpers and notes of the hand-authored kits for every tier-5 chess (DESIGN
// §7, docs/SIM.md §7.2; formerly tier5.js — the kits live one per file in ../ops/).
//
// export default { [baseChessId]: (bb, chess, def) => Kit }. `bb` = skill blackboard at the chess's level (normal Lv4 /
// elite Lv7), `chess` = data/chess.json record (talents with their own bb — elite records already carry the module talent
// upgrades — trait.bb incl. the module trait upgrade, stats, tokens), `def` = normalised def (skill.rangeGrid, …).
// Every number comes from those blackboards; the few constants below exist only in the skill TEXT (no blackboard key).
//
// Conventions shared by the kits of this file:
// - `base_attack_time` in skill blackboards is an absolute delta in seconds (AK attribute ADDITION: 烛煌 1.6 s − 1.3 s,
//   号角 2.8 s − 1.2 s, 白面鸮 2.85 s − 1.8 s, 寒檀 2.9 s − 2.4 s); it is converted into `batPct` of the chess's base BAT.
// - 元素伤害 (elemental HP damage, not a gauge) is the engine DamageInfo type 'elemental' (no DEF/RES/dodge,
//   × elementalTakenMul = 元素脆弱), with `element` set for the client colour.
// - Mechanics missing from the chess text follow the PRTS 备注 of the base operator (verified 2026-09-28): 号角 S3 overload
//   is the second half of the 24 s duration; 圣约送葬人's extra attack consumes no ammo; 夕 S1 splash 1.7; 烛煌 revive stun
//   radius 1.7, S3 splash 1.7 and its refilled ammo capped at the skill's ammo; 寒檀 icicles splash 1.5 and cycle left
//   row → right row → own row; 失重 = weight −1 level; 魔王 motes orbit at 1.15 (30°/s, hit radius 0.4); 铃兰 T2 is an
//   aura (sluggish enemies in range are 脆弱 while sluggish); 缇缇's chain sleep picks the highest-aggro enemy within
//   1.5; 乌尔比安 lands on the anchor tile > the tile beyond > his own tile; 引星棘刺 throws at the farthest forward tile
//   when no enemy is in range; 夕 T2 summons only on a deployable target tile.
// - Non-stacking auras refresh a short buff with a fixed key every 0.25 s while the source is on the field.
//   SP auras ("同类效果取最高") share the buff key `aura:spRecovery` (mods.spRecoveryFlat): the highest value wins.
// - Skills whose auto-cast needs a condition the engine rules can't express use the NEVER trigger (CUSTOM_RANGE with an
//   empty grid) plus their own activation — 塞雷娅 S2 (`autoCast`: an injured ally in the heal area of the skill; her
//   initial range is her own tile), 华法琳 (heal target below half HP, checked right before the heal). 塞雷娅 S1 (自动触发)
//   uses the engine's DEFAULT rule with `allies` / `hpAtMost` (about to attack + an ally of the skill area at ≤ half HP:
//   the heal replaces that attack). Every other
//   kit keeps the data rule (tools/build-data.mjs resolveTrigger, the official 技能策略: DEFAULT = about to attack + an
//   enemy in the INITIAL range; SKILL_RANGE for a MANUAL skill's own 技能范围; ACTIVE_RANGE for a MANUAL skill on the basic
//   strategy or the SEARCH row (玛恩纳 S2, 安洁莉娜 S3) whose running attack range strictly contains the own one (the
//   owner's rule, 2026-10-05); the class rows —
//   重装 TAKE_DAMAGE … — for
//   every MANUAL skill; AUTO skills never take a class row).
// - fx kinds emitted (battle.fx(kind, {x, y, id, …})): 'aoe' {r, skill}, 'healAoe' {r}, 'summon' {token}, 'anchor'
//   {fromX, fromY, r}, 'teleport', 'zone' {r, duration}, 'iceSpike' {r}, 'extraAttack', 'downed', 'revive' {r},
//   'overload', 'ember', 'bloodBattle', 'reborn', 'candle', 'wake' {scale}, 'mote', 'hpShare', 'crit',
//   'meltdown', 'soul', 'sleepGuard', 'weightless'; engine kinds used: 'dodge'.

import { bodyInKeys } from '../../../body.js';
import { absoluteRangeKeys, sortEnemyTargets } from '../../../targeting.js';

// ---- text-only constants (the official blackboards carry no key for these) --------------------------------------
/** 华法琳 S1 "只当目标生命值不满一半时才会触发"; 塞雷娅 S1 "血量小于等于一半"; 山 module "生命值高于50%时". */
const HALF_HP = 0.5;
/**
 * Abyssal Hunters (【深海猎人】 = character_table groupId `abyssal`; data/chess.json has no groupId, the charIds come from
 * docs/research/03-operators.json): 幽灵鲨, 斯卡蒂, 歌蕾蒂娅, 乌尔比安, 归溟幽灵鲨. 浊心斯卡蒂 (char_1012_skadi2) has groupId
 * null in the official data — she is NOT an Abyssal Hunter for these talents.
 */
const ABYSSAL = new Set(['char_143_ghost', 'char_263_skadi', 'char_474_glady', 'char_4145_ulpia', 'char_1023_ghost2']);
/** Never auto-fires (CUSTOM_RANGE with an empty trigger grid): the kit activates the skill itself. */
const NEVER = Object.freeze({ rule: 'CUSTOM_RANGE', grid: Object.freeze([]) });
const AURA_IV = 0.25;
const AURA_DUR = 0.5;
// alternate skills (loadouts) — text-only numbers
/** "周围" (8-neighbourhood) as a radius: 隐德来希 S2 血镰, 缇缇 S2 sleep ward, 乌尔比安 S1 anchor, 引星棘刺 S3 area. */
const RING1 = 1.5;

// ---- helpers ------------------------------------------------------------------------------------------------------
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const on = (u) => !!u && u.alive && u.deployed && !u.removed;
/** In the unit's current range: an ally by its tile, an enemy by its body (a huge one's every tile — sim/body.js). */
const inRange = (unit, x) => !!unit.rangeKeySet && bodyInKeys(x, unit.rangeKeySet);
const talent = (chess, i) => (chess?.talents || []).find((t) => t && t.index === i)?.bb ?? {};
const talentRec = (chess, i) => (chess?.talents || []).find((t) => t && t.index === i) ?? null;
const traitBb = (chess) => chess?.trait?.bb ?? {};
const skillGrid = (chess, def) => def?.skill?.rangeGrid ?? chess?.skill?.rangeGrid ?? null;
const maxCharges = (chess, def) => num(def?.skill?.maxCharges, num(chess?.skill?.maxChargeTime, 1));
/** Blackboard `base_attack_time` (seconds) → batPct of this chess's base attack time. */
const batPct = (sec, chess) => { const b = num(chess?.stats?.bat, 1) || 1; const v = num(sec) / b; return v ? Math.max(-0.9, v) : 0; };
/** Drop zero / non-finite entries (a zero mod is noise in the buff list). */
const mods = (m) => { const o = {}; for (const k of Object.keys(m)) { const v = m[k]; if (typeof v === 'number' && Number.isFinite(v) && v !== 0) o[k] = v; } return o; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const nationOf = (u) => u?.def?.raw?.nationId ?? null;
const inFaction = (u, bond, nations) => !!u?.def && ((u.def.bonds || []).includes(bond) || nations.includes(nationOf(u)));
const isAbyssal = (u) => u?.def?.raw?.groupId === 'abyssal' || ABYSSAL.has(u?.def?.charId);
const isOp = (u) => u && u.kind === 'op';

// ---- operator loadouts (DESIGN §16) -------------------------------------------------------------------------------
// A kit function is resolved per SELECTED skill: `bb` / `chess.skill` / `def.skill` are the selected skill's. The default
// skill keeps its `skill` spec; every other selectable skill is a `skills[skillId]` entry. Kit `install` / talents run
// under every skill, so default-skill machinery in them is guarded by the selected skill id (`sid`).
/** Id of the selected skill of a chess record / def. */
const selectedId = (chess, def) => chess?.skill?.skillId ?? def?.skill?.id ?? null;
/** `skills` map whose entries are built only when read (each spec is a function of the SELECTED skill's bb). */
function lazySkills(builders) {
  const o = {};
  for (const [id, build] of Object.entries(builders)) Object.defineProperty(o, id, { enumerable: true, get: build });
  return o;
}
/** Spec kind of an instant skill (charges when the selected skill can charge). */
const instantKind = (chess, def) => (maxCharges(chess, def) > 1 ? 'charges' : 'instant');
/** Skill-range targeting override of the selected skill (undefined without a skill range). */
const skillRange = (chess, def, extra = null) => {
  const g = skillGrid(chess, def);
  return g || extra ? { ...(g ? { rangeGrid: g } : {}), ...(extra || {}) } : undefined;
};
/** "攻击范围内存在元素损伤爆发的敌人时，技力自然恢复速度+X/秒" (modules PRI-Y). */
function burstSpUp(battle, unit, key, sp) {
  if (!(sp > 0)) return;
  whileOn(battle, unit, AURA_IV, () => {
    if (battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true }).some((e) => e.s.flags.burstLock)) battle.addBuff(unit, { key, duration: AURA_DUR, mods: { spRecoveryFlat: sp } });
  });
}

/** First living deployed ally with the same operator (charId) — used to keep same-name talents from stacking. */
function leaderOf(battle, unit) {
  const cid = unit.def?.charId;
  for (const a of battle.allyUnits) if (on(a) && a.def?.charId === cid) return a;
  return null;
}

/** Elemental HP damage (元素伤害): engine type 'elemental' (× elementalTakenMul in the pipeline, never trueTakenMul). */
function elementHit(battle, src, tgt, amount, tag, element = null) {
  if (!tgt || !tgt.alive || !(amount > 0)) return 0;
  return battle.dealDamage(src, tgt, { amount, type: 'elemental', element, canDodge: false, tags: ['element', tag] });
}

/** Periodic check while the unit is on the field. */
function whileOn(battle, unit, sec, fn) {
  battle.every(sec, () => { if (on(unit)) fn(); }, { owner: unit });
}

/** "同类效果取最高" SP-recovery aura: refresh `aura:spRecovery` on matching allies unless a higher one is present. */
function spAura(battle, unit, value, filter) {
  if (!(value > 0)) return;
  whileOn(battle, unit, AURA_IV, () => {
    for (const a of battle.alliesFor(unit)) {
      if (!filter(a)) continue;
      const cur = a.findBuff('aura:spRecovery');
      if (cur && num(cur.mods?.spRecoveryFlat) > value + 1e-9) continue;
      battle.addBuff(a, { key: 'aura:spRecovery', duration: AURA_DUR, mods: { spRecoveryFlat: value } });
    }
  });
}

/** Module PRI-X (本源术师): damage vs enemies in an element burst ×damage_scale. */
function burstDamageUp(battle, unit, mul) {
  if (!(mul > 1)) return;
  battle.on('hit', (c) => {
    if (c.source !== unit || !c.target || c.target.side !== 'enemy' || c.dmg.type === 'element') return;
    if (c.target.s.flags.burstLock) c.dmg.mul *= mul;
  }, { owner: unit });
}

/**
 * Modules PHY-X / GUA-X "治疗生命值低于50%的友方单位时治疗量提升15%": heals on allies below hp_ratio ×heal_scale. The client's
 * module buff picks its comparison: `atOrBelow` for heal_scale_up[hpratio][LE] (华法琳's PHY-X), strictly below for 塞雷娅's
 * GUA-X (set_heal_scale_by_hpratio: LT) and 录武官's PHY-X (reckpr_e_002_tr: LT).
 */
function lowHpHealUp(battle, unit, tb, { atOrBelow = false } = {}) {
  const mul = num(tb.heal_scale), thr = num(tb.hp_ratio);
  if (!(mul > 1) || !(thr > 0)) return;
  const low = atOrBelow ? (t) => t.hpRatio <= thr + 1e-9 : (t) => t.hpRatio < thr;
  battle.on('heal', (c) => {
    if (c.source !== unit || c.opts?.regen || !c.target || c.target.side !== 'ally') return;
    if (low(c.target)) c.amount *= mul;
  }, { owner: unit });
}

/**
 * Modules "攻击范围扩大" (夕 SPC-X, 白面鸮 RIN-X): the range becomes the SELECTED module's own grid — the data's
 * range-only talent change (talentIndex −1), e.g. SPC-X = the 3×3 caster range + ONE centre tile [0,3] — like the tier-4 kits'
 * 莫斯提马 / 莱恩哈特 / 白面鸮 (integration review: a flat forward +1 added a whole column, 3 tiles, and widened the skill
 * ranges too). It replaces the unit's own range, so the DEFAULT trigger's initial range follows; skills with their own
 * range keep it. Without such a grid in the data: one extra forward tile [ASSUMED].
 */
function moduleRangeUp(battle, unit, chess) {
  if (!chess?.isGolden || !/攻击范围扩大/.test(String(chess?.trait?.moduleDesc ?? ''))) return;
  const m = chess.module;
  const rec = m && m.active && m.id ? (chess.modules || []).find((x) => x && x.uniEquipId === m.id) : null;
  const g = (rec?.talentChanges || []).find((t) => t && t.talentIndex === -1 && Array.isArray(t.rangeGrid) && t.rangeGrid.length)?.rangeGrid;
  if (g) {
    unit.rangeGrid = g.map((p) => [p[0], p[1]]);
    battle.refreshRange(unit);
    return;
  }
  // a permanent (persist, never-expiring) rangeExtend: the engine counts it in the initial range of the DEFAULT skill
  // trigger ("敌人进入初始攻击范围") as well
  battle.addBuff(unit, { key: 't5:moduleRange', mods: { rangeExtend: 1 }, persist: true, allowDead: true });
}

/** Permanent (talent) stat buff that survives death/redeploy. */
function permBuff(battle, unit, key, m) {
  const mm = mods(m);
  if (Object.keys(mm).length) battle.addBuff(unit, { key, mods: mm, persist: true, allowDead: true });
}

/** Enemies inside an absolute-key grid of `grid` offsets around `unit` (best targets first). */
function enemiesInGrid(battle, unit, grid, n = 0, { ignoreStealth = false } = {}) {
  const keys = absoluteRangeKeys(grid || unit.rangeGrid || [[0, 0]], unit.tileR, unit.tileC, unit.dir, 0);
  let list;
  if (ignoreStealth) {
    const set = new Set(keys);
    list = battle.enemies.filter((e) => e.alive && !e.hidden && e.deployed && !e.s.flags.untargetable && bodyInKeys(e, set));
  } else list = battle.enemiesInKeys(keys, unit, { canHitFly: true });
  sortEnemyTargets(battle, unit, list, null);
  return n > 0 && list.length > n ? list.slice(0, n) : list;
}

export {
  HALF_HP, NEVER, AURA_IV, AURA_DUR, RING1, num, on, inRange, talent, talentRec, traitBb, skillGrid, maxCharges, batPct,
  mods, dist, inFaction, isAbyssal, isOp, selectedId, lazySkills, instantKind, skillRange, burstSpUp,
  leaderOf, elementHit, whileOn, spAura, burstDamageUp, lowHpHealUp, moduleRangeUp, permBuff, enemiesInGrid,
};
