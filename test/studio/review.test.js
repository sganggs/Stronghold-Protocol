// Studio review regressions; no listening socket required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { fixture } from '../helpers/contentFixtures.js';
import { scriptFixture } from '../helpers/scriptFixtures.js';
import { createTrialBench, TRIAL_LIMITS } from '../../server/studio/trial.js';
import { createPluginFiles } from '../../server/studio/files.js';
import { createPlugin, templateById, manifestText } from '../../server/studio/templates/index.js';
import { createAuthoring } from '../../server/studio/authoring.js';
import { createStudio } from '../../server/studio/index.js';
import { writeTrialDraftFile } from '../../server/studio/trialDraft.js';
import { numericFields, readStudioData } from '../../server/studio/gameData.js';
import { checkPluginFolder, packPlugin } from '../../server/plugins/pack.js';
import { buildContentSet } from '../../server/plugins/contentSet.js';
import { appendOfficialBounds } from '../../shared/plugins/officialBounds.js';
import { applyPatches } from '../../shared/plugins/patch.js';
import { validateDraft } from '../../public/studio/js/validateDraft.js';

const delay = ms => new Promise(r => setTimeout(r, ms));
function make(f, template = 'operator', id = 'review-op', options = {}) {
  const made = createPlugin(templateById(template), { id, options });
  const dir = f.put(id, made.manifest, made.files);
  fs.writeFileSync(path.join(dir, '.studio.json'), manifestText({ v: 1, authoring: made.authoring }));
  return { id, dir, made };
}
const filesOf = f => createPluginFiles(path.join(f.dir, 'plugins'));

for (const ending of ['success', 'refusal', 'timeout', 'crash', 'error', 'send-error', 'spawn-error', 'close', 'abort', 'limit']) {
  test(`draft cleanup after ${ending}, including the parent's temporary directory`, async t => {
    const f = fixture(t), { id } = make(f);
    let temporary, child, message;
    const mkdtemp = fs.mkdtempSync;
    t.mock.method(fs, 'mkdtempSync', (...args) => { temporary = mkdtemp(...args); return temporary; });
    const spawn = (_entry, _args, options) => {
      assert.equal(options.detached, true);
      if (ending === 'spawn-error') throw new Error('spawn failed');
      child = new EventEmitter(); child.kill = signal => { assert.equal(signal, 'SIGKILL'); child.killed = true; };
      child.send = m => {
        message = m; assert.equal(m.temporary, temporary);
        fs.writeFileSync(path.join(temporary, 'draft.json'), 'sensitive draft');
        if (ending === 'send-error') throw new Error('send failed');
        queueMicrotask(() => {
          if (ending === 'success') child.emit('message', { ok: true });
          if (ending === 'refusal') child.emit('message', { ok: false, issues: [] });
          if (ending === 'crash') child.emit('exit', 1);
          if (ending === 'error') child.emit('error', new Error('crash'));
          if (ending === 'limit') child.emit('message', { oversized: 'x'.repeat(1000) });
        });
      };
      return child;
    };
    const bench = createTrialBench({ registry: f.registry, files: filesOf(f), spawn, limits: { ...TRIAL_LIMITS, timeoutMs: 20, resultBytes: 100 } });
    t.after(() => bench.close());
    const abort = new AbortController();
    const pending = bench.run({ id, draft: { template: 'operator', options: {} } }, { signal: abort.signal });
    if (ending === 'abort') abort.abort();
    if (ending === 'close') bench.close();
    if (['success', 'refusal'].includes(ending)) assert.equal((await pending).ok, ending === 'success');
    else await assert.rejects(pending);
    assert.ok(temporary); assert.equal(fs.existsSync(temporary), false);
    assert.equal(bench.active(), 0);
    if (message) assert.equal(child.killed, true);
  });
}

test('real draft success and validation failure clean before sending, and the parent leaves no draft', { timeout: 30000 }, async t => {
  const f = fixture(t), { id } = make(f);
  const temporary = [];
  const spawn = (...args) => {
    const c = fork(...args), send = c.send.bind(c);
    c.send = m => { temporary.push(m.temporary); return send(m); };
    // Listener registered before the parent's finish: the child has already removed it when it sends.
    c.on('message', () => assert.equal(fs.existsSync(temporary.at(-1)), false));
    return c;
  };
  const bench = createTrialBench({ registry: f.registry, files: filesOf(f), spawn }); t.after(() => bench.close());
  const good = await bench.run({ id, seconds: 1, draft: { template: 'operator', options: {} } }); assert.equal(good.ok, true);
  const bad = await bench.run({ id, draft: { template: 'operator', options: { kitSource: 'dsl', dsl: { dsl: 1, talents: [{ when: 'wrong' }] } } } });
  assert.equal(bad.ok, false); assert.equal(bad.issues[0].code, 'PLUGIN_DSL_TRIGGER');
  assert.ok(temporary.every(d => !fs.existsSync(d)));
});

test('normal request close preserves a trial; incomplete request or disconnected response cancels and cleans it', async t => {
  const f = fixture(t), { id } = make(f);
  let child, temporary, sent;
  const studio = createStudio({ registry: f.registry, pluginsDir: path.join(f.dir, 'plugins'), dataDir: path.resolve('data'), publicDir: path.resolve('public'),
    watch: () => ({ on() {}, close() {} }), trialSpawn: () => {
      child = new EventEmitter(); child.kill = () => { child.killed = true; };
      child.send = m => { temporary = m.temporary; fs.writeFileSync(path.join(temporary, 'draft'), 'draft'); sent(); };
      return child;
    } });
  t.after(() => studio.close());
  for (const ending of ['response', 'request']) {
    const ready = new Promise(r => { sent = r; });
    const req = Readable.from([Buffer.from(JSON.stringify({ id, draft: { template: 'operator', options: {} } }))]);
    req.method = 'POST'; req.url = '/studio/api/trial'; req.complete = true;
    req.headers = { host: 'localhost:3000', 'x-sp-studio': studio.key }; req.socket = { remoteAddress: '127.0.0.1' };
    const res = new EventEmitter();
    Object.assign(res, { setHeader() {}, writeHead() {}, end() { this.writableEnded = true; }, destroy() {} });
    const handled = studio.handle(req, res, req.url, '');
    await ready; req.emit('close'); assert.equal(child.killed, undefined, 'complete body close is normal');
    if (ending === 'request') { req.complete = false; req.emit('close'); }
    else res.emit('close');
    await handled;
    assert.equal(child.killed, true); assert.equal(fs.existsSync(temporary), false);
  }
});

test('trial draft writer rejects traversal, absolute paths, hidden names and backslashes before writing', t => {
  const f = fixture(t), root = path.join(f.dir, 'draft'); fs.mkdirSync(root);
  for (const rel of ['../escape.json', '/absolute.json', 'C:\\escape.json', '.hidden/file.json', 'a/../../x.json']) {
    assert.throws(() => writeTrialDraftFile(root, rel, '{}'), { code: 'PLUGIN_STUDIO_PATH' });
  }
  assert.deepEqual(fs.readdirSync(root), []);
  writeTrialDraftFile(root, 'data/operator.json', '{}'); assert.equal(fs.readFileSync(path.join(root, 'data/operator.json'), 'utf8'), '{}');
});

/** A setup that writes its process id to `marker`, ignores SIGTERM and never returns. */
const loopSetup = marker => `export default () => { const p = global['pro' + 'cess'];
    p.getBuiltinModule('fs').writeFileSync(${JSON.stringify(marker)}, String(p.pid));
    p.on('SIGTERM', () => {}); while (true) {} }`;
/** A trial bench whose children get this probe ceiling (SP_SCRIPT_PROBE_MS); every child it forks lands in `leaders`. */
function loopBench(t, f, probeMs, timeoutMs, leaders) {
  const bench = createTrialBench({ registry: f.registry, files: createPluginFiles(f.pluginsDir),
    spawn: (entry, args, opts) => { const leader = fork(entry, args, { ...opts, env: { ...process.env, SP_SCRIPT_PROBE_MS: String(probeMs) } }); leaders.push(leader); return leader; },
    limits: { ...TRIAL_LIMITS, timeoutMs } });
  t.after(() => bench.close());
  return bench;
}
/** The probe (`pid`, the grandson) and every trial child are gone. */
async function assertNoGrandson(pid, leaders) {
  for (let n = 0; n < 100; n++) { try { process.kill(pid, 0); await delay(20); } catch { break; } }
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  for (const leader of leaders) assert.throws(() => process.kill(leader.pid, 0), { code: 'ESRCH' });
}

// The trial's own timeout must leave the probe time to reach its setup first: forking the trial child and composing
// the content set took more than 6 s on a Windows runner, and the trial then ended before the marker was written.
for (const ending of ['close', 'timeout']) test(`a real pinned SIGTERM-ignoring probe leaves no grandson after trial ${ending}`, { timeout: 40000 }, async t => {
  const f = scriptFixture(t), marker = path.join(f.root, 'probe.pid'), leaders = [];
  f.put('loop', loopSetup(marker));
  const bench = loopBench(t, f, 60000, ending === 'timeout' ? 12000 : 15000, leaders);
  const checked = assert.rejects(bench.run({ id: 'loop', seconds: 1 }), { code: ending === 'timeout' ? 'PLUGIN_STUDIO_TRIAL_TIMEOUT' : 'PLUGIN_STUDIO_TRIAL_FAILED' });
  for (let n = 0; n < 700 && !fs.existsSync(marker); n++) await delay(20);
  assert.ok(fs.existsSync(marker), 'the actual contentSet preflight ran');
  const pid = Number(fs.readFileSync(marker, 'utf8'));
  t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch { /* absent */ } });
  if (ending === 'close') bench.close();
  await checked;
  await assertNoGrandson(pid, leaders);
});

test('a real pinned SIGTERM-ignoring probe leaves no grandson after trial probe-timeout', { timeout: 60000 }, async t => {
  const f = scriptFixture(t), marker = path.join(f.root, 'probe.pid'), leaders = [];
  f.put('loop', loopSetup(marker));
  // The probe's ceiling covers its start too (Node, the SDK and the simulation modules: a quarter of a second on an
  // idle machine, over 1 s on a busy runner or Windows). Only a setup that is running when SIGKILL comes is this case:
  // when the trial reports the ceiling and no marker was written, the setup never started, and the trial runs again
  // with a ceiling twice as long. Every report names its own ceiling.
  for (const ms of [1000, 2000, 4000, 8000]) {
    const bench = loopBench(t, f, ms, ms + 14000, leaders);
    const result = await bench.run({ id: 'loop', seconds: 1 });
    assert.equal(result.ok, false); assert.equal(result.issues[0].code, 'PLUGIN_SCRIPT_CHECK'); assert.match(result.issues[0].text, new RegExp(`${ms} ms.*SIGKILL`));
    bench.close();
    if (fs.existsSync(marker)) break;
  }
  assert.ok(fs.existsSync(marker), 'the actual contentSet preflight ran');
  const pid = Number(fs.readFileSync(marker, 'utf8'));
  t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch { /* absent */ } });
  await assertNoGrandson(pid, leaders);
});

for (const mode of ['sandbox', 'trusted']) test(`trial uses the actual ${mode} executor, pinned mode and runtime kit`, { timeout: 30000 }, async t => {
  const f = scriptFixture(t, { mode });
  const made = createPlugin(templateById('operator'), { id: 'demo' });
  const source = `export default sp => {
    if ((typeof global === 'undefined') !== ${mode === 'sandbox'}) throw Error('wrong executor');
    sp.kits.register('char_x_demo_one', () => ({ skill: { kind: 'passive', mods: { atkFlat: 123 } }, talents: [{ install(b) {
      if ((typeof global === 'undefined') !== ${mode === 'sandbox'}) throw Error('wrong battle executor');
      b.on('battleStart', () => b.addDp('trial', 17));
    } }] })); }`;
  f.put('demo', source, { permissions: ['sim.code', 'data.add'], operators: ['op.json'] }, { 'op.json': made.files['data/operator.json'] });
  let changeAfterSnapshot = false;
  const bench = createTrialBench({ registry: f.registry, files: createPluginFiles(f.pluginsDir), spawn: (...args) => {
    if (changeAfterSnapshot) {
      fs.appendFileSync(path.join(f.pluginsDir, 'demo/index.js'), '\n// changed after authorization');
      packPlugin(path.join(f.pluginsDir, 'demo'));
    }
    return fork(...args);
  } }); t.after(() => bench.close());
  const r = await bench.run({ id: 'demo', seconds: 2 });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.deepEqual(r.plugin.errors, []); assert.ok(r.plugin.damage > r.vanilla.damage);
  // A different, newly packed lock is not authorized by the parent's snapshot.
  changeAfterSnapshot = true;
  const stale = await bench.run({ id: 'demo', seconds: 1 });
  assert.equal(stale.ok, false); assert.equal(stale.plugin, undefined);
});

test('sandbox-incompatible code cannot be promoted to trusted by the studio key', { timeout: 20000 }, async t => {
  const f = scriptFixture(t, { mode: 'sandbox' });
  f.put('bad-syntax', 'export let mutable = 1; export default () => {};');
  const bench = createTrialBench({ registry: f.registry, files: createPluginFiles(f.pluginsDir) }); t.after(() => bench.close());
  const result = await bench.run({ id: 'bad-syntax' });
  assert.equal(result.ok, false); assert.equal(result.plugin, undefined);
  assert.equal(result.issues[0].code, 'PLUGIN_SANDBOX_SYNTAX');
});

test('numeric wizard and folder check share C1 maximum and minimum step boundaries', t => {
  const f = fixture(t), data = readStudioData(path.resolve('data'));
  const fields = numericFields(data, { kind: 'operator', key: 'char_102_texas' });
  const scale = fields.find(f => f.path.at(-1) === 'atk_scale');
  const cost = fields.find(f => f.path.at(-1) === 'cost' && f.bounded);
  assert.equal(scale.max, 80); assert.ok(cost.positiveMin > 0);
  for (const [field, value, ok] of [[scale, 80, true], [scale, 81, false], [scale, -81, false], [cost, cost.positiveMin, true], [cost, cost.positiveMin / 2, false], [cost, 0, true]]) {
    const opts = { edits: [{ key: field.key, value }] };
    if (ok) assert.doesNotThrow(() => createPlugin(templateById('numbers'), { id: 'numbers', options: opts }));
    else assert.throws(() => createPlugin(templateById('numbers'), { id: 'numbers', options: opts }), { code: 'PLUGIN_DATA_BOUND' });
    const ops = [field.path, ...field.mirrors].map(path => ({ op: 'set', file: field.file, id: field.id, path, value }));
    const raw = f.put('numbers', { permissions: ['data.patch'], data: ['p.json'] }, { 'p.json': { patch: 1, ops } });
    const expected = []; appendOfficialBounds(applyPatches(data, ops).data, data, (...args) => expected.push(args));
    assert.equal(expected.length === 0, ok);
    assert.equal(checkPluginFolder(raw).issues.some(i => i.code === 'PLUGIN_DATA_BOUND'), !ok);
    assert.equal(buildContentSet({ registry: f.registry, ids: ['numbers'] }).problems.length === 0, ok);
  }
});

test('server rejects bad DSL before changing files, and the save gate checks the current result or network failure', async t => {
  const f = fixture(t), files = filesOf(f), author = createAuthoring({ files, dataDir: path.resolve('data') });
  assert.throws(() => createPlugin(templateById('dsl'), { id: 'null-example', options: { example: 'texas', dsl: null } }), { code: 'PLUGIN_DSL_SHAPE' });
  for (const template of ['dsl', 'meta', 'operator']) {
    const { id, dir } = make(f, template, `bad-${template}`);
    assert.throws(() => createPlugin(templateById(template), { id, options: { kitSource: 'dsl', dsl: null } }), e => e.code.startsWith('PLUGIN_DSL_'));
    const before = author.read(id), manifest = fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8');
    const next = { ...before, options: { kitSource: 'dsl', dsl: { dsl: 1, talents: [{ when: 'every', seconds: null }] } } };
    assert.throws(() => author.save(id, next), e => e.code.startsWith('PLUGIN_DSL_'));
    assert.equal(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'), manifest);
    assert.equal(author.read(id).revision, before.revision);
    const rejected = { ok: false, problems: [{ code: 'PLUGIN_DSL_EVERY' }] };
    assert.equal(await validateDraft({ ...next, id }, { post: async (_path, body) => { assert.deepEqual(body.spec, next.options.dsl); return rejected; } }), rejected);
    await assert.rejects(validateDraft({ ...next, id }, { post: async () => { throw new Error('network'); } }), /network/);
  }
});

test('the actual authoring editor module graph loads with the save/validation UI', async () => {
  const { Authoring } = await import('../../public/studio/js/authoring.js');
  const { DslForm } = await import('../../public/studio/js/editors/dslForm.js');
  assert.equal(typeof Authoring, 'function'); assert.equal(typeof DslForm, 'function');
});

test('real writing children cannot recreate drafts after timeout, crash, close or cancellation', { timeout: 20000 }, async t => {
  const f = fixture(t), { id } = make(f), entry = path.join(f.dir, 'draft-writer.cjs');
  fs.writeFileSync(entry, `const fs = require('node:fs'); const path = require('node:path');
    process.once('message', m => {
      fs.writeFileSync(path.join(m.temporary, 'draft.json'), 'unsaved');
      fs.writeFileSync(m.marker, 'ready');
      if (m.ending === 'crash') process.exit(3);
      setInterval(() => fs.writeFileSync(path.join(m.temporary, 'draft.json'), 'still writing'), 5);
    });`);
  for (const ending of ['timeout', 'crash', 'close', 'abort']) {
    const marker = path.join(f.dir, ending); let temporary;
    const bench = createTrialBench({ registry: f.registry, files: filesOf(f), limits: { ...TRIAL_LIMITS, timeoutMs: 1500 },
      spawn: (_entry, args, options) => {
        const child = fork(entry, args, options), send = child.send.bind(child);
        child.send = m => { temporary = m.temporary; return send({ ...m, marker, ending }); };
        return child;
      } });
    t.after(() => bench.close());
    const controller = new AbortController();
    const checked = assert.rejects(bench.run({ id, draft: {} }, { signal: controller.signal }));
    for (let n = 0; n < 100 && !fs.existsSync(marker); n++) await delay(10);
    assert.ok(fs.existsSync(marker), 'the writer actually created its draft');
    if (ending === 'close') bench.close();
    if (ending === 'abort') controller.abort();
    await checked; await delay(30);
    assert.equal(fs.existsSync(temporary), false); assert.equal(bench.active(), 0);
  }
});
