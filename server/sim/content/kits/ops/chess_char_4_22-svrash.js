// server/sim/content/kits/ops/chess_char_4_22-svrash.js — 银灰 (char_172_svrash) kit, tier 4.
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.

import {
  AURA, num, tbb, grid, enemiesOnRange, whileDeployed, reveal, alt, instantKind, withDefaults,
} from '../shared/tier4.js';
import { installLordArtsAddition } from '../shared/lord.js';

const eliteOrBoss = target => target.isBoss || target.def?.rank === 'ELITE' || target.def?.rank === 'BOSS';

export default withDefaults({
  // ===== 银灰 (lord) S3 真银斩 — DEF −70 %, ATK +125 %, wider range, ≤ 4 targets at melee scale; 领袖 / 鹰眼视觉; module
  //       S1 强力击·γ型 (attack SP: next attack 205 %/225 %); S2 雪境生存法则 (toggle — [ASSUMED] once switched on it stays
  //       on for the deployment: smaller range, DEF up, 3.5 %/4 % max HP regen per s)
  chess_char_4_22_a: (bb, chess, def) => {
    const t0 = tbb(def, 0);
    const tb = def.traitBb || {};
    const g = grid(def.skill?.rangeGrid);
    return {
      skills: alt(def, {
        skchr_svrash_1: () => ({ kind: instantKind(def), attack: { atkScale: num(bb.atk_scale, 2.05) } }),
        skchr_svrash_2: () => ({
          kind: 'toggle',
          mods: { defPct: num(bb.def), hpRegenRatio: num(bb.hp_recovery_per_sec_by_max_hp_ratio) },
          targeting: g ? { rangeGrid: g } : undefined,
          onStart({ battle, unit }) { battle.fx('snow', { x: unit.x, y: unit.y, id: unit.id }); },
        }),
      }),
      skill: {
        kind: 'duration',
        mods: { defPct: num(bb.def), atkPct: num(bb.atk) },
        targeting: { ...(g ? { rangeGrid: g } : {}), maxTargets: Math.max(1, Math.floor(num(bb['attack@max_target'], 4))) },
        attack: { projectile: 'none', dmgMul: () => 1 },       // 视为近距离攻击: no ranged ×0.8
        onStart({ battle, unit }) { battle.fx('truesilver', { x: unit.x, y: unit.y, id: unit.id }); },
        onAttack({ battle, unit }) { battle.fx('slash', { x: unit.x, y: unit.y, id: unit.id }); },
      },
      talents: [
        { install(battle, unit) { // 领袖: ATK +10 %; every unit of the team redeploys 10 % faster
          battle.addBuff(unit, { key: 'svrash:t1', mods: { atkPct: num(t0.atk, 0.1) }, persist: true, allowDead: true });
          const p = battle.getPlayer(unit.ownerId);
          for (const a of p ? p.units : []) if (a.kind === 'op') battle.addBuff(a, { key: 'svrash:leader', mods: { redeployMul: Math.max(0, 1 + num(t0.respawn_time, -0.1)) }, persist: true, allowDead: true });
        } },
        { install(battle, unit) { whileDeployed(battle, unit, AURA, () => reveal(battle, enemiesOnRange(battle, unit))); } }, // 鹰眼视觉
      ],
      install(battle, unit) {
        const moduleArts = num(tb.atk_scale_m);
        if (!(moduleArts > 0)) return;
        // svrash_e_002_t[atk]: higher module stages scale source calculation against elite/boss enemies.
        // Shipped chess forms use stage 1 (no talent atk_scale); do not borrow trait's ranged scale.
        const eliteScale = num(t0.atk_scale, 1);
        if (eliteScale !== 1) battle.on('damageCalculate', c => {
          if (c.source === unit && eliteOrBoss(c.target)) c.dmg.amount *= eliteScale;
        }, { owner: unit });
        installLordArtsAddition(battle, unit, c => {
          // S1 can finish before its projectile lands; its retained flags identify the skill attack.
          const skillAttack = c.dmg.isAttack && c.dmg.isSkill;
          const skillScale = unit.skill && (unit.skill.active || skillAttack) ? num(unit.skill.bb.atk_scale, 1) : 1;
          return moduleArts * skillScale * (eliteOrBoss(c.target) ? eliteScale : 1);
        });
      },
    };
  },
});
