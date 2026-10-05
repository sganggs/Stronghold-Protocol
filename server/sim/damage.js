// server/sim/damage.js — damage & heal pipeline, shields, dodge, element gauges (DESIGN §5.5).
//
// dealDamage order: (element → gauge path) | invulnerable? / 对地规避 (a ground enemy's damage to an airborne 起飞 ally —
//   targeting.js evadesGround; not `ignoreSelect` damage: no selection, e.g. a debuff's tick) → 'hit' hook (mutable DamageInfo, may set cancel)
//   → dodge (phys/arts, canDodge) → mitigation (phys: DEF, arts: RES, true: none)
//   → × source dmgDealtMul (× phys/artsDealtMul) × target dmgTakenMul (not for 元素伤害) × type-taken mul × dmg.mul
//   → 限伤 (leaders in boss / hidden battles: a hit of ceil(final) ≥ BOSS_HIT_LIMIT is cancelled, see leaderHitCancelled)
//   → shields (hit-negating barriers first, then HP shields) → HP loss (boss pool routing) → 'damaged' hook
//   → SP-on-hurt / TAKE_DAMAGE trigger → fatal/kill.
// Damage-dealt stats (the source's `stats.dmg`, the player's `damageDealt`) count only HP removed from the other side:
// self and friendly damage (a 源石溶剂 drain, an operator's own 流失) is the target's `taken` and keeps the kill credit.
// Phys: max(A − max(0, D×(1−defIgnorePct) − defIgnoreFlat), 5 %·A); Arts: max(A×(1 − R′/100), 5 %·A) with
// R′ = max(0, R×(1−resIgnorePct) − resIgnoreFlat); True: A; Elemental (元素伤害): max(A×(1 − 元素抗性/100), 5 %·A)
// (PRTS 游戏数据基础 DMG_e; 元素抗性 = the target's data `epDamageResistance`: 0 on every enemy in data/enemies.json).
// Element damage ('element' type + element, 元素损伤) fills a gauge instead of HP (1000; enemy leaders 2000):
//   gain = amount × dmg.mul × target elemTakenMul (元素损伤倍率: "受到的元素损伤提高/降低…") × max(5 %, 1 − 损伤抵抗/100)
// with 损伤抵抗 = the target's data `epResistance` (EP_RESISTANCE, a percentage: PRTS 元素 "受到的元素损伤 = 损伤值 ×
// (1 − 损伤抵抗 × 0.01)，后续可应用元素损伤倍率"; the 5 % floor of DMG_e — PRTS 游戏数据基础 "目标受到元素损伤时也可以使用
// 该公式计算，只需要将 D 值改为目标的损伤抵抗即可"; in data/enemies.json only 转译基底·α has 10, every other enemy — 海嗣
// included — 0; newer event enemies of the full enemy_database go up to 15, operators are all 0). No
// source-side multiplier touches it (a kit scales its own amount), no gauge ever decays (EP_RECOVERY_PER_SEC 0), and
// 元素脆弱 (`elementalTakenMul`, "受到的元素伤害提升") never scales it — only 元素伤害.
// A full gauge bursts with the official term-table effects (constants.js ELEMENT), which differ by the side hit:
//   operators (enemy damage):  burn 1200 arts + RES −20 10 s · neural stun 10 s, then 1000 true · apoptosis 15 s: 阻回
//     (noSp) + 静默 (no skill activation), −1 SP/s, 100 arts/s · erosion permanent DEF −100, then 800 phys (10 s).
//   enemies (operator damage, "·我方"): burn 7000 元素伤害 + RES −20 (10 s) · neural 3 麻痹, then 6000 元素伤害 (10 s) ·
//     apoptosis 15 s: 50 % weaken recovering over the burst + 800 元素伤害/s · erosion 5000 元素伤害 + permanent DEF −120 (8 s).
//   necrosis (legacy spare gauge): 12 s of 100 true dmg/s and ATK −20 %.
// Burst damage is 无来源 (PRTS 元素 "元素爆发通常造成无来源的伤害"; PRTS 伤害分类: 无来源 = "无法被追溯伤害来源", yet "无来源
// 伤害的击杀也能追溯击杀来源"): DamageInfo `sourceless` — the damage-dealt multipliers and penetration of the unit that
// filled the gauge do not apply (the target's own RES cuts do, "可享受法抗减少效果"), and the `hit` / `damaged` / `fatal`
// hooks get `source: null`, so no content keyed on the attacker (ATK ×1.5 vs 海怪, 精准狙击镜, bond / module 伤害提升,
// reflect, "受到来自…的伤害") touches it; the hook ctx's `credit` and the kill / stats keep the filler ("元素爆发本身来源于
// 造成“爆条”的元素损伤的来源").
// 爆发冷却 (PRTS 元素, "阻回" after a burst): for the burst's duration (the `<el>Burst` buff) NO element of the unit can
// fill or be recovered (reduceElement) — the bursting gauge shows full — and when it ends EVERY gauge of the unit
// resets to 0. A burst that is still resolving (its `elementBurst` hook runs before the `<el>Burst` lock exists) already
// counts as locked (`unit.burstPending[el]`), so a hook that spreads an element back (淤困 parasite hosts next to each
// other) cannot re-burst the unit recursively. The unit's shown gauge (the fullest, "当前损伤元素") and its cooldown
// travel in b.snap `elem` (elementView).
// 元素伤害 (HP damage of an element) is the DamageInfo type 'elemental' (+ optional `element` for display): no DEF/RES
// (元素抗性 instead), no dodge, × source dmgDealtMul × target elementalTakenMul (元素脆弱) only — the target's
// dmgTakenMul (脆弱 and the other "受到的伤害±" effects) does not scale it: ba.fragile is "受到的物理、法术、真实伤害提升"
// (gamedata_const termDescriptionDict), 元素伤害 has its own ba.elementfragile [ASSUMED for the damage_resistance-type
// cuts, which share the multiplier]. An element fill on a target with no HP left (hasHp: a lethal hit's `damaged` hook
// runs before battle.kill, while the target is still `alive` at 0 HP) is refused, so nothing bursts on a corpse.
// Element healing (reduceElement) lowers every element type by the amount, each on its own (PRTS 菲莱 备注: "清除元素损伤"
// = "一次等同于自身最大元素值的全类型元素损伤治疗"). Sleeping units (沉睡: 无敌) take no damage unless the attacker's profile
// has `hitSleep` or the damage carries `ignoreSleep`.

import { MIN_DAMAGE_RATIO, ELEMENT, ELEMENT_ORDER, PALSY_MAX } from './constants.js';
import { BOSS_HIT_LIMIT } from '../../shared/constants.js';
import { evadesGround } from './targeting.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Alive AND still has HP (a boss: its pool's HP). A `damaged` hook sees a lethal hit before `battle.kill`, while the
 * target is still `alive` at 0 HP — element riders attached to that damage (and applyElement itself) skip such a
 * target, or a burst resolves on the corpse (a second fatal, 烛煌 熔点引爆's heal, 妮芙's stack …).
 */
export function hasHp(u) {
  return !!u && u.alive && (u.bossPool ? u.bossPool.hp > 0 : u.hp > 0);
}

/** Normalise a DamageInfo descriptor. */
export function makeDamageInfo(d = {}) {
  const type = d.type ?? 'phys';
  return {
    _norm: true,
    amount: Number.isFinite(+d.amount) ? +d.amount : 0,
    type,
    element: d.element ?? null,
    atkScale: d.atkScale ?? 1,
    defIgnoreFlat: d.defIgnoreFlat ?? 0,
    defIgnorePct: d.defIgnorePct ?? 0,
    resIgnoreFlat: d.resIgnoreFlat ?? 0,
    resIgnorePct: d.resIgnorePct ?? 0,
    mul: d.mul ?? 1,
    canDodge: d.canDodge ?? (type === 'phys' || type === 'arts'),
    isSkill: !!d.isSkill,
    isSplash: !!d.isSplash,
    isAttack: !!d.isAttack,
    isProjectile: !!d.isProjectile,
    tags: d.tags ?? [],
    cancel: false,
    noSp: !!d.noSp,
    ignoreSleep: !!d.ignoreSleep,
    // no selection 无法选择 effects stop (an ability that "无视无法选择" such as PRTS 【污染秽蚀】, a direct pick, a flying
    // unit's blast credited to a ground leader, the tick of a debuff already on the unit): reaches an airborne 起飞 ally
    // whatever the source's 行动方式
    ignoreSelect: !!d.ignoreSelect,
    sourceless: !!d.sourceless,
    attackId: d.attackId ?? 0,
    // 咒愈师 skills whose damage triggers their trait for ONE named ally ("并仅对该角色/干员触发…特性"): the instance
    // carries that ally, and the trait hook (professions.js installIncantation) heals it instead of the lowest-HP ally
    // in range. null = the ordinary target of the trait.
    traitAlly: d.traitAlly ?? null,
  };
}

/**
 * DamageInfo of the official `periodic_damage` template — 源石溶剂 (PRTS 盟约记录: "受到60真实伤害", 修正 "并非流失", 备注
 * "造成无来源真实持续环境伤害"), 狂暴宿主组长 ("自身每秒受到500无来源真实伤害"): 无来源 true 持续 damage (PRTS 伤害分类: attack
 * type BUFF, "自残类型"). A damage instance, not a 流失 (Battle.loseHp skips every damage event — PRTS 作战机制 "生命流失不会
 * 触发反伤、受击回复"): shields, damage-taken multipliers and target-side `hit` effects apply, and it is a "受到伤害" for
 * 受击回复 SP and the 重装 TAKE_DAMAGE trigger. Tagged 'dot' (a fixed-value DoT: ATK multipliers skip it; 锡人's 持续伤害
 * boost takes it) and 'periodic'. The caller passes the credit (the carrier / null) as the dealDamage source.
 */
export function periodicDamage(amount) {
  return makeDamageInfo({ amount, type: 'true', canDodge: false, sourceless: true, tags: ['dot', 'periodic'] });
}

/**
 * Is this the DamageInfo of a 流失 (Battle.loseHp, tag 'hpLoss')? Its `damaged` hook still runs (stats, leader parts,
 * HP thresholds), but a 流失 is not "受到伤害": "受到伤害时" content (heals, counters, 未受伤害 timers, 反伤 chances)
 * skips it — PRTS 作战机制 "生命流失…跳过所有结算与伤判效果…不会触发反伤、受击回复等受到攻击触发的时点".
 */
export function isHpLoss(dmg) {
  return !!dmg && Array.isArray(dmg.tags) && dmg.tags.includes('hpLoss');
}

/** 沉睡 (ba.sleep "无敌且无法行动"): only attackers whose profile has `hitSleep` (or `ignoreSleep` damage) reach a sleeper. */
function sleepBlocks(target, source, dmg) {
  return !!target.s.flags.sleep && !dmg.ignoreSleep && !(source && source.profile && source.profile.hitSleep);
}

/**
 * 起飞 (flag `liftoff`): a ground enemy's damage never reaches the airborne ally — it cannot select it (对地规避, PRTS 作战机制
 * "AOE的判定是对攻击范围内的每个可以被选中的敌人进行判定"), so its splash, area abilities and element fills skip it, and a shot
 * already in flight when it took off lands on nothing [ASSUMED: PRTS 伤害流程 7 "取消掉隐匿/无敌状态下的攻击" read for
 * 对地规避]. Checked before the `hit` hook only: 蒂比 S2 takes off inside the hook of the hit that set it off, which then
 * resolves as usual (dodged if physical / arts — PRTS 备注). Sourceless damage and `ignoreSelect` damage still land: no
 * selection (targeting.js evadesGround) — 无视无法选择 abilities, direct picks, flying units' blasts, and the ticks of a
 * debuff already on it (PRTS 异常效果: 无法选择 effects "仅在选择时生效"; the debuff's mods stay too).
 */
function liftoffEvades(target, source, dmg) {
  return !!target.s.flags.liftoff && !dmg.ignoreSelect && evadesGround(source, target);
}

/**
 * Pure mitigation formula (exported for tests). `target` = the target's stats; `ign.elementalRes` = its 元素抗性
 * (epDamageResistance) for 'elemental' damage.
 */
export function mitigate(amount, type, target, ign = {}) {
  if (type === 'phys') {
    const D = target.def ?? 0;
    const eff = Math.max(0, D * (1 - clamp01(ign.defIgnorePct ?? 0)) - (ign.defIgnoreFlat ?? 0));
    return Math.max(amount - eff, MIN_DAMAGE_RATIO * amount);
  }
  if (type === 'arts') {
    const R = target.res ?? 0;
    const eff = Math.max(0, R * (1 - clamp01(ign.resIgnorePct ?? 0)) - (ign.resIgnoreFlat ?? 0));
    return Math.max(amount * (1 - Math.min(100, eff) / 100), MIN_DAMAGE_RATIO * amount);
  }
  if (type === 'elemental') {
    const D = Math.max(0, Math.min(100, Number.isFinite(ign.elementalRes) ? ign.elementalRes : 0));
    return Math.max(amount * (1 - D / 100), MIN_DAMAGE_RATIO * amount);
  }
  return amount;
}

/**
 * 限伤 — the official boss-hit limit (shared/constants.js BOSS_HIT_LIMIT, docs/research/11-limits-official.md §2;
 * client `AutoChessStepModeManager._OnBossEnemyTakeDamage`: `d = ceil(value); if (d >= 300000) modifier.Cancel()`).
 * True when the hit of `amount` HP about to land on `target` is cancelled: the target is a leader (`isBoss`: the
 * tag-'boss' units — data/bosses.json enemyKey, the official IsBossEnemy list — and their mirrored copies; never a part,
 * escort, drone or other minion), the battle is a boss / hidden one (the client's step mode: every boss battle outside
 * training) and ceil(amount) ≥ BOSS_HIT_LIMIT. The cancel is whole (no clamp): no HP / pool loss, no credit, no damage
 * number. A 'hitCap' fx event `{ id, n: ceil(amount) }` marks it for the client, which draws nothing — the official
 * shows no number [ASSUMED]. Every HP-damage kind is checked as the official `modifier.isDamage` (phys, arts, true,
 * 元素伤害 incl. element bursts, DoT ticks — they all come through dealDamage — and losses passed on to a leader through
 * Battle.loseHp); element 损伤 (gauge fill, 'element') removes no HP and is never checked. Deterministic (Math.ceil of
 * the same double on every engine).
 */
export function leaderHitCancelled(battle, target, amount) {
  if (!(BOSS_HIT_LIMIT > 0) || !target || !target.isBoss || (battle.kind !== 'boss' && battle.kind !== 'hidden')) return false;
  if (!(Math.ceil(amount) >= BOSS_HIT_LIMIT)) return false;
  battle.fx('hitCap', { x: target.x, y: target.y, id: target.id, n: Math.ceil(amount) });
  return true;
}

/** Absorb damage with shields on `target`. Returns the remaining amount. */
export function absorbShields(battle, target, amount) {
  if (amount <= 0) return 0;
  let changed = false;
  let rest = amount;
  for (let i = 0; i < target.buffs.length && rest > 0; i++) {
    const b = target.buffs[i];
    if (b.shieldHits > 0) {
      b.shieldHits--;
      rest = 0;
      if (b.shieldHits <= 0 && !(b.shield > 0) && !b.mods && !b.flags) { battle._removeBuffAt(target, i); i--; }
      changed = true;
      break;
    }
  }
  for (let i = 0; i < target.buffs.length && rest > 0; i++) {
    const b = target.buffs[i];
    if (b.shield > 0) {
      const take = Math.min(b.shield, rest);
      b.shield -= take;
      rest -= take;
      changed = true;
      if (b.shield <= 1e-9) {
        b.shield = 0;
        if (!b.mods && !b.flags && !(b.shieldHits > 0)) { battle._removeBuffAt(target, i); i--; }
      }
    }
  }
  if (changed) target.markDirty();
  return rest;
}

/**
 * Full damage pipeline. Returns the HP actually removed (0 when dodged/cancelled/absorbed).
 */
export function dealDamage(battle, source, target, dmgIn) {
  if (!target || !target.alive || target.removed || target.hidden || !target.deployed) return 0;
  const dmg = dmgIn && dmgIn._norm ? dmgIn : makeDamageInfo(dmgIn);
  if (dmg.type === 'element') return applyElement(battle, source, target, dmg);
  // 无来源 (dmg.sourceless, element bursts): hooks see no source — nothing keyed on "damage dealt by X" (ATK-up vs a
  // tag, 伤害提升 items / bonds / modules, reflect, "受到来自…的伤害") can recognise it; `credit` names the unit that still
  // gets the stats and the kill (PRTS 伤害分类 无来源 ③)
  const hs = dmg.sourceless ? null : source;
  let ts = target.s;
  if (ts.flags.invulnerable || sleepBlocks(target, hs, dmg) || liftoffEvades(target, hs, dmg)) return 0;
  if (battle._hooks.hit) {
    battle.emit('hit', { source: hs, target, dmg, credit: source });
    if (dmg.cancel || !target.alive || !target.deployed) return 0;
    if (dmg.type === 'element') return applyElement(battle, source, target, dmg);
    ts = target.s; // handlers may have changed the target's buffs (fragile, invulnerable, dodge…): never use stale stats
    if (ts.flags.invulnerable || sleepBlocks(target, hs, dmg)) return 0;
  }
  const type = dmg.type;
  // dodge
  if (dmg.canDodge && (type === 'phys' || type === 'arts')) {
    const p = type === 'phys' ? ts.dodgePhys : ts.dodgeArts;
    if (p > 0 && battle.rng() < p) {
      battle.fx('dodge', { x: target.x, y: target.y, id: target.id });
      if (battle._hooks.dodge) battle.emit('dodge', { source, target, dmg });
      return 0;
    }
  }
  // 频次 units (flags hitCount / hitCountArts): every damage instance removes exactly 1 HP (maxHp = hits needed);
  // hitCountArts ignores physical instances. The instance keeps its own DamageInfo, so `damaged` handlers still
  // recognise their own (tagged) damage — never re-create such a loss with a fresh loseHp.
  if (ts.flags.hitCount || ts.flags.hitCountArts) {
    const counts = !(ts.flags.hitCountArts && !ts.flags.hitCount && type === 'phys');
    return applyHpLoss(battle, source, target, absorbShields(battle, target, counts ? 1 : 0), dmg);
  }
  // 无来源 damage (element bursts) takes nothing from its source's stats; the source still gets the credit below
  const ss = source && source.s && !dmg.sourceless ? source.s : null;
  let final = mitigate(dmg.amount, type, ts, {
    defIgnorePct: dmg.defIgnorePct + (ss ? ss.defIgnorePct : 0),
    defIgnoreFlat: dmg.defIgnoreFlat + (ss ? ss.defIgnoreFlat : 0),
    resIgnorePct: dmg.resIgnorePct + (ss ? ss.resIgnorePct : 0),
    resIgnoreFlat: dmg.resIgnoreFlat + (ss ? ss.resIgnoreFlat : 0),
    elementalRes: type === 'elemental' ? (target.def?.epDamageResistance ?? 0) : 0,
  });
  // 脆弱 / "受到的伤害±" (dmgTakenMul) scale 物理、法术、真实 only; 元素伤害 takes 元素脆弱 alone (header)
  let mul = dmg.mul * (type === 'elemental' ? 1 : ts.dmgTakenMul);
  if (ss) mul *= ss.dmgDealtMul * (type === 'phys' ? ss.physDealtMul : type === 'arts' ? ss.artsDealtMul : 1);
  mul *= type === 'phys' ? ts.physTakenMul : type === 'arts' ? ts.artsTakenMul : type === 'elemental' ? ts.elementalTakenMul : ts.trueTakenMul;
  final *= mul;
  if (!(final > 0) || !Number.isFinite(final)) final = 0;
  // 限伤: a leader's hit of ≥ BOSS_HIT_LIMIT in a boss / hidden battle is cancelled before it reaches shields / HP — what
  // ran before it (the attack, its SP, `hit` hook effects, separate element 损伤) stays; nothing after it happens
  if (final > 0 && leaderHitCancelled(battle, target, final)) return 0;
  final = absorbShields(battle, target, final);
  return applyHpLoss(battle, source, target, final, dmg);
}

/**
 * Remove HP (after mitigation) and run damaged/fatal/kill bookkeeping. Also used by `battle.loseHp` (流失).
 */
export function applyHpLoss(battle, source, target, amount, dmg) {
  if (!target.alive) return 0;
  let dealt = 0;
  const hs = dmg && dmg.sourceless ? null : source; // the source hooks see (无来源: none; `credit` keeps it)
  if (target.bossPool) {
    const pool = target.bossPool;
    const before = pool.hp;
    const pid = source && source.side === 'ally' ? source.ownerId : null;
    if (amount > 0) {
      try { pool.damage(pid, amount); } catch (e) { battle._internalError('bossPool.damage', e); pool.hp = Math.max(0, pool.hp - amount); }
    }
    dealt = Math.max(0, before - pool.hp);
    if (!Number.isFinite(dealt)) dealt = 0; // a misbehaving pool (NaN hp) must not poison damage stats
    if (pid != null) { const pp = battle._pp(pid); if (pp) pp.bossDamage += dealt; }
    battle._syncBossHp(target);
  } else {
    const before = target.hp;
    target.hp -= amount;
    if (target.hp <= 0) {
      target.hp = 0;
      if (battle._hooks.fatal) {
        const fctx = { unit: target, source: hs, credit: source, dmg, amount, prevented: false };
        battle.emit('fatal', fctx);
        if (fctx.prevented && target.alive) { if (target.hp < 1) target.hp = Math.min(1, target.s.maxHp); }
      }
    }
    dealt = Math.max(0, before - Math.max(0, target.hp));
  }
  // damage dealt (unit stats, the results screen's 造成伤害) never counts a unit's own side — its own drain or 流失 (源石溶剂,
  // 史尔特尔 S3 …), friendly damage; `taken` and the kill credit do
  if (source && source.side !== target.side) {
    source.stats.dmg += dealt;
    if (source.side === 'ally' && source.ownerId != null) { const pp = battle._pp(source.ownerId); if (pp) pp.damageDealt += dealt; }
  }
  target.stats.taken += dealt;
  target.lastHitAt = battle.time;
  if (dmg && !dmg.silent && amount >= 0.5) {
    const shown = dmg.type === 'element' ? dmg.element : dmg.type === 'elemental' ? (dmg.element || 'true') : dmg.type;
    battle._ev(['dmg', target.id, Math.round(amount), shown]);
  }
  if (battle._hooks.damaged) battle.emit('damaged', { source: hs, target, amount, type: dmg ? dmg.type : 'true', dmg, credit: source });
  if (target.side === 'ally' && target.skill && dmg && !dmg.noSp && dmg.type !== 'element') battle._skills.onDamaged(target);
  const dead = target.bossPool ? target.bossPool.hp <= 0 : target.hp <= 0;
  if (dead && target.alive) battle.kill(target, source);
  return dealt;
}

/**
 * Are `target`'s element gauges locked (爆发冷却, see header): a burst's `<el>Burst` lock is up (any element — the lock
 * holds every gauge of the unit), or a burst of the unit is resolving right now. The element argument of older callers
 * is ignored.
 */
export function burstLocked(target) {
  const p = target.burstPending;
  if (p) for (const k in p) if (p[k]) return true;
  return !!target.s.flags.burstLock;
}

/** The burst lock buff (爆发冷却) running on `u`, or null. */
function burstLockOf(u) {
  let best = null;
  for (const b of u.buffs) if (b.flags && b.flags.burstLock && (!best || b.timeLeft > best.timeLeft)) best = b;
  return best;
}

/**
 * The element gauge a unit shows (b.snap `elem`, render/units.js): null when every gauge is empty and no burst
 * cooldown runs. Official display (PRTS 元素): one icon, the "当前损伤元素" — the fullest gauge, i.e. the least 元素值
 * left (ties: the lower official element id, constants.js ELEMENT_ORDER) — with a white bar of its remaining 元素值;
 * during a 爆发冷却 the bursting element, refilling over the cooldown. Returns `[el, fill, cooldownEnd (game s),
 * cooldown (s)]`; the two cooldown numbers are 0 outside a cooldown. `fill` has 2 decimals and is rounded DOWN
 * (0.01–0.99 while no burst runs, 1 during one), so the remainder shown (1 − fill) is never less than what is left —
 * except that a first chip of less than 1 % (under 10 元素值 of 1000) already shows as 1 % taken — and the bar only
 * runs out when the gauge bursts (user playtest #6). `now` = the battle time.
 */
export function elementView(u, now) {
  const e = u.elem;
  if (!e) return null;
  const lock = u.s.flags.burstLock ? burstLockOf(u) : null;
  if (lock) {
    const el = lock.key.endsWith('Burst') ? lock.key.slice(0, -5) : 'burn';
    const dur = Number.isFinite(lock.duration) && lock.duration > 0 ? lock.duration : 0;
    const left = Number.isFinite(lock.timeLeft) ? Math.max(0, lock.timeLeft) : 0;
    return [el in e ? el : 'burn', 1, Math.round((now + left) * 100) / 100, Math.round(dur * 100) / 100];
  }
  let best = null, bv = 0;
  for (const k of ELEMENT_ORDER) { const v = e[k]; if (v > bv) { bv = v; best = k; } }
  if (!best) return null;
  // rounded down (1e-9: 290 / 1000 × 100 is 28.999…), kept inside 1–99 %: a sliver shows, an empty bar = a burst
  const fill = Math.min(0.99, Math.max(0.01, Math.floor((bv / u.gaugeMax) * 100 + 1e-9) / 100));
  return [best, fill, 0, 0];
}

/**
 * The share of an element hit that reaches `target`'s gauge (header): its 元素损伤倍率 (`elemTakenMul`) × max(5 %,
 * 1 − 损伤抵抗 / 100) — the factor applyElement uses after the `elementHit` hook, exported for content that previews a
 * gauge gain.
 */
export function elementIntake(target) {
  const res = Number(target && target.def ? target.def.epResistance : 0) || 0;
  return target.s.elemTakenMul * Math.max(MIN_DAMAGE_RATIO, 1 - clamp01(res / 100));
}

/** Element gauge accumulation + burst. Fires `elementHit` { source, target, dmg } first (mutable amount/mul, cancel). */
export function applyElement(battle, source, target, dmg) {
  const el = dmg.element;
  if (!el || !(el in target.elem)) return 0;
  if (!hasHp(target)) return 0; // a killing blow's rider: the target is dead, nothing fills or bursts (header)
  if (target.s.flags.invulnerable || sleepBlocks(target, source, dmg)) return 0;
  if (liftoffEvades(target, dmg.sourceless ? null : source, dmg)) return 0;
  if (burstLocked(target, el)) return 0;
  if (battle._hooks.elementHit) {
    battle.emit('elementHit', { source, target, dmg });
    if (dmg.cancel || !target.alive || !target.deployed || burstLocked(target, el)) return 0;
    if (dmg.type !== 'element') return dealDamage(battle, source, target, dmg); // a handler converted it
  }
  const max = target.gaugeMax;
  // 元素损伤倍率 × max(5 %, 1 − 损伤抵抗 %) — official EP_RESISTANCE = data epResistance
  let amt = dmg.amount * dmg.mul * elementIntake(target);
  if (!(amt > 0) || !Number.isFinite(amt)) return 0;
  target.elem[el] = Math.min(max, target.elem[el] + amt);
  battle._ev(['dmg', target.id, Math.round(amt), el]);
  if (source) source.stats.elem = (source.stats.elem ?? 0) + amt;
  if (battle._hooks.damaged) battle.emit('damaged', { source, target, amount: amt, type: 'element', dmg });
  if (target.elem[el] >= max && target.alive) elementBurst(battle, source, target, el);
  return amt;
}

/**
 * A burst (see header): side-aware official effects; the `<el>Burst` buff is the 爆发冷却 that locks every gauge of the
 * unit for its duration. The unit is marked `burstPending[el]` while the burst resolves (hook, lock, hits), so nothing
 * re-bursts it in the meantime.
 */
export function elementBurst(battle, source, target, el) {
  if (!ELEMENT[el] || !target.alive || burstLocked(target)) return;
  const pending = target.burstPending || (target.burstPending = {});
  pending[el] = true;
  try { resolveBurst(battle, source, target, el); } finally { pending[el] = false; }
}

function resolveBurst(battle, source, target, el) {
  const cfg = ELEMENT[el];
  target.elem[el] = target.gaugeMax;
  // the cooldown's end restores every element of the unit ("随后单位所有种类的元素值恢复至最大值")
  const reset = () => { for (const k of ELEMENT_ORDER) if (k in target.elem) target.elem[k] = 0; };
  battle.fx('burst', { x: target.x, y: target.y, id: target.id, element: el });
  if (battle._hooks.elementBurst) battle.emit('elementBurst', { source, target, element: el });
  if (!target.alive) { reset(); return; }
  const tags = ['burst', el];
  // 无来源 damage credited to `source` (header)
  const hit = (amount, type) => battle.dealDamage(source, target, { amount, type, element: el, canDodge: false, sourceless: true, tags });
  const lock = (duration, extra = {}) => {
    if (!(duration > 0)) { reset(); return null; }
    return battle.addBuff(target, { key: `${el}Burst`, duration, visible: true, onExpire: reset, onRemove: reset, ...extra, flags: { burstLock: true, ...(extra.flags || {}) } });
  };
  if (el === 'necrosis') {
    lock(cfg.duration, {
      mods: { atkMul: 1 - cfg.atkDownPct }, interval: 1,
      onTick: () => battle.dealDamage(source, target, { amount: cfg.dps, type: 'true', canDodge: false, sourceless: true, tags: ['burst', 'necrosis'] }),
    });
    return;
  }
  const enemy = target.side === 'enemy';
  const c = enemy ? cfg.enemy : cfg.ally;
  if (el === 'burn') {
    lock(c.duration, { mods: { resFlat: -c.resDown } });
    if (enemy) hit(c.elemDamage, 'elemental'); else hit(c.damage, c.type);
  } else if (el === 'neural') {
    // PRTS 元素: the status first ("立刻获得等时长的眩晕" / "获得3层麻痹"), then the hit
    lock(c.duration);
    if (enemy) {
      battle.applyStatus(target, 'palsy', { value: c.palsy, source });
      if (target.alive) hit(c.elemDamage, 'elemental');
    } else {
      battle.applyStatus(target, 'stun', { duration: c.stun, source, force: true });
      if (target.alive) hit(c.damage, c.type);
    }
  } else if (el === 'apoptosis') {
    if (enemy) {
      // 50 % 虚弱, 800 元素伤害 per second; each second the 虚弱 drops to 50 % × 剩余时间 ÷ 总持续时间 (PRTS 元素)
      lock(c.duration, {
        mods: { atkMul: 1 - c.weaken }, interval: 1,
        onTick: ({ buff }) => {
          buff.mods = { atkMul: 1 - c.weaken * Math.max(0, buff.timeLeft) / c.duration };
          target.markDirty();
          hit(c.elemDps, 'elemental');
        },
      });
    } else {
      // 15 s of 阻回 ("停止并阻止任意形式的技力回复": noSp) + 静默 (no skill activation), −1 SP and 100 arts damage per second
      lock(c.duration, {
        flags: { silence: true, noSp: true }, interval: 1,
        onTick: () => {
          const sk = target.skill;
          if (sk && !sk.noSkill && sk.kind !== 'passive' && !(sk.active && sk.isTimed) && sk.sp > 0) sk.sp = Math.max(0, sk.sp - c.spLossPerSec);
          hit(c.dps, c.dpsType);
        },
      });
    }
  } else if (el === 'erosion') {
    // the permanent DEF cut lands first, then the hit; both sides then have their cooldown (operators 10 s, enemies 8 s)
    lock(c.duration);
    battle.addBuff(target, { key: 'erosionDown', refresh: 'stack', stacks: 1, maxStacks: 1e6, mods: { defFlat: -c.defDown }, visible: true });
    if (enemy) hit(c.elemDamage, 'elemental'); else hit(c.damage, c.type);
  }
}

/** Add `n` 麻痹 stacks (at most PALSY_MAX). */
export function palsyBuff(n) {
  const stacks = Math.max(1, Math.min(PALSY_MAX, Math.floor(Number.isFinite(n) ? n : 1)));
  return { key: 'palsy', refresh: 'stack', stacks, maxStacks: PALSY_MAX, visible: true, status: 'palsy' };
}

/**
 * Element healing (e.g. wandermedic "回复元素损伤"): lowers element `el`, or — without `el` — EVERY element type, each
 * by `amount` on its own (PRTS 菲莱 备注: clearing = "一次等同于自身最大元素值（通常为1000）的全类型元素损伤治疗").
 * Returns the total removed. Nothing recovers during a burst cooldown ("爆发冷却状态下，单位所有类型的元素值均无法损失、
 * 无法被其他手段回复").
 */
export function reduceElement(target, amount, el = null) {
  let removed = 0;
  if (!target || !target.elem || burstLocked(target) || !(amount > 0)) return 0;
  const els = el ? [el] : Object.keys(target.elem);
  for (const k of els) {
    const take = Math.min(target.elem[k] || 0, amount);
    if (take > 0) { target.elem[k] -= take; removed += take; }
  }
  return removed;
}

/**
 * Heal pipeline. Returns the HP actually restored. `noHeal` stops heals from others (`self` heals pass); `healFree` (禁疗,
 * PRTS 异常效果 HEAL_FREE "受到的治疗量变为0") stops the unit's own too — except an HP-regeneration attribute (`regen`:
 * "增减生命回复速度或生命回复速度（百分比）属性的效果不会被识别为治疗类能力") and a heal that ignores it (`ignoreHealFree`:
 * 史尔特尔 S3's start heal, PRTS "无视禁疗").
 */
export function heal(battle, source, target, amount, opts = {}) {
  if (!target || !target.alive || target.removed || !target.deployed || target.bossPool) return 0;
  const self = source === target || !!opts.self;
  if (!self && (target.s.flags.noHeal || (target.profile && target.profile.noHeal))) return 0;
  if (target.s.flags.healFree && !opts.regen && !opts.ignoreHealFree) return 0;
  let amt = amount * (source && source.s ? source.s.healingDealtMul : 1) * target.s.healingTakenMul;
  if (!(amt > 0) || !Number.isFinite(amt)) return 0;
  if (battle._hooks.heal) {
    const ctx = { source, target, amount: amt, opts };
    battle.emit('heal', ctx);
    amt = Number.isFinite(ctx.amount) ? Math.max(0, ctx.amount) : 0;
    // a handler may have killed / retreated the target: healing a dead unit would leave it "dead with hp > 0"
    if (!target.alive || !target.deployed) return 0;
  }
  const max = target.s.maxHp;
  const actual = Math.max(0, Math.min(amt, max - target.hp));
  target.hp = Math.min(max, target.hp + actual);
  if (opts.overheal && amt > actual) {
    // overheal becomes a shield (capped at max HP) so hp stays within [0, maxHp]
    const cur = target.findBuff('overheal');
    const val = Math.min(max, (cur ? cur.shield : 0) + (amt - actual));
    battle.addBuff(target, { key: 'overheal', shield: val, duration: opts.overhealDuration ?? Infinity });
  }
  if (source) {
    source.stats.heal += actual;
    if (source.side === 'ally' && source.ownerId != null) { const pp = battle._pp(source.ownerId); if (pp) pp.healingDone += actual; }
  }
  if (actual >= 0.5 && !opts.silent) battle._ev(['heal', target.id, Math.round(actual)]);
  return actual;
}
