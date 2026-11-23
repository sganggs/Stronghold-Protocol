// 同盟盟约速查 flyout (PR #922 review): the per-viewer operator lists and the composed thumbnail record.
// The server side (no boardOps in m.public, board-only in m.private) is test/match/teammate-flyout.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flyOpRec, flyOpsFor, flyOpChessId, mergeFlyOps, flyBondList, bondPopupNav } from '../../public/js/ui/teamPanel.js';
import { stripBondList } from '../../public/js/ui/gameLogic.js';

const players = [
  { playerId: 'p_0', alive: true, fieldId: 'n:p_0' },
  { playerId: 'p_1', alive: true, fieldId: 'n:p_1' },
  { playerId: 'p_2', alive: true, fieldId: 'b2' },
  { playerId: 'p_3', alive: false, fieldId: 'b2' },
];

test('flyOpRec: a chess id needs no composed record; a char id gets its name (the old record had none)', () => {
  assert.equal(flyOpRec({ id: 'chess_char_1001_1' }, () => ({ chessId: 'chess_char_1001_1' })), null);
  const rec = flyOpRec({ id: 'char_1001', golden: 1 }, () => null, (id) => (id === 'char_1001' ? '能天使' : null));
  assert.deepEqual(rec, { charId: 'char_1001', name: '能天使', assets: { avatar: 'char_1001' }, isGolden: true });
  assert.equal(rec.standInFor, undefined, 'standInFor never reaches the flyout record');
  assert.equal(flyOpRec({ id: 'char_1001' }, () => null, () => null).name, 'char_1001', 'an unknown char keeps its id as the name');
  assert.equal(flyOpRec(null), null);
});

test('flyOpsFor: the own seat is m.private.boardOps, nobody else is copied from the broadcast', () => {
  const ops = flyOpsFor({ myId: 'p_0', priv: { boardOps: [{ id: 'char_1' }, { id: 'char_2', golden: 1 }] }, field: null, players });
  assert.deepEqual(ops, { p_0: [{ id: 'char_1' }, { id: 'char_2', golden: 1 }] });
  assert.equal(ops.p_1, undefined);
});

test('flyOpsFor: a teammate only while their field is on screen, board area only, chess only, no hand/temp/items/summons', () => {
  const field = {
    fieldId: 'n:p_1',
    units: [
      { uid: 'u1', ownerId: 'p_1', kind: 'op', area: 'board', avatar: 'char_10', x: 0, y: 0 },
      { uid: 'u2', ownerId: 'p_1', kind: 'op', area: 'hand', avatar: 'char_11' },
      { uid: 'u3', ownerId: 'p_1', kind: 'op', area: 'temp', avatar: 'char_12' },
      { uid: 'i1', ownerId: 'p_1', kind: 'item', area: 'board', id: 'item_1' },
      { uid: 't1', ownerId: 'p_1', kind: 'token', area: 'board', defId: 'token_1' },
      { uid: 'u9', ownerId: 'p_2', kind: 'op', area: 'board', avatar: 'char_99' },
    ],
  };
  const ops = flyOpsFor({ myId: 'p_0', field, players });
  assert.deepEqual(ops, { p_1: [{ id: 'char_10' }] }, 'only the scouted board operator, slim: no coords / area / items');
  assert.equal(ops.p_2, undefined, 'another field is not on screen');
});

test('flyOpsFor: a running battle reads ownerOps, and the other group / a dead seat never gets a list', () => {
  const field = { fieldId: 'b2', players: ['p_2'] };
  // the runner's real entry shape (battle/simHost.js LocalSimHost.ownerOps): no golden flag, no uid / coordinates
  const runner = {
    ownerOps: (pid) => (pid === 'p_2'
      ? [{ kind: 'op', ownerId: 'p_2', defId: 'chess_char_7_2', items: ['i1'], standInFor: 'char_7' }]
      : [{ kind: 'op', ownerId: pid, defId: 'chess_char_8_1' }]),
  };
  const recs = { chess_char_7_2: { charId: 'char_7', isGolden: true }, chess_char_8_1: { charId: 'char_8', isGolden: false } };
  const ops = flyOpsFor({ myId: 'p_0', field, players, cc: true, runner, lookup: (id) => recs[id] || null });
  assert.deepEqual(ops, { p_2: [{ id: 'chess_char_7_2', golden: 1 }] }, 'p_1 is not on this field; p_3 is eliminated');
  assert.equal(ops.p_3, undefined);
});

test('flyOpsFor: the runner\'s elite operator keeps its elite frame over the peek row (client combat, PR #922 review)', () => {
  const field = { fieldId: 'n:p_1', players: ['p_1'] };
  const runner = { ownerOps: () => [{ kind: 'op', ownerId: 'p_1', defId: 'chess_char_1001_b' }, { kind: 'op', ownerId: 'p_1', defId: 'chess_char_1002_a' }] };
  const recs = { chess_char_1001_b: { charId: 'char_1001', isGolden: true }, chess_char_1002_a: { charId: 'char_1002', isGolden: false } };
  const base = flyOpsFor({ myId: 'p_0', field, players, cc: true, runner, lookup: (id) => recs[id] || null });
  const merged = mergeFlyOps(base, { p_1: [{ id: 'char_1001', golden: 1 }, { id: 'char_1002' }] });
  assert.deepEqual(merged.p_1, [{ id: 'chess_char_1001_b', golden: 1 }, { id: 'chess_char_1002_a' }],
    'the on-screen row wins, and still says which operator is elite');
});

test('flyOpsFor: a prep scout reads the meta even in a client-combat match (no battle runs yet)', () => {
  const field = {
    fieldId: 'n:p_1',
    prep: true,
    units: [{ uid: 'u1', ownerId: 'p_1', kind: 'op', area: 'board', avatar: 'char_10' }],
  };
  const runner = { ownerOps: () => [] };
  assert.deepEqual(flyOpsFor({ myId: 'p_0', field, players, cc: true, runner }), { p_1: [{ id: 'char_10' }] },
    'cc is true in prep too: the runner must not be consulted before the battle exists');
});

test('flyOpsFor: a shared field lists every member of its sides (boss partner, 联防)', () => {
  const field = {
    fieldId: 'boss_1',
    sides: { p_1: 'L', p_2: 'R' },
    units: [
      { uid: 'u1', ownerId: 'p_1', kind: 'op', area: 'board', avatar: 'char_10' },
      { uid: 'u2', ownerId: 'p_2', kind: 'op', area: 'board', avatar: 'char_20' },
    ],
  };
  assert.deepEqual(flyOpsFor({ myId: 'p_0', field, players }), { p_1: [{ id: 'char_10' }], p_2: [{ id: 'char_20' }] });
});

test('flyOpsFor: with no field on screen only the own list is built (no spectator bench shortcut)', () => {
  assert.deepEqual(flyOpsFor({ myId: 'p_0', priv: { boardOps: [{ id: 'char_1' }] }, field: null, players }), { p_0: [{ id: 'char_1' }] });
  assert.deepEqual(flyOpsFor({ myId: 'p_0', priv: null, field: null, players }), {});
});

test('mergeFlyOps: the peek fills the seats the screen cannot show, the screen wins, an empty list never clears', () => {
  const peek = { p_1: [{ id: 'char_7' }], p_2: [{ id: 'char_9' }], p_3: [{ id: 'char_8' }] };
  const base = { p_0: [{ id: 'char_1' }], p_1: [{ id: 'char_10' }] };
  assert.deepEqual(mergeFlyOps(base, peek), {
    p_0: [{ id: 'char_1' }],
    p_1: [{ id: 'char_10' }],
    p_2: [{ id: 'char_9' }],
    p_3: [{ id: 'char_8' }],
  });
  assert.deepEqual(mergeFlyOps(base, null), base);
  assert.deepEqual(mergeFlyOps(base, { p_1: [] }), base, 'm.peek sends [] when a seat dies: nothing on screen is fine too');
  assert.deepEqual(mergeFlyOps({}, {}), {});
});

// a click in the flyout hands the operator card a chess id (detailPanel resolveDetail reads chess records)
const chess = {
  chess_char_1001_1: { charId: 'char_1001', name: '能天使', tier: 5, isGolden: false },
  chess_char_1001_2: { charId: 'char_1001', name: '能天使', tier: 5, isGolden: true },
  chess_char_2002_1: { charId: 'char_2002', name: '德克萨斯', tier: 4, isGolden: false },
};
const byChess = (id) => chess[id] || null;

test('flyOpChessId: a chess id is the card id; a char id resolves to its chess record, golden first', () => {
  assert.equal(flyOpChessId({ id: 'chess_char_2002_1' }, byChess, () => chess), 'chess_char_2002_1');
  assert.equal(flyOpChessId({ id: 'char_1001' }, byChess, () => chess), 'chess_char_1001_1', 'plain operator → its plain record');
  assert.equal(flyOpChessId({ id: 'char_1001', golden: 1 }, byChess, () => chess), 'chess_char_1001_2', 'golden bit → the golden record');
  assert.equal(flyOpChessId({ id: 'char_2002', golden: 1 }, byChess, () => chess), 'chess_char_2002_1', 'no golden record: the plain one');
  assert.equal(flyOpChessId({ id: 'char_404' }, byChess, () => chess), null, 'an unknown operator opens no card');
  assert.equal(flyOpChessId(null, byChess, () => chess), null);
});

// the bond popup's ‹ ›: a teammate's bond opened from the flyout walks that teammate's row, never the strip's list
// (PR #922 review: › used to jump to the viewer's own strip bond and close the flyout)
const bondRecs = { b_core: { isCore: true }, b_x: {}, b_y: {}, b_z: {} };
const lookupBond = (id) => bondRecs[id] || null;
const seats = [
  { playerId: 'p_0', bonds: [{ bondId: 'b_x', active: true, layers: 3, count: 2 }, { bondId: 'b_y', active: false, count: 1 }] },
  { playerId: 'p_1', bonds: [
    { bondId: 'b_z', active: true, layers: 1, count: 2 },
    { bondId: 'b_off', off: true, count: 3 },
    { bondId: 'b_core', active: true, layers: 1, count: 2 },
    // a strategy's effect replacement maps this bond for the popup: count 0, no member (BondStrip hides it too)
    { bondId: 'b_mapped', count: 0, active: false, tier: 0, layers: 0, effectId: 'e_mapped' },
    { bondId: 'b_y', active: true, layers: 9, count: 2 },
    { bondId: 'b_w', count: 0, active: false, layers: 2 },
  ] },
];

test('flyBondList: the row is sorted like the strip (core breaks a tie), drops the mode-off bonds and the zero-count mapped rows', () => {
  assert.deepEqual(flyBondList(seats[1].bonds, lookupBond).map((b) => b.bondId), ['b_y', 'b_core', 'b_z', 'b_w'],
    'a row with layers but no member stays, as on the strip');
  assert.deepEqual(flyBondList([{ bondId: 'b_mapped', count: 0, active: false, tier: 0, layers: 0, effectId: 'e_mapped' }], lookupBond), [],
    'a seat whose only row is a mapped zero-count bond has an empty row, as the strip has no disc');
  assert.deepEqual(flyBondList(null, lookupBond), []);
});

test('bondPopupNav: a flyout disc walks its own seat\'s row; the strip walks the strip; other popups have no arrows', () => {
  const stripBonds = seats[0].bonds;
  const o = { stripBonds, stripOwnerId: 'p_0', players: seats, lookup: lookupBond };
  assert.deepEqual(bondPopupNav({ id: 'b_core', ownerId: 'p_1', from: 'fly' }, o), { ids: ['b_y', 'b_core', 'b_z', 'b_w'], ownerId: 'p_1' },
    'the teammate\'s own bonds (the discs of its row, no mapped zero-count row), and the teammate stays the owner');
  assert.deepEqual(bondPopupNav({ id: 'b_x', ownerId: 'p_0', from: 'fly' }, o), { ids: ['b_x', 'b_y'], ownerId: 'p_0' });
  assert.deepEqual(bondPopupNav({ id: 'b_x', ownerId: 'p_0', from: 'strip' }, o), { ids: ['b_x', 'b_y'], ownerId: 'p_0' });
  assert.deepEqual(bondPopupNav({ id: 'b_x', ownerId: 'p_0', from: 'strip' }, { ...o, stripOwnerId: 'p_1', stripBonds: seats[1].bonds }).ownerId, 'p_1',
    'the strip keeps following its owner (a scouted teammate)');
  assert.deepEqual(bondPopupNav({ id: 'b_y', ownerId: 'p_1', from: 'strip' }, { ...o, stripOwnerId: 'p_1', stripBonds: seats[1].bonds }).ids,
    ['b_y', 'b_core', 'b_z', 'b_w', 'b_off'], 'the strip\'s ‹ › walk its discs: the grey mode-off disc with members stays, the zero-count mapped row (no disc) is skipped (§37.348)');
  assert.deepEqual(stripBondList([{ bondId: 'b_off', off: true, count: 0 }, { bondId: 'b_mapped', count: 0, layers: 0, effectId: 'e' }], lookupBond), [],
    'no disc for a mode-off bond without members nor for a mapped zero-count row');
  assert.deepEqual(bondPopupNav({ id: 'b_x', ownerId: 'p_0', from: 'detail' }, o), { ids: [], ownerId: null });
  assert.deepEqual(bondPopupNav({ id: 'b_x', ownerId: 'p_0', from: 'info' }, o), { ids: [], ownerId: null });
  assert.deepEqual(bondPopupNav(null, o), { ids: [], ownerId: null });
  assert.deepEqual(bondPopupNav({ id: 'b_x', ownerId: 'p_9', from: 'fly' }, o), { ids: [], ownerId: 'p_9' }, 'a seat that left the list: no arrows');
  // the flyout's rows come from game.js flyBonds (the popup's entries, live layers on): ‹ › walk those lists as drawn
  const seatBonds = { p_1: [{ bondId: 'b_z', active: true, layers: 30, count: 2 }, { bondId: 'b_y', active: true, layers: 9, count: 2 }] };
  assert.deepEqual(bondPopupNav({ id: 'b_z', ownerId: 'p_1', from: 'fly' }, { ...o, seatBonds }).ids, ['b_z', 'b_y'],
    'live layers reorder the row: the arrows follow the drawn order');
  assert.deepEqual(bondPopupNav({ id: 'b_x', ownerId: 'p_0', from: 'fly' }, { ...o, seatBonds }).ids, ['b_x', 'b_y'], 'a seat missing from seatBonds: its m.public bonds');
  assert.deepEqual(bondPopupNav({ id: 'b_x', ownerId: 'p_9', from: 'fly' }, { ...o, seatBonds: { p_9: [{ bondId: 'b_x', active: true, count: 1 }] } }).ids, [],
    'a seat that left the list: still no arrows');
  // an eliminated seat draws no row: its m.public bonds are [] while your own m.private ones go on — no arrows
  const deadSeats = [{ ...seats[0], alive: false, bonds: [] }, seats[1]];
  assert.deepEqual(bondPopupNav({ id: 'b_x', ownerId: 'p_0', from: 'fly' }, { ...o, players: deadSeats, seatBonds: { p_0: seats[0].bonds } }).ids, []);
});

test('wiring: a flyout disc opens its popup as `from: \'fly\'`, a spectator seat sends no g.peek, the arrows keep the flyout', () => {
  const game = readFileSync(new URL('../../public/js/screens/game.js', import.meta.url), 'utf8');
  assert.match(game, /onBond=\$\{\(id, ownerId\) => openBond\(id, ownerId, 'fly'\)\}/);
  assert.match(game, /onFlyToggle=\$\{spectator \? null : actions\.peek\}/, 'the server refuses a spectator\'s g.peek anyway');
  assert.match(game, /bondPopupNav\(bondOpen, /);
  // the flyout rows and their arrows read the popup's entries (playerBonds with the popup's live / temporary layers)
  assert.match(game, /playerBonds\(\{ pub, priv, myId, ownerId: p\.playerId, live: liveLayers, temporary: tempLayersSnapshot \}\)/);
  assert.match(game, /popupView\(\{ open: bondOpen, pub, priv, myId, field, units: popOps, live: liveLayers, temporary: tempLayersSnapshot \}\)/);
  assert.match(game, /seatBonds: flyBonds \}\)/);
  assert.match(game, /seatBonds=\$\{flyBonds\}/);
  assert.match(game, /typeof p\.playerId === 'string' && p\.alive !== false\)/, 'no flyBonds row for an eliminated seat');
  const panel = readFileSync(new URL('../../public/js/ui/teamPanel.js', import.meta.url), 'utf8');
  assert.match(panel, /closest\('\.team, \.bpop, \.bpop-nav, \.dpanel'\)/, 'the ‹ › arrows sit outside .bpop');
});
