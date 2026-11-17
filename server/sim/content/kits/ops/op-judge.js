// server/sim/content/kits/ops/op-judge.js — 斥罪 (char_4065_judge) 自选 operator kit: 6★ 不屈者 (重装), an owned-6★ pick of the
// tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4065_judge, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); PRTS 斥罪 (律法卫士 备注:
// "自身产生的屏障生效优先级为-1000，为单一BUFF，每次“获得”实际效果为补充屏障的吸收量…本天赋的屏障上限仅限制自身通过天赋和技能产生的
// 屏障量…上限会实时计算"; 荆棘环身 备注 "反伤效果会直接选中伤害来源，但仅对阵营为敌方的来源造成伤害"; S1 备注 on 蓄力; S2 备注
// "技能期间，自身丢失全部视野"; S3 备注 "技能获取的屏障为补充天赋屏障的吸收量，且不会令屏障总量超过天赋描述下的屏障获取上限"),
// gamedata_const ba.charged 蓄力 ("技力达到上限可继续回复，回复至上限2倍时进入蓄力状态，此时开启技能会触发额外效果（任何时候开启均消耗
// 全部技力）"); the client's battle data: buff templates judge_t_1 / judge_t_2 / judge_e_002_tr / judge_s_1_enhance_checker /
// judge_s_1[damage] / judge_s_1[mode] / judge_s_2[aoe] / judge_s_2[shield_scale] / judge_s_3[shield], the skill prefabs
// skchr_judge_1..3 and the module prefabs judge_equip_{1,2}_*; Arknights Terra Wiki "Penance".
// - Trait (不屈者) "无法被友方角色治疗": the profession default (professions.js unyield `noHeal`; the charpack's 'unhealable');
//   an HP-regen attribute (黍's sown tiles, 吟游者) still reaches her (SIM.md §4). Melee physical, ground-only, block 3, 1-1.
//   Module UNY-X “通往未来的荆棘之路” "受到来自自身阻挡单位的伤害降低15%" (trait bb damage_scale; judge_e_002_tr): every damage
//   whose source she blocks ×damage_scale. Module UNY-Y “无罪” "周围8格没有友方干员时攻击力和防御力+8%" (trait bb atk / def; the
//   prefab's checker counts operators only — professionMask 639): ATK / DEF + while no allied operator stands on the 8
//   tiles around her.
// - T1 律法卫士 (judge_t_1): one barrier buff BARRIER. At every deployment +born_hp_ratio × max HP; every enemy she knocks
//   out +kill_hp_ratio × max HP; S3 +hp_ratio × max HP — each gain × the shield scale (1, + S2's shield_scale while S2
//   runs: judge_s_2[shield_scale]) and only while the barrier is below the cap max_hp_ratio × the CURRENT max HP, then
//   capped there (a max-HP change leaves the barrier as it is). PRTS explicitly retains the single buff while empty,
//   so refills preserve its acquisition position. Its priority −1000 puts ordinary damage reductions before it as the
//   client's LOW_PRIORITY. UNY-X stage 3: 75 % / 12 % (module talent change; full potential). higher_effect_hp_ratio only sizes the
//   barrier's effect (judge_t_1[effect]) — no gameplay.
// - T2 荆棘环身 (judge_t_2, ON_TAKE_DAMAGE): every damage instance an enemy source deals her while she holds barrier (its
//   judge_shield[mark]: the absorb before that hit — the hit that breaks it still counts, t_1 runs LOW_PRIORITY) deals
//   atk_scale × her ATK arts back to that source (a 普通伤害, InverseDamage `attackType` NORMAL; × the 蓄力 攻击力倍率 while S1's
//   蓄力 attack is out — PRTS 备注), never for a 流失, an element 损伤 or a 无来源 hit; descriptive counter/reflect tags do not exclude an enemy source,
//   undodgeable [ASSUMED like 星熊's counter]. UNY-Y stage 3: 61 % (full potential).
// - S1 一锤定音 (AUTO, time SP, data DEFAULT): the next attack adds atk_scale_2 × ATK arts (a 普通伤害 skill hit, after the
//   physical one). 蓄力 (maxChargeTime 2): SP runs on to twice the cost; casting from there (the client's "available count
//   ≥ 1" after the cast) also stuns the target `stun` s (before the arts hit) and raises every damage she deals until the
//   attack is done ×judge_s_1_enhance_checker.atk_scale (an 攻击力倍率: atkScaleMul). Every cast spends ALL the SP
//   (ClearCharacterSp). The moment the SP reaches the 蓄力 mark her attack cycle restarts (judge_s_1[mode] SwitchMode with
//   restartFSM, "无关乎能否开启技能"; PRTS 备注 "存在可攻击目标且未被控制的情况下切换后会立刻触发技能"): atkCd = 0. The refund of a
//   cast whose target died (_recoverSpIfTargetDead) is not modelled [ASSUMED]: a melee cast and its attack resolve in one
//   tick here.
// - S2 坚心苦修 (MANUAL; data DEFAULT — the owner's 重装 exception of 2026-10-05, rawRule TAKE_DAMAGE): `duration` s, no
//   attacks (她丢失全部视野), 庇护 damage_resistance (the shared applyStrongest key PROTECT, for the skill's time), and from
//   S2_FIRST s on every S2_EVERY s (judge_s_2[aoe]: firstTriggerInterval 0.9, triggerInterval 1) atk_scale × ATK arts (×
//   any 攻击力倍率) to every ground enemy she can select on the skill range x-4 (AOEDamage WALK_ONLY, attackType NORMAL); T1's
//   gains ×(1 + shield_scale) meanwhile.
// - S3 披荆斩棘 (MANUAL, hurt SP; data DEFAULT, rawRule TAKE_DAMAGE): at once barrier +hp_ratio × max HP (topping T1's,
//   capped), then `duration` s ATK +atk, attack interval +base_attack_time s (a flat +0.9 on 1.6 s), taunt +taunt_level.

import { num, traitBb, talentBb, skillRec, toggleBuff, batMod, up, enemiesInGrid, holdProtect, PROTECT, byEnemyDamage } from '../shared/tier1.js';

const S1 = 'skchr_judge_1';
const S2 = 'skchr_judge_2';
const S3 = 'skchr_judge_3';
const BARRIER = 'talent:judge:barrier';
const CHARGED = 'skill:judge:charged';
/** S2's 技能范围 when the data carries none (x-4: her tile and the 8 around it). */
const X4 = Object.freeze([[1, -1], [1, 0], [1, 1], [0, -1], [0, 0], [0, 1], [-1, -1], [-1, 0], [-1, 1]]);
/** judge_s_2[aoe]: firstTriggerInterval 0.9 s, then triggerInterval 1 s. */
const S2_FIRST = 0.9;
const S2_EVERY = 1;

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** Her barrier left (0 without one). */
const barrierOf = (u) => u.findBuff(BARRIER)?.shield ?? 0;

export default {
  char_4065_judge: (bb, chess) => {
    const tb = traitBb(chess);
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s2 = skillRec(chess, S2);
    const capRatio = num(t0.max_hp_ratio, 3);
    /** S2's 庇护 (damage_resistance[inf] for the skill's time). */
    const protect = (battle, unit, skill) => {
      const dr = num(b2.damage_resistance);
      holdProtect(battle, unit, dr, Math.max(0.05, skill.timeLeft), unit);   // 庇护: the shared effect (同名效果取最高)
    };
    /** judge_t_1's shield_scale: 1, + S2's shield_scale while S2 runs. */
    const shieldScale = (unit) => 1 + (unit.skill?.active && unit.skill.id === S2 ? num(b2.shield_scale) : 0);
    /** Add `amount` to her barrier while it is below the cap (the CURRENT max HP), capped there. Returns the gain. */
    const gain = (battle, unit, amount) => {
      if (!up(unit) || !(amount > 0)) return 0;
      const cap = unit.s.maxHp * capRatio;
      const cur = unit.findBuff(BARRIER);
      const have = cur ? cur.shield : 0;
      if (!(cap > have + 1e-9)) return 0;
      const next = Math.min(cap, have + amount);
      if (cur) { cur.shield = next; unit.markDirty(); } else battle.addBuff(unit, { key: BARRIER, shield: next, keepEmptyShield: true, injuryPriority: -1000, visible: true, tags: ['talent'] });
      battle.fx('shield', { x: unit.x, y: unit.y, id: unit.id });
      return next - have;
    };
    return {
      skills: {
        [S1]: {
          kind: 'charges',
          attack: {
            onHit({ battle, unit, target }) {
              if (!target || !target.alive) return;
              if (unit.mem.judgeCharged) battle.applyStatus(target, 'stun', { duration: num(b1.stun), source: unit });
              if (!target.alive) return;
              battle.dealDamage(unit, target, { amount: unit.s.atk * num(b1.atk_scale_2) * unit.s.atkScaleMul, type: 'arts', isSkill: true, tags: ['skill', 'judge:gavel'] });
            },
          },
          onStart({ battle, unit, skill }) {
            // 蓄力: the cast took one charge of a full stack; every cast spends ALL the SP (ClearCharacterSp)
            const charged = skill.maxCharges > 1 && skill.charges >= skill.maxCharges - 1;
            skill.charges = 0;
            skill.sp = 0;
            unit.mem.judgeCharged = charged;
            if (charged) {
              battle.addBuff(unit, { key: CHARGED, mods: { atkScaleMul: num(b1['judge_s_1_enhance_checker.atk_scale'], 1) }, tags: ['skill'] });
              battle.fx('crit', { x: unit.x, y: unit.y, id: unit.id });
            }
          },
          onEnd({ battle, unit }) { unit.mem.judgeCharged = false; battle.removeBuff(unit, CHARGED); },
        },
        [S2]: {
          kind: 'duration',
          attack: { noAttack: true },
          onStart({ battle, unit, skill }) {
            unit.mem.judgeS2Next = S2_FIRST;
            protect(battle, unit, skill);
          },
          onTick({ battle, unit, skill, dt }) {
            protect(battle, unit, skill);
            unit.mem.judgeS2Next -= dt;
            while (unit.mem.judgeS2Next <= 1e-9 && up(unit)) { // loop-cap: constant S2_EVERY added each pass
              unit.mem.judgeS2Next += S2_EVERY;
              const foes = enemiesInGrid(battle, unit, s2?.rangeGrid?.length ? s2.rangeGrid : X4, { canHitFly: false });
              battle.fx('aoe', { x: unit.x, y: unit.y, radius: 1.5, id: unit.id, skill: 'judge:atonement' });
              const amount = unit.s.atk * num(b2.atk_scale) * unit.s.atkScaleMul;
              for (const e of foes) if (e.alive) battle.dealDamage(unit, e, { amount, type: 'arts', isSkill: true, tags: ['skill', 'judge:atonement'] });
            }
          },
          onEnd({ battle, unit }) { if (unit.findBuff(PROTECT)?.source === unit) battle.removeBuff(unit, PROTECT); },
        },
        [S3]: {
          kind: 'duration',
          mods: { atkPct: num(b3.atk), batPct: batMod(b3.base_attack_time, chess), taunt: num(b3.taunt_level) },
          onStart({ battle, unit }) { gain(battle, unit, unit.s.maxHp * num(b3.hp_ratio) * shieldScale(unit)); },
        },
      },
      talents: [
        { install(battle, unit) { // 律法卫士: barrier at every deployment and per enemy she knocks out (≤ max_hp_ratio × max HP)
          battle.on('deploy', (ctx) => {
            if (ctx.unit === unit) gain(battle, unit, unit.s.maxHp * num(t0.born_hp_ratio) * shieldScale(unit));
          }, { owner: unit });
          battle.on('kill', ({ killer, victim }) => {
            if (killer === unit && victim && victim.side === 'enemy') gain(battle, unit, unit.s.maxHp * num(t0.kill_hp_ratio) * shieldScale(unit));
          }, { owner: unit });
        } },
        { install(battle, unit) { // 荆棘环身: while she holds barrier, every damage from an enemy source reflects atk_scale × ATK arts
          const scale = num(t1.atk_scale);
          if (!(scale > 0)) return;
          battle.addBuff(unit, { key: 'judge:thorns', persist: true, allowDead: true, observeInjury(c) {
            const src = c.source;
            // The ordinary observer precedes her -1000 barrier, so the breaking instance still reflects.
            if (!unit.alive || !(barrierOf(unit) > 1e-9) || !byEnemyDamage(c) || !src.alive) return;
            battle.dealDamage(unit, src, { amount: unit.s.atk * scale * unit.s.atkScaleMul, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['talent', 'counter', 'judge:thorns'] });
            battle.fx('thorns', { x: unit.x, y: unit.y, id: unit.id });
          } });
        } },
      ],
      install(battle, unit) {
        // S1 蓄力: the moment the SP reaches twice the cost her attack cycle restarts (judge_s_1[mode], restartFSM)
        if (unit.skill?.id === S1) {
          let full = false;
          battle.on('tick', () => {
            const sk = unit.skill;
            const now = !!sk && up(unit) && sk.maxCharges > 1 && sk.charges >= sk.maxCharges;
            if (now && !full) unit.atkCd = 0;
            full = now;
          }, { owner: unit });
        }
        // UNY-X: 受到来自自身阻挡单位的伤害降低15%
        const cut = num(tb.damage_scale, 1);
        if (cut !== 1) battle.on('hit', (c) => { if (c.target === unit && c.source && c.source.blockedBy === unit) c.dmg.mul *= cut; }, { owner: unit });
        // UNY-Y: 周围8格没有友方干员时攻击力和防御力+8% (operators only, her own tile aside)
        const ma = num(tb.atk), md = num(tb.def);
        if (ma || md) {
          const alone = () => !battle.allyUnits.some((a) => a !== unit && a.kind === 'op' && a.alive && a.deployed && !a.hidden
            && Math.max(Math.abs(a.tileR - unit.tileR), Math.abs(a.tileC - unit.tileC)) === 1);
          toggleBuff(battle, unit, 'trait:judge:alone', alone, { atkPct: ma, defPct: md });
        }
      },
    };
  },
};
