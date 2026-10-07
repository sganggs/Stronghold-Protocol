import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectRange } from '../../public/js/screens/game/range.js';
import { renderInfo } from '../../public/js/render/app/info.js';
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
    assert.equal(r.grid.length, 12);
    const tiles = rangeTiles(r.grid, r.row, r.col, r.dir);
    assert.equal(tiles.length, 12);
    assert.ok(tiles.some(([row, col]) => row === 12 && col === 4));
    assert.ok(!tiles.some(([row]) => row === 8));
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
