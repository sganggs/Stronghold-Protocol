// A Picture Scroll gain can consume its own target in an immediate three-copy promotion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, legalTileFor } from './harness.js';

const OP = 'chess_char_1_17_a';
const SCROLL = 'chess_item_6_02_m';
const HAMMER = 'chess_item_1_01_e_a';
const SHIELD = 'chess_item_1_02_e_a';
const FILLER = 'chess_item_6_09_e_a'; // non-mergeable
const OK = { ok: true };

function prep(t, { copies = 2, golden = false, items = [HAMMER] } = {}) {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 8 }).start();
  t.after(() => h.m.dispose());
  h.toPrep(1, { band: 'band_dusk' });
  const m = h.m, ps = h.ps('p_0');
  assert.equal(m.gd.mergeCount(OP), 3);
  const id = golden ? m.gd.goldenIdOf(OP) : OP;
  const target = ps.acquireChess(id);
  const [row, col] = legalTileFor(m, ps, id);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: target.uid, to: { area: 'board', row, col }, dir: 'RIGHT' }), OK);
  for (let i = 1; i < copies; i++) ps.acquireChess(id);
  for (const itemId of items) {
    const item = ps.acquireItem(itemId);
    assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: item.uid, targetUid: target.uid }), OK);
  }
  const art = ps.hand.find((p) => p?.id === SCROLL);
  assert.ok(art, 'Dusk grants the scroll in round 1');
  h.invariants();
  const cast = () => m.handle('p_0', { t: 'g.art', itemUid: art.uid, row, col, dir: 'RIGHT' });
  return { h, m, ps, target, art, row, col, cast };
}

function itemIds(ps) {
  return [...ps.hand, ...ps.temp, ...ps.board.values()].filter(Boolean)
    .flatMap((p) => p.kind === 'item' ? [p.id] : (p.items || []).map((it) => it.id)).sort();
}

test('Picture Scroll: a third normal copy preserves the target equipment through promotion', (t) => {
  const { h, m, ps, target, art, row, col, cast } = prep(t);
  const funds = ps.funds;
  assert.deepEqual(cast(), OK);
  const elite = ps.board.get(`${row},${col}`);
  assert.equal(elite.id, m.gd.goldenIdOf(OP));
  assert.equal(elite.dir, 'RIGHT');
  assert.equal(ps.find(target.uid), null, 'the original target was consumed');
  assert.equal(ps.find(art.uid), null, 'the scroll was consumed');
  assert.deepEqual(itemIds(ps), [m.gd.item(HAMMER).goldenId]);
  assert.ok(ps.hand.some((p) => p?.id === m.gd.item(HAMMER).goldenId), 'the original and copied hammer merge into an advanced hammer in hand');
  assert.deepEqual(elite.items, []);
  assert.equal(ps.stats.merges, 1);
  assert.equal(ps.stats.itemMerges, 1);
  assert.equal(ps.funds, funds);
  h.invariants();
});

for (const advanced of [false, true]) {
  test(`Picture Scroll: promotion copies both ${advanced ? 'advanced' : 'normal'} equipped items`, (t) => {
    const items = [HAMMER, SHIELD].map((id) => advanced ? id.replace(/_a$/, '_b') : id);
    const { h, m, ps, row, col, cast } = prep(t, { items });
    assert.deepEqual(cast(), OK);
    const elite = ps.board.get(`${row},${col}`);
    const upgraded = items.map((id) => m.gd.item(id).goldenId || id).sort();
    assert.deepEqual(itemIds(ps), advanced ? [...items, ...items].sort() : upgraded);
    assert.deepEqual(elite.items.map((p) => p.id).sort(), advanced ? items.sort() : []);
    h.invariants();
  });
}

for (const golden of [false, true]) {
  test(`Picture Scroll: one ${golden ? 'elite' : 'normal'} target still copies its equipment without promotion`, (t) => {
    const { h, m, ps, target, cast } = prep(t, { copies: 1, golden });
    assert.deepEqual(cast(), OK);
    assert.equal(ps.find(target.uid)?.piece, target);
    assert.equal(ps.allChess().length, 2);
    assert.equal(ps.allChess().filter((p) => p.id === target.id).length, 2);
    assert.deepEqual(itemIds(ps), [m.gd.item(HAMMER).goldenId]);
    assert.equal(ps.stats.merges, 0);
    h.invariants();
  });
}

test('Picture Scroll: a third copy without equipment still promotes normally', (t) => {
  const { h, m, ps, row, col, cast } = prep(t, { items: [] });
  assert.deepEqual(cast(), OK);
  assert.equal(ps.board.get(`${row},${col}`).id, m.gd.goldenIdOf(OP));
  assert.deepEqual(itemIds(ps), []);
  h.invariants();
});

test('Picture Scroll: a promotion at full hand and temp still copies the hammer', (t) => {
  const { h, m, ps, cast } = prep(t);
  while (ps.hand.some((p) => p == null) || ps.temp.some((p) => p == null)) assert.ok(ps.acquireItem(FILLER));
  h.invariants();
  assert.deepEqual(cast(), OK);
  assert.deepEqual(itemIds(ps).filter((id) => id !== FILLER), [m.gd.item(HAMMER).goldenId]);
  assert.equal(itemIds(ps).filter((id) => id === FILLER).length, 13);
  h.invariants();
});

test('Picture Scroll: a full hand and temp without promotion keeps the refused scroll and target equipment', (t) => {
  const { h, ps, target, art, cast } = prep(t, { copies: 1 });
  while (ps.hand.some((p) => p == null) || ps.temp.some((p) => p == null)) assert.ok(ps.acquireItem(FILLER));
  const before = ps.privateView();
  assert.equal(cast().error, 'HAND_FULL');
  assert.ok(ps.find(art.uid));
  assert.deepEqual(target.items.map((p) => p.id), [HAMMER]);
  assert.deepEqual(ps.privateView(), before);
  h.invariants();
});
