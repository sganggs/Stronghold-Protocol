// Shared pool accounting, copy-weighted odds, per-match bans (research 00-INDEX §3, §6); the shared item pool
// (GitHub #466, 路标月报#2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameData } from '../../server/match/gamedata.js';
import { SharedPool, ItemPool, drawDisabledBonds } from '../../server/match/pool.js';
import { makeCtx } from '../../server/match/effectsMeta.js';
import { createRng } from '../../server/sim/rng.js';
import { DATA, makeMatch, give, checkInvariants, chessOfTier } from './harness.js';

const gdOf = (modeId = 'mode_multi_normal') => new GameData(DATA, modeId);

test('pool caps follow config (12/14/18/16/8/5, 缪尔赛思 4) and only visible, unbanned chess enter', () => {
  const gd = gdOf();
  const pool = new SharedPool(gd, { banned: [] });
  const caps = { 1: 12, 2: 14, 3: 18, 4: 16, 5: 8, 6: 5 };
  assert.equal(pool.entries.size, gd.visibleChess.length);
  assert.equal(pool.entries.size, 112);
  for (const [id, e] of pool.entries) {
    const expect = id === 'chess_char_6_11_a' ? 4 : caps[e.tier];
    assert.equal(e.cap, expect, id);
    assert.equal(e.left, e.cap);
    assert.ok(DATA.chess[id].visible && !DATA.chess[id].isGolden);
  }
  const banned = [gd.visibleChess[0], gd.visibleChess[5]];
  const p2 = new SharedPool(gd, { banned });
  assert.equal(p2.entries.size, 110);
  assert.ok(!p2.has(banned[0]) && p2.left(banned[0]) === 0 && p2.take(banned[0]) === 0);
});

test('take/give never go below 0 or above the cap', () => {
  const pool = new SharedPool(gdOf());
  const id = chessOfTier(6)[0];
  const cap = pool.cap(id);
  assert.equal(pool.take(id, 3), 3);
  assert.equal(pool.left(id), cap - 3);
  assert.equal(pool.take(id, 100), cap - 3, 'take clamps at what is left');
  assert.equal(pool.left(id), 0);
  assert.equal(pool.take(id, 1), 0);
  assert.equal(pool.give(id, 100), cap, 'give clamps at the cap');
  assert.equal(pool.left(id), cap);
  assert.equal(pool.give(id, 1), 0);
  assert.equal(pool.take('nope', 1), 0);
  assert.equal(pool.give('nope', 1), 0);
  assert.equal(pool.take(id, -1), 0);
  assert.equal(pool.take(id, NaN), 0);
});

test('odds sanity: level L rolls only tiers ≤ L; level 1 only tier 1; shares ≈ research table', () => {
  const pool = new SharedPool(gdOf());
  const rng = createRng(12345);
  for (let level = 1; level <= 6; level++) {
    const seen = {};
    for (let i = 0; i < 4000; i++) {
      const id = pool.roll(rng, { maxTier: level });
      const t = DATA.chess[id].tier;
      assert.ok(t <= level, `level ${level} rolled tier ${t}`);
      seen[t] = (seen[t] || 0) + 1;
    }
    if (level === 1) assert.deepEqual(Object.keys(seen), ['1']);
    const shares = pool.tierShares(level);
    for (const [t, n] of Object.entries(seen)) assert.ok(Math.abs(n / 4000 - shares[t]) < 0.035, `L${level} T${t} ${n / 4000} vs ${shares[t]}`);
  }
  // research table (full pools, no bans): L6 ≈ 14.0 / 17.4 / 25.0 / 25.7 / 11.1 / 6.9 %
  const s6 = pool.tierShares(6);
  const want = { 1: 0.14, 2: 0.174, 3: 0.25, 4: 0.257, 5: 0.111, 6: 0.069 };
  for (const t of Object.keys(want)) assert.ok(Math.abs(s6[t] - want[t]) < 0.01, `T${t} ${s6[t]}`);
  const s2 = pool.tierShares(2);
  assert.ok(Math.abs(s2[1] - 0.447) < 0.01 && Math.abs(s2[2] - 0.553) < 0.01);
});

test('rolls are copy-weighted: an exhausted chess never rolls; tier/filter options work', () => {
  const pool = new SharedPool(gdOf());
  const rng = createRng(7);
  const t1 = chessOfTier(1);
  for (const id of t1.slice(1)) pool.take(id, 100);
  for (let i = 0; i < 200; i++) assert.equal(pool.roll(rng, { maxTier: 1 }), t1[0]);
  pool.take(t1[0], 100);
  assert.equal(pool.roll(rng, { maxTier: 1 }), null, 'empty tier → null');
  for (let i = 0; i < 100; i++) assert.equal(DATA.chess[pool.roll(rng, { tier: 3 })].tier, 3);
  const f = pool.roll(rng, { maxTier: 6, filter: (id) => id === chessOfTier(5)[2] });
  assert.equal(f, chessOfTier(5)[2]);
});

test('uniform rolls count every eligible chess once (拟态物质 random grant, 路标月报#2)', () => {
  const weighted = new SharedPool(gdOf());
  const uniform = new SharedPool(gdOf());
  const rng = createRng(11);
  const t1 = chessOfTier(1);
  // t1[0] holds a single copy, its 11 tier mates the full 12: copy-weighted nearly never picks it
  weighted.take(t1[0], weighted.cap(t1[0]) - 1);
  uniform.take(t1[0], uniform.cap(t1[0]) - 1);
  let cw = 0;
  let un = 0;
  for (let i = 0; i < 2000; i++) {
    if (weighted.roll(rng, { maxTier: 1 }) === t1[0]) cw++;
    if (uniform.roll(rng, { maxTier: 1, uniform: true }) === t1[0]) un++;
  }
  assert.ok(cw < 40, `copy-weighted picks the 1-copy chess ~1/133 (${cw}/2000)`);
  assert.ok(un > 80, `uniform picks it ~1/12 (${un}/2000)`);
});

test('item slot: tier ≤ level, shop-eligible normal equipment only, sold-out items never drawn', () => {
  const gd = gdOf();
  const ip = new ItemPool(gd);
  const rng = createRng(99);
  for (let level = 1; level <= 6; level++) {
    for (let i = 0; i < 300; i++) {
      const id = ip.roll(rng, { maxTier: level });
      const it = DATA.items[id];
      assert.ok(it && it.itemType === 'EQUIP' && !it.isGolden && !it.hideInShop && !it.shopExcluded, id);
      assert.ok(it.tier <= level, `L${level} item tier ${it.tier}`);
    }
  }
  const t1 = Object.values(DATA.items).filter((it) => !it.isGolden && !it.hideInShop && !it.shopExcluded && it.itemType === 'EQUIP' && it.tier === 1).map((it) => it.id).sort();
  for (const id of t1.slice(1)) ip.take(id, 100);
  for (let i = 0; i < 200; i++) assert.equal(ip.roll(rng, { maxTier: 1 }), t1[0], 'the only item with copies left always comes');
  for (const id of [...ip.entries.keys()]) if (DATA.items[id].tier === 1) ip.take(id, 100);
  assert.equal(ip.roll(rng, { maxTier: 1 }), null, 'every tier-1 item sold out → nothing');
});

// user playtest #4 item 5: the special 维式重锤 (维多利亚 25-layer reward / 洛洛's 定制品) and 突变细胞 (strategy 昆图斯)
// are never sold although the official shop table lists them (tools/build-data.mjs SHOP_EXCLUDED_ITEMS)
const EFFECT_ONLY = ['chess_item_2_03_e_a', 'chess_item_3_09_e_a', 'chess_item_3_10_e_a', 'chess_item_4_09_e_a', 'chess_item_5_08_e_a'];

test('effect-only items are never shop items: not in shopItemsByTier, never in the item slot, the pools or the 机变 supply', () => {
  for (const id of EFFECT_ONLY) {
    assert.equal(DATA.items[id].shopExcluded, true, `${id} (${DATA.items[id].name}) marked`);
    assert.equal(DATA.items[id].hideInShop, false, `${id}: the official table does not hide it`);
    assert.ok(DATA.items[id.replace(/_a$/, '_b')].shopExcluded, `${id}: the golden too`);
  }
  assert.equal(DATA.items.chess_item_1_01_e_a.shopExcluded, false, 'the plain 维式重锤 is sold');
  const gd = gdOf();
  const listed = new Set(Object.values(gd.shopItemsByTier).flat());
  assert.equal(listed.size, 51, '56 normal equipment − 5 effect-only');
  for (const id of EFFECT_ONLY) assert.ok(!listed.has(id), `${id} not a shop item`);
  assert.ok(listed.has('chess_item_1_01_e_a'));
  // the shop item slot at every level
  const ip = new ItemPool(gd);
  const rng = createRng(4);
  for (let level = 1; level <= 6; level++) for (let i = 0; i < 400; i++) assert.ok(!EFFECT_ONLY.includes(ip.roll(rng, { maxTier: level })));
  // every shop-eligible pool (凯瑟琳 / 列装 / 定向投放 / 见者有份) and the plain "random item" roll of effects
  const m = makeMatch({ mode: 'coop', seed: 3, fake: true }).m;
  for (const pid of ['pool_equip_normal', 'pool_equip_shop_1', 'pool_equip_kathe', 'pool_equip_narant']) {
    for (let i = 0; i < 300; i++) assert.ok(!EFFECT_ONLY.includes(m.rollItemId({ pool: pid, shopLevel: 6 })), pid);
  }
  for (let i = 0; i < 300; i++) assert.ok(!EFFECT_ONLY.includes(m.rollItemId({ maxTier: 6 })));
  m.dispose();
});

test('维多利亚 25-layer reward and 洛洛的定制品: the 4 special 维式重锤 (and nothing else)', () => {
  const special = ['chess_item_2_03_e_a', 'chess_item_3_09_e_a', 'chess_item_3_10_e_a', 'chess_item_4_09_e_a'];
  const m = makeMatch({ mode: 'coop', seed: 3, fake: true }).m;
  for (const pid of ['pool_equip_vict', 'pool_equip_rockr']) {
    assert.deepEqual([...DATA.choices.pools[pid].items].sort(), special, pid);
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(m.rollPool(pid).id);
    assert.deepEqual([...seen].sort(), special, `${pid}: every special hammer can come, nothing else`);
  }
  m.dispose();
});

test('per-match disabled bonds: 3 core + 4 add-on (NORMAL+), FUNNY static + 0 + 1; weight-0 never drawn; subset ban rule', () => {
  for (const [modeId, core, addon] of [['mode_multi_hard', 3, 4], ['mode_single_abyss', 3, 4], ['mode_multi_funny', 0, 1], ['mode_single_normal', 3, 4]]) {
    const gd = new GameData(DATA, modeId);
    for (let seed = 1; seed <= 20; seed++) {
      const { drawn, staticOff, banned } = drawDisabledBonds(gd, createRng(seed));
      const nCore = drawn.filter((b) => DATA.bonds[b].isCore).length;
      assert.equal(nCore, core, `${modeId} core`);
      assert.equal(drawn.length - nCore, addon, `${modeId} addon`);
      for (const b of drawn) {
        assert.ok(DATA.bonds[b].weight > 0, `${b} has weight 0`);
        assert.ok(!staticOff.includes(b));
      }
      const off = new Set([...drawn, ...staticOff]);
      for (const id of gd.visibleChess) {
        const bonds = DATA.chess[id].bonds;
        assert.equal(banned.includes(id), bonds.length > 0 && bonds.every((b) => off.has(b)), id);
      }
    }
  }
  // FUNNY: the static list alone removes many operators
  const f = drawDisabledBonds(new GameData(DATA, 'mode_multi_funny'), createRng(1));
  assert.equal(f.staticOff.length, 10);
  assert.ok(f.banned.length >= 20);
});

test('the match pool excludes banned chess; m.public lists disabled bonds and banned chess', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1, bots: 1, seed: 3 }).start();
  const pub = h.lastBc('m.public');
  assert.equal(pub.drawnDisabledBonds.length, 7);
  assert.ok(pub.bannedChess.length > 0);
  for (const id of pub.bannedChess) assert.ok(!h.m.pool.has(id), `${id} should not be in the pool`);
  assert.equal(h.m.pool.entries.size + pub.bannedChess.length, 112);
  checkInvariants(h.m);
  h.m.dispose();
});

test('selling and elimination return copies; elites return 3', () => {
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 1, seed: 5 }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  const id = chessOfTier(2).find((c) => m.pool.has(c));
  const cap = m.pool.cap(id);
  const a = give(m, ps, id);
  assert.equal(m.pool.left(id), cap - 1);
  assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: a.uid }), { ok: true });
  assert.equal(m.pool.left(id), cap);
  const golden = DATA.chess[id].goldenId;
  const e = give(m, ps, golden);
  assert.equal(e.poolCopies, 3);
  assert.equal(m.pool.left(id), cap - 3);
  checkInvariants(m);
  m.handle('p_0', { t: 'g.sell', uid: e.uid });
  assert.equal(m.pool.left(id), cap);
  // elimination returns everything
  const ids = chessOfTier(1).filter((c) => m.pool.has(c)).slice(0, 4);
  for (const c of ids) give(m, ps, c);
  const before = ids.map((c) => m.pool.left(c));
  ps.eliminate(1);
  ids.forEach((c, i) => assert.equal(m.pool.left(c), before[i] + 1));
  checkInvariants(m);
  m.dispose();
});

// ---- the shared item pool (GitHub #466; 路标月报#2, bilibili BV1eLXXBqEgF) ------------------------------

const PACK = 'chess_item_5_07_e_a'; // 商业包装方案 — the issue's item: 2 copies a match
const GOLDEN_PACK = 'chess_item_5_07_e_b';

test('item pool caps follow config (Ⅰ4 Ⅱ6 Ⅲ7 Ⅳ8 Ⅴ7 Ⅵ3, the 8 per-item exceptions); no key → nothing pooled', () => {
  const gd = gdOf();
  const ip = new ItemPool(gd);
  assert.equal(ip.entries.size, 51, 'every shop item is pooled');
  const tierCaps = { 1: 4, 2: 6, 3: 7, 4: 8, 5: 7, 6: 3 };
  const overrides = { chess_item_2_06_e_a: 5, chess_item_4_01_e_a: 7, chess_item_4_02_e_a: 6, chess_item_4_04_e_a: 7, chess_item_4_05_e_a: 6, chess_item_4_08_e_a: 7, chess_item_4_10_e_a: 6, chess_item_5_07_e_a: 2 };
  for (const [id, e] of ip.entries) {
    assert.equal(e.cap, overrides[id] ?? tierCaps[DATA.items[id].tier], id);
    assert.equal(e.left, e.cap, id);
    assert.equal(e.tier, DATA.items[id].tier, id);
  }
  assert.equal(ip.cap(PACK), 2, 'the issue: 商业包装方案 twice a match');
  assert.equal(ip.left('chess_item_2_03_e_a'), 0, 'effect-only 突变细胞 is not pooled');
  assert.equal(ip.left(PACK + 'x'), 0, 'unknown ids are not pooled');
  assert.ok(ip.tierLeft(5) > 0 && ip.tierLeft(9) === 0);
  const gdBare = new GameData({ ...DATA, config: { ...DATA.config, economy: { ...DATA.config.economy, itemPoolCopies: undefined, itemPoolCopiesOverrides: undefined } } }, 'mode_multi_normal');
  assert.equal(new ItemPool(gdBare).entries.size, 0, 'a config without the key pools nothing');
  assert.equal(gdBare.itemPoolCopies(PACK), 0);
});

test('item pool take/give mirror the chess pool; the draws are copy-weighted', () => {
  const ip = new ItemPool(gdOf());
  const cap = ip.cap(PACK);
  assert.equal(ip.take(PACK, 3), 2, 'take clamps at what is left');
  assert.equal(ip.left(PACK), 0);
  assert.equal(ip.take(PACK, 1), 0);
  assert.equal(ip.give(PACK, 100), cap, 'give clamps at the cap');
  assert.equal(ip.take('nope', 1), 0);
  assert.equal(ip.take(PACK, -1), 0);
  // copy-weighted: exhaust every tier-5 item but one, that one always comes
  const rng = createRng(21);
  const t5 = [...ip.entries].filter(([, e]) => e.tier === 5).map(([id]) => id).sort();
  for (const id of t5) if (id !== PACK) ip.take(id, 100);
  ip.take(PACK, 1);
  const rest = t5.filter((id) => ip.left(id) > 0);
  assert.equal(rest.length, 1, 'exactly one tier-5 item has copies left');
  for (let i = 0; i < 100; i++) assert.equal(ip.roll(rng, { tiers: [5] }), rest[0]);
  ip.take(rest[0], 100);
  assert.equal(ip.roll(rng, { tiers: [5] }), null, 'sold out within the tier list → null');
  for (const id of t5) ip.give(id, 100);
  assert.ok(ip.totalLeft() > 0);
});

test('a match grants 商业包装方案 twice at most: buys take, grants hold 0 when sold out, destroys give back', () => {
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 1, seed: 5, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  assert.equal(m.itemPool.cap(PACK), 2);
  const a = ps.acquireItem(PACK, { source: 'test' });
  assert.equal(a.poolCopies, 1);
  assert.equal(m.itemPool.left(PACK), 1);
  const b = ps.acquireItem(PACK, { source: 'test' });
  assert.equal(b.id, GOLDEN_PACK, 'the second copy merges');
  assert.equal(b.poolCopies, 2, 'the golden holds the two normals\' copies');
  assert.equal(m.itemPool.left(PACK), 0);
  // sold out: the shop slot never draws it and a third grant arrives without copies
  const rng = createRng(3);
  for (let i = 0; i < 500; i++) assert.notEqual(m.itemPool.roll(rng, { maxTier: 6 }), PACK, 'sold-out items are never drawn');
  const c = ps.acquireItem(PACK, { source: 'test' });
  assert.ok(c, 'a grant still resolves');
  assert.equal(c.poolCopies, 0, 'but holds no pool copy');
  assert.equal(m.itemPool.left(PACK), 0);
  // destroying the golden gives its two copies back
  const loc = ps.find(b.uid);
  assert.deepEqual(m.handle('p_0', { t: 'g.destroy', uid: loc.piece.uid }), { ok: true });
  assert.equal(m.itemPool.left(PACK), 2);
  checkInvariants(m);
  m.dispose();
});

test('整备 (the next bought item becomes golden) takes the golden\'s second pool copy', () => {
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 1, seed: 5, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  const id = 'chess_item_1_05_e_a'; // 源石溶剂 — a mergeable normal tier-1 item (cap 4), no owned twin
  const piece = ps.acquireItem(id, { source: 'test' });
  assert.equal(piece.poolCopies, 1);
  const cap = m.itemPool.cap(id);
  assert.ok(ps.upgradeItem(piece));
  assert.ok(m.gd.isGolden(piece.id));
  assert.equal(piece.poolCopies, 2, 'the in-place golden holds both copies');
  assert.equal(m.itemPool.left(id), cap - 2);
  checkInvariants(m);
  m.dispose();
});

test('a 特质-produced item (SERVER_GAIN_EQUIP) holds no pool copy; any other grant takes one', () => {
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 1, seed: 5, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  const food = 'chess_item_3_05_e_a'; // 迅捷作战粮 — 诗怀雅/卡涅利安/蜜蜡's trait produces it
  const cap = m.itemPool.cap(food);
  const produced = ps.acquireItem(food, { source: 'test', fromPool: false });
  assert.equal(produced.poolCopies, 0, 'the trait\'s item does not run through the pool');
  assert.equal(m.itemPool.left(food), cap);
  const granted = ps.acquireItem(food, { source: 'test' });
  assert.equal(granted.poolCopies, 1, 'any other acquisition path counts');
  assert.equal(m.itemPool.left(food), cap - 1);
  checkInvariants(m);
  m.dispose();
});

test('a directly granted golden item takes both pool copies (金占 2 张)', () => {
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 1, seed: 5, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  const gold = 'chess_item_1_02_e_b'; // a golden 坚守盾牌 (画卷 copies goldens too)
  const cap = m.itemPool.cap('chess_item_1_02_e_a');
  const piece = ps.acquireItem(gold, { source: 'test' });
  assert.equal(piece.poolCopies, 2, 'the golden holds both copies');
  assert.equal(m.itemPool.left('chess_item_1_02_e_a'), cap - 2);
  const loc = ps.find(piece.uid);
  assert.deepEqual(m.handle('p_0', { t: 'g.destroy', uid: loc.piece.uid }), { ok: true });
  assert.equal(m.itemPool.left('chess_item_1_02_e_a'), cap, 'destroying it gives both back');
  checkInvariants(m);
  m.dispose();
});

test('a handler-destroyed operator returns its equipment\'s pool copies even when there is no room for it', () => {
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 1, seed: 5, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  // a carrier with two pooled items equipped; then hand 10/10 + temp 5/5 — the destroy's returned equipment
  // finds room only for one, the other is dropped with no space and must give its copy back
  const carrier = give(m, ps, chessOfTier(1)[0], 'hand');
  const shield = ps.acquireItem('chess_item_1_02_e_a', { source: 'test' });
  const solvent = ps.acquireItem('chess_item_1_05_e_a', { source: 'test' });
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: shield.uid, targetUid: carrier.uid }), { ok: true });
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: solvent.uid, targetUid: carrier.uid }), { ok: true });
  const t1 = chessOfTier(1);
  for (let i = 0; i < 9; i++) give(m, ps, t1[(i + 1) % t1.length], 'hand');
  for (let i = 0; i < 5; i++) give(m, ps, t1[(i + 2) % t1.length], 'temp');
  const capShield = m.itemPool.cap('chess_item_1_02_e_a');
  const capSolvent = m.itemPool.cap('chess_item_1_05_e_a');
  assert.equal(m.itemPool.left('chess_item_1_02_e_a'), capShield - 1);
  assert.equal(m.itemPool.left('chess_item_1_05_e_a'), capSolvent - 1);
  const ctx = makeCtx(m, ps, { key: 'test:destroy' }, 'onRoundStart');
  assert.ok(ctx.destroyPiece(carrier.uid), 'the carrier is destroyed');
  assert.equal(m.itemPool.left('chess_item_1_02_e_a'), capShield - 1, 'the stowed shield keeps its copy held');
  assert.equal(m.itemPool.left('chess_item_1_05_e_a'), capSolvent, 'the dropped solvent\'s copy went back');
  checkInvariants(m);
  m.dispose();
});
