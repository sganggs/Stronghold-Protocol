import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDataStore } from '../../public/js/data.js';

test('setContent updates langs on the same values map (version i18n can appear without a new cs)', async () => {
  const chess = { chess_a: { name: '甲' } };
  const values = new Map([['chess', chess], ['config', { version: { id: 'act3autochess@V3_1' } }]]);
  const en = {
    version: 1,
    lang: 'en',
    names: { '甲': 'Alpha' },
    files: { chess: { chess_a: { name: 'Alpha', _h: 'aa' } } },
  };
  // force a matching hash so the leaf applies
  const { textHash2, buildRecordOverlay } = await import('../../shared/i18nData.js');
  en.files.chess.chess_a = buildRecordOverlay([{ path: ['name'], zh: '甲', en: 'Alpha' }]);
  assert.equal(en.files.chess.chess_a._h, textHash2('甲'));

  const d = createDataStore({ fetch: async () => ({ ok: false, status: 404, json: async () => null }), retryDelays: [] });
  await d.setLocale('en', ['en']);
  // first: version set without i18n
  d.setContent({ id: 'cs1', values, overlay: null, langs: [] });
  assert.equal(d.lookup('chess', 'chess_a').name, '甲');
  // same values map, now with i18n — must apply
  d.setContent({
    id: 'cs1',
    values,
    overlay: async () => en,
    langs: ['en'],
  });
  // setLocale is async from setContent; wait a tick for it
  await new Promise((r) => setTimeout(r, 20));
  await d.setLocale('en', ['en']);
  assert.equal(d.lookup('chess', 'chess_a').name, 'Alpha');
});
