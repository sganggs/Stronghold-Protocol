// server/sim/content/kits/ops/ver-fang2.js — 历阵锐枪芬 (char_1036_fang2), 规程·序列Ⅰ.
// Kill DP is the charger profession (trait cost). S1 adds its own cost on a kill while that attack is still the skill.
// "二连击" has no times key: two hits. S2 is PASSIVE in the table but lasts 14/18 s, so it is a duration skill that
// opens on deployment (a passive cannot expire). runtime_cost and the next operator's discount are not simulated:
// this mode has no shop cost to reduce. The refund is a manual retreat only [ASSUMED], at base.cost × ratio
// [ASSUMED: the printed deploy cost; normal ratio 1 from "撤退时返还" when the module key is absent].

import { moduleBb, num, skillBbOf } from '../shared/tier1.js';
import { chargeKind, kitSkills, posDur } from '../shared/version.js';

const S1 = 'skchr_fang2_1';
const S2 = 'skchr_fang2_2';

function fang2(_bb, chess, def) {
  const mod = moduleBb(chess);
  const ratio = num(mod.withdraw_cost_recover_ratio) > 0
    ? num(mod.withdraw_cost_recover_ratio)
    : (/撤退时返还/.test(chess?.trait?.desc ?? '') ? 1 : 0);
  const s1bb = skillBbOf(chess, S1);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      id, kind: chargeKind(rec),
      attack: { atkScale: num(sbb.atk_scale, 1), hits: 2 },
    };
    if (id === S2) return {
      id, kind: 'duration', duration: posDur(rec), activateOnDeploy: true,
      mods: { atkPct: num(sbb.atk), defPct: num(sbb.def), blockCnt: num(sbb.block_cnt) },
      attack: { hitAllBlocked: true },
    };
    return { id, kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      const extra = num(s1bb.cost);
      if (extra > 0) battle.on('kill', (ctx) => {
        if (ctx.killer !== unit) return;
        const sk = unit.skill;
        if (sk?.active && sk.id === S1) battle.addDp(unit.ownerId, extra);
      }, { owner: unit });
      if (ratio > 0) battle.on('death', (ctx) => {
        if (ctx.unit !== unit || ctx.reason !== 'retreat') return;
        battle.addDp(unit.ownerId, unit.base.cost * ratio);
      }, { owner: unit });
    },
  };
}

export default { char_1036_fang2: fang2 };
