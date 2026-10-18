// GitHub #701: the create-plugin dialog names the fault. The legal set is isPluginId, and `19p` is legal.
// [ASSUMED] Several faults at once show the first of: too short, an upper-case letter, a leading "-",
// a character outside the set, too long. Empty is not a fault (the dialog keeps the generic hint).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPluginId } from '../../shared/plugins/manifest.js';
import { pluginIdIssue } from '../../public/studio/js/pluginId.js';

const HINTS = {
  short: '太短：id 是 2 到 32 位小写字母、数字和连字符',
  upper: '有大写字母：只能用小写字母、数字和连字符',
  lead: '不能以 - 开头',
  char: '有不能用的字符：只能用小写字母、数字和连字符',
  long: '太长：id 是 2 到 32 位小写字母、数字和连字符',
};

test('plugin id: 19p is legal, and each fault has one reason', () => {
  const legal = ['19p', 'ab', 'a-b', 'a-', '9x', '0x', 'a'.repeat(32)];
  for (const id of legal) {
    assert.equal(pluginIdIssue(id), null, id);
    assert.equal(isPluginId(id), true, id);
  }
  assert.equal(pluginIdIssue(''), null);
  assert.equal(pluginIdIssue(null), null);
  assert.equal(isPluginId(''), false);
  const bad = [
    ['a', 'short'],
    ['-', 'short'],
    ['A', 'short'],
    ['Ab', 'upper'],
    ['-A', 'upper'],
    ['aB', 'upper'],
    ['-a', 'lead'],
    ['--', 'lead'],
    ['a_b', 'char'],
    ['a.b', 'char'],
    ['a b', 'char'],
    ['a'.repeat(33), 'long'],
    [`${'A'}${'a'.repeat(32)}`, 'upper'],
  ];
  for (const [id, issue] of bad) {
    assert.equal(pluginIdIssue(id), issue, id);
    assert.equal(isPluginId(id), false, id);
  }
});

test('plugin id: the dialog shows each reason through t(), and does not hide the fault', () => {
  const src = readFileSync(new URL('../../public/studio/js/create.js', import.meta.url), 'utf8');
  for (const [issue, msgid] of Object.entries(HINTS)) {
    assert.ok(src.includes(`issue === '${issue}'`), issue);
    assert.ok(src.includes(`t('${msgid}')`), msgid);
  }
  assert.match(src, /pluginIdIssue\(id\)/);
  assert.doesNotMatch(src, /toLowerCase\(\)/);
  assert.doesNotMatch(src, /maxLength="32"/);
});
