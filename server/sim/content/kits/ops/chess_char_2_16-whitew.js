// server/sim/content/kits/ops/chess_char_2_16-whitew.js — 拉普兰德 (char_140_whitew) kit, tier 2.
// Conventions of the tier-2 kits: ../shared/tier2.js; kit contract and rules: ../README.md.

import { num, talentBb, traitBb } from '../shared/tier1.js';
import { installLordArtsAddition } from '../shared/lord.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 2_16 拉普兰德 狼魂 (AUTO, attack SP): ATK +atk, arts damage, one extra target, ranged attacks no longer reduced.
  // 精神摧毁: attacks disable the target's abilities (silence) for `duration` s. Elite module (LOR-X, trait
  // atk_scale_m): attacks add atk_scale_m × ATK arts damage.
  // S1 日晷: PRTS corrects the original 抵挡 text to physical dodge. The skill buff owns its roll and lifetime.
  chess_char_2_16_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const tb = traitBb(chess);
    const trait = {};
    if (num(t.duration) > 0) trait.onHitStatus = { key: 'silence', duration: num(t.duration) };
    return {
      trait,
      install(battle, unit) { installLordArtsAddition(battle, unit, num(tb.atk_scale_m)); },
      skill: { kind: 'duration', mods: { atkPct: num(bb.atk) }, targeting: { maxTargets: 2 }, attack: { dmgType: 'arts', dmgMul: () => 1 } },
      skills: {
        skchr_whitew_1: {
          kind: 'toggle', mods: { atkPct: num(bb.atk), dodgePhys: num(bb.prob) },
        },
      },
    };
  },
};
