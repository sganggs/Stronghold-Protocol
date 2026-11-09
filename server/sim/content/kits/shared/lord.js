import { hasHp } from '../../../attack.js';

/**
 * LOR arts rider: the caller owns per-operator eligibility/scaling; zero omits the child. A scale function decides every
 * case itself (仇白 rides a non-attack ADDITION, 凛御银灰 its own rider). A plain number has no such check, so that rider
 * never rides its own damage (tag 'lord:rider'): 棘刺's LOR-X (规程 data) rode itself until the hook-depth guard.
 * 伊比利亚骨刺刀 (items/battle.js) skips additions in turn, so the two cannot feed each other.
 */
export function installLordArtsAddition(battle, unit, scale, tags = ['module', 'addition']) {
  if (typeof scale !== 'function' && !(scale > 0)) return;
  const fixed = typeof scale !== 'function';
  const riderTags = fixed ? [...tags, 'lord:rider'] : tags;
  battle.on('damageCalculate', c => {
    if (c.source !== unit || !c.target?.alive || c.target.side !== 'enemy' || !hasHp(c.target)) return;
    if (fixed && Array.isArray(c.dmg?.tags) && c.dmg.tags.includes('lord:rider')) return;
    const ratio = typeof scale === 'function' ? scale(c) : scale;
    if (!(ratio > 0)) return;
    battle.dealDamage({
      source: unit, target: c.target, amount: unit.s.atk * ratio, type: 'arts',
      attackType: 'ADDITION', applyWay: 'NONE', calculation: 'precomputed',
      origin: c.dmg, tags: riderTags,
    });
  }, { owner: unit });
}
