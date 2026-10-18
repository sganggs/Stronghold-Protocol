import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../../server/data.js';
import { scriptFixture } from '../helpers/scriptFixtures.js';
import { fixture } from '../helpers/contentFixtures.js';

const run = (root, args, mode = '') => spawnSync(process.execPath, [path.join(ROOT, 'tools/plugin.mjs'), 'check', ...args, '--root', root],
  { encoding: 'utf8', env: { ...process.env, SP_PLUGIN_SCRIPTS: mode } });

test('check uses the list/server script gate in text and JSON: off, sandbox, trusted pin and stale lock', t => {
  const f = scriptFixture(t, { mode: 'sandbox' });
  const dir = f.put('script-demo', 'export default () => {};');
  for (const [mode, status] of [['', 'disabled'], ['sandbox', 'loaded'], ['trusted', 'disabled'], ['trusted-force', 'loaded']]) {
    const text = run(f.root, ['script-demo'], mode);
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, new RegExp(`script-demo 1.0.0 · script \\(${status}\\)`));
    const json = run(f.root, ['script-demo', '--json'], mode);
    assert.equal(json.status, 0, json.stderr);
    assert.equal(JSON.parse(json.stdout).folders[0].status, status);
  }
  fs.writeFileSync(path.join(dir, 'index.js'), 'export default () => { /* changed after packing */ };');
  assert.equal(JSON.parse(run(f.root, ['script-demo', '--json'], 'sandbox').stdout).folders[0].status, 'disabled');
});

test('a losing language overlay says skipped and names the winner on its folder line and JSON row', t => {
  const f = fixture(t);
  const lang = { class: 'lang', lang: 'qzz', scope: ['personal'], permissions: [], files: { ui: 'ui.json' } };
  const ui = path.join(f.dir, 'public/i18n'); fs.mkdirSync(ui, { recursive: true });
  fs.writeFileSync(path.join(ui, 'qzz.json'), JSON.stringify({ _meta: { name: 'Base' }, Start: 'Start' }));
  f.put('alpha', lang, { 'ui.json': { Start: 'Alpha' } });
  f.put('beta', lang, { 'ui.json': { Start: 'Beta' } });
  for (const args of [[], ['alpha', 'beta'], ['beta', 'alpha']]) {
    const text = run(f.dir, args);
    assert.equal(text.status, 1, text.stdout + text.stderr);
    const line = text.stdout.split('\n').find(s => s.startsWith('plugins/beta/  '));
    assert.match(line, /lang \(skipped\).*alpha \(plugins\/alpha\/\)/);
    assert.doesNotMatch(line, /\(loaded\)/);
    const json = run(f.dir, [...args, '--json']);
    const report = JSON.parse(json.stdout), beta = report.folders.find(f => f.id === 'beta');
    assert.equal(report.problems, 1, 'do not count the same cross-folder problem twice');
    assert.equal(beta.status, 'skipped'); assert.equal(beta.loadable, false);
    assert.match(beta.skipped[0], /alpha \(plugins\/alpha\/\)/);
    assert.equal(report.folders.find(f => f.id === 'alpha').status, 'loaded');
  }
});
