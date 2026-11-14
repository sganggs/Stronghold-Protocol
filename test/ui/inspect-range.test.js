import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectRange } from '../../public/js/screens/game/range.js';
import { renderInfo } from '../../public/js/render/app/info.js';
import { isHealingRange, rangeStyle, HEAL_RANGE_COLOR } from '../../public/js/ui/rangeStyle.js';
import { rangeTiles } from '../../public/js/ui/facing.js';
import { unitStatsEntry } from '../../shared/protocol.js';
import { makeBattle } from '../helpers/battleHarness.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../../data/${name}.json`, import.meta.url), 'utf8'));
const chess = read('chess'), tokens = read('tokens');
const getChess = (id) => chess[id];
const medic = (id = 'char_613_acmedc', extra = {}) => renderInfo({ id: 71, defId: id, kind: 'token', side: 'ally', x: 5, y: 9, dir: 'UP', ...extra });
const args = (unit, extra = {}) => ({ target: { kind: 'unit', unit }, detail: { type: 'token', token: tokens[unit.defId] },
  getChess, field: { prep: true }, ...extra });

test('user Given Jessica inspected beside her shield When it expires Then her open range turns back with her', () => {
  const h = makeBattle({ autoFinish: false, units: [
    { uid: 1, diy: { slot: 'chess_char_5_diy1_a', charId: 'char_1034_jesca2', skillIndex: 0 }, row: 10, col: 4 },
    { uid: 2, kind: 'token', tokenId: 'token_10032_jesca2_jckshd', ownerUid: 1, row: 11, col: 4 },
  ] });
  h.step();
  const u = h.unit(1);
  const unit = h.b.fieldMeta().units.find((v) => v.id === u.id);
  const input = { target: { kind: 'unit', unit }, detail: { type: 'chess', chess: u.def.raw, diy: true }, getChess, field: {} };
  const tiles = () => {
    const r = inspectRange({ ...input, live: unitStatsEntry(u, u.s), snapshot: h.b.snapshot().units.find((v) => v[0] === u.id) });
    return rangeTiles(r.grid, r.row, r.col, r.dir);
  };
  assert.deepEqual(tiles(), [[10, 4], [11, 4], [12, 4]]);
  h.b.retreat(h.unit(2), { reason: 'expired', permanent: true });
  h.run(0.5);
  assert.deepEqual(tiles(), [[10, 4], [10, 5], [10, 6]]);
});

test('user Given strategy medics When inspecting them Then their healing tiles rotate on the field', () => {
  for (const id of ['char_613_acmedc', 'char_605_cmedic']) {
    const r = inspectRange(args(medic(id)));
    assert.equal(r.healing, true);
    assert.equal(r.grid.length, 12);
    const tiles = rangeTiles(r.grid, r.row, r.col, r.dir);
    assert.equal(tiles.length, 12);
    assert.ok(tiles.some(([row, col]) => row === 12 && col === 4));
    assert.ok(!tiles.some(([row]) => row === 8));
  }
});

test('user Given a prepared map medic When its card opens Then its board-space range is visible before battle', () => {
  for (const id of ['char_605_cmedic', 'char_613_acmedc']) {
    const unit = medic(id, { id: -1, uid: -1, area: 'board', x: 2, y: 10, dir: 'RIGHT' });
    const r = inspectRange({ ...args(unit), target: { kind: 'unit', unit, prepMapChar: true }, showPrep: true,
      field: { prep: false }, snapshot: [99, 18, 3, 1202, 1202] });
    assert.deepEqual([r.row, r.col, r.dir], [10, 2, 'RIGHT'], 'use the original board coordinates even on the mirrored boss half');
    assert.equal(rangeTiles(r.grid, r.row, r.col, r.dir).length, 12);
    assert.equal(inspectRange({ ...args(unit), target: { kind: 'unit', unit }, showPrep: true }), null,
      'other unit cards do not become prep-range previews');
  }
});

test('user Given a moving battle medic When its current range changes Then the overlay follows live range and position', () => {
  const r = inspectRange(args(medic(), { field: { prep: false }, snapshot: [71, 8, 10, 120, 200], live: { range: tokens.char_613_acmedc.skill.rangeGrid } }));
  assert.equal(r.grid.length, 18);
  assert.deepEqual([r.row, r.col, r.dir], [10, 8, 'UP']);
  const tiles = rangeTiles(r.grid, r.row, r.col, r.dir);
  assert.ok(tiles.some(([row, col]) => row === 15 && col === 9));
  assert.ok(!tiles.some(([, col]) => col === 5));
});

test('user Given an enemy, scouted hand or absent battle unit When inspecting Then no attack tiles appear', () => {
  for (const extra of [{ side: 'enemy' }, { area: 'hand' }, { area: 'temp' }, { kind: 'device' }]) {
    assert.equal(inspectRange(args(medic(undefined, extra))), null);
  }
  assert.equal(inspectRange(args(medic(), { field: { prep: false } })), null);
  assert.equal(inspectRange(args(medic(), { field: {}, snapshot: [71, 5, 9, 0, 200] })), null);
  assert.equal(inspectRange(args(medic(), { showPrep: true })), null);
  assert.equal(inspectRange(args(medic(), { live: { range: [] } })), null);
});

test('user Given an own board operator When its details open Then its range uses the board direction and clears off board', () => {
  const piece = { kind: 'chess', id: 'chess_char_1_01_a', uid: 5, dir: 'LEFT' };
  const input = { target: { kind: 'piece', uid: 5 }, detail: { type: 'chess', chess: chess[piece.id], piece },
    pieces: new Map([[5, { piece, area: 'board', row: 11, col: 2 }]]), showPrep: true, getChess };
  const r = inspectRange(input);
  const tiles = rangeTiles(r.grid, r.row, r.col, r.dir);
  assert.ok(tiles.every(([, col]) => col >= 0 && col <= 2));
  assert.ok(tiles.some(([, col]) => col === 0));
  assert.equal(inspectRange({ ...input, pieces: new Map() }), null);
  assert.equal(inspectRange({ ...input, target: { kind: 'chess', id: piece.id } }), null);
  assert.equal(inspectRange({ ...input, showPrep: false }), null);
});

test('a scouted prep board (the server\'s m.field): the board operator draws its range, the bench (area hand / temp) none', async () => {
  const { makeMatch, give, giveItem, legalTileFor, chessOfTier } = await import('../match/harness.js');
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 44, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const b = h.ps('p_1');
  m.handle('p_1', { t: 'g.ready', ready: false });
  for (const p of [...b.board.values(), ...b.hand.filter(Boolean), ...b.temp.filter(Boolean)]) if (p.kind === 'chess') b.returnCopies(p);
  b.board.clear(); b.hand.fill(null); b.temp.fill(null); b.recompute();
  const [id1, id2, id3] = chessOfTier(1, (c) => c.position === 'MELEE').filter((x) => m.pool.has(x));
  const deployed = give(m, b, id1);
  const [r, c] = legalTileFor(m, b, id1);
  m.handle('p_1', { t: 'g.move', uid: deployed.uid, to: { area: 'board', row: r, col: c }, dir: 'UP' });
  const held = give(m, b, id2);
  while (b.hand.some((x) => x == null)) giveItem(m, b, 'chess_item_6_09_e_a'); // a full hand keeps the temp piece in temp
  const waiting = give(m, b, id3, 'temp');
  m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_1' });
  const field = h.lastTo('p_0', 'm.field');
  const range = (piece) => {
    const unit = renderInfo(field.units.find((u) => u.uid === piece.uid));
    return inspectRange({ target: { kind: 'unit', unit }, detail: { type: 'chess', chess: chess[piece.id] }, field, getChess });
  };
  const own = range(deployed);
  assert.deepEqual([own.row, own.col, own.dir], [r, c, 'UP']);
  assert.equal(range(held), null, 'a held operator (area hand) has no field range');
  assert.equal(range(waiting), null, 'nor one in the 临时整备区 (area temp)');
  m.dispose();
});

test('range colour follows normal healing, not the MEDIC profession or an incidental heal', () => {
  const orange = { group: 'selRange', color: 0xff9c33, fill: 0.3, line: 0.95 };
  const healers = Object.values(chess).filter(c => c.dmgType === 'heal');
  assert.ok(healers.length > 0);
  for (const c of healers) {
    const piece = { uid: 71, kind: 'chess', id: c.chessId, dir: 'RIGHT' };
    const r = inspectRange({ target: { kind: 'piece', uid: 71 }, detail: { type: 'chess', chess: c },
      pieces: new Map([[71, { area: 'board', row: 9, col: 5, piece }]]), showPrep: true, getChess });
    assert.equal(r.healing, true, c.name);
    assert.equal(rangeStyle(orange, r.healing).color, HEAL_RANGE_COLOR);
    assert.equal(rangeStyle(orange, r.healing).group, 'selRange');
  }
  for (const c of Object.values(chess).filter(c => c.profession === 'MEDIC' && c.dmgType === 'arts')) {
    assert.equal(isHealingRange(c), false, c.name);
  }
  assert.equal(isHealingRange({ profession: 'SUPPORT', dmgType: 'arts', heal: { mode: 'single' } }), false);
  assert.equal(isHealingRange(null), false);
  assert.equal(rangeStyle(orange, false), orange);
});
