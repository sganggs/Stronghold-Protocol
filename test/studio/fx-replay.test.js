import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fxFixture, book } from '../helpers/fxFixtures.js';
import { png } from '../helpers/pluginFixtures.js';
import { addFxReplay } from '../../server/studio/fxReplay.js';
import { createPreviews } from '../../server/studio/preview.js';
import { createPluginRegistry } from '../../server/plugins/registry.js';

test('studio exposes validated flipbooks and replay records through hashed preview files', t => {
  const f = fxFixture(t), id = 'fx-demo';
  f.put(`plugins/${id}/plugin.json`, { manifest: 2, id, name: 'FX', version: '1.0.0', app: '>=0.3.0 <0.4.0', api: 1, class: 'cosmetic',
    permissions: ['assets.add'], scope: ['room'], assets: { fx: { flipbooks: { flash: book() } } } });
  f.put(`plugins/${id}/fx/sheet.png`, png(8, 8)); f.put('data/assets.json', { version: 1, chars: {} });
  const registry = createPluginRegistry({ publicDir: path.join(f.root, 'public'), packsDir: path.join(f.root, 'packs'), pluginsDir: path.join(f.root, 'plugins'), dataDir: path.join(f.root, 'data') });
  const dir = path.join(f.root, 'plugins', id), files = { root: () => dir };
  const p = createPreviews({ vanilla: () => registry.vanillaAssets() }).preview(id, dir);
  assert.equal(p.ops[0].at[0], 'fx');
  assert.match(p.ops[0].value.images['fx/sheet.png'].url, /^\/studio\/api\/plugins\/fx-demo\/f\/[a-f0-9]{8}\/fx\/sheet.png$/);
  const result = { ok: true, plugin: { field: { units: [{ kind: 'op', defId: 'chess_x_fx_demo_a' }] }, frames: [] } };
  addFxReplay(result, registry, id, { chess: { chess_x_fx_demo_a: { fx: { unit: 'char_112_siege' } } } }, files);
  assert.equal(result.plugin.fxAssets[id].config.flipbooks.flash.frames, 4);
  assert.equal(result.plugin.renderRecords.chess.chess_x_fx_demo_a.fx.unit, 'char_112_siege');
});
