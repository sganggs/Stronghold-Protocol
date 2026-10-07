import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, giveItem } from './match/harness.js';
import { createRegistry } from '../server/match/effectsMeta.js';

const registry = createRegistry({ log: { warn() {}, error() {}, info() {} } });
const BEACON = 'chess_item_5_04_e_a';
function setup(diy = false) {
  const seats = [0, 1, 2].map((i) => ({ seat: i, playerId: `p_${i}`, name: `P${i}`, isBot: false, connected: true,
    diy: diy && i === 0 ? { chess_char_5_diy1_a: { charId: 'char_112_siege', skillIndex: 2 } } : {} }));
  const h = makeMatch({ mode: 'coop', seats, seed: 39, registry, fake: true }).start();
  h.toPrep(1);
  for (const ps of h.m.players.values()) {
    for (const p of ps.allChess()) ps.returnCopies(p);
    ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.offers.length = 0; ps.bandId = null; ps.recompute();
  }
  return h;
}
const equip = (h, it, target) => h.m.handle('p_0', { t: 'g.equip', itemUid: it.uid, targetUid: target.uid });

test('user Given a DIY beacon carrier When equipped Then reject without consuming carrier, equipment, stock or offers', () => {
  const h = setup(true), ps = h.ps('p_0');
  const target = ps.acquireChess('chess_char_5_diy1_a');
  assert.ok(target);
  for (const id of ['chess_item_1_01_e_a', 'chess_item_2_03_e_a']) {
    assert.deepEqual(equip(h, giveItem(h.m, ps, id), target), { ok: true });
  }
  const item = giveItem(h.m, ps, BEACON);
  const stock = ps.poolOf(target.id).left(target.id);
  const before = JSON.stringify(ps.privateView());
  assert.equal(equip(h, item, target).error, 'BAD_TARGET');
  assert.equal(JSON.stringify(ps.privateView()), before);
  assert.ok(ps.find(target.uid)); assert.ok(ps.find(item.uid));
  assert.equal(ps.poolOf(target.id).left(target.id), stock);
  h.invariants(); h.m.dispose();
});

test('user Given a non-DIY beacon carrier When equipped Then consume the carrier, offer replacements and gift next prep', () => {
  const h = setup(), ps = h.ps('p_0');
  const cid = 'chess_char_1_07_a';
  const target = give(h.m, ps, cid, 'hand');
  const item = giveItem(h.m, ps, BEACON);
  assert.deepEqual(equip(h, item, target), { ok: true });
  assert.equal(ps.find(target.uid), null);
  assert.equal(ps.find(item.uid), null);
  assert.equal(ps.offers[0].slots.length, 2);
  h.toPrep(2);
  const got = [...h.m.players.values()].filter((p) => p !== ps).flatMap((p) => p.allChess()).filter((p) => p.id === cid);
  assert.equal(got.length, 1);
  h.invariants(); h.m.dispose();
});
