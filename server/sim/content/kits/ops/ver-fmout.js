// server/sim/content/kits/ops/ver-fmout.js — 远山 (char_109_fmout), 第一期 (DESIGN §35.22.9).
// Splash around the struck target is the splashcaster profile. S2's「同时攻击攻击范围内所有敌人」is allInRange on the
// skill's own grid. The module's wider range is the module talent rangeGrid (applyModuleRange).

import { applyModuleRange } from '../shared/tier4.js';
import { num, talentBb } from '../shared/tier1.js';
import { gridOf, kitSkills } from '../shared/version.js';

const S1 = 'skcom_magic_rage[2]';
const S2 = 'skchr_fmout_2';

function fmout(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return { kind: 'duration', duration: rec?.duration, mods: { aspd: num(sbb.attack_speed) } };
    if (id === S2) {
      const g = gridOf(rec);
      return {
        kind: 'duration', duration: rec?.duration,
        mods: { atkPct: num(sbb.atk) },
        targeting: g ? { rangeGrid: g, allInRange: true } : { allInRange: true },
        onEnd({ battle, unit, reason }) {
          if (reason !== 'duration') return;
          const t = num(sbb.time);
          if (t > 0) battle.addBuff(unit, { key: 'fmout:stop', duration: t, flags: { disarm: true } });
        },
      };
    }
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      applyModuleRange(battle, unit, def);
      // 占卜: one of the three, once per deployment. [ASSUMED] the next deployment rolls again.
      const choices = [
        { aspd: num(t0.attack_speed) },
        { atkPct: num(t0.atk) },
        { hpPct: num(t0.max_hp) },
      ].filter((m) => Object.values(m)[0]);
      if (!choices.length) return;
      battle.on('deploy', (c) => {
        if (c.unit !== unit) return;
        battle.removeBuff(unit, 'fmout:omen');
        battle.addBuff(unit, { key: 'fmout:omen', mods: battle.rng.pick(choices), persist: true, tags: ['talent'] });
      }, { owner: unit });
    },
  };
}

export default { char_109_fmout: fmout };
