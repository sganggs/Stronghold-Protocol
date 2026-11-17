// server/sim/content/kits/ops/ver-cuttle.js — 安哲拉 (char_218_cuttle), 第一期 (DESIGN §35.22.9).
// 优先攻击防御力最低 is the longrange profile. The distance scale is the elite trait blackboard (same shape as 伊芙利特).
// [ASSUMED]「编入队伍」is the deployed board, not the bench.

import { hypot } from '../../../detmath.js';
import { installAura, num, talentBb, traitBb, up } from '../shared/tier1.js';
import { isAbyssal } from '../shared/tier5.js';
import { kitSkills } from '../shared/version.js';

const S1 = 'skcom_atk_up[3]';
const S2 = 'skchr_cuttle_2';

function cuttle(_bb, chess, def) {
  const tb = traitBb(chess);
  const aspd = num(talentBb(chess, 0).attack_speed);
  const { skills, skill, sid } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return { kind: 'duration', duration: rec?.duration, mods: { atkPct: num(sbb.atk) } };
    if (id === S2) return {
      kind: 'duration', duration: rec?.duration,
      mods: { atkPct: num(sbb.atk) },
      attack: {
        onHit({ battle, unit, target }) {
          const slow = Math.abs(num(sbb['attack@move_speed']));
          const dur = num(sbb['attack@duration']);
          if (target?.alive && slow > 0 && dur > 0) battle.applyStatus(target, 'slow', { value: slow, duration: dur, source: unit });
        },
      },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      if (aspd) installAura(battle, unit, { key: 'cuttle:abyss', select: isAbyssal, mods: { aspd }, value: aspd });
      const ds = num(tb.damage_scale);
      if (ds > 0 && tb.max_dist != null) {
        const lo = num(tb.min_dist), hi = num(tb.max_dist, 4);
        battle.on('hit', (c) => {
          const e = c.target;
          if (c.source !== unit || !e || e.side !== 'enemy' || c.dmg?.type === 'element' || !up(unit)) return;
          const d = hypot(e.x - unit.x, e.y - unit.y);
          c.dmg.mul *= 1 + ds * (hi > lo ? Math.max(0, Math.min(1, (d - lo) / (hi - lo))) : 1);
        }, { owner: unit });
      }
      if (sid === S2) battle.on('beforeAttack', (ctx) => {
        if (ctx.attacker !== unit || !unit.skill?.active) return;
        // [ASSUMED] when every enemy is below half health she holds the shot; there is no fallback target.
        ctx.targets = (ctx.targets || []).filter((t) => t && t.hpRatio >= 0.5);
      }, { owner: unit });
    },
  };
}

export default { char_218_cuttle: cuttle };
