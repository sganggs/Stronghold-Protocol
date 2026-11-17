// server/sim/content/kits/ops/ver-frostl.js — 霜叶 (char_193_frostl), 规程·序列Ⅰ.
// The lord trait (ranged falloff) stays with the profession. The elite talent widens her range and adds
// attack interval. [ASSUMED] S2's per-hit slow lasts `debuff` seconds — that blackboard's only duration
// (the bind uses the same number). The module's extra arts is the main hit only.

import { batMod, isMainHit, num, statBuff, talentBb, talentGrid, traitBb, up } from '../shared/tier1.js';
import { chargeKind, kitSkills, posDur } from '../shared/version.js';

const S1 = 'skchr_frostl_1';
const S2 = 'skchr_frostl_2';

function slowFor(battle, unit, target, value, duration) {
  if (!target?.alive || !(value > 0) || !(duration > 0)) return;
  battle.applyStatus(target, 'slow', { value, duration, source: unit });
}

function frostl(_bb, chess) {
  const t0 = talentBb(chess, 0);
  const tb = traitBb(chess);
  const grid = talentGrid(chess, 0);
  const { skills, skill } = kitSkills(chess, null, (id, rec, sbb) => {
    if (id === S1) {
      return {
        kind: chargeKind(rec),
        attack: {
          atkScale: num(sbb.atk_scale, 1),
          onHit({ battle, unit, target }) {
            slowFor(battle, unit, target, Math.abs(num(sbb.move_speed)), num(sbb.duration));
          },
        },
      };
    }
    if (id === S2) {
      const bindFor = num(sbb.debuff);
      return {
        kind: 'duration',
        duration: posDur(rec),
        mods: { aspd: num(sbb.attack_speed) },
        attack: {
          onHit({ battle, unit, target }) {
            if (!target?.alive) return;
            slowFor(battle, unit, target, Math.abs(num(sbb.move_speed)), bindFor);
            if (bindFor > 0 && battle.rng.chance(num(sbb.prob))) {
              battle.applyStatus(target, 'bind', { duration: bindFor, source: unit });
            }
          },
        },
      };
    }
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      if (grid && grid.length) {
        const apply = () => {
          unit.rangeGrid = grid.map((p) => [p[0], p[1]]);
          battle.refreshRange(unit);
        };
        apply();
        battle.on('deploy', (ctx) => { if (ctx.unit === unit) apply(); }, { owner: unit });
      }
      // Positive base_attack_time with an empty description is extra seconds, not a ratio.
      const bat = batMod(t0.base_attack_time, chess, '');
      if (bat) statBuff(battle, unit, 'frostl:bat', { batPct: bat });
      if (tb.atk_scale_m != null) {
        const m = num(tb.atk_scale_m);
        battle.on('hit', (ctx) => {
          if (ctx.source !== unit || !isMainHit(ctx.dmg) || !(m > 0) || !ctx.target?.alive || !up(unit)) return;
          battle.dealDamage(unit, ctx.target, { amount: unit.s.atk * m, type: 'arts', tags: ['frostl:module'] });
        }, { owner: unit });
      }
    },
  };
}

export default { char_193_frostl: frostl };
