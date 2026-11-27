// server/sim/content/kits/ops/chess_char_4_02-mostma.js — 莫斯提马 (char_213_mostma) kit, tier 4.
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.

import {
  AURA, num, tbb, grid, enemiesOnRange, whileDeployed, pulse, spAura, skillActive, isSel, alt, applyModuleRange,
  withDefaults,
} from '../shared/tier4.js';

const TICK_EPS = 0.01;     // minimal status duration (s)
/**
 * Knock-back of 力度 `force` away from `from` (a radial push, Battle.push: the official 力度 − 重量 distance — PRTS 推与拉;
 * user playtest #6 item 14). Returns the tiles moved.
 */
function shove(battle, e, from, force) {
  return e && e.alive ? battle.push(e, num(force, 0), { from }) : 0;
}

export default withDefaults({
  // ===== 莫斯提马 (splashcaster) S3 序时之匙 — ripple hits all in range, +ATK, talent 2 ×3, small knock-back
  //       S1 攻击力强化·γ型; S2 荒时之锁 (every enemy in range stunned for the rest of the skill, 100 %/120 % ATK arts
  //       per second); module SPC-X (资深万国信使定制斗篷): 攻击范围扩大
  chess_char_4_02_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const g = grid(def.skill?.rangeGrid);
    const force = num(bb['attack@force'], num(bb.force, 0));
    const S3 = isSel(def, 'skchr_mostma_3');
    return {
      skills: alt(def, {
        'skcom_atk_up[3]': () => ({ kind: 'duration', mods: { atkPct: num(bb.atk) } }),
        skchr_mostma_2: () => ({
          kind: 'duration',
          onStart({ battle, unit, skill }) {
            unit.mem.timeLock = { acc: 0, locked: new Set() };
            battle.fx('zone', { x: unit.x, y: unit.y, id: unit.id, duration: skill.duration });
          },
          onTick({ battle, unit, skill, dt }) {
            const L = unit.mem.timeLock;
            if (!L) return;
            // every enemy standing in her range (entering later too) is stunned until the skill ends
            for (const e of enemiesOnRange(battle, unit)) {
              if (L.locked.has(e.id)) continue;
              L.locked.add(e.id);
              battle.applyStatus(e, 'stun', { duration: Math.max(TICK_EPS, skill.timeLeft), source: unit });
            }
            L.acc += dt;
            while (L.acc + 1e-9 >= 1) { // loop-cap: one-second step
              L.acc -= 1;
              for (const e of enemiesOnRange(battle, unit)) {
                battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale, 1), type: 'arts', isSkill: true, tags: ['skill', 'timeLock'] });
                // cosmetic fx (round 86): the channel hit on each enemy this second damages
                battle.fx('fxHit', { x: e.x, y: e.y, id: unit.id, target: e.id, skill: 'mostma:s2' });
              }
            }
          },
          onEnd({ unit }) { unit.mem.timeLock = null; },
        }),
      }),
      install(battle, unit) { applyModuleRange(battle, unit, def); }, // module SPC-X: 攻击范围扩大 (module range grid)
      skill: {
        kind: 'duration',
        mods: { atkPct: num(bb.atk) },
        targeting: { ...(g ? { rangeGrid: g } : {}), allInRange: true },
        attack: { projectile: 'none', splashRadius: 0, onHit({ battle, unit, target }) { if (target && target.alive) shove(battle, target, unit, force); } },
        onAttack({ battle, unit }) { battle.fx('ripple', { x: unit.x, y: unit.y, id: unit.id }); },
      },
      talents: [
        { install(battle, unit) { spAura(battle, unit, num(t0.sp_recovery_per_sec, 0.4), (a) => a.def?.profession === 'CASTER'); } },
        { install(battle, unit) { // 主观缓时: enemies in range −15 % move speed (×talent_scale during S3)
          whileDeployed(battle, unit, AURA, () => {
            const v = num(t1.move_speed, -0.15) * (S3 && skillActive(unit) ? num(bb.talent_scale, 3) : 1);
            for (const e of enemiesOnRange(battle, unit)) pulse(battle, e, `mostma:slow:${unit.id}`, { moveMul: Math.max(0, 1 + v) }, { status: 'slow', visible: true });
          });
        } },
      ],
    };
  },
});
