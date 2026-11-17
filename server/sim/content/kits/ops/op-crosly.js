// server/sim/content/kits/ops/op-crosly.js — 弑君者 (char_1502_crosly) 自选 operator kit: 6★ 处决者 (特种), an owned-6★ pick
// of the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules (EXE-X 弑君刃, EXE-Y 木炭画) at
// every form. Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_1502_crosly, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6) — the owner's decision of 2026-10-05.
// Full potential (the owner's decision of 2026-10-07). Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into
// backups.json); PRTS 弑君者 (吞咽苦厄 备注 "天赋生效范围为x-4"; 弑君者威名 备注 "<Y模组>任何来源为弑君者的晕眩…均可触发模组的额外
// 效果" / "<Y模组>额外效果在弑君者付与晕眩效果时检查目标是否伤害过自身，若没有则令该次晕眩Buff的持续时间变为1.25倍/1.5倍"; 硝烟震爆
// 备注 "技能持续期间获得嘲讽等级-1"; 烽烟行刑场 备注 "部署时阻挡数立刻归零；不会改变攻击范围/视野范围" / "“6秒内只会触发一次”的
// 实际效果为受到弑君者伤害的单位获得持续6秒的“已攻击”标记Buff，可因任何来源于弑君者的伤害触发；技能期间弑君者始终不攻击具有“已攻击”
// 标记的单位" / "此技能包含隐匿的Buff被隐匿反制解除时，失去“阻挡数变为0”的效果"); PRTS 命中率; the client's battle data —
// charpack char_1502_crosly (modes Default / S1 / S2 (no attack, Talents/t1 `_applyTalentScale`) / S3 (attack: cooldown
// `s3_cd`, `atk_scale_s3`, `_additionalTimes` 1, active buff stun, selector: ground enemies without her crosly_s_3[mark];
// `_rangeToShow` 1-1) / S2_End (attack `atk_scale_s2` on every ground enemy of the x-4, `_allowNoTarget`); Talents/t1 per
// mode: the hit-rate aura over ground enemies (attributes 33 / 34, range x-4 — S3: the skill's range); Talents/t2:
// crosly_t_2), the skill prefabs skchr_crosly_1 / _2 / _3 (S1: crosly_s_1[mode] ATK + crosly_s_1[evade] (evade: physical
// and arts) for `duration`; S2: crosly_s_2[start] (taunt level) for `duration`, then mode S2_End; S3: crosly_s_3[mode]
// for `duration` + crosly_s_3[invisible] (abnormal flag 隐匿, block count ×0)), the equips crosly_equip_2_* (the EXE-Y
// trait: ATK while no allied unit of profession mask 639 — the eight operator professions — stands at Manhattan distance 1)
// / crosly_equip_2_2/3_p2 (crosly_e_003_t2[status-resist] on every enemy without her crosly_t_2[mark], every 0.1 s);
// buff_template_data (crosly_t_2: an enemy whose non-continuous, uncancelled damage she takes gets crosly_t_2[mark] — a
// derived buff, gone with her talent buff when she leaves the field; DamageScale `damage_scale` on PHYSICAL damage she
// deals to a target without it; crosly_s_2[end] (finished at once when she is STUNNED / FROZEN / DISARMED — no blast);
// crosly_s_3[mode] (her damage marks the target crosly_s_3[mark] for mark_duration, derived: gone when the skill ends);
// crosly_e_003_t2[status-resist] (a stun of hers on such an enemy: duration × |1 + one_minus_status_resistance|)).
// - Trait (处决者) "再部署时间大幅度减少": the data's respawnTime (18 s); melee physical, 1-1, blocks 1, ground-only (data
//   canHitFly false), attacks the enemies it blocks first (the engine's blocked-first rule); ground enemies target her.
// - Module EXE-X: "撤退时返还大量该次部署费用" — no manual retreat in battle in this mode ⇒ no effect (as 砾's EXE-X); stats;
//   stage 2+ changes T1 (−23 % / −25 %). EXE-Y: "周围四格没有友方干员时攻击力+10%" (trait bb atk): ATK +atk while no allied
//   operator — summons and devices do not count — stands on the 4 tiles beside her (op-phatom.js noOperatorBeside); stats;
//   stage 2+ changes T2 (below).
// - T1 吞咽苦厄 "技能持续期间在自身周围产生烟雾，使其中的地面敌人物理与法术命中率-20%": while any of her skills runs, the smoke covers
//   her x-4 (PRTS 备注; S3: the skill's x-1, "第一天赋的生效范围扩大"); each physical / arts attack of a selectable ground
//   enemy whose body is in it misses with |damage_hitrate_physical| / |damage_hitrate_magical| (×talent_scale while S2
//   runs): PRTS 命中率 — one roll per attack (its first damage instance) that cancels every hit of it, a battle-wide `hit`
//   handler as Raidian's / 阿斯卡纶's (the strongest smoke holding the attacker; other kinds of 命中率 cut roll apart
//   [ASSUMED, as theirs]).
// - T2 弑君者威名 "对未伤害过自身的地面敌人造成的物理伤害提升20%" (full potential: 22%): physical damage she deals to a ground
//   enemy that has not damaged her during this deployment ×damage_scale (a final multiplier, dmg.mul); an enemy is marked
//   by any damage of it she takes — not a 持续伤害 tick, not a 流失, not an element 损伤, not a dodged hit — and the marks
//   go when she leaves the field.
//   EXE-Y stage 2+ (crosly_e_003_t2[status-resist]): "且造成的晕眩效果影响时间+50%" — a stun of hers (any source, PRTS 备注)
//   on an enemy without that mark lasts ×(1 + one_minus_status_resistance) (the hidden module talent; 1.5 at stage 3).
// - S1 尘烟蔽目 (被动, at each deployment, the skill's duration 10 s): ATK +atk, physical and arts dodge `prob`.
// - S2 硝烟震爆 (被动, at each deployment, bb duration 8 s): no attacks, taunt level +taunt_level (−1), T1 ×talent_scale; at its
//   end — unless she cannot act (晕眩 / 冻结 / …) or is 缴械 then (crosly_s_2[end]) — every selectable ground enemy of the
//   x-4 smoke takes attack@atk_scale_s2 × ATK physical skill damage. [ASSUMED] the blast lands at once (the end clip's
//   wind-up is not modelled).
// - S3 烽烟行刑场 (被动, at each deployment, the skill's duration 16 s): 隐匿 and block count 0 (one buff: no enemy counters an
//   ally's 隐匿 in this mode); her normal attacks stop; her attack is a strike — ready at the start, then every
//   attack@s3_cd (2) s [ASSUMED: not shortened by attack speed] — on one selectable ground enemy of the x-1 smoke without
//   her mark (the engine's default target order): attack@times (2) hits of attack@atk_scale_s3 × ATK physical (a skill
//   attack: Battle.forceAttack) and 晕眩 attack@stun s; every damage she deals meanwhile marks its target for mark_duration
//   (6) s, the marks gone when the skill ends. Her attack range stays 1-1 (PRTS "不会改变攻击范围").
// Triggers: the three skills are 被动 ON_DEPLOY — timed deployment skills (activateOnDeploy, trigger NEVER).

import { num, talentBb, moduleBb, traitBb, skillRec, toggleBuff, up } from '../shared/tier1.js';
import { absoluteRangeKeys, canTargetEnemy, sortEnemyTargets } from '../../../targeting.js';
import { bodyInRange } from '../../../body.js';
import { noOperatorBeside } from './op-phatom.js';
import { cancelDamage } from '../../../attack.js';

const S1 = 'skchr_crosly_1';
const S2 = 'skchr_crosly_2';
const S3 = 'skchr_crosly_3';
/** 吞咽苦厄's smoke (PRTS 备注 "天赋生效范围为x-4"): her tile and the eight around it. */
const X4 = Object.freeze([[1, -1], [1, 0], [1, 1], [0, -1], [0, 0], [0, 1], [-1, -1], [-1, 0], [-1, 1]]);
/** 烽烟行刑场's smoke when its record carries no grid: range x-1 (the diamond of radius 2). */
const X1 = Object.freeze([[2, 0], [1, -1], [1, 0], [1, 1], [0, -2], [0, -1], [0, 0], [0, 1], [0, 2], [-1, -1], [-1, 0], [-1, 1], [-2, 0]]);
/** The smoke's 命中率 handler runs after Raidian's (300) and 阿斯卡纶's (290), before the enemy content's riders (200). */
const MISS_PRIORITY = 280;
const GROUND = Object.freeze({ canHitFly: false, groundOnly: true });
const TIMED = Object.freeze({ kind: 'duration', activateOnDeploy: true, spCost: 0, spType: 'none', trigger: 'NEVER' });
const TAG_BLAST = 'crosly:blast';
const skillOn = (u, id) => !!(u.skill && u.skill.active && (id == null || u.skill.id === id));

// ---- T1 命中率: one battle-wide handler over every 弑君者 of the battle ---------------------------------------------
/** battle → { srcs: [{ unit, phys, arts, scale, s3Grid }], last: WeakMap(enemy → { id, miss }) }. */
const SMOKE = new WeakMap();

/** The smoke's tiles of `u` now (S3: the skill's x-1, else her x-4). */
const smokeKeys = (u, s3Grid) => absoluteRangeKeys(skillOn(u, S3) ? s3Grid : X4, u.tileR, u.tileC, u.dir, 0);

/** The 命中率 cut (0–1) that ground enemy `e`'s attack of damage type `type` suffers: the strongest smoke holding it. */
function smokeCut(st, e, type) {
  let cut = 0;
  for (const s of st.srcs) {
    const u = s.unit;
    if (!up(u) || !skillOn(u)) continue;
    const v = (type === 'arts' ? s.arts : s.phys) * (skillOn(u, S2) ? s.scale : 1);
    if (!(v > cut) || !canTargetEnemy(u, e, GROUND) || !bodyInRange(e, smokeKeys(u, s.s3Grid))) continue;
    cut = v;
  }
  return Math.min(1, cut);
}

function smokeHit(battle, st, ctx) {
  const e = ctx.source, d = ctx.dmg;
  if (!e || e.side !== 'enemy' || e.isFlying || !d || !d.isAttack || d.cancel || (d.type !== 'phys' && d.type !== 'arts')) return;
  // one roll per attack: every damage instance of it shares the first instance's result
  const prev = d.attackId ? st.last.get(e) : null;
  let miss;
  if (prev && prev.id === d.attackId) miss = prev.miss;
  else {
    const cut = smokeCut(st, e, d.type);
    miss = cut > 0 && battle.rng() < cut;
    if (d.attackId) st.last.set(e, { id: d.attackId, miss });
  }
  if (!miss) return;
  const cancelled = cancelDamage(d, 'miss');
  if (cancelled) ctx.stopPropagation = true;
  if (ctx.target) battle.fx('dodge', { x: ctx.target.x, y: ctx.target.y, id: ctx.target.id });
}

function installSmoke(battle, src) {
  if (!(src.phys > 0) && !(src.arts > 0)) return;
  let st = SMOKE.get(battle);
  if (!st) {
    st = { srcs: [], last: new WeakMap() };
    SMOKE.set(battle, st);
    // no owner: it serves every 弑君者 of the battle, whichever is on the field
    battle.on('hit', (ctx) => smokeHit(battle, st, ctx), { priority: MISS_PRIORITY });
  }
  st.srcs.push(src);
}

// ---- S3 strikes -------------------------------------------------------------------------------------------------------
/** The strike's target: a selectable ground enemy of the x-1 smoke without her mark, the engine's default order. */
function strikeTarget(battle, unit, s3Grid) {
  const marks = unit.mem.croslyMarks;
  const list = battle.enemiesInKeys(smokeKeys(unit, s3Grid), unit, GROUND)
    .filter((e) => !(marks && marks.get(e) > battle.time + 1e-9));
  if (!list.length) return null;
  sortEnemyTargets(battle, unit, list, null);
  return list[0];
}

export default {
  char_1502_crosly: (bb, chess) => {
    const t0 = talentBb(chess, 0);   // 吞咽苦厄 (EXE-X stage 2+: −0.25)
    const t1 = talentBb(chess, 1);   // 弑君者威名 (EXE-Y stage 2+: 1.37)
    const osr = num(moduleBb(chess).one_minus_status_resistance);   // EXE-Y stage 2+: the stun duration share
    const lonelyAtk = num(traitBb(chess).atk);                       // EXE-Y trait (EXE-X: withdraw_cost_recover_ratio)
    const r1 = skillRec(chess, S1), r2 = skillRec(chess, S2), r3 = skillRec(chess, S3);
    const b1 = r1?.bb ?? {}, b2 = r2?.bb ?? {}, b3 = r3?.bb ?? {};
    const s3Grid = Array.isArray(r3?.rangeGrid) && r3.rangeGrid.length ? r3.rangeGrid.map((p) => [p[0], p[1]]) : X1;
    const cd3 = Math.max(0.1, num(b3['attack@s3_cd'], 2));
    const markDur = num(b3.mark_duration, 6);
    return {
      skills: {
        [S1]: { ...TIMED, duration: num(r1?.duration, 10), mods: { atkPct: num(b1.atk), dodgePhys: num(b1.prob), dodgeArts: num(b1.prob) } },
        [S2]: {
          ...TIMED, duration: num(b2.duration, 8), mods: { taunt: num(b2.taunt_level) }, attack: { noAttack: true },
          onEnd({ battle, unit, reason }) {
            // crosly_s_2[end]: STUNNED / FROZEN / DISARMED when it ends ⇒ no blast
            if (reason !== 'duration' || !up(unit) || !unit.canAct || unit.s.flags.disarm) return;
            const scale = num(b2['attack@atk_scale_s2']);
            for (const e of battle.enemiesInKeys(absoluteRangeKeys(X4, unit.tileR, unit.tileC, unit.dir, 0), unit, GROUND)) {
              if (e.alive && scale > 0) battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'phys', isSkill: true, tags: ['skill', TAG_BLAST] });
            }
            battle.fx('aoe', { x: unit.x, y: unit.y, radius: 1, id: unit.id, skill: TAG_BLAST });
          },
        },
        [S3]: {
          ...TIMED, duration: num(r3?.duration, 16),
          flags: { stealth: true }, mods: { blockCnt: -99 },
          attack: {
            noAttack: true, atkScale: num(b3['attack@atk_scale_s3'], 1), hits: Math.max(1, Math.floor(num(b3['attack@times'], 2))),
            onHitStatus: { key: 'stun', duration: num(b3['attack@stun']) },
          },
          onStart({ battle, unit }) {
            unit.mem.croslyMarks = new Map();
            unit.mem.croslyNext = battle.time;   // the strike is ready at the start
            battle.fx('stealth', { x: unit.x, y: unit.y, id: unit.id });
          },
          onTick({ battle, unit }) {
            if (!unit.canAct || unit.s.flags.disarm || battle.time + 1e-9 < num(unit.mem.croslyNext, 0)) return;
            const t = strikeTarget(battle, unit, s3Grid);
            if (!t) return;
            if (battle.forceAttack(unit, [t])) {
              unit.mem.croslyNext = battle.time + cd3;
              battle.fx('strike', { x: t.x, y: t.y, id: unit.id, target: t.id });
            }
          },
          onEnd({ unit }) { unit.mem.croslyMarks = null; },
        },
      },
      talents: [
        { install(battle, unit) { // 吞咽苦厄: the smoke's 命中率 cut (×talent_scale while S2 runs)
          installSmoke(battle, { unit, phys: Math.abs(num(t0.damage_hitrate_physical)), arts: Math.abs(num(t0.damage_hitrate_magical)), scale: num(b2.talent_scale, 1), s3Grid });
        } },
        { install(battle, unit) { // 弑君者威名 (+ EXE-Y stage 2+: the stun duration)
          const ds = num(t1.damage_scale, 1);
          battle.on('deploy', (c) => { if (c.unit === unit && !c.move) unit.mem.croslyHurtBy = new WeakSet(); }, { owner: unit, priority: 10 });
          battle.on('damaged', (c) => {
            const e = c.source, d = c.dmg;
            if (c.target !== unit || !e || e.side !== 'enemy' || c.type === 'element' || !d) return;
            if (d.tags && (d.tags.includes('dot') || d.tags.includes('periodic') || d.tags.includes('hpLoss'))) return;
            (unit.mem.croslyHurtBy ??= new WeakSet()).add(e);
          }, { owner: unit });
          const fresh = (e) => !(unit.mem.croslyHurtBy && unit.mem.croslyHurtBy.has(e));
          if (ds !== 1) {
            battle.on('hit', (c) => {
              const t = c.target, d = c.dmg;
              if (c.source !== unit || !t || t.side !== 'enemy' || t.isFlying || !d || d.type !== 'phys' || !fresh(t)) return;
              d.mul *= ds;
            }, { owner: unit });
          }
          if (osr > 0) {
            battle.on('beforeStatus', (c) => {
              if (c.source !== unit || c.status !== 'stun' || !c.target || c.target.side !== 'enemy' || !fresh(c.target)) return;
              c.duration *= Math.abs(1 + osr);
            }, { owner: unit });
          }
        } },
      ],
      install(battle, unit) {
        // 烽烟行刑场: every damage she deals while it runs marks its target for mark_duration s
        if (chess?.skill?.skillId === S3) {
          battle.on('damaged', (c) => {
            const t = c.target;
            if (c.source !== unit || !t || t.side !== 'enemy' || c.type === 'element' || !skillOn(unit, S3) || !unit.mem.croslyMarks) return;
            unit.mem.croslyMarks.set(t, battle.time + markDur);
          }, { owner: unit });
        }
        // EXE-Y "周围四格没有友方干员时攻击力+10%"
        if (lonelyAtk > 0) toggleBuff(battle, unit, 'trait:crosly:lonely', () => noOperatorBeside(battle, unit), { atkPct: lonelyAtk });
      },
    };
  },
};
