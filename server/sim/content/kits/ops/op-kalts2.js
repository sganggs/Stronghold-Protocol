// server/sim/content/kits/ops/op-kalts2.js — 凯尔希·思衡托 (char_1052_kalts2) 自选 operator kit: 6★ 守望者 (医疗), an owned-6★
// pick of the tier-5 and tier-6 自选 slots; every skill, both talents and the trait at every form (she has no module),
// and the kit of her summon 战术锚点 (token_10068_kalts2_mtship). Kit contract and the 自选 rules: ../README.md ("How to add
// an operator (自选)").
//
// Forms (data/backups.json units.char_1052_kalts2): normal = E2 Lv1, skills at rank 4; elite = E2 Lv60, rank 7 (no module,
// so tiers 5 and 6 field the same elite) — the owner's decision of 2026-10-05. Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / token_table (zh_CN, as built into backups.json); PRTS 凯尔希·思衡托 (T1 备注
// "治疗效果无视禁疗…除非该目标为Mon3tr(凯尔希的召唤物)", "阻挡范围加成为提升自身的“阻挡半径倍率”属性"; T2 备注 "无视孤立",
// "“进入”的方式包括…部署时攻击范围碰撞到单位、单位部署在…攻击范围内…2技能攻击范围扩大时额外区域碰撞到的单位…3技能移动前发射的弹道
// 的碰撞", "来自此天赋的护盾最高1层"; S1 备注 "仅判断目标是否持有对地规避"; S2 备注 "伤害与治疗溅射半径均为1.5，可对空；伤害为真实普
// 通伤害", the enemy / ally target order and effect order; S3 备注: the operator choice, 【待投放】, the 3.5-speed 2.2-radius flight,
// its 无敌 / 强制缴械 / 不可阻挡, the paused skill time, the landing facing); PRTS 战术锚点 ("常态持有无敌"); PRTS 卫戍协议/帮助
// (§战斗部署 placed summons, §作战阶段 auto redeploy "满足再部署条件时…自动部署至该位置"); gamedata_const ba.liftoff (起飞
// "阻挡模式变为空中阻挡…阻挡半径变为0.8944"); PRTS 游戏数据基础 §阻挡半径 ("飞行阻挡半径 = 0.8944 × 阻挡半径倍率"); the client's battle
// data: charpack char_1052_kalts2 (attack triggers `_ignoreHealFree` + `_mon3terId` token_10002_kalts_mon3tr; talent "1":
// kalts2_t_1 [abnormal 35] + kalts2_t_1[buff] (MAX_HP / DEF MULTIPLIER, BLOCK_CNT ADDITION) + block_radius_scaler[inf]; talent
// "2" aura kalts2_t_2 (professionMask 639 = operators, ignoreTargetFree, `_removeBuffWhenTargetLeave`); mode s1 Aura
// block_radius_scaler[inf] on allies holding abnormal 35, `_selfOption` 2, `_interval` 0.3; mode s2 AttackEnemy (PURE,
// activeBuff sluggish, targetMotion 3) / HealAlly abilities, 10-count; mode s3 trigger `_maxNum` 2; StartTransporting
// (projectile_chr_kalts2_s3_2, activeBuff kalts2_t_2); S3OperatorSelector (`_maxNum` 2, `_checkPlayerSideSameWithOwner`);
// Invincible abnormal [5, 18, 3]); buff_template_data (kalts2_t_1, kalts2_t_2, kalts2_t_2[hp_recover] HP_RECOVERY_PER_SEC
// ×rhodes_bonus for group rhodes, kalts2_t_2[shield] BlockDamage once, INFINITY; kalts2_s_3 / [core] / [token_ctrl]
// RechargeToken cnt 1 then WithdrawTokens + cnt_minus 0; kalts2_s_3[on_token_born], kalts2_s3_trigger_transporting
// (every 0.1 s), kalts2_s_3[withdraw] (0.6 s, cost_scale 0, Withdraw); token_mtship_t_1 [abnormal 5] → on_token_born on its
// host); the projectile prefabs (projectile_chr_kalts2_s2_dmg / _heal speed 12 + the 1.5 sub-ranges; _s3_2 speed 3.5).
// - Trait (守望者) "恢复友方单位生命，并且可以起飞": the MEDIC profile (one heal per attack on the lowest-HP-ratio injured ally of
//   her y-6). Her heals and their selection pass 凯尔希's Mon3tr (token_10002_kalts_mon3tr) through its 禁疗 (`healThrough`);
//   other 禁疗 units stay out of the selection, and "治疗效果无视禁疗" changes nothing else here (no heal of hers reaches an
//   unselected 禁疗 unit). 起飞 itself is T1's.
// - T1 遗尘守望: max HP / DEF +max_hp / +def (0.3), block +block_cnt, 阻挡半径倍率 +block_radius_scale (mod
//   `blockRadiusScale`: her air-block radius 0.8944 × 1.23, Battle._checkBlock), and 起飞 from her deployment (flags
//   `liftoff` + `blockFly`: no ground enemy selects or is blocked by her, she blocks flyers — kalts2_t_1 ChangeCharBlockMode
//   FLY, from a ranged tile too). The 生命修复单元 is her model.
// - T2 医者丰碑: every other friendly OPERATOR (no summon: professionMask 639; 孤立 ones too) that enters her attack range —
//   her current one, S2's y-11 included — gets 1 护盾 layer (one damage instance blocked whole, no expiry, at most one from
//   this talent) and 生命回复速度 +hp_recovery_per_sec (×rhodes_bonus for a 罗德岛 operator, nationId rhodes) for buff_duration
//   s (an hpRegen buff: HP_RECOVERY_PER_SEC, never a heal — kits/README.md item 11; 不可叠加: the strongest, a new entry refreshes
//   it). An entry = not in her range on the tick before: her (re)deployment and her S3 landing (everyone in range), a unit
//   deployed / redeployed / moved into it, the range growing; S3's flight touches more (below).
// - S1 应急肃正防线 (MANUAL, data DEFAULT — a heal skill: cast as she is about to heal): ATK +atk, ASPD +attack_speed for its
//   35 s; every OTHER friendly operator of the field holding 起飞 (flag `liftoff`: 蒂比's skills, 司霆惊蛰) gets 阻挡半径倍率
//   +attack@block_radius_scale while it runs (refreshed every 0.3 s; 同名效果取最高 — nothing on a unit whose own 倍率 is at
//   least as high) [ASSUMED: the whole field — the aura has no range selector and the text says 所有].
// - S2 保护性拒止 (MANUAL, data ACTIVE_RANGE on its y-11 — the owner's rule for a heal skill: an injured ally inside the y-11;
//   10 发弹药): range y-11, ATK +atk. Each attack fires a 医疗单元: at an enemy she can select (air units too; the ones she
//   blocks first, then the usual order) — on impact every enemy within 1.5 of it takes attack@atk_scale × ATK true damage
//   (普通伤害: an attack hit, not 溅射) and attack@sluggish s 停顿, then every ally within 1.5 (summons too: the heal range
//   selector has no profession mask; no 孤立 one) is healed for attack@heal_scale × ATK; with no enemy to select, at the
//   lowest-HP-ratio injured ally of the y-11 — heal first, then the damage, no 停顿. The shot flies at the engine's orb speed
//   (10 tiles/s; the official 12) [ASSUMED] and fizzles when its enemy dies on the way [ASSUMED]. "可以随时停止技能": the
//   automatic battle never stops it.
// - S3 破梏重生 (MANUAL, data DEFAULT, 35 s): ATK +atk, base attack time base_attack_time (a flat −1.55 s on her 2.85 s), one
//   more heal target (2). "立刻获得战术锚点": one anchor in stock (content/tokens.js releaseSkillSummon — the placed piece
//   deploys on its tile if it is off the field and ready). With her anchor standing (one deployed while she stood:
//   kalts2_s_3[on_token_born] on her, lost when she leaves — `k2link`), 0.1 s after the cast (kalts2_s3_trigger_transporting),
//   or at once when an anchor deploys while S3 runs:
//   ① up to 2 other operators of her player inside her attack range — the latest deployed first (PRTS "部署时间点最晚的";
//     the battle-start board deploys in one tick here, so its order — `deploySeq` — stands for the official one-by-one
//     deployment times) — are withdrawn 0.6 s later into 【待投放】 (部署费用 ×0, 再部署时间 0, only inside her
//     pre-move range): the automatic battle redeploys them at once on their tiles, free — a fresh deployment (full HP, initial
//     SP) [ASSUMED: the 卫戍 auto redeploy of a 待投放 operator, PRTS 卫戍协议/帮助 "满足再部署条件时…自动部署至该位置"];
//   ② she leaves the field visually (hidden: 无敌, 缴械, 不可阻挡, no status) and flies from her tile to the anchor at 3.5
//     tiles/s, her skill time paused; every operator within 2.2 of the flying point gets T2's entry (once per flight), and
//     her range stays on her tile until she lands (the 待投放 operators redeployed there enter it);
//   ③ on arrival the anchor is withdrawn (her old instance's token_ctrl ends: WithdrawTokens, stock 0) and she 【移动】s
//     (Battle.moveRedeploy) onto its tile, facing the anchor's direction; the skill goes on with its remaining time. Should
//     the move be refused, she comes back on her own tile [ASSUMED; officially she is knocked out].
//   At the skill's end any anchor of hers on the field is withdrawn and the stock emptied (token_ctrl). The flight's begin
//   clip and its 生命回复速度 ×0 are not modelled [ASSUMED].
// - 战术锚点 (token_10068_kalts2_mtship, placed in prep on a ranged tile outside her attack range — "仅可以部署在凯尔希·思衡托
//   攻击范围外的远程位": the data's `ownerRangeOutside` / `rangedTilesOnly`, enforced by the match, 0.2.0 WE2): 无敌 and never targeted ("不会受到攻击"), no attack, blocks nothing; its range (hers) is only shown.
//   A placed piece is docked by content/tokens.js (a skill's summon: deployed for free at the battle start, then only when
//   her S3 gives one and its 70 s redeploy time has passed, on its own tile).

import { num, talentBb, skillRec, batMod, up } from '../shared/tier1.js';
import { releaseSkillSummon } from '../../tokens.js';
import { COLS } from '../../../constants.js';
import { hypot } from '../../../detmath.js';

const S1 = 'skchr_kalts2_1';
const S2 = 'skchr_kalts2_2';
const S3 = 'skchr_kalts2_3';
/** Her summon 战术锚点 (S3). */
export const ANCHOR = 'token_10068_kalts2_mtship';
/** 凯尔希's Mon3tr: her heals and their selection pass its 禁疗 (charpack `_mon3terId`). */
const KALTS_MON3TR = 'token_10002_kalts_mon3tr';
/** S2's damage / heal radius around the struck unit (PRTS S2 备注 "伤害与治疗溅射半径均为1.5"). */
const S2_RADIUS = 1.5;
/** S1's aura refresh (charpack mode s1 Aura `_interval`). */
const S1_AURA_IV = 0.3;
/** S3: the first transport check after the cast (kalts2_s3_trigger_transporting triggerInterval). */
const TRANSPORT_CHECK = 0.1;
/** S3: the flight speed (projectile_chr_kalts2_s3_2 `_speed`) and its collision radius (PRTS S3 备注). */
const TRANSPORT_SPEED = 3.5;
const TRANSPORT_RADIUS = 2.2;
/** S3: the operators chosen are withdrawn this long after the flight starts (kalts2_s_3[withdraw] firstTriggerInterval). */
const WITHDRAW_DELAY = 0.6;
/** S3: at most this many operators (S3OperatorSelector `_maxNum`). */
const WITHDRAW_MAX = 2;

const T1_KEY = 'talent:kalts2:t1';
const T2_SHIELD = 'talent:kalts2:shield';
const T2_REGEN = 'talent:kalts2:regen';
const S1_KEY = 'skill:kalts2:blockRadius';
const ANCHOR_KEY = 'kalts2:anchor';
const TAG_S2 = 'kalts2:s2';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const skillOn = (unit, id) => !!(unit.skill && unit.skill.active && unit.skill.id === id);
const isAnchorOf = (t, unit) => !!t && t.kind === 'token' && t.defId === ANCHOR && t.ownerUnit === unit;
const anchorsOf = (battle, unit) => battle.allyUnits.filter((t) => isAnchorOf(t, unit));
const isRhodes = (a) => (a?.def?.raw?.nationId ?? a?.def?.nationId) === 'rhodes';
/** A friendly operator other than `unit` standing on the field. */
const otherOp = (a, unit) => a !== unit && a.kind === 'op' && up(a) && !a.hidden;
/** The anchor stock content/tokens.js releaseSkillSummon keeps on its owner. */
function setStock(unit, n) {
  const s = unit.mem.summonStock || (unit.mem.summonStock = {});
  s[ANCHOR] = n;
}

/** The 战术锚点's kit: 无敌, never targeted, no attack, blocks nothing. */
function anchorKit() {
  return {
    skill: null,
    talents: [],
    trait: { noAttack: true },
    install(battle, t) {
      battle.addBuff(t, { key: ANCHOR_KEY, flags: { invulnerable: true, untargetable: true, noBlock: true }, persist: true, allowDead: true });
    },
  };
}

/** T2's entry for operator `a`: 1 护盾 layer unless one from this talent is there, the 生命回复速度 buff (strongest). */
function enterT2(battle, unit, a, t1) {
  if (!a.findBuff(T2_SHIELD)) battle.addBuff(a, { key: T2_SHIELD, shieldHits: 1, source: unit, tags: ['talent'] });
  const v = num(t1.hp_recovery_per_sec) * (isRhodes(a) ? num(t1.rhodes_bonus, 1) : 1);
  const d = num(t1.buff_duration);
  if (v > 0 && d > 0) battle.applyStrongest(a, T2_REGEN, { duration: d, value: v, mods: (x) => ({ hpRegen: x }), source: unit });
  battle.fx('shield', { x: a.x, y: a.y, id: a.id });
}

/**
 * S2's 医疗单元 landing on `target` (an enemy, or an injured ally when no enemy could be selected): true damage + 停顿 on
 * the enemies within 1.5, a heal on the allies within 1.5 — damage first on an enemy, heal first (and no 停顿) on an ally.
 */
function s2Burst(battle, unit, target, attackId, b2) {
  const x = target.x, y = target.y;
  const atk = unit.s.atk;
  const dmgAmt = atk * num(b2['attack@atk_scale'], 1);
  const healAmt = atk * num(b2['attack@heal_scale'], 1);
  const slug = num(b2['attack@sluggish']);
  const onEnemy = target.side === 'enemy';
  const hurt = () => {
    for (const e of battle.foesInRadius(x, y, S2_RADIUS, true)) {
      if (!e.alive) continue;
      battle.dealDamage(unit, e, { amount: dmgAmt, type: 'true', isAttack: true, isSkill: true, attackId, tags: [TAG_S2] });
      if (onEnemy && slug > 0 && e.alive) battle.applyStatus(e, 'sluggish', { duration: slug, source: unit });
    }
  };
  const mend = () => {
    for (const a of battle.alliesInRadius(x, y, S2_RADIUS)) if (battle.allySelectable(a, unit)) battle.heal(unit, a, healAmt, { ignoreHealFree: true });
  };
  battle.fx('aoe', { x, y, radius: S2_RADIUS, id: unit.id, skill: TAG_S2 });
  battle.fx('healAoe', { x, y, radius: S2_RADIUS, id: unit.id });
  if (onEnemy) { hurt(); mend(); } else { mend(); hurt(); }
}

/**
 * S2's HealAlly ability: with no enemy to select in her range (blocked ones included) she fires at the lowest-HP-ratio
 * injured ally instead (an attack in every respect: Battle.forceAttack, one bullet). Returns false so the engine's attack
 * loop makes no attack of its own then.
 */
function s2CanAttack(battle, unit) {
  const prof = { canHitFly: true };
  if (battle.enemiesInKeys(unit.rangeKeys, unit, prof).length || battle.blockedTargets(unit, prof).length) return true;
  const ally = battle.injuredAlliesInKeys(unit.rangeKeys, unit)[0];
  if (ally && battle.forceAttack(unit, [ally])) unit.atkCd = Math.max(unit.atkCd, unit.s.interval);
  return false;
}

/** The flight's point at the current time. */
function flightPoint(battle, f) {
  const k = f.T > 0 ? Math.min(1, Math.max(0, (battle.time - f.t0) / f.T)) : 1;
  return { x: f.from.x + (f.to.x - f.from.x) * k, y: f.from.y + (f.to.y - f.from.y) * k };
}

/** The flight's collisions: T2's entry for every operator within 2.2 of its point (once per flight). */
function collide(battle, unit, f) {
  const enter = unit.mem.kalts2Enter;
  if (!enter) return;
  const p = flightPoint(battle, f);
  const r2 = TRANSPORT_RADIUS * TRANSPORT_RADIUS + 1e-9;
  for (const a of battle.allyUnits) {
    if (!otherOp(a, unit) || f.hit.has(a)) continue;
    if ((a.x - p.x) * (a.x - p.x) + (a.y - p.y) * (a.y - p.y) > r2) continue;
    f.hit.add(a);
    enter(a);
  }
}

/** S3 ③: the arrival — the anchor withdrawn, the stock emptied, a 【移动】 onto its tile facing its direction. */
function land(battle, unit) {
  const f = unit.mem.k2flight;
  if (!f) return;
  unit.mem.k2flight = null;
  unit.hidden = false;
  if (!unit.alive || !unit.deployed) return;
  collide(battle, unit, f);
  unit.mem.k2landed = true;
  setStock(unit, 0);
  if (f.anchor.alive) battle.retreat(f.anchor, { reason: 'expired' });
  const dir0 = unit.dir;
  unit.dir = f.dir;
  if (!battle.moveRedeploy(unit, f.r, f.c)) {
    unit.dir = dir0;
    battle.refreshRange(unit);
  }
  battle.fx('teleport', { x: unit.x, y: unit.y, id: unit.id, fromX: f.from.x, fromY: f.from.y });
}

/** S3 ①②: the 待投放 operators and the flight to `anchor`. */
function startTransport(battle, unit, anchor) {
  const picks = battle.allyUnits
    .filter((a) => otherOp(a, unit) && a.ownerId === unit.ownerId && unit.rangeKeySet?.has(a.tileR * COLS + a.tileC))
    .sort((a, b) => b.deploySeq - a.deploySeq)
    .slice(0, WITHDRAW_MAX);
  for (const a of picks) {
    const seq = a.deploySeq;
    battle.after(WITHDRAW_DELAY, () => {
      // kalts2_s_3[withdraw]: CheckUnitAlive(her) + CheckCharSkillAffecting(her), then Withdraw — and back at once
      if (!up(a) || a.deploySeq !== seq || !unit.alive || !skillOn(unit, S3)) return;
      battle.retreat(a, { reason: 'retreat' });
      if (a.alive) return;
      if (!battle.redeploy(a, { free: true })) a.respawnAt = Math.min(a.respawnAt, battle.time);   // 再部署时间视为0
    }, { owner: unit });
  }
  const from = { x: unit.x, y: unit.y }, to = { x: anchor.x, y: anchor.y };
  const T = hypot(to.x - from.x, to.y - from.y) / TRANSPORT_SPEED;
  const f = { t0: battle.time, T, from, to, hit: new Set(), anchor, r: anchor.tileR, c: anchor.tileC, dir: anchor.dir };
  unit.mem.k2flight = f;
  battle.releaseBlocked(unit);
  unit.hidden = true;
  battle.fx('disappear', { x: unit.x, y: unit.y, id: unit.id });
  collide(battle, unit, f);
  battle.after(T, () => land(battle, unit), { owner: unit });
}

/** S3: start the transport when it can (S3 on, not done yet this cast, her linked anchor standing). */
function tryTransport(battle, unit) {
  const m = unit.mem;
  if (!skillOn(unit, S3) || m.k2flight || m.k2landed || !up(unit) || unit.hidden) return;
  const a = m.k2link;
  if (!a || !up(a) || !isAnchorOf(a, unit)) return;
  startTransport(battle, unit, a);
}

export default {
  char_1052_kalts2: (bb, chess) => {
    const t0 = talentBb(chess, 0);   // 遗尘守望: max_hp, def, block_cnt, block_radius_scale
    const t1 = talentBb(chess, 1);   // 医者丰碑: buff_duration, hp_recovery_per_sec, rhodes_bonus
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s2 = skillRec(chess, S2);
    const picked = chess?.skill?.skillId ?? null;
    return {
      trait: { healThrough: (healer, a) => !!a && a.kind === 'token' && a.defId === KALTS_MON3TR },
      skills: {
        [S1]: { kind: 'duration', mods: { atkPct: num(b1.atk), aspd: num(b1.attack_speed) } },
        [S2]: {
          kind: 'ammo',
          // The larger active range contains attack targets as well as patients (#406).
          trigger: { rule: 'ACTIVE_RANGE', grid: s2?.rangeGrid, enemies: true },
          ammo: Math.max(1, Math.floor(num(b2['attack@trigger_time'], 10))),
          mods: { atkPct: num(b2.atk) },
          targeting: s2?.rangeGrid ? { rangeGrid: s2.rangeGrid } : undefined,
          attack: {
            dmgType: 'true', canHitFly: true,
            hitsFn: () => 0,   // the damage is the 医疗单元's burst (s2Burst), not a hit on the target itself
            canAttack: (battle, unit) => s2CanAttack(battle, unit),
            onEachHit: (ctx) => { if (ctx.kind === 'main' && ctx.target) s2Burst(ctx.battle, ctx.unit, ctx.target, ctx.attackId, b2); },
          },
        },
        [S3]: {
          kind: 'duration',
          mods: { atkPct: num(b3.atk), batPct: batMod(b3.base_attack_time, chess) },
          targeting: { maxTargets: 2 },   // 额外治疗1个目标 (her s3 heal trigger `_maxNum` 2)
          onStart({ battle, unit }) {
            unit.mem.k2landed = false;
            releaseSkillSummon(battle, unit, ANCHOR);   // 立刻获得战术锚点 (a docked piece off the field deploys now when ready)
            battle.after(TRANSPORT_CHECK, () => tryTransport(battle, unit), { owner: unit });
          },
          onTick({ unit, skill, dt }) { if (unit.mem.k2flight) skill.timeLeft += dt; },   // 技能剩余时间暂停消耗 while flying
          onEnd({ battle, unit }) {
            // kalts2_s_3[token_ctrl] ON_BUFF_FINISH: WithdrawTokens, RechargeToken cnt_minus 0 (refresh)
            setStock(unit, 0);
            for (const t of anchorsOf(battle, unit)) if (t.alive) battle.retreat(t, { reason: 'expired' });
            if (unit.mem.k2flight) { unit.mem.k2flight = null; unit.hidden = false; }
          },
        },
      },
      talents: [
        { install(battle, unit) { // 遗尘守望
          const mods = {};
          for (const [k, v] of [['hpPct', num(t0.max_hp)], ['defPct', num(t0.def)], ['blockCnt', num(t0.block_cnt)], ['blockRadiusScale', num(t0.block_radius_scale)]]) if (v) mods[k] = v;
          battle.addBuff(unit, { key: T1_KEY, mods, flags: { liftoff: true, blockFly: true }, persist: true, allowDead: true, tags: ['talent'] });
          battle.on('deploy', (c) => { if (c.unit === unit && !c.move) battle.fx('takeoff', { x: unit.x, y: unit.y, id: unit.id }); }, { owner: unit });
        } },
        { install(battle, unit) { // 医者丰碑: the operators entering her attack range
          if (!(num(t1.buff_duration) > 0)) return;
          const enter = (a) => enterT2(battle, unit, a, t1);
          unit.mem.kalts2Enter = enter;   // S3's flight collisions
          let inside = new Set();
          battle.on('deploy', (c) => { if (c.unit === unit) inside = new Set(); }, { owner: unit });
          battle.on('tick', () => {
            // (also while S3's flight hides her: her range stays on her tile until the landing — the 待投放 operators
            // redeployed there enter it)
            if (!up(unit) || !unit.rangeKeySet) return;
            const now = new Set();
            for (const a of battle.allyUnits) {
              if (!otherOp(a, unit) || !unit.rangeKeySet.has(a.tileR * COLS + a.tileC)) continue;
              now.add(a);
              if (!inside.has(a)) enter(a);
            }
            inside = now;
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // her 战术锚点 pieces run the anchor kit (set up before content/tokens.js docks them: its install runs after the kits)
        for (const t of battle.allyUnits) {
          if (!isAnchorOf(t, unit) || t.alive || t.deployed) continue;
          if (t.kit) battle.offOwner(t);
          battle._setupUnit(t, anchorKit());
        }
        // kalts2_s_3[on_token_born]: an anchor deployed while she stands links to her until it or she leaves; while S3 runs
        // its deployment starts the transport at once
        battle.on('deploy', (c) => {
          if (!isAnchorOf(c.unit, unit)) return;
          if (up(unit)) unit.mem.k2link = c.unit;
          tryTransport(battle, unit);
        }, { owner: unit });
        battle.on('death', (c) => { if (c.unit === unit || c.unit === unit.mem.k2link) unit.mem.k2link = null; }, { owner: unit });
        // S3's flight: its collisions every tick
        battle.on('tick', () => { const f = unit.mem.k2flight; if (f && unit.alive) collide(battle, unit, f); }, { owner: unit });
        // S1: every other 起飞 operator's 阻挡半径倍率 +attack@block_radius_scale while it runs (同名效果取最高)
        const v1 = num(b1['attack@block_radius_scale']);
        if (picked === S1 && v1 > 0) {
          battle.every(S1_AURA_IV, () => {
            if (!up(unit) || !skillOn(unit, S1)) return;
            for (const a of battle.allyUnits) {
              if (!otherOp(a, unit) || !a.s.flags.liftoff) continue;
              const cur = a.findBuff(S1_KEY);
              const own = (a.s.blockRadiusScale || 0) - (cur ? num(cur.mods?.blockRadiusScale) : 0);
              if (own >= v1 - 1e-9 || (cur && cur.source !== unit && num(cur.data?.v) > v1 && cur.timeLeft > 0.05)) continue;
              battle.addBuff(a, { key: S1_KEY, duration: S1_AURA_IV + 0.1, mods: { blockRadiusScale: v1 }, source: unit, data: { v: v1 }, tags: ['skill'] });
            }
          }, { owner: unit, immediate: true });
        }
      },
    };
  },
};
