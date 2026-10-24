// server/sim/content/kits/ops/chess_char_2_01-excu.js — 送葬人 (char_279_excu) kit, tier 2.
// Conventions of the tier-2 kits: ../shared/tier2.js; kit contract and rules: ../README.md.

import { num, talentBb, statBuff, batMod } from '../shared/tier1.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 2_01 送葬人 最终旅程: normal attacks become double hits, base attack time +base_attack_time s (−0.5 on 2.3 s
  // "少量缩短"). 终结改装: ignore def_penetrate_fixed DEF. (Trait: every enemy in range, ×atk_scale on its front row —
  // reaperrange profile.)
  //
  // S1 铳口收束 (alt): ATK +atk; "攻击时对攻击范围内的所有敌人应用特性加成" — every enemy in range takes the trait's
  // front-row multiplier (profile frontScale: trait atk_scale 1.5, elite module 1.6, elite without module 1.5).
  chess_char_2_01_a: (bb, chess) => ({
    trait: { visualStyle: 'shotgunWave' }, // cosmetic opt-in from the supplied Executor reference
    skill: { kind: 'duration', mods: { batPct: batMod(bb.base_attack_time, chess) }, attack: { hits: 2 } },
    skills: {
      skchr_excu_1: { kind: 'duration', mods: { atkPct: num(bb.atk) }, attack: { dmgMul: (battle, u) => num(u.profile?.frontScale, 1.5) } },
    },
    talents: [{ install(battle, unit) { statBuff(battle, unit, 'talent:excu', { defIgnoreFlat: num(talentBb(chess, 0).def_penetrate_fixed) }); } }],
  }),
};
