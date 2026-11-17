// server/sim/content/kits/ops/ver-ceylon.js — 锡兰 (char_348_ceylon), 第一期 (DESIGN §35.22.9).
// The far-heal penalty stays: the elite trait text still says 治疗量变为80% and the blackboard keeps heal_scale 0.8
// (the healer profile). The kit adds taunt and 抵抗 only when those keys are on the trait.

import { alliesInGridOf, num, statBuff, talentBb, traitBb, up } from '../shared/tier1.js';
import { waterOn } from './op-chen2.js';
import { chargeKind, fieldHasDeepWater, kitSkills, resistValue } from '../shared/version.js';

const S1 = 'skchr_ceylon_1';
const S2 = 'skchr_ceylon_2';

function ceylon(_bb, chess, def) {
  const tb = traitBb(chess);
  const t0 = talentBb(chess, 0);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      kind: chargeKind(rec),
      attack: { healScale: num(sbb.heal_scale, 1), heal: { mode: 'single', farMul: 1 } },
    };
    if (id === S2) return {
      kind: 'duration', duration: rec?.duration,
      mods: { atkPct: num(sbb.atk) },
      targeting: { maxTargets: num(sbb['attack@max_target'], 2) },
      onTick({ battle, unit }) {
        const r = resistValue(sbb.one_minus_status_resistance);
        if (!(r > 0)) return;
        for (const a of alliesInGridOf(battle, unit)) battle.applyStatus(a, 'resist', { value: r, duration: 0.6, source: unit });
      },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      if (tb.taunt_level != null) statBuff(battle, unit, 'ceylon:taunt', { taunt: num(tb.taunt_level) });
      const rv = resistValue(tb.one_minus_status_resistance);
      if (rv > 0) {
        const apply = () => { if (up(unit)) battle.applyStatus(unit, 'resist', { value: rv, source: unit }); };
        battle.on('deploy', (c) => { if (c.unit === unit) apply(); }, { owner: unit });
        apply();
      }
      const common = num(t0['ceylon_t_1[common].atk']);
      const water = num(t0['celyon_t_1[map].atk']);
      if (common || water) battle.every(0.5, () => {
        if (!up(unit)) return;
        const wet = waterOn(battle) || fieldHasDeepWater(battle);
        const pct = common + (wet ? water : 0);
        if (pct) battle.addBuff(unit, { key: 'ceylon:water', mods: { atkPct: pct }, duration: 0.7, refresh: 'replace' });
      }, { owner: unit, immediate: true });
    },
  };
}

export default { char_348_ceylon: ceylon };
