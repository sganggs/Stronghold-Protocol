// server/sim/content/kits/ops/op-irene.js — 艾丽妮 (char_4009_irene) 自选 operator kit: 6★ 剑豪 (近卫), an owned-6★ pick of
// the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and all three modules at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4009_irene, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json), PRTS 艾丽妮 (审判之火
// 备注: "计算伤害前有概率（地面）/必定（空中单位）获取永久的物理穿透（百分比）Buff（不可叠加，直接加算），该效果仅在成功造成伤害后
// 消耗", popup "对空中单位造成物理伤害时，不会占用随机数"; S3 备注 "技能范围内仅存在飞行单位时，该技能也可开启 / 技能动画为固定时长
// （3.5秒），不受攻击速度影响 / 快速轰击可对空，溅射半径1.1"), PRTS 分支特性信息 §剑豪, gamedata_const ba.levitate ("变为空中单位").
// - Trait (剑豪) "普通攻击连续造成两次伤害": the profession default (hits 2), ground-only melee on her 1-1. SWO-X “审判官口粮”
//   "技能造成的伤害提升10%" (trait bb damage_scale): her skill damage ×1.1; SWO-Y “厚重的经卷” "攻击时无视敌人70点的防御力"
//   (def_penetrate_fixed): defIgnoreFlat on all her damage; ISW-A “艾丽妮特限证章”: only its attributes act here — its
//   trait text and every talent part are 集成战略-only (battle_equip_table validInGameTag roguelike: 再部署 −60 %, +8 SP on
//   deploy, the stage-3 range effects) ⇒ N/A; its stage-3 审判之火 text keeps the base 50 % / 50 %.
// - T1 审判之火 "对敌人造成物理伤害时有50%概率无视其50%防御力，对空中单位概率提升至100%": per PRTS 备注, before each physical
//   damage instance she deals (normal or skill) she holds a 物理穿透 charge or draws one — always against an air unit (no
//   random draw; 浮空 enemies are air units, ba.levitate), with `prob` against a ground one — and the charge adds
//   def_penetrate to that instance's defIgnorePct; it is spent only by a damage instance that lands (a dodge or a cancel
//   keeps it, and while she holds one she draws nothing: 不可叠加); a buff on her, so a new deployment starts without one.
//   SWO-X stage 3: 55 % and "技能期间若击倒空中单位，技能结束时获得6点技力" — an air unit she knocks out while her skill
//   is active (S1's strike, S2's cut, S3's 3.5 s) gives her +sp SP once that skill ends.
// - T2 净化之剑 "攻击速度+18，场上有【海怪】敌人时效果翻倍" (full potential: +21): ASPD +attack_speed; SWO-Y stage 3 adds ATK
//   +5 % (the module talent change's atk); both doubled while a living 【海怪】 enemy (data tag seamonster) is on the field.
// - S1 起风 (AUTO, attack SP, DEFAULT): the next attack strikes its target once for atk_scale × ATK physical and levitates it
//   `levitate` s, then hits it again for atk_scale × ATK physical (her skeleton's Skill_1 clip: two OnAttack) — the second
//   hit meets an air unit when the levitation took.
// - S2 裂潮 (MANUAL, attack SP, 2 charges, 技能范围 3-12, data SKILL_RANGE): at once, up to max_target ground enemies of the
//   skill range take atk_scale × ATK physical, and those of 重量 ≤ value (3) are levitated `levitate` s. It cannot be opened
//   while its range holds no ground enemy at all [ASSUMED: PRTS's S3 note "仅存在飞行单位时，该技能也可开启" marks the opposite
//   as the rule for this ground-only skill; the strategy's SKILL_RANGE still counts unselectable ones, "无视其不可选中"].
// - S3 判决 (MANUAL, attack SP, 技能范围 x-1, data SKILL_RANGE — PRTS: opens with only flyers in range): every ground enemy of
//   the skill range takes atk_scale × ATK physical and is levitated `levitate` s, then multi_times (10) bombardments, one
//   every multi_hit_interval (0.3) s, each on a random enemy of the skill range (flyers included) hitting every enemy within
//   1.1 of it (中点判定; PRTS 溅射半径1.1, 可对空) for multi_atk_scale × ATK physical; the skill runs PRTS's fixed 3.5 s with
//   no normal attack [ASSUMED: the first bombardment one interval after the opening strike; a bombardment with no enemy in
//   the skill range is skipped].

import { num, talentBb, traitBb, skillRec, statBuff, toggleBuff, giveSp, onHitBy } from '../shared/tier1.js';
import { absoluteRangeKeys, sortEnemyTargets } from '../../../targeting.js';

const S1 = 'skchr_irene_1';
const S2 = 'skchr_irene_2';
const S3 = 'skchr_irene_3';
/** PRTS S3 备注: "技能动画为固定时长（3.5秒），不受攻击速度影响". */
const S3_DURATION = 3.5;
/** PRTS S3 备注: "快速轰击可对空，溅射半径1.1". */
const S3_SPLASH = 1.1;
/** The skill ranges when a record carries none (data: 3-12 and x-1). */
const R3_12 = Object.freeze([[1, 0], [1, 1], [0, 0], [0, 1], [0, 2], [0, 3], [-1, 0], [-1, 1]]);
const X_1 = Object.freeze([[2, 0], [1, -1], [1, 0], [1, 1], [0, -2], [0, -1], [0, 0], [0, 1], [0, 2], [-1, -1], [-1, 0], [-1, 1], [-2, 0]]);
const AIR = Object.freeze({ canHitFly: true });
const GROUND = Object.freeze({ canHitFly: false });

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** Absolute tile keys of a skill range at the unit's tile and facing (a 技能范围 ignores 攻击距离: no extend). */
const keysOf = (unit, grid) => absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, 0);
/** A living 【海怪】 enemy on the field. */
const seaMonsterOnField = (battle) => battle.enemies.some((e) => e.alive && !e.hidden && Array.isArray(e.def?.tags) && e.def.tags.includes('seamonster'));

export default {
  char_4009_irene: (bb, chess, def) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const tb = traitBb(chess);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s2 = skillRec(chess, S2), s3 = skillRec(chess, S3);
    const grid2 = s2?.rangeGrid ?? R3_12, grid3 = s3?.rangeGrid ?? X_1;
    const levitate = (battle, unit, e, s) => { if (e.alive && s > 0) battle.applyStatus(e, 'levitate', { duration: s, source: unit }); };

    return {
      skills: {
        [S1]: {
          kind: num(skillRec(chess, S1)?.maxChargeTime, 1) > 1 ? 'charges' : 'instant',
          attack: {
            atkScale: num(b1.atk_scale, 1),
            hits: 1, // the first strike; the follow-up below (Skill_1 clip: two OnAttack)
            onEachHit({ battle, unit, target, kind, attackId }) {
              if (kind !== 'main' || !target || target.side !== 'enemy' || !target.alive) return;
              levitate(battle, unit, target, num(b1.levitate));
              if (!target.alive || !unit.alive) return;
              battle.dealDamage(unit, target, { amount: unit.s.atk * num(b1.atk_scale, 1) * unit.s.atkScaleMul, type: 'phys', isAttack: true, isSkill: true, attackId, tags: ['skill'] });
            },
          },
        },
        [S2]: {
          kind: num(s2?.maxChargeTime, 1) > 1 ? 'charges' : 'instant',
          allyTargets: false,
          canActivate: (battle, unit) => battle.enemiesInKeys(keysOf(unit, grid2), unit, GROUND).length > 0,
          onStart({ battle, unit }) {
            const list = battle.enemiesInKeys(keysOf(unit, grid2), unit, GROUND);
            sortEnemyTargets(battle, unit, list, null);
            const v = list.slice(0, Math.max(1, Math.floor(num(b2.max_target, 1))));
            battle.fx('slash', { x: unit.x, y: unit.y, id: unit.id, n: v.length, skill: 'irene:tide' });
            for (const e of v) {
              battle.dealDamage(unit, e, { amount: unit.s.atk * num(b2.atk_scale, 1), type: 'phys', isSkill: true, tags: ['skill'] });
              // "使其中重量小于等于3的目标浮空"
              if (e.alive && e.weight <= num(b2.value, 3)) levitate(battle, unit, e, num(b2.levitate));
            }
          },
        },
        [S3]: {
          kind: 'duration',
          duration: S3_DURATION,
          ...(def?.skill?.trigger?.rule === 'SP_FULL' ? { trigger: 'SEARCH' } : {}),
          canActivate(battle, unit) {
            const keys = keysOf(unit, grid3);
            return battle.enemiesInKeys(keys, unit, AIR).length > 0
              || battle.allyTargetsInKeys(keys, unit).length > 0;
          },
          attack: { noAttack: true },
          // 白铁's 铁钳号·原型机 (a registered ally target) is struck like an enemy — the owner's rule of 2026-10-08; its kit
          // cancels the hits [ASSUMED: its strikes take it like a ground enemy of the skill range] (skills.js allyTargetsOk)
          allyTargets: true,
          onStart({ battle, unit }) {
            unit.mem.ireneS3 = { t: 0, n: 0 };
            const v = [...battle.enemiesInKeys(keysOf(unit, grid3), unit, GROUND), ...battle.allyTargetsInKeys(keysOf(unit, grid3), unit)];
            battle.fx('aoe', { x: unit.x, y: unit.y, radius: 1.5, id: unit.id, skill: 'irene:judgment' });
            for (const e of v) {
              battle.dealDamage(unit, e, { amount: unit.s.atk * num(b3.atk_scale, 1), type: 'phys', isSkill: true, tags: ['skill'] });
              levitate(battle, unit, e, num(b3.levitate));
            }
          },
          onTick({ battle, unit, dt }) {
            const m = unit.mem.ireneS3;
            if (!m) return;
            m.t += dt;
            const iv = Math.max(0.05, num(b3.multi_hit_interval, 0.3)), times = Math.max(0, Math.floor(num(b3.multi_times, 10)));
            while (m.n < times && m.t + 1e-9 >= (m.n + 1) * iv) { // loop-cap: interval floored at 0.05 and a slash count
              m.n++;
              const foes = battle.enemiesInKeys(keysOf(unit, grid3), unit, AIR);
              const cands = foes.length ? foes : battle.allyTargetsInKeys(keysOf(unit, grid3), unit);   // (the 铁钳号 when no enemy)
              if (!cands.length) continue;
              const c = battle.rng.pick(cands);
              battle.fx('aoe', { x: c.x, y: c.y, radius: S3_SPLASH, id: unit.id, skill: 'irene:judgment' });
              for (const e of [...battle.foesInRadius(c.x, c.y, S3_SPLASH, true), ...battle.allyTargetsInRadius(c.x, c.y, S3_SPLASH, unit)]) {
                battle.dealDamage(unit, e, { amount: unit.s.atk * num(b3.multi_atk_scale, 1), type: 'phys', isSkill: true, isSplash: e !== c, tags: ['skill'] });
              }
              if (!unit.alive || !unit.skill?.active) return;
            }
          },
          onEnd({ unit }) { unit.mem.ireneS3 = null; },
        },
      },
      talents: [
        { install(battle, unit) { // 审判之火: a 物理穿透 charge per physical instance (air: always, ground: prob), spent on landing
          const prob = num(t0.prob), pen = num(t0.def_penetrate), sp = num(t0.sp);
          // the charge is a buff on her: a new deployment starts without one (an operator leaving the field loses its buffs)
          battle.on('deploy', (ctx) => {
            if (ctx.unit !== unit) return;
            unit.mem.ireneCharge = false;
            unit.mem.ireneChargeDmg = null;
            unit.mem.ireneAirKill = false;
          }, { owner: unit });
          if (pen > 0) {
            onHitBy(battle, unit, (ctx) => {
              const d = ctx.dmg, m = unit.mem;
              if (d.type !== 'phys') return;
              if (!m.ireneCharge) m.ireneCharge = ctx.target.isFlying || (prob > 0 && battle.rng() < prob);
              if (!m.ireneCharge) return;
              d.defIgnorePct += pen;
              m.ireneChargeDmg = d;
            });
            battle.on('damaged', (c) => {
              if (c.source !== unit || !c.dmg || c.dmg !== unit.mem.ireneChargeDmg) return;
              unit.mem.ireneCharge = false;
              unit.mem.ireneChargeDmg = null;
            }, { owner: unit });
          }
          // SWO-X stage 3: an air unit knocked out during her skill ⇒ +sp SP when the skill ends
          if (sp > 0) {
            battle.on('death', (c) => {
              if (c.reason === 'killed' && c.killer === unit && c.unit?.side === 'enemy' && c.unit.isFlying && unit.skill?.active) unit.mem.ireneAirKill = true;
            }, { owner: unit });
            battle.on('skillEnd', (c) => {
              if (c.unit !== unit || !unit.mem.ireneAirKill) return;
              unit.mem.ireneAirKill = false;
              if (unit.alive) giveSp(unit, sp);
            }, { owner: unit });
          }
        } },
        { install(battle, unit) { // 净化之剑: ASPD (SWO-Y stage 3: ATK too), doubled while a 【海怪】 enemy is on the field
          const mods = { aspd: num(t1.attack_speed), atkPct: num(t1.atk) };
          statBuff(battle, unit, 'talent:irene:sword', mods);
          if (mods.aspd || mods.atkPct) {
            const extra = {};
            for (const [k, v] of Object.entries(mods)) if (v) extra[k] = v;
            toggleBuff(battle, unit, 'talent:irene:seamonster', () => seaMonsterOnField(battle), extra);
          }
        } },
      ],
      install(battle, unit) {
        // SWO-Y “厚重的经卷”: 攻击时无视敌人70点的防御力
        statBuff(battle, unit, 'trait:irene:pierce', { defIgnoreFlat: num(tb.def_penetrate_fixed) });
        // SWO-X “审判官口粮”: 技能造成的伤害提升10%
        const skillMul = num(tb.damage_scale, 1);
        if (skillMul !== 1) onHitBy(battle, unit, ({ dmg }) => { if (dmg.isSkill) dmg.mul *= skillMul; });
      },
    };
  },
};
