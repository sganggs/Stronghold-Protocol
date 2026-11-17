// server/sim/content/kits/ops/ver-spikes.js — 芳汀 (char_271_spikes), 第一期 (DESIGN §35.22.9).
// The lord ranged penalty is the profession (`atk_scale`). The hidden "2名及以上敌人攻速+12" is traitMods. Neither is repeated.
// 「攻击【无人机】时攻击力+N%」with atk_scale 1.43 is ×1.43 (+43% is how the blackboard stores it).

import { isMainHit, num, onHitBy, talentBb } from '../shared/tier1.js';
import { gridOf, kitSkills } from '../shared/version.js';

const S1 = 'skchr_spikes_1';
const S2 = 'skchr_spikes_2';
const drone = (t) => (t?.def?.tags || []).includes('drone');

function spikes(_bb, chess, def) {
  const scale = num(talentBb(chess, 0).atk_scale, 1);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      kind: 'duration', duration: rec?.duration,
      mods: { blockCnt: -9 },
      attack: { hits: 2, atkScale: num(sbb['attack@atk_scale'], 1) },
    };
    if (id === S2) {
      const g = gridOf(rec);
      return {
        kind: 'duration', duration: rec?.duration,
        attack: { atkScale: num(sbb['attack@atk_scale'], 1), dmgType: 'arts' },
        targeting: { maxTargets: num(sbb['attack@max_target'], 2), ...(g ? { rangeGrid: g } : {}) },
        onStart({ unit }) {
          unit.mem.spikesProf = unit.profile;
          unit.profile = { ...unit.profile, rangedScale: 1 };
        },
        onEnd({ unit }) {
          if (unit.mem.spikesProf) unit.profile = unit.mem.spikesProf;
          unit.mem.spikesProf = null;
        },
      };
    }
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      battle.on('beforeAttack', (ctx) => {
        if (ctx.attacker !== unit) return;
        const drones = [], rest = [];
        for (const t of ctx.targets || []) (drone(t) ? drones : rest).push(t);
        if (drones.length) ctx.targets = drones.concat(rest);
      }, { owner: unit });
      if (scale !== 1) onHitBy(battle, unit, ({ target, dmg }) => {
        if (dmg.isAttack && isMainHit(dmg) && drone(target)) dmg.mul *= scale;
      });
    },
  };
}

export default { char_271_spikes: spikes };
