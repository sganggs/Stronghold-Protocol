// server/sim/content/kits/ops/op-zuole.js — 左乐 (char_4121_zuole) 自选 operator kit: 6★ 武者 (近卫), an owned-6★ pick of
// the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4121_zuole, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); PRTS 左乐 (S2 / S3
// 备注); the client's buff templates (buff_template_data `zuole_trait`, `zuole_t_2`, `zuole_s_2[shield]` /
// `[shield_core]`, `zuole_s_3` / `[shield]`, `zuole_e_002[resistance]`, `zuole_e_003_talent`, `zuole_e_003_trait`);
// Arknights Terra Wiki "Zuo Le" (the barrier caps count each skill's own barrier only).
// - Trait (武者) "不成为其他角色的治疗目标，每次攻击到敌人后回复自身70生命": the profession default (musha: no heal from
//   others; zuole_trait heals on every damage he outputs — the profession heals `value` per damage instance, PRTS 分支特性信息
//   武者, so S1's extra strikes heal too).
// - T1 秉烛照影 "在场时，自身获得最高+50攻击速度和技力自然回复速度+2/秒的坚忍（损失70%生命值时达到最大加成）" (bb
//   min_attack_speed / min_sp_recovery_per_sec / min_hp_ratio): 坚忍 (ba.berserk "根据已损失的生命值获得相应比例的属性
//   加成") — ASPD and SP recovery × min(1, lost HP ÷ (1 − min_hp_ratio)) while he is deployed. SBL-X stage 3: +70 /
//   +2.3 / at 50 % lost (the module talent's bb).
// - T2 守正自明 "攻击时有20%的概率获得1点技力，生命低于50%时概率变为70%" (full potential: 23 % / 75 %; bb prob_1 / prob_2 /
//   hp_ratio / sp): zuole_t_2 rolls on every damage he outputs (ON_OUTPUT_DAMAGE — skill damage too), prob_2 below hp_ratio.
//   SBL-Y stage 3 (zuole_e_003_talent, ON_CALCULATE_DAMAGE): "…且当次攻击的攻击力提升至120%…80%" (full potential: 85 %): a
//   success also scales that damage instance by atk_scale.
// - Module SBL-X “岂苦夜长” (trait moduleDesc "生命值低于50%时，获得25%的庇护"; the hidden part merged into the first talent's
//   bb: hp_ratio / damage_resistance): 庇护 (ba.protect "受到的物理和法术伤害降低相应比例（同名效果取最高）": the shared effect of
//   every source, tier1.js holdProtect) while HP < hp_ratio
//   (zuole_e_002[resistance]: the 庇护 buff is created when HP drops below it and finished when it is back). PRTS S2 备注:
//   行险 resets it, it comes back 0.1 s later "并因此导致庇护的BUFF顺序落后于本技能的屏障" — a 庇护 created after his
//   barrier cuts only what passes the barrier (the `hpDamage` hook), one created before it cuts the hit first.
// - Module SBL-Y “秉烛人的记录” (trait bb hp_ratio): "被击倒时不撤退且回复30%生命（单次部署只触发1次）" — the first lethal
//   hit of a deployment is prevented and he heals hp_ratio × max HP (zuole_e_003_trait[heal] HealViaMaxHpRatio, 无视禁疗);
//   not while a 不死 already holds him ("_dontConsumeWhenUndeadable": 坚固维式重锤's window, items/battle.js holdsUndying).
// - S1 破虏 (AUTO, 可充能 2 次): the next attack at atk_scale × ATK; "自身生命低于80%时额外攻击1次，低于50%时额外攻击2次"
//   (hp_ratio_double / hp_ratio_tripple): one / two more strikes on that target at the same scale, separate damage
//   instances [ASSUMED: the same target — nothing when it fell; the HP read when the skill fires, before the strike's
//   own trait heal]. The data's DEFAULT trigger (an AUTO "next attack").
// - S2 行险 (MANUAL, 12 s): "立即流失50%当前生命" (zuole_s_2[shield] DamageViaCurHpRatio, undeadable: never below 1 HP;
//   a 流失), then a barrier of scale × max HP (ba.barrier "可以吸收一定数值的伤害") added to the one he still has, capped at
//   max_scale × max HP at each gain (PRTS "上限于每次获取屏障时实时发生变化"; Terra: the cap counts this skill's barrier
//   only); ATK +atk, block +block_cnt, every blocked enemy struck at once. Once the skill is over the barrier loses
//   −shield_decrease every second (PRTS "技能结束时屏障以每秒-200点的速度流失"; zuole_s_2[shield_core] ON_BUFF_TRIGGER).
// - S3 佑序有炎 (MANUAL, data SKILL_RANGE on its 3-2): 7 slashes ("立刻…": all in the cast instant [ASSUMED: the kits'
//   instant convention — his skeleton's 2 s Skill_3 clip spreads its 7 OnAttack events over 0.2 … 1.2 s, and the engine
//   models no animation lock]), each on at most 3 enemies of the skill range (the 3 is the text's: no
//   blackboard key; air units too [ASSUMED: no 对空 note — docs/SIM.md §8]) for atk_scale × ATK physical, the last
//   ×last_atk_bonus and 晕眩 `stun` s (zuole_s_3: AtkScaleUp once spell_times reaches times). Meanwhile the trait heals
//   nothing (zuole_trait "CheckContainsBuff zuole_s_3 → IfNot → heal") and every damage instance he outputs adds
//   value × shield_scale to a barrier (zuole_s_3 ON_OUTPUT_DAMAGE; PRTS "屏障获取不经过治疗流程，不受治疗倍率等影响"), capped
//   at max_scale × max HP at each gain, lasting shield_duration s from the latest gain (PRTS "每次获取屏障时重置剩余持续
//   时间为15s").

import { num, talentBb, traitBb, up, onHitOn, giveSp, skillRec, holdProtect, PROTECT, PROTECT_TICK_HOLD } from '../shared/tier1.js';
import { bbCap } from '../../../../../shared/plugins/officialBounds.js';
import { absoluteRangeKeys, sortEnemyTargets } from '../../../targeting.js';
import { isHpLoss } from '../../../attack.js';
import { holdsUndying } from '../../items/battle.js';

const S1 = 'skchr_zuole_1';
const S2 = 'skchr_zuole_2';
const S3 = 'skchr_zuole_3';
/** S3 "每次对最多3名敌人" — in the text only (no blackboard key). */
const S3_TARGETS = 3;
/** PRTS S2 备注 "庇护BUFF于技能开启0.1s后重新判定并生效". */
const PROTECT_RESET = 0.1;
/** zuole_s_2[shield_core] decays once per trigger: "每秒-200点" (PRTS S2 备注). */
const S2_DECAY_EVERY = 1;
const S2_BARRIER = 'skill:zuole:barrier2';
const S3_BARRIER = 'skill:zuole:barrier3';
const BERSERK = 'talent:zuole:berserk';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** The barrier of his skill he holds (one skill per pick), or null. */

export default {
  char_4121_zuole: (bb, chess) => {
    const tb = traitBb(chess);
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s1 = skillRec(chess, S1), s3 = skillRec(chess, S3);
    const healValue = num(tb.value, 70);
    // SBL-X 庇护 (merged into the first talent's bb) — its state is shared with S2's reset
    const protectRatio = num(t0.hp_ratio), protectCut = t0.hp_ratio != null ? num(t0.damage_resistance) : 0;
    const P = { since: null, blockedUntil: -Infinity };
    const s2Decay = ({ battle, unit, buff }) => {
      const sk = unit.skill;
      if (sk && sk.active && sk.id === S2) return;
      buff.shield = Math.max(0, buff.shield + num(b2.shield_decrease, -200));
      unit.markDirty();
      if (!(buff.shield > 0)) battle.removeBuff(unit, buff);
    };
    const gainS3Barrier = (battle, unit) => {
      const cap = unit.s.maxHp * num(b3.max_scale, 2);
      const cur = unit.findBuff(S3_BARRIER);
      const val = Math.min(cap, (cur ? cur.shield : 0) + healValue * num(b3.shield_scale));
      if (!(val > 0)) return;
      const duration = num(b3.shield_duration, 15);
      if (cur) {
        // Native EXTEND updates the existing pool and lifetime without reacquiring its injury position.
        cur.shield = val;
        cur.timeLeft = cur.duration = duration;
        unit.markDirty();
      } else battle.addBuff(unit, { key: S3_BARRIER, shield: val, duration, visible: true,
        tags: ['skill'], data: { createdAt: battle.time } });
    };
    return {
      skills: {
        [S1]: {
          kind: num(s1?.maxChargeTime, 1) > 1 ? 'charges' : 'instant',
          // the HP that decides the extra strikes: when the skill fires, before its strike lands (the trait heals at each
          // damage instance — professions.js musha — so after the first strike he would read healed) [ASSUMED]
          onStart({ unit }) { unit.mem.zuoleS1Hp = unit.hpRatio; },
          attack: {
            atkScale: num(b1.atk_scale, 1),
            onHit({ battle, unit, target }) {
              const r = unit.mem.zuoleS1Hp ?? unit.hpRatio;
              unit.mem.zuoleS1Hp = null;
              const extra = (r < num(b1.hp_ratio_double, 0.8) ? 1 : 0) + (r < num(b1.hp_ratio_tripple, 0.5) ? 1 : 0);
              for (let i = 0; i < extra && target && target.alive; i++) {
                battle.dealDamage(unit, target, { amount: unit.s.atk * num(b1.atk_scale, 1), type: 'phys', isSkill: true, tags: ['skill'] });
              }
            },
          },
        },
        [S2]: {
          kind: 'duration',
          mods: { atkPct: num(b2.atk), blockCnt: num(b2.block_cnt) },
          attack: { hitAllBlocked: true },
          onStart({ battle, unit }) {
            const loss = Math.min(unit.hp * num(b2.hp_ratio), unit.hp - 1);
            if (loss > 0) battle.loseHp(unit, loss, { source: unit });
            const cap = unit.s.maxHp * num(b2.max_scale, 2);
            const add = Math.min(cap, unit.s.maxHp * num(b2.scale));
            const cur = unit.findBuff(S2_BARRIER);
            if (cur) { cur.shield = Math.min(cap, cur.shield + add); unit.markDirty(); }
            else if (add > 0) {
              battle.addBuff(unit, { key: S2_BARRIER, shield: add, interval: S2_DECAY_EVERY, onTick: s2Decay, visible: true, tags: ['skill'],
                data: { createdAt: battle.time } });
            }
            battle.fx('shield', { x: unit.x, y: unit.y, id: unit.id });
            // SBL-X: 行险 resets the 庇护, which is judged again PROTECT_RESET s later (after the barrier) — his own held 庇护
            // goes now (another source's comes back with its next refresh)
            P.since = null;
            P.blockedUntil = battle.time + PROTECT_RESET;
            const held = unit.findBuff(PROTECT);
            if (held && held.source === unit) battle.removeBuff(unit, held);
          },
        },
        [S3]: {
          kind: 'instant',
          onStart({ battle, unit }) {
            const grid = s3?.rangeGrid?.length ? s3.rangeGrid : [[0, 0], [0, 1], [0, 2], [0, 3]];
            const keys = absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, 0);
            // [ASSUMED] DESIGN §32.5: a bypass that never ran validateData still cannot loop 1e9 times. Official is 7.
            const times = Math.min(bbCap('times'), Math.max(1, Math.floor(num(b3.times, 7))));
            battle.fx('aoe', { x: unit.x + 1.5 * unit.fwd.x, y: unit.y + 1.5 * unit.fwd.y, radius: 1, id: unit.id, skill: 'zuole:slash' });
            unit.mem.zuoleS3 = true;
            try {
              for (let i = 1; i <= times && up(unit); i++) {
                const last = i === times;
                const foes = battle.enemiesInKeys(keys, unit, { canHitFly: true });
                sortEnemyTargets(battle, unit, foes, null);
                const amount = unit.s.atk * num(b3.atk_scale, 1) * (last ? num(b3.last_atk_bonus, 1) : 1);
                for (const e of foes.slice(0, S3_TARGETS)) {
                  if (!e.alive) continue;
                  battle.dealDamage(unit, e, { amount, type: 'phys', isSkill: true, tags: ['skill'] });
                  if (last && e.alive) battle.applyStatus(e, 'stun', { duration: num(b3.stun), source: unit });
                }
              }
            } finally {
              unit.mem.zuoleS3 = false;
            }
          },
        },
      },
      talents: [
        { install(battle, unit) { // 秉烛照影 (坚忍)
          const maxAs = num(t0.min_attack_speed), maxSp = num(t0.min_sp_recovery_per_sec), full = num(t0.min_hp_ratio, 0.3);
          if (!(maxAs > 0 || maxSp > 0) || !(full < 1)) return;
          let last = -1;
          const update = () => {
            if (!up(unit)) { last = -1; return; }
            const f = Math.max(0, Math.min(1, (1 - unit.hpRatio) / (1 - full)));
            if (Math.abs(f - last) < 1e-9) return;
            last = f;
            const cur = unit.findBuff(BERSERK);
            if (!(f > 0)) { if (cur) battle.removeBuff(unit, cur); return; }
            const mods = { aspd: maxAs * f, spRecoveryFlat: maxSp * f };
            if (cur) { cur.mods = mods; unit.markDirty(); } else battle.addBuff(unit, { key: BERSERK, mods, tags: ['talent'] });
          };
          battle.on('deploy', ({ unit: u }) => { if (u === unit) { last = -1; update(); } }, { owner: unit });
          battle.on('damaged', (c) => { if (c.target === unit) update(); }, { owner: unit });
          battle.on('tick', update, { owner: unit });
        } },
        { install(battle, unit) { // 守正自明 (+ SBL-Y stage 3: ×atk_scale on a success)
          const p1 = num(t1.prob_1), p2 = num(t1.prob_2), thr = num(t1.hp_ratio, 0.5), sp = num(t1.sp), scale = num(t1.atk_scale, 1);
          if (!(sp > 0)) return;
          const roll = () => battle.rng.chance(unit.hpRatio < thr ? p2 : p1);
          if (scale !== 1) {
            battle.on('damageCalculate', ({ source, target, dmg }) => {
              if (source !== unit || !target || target.side !== 'enemy' || dmg.type === 'element') return;
              if (roll()) { giveSp(unit, sp); dmg.amount *= scale; }
            }, { owner: unit });
          } else {
            battle.on('damageOutput', (c) => {
              if (c.source !== unit || !c.target || c.target.side !== 'enemy' || !(c.amount > 0) || isHpLoss(c.dmg) || c.dmg.type === 'element') return;
              if (roll()) giveSp(unit, sp);
            }, { owner: unit });
          }
        } },
      ],
      install(battle, unit) {
        unit.mem.zuoleProtect = P;
        // S3: the trait's heal turns into barrier while the slashes run (every damage instance he outputs)
        battle.on('heal', (c) => {
          if (unit.mem.zuoleS3 && c.source === unit && c.target === unit && c.opts && c.opts.self && !c.opts.tags) c.amount = 0;
        }, { owner: unit });
        battle.on('damageOutput', (c) => {
          if (!unit.mem.zuoleS3 || c.source !== unit || !c.target || c.target.side !== 'enemy' || !(c.amount > 0) || isHpLoss(c.dmg) || c.dmg.type === 'element') return;
          gainS3Barrier(battle, unit);
        }, { owner: unit });
    // Reacquired 庇护 follows the older barrier naturally in the ordered injury pass.
        if (protectCut > 0 && protectCut < 1) {
          const active = () => {
            const now = battle.time;
            if (!up(unit) || now < P.blockedUntil - 1e-9) { P.since = null; return false; }
            if (unit.hpRatio < protectRatio) { if (P.since == null) P.since = now; return true; }
            P.since = null;
            return false;
          };
          const keep = () => { if (active()) holdProtect(battle, unit, protectCut, PROTECT_TICK_HOLD, unit); };
      battle.on('tick', keep, { owner: unit });
      onHitOn(battle, unit, keep);
        }
        // SBL-Y: 被击倒时不撤退且回复30%生命（单次部署只触发1次）
        const revive = num(tb.hp_ratio);
        if (revive > 0) {
          let usedSeq = -1;
          battle.on('fatal', (c) => {
            if (c.unit !== unit || c.prevented || usedSeq === unit.deploySeq || holdsUndying(battle, unit)) return;
            c.prevented = true;
            usedSeq = unit.deploySeq;
            battle.heal(unit, unit, unit.s.maxHp * revive, { self: true, ignoreHealFree: true, tags: ['trait'] });
            battle.fx('revive', { x: unit.x, y: unit.y, id: unit.id });
          }, { owner: unit, priority: -60 });
        }
      },
    };
  },
};
