// server/sim/content/kits/ops/op-vvana.js — 薇薇安娜 (char_4098_vvana) 自选 operator kit: 6★ 术战者 (近卫), an owned-6★ pick
// of the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4098_vvana, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); PRTS 薇薇安娜 (备注 of
// 散华, 光影迅捷剑 and “明灭”, the AFT-Δ trait note); gamedata_const ba.charged 蓄力, ba.shield 护盾, ba.steal 偷取,
// ba.magicfragile 法术脆弱; PRTS 作战机制 (伤害流程, 远近途径 "有弹道的攻击固定为10，无弹道的攻击固定为01"); range_table 3-2; the
// client's battle data read from the local install — charpack char_4098_vvana, battle/prefabs [uc]skills skchr_vvana_1/2/3
// and [uc]equips vvana_equip_*, buff_template_data vvana_* (the templates are named below).
// - Trait (术战者) "攻击造成法术伤害": the profession (melee arts, ground only, block 1, 1.25 s).
// - Module AFT-D 目不能及之处: trait "攻击灼燃损伤爆发期间的目标时额外造成攻击力15%的元素伤害" (trait bb ep_damage_ratio; PRTS
//   "※于任意非本模组特性的伤害的输出伤害时触发"; vvana_e_002_trait: ON_OUTPUT_DAMAGE, not its own damage, the target in its FIRE
//   爆发冷却 → ELEMENT damage ep_damage_ratio × ATK): every damage instance she outputs on an enemy holding the `burnBurst` lock
//   (docs/SIM.md §3) — at the output (the `hit` step, before the target's dodge / cancel) — adds ep_damage_ratio × ATK
//   元素伤害. Stage 3: 燃烛施明's 灼燃损伤 (below).
// - Module AFT-Y “最后一行”: trait "自身阻挡的敌人受到10%的法术脆弱效果" (trait bb damage_scale 1.1; vvana_equip_2_*: weak[magic]
//   to every blockee): the 法术脆弱 status (同名效果取最高) on each enemy she blocks, renewed every 0.2 s for 0.3 s (as 史尔特尔's
//   AFT-Y). Stage 3: 散华 27 %, 2 layers (below).
// - T1 燃烛施明 "造成的法术伤害+8%，受到的物理和法术伤害-8%。攻击范围内存在精英或领袖敌人时，该效果提升至2倍" (full potential: 9 %;
//   damage_scale_m, damage_resistance_pm, super_scale; vvana_t_1[self] / [aura] / [super]: an aura on the enemies of her current
//   range — targetMotion ALL, flyers too, no untargetable one — and on those she blocks; an ELITE / BOSS one swaps [self] for
//   [super], ×super_scale): artsDealtMul 1 + 0.09 f, phys / artsTakenMul 1 − 0.09 f, f = super_scale while such an enemy is there,
//   else 1 — re-read every tick and before every hit she deals or takes. AFT-D stage 3 "攻击附带相当于9%伤害的灼燃损伤"
//   (ep_damage_ratio_m; the templates' ON_AFTER_OUTPUT_DAMAGE on her non-continuous arts damage, ApplyElementDamageBasedOnDamageValue
//   FIRE): each arts damage instance of hers that removes HP carries ep × f × that damage as 灼燃损伤.
// - T2 散华 "攻击精英或领袖敌人时，有18%概率获得一层仅抵挡近战攻击的护盾（最多1层）" (full potential: 20 %; prob; AFT-Y stage 3:
//   27 %, max_stack_cnt 2; S3: × talent_scale; vvana_t_2: ON_OUTPUT_DAMAGE on an ELITE_AND_BOSS target, Dice prob, CreateBuff
//   vvana_t_2[block_melee] — UNIQUE without max_stack_cnt, STACK up to it with — so a roll at the cap changes nothing, PRTS
//   "※自身未存在本天赋的护盾时，每对符合条件的目标造成一次伤害判定一次本天赋"): one roll per damage instance she outputs on an elite /
//   leader (any damage — the AFT-D rider too — at the output, before the target's dodge / cancel). vvana_t_2[block_melee]:
//   ON_TAKE_DAMAGE from an ENEMY source with apply way MELEE → BlockDamage, one layer spent (ba.shield "每层护盾可以抵挡一次伤害";
//   PRTS "※仅来源于敌方单位的近战途径伤害可触发本天赋的护盾"): an ordinary ordered injury effect. Its
//   instance route is explicit, with compatibility inference from projectile/attack metadata; source-less credit
//   cannot supply an enemy source. Adding a layer retains the shield buff's acquisition position.
// - S1 光影迅捷剑 (AUTO, 2 charges, data DEFAULT — a "next attack" waits for her attack): the next attack at atk_scale × ATK,
//   S1_HITS hits (S1_Attack2, `_additionalTimes` 1). 蓄力 (ba.charged "回复至上限2倍时进入蓄力状态…任何时候开启均消耗全部技力"; PRTS
//   备注 "未满足蓄力所需技力时…仅消耗技能最低所需技力" / "“蓄力”模式将在下一次技能结束时结束" / "“蓄力”模式期间…攻击范围变为3-2";
//   the skill's toggle at SP ratio 1 puts vvana_s_1[mode] — mode 1, range 3-2 — whose ON_SKILL_START clears the SP and
//   ON_SKILL_FINISH ends it; S1_Attack, `_additionalTimes` 2 on 3-2, needs its mark): with both charges stored her own range is
//   3-2 (the DEFAULT trigger's initial range and the card follow it) until the next end of the skill; a cast then hits
//   S1_CHARGED_HITS times and spends every charge, a cast below that spends one charge.
// - S2 烛燃影息 (MANUAL, data DEFAULT, 28 / 30 s; mode 2): ATK +atk, DEF +def, block +block_cnt, every attack hits all the
//   enemies she blocks; each attack picks Attack_Once / Attack_Twice (attack@prob_once / attack@prob_twice: one roll per
//   attack), the double hit at attack@atk_scale_twice × ATK carrying vvana_s_2[steal] (ON_BEFORE_TARGET_APPLY_MODIFIER of each
//   damage → vvana_steal_attack_speed: ba.steal "减少目标的基础属性作为自身加成，目标减少和自身加成的属性不超过指定上限（同类属性取最高）"):
//   each enemy it hits loses attack@steal_atk_speed ASPD (at most attack@steal_atk_speed_max per enemy, the largest of several
//   thieves) and she gains as much (at most the max in all) — "持续至技能结束或薇薇安娜离场"; a dodged hit steals too (the step
//   comes before the target's checks).
// - S3 “明灭” (MANUAL, data DEFAULT, 15 s): attack interval +base_attack_time s (flat), ATK +atk, DEF +def, RES
//   +magic_resistance, S3_HITS hits per attack, 散华 × talent_scale, elite / leader enemies first (targeting priority 'elite',
//   after the enemies she blocks — the engine's order). "第二次及以后使用时，攻击距离+2，攻击变为三连击，持续时间延长至25秒" (PRTS
//   备注 "每次部署薇薇安娜时，重新计算该技能的使用次数" / "首次技能结束后，本技能的技能范围永久扩大至3-2"; vvana_s_3[check]: a
//   skill triggered before ⇒ the enhance mark and duration_plus = enhance_duration, vvana_s_3: mode 4 instead of 3): from her
//   second cast of a deployment the skill runs enhance_duration s with S3_LATER_HITS hits on the 3-2 range (her own grid while
//   it runs: the card shows it). Trigger: the data's DEFAULT on her own range for the first cast of a deployment; once it
//   has ended the owner's ACTIVE_RANGE rule (2026-10-05: a MANUAL skill whose running range strictly contains her own casts
//   with an enemy inside that range) on the 3-2 — no data range carries it, so the kit sets it (skill.setTrigger, 0.2.0 WE2,
//   follow-up #16; O11's report) — and DEFAULT again at her next deployment.

import { num, talentBb, traitBb, skillRec, up, batMod } from '../shared/tier1.js';
import { isElite, elementDmg, enemiesIn } from '../shared/tier6.js';
import { hasHp, damageApplyWay } from '../../../attack.js';

const S1 = 'skchr_vvana_1';
const S2 = 'skchr_vvana_2';
const S3 = 'skchr_vvana_3';
/** range_table 3-2: the 蓄力 range (PRTS S1 备注) and S3's range from its second cast (PRTS S3 备注). */
const RANGE_3_2 = Object.freeze([[0, 0], [0, 1], [0, 2], [0, 3]].map((p) => Object.freeze(p)));
/** S1 "并连续攻击两次" / 蓄力 "改为连续攻击三次"; S2 "二连击"; S3 "攻击变为二连击" / later "攻击变为三连击" — text only. */
const S1_HITS = 2, S1_CHARGED_HITS = 3, S2_TWICE_HITS = 2, S3_HITS = 2, S3_LATER_HITS = 3;
/** AFT-Y: the 法术脆弱 renewal (as 史尔特尔's AFT-Y, kits/ops/chess_char_5_07-surtr.js). */
const FRAGILE_IV = 0.2, FRAGILE_DUR = 0.3;
const AFTD_TAG = 'vvanaAftD';
const CANDLE_KEY = 'talent:vvana:candle';
const SHIELD_KEY = 'talent:vvana:shield';
const LOOT_KEY = 'skill:vvana:loot';
const STOLEN_KEY = 'skill:vvana:stolen';
/** Pre-formula source effects stay on hit; the acquired shield participates in ordinary ordered injury effects. */
const CANDLE_PRIORITY = 100, OUTPUT_PRIORITY = 50;

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const tagged = (d, tag) => !!d && Array.isArray(d.tags) && d.tags.includes(tag);
/** Her own range grid (the form's 1-1), or the range she switches to. */
function setGrid(battle, unit, grid) {
  if (!grid || unit.rangeGrid === grid) return;
  unit.rangeGrid = grid;
  battle.refreshRange(unit);
}

// ---- S2 偷取: the losses of the enemies, one battle-wide table (同类属性取最高 over several thieves) ---------------------
/** battle → Map(enemy → Map(thief id → ASPD stolen)). */
const STOLEN = new WeakMap();
const stolenOf = (battle) => { let m = STOLEN.get(battle); if (!m) STOLEN.set(battle, (m = new Map())); return m; };
function applyLoss(battle, e, per) {
  let a = 0;
  for (const v of per.values()) a = Math.max(a, v);
  if (!(a > 0)) { battle.removeBuff(e, STOLEN_KEY); return; }
  battle.addBuff(e, { key: STOLEN_KEY, mods: { aspd: -a }, tags: ['steal'] });
}
function steal(battle, unit, e, n, cap) {
  if (!(n > 0) || !e || !e.alive || e.side !== 'enemy') return;
  const losses = stolenOf(battle);
  let per = losses.get(e);
  if (!per) losses.set(e, (per = new Map()));
  per.set(unit.id, Math.min(cap, (per.get(unit.id) ?? 0) + n));
  applyLoss(battle, e, per);
  (unit.mem.vvanaVictims ??= new Set()).add(e);
  unit.mem.vvanaLoot = Math.min(cap, (unit.mem.vvanaLoot ?? 0) + n);
  battle.addBuff(unit, { key: LOOT_KEY, mods: { aspd: unit.mem.vvanaLoot }, tags: ['skill'] });
}
/** "持续至技能结束或薇薇安娜离场": she gives everything back. */
function returnLoot(battle, unit) {
  battle.removeBuff(unit, LOOT_KEY);
  unit.mem.vvanaLoot = 0;
  const losses = stolenOf(battle);
  for (const e of unit.mem.vvanaVictims ?? []) {
    const per = losses.get(e);
    if (!per || !per.delete(unit.id)) continue;
    if (e.alive) applyLoss(battle, e, per);
  }
  unit.mem.vvanaVictims = new Set();
}

export default {
  char_4098_vvana: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const tb = traitBb(chess);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const twice = num(b2['attack@atk_scale_twice'], 1);
    return {
      skills: {
        [S1]: {
          kind: 'charges',
          attack: { atkScale: num(b1.atk_scale, 1), hitsFn: (b, u) => (u.mem.vvanaCast === 'charged' ? S1_CHARGED_HITS : S1_HITS) },
          onStart({ unit, skill }) {
            // after activate's one charge: still ≥ max − 1 ⇒ every charge was stored (蓄力) — a charged cast spends them all
            const charged = !!unit.mem.vvanaCharged || (skill.maxCharges > 1 && skill.charges >= skill.maxCharges - 1);
            unit.mem.vvanaCast = charged ? 'charged' : 'plain';
            if (charged) { skill.charges = 0; skill.sp = 0; }
          },
          onEnd({ unit }) { unit.mem.vvanaCast = null; },
        },
        [S2]: {
          kind: 'duration',
          mods: { atkPct: num(b2.atk), defPct: num(b2.def), blockCnt: num(b2.block_cnt) },
          attack: {
            hitAllBlocked: true,
            hitsFn: (b, u) => (u.mem.vvanaTwice ? S2_TWICE_HITS : 1),
            dmgMul: (b, u) => (u.mem.vvanaTwice ? twice : 1),
            onEachHit({ battle, unit, target, kind }) {
              if (unit.mem.vvanaTwice && kind === 'main') steal(battle, unit, target, num(b2['attack@steal_atk_speed']), num(b2['attack@steal_atk_speed_max'], Infinity));
            },
          },
          onStart({ battle, unit }) { returnLoot(battle, unit); },
          onEnd({ battle, unit }) { unit.mem.vvanaTwice = false; returnLoot(battle, unit); },
        },
        [S3]: {
          kind: 'duration',
          mods: { batPct: batMod(b3.base_attack_time, chess), atkPct: num(b3.atk), defPct: num(b3.def), resFlat: num(b3.magic_resistance) },
          targeting: { priority: 'elite' },
          attack: { hitsFn: (b, u) => (u.mem.vvanaS3Later ? S3_LATER_HITS : S3_HITS) },
          onStart({ battle, unit, skill }) {
            const later = (unit.mem.vvanaS3Casts ?? 0) >= 1;
            unit.mem.vvanaS3Casts = (unit.mem.vvanaS3Casts ?? 0) + 1;
            unit.mem.vvanaS3Later = later;
            if (!later) return;
            skill.timeLeft = Math.max(0.01, num(b3.enhance_duration, skill.duration));
            setGrid(battle, unit, RANGE_3_2);
          },
          onEnd({ battle, unit, skill }) {
            if (unit.mem.vvanaS3Later) setGrid(battle, unit, unit.def?.rangeGrid);
            unit.mem.vvanaS3Later = false;
            // its later casts run on the 3-2: from now the owner's ACTIVE_RANGE rule there (see the header)
            if ((unit.mem.vvanaS3Casts ?? 0) >= 1) skill.setTrigger('ACTIVE_RANGE', RANGE_3_2);
          },
        },
      },
      talents: [
        { install(battle, unit) { // 燃烛施明: arts dealt +, phys / arts taken −, ×super_scale with an elite / leader there
          const dsm = num(t0.damage_scale_m), drp = num(t0.damage_resistance_pm), sup = num(t0.super_scale, 1), ep = num(t0.ep_damage_ratio_m);
          const factor = () => (enemiesIn(battle, unit, unit.rangeKeys).some(isElite) || unit.blocking.some(isElite) ? sup : 1);
          const check = () => {
            if (!up(unit)) return;
            const f = factor();
            if (unit.mem.vvanaCandle === f && unit.findBuff(CANDLE_KEY)) return;
            unit.mem.vvanaCandle = f;
            battle.addBuff(unit, { key: CANDLE_KEY, mods: { artsDealtMul: 1 + dsm * f, physTakenMul: 1 - drp * f, artsTakenMul: 1 - drp * f }, data: { f }, tags: ['talent'] });
          };
          battle.on('tick', check, { owner: unit });
          battle.on('battleStart', check, { owner: unit });
          battle.on('deploy', (c) => { if (c.unit === unit) { unit.mem.vvanaCandle = null; check(); } }, { owner: unit });
          // exact at the damage: re-read before any hit she deals or takes is resolved (the pipeline reads both units'
          // stats after the `hit` hook)
          battle.on('hit', (c) => { if (c.source === unit || c.target === unit) check(); }, { owner: unit, priority: CANDLE_PRIORITY });
          if (!(ep > 0)) return;
          // AFT-D stage 3: 攻击附带相当于9%伤害的灼燃损伤 (× the same factor) — her arts damage that removed HP
          battle.on('damaged', (c) => {
            const d = c.dmg;
            if (c.source !== unit || c.type !== 'arts' || tagged(d, 'dot') || !(c.amount > 0) || !c.target || c.target.side !== 'enemy') return;
            elementDmg(battle, unit, c.target, 'burn', c.amount * ep * (unit.mem.vvanaCandle ?? 1), ['talent']);
          }, { owner: unit });
        } },
        { install(battle, unit) { // 散华: a melee-only 护盾 layer from her damage on elite / leader enemies
          const p = num(t1.prob), max = Math.max(1, Math.floor(num(t1.max_stack_cnt, 1)));
          const s3Scale = num(b3.talent_scale, 1);
          const layers = () => unit.findBuff(SHIELD_KEY)?.data?.n ?? 0;
          const setLayers = n => {
            if (!(n > 0)) { battle.removeBuff(unit, SHIELD_KEY); return; }
            const held = unit.findBuff(SHIELD_KEY);
            if (held) { held.data.n = n; return; }
            battle.addBuff(unit, { key: SHIELD_KEY, data: { n }, visible: true, tags: ['talent'], injury(c) {
              if (c.source?.side !== 'enemy' || damageApplyWay(c.dmg) === 'RANGED' || !(c.buff.data.n > 0)) return;
              if (!c.block()) return;
              setLayers(c.buff.data.n - 1);
              battle.fx('shieldBreak', { x: unit.x, y: unit.y, id: unit.id });
            } });
          };
          battle.on('hit', (c) => {
            if (c.source !== unit || !isElite(c.target) || !up(unit)) return;
            const have = layers();
            if (have >= max) return;
            const prob = p * (unit.skill?.active && unit.skill.id === S3 ? s3Scale : 1);
            if (!(prob > 0) || !battle.rng.chance(prob)) return;
            setLayers(have + 1);
            battle.fx('shield', { x: unit.x, y: unit.y, id: unit.id });
          }, { owner: unit, priority: OUTPUT_PRIORITY });

        } },
      ],
      install(battle, unit) {
        const own = unit.def?.rangeGrid;
        // S1's 蓄力 mode: both charges stored ⇒ her range is 3-2 until the next end of the skill
        if (unit.skill?.id === S1) {
          const leave = () => { unit.mem.vvanaCharged = false; setGrid(battle, unit, own); };
          battle.on('tick', () => {
            const sk = unit.skill;
            if (!up(unit) || unit.mem.vvanaCharged || !sk || !(sk.maxCharges > 1) || sk.charges < sk.maxCharges) return;
            unit.mem.vvanaCharged = true;
            setGrid(battle, unit, RANGE_3_2);
          }, { owner: unit });
          battle.on('skillEnd', (c) => { if (c.unit === unit && c.skill.id === S1 && unit.mem.vvanaCharged) leave(); }, { owner: unit });
          battle.on('deploy', (c) => { if (c.unit === unit) leave(); }, { owner: unit });
        }
        // S2: one Attack_Once / Attack_Twice pick per attack while it runs
        if (unit.skill?.id === S2) {
          const prob = num(b2['attack@prob_twice']);
          battle.on('beforeAttack', (c) => {
            if (c.attacker !== unit) return;
            unit.mem.vvanaTwice = !!(unit.skill?.active && unit.skill.id === S2) && prob > 0 && battle.rng.chance(prob);
          }, { owner: unit });
          battle.on('death', (c) => { if (c.unit === unit) returnLoot(battle, unit); }, { owner: unit });
        }
        // S3: the cast count of a deployment ("每次部署…重新计算"), her own range back
        if (unit.skill?.id === S3) {
          battle.on('deploy', (c) => {
            if (c.unit !== unit) return;
            unit.mem.vvanaS3Casts = 0;
            unit.mem.vvanaS3Later = false;
            setGrid(battle, unit, own);
            if (unit.skill?.id === S3) unit.skill.setTrigger('DEFAULT', null);   // the first cast of a deployment: the data's rule
          }, { owner: unit });
        }
        // AFT-D: 元素伤害 at the output of every damage of hers on an enemy in its 灼燃 爆发冷却 (not on this rider's own)
        const er = num(tb.ep_damage_ratio);
        if (er > 0) {
          battle.on('hit', (c) => {
            const t = c.target;
            if (c.source !== unit || !t || t.side !== 'enemy' || tagged(c.dmg, AFTD_TAG) || !hasHp(t) || !t.findBuff('burnBurst')) return;
            battle.dealDamage(unit, t, { amount: unit.s.atk * er, type: 'elemental', element: 'burn', canDodge: false, tags: [AFTD_TAG, 'dot'] });
          }, { owner: unit, priority: OUTPUT_PRIORITY });
        }
        // AFT-Y: 自身阻挡的敌人受到10%的法术脆弱效果
        const fragile = num(tb.damage_scale, 1) - 1;
        if (fragile > 0) {
          battle.every(FRAGILE_IV, () => {
            if (!up(unit)) return;
            for (const e of unit.blocking) if (e.alive) battle.applyStatus(e, 'artsFragile', { duration: FRAGILE_DUR, value: fragile, source: unit });
          }, { owner: unit });
        }
      },
    };
  },
};
