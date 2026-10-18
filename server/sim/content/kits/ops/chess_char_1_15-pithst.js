// server/sim/content/kits/ops/chess_char_1_15-pithst.js — 盟约·辅助干员 (char_616_pithst) kit, tier 1 (hidden).
// Registered with the tier-6 kits, whose conventions are in ../shared/tier6.js; kit contract and rules: ../README.md.

import { hasHp } from '../../../attack.js';
import { num, tbb, isElite, elementDmg } from '../shared/tier6.js';

// ------------------------------------------------------------------------------------------------------------------
// 盟约·辅助干员 chess_char_1_15 (巫役) — S1 战术咏唱·双型; 迭代元素

/** 迭代元素's elements in the order they are applied: 神经损伤 "（优先）", then 灼燃损伤, then 凋亡损伤. */
export const PITHST_ELEMENTS = Object.freeze(['neural', 'burn', 'apoptosis']);

/**
 * 迭代元素 "攻击同时附带18%攻击力的神经损伤（优先）、灼燃损伤、凋亡损伤；优先攻击未处于损伤爆发的目标":
 *   * timing = every damage she deals (PRTS 盟约·辅助干员 corrects "攻击同时" to "造成伤害时"): HP damage > 0 — a dodged
 *     or fully absorbed hit deals none; her own element fills and the bursts they cause never re-trigger it; a killing
 *     blow attaches nothing (the target is dead — no burst on the corpse);
 *   * each such damage attaches ep_damage_ratio × ATK of ALL THREE elements, 神经 first, then 灼燃, then 凋亡 (user
 *     playtest #5 #3: the kit used to pick one element "not bursting" — but a burst's 爆发冷却 locks every gauge of the
 *     unit, so it only ever filled 神经). PRTS 元素: when one unit applies several elements that would each fill their
 *     gauge, the element applied first bursts — from her alone 神经 bursts (the "（优先）"), while her 灼燃 / 凋亡 add to
 *     the gauges the team builds (余, 塑心 …). [ASSUMED: simultaneous application — the reading of the official text]
 *   * elite module RIT-X "对精英和领袖敌人造成的元素损伤提升18%" = ep_damage_ratio_boss (0.2124) vs ELITE / BOSS enemies:
 *     a talent ratio, not an "元素损伤提升" (PRTS 备注), so it changes nothing else she deals (e.g. a 灼燃维式重锤).
 * The target pick prefers enemies not in a burst (`priority: 'notBurst'`).
 */
function pithst(bb, chess, def) {
  const t0 = tbb(def, 0);
  const ratio = num(t0.ep_damage_ratio);
  const ratioBoss = num(t0.ep_damage_ratio_boss, ratio);
  return {
    skill: {
      kind: 'duration',
      mods: { aspd: num(bb.attack_speed) },
      targeting: { maxTargets: Math.max(1, Math.floor(num(bb['attack@max_target'], 1))) },
    },
    trait: { priority: 'notBurst' },
    install(battle, unit) {
      if (!(ratio > 0)) return;
      battle.on('damaged', (ctx) => {
        const t = ctx.target, d = ctx.dmg;
        // hasHp: a killing blow attaches nothing (the hook runs before battle.kill, see hasHp)
        if (ctx.source !== unit || !t || t.side !== 'enemy' || !hasHp(t) || !(ctx.amount > 0)) return;
        if (ctx.type === 'element' || ctx.type === 'elemental' || (d && d.tags && d.tags.includes('burst'))) return;
        const amount = unit.s.atk * (isElite(t) ? ratioBoss : ratio);
        for (const el of PITHST_ELEMENTS) elementDmg(battle, unit, t, el, amount, ['talent', 'pithst']);
      }, { owner: unit });
    },
  };
}

export default {
  chess_char_1_15_a: pithst,
};
