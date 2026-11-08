// server/sim/content/kits/ops/ver-meteo.js — 陨星 (char_219_meteo), 规程·序列Ⅰ.
// 爆破附着改装: one roll per attack, shared by its splash. atk is +60% of THAT attack's ATK, before DEF.
// S1 "爆炸范围扩大" has no radius key [ASSUMED: 2 tiles, the PRTS 散射 reading; the branch splash is 1.1].
// S2's duration key is the DEF debuff, not a timed skill. The burst is not an attack, so the talent is rolled once here.

import { enemiesInGrid, num, onHitBy, statBuff, talentBb, traitBb } from '../shared/tier1.js';
import { chargeKind, kitSkills } from '../shared/version.js';

const S1 = 'skchr_meteo_1';
const S2 = 'skchr_meteo_2';
const S1_SPLASH = 2;

function meteo(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const tb = traitBb(chess);
  const prob = num(t0.prob);
  const bonus = num(t0.atk);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      id, kind: chargeKind(rec),
      attack: { atkScale: num(sbb.atk_scale, 1), splashRadius: S1_SPLASH },
    };
    if (id === S2) return {
      id, kind: chargeKind(rec),
      onStart({ battle, unit }) {
        const primary = enemiesInGrid(battle, unit, null, { n: 1 })[0];
        if (!primary) return;
        const radius = unit.profile.splashRadius || 1.1;
        const victims = battle.foesInRadius(primary.x, primary.y, radius, true).slice();
        const proc = prob > 0 && battle.rng() < prob;
        const amount = unit.s.atk * num(sbb.atk_scale, 1) * (proc ? 1 + bonus : 1);
        for (const e of victims) {
          battle.dealDamage({ source: unit, target: e, amount, type: 'phys', isSkill: true, tags: ['skill'] });
        }
        const defCut = num(sbb.def);
        const dur = num(sbb.duration);
        if (defCut && dur > 0) {
          for (const e of victims) {
            if (e.alive) battle.addBuff(e, { key: 'meteo:def', duration: dur, mods: { defFlat: defCut }, source: unit });
          }
        }
      },
    };
    return { id, kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      if (tb.def_penetrate_fixed != null) statBuff(battle, unit, 'meteo:pierce', { defIgnoreFlat: num(tb.def_penetrate_fixed) });
      if (!(prob > 0) || !(bonus > 0)) return;
      onHitBy(battle, unit, ({ dmg }) => {
        if (!dmg?.isAttack) return;
        const id = dmg.attackId ?? 0;
        if (unit.mem.meteoLastId !== id) {
          unit.mem.meteoLastId = id;
          unit.mem.meteoProc = battle.rng() < prob;
        }
        if (unit.mem.meteoProc) dmg.amount *= 1 + bonus;
      });
    },
  };
}

export default { char_219_meteo: meteo };
