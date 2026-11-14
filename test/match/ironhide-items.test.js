import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../../server/data.js';
import { createRegistry, makeCtx } from '../../server/match/effectsMeta.js';
import { registerBuiltins } from '../../server/match/builtinMeta.js';
import { equipmentCapacity } from '../../shared/itemRules.js';
import { makeMatch, give, giveItem } from './harness.js';

const V3 = getVersionData('act3autochess@V3_1');
const NORMAL = 'chess_char_5_22_a', ELITE = 'chess_char_5_22_b';
const PHONE = 'chess_item_2_06_e_a', GOLD_PHONE = 'chess_item_2_06_e_b';
const equipment = Object.values(V3.items).filter(i => i.itemType === 'EQUIP' && !i.isGolden && !i.canFuse && !i.canGiveBond
  && !String(i.kind).startsWith('consume_on_equip')).slice(0, 7).map(i => i.id);
const owned = ps => [...ps.board.values(), ...ps.hand, ...ps.temp].filter(p => p?.kind === 'chess');
const copies = ps => owned(ps).filter(p => ps.gd.baseIdOf(p.id) === NORMAL).reduce((n, p) => n + (ps.gd.isGolden(p.id) ? 3 : 1), 0);

function setup(t, rules = null) {
  const registry = createRegistry({ builtins: false, content: false });
  registerBuiltins(registry, V3);
  const h = makeMatch({ data: V3, mode: 'solo', modeId: 'mode_single_1', seed: 41, fake: true, rules,
    registry }).start();
  t.after(() => h.m.dispose());
  h.toPrep(1, { band: 'band_amiya' });
  const ps = h.ps('p_0');
  ps.shop.level = 2;
  const equip = (it, p, replaceUid) => h.m.handle('p_0', { t: 'g.equip', itemUid: it.uid, targetUid: p.uid,
    ...(replaceUid != null && { replaceUid }) });
  return { h, m: h.m, ps, equip };
}

for (const id of [NORMAL, ELITE]) for (const [phone, n] of [[PHONE, 1], [GOLD_PHONE, 2]]) {
  test(`${id} + ${phone}: shop II grants ${n} special copies without destroying free-slot equipment`, t => {
    const { h, m, ps, equip } = setup(t);
    const target = give(m, ps, id);
    const worn = equipment.slice(0, 2).map(i => giveItem(m, ps, i));
    for (const it of worn) assert.deepEqual(equip(it, target), { ok: true });
    const before = copies(ps), it = giveItem(m, ps, phone);
    assert.equal(m.pool.has(NORMAL), false);
    assert.deepEqual(equip(it, target), { ok: true });
    assert.equal(ps.find(it.uid), null);
    assert.equal(copies(ps), before + n, 'advanced phone counts both gifts even when they immediately merge');
    for (const item of worn) assert.ok(ps.find(item.uid), 'a gift-triggered promotion returns equipment instead of destroying it');
    assert.equal(m.pool.has(NORMAL), false, 'special recruitment never adds Ironhide to shop stock');
    h.invariants();
  });
}

test('two normal communicators at shop II promote the strategy carrier and return both equipped items', t => {
  const { h, m, ps, equip } = setup(t);
  const target = give(m, ps, NORMAL);
  const worn = equipment.slice(0, 2).map(i => giveItem(m, ps, i));
  for (const it of worn) equip(it, target);
  for (let i = 0; i < 2; i++) assert.deepEqual(equip(giveItem(m, ps, PHONE), target), { ok: true });
  assert.equal(ps.find(target.uid), null);
  const elite = owned(ps).filter(p => p.id === ELITE);
  assert.equal(elite.length, 1);
  assert.equal(ps.gd.equipSlots(elite[0].id), 6);
  assert.equal(copies(ps), 3);
  for (const it of worn) assert.ok(ps.find(it.uid));
  h.invariants();
});

test('only the marked carrier copy bypasses tier; regular recruits, paging and shop draws keep their limits', t => {
  const { m, ps, equip } = setup(t);
  const ctx = makeCtx(m, ps, { kind: 'item', key: PHONE }, 'onEquip');
  const calls = [], roll = m.pool.roll.bind(m.pool);
  m.pool.roll = (rng, opts) => { calls.push(opts); return roll(rng, opts); };
  const target = give(m, ps, NORMAL);
  equip(giveItem(m, ps, PHONE), target);
  const last = calls.at(-1);
  assert.equal(last.maxTier, 2, 'do not remove the level gate from normal candidates');
  assert.deepEqual(last.extra.filter(([, e]) => e.tierExempt).map(([id]) => id), [NORMAL]);
  assert.equal(last.extra.find(([id]) => id === NORMAL)[1].tier, 5, 'keep the actual tier instead of disguising the special copy as tier II');
  assert.equal(roll(() => 0, { ...last, tier: 2, filter: id => id === NORMAL }), null, 'the exception never bypasses an exact-tier draw');
  assert.equal(roll(() => 0, { ...last, tier: 5, filter: id => id === NORMAL }), NORMAL);
  ctx.rollChess({ maxTier: 2 });
  assert.ok(!(calls.at(-1).extra || []).some(([id]) => id === NORMAL));
  ctx.rollChess({ maxTier: 2, tierExemptChess: ['chess_char_3_23_a'] });
  assert.ok(!(calls.at(-1).extra || []).some(([, e]) => e.tierExempt), 'unmarked hidden operators do not inherit this exception');
  const candidate = [...m.pool.entries.keys()].find(id => ps.gd.tierOf(id) > 2 && ps.gd.chess(id).bonds.includes('emptyShip'));
  assert.ok(candidate && m.pool.left(candidate) > 0);
  assert.equal(last.filter(candidate), true, 'same-bond normal candidates still share the original pool');
  assert.equal(roll(() => 0, { ...last, filter: id => id === candidate }), null, 'the normal tier-III candidate cannot leak into a tier-II draw');
  calls.length = 0;
  equip(giveItem(m, ps, 'chess_item_4_01_e_a'), target);
  assert.ok(calls.length > 0);
  assert.ok(calls.every(o => o.maxTier === 2 && !(o.extra || []).some(([, e]) => e.tierExempt)), 'paging does not opt into the communicator exception');
});

test('a full four-slot carrier replaces the chosen item before a communicator-triggered promotion', t => {
  const { h, m, ps, equip } = setup(t);
  const target = give(m, ps, NORMAL);
  const worn = equipment.slice(0, 4).map(i => giveItem(m, ps, i));
  for (const it of worn) equip(it, target);
  assert.deepEqual(equip(giveItem(m, ps, GOLD_PHONE), target, worn[1].uid), { ok: true });
  assert.equal(ps.find(worn[1].uid), null, 'the selected item is destroyed normally');
  for (const it of worn.filter(x => x !== worn[1])) assert.ok(ps.find(it.uid), 'promotion returns every other equipped item');
  assert.equal(owned(ps).filter(p => p.id === ELITE).length, 1);
  h.invariants();
});

test('equipment capacity reads official per-form slots without changing normal defaults', () => {
  assert.equal(equipmentCapacity(V3.chess[NORMAL]), 4);
  assert.equal(equipmentCapacity(V3.chess[ELITE]), 6);
  assert.equal(equipmentCapacity(V3.chess.chess_char_1_11_a), 2);
  assert.equal(equipmentCapacity({}, 3), 3);
  for (const bad of [null, -1, 0, 1.5, '4']) assert.equal(equipmentCapacity({ equipSlotNum: bad }), 2);
});

for (const [id, cap] of [[NORMAL, 4], [ELITE, 6]]) {
  for (const morph of ['official', 'plus']) test(`${id} ${morph}: fill ${cap} slots, then replace the selected item only`, t => {
    const { h, m, ps, equip } = setup(t, morph === 'plus' ? { morphPairing: 'plus' } : null);
    const target = give(m, ps, id);
    assert.equal(ps.gd.equipSlots(id), cap);
    const worn = [];
    for (let i = 0; i < cap; i++) {
      const it = giveItem(m, ps, equipment[i]); worn.push(it);
      assert.deepEqual(equip(it, target), { ok: true });
      assert.deepEqual(target.items.map(x => x.uid), worn.map(x => x.uid));
    }
    h.invariants();
    const incoming = giveItem(m, ps, equipment[cap]);
    assert.deepEqual(equip(incoming, target, worn[1].uid), { ok: true });
    assert.equal(target.items.length, cap);
    assert.equal(ps.find(worn[1].uid), null);
    assert.ok(target.items.some(x => x.uid === worn[0].uid));
    assert.ok(target.items.some(x => x.uid === incoming.uid));
    h.invariants();
  });

}

test('a consumable replaces only at the actual four-slot limit', t => {
  const { h, m, ps, equip } = setup(t);
  const target = give(m, ps, NORMAL);
  const worn = equipment.slice(0, 4).map(i => giveItem(m, ps, i));
  for (const it of worn) equip(it, target);
  const coin = Object.values(V3.items).find(i => !i.isGolden && i.buffs?.some(b => b.key === 'equip_destory_gain_random_coin'));
  assert.deepEqual(equip(giveItem(m, ps, coin.id), target, worn[2].uid), { ok: true });
  assert.equal(target.items.length, 3);
  assert.equal(ps.find(worn[2].uid), null);
  h.invariants();
});
