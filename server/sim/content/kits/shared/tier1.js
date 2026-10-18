// server/sim/content/kits/shared/tier1.js — the general kit helpers (formerly tier1.js's named exports; the tier-1
// and tier-2 kits use them) and the notes of the Tier 1 operator kits, which live one per file in ../ops/.
//
// export default { [baseChessId]: (bb, chess, def) => Kit } (docs/SIM.md §7.2). `bb` = skill blackboard at the chess's
// level (normal Lv4 / elite Lv7), `chess` = raw data/chess.json record (talents with their own bb, trait.bb incl. the
// elite module upgrade, module{active}), `def` = normalised def (def.skill.rangeGrid, def.skill.description …).
// Every number comes from a blackboard; the few constants below exist nowhere in data and are documented.
// Profession defaults (professions.js) are reused: kits only add what the trait text / module says beyond them.
//
// Covered (normal + elite): 1_01 隐现 1_02 角峰 1_03 惊蛰 1_04 深巡 1_05 红豆(H) 1_06 刺玫 1_07 普罗旺斯 1_08 德克萨斯
// 1_09 跃跃 1_10 古米 1_11 地灵(H) 1_12 艾丝黛尔 1_13 波登可 1_14 格雷伊 1_16 锡人(H) 1_17 深靛
// 1_18 宴 1_19 野鬃 1_20 雷蛇.  (H = hidden in the shop pool, still authored.) 1_15 盟约·辅助干员(H) is registered
// with the tier-6 kits.
// Operator loadouts (DESIGN §16): every selectable non-default skill of the 16 visible chess is authored in the kit's
// `skills: { [skillId]: SkillSpec }` map from its own SkillRecord (skillRec / skillBbOf — Lv4 normal, Lv7 elite);
// talents / traits read the resolved record, so a module choice ('none' ⇒ traitBase / talentsBase, module.active
// false) is honoured. Per-skill triggers come from data (the official 技能策略: every MANUAL 重装 skill ⇒ TAKE_DAMAGE —
// but the six of the owner's deliberate deviation, DESIGN §21.29 / tools/build-data.mjs TRIGGER_DEVIATIONS, which are
// DEFAULT —, a MANUAL skill with its own 技能范围 ⇒ SKILL_RANGE, a MANUAL skill on the basic strategy whose running attack
// range strictly contains the own one ⇒ ACTIVE_RANGE (the owner's rule, 2026-10-05 — 深巡 S2 too, on top of its
// deviation), AUTO skills keep their own rule); the few spec rules are documented at the skill (冲锋号令 AUTO ⇒ SP_FULL,
// 花香疗法 heal-type DEFAULT; the 哨戒铁卫 S2 雷蛇 反击电弧 states the DEFAULT its data carries since that deviation —
// GitHub issue #4, PR #12; 深巡 行动能力剥夺 dropped its PR #12 line in 0.2.0 and reads its data's ACTIVE_RANGE).
// Tests: test/content/kits_alt_t1.test.js.
//
// fx kinds emitted (battle.fx(kind, {x, y, …})): aoe {radius, id, skill} · zone {radius, dur, id, skill} ·
// counter {id} · crit {id} · dp {n, id} · heal {id} · taunt {id} · summon {id, token} · pull {id} · sonic {radius} ·
// shield {id} · overload {id} · takeoff {id} · sleep {id} · buff {id, kind} · reveal {id} · dodge (engine kind).

import { COLS, TICK } from '../../../constants.js';
import { absoluteRangeKeys, sortEnemyTargets } from '../../../targeting.js';
import { offsetTile } from '../../../dir.js';
import { bodyTileReach, bodyInRange } from '../../../body.js';
import { isHpLoss } from '../../../attack/helpers.js';

// =================================================================================================================
// shared helpers (named exports; content/index.js only merges the default export)

/** Finite number or `d` (blackboard values may be strings). */
export const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : d));

/** Named talent `i` (data index ≥ 0, in order) of a raw chess record. */
function talentAt(chess, i) {
  const list = (chess?.talents ?? []).filter((t) => t && t.index !== -1);
  return list[i] ?? null;
}
/** Blackboard of named talent `i` ({} when absent). */
export const talentBb = (chess, i = 0) => talentAt(chess, i)?.bb ?? {};
/** Range grid of named talent `i` (or null). */
export const talentGrid = (chess, i = 0) => talentAt(chess, i)?.rangeGrid ?? null;
/** Merged blackboard of the hidden module talents (data index −1, elite only). */
export function moduleBb(chess) {
  const o = {};
  for (const t of chess?.talents ?? []) if (t && t.index === -1 && t.bb) Object.assign(o, t.bb);
  return o;
}
/** Trait blackboard (elites include their module's trait upgrade). */
export const traitBb = (chess) => chess?.trait?.bb ?? {};
/** Elite module active (golden chess). */
export const moduleOn = (chess) => !!(chess?.module && chess.module.active);

export const up = (u) => !!u && u.alive && u.deployed;
export const posKey = (u) => Math.round(u.y) * COLS + Math.round(u.x);
/** Chebyshev tile distance between two units (a huge enemy: from the nearest tile it occupies — sim/body.js). */
export const cheb = (a, b) => (b.hitArea ? bodyTileReach(b, Math.round(a.y), Math.round(a.x))
  : a.hitArea ? bodyTileReach(a, Math.round(b.y), Math.round(b.x))
    : Math.max(Math.abs(Math.round(a.y) - Math.round(b.y)), Math.abs(Math.round(a.x) - Math.round(b.x))));
/** Normal attack hit on its primary target (no splash, no chain jump). */
export const isMainHit = (dmg) => !!dmg && dmg.isAttack && !dmg.isSplash && !(dmg.tags && dmg.tags.includes('chain'));
/**
 * `damaged` ctx that sets off a "受到攻击时" counter: a damage instance from an enemy, of any kind — its normal attack, a
 * skill hit, an area pulse (深溟巢涌者's 无途径 法术伤害). The official counters fire on ON_TAKE_DAMAGE from a source of the
 * other side, not on attacks only (ArknightsGameData buff_template_data: inverse_damage / inverse_damage[magic] — 星熊 S2,
 * 年 S2 —, bubble_s_2 / bubble_t_1 — 泡泡 —, vendla_s_2 — 刺玫 —, yu_s_1[inverse_damage] — 余 S1 —, hsgma2_s_1 /
 * hsgma2_e_003_tr_take — 斩业星熊 —, mlynar_t_2[inverse] — 玛恩纳 无动于衷; 菲莱 S2's philae_s_2 checks no source at all).
 * Never a 流失 (PRTS 作战机制 "生命流失…不会触发反伤、受击回复等受到攻击触发的时点"), an element 损伤 (its own event), 无来源 damage
 * (no source to strike back) or another counter / reflection (tags 'counter' / 'reflect': no ping-pong). Community report
 * of 2026-10-06 (item 30): it took enemy attacks only, so 深溟巢涌者's pulse never set a counter off.
 */
export const byEnemyAttack = (ctx) => {
  const s = ctx.source, d = ctx.dmg;
  if (!s || s.side !== 'enemy' || !d || d.sourceless || ctx.type === 'element' || isHpLoss(d)) return false;
  return !(Array.isArray(d.tags) && (d.tags.includes('counter') || d.tags.includes('reflect')));
};
/**
 * `damaged` ctx of a damage that removed HP and can give 受击回复 SP — the engine's rule (damage.js applyHpLoss: not a 流失
 * (`noSp`, Battle.loseHp), not an element 损伤), whatever its source: an attack, a zone, the 无来源 源石溶剂 tick.
 */
export const hurtSpDamage = (ctx) => !!ctx.dmg && !ctx.dmg.noSp && ctx.type !== 'element' && ctx.amount > 0;
/** A timed skill is running (no SP may be gained). */
export const skillBusy = (u) => !!(u.skill && u.skill.active && u.skill.isTimed);
/** Give SP unless a timed skill is running (AK: no SP gain during a skill). */
export function giveSp(u, n, reason = 'talent') {
  if (!u || !u.skill || u.skill.noSkill || skillBusy(u) || !(n > 0)) return 0;
  return u.skill.gainSp(n, reason);
}

/** 'hit' handler for damage dealt BY `unit` (pre-mitigation; mutate ctx.dmg). */
export function onHitBy(battle, unit, fn, priority = 0) {
  return battle.on('hit', (ctx) => { if (ctx.source === unit && ctx.target && ctx.target.side === 'enemy') fn(ctx); }, { owner: unit, priority });
}
/** 'hit' handler for damage dealt TO `unit`. */
export function onHitOn(battle, unit, fn, priority = 0) {
  return battle.on('hit', (ctx) => { if (ctx.target === unit) fn(ctx); }, { owner: unit, priority });
}
/** 'damaged' handler for damage dealt TO `unit`. */
export function onDamagedOn(battle, unit, fn, priority = 0) {
  return battle.on('damaged', (ctx) => { if (ctx.target === unit) fn(ctx); }, { owner: unit, priority });
}

/**
 * 庇护 (gamedata_const ba.protect "受到的物理和法术伤害降低相应比例（同名效果取最高）"; PRTS 术语释义 庇护): ONE effect per unit
 * whoever grants it — battle.applyStrongest under this key, the strongest value holds and a weaker one resumes when it
 * outlasts it. (遥's bubbles are a separate key, the client's damage_resistance[bonus] — they multiply with it.)
 */
export const PROTECT = 'protect';
/** The mods of a 庇护 value: physical and arts damage taken ×(1 − v). */
export const protectMods = (v) => ({ physTakenMul: 1 - v, artsTakenMul: 1 - v });
/** A hold that outlives one tick and lapses in the next: refreshed every tick while its condition lasts. */
export const PROTECT_TICK_HOLD = 1.5 * TICK;
/** Hold 庇护 `value` on `target` for `duration` s (the shared PROTECT effect). */
export function holdProtect(battle, target, value, duration, source = null) {
  if (value > 0) battle.applyStrongest(target, PROTECT, { duration, value, mods: protectMods, source });
}

/** Targetable enemies inside `grid` (relative to the unit; null ⇒ current range), best targets first. */
export function enemiesInGrid(battle, unit, grid, { n = 0, priority = null, canHitFly = true, groundOnly = false } = {}) {
  const keys = grid ? absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, 0) : unit.rangeKeys;
  const list = battle.enemiesInKeys(keys, unit, { canHitFly, groundOnly });
  sortEnemyTargets(battle, unit, list, priority ?? unit.profile?.priority ?? null);
  return n > 0 && list.length > n ? list.slice(0, n) : list;
}
/**
 * Deployed allies (no devices) whose tile is inside `grid` relative to `unit` (null ⇒ current range) — never a 孤立 unit
 * (炎佑: Battle.allySelectable), as Battle.alliesInGrid.
 */
export function alliesInGridOf(battle, unit, grid = null) {
  const set = grid ? new Set(absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, 0)) : (unit.rangeKeySet || new Set(unit.rangeKeys || []));
  return battle.allyUnits.filter((a) => a.alive && a.deployed && !a.hidden && a.kind !== 'device' && set.has(a.tileR * COLS + a.tileC) && battle.allySelectable(a, unit));
}
/** Any targetable enemy in the unit's current range. */
export const enemyInRange = (battle, unit) => battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true }).length > 0;

/** Run `fn` once per battle for `key` (battle-wide handlers shared by several units). */
const ONCE = new WeakMap();
export function once(battle, key, fn) {
  let s = ONCE.get(battle);
  if (!s) ONCE.set(battle, (s = new Set()));
  if (s.has(key)) return;
  s.add(key);
  fn();
}

/** Permanent talent stat buff (survives death / redeploy). */
export function statBuff(battle, unit, key, mods) {
  const m = {};
  for (const [k, v] of Object.entries(mods)) if (Number.isFinite(v) && v !== 0 && !(k.endsWith('Mul') && v === 1)) m[k] = v;
  if (Object.keys(m).length) battle.addBuff(unit, { key, mods: m, persist: true, allowDead: true, tags: ['talent'] });
}

/** Keep buff `key` on `unit` exactly while cond() holds (checked every tick). `mods` may be a function. */
export function toggleBuff(battle, unit, key, cond, mods, extra = {}) {
  const check = () => {
    const want = up(unit) && !!cond();
    const has = unit.findBuff(key);
    if (want && !has) battle.addBuff(unit, { key, mods: typeof mods === 'function' ? mods() : mods, tags: ['talent'], ...extra });
    else if (!want && has) battle.removeBuff(unit, key);
  };
  battle.on('tick', check, { owner: unit });
  battle.on('battleStart', check, { owner: unit });
  battle.on('deploy', (ctx) => { if (ctx.unit === unit && battle.started) check(); }, { owner: unit });
}

/**
 * Aura while `unit` is on the field: every `interval` s, allies passing `select(a)` get buff `key` for slightly longer
 * than the interval. Several sources of the same aura never stack: the strongest `value` wins.
 */
export function installAura(battle, unit, { key, select, mods, value = 0, interval = 0.5 }) {
  battle.every(interval, () => {
    if (!up(unit)) return;
    for (const a of battle.alliesFor(unit)) {
      if (!select(a)) continue;
      const cur = a.findBuff(key);
      if (cur && cur.source !== unit && (cur.data?.v ?? 0) > value && cur.timeLeft > 0.05) continue;
      battle.addBuff(a, { key, duration: interval + 0.1, mods: typeof mods === 'function' ? mods(a) : mods, source: unit, data: { v: value }, tags: ['aura'] });
    }
  }, { owner: unit, immediate: true });
}

/** Extra natural SP recovery (+perSec) while cond() holds (hooks the per-tick 'time' SP gain). */
export function spTimeBonus(battle, unit, perSec, cond) {
  if (!(perSec > 0)) return;
  battle.on('spGain', (ctx) => {
    if (ctx.unit === unit && ctx.reason === 'time' && cond()) ctx.amount += perSec * battle.dt;
  }, { owner: unit });
}

/** Module "攻击范围内敌人的隐匿效果失效": stealthed enemies inside the current range are revealed. */
export function installReveal(battle, unit, interval = 0.2) {
  battle.every(interval, () => {
    if (!up(unit) || !unit.rangeKeySet) return;
    for (const e of battle.enemies) {
      if (!e.alive || e.hidden || !e.s.flags.stealth || !bodyInRange(e, unit.rangeKeySet)) continue;
      const was = !!e.s.flags.reveal;
      if (battle.applyStatus(e, 'reveal', { duration: interval + 0.1, source: unit }) && !was) battle.fx('reveal', { x: e.x, y: e.y, id: e.id });
    }
  }, { owner: unit });
}

/**
 * Lingering area (spores, alchemy units): `onPulse(battle)` runs immediately and then every `interval` s,
 * `round(duration / interval)` times in total. Not owned by the caster: it keeps working after the caster falls.
 */
export function makeZone(battle, caster, { x, y, radius, duration, interval = 1, skill, onPulse, onEnd }) {
  const total = Math.max(1, Math.round(duration / interval));
  let n = 0;
  battle.fx('zone', { x, y, radius, dur: duration, id: caster.id, skill });
  return battle.every(interval, (b, sc) => {
    onPulse(b);
    if (++n >= total) { sc.cancel(); if (onEnd) onEnd(b); }
  }, { immediate: true });
}

/**
 * A tile a summon may take: inside the field and not reserved (Battle.isReservedTile: nobody on it, no knocked-out
 * operator lying there, not the home tile of a board unit that has not deployed yet / waits to redeploy — a summon
 * there would stop that operator from redeploying until it leaves).
 */
export function summonTileFree(battle, r, c) {
  return Number.isInteger(r) && Number.isInteger(c) && battle.grid.inRect(r, c) && !battle.isReservedTile(r, c);
}

/** First free tile around `unit` (Chebyshev ring 1, front first — offsets rotated by its direction) where `ok(r, c)` holds. */
export function freeTileAround(battle, unit, ok) {
  const order = [[0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0], [0, -1], [1, -1], [-1, -1]];
  for (const [dr, dc] of order) {
    const [r, c] = offsetTile(unit.tileR, unit.tileC, dr, dc, unit.dir);
    if (!summonTileFree(battle, r, c)) continue;
    if (ok(r, c)) return [r, c];
  }
  return null;
}

/** Skill spec kind for an instant skill with (possible) charges. */
export const instantKind = (def) => ((def?.skill?.maxCharges ?? 1) > 1 ? 'charges' : 'instant');

/**
 * SkillRecord `skillId` of a raw chess record (DESIGN §16 operator loadouts): the selected skill (`chess.skill`) or one of
 * `chess.skills[]` (every skill of the chess at its level — bb, duration, rangeGrid, trigger). Null when absent.
 * A kit's `skills` map builds every entry from its own record, so each spec is right whichever skill is selected.
 */
export function skillRec(chess, skillId) {
  if (chess?.skill && (chess.skill.skillId ?? chess.skill.id) === skillId) return chess.skill;
  return (chess?.skills ?? []).find((s) => s && s.skillId === skillId) ?? null;
}
/** Blackboard of skill `skillId` of a raw chess record ({} when absent). */
export const skillBbOf = (chess, skillId) => skillRec(chess, skillId)?.bb ?? {};

/**
 * Skill blackboard `base_attack_time` → engine batPct of this chess's base attack time. The value is a FLAT change of
 * the base attack time in seconds (AK attribute ADDITION: 送葬人 −0.5 on 2.3 s "少量缩短(-0.5)" ⇒ 1.8 s, 红豆 +0.5
 * "略微增大(+0.5)" — the same convention as the tier-4 / tier-5 kits), except a positive value described as a shortening, which is
 * the new interval ratio (深靛 0.7 "攻击间隔略微缩短" ⇒ ×0.7). The convention is per skill in AK: skills PRTS lists as
 * a ratio (雷蛇 反击电弧 "+70%", 古米 食粮烹制 "+130%", 深靛 灯塔守卫者 "-80%") use batPct = value directly, not this.
 */
export function batMod(v, chess = null, desc = '') {
  const x = num(v, 0);
  if (!x) return 0;
  if (x > 0 && x < 1 && /间隔[^，。；]*缩短/.test(desc)) return x - 1;
  const bat = num(chess?.stats?.bat, 1) || 1;
  return Math.max(-0.9, x / bat);
}
/** "周围8格" = Chebyshev ring 1 ⇒ Euclidean radius covering the 8 neighbours. */
export const RING1 = 1.5;
