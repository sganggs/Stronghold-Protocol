import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const run = (trace) => {
  const args = ['tools/botbench.mjs', '--configs', 'solo:FUNNY', '--seeds', '1', '--jobs', '1', '--rehearsal', '1', '--quiet', '--json', '-'];
  if (trace) args.push('--layers');
  const child = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout)[0];
};

test('layer tracing preserves real match outcomes and reconciles banked layers and spending', () => {
  const plain = run(false), traced = run(true);
  for (const key of ['config', 'seed', 'stageId', 'bossId', 'economy', 'rounds', 'bounties', 'strategyMetrics',
    'victory', 'roundsPassed', 'players', 'errors', 'hidden', 'lpLeft']) assert.deepEqual(traced[key], plain[key], key);
  assert.equal(plain.layerTrace, undefined);
  const t = traced.layerTrace;
  assert.ok(t.gains.length > 0);
  assert.ok(t.gains.some(g => g.reason === 'battle'), 'real combat settlement is included');
  assert.ok(t.gains.some(g => g.sources.some(s => s.kind === 'garrison')), 'trait provenance is included');
  assert.ok(t.snapshots.some(s => s.phase === 'afterEndPrep'));
  assert.ok(t.snapshots.some(s => s.phase === 'SETTLE'));
  const totals = {};
  for (const g of t.gains) {
    assert.equal(g.add, g.to - g.from);
    assert.ok(g.add > 0);
    const key = `${g.pid}:${g.bond}`;
    assert.equal(g.from, totals[key] || 0, 'no rehearsal, duplicate or missing gains');
    totals[key] = (totals[key] || 0) + g.add;
  }
  for (const p of traced.players) {
    const last = t.snapshots.filter(s => s.pid === p.pid).at(-1);
    for (const [bond, layers] of Object.entries(last.layers)) assert.equal(totals[`${p.pid}:${bond}`] || 0, layers);
    assert.equal(t.spending.filter(s => s.pid === p.pid).reduce((v, s) => v + s.spent, 0), p.spent);
  }
});
