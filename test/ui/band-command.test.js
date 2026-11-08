import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commandText, commandStatus, commandUnlock } from '../../public/js/ui/bandCommand.js';
import { data } from '../../public/js/data.js';

const bands = JSON.parse(readFileSync(new URL('../../data/versions/act3autochess-v3_1/bands.json', import.meta.url), 'utf8'));

test('command rich text expands replacement clauses and unlock text without leaving placeholder tokens', t => {
  const get = data.get; data.get = file => file === 'bands' ? bands : get(file); t.after(() => { data.get = get; });
  for (const band of Object.values(bands)) for (const s of band.skills) assert.ok(!/\{@(?:tag|unlock)\}/.test(commandText(s)), s.effectId);
  assert.match(commandText(bands.band_sargon.skills[0]), /在场6名不同【萨尔贡】/);
  assert.match(commandText(bands.band_rich.skills[0]), /120时升级为获取2名/);
  assert.ok(!commandText(bands.band_mlynar.skills[0]).includes('undefined'));
});

test('command HUD distinguishes locks, cooldown, stocks, recruitment and insufficient funds', () => {
  assert.match(commandUnlock({ unlockType: 'band_skill_load_by_round', unlockParam: ['4'] }), /4/);
  assert.match(commandStatus({ cooldown: 3 }), /3/);
  assert.match(commandStatus({ usesLeft: 0 }), /0/);
  assert.notEqual(commandStatus({ reason: 'funds' }), commandStatus({ reason: 'specialRecruit' }));
  assert.notEqual(commandStatus({ reason: 'passive' }), commandStatus({ usesLeft: 1 }));
});
