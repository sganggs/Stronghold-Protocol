// server/sim/content/kits/ops/op-cerber.js — 刻俄柏 (char_2013_cerber) 自选 operator kit: 6★ 中坚术师 (术师), an owned-6★
// pick of the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_2013_cerber, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json; every module part is
// valid outside 集成战略 — no `validInGameTag`) and PRTS 刻俄柏 (S2 "攻击间隔缩短(*0.6)" / "较大幅度缩短(*0.4)": a ratio of the
// interval; 剥壳 备注 "处理敌人防御力时不考虑物理穿透", "<X模组>每次攻击与上一次攻击相同的目标时，将提升5%的比例值（第五次后达到
// 最大值，于剥壳伤害前处理）；攻击不同目标时比例值立刻重置"; 独行长路 能力生效范围 x-5 and 备注 "天赋判定范围包括刻俄柏所在格，不判定
// 目标的可选性、实体类型等；天赋生效期间检测到敌人类我方单位时不会主动失效，但失效期间检测到敌人类我方单位后，直到该敌人类我方单位退场前
// 无法重新生效", "<Y模组>本天赋不再通过原本的判定方式生效/失效…部署时检测到敌人类我方单位也会失效").
// - Trait (中坚术师) "攻击造成法术伤害": the profession default (ranged arts, hits air, block 1). Module CCR-X “很干的面包”
//   adds "无视目标10点法术抗性" (trait bb magic_resist_penetrate_fixed: a permanent resIgnoreFlat), CCR-Y “我打的刀”
//   "普通攻击命中精英或领袖敌人时获得1点技力" (trait bb sp: per hit of one of her attacks on an elite / leader; a running timed
//   skill takes no SP, as always).
// - T1 剥壳 "攻击时对目标额外造成相当于其防御力40%的法术伤害" (full potential: 44 %): each hit of her attacks (S3's physical
//   spear too) is followed by atk_scale × the target's DEF (its current DEF, her own penetration ignored — she has
//   none) as arts damage, a damage instance of the talent (not an attack: no further on-hit effects). A target with no
//   DEF takes none (PRTS: she "tries" and deals nothing; no flat arts bonus exists in this mode that a zero hit could
//   carry). CCR-X stage 2+ (bb basic_atk_scale / delta_atk_scale / max_atk_scale): 54 % +5 % per consecutive hit on the
//   same target, ≤ 79 %, back to 54 % on another target (PRTS 备注), counted from the start of each deployment
//   [ASSUMED].
// - T2 独行长路 "当周围四格内没有其他友方单位时，攻击力+8%，攻击速度+8": while no other ally unit (operator, summon or device —
//   PRTS: no selectability / entity check) stands on her tile or the four next to it (x-5), with the 敌人类我方单位 rule
//   of the 备注 (炎佑: an ally built from an enemy record; it does not switch the talent off, but one seen while it is off
//   keeps it off until that unit leaves the field). CCR-Y stage 2+ ("部署时若周围四格内没有其他友方单位，攻击力+15%，攻击速度
//   +15"): checked once per deployment — an ally of either kind there switches it off for that deployment; the battle's
//   initial deployment counts as one moment, every board piece already placed [ASSUMED: the pieces of the mode are on the
//   board together before the battle starts; the official deploys one at a time].
// - S1 “很冰的斧” (AUTO, 可充能 1 / 2, data DEFAULT): the next attack at atk_scale × ATK, on an enemy that nobody blocks first
//   (the usual order among those, then the blocked ones), binding (束缚) it for `duration` s.
// - S2 “很热的刀” (MANUAL, 33 / 36 s, data DEFAULT): attack interval × base_attack_time (0.6 / 0.4: PRTS "(*0.4)"), the
//   highest-DEF enemy first.
// - S3 “很重的枪” (MANUAL, 56 / 57 s, data ACTIVE_RANGE on 3-3): attack range 3-3 while it runs, ATK +atk, physical damage,
//   the lowest-DEF enemy first, each hit silences (失去特殊能力) for attack@silence s.
// - No summon (the forms list no token).

import { num, talentBb, traitBb, skillRec, statBuff, toggleBuff, batMod, giveSp, up } from '../shared/tier1.js';
import { sortEnemyTargets } from '../../../targeting.js';
import { offsetTile } from '../../../dir.js';
import { hasHp } from '../../../attack.js';

const S1 = 'skchr_cerber_1';
const S2 = 'skchr_cerber_2';
const S3 = 'skchr_cerber_3';
/** 独行长路's area: her tile and the four next to it (PRTS 能力生效范围 x-5; the data carries no talent grid). */
const X5 = Object.freeze([[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]);
/** S3's 3-3 when the data carries no grid. */
const R33 = Object.freeze([[1, 0], [1, 1], [1, 2], [1, 3], [0, 0], [0, 1], [0, 2], [0, 3], [-1, 0], [-1, 1], [-1, 2], [-1, 3]]);
/** 剥壳's extra damage (a talent instance: never itself followed by 剥壳). */
const SHELL_TAG = 'cerber:shell';
const LONE_KEY = 'talent:cerber:lone';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** An elite or leader enemy (精英或领袖敌人). */
const isEliteEnemy = (e) => !!e && e.side === 'enemy' && (e.isBoss || e.def?.rank === 'ELITE' || e.def?.rank === 'BOSS');
const tagged = (d, tag) => !!(d && d.tags && d.tags.includes(tag));
/** A module trait that works 在集成战略中 only (ISW modules): nothing of it applies in this mode. */
const roguelikeOnly = (chess) => /集成战略/.test(String(chess?.trait?.moduleDesc ?? ''));
/** Named talent `i` of the record (its desc tells the module stage's wording). */
const talentRec = (chess, i) => (chess?.talents ?? []).filter((t) => t && t.index !== -1)[i] ?? null;
/** PRTS's 敌人类我方单位: an ally built from an enemy record (炎佑 enemy_9012_acloon, content/items/battle.js). */
const enemyLike = (a) => /^enemy_/.test(String(a?.defId ?? a?.def?.id ?? ''));

/** The other ally units on her x-5 (any kind — PRTS: "不判定目标的可选性、实体类型等"). */
function othersAround(battle, unit) {
  const out = [];
  for (const [dr, dc] of X5) {
    const [r, c] = offsetTile(unit.tileR, unit.tileC, dr, dc, unit.dir);
    const o = battle.grid.inBounds(r, c) ? battle.unitAt(r, c) : null;
    if (o && o !== unit && o.side === 'ally' && !out.includes(o)) out.push(o);
  }
  return out;
}

export default {
  char_2013_cerber: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const onDeploy = /部署时/.test(String(talentRec(chess, 1)?.desc ?? ''));   // CCR-Y stage 2+
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s1 = skillRec(chess, S1), s2 = skillRec(chess, S2), s3 = skillRec(chess, S3);
    return {
      skills: {
        [S1]: {
          kind: num(s1?.maxChargeTime, 1) > 1 ? 'charges' : 'instant',
          attack: { atkScale: num(b1.atk_scale, 1), onHitStatus: { key: 'bind', duration: num(b1.duration) } },
        },
        [S2]: {
          kind: 'duration',
          mods: { batPct: batMod(b2.base_attack_time, chess, s2?.desc) },
          targeting: { priority: 'highDef' },
        },
        [S3]: {
          kind: 'duration',
          mods: { atkPct: num(b3.atk) },
          targeting: { rangeGrid: s3?.rangeGrid ?? R33, priority: 'lowDef' },
          attack: { dmgType: 'phys', onHitStatus: { key: 'silence', duration: num(b3['attack@silence']) } },
        },
      },
      talents: [
        { install(battle, unit) { // 剥壳: DEF × ratio arts after each hit; CCR-X stage 2+: the ratio climbs on the same target
          const base = num(t0.basic_atk_scale, num(t0.atk_scale)), delta = num(t0.delta_atk_scale), top = num(t0.max_atk_scale, base);
          if (!(base > 0)) return;
          battle.on('deploy', (ctx) => { if (ctx.unit === unit) { unit.mem.cerberShellTarget = null; unit.mem.cerberShellScale = base; } }, { owner: unit });
          battle.on('damaged', (ctx) => {
            const t = ctx.target, d = ctx.dmg;
            if (ctx.source !== unit || !t || t.side !== 'enemy' || !d || !d.isAttack || d.isSplash || tagged(d, SHELL_TAG)) return;
            let sc = base;
            if (delta > 0) {
              // "于剥壳伤害前处理": the same target as her previous hit +delta (≤ max), another one back to the base
              sc = unit.mem.cerberShellTarget === t ? Math.min(top, num(unit.mem.cerberShellScale, base) + delta) : base;
              unit.mem.cerberShellTarget = t;
              unit.mem.cerberShellScale = sc;
            }
            const def = t.s.def;
            if (def > 0 && hasHp(t)) battle.dealDamage(unit, t, { amount: def * sc, type: 'arts', tags: [SHELL_TAG] });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 独行长路
          const mods = { atkPct: num(t1.atk), aspd: num(t1.attack_speed) };
          if (!mods.atkPct && !mods.aspd) return;
          if (onDeploy) {
            // CCR-Y stage 2+: the deployment's check, for the whole deployment
            const check = () => {
              if (!up(unit)) return;
              if (othersAround(battle, unit).length) battle.removeBuff(unit, LONE_KEY);
              else battle.addBuff(unit, { key: LONE_KEY, mods, tags: ['talent'] });
            };
            battle.on('battleStart', check, { owner: unit });
            battle.on('deploy', (ctx) => { if (ctx.unit === unit && battle.started) check(); }, { owner: unit });
            return;
          }
          // the base talent, checked every tick: an ordinary ally switches it off; an enemy-like one seen while it is off
          // keeps it off until that unit leaves the field
          let on = false;
          const locks = new Set();
          battle.on('tick', () => {
            if (!up(unit)) { on = false; locks.clear(); return; }
            const near = othersAround(battle, unit);
            if (on && near.some((a) => !enemyLike(a))) on = false;
            if (!on) {
              for (const a of near) if (enemyLike(a)) locks.add(a);
              for (const a of locks) if (!a.alive || !a.deployed) locks.delete(a);
              if (!near.length && !locks.size) on = true;
            }
          }, { owner: unit, priority: 1 });
          toggleBuff(battle, unit, LONE_KEY, () => on, mods);
        } },
      ],
      install(battle, unit) {
        // module traits (none on the normal form): CCR-X 无视目标10点法术抗性, CCR-Y SP per hit on an elite / leader
        if (!roguelikeOnly(chess)) {
          const tb = traitBb(chess);
          const pen = num(tb.magic_resist_penetrate_fixed);
          if (pen > 0) statBuff(battle, unit, 'trait:cerber:resIgnore', { resIgnoreFlat: pen });
          const sp = num(tb.sp);
          if (sp > 0) {
            battle.on('damaged', (ctx) => {
              const d = ctx.dmg;
              if (ctx.source !== unit || !d || !d.isAttack || d.isSplash || !isEliteEnemy(ctx.target)) return;
              giveSp(unit, sp, 'trait');
            }, { owner: unit });
          }
        }
        if (unit.skill?.id === S1) {
          // “很冰的斧” "优先攻击没有被阻挡的目标": the pending attack re-picks its target, unblocked enemies first
          battle.on('beforeAttack', (ctx) => {
            if (ctx.attacker !== unit || !ctx.isSkill || !ctx.targets.length) return;
            const prof = ctx.profile;
            const cands = battle.enemiesInKeys(unit.rangeKeys, unit, prof);
            for (const e of battle.blockedTargets(unit, prof)) if (!cands.includes(e)) cands.push(e);
            if (!cands.length) return;
            sortEnemyTargets(battle, unit, cands, prof.priority);
            ctx.targets = [cands.find((e) => !e.blockedBy) ?? cands[0]];
          }, { owner: unit });
        }
      },
    };
  },
};
