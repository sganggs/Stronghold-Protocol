// server/sim/content/kits/ops/op-nian.js — 年 (char_2014_nian) 自选 operator kit: 6★ 铁卫 (重装), an owned-6★ pick of the
// tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_2014_nian, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json), gamedata_const
// ba.shield 护盾 ("每层护盾可以抵挡一次伤害") and ba.buffres 抵抗, PRTS 年 (积甲成山 备注 "根据重装干员数量获得的治疗效果加成与
// 生命上限加成叠加时以加法叠加"; 干明可鉴 备注 "攻击力与防御力增益持续时间无限"; 铜印 备注 "沉默效果与反伤效果会直接选中伤害来源，
// 但仅对阵营为敌方的来源产生效果"; 铁御 技能范围 x-2).
// - Trait (铁卫) "能够阻挡三个敌人": the profession default (block 3 from the data stats), ground-only physical melee on her
//   1-1. Module PRO-X 混沌阵列 adds "阻挡敌人时防御力+20%" (trait bb def): DEF + while she blocks at least one enemy.
//   Module PRO-Y “请勿叩门” "能够阻挡四个敌人" (attr block_cnt +1, already in the stats). From stage 2 its trait part carries
//   the blackboard of 积甲成山's module text (battle_equip_table: TRAIT part max_hp / heal_scale / heal_scale_addition /
//   heal_scale_max_value / max_stack_cnt, the talent part only the team bonus) "场上每有一名重装干员，自身受到治疗效果和生命上限
//   额外提升4%，最多叠加3层": n = the 重装 operators on the field, her included [ASSUMED: "每有一名重装干员" counts every 重装 on
//   the field] and a teammate's in a shared field (alliesFor), at most max_stack_cnt — max HP +max_hp × n (直接乘算 with her
//   other "+%" bonuses) and healing received ×(heal_scale + heal_scale_addition × n), at most heal_scale_max_value (the
//   PRTS note's 加法叠加: the stacks add up, 104 / 108 / 112 %). Re-counted every tick.
// - T1 积甲成山 "编入队伍时，所有【重装】职业干员的生命上限+16%" (full potential: +20 %): every 重装 operator of her player's team (her included) max HP
//   +max_hp for the whole battle, deployed or not (the kits' 编入队伍时 convention: 斯卡蒂 深海掠食者, 早露 学生楷模). PRO-Y
//   stage 3: +25 % (the module talent change).
// - T2 干明可鉴 "部署后立即获得3层护盾": `times` 护盾 layers at every deployment (a hit-negating barrier: buff shieldHits — each
//   layer negates one damage instance). PRO-X stage 2+ (talent change atk / def / sp / max_stack_cnt) "每层护盾破裂时，攻击力
//   +7%，防御力+7%且获得3点技力": each broken layer one more stack of ATK / DEF + (at most max_stack_cnt; "持续时间无限": until she
//   leaves the field [ASSUMED: a deployment's layers give a deployment's stacks]) and +sp SP (none while a skill runs: AK's
//   no-SP-during-a-skill rule, tier1 giveSp).
// - S1 锡灼 (MANUAL, time SP; data DEFAULT — the owner's 重装 cast-in-range exception, rawRule TAKE_DAMAGE): `duration` s of
//   DEF +def and ATK +atk; normal attacks deal arts damage.
// - S2 铜印 (MANUAL; data DEFAULT): `duration` s — stops attacking; DEF +def, block +block_cnt; every enemy damage instance she
//   takes (its attack or not, as 星熊 荆棘 / 泡泡) deals atk_scale × ATK arts to its source and silences it `silence`
//   s ("失去特殊能力"): a direct pick of the damage source (ignoreSelect), enemies only (PRTS 备注), even when a 护盾 layer
//   negated the hit.
// - S3 铁御 (MANUAL; data DEFAULT — its x-2 is a 技能范围 for the allies, no attack-range change): `duration` s of ATK
//   +[self].atk (block +[self].block_cnt = 0); every other allied operator on her x-2 ("周围其他友方干员": summons are no 干员
//   [ASSUMED]) gets DEF +[ally].def, block +[ally].block_cnt and 抵抗 (the engine `resist` status, value
//   −one_minus_status_resistance), refreshed every AURA s while the skill runs; two 年 of a shared field keep the stronger
//   (installAura's rule). The DEF / block buff ends with the skill, the 抵抗 within AURA_DUR.

import { num, talentBb, traitBb, skillRec, statBuff, toggleBuff, up, giveSp, byEnemyDamage } from '../shared/tier1.js';
import { absoluteRangeKeys } from '../../../targeting.js';
import { COLS } from '../../../constants.js';

const S1 = 'skchr_nian_1';
const S2 = 'skchr_nian_2';
const S3 = 'skchr_nian_3';
/** 铁御's aura: refresh period and buff lifetime (s) — the tier-4 kits' AURA / AURA_DUR. */
const AURA = 0.2;
const AURA_DUR = 0.25;
/** 铁御's 技能范围 x-2 when the data carries no grid. */
const X2 = Object.freeze([[2, -1], [2, 0], [2, 1], [1, -2], [1, -1], [1, 0], [1, 1], [1, 2], [0, -2], [0, -1], [0, 0], [0, 1],
  [0, 2], [-1, -2], [-1, -1], [-1, 0], [-1, 1], [-1, 2], [-2, -1], [-2, 0], [-2, 1]]);
const SHIELD = 'talent:nian:shield';
const BREAK = 'talent:nian:shieldBreak';
const GUARD = 'skill:nian:ironGuard';
const FORT = 'trait:nian:fortify';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** A 【重装】 operator (summons are never 重装 operators). */
const isTank = (a) => !!a && a.kind === 'op' && a.def?.profession === 'TANK';
/** The mods of `o` without its zero entries. */
const nz = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => Number.isFinite(v) && v !== 0));

export default {
  char_2014_nian: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const tb = traitBb(chess);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const guardGrid = skillRec(chess, S3)?.rangeGrid ?? X2;
    const allyDef = num(b3['nian_s_3[ally].def']), allyBlock = num(b3['nian_s_3[ally].block_cnt']);
    const resist = Math.min(0.95, Math.max(0, -num(b3.one_minus_status_resistance)));
    /** 铁御: the other allied operators on her x-2 get the DEF / block buff and 抵抗 for AURA_DUR. */
    const ironGuard = (battle, unit) => {
      const keys = new Set(absoluteRangeKeys(guardGrid, unit.tileR, unit.tileC, unit.dir, 0));
      for (const a of battle.alliesFor(unit)) {
        if (a === unit || a.kind !== 'op' || a.hidden || !keys.has(a.tileR * COLS + a.tileC)) continue;
        const cur = a.findBuff(GUARD);
        if (!(cur && cur.source !== unit && (cur.data?.v ?? 0) > allyDef && cur.timeLeft > 0.05)) {
          battle.addBuff(a, { key: GUARD, duration: AURA_DUR, mods: nz({ defPct: allyDef, blockCnt: allyBlock }), source: unit, data: { v: allyDef }, tags: ['skill', 'aura'] });
        }
        if (resist > 0) battle.applyStatus(a, 'resist', { duration: AURA_DUR, value: resist, source: unit });
      }
    };
    return {
      skills: {
        [S1]: { kind: 'duration', mods: nz({ defPct: num(b1.def), atkPct: num(b1.atk) }), attack: { dmgType: 'arts' } },
        [S2]: {
          kind: 'duration', mods: nz({ defPct: num(b2.def), blockCnt: num(b2.block_cnt) }), attack: { noAttack: true },
          onStart({ battle, unit }) {
            battle.addBuff(unit, { key: 'nian:copperSeal', tags: ['skill'], observeInjury(c) {
              const src = c.source;
              if (!unit.alive || !byEnemyDamage(c) || !src.alive) return;
              const scale = num(b2.atk_scale), sil = num(b2.silence);
              if (scale > 0) battle.dealDamage(unit, src, { amount: unit.s.atk * scale, type: 'arts', canDodge: false, isSkill: true, ignoreSelect: true, tags: ['skill', 'counter'] });
              if (sil > 0 && src.alive) battle.applyStatus(src, 'silence', { duration: sil, source: unit });
              battle.fx('counter', { x: src.x, y: src.y, id: unit.id });
            } });
          },
          onEnd({ battle, unit }) { battle.removeBuff(unit, 'nian:copperSeal'); },
        },
        [S3]: {
          kind: 'duration',
          mods: nz({ atkPct: num(b3['nian_s_3[self].atk']), blockCnt: num(b3['nian_s_3[self].block_cnt']) }),
          onStart({ battle, unit }) {
            unit.mem.nianGuardAcc = 0;
            ironGuard(battle, unit);
            battle.fx('buff', { x: unit.x, y: unit.y, id: unit.id, kind: 'nian:ironGuard' });
          },
          onTick({ battle, unit, dt }) {
            unit.mem.nianGuardAcc = (unit.mem.nianGuardAcc ?? 0) + dt;
            if (unit.mem.nianGuardAcc + 1e-9 < AURA) return;
            unit.mem.nianGuardAcc -= AURA;
            ironGuard(battle, unit);
          },
          onEnd({ battle, unit }) {
            for (const a of battle.allyUnits) {
              const b = a.findBuff(GUARD);
              if (b && b.source === unit) battle.removeBuff(a, b);
            }
          },
        },
      },
      talents: [
        { install(battle, unit) { // 积甲成山: every 重装 operator of her team max HP +max_hp (PRO-Y stage 3: the module's value)
          const hp = num(t0.max_hp);
          if (!(hp > 0)) return;
          for (const a of battle.allyUnits) if (isTank(a) && a.ownerId === unit.ownerId) statBuff(battle, a, 'talent:nian:armor', { hpPct: hp });
        } },
        { install(battle, unit) { // 干明可鉴: `times` 护盾 layers at every deployment; PRO-X stage 2+: ATK / DEF stack + SP per broken layer
          const times = Math.max(0, Math.floor(num(t1.times)));
          if (!(times > 0)) return;
          const atk = num(t1.atk), def = num(t1.def), sp = num(t1.sp), cap = Math.max(1, Math.floor(num(t1.max_stack_cnt, 1)));
          battle.on('deploy', (c) => {
            if (c.unit !== unit) return;
            unit.mem.nianLayers = times;
            battle.addBuff(unit, { key: SHIELD, shieldHits: times, visible: true, tags: ['talent'] });
            battle.fx('shield', { x: unit.x, y: unit.y, id: unit.id, n: times });
          }, { owner: unit });
          if (!(atk || def || sp)) return;
          battle.on('block', (c) => {
            if (c.target !== unit || !unit.alive) return;
            const left = unit.findBuff(SHIELD)?.shieldHits ?? 0;
            const broken = (unit.mem.nianLayers ?? 0) - left;
            if (!(broken > 0)) return;
            unit.mem.nianLayers = left;
            for (let i = 0; i < broken; i++) {
              if (atk || def) battle.addBuff(unit, { key: BREAK, refresh: 'stack', stacks: 1, maxStacks: cap, mods: nz({ atkPct: atk, defPct: def }), visible: true, tags: ['talent'] });
              giveSp(unit, sp);
            }
            battle.fx('shieldBreak', { x: unit.x, y: unit.y, id: unit.id });
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // PRO-X 混沌阵列: 阻挡敌人时防御力+20%
        const blockDef = num(tb.def);
        if (blockDef) toggleBuff(battle, unit, 'trait:nian:block', () => unit.blocking.length > 0, { defPct: blockDef });
        // PRO-Y stage 2+: per 重装 operator on the field max HP +max_hp and healing received +heal_scale_addition (≤ the cap)
        const perHp = num(tb.max_hp), healAdd = num(tb.heal_scale_addition), stackCap = Math.floor(num(tb.max_stack_cnt));
        if ((perHp > 0 || healAdd > 0) && stackCap > 0) {
          const healBase = num(tb.heal_scale, 1), healMax = num(tb.heal_scale_max_value, Infinity);
          battle.on('tick', () => {
            const cur = unit.findBuff(FORT);
            const n = up(unit) ? Math.min(stackCap, battle.alliesFor(unit).filter(isTank).length) : 0;
            if ((cur?.data?.n ?? 0) === n) return;
            if (!(n > 0)) { battle.removeBuff(unit, FORT); return; }
            battle.addBuff(unit, { key: FORT, mods: nz({ hpPct: perHp * n, healingTakenMul: Math.min(healMax, healBase + healAdd * n) }), data: { n }, tags: ['trait'] });
          }, { owner: unit });
        }

      },
    };
  },
};
