// server/sim/content/kits/ops/ver-glassb.js — 真理 (char_195_glassb), 规程·序列Ⅰ.
// 停顿 is the slower profession. base_attack_time is a flat second change (攻击间隔较大幅度缩短), not a raw batPct.
// S2 keeps the data ACTIVE_RANGE trigger and widens to the skill grid for three full-ATK targets.

import { batMod, num, statBuff, talentBb } from '../shared/tier1.js';
import { descOf, gridOf, kitSkills, posDur } from '../shared/version.js';

const S1 = 'skchr_glassb_1';
const S2 = 'skchr_glassb_2';

function glassb(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      id, kind: 'duration', duration: posDur(rec),
      mods: { batPct: batMod(sbb.base_attack_time, chess, descOf(rec)) },
    };
    if (id === S2) return {
      id, kind: 'duration', duration: posDur(rec),
      mods: { atkPct: num(sbb.atk) },
      targeting: { maxTargets: num(sbb['attack@max_target'], 1), rangeGrid: gridOf(rec) },
    };
    return { id, kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      statBuff(battle, unit, 'glassb:talent', { defPct: num(t0.def), aspd: num(t0.attack_speed) });
    },
  };
}

export default { char_195_glassb: glassb };
