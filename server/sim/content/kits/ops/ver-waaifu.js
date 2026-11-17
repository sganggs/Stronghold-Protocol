// server/sim/content/kits/ops/ver-waaifu.js — 槐琥 (char_243_waaifu), 第一期 (DESIGN §35.22.9).
// S1 is PASSIVE in the table but has a duration and no SP: a duration skill that opens on deployment (a passive cannot
// be activated, and a lasting buff is not a permanent passive). S2's burst is the passive onStart.

import { enemiesInGrid, isMainHit, num, onHitBy, talentBb, traitBb } from '../shared/tier1.js';
import { gridOf, kitSkills } from '../shared/version.js';

const S1 = 'skchr_waaifu_1';
const S2 = 'skchr_waaifu_2';

function waaifu(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const ratio = num(traitBb(chess).withdraw_cost_recover_ratio);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      kind: 'duration', duration: rec?.duration, activateOnDeploy: true,
      mods: { atkPct: num(sbb['waaifu_s_1[self].atk']) },
      attack: {
        onHit({ battle, unit, target }) {
          const deb = num(sbb['attack@waaifu_s_1[debuff].atk']);
          const dur = num(sbb['attack@waaifu_s_1[debuff].duration']);
          if (target?.alive && deb < 0 && dur > 0) battle.applyStatus(target, 'weaken', { duration: dur, value: -deb, source: unit });
        },
      },
    };
    if (id === S2) return {
      kind: 'passive',
      onStart({ battle, unit }) {
        const g = gridOf(rec);
        const scale = num(sbb.atk_scale, 1);
        const silence = num(sbb.silence);
        for (const e of enemiesInGrid(battle, unit, g)) {
          battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'phys', isSkill: true, tags: ['skill'] });
          if (e.alive && silence > 0) battle.applyStatus(e, 'silence', { duration: silence, source: unit });
        }
      },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      const prob = num(t0.prob), scale = num(t0.atk_scale, 1), force = num(t0.force, -1);
      if (prob > 0) onHitBy(battle, unit, ({ target, dmg }) => {
        if (!dmg.isAttack || !isMainHit(dmg) || !target?.alive) return;
        if (!battle.rng.chance(prob)) return;
        dmg.mul *= scale; // 提升至160%: atk_scale is the attack's scale
        battle.push(target, force, { from: unit });
      });
      // [ASSUMED] the refund is paid on a manual retreat only, not when she is knocked out.
      if (ratio > 0) battle.on('death', (c) => {
        if (c.unit !== unit || c.reason !== 'retreat') return;
        battle.addDp(unit.ownerId, unit.base.cost * ratio);
      }, { owner: unit });
    },
  };
}

export default { char_243_waaifu: waaifu };
