// server/sim/content/kits/ops/chess_char_3_06-philae.js — 菲莱 (char_4148_philae) kit, tier 3.
// Conventions of the tier-3 kits: ../shared/tier3.js; kit contract and rules: ../README.md.

import { num, defOf, talentBb, traitBb, selectedId, altSkills, fx, NINE, giveSp } from '../shared/tier3.js';
import { isHpLoss } from '../../../attack.js';
import { canTargetEnemy } from '../../../targeting.js';

// Native philae_s_2[ep]: wait for its first 0.0334 s trigger; not derived from the skill buff.
// [ASSUMED] The shared 30 Hz scheduler discretizes this authored interval; native intra-frame phase is unavailable.
const BLAST_DELAY = 0.0334;

export default {
  // ---- 3_06 菲莱 · 本源铁卫 — S2 冥河诅咒: stops attacking, HP +; "受到攻击时" — any damage instance she takes (official
  //      philae_s_2: ON_TAKE_DAMAGE with no source or attack filter) — blasts the ground enemies of the 3×3 around her
  //      (PRTS 备注: range x-4; arts + ep_damage_ratio × ATK apoptosis, aoe_cd); ATK + once hit by element
  //      damage; 神河谕使: 元素损伤 taken −damage_resistance, +SP on apoptosis
  //      精锐 module PRP-X "阻挡敌人时，自身造成的元素损伤提升15%": EVERY element fill she deals (the S2 blast, a 灼燃维式重锤
  //      she carries …) ×ep_damage_scale while she blocks — an `elementHit` multiplier, like 余's
  //      S1 灵河护佑 (TAKE_DAMAGE): HP +, clears her element gauges and gives a shield_value 损伤屏障 (absorbs element
  //      damage — gauge fills — until spent or the skill ends)
  // 神河谕使 and the barrier act on the element hit before it lands (PRTS 备注: "减伤与技力回复效果于伤害计算前处理；即使
  // 受到0点的凋亡损伤依然可以回复技力", "损伤屏障于伤害计算前、第一天赋后处理"): the talent's cut and SP first (priority 20),
  // then the barrier absorbs what is left (`dmg.amount × dmg.mul`). The cut is a 元素损伤 multiplier (PRTS 元素 "受到的
  // 元素损伤 = 损伤值 × (1 − 损伤抵抗 × 0.01)，后续可应用元素损伤倍率提升/降低等效果"), not `elemTakenMul` (元素伤害 / 元素脆弱).
  chess_char_3_06_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0);
    const tb = traitBb(d);
    const sel = selectedId(chess, d);
    const S1 = 'skchr_philae_1', S2 = 'skchr_philae_2';
    const isS2 = sel === S2 || sel == null;
    const scale = num(bb.atk_scale, 1);
    const ep = num(bb.ep_damage_ratio, 0);
    const cd = num(bb.aoe_cd, 2);
    const epScale = num(tb.ep_damage_scale, 1);
    const cut = Math.max(0, Math.min(1, num(t0.damage_resistance)));
    // 损伤屏障 of S1: absorbs the gauge gain an element hit would add (after 神河谕使)
    const installBarrier = (battle, unit) => {
      battle.on('elementHit', (ctx) => {
        if (ctx.target !== unit || !(unit.mem.philaeBarrier > 0) || !unit.skill?.active) return;
        const dmg = ctx.dmg;
        const eff = num(dmg.amount) * num(dmg.mul, 1);
        if (!(eff > 0)) return;
        const take = Math.min(unit.mem.philaeBarrier, eff);
        unit.mem.philaeBarrier -= take;
        if (take >= eff - 1e-9) dmg.cancel = true;
        else dmg.amount *= (eff - take) / eff;
        if (!(unit.mem.philaeBarrier > 0)) fx(battle, 'shieldBreak', unit, { element: true });
      }, { owner: unit });
    };
    return {
      skill: {
        kind: 'duration',
        mods: { hpPct: num(bb.max_hp) },
        attack: { noAttack: true },
        onStart({ battle, unit }) {
          unit.mem.philaeCd = -Infinity;
          battle.addBuff(unit, { key: 'philae:counter', tags: ['skill'], observeInjury(ctx) {
            if (!unit.alive) return;
            const sk = unit.skill;
            // the official philae_s_2 (buff_template_data) fires on ON_TAKE_DAMAGE with no filter: any damage instance — an
            // enemy's attack, a skill hit or a 无来源 hit, including descriptive counter/reflect tags.
            // HP loss and element gauges do not enter this ordinary injury event.
            const d = ctx.dmg;
            if (!isS2 || !sk || !sk.active || !d || isHpLoss(d)) return;
            if (battle.time < (unit.mem.philaeCd ?? -Infinity)) return;
            unit.mem.philaeCd = battle.time + cd;
            // "周围的地面敌人" = range x-4, the 3×3 tiles around her (PRTS 备注)
            for (const e of battle.unitsInGrid(unit, NINE, { side: 'enemy' })) {
              if (!canTargetEnemy(unit, e, { groundOnly: true })) continue;
              // Native creates a non-derived buff on each selected target; leaving range or ending S2 does not revoke it.
              battle.after(BLAST_DELAY, () => {
                if (!e.alive) return;
                battle.dealDamage({ source: unit, target: e, amount: unit.s.atk * scale, type: 'arts',
                  attackType: 'NORMAL', applyWay: 'NONE', calculation: 'precomputed',
                  isSkill: true, tags: ['skill', 'counter'] });
                if (ep > 0 && e.alive) battle.dealElementDamage({ source: unit, target: e, element: 'apoptosis', amount: unit.s.atk * ep, tags: ['skill'] });
              }, { owner: e });
            }
            fx(battle, 'aoe', unit, { radius: 1.5, tiles: 'box', dmgType: 'arts', skill: 'philae_2' }); // box: the 3×3 tiles
          } });
        },
        onEnd({ battle, unit }) { battle.removeBuff(unit, 'skill:philae_rage'); battle.removeBuff(unit, 'philae:counter'); },
      },
      skills: altSkills(chess, d, bb, {
        [S1]: (s) => ({
          kind: 'duration',
          mods: { hpPct: num(s.bb.max_hp) },
          onStart({ battle, unit }) {
            battle.healElement({ target: unit, amount: unit.gaugeMax }); // "立刻清除自身的元素损伤" (a gauge locked by a running burst stays)
            unit.mem.philaeBarrier = num(s.bb.shield_value, 0);
            fx(battle, 'shield', unit, { element: true, n: unit.mem.philaeBarrier });
          },
          onEnd({ unit }) { unit.mem.philaeBarrier = 0; },
        }),
      }),
      talents: [{ install(battle, unit) {
        // 神河谕使 (every skill): 元素损伤 taken ×(1 − damage_resistance); "受到凋亡损伤时回复2点技力" — even for 0 damage
        battle.on('elementHit', (ctx) => {
          const dmg = ctx.dmg;
          if (ctx.target !== unit || !dmg || dmg.type !== 'element') return;
          if (dmg.element === 'apoptosis' && !unit.skill?.active) giveSp(unit, num(t0.sp), 'talent');
          if (cut > 0) dmg.mul *= 1 - cut;
        }, { owner: unit, priority: 20 });
      } }],
      install(battle, unit) {
        if (sel === S1) installBarrier(battle, unit);
        // module PRP-X: her element damage ×ep_damage_scale while she blocks
        if (epScale > 1) {
          battle.on('elementHit', (ctx) => {
            if (ctx.source === unit && ctx.dmg?.type === 'element' && ctx.target?.side === 'enemy' && unit.blocking.length) ctx.dmg.mul *= epScale;
          }, { owner: unit });
        }
        battle.on('elementHit', ctx => {
          if (ctx.target === unit && unit.alive && isS2 && unit.skill?.active && !unit.findBuff('skill:philae_rage')) {
            battle.addBuff(unit, { key: 'skill:philae_rage', mods: { atkPct: num(bb.atk) }, visible: true });
          }
        }, { owner: unit });
      },
    };
  },
};
