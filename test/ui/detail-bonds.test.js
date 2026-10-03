// The detail card's bond chips show a piece's EFFECTIVE bonds (upstream issue #17 / user report "转职道具没有效果"):
// the chess record's own `bonds` ∪ the bonds granted by a 变形同构体 (`canGiveBond`) worn together with an item that
// carries a `giveBondId` — exactly what the match counts (server/match/bondsMeta.js pieceBonds; the match tests:
// test/match/merge.test.js "变形同构体 grants the bond of the other equipped item").
//
// Before the fix the header chips were built from the static chess.json record alone (`bondIds=${c.bonds}`), so a piece
// that had just been 转职 showed no new chip anywhere — the grant was only ever visible in the bond strip's count, and
// only while the piece was on the board. The chips now come from gameLogic.effectiveBonds, and the granted chips carry
// the `is-granted` class + the source in their title/aria-label so the effect is visible where the player equipped it
// (board, bench or 临时整备区 alike — the chips describe the PIECE, the count still follows the bond's countMode).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

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

const { ChessDetail, resolveDetail } = await import('../../public/js/ui/detailPanel.js');
const { data } = await import('../../public/js/data.js');
await data.loadAll('chess', 'bonds', 'assets', 'items');

/** Every vnode of a preact tree (htm output), depth first; the bond-chip component is expanded. */
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  if (typeof v.type === 'function' && v.type.name === 'BondChips') yield* walk(v.type(v.props));
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);

const MIRA = 'chess_char_6_11_a';            // 缪尔赛思: own bond 调和 only
const ISO = 'chess_item_6_09_e_a';           // 变形同构体: canGiveBond
const HAMMER = 'chess_item_1_01_e_a';        // 维式重锤: giveBondId victoriaShip
const item = (id, uid) => ({ uid, kind: 'item', id, golden: false, tier: 6 });
const chipOf = (tree, bondId) => [...walk(tree)].find((v) => v?.props?.['data-bond'] === bondId) || null;
const chipsOf = (tree) => [...walk(tree)].filter((v) => typeof v?.props?.['data-bond'] === 'string').map((v) => v.props['data-bond']);

describe('detail card bond chips: a piece\'s effective bonds', () => {
  test('变形同构体 + 维式重锤 adds the 维多利亚 chip to 缪尔赛思 (and marks it granted)', () => {
    const c = data.lookup('chess', MIRA);
    const piece = { uid: 7, kind: 'chess', id: MIRA, golden: false, items: [item(ISO, 8), item(HAMMER, 9)] };
    const blocks = ChessDetail({ chess: c, piece, editable: false, onSell() {}, bonds: [], loadout: null, onBond: null });
    assert.ok(chipsOf(blocks).includes('maniShip'), 'her own 调和 chip stays');
    const granted = chipOf(blocks, 'victoriaShip');
    assert.ok(granted, 'the granted bond has a chip');
    assert.ok(hasClass(granted, 'is-granted'), 'marked as granted (not one of the record\'s own bonds)');
    assert.match(String(granted.props.title), /维多利亚/);
    assert.match(String(granted.props.title), /装备/, 'the title names the source');
    assert.ok(!hasClass(chipOf(blocks, 'maniShip'), 'is-granted'), 'an own bond is not marked');
  });

  test('no grant without the pair: one item, the body alone, or two bond items', () => {
    const c = data.lookup('chess', MIRA);
    const withItems = (items) => ChessDetail({ chess: c, piece: { uid: 7, kind: 'chess', id: MIRA, golden: false, items }, editable: false, onSell() {}, bonds: [], loadout: null, onBond: null });
    assert.deepEqual(chipsOf(withItems([item(HAMMER, 8)])), ['maniShip'], 'one item');
    assert.deepEqual(chipsOf(withItems([item(ISO, 8)])), ['maniShip'], 'the body alone');
    assert.deepEqual(chipsOf(withItems([item(HAMMER, 8), item('chess_item_1_02_e_a', 9)])), ['maniShip'], 'no body, no grant');
    assert.deepEqual(chipsOf(withItems([])), ['maniShip'], 'nothing equipped');
    // no piece at all (a shop card / a record-only target): the record's own bonds
    assert.deepEqual(chipsOf(ChessDetail({ chess: c, piece: null, editable: false, bonds: [], loadout: null })), ['maniShip']);
  });

  test('a bench piece shows the chip too — the count it shows is the player\'s (0/3 while not deployed)', () => {
    const c = data.lookup('chess', MIRA);
    const piece = { uid: 7, kind: 'chess', id: MIRA, golden: false, items: [item(ISO, 8), item(HAMMER, 9)] };
    // m.private.bonds of a player whose 维多利亚 sits at 0: the server sends no entry for it (bondList drops count 0)
    const blocks = ChessDetail({ chess: c, piece, editable: true, onSell() {}, bonds: [{ bondId: 'maniShip', count: 1, active: true, tier: 1, layers: 0, thresholds: [1], countsHand: false }], loadout: null, onBond: null });
    const granted = chipOf(blocks, 'victoriaShip');
    assert.ok(granted && hasClass(granted, 'is-granted'));
    assert.equal(granted.props['data-bond'], 'victoriaShip');
    assert.match(String(granted.props.title), /在场 0/, 'the effect is visible where the piece was equipped, even off the board');
  });

  test('resolveDetail hands the chips a piece WITH its items (own pieces; a watched unit carries none)', () => {
    const own = { uid: 7, kind: 'chess', id: MIRA, items: [item(ISO, 8), item(HAMMER, 9)] };
    const pieces = new Map([[7, { piece: own, area: 'temp', idx: 0 }]]);
    const r = resolveDetail({ kind: 'piece', uid: 7 }, pieces);
    assert.equal(r.piece, own, 'the private piece (items included) reaches ChessDetail');
    assert.deepEqual(chipsOf(ChessDetail({ chess: r.chess, piece: r.piece, editable: true, onSell() {}, bonds: [], loadout: null, onBond: null })), ['maniShip', 'victoriaShip']);
    // a teammate's unit of the field meta: no items in the payload (Match.prepFieldMeta) ⇒ the record's own bonds
    const u = { id: 3, uid: 3, kind: 'op', side: 'ally', ownerId: 'p_1', defId: MIRA };
    const ru = resolveDetail({ kind: 'unit', unit: u }, new Map());
    assert.equal(ru.piece, null);
    assert.deepEqual(chipsOf(ChessDetail({ chess: ru.chess, piece: ru.piece, editable: false, bonds: [], loadout: null })), ['maniShip']);
  });

  test('the derivation is the shared pure helper the match mirrors (no duplicated item rules in the panel)', () => {
    const src = read('public/js/ui/detailPanel.js');
    assert.match(src, /effectiveBonds/, 'the chips use gameLogic.effectiveBonds');
    assert.doesNotMatch(src, /BondChips bondIds=\$\{c\.bonds\}/, 'no longer the static record bonds alone');
  });
});
