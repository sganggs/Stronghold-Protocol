// server/sim/content/kits/ops/ver-bison.js — 拜松 (char_325_bison), 规程·序列Ⅰ.
// Protector trait stays with the profession. [ASSUMED] the talent's flat DEF holds only while he is deployed.
// [ASSUMED] "身后" is the talent grid's other tiles, and only a 先锋 or 近卫 operator. [ASSUMED] S2's 友方单位
// includes tokens and not devices. Class skill triggers stay on the data row.

import { absoluteRangeKeys } from '../../../targeting.js';
import { installAura, num, skillRec, talentBb, talentGrid, toggleBuff, traitBb } from '../shared/tier1.js';
import { COLS, gridOf, kitSkills, posDur } from '../shared/version.js';

const S1 = 'skcom_def_up[3]';
const S2 = 'skchr_bison_2';

function onGrid(unit, grid, ally) {
  if (!grid || ally === unit) return false;
  const keys = absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, 0);
  return keys.includes(ally.tileR * COLS + ally.tileC);
}

function bison(_bb, chess) {
  const t0 = talentBb(chess, 0);
  const tb = traitBb(chess);
  const behind = talentGrid(chess, 0);
  const behindGrid = behind ? behind.map((p) => [p[0], p[1]]) : null;
  const s2rec = skillRec(chess, S2);
  const s2grid = gridOf(s2rec);
  const s2bb = s2rec?.bb ?? {};
  const flat = num(t0.def);
  const allyPct = num(s2bb['bison_s_2[ally].def']);
  const { skills, skill } = kitSkills(chess, null, (id, rec, sbb) => {
    if (id === S1) {
      return { kind: 'duration', duration: posDur(rec), mods: { defPct: num(sbb.def) } };
    }
    if (id === S2) {
      const g = gridOf(rec);
      return {
        kind: 'duration',
        duration: posDur(rec),
        attack: { noAttack: true },
        mods: { defPct: num(sbb['bison_s_2[self].def']), taunt: num(sbb['bison_s_2[self].taunt_level']) },
        targeting: g ? { rangeGrid: g } : undefined,
      };
    }
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      if (flat) toggleBuff(battle, unit, 'bison:self', () => true, { defFlat: flat });
      if (behindGrid && flat) {
        installAura(battle, unit, {
          key: 'bison:behind', value: Math.abs(flat) + 1,
          select: (a) => onGrid(unit, behindGrid, a) && a.kind === 'op'
            && (a.def?.profession === 'PIONEER' || a.def?.profession === 'WARRIOR'),
          mods: { defFlat: flat },
        });
      }
      const modulePct = num(tb.def);
      if (tb.def != null && modulePct) {
        toggleBuff(battle, unit, 'bison:module', () => unit.blocking.length > 0, { defPct: modulePct });
      }
      if (s2grid && allyPct) {
        installAura(battle, unit, {
          key: 'bison:s2', value: Math.abs(allyPct) + 1,
          select: (a) => a !== unit && a.kind !== 'device' && unit.skill?.active && unit.skill.id === S2
            && onGrid(unit, s2grid, a),
          mods: { defPct: allyPct },
        });
      }
    },
  };
}

export default { char_325_bison: bison };
