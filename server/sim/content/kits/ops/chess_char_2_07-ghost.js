// server/sim/content/kits/ops/chess_char_2_07-ghost.js — 幽灵鲨 (char_143_ghost) kit, tier 2.
// Conventions of the tier-2 kits: ../shared/tier2.js; kit contract and rules: ../README.md.

import { num, talentBb, traitBb, onHitBy, statBuff } from '../shared/tier1.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 2_07 幽灵鲨 肉斩骨断: ATK +atk and HP never drops below 1 while active; stunned `stun` s afterwards.
  // Talent: max HP +max_hp (elite: + hp_recovery_per_sec_by_max_hp_ratio × max HP per s).
  // Elite module (CEN-X, trait atk_scale): vs enemies it blocks ATK ×atk_scale.
  // S1 攻击力强化·γ型 (alt): ATK +atk for its duration.
  chess_char_2_07_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const tb = traitBb(chess);
    // 肉斩骨断 stays reachable when it is no longer the chess default (规程 selects 攻击力强化·γ型).
    const cleave = {
      kind: 'duration', mods: { atkPct: num(bb.atk) },
      onStart({ battle, unit }) {
        if (unit.mem.undying) battle.off(unit.mem.undying);
        unit.mem.undying = battle.on('fatal', (c) => { if (c.unit === unit && unit.skill?.active) c.prevented = true; }, { owner: unit, priority: 10 });
      },
      onEnd({ battle, unit, reason }) {
        if (unit.mem.undying) battle.off(unit.mem.undying);
        unit.mem.undying = null;
        if (reason !== 'death' && unit.alive && num(bb.stun) > 0) battle.applyStatus(unit, 'stun', { duration: num(bb.stun), source: unit });
      },
    };
    return {
      skill: cleave,
      skills: { skchr_ghost_2: cleave, 'skcom_atk_up[3]': { kind: 'duration', mods: { atkPct: num(bb.atk) } } },
      talents: [{ install(battle, unit) {
        statBuff(battle, unit, 'talent:ghost', { hpPct: num(t.max_hp), hpRegenRatio: num(t.hp_recovery_per_sec_by_max_hp_ratio) });
        if (num(tb.atk_scale, 1) !== 1) onHitBy(battle, unit, ({ target, dmg }) => { if (dmg.isAttack && target.blockedBy) dmg.amount *= num(tb.atk_scale, 1); });
      } }],
    };
  },
};
