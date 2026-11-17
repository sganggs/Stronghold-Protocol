// Element gauges, bursts, cooldowns and element recovery (DESIGN §5.5).
//
// Element damage ('element' type + element, 元素损伤) fills a gauge instead of HP (1000; enemy leaders 2000):
//   gain = amount × dmg.mul × target elemTakenMul (元素损伤倍率: "受到的元素损伤提高/降低…") × max(5 %, 1 − 损伤抵抗/100)
// with 损伤抵抗 = the target's data `epResistance` (EP_RESISTANCE, a percentage: PRTS 元素 "受到的元素损伤 = 损伤值 ×
// (1 − 损伤抵抗 × 0.01)，后续可应用元素损伤倍率"; the 5 % floor of DMG_e — PRTS 游戏数据基础 "目标受到元素损伤时也可以使用
// 该公式计算，只需要将 D 值改为目标的损伤抵抗即可"; in data/enemies.json only 转译基底·α has 10, every other enemy — 海嗣
// included — 0; newer event enemies of the full enemy_database go up to 15, operators are all 0). No
// source-side multiplier touches it (a kit scales its own amount), no gauge ever decays (EP_RECOVERY_PER_SEC 0), and
// 元素脆弱 (`elementalTakenMul`, "受到的元素伤害提升") never scales it — only 元素伤害.
// A full gauge bursts with the official term-table effects (constants.js ELEMENT), which differ by the side hit:
//   operators (enemy damage):  burn 1200 arts + RES −20 10 s · neural stun 10 s, then 1000 true · apoptosis 15 s: 阻回
//     (noSp) + 静默 (no skill activation), −1 SP/s, 100 arts/s · erosion permanent DEF −100, then 800 phys (10 s).
//   enemies (operator damage, "·我方"): burn 7000 元素伤害 + RES −20 (10 s) · neural 3 麻痹, then 6000 元素伤害 (10 s) ·
//     apoptosis 15 s: 50 % weaken recovering over the burst + 800 元素伤害/s · erosion 5000 元素伤害 + permanent DEF −120 (8 s).
//   necrosis (legacy spare gauge): 12 s of 100 true dmg/s and ATK −20 %.
//   The HP damage of a burst is ordinary 无来源 damage, not undodgeable (v0.3.1's canDodge false): on an operator a phys /
//   arts dodge or an injury-dodge effect cancels burn's 1200, erosion's 800 and apoptosis's 100/s while the status and
//   cooldown stay (native ep_break_* NoSourceDamage, `_ignoreCancelReasonMask` NONE; DESIGN §35.32). necrosis, with no
//   official template of its own, follows the same rule (its true damage is outside the phys / arts dodge stats).
// Burst damage is 无来源 (PRTS 元素 "元素爆发通常造成无来源的伤害"; PRTS 伤害分类: 无来源 = "无法被追溯伤害来源", yet "无来源
// 伤害的击杀也能追溯击杀来源"): DamageInfo `sourceless` — the damage-dealt multipliers and penetration of the unit that
// filled the gauge do not apply (the target's own RES cuts do, "可享受法抗减少效果"), and the `hit` / `damaged` / `fatal`
// hooks get `source: null`, so no content keyed on the attacker (ATK ×1.5 vs 海怪, 精准狙击镜, bond / module 伤害提升,
// reflect, "受到来自…的伤害") touches it; the hook ctx's `credit` and the kill / stats keep the filler ("元素爆发本身来源于
// 造成“爆条”的元素损伤的来源").
// 爆发冷却 (PRTS 元素, "阻回" after a burst): for the burst's duration (the `<el>Burst` buff) NO element of the unit can
// fill or be recovered (reduceElement) — the bursting gauge shows full — and when it ends EVERY gauge of the unit
// resets to 0. A burst that is still resolving (its `elementBurst` hook runs before the `<el>Burst` lock exists) already
// counts as locked (`unit.burstPending[el]`), so a hook that spreads an element back (淤困 parasite hosts next to each
// other) cannot re-burst the unit recursively. The unit's shown gauge (the fullest, "当前损伤元素") and its cooldown
// travel in b.snap `elem` (elementView).
// 元素伤害 (HP damage of an element) is the DamageInfo type 'elemental' (+ optional `element` for display): no DEF/RES
// (元素抗性 instead), no probability dodge (dodgePhys / dodgeArts are phys / arts only), but an injury dodge that
// names every HP type (圣约送葬人 S2) can cancel it, × source dmgDealtMul × target elementalTakenMul (元素脆弱) only —
// the target's dmgTakenMul (脆弱 and the other "受到的伤害±" effects) does not scale it: ba.fragile is "受到的物理、法术、真实伤害提升"
// (gamedata_const termDescriptionDict), 元素伤害 has its own ba.elementfragile [ASSUMED for the damage_resistance-type
// cuts, which share the multiplier]. An element fill on a target with no HP left (hasHp: a lethal hit's `damaged` hook
// runs before battle.kill, while the target is still `alive` at 0 HP) is refused, so nothing bursts on a corpse.
// Element healing (reduceElement) lowers every element type by the amount, each on its own (PRTS 菲莱 备注: "清除元素损伤"
// = "一次等同于自身最大元素值的全类型元素损伤治疗"). Sleeping units (沉睡: 无敌) take no damage unless the attacker's profile
// has `hitSleep` or the damage carries `ignoreSleep`.

import { MIN_DAMAGE_RATIO, ELEMENT, ELEMENT_ORDER, PALSY_MAX } from '../constants.js';
import { hasHp, sleepBlocks, liftoffEvades } from './helpers.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Are `target`'s element gauges locked (爆发冷却, see header): a burst's `<el>Burst` lock is up (any element — the lock
 * holds every gauge of the unit), or a burst of the unit is resolving right now. The element argument of older callers
 * is ignored.
 */
export function burstLocked(target) {
  const p = target.burstPending;
  if (p) for (const k in p) if (p[k]) return true;
  return !!target.s.flags.burstLock;
}

/** The burst lock buff (爆发冷却) running on `u`, or null. */
function burstLockOf(u) {
  let best = null;
  for (const b of u.buffs) if (b.flags && b.flags.burstLock && (!best || b.timeLeft > best.timeLeft)) best = b;
  return best;
}

/**
 * The element gauge a unit shows (b.snap `elem`, render/units.js): null when every gauge is empty and no burst
 * cooldown runs. Official display (PRTS 元素): one icon, the "当前损伤元素" — the fullest gauge, i.e. the least 元素值
 * left (ties: the lower official element id, constants.js ELEMENT_ORDER) — with a white bar of its remaining 元素值;
 * during a 爆发冷却 the bursting element, refilling over the cooldown. Returns `[el, fill, cooldownEnd (game s),
 * cooldown (s)]`; the two cooldown numbers are 0 outside a cooldown. `fill` has 2 decimals and is rounded DOWN
 * (0.01–0.99 while no burst runs, 1 during one), so the remainder shown (1 − fill) is never less than what is left —
 * except that a first chip of less than 1 % (under 10 元素值 of 1000) already shows as 1 % taken — and the bar only
 * runs out when the gauge bursts (user playtest #6). `now` = the battle time.
 */
export function elementView(u, now) {
  const e = u.elem;
  if (!e) return null;
  const lock = u.s.flags.burstLock ? burstLockOf(u) : null;
  if (lock) {
    const el = lock.key.endsWith('Burst') ? lock.key.slice(0, -5) : 'burn';
    const dur = Number.isFinite(lock.duration) && lock.duration > 0 ? lock.duration : 0;
    const left = Number.isFinite(lock.timeLeft) ? Math.max(0, lock.timeLeft) : 0;
    return [el in e ? el : 'burn', 1, Math.round((now + left) * 100) / 100, Math.round(dur * 100) / 100];
  }
  let best = null, bv = 0;
  for (const k of ELEMENT_ORDER) { const v = e[k]; if (v > bv) { bv = v; best = k; } }
  if (!best) return null;
  // rounded down (1e-9: 290 / 1000 × 100 is 28.999…), kept inside 1–99 %: a sliver shows, an empty bar = a burst
  const fill = Math.min(0.99, Math.max(0.01, Math.floor((bv / u.gaugeMax) * 100 + 1e-9) / 100));
  return [best, fill, 0, 0];
}

/**
 * The share of an element hit that reaches `target`'s gauge (header): its 元素损伤倍率 (`elemTakenMul`) × max(5 %,
 * 1 − 损伤抵抗 / 100) — the factor applyElement uses after the `elementHit` hook, exported for content that previews a
 * gauge gain.
 */
export function elementIntake(target) {
  const res = Number(target && target.def ? target.def.epResistance : 0) || 0;
  return target.s.elemTakenMul * Math.max(MIN_DAMAGE_RATIO, 1 - clamp01(res / 100));
}

/** Element gauge accumulation + burst. Fires `elementHit` { source, target, dmg } first (mutable amount/mul, cancel). */
export function applyElement(battle, ctx) {
  const { source, credit, target, dmg } = ctx;
  const el = dmg.element;
  if (!el || !(el in target.elem)) return 0;
  if (!hasHp(target)) return 0; // a killing blow's rider: the target is dead, nothing fills or bursts (header)
  if (target.s.flags.invulnerable || sleepBlocks(target, source, dmg)) return 0;
  if (liftoffEvades(target, source, dmg)) return 0;
  if (burstLocked(target, el)) return 0;
  if (battle._hooks.elementHit) {
    battle.emit('elementHit', { source, credit, target, dmg });
    if (dmg.cancel || !target.alive || !target.deployed || burstLocked(target, el)) return 0;
    if (dmg.type !== 'element') return battle.dealDamage(source, target, dmg, { credit }); // a handler converted it
  }
  const max = target.gaugeMax;
  // 元素损伤倍率 × max(5 %, 1 − 损伤抵抗 %) — official EP_RESISTANCE = data epResistance
  let amt = dmg.amount * dmg.mul * elementIntake(target);
  if (!(amt > 0) || !Number.isFinite(amt)) return 0;
  const before = target.elem[el];
  target.elem[el] = Math.min(max, before + amt);
  battle._ev(['dmg', target.id, Math.round(amt), el]);
  if (credit) credit.stats.elem = (credit.stats.elem ?? 0) + amt;
  if (battle._hooks.modifierApplied) battle.emit('modifierApplied', { source, credit, target, dmg,
    kind: 'elementDamage', amount: amt, gaugeAdded: target.elem[el] - before });
  if (battle._hooks.damaged) battle.emit('damaged', { source, credit, target, amount: amt, type: 'element', dmg });
  if (battle._hooks.elementApplied) battle.emit('elementApplied', { source, credit, target, dmg, amount: amt });
  if (target.elem[el] >= max && target.alive) elementBurst(battle, source, target, el, credit);
  return amt;
}

/**
 * A burst (see header): side-aware official effects; the `<el>Burst` buff is the 爆发冷却 that locks every gauge of the
 * unit for its duration. The unit is marked `burstPending[el]` while the burst resolves (hook, lock, hits), so nothing
 * re-bursts it in the meantime.
 */
export function elementBurst(battle, source, target, el, credit = source) {
  if (!ELEMENT[el] || !target.alive || burstLocked(target)) return;
  const pending = target.burstPending || (target.burstPending = {});
  pending[el] = true;
  try { resolveBurst(battle, source, target, el, credit); } finally { pending[el] = false; }
}

function resolveBurst(battle, source, target, el, credit) {
  const cfg = ELEMENT[el];
  target.elem[el] = target.gaugeMax;
  // the cooldown's end restores every element of the unit ("随后单位所有种类的元素值恢复至最大值")
  const reset = () => { for (const k of ELEMENT_ORDER) if (k in target.elem) target.elem[k] = 0; };
  battle.fx('burst', { x: target.x, y: target.y, id: target.id, element: el });
  if (battle._hooks.elementBurst) battle.emit('elementBurst', { source, credit, target, element: el });
  if (!target.alive) { reset(); return; }
  const tags = ['burst', el];
  // Burst damage is source-less; its statistics/kill credit is inherited independently.
  // Native ep_break_* uses ordinary NoSourceDamage without a cancellation override (resource snapshot 9bf2396:
  // ep_break_fire_char MAGICAL, ep_break_water_char PHYSICAL, ep_break_anger_char PURE, the dark char's
  // periodic_magic_damage MAGICAL BUFF — all `_ignoreCancelReasonMask` NONE), so a dodge may cancel the HP damage while
  // the burst status and cooldown stay. v0.3.1 made it undodgeable (DESIGN §35.32).
  const hit = (amount, type, extra = {}) => battle.dealDamage({ source: null, credit, target, amount, type, element: el, tags, ...extra });
  const lock = (duration, extra = {}) => {
    if (!(duration > 0)) { reset(); return null; }
    return battle.addBuff(target, { key: `${el}Burst`, duration, visible: true, onExpire: reset, onRemove: reset, ...extra, flags: { burstLock: true, ...(extra.flags || {}) } });
  };
  if (el === 'necrosis') {
    lock(cfg.duration, {
      mods: { atkMul: 1 - cfg.atkDownPct }, interval: 1,
      onTick: () => battle.dealDamage({ source: null, credit, target, amount: cfg.dps, type: 'true', attackType: 'BUFF', tags: ['burst', 'necrosis'] }),
    });
    return;
  }
  const enemy = target.isEnemyEntity;
  const c = enemy ? cfg.enemy : cfg.ally;
  if (el === 'burn') {
    lock(c.duration, { mods: { resFlat: -c.resDown } });
    if (enemy) hit(c.elemDamage, 'elemental'); else hit(c.damage, c.type);
  } else if (el === 'neural') {
    // PRTS 元素: the status first ("立刻获得等时长的眩晕" / "获得3层麻痹"), then the hit
    lock(c.duration);
    if (enemy) {
      battle.applyStatus(target, 'palsy', { value: c.palsy, source });
      if (target.alive) hit(c.elemDamage, 'elemental');
    } else {
      battle.applyStatus(target, 'stun', { duration: c.stun, source, force: true });
      if (target.alive) hit(c.damage, c.type);
    }
  } else if (el === 'apoptosis') {
    if (enemy) {
      // 50 % 虚弱, 800 元素伤害 per second; each second the 虚弱 drops to 50 % × 剩余时间 ÷ 总持续时间 (PRTS 元素)
      lock(c.duration, {
        mods: { atkMul: 1 - c.weaken }, interval: 1,
        onTick: ({ buff }) => {
          buff.mods = { atkMul: 1 - c.weaken * Math.max(0, buff.timeLeft) / c.duration };
          target.markDirty();
          hit(c.elemDps, 'elemental', { noSp: true, attackType: 'BUFF', tags: [...tags, 'dot'] });
        },
      });
    } else {
      // 15 s of 阻回 ("停止并阻止任意形式的技力回复": noSp) + 静默 (no skill activation), −1 SP and 100 arts damage per second.
      // The loss is of the official 技力 (Skill.spTotal: the stored charges × cost + the SP towards the next) — PRTS 技能
      // 可充能 "当持有者的技力流失时，充能次数也会实时降低": taking it from the partial bar alone left a full skill every
      // charge it had (a one-charge skill stayed ready through the burst; PR #262). setSpTotal rebuilds the charges
      // silently (no spGain) and leaves a running timed skill alone, whose SP was spent at its cast.
      lock(c.duration, {
        flags: { silence: true, noSp: true }, interval: 1,
        onTick: () => {
          const sk = target.skill;
          if (sk && !sk.noSkill && sk.kind !== 'passive' && !(sk.active && sk.isTimed) && sk.spTotal > 0) sk.setSpTotal(Math.max(0, sk.spTotal - c.spLossPerSec));
          hit(c.dps, c.dpsType, { noSp: true, attackType: 'BUFF', tags: [...tags, 'dot'] });
        },
      });
    }
  } else if (el === 'erosion') {
    // the permanent DEF cut lands first, then the hit; both sides then have their cooldown (operators 10 s, enemies 8 s)
    lock(c.duration);
    battle.addBuff(target, { key: 'erosionDown', refresh: 'stack', stacks: 1, maxStacks: 1e6, mods: { defFlat: -c.defDown }, visible: true });
    if (enemy) hit(c.elemDamage, 'elemental'); else hit(c.damage, c.type);
  }
}

/** Add `n` 麻痹 stacks (at most PALSY_MAX). */
export function palsyBuff(n) {
  const stacks = Math.max(1, Math.min(PALSY_MAX, Math.floor(Number.isFinite(n) ? n : 1)));
  return { key: 'palsy', refresh: 'stack', stacks, maxStacks: PALSY_MAX, visible: true, status: 'palsy' };
}

/**
 * Element healing (e.g. wandermedic "回复元素损伤"): lowers element `el`, or — without `el` — EVERY element type, each
 * by `amount` on its own (PRTS 菲莱 备注: clearing = "一次等同于自身最大元素值（通常为1000）的全类型元素损伤治疗").
 * Returns the total removed. Nothing recovers during a burst cooldown ("爆发冷却状态下，单位所有类型的元素值均无法损失、
 * 无法被其他手段回复").
 */
export function healElement(target, amount, el = null) {
  let removed = 0;
  if (!target || !target.elem || burstLocked(target) || !(amount > 0)) return 0;
  const els = el ? [el] : Object.keys(target.elem);
  for (const k of els) {
    const take = Math.min(target.elem[k] || 0, amount);
    if (take > 0) { target.elem[k] -= take; removed += take; }
  }
  return removed;
}
