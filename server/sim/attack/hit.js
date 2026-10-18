// HP-damage pipeline: hit → dodge → mitigation → limit → shields → hpDamage → final HP application.
import { sleepBlocks, liftoffEvades } from './helpers.js';
import { leaderHitCancelled, applyHpLoss } from './health.js';
import { applyElement } from './element.js';

export { mitigate } from './calculation.js';
import { calculateDamage, officialExpectedAmount } from './calculation.js';

/**
 * Absorb damage with shields on `target`. Returns the remaining amount. `type` = the damage type: a shield buff with a
 * `shieldType` absorbs only that type (夜莺 S2 "屏障能吸收…法术伤害") — or, a list of types, only those (机械师's 屏障:
 * BlockDamage PHYSICAL_AND_MAGICAL, buff_template_data mcnist_t_2 / mcnist_s_2_shield: ['phys', 'arts']); one without
 * absorbs every type (PRTS 术语释义 屏障 "若无特殊说明，屏障可吸收全种类伤害"). Older shields first (buff order:
 * "优先消耗先生成的屏障").
 */
export function absorbShields(battle, target, amount, type = null) {
	if (amount <= 0) return 0;
	let changed = false;
	let rest = amount;
	const absorbs = (b) => !b.shieldType || (Array.isArray(b.shieldType) ? b.shieldType.includes(type) : b.shieldType === type);
	for (let i = 0; i < target.buffs.length && rest > 0; i++) {
		const b = target.buffs[i];
		if (b.shieldHits > 0 && absorbs(b)) {
			b.shieldHits--;
			rest = 0;
			if (b.shieldHits <= 0 && !(b.shield > 0) && !b.mods && !b.flags) { battle._removeBuffAt(target, i); i--; }
			changed = true;
			break;
		}
	}
	for (let i = 0; i < target.buffs.length && rest > 0; i++) {
		const b = target.buffs[i];
		if (b.shield > 0 && absorbs(b)) {
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
 * Official red-number test (PRTS 作战机制 「伤害红字（暴击）」, https://prts.wiki/w/作战机制).
 * A red integer is shown when 最终伤害 ≥ 期望伤害 × 1.5. `1e-9` only absorbs a binary rounding crumb.
 * 0 ≥ 0 × 1.5 is red: an invulnerable hit still shows red 0 in the official client. This function reports that;
 * `dealDamage` does not emit a new event for it (a new `dmg` tuple would change golden counts and play an impact).
 * @returns {'r'|null}
 */
export function officialDamageMark(finalAmount, expectedAmount) {
	const fin = Number.isFinite(finalAmount) ? Math.max(0, finalAmount) : 0;
	const exp = Number.isFinite(expectedAmount) ? Math.max(0, expectedAmount) : 0;
	return fin + 1e-9 >= exp * 1.5 ? 'r' : null;
}

/** Source stats for a display-only dodge classification. Reading `source.s` while dirty rescales HP (units.js). */
function peekStats(unit) {
	if (!unit) return null;
	return unit._dirty ? (unit._s || null) : unit.s;
}

/**
 * Full damage pipeline. Returns HP actually removed, or gauge gain for element damage (0 when refused).
 */
export function resolveDamage(battle, ctx) {
	const { source, credit, target, dmg } = ctx;
	if (!target || !target.alive || target.removed || target.hidden || !target.deployed) return 0;
	if (dmg.type === 'element') return applyElement(battle, ctx);
	// 无来源 (dmg.sourceless, element bursts): hooks see no source — nothing keyed on "damage dealt by X" (ATK-up vs a
	// tag, 伤害提升 items / bonds / modules, reflect, "受到来自…的伤害") can recognise it; `credit` names the unit that still
	// gets the stats and the kill (PRTS 伤害分类 无来源 ③)
	const hs = source;
	let ts = target.s;
	if (ts.flags.invulnerable || sleepBlocks(target, hs, dmg) || liftoffEvades(target, hs, dmg)) return 0;
	if (battle._hooks.hit) {
		battle.emit('hit', { source: hs, target, dmg, credit });
		if (dmg.cancel || !target.alive || !target.deployed) return 0;
		if (dmg.type === 'element') return applyElement(battle, ctx);
		ts = target.s; // handlers may have changed the target's buffs (fragile, invulnerable, dodge…): never use stale stats
		if (ts.flags.invulnerable || sleepBlocks(target, hs, dmg)) return 0;
	}
	const type = dmg.type;
	// dodge. The yellow MISS (PRTS: a hit that would have been red, dodged) is classified after the existing roll
	// and does not roll again. Source stats are peeked so a dirty attacker is not refreshed just to label the dodge.
	const dodgeMode = dmg.dodgeMode ?? (dmg.canDodge ? 'normal' : 'ignore');
	if (dodgeMode !== 'ignore' && (type === 'phys' || type === 'arts')) {
		const p = type === 'phys' ? ts.dodgePhys : ts.dodgeArts;
		if (p > 0 && battle.rng() < p) {
			const peeked = peekStats(source);
			const red = officialDamageMark(calculateDamage(dmg, type, ts, peeked, target), officialExpectedAmount(dmg, type, ts, target)) === 'r';
			battle.fx('dodge', red
				? { x: target.x, y: target.y, id: target.id, num: 'm' }
				: { x: target.x, y: target.y, id: target.id });
			if (battle._hooks.dodge) battle.emit('dodge', { source, target, dmg, credit, cancelled: dodgeMode !== 'uncancellable' });
			if (dodgeMode !== 'uncancellable') return 0;
		}
	}
	// 频次 units (flags hitCount / hitCountArts): every damage instance removes exactly 1 HP (maxHp = hits needed);
	// hitCountArts ignores physical instances. The instance keeps its own DamageInfo, so `damaged` handlers still
	// recognise their own (tagged) damage — never re-create such a loss with a fresh dealHPLose.
	// The red test compares that 1 (or 0) with the ordinary expected damage: 特殊生命值机制均不考虑 on the expected side.
	if (ts.flags.hitCount || ts.flags.hitCountArts) {
		const counts = !(ts.flags.hitCountArts && !ts.flags.hitCount && type === 'phys');
		const instance = counts ? 1 : 0;
		const mark = officialDamageMark(instance, officialExpectedAmount(dmg, type, ts, target));
		return applyHpLoss(battle, ctx, absorbShields(battle, target, instance, type), mark);
	}
	// 无来源 damage (element bursts) takes nothing from its source's stats; the source still gets the credit below
	const ss = source ? source.s : null;
	let final = calculateDamage(dmg, type, ts, ss, target);
	// The 1.5× test uses this pre-shield total. The integer on the dmg event is whatever remains after shields and
	// hpDamage (PRTS can show a number that differs from the HP delta; [ASSUMED] the shown value stays that integer).
	if (battle._hooks.damageCalculated) {
		const calculated = { ...ctx, amount: final };
		battle.emit('damageCalculated', calculated);
		final = Number.isFinite(calculated.amount) ? Math.max(0, calculated.amount) : 0;
		if (dmg.cancel || !target.alive || !target.deployed) return 0;
	}
	const mark = officialDamageMark(final, officialExpectedAmount(dmg, type, ts, target));
	// 限伤: a leader's hit of ≥ BOSS_HIT_LIMIT in a boss / hidden battle is cancelled before it reaches shields / HP — what
	// ran before it (the attack, its SP, `hit` hook effects, separate element 损伤) stays; nothing after it happens
	if (final > 0 && leaderHitCancelled(battle, target, final)) return 0;
	final = absorbShields(battle, target, final, type);
	// 伤判效果 after the barriers (header): a handler may lower what reaches the HP — never raise it (a 流失 skips this)
	if (final > 0 && battle._hooks.hpDamage) {
		const hctx = { source: hs, target, amount: final, dmg, credit };
		battle.emit('hpDamage', hctx);
		if (Number.isFinite(hctx.amount)) final = Math.max(0, Math.min(final, hctx.amount));
	}
	return applyHpLoss(battle, ctx, final, mark);
}
