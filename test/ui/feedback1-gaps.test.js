// Gaps found while triaging GitHub issues #1 / #8 (DESIGN §21.26) — the client side.
//   1. 变形同构体 shows its pairings ("转职球" read as doing nothing: its text says "具体对应关系可在模拟中查看本装备天赋栏", and
//      no screen showed that 天赋栏). gameLogic morphPairings builds the list from the items' `giveBondId` — the rule the
//      server counts with — grouped by bond in bonds.json order; detailPanel MorphPairings draws it on the item card (shop,
//      reward, hand) and on a wearer's card (装备), 本局禁用 marked (标准: 5 of the 14 bonds), the pairing a wearer wears
//      highlighted; a bond item says what it gives a 变形同构体 wearer (MorphGrantLine).
//   2. 调和's +1 in the bond popup ("一些不考虑整备区的盟约计算人数时也会把整备区的干员算进去"): the server marks a count that holds
//      调和's +1 (`harmony` in m.private bonds / m.public players[].bonds — test/match/feedback1-gaps.test.js); the popup
//      says 在场 n（含调和 +1） and a 调和 row heads the member list naming the 调和 operators on that board — own and a
//      teammate's (ui/watchBonds.js popupView over the scouted field), the chip's and the strip's titles too.
//   4. The strategy draft marks a strategy built around a bond the mode switches off 本局禁用 (bands.json `bondIds`, built
//      by shared/bandBonds.js — the field the bot reads too: gameLogic bandOffBonds = GameData.bandBondIds ∩ the mode's
//      inactive bonds), on its card and in the detail pane (screens/bandDraft.js BandOffTag / BandOffNote); still selectable.
//   (3, the bot's pick, is server-side: test/match/feedback1-gaps.test.js.)
// On screen (headless Chrome, opt-in): test/ui/feedback1-gaps.e2e.test.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (f) => JSON.parse(readFileSync(path.join(ROOT, 'data', f), 'utf8'));

// the browser data store reads the real data files from disk
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { morphPairings, modeOffBonds, grantedBonds, harmonyMembers, HARMONY_BOND, bandOffBonds, bandOffLine } = await import('../../public/js/ui/gameLogic.js');
const { data, getMode } = await import('../../public/js/data.js');
await data.loadAll('bonds', 'chess', 'items', 'assets', 'garrisons', 'config');
const { ItemDetail, ChessDetail, MorphPairings, MorphGrantLine, BondChips } = await import('../../public/js/ui/detailPanel.js');
const { BondPopup, BondStrip } = await import('../../public/js/ui/bondStrip.js');
const { popupView } = await import('../../public/js/ui/watchBonds.js');
const { HARMONY_BOND: SERVER_HARMONY_BOND } = await import('../../server/match/bondsMeta.js');
const { makeMatch, give, giveItem, legalTileFor } = await import('../match/harness.js');
const { tileKey } = await import('../../server/match/board.js');

const items = load('items.json');
const bonds = load('bonds.json');
const chess = load('chess.json');
const config = load('config.json');
const ITEMS = Object.values(items);
const BONDS = Object.values(bonds);

const ISO = 'chess_item_6_09_e_a'; // 变形同构体
const ISO_B = 'chess_item_6_09_e_b';
const HAMMER = 'chess_item_1_01_e_a'; // 维式重锤 → 维多利亚
const HAMMER_SHUDDER = 'chess_item_2_03_e_a'; // 战栗维式重锤 → 维多利亚 (an effect-only hammer)
const LATERANO_CLIP = 'chess_item_4_08_e_a'; // 拉特兰桥夹 → 拉特兰 (off in 标准)
const WEARER = 'chess_char_1_01_a'; // 隐现 (拉特兰 / 迅捷)
const MLYSS = 'chess_char_6_11_a'; // 缪尔赛思 (调和)
const YAN = Object.values(chess).filter((c) => c.visible && !c.isGolden && c.bonds.includes('yanShip') && !c.bonds.includes(HARMONY_BOND)).map((c) => c.chessId).sort();

/** Every vnode of a tree; the panel's own hook-free components are expanded (RichText & co. stay unexpanded). */
const EXPAND = new Set(['Section', 'ItemRow', 'MorphPairings', 'MorphGrantLine']);
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  if (typeof v.type === 'function' && EXPAND.has(v.type.name)) { yield* walk(v.type(v.props)); return; }
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const textOf = (v) => {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).join('');
  if (typeof v.type === 'function' && EXPAND.has(v.type.name)) return textOf(v.type(v.props));
  if (typeof v.type === 'function' && v.type.name === 'RichText') return String(v.props.text || '');
  return textOf(v.props?.children);
};
const byClass = (tree, c) => [...walk(tree)].filter((v) => hasClass(v, c));

/** The expected list straight from the data: bond → the distinct names of the items whose giveBondId is it. */
function expectedPairings() {
  const out = new Map();
  for (const r of ITEMS) {
    if (r.canGiveBond || !r.giveBondId) continue;
    if (!out.has(r.giveBondId)) out.set(r.giveBondId, new Set());
    out.get(r.giveBondId).add(r.name);
  }
  return out;
}

describe('§21.26 1 — 变形同构体: the pairing list (gameLogic morphPairings)', () => {
  test('from the data: 14 bonds in bonds.json order, 18 items, the same giveBondId the server counts with', () => {
    const rows = morphPairings(ITEMS, BONDS);
    const want = expectedPairings();
    assert.equal(rows.length, 14);
    assert.equal(want.size, 14);
    assert.deepEqual(rows.map((r) => r.bondId), BONDS.map((b) => b.bondId).filter((id) => want.has(id)), 'bonds.json order');
    for (const r of rows) {
      assert.equal(r.name, bonds[r.bondId].name);
      assert.deepEqual(new Set(r.items.map((it) => it.name)), want.get(r.bondId), `${r.name}: its items`);
      assert.equal(new Set(r.items.map((it) => it.id)).size, r.items.length, 'one entry per item family (normal / 进阶 share it)');
      assert.equal(r.off, false);
      assert.equal(r.worn, false);
    }
    assert.equal(rows.reduce((n, r) => n + r.items.length, 0), 18, '18 bond items');
    const vic = rows.find((r) => r.bondId === 'victoriaShip');
    assert.deepEqual(vic.items.map((it) => it.name), ['维式重锤', '战栗维式重锤', '坚固维式重锤', '加速维式重锤', '灼燃维式重锤'], 'by tier: the hammer series');
    assert.ok(!rows.some((r) => r.items.some((it) => items[it.id].canGiveBond)), '变形同构体 itself is no partner');
    // every listed item really grants its bond to a wearer (the client rule = the server's: test/ui/morph-bonds.test.js)
    for (const r of rows) for (const it of r.items) assert.deepEqual(grantedBonds([ISO, it.id], (id) => items[id]), [r.bondId], it.name);
  });

  test('the official 天赋栏 (character_table trap_1073_acarm073) lists the same 14 pairings', { skip: !existsSync(path.join(ROOT, '.cache/gamedata/excel/character_table.json')) && 'no official cache' }, () => {
    const ct = JSON.parse(readFileSync(path.join(ROOT, '.cache/gamedata/excel/character_table.json'), 'utf8'));
    const talent = ct[items[ISO].trapId].talents[0].candidates.at(-1).description.replace(/\\n/g, '\n');
    const pairs = [...talent.matchAll(/“([^”]+)”(?:系列装备)?→【([^】]+)】盟约/g)].map(([, item, bond]) => ({ item, bond }));
    assert.equal(pairs.length, 14, talent);
    const rows = morphPairings(ITEMS, BONDS);
    assert.deepEqual(pairs.map((p) => p.bond).sort(), rows.map((r) => r.name).sort(), 'the same 14 bonds');
    for (const p of pairs) {
      const r = rows.find((x) => x.name === p.bond);
      assert.ok(r.items.some((it) => it.name.includes(p.item)), `“${p.item}”→【${p.bond}】`);
    }
  });

  test('本局禁用: 标准 marks the 5 bonds it switches off (拉特兰 阿戈尔 卡西米尔 奥术 突袭), the other modes none', () => {
    for (const id of ['mode_single_funny', 'mode_multi_funny']) {
      const off = modeOffBonds(getMode(id));
      const rows = morphPairings(ITEMS, BONDS, { off });
      const marked = rows.filter((r) => r.off).map((r) => r.bondId);
      assert.deepEqual(marked, rows.map((r) => r.bondId).filter((b) => config.modes[id].inactiveBondIds.includes(b)), id);
      assert.deepEqual(marked.map((b) => bonds[b].name), ['拉特兰', '阿戈尔', '卡西米尔', '奥术', '突袭']);
    }
    for (const id of ['mode_single_normal', 'mode_multi_hard', 'mode_multi_abyss']) {
      assert.equal(morphPairings(ITEMS, BONDS, { off: modeOffBonds(getMode(id)) }).filter((r) => r.off).length, 0, id);
    }
  });

  test('on a wearer: the pairing it wears is highlighted (bond and item), with a 进阶 变形同构体 too; nothing without a pair', () => {
    const worn = (carried, off = null) => morphPairings(ITEMS, BONDS, { carried, off }).filter((r) => r.worn);
    const vic = worn([ISO, HAMMER_SHUDDER]);
    assert.deepEqual(vic.map((r) => r.bondId), ['victoriaShip']);
    assert.deepEqual(vic[0].items.filter((it) => it.worn).map((it) => it.name), ['战栗维式重锤'], 'only the item it carries');
    assert.deepEqual(worn([{ uid: 1, id: HAMMER }, { uid: 2, id: ISO_B }]).map((r) => r.bondId), ['victoriaShip'], 'pieces, golden 变形同构体');
    const lat = worn([ISO, LATERANO_CLIP], modeOffBonds(getMode('mode_multi_funny')));
    assert.ok(lat.length === 1 && lat[0].bondId === 'lateranoShip' && lat[0].off, 'worn, but 本局禁用 in 标准');
    assert.deepEqual(worn([ISO]), [], 'the 变形同构体 alone');
    assert.deepEqual(worn([HAMMER]), [], 'the bond item alone');
    assert.deepEqual(worn([ISO, 'chess_item_1_03_e_a']), [], 'a partner with no bond');
    assert.deepEqual(worn(null), []);
  });
});

describe('§21.26 1 — 变形同构体 on the cards', () => {
  const funny = modeOffBonds(getMode('mode_multi_funny'));

  test('the item card (shop / reward / hand): a 天赋 section with the 14 lines, 本局禁用 struck through, no highlight', () => {
    const v = ItemDetail({ item: items[ISO], piece: null, editable: false, onDestroy() {}, offBonds: funny });
    const sec = [...walk(v)].find((x) => x.type?.name === 'Section' && x.props.title === '天赋');
    assert.ok(sec, 'a 天赋 section (the item text points at its 天赋栏)');
    assert.match(textOf(v), /搭配以下装备时，携带者视为对应盟约的成员：/);
    const rows = byClass(v, 'dmorph__row');
    assert.equal(rows.length, 14);
    const off = rows.filter((r) => hasClass(r, 'is-off'));
    assert.deepEqual(off.map((r) => r.props['data-bond']), ['lateranoShip', 'egirShip', 'kazimierzShip', 'arcaneShip', 'raidShip']);
    for (const r of off) assert.match(textOf(r), /本局禁用/);
    assert.equal(rows.filter((r) => !hasClass(r, 'is-off') && /本局禁用/.test(textOf(r))).length, 0);
    assert.equal(byClass(v, 'is-worn').length, 0, 'no wearer: nothing highlighted');
    assert.match(textOf(rows.find((r) => r.props['data-bond'] === 'victoriaShip')), /【维多利亚】维式重锤、战栗维式重锤、坚固维式重锤、加速维式重锤、灼燃维式重锤/);
    assert.equal(byClass(v, 'dmorph__none').length, 0);
    // other modes: no mark
    assert.equal(byClass(ItemDetail({ item: items[ISO_B], piece: null, editable: false, onDestroy() {}, offBonds: new Set() }), 'is-off').length, 0, '进阶 copy, 绝境');
  });

  test('a wearer\'s card (装备): the 变形同构体 row lists the pairings with the worn one highlighted (生效中); the bond item\'s row says it', () => {
    const piece = { uid: 1, kind: 'chess', id: WEARER, golden: false, tier: 1, items: [{ uid: 2, id: ISO }, { uid: 3, id: HAMMER }] };
    const blocks = ChessDetail({ chess: chess[WEARER], piece, editable: false, bonds: [], offBonds: funny, loadout: null });
    const equip = blocks.find((b) => b?.key === 'equip');
    const rows = byClass(equip, 'dmorph__row');
    assert.equal(rows.length, 14);
    const worn = rows.filter((r) => hasClass(r, 'is-worn'));
    assert.deepEqual(worn.map((r) => r.props['data-bond']), ['victoriaShip']);
    assert.match(textOf(worn[0]), /生效中/);
    assert.deepEqual(byClass(worn[0], 'dmorph__item').filter((x) => hasClass(x, 'is-worn')).map(textOf), ['维式重锤']);
    const grant = byClass(equip, 'dhint--morph');
    assert.equal(grant.length, 1, 'the 维式重锤 row');
    assert.ok(hasClass(grant[0], 'is-worn'));
    assert.match(textOf(grant[0]), /与变形同构体一同装备时，携带者视为【维多利亚】成员.*生效中/);
    // worn with a bond the mode switches off: 已搭配 + 本局禁用, never 生效中
    const lat = ChessDetail({ chess: chess[WEARER], piece: { ...piece, items: [{ uid: 2, id: ISO }, { uid: 4, id: LATERANO_CLIP }] }, editable: false, bonds: [], offBonds: funny, loadout: null });
    const latRow = byClass(lat.find((b) => b?.key === 'equip'), 'dmorph__row').find((r) => hasClass(r, 'is-worn'));
    assert.equal(latRow.props['data-bond'], 'lateranoShip');
    assert.match(textOf(latRow), /已搭配/);
    assert.match(textOf(latRow), /本局禁用/);
    assert.doesNotMatch(textOf(latRow), /生效中/);
    // a teammate's unit / a popup's 同构 row (no own piece): the same, from the item ids it carries
    const ro = ChessDetail({ chess: chess[WEARER], piece: null, editable: false, bonds: [], offBonds: null, loadout: null, unitItems: [HAMMER_SHUDDER, ISO_B] });
    assert.deepEqual(byClass(ro.find((b) => b?.key === 'equip'), 'dmorph__row').filter((r) => hasClass(r, 'is-worn')).map((r) => r.props['data-bond']), ['victoriaShip']);
  });

  test('a wearer without a pair reads 暂未生效; a bond item alone says what it would give', () => {
    const lone = MorphPairings({ off: null, carried: [ISO] });
    assert.equal(byClass(lone, 'is-worn').length, 0);
    assert.match(textOf(byClass(lone, 'dmorph__none')[0]), /暂未生效/);
    const card = ItemDetail({ item: items[HAMMER], piece: null, editable: false, onDestroy() {}, offBonds: funny });
    const line = byClass(card, 'dhint--morph');
    assert.equal(line.length, 1);
    assert.match(textOf(line[0]), /^与变形同构体一同装备时，携带者视为【维多利亚】成员$/);
    assert.ok(!hasClass(line[0], 'is-worn'));
    const clip = byClass(ItemDetail({ item: items[LATERANO_CLIP], piece: null, editable: false, onDestroy() {}, offBonds: funny }), 'dhint--morph');
    assert.ok(hasClass(clip[0], 'is-off'));
    assert.match(textOf(clip[0]), /【拉特兰】成员本局禁用/);
    assert.equal(MorphGrantLine({ item: items[ISO], off: null }), null, 'not on the 变形同构体 itself');
    assert.equal(MorphGrantLine({ item: items['chess_item_1_03_e_a'], off: null }), null, 'not on an item without a bond');
  });
});

describe('§21.26 2 — 调和\'s +1 in the bond popup', () => {
  test('the client names 调和 by the server\'s id; harmonyMembers lists the 调和 operators on a board once each', () => {
    assert.equal(HARMONY_BOND, SERVER_HARMONY_BOND);
    const getChess = (id) => chess[id] || null;
    const priv = { board: [{ kind: 'chess', id: MLYSS }, { kind: 'chess', id: chess[MLYSS].goldenId }, { kind: 'chess', id: YAN[0] }, { kind: 'token', id: 'x' }], hand: [{ kind: 'chess', id: 'chess_char_1_15_a' }] };
    assert.deepEqual(harmonyMembers(priv, getChess), [{ id: MLYSS, name: '缪尔赛思' }], 'board only, one per operator');
    assert.deepEqual(harmonyMembers({ board: [{ kind: 'chess', id: 'chess_char_1_15_a' }] }, getChess).map((x) => x.name), ['盟约·辅助干员'], 'the Pith strategy\'s hidden one');
    assert.deepEqual(harmonyMembers(null, getChess), []);
  });

  /** A co-op match: p_1 deploys 缪尔赛思 + two 炎 operators (调和 makes 炎 3 = active), p_0 has nothing of it. */
  function harmonyMatch() {
    const h = makeMatch({ mode: 'coop', humans: 2, seed: 2611, fake: true }).start();
    h.toPrep(1);
    const m = h.m;
    const ps = h.ps('p_1');
    ps.board.clear();
    const used = new Set();
    const pieces = {};
    for (const id of [MLYSS, YAN[0], YAN[1]]) {
      const t = legalTileFor(m, ps, id, used);
      used.add(tileKey(t[0], t[1]));
      pieces[id] = give(m, ps, id, 'board', t);
    }
    ps.recompute();
    return { h, m, ps, pieces };
  }

  test('own popup: 在场 3（含调和 +1）, the 调和 row names 缪尔赛思 and opens her card; the member list stays 2 in play', () => {
    const { h, m, ps } = harmonyMatch();
    const priv = ps.privateView();
    const view = popupView({ open: { id: 'yanShip', ownerId: 'p_1' }, pub: m.publicView(), priv, myId: 'p_1', field: null });
    assert.equal(view.entry.harmony, 1, 'the server\'s entry says the count holds 调和\'s +1');
    assert.equal(view.entry.count, 3);
    const calls = [];
    const v = BondPopup({ bondId: 'yanShip', entry: view.entry, priv: view.priv, onClose() {}, onMember: (...a) => calls.push(a) });
    assert.match(textOf(byClass(v, 'bpop__facts')[0]).replace(/\s+/g, ''), /在场3\/6（含调和\+1）/);
    const row = byClass(v, 'bpop__harmony');
    assert.equal(row.length, 1);
    assert.equal(row[0].type, 'button');
    assert.match(textOf(row[0]), /调和 \+1/);
    assert.match(textOf(row[0]), /缪尔赛思 在场：核心盟约激活人数 \+1/);
    row[0].props.onClick();
    assert.deepEqual(calls, [[MLYSS, null]], 'opens 缪尔赛思\'s card');
    const head = [...walk(v)].filter((x) => x.type === 'h4').map(textOf).find((t) => t.includes('成员'));
    assert.match(head.replace(/[\[\]\s]/g, ''), /^成员2\//, 'the real members: 2 in play + the 调和 row = 在场 3');
    // the popup of 调和 itself (an add-on bond) and of a bond without the +1: no row
    const mani = popupView({ open: { id: HARMONY_BOND, ownerId: 'p_1' }, pub: m.publicView(), priv, myId: 'p_1' });
    assert.equal(byClass(BondPopup({ bondId: HARMONY_BOND, entry: mani.entry, priv, onClose() {} }), 'bpop__harmony').length, 0);
    m.dispose();
    void h;
  });

  test('a teammate\'s popup (scouting their board): the entry from m.public carries the +1, the row names their 缪尔赛思', () => {
    const { m, ps } = harmonyMatch();
    const pub = m.publicView();
    const field = m.prepFieldMeta(ps); // what 前往查看 shows p_0 (m.field)
    const view = popupView({ open: { id: 'yanShip', ownerId: 'p_1' }, pub, priv: m.players.get('p_0').privateView(), myId: 'p_0', field });
    assert.equal(view.name, ps.name);
    assert.equal(view.entry.harmony, 1);
    const v = BondPopup({ bondId: 'yanShip', entry: view.entry, priv: view.priv, owner: view.name, onClose() {} });
    assert.match(textOf(byClass(v, 'bpop__facts')[0]), /含调和 \+1/);
    assert.match(textOf(byClass(v, 'bpop__harmony')[0]), /缪尔赛思 在场/);
    // their board not on screen (no field): the row still explains the +1, without names
    const blind = popupView({ open: { id: 'yanShip', ownerId: 'p_1' }, pub, priv: null, myId: 'p_0', field: null });
    const row = byClass(BondPopup({ bondId: 'yanShip', entry: blind.entry, priv: blind.priv, owner: view.name, onClose() {} }), 'bpop__harmony');
    assert.equal(row[0].type, 'div');
    assert.match(textOf(row[0]), /调和已激活：核心盟约激活人数 \+1/);
    m.dispose();
  });

  test('without the server\'s +1 nothing changes; a 本局禁用 popup never shows it', () => {
    const plain = { bondId: 'yanShip', count: 3, active: true, tier: 1, layers: 0, thresholds: [3, 6, 9] };
    const priv = { board: [{ kind: 'chess', id: MLYSS }, { kind: 'chess', id: YAN[0] }], hand: [], temp: [] };
    const v = BondPopup({ bondId: 'yanShip', entry: plain, priv, onClose() {} });
    assert.equal(byClass(v, 'bpop__harmony').length, 0, 'the client does not re-derive the rule');
    assert.doesNotMatch(textOf(byClass(v, 'bpop__facts')[0]), /调和/);
    const off = BondPopup({ bondId: 'lateranoShip', entry: { bondId: 'lateranoShip', count: 2, harmony: 1 }, priv, onClose() {}, off: true });
    assert.equal(byClass(off, 'bpop__harmony').length, 0);
  });

  test('the strip disc\'s and the card chip\'s titles say the count holds the +1', () => {
    const entry = { bondId: 'yanShip', count: 3, active: true, tier: 1, layers: 5, harmony: 1, thresholds: [3, 6, 9] };
    const strip = BondStrip({ bonds: [entry], onOpen() {} });
    const slot = [...walk(strip)].find((x) => x.props?.['data-bond'] === 'yanShip');
    assert.equal(slot.props['data-harmony'], 1);
    const disc = [...walk(slot)].find((x) => typeof x.props?.title === 'string' && x.props.title.startsWith('炎'));
    assert.equal(disc.props.title, '炎 3/6（含调和 +1）');
    const chips = BondChips({ bondIds: ['yanShip'], bonds: [entry], onBond() {} });
    const chip = [...walk(chips)].find((x) => x.props?.['data-bond'] === 'yanShip');
    assert.equal(chip.props.title, '炎：在场 3/6（含调和 +1），已激活 1 阶');
    const noPlus = [...walk(BondChips({ bondIds: ['yanShip'], bonds: [{ ...entry, harmony: undefined }] }))].find((x) => x.props?.['data-bond'] === 'yanShip');
    assert.equal(noPlus.props.title, '炎：在场 3/6，已激活 1 阶');
  });
});

describe('§21.26 4 — the strategy draft marks a strategy built around a bond the mode switches off (本局禁用)', () => {
  const bands = load('bands.json');
  const modeIds = Object.keys(config.modes);
  const markedIn = (modeId) => Object.values(bands).map((b) => [b.bandId, bandOffBonds(b, modeOffBonds(getMode(modeId)))]).filter(([, ids]) => ids.length);

  test('标准: exactly 潘格尼尼 (拉特兰), 克莱门莎 (阿戈尔) and 玛恩纳 (卡西米尔); 险境 / 绝境 / 终极: none; a band tied to no bond: never', () => {
    for (const id of ['mode_single_funny', 'mode_multi_funny']) {
      assert.deepEqual(markedIn(id), [['band_paganini', ['lateranoShip']], ['band_clementia', ['egirShip']], ['band_mlynar', ['kazimierzShip']]], id);
    }
    for (const id of ['mode_single_normal', 'mode_multi_normal', 'mode_single_hard', 'mode_multi_hard', 'mode_single_abyss', 'mode_multi_abyss']) assert.deepEqual(markedIn(id), [], id);
    for (const b of Object.values(bands).filter((x) => !x.bondIds.length)) {
      for (const id of modeIds) assert.deepEqual(bandOffBonds(b, modeOffBonds(getMode(id))), [], `${b.name} in ${id}`);
    }
    // a tied band whose bond stays on (杜遥夜 炎) is not marked in 标准 either
    assert.deepEqual(bandOffBonds(bands.band_duyaoy, modeOffBonds(getMode('mode_multi_funny'))), []);
    assert.deepEqual(bandOffBonds(bands.band_paganini, null), []);
    assert.deepEqual(bandOffBonds({ bandId: 'old' }, modeOffBonds(getMode('mode_multi_funny'))), [], 'data without bondIds: no mark');
  });

  test('one source with the server: the bot\'s exclusion (GameData.bandBondIds ∩ modeInactiveBonds) is the draft\'s mark, in every mode', async () => {
    const { GameData } = await import('../../server/match/gamedata.js');
    const { getData } = await import('../../server/data.js');
    const DATA = getData({ log: { warn() {}, error() {}, info() {} } });
    for (const modeId of modeIds) {
      const gd = new GameData(DATA, modeId);
      for (const id of Object.keys(bands)) {
        assert.deepEqual([...gd.bandBondIds(id)], bands[id].bondIds, `${id}: the same field`);
        const server = gd.bandBondIds(id).filter((b) => gd.modeInactiveBonds.has(b));
        assert.deepEqual(server, bandOffBonds(bands[id], modeOffBonds(getMode(modeId))), `${modeId} ${id}`);
      }
    }
  });

  test('the card\'s tag and the detail pane\'s note: "本局禁用【拉特兰】盟约，此策略效果可能无法发挥", the bond struck through; nothing without one', async () => {
    const { BandOffTag, BandOffNote } = await import('../../public/js/screens/bandDraft.js');
    assert.equal(bandOffLine(['拉特兰']), '本局禁用【拉特兰】盟约，此策略效果可能无法发挥');
    assert.equal(bandOffLine(['拉特兰', '阿戈尔']), '本局禁用【拉特兰】【阿戈尔】盟约，此策略效果可能无法发挥');
    assert.equal(bandOffLine([]), '');
    const tag = BandOffTag({ names: ['拉特兰'] });
    assert.ok(hasClass(tag, 'dband__off'));
    assert.equal(textOf(tag), '本局禁用');
    assert.equal(tag.props.title, '本局禁用【拉特兰】盟约，此策略效果可能无法发挥');
    const note = BandOffNote({ names: ['拉特兰'] });
    assert.ok(hasClass(note, 'draft-detail__off'));
    assert.equal(note.props.role, 'note');
    assert.equal(textOf(note), '本局禁用【拉特兰】盟约，此策略效果可能无法发挥');
    assert.deepEqual(byClass(note, 'draft-detail__offname').map(textOf), ['拉特兰'], 'the bond name struck through (§21.7)');
    assert.equal(BandOffTag({ names: [] }), null);
    assert.equal(BandOffNote({ names: [] }), null);
  });
});
