// Final HP application and HP loss (流失). Shared by damage and the explicit HP-loss entry.
import { BOSS_HIT_LIMIT } from '../../../shared/constants.js';

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
 * Battle.dealHPLose, except the 胄 drone link's pool share: `noHitLimit`, DESIGN §25.13.4); element 损伤 (gauge fill,
 * 'element') removes no HP and is never checked. Deterministic (Math.ceil of the same double on every engine).
 */
export function leaderHitCancelled(battle, target, amount) {
	if (!(BOSS_HIT_LIMIT > 0) || !target || !target.isBoss || (battle.kind !== 'boss' && battle.kind !== 'hidden')) return false;
	if (!(Math.ceil(amount) >= BOSS_HIT_LIMIT)) return false;
	battle.fx('hitCap', { x: target.x, y: target.y, id: target.id, n: Math.ceil(amount) });
	return true;
}

/**
 * Remove HP (after mitigation) and run damaged/fatal/kill bookkeeping. Also used by `battle.dealHPLose` (流失).
 */
export function applyHpLoss(battle, ctx, amount, mark) {
	const { source, credit, target, dmg, kind = 'damage' } = ctx;
	if (!target.alive) return 0;
	let dealt = 0;
	const hs = source; // the source hooks see (无来源: none; `credit` keeps it)
	if (target.bossPool) {
		const pool = target.bossPool;
		const before = pool.hp;
		const pid = credit && credit.side === 'ally' ? credit.ownerId : null;
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
				const fctx = { unit: target, source: hs, credit, dmg, amount, prevented: false };
				battle.emit('fatal', fctx);
				if (fctx.prevented && target.alive) { if (target.hp < 1) target.hp = Math.min(1, target.s.maxHp); }
			}
		}
		dealt = Math.max(0, before - Math.max(0, target.hp));
	}
	// damage dealt (unit stats, the results screen's 造成伤害) never counts a unit's own side — its own drain or 流失 (源石溶剂,
	// 史尔特尔 S3 …), friendly damage; `taken` and the kill credit do
	if (credit && credit.side !== target.side) {
		credit.stats.dmg += dealt;
		if (credit.side === 'ally' && credit.ownerId != null) { const pp = battle._pp(credit.ownerId); if (pp) pp.damageDealt += dealt; }
	}
	target.stats.taken += dealt;
	target.lastHitAt = battle.time;
	if (dmg && !dmg.silent && amount >= 0.5) {
		const shown = dmg.type === 'element' ? dmg.element : dmg.type === 'elemental' ? (dmg.element || 'true') : dmg.type;
		// 'r' is display-only (official red number). Absent on every other hit, so the tuple stays four elements.
		const ev = ['dmg', target.id, Math.round(amount), shown];
		if (mark === 'r') ev.push('r');
		battle._ev(ev);
	}
	const result = { source, credit, target, dmg, kind, amount, hpRemoved: dealt };
	if (battle._hooks.hpChanged) battle.emit('hpChanged', { ...result, delta: -dealt });
	if (kind === 'damage' && battle._hooks.damageApplied) battle.emit('damageApplied', result);
	if (battle._hooks.damaged) battle.emit('damaged', { source: hs, target, amount, type: dmg ? dmg.type : 'true', dmg, credit });
	if (target.side === 'ally' && target.skill && dmg && !dmg.noSp && dmg.type !== 'element') battle._skills.onDamaged(target);
	const dead = target.bossPool ? target.bossPool.hp <= 0 : target.hp <= 0;
	if (dead && target.alive) battle.kill(target, credit);
	return dealt;
}

