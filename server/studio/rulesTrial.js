// [ASSUMED] Fixed, bounded prep fixtures compare the same Match actions under the selected rules and vanilla.
// Shop: twelve level-one refreshes with Victoria active. Loadout: disable the first holder's skill.
// Morph: equip two bond items then a morph. Unequip: a separate holder returns one elite hammer (no auto-merge with the morph fixture).
import { pieceBonds } from '../match/bondsMeta.js';

export function rulesTrial(m, ps, scene, declared) {
  const checks = [], holder = [...ps.board.values()][0];
  const equip = (owner, id) => {
    const item = ps.newPiece('item', id); ps.stow(item);
    return { item, result: m.handle(ps.playerId, { t: 'g.equip', itemUid: item.uid, targetUid: owner.uid }) };
  };
  if (Object.hasOwn(declared, 'shopBias')) {
    ps.shop.level = 1; ps.shop.freeRefreshes = 12;
    const members = Object.values(m.data.chess).filter(c => !c.isGolden && !c.isDiy && c.visible && c.bonds.includes('victoriaShip'));
    const slots = members.slice(0, m.data.bonds.victoriaShip.thresholds[0]).map((c, i) => {
      const at = `11,${3 + i}`; ps.board.set(at, ps.newPiece('chess', c.chessId)); return at;
    });
    ps.recompute();
    const draws = [], outcomes = [];
    for (let i = 0; i < 12; i++) {
      outcomes.push(m.handle(ps.playerId, { t: 'g.refresh' }));
      draws.push(...ps.shop.slots.filter(s => s?.kind === 'item').map(s => ({ id: s.id, bond: m.gd.item(s.id).giveBondId })));
    }
    checks.push({ rule: 'shopBias', outcomes, draws, active: !!ps.bonds.victoriaShip?.active });
    for (const at of slots) ps.board.delete(at);
    ps.recompute();
  }
  if (Object.hasOwn(declared, 'prepLoadout')) {
    const before = structuredClone(ps.loadout);
    const result = m.setLoadout(ps.playerId, { [m.gd.chess(holder.id).baseId]: { skill: 0 } });
    checks.push({ rule: 'prepLoadout', before, after: structuredClone(ps.loadout), result });
  }
  if (Object.hasOwn(declared, 'morphPairing')) {
    const outcomes = ['chess_item_1_01_e_a', 'chess_item_2_03_e_a', 'chess_item_6_09_e_a'].map(id => equip(holder, id).result);
    checks.push({ rule: 'morphPairing', outcomes, items: holder.items.map(i => i.id), bonds: pieceBonds(m.gd, holder, m.rules) });
  }
  // Carry the actual equipment and loadout into replay, using the production player serializer.
  Object.assign(scene.spec.players[0], ps.battleInput());
  if (m.rules?.morphPairing === 'plus') scene.spec.morphPairing = 'plus';
  if (Object.hasOwn(declared, 'unequip')) {
    const owner = ps.newPiece('chess', holder.id); ps.stow(owner);
    const { item, result: equipped } = equip(owner, 'chess_item_1_01_e_b');
    const result = m.handle(ps.playerId, { t: 'g.unequip', itemUid: item.uid });
    checks.push({ rule: 'unequip', equipped, result, items: owner.items.map(i => i.id),
      returned: [...ps.hand, ...ps.temp].some(p => p?.uid === item.uid) });
  }
  return checks;
}
