// Damage descriptors and shared guards. No damage is applied here.
import { evadesGround } from '../targeting.js';

/**
 * Alive AND still has HP (a boss: its pool's HP). A `damaged` hook sees a lethal hit before `battle.kill`, while the
 * target is still `alive` at 0 HP — element riders attached to that damage (and applyElement itself) skip such a
 * target, or a burst resolves on the corpse (a second fatal, 烛煌 熔点引爆's heal, 妮芙's stack …).
 */
export function hasHp(u) {
  return !!u && u.alive && (u.bossPool ? u.bossPool.hp > 0 : u.hp > 0);
}

/** PRTS 伤害分类: application route belongs to an instance, independently of its source's profile. */
export function damageApplyWay(d) {
  return d.applyWay ?? (d.isProjectile ? 'RANGED' : d.isAttack ? 'MELEE' : 'NONE');
}

/** Legacy tag inference only; explicit requests default to NORMAL independently of descriptive tags. */
export function damageAttackType(dmg) {
  return dmg.attackType ?? (dmg.isSplash ? 'SPLASH'
    : dmg.tags?.some(tag => tag === 'dot' || tag === 'necrosis' || tag === 'apoptosis') ? 'BUFF' : 'NORMAL');
}

/** Native cancellation masks reject a reason after its effect has attempted to cancel. */
export function ignoresDamageCancellation(dmg, reason) {
  return !!dmg && (Array.isArray(dmg.ignoreCancelReasons) && dmg.ignoreCancelReasons.includes(reason)
    || reason === 'dodge' && (dmg.dodgeMode === 'uncancellable' || dmg.dodgeMode === 'ignore'
      || dmg.dodgeMode == null && dmg.canDodge === false));
}

/** Skipping a dodge attempt remains distinct from attempting one whose cancellation is rejected. */
export function damageDodgeMode(dmg) {
  const mode = dmg.dodgeMode ?? (dmg.canDodge === false ? 'ignore' : 'normal');
  return mode === 'ignore' ? mode : ignoresDamageCancellation(dmg, 'dodge') ? 'uncancellable' : mode;
}

/** Preserve the actual miss even when its cancellation is rejected; other early hit cancellations remain ordinary. */
export function cancelDamage(dmg, reason) {
  if (reason === 'miss') dmg.missed = true;
  if (ignoresDamageCancellation(dmg, reason)) return false;
  dmg.cancel = true;
  return true;
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
    canDodge: d.dodgeMode != null ? d.dodgeMode !== 'ignore' : d.canDodge ?? (type !== 'element'),
    applyWay: damageApplyWay(d),
    attackType: damageAttackType(d),
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
    ...(d.origin != null ? { origin: d.origin } : {}),
    ...(d.dodgeMode != null ? { dodgeMode: d.dodgeMode } : {}),
    ...(d.calculation != null ? { calculation: d.calculation } : {}),
    ...(d.ignoreCancelReasons != null ? { ignoreCancelReasons: [...d.ignoreCancelReasons] } : {}),
  };
}

/**
 * DamageInfo of the official `periodic_damage` template — 源石溶剂 (PRTS 盟约记录: "受到60真实伤害", 修正 "并非流失", 备注
 * "造成无来源真实持续环境伤害"), 狂暴宿主组长 ("自身每秒受到500无来源真实伤害"): 无来源 true 持续 damage (PRTS 伤害分类: attack
 * type BUFF, "自残类型"). A damage instance, not a 流失 (Battle.dealHPLose skips every damage event — PRTS 作战机制 "生命流失不会
 * 触发反伤、受击回复"): shields, damage-taken multipliers and target-side `hit` effects apply, and it is a "受到伤害" for
 * 受击回复 SP and the 重装 TAKE_DAMAGE trigger. Tagged 'dot' (a fixed-value DoT: ATK multipliers skip it; 锡人's 持续伤害
 * boost takes it) and 'periodic'. The caller passes the credit (the carrier / null) as the dealDamage source.
 */
export function periodicDamage(amount) {
  return makeDamageInfo({ amount, type: 'true', canDodge: false, sourceless: true, tags: ['dot', 'periodic'] });
}

/**
 * Is this the DamageInfo of a 流失 (Battle.dealHPLose, tag 'hpLoss')? Its `damaged` hook still runs (stats, leader parts,
 * HP thresholds), but a 流失 is not "受到伤害": "受到伤害时" content (heals, counters, 未受伤害 timers, 反伤 chances)
 * skips it — PRTS 作战机制 "生命流失…跳过所有结算与伤判效果…不会触发反伤、受击回复等受到攻击触发的时点".
 */
export function isHpLoss(dmg) {
  return !!dmg && Array.isArray(dmg.tags) && dmg.tags.includes('hpLoss');
}

/** 沉睡 (ba.sleep "无敌且无法行动"): only attackers whose profile has `hitSleep` (or `ignoreSleep` damage) reach a sleeper. */
export function sleepBlocks(target, source, dmg) {
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
export function liftoffEvades(target, source, dmg) {
  return !!target.s.flags.liftoff && !dmg.ignoreSelect && evadesGround(source, target);
}
