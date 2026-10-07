import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectRange } from '../../public/js/screens/game/range.js';

const tokens = JSON.parse(readFileSync(new URL('../../data/tokens.json', import.meta.url), 'utf8'));
const input = (id) => ({ target: { kind: 'unit', unit: { kind: 'token', side: 'ally', x: 2, y: 10, dir: 'RIGHT' } },
  detail: { type: 'token', token: tokens[id] }, field: { prep: true } });

test('user Given Touch When toggling skill preview Then only the explicit skill grid replaces the attack grid', () => {
  const base = inspectRange(input('char_613_acmedc'));
  const preview = inspectRange({ ...input('char_613_acmedc'), previewSkill: true });
  assert.equal(base.grid.length, 12);
  assert.equal(preview.grid.length, 18);
  assert.ok(preview.grid.some(([r, c]) => r === 1 && c === 5));
  assert.ok(!preview.grid.some(([, c]) => c > 5), 'adjacent extra healing is not a caster range cell');
  assert.equal(inspectRange({ ...input('char_613_acmedc'), live: { range: [[0, 0]] } }).grid.length, 1);
});

test('user Given a skill without an explicit grid When inspecting Then no speculative skill preview is offered', () => {
  const r = inspectRange({ ...input('char_605_cmedic'), previewSkill: true });
  assert.equal(r.skillGrid, null);
  assert.equal(r.grid.length, 12);
});
