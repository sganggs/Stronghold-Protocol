// server/sim/content/kits/ops/op-hodrer.js — 赫德雷 (char_4088_hodrer) 自选 operator kit: 6★ 重剑手 (近卫), an owned-6★ pick of
// the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4088_hodrer, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); PRTS 赫德雷 (备注 of 及锋而试
// and 死境硝烟); PRTS 卫戍协议/帮助 §技能操作 ("携带状态切换类技能的干员…每次部署后仅开启一次技能"); gamedata_const ba.protect 庇护,
// ba.stun 晕眩, ba.root 束缚; PRTS 伤害分类 (无来源真实持续伤害); the client's battle data read from the local install —
// charpack char_4088_hodrer, battle/prefabs [uc]skills skchr_hodrer_1/2/3 and [uc]equips hodrer_equip_*, buff_template_data
// hodrer_* (named below).
// - Trait (重剑手) "同时攻击阻挡的所有敌人": the profession (melee physical, ground only, block 2, 2.5 s).
// - Module CRU-X 新的生活: trait "受到的治疗效果提升20%" (trait bb heal_scale; equip_heal_scale_up): healingTakenMul ×heal_scale —
//   his own S1 / S3 heals included. Stage 3: 余火之氅 31 % and 物理伤害 +10 % (below).
// - Module CRU-Y 笔迹: trait "对被阻挡的敌人伤害提升至110%" (trait bb damage_scale; hodrer_e_003_tr: ON_OUTPUT_DAMAGE, CheckBlocked
//   by the buff's source — him): ×damage_scale (a damage multiplier) on every damage of his on an enemy HE blocks. Stage 3:
//   及锋而试 130 % / 160 % and its first-hit stun (below).
// - T1 及锋而试 "攻击敌人时攻击力提升至110%，若目标处于晕眩、束缚则改为提升至140%" (atk_scale_2 / atk_scale; hodrer_t_1:
//   ON_CALCULATE_DAMAGE, abnormal flags STUNNED / UNMOVABLE → AtkScaleUp): each damage instance of his attacks ×atk_scale_2, or
//   ×atk_scale on a target under a 晕眩 or 束缚 status (冻结 is neither) — an ATK scale, before DEF. PRTS 备注 "本天赋于每次攻击的
//   附加效果后、计算伤害前判断并生效": the attack's riders come first, in the same `hit` step — S2's stun and S3's stun roll (the
//   attacks' `_activeBuffs`), then CRU-Y stage 3's "且对阻挡的敌人首次造成伤害时对其造成2.5秒晕眩效果" (hodrer_e_003_t, event
//   priority 2000 — before 及锋而试: an enemy he blocks without his mark gets it and stuns `stun` s; the marks are derived from
//   the module talent's buff, so they go when he leaves the field and a redeployed 赫德雷 stuns anew) — so a hit that stuns
//   counts as on a stunned target; a rider lands when the hit is then dodged [ASSUMED: the client applies them in the attack's
//   damage calculation].
// - T2 余火之氅 "使自身与身后一格的友军获得18%的庇护" (full potential: 21%; damage_resistance, talent grid b-1: his tile and the one
//   behind; CRU-X stage 3 "28%…且造成的物理伤害提升10%" (full potential: 31%) — hodrer_equip_1_3_p2 gives damage_resistance[inf] and
//   hodrer_equip[damage_scale_up] (ON_OUTPUT_DAMAGE PHYSICAL ×damage_scale) to the same targets, ally side, any motion, removed when
//   they leave): 庇护 (ba.protect "受到的物理和法术伤害降低相应比例（同名效果取最高）") = phys / artsTakenMul 1 − value — the shared
//   庇护 of every source (tier1.js holdProtect: damage_resistance[inf] is the common key) — and physDealtMul ×damage_scale (its own one
//   instance per ally), renewed every PROTECT_IV s on the allies of the grid while he is deployed.
// - S1 重锋不熄 (AUTO, hit SP: INCREASE_WHEN_ATTACK, data DEFAULT): the next attack (every enemy he blocks) at atk_scale × ATK;
//   hodrer_s[heal] (ON_ABILITY_SPELL_ON, HealViaMaxHpRatio) heals hp_ratio of his max HP once for that attack.
// - S2 余烬重荷 (MANUAL, data DEFAULT): "被动效果：攻击力+16%" (atk; the skill's extra ability hodrer_s_2[passive]) while it is
//   his skill; "主动触发可以在下列状态和初始状态间切换" — a 状态切换类 skill, switched on once per deployment and kept (the official
//   auto-battle rule, `toggle`): attack interval +base_attack_time s (flat), block +block_cnt, every attack stuns its targets
//   attack@stun s.
// - S3 死境硝烟 (MANUAL, data ACTIVE_RANGE on its running range, 70 / 70 s): max HP +max_hp, ATK +atk, 攻击距离
//   +ability_range_forward_extend; each attack heals attack@hp_ratio of his max HP (hodrer_s[heal], once per attack) and stuns
//   each target attack@stun s with attack@buff_prob. hodrer_s_3[damage] (triggerInterval 1 s, the first after 1 s): he loses
//   attack@value HP every second (FixedValueDamage that skips the damage events: a 流失 here [ASSUMED: it may knock him out —
//   no floor is named]); every damage he outputs on an enemy, and every damage an enemy deals him, marks that enemy if it is
//   not 无敌 (one hodrer_s_3[burn] per enemy and 赫德雷, PRTS 备注 "仅判定本次技能期间满足条件的非无敌敌方单位…不可叠加"): from
//   then on it takes attack@damage 无来源 true damage (NoSourceDamage PURE: attack.js periodicDamage, credited to him) every
//   second of its own (triggerInterval 1 s from its mark) until the skill ends (a derived buff of the skill's).

import { num, talentBb, talentGrid, moduleBb, traitBb, skillRec, statBuff, up, batMod, alliesInGridOf, holdProtect } from '../shared/tier1.js';
import { periodicDamage } from '../../../attack.js';

const S1 = 'skchr_hodrer_1';
const S2 = 'skchr_hodrer_2';
const S3 = 'skchr_hodrer_3';
/** 余火之氅's grid when the data carries none: his tile and the one behind him (range b-1). */
const BEHIND = Object.freeze([Object.freeze([0, -1]), Object.freeze([0, 0])]);
const PROTECT_IV = 0.25;
/** CRU-X stage 3's 物理伤害 + (hodrer_equip[damage_scale_up]): one instance per ally (the 庇护 is the shared key). */
const DMG_UP_KEY = 'talent:hodrer:dmgUp';
const S2_PASSIVE_KEY = 'skill:hodrer:s2passive';
/** hodrer_s_3[damage] / hodrer_s_3[burn]: triggerInterval 1 s, waitFirstTriggerInterval. */
const SMOKE_IV = 1;
/** The riders and 及锋而试 before the other `hit` handlers read the hit. */
const T1_PRIORITY = 10;

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** Under a 晕眩 or 束缚 status (及锋而试: abnormal flags STUNNED / UNMOVABLE). */
const held = (e) => e.buffs.some((b) => (b.status ?? b.key) === 'stun' || (b.status ?? b.key) === 'bind');
/** The S3 burn of one 赫德雷 on an enemy (independentCharacterSource: one per source). */
const smokeKey = (unit) => `skill:hodrer:smoke:${unit.id}`;

export default {
  char_4088_hodrer: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const hidden = moduleBb(chess);   // CRU-Y stage 3: stun (the first-hit stun on an enemy he blocks)
    const tb = traitBb(chess);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const selfHeal = (battle, unit, ratio) => { if (ratio > 0) battle.heal(unit, unit, unit.s.maxHp * ratio, { self: true }); };
    /** S3: mark `e` (not 无敌) for this cast — its own 1 s burn until the skill ends. */
    const mark = (battle, unit, e) => {
      const marks = unit.mem.hodrerMarks;
      if (!marks || marks.has(e) || !e.alive || e.s.flags.invulnerable) return;
      marks.add(e);
      const dmg = num(b3['attack@damage']);
      battle.addBuff(e, {
        key: smokeKey(unit), interval: SMOKE_IV, source: unit, tags: ['skill'],
        onTick: ({ battle: b, unit: target }) => { if (dmg > 0) b.dealDamage(unit, target, periodicDamage(dmg)); },
      });
    };
    return {
      skills: {
        [S1]: {
          kind: 'instant',
          attack: { atkScale: num(b1.atk_scale, 1) },
          onAttack({ battle, unit }) { selfHeal(battle, unit, num(b1.hp_ratio)); },
        },
        [S2]: {
          kind: 'toggle',
          mods: { batPct: batMod(b2.base_attack_time, chess), blockCnt: num(b2.block_cnt) },
        },
        [S3]: {
          kind: 'duration',
          mods: { hpPct: num(b3.max_hp), atkPct: num(b3.atk) },
          targeting: { rangeExtend: num(b3.ability_range_forward_extend) },
          onStart({ battle, unit, skill }) {
            const n0 = skill.activations;
            unit.mem.hodrerMarks = new Set();
            unit.mem.hodrerSmoke = battle.every(SMOKE_IV, (b, sc) => {
              if (!skill.active || skill.activations !== n0 || !up(unit)) { sc.cancel(); return; }
              battle.loseHp(unit, num(b3['attack@value']), { source: unit, tags: ['hodrer:smoke'] });
            }, { owner: unit });
          },
          onAttack({ battle, unit }) { selfHeal(battle, unit, num(b3['attack@hp_ratio'])); },
          onEnd({ battle, unit }) {
            unit.mem.hodrerSmoke?.cancel();
            unit.mem.hodrerSmoke = null;
            for (const e of unit.mem.hodrerMarks ?? []) battle.removeBuff(e, smokeKey(unit));
            unit.mem.hodrerMarks = null;
          },
        },
      },
      talents: [
        { install(battle, unit) { // 及锋而试 (+ the riders that precede it): ×atk_scale_2, ×atk_scale on a stunned / bound target
          const firstStun = num(hidden.stun);
          let stunnedOnce = new WeakSet();   // CRU-Y stage 3's marks, gone with his deployment
          battle.on('deploy', (c) => { if (c.unit === unit) stunnedOnce = new WeakSet(); }, { owner: unit });
          battle.on('hit', (c) => {
            const d = c.dmg, e = c.target;
            if (c.source !== unit || !d.isAttack || d.cancel || !e || e.side !== 'enemy') return;
            const sk = unit.skill;
            if (sk?.active && sk.id === S2) battle.applyStatus(e, 'stun', { duration: num(b2['attack@stun']), source: unit });
            if (sk?.active && sk.id === S3 && e.alive && battle.rng.chance(num(b3['attack@buff_prob']))) {
              battle.applyStatus(e, 'stun', { duration: num(b3['attack@stun']), source: unit });
            }
            if (firstStun > 0 && e.alive && e.blockedBy === unit && !stunnedOnce.has(e)) {
              stunnedOnce.add(e);
              battle.applyStatus(e, 'stun', { duration: firstStun, source: unit });
            }
            d.amount *= held(e) ? num(t0.atk_scale, 1) : num(t0.atk_scale_2, 1);
          }, { owner: unit, priority: T1_PRIORITY });
        } },
        { install(battle, unit) { // 余火之氅: 庇护 (and CRU-X stage 3 物理伤害 +) on his tile and the one behind
          const dr = num(t1.damage_resistance), ds = num(t1.damage_scale, 1);
          const grid = talentGrid(chess, 1) ?? BEHIND;
          if (!(dr > 0) && ds === 1) return;
          const give = () => {
            if (!up(unit)) return;
            for (const a of alliesInGridOf(battle, unit, grid)) {
              holdProtect(battle, a, dr, PROTECT_IV + 0.1, unit);
              if (ds !== 1) battle.applyStrongest(a, DMG_UP_KEY, { duration: PROTECT_IV + 0.1, value: ds, mods: (v) => ({ physDealtMul: v }), source: unit });
            }
          };
          battle.every(PROTECT_IV, give, { owner: unit });
          battle.on('battleStart', give, { owner: unit });
          battle.on('deploy', (c) => { if (c.unit === unit && battle.started) give(); }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // CRU-X: 受到的治疗效果提升20%
        statBuff(battle, unit, 'trait:hodrer:heal', { healingTakenMul: num(tb.heal_scale, 1) });
        // CRU-Y: 对被（自身）阻挡的敌人伤害提升至110%
        const vs = num(tb.damage_scale, 1);
        if (vs !== 1) {
          battle.on('hit', (c) => {
            if (c.source === unit && c.target && c.target.side === 'enemy' && c.target.blockedBy === unit) c.dmg.mul *= vs;
          }, { owner: unit });
        }
        // S2's passive part: 攻击力+16% while 余烬重荷 is his skill
        if (unit.skill?.id === S2) statBuff(battle, unit, S2_PASSIVE_KEY, { atkPct: num(b2.atk) });
        // S3: every damage either way between him and an enemy marks the enemy for the running cast
        if (unit.skill?.id === S3) {
          battle.on('hit', (c) => {
            if (!unit.mem.hodrerMarks) return;
            if (c.source === unit && c.target && c.target.side === 'enemy') mark(battle, unit, c.target);
            else if (c.target === unit && c.source && c.source.side === 'enemy') mark(battle, unit, c.source);
          }, { owner: unit });
        }
      },
    };
  },
};
