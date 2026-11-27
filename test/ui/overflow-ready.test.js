import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readyOverflowPrompt, readyFundsPrompt, readyCommandPrompt, readyPrompt } from '../../public/js/ui/gameLogic.js';

const config = { version: { family: 'regulation', rules: { equipHand: true } } };
const priv = { alive: true, ready: false, stashCount: 2, temp: [{ kind: 'item' }], funds: 4 };

test('regulation asks about hidden overflow, excludes permanent equipment, and preserves version boundaries', () => {
  const ask = readyOverflowPrompt(priv, { config });
  assert.match(ask.text, /进入战斗后自动销毁/);
  assert.match(ask.text, /召唤物仍会在下个休整期出现/);
  assert.equal(readyOverflowPrompt({ ...priv, stashCount: 0 }, { config }), null);
  assert.equal(readyOverflowPrompt(priv, { config, ready: false }), null);
  assert.equal(readyOverflowPrompt({ ...priv, ready: true }, { config }), null);
  assert.equal(readyOverflowPrompt({ ...priv, alive: false }, { config }), null);
  assert.equal(readyOverflowPrompt(null, { config }), null);
  assert.equal(readyOverflowPrompt(priv), null);
  assert.equal(readyOverflowPrompt(priv, { config: { version: { family: 'covenant', rules: { equipHand: true } } } }), null);
  assert.ok(readyOverflowPrompt(priv, { config: { version: { family: 'regulation' } } }));
});

test('one dialog combines overflow with funds and command; muting commands cannot suppress overflow', () => {
  const overflow = readyOverflowPrompt(priv, { config });
  const funds = readyFundsPrompt(priv);
  const command = readyCommandPrompt({ ...priv, command: { type: 'ACTIVE', targetType: 'CHESS', usable: true, targets: [1] } });
  const combined = readyPrompt(funds, command, overflow);
  assert.equal(combined.title, '准备就绪前');
  assert.equal(combined.danger, true);
  assert.deepEqual(combined.lines, [overflow.text, command.text, funds.text]);
  assert.equal(combined.mutable, true);
  const muted = readyPrompt(null, null, overflow);
  assert.deepEqual(muted.lines, [overflow.text, '确定准备就绪吗？']);
  assert.equal(muted.mutable, false);
  assert.equal(readyPrompt(null, null, null), null);
});
