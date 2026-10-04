// 折射 while silenced: the enemy card greys the SILENCE-format line; the status icon is mapped and not drawn
// under silence. The sim already drops the RES bonus (enemies.js) — not asserted here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { abilityRows } from '../../public/js/ui/abilityLines.js';
import { statusIconKey, statusIconSuppressed } from '../../public/js/render/style.js';

const scout = JSON.parse(readFileSync(new URL('../../data/enemies.json', import.meta.url), 'utf8')).enemy_1166_dusbr;

test('折射: the card line greys only while silenced; the icon key exists and is suppressed under silence', () => {
  const on = abilityRows(scout.abilities, false);
  assert.equal(on.length, 1);
  assert.match(on[0].text, /折射/);
  assert.equal(on[0].off, false);
  const off = abilityRows(scout.abilities, true);
  assert.equal(off[0].off, true, 'grey the 折射 line');
  assert.equal(off[0].text, on[0].text, 'the words stay');
  assert.equal(abilityRows([{ text: '普通攻击', format: 'NONE' }], true)[0].off, false);
  assert.equal(abilityRows(['plain'], true)[0].off, false);
  assert.equal(statusIconKey('ab:refraction'), 'refraction');
  const both = new Set(['ab:refraction', 'silence']);
  assert.equal(statusIconSuppressed('ab:refraction', both), true, 'drop the icon while silenced');
  assert.equal(statusIconSuppressed('silence', both), false, 'the silence icon itself stays');
  assert.equal(statusIconSuppressed('ab:refraction', new Set(['ab:refraction'])), false, 'the icon shows while 折射 is on');
});
