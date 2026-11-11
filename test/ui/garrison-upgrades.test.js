import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../../server/data.js';

const RAW = getVersionData('act3autochess@V3_1');
globalThis.fetch = async url => {
  const name = String(url).split('/').pop();
  const value = name === 'assets.json' ? {} : RAW[name.replace(/\.json$/, '')];
  return { ok: !!value, status: value ? 200 : 404, json: async () => value || {} };
};
const { data } = await import('../../public/js/data.js');
await data.loadAll('chess', 'items', 'bonds', 'garrisons', 'assets', 'config');
const { resolveDetail, ChessDetail } = await import('../../public/js/ui/detailPanel.js');

for (const group of ['slots', 'rewardOffer']) test(`${group}: detail uses the owner's current upgrade preview`, () => {
  const id = 'chess_char_3_07_a', tags = { garrison_50_a: { showtag_value_1: 9 } };
  const slots = [{ kind: 'chess', id, garrisonTags: tags }];
  const priv = { playerId: 'p_0', shop: group === 'slots' ? { slots } : { rewardOffer: { slots } } };
  const detail = resolveDetail({ kind: 'chess', id }, new Map(), { priv });
  assert.deepEqual(detail.unitGarrisonTags, tags);
  const blocks = ChessDetail(detail), block = blocks.find(v => v?.key === 'garrison');
  assert.deepEqual(block.props.showTags, tags.garrison_50_a);
  for (const target of [{ kind: 'chess', id, foreign: true }, { kind: 'chess', id, owner: 'p_1' }]) {
    assert.equal(resolveDetail(target, new Map(), { priv }).unitGarrisonTags, undefined);
  }
});
