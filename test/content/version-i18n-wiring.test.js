// Version content sets may ship i18n/<lang>.json; the client must attach them as setContent overlays (M3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDataStore } from '../../public/js/data.js';
import { contentIndexOf } from '../../server/plugins/identity.js';
import { buildRecordOverlay, textHash2 } from '../../shared/i18nData.js';

test('contentIndexOf lists version i18n URLs without changing the caller-supplied cs', () => {
  const content = {
    cs: 'a'.repeat(64),
    app: '0.4.0',
    vanilla: true,
    sim: 'b'.repeat(64),
    simFiles: {},
    data: { chess: { file: 'chess.json', sha256: 'c'.repeat(64), bytes: 10 } },
  };
  const index = contentIndexOf(content, {
    dataUrl: '/data/versions/act3autochess-v3_1/',
    version: 'act3autochess@V3_1',
    i18n: { en: { file: 'i18n/en.json', sha256: 'd'.repeat(64), bytes: 99 } },
  });
  assert.equal(index.cs, content.cs);
  assert.equal(index.i18n.en.url, '/data/versions/act3autochess-v3_1/i18n/en.json?v=dddddddd');
  assert.equal(index.i18n.en.bytes, 99);
});

test('version content set with own English overlay localizes chess names', async () => {
  const zhName = '测试干员';
  const chess = { chess_test_a: { name: zhName, skill: { name: '技能', descRaw: '描述' } } };
  const leaves = [
    { path: ['name'], zh: zhName, en: 'Test Operator' },
    { path: ['skill', 'name'], zh: '技能', en: 'Skill' },
    { path: ['skill', 'descRaw'], zh: '描述', en: 'Description' },
  ];
  const en = {
    version: 1,
    lang: 'en',
    meta: { totals: { texts: 3, translated: 3 } },
    names: { [zhName]: 'Test Operator' },
    files: { chess: { chess_test_a: buildRecordOverlay(leaves) } },
  };
  assert.equal(en.files.chess.chess_test_a._h.slice(0, 2), textHash2(zhName));

  const d = createDataStore({
    fetch: async () => ({ ok: false, status: 404, json: async () => null }),
    retryDelays: [],
  });
  d.setContent({
    id: 'cs-act3-test',
    values: { chess, config: { version: { id: 'act3autochess@V3_1' } } },
    overlay: async () => en,
    langs: ['en'],
  });
  await d.setLocale('en');
  assert.equal(d.lookup('chess', 'chess_test_a').name, 'Test Operator');
  assert.equal(d.lookup('chess', 'chess_test_a').skill.name, 'Skill');
  assert.equal(d.getRaw('chess').chess_test_a.name, zhName);
});
