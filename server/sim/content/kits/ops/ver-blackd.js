// server/sim/content/kits/ops/ver-blackd.js — 讯使 (char_198_blackd), 第一期 (DESIGN §35.22.9).
// Shop chess ids of that version are today's other operators, so the kit is keyed by charId.

import { num, talentBb, traitBb, toggleBuff } from '../shared/tier1.js';
import { beginDp, endDp, kitSkills, tickDp } from '../shared/version.js';

const S1 = 'skcom_charge_cost[2]';
const S2 = 'skchr_blackd_2';

function blackd(_bb, chess, def) {
  const tb = traitBb(chess);
  const t0 = talentBb(chess, 0);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      // [ASSUMED] the built trigger is DEFAULT; an AUTO「立即获得部署费用」fires when SP is full (德克萨斯 冲锋号令).
      kind: 'instant', trigger: 'SP_FULL',
      onStart({ battle, unit }) { battle.addDp(unit.ownerId, num(sbb.cost), unit); },
    };
    if (id === S2) return {
      kind: 'duration', duration: rec?.duration,
      mods: { defPct: num(sbb['blackd_s_2[period].def']) },
      onStart({ battle, unit }) {
        battle.addDp(unit.ownerId, num(sbb['blackd_s_2[once].cost']), unit);
        beginDp(unit, 'blackdDp', sbb['blackd_s_2[period].interval'], sbb['blackd_s_2[period].trig_cnt'], sbb['blackd_s_2[period].cost']);
      },
      onTick({ battle, unit, dt }) { tickDp(battle, unit, 'blackdDp', dt); },
      onEnd({ battle, unit, reason }) { endDp(battle, unit, 'blackdDp', reason); },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      const atk = num(tb.atk), defv = num(tb.def);
      if (atk || defv) toggleBuff(battle, unit, 'blackd:block', () => unit.blocking.length > 0, { atkPct: atk, defPct: defv });
      const defPct = num(t0.def);
      if (defPct) toggleBuff(battle, unit, 'blackd:patrol', () => unit.blocking.length >= num(t0.cnt, 2), { defPct });
    },
  };
}

export default { char_198_blackd: blackd };
