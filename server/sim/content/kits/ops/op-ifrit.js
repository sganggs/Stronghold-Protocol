// server/sim/content/kits/ops/op-ifrit.js — 伊芙利特 (char_134_ifrit) 自选 operator kit: 6★ 轰击术师 (术师), an owned-6★ pick
// of the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_134_ifrit, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); PRTS 伊芙利特 (炎爆 备注
// "灼伤：目标每秒受到伊芙利特当前攻击力33%的法术持续伤害，伊芙利特离场后也会生效" and "<模组相关>于伊芙利特在场时受模组基础效果影响";
// 灼地 备注 "属于维持技能状态，时间模式为跟随动画", "降低法术抗性的效果持续1秒"; 精神融解 备注 "<Δ模组>造成的元素伤害为持续伤害";
// “同熔” 特性 "目标距离自身0格或以上时应用加成，按距离线性提升，目标距离自身4格或以上时达到最大值"); PRTS 游戏数据基础 §维持技能状态;
// PRTS 分支特性信息 轰击术师 ("可对空", "普通攻击同时攻击范围内的所有敌人"); the client's battle data (battle/prefabs [uc]skills
// skchr_ifrit_1/2/3, [uc]equips ifrit_equip_*, charpack char_134_ifrit, buff_template_data: burn, atk_scale_by_distance,
// periodic_damage_by_hp_ratio[skip_modifier_fix], ifrit_e_002[sp] / [dice_sp], ifrit_e_003_tr, ifrit_e_003_ele) and her
// battle skeleton (Skill_2_Begin's OnAttack event).
// - Trait (轰击术师) "攻击造成超远距离的群体法术伤害": the profession's `rangeAoe` — every selectable enemy of her 5-1 line at
//   once, air units too, the same damage near and far (professions.js blastcaster).
// - Module BLA-X “同熔” (trait min_dist 0 / max_dist 4 / damage_scale 0.1): "距离越远伤害越高，最高达到110%" — ×(1 + 0.1 ×
//   clamp((d − 0) / (4 − 0), 0, 1)) by the Euclidean distance d between her and the target, on EVERY damage she outputs
//   while on the field (the module's buff atk_scale_by_distance: ON_OUTPUT_DAMAGE, no damage mask) — her attacks, the 灼地
//   ticks and the 炎爆 灼伤 (PRTS: "于伊芙利特在场时受模组基础效果影响"). Stage 3 also changes T2 (below).
// - Module BLA-D “热成形记忆” (trait ep_damage_ratio 0.08): "造成法术伤害时附带相当于8%伤害的灼燃损伤" (ifrit_e_003_tr: ON_AFTER_
//   OUTPUT_DAMAGE, every MAGICAL damage of hers) — 8 % of the HP damage dealt as 灼燃损伤 (`type: 'element'`, docs/SIM.md §7.2
//   element conventions), the 灼伤 too while she stands. Stage 3 also changes T1 (below).
// - T1 精神融解 "攻击范围内的敌军法术抗性-40%" (full potential: −44 %; magic_resistance −0.44: a ratio; charpack ifrit_t_1, removed
//   when the enemy leaves): RES ×0.56 on every enemy on her range, refreshed every AURA_IV s; several 伊芙利特 keep one
//   (applyStrongest — the mode's "同名效果取最高" convention; [ASSUMED] the client's independentCharacterSource flag would let
//   two stack, which a lone base-game 伊芙利特 never shows). BLA-D stage 2+ "若攻击目标处于灼燃损伤爆发期间，攻击对其额外造成
//   相当于攻击力50%的元素伤害" (the module's hidden talent element_atk_scale; ifrit_e_003_ele: IsTargetInEPBreakRecovery FIRE
//   ⇒ ELEMENT damage, attack type BUFF, 持续伤害): every hit of her attack abilities — normal attacks and the 灼地 ticks
//   (the equip adds it to the abilities of `_targetFamilyMask` 31, [ASSUMED] every family: 1 / 3 mark the narrower equips)
//   — on an enemy in its 灼燃 burst (its `burnBurst` lock) adds 50 % ATK 元素伤害 (`type: 'elemental'`), tagged 'dot'
//   (PRTS: "<Δ模组>造成的元素伤害为持续伤害"); never the 灼伤 (a buff's damage).
// - T2 莱茵回路 "每6秒额外回复2点技力" (full potential: every 5.5 s; periodic_sp; BLA-X stage 2+ ifrit_e_002[sp]): +sp SP every
//   `interval` s of a deployment (the first one interval in: waitFirstTriggerInterval; a gift during a running 狂热 / 灼地
//   is lost — no SP during a skill). BLA-X stage 2+ "有30%概率额外回复5点技力" (ifrit_e_002[dice_sp] prob / interval / sp):
//   one roll per its own interval.
// - S1 狂热 (MANUAL, data DEFAULT, 20 s): ATK +atk, ASPD +attack_speed.
// - S2 炎爆 (AUTO, 可充能 2 / 3 次, data DEFAULT — the "next attack" waits for her attack): the next attack hits her whole line
//   (ground and air: its selector's targetMotion ALL) for atk_scale × ATK; every enemy it hits gets the buff ifrit_s_2
//   (template burn): DEF +def (−100 / −200, "同名效果取最高") for `duration` (3.01) s and the 灼伤 — burn.atk_scale (33 %) × her
//   CURRENT ATK arts every second of it (triggerInterval 1, the first a second in: 3 ticks), a 持续伤害 (no dodge) that keeps
//   ticking after she leaves the field. A new 炎爆 on the same enemy restarts both.
// - S3 灼地 (MANUAL, data DEFAULT, 20 s): a 维持技能状态 — no normal attack. The ability (skchr_ifrit_3: `_triggerDelta` 1,
//   ground-only selector) strikes first at the attack event of its Begin clip (SCORCH_FIRST: 0.4 s; facing UP / DOWN the
//   back / down clips, 0.333 s) and then every S3_CADENCE (1) s — a fixed cadence no ASPD change touches: every ground enemy
//   on her range takes atk_scale × ATK arts and the active buff ifrit_s_3, RES +magic_resistance (−7 / −10, flat) for 1 s
//   (PRTS 备注) — the cut before the damage [ASSUMED order], so the tick it comes with counts it. Her own periodic_damage_by_
//   hp_ratio buff takes hp_ratio (2 %) of her max HP every second of the skill (the first a second in; a 流失 — it ignores
//   for SP and skips the damage events —, it can knock her out; PRTS "实际的生命流失量略低于标注值" gives no number [ASSUMED:
//   the stated 2 %]). 晕眩 / 冻结 (any state that stops her acting) ends it at once (PRTS 维持技能状态).

import { num, talentBb, moduleBb, traitBb, skillRec, up, giveSp } from '../shared/tier1.js';
import { stepOf, STEP_PER_TICK } from '../../../../../shared/plugins/steps.js';
import { bodyInRange } from '../../../body.js';
import { hasHp } from '../../../attack.js';
import { hypot } from '../../../detmath.js';

const S1 = 'skchr_ifrit_1';
const S2 = 'skchr_ifrit_2';
const S3 = 'skchr_ifrit_3';
/** T1 aura refresh period and buff length (the non-stacking aura convention of the kits). */
const AURA_IV = 0.25;
const AURA_DUR = 0.4;
/** S3 灼地: the ability's `_triggerDelta` (s) — one damage tick per second, "每秒". */
const S3_CADENCE = 1;
/** S3 灼地: the first tick at the OnAttack event of Skill_2_Begin (front 0.4 s; the back clip and Skill_Down_2_Begin 0.333 s). */
const SCORCH_FIRST = Object.freeze({ side: 0.4, vertical: 0.333 });
/** S3 灼地 RES cut length (ifrit_s_3 lifeTime 1; PRTS 备注 "降低法术抗性的效果持续1秒"). */
const S3_RES_TIME = 1;
/** S3 灼地 self 流失 period (periodic_damage_by_hp_ratio triggerInterval 1). */
const S3_LOSS_IV = 1;
const MELT_KEY = 'ifrit:meltdown';
const S2_DEF_KEY = 'ifrit:pyroDef';
const S2_BURN_KEY = 'ifrit:pyroBurn';
const S3_RES_KEY = 'ifrit:scorchRes';
const SCORCH_TAG = 'ifrit:scorch';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** RES cut mods for a blackboard magic_resistance value (applyStrongest): |v| < 1 = ×(1 + v), else flat v. */
const resCut = (v) => (Math.abs(v) < 1 ? { resMul: Math.max(0, 1 + v) } : { resFlat: v });
const defCut = (v) => ({ defFlat: v });

/** S2 炎爆 on one enemy its attack hit: DEF cut and the 灼伤 for `duration` s. */
function pyroclasm(battle, unit, e, b2) {
  if (!e || !e.alive || e.side !== 'enemy') return;
  const dur = num(b2.duration, 3);
  const d = num(b2.def);
  if (d) battle.applyStrongest(e, S2_DEF_KEY, { duration: dur, value: d, mods: defCut, source: unit });
  const sc = num(b2['burn.atk_scale']);
  if (!(sc > 0)) return;
  battle.addBuff(e, {
    key: S2_BURN_KEY, duration: dur, interval: 1, source: unit, tags: ['dot'],
    // "伊芙利特当前攻击力": her ATK at each tick; it ticks on after she leaves the field (PRTS 备注)
    onTick: ({ battle: b, unit: tgt }) => b.dealDamage(unit, tgt, { amount: unit.s.atk * sc, type: 'arts', isSkill: true, canDodge: false, tags: ['dot', 'skill', 'ifrit:burn'] }),
  });
}

/** S3 灼地 tick: every ground enemy on her range — the RES cut, then the damage. */
function scorch(battle, unit, b3) {
  const scale = num(b3.atk_scale), mr = num(b3.magic_resistance);
  const victims = battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: false });
  for (const e of victims) {
    if (mr) battle.applyStrongest(e, S3_RES_KEY, { duration: S3_RES_TIME, value: mr, mods: resCut, source: unit });
    if (e.alive && scale > 0) battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'arts', isSkill: true, tags: ['skill', SCORCH_TAG] });
  }
  battle.fx('flame', { x: unit.x, y: unit.y, id: unit.id, n: victims.length, skill: SCORCH_TAG });
}

export default {
  char_134_ifrit: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const hidden = moduleBb(chess);   // BLA-D stage 2+: element_atk_scale
    const tb = traitBb(chess);        // BLA-X: min_dist / max_dist / damage_scale; BLA-D: ep_damage_ratio
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s2 = skillRec(chess, S2);
    return {
      skills: {
        [S1]: { kind: 'duration', mods: { atkPct: num(b1.atk), aspd: num(b1.attack_speed) } },
        [S2]: {
          kind: num(s2?.maxChargeTime, 1) > 1 ? 'charges' : 'instant',
          attack: {
            atkScale: num(b2.atk_scale, 1),
            onEachHit({ battle, unit, target }) { pyroclasm(battle, unit, target, b2); },
          },
          onStart({ battle, unit }) { battle.fx('aoe', { x: unit.x, y: unit.y, radius: 0.5, id: unit.id, skill: 'ifrit:pyroclasm' }); },
        },
        [S3]: {
          kind: 'duration',
          attack: { noAttack: true },
          onStart({ unit }) {
            unit.mem.scorchAt = 0;
            unit.mem.scorchNext = unit.dir === 'UP' || unit.dir === 'DOWN' ? SCORCH_FIRST.vertical : SCORCH_FIRST.side;
            unit.mem.scorchLoss = 0;
          },
          onTick({ battle, unit, skill, dt }) {
            // 维持技能状态: a hard control (晕眩 / 冻结 / 浮空 / 睡眠 — the unit cannot act) ends it at once
            if (!unit.canAct) { skill.end('interrupted'); return; }
            const t = (unit.mem.scorchAt = (unit.mem.scorchAt ?? 0) + dt);
            while (t >= unit.mem.scorchNext - 1e-6 && unit.alive && skill.active) { // loop-cap: constant S3_CADENCE
              unit.mem.scorchNext += S3_CADENCE;
              scorch(battle, unit, b3);
            }
            const ratio = num(b3.hp_ratio);
            while (ratio > 0 && t >= (unit.mem.scorchLoss + 1) * S3_LOSS_IV - 1e-6 && unit.alive) { // loop-cap: constant S3_LOSS_IV
              unit.mem.scorchLoss++;
              battle.loseHp(unit, unit.s.maxHp * ratio, { source: unit, tags: ['skill', SCORCH_TAG] });
            }
          },
        },
      },
      talents: [
        { install(battle, unit) { // 精神融解: RES −44 % on her range; BLA-D stage 2+: +50 % ATK 元素伤害 on a bursting target
          const v = num(t0.magic_resistance);
          if (v) {
            battle.every(AURA_IV, () => {
              if (!up(unit) || !unit.rangeKeySet) return;
              for (const e of battle.enemies) {
                if (!e.alive || e.hidden || !bodyInRange(e, unit.rangeKeySet)) continue;
                battle.applyStrongest(e, MELT_KEY, { duration: AURA_DUR, value: v, mods: resCut, source: unit });
              }
            }, { owner: unit, immediate: true });
          }
          const ex = num(hidden.element_atk_scale);
          if (ex > 0) {
            battle.on('damaged', (c) => {
              const e = c.target, d = c.dmg;
              if (c.source !== unit || !d || !(d.isAttack || d.tags?.includes(SCORCH_TAG)) || !e || e.side !== 'enemy' || !hasHp(e) || !e.findBuff('burnBurst')) return;
              battle.dealDamage(unit, e, { amount: unit.s.atk * ex, type: 'elemental', element: 'burn', canDodge: false, tags: ['dot', 'module', 'ifrit:meltdown'] });
            }, { owner: unit });
          }
        } },
        { install(battle, unit) { // 莱茵回路: +sp SP every interval s; BLA-X stage 2+: prob to +5 SP more
          const sp = num(t1.sp), iv = stepOf('interval', num(t1.interval, 6), 6);
          const dProb = num(t1['ifrit_e_002[dice_sp].prob']), dSp = num(t1['ifrit_e_002[dice_sp].sp']);
          const dIv = stepOf('ifrit_e_002[dice_sp].interval', num(t1['ifrit_e_002[dice_sp].interval'], iv), iv);
          if (!(sp > 0 && iv > 0) && !(dProb > 0 && dSp > 0 && dIv > 0)) return;
          battle.on('deploy', (c) => { if (c.unit === unit) { unit.mem.rhineAcc = 0; unit.mem.rhineDice = 0; } }, { owner: unit });
          battle.on('tick', ({ dt }) => {
            if (!up(unit)) return;
            if (sp > 0 && iv > 0) {
              unit.mem.rhineAcc = (unit.mem.rhineAcc ?? 0) + dt;
              let guard = 0;
              while (unit.mem.rhineAcc >= iv - 1e-6 && guard++ < STEP_PER_TICK) { unit.mem.rhineAcc -= iv; giveSp(unit, sp); } // loop-cap: stepOf interval
            }
            if (dProb > 0 && dSp > 0 && dIv > 0) {
              unit.mem.rhineDice = (unit.mem.rhineDice ?? 0) + dt;
              let guard = 0;
              while (unit.mem.rhineDice >= dIv - 1e-6 && guard++ < STEP_PER_TICK) { // loop-cap: stepOf interval
                unit.mem.rhineDice -= dIv;
                if (battle.rng.chance(dProb)) giveSp(unit, dSp);
              }
            }
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // BLA-X “同熔”: farther targets take more of every damage she outputs (up to ×1 + damage_scale at max_dist tiles)
        const ds = num(tb.damage_scale);
        if (ds > 0 && tb.max_dist != null) {
          const lo = num(tb.min_dist), hi = num(tb.max_dist, 4);
          battle.on('hit', (c) => {
            const e = c.target;
            if (c.source !== unit || !e || e.side !== 'enemy' || c.dmg.type === 'element' || !up(unit)) return;
            const d = hypot(e.x - unit.x, e.y - unit.y);
            c.dmg.mul *= 1 + ds * (hi > lo ? Math.max(0, Math.min(1, (d - lo) / (hi - lo))) : 1);
          }, { owner: unit });
        }
        // BLA-D “热成形记忆”: 8 % of each arts damage she deals as 灼燃损伤
        const ep = num(tb.ep_damage_ratio);
        if (ep > 0) {
          battle.on('damaged', (c) => {
            const e = c.target;
            if (c.source !== unit || c.type !== 'arts' || !(c.amount > 0) || !e || e.side !== 'enemy' || !hasHp(e) || !up(unit)) return;
            battle.dealDamage(unit, e, { type: 'element', element: 'burn', amount: c.amount * ep, tags: ['module', 'ifrit:thermal'] });
          }, { owner: unit });
        }
      },
    };
  },
};
