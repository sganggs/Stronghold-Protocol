// server/sim/content/kits/ops/chess_char_1_19-wildmn.js — 野鬃 (char_496_wildmn) kit, tier 1.
// Conventions of the tier-1 kits: ../shared/tier1.js; kit contract and rules: ../README.md.

import { num, talentBb, skillRec } from '../shared/tier1.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 1_19 野鬃 夹枪冲锋: wider range (skill grid), ATK +atk, "攻击会把目标往攻击方向中等力度地推开" (attack@force 1 = 中力) by
  // the official 力度 − 重量 distance (Battle.push: weight 0 → 2.14 tiles, 1 → 1.7, 2 → 0.44, 3 → 0.12, ≥ 4 → none; user
  // playtest #6 item 14). A directional push (方向力, PRTS 推与拉): the client's S2 attack ability (charpack
  // char_496_wildmn, anim Skill_2) carries buff wildmn_s_2[force] of template knockback[dir] — buff_template_data:
  // Knockback {_useSourceDirection: true, _decreaseForceLevelWhenNotInDirection: 2} — along her deploy direction,
  // and 受力等级 −2 when the target is > 45° off it or < 0.25 tile away (特殊修正). PRTS 推与拉 also turns that push
  // radial (away from her), including behind her. Maintainer decision 2026-10-19 and the official recordings
  // (#782, DESIGN §35.10) supersede round 40's `keepDir` exception. Her visual attack turn does not change `fwd`.
  // Rear weight-1 hits move ~14 px / ~154 px per tile = ~0.09 tile: the PRTS 特效 row at level −2 (0.085).
  // [ASSUMED] Use that column only behind her to preserve the task's explicit front-unchanged scope. The footage
  // also suggests the 特效 column in front (~1.56 tiles); it does not establish an official rear-only classification.
  // Other rear weights / unrecorded angles use the same PRTS column [ASSUMED].
  // Side / near-front hits retain their existing distances. See §35.10.
  // 一致向前: after deploying (normal flag 0: first deployment only; elite flag 1: every deployment) every undeployed
  // 【近卫】 operator of the player costs `value` less DP to deploy (≤ max_stack_cnt per operator until it deploys).
  // Alternate S1 骑枪刺击 (PASSIVE, ON_DEPLOY): for `duration` s after every deployment ASPD +attack_speed.
  // Elite module CHG-X (+2 DP per kill) is the charger profile of the module trait (TUNE.charger).
  chess_char_1_19_a: (bb, chess, def) => {
    const t = talentBb(chess, 0);
    const force = num(bb['attack@force'], 1);
    const r1 = skillRec(chess, 'skchr_wildmn_1');
    return {
      skills: {
        skchr_wildmn_1: {
          kind: 'duration', activateOnDeploy: true, duration: num(r1?.duration), spCost: 0, spType: 'none', trigger: 'NEVER',
          mods: { aspd: num(r1?.bb?.attack_speed) },
        },
      },
      skill: {
        kind: 'duration', mods: { atkPct: num(bb.atk) },
        targeting: { rangeGrid: def?.skill?.rangeGrid ?? null },
        attack: {
          onHit({ battle, unit, target }) {
            if (!target || !target.alive || target.side !== 'enemy') return;
            const dir = { x: unit.fwd[1], y: unit.fwd[0] };
            const behind = (target.x - unit.x) * dir.x + (target.y - unit.y) * dir.y < 0;
            battle.push(target, force, { from: unit, dir, effect: behind });
          },
        },
      },
      talents: [{ install(battle, unit) {
        const cut = Math.abs(num(t.value, -1)), cap = num(t.max_stack_cnt, 1), every = num(t.flag) === 1;
        let deploys = 0;
        battle.on('deploy', ({ unit: u }) => {
          if (u === unit) {
            deploys++;
            if (!every && deploys > 1) return;
            for (const a of battle.allyUnits) {
              if (a === unit || a.kind !== 'op' || a.ownerId !== unit.ownerId || a.alive || a.removed || a.def.profession !== 'WARRIOR') continue;
              const done = a.mem.wildmnCut ?? 0;
              const d = Math.min(cut, cap - done, a.base.cost);
              if (d > 0) { a.base.cost -= d; a.mem.wildmnCut = done + d; }
            }
          } else if (u.mem.wildmnCut > 0) {
            // the discount is consumed by this deployment
            u.base.cost += u.mem.wildmnCut;
            u.mem.wildmnCut = 0;
          }
        }, { owner: unit });
      } }],
    };
  },
};
