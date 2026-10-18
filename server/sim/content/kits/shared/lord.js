import { hasHp } from '../../../attack.js';

/** LOR arts rider: the caller owns per-operator eligibility/scaling; zero omits the child. */
export function installLordArtsAddition(battle, unit, scale, tags = ['module', 'addition']) {
	if (typeof scale !== 'function' && !(scale > 0)) return;
	battle.on('damageCalculate', c => {
		if (c.source !== unit || !c.target?.alive || c.target.side !== 'enemy' || !hasHp(c.target)) return;
		const ratio = typeof scale === 'function' ? scale(c) : scale;
		if (!(ratio > 0)) return;
		battle.dealDamage({
			source: unit, target: c.target, amount: unit.s.atk * ratio, type: 'arts',
			attackType: 'ADDITION', applyWay: 'NONE', calculation: 'precomputed',
			origin: c.dmg, tags,
		});
	}, { owner: unit });
}
