// server/sim/professions.js — default combat behaviour per profession / subProfessionId (DESIGN §5.6 traits).
//
// A *profile* describes how a unit attacks. It is resolved once per unit:
//   PROFESSION_DEFAULTS[profession] → SUB[subProfessionId] → trait-text / trait-blackboard tunables (TUNE[sub]) →
//   data fields (dmgType/attackKind/projectile/canHitFly/targetPriority from data/chess.json) → kit.trait overrides.
// Profile fields:
//   attack 'melee'|'ranged'   dmgType 'phys'|'arts'|'true'|'heal'|'none'
//   projectile 'none'|'beam'|'arrow'|'bolt'|'bomb'|'lob'|'orb'|'drone'|'boomerang' ('beam': an instant hit drawn as a
//                             line; 'boomerang': out to the target and back to the thrower, ai.js throwBoomerang)
//                             boomerang bool (回环射手: keeps 'boomerang')
//   canHitFly bool            maxTargets n (≥1)          hitAllBlocked bool ("同时攻击阻挡的所有敌人": up to the block count of
//                             targets, blocked ones first — ai.js targetCount)
//   allInRange bool (every enemy on the range at once)   splashRadius tiles (around the struck target)
//   rangeAoe bool (a 锁定攻击范围 AoE without a projectile — SUB table or kit trait, applied by resolveProfile after
//                  every override: allInRange + instant 'beam' hits on a ranged profile; only selectable enemies are
//                  struck — a stealthed one is not, unless revealed or blocked; PRTS 作战机制 §AOE伤害判定)
//   splashScale (× damage for splash victims)
//   splashOthersOnly bool     groundOnly bool            hits n (damage instances per attack)
//   chain {count, falloff, radius, sluggish}              heal {mode:'single'|'multi'|'chain', count, falloff, farMul, elementHealRatio}
//   priority 'fly'|'lowDef'|'ranged'|'lowestHp'|'highestHp'|'nearest'|'farthest'|'notBurst'|null
//   noAttack bool (never attacks)   noAttackUnlessSkill bool (attacks only while its skill is active)
//   noHeal bool (cannot be healed by others)   blockFly bool   onHitStatus {key, duration, value}
//   dmgMul(battle, unit, target) → number      afterHit(battle, unit, target, {dealt,x,y})
//   canAttack(battle, unit) → bool             afterAttack(battle, unit, targets)
//   skipEnemy(enemy) → bool (an enemy the unit never selects — targeting.js canTargetEnemy; 嵯峨 "不攻击重伤单位")
//   healThrough(healer, ally) → bool (a healer that selects and heals that ally through its 禁疗 — Battle
//                             injuredAlliesInKeys, damage.js heal; 凯尔希 on her Mon3tr)
//   hitsFn(battle, unit, info) → n (info: the hit's { isSkill, index, attackId, energy })
//   hitDmgMul n (伤害倍率 of each of the `hits` instances on the main target: DamageInfo `mul`, applied after DEF / RES
//                and the damage multipliers, not 攻击倍率 — a 频次 enemy still loses 1 per instance; the instances after
//                the first carry `noSp`, no 受击回复: 砾's two 50 % hits, PRTS 砾 特性备注 — ai.js resolveHit)
//   install(battle, unit) — per-unit hooks, called once at setup
//   storeEnergy(battle, unit) → bool / releaseEnergy(battle, unit) → n (秘术师: the attack check found no valid target ⇒
//                             store one energy, false when full; the energies leaving with an attack — installMystic)
//   dollNoAttack bool (傀儡师: its <替身> makes no normal attack and casts no skill — 归溟幽灵鲨, kit trait)
//   tb — the unit's trait blackboard (data `trait.bb`), used for tunables (module upgrades included on elites)
// Behaviour per subprofession is documented in docs/SIM.md §Professions. Front / side tests use the unit's direction
// (`dir`, sim/dir.js): offsets are compared in its facing-RIGHT frame.

import { toLocal, frontOf } from './dir.js';
import { isHpLoss } from './damage.js';
import { absoluteRangeKeys } from './targeting.js';
import { bodyInKeys, bodyKeys, bodyOnTile } from './body.js';
import { COLS, CHAIN_RADIUS } from './constants.js';

const P = (o) => Object.freeze(o);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export const PROFESSION_DEFAULTS = Object.freeze({
  SNIPER: P({ attack: 'ranged', dmgType: 'phys', projectile: 'arrow', canHitFly: true }),
  CASTER: P({ attack: 'ranged', dmgType: 'arts', projectile: 'bolt', canHitFly: true }),
  MEDIC: P({ attack: 'ranged', dmgType: 'heal', projectile: 'orb', canHitFly: true, heal: { mode: 'single' } }),
  SUPPORT: P({ attack: 'ranged', dmgType: 'arts', projectile: 'bolt', canHitFly: true }),
  TANK: P({ attack: 'melee', dmgType: 'phys', projectile: 'none', canHitFly: false }),
  WARRIOR: P({ attack: 'melee', dmgType: 'phys', projectile: 'none', canHitFly: false }),
  PIONEER: P({ attack: 'melee', dmgType: 'phys', projectile: 'none', canHitFly: false }),
  SPECIAL: P({ attack: 'melee', dmgType: 'phys', projectile: 'none', canHitFly: false }),
  TOKEN: P({ attack: 'melee', dmgType: 'phys', projectile: 'none', canHitFly: false }),
});

// --------------------------------------------------------------------------------------------------------------
// install helpers (per-unit hooks). All use engine helpers only; tunables come from unit.profile.

/**
 * 武者 (musha) trait "每次攻击到敌人后回复自身N生命" (bb value) with the branch rules of PRTS 分支特性信息 武者: "特性治疗于干员每次
 * 输出伤害时触发（不局限于攻击）" and "常态持有禁疗；通过自身特性/天赋/技能产生的作用于自身的治疗效果会无视自身的禁疗". The official
 * trait buffs (buff_template_data `utage_trait`, `helage_trait`, `zuole_trait`) fire on ON_OUTPUT_DAMAGE: one heal per damage
 * instance the unit deals to an enemy — every hit of a normal attack (the second hit of a double strike, a splash or
 * chain victim) and every skill / item / bond damage instance credited to it; a dodged hit deals none (no `damaged`).
 * Not a 流失 (no damage dealt), not an element 损伤 (a gauge fill, no HP damage — as 咒愈师), not a buff-made damage
 * (talent / DoT tags: attackType BUFF — [ASSUMED] as before; only 隐德来希's template filters it and no 武者 kit deals such
 * damage). The heal ignores 禁疗 (`ignoreHealFree`: an abnormal flag is one switch whoever set it — PRTS 异常效果).
 */
const installMushaHeal = (battle, unit) => {
  battle.on('damaged', (c) => {
    if (c.source !== unit || !unit.alive || !c.target || c.target.side !== 'enemy') return;
    const dmg = c.dmg;
    if (!dmg || isHpLoss(dmg) || c.type === 'element') return;
    const tags = dmg.tags || [];
    if (tags.includes('talent') || tags.includes('dot') || tags.includes('periodic')) return;
    battle.heal(unit, unit, unit.profile.selfHeal ?? 50, { self: true, ignoreHealFree: true });
  }, { owner: unit, priority: -10 });
};

/**
 * 收割者 (reaper) self-heal ("每次攻击到敌人回复自身50生命，最大生效数等于阻挡数"). Normal attacks arrive as one 'attack' event
 * whose `targets` are every enemy hit.
 *
 * The official trait is a buff ON the operator that fires on ON_OUTPUT_DAMAGE — buff_template_data `etlchi_trait`,
 * `excu2_trait` react to any damage the unit outputs, and 隐德来希's filters the attackType BUFF out (damage produced by a
 * buff/talent — e.g. her own 萃血 DoT). So skill damage heals too: 隐德来希's S2 blood sickles restore her life although the
 * skill stops her attacks (`attack: { noAttack: true }`) — the sickle's AOEDamage nodes are attackType NORMAL and PRTS 备注
 * says "伤害来源始终视为隐德来希". Every such hit arrives as one 'damaged' event per enemy, so the reaper cap ("最大生效数") is
 * applied per instant here: the official `[heal_fake]` window is 0.05 s and its stack count is the block number
 * (`SetStackCountViaBlockNum`; PRTS 分支特性信息 收割者 "触发后的0.05s内最多只能累加等于自身阻挡数的治疗次数"). [ASSUMED] the sim uses
 * the same `battle.time` as its window, so simultaneous hits (both 血镰, an AoE) share the block-count cap; a normal attack
 * has its own event and its own cap, as before. Like the 武者's, the heal ignores 禁疗 (PRTS 分支特性信息 收割者 "通过自身特性/
 * 天赋/技能产生的作用于自身的治疗效果会无视自身的禁疗").
 */
const installReaperHeal = (battle, unit) => {
  const heal = (n) => { if (n > 0 && unit.alive) battle.heal(unit, unit, (unit.profile.selfHeal ?? 50) * n, { self: true, ignoreHealFree: true }); };
  battle.on('attack', (ctx) => {
    if (ctx.attacker !== unit || !unit.alive) return;
    heal(Math.min(ctx.targets.length, Math.max(1, unit.s.blockCnt)));
  }, { owner: unit, priority: -10 });
  battle.on('damaged', (c) => {
    if (c.source !== unit || !unit.alive || !c.target || c.target.side !== 'enemy') return;
    const dmg = c.dmg;
    if (!dmg || dmg.isAttack || isHpLoss(dmg)) return; // normal attacks: the 'attack' hook; a 流失 is not damage dealt
    const tags = dmg.tags || [];
    if (tags.includes('talent') || tags.includes('dot') || tags.includes('periodic')) return; // attackType BUFF
    const mem = unit.mem;
    if (mem.selfHealAt !== battle.time) { mem.selfHealAt = battle.time; mem.selfHealN = 0; }
    if (mem.selfHealN >= Math.max(1, unit.s.blockCnt)) return;
    mem.selfHealN++;
    heal(1);
  }, { owner: unit, priority: -10 });
};

/**
 * 咒愈师 (incantationmedic) trait "攻击造成法术伤害，攻击敌人时为攻击范围内一名友方干员治疗相当于50%伤害的生命值".
 *
 * The official trait is a buff ON the operator that fires on ON_AFTER_OUTPUT_DAMAGE — buff_template_data `vendla_tr`,
 * `reed2_tr` and `titi_tr` all are (`IsDamage` → `AssignDamageValueToBlackboard` → heal through an ability selector),
 * i.e. the heal follows EVERY damage the operator deals, not only a normal attack. The 咒愈师 skills that damage without
 * an attack say so themselves: 焰影苇草 S2 "每1.5秒对一名敌人造成…法术伤害并仅对该干员触发焰影苇草特性", 刺玫 S2
 * "…造成攻击力20%的法术伤害并仅对该角色触发刺玫特性" — the official text only makes sense if damage (not an attack)
 * triggers the trait.
 *
 * The sim used to heal from the attack path only (`profile.afterHit`, ai.js), so 缇缇's per-second 凝固的时光 ticks and
 * every other non-attack damage healed nothing. A damage instance may name the one ally it triggers for
 * (`DamageInfo.traitAlly`, the skills' "仅对该角色/干员触发特性"): the heal then goes to that operator instead of the
 * lowest-HP ally in range.
 */
const installIncantation = (battle, unit) => {
  battle.on('damaged', (c) => {
    const t = c.target;
    if (c.source !== unit || !unit.alive || !t || t.side !== 'enemy' || !(c.amount > 0)) return;
    // a gauge fill (元素损伤) removes no HP and is not "伤害" for the heal; a 流失 is not damage dealt either
    if (c.type === 'element' || c.type === 'elemental') return;
    const ally = (c.dmg && c.dmg.traitAlly) || battle.lowestHpAllyInRange(unit);
    if (ally) battle.heal(unit, ally, c.amount * (unit.profile.healRatio ?? 0.5), { tags: ['incantation'] });
  }, { owner: unit });
};

const installHpDrain = (battle, unit) => {
  battle.every(1, () => {
    if (!unit.alive || !unit.deployed) return;
    const loss = unit.s.maxHp * (unit.profile.hpDrain ?? 0.03);
    // non-lethal: the drain never knocks the operator out on its own
    if (unit.hp - loss < 1) unit.hp = Math.min(unit.hp, 1);
    else battle.loseHp(unit, loss, { source: unit, silent: true });
  }, { owner: unit });
};

const installMerchant = (battle, unit) => {
  const iv = unit.profile.merchantInterval ?? 3;
  const cost = unit.profile.merchantCost ?? 3;
  battle.every(iv, () => {
    if (!unit.alive || !unit.deployed) return;
    const pl = battle.getPlayer(unit.ownerId);
    if (!pl) return;
    // `merchantPay` { unit, cost, cancel }: content may change the payment or waive it (cancel)
    const ctx = battle.hasHook('merchantPay') ? battle.emit('merchantPay', { unit, cost, cancel: false }) : null;
    if (!unit.alive || !unit.deployed || (ctx && ctx.cancel)) return;
    const c = ctx && Number.isFinite(ctx.cost) ? Math.max(0, ctx.cost) : cost;
    if (pl.dp >= c) battle.addDp(unit.ownerId, -c);
    else battle.retreat(unit, { reason: 'merchant' });
  }, { owner: unit });
};

const installCharger = (battle, unit) => {
  battle.on('kill', (ctx) => {
    if (ctx.killer === unit && ctx.victim.side === 'enemy') battle.addDp(unit.ownerId, unit.profile.dpOnKill ?? 1);
  }, { owner: unit });
};

/**
 * 傀儡师 (dollkeeper) trait "受到致命伤时不撤退，切换成<替身>作战（替身阻挡数为0），持续20秒后自身再次替换<替身>" with the
 * branch rules of PRTS 分支特性信息 傀儡师: a lethal hit on the <本体> (one it survives with 不死 does not count: "受到足以致命的
 * 伤害且未持有不死的情况下" — a skill's / talent's own 不死 runs earlier, a running 坚固维式重锤 window just before this hook,
 * items/battle.js PRIO_UNDYING_HELD −99) starts a switch animation, after which the operator fights as its <替身> for the
 * trait's 20 s (bb duration) holding 阻回; then it switches back the same way. A switch animation clears the operator's
 * Buffs and resets its HP to the max of the form it switches to; during one the operator holds 不死, 无敌, 阻回, 禁疗, 孤立,
 * 强制缴械 and is immune to 眩晕 / 冻结 / 睡眠.
 * The 替身 blocks nothing from the start of the switch to it until the switch back starts; a lethal hit on it knocks the
 * operator out. Content may switch the operator at once (hook `dollSwitch` { unit, reason, done }: 归溟幽灵鲨 S2 "技能结束
 * 后立刻切换为<替身>"). A kit's `dollNoAttack` profile flag (归溟幽灵鲨, PRTS 特性备注 "<替身>不进行普通攻击") disarms the 替身
 * and keeps it from casting (the basic 技能策略 casts on an attack the 替身 never makes; [ASSUMED] every other rule — S1's
 * 技能范围 — likewise); 风丸's 替身 attacks (PRTS: "<替身>状态下可对空").
 * The form is the unit's model state (`unit.form` 'doll', snapshot.js unitInfo; fx 'substitute' / 'swap' / 'dollEnd' with
 * `form`, shared/protocol.js fxForm): the client draws the 替身 on the skeleton's *_B clips (render/units.js FORMS).
 * The 替身's max HP is the operator's own (PRTS: HP "重设…至最大值"; the trait blackboard's 替身 HP bonus `max_hp` is 0 for
 * both 傀儡师 — the elite PUM-Y module's +20 % aside — and 风丸's 纸偶 token has her max HP at every level), or its 替身
 * token's (风丸).
 * [ASSUMED]: a switch animation lasts DOLL_SWITCH (the skeletons' 1 s Start_B — the 替身 appearing — and Start_2 — the
 * 本体 back), also on a direct switch (`dollSwitch`); "清除自身一切Buff" ends the running skill and removes the statuses
 * (buffs with a catalogue `status`) — every other buff stays, the remake's bond / item / talent effects (buffs too)
 * and other units' timed buffs and shields alike; 无敌 is damage immunity only (as for every ally 无敌 here — PRTS's
 * "无法被不同阵营选中" is not modelled for it).
 */
export const DOLL_SWITCH = 1;
const DOLL_SWITCH_IMMUNE = new Set(['stun', 'freeze', 'sleep']);

const installDollkeeper = (battle, unit) => {
  // the 替身's max HP comes from the unit's own 替身 token (风丸 纸偶) for its selected skill / module (DESIGN §16); a
  // dollkeeper without one (归溟幽灵鲨) must not borrow another operator's token stats: its own max HP (header)
  const dollHpMul = () => {
    const tokId = (unit.def.tokens || []).map((t) => (typeof t === 'string' ? t : t?.tokenId)).find((t) => t && /shadow|doll/.test(t));
    const tok = tokId ? battle.data.getToken?.(tokId, unit.defId, unit.def?.loadout ?? null) : null;
    return tok && tok.stats.maxHp > 0 ? Math.max(0.05, tok.stats.maxHp / Math.max(1, unit.base.maxHp)) : 1;
  };
  const at = (extra) => ({ x: unit.x, y: unit.y, id: unit.id, ...extra });
  // a switch animation: "切换动画开始时会清除自身一切Buff" (header: the running skill and the statuses), then 1 s of 不死
  // (the fatal hook below) 无敌 阻回 禁疗 孤立 强制缴械 and 眩晕 / 冻结 / 睡眠 immunity (beforeStatus below). "切换途中重设自身
  // 生命至最大值": the HP is set to the max at the start (enter / leave) and again when the switch ends, so she always
  // leaves it at full HP — a lethal 流失 inside the switch (无敌 does not stop it, 不死 holds it at 1 HP: a later 阿戈尔
  // devour mark on her) used to leave her the 替身's 20 s at 1 HP (community report #2)
  const startSwitch = () => {
    const sk = unit.skill;
    if (sk && sk.active && sk.kind !== 'passive') sk.end('substitute');
    for (const b of unit.buffs.slice()) if (b.status) battle.removeBuff(unit, b);
    unit.trait.dollSwitching = true;
    const done = () => { unit.trait.dollSwitching = false; };
    const ended = () => {
      done();
      if (!unit.alive || !unit.deployed) return;
      unit.markDirty();
      unit.hp = unit.s.maxHp;
    };
    battle.addBuff(unit, {
      key: 'trait:dollSwitching', duration: DOLL_SWITCH, onExpire: ended, onRemove: done,
      // noHeal refuses another unit's heal; healFree is 禁疗 (damage.js: a self-heal is 0 too, regen excepted). The
      // window still ends at full HP — onExpire writes it, it does not heal.
      flags: { invulnerable: true, noSp: true, noHeal: true, healFree: true, isolated: true, disarm: true },
    });
  };
  const leave = () => {
    if (!unit.trait.doll) return;
    unit.trait.doll = false;
    unit.form = null;
    if (!unit.alive || !unit.deployed) return;
    startSwitch();
    unit.markDirty();
    unit.hp = unit.s.maxHp;
    battle.fx('swap', at({ form: null }));
    if (battle.hasHook('dollSwap')) battle.emit('dollSwap', { unit, form: null });
  };
  const enter = () => {
    if (unit.trait.doll || !unit.alive || !unit.deployed) return false;
    unit.trait.doll = true;
    startSwitch();
    const dur = DOLL_SWITCH + (unit.profile.dollDuration ?? 20);
    const mul = dollHpMul();
    battle.addBuff(unit, {
      key: 'trait:substitute', duration: dur, visible: true, onExpire: leave, onRemove: leave,
      mods: { blockCnt: -99, ...(mul !== 1 ? { hpMul: mul } : null) },
      // 阻回 for the whole form; a 替身 that makes no normal attack casts no skill either (header)
      flags: { noSp: true, ...(unit.profile.dollNoAttack ? { disarm: true, silence: true } : null) },
    });
    battle.releaseBlocked(unit);
    unit.form = 'doll';
    unit.markDirty();
    unit.hp = unit.s.maxHp;
    // `dur`: until the switch back (the client times the 替身's closing clip with it)
    battle.fx('substitute', at({ form: 'doll', dur }));
    // `dollSwap` { unit, form }: a switch started — to the 替身 ('doll') or back to the 本体 (null); not fired when she is
    // knocked out as the 替身 (不屈 rolls on both switches: PRTS 盟约记录 "切换<替身>与<本体>时")
    if (battle.hasHook('dollSwap')) battle.emit('dollSwap', { unit, form: 'doll' });
    return true;
  };
  battle.on('fatal', (ctx) => {
    if (ctx.unit !== unit || ctx.prevented) return;
    if (unit.trait.dollSwitching) { ctx.prevented = true; return; } // 不死 while switching (a 流失 ignores 无敌)
    if (unit.trait.doll) return;                                   // the 替身 is knocked out
    ctx.prevented = enter();
  }, { owner: unit, priority: -100 });
  battle.on('dollSwitch', (ctx) => { if (ctx.unit === unit && !ctx.done) ctx.done = enter(); }, { owner: unit });
  battle.on('beforeStatus', (ctx) => {
    if (ctx.target === unit && unit.trait.dollSwitching && DOLL_SWITCH_IMMUNE.has(ctx.status)) ctx.cancel = true;
  }, { owner: unit });
  battle.on('death', (ctx) => {
    if (ctx.unit !== unit) return;
    unit.trait.doll = false;
    unit.trait.dollSwitching = false;
    // knocked out as the 替身: its death clip has played (the 'die' event came first); the redeploy is the 本体 again
    if (unit.form) { unit.form = null; battle.fx('dollEnd', at({ form: null })); }
  }, { owner: unit });
};

const installLibrator = (battle, unit) => {
  // ATK ramps linearly to +rampMax (bb atk, default +200 %) over rampTime s (bb max_stack_cnt, default 40) while
  // the skill is inactive; blocks nothing while inactive; everything resets when the skill ends.
  const rampMax = unit.profile.rampMax ?? 2;
  const rampTime = unit.profile.rampTime ?? 40;
  const rampInit = Math.min(rampMax, unit.profile.rampInit ?? 0); // golden module: "部署后获得+100%加成" (init_atk)
  const applyBlock = () => {
    if (unit.skill?.active) battle.removeBuff(unit, 'trait:libratorBlock');
    else { battle.addBuff(unit, { key: 'trait:libratorBlock', mods: { blockCnt: -99 } }); battle.releaseBlocked(unit); }
  };
  unit.trait.ramp = 0;
  battle.every(1, () => {
    if (!unit.alive || !unit.deployed || unit.skill?.active) return;
    unit.trait.ramp = Math.min(rampMax, unit.trait.ramp + rampMax / rampTime);
    battle.addBuff(unit, { key: 'trait:libratorRamp', mods: { atkPct: unit.trait.ramp } });
  }, { owner: unit });
  const applyRamp = () => {
    if (unit.trait.ramp > 0) battle.addBuff(unit, { key: 'trait:libratorRamp', mods: { atkPct: unit.trait.ramp } });
    else battle.removeBuff(unit, 'trait:libratorRamp');
  };
  battle.on('deploy', (ctx) => { if (ctx.unit === unit) { unit.trait.ramp = rampInit; applyRamp(); applyBlock(); } }, { owner: unit });
  battle.on('skillStart', (ctx) => { if (ctx.unit === unit) applyBlock(); }, { owner: unit });
  battle.on('skillEnd', (ctx) => {
    if (ctx.unit !== unit) return;
    unit.trait.ramp = 0;
    applyRamp();
    applyBlock();
  }, { owner: unit });
};

const installPhalanx = (battle, unit) => {
  const apply = () => {
    if (unit.skill?.active) battle.removeBuff(unit, 'trait:phalanxGuard');
    else battle.addBuff(unit, { key: 'trait:phalanxGuard', mods: { defPct: unit.profile.guardDef ?? 2, resFlat: unit.profile.guardRes ?? 20 } });
  };
  battle.on('deploy', (ctx) => { if (ctx.unit === unit) apply(); }, { owner: unit });
  battle.on('skillStart', (ctx) => { if (ctx.unit === unit) apply(); }, { owner: unit });
  battle.on('skillEnd', (ctx) => { if (ctx.unit === unit) apply(); }, { owner: unit });
};

const installBearer = (battle, unit) => {
  battle.on('skillStart', (ctx) => {
    if (ctx.unit === unit) { battle.addBuff(unit, { key: 'trait:bearer', mods: { blockCnt: -99 } }); battle.releaseBlocked(unit); }
  }, { owner: unit });
  battle.on('skillEnd', (ctx) => { if (ctx.unit === unit) battle.removeBuff(unit, 'trait:bearer'); }, { owner: unit });
};

const installStalker = (battle, unit) => {
  const p = unit.profile.dodge ?? 0.5;
  battle.addBuff(unit, { key: 'trait:stalker', mods: { dodgePhys: p, dodgeArts: p, taunt: -1 }, persist: true, allowDead: true });
};

const installHunter = (battle, unit) => {
  const max = unit.profile.ammoMax ?? 8;
  unit.trait.ammo = max;
  unit.trait.reloadAcc = 0;
  battle.on('tick', (ctx) => {
    if (!unit.alive || !unit.deployed) return;
    if (battle.time - unit.lastAttackAt >= 1 && unit.trait.ammo < max) {
      unit.trait.reloadAcc += ctx.dt;
      if (unit.trait.reloadAcc >= 1) { unit.trait.reloadAcc -= 1; unit.trait.ammo++; }
    } else unit.trait.reloadAcc = 0;
  }, { owner: unit });
  battle.on('deploy', (ctx) => { if (ctx.unit === unit) unit.trait.ammo = max; }, { owner: unit });
};

/**
 * 回环射手 (loopshooter) trait "持有回旋投射物时才能够攻击（投射物需要时间回收）": its projectile is a boomerang that
 * flies to the target, hits on arrival and flies back to the thrower (ai.js throwBoomerang, speeds in constants.js);
 * the thrower attacks only while it holds its boomerang — every one it threw must be caught first (PRTS 跃跃 S2 note
 * "必须回收全部回旋投掷物才可以进行下一次攻击") — and once its attack cooldown is ready, so the real interval is the longer
 * of the two ("实际攻击间隔会受投掷物的实际飞行时间影响产生浮动"). A (re)deployed thrower holds a fresh one.
 */
const installLoopshooter = (battle, unit) => {
  unit.trait.boomerangsOut = 0;
  battle.on('deploy', (ctx) => { if (ctx.unit === unit) unit.trait.boomerangsOut = 0; }, { owner: unit });
};

const installTactician = (battle, unit) => {
  const spawn = () => {
    if (!unit.alive || !unit.deployed) return;
    if (unit.trait.reinforcement && unit.trait.reinforcement.alive) return;
    const tile = battle.findTacticalPoint(unit);
    if (!tile) return;
    unit.trait.reinforcement = battle.spawnToken(unit, 'token_tactician_reinforce', tile[0], tile[1], {
      def: {
        name: '援军', stats: {
          maxHp: unit.base.maxHp * 0.7, atk: unit.base.atk * 0.5, def: unit.base.def, magicResistance: 0,
          blockCnt: 1, baseAttackTime: 1.2, attackSpeed: 100, respawnTime: 999, cost: 0,
        }, rangeGrid: [[0, 0]], dmgType: 'phys', attackKind: 'melee', profession: 'TOKEN',
      },
    });
  };
  battle.on('deploy', (ctx) => { if (ctx.unit === unit) spawn(); }, { owner: unit });
};

const installFunnel = (battle, unit) => {
  unit.trait.funnelTarget = null;
  unit.trait.funnelScale = unit.profile.funnel?.init ?? 0.2;
};

/**
 * 秘术师 (mystic) trait "攻击造成法术伤害，在找不到攻击目标时可以将攻击能量储存起来之后一齐发射（最多3个）" (bb times; 深靛's
 * MSC-X 4) with the branch rules of PRTS 分支特性信息 秘术师: "能量储存与攻击占用相同的攻击间隔：在进行攻击判定时，若范围内存在
 * 有效目标，则进行普通攻击；若无有效目标且能量储存数未满，则改为储存一份攻击能量（属于攻击行为）；仅没有有效目标，且能量储存数已满的
 * 情况下才进入待机状态". The attack loop (ai.js updateAlly) calls the profile's `storeEnergy` at its attack check — the attack
 * ready, the unit able to act and not disarmed (PRTS 异常效果 缴械 "秘术师储存能量同样无法进行") — when it finds no valid target
 * (no target, or the profile's `canAttack` false: a 秘术师 kit's own target rule — 深靛 never picks a bound enemy, so a bind
 * on her only target is no valid target); a stored energy restarts the attack interval, a full store idles (the next
 * valid target is attacked at once). The energies leave with the next attack that happens (`releaseEnergy`, called by
 * performAttack after `beforeAttack`: "攻击被打断且弹道未能成功生成的情况下，储存的能量不会被消耗") with its main target and land
 * with its main hit, one damage instance each (`hitsFn`; "由储存能量形成的弹道造成攻击力100%的法术普通伤害" — each as the
 * main hit). [ASSUMED] a redeployment holds no energy (a free move — 乌尔比安 S3 — keeps them). Kits with their own store
 * (维伊's 转置能量, 黑键's elite energies) replace `storeEnergy` and release theirs from an `attack` hook.
 */
const installMystic = (battle, unit) => {
  unit.trait.stored = 0;
  battle.on('deploy', (ctx) => { if (ctx.unit === unit && !ctx.move) unit.trait.stored = 0; }, { owner: unit });
};

/** Refresh period / lifetime (s) of a bard trait's 生命回复速度 buff: it lapses within BARD_REGEN_DUR once the bard stops. */
export const BARD_REGEN_IV = 0.25;
export const BARD_REGEN_DUR = 0.5;

/**
 * 吟游者 trait "不攻击，持续恢复范围内所有友军生命（每秒相当于自身攻击力10%的生命）": PRTS 分支特性信息 吟游者 "特性为基于自身攻击力
 * 来增加受益者的“生命回复速度”属性" — an hpRegen buff of `value` (the bard's ATK × ratio) on `ally`, one per bard (two bards
 * add up), which the caller refreshes before it lapses (`duration`, default BARD_REGEN_DUR). No heal: 禁疗 and 无法被友方
 * 治疗 (收割者 / 不屈者 / 武者 noHeal) do not stop it — PRTS 异常效果 禁疗 "增减生命回复速度…的效果不会被识别为治疗类能力"; the
 * regeneration tick is the ally's own (damage.js heal `regen`, no 治疗加成). The `bardRegen` hook { unit (the bard),
 * target, value } may scale one ally's share (魔王's 微尘: "使该干员受到魔王特性效果提升至1.5倍"). Also the 海嗣 range of
 * 浊心斯卡蒂 (content/tokens.js, kits/ops/chess_char_6_04-skadi2.js).
 */
export function bardRegen(battle, bard, ally, value, duration = BARD_REGEN_DUR) {
  if (!bard || !ally || !ally.alive || !(value > 0)) return;
  let v = value;
  if (battle.hasHook('bardRegen')) v = num(battle.emit('bardRegen', { unit: bard, target: ally, value: v }).value, 0);
  if (v > 0) battle.addBuff(ally, { key: `trait:bard:${bard.id}`, duration, source: bard, mods: { hpRegen: v } });
}

const installBard = (battle, unit) => {
  battle.every(BARD_REGEN_IV, () => {
    // Continuous regeneration is an aura, so stun does not stop it.
    if (!unit.alive || !unit.deployed || unit.hidden) return;
    const v = unit.s.atk * (unit.profile.auraRatio ?? 0.1);
    for (const ally of battle.alliesInGrid(unit)) bardRegen(battle, unit, ally, v);
  }, { owner: unit });
};

const installSkywalker = (battle, unit) => {
  battle.addBuff(unit, { key: 'trait:skywalker', flags: { blockFly: true }, persist: true, allowDead: true });
};

/** Target's tile offset from the unit in the unit's facing-RIGHT frame ([dRow, dCol], sim/dir.js toLocal). */
/** The target (its body: a huge enemy's every tile — body.js) on a tile of `grid` around the unit (its facing frame). */
const inTraitGrid = (unit, target, grid) => bodyInKeys(target, absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, 0));

/**
 * 'reaperrange' default front test: the target stands on the unit's own line, at or ahead of it along its facing — a
 * huge enemy when any tile of its body does (body.js).
 */
const onFrontLine = (unit, target) => {
  const [fr, fc] = unit.fwd;
  const lateral = (r, c) => toLocal(r - unit.tileR, c - unit.tileC, unit.dir)[0];
  if (!target.hitArea) {
    return lateral(Math.round(target.y), Math.round(target.x)) === 0 && (target.x - unit.x) * fc + (target.y - unit.y) * fr >= 0;
  }
  for (const k of bodyKeys(target)) {
    const r = Math.floor(k / COLS), c = k % COLS;
    if (lateral(r, c) === 0 && (c - unit.tileC) * fc + (r - unit.tileR) * fr >= 0) return true;
  }
  return false;
};

// --------------------------------------------------------------------------------------------------------------
// subprofession table

export const SUB = Object.freeze({
  // --- SNIPER
  fastshot: P({ priority: 'fly', dmgMul: (b, u, t) => (t.isFlying ? (u.profile.flyScale ?? 1) : 1) }),
  closerange: P({}),
  longrange: P({ priority: 'lowDef' }),
  aoesniper: P({ splashRadius: 1.1, projectile: 'bomb' }),
  // PRTS 溅射半径一览 (特性): 投掷手 0.9, 扩散术师 1.1 (格雷伊 1.0, TUNE below), 链术师 1.7 jumps; 炮手 1.0 (none in the pool)
  bombarder: P({ splashRadius: 0.9, projectile: 'bomb', groundOnly: true, canHitFly: false,
    afterHit: (battle, unit, target, info) => {
      // aftershocks: (times − 1) extra hits at append_atk_scale × ATK (default one hit at 50 %)
      const n = Math.max(1, (unit.profile.shockTimes ?? 2) - 1);
      for (let i = 1; i <= n; i++) {
        battle.after(0.3 * i, () => {
          for (const e of battle.foesInRadius(info.x, info.y, unit.profile.splashRadius || 1, true)) { // splash: 中点判定
            if (e.isFlying) continue;
            battle.dealDamage(unit, e, { amount: unit.s.atk * (unit.profile.shockScale ?? 0.5), type: 'phys', isSplash: true, tags: ['aftershock'] });
          }
        });
      }
    } }),
  hunter: P({ install: installHunter,
    canAttack: (battle, unit) => (unit.trait.ammo ?? 8) > 0,
    dmgMul: (b, u) => u.profile.ammoScale ?? 1.2,
    afterAttack: (battle, unit) => { unit.trait.ammo = Math.max(0, (unit.trait.ammo ?? 8) - 1); } }),
  loopshooter: P({ projectile: 'boomerang', boomerang: true, install: installLoopshooter,
    canAttack: (battle, unit) => !(unit.trait.boomerangsOut > 0) }),
  reaperrange: P({ allInRange: true,
    dmgMul: (battle, unit, target) => {
      const grid = unit.profile.frontGrid;
      const front = grid ? inTraitGrid(unit, target, grid) : onFrontLine(unit, target);
      return front ? (unit.profile.frontScale ?? 1.5) : 1;
    } }),
  // --- CASTER
  // "群体法术伤害" names two shapes: the 扩散术师 splash 1.1 tiles around the struck target (PRTS 溅射半径一览; Arknights
  // Terra Wiki, Splash Caster), while the 轰击术师 ("超远距离的群体法术伤害") and the 阵法术师 strike every enemy inside the
  // attack range at once, the same damage near and far — community report E3 after 0.1.0. Primary for the 轰击术师: PRTS
  // 作战机制 §AOE伤害判定 names 伊芙利特's 炎爆 a 锁定攻击范围 AoE, and 炎爆 is her next-attack skill ("下次攻击造成…",
  // PRTS 伊芙利特 S2); for the 阵法术师: Terra Wiki, Phalanx Caster (secondary) and PRTS 林 S3 备注. PRTS 溅射半径一览
  // documents no splash radius for either (supporting only: it omits the 撼地者 too)
  splashcaster: P({ splashRadius: 1.1 }),
  blastcaster: P({ rangeAoe: true }),
  chain: P({ chain: { count: 3, falloff: 0.15, radius: CHAIN_RADIUS, sluggish: 0.5 } }),
  funnel: P({ projectile: 'drone', install: installFunnel,
    dmgMul: (battle, unit, target) => {
      const f = unit.profile.funnel || { init: 0.2, delta: 0.15, max: 1.1 };
      if (unit.trait.funnelTarget === target.id) unit.trait.funnelScale = Math.min(f.max, (unit.trait.funnelScale ?? f.init) + f.delta);
      else { unit.trait.funnelTarget = target.id; unit.trait.funnelScale = f.init; }
      return unit.trait.funnelScale;
    } }),
  mystic: P({ install: installMystic,
    storeEnergy: (battle, unit) => {
      const n = unit.trait.stored ?? 0;
      if (n >= (unit.profile.storeMax ?? 3)) return false;
      unit.trait.stored = n + 1;
      return true;
    },
    releaseEnergy: (battle, unit) => { const n = unit.trait.stored ?? 0; unit.trait.stored = 0; return n; },
    hitsFn: (battle, unit, info) => 1 + (info?.energy ?? 0) }),
  phalanx: P({ noAttackUnlessSkill: true, rangeAoe: true, install: installPhalanx }),
  primcaster: P({}),
  corecaster: P({}),
  // --- MEDIC
  physician: P({ heal: { mode: 'single' } }),
  ringhealer: P({ heal: { mode: 'multi', count: 3 } }),
  chainhealer: P({ heal: { mode: 'chain', count: 3, falloff: 0.25 } }),
  healer: P({ heal: { mode: 'single', farMul: 0.8, nearDist: 2 } }),
  wandermedic: P({ heal: { mode: 'single', elementHealRatio: 0.5 } }),
  incantationmedic: P({ dmgType: 'arts', projectile: 'bolt', heal: null, install: installIncantation }),
  // --- SUPPORT
  slower: P({ onHitStatus: { key: 'sluggish', duration: 0.8 } }),
  underminer: P({}),
  bard: P({ noAttack: true, dmgType: 'heal', heal: null, install: installBard }),
  ritualist: P({}),
  craftsman: P({ attack: 'melee', dmgType: 'phys', projectile: 'none', canHitFly: false }),
  summoner: P({}),
  // --- TANK
  protector: P({}),
  guardian: P({}),
  shotprotector: P({ attack: 'ranged', canHitFly: true, projectile: 'arrow' }),
  primprotector: P({}),
  unyield: P({ noHeal: true }),
  duelist: P({}),
  fortress: P({ fortress: true, splashRadius: 1.0, projectile: 'bomb', canHitFly: false, groundOnly: true }),
  // --- WARRIOR
  centurion: P({ hitAllBlocked: true }),
  crusher: P({ hitAllBlocked: true }),
  fearless: P({}),
  fighter: P({}),
  hammer: P({ splashRadius: 1.0, splashScale: 0.5, splashOthersOnly: true }),
  instructor: P({ dmgMul: (battle, unit, target) => (target.blockedBy === unit ? 1 : (unit.profile.unblockedScale ?? 1.2)) }),
  librator: P({ noAttackUnlessSkill: true, install: installLibrator }),
  lord: P({ canHitFly: true,
    dmgMul: (battle, unit, target) => {
      if (target.blockedBy === unit) return 1;
      const [fr, fc] = frontOf(unit.tileR, unit.tileC, unit.dir);
      return bodyOnTile(target, unit.tileR, unit.tileC) || bodyOnTile(target, fr, fc) ? 1 : (unit.profile.rangedScale ?? 0.8);
    } }),
  musha: P({ noHeal: true, install: installMushaHeal }),
  reaper: P({ noHeal: true, allInRange: true, install: installReaperHeal }),
  sword: P({ hits: 2 }),
  artsfghter: P({ dmgType: 'arts' }),
  swordmaster: P({ hits: 2 }),
  // --- PIONEER
  pioneer: P({}),
  charger: P({ install: installCharger }),
  tactician: P({ install: installTactician,
    dmgMul: (battle, unit, target) => (unit.trait.reinforcement && target.blockedBy === unit.trait.reinforcement ? (unit.profile.reinforceScale ?? 1.5) : 1) }),
  agent: P({ canHitFly: true }),
  counsellor: P({}),
  bearer: P({ install: installBearer }),
  // --- SPECIAL
  alchemist: P({ attack: 'ranged', canHitFly: true, projectile: 'lob' }),
  dollkeeper: P({ install: installDollkeeper }),
  executor: P({}),
  geek: P({ install: installHpDrain }),
  hookmaster: P({ canHitFly: true }),
  merchant: P({ install: installMerchant }),
  pusher: P({ hitAllBlocked: true }),
  skywalker: P({ canHitFly: true, blockFly: true, install: installSkywalker }),
  stalker: P({ allInRange: true, install: installStalker }),
  traper: P({ attack: 'ranged', canHitFly: false, projectile: 'none' }),
});

/**
 * Trait tunables per subprofession, read from the trait text and the trait blackboard (`def.traitBb`, data
 * `trait.bb`; elites include their module upgrade). Returns profile overrides.
 */
const TUNE = {
  fastshot: (tb) => ({ flyScale: num(tb.atk_scale, 1) }),
  bombarder: (tb) => ({ shockScale: num(tb['attack@append_atk_scale'], 0.5), shockTimes: num(tb['attack@times'], 2) }),
  // PRTS 溅射半径一览 特殊: 格雷伊 1.0 (the branch's 1.1 otherwise)
  splashcaster: (tb, def) => ((def.charId ?? def.raw?.charId) === 'char_253_greyy' ? { splashRadius: 1.0 } : {}),
  hunter: (tb) => ({ ammoMax: num(tb.value, 8), ammoScale: num(tb.atk_scale, 1.2) }),
  reaperrange: (tb, def) => ({ frontScale: num(tb.atk_scale, 1.5), frontGrid: def.raw?.trait?.rangeGrid ?? null }),
  funnel: (tb) => ({ funnel: { init: num(tb.init_atk_scale, 0.2), delta: num(tb.delta_atk_scale, 0.15), max: num(tb.max_atk_scale, 1.1) } }),
  mystic: (tb) => ({ storeMax: num(tb.times, 3) }),
  phalanx: (tb) => ({ guardDef: num(tb.def, 2), guardRes: num(tb.magic_resistance, 20) }),
  healer: (tb, def, p) => ({ heal: { ...p.heal, farMul: num(tb.heal_scale, 0.8) } }),
  wandermedic: (tb, def, p) => ({ heal: { ...p.heal, elementHealRatio: num(tb.ep_heal_ratio, 0.5) } }),
  incantationmedic: (tb) => ({ healRatio: num(tb.scale, 0.5) }),
  chainhealer: (tb, def, p) => {
    const o = { ...p.heal };
    const m = String(def.trait || '').match(/在(\d+)个友方单位间跳跃/);
    if (m) o.count = +m[1];
    const f = String(def.trait || '').match(/治疗量降低(\d+)%/);
    if (f) o.falloff = +f[1] / 100;
    if (tb['attack@chain.max_target'] != null) o.count = num(tb['attack@chain.max_target'], o.count);
    if (tb['attack@chain.atk_scale'] != null) o.falloff = 1 - num(tb['attack@chain.atk_scale'], 1 - o.falloff);
    return { heal: o };
  },
  ringhealer: (tb, def, p) => ({ heal: { ...p.heal, count: /同时恢复三个|同时恢复3个/.test(String(def.trait || '')) ? 3 : (p.heal.count ?? 3) } }),
  chain: (tb, def, p) => {
    const o = { ...p.chain };
    const m = String(def.trait || '').match(/在(\d+)个敌人间跳跃/);
    if (m) o.count = +m[1];
    const f = String(def.trait || '').match(/伤害降低(\d+)%/);
    if (f) o.falloff = +f[1] / 100;
    if (tb['attack@max_target'] != null) o.count = num(tb['attack@max_target'], o.count);
    if (tb['attack@sluggish'] != null) o.sluggish = num(tb['attack@sluggish'], o.sluggish);
    if (tb['attack@chain.atk_scale'] != null) o.falloff = 1 - num(tb['attack@chain.atk_scale'], 1 - o.falloff);
    return { chain: o };
  },
  slower: (tb) => ({ onHitStatus: { key: 'sluggish', duration: num(tb.sluggish, 0.8) } }),
  underminer: (tb) => (tb.atk != null && tb.duration != null ? { onHitStatus: { key: 'weaken', duration: num(tb.duration, 2), value: Math.abs(num(tb.atk, 0.1)) } } : {}),
  bard: (tb) => ({ auraRatio: num(tb['attack@atk_to_hp_recovery_ratio'], 0.1) }),
  hammer: (tb) => ({ splashScale: num(tb['attack@atk_scale_2'], 0.5), splashRadius: num(tb['attack@ability_range_radius'], 1) }),
  instructor: (tb) => ({ unblockedScale: num(tb.atk_scale, 1.2) }),
  librator: (tb) => ({ rampMax: num(tb.atk, 2), rampTime: num(tb.max_stack_cnt, 40), rampInit: num(tb.init_atk, 0) }),
  lord: (tb) => ({ rangedScale: num(tb.atk_scale, 0.8) }),
  musha: (tb) => ({ selfHeal: num(tb.value, 50) }),
  reaper: (tb) => ({ selfHeal: num(tb.value, 50) }),
  charger: (tb) => ({ dpOnKill: num(tb.cost, 1) }),
  tactician: (tb) => ({ reinforceScale: num(tb.atk_scale, 1.5) }),
  dollkeeper: (tb) => ({ dollDuration: num(tb.duration, 20) }),
  geek: (tb) => ({ hpDrain: num(tb.hp_ratio, 0.03) }),
  merchant: (tb) => ({ merchantInterval: num(tb.interval, 3), merchantCost: Math.abs(num(tb.cost, -3)) }),
  stalker: (tb) => ({ dodge: num(tb.prob, 0.5) }),
};

const PRIORITY_ALIASES = {
  FLY_FIRST: 'fly', fly: 'fly', LOW_DEF: 'lowDef', lowDef: 'lowDef', lowestDef: 'lowDef', RANGED: 'ranged', ranged: 'ranged',
  lowestHp: 'lowestHp', highestHp: 'highestHp', nearest: 'nearest', farthest: 'farthest',
};

/**
 * Resolve the attack profile of a unit def. `kitTrait` (optional) overrides everything.
 * @returns {object} mutable profile
 */
export function resolveProfile(def, kitTrait = null) {
  const prof = PROFESSION_DEFAULTS[def.profession] || PROFESSION_DEFAULTS.WARRIOR;
  const sub = (def.subProf && SUB[def.subProf]) || {};
  const tb = def.traitBb || {};
  const p = {
    sub: def.subProf || null,
    attack: 'melee', dmgType: 'phys', projectile: 'none', canHitFly: false, maxTargets: 1,
    hitAllBlocked: false, allInRange: false, splashRadius: 0, splashScale: 1, splashOthersOnly: false,
    groundOnly: false, hits: 1, chain: null, heal: null, priority: null, noAttack: false,
    noAttackUnlessSkill: false, noHeal: false, blockFly: false,
    ...prof, ...sub, tb,
  };
  const tune = def.subProf && TUNE[def.subProf];
  if (tune) Object.assign(p, tune(tb, def, p));
  // data-provided fields (build-data parsed them from trait text) take precedence over table defaults,
  // except for 'none' (no normal attack: phalanx/librator/bard) and 'heal' kinds whose attack shape stays table-defined.
  const ak = def.attackKind ? String(def.attackKind).toLowerCase() : null;
  if (def.dmgType) p.dmgType = def.dmgType;
  if (ak === 'ranged' || ak === 'melee') {
    p.attack = ak;
    if (def.projectile) p.projectile = def.projectile;
    if (def.canHitFly != null) p.canHitFly = !!def.canHitFly;
    else p.canHitFly = p.attack === 'ranged' || p.canHitFly;
  } else if (ak === 'heal') {
    p.attack = 'ranged';
    p.dmgType = 'heal';
  } else if (ak === 'none') {
    if (!p.noAttack && !p.noAttackUnlessSkill) p.noAttackUnlessSkill = true;
  }
  if (def.targetPriority) p.priority = PRIORITY_ALIASES[def.targetPriority] ?? def.targetPriority;
  if (def.splashRadius != null && def.splashRadius > 0) p.splashRadius = def.splashRadius;
  // a boomerang thrower (回环射手) always throws its boomerang: the data's generic ranged projectile ('arrow', a
  // build-data default) would turn the out-and-back flight into a plain shot
  if (p.boomerang && p.attack === 'ranged') p.projectile = 'boomerang';
  if (def.type === 'token') {
    if (p.dmgType === 'heal') p.heal = p.heal || { mode: 'single' };
    if (def.stats.atk <= 0) p.noAttack = true;
  }
  if (p.dmgType === 'heal' && !p.heal && !p.noAttack) p.heal = { mode: 'single' };
  if (p.dmgType !== 'heal' && p.heal) p.heal = null;
  if (p.dmgType === 'none') p.noAttack = true;
  // a 要塞 (fortress) branch throws ground-only splash: the data's generic ranged default would let it hit FLY enemies
  if (p.fortress || p.groundOnly) { p.canHitFly = false; p.groundOnly = true; }
  if (kitTrait) Object.assign(p, kitTrait);
  // a 锁定攻击范围 AoE (阵法术师, 轰击术师) strikes every enemy on its range and has no projectile: they are struck at the
  // same moment ('beam' = instant hits, drawn as a line to each victim — PRTS 作战机制 "在攻击前摇结束时选取范围内的全体
  // 目标，同时造成伤害"); the data's generic ranged projectile ('bolt') would land them one by one
  if (p.rangeAoe) {
    p.allInRange = true;
    if (p.attack === 'ranged') p.projectile = 'beam';
  }
  return p;
}

/** Every subProfessionId with a specific behaviour (used by tests to check coverage). */
export const KNOWN_SUBPROFESSIONS = Object.freeze(Object.keys(SUB));
