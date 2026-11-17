// server/sim/content/kits/ops/ver-halo.js — 星源 (char_135_halo), 第一期 (DESIGN §35.22.9).
// The resting chain (4 jumps, falloff from the trait, sluggish) is the chain profile. S1's charged shot carries its own.
// She is already on 缪尔赛思's version 莱茵 list; this file does not edit that list.

import { num, talentBb, up } from '../shared/tier1.js';
import { chainShape, chargeKind, gridOf, kitSkills } from '../shared/version.js';

const S1 = 'skchr_halo_1';
const S2 = 'skchr_halo_2';

function halo(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      kind: chargeKind(rec),
      attack: { atkScale: num(sbb.atk_scale, 1), chain: chainShape(chess, sbb['chain.max_target'], sbb.sluggish) },
      targeting: { maxTargets: num(sbb.max_target, 2) },
    };
    if (id === S2) {
      const g = gridOf(rec);
      return {
        kind: 'duration', duration: rec?.duration,
        mods: { atkPct: num(sbb.atk) },
        targeting: { maxTargets: num(sbb['attack@max_target'], 2), ...(g ? { rangeGrid: g } : {}) },
      };
    }
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      const iv = num(t0.interval, 15), step = num(t0.attack_speed), max = num(t0.max_stack_cnt, 5);
      if (!(iv > 0) || !(step > 0)) return;
      battle.on('deploy', (c) => {
        if (c.unit !== unit) return;
        unit.mem.haloT = 0;
        unit.mem.haloN = 0;
        battle.removeBuff(unit, 'halo:stack');
      }, { owner: unit });
      battle.on('tick', ({ dt }) => {
        if (!up(unit)) return;
        unit.mem.haloT = (unit.mem.haloT ?? 0) + dt;
        let guard = 0;
        while (unit.mem.haloT + 1e-9 >= iv && (unit.mem.haloN ?? 0) < max && guard++ < 4) { // loop-cap: one stack per interval
          unit.mem.haloT -= iv;
          unit.mem.haloN = (unit.mem.haloN ?? 0) + 1;
          battle.addBuff(unit, { key: 'halo:stack', mods: { aspd: step * unit.mem.haloN }, refresh: 'replace', tags: ['talent'] });
        }
      }, { owner: unit });
    },
  };
}

export default { char_135_halo: halo };
