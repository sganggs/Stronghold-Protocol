// server/sim/content/kits/ops/op-amgoat.js — 艾雅法拉 (char_180_amgoat) 自选 operator kit: 6★ 中坚术师 (术师), an owned-6★
// pick of the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_180_amgoat, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json; every module part is
// valid outside 集成战略 — no `validInGameTag`) and PRTS 艾雅法拉 (S1 备注 "每次部署艾雅法拉时，重新计算该技能的使用次数";
// S2 备注 "爆炸范围为半径1.5", "技能实际效果为先削减主攻击目标的法术抗性，再对爆炸范围内所有敌人造成½倍率的伤害(包括主攻击目标)，
// 最后对主攻击目标额外造成一次½倍率的伤害", 法术抗性 "{{**|80%|-20%}}" = a multiplier; S3 "攻击间隔大幅度缩短(-1.1)";
// 乱火's hidden 备注 "在最小值与最大值之间随机生成一个浮点数后向下取整").
// - Trait (中坚术师) "攻击造成法术伤害": the profession default (ranged arts, hits air, block 1). Module CCR-X “错过的声音”
//   adds "无视目标10点法术抗性" (trait bb magic_resist_penetrate_fixed: a permanent resIgnoreFlat), CCR-Y “宠物大赛第一名”
//   "普通攻击命中精英或领袖敌人时获得1点技力" (trait bb sp: per hit of one of her attacks on an elite / leader — the S2
//   explosion's splash and its second ½ are not further 命中 [ASSUMED]; a running timed skill takes no SP, as always).
// - T1 炎息 "在场时，所有友方【术师】职业干员的攻击力+14%" (full potential: +16%): an aura on every 【术师】 operator of the
//   field (her included) while she is deployed (installAura, the kits' convention for field-wide talents; several sources
//   keep the strongest). CCR-X stage 2+ turns it into "携带时…+22%" (full potential: +24%; the module talent's bb): the
//   same aura whether she is on the field or not — she is carried while she belongs to the battle, knocked out or waiting
//   to redeploy included.
// - T2 乱火 "部署后立即随机获得7~15点技力" (full potential: 10~19; bb sp_min 10, sp_max 20): floor(uniform [sp_min, sp_max))
//   SP at every deployment (PRTS hidden 备注). CCR-Y stage 3 adds "并随机提升6~15的攻击速度" (attack_speed_min / _max, the
//   same draw) for that deployment [ASSUMED: no duration given — until she leaves the field], and with `factor`
//   "部署后范围内存在精英或领袖敌人时，获得的技力和提升的攻击速度取最大值": an elite or leader enemy in her attack range at
//   that deployment gives the text's maxima, 19 SP / 15 ASPD — the blackboard maxima are the exclusive bounds of the
//   draw (stage 2's attack_speed_max 1 with no ASPD in its text says so) [ASSUMED: 取最大值 = the largest value the draw
//   yields; checked at the deployment instant — at the battle start no enemy is on the field yet].
// - S1 二重咏唱 (MANUAL, 25 s, data DEFAULT): ASPD +[a].attack_speed; from the second cast of a deployment on, ASPD
//   +[b].attack_speed and ATK +[b].atk (PRTS 备注: the count restarts at every deployment).
// - S2 点燃 (AUTO, 可充能 2, data DEFAULT): the next attack, on impact — the main target's RES ×(1 + magic_resistance) for
//   `duration` s first, then an explosion of radius 1.5 around it (a 中点判定 splash) dealing atk_scale × ATK arts to
//   every enemy in it, the main target included, each of the others then getting the same RES cut, and last
//   atk_scale_2 × ATK arts to the main target again (the PRTS 备注's order; it names the main target's cut only as
//   coming first, so the others' cut follows their hit [ASSUMED]; the cut is "同名效果取最高" through applyStrongest).
//   The explosion reaches air units and skips enemies an area effect cannot select (foesInRadius); like the engine's
//   profession splash it can be dodged.
// - S3 火山 (MANUAL, 15 s): ATK +atk, attack interval base_attack_time (−1.1 s flat on her 1.6 s), the attack range x-3
//   while it runs, each attack throws lava at attack@max_target enemies of that range drawn at random (all of them when
//   fewer) — one projectile each, no splash [ASSUMED: the text names none]. Trigger: the data's SKILL_RANGE on
//   x-3 — its text says "攻击范围增大", which tools/build-data.mjs ATTACK_RANGE_CHANGE does not list, so the owner's
//   ACTIVE_RANGE rule did not reach it (reported; the kit keeps the data rule).
// - No summon (the forms list no token).

import { num, talentBb, traitBb, skillRec, statBuff, installAura, batMod, giveSp, onHitBy } from '../shared/tier1.js';
import { hasHp } from '../../../attack.js';
import { canTargetEnemy } from '../../../targeting.js';
import { bodyInRange } from '../../../body.js';

const S1 = 'skchr_amgoat_1';
const S2 = 'skchr_amgoat_2';
const S3 = 'skchr_amgoat_3';
/** S2 点燃: the explosion radius (PRTS 备注 "爆炸范围为半径1.5"; no blackboard key). */
const IGNITE_RADIUS = 1.5;
/** S3 火山's 技能范围 x-3 when the data carries no grid (range_table x-3: the tiles within 3 steps). */
const X3 = Object.freeze([[3, 0], [2, -1], [2, 0], [2, 1], [1, -2], [1, -1], [1, 0], [1, 1], [1, 2], [0, -3], [0, -2], [0, -1],
  [0, 0], [0, 1], [0, 2], [0, 3], [-1, -2], [-1, -1], [-1, 0], [-1, 1], [-1, 2], [-2, -1], [-2, 0], [-2, 1], [-3, 0]]);
/** Damage of the S2 explosion and its second ½ (not a further 命中 of the attack: CCR-Y counts the first). */
const IGNITE_TAG = 'amgoat:ignite';
const AURA_KEY = 'talent:amgoat:casters';
const AURA_EVERY = 0.5;

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** A 【术师】 operator (summons are never operators). */
const isCaster = (a) => !!a && a.kind === 'op' && a.def?.profession === 'CASTER';
/** An elite or leader enemy (精英或领袖敌人). */
const isEliteEnemy = (e) => !!e && e.side === 'enemy' && (e.isBoss || e.def?.rank === 'ELITE' || e.def?.rank === 'BOSS');
const tagged = (d, tag) => !!(d && d.tags && d.tags.includes(tag));
/** A module trait that works 在集成战略中 only (ISW modules): nothing of it applies in this mode. */
const roguelikeOnly = (chess) => /集成战略/.test(String(chess?.trait?.moduleDesc ?? ''));
/** Named talent `i` of the record (its desc tells the module stage's wording). */
const talentRec = (chess, i) => (chess?.talents ?? []).filter((t) => t && t.index !== -1)[i] ?? null;

/** "携带时": the aura of installAura, held while she belongs to the battle — on the field or not. */
function carriedAura(battle, unit, { key, select, mods, value }) {
  battle.every(AURA_EVERY, () => {
    for (const a of battle.alliesFor(unit)) {
      if (!select(a)) continue;
      const cur = a.findBuff(key);
      if (cur && cur.source !== unit && (cur.data?.v ?? 0) > value && cur.timeLeft > 0.05) continue;
      battle.addBuff(a, { key, duration: AURA_EVERY + 0.1, mods, source: unit, data: { v: value }, tags: ['aura'] });
    }
  }, { owner: unit, immediate: true });
}

export default {
  char_180_amgoat: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const carried = /携带时/.test(String(talentRec(chess, 0)?.desc ?? ''));
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s2 = skillRec(chess, S2), s3 = skillRec(chess, S3);
    const mr = num(b2.magic_resistance), resDur = num(b2.duration);
    const resCut = (battle, unit, e) => {
      if (e && e.alive && mr) battle.applyStrongest(e, 'amgoat:ignite', { duration: resDur, value: mr, mods: (v) => ({ resMul: Math.max(0, 1 + v) }), source: unit });
    };
    const maxLava = Math.max(1, Math.floor(num(b3['attack@max_target'], 1)));
    return {
      skills: {
        [S1]: {
          kind: 'duration',
          onStart({ battle, unit }) {
            // the casts of this deployment (PRTS 备注: "每次部署…重新计算该技能的使用次数")
            const n = unit.mem.amgoatDuetSeq === unit.deploySeq ? num(unit.mem.amgoatDuetN) + 1 : 1;
            unit.mem.amgoatDuetSeq = unit.deploySeq;
            unit.mem.amgoatDuetN = n;
            const mods = n >= 2
              ? { aspd: num(b1['amgoat_s_1[b].attack_speed']), atkPct: num(b1['amgoat_s_1[b].atk']) }
              : { aspd: num(b1['amgoat_s_1[a].attack_speed']) };
            battle.addBuff(unit, { key: 'skill:amgoat:duet', mods, tags: ['skill'] });
          },
          onEnd({ battle, unit }) { battle.removeBuff(unit, 'skill:amgoat:duet'); },
        },
        [S2]: {
          kind: num(s2?.maxChargeTime, 1) > 1 ? 'charges' : 'instant',
          attack: {
            // the engine's hit on the main target is its share of the explosion (½); the RES cut came first (install)
            atkScale: num(b2.atk_scale, 1),
            onEachHit({ battle, unit, target, kind }) {
              if (kind !== 'main' || !target) return;
              const atk = unit.s.atk, x = target.x, y = target.y;
              for (const e of battle.foesInRadius(x, y, IGNITE_RADIUS, true)) {
                if (e === target) continue;
                battle.dealDamage(unit, e, { amount: atk * num(b2.atk_scale, 1), type: 'arts', isAttack: true, isSplash: true, isSkill: true, tags: [IGNITE_TAG] });
                resCut(battle, unit, e);
              }
              if (hasHp(target)) battle.dealDamage(unit, target, { amount: atk * num(b2.atk_scale_2, num(b2.atk_scale, 1)), type: 'arts', isAttack: true, isSkill: true, tags: [IGNITE_TAG] });
              battle.fx('explosion', { x, y, id: unit.id, r: IGNITE_RADIUS, dmgType: 'arts' });
            },
          },
        },
        [S3]: {
          kind: 'duration',
          mods: { atkPct: num(b3.atk), batPct: batMod(b3.base_attack_time, chess) },
          // every enemy of x-3 is a candidate; install draws the lava targets among them
          targeting: { rangeGrid: s3?.rangeGrid ?? X3, allInRange: true },
        },
      },
      talents: [
        { install(battle, unit) { // 炎息: the field's 【术师】 ATK +atk — while she is deployed, or (CCR-X stage 2+) carried
          const a = num(t0.atk);
          if (!(a > 0)) return;
          const opts = { key: AURA_KEY, value: a, select: isCaster, mods: { atkPct: a } };
          if (carried) carriedAura(battle, unit, opts);
          else installAura(battle, unit, { ...opts, interval: AURA_EVERY });
        } },
        { install(battle, unit) { // 乱火: SP (and with CCR-Y stage 3 ASPD) at every deployment; the maxima with an elite in range
          const spLo = num(t1.sp_min), spHi = num(t1.sp_max), asLo = num(t1.attack_speed_min), asHi = num(t1.attack_speed_max);
          const maxRule = num(t1.factor) > 0;
          battle.on('deploy', (ctx) => {
            if (ctx.unit !== unit || !unit.alive) return;
            // (a scan of the enemies: the tile index of enemiesInKeys is the last tick's)
            const top = maxRule && battle.enemies.some((e) => isEliteEnemy(e) && canTargetEnemy(unit, e, unit.profile) && bodyInRange(e, unit.rangeKeySet));
            // floor of a uniform draw in [lo, hi); "取最大值" = the largest value the draw yields (hi − 1 for integer bounds)
            const draw = (lo, hi) => (hi > lo ? (top ? Math.ceil(hi) - 1 : Math.floor(battle.rng.range(lo, hi))) : 0);
            const sp = draw(spLo, spHi);
            if (sp > 0) giveSp(unit, sp);
            const as = draw(asLo, asHi);
            if (as > 0) battle.addBuff(unit, { key: 'talent:amgoat:wildfire', mods: { aspd: as }, tags: ['talent'] });
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // module traits (none on the normal form): CCR-X 无视目标10点法术抗性, CCR-Y SP per hit on an elite / leader
        if (!roguelikeOnly(chess)) {
          const tb = traitBb(chess);
          const pen = num(tb.magic_resist_penetrate_fixed);
          if (pen > 0) statBuff(battle, unit, 'trait:amgoat:resIgnore', { resIgnoreFlat: pen });
          const sp = num(tb.sp);
          if (sp > 0) {
            battle.on('damaged', (ctx) => {
              const d = ctx.dmg;
              if (ctx.source !== unit || !d || !d.isAttack || d.isSplash || tagged(d, IGNITE_TAG) || !isEliteEnemy(ctx.target)) return;
              giveSp(unit, sp, 'trait');
            }, { owner: unit });
          }
        }
        const sid = unit.skill?.id;
        if (sid === S2) {
          // 点燃: "先削减主攻击目标的法术抗性" — the main target's RES cut lands before the first damage of the attack
          onHitBy(battle, unit, (ctx) => {
            const d = ctx.dmg;
            if (d.isAttack && d.isSkill && !d.isSplash && !tagged(d, IGNITE_TAG)) resCut(battle, unit, ctx.target);
          }, 50);
        } else if (sid === S3) {
          // 火山: "随机对攻击范围内至多N个敌人发射熔岩" — a random draw among every enemy of the range
          battle.on('beforeAttack', (ctx) => {
            if (ctx.attacker !== unit || !unit.skill?.active || ctx.targets.length <= maxLava) return;
            ctx.targets = battle.rng.shuffle(ctx.targets.slice()).slice(0, maxLava);
          }, { owner: unit });
        }
      },
    };
  },
};
