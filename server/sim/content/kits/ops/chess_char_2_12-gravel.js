// server/sim/content/kits/ops/chess_char_2_12-gravel.js — 砾 (char_237_gravel) kit, tier 2.
// Conventions of the tier-2 kits: ../shared/tier2.js; kit contract and rules: ../README.md.

import { num, talentBb, installAura } from '../shared/tier1.js';

/**
 * 砾's normal attack (PRTS 砾 特性备注): "在砾的攻击动作下，每次普通攻击造成两段伤害，但是每段最终只会造成50%的伤害（在计算防御/减伤后，在
 * 重设伤害前）；第二段伤害不会触发目标的受击回复" — two damage instances of 50 % 伤害倍率 each (DamageInfo `mul`, after DEF: not a 50 %
 * 攻击倍率), so a 频次 enemy loses 2 per attack; the second carries no 受击回复 (ai.js resolveHit `hitDmgMul`). Every attack she
 * makes is a normal attack (both her skills are passive).
 */
const GRAVEL_HITS = 2;
const GRAVEL_HIT_DMG_MUL = 0.5;

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 2_12 砾 鼠群 (passive): at each deployment a barrier of hp_ratio × max HP that decays to 0 over `duration` s
  // (capacity stepped once per second; a damaged barrier shrinks in proportion — PRTS).
  // 快速部署: own deployment cost +cost (−1). Elite 小个子支援: every unit whose initial deployment cost ≤ cond.cost
  // DEF +def while 砾 is on the field. (Elite module withdraw refund: no manual retreat in battle ⇒ no effect.)
  // S1 影袭 (alt, passive): at each deployment DEF +def, decaying linearly to 0 over `duration` s, updated once per
  // second (PRTS: "防御力加成每秒更新一次"). Trait note: every normal attack hits twice at 50 % (GRAVEL_HIT_DMG_MUL above).
  chess_char_2_12_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    // 鼠群 stays reachable when 影袭 is the chess default (规程).
    const rats = {
        kind: 'duration', activateOnDeploy: true, duration: num(bb.duration, 10), spCost: 0, spType: 'none', trigger: 'NEVER',
        onStart({ battle, unit }) {
          const total = unit.s.maxHp * num(bb.hp_ratio);
          const dur = num(bb.duration, 10);
          if (!(total > 0) || !(dur > 0)) return;
          let k = 0;
          battle.addBuff(unit, {
            key: 'gravel:rats', shield: total, duration: dur, interval: 1, visible: true, tags: ['skill'],
            // PRTS: "屏障最大容量每秒更新一次；受到伤害后，剩余容量根据屏障最大容量等比变化" — the capacity steps down
            // once per second and what is left of the barrier scales with it (never a plain cap)
            onTick: ({ unit: u, buff }) => {
              const prev = Math.max(0, dur - k) / dur;
              k++;
              const next = Math.max(0, dur - k) / dur;
              if (prev > 0 && buff.shield > 0) { buff.shield *= next / prev; u.markDirty(); }
            },
          });
          battle.fx('shield', { x: unit.x, y: unit.y, id: unit.id });
        },
        onEnd({ battle, unit }) { battle.removeBuff(unit, 'gravel:rats'); },
    };
    return {
      trait: { hits: GRAVEL_HITS, hitDmgMul: GRAVEL_HIT_DMG_MUL },
      skill: rats,
      skills: {
        skchr_gravel_2: rats,
        skchr_gravel_1: {
          kind: 'duration', activateOnDeploy: true, duration: num(bb.duration), spCost: 0, spType: 'none', trigger: 'NEVER',
          onStart({ battle, unit }) {
            const v = num(bb.def), dur = num(bb.duration);
            if (!(v > 0) || !(dur > 0)) return;
            let k = 0;
            battle.addBuff(unit, {
              key: 'gravel:shadow', duration: dur, mods: { defPct: v }, interval: 1, visible: true, tags: ['skill'],
              onTick: ({ unit: u, buff }) => {
                k++;
                buff.mods = { defPct: v * Math.max(0, dur - k) / dur };
                u.markDirty();
              },
            });
            battle.fx('buff', { x: unit.x, y: unit.y, id: unit.id, kind: 'def' });
          },
          onEnd({ battle, unit }) { battle.removeBuff(unit, 'gravel:shadow'); },
        },
      },
      talents: [{ install(battle, unit) {
        const c = num(t.cost);
        if (c) unit.base.cost = Math.max(0, unit.base.cost + c);
        const d = num(t.def), lim = t['cond.cost'];
        if (d && lim != null) installAura(battle, unit, { key: 'talent:gravel', value: d, select: (a) => num(a.def?.stats?.cost, Infinity) <= num(lim), mods: { defPct: d } });
      } }],
    };
  },
};
