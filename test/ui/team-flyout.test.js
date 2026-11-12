// 同盟盟约速查 flyout (PR #922 review): the per-viewer operator lists and the composed thumbnail record.
// The server side (no boardOps in m.public, board-only in m.private) is test/match/teammate-flyout.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flyOpRec, flyOpsFor, flyOpChessId, mergeFlyOps } from '../../public/js/ui/teamPanel.js';

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
  const runner = {
    ownerOps: (pid) => (pid === 'p_2'
      ? [
        { uid: 'u1', kind: 'op', defId: 'chess_char_7_1', golden: true, items: ['i1'], standInFor: 'char_7', x: 1, y: 2 },
        { uid: 's1', kind: 'token', defId: 'token_1' },
      ]
      : [{ uid: 'u2', kind: 'op', defId: 'chess_char_8_1' }]),
  };
  const ops = flyOpsFor({ myId: 'p_0', field, players, cc: true, runner });
  assert.deepEqual(ops, { p_2: [{ id: 'chess_char_7_1', golden: 1 }] }, 'p_1 is not on this field; p_3 is eliminated');
  assert.equal(ops.p_3, undefined);
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
