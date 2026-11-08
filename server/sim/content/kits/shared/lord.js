import { hasHp, damageAttackType } from '../../../attack.js';

/**
 * LOR arts rider: the caller owns per-operator eligibility/scaling; zero omits the child. It never rides an ADDITION (its
 * own included): with a plain number scale, 棘刺's LOR-X (规程 data) recursed until the hook-depth guard, and with
 * 伊比利亚骨刺刀 (items/battle.js, which skips additions in turn) the two fed each other.
 */
export function installLordArtsAddition(battle, unit, scale, tags = ['module', 'addition']) {
  if (typeof scale !== 'function' && !(scale > 0)) return;
  battle.on('damageCalculate', c => {
    if (c.source !== unit || !c.target?.alive || c.target.side !== 'enemy' || !hasHp(c.target)) return;
    if (damageAttackType(c.dmg) === 'ADDITION') return;
    const ratio = typeof scale === 'function' ? scale(c) : scale;
    if (!(ratio > 0)) return;
    battle.dealDamage({
      source: unit, target: c.target, amount: unit.s.atk * ratio, type: 'arts',
      attackType: 'ADDITION', applyWay: 'NONE', calculation: 'precomputed',
      origin: c.dmg, tags,
    });
  }, { owner: unit });
}
