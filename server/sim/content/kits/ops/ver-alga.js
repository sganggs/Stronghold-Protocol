// server/sim/content/kits/ops/ver-alga.js — 奥尔佳 (char_4245_alga), 规程·序列Ⅰ.
// The instructor trait (unblockedScale from atk_scale) stays with the profession. The talent aura is the
// talent grid, and the extra attack bonus looks at her current attack range. [ASSUMED] the self tile in
// that grid means she is one of the 干员 (the words say 周围8格). [ASSUMED] a token is not a 干员.
// [ASSUMED] 精英及领袖 is an elite-rank enemy, a boss-rank enemy, or a boss tag. [ASSUMED] two of them at
// the same ATK: the smaller id. [ASSUMED] S1 连续攻击两次 is the same attack's second hit (no times key);
// both hits use atk_scale.

import { absoluteRangeKeys } from '../../../targeting.js';
import { installAura, num, talentBb, talentGrid } from '../shared/tier1.js';
import { COLS, chargeKind, gridOf, kitSkills, posDur } from '../shared/version.js';

const S1 = 'skchr_alga_1';
const S2 = 'skchr_alga_2';

function covers(unit, grid, ally) {
  if (!grid) return false;
  const keys = absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, 0);
  return keys.includes(ally.tileR * COLS + ally.tileC);
}

function isElite(e) {
  return !!(e && e.alive && (e.isBoss || e.def?.rank === 'ELITE' || e.def?.rank === 'BOSS'));
}

function eliteInRange(battle, unit) {
  const keys = unit.rangeKeys;
  if (!keys || !keys.length) return false;
  for (const e of battle.enemiesInKeys(keys, unit, { canHitFly: true })) {
    if (isElite(e)) return true;
  }
  return false;
}

function alga(_bb, chess) {
  const t0 = talentBb(chess, 0);
  const grid = talentGrid(chess, 0);
  const auraGrid = grid?.length ? grid.map((p) => [p[0], p[1]]) : null;
  const baseUp = num(t0['alga[atk_up].atk']);
  const check = num(t0['alga[check_enemy].atk']);
  const { skills, skill } = kitSkills(chess, null, (id, rec, sbb) => {
    if (id === S1) {
      return {
        kind: chargeKind(rec),
        attack: { atkScale: num(sbb.atk_scale, 1), hits: 2 },
      };
    }
    if (id === S2) {
      const g = gridOf(rec);
      const dur = num(sbb['attack@debuff_duration']);
      const taunt = num(sbb['attack@taunt_level']);
      return {
        kind: 'duration',
        duration: posDur(rec),
        mods: { atkPct: num(sbb.atk) },
        targeting: g ? { rangeGrid: g } : undefined,
        attack: {
          onHit({ battle, unit, target }) {
            if (!target?.alive) return;
            if (dur > 0) battle.applyStatus(target, 'sluggish', { duration: dur, source: unit });
            if (taunt) battle.applyStatus(target, 'taunt', { value: taunt, duration: dur > 0 ? dur : undefined, source: unit });
          },
        },
      };
    }
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      if (auraGrid && (baseUp || check)) {
        installAura(battle, unit, {
          key: 'alga:aura', value: Math.abs(baseUp) + Math.abs(check) + 1,
          select: (a) => a.kind === 'op' && covers(unit, auraGrid, a),
          mods: () => {
            let pct = baseUp;
            if (check && eliteInRange(battle, unit)) pct += check;
            if (unit.skill?.active && unit.skill.id === S2) pct *= num(unit.skill.bb?.talent_scale, 1);
            return { atkPct: pct };
          },
        });
      }
      battle.on('beforeAttack', (ctx) => {
        if (ctx.attacker !== unit) return;
        const prof = ctx.profile || unit.profile;
        const cands = battle.enemiesInKeys(unit.rangeKeys, unit, prof);
        for (const e of battle.blockedTargets(unit, prof)) if (!cands.includes(e)) cands.push(e);
        let best = null;
        for (const e of cands) {
          if (!isElite(e)) continue;
          if (!best || e.s.atk > best.s.atk + 1e-9 || (Math.abs(e.s.atk - best.s.atk) <= 1e-9 && e.id < best.id)) best = e;
        }
        if (best) ctx.targets = [best];
      }, { owner: unit });
    },
  };
}

export default { char_4245_alga: alga };
