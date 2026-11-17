// server/sim/content/kits/ops/ver-zebra.js — 暴雨 (char_304_zebra), 第一期 (DESIGN §35.22.9).
// Elite block 4 is already on the stats. S1 is the next attack; the camou and the regen last the skill record's duration.

import { RING1, alliesInGridOf, num, talentBb, up } from '../shared/tier1.js';
import { gridOf, kitSkills } from '../shared/version.js';

const S1 = 'skchr_zebra_1';
const S2 = 'skchr_zebra_2';

function zebra(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      kind: 'instant',
      attack: {
        onHit({ battle, unit }) {
          const key = `zebra:camou:${unit.id}`;
          const g = gridOf(rec);
          const cand = alliesInGridOf(battle, unit, g).filter((a) => a !== unit && a.hpRatio < 0.5 - 1e-9 && !a.findBuff(key));
          cand.sort((a, b) => a.hp - b.hp || a.hpRatio - b.hpRatio);
          const t = cand[0];
          if (!t) return;
          const dur = rec?.duration > 0 ? rec.duration : 4;
          battle.addBuff(t, { key, duration: dur, flags: { camou: true }, mods: { hpRegen: num(sbb.hp_recovery_per_sec) }, source: unit });
        },
      },
    };
    if (id === S2) {
      const g = gridOf(rec);
      return {
        kind: 'duration', duration: rec?.duration, flags: { disarm: true },
        mods: { hpPct: num(sbb.max_hp), defPct: num(sbb.def) },
        onStart({ battle, unit, skill: sk }) {
          const allies = alliesInGridOf(battle, unit, g);
          if (!allies.includes(unit)) allies.unshift(unit);
          for (const a of allies) battle.addBuff(a, { key: `zebra:camou2:${unit.id}`, duration: sk.timeLeft, flags: { camou: true }, source: unit });
        },
      };
    }
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      const p = num(t0.prob);
      if (!(p > 0)) return;
      battle.every(0.5, () => {
        if (!up(unit)) return;
        for (const a of battle.alliesInRadius(unit.x, unit.y, RING1)) {
          if (a !== unit) {
            const tile = battle.grid.tile(a.tileR, a.tileC);
            if (!tile || tile.height !== 'HIGH') continue;
          }
          battle.addBuff(a, { key: `zebra:dodge:${unit.id}`, mods: { dodgePhys: p }, duration: 0.7, refresh: 'replace', source: unit });
        }
      }, { owner: unit, immediate: true });
    },
  };
}

export default { char_304_zebra: zebra };
