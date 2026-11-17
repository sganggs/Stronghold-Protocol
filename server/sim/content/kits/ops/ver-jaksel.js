// server/sim/content/kits/ops/ver-jaksel.js — 杰克 (char_347_jaksel), 规程·序列Ⅰ.
// Talent and the module are separate dodge chances. A physical dodge grants ASPD, then (while S2 is up) one
// counter hit. [ASSUMED] the counter is a damage instance, not an attack: it gives no attack SP and is not
// an attack. [ASSUMED] it strikes the source when that enemy is in his range, otherwise the nearest enemy
// (Chebyshev, then id). [ASSUMED] 晕眩 or 缴械 skips the counter. S2 `base_attack_time` is the counter's
// minimum interval as a fraction of his current attack interval (信仰搅拌机), not a BAT change.

import { enemiesInGrid, cheb, num, skillRec, talentBb, traitBb, up } from '../shared/tier1.js';
import { chargeKind, kitSkills } from '../shared/version.js';

const S1 = 'skchr_jaksel_1';
const S2 = 'skchr_jaksel_2';

function counterTarget(battle, unit, source) {
  const inRange = enemiesInGrid(battle, unit, null);
  if (source && source.side === 'enemy' && source.alive && inRange.includes(source)) return source;
  let best = null;
  let bestD = Infinity;
  for (const e of battle.enemies) {
    if (!e.alive) continue;
    const d = cheb(unit, e);
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && best && e.id < best.id)) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

function jaksel(_bb, chess) {
  const t0 = talentBb(chess, 0);
  const tb = traitBb(chess);
  const s2 = skillRec(chess, S2)?.bb ?? {};
  const { skills, skill } = kitSkills(chess, null, (id, rec, sbb) => {
    if (id === S1) {
      return {
        kind: chargeKind(rec),
        attack: { atkScale: num(sbb.atk_scale, 1) },
      };
    }
    if (id === S2) {
      return {
        kind: 'duration',
        attack: { noAttack: true },
        mods: { dodgePhys: num(sbb['jaksel_skill_2[evade].prob']) },
      };
    }
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      const talentP = num(t0.prob);
      if (talentP > 0) {
        battle.addBuff(unit, {
          key: 'jaksel:talentDodge', mods: { dodgePhys: talentP }, persist: true, allowDead: true, tags: ['talent'],
        });
      }
      const moduleP = num(tb.prob);
      if (moduleP > 0) {
        battle.addBuff(unit, {
          key: 'jaksel:moduleDodge', mods: { dodgePhys: moduleP }, persist: true, allowDead: true, tags: ['talent'],
        });
      }
      const aspd = num(t0['charge_atk_speed_on_evade.attack_speed']);
      const aspdDur = num(t0['charge_atk_speed_on_evade.duration']);
      // Registered before the counter so the ASPD is on the interval the counter reads.
      battle.on('dodge', (ctx) => {
        if (ctx.target !== unit || !ctx.cancelled || ctx.dmg?.type !== 'phys') return;
        if (!(aspd > 0) || !(aspdDur > 0)) return;
        battle.addBuff(unit, {
          key: 'jaksel:evadeAspd', mods: { aspd }, duration: aspdDur, refresh: 'replace', tags: ['talent'],
        });
      }, { owner: unit });
      battle.on('dodge', (ctx) => {
        if (ctx.target !== unit || !ctx.cancelled || ctx.dmg?.type !== 'phys') return;
        if (!up(unit) || !unit.skill?.active || unit.skill.id !== S2) return;
        if (!unit.canAct || unit.s.flags.disarm) return;
        const ratio = num(s2.base_attack_time);
        if (battle.time + 1e-9 < (unit.mem.jakselReady ?? 0)) return;
        const target = counterTarget(battle, unit, ctx.source);
        unit.mem.jakselReady = battle.time + (ratio > 0 ? ratio * unit.s.interval : 0);
        const scale = num(s2['attack@atk_scale']);
        if (!target || !(scale > 0)) return;
        battle.dealDamage(unit, target, {
          amount: unit.s.atk * scale, type: 'phys', tags: ['jaksel:counter'],
        });
      }, { owner: unit });
    },
  };
}

export default { char_347_jaksel: jaksel };
