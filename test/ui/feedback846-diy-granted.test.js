// GitHub #846 — 自选干员头像在部分界面显示为「甄」. The damage panel was fixed by B6 (§35.4); the bond popup's rows granted
// through 变形同构体 were not: gameLogic bondMembers built them from the slot id alone (no record), so ui/bondStrip.js's
// UnitThumb fell back to the empty 甄选干员 slot record (charId null → the 「甄」 glyph) and a watched teammate's row was
// also named 「甄选干员」. A 自选 piece's granted row now carries its operator — the normal form `rec` and a teammate's
// `pick` — like a 自选 member row (DESIGN §35.50).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const G = await import('../../public/js/ui/gameLogic.js');
const { BondPopup } = await import('../../public/js/ui/bondStrip.js');
const { ownerBoard } = await import('../../public/js/ui/watchBonds.js');
const { data } = await import('../../public/js/data.js');
const { DATA } = await import('../match/harness.js');

await data.loadAll('chess', 'bonds', 'assets', 'garrisons', 'items', 'backups');

const D = { chess: DATA.chess, backups: DATA.backups };
const getChess = (id) => (Object.hasOwn(DATA.chess, id) ? DATA.chess[id] : null);
const getItem = (id) => (Object.hasOwn(DATA.items, id) ? DATA.items[id] : null);
const T5A = 'chess_char_5_diy1_a';
const T5A_ELITE = 'chess_char_5_diy1_b';
const KALTS = 'char_003_kalts'; // 凯尔希: 罗德岛, not 维多利亚
const KALTS_PICK = { charId: KALTS, skillIndex: 0, uniEquipId: null };
const KALTS_NAME = DATA.backups.units[KALTS].name;
const MORPH = 'chess_item_6_09_e_a';   // 变形同构体
const HAMMER = 'chess_item_1_01_e_a';  // 维式重锤 → 维多利亚
const PIPER = 'chess_char_4_07_a';     // 风笛, a regular 维多利亚 member
const ENTRY = { count: 1, active: false, tier: 0, layers: 0 };

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
function expand(v, depth = 6) {
  if (Array.isArray(v)) return v.map((x) => expand(x, depth));
  if (!v || typeof v !== 'object') return v;
  if (typeof v.type === 'function' && depth > 0) {
    try { return expand(v.type(v.props || {}), depth - 1); } catch { return v; }
  }
  const children = v.props?.children;
  return children === undefined ? v : { ...v, props: { ...v.props, children: expand(children, depth) } };
}
const popup = (props) => expand(BondPopup({ entry: ENTRY, onClose() {}, ...props }));
const grantedButton = (pop) => [...walk(pop)].find((v) => hasClass(v, 'bpop__member') && v.props['data-granted'] === '1');
/** The record the row's UnitThumb draws (its OperatorImage's `chess`), and the fallback glyph's text. */
const thumbOf = (btn) => {
  const img = [...walk(btn)].find((v) => v.props && Object.hasOwn(v.props, 'chess') && Object.hasOwn(v.props, 'fallback'));
  return { rec: img?.props.chess ?? null, glyph: [...walk(img?.props.fallback)].find((v) => hasClass(v, 'uthumb__glyph'))?.props.children };
};
const piece = (uid, id, items, at = null) => ({ uid, kind: 'chess', id, items, ...(at ? { row: at[0], col: at[1] } : {}) });

/** The own m.private: 凯尔希 in the first tier-5 slot, on the board (or in the hand) with 变形同构体 + 维式重锤. */
const privOf = (where = 'board', id = T5A, items = [MORPH, HAMMER]) => ({
  playerId: 'p_1', diy: { [T5A]: KALTS_PICK }, diyBanned: [], loadout: {}, standIns: [], board: [], hand: [], temp: [],
  [where]: [piece('u1', id, items, where === 'board' ? [1, 1] : null)],
});
const ownRows = (priv) => G.bondMembers(DATA.bonds.victoriaShip, priv, [], G.diyGetter(getChess, priv, D), getItem);

describe('#846: a 自选 piece that joins a bond through 变形同构体 shows its operator', () => {
  test('own board: the granted row is 凯尔希 (name, record), not the 甄选干员 slot; the popup thumb gets her record', () => {
    const priv = privOf();
    const r = ownRows(priv).find((x) => x.granted);
    assert.ok(r, 'a granted row');
    assert.deepEqual([r.id, r.name, r.onBoard, r.rec?.charId, r.rec?.isGolden, r.diy], [T5A, KALTS_NAME, true, KALTS, false, undefined]);
    assert.deepEqual(r.items, [MORPH, HAMMER]);
    const btn = grantedButton(popup({ bondId: 'victoriaShip', priv }));
    assert.ok(btn && hasClass(btn, 'is-granted') && hasClass(btn, 'is-on'));
    assert.equal(thumbOf(btn).rec?.charId, KALTS, 'UnitThumb draws 凯尔希\'s picture');
    assert.equal(thumbOf(btn).glyph, [...KALTS_NAME][0], 'and her glyph without a picture, not 「甄」');
    assert.ok(btn.props.title.startsWith(KALTS_NAME), btn.props.title);
    assert.equal(btn.props['data-standin'], null, 'no 补位 stand-in for a 自选 row');
  });

  test('an elite copy in the hand: the row draws the normal form (one member per slot)', () => {
    const r = ownRows(privOf('hand', T5A_ELITE)).find((x) => x.granted);
    assert.deepEqual([r.id, r.name, r.inHand, r.onBoard, r.rec?.charId, r.rec?.isGolden], [T5A, KALTS_NAME, true, false, KALTS, false]);
  });

  test('a watched teammate: the row is their 凯尔希 (their unit\'s pick) and opens their operator\'s card with the items', () => {
    const field = { units: [{ id: 9, kind: 'op', ownerId: 'p_2', defId: T5A, diy: KALTS_PICK, items: [MORPH, HAMMER] }] };
    const mate = ownerBoard(field, 'p_2');
    const pieceRecord = (p) => (p.diy ? G.diyRecordFor(getChess(p.id), p.diy, D) : null) || getChess(p.id);
    const rows = G.bondMembers(DATA.bonds.victoriaShip, mate, [], G.diyGetter(getChess, mate, D), getItem, pieceRecord);
    const r = rows.find((x) => x.granted);
    assert.ok(r, `a granted row (${JSON.stringify(mate.board)})`);
    assert.deepEqual([r.id, r.name, r.rec?.charId], [T5A, KALTS_NAME, KALTS]);
    assert.deepEqual(r.pick, KALTS_PICK);
    const calls = [];
    const btn = grantedButton(popup({ bondId: 'victoriaShip', priv: mate, owner: 'Mate', ownerId: 'p_2', onMember: (...a) => calls.push(a) }));
    assert.equal(thumbOf(btn).rec?.charId, KALTS);
    btn.props.onClick();
    assert.deepEqual(calls, [[T5A, [MORPH, HAMMER], null, KALTS_PICK]]);
  });

  test('a regular operator granted the bond keeps its plain row (no record, no pick)', () => {
    const priv = { playerId: 'p_1', diy: {}, diyBanned: [], loadout: {}, standIns: [], board: [piece('u2', 'chess_char_1_01_a', [MORPH, HAMMER], [0, 0])], hand: [], temp: [] };
    const r = ownRows(priv).find((x) => x.granted);
    assert.ok(r);
    assert.equal(r.name, DATA.chess.chess_char_1_01_a.name);
    assert.equal(Object.hasOwn(r, 'rec'), false);
    assert.equal(Object.hasOwn(r, 'pick'), false);
    // and a regular member is no granted row
    assert.equal(ownRows({ ...priv, board: [piece('u3', PIPER, [MORPH, HAMMER], [0, 0])] }).some((x) => x.granted), false);
  });
});
