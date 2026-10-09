import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeSettings } from '../../public/js/ui/gameLogic/settings.js';
import { filterRoster, changedCount, rosterOf } from '../../public/js/ui/loadoutModel.js';
import { setVoiceOverride, voiceLanguageFor } from '../../public/js/ui/gameLogic/operatorVoice.js';

test('old settings follow the global dub; valid per-operator preferences survive persistence', () => {
  assert.deepEqual(sanitizeSettings({ voiceLang: 'jp' }).voiceOverrides, {});
  const raw = { voiceLang: 'jp', voiceOverrides: { char_263_skadi: 'cn', char_1012_skadi2: 'jp' } };
  const clean = sanitizeSettings(raw);
  assert.deepEqual(clean.voiceOverrides, raw.voiceOverrides);
  assert.deepEqual(sanitizeSettings(JSON.parse(JSON.stringify(clean))), clean);
});

test('edits share charId across forms, keep alters separate and reset to the current global language', () => {
  const first = setVoiceOverride({}, 'char_263_skadi', 'jp');
  const both = setVoiceOverride(first, 'char_1012_skadi2', 'cn');
  assert.deepEqual(first, { char_263_skadi: 'jp' }, 'the old map is not mutated');
  assert.equal(voiceLanguageFor(both, 'char_263_skadi', 'cn'), 'jp');
  assert.equal(voiceLanguageFor(both, 'char_1012_skadi2', 'jp'), 'cn');
  const reset = setVoiceOverride(both, 'char_263_skadi', '');
  assert.deepEqual(reset, { char_1012_skadi2: 'cn' });
  assert.equal(voiceLanguageFor(reset, 'char_263_skadi', 'cn'), 'cn');
  assert.equal(voiceLanguageFor(reset, 'char_263_skadi', 'jp'), 'jp');
});

test('voice preferences reject invalid languages, unsafe IDs, arrays and prototype properties', () => {
  const raw = JSON.parse('{"char_a":"jp","__proto__":"cn","constructor":"jp","char_b":"kr","../char_c":"cn"}');
  assert.deepEqual(sanitizeSettings({ voiceOverrides: raw }).voiceOverrides, { char_a: 'jp' });
  assert.deepEqual(sanitizeSettings({ voiceOverrides: ['cn'] }).voiceOverrides, {});
  assert.deepEqual(sanitizeSettings({ voiceOverrides: Object.create({ char_a: 'jp' }) }).voiceOverrides, {});
  const many = Object.fromEntries(Array.from({ length: 2100 }, (_, i) => [`char_${i}`, 'jp']));
  assert.ok(Object.keys(sanitizeSettings({ voiceOverrides: many }).voiceOverrides).length <= 2048);
});

test('voice-only edits participate in roster filtering/counts; multiple edits count an operator once', () => {
  const raw = JSON.parse(readFileSync(new URL('../../data/chess.json', import.meta.url), 'utf8'));
  const all = Array.isArray(raw) ? raw : Object.values(raw);
  const roster = rosterOf(all);
  const get = (id) => all.find((c) => c.chessId === id);
  const first = roster[0];
  assert.ok(first);
  const overrides = { [first.charId]: 'jp', char_retired: 'cn' };
  assert.deepEqual(filterRoster(roster, { changedOnly: true }, {}, get, () => null, {}, overrides), [first]);
  assert.equal(changedCount({}, get, {}, roster, overrides), 1);
  assert.equal(changedCount({}, get, { [first.charId]: { potential: 1, tier: 'low' } }, roster, overrides), 1);
});
