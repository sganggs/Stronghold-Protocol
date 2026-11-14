// test/match/feedback79.test.js — community reports on old versions, sent by the owner on 2026-11-14 (history §37.205):
// 巫恋's 售出 swap into a frozen shop keeps the swapped card frozen (an effect's card follows the shop's freeze); 伊桑's
// 「当前人数最多盟约的干员」 is never above the shop level and never 伊桑 himself (第一期 and 规程); 第一期 greys 2 of its 6
// core bonds per match.
// Run: node --test test/match/feedback79.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getData, getVersionData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { drawDisabledBonds } from '../../server/match/pool.js';
import { createRng } from '../../server/sim/rng.js';
import { makeCtx } from '../../server/match/effectsMeta.js';
import { HANDLERS, mostBondRules } from '../../server/sim/content/garrisons/meta.js';
import { makeMatch, give } from './harness.js';

const dataOf = (v) => (v === 'act2autochess' ? getData() : getVersionData(v));

test('an effect\'s card in a frozen shop is frozen too (an explicit `frozen` still wins) and stays at the combat start', () => {
  const h = makeMatch({ fake: true, seed: 4 }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  const ids = [...m.pool.entries.keys()].filter((id) => !m.chessExcluded(m.gd.chess(id))).slice(0, 3);
  const ctx = makeCtx(m, ps, { key: 'test' }, 'onSold', {});
  ps.shop.frozen = true;
  assert.ok(ctx.setShopSlot(0, { kind: 'chess', id: ids[0] }));
  assert.ok(ctx.setShopSlot(1, { kind: 'chess', id: ids[1], frozen: false }));
  assert.equal(ps.shop.slots[0].frozen, true, 'follows the frozen shop');
  assert.equal(ps.shop.slots[1].frozen, false, 'explicit');
  ps.clearUnfrozenShop();
  assert.equal(ps.shop.slots[0]?.id, ids[0], 'kept at the combat start');
  assert.equal(ps.shop.slots[1], null);
  ps.shop.frozen = false;
  assert.ok(ctx.setShopSlot(2, { kind: 'chess', id: ids[2] }));
  assert.equal(ps.shop.slots[2].frozen, false, 'an unfrozen shop: unfrozen');
});

test('巫恋 (band_vodfox): the first sale of a normal operator into a frozen shop swaps it in frozen — the lock it shows is the lock it keeps', () => {
  const h = makeMatch({ fake: true, seed: 6 }).start();
  h.toPrep(1, { band: 'band_vodfox' });
  const m = h.m;
  const ps = h.ps('p_0');
  assert.equal(ps.bandId, 'band_vodfox');
  const inShop = new Set(ps.shop.slots.filter(Boolean).map((s) => s.id));
  const id = [...m.pool.entries.keys()].find((x) => /_a$/.test(x) && !inShop.has(x) && !m.chessExcluded(m.gd.chess(x)) && m.pool.entries.get(x)?.left > 0);
  const piece = give(m, ps, id, 'hand');
  ps.shop.frozen = true;
  for (const s of ps.shop.slots) if (s) s.frozen = true;
  assert.ok(m.handle('p_0', { t: 'g.sell', uid: piece.uid }).ok);
  const i = ps.shop.slots.findIndex((s) => s && s.id === id);
  assert.ok(i >= 0, 'the sold operator went into the shop');
  assert.equal(ps.shop.slots[i].frozen, true, 'under the lock');
  ps.clearUnfrozenShop();
  assert.equal(ps.shop.slots[i]?.id, id, 'still there after the combat start');
});

/** The `_a` trait text of the chess named `name` in version `v`. */
function traitText(v, name) {
  const d = dataOf(v);
  const chess = Object.values(d.chess.chess ?? d.chess).find((c) => c && c.name === name && /_a$/.test(c.chessId ?? c.id ?? ''))
    ?? Object.entries(d.chess.chess ?? d.chess).find(([k, c]) => c && c.name === name && /_a$/.test(k))?.[1];
  const gid = (chess?.garrisonIds ?? [])[0];
  const g = (d.garrisons.garrisons ?? d.garrisons)[gid];
  return { gid, g };
}

test('every 「当前人数最多盟约的干员」 is capped at the shop level; only 伊桑\'s texts (第一期 「（自身除外）」, 规程 「（无法获得自身）」) skip the operator itself', () => {
  for (const [v, name, want] of [
    ['act1autochess', '伊桑', { noSelf: true, capped: true }],
    ['act1autochess@V1_1', '伊桑', { noSelf: true, capped: true }],
    ['act3autochess@V3_1', '伊桑', { noSelf: true, capped: true }],
    ['act2autochess', '余', { noSelf: false, capped: true }],
    ['act1autochess', '余', { noSelf: false, capped: true }],
    ['act3autochess@V3_1', '机械师', { noSelf: false, capped: true }],
  ]) {
    const { gid, g } = traitText(v, name);
    assert.equal(g?.effectType, 'SERVER_MOST_BOND', `${v} ${name} ${gid}`);
    assert.deepEqual(mostBondRules(g), want, `${v} ${name}: ${g.desc}`);
  }
});

/** A trait context for SERVER_MOST_BOND: bond `big` has the most members; rollChess records its options. */
function fakeCtx(desc, { shopLevel = 3, selfId = 'chess_char_3_18_a' } = {}) {
  const calls = [];
  const ctx = {
    source: { garrison: { desc }, piece: { id: selfId }, bb: {}, bbStr: {} },
    gd: { bondIds: ['big', 'small'], baseIdOf: (id) => String(id).replace(/_[ab]$/, '') },
    data: { bonds: {} },
    bondCount: (id) => (id === 'big' ? 4 : 1),
    rng: { shuffle: (a) => a },
    shopLevel: () => shopLevel,
    rollChess: (opts) => { calls.push(opts); return 'chess_char_2_01_a'; },
    grantChess: () => true,
  };
  return { ctx, calls };
}

test('SERVER_MOST_BOND: the most-member bond at most at the shop level; 伊桑 never himself, 余 / 机械师 without that filter', () => {
  const ethan = fakeCtx(traitText('act3autochess@V3_1', '伊桑').g.desc, { shopLevel: 3 });
  HANDLERS.SERVER_MOST_BOND.run(ethan.ctx);
  assert.equal(ethan.calls.length, 1);
  assert.equal(ethan.calls[0].bond, 'big');
  assert.equal(ethan.calls[0].maxTier, 3, 'the shop level');
  assert.equal(ethan.calls[0].filter('chess_char_3_18_a'), false, 'not 伊桑');
  assert.equal(ethan.calls[0].filter('chess_char_3_18_b'), false, 'nor his elite');
  assert.equal(ethan.calls[0].filter('chess_char_2_01_a'), true);
  const first = fakeCtx(traitText('act1autochess', '伊桑').g.desc, { shopLevel: 5, selfId: 'chess_char_3_12_a' });
  HANDLERS.SERVER_MOST_BOND.run(first.ctx);
  assert.equal(first.calls[0].maxTier, 5, '第一期 too (the owner: never above the shop level)');
  assert.equal(first.calls[0].filter('chess_char_3_12_b'), false);
  const yu = fakeCtx(traitText('act2autochess', '余').g.desc, { shopLevel: 2 });
  HANDLERS.SERVER_MOST_BOND.run(yu.ctx);
  assert.equal(yu.calls[0].maxTier, 2, '余 too (GitHub #218; the owner, 2026-11-14)');
  assert.equal(yu.calls[0].filter, undefined);
  const mech = fakeCtx(traitText('act3autochess@V3_1', '机械师').g.desc, { shopLevel: 4 });
  HANDLERS.SERVER_MOST_BOND.run(mech.ctx);
  assert.equal(mech.calls[0].maxTier, 4, '机械师 too');
  assert.equal(mech.calls[0].filter, undefined);
});

test('第一期 greys 2 of its 6 core bonds (险境 / 绝境 / 终极), 4 add-ons; 标准 none of them; 第二期 keeps 3 of 8', () => {
  for (const [v, core] of [['act1autochess', 2], ['act1autochess@V1_1', 2], ['act2autochess@V2_1', 3], ['act2autochess', 3]]) {
    const data = dataOf(v);
    for (const mode of ['normal', 'hard']) {
      const gd = new GameData(data, `mode_multi_${mode}`);
      assert.deepEqual(gd.bans(gd.difficulty), { core, addon: 4 }, `${v} ${mode}`);
      for (let seed = 1; seed <= 5; seed++) {
        const { drawn } = drawDisabledBonds(gd, createRng(seed));
        assert.equal(drawn.filter((b) => gd.bond(b)?.isCore).length, core, `${v} ${mode} seed ${seed}`);
      }
    }
  }
  const funny = new GameData(dataOf('act1autochess'), 'mode_multi_funny');
  assert.deepEqual(funny.bans(funny.difficulty), { core: 0, addon: 1 });
});
