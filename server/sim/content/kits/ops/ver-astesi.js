// server/sim/content/kits/ops/ver-astesi.js — 星极 (char_274_astesi), 规程·序列Ⅰ.

import { num, talentBb, traitBb, up } from '../shared/tier1.js';
import { kitSkills, posDur } from '../shared/version.js';

const S1 = 'skchr_astesi_1';
const S2 = 'skchr_astesi_2';
// AFT-Y renewal, the same timings as 薇薇安娜 (the trait text gives the strength, not the refresh).
const FRAGILE_IV = 0.2, FRAGILE_DUR = 0.3;

function astesi(_bb, chess, def) {
  const tb = traitBb(chess);
  const t0 = talentBb(chess, 0);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      kind: 'duration', duration: posDur(rec),
      mods: { atkPct: num(sbb.atk), defPct: num(sbb.def) },
    };
    if (id === S2) return {
      kind: 'duration', duration: posDur(rec),
      mods: { atkPct: num(sbb.atk), defPct: num(sbb.def), blockCnt: num(sbb.block_cnt) },
      attack: { hitAllBlocked: true },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      // [ASSUMED] the first stack lands after one full interval on the field, not at deployment. The accumulator
      // pauses while she is down and resets on the next deploy. A DEF modifier in the template has no blackboard key.
      const max = Math.max(0, Math.floor(num(t0.max_stack_cnt)));
      const iv = num(t0.interval);
      const aspd = num(t0.attack_speed);
      if (max > 0 && iv > 0 && aspd !== 0) {
        unit.mem.astesiAcc = 0;
        unit.mem.astesiN = 0;
        const apply = (n) => {
          battle.addBuff(unit, {
            key: 'astesi:sky', mods: { aspd: aspd * n }, persist: true, allowDead: true, refresh: 'replace', tags: ['talent'],
          });
        };
        battle.on('deploy', (c) => {
          if (c.unit !== unit) return;
          unit.mem.astesiAcc = 0;
          unit.mem.astesiN = 0;
          battle.removeBuff(unit, 'astesi:sky');
        }, { owner: unit });
        battle.on('tick', () => {
          if (!up(unit) || (unit.mem.astesiN || 0) >= max) return;
          unit.mem.astesiAcc = (unit.mem.astesiAcc || 0) + battle.dt;
          let gained = 0;
          let guard = 0;
          while (unit.mem.astesiAcc + 1e-9 >= iv && unit.mem.astesiN < max && guard++ < 8) { // loop-cap: at most 8 stacks per tick
            unit.mem.astesiAcc -= iv;
            unit.mem.astesiN++;
            gained++;
          }
          if (gained) apply(unit.mem.astesiN);
        }, { owner: unit });
      }
      // [ASSUMED] the 10% 法术脆弱 is refreshed like 薇薇安娜's AFT-Y: every 0.2s for 0.3s, on enemies she is blocking.
      const scale = num(tb.damage_scale);
      if (scale > 1) {
        const value = scale - 1;
        battle.every(FRAGILE_IV, () => {
          if (!up(unit)) return;
          for (const e of unit.blocking) if (e?.alive) battle.applyStatus(e, 'artsFragile', { duration: FRAGILE_DUR, value, source: unit });
        }, { owner: unit });
      }
    },
  };
}

export default { char_274_astesi: astesi };
