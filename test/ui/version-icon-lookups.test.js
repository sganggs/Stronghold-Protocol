// Audit the ID → record → art path against all installed official versions, in one warm store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDataStore } from '../../public/js/data.js';
import { makeData } from '../../public/js/render/app/host.js';
import { VERSIONS } from '../../shared/versions.js';
import { diyRecordOf } from '../../shared/diy.js';
import { standInRecord } from '../../shared/standIn.js';
import { garrisonTypeIconKey } from '../../public/js/ui/detailPanel.js';
import { chessAvatarUrl, chessPortraitUrl, skillIconUrl, itemIconUrl, bondIconUrl, bandIconUrl,
  enemyIconUrl, tokenAvatarUrl, effectIconUrl } from '../../public/js/ui/assetUrls.js';

const read = (dir, file) => JSON.parse(readFileSync(new URL(`../../${dir}/${file}.json`, import.meta.url)));
const files = ['config', 'chess', 'items', 'enemies', 'tokens', 'bonds', 'bands', 'garrisons', 'effects', 'backups'];
const manifest = read('data', 'assets');

test('warm record indexes and art helpers follow every version, then restore the default without refetching', async () => {
  const originals = Object.fromEntries(files.map(name => [name, read('data', name)]));
  let fetched = 0;
  const store = createDataStore({ fetch: async url => {
    fetched++;
    return { ok: true, json: async () => originals[url.split('/').at(-1).replace('.json', '')] };
  } });
  await store.loadAll(...files);
  const view = makeData(store);
  const sets = VERSIONS.filter(v => v.dir).map(v => ({ id: v.id,
    values: Object.fromEntries(files.map(name => [name, read(`data/${v.dir}`, name)])) }));
  for (const set of [null, ...sets, null, ...sets.toReversed(), null]) {
    store.setContent(set);
    const records = set?.values || originals;
    for (const file of files.filter(n => !['config', 'backups'].includes(n))) {
      for (const [id, record] of Object.entries(records[file])) {
        assert.equal(store.lookup(file, id), record, `${set?.id || 'default'} ${file}/${id}: active names, descriptions and rules`);
      }
    }
    for (const c of Object.values(records.chess).filter(c => c.charId && !c.isDiy)) {
      assert.equal(view.chess(c.chessId), c);
      assert.ok(chessAvatarUrl(manifest, c), c.chessId);
      assert.ok(chessPortraitUrl(manifest, c), c.chessId);
      assert.equal(skillIconUrl(manifest, c), manifest.skills[c.assets.skillIcon], c.chessId);
      assert.deepEqual(view.standIn(c.chessId), standInRecord(c, records.backups), `${c.chessId}: active stand-in`);
    }
    for (const c of Object.values(records.chess).filter(c => c.isDiy)) {
      for (const charId of records.backups.diy.prototypes[c.tier]) {
        const pick = { charId };
        assert.deepEqual(view.diy(c.chessId, pick), diyRecordOf(c, pick, records), `${set?.id || 'default'} ${c.chessId}/${charId}: active DIY`);
      }
    }
    for (const it of Object.values(records.items)) {
      assert.equal(view.item(it.id), it);
      assert.equal(itemIconUrl(manifest, view.item(it.id)), manifest.items[it.iconId], it.name);
    }
    for (const id of Object.keys(records.bonds)) assert.equal(bondIconUrl(manifest, id), manifest.bonds[id]);
    for (const id of Object.keys(records.bands)) assert.equal(bandIconUrl(manifest, id), manifest.bands[id]);
    for (const id of Object.keys(records.enemies)) assert.equal(enemyIconUrl(manifest, id), manifest.enemies[id]?.icon || null);
    for (const id of Object.keys(records.tokens)) {
      assert.equal(view.token(id), records.tokens[id]);
      const t = manifest.tokens[id];
      // a map character / an enemy fielded as a summon falls back to its own avatar / icon (§37.201)
      const own = id.startsWith('char_') ? manifest.chars[id]?.avatar : id.startsWith('enemy_') ? manifest.enemies?.[id]?.icon : null;
      assert.equal(tokenAvatarUrl(manifest, id), t?.avatar || manifest.chars[t?.owner]?.avatar || own || null);
    }
    for (const g of Object.values(records.garrisons)) {
      const iconId = garrisonTypeIconKey(g);
      assert.equal(iconId, `s_${g.eventTypeIcon}`, g.garrisonId);
      assert.ok(manifest.ui[`garrisonTypeIcon/${iconId}`]);
      assert.equal(effectIconUrl(manifest, { iconKind: 'garrison', iconId }), manifest.ui[`garrisonTypeIcon/${iconId}`]);
    }
    const item = store.lookup('items', 'chess_item_2_07_e_a');
    assert.equal(item.name, set?.id.startsWith('act1') ? '迅捷作战粮' : '见钱眼开玩偶');
  }
  assert.equal(fetched, files.length, 'returning to the default reuses its own original files');

  // A content overlay can replace backups while retaining the same chess objects.
  const changedBackups = structuredClone(originals.backups);
  const source = Object.values(originals.chess).find(c => standInRecord(c, originals.backups));
  const old = view.standIn(source.chessId);
  changedBackups.units[old.charId].name = 'Replacement stand-in';
  store.setContent({ id: 'backups-only', values: { backups: changedBackups } });
  assert.equal(view.standIn(source.chessId).name, 'Replacement stand-in');
  assert.equal(view.standIn(source.chessId), view.standIn(source.chessId), 'unchanged inputs still reuse the composition');
});
