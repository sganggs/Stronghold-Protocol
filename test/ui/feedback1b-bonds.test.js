// Player report after the public 0.1.0 release (relayed, untested by the user): "奥术盟约不生效".
// The bond works in battle (test/sim/feedback1b-arcane.test.js). What a player can see instead: 标准模拟 (FUNNY) is one
// of the modes whose official modeDataDict inactiveBondIdList switches 奥术 off (with 拉特兰 阿戈尔 卡西米尔 灵巧 奇迹 投资人
// 突袭 独行 绝技), yet 深靛 洛洛 阿罗玛 夕 圣聆初雪 stay in the pool through their other bond (server pool.js) and their cards
// showed 奥术 like any bond: the detail card's chip read "奥术 0/2 未激活" with three 奥术 operators deployed (the server
// used to leave an inactive bond out of m.private.bonds) and the bond popup "在场 0/2 未激活". The cards, chips and popup
// say 本局禁用 for a bond the mode never activates (gameLogic modeOffBonds over config.modes[modeId].inactiveBondIds);
// since 0.1.3 the view also lists it (`off: true`) so the strip can draw the grey disc — still never in ps.bonds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { modeOffBonds } = await import('../../public/js/ui/gameLogic.js');
const { BondChips } = await import('../../public/js/ui/detailPanel.js');
const { ChessCard } = await import('../../public/js/ui/shopBar.js');
const { BondPopup, BondStrip } = await import('../../public/js/ui/bondStrip.js');
const { data, getMode } = await import('../../public/js/data.js');
const { DATA, makeMatch, give, legalTileFor } = await import('../match/harness.js');
const { tileKey } = await import('../../server/match/board.js');

await data.loadAll('chess', 'bonds', 'assets', 'config');

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  if (typeof v.type === 'function' && !v.props?.children) return;
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const textOf = (v) => [...walk(v)].flatMap((n) => (Array.isArray(n.props?.children) ? n.props.children : [n.props?.children])).filter((x) => typeof x === 'string' || typeof x === 'number').join('');
const chipOf = (vnode, bondId) => [...walk(vnode)].find((v) => v.props?.['data-bond'] === bondId);

const OFF_FUNNY = ['lateranoShip', 'egirShip', 'kazimierzShip', 'skillfulShip', 'arcaneShip', 'miraShip', 'investShip', 'raidShip', 'soloShip', 'suntShip'];

test('modeOffBonds: 标准 (single and multi) switches off the 10 official inactive bonds, 奥术 included; 险境+ none', () => {
  for (const id of ['mode_single_funny', 'mode_multi_funny']) assert.deepEqual([...modeOffBonds(getMode(id))].sort(), [...OFF_FUNNY].sort(), id);
  for (const id of ['mode_single_normal', 'mode_multi_hard', 'mode_single_abyss']) assert.equal(modeOffBonds(getMode(id)).size, 0, id);
  assert.equal(modeOffBonds(null).size, 0);
});

test('a real 标准 match: 奥术 operators are buyable, three on the board never activate the bond — and the card chips say so', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', humans: 1, seed: 3 }).start();
  h.toPrep(1);
  const m = h.m, ps = h.ps('p_0');
  const members = DATA.bonds.arcaneShip.visibleMembers.filter((id) => m.pool.has(id) && !m.bannedChess.includes(id));
  assert.deepEqual(members.map((id) => DATA.chess[id].name), ['深靛', '洛洛', '阿罗玛', '夕', '圣聆初雪'], 'members kept in the pool by their other bond');
  ps.board.clear();
  const used = new Set();
  for (const id of members.slice(0, 3)) { const t = legalTileFor(m, ps, id, used); used.add(tileKey(t[0], t[1])); give(m, ps, id, 'board', t); }
  ps.recompute();
  assert.equal(ps.bonds.arcaneShip, undefined, 'official: the mode never activates 奥术 — not in the battle state');
  const priv = ps.privateView();
  const arc = priv.bonds.find((b) => b.bondId === 'arcaneShip');
  assert.ok(arc && arc.off === true && arc.active === false && arc.tier === 0 && arc.count === 3, 'the view lists the members as a grey 本局禁用 disc');
  assert.ok(priv.bonds.slice(priv.bonds.findIndex((b) => b.off)).every((b) => b.off), 'off entries come last');
  const off = modeOffBonds(getMode(m.modeId));
  // without the mode's off set the chip would read the new entry as an ordinary inactive bond (在场 3/3，未激活)
  const bare = chipOf(BondChips({ bondIds: DATA.chess[members[0]].bonds, bonds: priv.bonds }), 'arcaneShip');
  assert.match(bare.props.title, /在场 3\/3，未激活/);
  const chip = chipOf(BondChips({ bondIds: DATA.chess[members[0]].bonds, bonds: priv.bonds, off }), 'arcaneShip');
  assert.ok(hasClass(chip, 'is-off') && !hasClass(chip, 'is-active'));
  assert.equal(chip.props.title, '奥术：本局禁用（该盟约不会激活）');
  assert.match(textOf(chip), /本局禁用/);
  assert.ok(![...walk(chip)].some((v) => hasClass(v, 'dbond__count')), 'no member count');
  // the operator's enabled bond (精准) keeps its normal chip
  const preci = chipOf(BondChips({ bondIds: DATA.chess[members[0]].bonds, bonds: priv.bonds, off }), 'preciShip');
  assert.ok(!hasClass(preci, 'is-off'));
  m.dispose();
});

test('shop / reward card: a mode-disabled bond tag is struck through with the 本局禁用 title; others unchanged', () => {
  const id = 'chess_char_1_17_a'; // 深靛: 奥术 / 精准
  const slot = { kind: 'chess', id, price: 1, basePrice: 1 };
  const tags = (offBonds) => [...walk(ChessCard({ slot, idx: 0, priv: { funds: 9, hand: [], board: [], temp: [] }, onBuy() {}, onDetail() {}, offBonds }))].filter((v) => hasClass(v, 'scard__bond'));
  const on = tags(modeOffBonds(getMode('mode_single_funny')));
  assert.equal(on.length, 2);
  assert.ok(hasClass(on[0], 'is-off'), '奥术 struck');
  assert.equal(on[0].props.title, '奥术：本局禁用（该盟约不会激活）');
  assert.ok(!hasClass(on[1], 'is-off'), '精准 enabled');
  assert.ok(tags(modeOffBonds(getMode('mode_single_normal'))).every((v) => !hasClass(v, 'is-off')), '险境: nothing off');
  assert.ok(tags(null).every((v) => !hasClass(v, 'is-off')), 'no set: as before');
});

test('bond popup: 本局禁用 instead of 未激活, a note, and no misleading member count or 当前效果 numbers', () => {
  const pop = BondPopup({ bondId: 'arcaneShip', entry: null, priv: { board: [], hand: [] }, onClose() {}, off: true });
  const text = textOf(pop);
  assert.match(text, /本局禁用/);
  assert.match(text, /本模式下该盟约不会激活/);
  assert.doesNotMatch(text, /在场/);
  // the 当前效果 block ("提升20% … 68%") would promise an effect the mode never gives; the bond text (盟约效果) stays
  assert.doesNotMatch(text, /当前效果/);
  assert.ok(![...walk(pop)].some((v) => hasClass(v, 'bpop__sec--now')), 'no current-effect section');
  assert.match(text, /盟约效果/);
  const plain = textOf(BondPopup({ bondId: 'arcaneShip', entry: null, priv: { board: [], hand: [] }, onClose() {} }));
  assert.match(plain, /未激活/);
  assert.match(plain, /在场/);
  assert.match(plain, /当前效果/, 'an enabled bond keeps its current-effect block');
});

test('the game screen hands the mode-disabled set to the shop bar, the detail card and the bond popup', () => {
  const src = read('public/js/screens/game.js');
  assert.match(src, /const offBonds = modeOffBonds\(getMode\(pub\?\.modeId\)\)/);
  assert.match(src, /<\$\{ShopBar\}[\s\S]*?offBonds=\$\{offBonds\}/);
  assert.match(src, /<\$\{DetailPanel\}[\s\S]*?offBonds=\$\{offBonds\}/);
  assert.match(src, /<\$\{BondPopup\}[\s\S]*?off=\$\{offBonds\.has\(bondPop\.bondId\)\}/);
});

test('hidden-layer bonds show activation and tiers without a stack badge or layer count', () => {
  for (const bondId of ['maniShip', 'emptyShip', 'soloShip', 'suntShip']) {
    const entry = { bondId, active: true, count: 2, tier: 1, layers: 99 };
    const pop = BondPopup({ bondId, entry, priv: { board: [], hand: [] }, onClose() {} });
    assert.match(textOf(pop), /层数不显示/);
    assert.doesNotMatch(textOf(pop), /99|99 层/);
    const strip = BondStrip({ bonds: [entry], onOpen() {} });
    const disc = [...walk(strip)].find((v) => v.props?.name === DATA.bonds[bondId].name);
    assert.ok(disc);
    assert.equal(disc.props.layers, undefined);
    assert.equal(disc.props.active, true);
    assert.equal(disc.props.tier, 1);
  }
  const disc = [...walk(BondStrip({ bonds: [{ bondId: 'yanShip', active: true, layers: 12 }], onOpen() {} }))]
    .find((v) => v.props?.name === DATA.bonds.yanShip.name);
  assert.equal(disc.props.layers, 12, 'stacking bonds keep their badge');
});
