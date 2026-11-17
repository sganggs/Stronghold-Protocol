// server/sim/content/kits/ops/ver-folnic.js — 亚叶 (char_345_folnic), 第一期 (DESIGN §35.22.9).
// Her chess id in that version is today's 泥岩. This file is keyed by charId and does not edit the 泥岩 kit.
// S1's attack range is the skill trigger's custom grid (the physician range plus one forward column).
// [ASSUMED] S2 fires only at an enemy: with nobody to hit, the shell is not thrown.
// [ASSUMED] damage_scale 0.5 is the fraction of a 'terrain'-tagged hit she keeps (the text is −50%, and 0.5 equals that).
// [ASSUMED] 地面 is a tile whose height is not HIGH (module text: 治疗地面单位时治疗量提升15%, heal_scale 1.15).

import { RING1, num, talentBb, traitBb, up } from '../shared/tier1.js';
import { gridOf, kitSkills, resistValue } from '../shared/version.js';

const S1 = 'skchr_folnic_1';
const S2 = 'skchr_folnic_2';

function folnic(_bb, chess, def) {
  const tb = traitBb(chess);
  const t0 = talentBb(chess, 0);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) {
      const g = gridOf(rec);
      return {
        kind: 'duration', duration: rec?.duration,
        mods: { atkPct: num(sbb.atk) },
        targeting: g ? { rangeGrid: g } : undefined,
      };
    }
    if (id === S2) return {
      kind: 'duration', duration: rec?.duration,
      attack: {
        dmgType: 'arts', atkScale: num(sbb['attack@atk_scale'], 1),
        onHit({ battle, unit, target }) {
          if (!target) return;
          const scale = num(sbb['attack@heal_scale']);
          for (const a of battle.alliesInRadius(target.x, target.y, RING1)) battle.heal(unit, a, unit.s.atk * scale);
        },
      },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      const rv = resistValue(t0.one_minus_status_resistance);
      if (rv > 0) {
        const apply = () => { if (up(unit)) battle.applyStatus(unit, 'resist', { value: rv, source: unit }); };
        battle.on('deploy', (c) => { if (c.unit === unit) apply(); }, { owner: unit });
        apply();
      }
      if (t0.damage_scale != null) {
        const ds = num(t0.damage_scale, 1);
        battle.on('hit', (c) => {
          if (c.target !== unit || !c.dmg) return;
          if ((c.dmg.tags || []).includes('terrain')) c.dmg.mul *= ds;
        }, { owner: unit });
      }
      if (tb.heal_scale != null) {
        const hs = num(tb.heal_scale, 1);
        battle.on('heal', (c) => {
          if (c.source !== unit || !c.target || hs === 1) return;
          const tile = battle.grid.tile(c.target.tileR, c.target.tileC);
          if (tile && tile.height !== 'HIGH') c.amount *= hs;
        }, { owner: unit });
      }
    },
  };
}

export default { char_345_folnic: folnic };
