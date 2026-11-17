// server/sim/content/kits/ops/ver-sidero.js — 铸铁 (char_333_sidero), 规程·序列Ⅰ.
// Arts-fighter damage type stays with the profession. [ASSUMED] the kill count is per deployment: a new
// deployment starts it over and drops the ASPD already earned. The module's arts fragile is refreshed on
// enemies she is blocking. S2's recovery is 生命回复速度, not a heal.

import { num, talentBb, traitBb, up } from '../shared/tier1.js';
import { gridOf, kitSkills, posDur, resistValue } from '../shared/version.js';

const S1 = 'skcom_heal_self[3]';
const S2 = 'skchr_sidero_2';

function sidero(_bb, chess) {
  const t0 = talentBb(chess, 0);
  const tb = traitBb(chess);
  const times = num(t0.times);
  const aspd = num(t0.attack_speed);
  const resist = resistValue(t0.one_minus_status_resistance);
  const { skills, skill } = kitSkills(chess, null, (id, rec, sbb) => {
    if (id === S1) {
      return {
        kind: 'instant',
        onStart({ battle, unit }) {
          battle.heal(unit, unit, unit.s.maxHp * num(sbb.heal_scale));
        },
      };
    }
    if (id === S2) {
      const g = gridOf(rec);
      return {
        kind: 'duration',
        duration: posDur(rec),
        mods: { atkPct: num(sbb.atk), hpRegenRatio: num(sbb.hp_recovery_per_sec_by_max_hp_ratio) },
        targeting: g ? { rangeGrid: g } : undefined,
      };
    }
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      const reset = () => {
        unit.mem.sideroKills = 0;
        unit.mem.sideroDone = false;
        battle.removeBuff(unit, 'sidero:kills');
      };
      reset();
      battle.on('deploy', (ctx) => { if (ctx.unit === unit) reset(); }, { owner: unit });
      if (times > 0) {
        battle.on('kill', (ctx) => {
          if (ctx.killer !== unit || ctx.victim?.side !== 'enemy' || !up(unit) || unit.mem.sideroDone) return;
          unit.mem.sideroKills = (unit.mem.sideroKills || 0) + 1;
          if (unit.mem.sideroKills < times) return;
          unit.mem.sideroDone = true;
          if (aspd) battle.addBuff(unit, { key: 'sidero:kills', mods: { aspd }, tags: ['talent'] });
          if (resist > 0) battle.applyStatus(unit, 'resist', { value: resist, source: unit });
        }, { owner: unit });
      }
      if (tb.damage_scale != null) {
        const fragile = num(tb.damage_scale, 1) - 1;
        if (fragile > 0) {
          battle.every(0.25, () => {
            if (!up(unit) || !unit.blocking?.length) return;
            for (const e of unit.blocking) {
              if (e.blockedBy === unit && e.alive) {
                battle.applyStatus(e, 'artsFragile', { value: fragile, duration: 0.4, source: unit });
              }
            }
          }, { owner: unit });
        }
      }
    },
  };
}

export default { char_333_sidero: sidero };
