// server/sim/content/kits/ops/chess_char_2_19-tinman.js — 锡人 (char_4151_tinman) kit, tier 2.
// Conventions of the tier-2 kits: ../shared/tier2.js; kit contract and rules: ../README.md.

import { num, talentBb, enemiesInGrid, instantKind } from '../shared/tier1.js';
import { tinmanKit, startTinmanCoverage } from './chess_char_1_16-tinman.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 2_19 锡人 “大拉里”: see tinmanKit (chess_char_1_16-tinman.js).
  // S1 “老科利” (alt, attack SP, needs a target): throws an alchemy unit at the target (ground first); for
  // projectile_delay_time s ground enemies within projectile_range tiles are 虚弱 (weaken −atk) and take atk_scale ×
  // ATK arts per second (ATK cached at the cast; damage over time, so the elite 凋敝魂灵 ×skill@damage_scale applies;
  // the zone counts for the module's SP bonus and outlives her).
  chess_char_2_19_a: (bb, chess, def) => {
    const k = tinmanKit(bb, chess, def);
    const dur = num(bb.projectile_delay_time, 8), radius = num(bb.projectile_range, 1), dmgScale = num(bb.atk_scale);
    const weak = Math.min(1, Math.max(0, -num(bb.atk)));
    const wither = num(talentBb(chess, 1)['skill@damage_scale'], 1);
    const STEP = 0.25; // [ASSUMED] Existing weaken refresh cadence; damage every 1 s.
    return {
      ...k,
      skills: {
        ...(k.skills || {}),
        skchr_tinman_1: {
          kind: instantKind(def),
          onStart({ battle, unit }) {
            const tgt = enemiesInGrid(battle, unit, null, { n: 1, groundOnly: true })[0] ?? enemiesInGrid(battle, unit, null, { n: 1 })[0];
            const x = tgt ? tgt.x : unit.x + unit.fwd[1], y = tgt ? tgt.y : unit.y + unit.fwd[0];
            const atk = unit.s.atk;
            const n = Math.max(1, Math.round(dur / STEP)), per = Math.max(1, Math.round(1 / STEP));
            const zoneKey = `tinman:zone:${unit.id}:${unit.mem.tinZoneSeq = (unit.mem.tinZoneSeq ?? 0) + 1}`;
            let i = 0;
            const sync = startTinmanCoverage(battle, unit, { key: zoneKey, x, y, radius, duration: dur, mul: wither });
            battle.fx('zone', { x, y, radius, dur, id: unit.id, skill: 'tinman1' });
            battle.every(STEP, (b, sc) => {
              sync();
              const pulse = i % per === 0;
              for (const e of b.foesInRadius(x, y, radius)) {
                if (e.isFlying || e.s.flags.untargetable) continue;
                if (weak > 0) b.applyStatus(e, 'weaken', { duration: STEP + 0.05, value: weak, source: unit });
                if (pulse && dmgScale > 0) b.dealDamage({ source: null, credit: unit, target: e, amount: atk * dmgScale, type: 'arts',
                  attackType: 'BUFF', calculation: 'precomputed', isSkill: true, tags: ['dot', 'zone'] });
              }
              if (++i >= n) sc.cancel();
            }, { immediate: true });
          },
        },
      },
    };
  },
};
