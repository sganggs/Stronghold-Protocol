// server/sim/content/kits/ops/ver-ethan.js — 伊桑 (char_355_ethan), 第一期 (DESIGN §35.22.9).
// Stalker dodge is the profession. The module slow is the hidden talent, the same aura as 狮蝎.
// `frozen_duration` binds (束缚); the key name is the table's. The poison is a 1 s arts tick of the blackboard damage
// for the blackboard duration. [ASSUMED] that tick, where it differs from 棘刺's precomputed poison.

import { isMainHit, moduleBb, num, onHitBy, skillBbOf, talentBb } from '../shared/tier1.js';
import { installRangeSlow, kitSkills } from '../shared/version.js';

const S1 = 'skchr_ethan_1';
const S2 = 'skchr_ethan_2';

function ethan(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const { skills, skill, sid } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return { kind: 'passive' };
    if (id === S2) return { kind: 'duration', duration: rec?.duration, mods: { atkPct: num(sbb.atk) } };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      installRangeSlow(battle, unit, moduleBb(chess).move_speed);
      if (sid === S1) {
        const dmgN = num(skillBbOf(chess, S1)['attack@poison_damage']);
        const dur = num(skillBbOf(chess, S1)['attack@duration']);
        if (dmgN > 0 && dur > 0) onHitBy(battle, unit, ({ target, dmg }) => {
          if (!dmg.isAttack || !isMainHit(dmg) || !target?.alive) return;
          battle.addBuff(target, {
            key: `ethan:poison:${unit.id}`, duration: dur, interval: 1, refresh: 'replace', source: unit,
            onTick({ battle: b, unit: tgt }) {
              b.dealDamage(unit, tgt, { amount: dmgN, type: 'arts', isSkill: true, tags: ['poison'] });
            },
          });
        });
      }
      const prob = num(t0.prob), bindDur = num(t0.frozen_duration);
      if (prob > 0 && bindDur > 0) onHitBy(battle, unit, ({ target, dmg }) => {
        if (!dmg.isAttack || !isMainHit(dmg) || !target?.alive) return;
        let p = prob;
        if (unit.skill?.active && unit.skill.id === S2) p *= num(skillBbOf(chess, S2).talent_scale, 1);
        if (battle.rng.chance(p)) battle.applyStatus(target, 'bind', { duration: bindDur, source: unit });
      });
    },
  };
}

export default { char_355_ethan: ethan };
