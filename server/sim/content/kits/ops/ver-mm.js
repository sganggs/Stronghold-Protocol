// server/sim/content/kits/ops/ver-mm.js — 梅 (char_133_mm), 第一期 (DESIGN §35.22.9).
// 优先攻击空中单位 and the elite fly damage scale are the fastshot profile (professions.js). The kit does not set them again.

import { batMod, num, statBuff, talentBb } from '../shared/tier1.js';
import { descOf, kitSkills } from '../shared/version.js';

const S1 = 'skchr_mm_1';
const S2 = 'skchr_mm_2';

function mm(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      kind: 'instant',
      attack: {
        atkScale: num(sbb.atk_scale, 1),
        onHit({ battle, unit, target }) {
          const d = num(sbb.sluggish);
          if (target?.alive && d > 0) battle.applyStatus(target, 'sluggish', { duration: d, source: unit });
        },
      },
    };
    if (id === S2) return {
      kind: 'duration', duration: rec?.duration,
      mods: { atkPct: num(sbb.atk), batPct: batMod(sbb.base_attack_time, chess, descOf(rec)) },
      attack: {
        onHit({ battle, unit, target }) {
          if (!target?.alive) return;
          if (battle.rng.chance(num(sbb['attack@prob']))) battle.applyStatus(target, 'stun', { duration: num(sbb['attack@stun']), source: unit });
          else {
            const d = num(sbb['attack@sluggish']);
            if (d > 0) battle.applyStatus(target, 'sluggish', { duration: d, source: unit });
          }
        },
      },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) { statBuff(battle, unit, 'mm:agent', { atkPct: num(t0.atk), aspd: num(t0.attack_speed) }); },
  };
}

export default { char_133_mm: mm };
