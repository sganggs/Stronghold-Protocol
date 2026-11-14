// test/ui/show-tags.test.js — the client's {showtag_value_N} filling (public/js/ui/showTags.js, §37.201): the server's
// live values first, else the record's starting value (定期存折 0, an upgrading 特质's first grant, a round counter 0),
// never the raw placeholder. Server side: test/match/show-tags.test.js.
// Run: node --test test/ui/show-tags.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fillShowTags, itemShowStart, garrisonShowStart, itemText, garrisonText } from '../../public/js/ui/showTags.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../../data/versions/act3autochess-v3_1/${p}`, import.meta.url), 'utf8'));
const ITEMS = read('items.json');
const GARRISONS = read('garrisons.json');

test('fillShowTags: live value, else the fallback, else 0; texts without a placeholder untouched', () => {
  assert.equal(fillShowTags('获得{showtag_value_1}资金', [5]), '获得5资金');
  assert.equal(fillShowTags('获得{showtag_value_1}资金', [null], [0]), '获得0资金');
  assert.equal(fillShowTags('+{showtag_value_1}', null, [1]), '+1');
  assert.equal(fillShowTags('+{showtag_value_1}', undefined), '+0');
  assert.equal(fillShowTags('a{showtag_value_2}b{showtag_value_1}', [3, 4]), 'a4b3');
  assert.equal(fillShowTags('plain <@ba.vup>+1</>', [9]), 'plain <@ba.vup>+1</>');
  assert.equal(fillShowTags(null, [1]), '');
});

test('定期存折: the shop card reads its starting 0, the held piece what it pays now; the markup stays', () => {
  const rec = ITEMS.chess_item_3_15_e_a;
  assert.deepEqual(itemShowStart(rec), [0]);
  assert.equal(itemText(rec), '<@ba.vdown>装备时销毁</>，获得0资金（持有时每回合<@ba.vup>+1</>）');
  assert.equal(itemText(rec, { showTag: [4] }), '<@ba.vdown>装备时销毁</>，获得4资金（持有时每回合<@ba.vup>+1</>）');
  assert.ok(!itemText(rec).includes('showtag'));
});

test('特质: upgrading ones start at their first grant, round counters at 0; a piece\'s garrisonTags win', () => {
  assert.deepEqual(garrisonShowStart(GARRISONS.garrison_50_a), [1]);
  assert.deepEqual(garrisonShowStart(GARRISONS.garrison_74_a), [1]);
  assert.equal(garrisonShowStart(GARRISONS.garrison_36_a), null);
  assert.match(garrisonText(GARRISONS.garrison_50_a), /层数<@ba\.vup>\+1<\/>（/);
  assert.match(garrisonText(GARRISONS.garrison_50_a, { garrisonTags: { garrison_50_a: [3] } }), /层数<@ba\.vup>\+3<\/>（/);
  assert.match(garrisonText(GARRISONS.garrison_36_a), /已获得0名/);
  assert.match(garrisonText(GARRISONS.garrison_36_a, { garrisonTags: { garrison_36_a: [2] } }), /已获得2名/);
  for (const g of Object.values(GARRISONS)) assert.ok(!garrisonText(g).includes('{showtag_value_'), g.garrisonId);
});
