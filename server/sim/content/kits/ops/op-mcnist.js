// server/sim/content/kits/ops/op-mcnist.js — 机械师 (char_4230_mcnist) 自选 operator kit: 6★ 哨戒铁卫 (重装), an owned-6★ pick
// of the tier-5 and tier-6 自选 slots — not the 补位 stand-in Mechanist (char_610_acfend, standin-acfend.js); every skill,
// both talents, the trait and her module SO-A 机械师特勤证章 at every form, and the kit of her summon 结构性原理
// (token_10069_mcnist_mcgraf). Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4230_mcnist): normal = E2 Lv1, skills at rank 4, no module; elite = E2 Lv60, rank 7,
// the module at stage 1 (tier 5) or 3 (tier 6) — the owner's decision of 2026-10-05. Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table / token_table (zh_CN, as built into backups.json); PRTS 机械师
// (生命方程 备注: the 【超额防护】 of her own 屏障 — "当此屏障吸收部分伤害…后，若此时“持有的所有同来源的屏障”的屏障值总和等于0
// 时，将本次伤害直接视为抵挡"; S1 备注 "弹道溅射半径1.1（碰撞判定），可对空"; S2 备注 "屏障“被摧毁时...”的效果，其溅射半径1.5（中点
// 判定），可对空；该效果存在极短的触发冷却…且冷却期间强制格挡受到的所有伤害", "屏障持续时间无限，但技能结束后屏障不再具备“被摧毁时...”
// 的效果"; S3 备注 "每次攻击变为向攻击目标所在地块中心投掷十字星弹道，弹道延迟0.8秒后落地，伤害范围x-6（碰撞判定），可对空",
// "结构性原理的“冲锋”效果为向其部署方向发射弹道，弹道终点位于其正前方尽可能远的可通行、可部署地面地块（无法越过存在敌人的地块以及
// 高台地块）", "弹道停止时，以该地块为中心对半径1.5的敌方单位产生伤害（碰撞判定）；那之后，场上的结构性原理立刻撤退并在停止地块上
// 重新部署（非移动），随后其获得半径1.5（中点判定）的【虚弱光环】…初始为50%，每秒减少2.5%，降至0%后虚弱光环结束", "技能开启时若场上
// 不存在结构性原理，则冲锋会保留至下次部署结构性原理后再触发"); PRTS 结构性原理 (备注 "持有禁疗", 天赋 备注 "此天赋提供的屏障视为
// 来源于自身的持有者"); the client's battle data (charpack char_4230_mcnist: Talents/1 charge_token[born] + die_to_kill_token,
// Talents/2 mcnist_t_2, the 精通 abilities tagged rogue_6; token prefab token_10069_mcnist_mcgraf: mcgraf_s_3_passive
// (abnormal flag 7 = 禁疗), charge_token[finish], Talents/2 mcnist_t_2, Talents/-1 the weaken aura; skill prefabs
// skchr_mcnist_2 (ammo counted by CharSkillManualTriggerCountEvent, not by attacks) / skchr_mcnist_3; projectiles
// projectile_chr_mcnist_s1 / _s3 / _s3_token_*; buff_template_data mcnist_t_2, mcnist_s_2_mode, mcnist_s_2_shield (BlockDamage
// PHYSICAL_AND_MAGICAL), mcnist_s_3_projectile*, mcgraf_s_3_trigger / _aura / _mark, mcgraf_t_suicide).
// - Trait (哨戒铁卫): the profession default — ranged physical, blocks 3, hits air units; ground enemies target her.
// - Module SO-A 机械师特勤证章: only its attributes (ATK / DEF, in the stats) act here. Its trait ("在【沉沦者的黑流树海】中，攻击
//   被自身或召唤物阻挡的敌人时攻击力提升至150%") and its stage-2 / 3 talent ("在【沉沦者的黑流树海】中，结构性原理的持续时间无限，
//   5秒内未受到伤害后每秒获得4%最大生命的屏障") name a 集成战略 theme (沉沦者的黑流树海 = rogue_6, PRTS 精通 "希望", "临时招募"):
//   N/A outside it (the brief's rule) — the token's merged module talents (skill@duration −1, the barrier regen) are ignored.
// - T1 结构性原理: her 结构性原理 is a hand piece the player places; it deploys with the board, lasts the token talent's
//   skill@duration (30 s; the base variant — the SO-A override is IS-only) from each deployment, blocks 3 and strikes one
//   ground enemy in melee for physical damage (its data), holds 禁疗 (PRTS; mcgraf_s_3_passive flag 7 — the data's
//   `abnormal` lacks it [ASSUMED: given here]). 拥有独立的再部署时间: back on its tile its respawnTime (40 s) after it left,
//   paying its cost (10 DP), only while she stands; her (re)deployment readies a waiting one at once (charge_token[born]);
//   it falls when she leaves (die_to_kill_token) [ASSUMED: the 卫戍 auto redeploy of a placed summon, as 鸿雪's 打字机].
// - T2 生命方程: she and her 结构性原理, at each deployment, get a 屏障 of hp_ratio × their own max HP (infinite until spent).
//   Every 屏障 that comes from her (this one, S2's, the token's — "视为来源于自身的持有者") absorbs physical and arts damage
//   only (BlockDamage PHYSICAL_AND_MAGICAL: buff `shieldType` ['phys', 'arts']) and has 超额防护: the hit that breaks it is
//   cancelled whole when no 屏障 of hers is left on that unit afterwards (the `hpDamage` hook — what passed the shields).
// - S1 聚类分析 (AUTO, attack SP, data DEFAULT — an AUTO "next attacks" skill waits for her attack): 3 bullets (`ammo`); attack
//   interval +base_attack_time (1.3 s); each attack lands where its target is and strikes 5 times (attack@times), every
//   attack@interval s, every enemy within attack@projectile_range (1.1, air units too) for attack@atk_scale × ATK physical —
//   the first strike on impact through the engine's splash, the next four from the impact point with the ATK of the first.
// - S2 协防术式 (MANUAL, data DEFAULT): ATK +atk; she and her 结构性原理 (one deployed later during the skill too) get a 屏障 of
//   hp_ratio × their max HP (a re-cast replaces it). When one breaks while the skill runs: every enemy within range_radius
//   (1.5, 中点判定, air units too) of its holder takes atk_scale × her ATK arts and 战栗 not_combat s (none on a dodged hit
//   [ASSUMED]); meanwhile the holder takes no damage; then, with a bullet left (trigger_time bullets — attacks spend none), one
//   is spent and the holder gets a new 屏障; the last bullet ends the skill and leaves that 屏障 (infinite, with no break effect).
// - S3 工程学十字星 (MANUAL, data DEFAULT, 40 s): ATK +atk, attack interval +base_attack_time (2.3 s); each attack throws a
//   cross at the centre of its target's tile: X6_DELAY s later every selectable enemy on the x-6 around it (attack@
//   projectile_range "x-6"; air units too) takes attack@atk_scale × her ATK of the throw, arts; the enemies her 结构性原理
//   blocks are her targets too (setExtraRange: their tiles while the skill runs). The cast (or, without a 结构性原理 on the
//   field, its next deployment during the skill — and every later one) makes it charge along its facing to the farthest
//   passable, deployable low tile before an enemy's tile or high ground: CHARGE_DELAY s + the distance at CHARGE_SPEED, then
//   every enemy within projectile_range (1.5) of the stop tile takes atk_scale × her ATK physical, and the 结构性原理 is
//   deployed anew there (free; a new deployment: full HP, 生命方程 again — not a 移动). While the skill runs, each deployment of
//   it carries a weaken aura of range_radius (1.5, 中点判定): 虚弱 atk (50 %) on the enemies inside, 2.5 % weaker every second
//   (atk_interval / interval), gone at 0 or when the skill ends.

import { num, skillRec, batMod, up } from '../shared/tier1.js';
import { COLS } from '../../../constants.js';
import { dirVec } from '../../../dir.js';
import { hypot } from '../../../detmath.js';
import { atPotential } from '../../../../../shared/potential.js';

const S1 = 'skchr_mcnist_1';
const S2 = 'skchr_mcnist_2';
const S3 = 'skchr_mcnist_3';
/** Her summon 结构性原理 (talent 结构性原理). */
export const MCGRAF = 'token_10069_mcnist_mcgraf';
/** Her 屏障 absorb physical and arts damage only (BlockDamage PHYSICAL_AND_MAGICAL). */
const BARRIER_TYPES = Object.freeze(['phys', 'arts']);
const T2_KEY = 'mcnist:t2:barrier';
const S2_KEY = 'mcnist:s2:barrier';
/** S3 cross (range_table x-6: the plus of reach 2 around the landing tile) and its landing delay (PRTS 备注). */
const X6 = Object.freeze([[2, 0], [1, 0], [0, -2], [0, -1], [0, 0], [0, 1], [0, 2], [-1, 0], [-2, 0]]);
const X6_DELAY = 0.8;
/** S3 charge (projectile_chr_mcnist_s3_token_*: `_delayToStart` 0.2, speed 20 tiles / s). */
const CHARGE_DELAY = 0.2;
const CHARGE_SPEED = 20;
/** Weaken aura refresh / buff life (s) and its fallback numbers (mcgraf hidden talent: atk −0.5, +0.025 per 1 s). */
const AURA = 0.2;
const AURA_DUR = 0.25;
/** 结构性原理's life when no source carries it (PRTS: 部署后持续30秒 at E2). */
const LIFE_FALLBACK = 30;
/** How often a waiting 结构性原理 tries to come back once ready. */
const RETRY = 0.1;
const TAG_CROSS = 'mcnist:cross';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const isGrafOf = (t, unit) => !!t && t.kind === 'token' && t.defId === MCGRAF && t.ownerUnit === unit;
const grafsOf = (battle, unit) => battle.allyUnits.filter((t) => isGrafOf(t, unit));
const skillOn = (unit, id) => !!(unit.skill && unit.skill.active && unit.skill.id === id);
/** First talent of a normalised token def holding `key` (token talents keep no index). */
const tokTalent = (def, key) => (def?.talents ?? []).find((t) => t && t.bb && t.bb[key] != null)?.bb ?? null;
/** Every 屏障 that comes from `mcn` on `holder` (hers, or her token's: "视为来源于自身的持有者"). */
const barrierLeft = (holder, mcn) => {
  let s = 0;
  for (const b of holder.buffs) if (b.data && b.data.mcnist === mcn && b.shield > 0) s += b.shield;
  return s;
};

/** A 屏障 from `mcn` on `holder`: `ratio` × the holder's max HP, physical and arts only, until spent. */
function grantBarrier(battle, mcn, holder, key, ratio) {
  if (!(ratio > 0) || !holder.alive) return null;
  battle.removeBuff(holder, key);
  const buff = battle.addBuff(holder, {
    key, shield: holder.s.maxHp * ratio, shieldType: BARRIER_TYPES, visible: true, source: mcn, tags: ['barrier'],
    data: { mcnist: mcn },
    // spent by a hit (attack/effects.js injuryEffects removes it at 0): S2's break effect waits for the hit to resolve (`damaged`)
    onRemove: ({ buff: b }) => { if (key === S2_KEY && !(b.shield > 1e-9)) holder.mem.mcnistBroken = true; },
  });
  battle.fx('shield', { x: holder.x, y: holder.y, id: holder.id });
  return buff;
}

/**
 * Where the charge stops: from the token's tile along its facing, the farthest tile before a tile it cannot cross (outside
 * the field, not ground-passable, high ground, an enemy on it); then, back towards the token, the first of those tiles it
 * can be deployed on (free, standable for a melee unit, low). Its own tile when it cannot move.
 */
function chargeEnd(battle, t) {
  const [fr, fc] = dirVec(t.dir);
  const path = [[t.tileR, t.tileC]];
  for (let k = 1; k < 32; k++) {
    const r = t.tileR + fr * k, c = t.tileC + fc * k;
    if (!battle.grid.inRect(r, c) || !battle.grid.groundPassable(r, c) || !battle.grid.isLow(r, c)) break;
    if (battle.enemies.some((e) => e.alive && !e.hidden && Math.round(e.y) === r && Math.round(e.x) === c)) break;
    path.push([r, c]);
  }
  const stop = path[path.length - 1];
  for (let i = path.length - 1; i > 0; i--) {
    const [r, c] = path[i];
    if (!battle.isReservedTile(r, c) && battle.grid.canStand(r, c, { ranged: false })) return { stop, land: [r, c] };
  }
  return { stop, land: path[0] };
}

/**
 * A 结构性原理 that left the field comes back on its tile its respawnTime later (her (re)deployment: at once —
 * charge_token[born] sets readyAt), paying its cost, only while she stands; retried until it deploys.
 */
function scheduleReturn(battle, owner, t) {
  t.mem.readyAt = battle.time + Math.max(0, num(t.base.respawnTime));
  if (t.mem.retry) return;
  t.mem.retry = battle.every(RETRY, (b, sched) => {
    const stop = () => { sched.cancel(); t.mem.retry = null; };
    if (t.alive || t.removed || b.finished) { stop(); return; }
    if (!up(owner) || b.time + 1e-9 < t.mem.readyAt) return;
    if (b.redeploy(t, { free: false })) stop();
  }, { owner: t });
}

/**
 * The 结构性原理's kit (lifetime, 禁疗, 生命方程, S2's 屏障, the S3 charge and weaken aura, its redeploy). `owner` = 机械师,
 * `life` = its lifetime, `t2` = 生命方程's hp_ratio, `b2` / `b3` = her S2 / S3 blackboards.
 */
function grafKit(owner, { life, t2, b2, b3, aura }) {
  return {
    skill: null,
    talents: [],
    install(battle, t) {
      battle.addBuff(t, { key: 'mcnist:graf:abnormal', flags: { noHeal: true }, persist: true, allowDead: true });   // 持有禁疗
      battle.on('deploy', (c) => {
        if (c.unit !== t) return;
        const respawned = !!t.mem.chargeLanding;
        t.mem.chargeLanding = false;
        const seq = t.deploySeq;
        if (life > 0) {
          battle.after(life, () => { if (t.alive && t.deploySeq === seq) battle.retreat(t, { reason: 'expired', permanent: true }); }, { owner: t });
        }
        grantBarrier(battle, owner, t, T2_KEY, t2);                                   // 生命方程
        if (skillOn(owner, S2)) grantBarrier(battle, owner, t, S2_KEY, num(b2.hp_ratio));   // a deployment during S2
        if (skillOn(owner, S3)) {
          t.mem.weakenFrom = battle.time;                                             // the weaken aura of this deployment
          // a deployment during S3 (not the charge's own landing) charges — the cast's charge kept until then — once
          // the deployment has resolved (the next tick: ON_OWNER_LOCATE)
          if (!respawned) battle.after(0, () => { if (t.alive && t.deploySeq === seq && skillOn(owner, S3)) chargeGraf(battle, owner, t, b3); }, { owner: t });
        } else t.mem.weakenFrom = null;
      }, { owner: t });
      // the weaken aura: 虚弱 on the enemies within its radius, 2.5 % weaker every second, gone at 0 or when S3 ends
      battle.every(AURA, () => {
        if (!up(t) || t.mem.weakenFrom == null || !skillOn(owner, S3)) return;
        const steps = Math.floor((battle.time - t.mem.weakenFrom) / aura.interval + 1e-9);
        const v = Math.max(0, aura.start - aura.step * steps);
        if (!(v > 0)) return;
        for (const e of battle.foesInRadius(t.x, t.y, aura.radius, true)) {
          battle.applyStatus(e, 'weaken', { duration: AURA_DUR, value: v, source: t });
        }
      }, { owner: t });
      battle.on('death', (c) => {
        if (c.unit !== t || battle.finished) return;
        t.removed = false;   // the piece stays: back on its tile once ready (or on the charge's landing tile)
        if (!t.mem.charging) scheduleReturn(battle, owner, t);
      }, { owner: t, priority: -10 });
    },
  };
}

/** S3: the 结构性原理 charges along its facing, strikes around the stop tile and is deployed anew there. */
function chargeGraf(battle, mcn, t, b3) {
  if (!up(t)) return;
  const { stop, land } = chargeEnd(battle, t);
  const dist = hypot(stop[0] - t.tileR, stop[1] - t.tileC);
  t.mem.charging = true;
  battle.fx('charge', { x: t.x, y: t.y, id: t.id, tx: stop[1], ty: stop[0] });
  battle.retreat(t, { reason: 'expired', permanent: true });
  t.mem.charging = false;
  const atk = mcn.s.atk, scale = num(b3.atk_scale, 3), radius = num(b3.projectile_range, 1.5);
  battle.after(CHARGE_DELAY + dist / CHARGE_SPEED, () => {
    battle.fx('aoe', { x: stop[1], y: stop[0], radius, id: mcn.id, skill: 'mcnist:charge' });
    for (const e of battle.foesInColliderRadius(stop[1], stop[0], radius)) {
      if (e.alive) battle.dealDamage(mcn, e, { amount: atk * scale, type: 'phys', isSkill: true, tags: ['skill', 'mcnist:charge'] });
    }
    if (t.alive || t.removed || battle.finished) return;
    // she fell meanwhile (die_to_kill_token): no landing, it waits for her like any piece [ASSUMED]
    if (!up(mcn)) { scheduleReturn(battle, mcn, t); return; }
    t.mem.chargeLanding = true;
    if (!battle.redeploy(t, { free: true, tile: land }) && !battle.redeploy(t, { free: true })) {
      t.mem.chargeLanding = false;
      scheduleReturn(battle, mcn, t);   // nowhere to land: an ordinary wait for its redeploy [ASSUMED]
    }
  }, { owner: mcn });
}

/** S3's cross: every selectable enemy on the x-6 around (r, c) takes `atk` × scale arts, X6_DELAY s after the throw. */
function throwCross(battle, unit, r, c, atk, scale) {
  battle.fx('aoe', { x: c, y: r, radius: 2, id: unit.id, skill: 'mcnist:cross', tiles: X6.map(([dr, dc]) => [r + dr, c + dc]) });
  battle.after(X6_DELAY, () => {
    const keys = X6.map(([dr, dc]) => (r + dr) * COLS + (c + dc)).filter((k) => k >= 0);
    for (const e of battle.enemiesInKeys(keys, unit, { canHitFly: true })) {
      if (e.alive) battle.dealDamage(unit, e, { amount: atk * scale, type: 'arts', isAttack: true, isSkill: true, tags: ['skill', TAG_CROSS] });
    }
  }, { owner: unit });
}

export default {
  char_4230_mcnist: (bb, chess) => {
    const t1 = (chess?.talents ?? []).find((t) => t && t.index === 1)?.bb ?? {};   // 生命方程: hp_ratio
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s1Scale = num(b1['attack@atk_scale'], 1), s1Times = Math.max(1, Math.floor(num(b1['attack@times'], 5)));
    const s1Iv = num(b1['attack@interval'], 0.2), s1Radius = num(b1['attack@projectile_range'], 1.1);
    return {
      skills: {
        [S1]: {
          kind: 'ammo', ammo: num(b1['attack@trigger_time'], 3),
          mods: { batPct: batMod(b1.base_attack_time, chess) },
          attack: {
            atkScale: s1Scale, splashRadius: s1Radius,
            // the four strikes after the impact's, from the impact point (the target dead meanwhile: where it was)
            onHit({ battle, unit, x, y }) {
              const atk = unit.s.atk;
              for (let i = 1; i < s1Times; i++) {
                battle.after(s1Iv * i, () => {
                  for (const e of battle.foesInColliderRadius(x, y, s1Radius)) {
                    if (e.alive) battle.dealDamage(unit, e, { amount: atk * s1Scale, type: 'phys', isAttack: true, isSplash: true, isSkill: true, tags: ['skill', 'mcnist:cluster'] });
                  }
                }, { owner: unit });
              }
            },
          },
        },
        [S2]: {
          kind: 'ammo', ammo: num(b2.trigger_time, 6),
          mods: { atkPct: num(b2.atk) },
          onAttack(ctx) { ctx.noAmmo = true; },   // her bullets go on 屏障 only (CharSkillManualTriggerCountEvent)
          onStart({ battle, unit }) {
            grantBarrier(battle, unit, unit, S2_KEY, num(b2.hp_ratio));
            for (const t of grafsOf(battle, unit)) if (up(t)) grantBarrier(battle, unit, t, S2_KEY, num(b2.hp_ratio));
          },
        },
        [S3]: {
          kind: 'duration',
          mods: { atkPct: num(b3.atk), batPct: batMod(b3.base_attack_time, chess) },
          // [ASSUMED] the cross lands on an enemy target only: 白铁's 铁钳号 alone does not open it (skills.js allyTargetsOk)
          allyTargets: false,
          // the attack is the cross: no damage on the target itself (its 0.8 s later landing does it)
          attack: { dmgType: 'arts', hitsFn: () => 0 },
          onAttack({ battle, unit, targets }) {
            const tg = (targets || []).find((e) => e && e.side === 'enemy');
            if (tg) throwCross(battle, unit, Math.round(tg.y), Math.round(tg.x), unit.s.atk, num(b3['attack@atk_scale'], 1));
          },
          onStart({ battle, unit }) {
            const t = grafsOf(battle, unit).find(up);
            if (t) chargeGraf(battle, unit, t, b3);   // without one: its next deployment during the skill charges
          },
          onEnd({ battle, unit }) { battle.setExtraRange(unit, null); },
        },
      },
      talents: [
        { install(battle, unit) { // 结构性原理: her pieces run the token's kit (set up before the battle starts)
          const raw = atPotential(battle.data.rawToken?.(MCGRAF)?.variants?.[unit.def?.tokenOwner] ?? null, unit.def?.loadout?.potential);
          for (const t of battle.allyUnits) {
            if (!isGrafOf(t, unit) || t.alive || t.deployed) continue;
            // its life: the base variant's (the SO-A stage-3 skill@duration −1 is 集成战略-only)
            const base = num(tokTalent(raw ? { talents: raw.talents } : null, 'skill@duration')?.['skill@duration'], NaN);
            const merged = num(tokTalent(t.def, 'skill@duration')?.['skill@duration'], NaN);
            const life = base > 0 ? base : merged > 0 ? merged : LIFE_FALLBACK;
            const w = tokTalent(t.def, 'atk_interval') ?? {};
            const aura = { start: Math.abs(num(w.atk, -0.5)), step: Math.abs(num(w.atk_interval, 0.025)), interval: num(w.interval, 1) || 1, radius: num(w.range_radius, 1.5) };
            const t2 = num(tokTalent(t.def, 'hp_ratio')?.hp_ratio, num(t1.hp_ratio));
            if (t.kit) battle.offOwner(t);
            battle._setupUnit(t, grafKit(unit, { life, t2, b2, b3, aura }));
          }
          // die_to_kill_token: it falls when she leaves; charge_token[born]: her (re)deployment readies a waiting one
          battle.on('death', (c) => {
            if (c.unit !== unit) return;
            for (const t of grafsOf(battle, unit)) if (t.alive) battle.kill(t, null);
          }, { owner: unit });
          battle.on('deploy', (c) => {
            if (c.unit !== unit) return;
            for (const t of grafsOf(battle, unit)) if (!t.alive && !t.removed) t.mem.readyAt = battle.time;
          }, { owner: unit });
        } },
        { install(battle, unit) { // 生命方程: her own 屏障 at each deployment (the token's: its kit)
          battle.on('deploy', (c) => { if (c.unit === unit) grantBarrier(battle, unit, unit, T2_KEY, num(t1.hp_ratio)); }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        const holds = (h) => h === unit || isGrafOf(h, unit);
        // 超额防护: the hit that breaks the last 屏障 of hers on a unit is cancelled whole (PRTS 生命方程 备注)
        const before = new WeakMap();
        battle.on('hit', (c) => {
          const h = c.target;
          if (!holds(h) || !c.dmg || c.dmg.cancel || (c.dmg.type !== 'phys' && c.dmg.type !== 'arts')) return;
          before.set(c.dmg, barrierLeft(h, unit));
        }, { owner: unit, priority: -1000 });
        // S2's break effect is running: the holder takes nothing meanwhile ("冷却期间强制格挡受到的所有伤害")
        battle.on('hit', (c) => { if (holds(c.target) && c.target.mem.mcnistLock && c.dmg) c.dmg.cancel = true; }, { owner: unit, priority: 1000 });
        battle.on('hpDamage', (c) => {
          if (!holds(c.target) || !(before.get(c.dmg) > 0)) return;
          if (barrierLeft(c.target, unit) <= 1e-9) c.amount = 0;
        }, { owner: unit });
        // S2: a 屏障 broken while the skill runs — the burst around its holder, then a bullet buys a new one
        battle.on('damaged', (c) => {
          const h = c.target;
          if (!holds(h) || !h.mem.mcnistBroken) return;
          h.mem.mcnistBroken = false;
          const sk = unit.skill;
          if (!skillOn(unit, S2) || !h.alive) return;
          h.mem.mcnistLock = true;
          try {
            const r = num(b2.range_radius, 1.5);
            battle.fx('aoe', { x: h.x, y: h.y, radius: r, id: unit.id, skill: 'mcnist:shieldBurst' });
            const dodged = new Set();
            const dh = battle.on('dodge', (d) => { if (d.source === unit && d.dmg?.tags?.includes('mcnist:shieldBurst')) dodged.add(d.target); });
            for (const e of battle.foesInRadius(h.x, h.y, r, true)) {
              if (!e.alive) continue;
              battle.dealDamage(unit, e, { amount: unit.s.atk * num(b2.atk_scale, 2), type: 'arts', isSkill: true, tags: ['skill', 'mcnist:shieldBurst'] });
              if (e.alive && !dodged.has(e)) battle.applyStatus(e, 'tremble', { duration: num(b2.not_combat, 2), source: unit });
            }
            battle.off(dh);
          } finally { h.mem.mcnistLock = false; }
          if (!sk || !sk.active || sk.id !== S2 || !(sk.ammoLeft > 0) || !h.alive) return;
          sk.ammoLeft--;
          battle.emit('ammoUsed', { unit, left: sk.ammoLeft, skill: sk });
          if (sk.ammoLeft <= 0) sk.end('ammo');
          grantBarrier(battle, unit, h, S2_KEY, num(b2.hp_ratio));   // the last bullet's 屏障 outlives the skill
        }, { owner: unit, priority: -50 });
        // S3: the enemies her 结构性原理 blocks are her targets too
        battle.on('tick', () => {
          if (!skillOn(unit, S3)) return;
          const keys = [];
          for (const t of grafsOf(battle, unit)) {
            if (!up(t)) continue;
            for (const e of t.blocking) if (e.alive) keys.push(Math.round(e.y) * COLS + Math.round(e.x));
          }
          const cur = unit.extraRangeKeys ?? [];
          if (keys.length !== cur.length || keys.some((k, i) => k !== cur[i])) battle.setExtraRange(unit, keys.length ? keys : null);
        }, { owner: unit });
      },
    };
  },
};
