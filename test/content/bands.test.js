// The 40 strategies (bands): prep side (server/sim/content/bands/meta.js through the real registry + dispatcher) and
// battle side (bands/battle.js with synthetic operators / enemies for exact numbers). Numbers are the band blackboards
// (data/bands.json, research 01 §11); every band is covered (last test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { makeMatch, give, giveItem, DATA } from '../match/harness.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { hasBattlePart, amedicCharsFor, PRIO_BAND_REVIVE } from '../../server/sim/content/bands/battle.js';
import { bandMetaHandler, duckReplace } from '../../server/sim/content/bands/meta.js';
import { PRIO_RESPAWN } from '../../server/sim/content/items/battle.js';
import * as bands from '../../server/sim/content/bands.js';

const QUIET = { warn() {}, error() {}, info() {} };
const REG = createRegistry({ log: QUIET });
const COVER = new Set();
const cover = (...ids) => { for (const id of ids) { assert.ok(DATA.bands[id], id); COVER.add(id); } };
const close = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);
const OK = { ok: true };
const A = (k) => `chess_item_${k}_e_a`;

// ---------------------------------------------------------------------------------------------------------------
// prep helpers

function setup({ band, mode = 'solo', humans = 1, seed = 41, bands: perPlayer = null } = {}) {
  const h = makeMatch({ mode, humans, seed, registry: REG, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  for (const ps of m.players.values()) {
    for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
    ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.offers.length = 0;
    ps.funds = 50; ps.layers = {}; ps.pendingFunds = 0; ps.shop.freeRefreshes = 0; ps.counters = {};
    ps.bandId = perPlayer ? perPlayer[ps.playerId] ?? null : null;
    ps.recompute();
  }
  const ps = h.ps('p_0');
  if (band) ps.bandId = band;
  const at = (r) => { m.round = r; };
  const roundStart = (r, who = ps) => { at(r); m.dispatch(who, 'onRoundStart', { round: r }); };
  const prepEnd = (who = ps) => m.dispatch(who, 'onPrepEnd', { round: m.round });
  return { h, m, ps, at, roundStart, prepEnd };
}
const handIds = (ps, kind) => [...ps.hand, ...ps.temp].filter((p) => p && (!kind || p.kind === kind)).map((p) => p.id);
const plain = (pred = () => true) => Object.values(DATA.chess)
  .filter((c) => c.visible && !c.isGolden && (c.garrisonIds || []).every((g) => DATA.garrisons[g].eventType === 'IN_BATTLE') && pred(c))
  .map((c) => c.chessId).sort();
/** Chess acquired with a source (band grants use 'band' / the band key). */
function spyGrants(ps, pred = (o) => /band/.test(String(o.source || ''))) {
  const got = [];
  const orig = ps.acquireChess.bind(ps);
  ps.acquireChess = (id, o = {}) => { const p = orig(id, o); if (p && pred(o)) got.push(id); return p; };
  return got;
}
const inPool = (m, id) => m.pool.has(id) && m.pool.left(id) > 0;
const bondPool = (m, bond, maxTier) => Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && c.tier <= maxTier && c.bonds.includes(bond) && inPool(m, c.chessId)).map((c) => c.chessId);
/** First seed ≥ `from` whose match pool offers ≥ n chess of `bond` up to `maxTier`. */
function seedWithBond(bond, maxTier, n, from = 40) {
  for (let s = from; s < from + 60; s++) {
    const h = makeMatch({ mode: 'solo', seed: s, registry: REG, fake: true });
    if (bondPool(h.m, bond, maxTier).length >= n) return s;
  }
  throw new Error(`no seed with ${n} ${bond}`);
}
const slotOf = (id) => ({ kind: 'chess', id, basePrice: DATA.chess[id].tier === 1 ? 2 : DATA.chess[id].tier <= 4 ? 3 : 4, frozen: false, sold: false });

// ---------------------------------------------------------------------------------------------------------------
// data / wiring

test('bands.js wires both parts: 28 bands with a prep handler, 10 with a battle part, 鸭爵 global, 歌利亚 = LP only', () => {
  assert.equal(typeof bands.install, 'function');
  assert.equal(typeof bands.registerMeta, 'function');
  const ids = Object.keys(DATA.bands);
  assert.equal(ids.length, 40);
  const meta = ids.filter((id) => REG.has(`band:${id}`));
  const battle = ids.filter(hasBattlePart);
  assert.equal(meta.length, 28);
  assert.deepEqual(battle.sort(), ['band_amedic', 'band_amiya', 'band_chen', 'band_clementia', 'band_dusk', 'band_emperor', 'band_ermengard', 'band_humus', 'band_ioleta', 'band_mberry', 'band_qalaisa'].sort());
  assert.ok(REG.has('global:bands_ducklord'));
  const none = ids.filter((id) => !meta.includes(id) && !battle.includes(id));
  assert.deepEqual(none.sort(), ['band_ducklord', 'band_sarkazb']);
  for (const id of ids) if (!meta.includes(id)) assert.equal(bandMetaHandler(id), null, id);
});

test('starting LP = totalHp for every band (歌利亚 坚不可摧 45, 铃兰 20)', () => {
  const { m } = setup();
  for (const [id, b] of Object.entries(DATA.bands)) assert.equal(m.gd.startLp(id), b.totalHp, id);
  assert.equal(m.gd.startLp('band_sarkazb'), 45);
  assert.equal(m.gd.startLp('band_lisa'), 20);
  cover('band_sarkazb');
});

// ---------------------------------------------------------------------------------------------------------------
// prep side

test('华法琳 重点监护: prep end — for every distinct tier on the board, 1 random operator\'s bonds +2 layers (无需激活)', () => {
  for (let s = 0; s < 6; s++) {
    const { m, ps, prepEnd } = setup({ band: 'band_bldsk', seed: 50 + s });
    give(m, ps, 'chess_char_1_04_a', 'board', [10, 3]); // T1 阿戈尔
    give(m, ps, 'chess_char_1_09_a', 'board', [10, 4]); // T1 精准
    give(m, ps, 'chess_char_2_06_a', 'board', [10, 5]); // T2 萨尔贡
    give(m, ps, 'chess_char_3_06_a', 'hand');            // hand: ignored
    prepEnd();
    assert.equal(ps.layers.sargonShip, 2, 'the only T2');
    assert.equal((ps.layers.egirShip || 0) + (ps.layers.preciShip || 0), 2, 'exactly one of the T1 operators');
    assert.equal(Object.values(ps.layers).reduce((a, b) => a + b, 0), 4);
  }
  cover('band_bldsk');
});

test('杜遥夜 广交豪杰: the first 2 manual refreshes of a round show ≥ 1 <炎> operator; the 3rd is a normal refresh', () => {
  const seed = seedWithBond('yanShip', 3, 2);
  let forced = 0, third = 0;
  for (let k = 0; k < 8; k++) {
    const { m, ps } = setup({ band: 'band_duyaoy', seed });
    ps.shop.level = 3;
    const yanIn = () => ps.shop.slots.some((sl) => sl && sl.kind === 'chess' && DATA.chess[sl.id].bonds.includes('yanShip'));
    for (let i = 0; i < k; i++) { ps.shop.freeRefreshes = 1; m.handle('p_0', { t: 'g.refresh' }); } // randomise the stream
    ps.round.refreshes = 0;
    assert.deepEqual(m.handle('p_0', { t: 'g.refresh' }), OK);
    assert.ok(yanIn(), 'refresh 1');
    assert.deepEqual(m.handle('p_0', { t: 'g.refresh' }), OK);
    assert.ok(yanIn(), 'refresh 2');
    forced++;
    m.handle('p_0', { t: 'g.refresh' });
    if (!yanIn()) third++;
  }
  assert.equal(forced, 8);
  assert.ok(third >= 1, 'the 3rd refresh is not special');
  cover('band_duyaoy');
});

test('梓兰 猎头顾问: every manual refresh copies the highest-tier shop operator into another slot and freezes the copy; R10 寻呼模块', () => {
  const { m, ps, roundStart } = setup({ band: 'band_orchid', seed: 12 });
  ps.shop.level = 4;
  for (let i = 0; i < 4; i++) {
    assert.deepEqual(m.handle('p_0', { t: 'g.refresh' }), OK);
    const chess = ps.shop.slots.filter((sl) => sl && sl.kind === 'chess');
    const top = Math.max(...chess.map((sl) => DATA.chess[sl.id].tier));
    const pairs = chess.filter((sl) => DATA.chess[sl.id].tier === top);
    const ids = pairs.map((sl) => sl.id);
    const dup = ids.find((id, j) => ids.indexOf(id) !== j);
    assert.ok(dup, 'two identical top-tier operators');
    assert.ok(chess.some((sl) => sl.id === dup && sl.frozen), 'one of them frozen');
    assert.equal(ps.shop.frozen, false);
  }
  roundStart(9);
  assert.deepEqual(handIds(ps, 'item'), []);
  roundStart(10);
  assert.deepEqual(handIds(ps, 'item'), [A('4_01')]);
  cover('band_orchid');
});

test('fixed-round grants: 小贾斯汀 / 昆图斯 / 马克维茨 / 变形者集群 / 杰西卡 / 缪尔赛思 / 芬 / Pith / 夕 (进入休整期时)', () => {
  const CASES = [
    ['band_justin', A('3_12'), [1, 4, 7, 10]],
    ['band_quintus', A('5_08'), [3]],
    ['band_malkie', A('5_07'), [1]],
    ['band_damaztic', A('6_09'), [5, 10, 15]],
    ['band_jesica', A('4_01'), [4, 7, 10, 13]],
    ['band_mlyss', 'chess_item_5_06_e_b', [1]],
    ['band_fang', A('5_04'), [8, 10, 12, 14]],
    ['band_pith', 'chess_char_1_15_a', [1]],
    ['band_dusk', 'chess_item_6_02_m', [1]],
  ];
  for (const [band, id, rounds] of CASES) {
    const { ps, roundStart } = setup({ band, seed: 5 });
    for (let r = 1; r <= 15; r++) {
      const before = handIds(ps).filter((x) => x === id).length;
      roundStart(r);
      const got = handIds(ps).filter((x) => x === id).length - before;
      assert.equal(got, rounds.includes(r) ? 1 : 0, `${band} R${r}`);
      ps.hand.fill(null); ps.temp.fill(null);
    }
    cover(band);
  }
});

test('杜宾 加练！: a 教鞭 every 2 rounds (even rounds)', () => {
  const { ps, roundStart } = setup({ band: 'band_doberm' });
  const got = [];
  for (let r = 1; r <= 8; r++) {
    roundStart(r);
    if (handIds(ps, 'item').includes('chess_item_6_03_m')) got.push(r);
    ps.hand.fill(null);
  }
  assert.deepEqual(got, [2, 4, 6, 8]);
  cover('band_doberm');
});

test('老鲤 得闲饮茶: income R1 0, R2 0, R3 15; R3 round start: 1 random tier-II and 1 tier-IV operator', () => {
  const { m, ps, at, roundStart } = setup({ band: 'band_lmlee', seed: 14 });
  const got = [];
  for (const r of [1, 2, 3, 4]) {
    at(r);
    ps.funds = 0;
    ps.startRound(r);
    got.push(ps.funds);
  }
  assert.deepEqual(got, [0, 0, 15, m.gd.income(4)]);
  const grants = spyGrants(ps);
  roundStart(3);
  assert.deepEqual(grants.map((id) => DATA.chess[id].tier).sort(), [2, 4]);
  roundStart(4);
  assert.equal(grants.length, 2);
  cover('band_lmlee');
});

test('绮良 通关奖励: every 20 funds spent ⇒ 1 random operator of tier ≤ shop level', () => {
  const { ps } = setup({ band: 'band_kirara', seed: 21 });
  ps.shop.level = 2;
  const grants = spyGrants(ps);
  const spend = (n) => { ps.spend(n); ps._afterSpend(n, 'test'); };
  spend(19);
  assert.equal(grants.length, 0);
  spend(1);
  assert.equal(grants.length, 1);
  ps.funds = 100;
  spend(45);
  assert.equal(grants.length, 3, '40 more ⇒ 2 more (5 carried)');
  spend(15);
  assert.equal(grants.length, 4);
  for (const id of grants) assert.ok(DATA.chess[id].tier <= 2 && !DATA.chess[id].isGolden);
  cover('band_kirara');
});

test('佩佩 博学多通: upgrading to 2 / 4 / 6 makes the next refresh special (paid as usual) — its operators are <萨尔贡> first', () => {
  const seed = seedWithBond('sargonShip', 2, 2);
  const { m, ps } = setup({ band: 'band_pepe', seed });
  ps.shop.upgradePrice = 0;
  assert.deepEqual(m.handle('p_0', { t: 'g.levelUp' }), OK);
  assert.equal(ps.shop.level, 2);
  assert.equal(ps.shop.freeRefreshes, 0, 'no free refresh comes with it (community report of 2026-10-06)');
  const f0 = ps.funds;
  assert.deepEqual(m.handle('p_0', { t: 'g.refresh' }), OK);
  assert.equal(ps.funds, f0 - m.gd.refreshPrice, 'the usual refresh price');
  const chess = ps.shop.slots.filter((sl) => sl && sl.kind === 'chess');
  assert.ok(chess.length >= 3 && chess.every((sl) => DATA.chess[sl.id].bonds.includes('sargonShip')), 'all 萨尔贡');
  assert.equal(ps.counters['band:pepe:special'], 0, 'consumed');
  ps.shop.upgradePrice = 0;
  assert.deepEqual(m.handle('p_0', { t: 'g.levelUp' }), OK);
  assert.equal(ps.shop.level, 3);
  assert.equal(ps.shop.freeRefreshes, 0, 'level 3 is not in lvlist');
  cover('band_pepe');
});

test('哈洛德 人才盲盒: from R4 every 2 rounds a <维多利亚> operator', () => {
  const { ps, roundStart } = setup({ band: 'band_harold', seed: 18 });
  ps.shop.level = 3;
  const grants = spyGrants(ps);
  const by = {};
  for (let r = 1; r <= 9; r++) { const n = grants.length; roundStart(r); by[r] = grants.length - n; }
  assert.deepEqual(by, { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0, 6: 1, 7: 0, 8: 1, 9: 0 });
  for (const id of grants) assert.ok(DATA.chess[id].bonds.includes('victoriaShip'));
  cover('band_harold');
});

test('休露丝 雪域礼赠: the first <谢拉格> operator bought each round costs 1', () => {
  const { m, ps, at } = setup({ band: 'band_sciurus', seed: 3 });
  ps.shop.slots = [slotOf('chess_char_2_05_a'), slotOf('chess_char_3_11_a'), slotOf('chess_char_2_06_a')];
  assert.equal(ps.priceOf(ps.shop.slots[0]), 1);
  assert.equal(ps.priceOf(ps.shop.slots[1]), 1);
  assert.equal(ps.priceOf(ps.shop.slots[2]), 3, 'not 谢拉格');
  const f0 = ps.funds;
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 1 }), OK);
  assert.equal(f0 - ps.funds, 1);
  assert.equal(ps.priceOf(ps.shop.slots[0]), 3, 'second one: full price');
  at(m.round + 1);
  assert.equal(ps.priceOf(ps.shop.slots[0]), 1, 'new round');
  cover('band_sciurus');
});

test('潘格尼尼 定制铳械: after 55 funds spent in total, 1 random elite <拉特兰> operator of tier ≥ IV (once)', () => {
  const seed = seedWithBond('lateranoShip', 6, 3);
  const { ps } = setup({ band: 'band_paganini', seed });
  ps.funds = 200;
  const grants = spyGrants(ps);
  const spend = (n) => { ps.spend(n); ps._afterSpend(n, 'test'); };
  spend(30); spend(24);
  assert.equal(grants.length, 0);
  spend(1);
  assert.equal(grants.length, 1);
  const c = DATA.chess[grants[0]];
  assert.ok(c.isGolden && c.tier >= 4 && c.bonds.includes('lateranoShip'), grants[0]);
  spend(60);
  assert.equal(grants.length, 1, 'once');
  cover('band_paganini');
});

test('余 文火慢炖: R8 round start — exactly 1 active bond +36 layers, otherwise every active bond +12', () => {
  let s = setup({ band: 'band_yu' });
  s.ps.bondCountBonus.yanShip = 20; s.ps.recompute();
  s.roundStart(7);
  assert.equal(s.ps.layers.yanShip || 0, 0);
  s.roundStart(8);
  assert.equal(s.ps.layers.yanShip, 36);
  s = setup({ band: 'band_yu' });
  s.ps.bondCountBonus.yanShip = 20; s.ps.bondCountBonus.sargonShip = 20; s.ps.recompute();
  s.roundStart(8);
  assert.equal(s.ps.layers.yanShip, 12);
  assert.equal(s.ps.layers.sargonShip, 12);
  assert.equal(s.ps.layers.victoriaShip || 0, 0, 'inactive bonds get nothing');
  cover('band_yu');
});

test('余 文火慢炖 adds no layers to a bond without layers (noStack: 独行, 绝技 …) — the owner\'s decision of 2026-10-08', () => {
  assert.deepEqual(Object.values(DATA.bonds).filter((b) => b.noStack).map((b) => b.name).sort(), ['协防干员', '独行', '绝技', '调和'].sort());
  for (const [bonus, want] of [
    [{ soloShip: 1 }, {}],                          // the one active bond is 独行: nothing at all
    [{ suntShip: 5 }, {}],                          // … or 绝技
    [{ soloShip: 1, yanShip: 20 }, { yanShip: 12 }], // two active (the sentence's count): the layered one +12, 独行 none
  ]) {
    const s = setup({ band: 'band_yu' });
    Object.assign(s.ps.bondCountBonus, bonus); s.ps.recompute();
    for (const id of Object.keys(bonus)) assert.ok(s.ps.bonds[id]?.active, `${id} active`);
    s.roundStart(8);
    const got = Object.fromEntries(Object.entries(s.ps.layers).filter(([, v]) => v > 0));
    assert.deepEqual(got, want, JSON.stringify(bonus));
  }
});

test('凯瑟琳 定向投放: every shop upgrade offers 3 different shop items (any tier — community report of 2026-10-06), 1 free pick', () => {
  const { m, ps } = setup({ band: 'band_cathy', seed: 9 });
  for (const lvl of [2, 3]) {
    ps.shop.upgradePrice = 0;
    ps.offers.length = 0;
    assert.deepEqual(m.handle('p_0', { t: 'g.levelUp' }), OK);
    const offer = ps.offers[0];
    assert.ok(offer, `offer at L${lvl}`);
    const ids = offer.slots.map((sl) => sl.id);
    assert.equal(ids.length, 3);
    assert.equal(new Set(ids).size, 3);
    for (const id of ids) assert.ok(offer.slots[0].kind === 'item' && !DATA.items[id].shopExcluded && !DATA.items[id].isGolden, id);
  }
  const f0 = ps.funds;
  const pick = ps.offers[0].slots[2].id;
  assert.deepEqual(m.handle('p_0', { t: 'g.reward', idx: 2 }), OK);
  assert.equal(ps.funds, f0);
  assert.ok(handIds(ps, 'item').includes(pick) || handIds(ps, 'item').includes(DATA.items[pick].goldenId));
  cover('band_cathy');
});

test('坎诺特 利滚利: leftover funds are kept; ≥ 5 left ⇒ +1 at round start (max 1)', () => {
  const { m, ps, at } = setup({ band: 'band_cannot' });
  ps.funds = 13;
  ps.endPrep();
  assert.equal(ps.funds, 13, 'kept at prep end');
  at(4);
  ps.startRound(4);
  assert.equal(ps.funds, 13 + m.gd.income(4) + 1);
  ps.funds = 4;
  ps.startRound(5);
  assert.equal(ps.funds, 4 + m.gd.income(5), 'fewer than 5 left: no interest');
  cover('band_cannot');
});

test('鸭爵 “神秘顾客”: from R5, 0–2 ground enemies in the last 40 % of every teammate\'s wave become 鸭爵 & co. worth 1 fund to the killer', () => {
  const p = DATA.bands.band_ducklord.buffs[0];
  const ducks = p.bbStr.enemylist.split(',');
  const normalKey = Object.values(DATA.enemies).find((e) => e.rank === 'NORMAL' && e.stats.motion === 'WALK').key;
  const flyKey = Object.values(DATA.enemies).find((e) => e.rank === 'NORMAL' && e.stats.motion === 'FLY').key;
  const wave = () => Array.from({ length: 10 }, (_, i) => ({ time: i * 2, enemyKey: i === 8 ? flyKey : normalKey, routeIndex: 0, count: 1 }));
  const { h, m } = setup({ mode: 'coop', humans: 2, seed: 4, bands: { p_1: 'band_ducklord' } });
  const p0 = h.ps('p_0');
  const counts = {};
  for (let k = 0; k < 30; k++) {
    m.round = 5;
    const ev = { input: p0.battleInput({ side: 'L', colOffset: 0 }), kind: 'normal', round: 5, spawns: wave() };
    m.dispatch(p0, 'onBattleStart', ev);
    const dk = ev.spawns.filter((sp) => ducks.includes(sp.enemyKey));
    counts[dk.length] = (counts[dk.length] || 0) + 1;
    assert.equal(ev.spawns.length, 10, 'same enemy count');
    for (const d of dk) {
      assert.deepEqual(d.bounty, { coins: 1, ownerPlayerId: 'p_0' });
      assert.ok(d.time >= 0.6 * 18 - 1e-9, `late part of the wave (${d.time})`);
    }
    assert.ok(ev.spawns.some((sp) => sp.enemyKey === flyKey), 'flyers are never replaced');
  }
  assert.deepEqual(Object.keys(counts).map(Number).sort(), [0, 1, 2]);
  // before R5, in the 联防 phase (its enemies are leaks), or when nobody holds the band: nothing (the Final Assault and
  // the Hidden Core swap too: test/match/feedback1-ducklord.test.js)
  for (const [r, kind, band] of [[4, 'normal', 'band_ducklord'], [5, 'unite', 'band_ducklord'], [5, 'normal', null]]) {
    h.ps('p_1').bandId = band;
    m.round = r;
    const ev = { input: p0.battleInput({ side: 'L', colOffset: 0 }), kind, round: r, spawns: wave() };
    m.dispatch(p0, 'onBattleStart', ev);
    assert.ok(!ev.spawns.some((sp) => ducks.includes(sp.enemyKey)), `R${r} ${kind} ${band}`);
  }
  // duckReplace keeps unreplaced copies of a multi-count spec
  const ctx = { gd: m.gd, rng: Object.assign(() => 0, m.rngMeta) };
  ctx.rng.int = () => 2; ctx.rng.shuffle = (a) => a; ctx.rng.pick = (a) => a[0];
  const spawns = [{ time: 0, enemyKey: normalKey, routeIndex: 0, count: 10, interval: 1 }];
  const out = duckReplace(ctx, spawns, { ...p.bb, ...p.bbStr }, 'p_0');
  assert.equal(out.length, 2);
  assert.equal(spawns.reduce((n, sp) => n + (sp.count || 1), 0), 10);
  // a pair boss field (`side` + `routes`): only the enemies heading for the player's half (route end left / right of
  // the middle column), the 60–99 % share taken over that half — here the left half's enemies all come first
  const routes = [{ motion: 'WALK', end: [1, 3] }, { motion: 'WALK', end: [1, 17] }];
  for (const [side, route, times] of [['L', 0, [6, 7]], ['R', 1, [16, 17]], [null, 1, [12, 13]]]) {
    const field = Array.from({ length: 20 }, (_, i) => ({ time: i, enemyKey: normalKey, routeIndex: i < 10 ? 0 : 1, count: 1 }));
    const got = duckReplace(ctx, field, { ...p.bb, ...p.bbStr }, 'p_0', { routes, side });
    assert.deepEqual(got.map((d) => d.time), times, `side ${side}`);
    for (const d of got) assert.equal(d.routeIndex, route);
    assert.equal(field.length, 20);
  }
  cover('band_ducklord');
});

test('铃兰 御守之力: each round start re-triggers the 获得时 effect of the right-most (then bottom-most) board operator', () => {
  const run = (swire, yela) => {
    const { m, ps, roundStart } = setup({ band: 'band_lisa', seed: 2 });
    give(m, ps, 'chess_char_3_03_a', 'board', swire); // 诗怀雅: <获得时> 1 盟约之币
    give(m, ps, 'chess_char_3_20_a', 'board', yela);  // 耶拉: <获得时> 1 谢拉格不融冰
    roundStart(2);
    return handIds(ps, 'item');
  };
  assert.deepEqual(run([10, 8], [10, 4]), [A('1_03')], '诗怀雅 is right-most');
  assert.deepEqual(run([10, 4], [11, 8]), [A('5_02')], '耶拉 is right-most');
  assert.deepEqual(run([12, 6], [9, 6]), [A('5_02')], 'same column: the bottom one (row 9)');
  cover('band_lisa');
});

test('巫恋 替身娃娃: the first sale of a normal operator each round swaps it with a random shop operator (no funds)', () => {
  const { m, ps, at } = setup({ band: 'band_vodfox', seed: 6 });
  const [a, b, x, y] = plain((c) => c.tier === 1);
  ps.shop.slots = [slotOf(x), slotOf(y)];
  const pa = give(m, ps, a, 'hand');
  const f0 = ps.funds;
  assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: pa.uid }), OK);
  assert.equal(ps.funds, f0, 'no funds');
  const got = handIds(ps, 'chess');
  assert.equal(got.length, 1);
  assert.ok([x, y].includes(got[0]));
  assert.ok(ps.shop.slots.some((sl) => sl && sl.id === a && !sl.sold), 'the sold operator is now in the shop');
  const pb = give(m, ps, b, 'hand');
  assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: pb.uid }), OK);
  assert.equal(ps.funds, f0 + 1, 'second sale this round: normal');
  const elite = give(m, ps, DATA.chess[b].goldenId, 'hand');
  at(m.round + 1);
  assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: elite.uid }), OK);
  assert.equal(ps.funds, f0 + 2, 'elites are not 初始干员: sold normally');
  cover('band_vodfox');
});

test('松桐 九流之缘: at even rounds\' prep start 1 random shop operator is taken for free (its slot empties)', () => {
  const { ps, roundStart } = setup({ band: 'band_makiri', seed: 8 });
  const ids = plain((c) => c.tier === 1).slice(0, 3);
  for (const r of [1, 2, 3, 4]) {
    ps.shop.slots = ids.map(slotOf);
    ps.hand.fill(null);
    const f0 = ps.funds;
    roundStart(r);
    const got = handIds(ps, 'chess');
    assert.equal(got.length, r % 2 === 0 ? 1 : 0, `R${r}`);
    assert.equal(ps.shop.slots.filter(Boolean).length, r % 2 === 0 ? 2 : 3);
    assert.equal(ps.funds, f0);
  }
  cover('band_makiri');
});

test('玛恩纳 业务指标: each <卡西米尔> operator bought ⇒ +1 fund next round, at most 3 per round', () => {
  const seed = seedWithBond('kazimierzShip', 2, 2);
  const { m, ps, at } = setup({ band: 'band_mlynar', seed });
  const kaz = bondPool(m, 'kazimierzShip', 2);
  for (let i = 0; i < 4; i++) {
    ps.shop.slots = [slotOf(kaz[i % kaz.length]), slotOf(plain((c) => c.tier === 1 && !c.bonds.includes('kazimierzShip'))[0])];
    assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), OK);
  }
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 1 }), OK);
  assert.equal(ps.pendingFunds, 3);
  at(m.round + 1);
  ps.shop.slots = [slotOf(kaz[0])];
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), OK);
  assert.equal(ps.pendingFunds, 4, 'new round');
  cover('band_mlynar');
});

test('贾维 团伙行动: every 6 manual refreshes ⇒ a <叙拉古> operator (≤ shop level), at most 2 per round', () => {
  const seed = seedWithBond('siracusaShip', 4, 2);
  const { m, ps, at } = setup({ band: 'band_chiave', seed });
  ps.shop.level = 4;
  ps.funds = 100;
  const grants = spyGrants(ps);
  const refresh = (n) => { for (let i = 0; i < n; i++) assert.deepEqual(m.handle('p_0', { t: 'g.refresh' }), OK); };
  refresh(5);
  assert.equal(grants.length, 0);
  refresh(1);
  assert.equal(grants.length, 1);
  refresh(12);
  assert.equal(grants.length, 2, 'max 2 per round');
  at(m.round + 1);
  refresh(6);
  assert.equal(grants.length, 3);
  for (const id of grants) assert.ok(DATA.chess[id].bonds.includes('siracusaShip') && DATA.chess[id].tier <= 4);
  cover('band_chiave');
});

test('娜仁图亚 见者有份: even rounds\' prep start — pick 1 of 2 different items (tier ≤ shop level) for free', () => {
  const { ps, roundStart } = setup({ band: 'band_narant', seed: 13 });
  ps.shop.level = 3;
  for (const r of [1, 2, 3, 4]) {
    ps.offers.length = 0;
    roundStart(r);
    if (r % 2) { assert.equal(ps.offers.length, 0, `R${r}`); continue; }
    assert.equal(ps.offers.length, 1, `R${r}`);
    const ids = ps.offers[0].slots.map((sl) => sl.id);
    assert.equal(ids.length, 2);
    assert.equal(new Set(ids).size, 2);
    for (const id of ids) assert.ok(DATA.items[id].itemType === 'EQUIP' && DATA.items[id].tier <= 3);
  }
  cover('band_narant');
});

// ---------------------------------------------------------------------------------------------------------------
// battle side

function op(id, o = {}) {
  return chessRec({
    id, profession: o.profession ?? 'WARRIOR', bonds: o.bonds ?? [], tier: o.tier ?? 1, golden: !!o.golden,
    rangeGrid: o.range ?? [[0, 0], [0, 1]],
    stats: { maxHp: 2000, atk: 500, def: 200, res: 0, aspd: 100, bat: 1, respawnTime: 20, spRecovery: 1, blockCnt: 2, ...(o.stats || {}) },
    skill: { spCost: 60, duration: 5, initSp: 0, ...(o.skill || {}) },
  });
}
const DUMMY = (key = 'e_d', o = {}) => enemyRec({ key, hp: 1e7, speed: 0, ...o });
function fight({ band, ops = { t_op: op('t_op') }, units, foes = [], enemies = {}, bonds, players, kind, stageId, flags } = {}) {
  return makeBattle({
    defs: { chess: ops, enemies: { e_d: DUMMY(), ...enemies } }, units, players, kind, stageId, flags, bandId: band, bonds,
    enemies: foes.map(([r, c, key]) => ({ key: key ?? 'e_d', pos: [r, c] })), timeLimit: 999, autoFinish: false,
  });
}
const active = (...ids) => Object.fromEntries(ids.map((id) => [id, { count: 3, active: true, tier: 1, layers: 0 }]));
const foe = (h, i = 0) => h.b.enemies.filter((e) => e.alive)[i];
function forceRng(h, v) { const orig = h.b.rng; h.b.rng = Object.assign(() => v, orig); }

test('阿米娅 众志合一: 3 / 4 / ≥ 5 active bonds ⇒ every operator ATK and HP ×1.2 / ×1.3 / ×1.4', () => {
  const ALL = ['yanShip', 'sargonShip', 'victoriaShip', 'kjeragShip', 'lateranoShip', 'egirShip'];
  for (const [n, mul] of [[2, 1], [3, 1.2], [4, 1.3], [5, 1.4], [6, 1.4]]) {
    const h = fight({ band: 'band_amiya', bonds: active(...ALL.slice(0, n)), units: [{ chessId: 't_op', row: 10, col: 4 }] });
    h.step(1);
    const u = h.unit('t_op');
    close(u.s.atk, 500 * mul, `${n} bonds ATK`);
    close(u.s.maxHp, 2000 * mul, `${n} bonds HP`);
    close(u.hp, u.s.maxHp, 'deployed at full HP');
  }
  const inactive = fight({ band: 'band_amiya', bonds: { ...active('yanShip', 'sargonShip'), victoriaShip: { count: 1, active: false, tier: 0, layers: 50 } }, units: [{ chessId: 't_op', row: 10, col: 4 }] });
  inactive.step(1);
  close(inactive.unit('t_op').s.atk, 500, 'inactive bonds do not count');
  cover('band_amiya');
});

test('埃芒加德 命结之秘: the first 3 knock-downs of the battle revive at full HP (after the operators\' own revive items) — a knock-out and a free redeploy', () => {
  const ops = { t_op: op('t_op'), t_b: op('t_b') };
  const h = fight({ band: 'band_ermengard', ops, units: [{ chessId: 't_op', row: 10, col: 4, items: [A('4_12')] }, { chessId: 't_b', row: 11, col: 4 }], foes: [[10, 9]] });
  const log = [];
  h.b.on('death', (c) => log.push(['death', c.unit.defId, c.revivedBy ?? null]), { priority: -1000 });
  h.b.on('deploy', (c) => { if (!c.initial && c.unit.side === 'ally') log.push(['deploy', c.unit.defId]); }, { priority: -1000 });
  h.step(1);
  const [a, b] = [h.unit('t_op'), h.unit('t_b')];
  const kill = (u) => h.b.dealDamage(foe(h), u, { amount: 1e6, type: 'true' });
  kill(a); // M3茧甲 first
  assert.ok(a.alive);
  kill(a); kill(b); kill(b); // band revives 1, 2, 3
  assert.ok(a.alive && b.alive);
  close(b.hp, 2000, 'full HP');
  // PRTS 备注 "“复活”的实现方式为：受益者因移动之外的原因退场时下次部署的再部署时间和费用归零": each revive is a knock-out
  // (death hooks — 被击倒时 effects) and an immediate free redeploy where it lies (deploy hooks — 部署时 effects)
  assert.deepEqual(log.filter((x) => x[0] === 'death').map((x) => x.slice(1)), [['t_op', 'item'], ['t_op', 'band'], ['t_b', 'band'], ['t_b', 'band']]);
  assert.deepEqual(log.filter((x) => x[0] === 'deploy').map((x) => x[1]), ['t_op', 't_op', 't_b', 't_b'], 'each knock-out redeployed at once');
  kill(a);
  assert.equal(a.alive, false, '4th knock-down of the band: dies');
  assert.ok(PRIO_BAND_REVIVE < PRIO_RESPAWN, 'the band after the item revive (both death hooks, after every fatal saver)');
  cover('band_ermengard');
});

test('克莱门莎 崇高牺牲: a <阿戈尔> operator knocked down ⇒ +its tier <阿戈尔> layers (requires activation; none in 联防/boss)', () => {
  const ops = { t_eg: op('t_eg', { bonds: ['egirShip'], tier: 3 }), t_x: op('t_x', { bonds: ['yanShip'], tier: 5 }) };
  const h = fight({ band: 'band_clementia', bonds: active('egirShip'), ops, units: [{ chessId: 't_eg', row: 10, col: 4 }, { chessId: 't_x', row: 11, col: 4 }], foes: [[10, 9]] });
  h.step(1);
  h.b.dealDamage(foe(h), h.unit('t_eg'), { amount: 1e6, type: 'true' });
  h.b.dealDamage(foe(h), h.unit('t_x'), { amount: 1e6, type: 'true' });
  h.b.retreat(h.unit('t_eg')); // not knocked down: nothing (already dead anyway)
  assert.deepEqual(h.b.result().perPlayer.p1.layerGains, { egirShip: 3 });
  const u = fight({ band: 'band_clementia', bonds: active('egirShip'), kind: 'unite', ops, units: [{ chessId: 't_eg', row: 10, col: 4 }], foes: [[10, 9]] });
  u.step(1);
  u.b.dealDamage(foe(u), u.unit('t_eg'), { amount: 1e6, type: 'true' });
  assert.deepEqual(u.b.result().perPlayer.p1.layerGains, {});
  const inactive = fight({ band: 'band_clementia', ops, units: [{ chessId: 't_eg', row: 10, col: 4 }], foes: [[10, 9]] });
  inactive.step();
  inactive.b.dealDamage(foe(inactive), inactive.unit('t_eg'), { amount: 1e6, type: 'true' });
  assert.deepEqual(inactive.b.result().perPlayer.p1.layerGains, {}, 'an inactive 阿戈尔 bond gains no layers');
  cover('band_clementia');
});

test('大帝 加急调派: every deployment halves the operator\'s next redeploy time (cumulative)', () => {
  const h = fight({ band: 'band_emperor', units: [{ chessId: 't_op', row: 10, col: 4 }] });
  h.step(1);
  const u = h.unit('t_op');
  h.b.kill(u);
  close(u.respawnAt - h.b.time, 10, 'after the initial deployment');
  h.runUntil(() => u.alive, 30);
  h.b.kill(u);
  close(u.respawnAt - h.b.time, 5, 'after the redeployment');
  const plainH = fight({ units: [{ chessId: 't_op', row: 10, col: 4 }] });
  plainH.step(1);
  plainH.b.kill(plainH.unit('t_op'));
  close(plainH.unit('t_op').respawnAt - plainH.b.time, 20, 'without the band');
  cover('band_emperor');
});

test('大帝 加急调派 stacks without a cap: the 21st and 22nd deployments still halve the next redeploy (PRTS "※该策略效果可无限叠加"; GitHub #328, PR #329)', () => {
  const h = fight({ band: 'band_emperor', units: [{ chessId: 't_op', row: 10, col: 4 }] });
  h.step(1);
  const u = h.unit('t_op');
  for (let n = 1; n <= 22; n++) {
    h.b.retreat(u, { reason: 'raid' });
    close(u.respawnAt - u.deathAt, 20 / 2 ** n, `after deployment ${n}`);
    if (n < 22) assert.ok(h.b._deploy(u), `deployment ${n + 1}`);
  }
  assert.equal(u.findBuff('band:band_emperor').stacks, 22);
});

test('桑葚 药枚实验: the units on the right-most column get a 25 % chance per attack of 1 shield layer (max 1)', () => {
  const ops = { t_op: op('t_op'), t_b: op('t_b') };
  for (const [v, want] of [[0.24, 1], [0.26, 0]]) {
    const h = fight({ band: 'band_mberry', ops, units: [{ chessId: 't_op', row: 10, col: 7 }, { chessId: 't_b', row: 11, col: 5 }], foes: [[10, 8], [11, 6]] });
    forceRng(h, v);
    h.run(3.1);
    const sh = (u) => { const b = u.findBuff('band:band_mberry:shield'); return b ? b.shieldHits : 0; };
    assert.equal(sh(h.unit('t_op')), want, `right-most, rng ${v}`);
    assert.equal(sh(h.unit('t_b')), 0, 'not right-most');
  }
  cover('band_mberry');
});

test('休谟斯 回收利用: a ground operator\'s skill end gives a random operator on its 4 neighbouring tiles 3 SP', () => {
  const ops = { t_op: op('t_op'), t_n: op('t_n'), t_far: op('t_far') };
  const h = fight({ band: 'band_humus', ops, units: [{ chessId: 't_op', row: 10, col: 4 }, { chessId: 't_n', row: 11, col: 4 }, { chessId: 't_far', row: 12, col: 7 }] });
  h.step(1);
  const [u, n, far] = [h.unit('t_op'), h.unit('t_n'), h.unit('t_far')];
  const n0 = n.skill.sp, f0 = far.skill.sp;
  u.skill.activate('test', { free: true });
  u.skill.end('test');
  close(n.skill.sp - n0, 3, 'neighbour +3');
  close(far.skill.sp - f0, 0, 'not adjacent');
  cover('band_humus');
});

test('卡莱莎 食腐之蝶: an operator knocked down ⇒ the others on the field ATK +20 % per knock-down (additive, max +200 %), lost when they fall', () => {
  const ops = { t_a: op('t_a'), t_b: op('t_b'), t_c: op('t_c') };
  const h = fight({ band: 'band_qalaisa', ops, units: [{ chessId: 't_a', row: 10, col: 4 }, { chessId: 't_b', row: 11, col: 4 }, { chessId: 't_c', row: 12, col: 4 }], foes: [[10, 9]] });
  h.step(1);
  const [a, b, c] = [h.unit('t_a'), h.unit('t_b'), h.unit('t_c')];
  const kill = (u) => h.b.dealDamage(foe(h), u, { amount: 1e6, type: 'true' });
  kill(a);
  close(b.s.atk, 600, '+20 %');
  kill(b);
  close(c.s.atk, 700, '+40 %');
  h.runUntil(() => a.alive, 30); // a redeploys: its bonus was lost when it fell
  close(a.s.atk, 500);
  for (let i = 0; i < 12; i++) { kill(a); h.runUntil(() => a.alive, 30); }
  close(c.s.atk, 500 * 3, 'max +200 %');
  cover('band_qalaisa');
});

test('陈 以己之长: the player\'s operators deal physical / arts damage as 弱点伤害', () => {
  const h = fight({ band: 'band_chen', units: [{ chessId: 't_op', row: 10, col: 3 }], foes: [[10, 9, 'e_def']], enemies: { e_def: DUMMY('e_def', { def: 900 }) } });
  h.step(1);
  close(h.b.dealDamage(h.unit('t_op'), foe(h), { amount: 1000, type: 'phys', canDodge: false }), 1000, 'phys → arts');
  const p = fight({ units: [{ chessId: 't_op', row: 10, col: 3 }], foes: [[10, 9, 'e_def']], enemies: { e_def: DUMMY('e_def', { def: 900 }) } });
  p.step(1);
  close(p.b.dealDamage(p.unit('t_op'), foe(p), { amount: 1000, type: 'phys', canDodge: false }), 100, 'without the band');
  cover('band_chen');
});

test('夕 墨色真颜: operators with a same-name partner on the field ATK +30 %', () => {
  const ops = { t_op: op('t_op'), t_b: op('t_b') };
  const h = fight({ band: 'band_dusk', ops, units: [{ chessId: 't_op', row: 10, col: 4 }, { chessId: 't_op', row: 11, col: 4 }, { chessId: 't_b', row: 12, col: 4 }] });
  h.step(1);
  const [x, y, z] = [h.unit(1), h.unit(2), h.unit(3)];
  close(x.s.atk, 650); close(y.s.atk, 650);
  close(z.s.atk, 500, 'single');
});

test('伊奥莱塔 统御号令: n elite operators on the field ⇒ each elite ATK and HP ×(1 + 0.1 n)', () => {
  const ops = { t_e1_b: op('t_e1_b', { golden: true }), t_e2_b: op('t_e2_b', { golden: true }), t_n: op('t_n') };
  const h = fight({ band: 'band_ioleta', ops, units: [{ chessId: 't_e1_b', row: 10, col: 4 }, { chessId: 't_e2_b', row: 11, col: 4 }, { chessId: 't_n', row: 12, col: 4 }] });
  h.step(1);
  for (const id of ['t_e1_b', 't_e2_b']) { close(h.unit(id).s.atk, 600, id); close(h.unit(id).s.maxHp, 2400, id); }
  close(h.unit('t_n').s.atk, 500, 'normal operators unchanged');
  checkInvariants(h.b);
  cover('band_ioleta');
});

test('Touch 外勤医疗: every player of a match with the band gets 预备干员-医疗 (≤ 1 elite) or Touch (≥ 2 elites) on its stage slot', () => {
  assert.deepEqual(amedicCharsFor(0), ['char_605_cmedic']);
  assert.deepEqual(amedicCharsFor(1), ['char_605_cmedic']);
  assert.deepEqual(amedicCharsFor(2), ['char_613_acmedc']);
  const ops = { t_e1_b: op('t_e1_b', { golden: true }), t_e2_b: op('t_e2_b', { golden: true }), t_n: op('t_n') };
  const run = (unitsIds, { band = 'band_amedic', matchBands = null } = {}) => {
    const players = [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, bandId: band, playerEffects: [],
      units: unitsIds.map((id, i) => ({ uid: i + 1, kind: 'chess', chessId: id, row: 10 + i, col: 5 })),
      contentInfo: matchBands ? { matchBands } : undefined }];
    const h = fight({ ops, players, stageId: 'act2autochess_m01' });
    h.step(1);
    return h.b.allyUnits.filter((u) => u.kind === 'token' && u.alive).map((u) => [u.defId, u.tileR, u.tileC]);
  };
  assert.deepEqual(run(['t_n', 't_e1_b']), [['char_605_cmedic', 10, 2]]);
  assert.deepEqual(run(['t_e1_b', 't_e2_b']), [['char_613_acmedc', 10, 2]]);
  assert.deepEqual(run(['t_n'], { band: null, matchBands: ['band_bldsk', 'band_amedic'] }), [['char_605_cmedic', 10, 2]], 'a teammate holds it');
  assert.deepEqual(run(['t_n'], { band: null }), [], 'nobody holds it');
  cover('band_amedic');
});

test('coverage: every band is exercised by a test above', () => {
  cover('band_dusk'); // 夕: 画卷 grant (fixed-round test) + 墨色真颜 (battle test)
  const missing = Object.keys(DATA.bands).filter((id) => !COVER.has(id)).sort();
  assert.deepEqual(missing, []);
});

void giveItem;
