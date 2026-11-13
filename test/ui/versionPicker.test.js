// Current-version logic of the 游戏版本 cards (ui/versionPicker.js). No DOM: a fake root
// stands in for the open list, and the season comes from the version's family or period.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrollCurrentCard, versionSeason } from '../../public/js/ui/versionPicker.js';

test('a regulation family or period is a 规程 card; every other official period is 盟约', () => {
  assert.equal(versionSeason({ id: 'act3autochess@V3_1', family: 'regulation' }), 'regulation');
  assert.equal(versionSeason({ id: 'act3autochess@V3_1' }), 'regulation', 'the period table is enough');
  assert.equal(versionSeason('act3autochess@V3_1'), 'regulation');
  assert.equal(versionSeason({ id: 'act2autochess' }), 'covenant');
  assert.equal(versionSeason('act1autochess@V1_1'), 'covenant');
  assert.equal(versionSeason({ id: 'not-a-version' }), 'covenant');
  assert.equal(versionSeason(null), 'covenant');
});

test('opening the picker scrolls the current card, and only that card', () => {
  const seen = [];
  const row = { scrollIntoView: (opts) => seen.push(opts) };
  const root = {
    querySelector(sel) {
      assert.equal(sel, '.verpick__row.is-on, .verpick__row[aria-selected="true"]');
      return row;
    },
  };
  assert.equal(scrollCurrentCard(root), row);
  assert.deepEqual(seen, [{ block: 'nearest', inline: 'nearest' }]);
  assert.equal(scrollCurrentCard({ querySelector: () => null }), null);
  assert.equal(scrollCurrentCard(null), null);
});
