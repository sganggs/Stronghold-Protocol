import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Persistence } from '../../server/persistence.js';
import { makeMatch, give, giveItem, DATA } from './harness.js';

test('user Given items and distinct operators When applying equipment consumables and Arts Then history identifies the original targets', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'stronghold-actions-'));
  const storage = new Persistence(directory);
  const id = storage.startMatch({});
  const h = makeMatch({ mode: 'solo', seed: 27 }).start();
  t.after(() => { h.m.dispose(); storage.close(); rmSync(directory, { recursive: true, force: true }); });
  h.toPrep(1);
  h.setStage('act2autochess_m04');
  const ps = h.ps('p_0');
  h.m.onAction = (action) => storage.recordAction(id, action);
  const target = give(h.m, ps, 'chess_char_1_01_a');
  const other = give(h.m, ps, 'chess_char_1_04_a');
  const targetId = target.id;
  const equip = (item, piece) => h.m.handle('p_0', { t: 'g.equip', itemUid: item.uid, targetUid: piece.uid });
  const sword = giveItem(h.m, ps, 'chess_item_1_01_e_a');
  assert.deepEqual(equip(sword, target), { ok: true });
  assert.ok(equip(sword, other).error, 'an equipped item cannot be applied again');
  const coin = giveItem(h.m, ps, 'chess_item_1_03_e_a');
  assert.deepEqual(equip(coin, other), { ok: true });
  const promotion = giveItem(h.m, ps, 'chess_item_5_06_e_b');
  assert.deepEqual(equip(promotion, target), { ok: true });
  assert.notEqual(target.id, targetId, 'the effect changes the operator tier');
  const boardTarget = give(h.m, ps, 'chess_char_1_02_a', 'board', [9, 3]);
  const art = giveItem(h.m, ps, 'chess_item_6_02_m');
  assert.deepEqual(h.m.handle('p_0', { t: 'g.art', itemUid: art.uid, row: 9, col: 3 }), { ok: true });
  const shield = giveItem(h.m, ps, 'chess_item_1_02_e_a');
  const wand = giveItem(h.m, ps, 'chess_item_3_03_e_a');
  assert.deepEqual(equip(shield, other), { ok: true });
  assert.deepEqual(equip(wand, other), { ok: true });
  const replacement = giveItem(h.m, ps, 'chess_item_2_03_e_a');
  assert.deepEqual(h.m.handle('p_0', { t: 'g.equip', itemUid: replacement.uid, targetUid: other.uid, replaceUid: wand.uid }), { ok: true });
  const twin = giveItem(h.m, ps, shield.id);
  assert.deepEqual(equip(twin, other), { ok: true });
  const actions = readFileSync(join(directory, 'matches', `${id}.actions.jsonl`), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(actions.map((a) => [a.type, a.itemId, a.itemUid, a.targets.map((p) => p.uid)]), [
    ['item.use', sword.id, sword.uid, [target.uid]],
    ['item.use', coin.id, coin.uid, [other.uid]],
    ['item.use', promotion.id, promotion.uid, [target.uid]],
    ['item.use', art.id, art.uid, [boardTarget.uid]],
    ['item.use', shield.id, shield.uid, [other.uid]],
    ['item.use', wand.id, wand.uid, [other.uid]],
    ['item.use', replacement.id, replacement.uid, [other.uid]],
    ['item.merge', twin.id, twin.uid, []],
  ]);
  assert.deepEqual(actions[2].targets, [{ uid: target.uid, id: targetId, charId: DATA.chess[targetId].charId }]);
  assert.ok(actions.every((a) => a.playerId === 'p_0' && a.round === 1 && Number.isFinite(a.at)));
  assert.deepEqual(actions[3].tile, { row: 9, col: 3, dir: 'RIGHT' });
  assert.equal(actions[6].replacedUid, wand.uid, 'replacement identifies the selected item, not the oldest');
});
