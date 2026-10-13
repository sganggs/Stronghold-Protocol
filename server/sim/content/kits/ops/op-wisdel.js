// server/sim/content/kits/ops/op-wisdel.js — 维什戴尔 (char_1035_wisdel) 自选 operator kit: 6★ 投掷手 (狙击), an owned-6★ pick
// of the tier-5 and tier-6 自选 slots; every skill, both talents, the trait, her module BOM-X “‘祖宗发射器’” at every form, and
// the kit of her summon “魂灵之影” (token_10035_wisdel_wward). Kit contract and the 自选 rules: ../README.md ("How to add an
// operator (自选)").
//
// Forms (data/backups.json units.char_1035_wisdel, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the module at stage 1 (tier 5) or 3 (tier 6) — the owner's decision of 2026-10-05. Full potential
// (the owner's decision of 2026-10-07). Sources: character_table / skill_table / battle_equip_table and the token record (zh_CN, as
// built into backups.json); PRTS 维什戴尔, 魂灵之影 and 溅射半径一览 (the 备注 quoted below); the client's skill prefabs
// ([uc]skills skchr_wisdel_1 / 2 / 3, sktok_wisdel_wward) and buff templates (wisdel_t_1[bomb] / [projectile_shock],
// wisdel_token_t_1[bomb], token_wisdel_passive[to_host], token_wisdel_host[Camouflage], token_wisdel_skill_end,
// wisdel_s_2[switch] / [overload_start], wisdel_s_3[trigger_spawn], wisdel_s_3_token[add_sp]).
// - Trait (投掷手) "攻击对小范围的地面敌人造成两次物理伤害（第二次为余震，伤害降低至攻击力的一半）": the bombarder profile — a
//   ground-only splash of SPLASH (PRTS 溅射半径一览 投掷手 0.9) at full damage, then 余震 (aftershocks) on the same spot
//   SHOCK_GAP s apart (the engine's spacing [ASSUMED there]) at attack@append_atk_scale × the attack's ATK — her 3-9,
//   blocks 1, never targets air units (data canHitFly false), ground enemies target her. The kit replaces the profile's
//   aftershock (`afterHit`) to carry 好礼 and the skills' changes. Module BOM-X “‘祖宗发射器’” "三次物理伤害（后两次为余震…）"
//   (trait bb attack@enable_third_attack 1): two aftershocks; ATK / 攻击速度 in the stats; stage 3 changes 好礼 (below).
// - T1 好礼 "攻击时对主目标的攻击力提升至115%并为其附着残影，残影受到维什戴尔的余震影响时有15%概率爆炸，对周围所有敌人造成
//   150%攻击力的物理伤害并使其晕眩1秒" (full potential: 160 %; BOM-X stage 3: 125 % / 185 %). PRTS 备注 "攻击倍率提升效果仅对普通攻击（含余震）生效",
//   "残影持续时间无限，不可叠加，维什戴尔退场后消失；每次余震独立判定残影爆炸，爆炸半径1.1（中点判定），爆炸效果可对空": every
//   main target of her attacks (each of S2's targets, each overload round) takes ×main_atk_scale on that hit and on her
//   aftershocks, and carries her 残影 (one per enemy, removed when she leaves the field — a knock-out too); each
//   aftershock hit on a marked enemy that survives it rolls `prob` (wisdel_t_1[projectile_shock]: Dice, then the AOE) —
//   on success the mark is spent and every targetable enemy within attack@range_radius of it, air units too, takes
//   bomb_atk_scale × ATK physical and is stunned attack@stun s.
// - T2 死魂灵的余息 "部署后立刻在攻击范围内召唤一个魂灵之影，在魂灵之影周围时获得迷彩": each deployment summons one 魂灵之影 on a
//   free deployable tile of her range — PRTS 备注 "部署时优先在距离自身最近的>地图下方行>地图左侧列可部署位部署" (nearest to
//   her, then the lower row, then the left column; at once — the deploy animation is not modelled [ASSUMED]) — while fewer
//   than SHADOW_CAP stand ("最多存在3个"; beyond it nothing is summoned — S3_Spawn `_checkTokenMaxDeployCnt`, the talent's
//   summon read alike [ASSUMED]). A shadow coming in gives her 迷彩 while it
//   stays when she stands on its x-5 (token_wisdel_passive[to_host] + token_wisdel_host[Camouflage]: only the host keeps
//   it; PRTS "仅在登场时尝试给予维什戴尔迷彩…可受孤立干扰", "本天赋的迷彩不会因维什戴尔阻挡敌人而解除" — the engine's 迷彩
//   never lifts by blocking). Shadows stay when she leaves [ASSUMED: no source withdraws them; their skill needs her range].
//   魂灵之影 (shadowKit): its stats are the form's (token variant), 禁疗, no normal attack, no range of its own (PRTS 备注 "持有
//   禁疗 / 无视野范围 / 不进行普通攻击"); its skill (AUTO, 5 SP over time) "对一名在维什戴尔攻击范围内的敌人造成法术伤害，对其造成
//   1秒停顿并附着残影，之后获得0-2点技力" — PRTS "技能仅攻击维什戴尔攻击范围内的敌人，优先攻击未携带残影的敌人，不可对空" (prefab
//   SkillTrigger: `_fetchHost`, `_targetMotion` 1, `_withoutThisBuff` wisdel_t_1[bomb]): cast by this kit once ready with a
//   targetable ground enemy in her current range (the data's DEFAULT read on her range, which the engine's rule cannot see),
//   unmarked ones first, then the usual order: its ATK × 1 arts (`_atkScale` 1, `_damageType` magical), 停顿 `sluggish` s,
//   her 残影 (while she is on the field — wisdel_token_t_1[bomb] hangs it on her talent), then
//   sp_min … sp_max − 1 SP (token_wisdel_skill_end: RandomSetter, forced). It can be attacked (实体类型 默认).
// - S1 定点清算 (AUTO, attack SP, data DEFAULT — the next attack): that attack splashes S1_SPLASH (PRTS 备注 "溅射半径1.1";
//   its aftershocks too [ASSUMED]), makes 2 more aftershocks, each at append_atk_scale × ATK, and stuns every enemy it hits
//   (main, splash, aftershocks) stun_duration s.
// - S2 饱和复仇 (MANUAL, 25 s, data DEFAULT): ATK +atk, attack interval +base_attack_time s (−0.5 / −0.7 on 2.1 s), 3 targets
//   at once. 过载 (ba.overdrive "技能持续拥有两段计量槽，技能进行到一半时触发额外效果": the second half, as 号角 S3 —
//   OVERLOAD_AT): every attack becomes OVERLOAD_SHOTS rounds of attack@atk_scale_ol × ATK, each on a random enemy of her
//   range (PRTS "过载模式下不再同时攻击3个目标，4次攻击分别随机索敌"; one draw per round, repeats allowed), the rounds of one
//   attack at once [ASSUMED], their aftershocks at append_atk_scale × that ATK (PRTS S3 备注 "攻击倍率提升效果仅对普通攻击
//   与余震生效" read for the overload rounds too [ASSUMED]). Manual close: N/A in the auto battle.
// - S3 爆裂黎明 (MANUAL, 6 发弹药 — attack@trigger_time, data SP_FULL from the official ALWAYS row): at once max_cnt shadows
//   (the first one with `sp` SP: wisdel_s_3_token[add_sp] — PRTS "初始技力分别为3sp（优先召唤）与0sp"), then ATK +atk, attack
//   interval +base_attack_time s, each attack attack@atk_scale_3 × ATK with a splash of S3_SPLASH (PRTS 备注 "攻击溅射半径
//   2.5"), 好礼 at attack@prob (100 %). PRTS "施加锁定、普通攻击、溅射均可对空": she targets and splashes air units meanwhile;
//   the aftershocks stay on ground enemies [ASSUMED: PRTS names only the lock, the attack and its splash] on the 2.5 spot
//   [ASSUMED], at append_atk_scale × the boosted ATK (the same 备注). Its <爆裂锁定> picks the target her own selection
//   picks [ASSUMED: one 维什戴尔, no shared lock].

import { num, talentBb, traitBb, skillRec, up, batMod } from '../shared/tier1.js';
import { absoluteRangeKeys, sortEnemyTargets } from '../../../targeting.js';
import { hasHp } from '../../../damage.js';
import { COLS } from '../../../constants.js';
import { hypot } from '../../../detmath.js';

const S1 = 'skchr_wisdel_1';
const S2 = 'skchr_wisdel_2';
const S3 = 'skchr_wisdel_3';
/** Her summon “魂灵之影” (T2 死魂灵的余息, S3 爆裂黎明). */
export const SHADOW = 'token_10035_wisdel_wward';
/** PRTS 溅射半径一览: 投掷手 0.9 (the bombarder profile's). */
const SPLASH = 0.9;
/** PRTS S1 备注 "溅射半径1.1" / S3 备注 "攻击溅射半径2.5". */
const S1_SPLASH = 1.1;
const S3_SPLASH = 2.5;
/** Seconds between two aftershocks (professions.js bombarder's spacing) [ASSUMED there]. */
const SHOCK_GAP = 0.3;
/** "最多存在3个魂灵之影" (the token's maxDeployCount 3). */
const SHADOW_CAP = 3;
/** 过载 from the second half of the skill (ba.overdrive). */
const OVERLOAD_AT = 0.5;
/** "4连发". */
const OVERLOAD_SHOTS = 4;
/** The shadow's x-5 (PRTS 魂灵之影 备注 "登场时给予自身及周围4格的其他我方单位迷彩"). */
const X5 = Object.freeze([[1, 0], [0, -1], [0, 0], [0, 1], [-1, 0]]);
const GROUND = Object.freeze({ canHitFly: false });

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** Buff key of 维什戴尔 `host`'s 残影 on an enemy (one per enemy: "不可叠加"). */
const markKey = (host) => `wisdel:mark:${host.id}`;
/** Buff key of the 迷彩 a shadow gave its host. */
const camoKey = (t) => `wisdel:camou:${t.id}`;
const isShadowOf = (t, host) => !!t && t.kind === 'token' && t.defId === SHADOW && t.ownerUnit === host;
const shadowsOf = (battle, host) => battle.allyUnits.filter((t) => t.alive && isShadowOf(t, host));

/** Hang `host`'s 残影 on enemy `e` (while she is on the field). */
function markOf(battle, host, e) {
  if (!e || !e.alive || e.side !== 'enemy' || !up(host)) return;
  const key = markKey(host);
  if (!e.findBuff(key)) battle.addBuff(e, { key, source: host, tags: ['wisdel:mark'] });
}

/** 好礼's explosion on marked enemy `e` (the mark is spent). */
function detonate(battle, unit, e, bomb) {
  battle.removeBuff(e, markKey(unit));
  const x = e.x, y = e.y;
  battle.fx('aoe', { x, y, radius: bomb.radius, id: unit.id, skill: 'wisdel:bomb' });
  for (const v of battle.foesInRadius(x, y, bomb.radius, true)) { // 爆炸效果可对空
    battle.dealDamage(unit, v, { amount: unit.s.atk * bomb.scale * unit.s.atkScaleMul, type: 'phys', isSplash: true, tags: ['wisdel:bomb'] });
    if (bomb.stun > 0 && hasHp(v)) battle.applyStatus(v, 'stun', { duration: bomb.stun, source: unit });
  }
}

/**
 * The aftershocks of one hit (the profile's `afterHit`): `count` shocks SHOCK_GAP s apart on the hit's spot, each
 * hitting every targetable ground enemy within `radius` for `atkScale` × `shockScale` × ATK (×`mainScale` on the main
 * target), stunning them `stun` s, and rolling 好礼 on each marked survivor (`prob`).
 */
function shocks({ count, atkScale, shockScale, radius, prob, stun, mainScale, bomb }) {
  return (battle, unit, target, hctx) => {
    for (let i = 1; i <= count; i++) {
      battle.after(SHOCK_GAP * i, () => {
        for (const e of battle.foesInRadius(hctx.x, hctx.y, radius, true)) {
          if (e.isFlying) continue; // 余震: 地面敌人
          const boost = e === target ? mainScale : 1;
          battle.dealDamage(unit, e, { amount: unit.s.atk * atkScale * shockScale * boost * unit.s.atkScaleMul, type: 'phys', isSplash: true, isSkill: !!hctx.isSkill, tags: ['aftershock', 'wisdel:shock'] });
          if (!hasHp(e)) continue;
          if (stun > 0) battle.applyStatus(e, 'stun', { duration: stun, source: unit });
          if (prob > 0 && e.findBuff(markKey(unit)) && (prob >= 1 || battle.rng.chance(prob))) detonate(battle, unit, e, bomb);
        }
      });
    }
  };
}

/** The free deployable tile of her range a shadow takes (PRTS: nearest to her > lower row > left column), or null.
 *  Deployable = on a board of this field (Battle.onFieldBoard): a teammate's half counts, a boss field's hand /
 *  临时整备区 rows and an empty half do not (#557, PR #558). */
function shadowTile(battle, host) {
  let best = null, bd = Infinity;
  for (const k of host.rangeKeys ?? []) {
    const r = Math.floor(k / COLS), c = k % COLS;
    if (!battle.grid.inRect(r, c) || !battle.onFieldBoard(r, c) || !battle.grid.canStand(r, c, { ranged: true }) || battle.isReservedTile(r, c)) continue;
    const d = hypot(r - host.tileR, c - host.tileC);
    if (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && (r < best[0] || (r === best[0] && c < best[1])))) { bd = d; best = [r, c]; }
  }
  return best;
}

/** The enemy a shadow strikes: a targetable ground enemy of `host`'s range, unmarked first, then the usual order. */
function shadowTarget(battle, host, t) {
  const pool = battle.enemiesInKeys(host.rangeKeys, t, GROUND);
  if (!pool.length) return null;
  const key = markKey(host);
  const fresh = pool.filter((e) => !e.findBuff(key));
  const list = fresh.length ? fresh : pool;
  sortEnemyTargets(battle, t, list, null);
  return list[0];
}

/** 魂灵之影's kit (header); `host` = 维什戴尔. */
function shadowKit(host) {
  return {
    skill: {
      kind: 'instant',
      trigger: 'NEVER', // cast by the install below on her range
      onStart({ battle, unit, bb }) {
        const e = unit.mem.wisdelTarget;
        unit.mem.wisdelTarget = null;
        if (e && e.alive) {
          battle.fx('strike', { x: e.x, y: e.y, id: unit.id, target: e.id });
          battle.dealDamage(unit, e, { amount: unit.s.atk * unit.s.atkScaleMul, type: 'arts', isSkill: true, tags: ['skill', 'wisdel:shadow'] });
          if (hasHp(e)) {
            const slug = num(bb.sluggish);
            if (slug > 0) battle.applyStatus(e, 'sluggish', { duration: slug, source: unit });
            markOf(battle, host, e);
          }
        }
        // token_wisdel_skill_end: 之后获得0-2点技力 (an integer of [sp_min, sp_max), forced)
        const lo = Math.floor(num(bb.sp_min)), hi = Math.floor(num(bb.sp_max, lo + 1));
        const add = lo + battle.rng.int(Math.max(1, hi - lo));
        if (add > 0) unit.skill.gainSp(add, 'init');
      },
    },
    trait: { noAttack: true },
    install(battle, t) {
      battle.addBuff(t, { key: 'trait:abnormal', flags: { noHeal: true }, persist: true, allowDead: true }); // 持有禁疗
      battle.on('tick', () => {
        const sk = t.skill;
        if (!t.alive || !t.deployed || !sk || !sk.ready || sk.active || !t.canAct || t.s.flags.silence || !up(host)) return;
        const e = shadowTarget(battle, host, t);
        if (!e) return;
        t.mem.wisdelTarget = e;
        sk.activate('DEFAULT');
      }, { owner: t });
      battle.on('death', (ctx) => {
        if (ctx.unit === t && host.findBuff(camoKey(t))) battle.removeBuff(host, camoKey(t));
      }, { owner: t });
    },
  };
}

/** A shadow coming in: 迷彩 for its host while it stays, when she stands on its x-5 and may be selected by it. */
function grantCamo(battle, host, t) {
  if (!up(host) || !battle.allySelectable(host, t)) return;
  if (!absoluteRangeKeys(X5, t.tileR, t.tileC, t.dir, 0).includes(host.tileR * COLS + host.tileC)) return;
  battle.addBuff(host, { key: camoKey(t), flags: { camou: true }, source: t, tags: ['talent'], visible: true });
  battle.fx('camouflage', { x: host.x, y: host.y, id: host.id });
}

/** Summon up to `n` shadows for `host` (never beyond SHADOW_CAP); the first one starts with `firstSp` SP. */
function summonShadows(battle, host, n, firstSp = 0) {
  for (let i = 0; i < n; i++) {
    if (shadowsOf(battle, host).length >= SHADOW_CAP) return;
    const tile = shadowTile(battle, host);
    if (!tile) return;
    const t = battle.spawnToken(host, SHADOW, tile[0], tile[1], { kit: shadowKit(host) });
    if (!t) return;
    if (i === 0 && firstSp > 0 && t.skill) t.skill.gainSp(firstSp, 'init');
    battle.fx('summon', { x: t.x, y: t.y, id: host.id, token: SHADOW });
    grantCamo(battle, host, t);
  }
}

export default {
  char_1035_wisdel: (bb, chess) => {
    const tb = traitBb(chess);
    const shockScale = num(tb['attack@append_atk_scale'], 0.5);
    const count = num(tb['attack@enable_third_attack']) > 0 ? 2 : Math.max(1, Math.floor(num(tb['attack@times'], 2)) - 1);
    const t0 = talentBb(chess, 0);
    const mainScale = num(t0['attack@main_atk_scale'], 1);
    const bomb = { scale: num(t0['attack@bomb_atk_scale']), stun: num(t0['attack@stun']), radius: num(t0['attack@range_radius'], 1.1) };
    const base = { count, atkScale: 1, shockScale, radius: SPLASH, prob: num(t0['attack@prob']), stun: 0, mainScale, bomb };
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s1 = skillRec(chess, S1);
    const s3Scale = num(b3['attack@atk_scale_3'], 1);
    return {
      trait: {
        splashRadius: SPLASH,
        ...(mainScale !== 1 ? { dmgMul: () => mainScale } : null), // 好礼: 主目标 ×main_atk_scale (ai.js: the main target only)
        onEachHit(battle, unit, victim, hc) { if (hc.kind === 'main') markOf(battle, unit, victim); }, // 附着残影
        afterHit: shocks(base),
      },
      skills: {
        [S1]: {
          kind: num(s1?.maxChargeTime, 1) > 1 ? 'charges' : 'instant',
          attack: {
            splashRadius: S1_SPLASH,
            onEachHit({ battle, unit, target }) {
              const d = num(b1.stun_duration);
              if (d > 0 && target && target.side === 'enemy' && hasHp(target)) battle.applyStatus(target, 'stun', { duration: d, source: unit });
            },
            afterHit: shocks({ ...base, count: count + 2, shockScale: num(b1.append_atk_scale, shockScale), radius: S1_SPLASH, stun: num(b1.stun_duration) }),
          },
        },
        [S2]: {
          kind: 'duration',
          mods: { atkPct: num(b2.atk), batPct: batMod(b2.base_attack_time, chess) },
          targeting: { maxTargets: 3 },
          onStart({ unit }) { unit.mem.wisdelOverload = false; },
          onTick({ battle, unit, skill }) {
            if (unit.mem.wisdelOverload || skill.timeLeft > skill.duration * (1 - OVERLOAD_AT) + 1e-9) return;
            unit.mem.wisdelOverload = true;
            battle.fx('overload', { x: unit.x, y: unit.y, id: unit.id });
          },
          onEnd({ unit }) { unit.mem.wisdelOverload = false; },
        },
        [S3]: {
          kind: 'ammo',
          ammo: Math.max(1, Math.floor(num(b3['attack@trigger_time'], 6))),
          mods: { atkPct: num(b3.atk), batPct: batMod(b3.base_attack_time, chess) },
          targeting: { canHitFly: true },
          attack: {
            atkScale: s3Scale,
            splashRadius: S3_SPLASH,
            groundOnly: false,
            afterHit: shocks({ ...base, atkScale: s3Scale, radius: S3_SPLASH, prob: num(b3['attack@prob'], 1) }),
          },
          onStart({ battle, unit }) { summonShadows(battle, unit, Math.max(0, Math.floor(num(b3.max_cnt, 1))), num(b3.sp)); },
        },
      },
      talents: [
        { install(battle, unit) { // 好礼: her 残影 leave with her
          battle.on('death', (ctx) => {
            if (ctx.unit !== unit) return;
            const key = markKey(unit);
            for (const e of battle.enemies) if (e.findBuff(key)) battle.removeBuff(e, key);
          }, { owner: unit });
        } },
        { install(battle, unit) { // 死魂灵的余息: a shadow at each deployment
          battle.on('deploy', (ctx) => { if (ctx.unit === unit) summonShadows(battle, unit, 1); }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // 过载: every attack becomes 4 rounds at attack@atk_scale_ol, each on a random enemy of her range
        if (unit.skill?.id !== S2) return;
        const ol = num(b2['attack@atk_scale_ol'], 1);
        const olShock = shocks({ ...base, atkScale: ol });
        battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit || !unit.mem.wisdelOverload || !unit.skill?.active || !ctx.profile) return;
          const pool = battle.enemiesInKeys(unit.rangeKeys, unit, ctx.profile);
          for (const e of battle.blockedTargets(unit, ctx.profile)) if (!pool.includes(e)) pool.push(e);
          if (!pool.length) return;
          const picks = [];
          for (let i = 0; i < OVERLOAD_SHOTS; i++) picks.push(battle.rng.pick(pool));
          ctx.targets = picks;
          // (a per-attack copy while the skill runs: its targeting override makes effectiveProfile copy the profile)
          ctx.profile.atkScale = ol;
          ctx.profile.afterHit = olShock;
        }, { owner: unit, priority: -100 });
      },
    };
  },
};
