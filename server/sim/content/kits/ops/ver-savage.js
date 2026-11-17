// server/sim/content/kits/ops/ver-savage.js — 暴行 (char_230_savage), 第一期 (DESIGN §35.22.9).
// 同时攻击阻挡的所有敌人 is the centurion profile. The elite 110% against a blocked enemy is the trait blackboard.

import { enemiesInGrid, num, onHitBy, talentBb, traitBb, toggleBuff } from '../shared/tier1.js';
import { gridOf, highlandNear, kitSkills } from '../shared/version.js';

const S1 = 'skchr_savage_1';
const S2 = 'skchr_savage_2';

function savage(_bb, chess, def) {
  const tb = traitBb(chess);
  const t0 = talentBb(chess, 0);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return { kind: 'instant', attack: { atkScale: num(sbb.atk_scale, 1) } };
    if (id === S2) return {
      kind: 'instant',
      onStart({ battle, unit }) {
        const g = gridOf(rec);
        const n = num(sbb.max_target, 4);
        const scale = num(sbb.atk_scale, 1);
        for (const e of enemiesInGrid(battle, unit, g, { n })) {
          battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'phys', isSkill: true, tags: ['skill'] });
        }
      },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      const scale = num(tb.atk_scale);
      if (tb.atk_scale != null && scale !== 1) onHitBy(battle, unit, ({ target, dmg }) => {
        if (dmg.isAttack && target?.blockedBy === unit) dmg.mul *= scale;
      });
      const atk = num(t0.atk), defv = num(t0.def), cnt = num(t0.cnt, 2);
      if (atk || defv) toggleBuff(battle, unit, 'savage:valley', () => highlandNear(battle, unit) >= cnt, { atkPct: atk, defPct: defv });
    },
  };
}

export default { char_230_savage: savage };
