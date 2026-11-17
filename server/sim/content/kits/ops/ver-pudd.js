// server/sim/content/kits/ops/ver-pudd.js — 布丁 (char_4004_pudd), 第一期 (DESIGN §35.22.9).
// The resting chain (count, falloff, sluggish) is the chain profile. S2 replaces it for the skill's attacks.

import { num, statBuff, talentBb } from '../shared/tier1.js';
import { chainShape, kitSkills } from '../shared/version.js';

const S1 = 'skcom_magic_rage[2]';
const S2 = 'skchr_pudd_2';

function pudd(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return { kind: 'duration', duration: rec?.duration, mods: { aspd: num(sbb.attack_speed) } };
    if (id === S2) return {
      kind: 'duration', duration: rec?.duration,
      mods: { atkPct: num(sbb.atk) },
      attack: { chain: chainShape(chess, sbb['attack@max_target']) },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) { statBuff(battle, unit, 'pudd:wave', { atkPct: num(t0.atk) }); },
  };
}

export default { char_4004_pudd: pudd };
