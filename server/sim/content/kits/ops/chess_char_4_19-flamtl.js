// server/sim/content/kits/ops/chess_char_4_19-flamtl.js — 焰尾 (char_420_flamtl) kit, tier 4.
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.

import { canTargetEnemy, sortEnemyTargets } from '../../../targeting.js';
import { stepOf, STEP_PER_TICK } from '../../../../../shared/plugins/steps.js';
import {
  AURA, num, tbb, grid, nationOf, targetsInGrid, whileDeployed, pulse, toggleBuff, isSel, alt,
  withDefaults,
} from '../shared/tier4.js';

export default withDefaults({
  // ===== 焰尾 (pioneer) S3 焰心 — 8 DP over the skill, faster, +ATK, block +1, 60 % dodge; talents 前锋剑术 / 红松骑士团团长
  //       S1 迅敏直觉 (+6 DP, dodges the next physical attack); S2 “红松林” (+11/12 DP; ≤ 6 enemies around: 2 × 180 %/210 %
  //       phys + 0.5 s stun, air units too — PRTS 备注 "※可对空"; allies around +40 %/45 % physical dodge for 10 s);
  //       module SOL-X (她们的未来): ATK/DEF +8 % while blocking. Her dodges (any source) feed talent 前锋剑术.
  chess_char_4_19_a: (bb, chess, def) => {
    const t1 = tbb(def, 1);
    const tb = def.traitBb || {};
    const total = Math.max(0, Math.floor(num(bb.value, 8))), per = num(bb.cost, 1);
    const p = num(bb.prob, 0.6);
    const S3 = isSel(def, 'skchr_flamtl_3');
    const g = grid(def.skill?.rangeGrid);
    return {
      skills: alt(def, {
        // (自动触发: an AUTO skill takes no 技能策略 — an AUTO DP skill fires as soon as it is ready, like 伺夜 S1)
        skchr_flamtl_1: () => ({
          kind: 'instant',
          trigger: 'SP_FULL',
          onStart({ battle, unit }) {
            battle.addDp(unit.ownerId, num(bb.cost, 6), unit);
            battle.addBuff(unit, { key: 'flamtl:evade', visible: true, injury(c) {
        if (c.type === 'phys' && c.dmg.isAttack && c.source?.side === 'enemy' && c.dodge()) battle.removeBuff(unit, c.buff);
      } });
            battle.fx('dp', { x: unit.x, y: unit.y, id: unit.id, n: num(bb.cost, 6) });
          },
        }),
        skchr_flamtl_2: () => ({
          kind: 'instant',
          onStart({ battle, unit }) {
            battle.addDp(unit.ownerId, num(bb.cost, 11), unit);
            const area = g || [[0, 0], [0, 1]];
            const foes = targetsInGrid(battle, unit, area);
            sortEnemyTargets(battle, unit, foes, null);
            for (const e of foes.slice(0, Math.max(1, Math.floor(num(bb.max_target, 6))))) {
              for (let i = 0; i < 2 && e.alive; i++) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale, 1.8), type: 'phys', isSkill: true, tags: ['skill', 'redPine'] });
              if (e.alive) battle.applyStatus(e, 'stun', { duration: num(bb.stun, 0.5), source: unit });
            }
            for (const a of battle.unitsInGrid(unit, area, { side: 'ally' })) {
              if (a.kind === 'device' || !battle.allySelectable(a, unit)) continue;
              battle.addBuff(a, { key: 'flamtl:redPine', duration: num(bb['flamtl_s_2.duration'], 10), mods: { dodgePhys: num(bb['flamtl_s_2.prob'], 0.4) }, visible: true, source: unit });
            }
            battle.fx('aoe', { x: unit.x, y: unit.y, id: unit.id });
          },
        }),
      }),
      skill: {
        kind: 'duration',
    // Each buff rolls independently at its acquisition position in the injury pass.
        mods: { atkPct: num(bb.atk), batPct: Math.max(-0.9, num(bb.base_attack_time, 1) - 1), blockCnt: num(bb.block_cnt, 1), dodgePhys: S3 ? p : 0, dodgeArts: S3 ? p : 0 },
        onStart({ battle, unit, skill }) {
          const raw = skill.duration / Math.max(1, total);
          unit.mem.flame = { acc: 0, given: 0, step: stepOf('interval', raw, raw) };
          battle.fx('flame', { x: unit.x, y: unit.y, id: unit.id });
        },
        onTick({ battle, unit, dt }) {
          const F = unit.mem.flame;
          if (!F) return;
          F.acc += dt;
          let guard = 0;
          while (F.acc + 1e-9 >= F.step && F.given < total && guard++ < STEP_PER_TICK) { F.acc -= F.step; F.given++; battle.addDp(unit.ownerId, per, unit); } // loop-cap: stepOf interval
        },
        onEnd({ battle, unit, reason }) {
          const F = unit.mem.flame;
          unit.mem.flame = null;
          if (F && reason === 'duration' && F.given < total) battle.addDp(unit.ownerId, per * (total - F.given), unit);
        },
      },
      install(battle, unit) {
        const ma = num(tb.atk, 0), md = num(tb.def, 0); // module SOL-X: 阻挡敌人时攻击力和防御力各+8%
        if (ma || md) whileDeployed(battle, unit, 0.1, () => toggleBuff(battle, unit, 'flamtl:module', unit.blocking.length > 0, { atkPct: ma, defPct: md }));

      },
      talents: [
        { install(battle, unit) { // 前锋剑术: after a dodge the next attack hits twice and every blocked enemy
          battle.on('dodge', (c) => { if (c.target === unit) unit.mem.riposte = true; }, { owner: unit });
          battle.on('death', (c) => { if (c.unit === unit) unit.mem.riposte = unit.mem.riposteNow = false; }, { owner: unit });
          battle.on('beforeAttack', (c) => {
            if (c.attacker !== unit || !unit.mem.riposte) return;
            unit.mem.riposte = false;
            unit.mem.riposteNow = true;
            const extra = unit.blocking.filter((e) => e.alive && canTargetEnemy(unit, e, c.profile) && !c.targets.includes(e));
            c.targets = [...c.targets, ...extra];
          }, { owner: unit });
          battle.on('attack', (c) => {
            if (c.attacker !== unit || !unit.mem.riposteNow) return;
            unit.mem.riposteNow = false;
            for (const e of c.targets) if (e.alive) battle.dealDamage(unit, e, { amount: unit.s.atk * unit.s.atkScaleMul, type: 'phys', isAttack: true, tags: ['riposte'] });
            battle.fx('riposte', { x: unit.x, y: unit.y, id: unit.id });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 红松骑士团团长: 卡西米尔 operators +22 % physical dodge
          whileDeployed(battle, unit, AURA, () => { for (const a of battle.allies(unit.ownerId)) if (nationOf(a) === 'kazimierz') pulse(battle, a, 'flamtl:dodge', { dodgePhys: num(t1.prob, 0.22) }); });
        } },
      ],
    };
  },
});
