// Prep-side 特质 (server/sim/content/garrisons/meta.js) through the real registry and dispatcher. Every SERVER_* garrison
// id carried by a chess (visible ones required, hidden ones where they share a key) is exercised with its own blackboard
// numbers; one normal and one elite id per key are also asserted with literal numbers. The last test checks coverage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, giveItem, DATA } from '../match/harness.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { triggerGainEffects } from '../../server/sim/content/garrisons.js';

const QUIET = { warn() {}, error() {}, info() {} };
const REG = createRegistry({ log: QUIET });
const GR = (gid) => DATA.garrisons[gid];
const CH = (id) => DATA.chess[id];
const ids = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

/** SERVER_* garrison ids carried by visible chess (the coverage target). */
const VISIBLE_IDS = new Set();
for (const c of Object.values(DATA.chess)) if (c.visible) for (const g of c.garrisonIds || []) if (GR(g).eventType !== 'IN_BATTLE') VISIBLE_IDS.add(g);
const COVER = new Set();
const cover = (gid) => { assert.ok(GR(gid), gid); COVER.add(gid); };
/** Ids of an eventType|effectKey owned by any chess, with their owner chess ids (visible first). */
function idsOf(eventType, key) {
  return Object.values(DATA.garrisons).filter((g) => g.eventType === eventType && g.effectKey === key && g.owners.length)
    .map((g) => ({ gid: g.garrisonId, g, owners: g.owners.slice().sort((a, b) => (CH(b).visible - CH(a).visible) || a.localeCompare(b)) }))
    .sort((a, b) => a.gid.localeCompare(b.gid));
}
/** Visible normal chess without any prep-side (SERVER_*) 特质. */
const prepFree = (c) => (c.garrisonIds || []).every((g) => GR(g).eventType === 'IN_BATTLE');
const plain = (pred = () => true) => Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && prepFree(c) && pred(c)).map((c) => c.chessId).sort();
/** Visible normal chess without a 休整期结束时 特质 (fillers for prep-end tests). */
const noPrepFin = (pred = () => true) => Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && (c.garrisonIds || []).every((g) => GR(g).eventType !== 'SERVER_PREP_FIN') && pred(c)).map((c) => c.chessId).sort();

function setup(seed = 70) {
  const h = makeMatch({ mode: 'solo', seed, registry: REG, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.temp.fill(null);
  ps.offers.length = 0;
  ps.funds = 50;
  ps.layers = {};
  ps.pendingFunds = 0;
  ps.shop.freeRefreshes = 0;
  ps.bandId = null; // isolate from the band's own prep effects
  ps.recompute();
  const gains = {};
  const addLayers = ps.addLayers.bind(ps);
  ps.addLayers = (b, n, o = {}) => {
    const a = addLayers(b, n, o);
    if (/^(SERVER_|garrison)/.test(String(o.reason || ''))) gains[b] = (gains[b] || 0) + a;
    return a;
  };
  const G = (b) => gains[b] || 0;
  /** activate bonds through a member-count bonus (独行 is a "downward" bond: never activated here) */
  const activate = (...bonds) => { for (const b of bonds) if (b !== 'soloShip') ps.bondCountBonus[b] = 20; ps.recompute(); };
  const active = (b) => !!(ps.bonds[b] && ps.bonds[b].active);
  const L = (b) => ps.layers[b] || 0;
  const prepEnd = () => m.dispatch(ps, 'onPrepEnd', { round: m.round });
  const roundStart = () => m.dispatch(ps, 'onRoundStart', { round: m.round });
  const acquire = (id) => ps.acquireChess(id, { source: 'test' });
  const sell = (p) => assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: p.uid }), { ok: true });
  const gainsNow = () => Object.fromEntries(Object.entries(gains).filter(([, v]) => v > 0));
  return { h, m, ps, activate, active, L, G, gainsNow, prepEnd, roundStart, acquire, sell };
}
const handItems = (ps) => [...ps.hand, ...ps.temp].filter((p) => p && p.kind === 'item').map((p) => p.id);
const handChess = (ps) => [...ps.hand, ...ps.temp].filter((p) => p && p.kind === 'chess').map((p) => p.id);
/** Normal-item equivalents of `itemId` held (a golden item counts as its merge count). */
function itemUnits(ps, itemId) {
  const n = DATA.items[itemId];
  let u = 0;
  for (const id of handItems(ps)) {
    if (id === itemId) u++;
    else if (n && id === n.goldenId) u += n.upgradeNum || 2;
  }
  return u;
}
const onlyGains = (s, want, msg) => {
  const got = Object.fromEntries(Object.entries(s.gainsNow()).filter(([, v]) => v > 0));
  assert.deepEqual(got, Object.fromEntries(Object.entries(want).filter(([, v]) => v > 0)), msg);
};

// ---------------------------------------------------------------------------------------------------------------------
// 获得时 layer sources

test('获得时 自身所属盟约 +N without activation (角峰 / 艾丝黛尔 / 深靛 / 野鬃 25, 雪猎 / 灵知 111, 忍冬 71, 星熊 / 锏 65, 崖心 41, 协律 130)', () => {
  for (const { gid, g, owners } of idsOf('SERVER_GAIN', 'SERVER_ADD_BOND_CHESS_ALL')) {
    for (const owner of owners) {
      const s = setup();
      s.acquire(owner);
      onlyGains(s, Object.fromEntries(CH(owner).bonds.map((b) => [b, g.bb.count])), `${gid} ${owner}`);
    }
    cover(gid);
  }
  const s = setup();
  s.acquire('chess_char_1_02_a');
  s.acquire('chess_char_4_17_b');
  const want = {};
  for (const b of CH('chess_char_1_02_a').bonds) want[b] = (want[b] || 0) + 2;
  for (const b of CH('chess_char_4_17_b').bonds) want[b] = (want[b] || 0) + 16;
  onlyGains(s, want, '角峰 +2, 星熊 精锐 +16');
});

test('投资人: 获得时 traits run ×2 while active, ×3 at ≥ 100 layers (dispatcher; handlers add once per call)', () => {
  const s = setup();
  s.activate('investShip');
  s.acquire('chess_char_3_18_b');                                   // 忍冬 精锐 +12
  onlyGains(s, Object.fromEntries(CH('chess_char_3_18_b').bonds.map((b) => [b, 24])), '×2');
  const t = setup();
  t.activate('investShip');
  t.ps.layers.investShip = 100;
  t.ps.recompute();
  t.acquire('chess_char_1_03_a');                                   // 惊蛰: shop level × 1
  assert.equal(t.G('yanShip'), 3 * t.ps.shop.level, '×3');
});

test('SERVER_ADD_BOND 获得时: 烛煌 35 炎/维多利亚 +5 / +10; 录武官 (hidden 4_15) 156 + 157 grant 奇迹 once', () => {
  for (const { gid, g, owners } of idsOf('SERVER_GAIN', 'SERVER_ADD_BOND')) {
    for (const owner of owners) {
      const s = setup();
      s.acquire(owner);
      if (gid.startsWith('garrison_157')) {
        const m = GR(gid.replace('157', '156'));
        const [yan, mira] = ids(m.bbStr.count).map(Number);
        onlyGains(s, { yanShip: yan, miraShip: mira }, `${gid}: the shared text grants 奇迹 once`);
      } else {
        onlyGains(s, Object.fromEntries(ids(g.bbStr.bond).map((b) => [b, g.bb.count])), `${gid} ${owner}`);
      }
    }
    cover(gid);
  }
  const s = setup();
  s.acquire('chess_char_5_03_a');
  s.acquire('chess_char_5_03_b');
  onlyGains(s, { yanShip: 15, victoriaShip: 15 });
});

test('SERVER_ADD_MULTIPLE_BOND 录武官 156: 炎 +6 / 奇迹 +3 (精锐 12 / 6), no activation needed', () => {
  for (const { gid, g, owners } of idsOf('SERVER_GAIN', 'SERVER_ADD_MULTIPLE_BOND')) {
    for (const owner of owners.filter((o) => CH(o).visible)) {
      const s = setup();
      s.acquire(owner);
      const counts = ids(g.bbStr.count).map(Number);
      onlyGains(s, Object.fromEntries(ids(g.bbStr.bond).map((b, i) => [b, counts[i]])), `${gid} ${owner}`);
    }
    cover(gid);
  }
  const s = setup();
  s.acquire('chess_char_5_23_b');
  onlyGains(s, { yanShip: 12, miraShip: 6 });
});

test('SERVER_ADD_BOND_METHOD shoplv (惊蛰 30): 调度中心等级 × multi, no activation needed', () => {
  for (const { gid, g, owners } of idsOf('SERVER_GAIN', 'SERVER_ADD_BOND_METHOD')) {
    for (const owner of owners) {
      const s = setup();
      s.ps.shop.level = 4;
      s.acquire(owner);
      onlyGains(s, { [g.bbStr.bond]: 4 * g.bb.multi }, gid);
    }
    cover(gid);
  }
  const s = setup();
  s.ps.shop.level = 3;
  s.acquire('chess_char_1_03_a');
  s.acquire('chess_char_1_03_b');
  assert.equal(s.G('yanShip'), 3 + 6);
});

test('SERVER_ADD_BOND_ACTIVATED_MOST_LAYER: 灰毫 105 获得时; 波登可 102 / 调香师 81 at prep end, also from the hand', () => {
  const prime = (s) => { s.activate('yanShip', 'egirShip'); s.ps.layers = { yanShip: 3, egirShip: 7, kjeragShip: 50 }; s.ps.recompute(); };
  for (const { gid, g, owners } of idsOf('SERVER_GAIN', 'SERVER_ADD_BOND_ACTIVATED_MOST_LAYER')) {
    for (const owner of owners) {
      const s = setup();
      prime(s);
      s.acquire(owner);
      onlyGains(s, { egirShip: g.bb.count }, `${gid}: the ACTIVE bond with most layers`);
    }
    cover(gid);
  }
  for (const { gid, g, owners } of idsOf('SERVER_PREP_FIN', 'SERVER_ADD_BOND_ACTIVATED_MOST_LAYER')) {
    for (const owner of owners) {
      for (const where of ['hand', 'board']) {
        const s = setup();
        give(s.m, s.ps, owner, where, where === 'board' ? [10, 4] : null);
        prime(s);
        s.prepEnd();
        onlyGains(s, { egirShip: g.bb.count }, `${gid} ${where}`);
      }
    }
    cover(gid);
  }
  const s = setup();
  s.acquire('chess_char_2_18_b');
  assert.deepEqual(s.gainsNow(), {}, 'no active bond: nothing');
  prime(s);
  give(s.m, s.ps, 'chess_char_1_13_b', 'hand');
  give(s.m, s.ps, 'chess_char_2_14_a', 'hand');
  s.prepEnd();
  onlyGains(s, { egirShip: 2 + 2 }, '波登可 精锐 +2, 调香师 +2');
});

// ---------------------------------------------------------------------------------------------------------------------
// 进入休整期时 / 休整期结束时 layer sources

test('SERVER_ADD_BOND at prep start / end (寒檀 141 / 142, 刺玫 154, 雷蛇 158, 折桠 69): active bond, board only', () => {
  for (const [ev, run] of [['SERVER_PREP_FIN', 'prepEnd'], ['SERVER_PREP_START', 'roundStart']]) {
    for (const { gid, g, owners } of idsOf(ev, 'SERVER_ADD_BOND')) {
      for (const owner of owners) {
        const bonds = ids(g.bbStr.bond);
        const s = setup();
        give(s.m, s.ps, owner, 'board', [10, 4]);
        s[run]();
        assert.deepEqual(s.gainsNow(), {}, `${gid}: inactive`);
        s.activate(...bonds);
        s[run]();
        onlyGains(s, Object.fromEntries(bonds.map((b) => [b, g.bb.count])), `${gid} ${owner}`);
        const t = setup();
        give(t.m, t.ps, owner, 'hand');
        t.activate(...bonds);
        t[run]();
        assert.deepEqual(t.gainsNow(), {}, `${gid}: character_target_inboard`);
      }
      cover(gid);
    }
  }
  const w = setup();
  give(w.m, w.ps, 'chess_char_5_21_b', 'board', [10, 4]);             // 寒檀 精锐: +8 at round start and +8 at prep end
  w.activate('visiShip');
  w.roundStart();
  w.prepEnd();
  assert.equal(w.G('visiShip'), 16);
  const v = setup();
  give(v.m, v.ps, 'chess_char_1_06_a', 'board', [10, 4]);             // 刺玫 +1
  give(v.m, v.ps, 'chess_char_1_20_b', 'board', [11, 4]);             // 雷蛇 精锐 +2
  v.activate('victoriaShip', 'indomShip');
  v.prepEnd();
  assert.deepEqual([v.G('victoriaShip'), v.G('indomShip')], [1, 2]);
});

test('SERVER_ADD_BOND_CHESS_ALL at prep start / end (赫默 / 蒂比 80, 伊内丝 104, 莱恩哈特 51): own ACTIVE bonds, board only', () => {
  for (const [ev, run] of [['SERVER_PREP_FIN', 'prepEnd'], ['SERVER_PREP_START', 'roundStart']]) {
    for (const { gid, g, owners } of idsOf(ev, 'SERVER_ADD_BOND_CHESS_ALL')) {
      for (const owner of owners) {
        const bonds = CH(owner).bonds;
        const s = setup();
        give(s.m, s.ps, owner, 'board', [10, 4]);
        s.activate(...bonds.slice(0, 1));
        s[run]();
        onlyGains(s, Object.fromEntries(bonds.map((b) => [b, s.active(b) ? g.bb.count : 0])), `${gid} ${owner}`);
        assert.equal(s.G(bonds[0]), g.bb.count);
        const t = setup();
        give(t.m, t.ps, owner, 'hand');
        t.activate(...bonds);
        t[run]();
        assert.deepEqual(t.gainsNow(), {}, `${gid}: board only`);
      }
      cover(gid);
    }
  }
  const s = setup();
  give(s.m, s.ps, 'chess_char_2_02_a', 'board', [10, 4]);
  give(s.m, s.ps, 'chess_char_4_14_b', 'board', [11, 4]);
  s.activate(CH('chess_char_2_02_a').bonds[0], CH('chess_char_4_14_b').bonds[0]);
  s.roundStart();
  assert.equal(s.G(CH('chess_char_2_02_a').bonds[0]), 2, '赫默 +2 at round start');
  s.prepEnd();
  assert.equal(s.G(CH('chess_char_4_14_b').bonds[0]), 10 + (CH('chess_char_2_02_a').bonds[0] === CH('chess_char_4_14_b').bonds[0] ? 2 : 0), '莱恩哈特 精锐 +10 at prep end');
});

test('SERVER_ADD_BOND_METHOD round_gain_char (小满 31, 山 34, 夕 119): operators gained this round × multi', () => {
  for (const { gid, g, owners } of idsOf('SERVER_PREP_FIN', 'SERVER_ADD_BOND_METHOD').filter((x) => x.g.bbStr.add_method === 'round_gain_char')) {
    for (const owner of owners) {
      const bonds = ids(g.bbStr.bond);
      const s = setup();
      give(s.m, s.ps, owner, 'board', [10, 4]);
      s.ps.round.gainedChess = 4;
      s.prepEnd();
      assert.deepEqual(s.gainsNow(), {}, `${gid}: inactive`);
      s.activate(...bonds);
      s.prepEnd();
      onlyGains(s, Object.fromEntries(bonds.map((b) => [b, 4 * g.bb.multi])), gid);
    }
    cover(gid);
  }
  const s = setup();
  give(s.m, s.ps, 'chess_char_5_12_b', 'board', [10, 4]);             // 夕 精锐 +4 per gained operator
  s.activate('yanShip', 'arcaneShip');
  s.acquire('chess_char_1_02_a');
  s.acquire('chess_char_1_03_a');
  s.prepEnd();
  const onGain = s.ps.shop.level + (CH('chess_char_1_02_a').bonds.includes('yanShip') ? 2 : 0); // 惊蛰 / 角峰 获得时
  assert.deepEqual([s.G('arcaneShip'), s.G('yanShip')], [8, 8 + onGain], '2 gained × 4');
});

test('SERVER_ADD_BOND_METHOD same_bond_diff_lv (薄绿 48, 维娜 53 维多利亚 / 54 奇迹): distinct tiers on the board × multi', () => {
  for (const { gid, g, owners } of idsOf('SERVER_PREP_FIN', 'SERVER_ADD_BOND_METHOD').filter((x) => x.g.bbStr.add_method === 'same_bond_diff_lv')) {
    for (const owner of owners) {
      const bond = g.bbStr.bond;
      const s = setup();
      give(s.m, s.ps, owner, 'board', [10, 4]);
      const tiers = new Set([CH(owner).tier]);
      const fillers = [];
      for (const t of [1, 2, 3, 4, 5, 6]) {
        if (tiers.has(t) || fillers.length >= 2) continue;
        const id = noPrepFin((c) => c.tier === t && c.bonds.includes(bond))[0];
        if (id) { fillers.push(id); tiers.add(t); }
      }
      assert.ok(fillers.length >= 1, `${gid}: fillers`);
      fillers.forEach((id, i) => give(s.m, s.ps, id, 'board', [11, 4 + i * 2]));
      give(s.m, s.ps, fillers[0], 'board', [12, 4]);                  // a second copy of a tier: no extra
      s.activate(...CH(owner).bonds, bond);
      s.prepEnd();
      const counted = new Set([owner, ...fillers].filter((id) => CH(id).bonds.includes(bond)).map((id) => CH(id).tier));
      const sibling = CH(owner).garrisonIds.map(GR).filter((x) => x.effectKey === g.effectKey && x.eventType === g.eventType && x.bbStr.bond === bond);
      assert.equal(s.G(bond), counted.size * sibling.reduce((a, x) => a + x.bb.multi, 0), `${gid} ${owner}`);
    }
    cover(gid);
  }
  const b = setup();
  give(b.m, b.ps, 'chess_char_6_07_a', 'board', [10, 4]);             // 维娜 T6 维多利亚+奇迹
  give(b.m, b.ps, 'chess_char_3_08_b', 'board', [10, 5]);             // 薄绿 精锐 T3 (+4 per tier)
  const v1 = noPrepFin((c) => ![3, 6].includes(c.tier) && c.bonds.includes('victoriaShip'))[0];
  give(b.m, b.ps, v1, 'board', [11, 4]);
  b.activate('victoriaShip', 'miraShip');
  b.prepEnd();
  assert.equal(b.G('victoriaShip'), 3 * 3 + 3 * 4, '3 distinct tiers × (维娜 3 + 薄绿 精锐 4)');
  assert.equal(b.G('miraShip'), new Set(['chess_char_6_07_a', 'chess_char_3_08_b', v1].filter((id) => CH(id).bonds.includes('miraShip')).map((id) => CH(id).tier)).size * 2);
});

test('SERVER_ADD_BOND_METHOD hand_count (妮芙 56) and same_row (蛇屠箱 70)', () => {
  for (const { gid, g, owners } of idsOf('SERVER_PREP_FIN', 'SERVER_ADD_BOND_METHOD').filter((x) => ['hand_count', 'same_row'].includes(x.g.bbStr.add_method))) {
    for (const owner of owners) {
      const s = setup();
      give(s.m, s.ps, owner, 'board', [10, 4]);
      const fill = plain((c) => !c.bonds.includes(g.bbStr.bond)).slice(0, 3);
      if (g.bbStr.add_method === 'hand_count') {
        for (const id of fill) give(s.m, s.ps, id, 'hand');
        giveItem(s.m, s.ps, 'chess_item_1_01_e_a');                   // items do not count
      } else {
        give(s.m, s.ps, fill[0], 'board', [10, 6]);
        give(s.m, s.ps, fill[1], 'board', [10, 8]);
        give(s.m, s.ps, fill[2], 'board', [11, 6]);                    // other row
      }
      s.activate(g.bbStr.bond);
      s.prepEnd();
      assert.equal(s.G(g.bbStr.bond), 3 * g.bb.multi, `${gid} ${owner}: 3 × ${g.bb.multi}`);
    }
    cover(gid);
  }
  const c = setup();
  give(c.m, c.ps, 'chess_char_5_22_b', 'board', [10, 4]);
  give(c.m, c.ps, 'chess_char_1_02_a', 'hand');
  give(c.m, c.ps, 'chess_char_1_03_a', 'hand');
  c.activate('swiftShip');
  c.prepEnd();
  assert.equal(c.G('swiftShip'), 8, '妮芙 精锐: 2 hand operators × 4');
  const d = setup();
  give(d.m, d.ps, 'chess_char_3_16_a', 'board', [10, 4]);
  give(d.m, d.ps, 'chess_char_1_02_a', 'board', [10, 6]);
  d.activate('steadShip');
  d.prepEnd();
  assert.equal(d.G('steadShip'), 2, '蛇屠箱: 2 in the row (self included) × 1');
});

test('号角 61: the top active bond + multi per distinct tier of its members on the board', () => {
  for (const { gid, g, owners } of idsOf('SERVER_PREP_FIN', 'SERVER_ADD_ACT_BOND_DIFF_LV_MOST_LAYER')) {
    for (const owner of owners) {
      const bond = CH(owner).bonds[0];
      const s = setup();
      give(s.m, s.ps, owner, 'board', [10, 4]);
      const other = plain((c) => c.tier !== CH(owner).tier && c.bonds.includes(bond))[0];
      give(s.m, s.ps, other, 'board', [10, 6]);
      s.activate(bond, 'kjeragShip');
      s.ps.layers = { [bond]: 10, kjeragShip: 3 };
      s.ps.recompute();
      s.prepEnd();
      onlyGains(s, { [bond]: 2 * g.bb.multi }, `${gid}: 2 distinct tiers`);
    }
    cover(gid);
  }
  assert.deepEqual([GR('garrison_61_a').bb.multi, GR('garrison_61_b').bb.multi], [2, 4]);
});

test('流明 57: every hand operator adds +N to each of its ACTIVE bonds', () => {
  for (const { gid, g, owners } of idsOf('SERVER_PREP_FIN', 'SERVER_ADD_BOND_IN_HAND')) {
    for (const owner of owners) {
      const s = setup();
      give(s.m, s.ps, owner, 'board', [10, 4]);
      give(s.m, s.ps, 'chess_char_1_03_a', 'hand');                  // 惊蛰 炎
      give(s.m, s.ps, 'chess_char_2_04_a', 'hand');                  // 小满 炎 + 灵巧 (inactive)
      s.activate('yanShip');
      s.prepEnd();
      onlyGains(s, { yanShip: 2 * g.bb.count }, `${gid} ${owner}`);
    }
    cover(gid);
  }
  assert.deepEqual([GR('garrison_57_a').bb.count, GR('garrison_57_b').bb.count], [2, 4]);
});

test('SERVER_ADD_BOND_POSITION (断崖 / 见行者 47 behind, 引星棘刺 79 front, 空弦 150 front at round start): each target operator', () => {
  for (const [ev, run] of [['SERVER_PREP_FIN', 'prepEnd'], ['SERVER_PREP_START', 'roundStart']]) {
    for (const { gid, g, owners } of idsOf(ev, 'SERVER_ADD_BOND_POSITION')) {
      for (const owner of owners) {
        const ob = CH(owner).bonds;
        const behind = g.bbStr.dir === 'behind';
        const mate = plain((c) => c.bonds.includes(ob[0]))[0];                         // shares a bond with the owner
        const decoy = plain((c) => !c.bonds.some((b) => ob.includes(b) || CH(mate).bonds.includes(b)))[0];
        const s = setup();
        give(s.m, s.ps, owner, 'board', [10, 5]);
        give(s.m, s.ps, mate, 'board', [10, behind ? 4 : 6]);
        give(s.m, s.ps, decoy, 'board', [10, behind ? 6 : 4]);
        s.activate(...ob, ...CH(mate).bonds, ...CH(decoy).bonds);
        s[run]();
        const want = {};
        for (const id of [owner, mate]) for (const b of CH(id).bonds) if (s.active(b)) want[b] = (want[b] || 0) + g.bb.count;
        onlyGains(s, want, `${gid} ${owner}`);
      }
      cover(gid);
    }
  }
});

test('regression: POSITION — a bond shared by 断崖 and the operator behind her gets +N from each (per-operator targets)', () => {
  const s = setup();
  give(s.m, s.ps, 'chess_char_3_02_b', 'board', [10, 5]);             // 断崖 精锐 灵巧 +6
  const mate = plain((c) => c.bonds.includes('skillfulShip'))[0];
  give(s.m, s.ps, mate, 'board', [10, 4]);
  s.activate(...CH(mate).bonds, 'skillfulShip');
  s.prepEnd();
  assert.equal(s.G('skillfulShip'), 12);
  const t = setup();
  give(t.m, t.ps, 'chess_char_3_21_a', 'board', [10, 5]);             // 空弦 拉特兰/灵巧 +3, nobody in front
  t.activate('lateranoShip', 'skillfulShip');
  t.roundStart();
  onlyGains(t, { lateranoShip: 3, skillfulShip: 3 });
});

test('coin / refresh counters: 溯光星源 121 per 3 spent, 阿罗玛 122 / 安洁莉娜 147 refreshes × multiplier (capped), 拉普兰德 123', () => {
  for (const { gid, g, owners } of idsOf('SERVER_PREP_FIN', 'SERVER_ADD_BOND_ROUND_COIN_COST')) {
    for (const owner of owners) {
      const s = setup();
      give(s.m, s.ps, owner, 'board', [10, 4]);
      s.activate(...ids(g.bbStr.bond));
      s.ps.round.spent = 7;
      s.prepEnd();
      onlyGains(s, Object.fromEntries(ids(g.bbStr.bond).map((b) => [b, Math.floor(7 / g.bb.count) * g.bb.layer])), gid);
    }
    cover(gid);
  }
  for (const { gid, g, owners } of idsOf('SERVER_PREP_FIN', 'SERVER_ADD_REFRESH_CNT_MULTIPLIER_BOND_LAYER')) {
    for (const owner of owners) {
      for (const n of [1, 5]) {
        const s = setup();
        give(s.m, s.ps, owner, 'board', [10, 4]);
        s.activate(...ids(g.bbStr.bond));
        s.ps.round.refreshes = n;
        s.prepEnd();
        onlyGains(s, Object.fromEntries(ids(g.bbStr.bond).map((b) => [b, Math.min(n * g.bb.multiplier, g.bb.max_layer)])), `${gid} ${n}`);
      }
    }
    cover(gid);
  }
  for (const { gid, g, owners } of idsOf('SERVER_REFRESH_SHOP', 'SERVER_GAIN_BOND_LAYER_BY_REFRESH_CNT')) {
    for (const owner of owners) {
      for (const where of ['hand', 'board']) {
        const s = setup();
        give(s.m, s.ps, owner, where, where === 'board' ? [10, 4] : null);
        s.activate(g.bbStr.bond);
        assert.deepEqual(s.m.handle('p_0', { t: 'g.refresh' }), { ok: true });
        assert.equal(s.G(g.bbStr.bond), g.bb.layer, `${gid} ${where}`);
        s.m.handle('p_0', { t: 'g.refresh' });
        assert.equal(s.G(g.bbStr.bond), g.bb.layer, 'only the first refresh of the round');
      }
    }
    cover(gid);
  }
  const s = setup();
  give(s.m, s.ps, 'chess_char_6_16_b', 'board', [10, 4]);
  give(s.m, s.ps, 'chess_char_4_10_a', 'board', [11, 4]);
  give(s.m, s.ps, 'chess_char_5_20_b', 'board', [12, 4]);
  s.activate('skillfulShip', 'arcaneShip', 'siracusaShip');
  s.ps.round.spent = 9;
  s.ps.round.refreshes = 5;
  s.prepEnd();
  onlyGains(s, { skillfulShip: 12, arcaneShip: 12 + 6, siracusaShip: 6 + 24 }, '溯光星源 精锐 3 × 4; 阿罗玛 min(10, 6); 安洁莉娜 精锐 min(40, 24)');
});

test('regression #169: 拉普兰德 合成金 — the refresh right after the merge fires (the count starts at the acquisition)', () => {
  const s = setup();
  give(s.m, s.ps, 'chess_char_2_16_a', 'board', [10, 4]);           // 拉普兰德 123 (+4 叙拉古)
  s.activate('siracusaShip');
  s.m.handle('p_0', { t: 'g.refresh' });
  assert.equal(s.G('siracusaShip'), 4, 'the first refresh the copy witnesses');
  s.m.handle('p_0', { t: 'g.refresh' });
  assert.equal(s.G('siracusaShip'), 4, 'the second refresh since the acquisition adds nothing');
  s.acquire('chess_char_2_16_a');
  s.acquire('chess_char_2_16_a');                                   // completes the merge → 精锐 (123_b, +8)
  s.m.handle('p_0', { t: 'g.refresh' });
  assert.equal(s.G('siracusaShip'), 12, 'the merged elite is a new acquisition: +8 on its first witnessed refresh');
});

test('regression #169: 拉普兰德 123 — a copy kept across rounds fires again on the next round\u2019s first refresh', () => {
  const s = setup();
  give(s.m, s.ps, 'chess_char_2_16_a', 'board', [10, 4]);
  s.activate('siracusaShip');
  s.m.handle('p_0', { t: 'g.refresh' });
  assert.equal(s.G('siracusaShip'), 4);
  s.m.round = 2;                                                    // the round turns, the copy stays
  s.m.handle('p_0', { t: 'g.refresh' });
  assert.equal(s.G('siracusaShip'), 8, '本回合首次主动刷新 of the new round');
});

// ---------------------------------------------------------------------------------------------------------------------
// price, items, refreshes, funds

test('SERVER_CHESS_PRICE: 购买价格为1 — bb.price is the discount off the tier price (至简 Ⅲ 3 − 2, 红豆 Ⅰ 2 − 1; user playtest #5)', () => {
  for (const { gid, g, owners } of idsOf('SERVER_PRICE', 'SERVER_CHESS_PRICE')) {
    const n = Number(/购买价格为(\d+)/.exec(g.desc)?.[1]);
    assert.equal(n, 1, `${gid}: the official text`);
    for (const owner of owners) {
      const s = setup();
      const tierPrice = s.m.gd.chessPrice(owner);
      assert.equal(tierPrice - g.bb.price, n, `${gid} ${owner}: tier price − bb.price = the text's price`);
      s.ps.shop.slots[0] = { kind: 'chess', id: owner, basePrice: tierPrice, frozen: false, sold: false };
      assert.equal(s.ps.priceOf(s.ps.shop.slots[0]), n, `${gid} ${owner}`);
    }
    cover(gid);
  }
  const s = setup();
  s.ps.shop.slots[0] = { kind: 'chess', id: 'chess_char_3_13_a', basePrice: 3, frozen: false, sold: false };
  const funds = s.ps.funds;
  assert.deepEqual(s.m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
  assert.equal(s.ps.funds, funds - 1, '至简 costs 1');
  assert.equal(GR('garrison_13_a').bb.price, 2);
  assert.equal(GR('garrison_13_b').bb.price, 2);
});

test('regression: 购买价格为1 runs before the other price modifiers — 远见 150 (−1, no floor since 0.1.3) takes 至简 to 0', () => {
  const s = setup();
  const seen = [];
  s.m.dispatcher.registry.global('gar_test_seen', { onPrice(ctx, ev) { seen.push(ev.price); } });
  try {
    s.ps.shop.slots[0] = { kind: 'chess', id: 'chess_char_3_13_a', basePrice: 3, frozen: false, sold: false };
    s.ps.shop.slots[1] = { kind: 'chess', id: 'chess_char_1_02_a', basePrice: 2, frozen: false, sold: false };
    assert.equal(s.ps.priceOf(s.ps.shop.slots[0]), 1);
    assert.deepEqual(seen, [1], 'a global modifier already sees 至简 at 1');
    s.ps.counters['bondaddon:visi:disc'] = 2;             // 远见 150 layers: every chess −1, down to 0
    assert.equal(s.ps.priceOf(s.ps.shop.slots[0]), 0, '至简 3 − 2 = 1, then 远见 −1 → 0 (owner\'s decision 2026-10-04)');
    assert.equal(s.ps.priceOf(s.ps.shop.slots[1]), 1, 'other chess: 2 − 1');
    assert.equal(s.ps.privateView().shop.slots[0].price, 0, 'the shop card gets 0 (drawn FREE)');
    s.ps.funds = 0;
    assert.deepEqual(s.m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true }, 'bought with no funds');
    assert.equal(s.ps.funds, 0);
  } finally {
    s.m.dispatcher.registry.unregister('global:gar_test_seen');
  }
});

test('SERVER_GAIN_EQUIP (诗怀雅 133, 耶拉 92, 卡涅利安 / 蜜蜡 49, 缪尔赛思 76): bb.count copies of bbStr.chess', () => {
  for (const { gid, g, owners } of idsOf('SERVER_GAIN', 'SERVER_GAIN_EQUIP')) {
    for (const owner of owners) {
      const s = setup();
      s.acquire(owner);
      assert.equal(itemUnits(s.ps, g.bbStr.chess), g.bb.count, `${gid} ${owner}: ${handItems(s.ps)}`);
      assert.equal(handItems(s.ps).every((id) => id === g.bbStr.chess || id === DATA.items[g.bbStr.chess].goldenId), true);
    }
    cover(gid);
  }
  const s = setup();
  s.acquire('chess_char_4_24_b');
  assert.deepEqual(handItems(s.ps), ['chess_item_3_05_e_b'], '卡涅利安 精锐: two 迅捷作战粮 merge into the golden one');
  const t = setup();
  t.acquire('chess_char_3_03_a');
  assert.deepEqual(handItems(t.ps), ['chess_item_1_03_e_a'], '诗怀雅: 1 盟约之币');
});

test('free refreshes: 普罗旺斯 113 获得时, 德克萨斯 120 / 巫恋 132 售出时, 缄默德克萨斯 114 进入休整期时 (board only)', () => {
  for (const { gid, g, owners } of idsOf('SERVER_GAIN', 'SERVER_GAIN_FREE_REFRESH_COUNT')) {
    for (const owner of owners) { const s = setup(); s.acquire(owner); assert.equal(s.ps.shop.freeRefreshes, g.bb.count, gid); }
    cover(gid);
  }
  for (const { gid, g, owners } of idsOf('SERVER_CHESS_SOLD', 'SERVER_GAIN_FREE_REFRESH_COUNT')) {
    for (const owner of owners) { const s = setup(); s.sell(give(s.m, s.ps, owner, 'hand')); assert.equal(s.ps.shop.freeRefreshes, g.bb.count, gid); }
    cover(gid);
  }
  for (const { gid, g, owners } of idsOf('SERVER_PREP_START', 'SERVER_GAIN_FREE_REFRESH_COUNT')) {
    for (const owner of owners) {
      const s = setup();
      give(s.m, s.ps, owner, 'hand');
      s.roundStart();
      assert.equal(s.ps.shop.freeRefreshes, 0, `${gid}: hand`);
      give(s.m, s.ps, owner, 'board', [10, 4]);
      s.roundStart();
      assert.equal(s.ps.shop.freeRefreshes, g.bb.count, gid);
    }
    cover(gid);
  }
  const u = setup();
  u.acquire('chess_char_1_07_b');
  u.sell(give(u.m, u.ps, 'chess_char_1_08_a', 'hand'));
  give(u.m, u.ps, 'chess_char_4_16_b', 'board', [10, 4]);
  u.roundStart();
  assert.equal(u.ps.shop.freeRefreshes, 2 + 1 + 2);
});

test('funds: 能天使 26 / 新约能天使 32 获得时, 格雷伊 67 / 泥岩 21 售出时 → next round; 琳琅诗怀雅 98 (hand needs 炎 / 投资人)', () => {
  for (const { gid, g, owners } of idsOf('SERVER_GAIN', 'SERVER_ONCE_GOLD')) {
    for (const owner of owners) { const s = setup(); s.acquire(owner); assert.equal(s.ps.pendingFunds, g.bb.count, gid); }
    cover(gid);
  }
  for (const { gid, g, owners } of idsOf('SERVER_CHESS_SOLD', 'SERVER_ONCE_GOLD')) {
    for (const owner of owners) {
      const s = setup();
      const funds = s.ps.funds;
      s.sell(give(s.m, s.ps, owner, 'hand'));
      assert.equal(s.ps.pendingFunds, g.bb.count, gid);
      assert.equal(s.ps.funds, funds + 1, 'the sale itself still pays 1');
    }
    cover(gid);
  }
  for (const { gid, g, owners } of idsOf('SERVER_PREP_FIN', 'SERVER_ONCE_GOLD_WITH_BOND_CONDITION')) {
    for (const owner of owners) {
      const s = setup();
      give(s.m, s.ps, owner, 'board', [10, 4]);
      s.prepEnd();
      assert.equal(s.ps.pendingFunds, g.bb.count, `${gid}: on the board always`);
      for (const b of ids(g.bbStr.bond)) {
        const t = setup();
        give(t.m, t.ps, owner, 'hand');
        t.prepEnd();
        assert.equal(t.ps.pendingFunds, 0, `${gid}: hand without 炎 / 投资人`);
        t.activate(b);
        t.prepEnd();
        assert.equal(t.ps.pendingFunds, g.bb.count, `${gid}: hand with ${b}`);
      }
    }
    cover(gid);
  }
  const s = setup();
  s.acquire('chess_char_6_13_b');
  s.sell(give(s.m, s.ps, 'chess_char_4_18_b', 'hand'));
  assert.equal(s.ps.pendingFunds, 4 + 4);
});

test('松果 116 on sale: a free special recruit of tier I (精锐: tier V)', () => {
  for (const { gid, g, owners } of idsOf('SERVER_CHESS_SOLD', 'SERVER_SELL_CHESS_GAIN_SPECIAL_GOODS')) {
    const tier = DATA.choices.pools[g.bbStr.max_pool].tier;
    for (const owner of owners) {
      const s = setup();
      s.sell(give(s.m, s.ps, owner, 'hand'));
      const offer = s.ps.offers[s.ps.offers.length - 1];
      assert.ok(offer && offer.slots.length >= 1, gid);
      for (const sl of offer.slots) { assert.equal(CH(sl.id).tier, tier, gid); assert.equal(sl.price, 0); }
    }
    cover(gid);
  }
  assert.deepEqual([DATA.choices.pools[GR('garrison_116_a').bbStr.pool3].tier, DATA.choices.pools[GR('garrison_116_b').bbStr.pool3].tier], [1, 5]);
});

// ---------------------------------------------------------------------------------------------------------------------
// pools

test('pools: 凯瑟琳 127 odd rounds, 佩佩 94, 洛洛 91, 焰尾 149, 歌蕾蒂娅 139 row of 3 — bb.count each', () => {
  for (const { gid, g, owners } of idsOf('SERVER_PREP_START', 'SERVER_GAIN_RANDOM_EQUIP_CHESS_IN_POOL')) {
    for (const owner of owners) {
      const s = setup();
      give(s.m, s.ps, owner, 'board', [10, 4]);
      s.roundStart();
      assert.equal(handItems(s.ps).length, g.bb.count, `${gid}: round 1 is odd`);
      s.m.round = 2;
      s.roundStart();
      s.m.round = 1;
      assert.equal(handItems(s.ps).length, g.bb.count, `${gid}: round 2 nothing`);
      for (const id of handItems(s.ps)) assert.ok(DATA.items[id].tier <= s.ps.shop.level, id);
    }
    cover(gid);
  }
  for (const [ev, key] of [['SERVER_GAIN', 'SERVER_POOL_EQUIP'], ['SERVER_PREP_START', 'SERVER_POOL_EQUIP']]) {
    for (const { gid, g, owners } of idsOf(ev, key)) {
      const pool = DATA.choices.pools[g.bbStr.pool];
      const allowed = new Set([...(pool.items || []), ...(pool.weighted || []).map((x) => x[0])]);
      for (const owner of owners) {
        for (let seed = 1; seed <= 4; seed++) {
          const s = setup(seed);
          if (ev === 'SERVER_GAIN') s.acquire(owner);
          else { give(s.m, s.ps, owner, 'board', [10, 4]); s.roundStart(); }
          let units = 0;
          for (const id of allowed) units += itemUnits(s.ps, id);
          assert.equal(units, g.bb.count, `${gid} seed ${seed}: ${handItems(s.ps)}`);
        }
      }
      cover(gid);
    }
  }
  for (const [ev, key] of [['SERVER_GAIN', 'SERVER_POOL_CHAR'], ['SERVER_PREP_START', 'SERVER_POOL_CHAR']]) {
    for (const { gid, g, owners } of idsOf(ev, key)) {
      const pool = DATA.choices.pools[g.bbStr.pool];
      const allowed = new Set([...(pool.items || []), ...(pool.weighted || []).map((x) => x[0])]);
      for (const owner of owners) {
        const s = setup();
        const got = () => handChess(s.ps).filter((id) => allowed.has(id) || allowed.has(id.replace(/_b$/, '_a')));
        if (ev === 'SERVER_GAIN') {
          s.acquire(owner);
          assert.equal(got().length, g.bb.count, `${gid}: ${handChess(s.ps)}`);
        } else {
          const row = plain((c) => !allowed.has(c.chessId)).slice(0, 2);
          give(s.m, s.ps, owner, 'board', [10, 4]);
          give(s.m, s.ps, row[0], 'board', [10, 6]);
          s.roundStart();
          assert.equal(got().length, 0, `${gid}: 2 in the row`);
          give(s.m, s.ps, row[1], 'board', [10, 8]);
          s.roundStart();
          assert.equal(got().length, g.bb.count, `${gid}: 3 in the row`);
        }
      }
      cover(gid);
    }
  }
});

test('歌蕾蒂娅 / 余: granting a chess toasts 「名字：获得X」', () => {
  const glady = setup(11);
  const row = plain().slice(0, 2);
  give(glady.m, glady.ps, 'chess_char_4_12_a', 'board', [10, 4]);
  give(glady.m, glady.ps, row[0], 'board', [10, 6]);
  give(glady.m, glady.ps, row[1], 'board', [10, 8]);
  const n0 = glady.h.allTo('p_0', 'm.toast').length;
  glady.roundStart();
  const lines = glady.h.allTo('p_0', 'm.toast').slice(n0).map((t) => t.text);
  const line = lines.find((t) => t.startsWith('歌蕾蒂娅：获得'));
  assert.ok(line, lines.join(' | '));
  const gained = line.slice('歌蕾蒂娅：获得'.length);
  assert.ok(handChess(glady.ps).some((id) => CH(id).name === gained), `${line} not in ${handChess(glady.ps)}`);
  const yu = setup(12);
  give(yu.m, yu.ps, 'chess_char_6_03_a', 'board', [10, 4]);
  yu.ps.bondCountBonus.egirShip = 9;
  yu.ps.recompute();
  const fillers = plain((c) => !c.bonds.includes('egirShip')).slice(0, 2);
  give(yu.m, yu.ps, fillers[0], 'board', [10, 6]);
  give(yu.m, yu.ps, fillers[1], 'board', [10, 8]);
  const n1 = yu.h.allTo('p_0', 'm.toast').length;
  yu.roundStart();
  const yuLine = yu.h.allTo('p_0', 'm.toast').slice(n1).map((t) => t.text).find((t) => t.startsWith('余：获得'));
  assert.ok(yuLine, yu.h.allTo('p_0', 'm.toast').slice(n1).map((t) => t.text).join(' | '));
  const yuName = yuLine.slice('余：获得'.length);
  assert.ok(handChess(yu.ps).some((id) => CH(id).name === yuName), yuLine);
});

test('余 37: a chess of the bond with the most members (normal: 3 in the row; 精锐: always)', () => {
  for (const { gid, g, owners } of idsOf('SERVER_PREP_START', 'SERVER_MOST_BOND')) {
    for (const owner of owners) {
      const s = setup();
      give(s.m, s.ps, owner, 'board', [10, 4]);
      s.ps.bondCountBonus.egirShip = 9;
      s.ps.recompute();
      s.roundStart();
      const rowRule = g.bbStr.conditionkey === 'character_same_row';
      assert.equal(handChess(s.ps).length, rowRule ? 0 : 1, `${gid}: alone in the row`);
      if (rowRule) {
        const row = plain((c) => !c.bonds.includes('egirShip')).slice(0, 2);
        give(s.m, s.ps, row[0], 'board', [10, 6]);
        give(s.m, s.ps, row[1], 'board', [10, 8]);
        s.roundStart();
      }
      const got = handChess(s.ps);
      assert.equal(got.length, 1, gid);
      assert.ok(CH(got[0]).bonds.includes('egirShip'), `${gid} ${got[0]}`);
    }
    cover(gid);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// re-triggers / copies

test('铃兰 60: front "获得时" traits (精锐: the two tiles in front), ×投资人; nothing from the hand', () => {
  for (const [key, tiles] of [['SERVER_TRIGGER_ANOTHER', 1], ['SERVER_TRIGGER_FRONT_COUNT', 2]]) {
    for (const { gid, g, owners } of idsOf('SERVER_PREP_START', key)) {
      for (const owner of owners) {
        const s = setup();
        give(s.m, s.ps, owner, 'board', [10, 4]);
        give(s.m, s.ps, 'chess_char_1_07_a', 'board', [10, 5]);       // 普罗旺斯: 获得时 +1 free refresh
        give(s.m, s.ps, 'chess_char_1_07_b', 'board', [10, 6]);       // +2
        give(s.m, s.ps, 'chess_char_1_07_a', 'board', [10, 7]);       // 3 tiles away: never
        s.roundStart();
        assert.equal(s.ps.shop.freeRefreshes, tiles === 1 ? 1 : 3, gid);
        const t = setup();
        give(t.m, t.ps, owner, 'hand');
        give(t.m, t.ps, 'chess_char_1_07_a', 'board', [10, 5]);
        t.roundStart();
        assert.equal(t.ps.shop.freeRefreshes, 0, `${gid}: character_target_inboard`);
      }
      assert.equal(g.bbStr.event, 'SERVER_GAIN');
      cover(gid);
    }
  }
  const t = setup();
  give(t.m, t.ps, 'chess_char_5_10_b', 'board', [10, 4]);
  give(t.m, t.ps, 'chess_char_1_07_a', 'board', [10, 5]);
  give(t.m, t.ps, 'chess_char_1_07_b', 'board', [10, 6]);
  t.activate('investShip');
  t.roundStart();
  assert.equal(t.ps.shop.freeRefreshes, (1 + 2) * 2, 'both tiles, ×2 under 投资人');
});

test('regression: 瑰盐 82 (hidden) triggers the top-most (highest row: row 0 is the bottom), then right-most prep-end trait', () => {
  for (const { gid, owners } of idsOf('SERVER_CHESS_SOLD', 'SERVER_TRIGGER_ANOTHER')) {
    for (const owner of owners) {
      const u = setup();
      give(u.m, u.ps, 'chess_char_2_17_a', 'board', [11, 3]);         // 折桠 坚守 +4 — upper row
      give(u.m, u.ps, 'chess_char_1_20_a', 'board', [10, 9]);         // 雷蛇 不屈 +1 — lower row, further right
      give(u.m, u.ps, 'chess_char_1_06_a', 'board', [11, 2]);         // 刺玫 upper row, left of 折桠
      u.activate('steadShip', 'indomShip', 'victoriaShip');
      u.sell(give(u.m, u.ps, owner, 'hand'));
      onlyGains(u, { steadShip: 4 }, gid);
    }
    cover(gid);
  }
});

test('塞雷娅 99 / 白面鸮 86: the copier runs the front operator\'s prep-end / prep-start trait as its own (chains followed)', () => {
  for (const { gid, owners } of idsOf('SERVER_PREP_FIN', 'SERVER_FRONT_SAME_EFFECT_PREP_FIN')) {
    for (const owner of owners) {
      const v = setup();
      give(v.m, v.ps, owner, 'board', [10, 4]);
      give(v.m, v.ps, 'chess_char_2_17_b', 'board', [10, 5]);         // 折桠 精锐 坚守 +8
      v.activate('steadShip');
      v.prepEnd();
      assert.equal(v.G('steadShip'), 16, `${gid}: 折桠 8 + copied 8`);
      const w = setup();
      give(w.m, w.ps, owner, 'board', [10, 4]);
      give(w.m, w.ps, 'chess_char_4_14_a', 'board', [10, 5]);         // 莱恩哈特 "自身已激活的盟约 +5" → the copier's own bonds
      w.activate(...CH(owner).bonds, ...CH('chess_char_4_14_a').bonds);
      w.prepEnd();
      const want = {};
      for (const id of [owner, 'chess_char_4_14_a']) for (const b of CH(id).bonds) if (w.active(b)) want[b] = (want[b] || 0) + 5;
      onlyGains(w, want, `${gid}: self-relative effects use the copier`);
      const x = setup();
      give(x.m, x.ps, owner, 'board', [10, 4]);
      give(x.m, x.ps, 'chess_char_1_07_a', 'board', [10, 5]);         // 获得时 trait: not a prep-end trait
      x.prepEnd();
      assert.equal(x.ps.shop.freeRefreshes, 0);
    }
    cover(gid);
  }
  for (const { gid, owners } of idsOf('SERVER_PREP_START', 'SERVER_FRONT_SAME_EFFECT_PREP_START')) {
    for (const owner of owners) {
      const w = setup();
      give(w.m, w.ps, owner, 'board', [10, 4]);
      give(w.m, w.ps, 'chess_char_4_16_b', 'board', [10, 5]);         // 缄默德克萨斯 精锐 +2 free refreshes
      w.roundStart();
      assert.equal(w.ps.shop.freeRefreshes, 4, gid);
    }
    cover(gid);
  }
  const w = setup();
  give(w.m, w.ps, 'chess_char_4_21_a', 'board', [10, 3]);             // 白面鸮 → 白面鸮 (hidden 5_16) → 缄默德克萨斯
  give(w.m, w.ps, 'chess_char_5_16_a', 'board', [10, 4]);
  give(w.m, w.ps, 'chess_char_4_16_a', 'board', [10, 5]);
  w.roundStart();
  assert.equal(w.ps.shop.freeRefreshes, 3);
});

test('triggerGainEffects export (band 铃兰): re-runs 获得时 garrisons ×投资人 and returns the effects run', () => {
  const s = setup();
  const p = give(s.m, s.ps, 'chess_char_5_03_a', 'board', [10, 4]);   // 烛煌 炎/维多利亚 +5
  s.activate('investShip');
  let n = -1;
  s.m.dispatcher.registry.global('gar_test', { onPrepEnd(ctx) { n = triggerGainEffects(ctx, ctx.piece(p.uid)); } });
  try { s.prepEnd(); } finally { s.m.dispatcher.registry.unregister('global:gar_test'); }
  assert.equal(n, 1);
  assert.deepEqual([s.G('yanShip'), s.G('victoriaShip')], [10, 10]);
});

test('风丸 93: only 2 copies merge into the elite', () => {
  const s = setup();
  assert.equal(s.m.gd.mergeCount('chess_char_2_11_a'), 2);
  s.acquire('chess_char_2_11_a');
  s.acquire('chess_char_2_11_a');
  assert.ok([...s.ps.hand, ...s.ps.temp].some((p) => p && p.id === 'chess_char_2_11_b'));
  assert.equal(GR('garrison_93_a').eventType, 'IN_BATTLE');
});

test('every SERVER_* effectKey of the data has a registered handler', () => {
  const keys = new Set(Object.values(DATA.garrisons).filter((g) => g.eventType !== 'IN_BATTLE').map((g) => g.effectKey));
  for (const k of keys) assert.ok(REG.has(`garrison:${k}`), k);
});

test('coverage: every SERVER_* garrison id of a visible chess was exercised above', () => {
  const missing = [...VISIBLE_IDS].filter((g) => !COVER.has(g)).sort();
  assert.deepEqual(missing, []);
  assert.ok(VISIBLE_IDS.size >= 100, `${VISIBLE_IDS.size} ids`);
});
