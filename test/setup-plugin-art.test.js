import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fxFixture } from './helpers/fxFixtures.js';
import { installedArtReferences } from '../server/plugins/artReferences.js';
import { installedFxReferences } from '../server/plugins/fxReferences.js';
import { checkPluginArt, pluginFxExtractionAllowed } from '../tools/setup.mjs';

const ID = 'char_9001_test';
function fixture(t) {
  const f = fxFixture(t);
  f.put('data/chess.json', { a: { charId: 'char_1_pool' } });
  f.put('data/backups.json', { units: { char_2_backup: {} } });
  f.put('.cache/gamedata/excel/character_table.json', Object.fromEntries(['char_1_pool', 'char_2_backup', ID,
    ...Array.from({ length: 5 }, (_, i) => `char_${9002 + i}_test`)].map(id => [id, { phases: [{}, {}] }])));
  f.put('plugins/demo/plugin.json', { operators: ['ops.json'], data: ['records.json'], assets: 'assets.json', entry: { sim: 'evil.js' } });
  f.put('plugins/demo/ops.json', [{ charId: 'char_1_pool' }, { origin: { charId: 'char_2_backup' } },
    { charId: 'char_x_demo_one', fx: { unit: ID }, art: { assets: { portrait: 'char_9002_test' } } },
    { charId: 'char_x_demo_two', origin: { charId: 'char_9003_test' } }]);
  f.put('plugins/demo/records.json', [{ target: 'backups', value: { units: { char_9004_test: {} } } }]);
  f.put('plugins/demo/assets.json', { chars: { char_x_demo_one: { ref: 'char_9005_test' } } });
  fs.writeFileSync(path.join(f.root, 'plugins/demo/evil.js'), 'throw new Error("never execute this");');
  return f;
}

test('operator discovery reuses W5 references, excludes the shipped roster, and never loads scripts/links', t => {
  const f = fixture(t), ids = [ID, 'char_9002_test', 'char_9003_test', 'char_9004_test', 'char_9005_test', 'char_9006_test'];
  f.put('plugins/phases/plugin.json', { assets: { chars: { char_x_phases_one: { portrait: { ref: 'char_9006_test_2' } } } }, fx: { unit: 'char_9007_test_2' } });
  f.put('plugins/linked/plugin.json', { operators: ['link.json'] });
  f.put('outside.json', [{ charId: 'char_9999_forbidden' }]);
  fs.symlinkSync(path.join(f.root, 'outside.json'), path.join(f.root, 'plugins/linked/link.json'));
  f.put('plugins/traversal/plugin.json', { operators: ['../../outside.json'] });
  assert.deepEqual(installedArtReferences(f.root), ids);
  assert.ok(!installedFxReferences(f.root).includes('char_9006_test'), 'effect discovery keeps exact ids');
  const cli = spawnSync(process.execPath, ['tools/local-extract/plugin-art.mjs', f.root], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout), ids);
});

test('new references, missing files, directions and E2 art offer extraction; complete art closes the gap', t => {
  const f = fixture(t);
  const art = { avatar: '/assets/local/a.png', portrait: '/assets/local/p.png',
    spine: { front: { skel: '/assets/local/f.skel', atlas: '/assets/local/f.atlas', textures: ['/assets/local/f.png'] },
      back: { skel: '/assets/local/b.skel', atlas: '/assets/local/b.atlas', textures: ['/assets/local/b.png'] } } };
  f.put('data/local-assets.json', { chars: { [ID]: art } });
  assert.ok(checkPluginArt(f.root).includes(ID), 'a manifest alone is insufficient');
  for (const url of [art.avatar, art.portrait, ...Object.values(art.spine).flatMap(m => [m.skel, m.atlas, ...m.textures])]) f.put('public' + url, Buffer.from('fixture'));
  assert.ok(!checkPluginArt(f.root).includes(ID));
  fs.unlinkSync(path.join(f.root, 'public/assets/local/b.png'));
  assert.ok(checkPluginArt(f.root).includes(ID));
  f.put('public/assets/local/b.png', Buffer.from('fixture'));
  f.put('.cache/gamedata/excel/character_table.json', { [ID]: { phases: [{}, {}, {}] } });
  assert.ok(checkPluginArt(f.root).includes(ID), 'E2 art needed when the local table declares E2');
  art.avatarE2 = art.avatar; art.portraitE2 = art.portrait;
  f.put('data/local-assets.json', { chars: { [ID]: art } });
  assert.ok(!checkPluginArt(f.root).includes(ID));
  f.put('.cache/gamedata/excel/character_table.json', { [ID]: { phases: [{}, {}, {}] }, char_9998_new: {} });
  f.put('plugins/new/plugin.json', { origin: { charId: 'char_9998_new' } });
  assert.ok(checkPluginArt(f.root).includes('char_9998_new'));
});

test('operator gap uses the existing opt-in gate; check/no-local and no reply never authorize extraction', () => {
  for (const reply of [false, null, undefined]) assert.equal(pluginFxExtractionAllowed({}, [ID], reply), false);
  assert.equal(pluginFxExtractionAllowed({}, [ID], true), true);
  assert.equal(pluginFxExtractionAllowed({ yes: true }, [ID]), true);
  assert.equal(pluginFxExtractionAllowed({ local: 'force' }, [ID]), true);
  for (const opts of [{ check: true, local: 'force' }, { local: 'no', yes: true }]) assert.equal(pluginFxExtractionAllowed(opts, [ID], true), false);
});

test('art discovery requires an own official table entry; missing and broken tables discover nothing', t => {
  const f = fxFixture(t);
  f.put('plugins/demo/plugin.json', { operators: ['ops.json'] });
  f.put('plugins/demo/ops.json', [ID, 'char_9999_fabricated', '../char_9002_bad'].map(charId => ({ charId })));
  f.put('.cache/gamedata/excel/character_table.json', { [ID]: {} });
  assert.deepEqual(installedArtReferences(f.root), [ID]);
  assert.deepEqual(checkPluginArt(f.root), [ID]);
  fs.unlinkSync(path.join(f.root, '.cache/gamedata/excel/character_table.json'));
  assert.deepEqual(installedArtReferences(f.root), []);
  f.put('.cache/gamedata/excel/character_table.json', Buffer.from('{broken'));
  assert.deepEqual(installedArtReferences(f.root), []);
  f.put('.cache/gamedata/excel/character_table.json', null);
  assert.deepEqual(installedArtReferences(f.root), []);
});

test('art discovery caps distinct table-backed operators across plugins, after deduplication and roster exclusion', t => {
  const f = fxFixture(t), ids = Array.from({ length: 600 }, (_, i) => `char_${10000 + i}_test`);
  f.put('.cache/gamedata/excel/character_table.json', Object.fromEntries(ids.map(id => [id, {}])));
  f.put('data/chess.json', { pool: { charId: ids[0] } });
  f.put('plugins/a/plugin.json', { operators: ['ops.json'] });
  f.put('plugins/a/ops.json', ids.slice().reverse().map(charId => ({ charId })));
  f.put('plugins/b/plugin.json', { assets: { chars: Object.fromEntries(ids.map(id => [id, { ref: id }])) } });
  const found = installedArtReferences(f.root);
  assert.deepEqual(found, ids.slice(1, 257));
  const cli = spawnSync(process.execPath, ['tools/local-extract/plugin-art.mjs', f.root], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout), found);
});

test('full setup and dedicated operator extraction both obey explicit art consent', async t => {
  const source = fs.readFileSync(new URL('../tools/setup.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('  const local = checkLocal();', source.indexOf('async function main()'));
  const end = source.indexOf('  // 7. official battlefield scenes', start);
  assert.ok(start > 0 && end > start);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const cases = [
    { name: 'Enter', answer: false }, { name: 'timeout', answer: null },
    { name: 'remembered decline', declined: true }, { name: 'typed yes', answer: true, allowed: true },
    { name: '--local', opts: { local: 'force' }, allowed: true }, { name: '--yes', opts: { yes: true }, allowed: true },
    { name: '--local refreshes complete art', opts: { local: 'force' }, complete: true, allowed: true },
    { name: '--check', opts: { check: true, yes: true, local: 'force' } },
    { name: '--no-local', opts: { local: 'no', yes: true } },
    { name: 'already extracted vanilla, Enter', already: true, answer: false },
    { name: 'already extracted vanilla, typed yes', already: true, answer: true, allowed: true },
  ];
  for (const c of cases) await t.test(c.name, async () => {
    let extracted = false;
    const runs = [], prompts = [];
    const deps = {
      opts: { local: 'ask', check: false, yes: false, game: null, ...c.opts }, summary: [],
      log() {}, add() {}, loadState: () => c.declined ? { pluginArtDeclined: ID } : {}, saveState() {},
      checkLocal: () => ({ manifest: !!c.already, dirPresent: !!c.already, board3d: false, fx: { state: 'ok', detail: '' } }),
      findClient: () => ({ autochess: true, kind: 'synthetic', path: '/synthetic-client' }),
      findPython: () => ({ cmd: 'python3' }), ensureVenv: () => ({ ok: true, python: 'fake-python' }),
      ask: async (question, def) => { prompts.push({ question, def }); return question.includes('operator art') ? c.answer ?? null : def; },
      run: (_cmd, args) => {
        if (!args.includes('--only') && !c.declined && !c.opts) {
          assert.ok(prompts.some(p => p.question.includes('operator art')), 'resolve art consent before starting full extraction');
        }
        runs.push(args);
        if (args.includes('--plugin-art') || args.includes('--only') && args.includes('plugin-art')) extracted = true;
        return { ok: true };
      },
      c: { cyan: s => s, dim: s => s, warn: s => s }, IS_WIN: false, LOCAL_ART_FALLBACK: 'fallback', EXTRACT_PY: 'extract.py', PY_ENV: {},
      cropBoardTiles() {}, localArtState: () => 'ok', localArtDetail: () => '',
      checkPluginFx: () => [], checkPluginArt: () => extracted || c.complete ? [] : [ID], pluginFxExtractionAllowed,
    };
    await new AsyncFunction(...Object.keys(deps), source.slice(start, end))(...Object.values(deps));
    assert.equal(extracted, !!c.allowed, JSON.stringify(runs));
    const artPrompts = prompts.filter(p => p.question.includes('operator art'));
    assert.ok(artPrompts.every(p => p.def === false));
    if (c.declined || c.opts) assert.equal(artPrompts.length, 0);
    else assert.equal(artPrompts.length, 1);
    if (c.opts?.check || c.opts?.local === 'no') assert.equal(runs.length, 0);
    else if (!c.already) assert.ok(runs.some(args => !args.includes('--only')), 'ordinary vanilla full extraction remains available');
  });
});
