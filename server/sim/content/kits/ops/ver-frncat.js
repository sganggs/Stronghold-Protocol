// server/sim/content/kits/ops/ver-frncat.js — 慕斯 (char_185_frncat), 规程·序列Ⅰ.

import { num, talentBb, traitBb, toggleBuff, up } from '../shared/tier1.js';
import { kitSkills, posDur } from '../shared/version.js';

const S1 = 'skchr_frncat_1';
const S2 = 'skchr_frncat_2';

function frncat(_bb, chess, def) {
  const tb = traitBb(chess);
  const t0 = talentBb(chess, 0);
  const prob = num(t0.prob);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      kind: 'instant',
      mods: { atkPct: num(sbb.atk) },
      attack: {
        onHit({ battle, unit, target }) {
          const deb = num(sbb['frncat_s_1[debuff].atk']);
          const dur = num(sbb['frncat_s_1[debuff].duration']);
          if (!target?.alive || !deb || !(dur > 0)) return;
          battle.addBuff(target, {
            key: 'frncat:s1', duration: dur, mods: { atkPct: deb }, refresh: 'replace', source: unit, tags: ['skill'],
          });
        },
      },
    };
    if (id === S2) return {
      kind: 'duration', duration: posDur(rec),
      mods: { atkPct: num(sbb.atk), defPct: num(sbb.def) },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    // 连击: the next attack is two hits. Skills do not set `hits`, so this covers them too.
    trait: prob > 0 ? { hitsFn: (battle) => (battle.rng.chance(prob) ? 2 : 1) } : undefined,
    install(battle, unit) {
      // AFT-X 「未阻挡敌人时攻击速度+N」. traitMods refuses 「未阻挡」, so the kit holds it.
      const aspd = num(tb.attack_speed);
      if (aspd > 0) toggleBuff(battle, unit, 'frncat:open', () => up(unit) && unit.blocking.length === 0, { aspd });
    },
  };
}

export default { char_185_frncat: frncat };
