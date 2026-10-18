import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getData } from '../../server/data.js';
import { expandRecords } from '../../shared/plugins/records.js';
import { validateData } from '../../shared/plugins/validate.js';
import { checkPluginFolder } from '../../server/plugins/pack.js';
import { GameData } from '../../server/match/gamedata.js';
import { fixture, guard } from '../helpers/contentFixtures.js';
import { rosterOf } from '../../public/js/ui/loadoutModel.js';
import { chessAvatarUrl, chessPortraitUrl } from '../../public/js/ui/assetUrls.js';
import { mergeProgress } from '../../public/js/ui/gameLogic/shop.js';
import { bondMembers } from '../../public/js/ui/gameLogic/bonds.js';
import { diyRecord } from '../../shared/diy.js';
const base = getData(), pluginId = 'data-demo';
const ids = { normal: 'chess_x_data_demo_seed_b', elite: 'chess_x_data_demo_bloom' };

test('hidden explicit pairs remain addressable, absent from shop, handbook and recruit pools', () => {
  const op = guard();
  op.chess = { ...op.chess, hidden: true, ids };
  op.origin = { chessId: 'chess_char_1_02_a', charId: base.chess.chess_char_1_02_a.charId };
  op.art = { ref: 'char_102_texas', assets: { portrait: 'custom_portrait', spineGolden: 'custom_model', voice: 'custom_voice' } };
  const r = expandRecords(base, [op], { pluginId });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(validateData(r.data), []);
  const a = r.data.chess[ids.normal], b = r.data.chess[ids.elite];
  assert.equal(a.upgradeChessId, ids.elite);
  assert.equal(b.baseId, ids.normal);
  assert.deepEqual(a.origin, op.origin);
  assert.equal(a.assets.portrait, 'custom_portrait');
  assert.equal(b.assets.spine, 'custom_model');
  assert.equal(b.assets.voice, 'custom_voice');
  assert.equal(chessPortraitUrl({ chars: { custom_portrait: { portrait: '/custom.png' } } }, a), '/custom.png');
  assert.ok(!new GameData(r.data).visibleChess.includes(ids.normal));
  assert.ok(!rosterOf(Object.values(r.data.chess)).some(c => c.chessId === ids.normal));
  assert.ok(!r.data.backups.diy.ownedPool.includes(op.charId));
  for (const bond of op.chess.bonds) assert.ok(!r.data.bonds[bond].visibleMembers.includes(ids.normal));
  assert.equal(mergeProgress({ hand: [{ kind: 'chess', id: ids.normal }] }, ids.normal, id => r.data.chess[id]).copies, 1);
  assert.equal(diyRecord('chess_char_5_diy1_a', { charId: op.charId }, { data: r.data }), null);
  op.chess.hidden = false;
  const visible = expandRecords(base, [op], { pluginId });
  const d = diyRecord('chess_char_5_diy1_a', { charId: op.charId, skillIndex: 0 }, { elite: true, data: visible.data });
  assert.equal(d.assets.spine, 'custom_model');
  assert.equal(d.assets.voice, 'custom_voice');
});

test('a hidden pair bonded to a bond with no visible members is not drawn', () => {
  const op = guard();
  op.chess = { ...op.chess, hidden: true, bonds: ['deputShip'] };
  const bondId = 'deputShip';
  const input = { ...base, bonds: { ...base.bonds, [bondId]: { ...base.bonds[bondId], members: [], visibleMembers: [] } } };
  const r = expandRecords(input, [op], { pluginId });
  assert.deepEqual(r.problems, []);
  const bond = r.data.bonds[bondId];
  const hiddenId = 'chess_x_data_demo_guard_a';
  assert.ok(bond.members.includes(hiddenId));
  assert.deepEqual(bond.visibleMembers, []);
  const rows = bondMembers(bond, null, [], (id) => r.data.chess[id]);
  assert.equal(rows.some((row) => row.id === hiddenId), false);
  assert.equal(rows.length, 0);
  assert.equal(bondMembers({ bondId: 'legacy', members: ['kept'] }, null, [], () => ({ name: 'K', tier: 1 })).length, 1);
  assert.ok(!new GameData(r.data).visibleChess.includes(hiddenId));
  assert.ok(!rosterOf(Object.values(r.data.chess)).some((c) => c.chessId === hiddenId));
});

test('art.ref is an asset id, and an elite art.ref uses the character E2 portrait', () => {
  for (const ref of ['../secret', 'https://evil.example/a']) {
    const op = guard();
    op.art = { ref };
    const r = expandRecords(base, [op], { pluginId });
    assert.equal(r.data, base);
    assert.equal(r.problems[0].code, 'PLUGIN_RECORD_ART', ref);
  }
  const op = guard();
  op.art = { ref: 'char_498_inside' };
  const r = expandRecords(base, [op], { pluginId });
  assert.deepEqual(r.problems, []);
  const manifest = JSON.parse(readFileSync(new URL('../../data/assets.json', import.meta.url), 'utf8'));
  const normal = r.data.chess.chess_x_data_demo_guard_a;
  const elite = r.data.chess.chess_x_data_demo_guard_b;
  const entry = manifest.chars.char_498_inside;
  assert.equal(chessPortraitUrl(manifest, elite), entry.portraitE2);
  assert.equal(chessPortraitUrl(manifest, normal), entry.portrait);
  assert.equal(chessAvatarUrl(manifest, elite), entry.avatarE2);
  assert.equal(chessAvatarUrl(manifest, normal), entry.avatar);
  assert.equal(elite.assets.spine, 'char_498_inside');
  assert.equal(normal.assets.spine, elite.assets.spine);
  assert.equal(elite.assets.voice, 'char_498_inside');
  assert.equal(normal.assets.voice, elite.assets.voice);
});

test('strict checking and atomic expansion share metadata diagnostics', t => {
  const { put } = fixture(t);
  for (const [change, code] of [
    [r => { r.chess.hidden = 'yes'; }, 'PLUGIN_RECORD_HIDDEN'],
    [r => { r.chess.ids = { normal: ids.normal, elite: ids.normal }; }, 'PLUGIN_RECORD_PAIR'],
    [r => { r.chess.ids = { normal: ids.normal, elite: 'chess_x_other_no' }; }, 'PLUGIN_RECORD_PAIR'],
    [r => { r.art = { assets: { portrait: '../bad.png' } }; }, 'PLUGIN_RECORD_ART'],
    [r => { r.origin = { chessId: 'missing' }; }, 'PLUGIN_RECORD_ORIGIN'],
    [r => { r.origin = { chessId: 'chess_char_1_02_a', charId: 'char_103_angel' }; }, 'PLUGIN_RECORD_ORIGIN'],
  ]) {
    const op = guard(); change(op);
    const r = expandRecords(base, [op], { pluginId });
    assert.equal(r.data, base);
    assert.equal(r.problems[0].code, code);
    const dir = put(pluginId, { operators: ['op.json'] }, { 'op.json': op });
    const check = checkPluginFolder(dir, pluginId);
    assert.ok(check.issues.some(i => i.code === code), JSON.stringify(check));
  }
});
