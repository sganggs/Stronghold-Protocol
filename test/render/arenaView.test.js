// render/arenaView.js: the field a view draws on a 规程 stage (data/versions/act3autochess-v3_1/stages.json `arena`,
// tools/versions/layouts.mjs regulationArena) — the piece of the arena that view shows, placed on the 19×21 grid where
// the sim's composed stage has the same cells.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { arenaField, arenaRegion, arenaViewOf } from '../../public/js/render/arenaView.js';
import { parsePenRect } from '../../public/js/render/pen.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = join(ROOT, 'data/versions/act3autochess-v3_1/stages.json');
const stages = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
const arenaIds = Object.keys(stages).filter((id) => stages[id].arena);
const keyAt = (st, r, c) => st.tiles[st.rows[r][c]]?.tileKey;

test('arenaViewOf: 联防 the unite board, the boss / hidden / Final Assault prep cameras a boss field, the rest a player block', () => {
  assert.equal(arenaViewOf('unite'), 'unite');
  for (const k of ['boss', 'hidden', 'bossPrep']) assert.equal(arenaViewOf(k), 'boss', k);
  for (const k of ['prep', 'normal', 'pen', 'nonsense', undefined]) assert.equal(arenaViewOf(k), 'normal', String(k));
});

test('a stage without an arena (盟约, a plugin stage, 规程\'s escape stages) is drawn as it is', () => {
  const st = { id: 'x', rows: ['r'], tiles: {} };
  for (const v of ['normal', 'unite', 'boss']) assert.equal(arenaField(st, v), st);
  assert.equal(arenaField(null, 'normal'), null);
  assert.equal(arenaRegion(st, 'normal'), null);
  if (stages.act3autochess_escaped_single) assert.equal(arenaField(stages.act3autochess_escaped_single, 'normal'), stages.act3autochess_escaped_single);
});

test('enemy preview retains the originating piece, pen rectangle and devices on every Regulation map', () => {
  for (const kind of ['prep', 'bossPrep', 'boss', 'hidden', 'unite']) {
    const view = arenaViewOf(kind);
    assert.equal(arenaViewOf('pen', kind), view, kind);
    for (const id of arenaIds) {
      const before = arenaField(stages[id], view);
      const preview = arenaField(stages[id], arenaViewOf('pen', kind));
      assert.equal(preview, before, `${id} ${kind}: keep the same piece and device records`);
      assert.deepEqual(parsePenRect(preview.config.enemy_place_rect), parsePenRect(before.config.enemy_place_rect));
    }
  }
});

test('the ten 规程 battlefields: 7 regions at the official rects; four player blocks, 联防, a left and a right boss field', { skip: !arenaIds.length && 'no 规程 data' }, () => {
  assert.equal(arenaIds.length, 10);
  for (const id of arenaIds) {
    const { arena } = stages[id];
    assert.deepEqual(arena.size, [36, 55], id);
    assert.equal(arena.rows.length, 36, id);
    const regions = arena.regions.map((r) => [r.role, r.ownerSeat ?? r.side ?? null, r.rect.join(',')]);
    assert.deepEqual(regions, [
      ['player', 0, '0,6,0,19'], ['player', 1, '0,6,35,54'], ['unite', null, '8,13,17,37'], ['boss', 'L', '15,27,0,20'],
      ['boss', 'R', '15,27,34,54'], ['player', 2, '29,35,0,19'], ['player', 3, '29,35,35,54'],
    ], id);
    // the four player blocks are the same piece
    const block = (r) => arena.rows.slice(r.rect[0], r.rect[1] + 1).map((line) => line.slice(r.rect[2], r.rect[3] + 1)).join('/');
    const players = arena.regions.filter((r) => r.role === 'player').map(block);
    assert.ok(players.every((b) => b === players[0]), `${id}: the player blocks differ`);
  }
});

test('each view draws its piece where the sim\'s composed stage has the same cells; the pen beside the road / above the boss field', { skip: !arenaIds.length && 'no 规程 data' }, () => {
  // (rows of the sim's field per view: the normal road + hand + equipment rows, the 联防 road, the boss field)
  const compare = { normal: [7, 12, 0, 10], unite: [9, 12, 0, 20], boss: [0, 5, 0, 20] };
  const pens = { normal: '((8,12),(12,18))', boss: '((7,7),(11,13))' };
  for (const id of arenaIds) {
    const st = stages[id];
    for (const view of ['normal', 'unite', 'boss']) {
      const f = arenaField(st, view);
      assert.notEqual(f, st);
      assert.equal(arenaField(st, view), f, 'the same object for the same stage and view');
      assert.equal(f.id, st.id);
      assert.equal(f.rows.length, 19);
      assert.ok(f.rows.every((line) => line.length === 21));
      assert.equal(f.arenaView, view);
      assert.deepEqual(f.scenePiece, { group: { normal: 'sub_01', unite: 'sub_02', boss: 'sub_03' }[view], ...{ normal: { dr: 7, dc: 0 }, unite: { dr: 8, dc: 0 }, boss: { dr: 0, dc: 0 } }[view] });
      const [r0, r1, c0, c1] = compare[view];
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) assert.equal(keyAt(f, r, c), keyAt(st, r, c), `${id} ${view} (${r},${c})`);
      if (pens[view]) {
        assert.equal(f.config.enemy_place_rect, pens[view], `${id} ${view} pen`);
        const pen = parsePenRect(f.config.enemy_place_rect);
        assert.ok(['tile_floor', 'tile_start'].includes(keyAt(f, pen.r0, pen.c0)), `${id} ${view}: the pen is floor`);
      } else assert.equal(f.config.enemy_place_rect, st.config?.enemy_place_rect, `${id} 联防 keeps the stage's pen`);
      // outside the piece: void
      const { dr } = f.scenePiece;
      const span = st.arena.regions.find((r) => r.role === { normal: 'player', unite: 'unite', boss: 'boss' }[view]).rect;
      for (let r = 0; r < 19; r++) if (r < dr || r > dr + span[1] - span[0]) assert.equal(f.rows[r], '#'.repeat(21), `${id} ${view} row ${r}`);
      // devices stand on the piece, with the stage device's record of the same key
      for (const d of f.devices) {
        assert.ok(d.pos[0] >= dr && d.pos[0] <= dr + span[1] - span[0], `${id} ${view} device ${d.key} at ${d.pos}`);
        const own = st.devices.find((x) => x.key === d.key);
        if (own) for (const k of Object.keys(own)) if (!(k in st.arena.devices[0]) && k !== 'pos') assert.deepEqual(d[k], own[k], `${id} ${d.key}.${k}`);
      }
    }
    assert.equal(arenaRegion(st, 'normal', 2).ownerSeat, 2, 'seat s draws the block it owns');
    assert.equal(arenaRegion(st, 'normal', 9).ownerSeat, 0, 'an unknown seat draws the first block');
    assert.equal(arenaRegion(st, 'boss').side, 'L');
  }
});
