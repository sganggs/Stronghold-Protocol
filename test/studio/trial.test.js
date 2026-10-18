import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { fixture } from '../helpers/contentFixtures.js';
import { createPlugin, templateById } from '../../server/studio/templates/index.js';
import { createPluginFiles } from '../../server/studio/files.js';
import { createTrialBench, TRIAL_LIMITS } from '../../server/studio/trial.js';
import { createStudio } from '../../server/studio/index.js';

function plugin(f, id = 'bench-op', options = {}) {
  const made = createPlugin(templateById('operator'), { id, options });
  f.put(id, made.manifest, made.files);
  return id;
}
function bench(f, extra = {}) { return createTrialBench({ registry: f.registry, files: createPluginFiles(path.join(f.dir, 'plugins')), ...extra }); }

test('trial child: vanilla and plugin repeated bit for bit, real frames, changed damage, unsaved draft and bad plugin refusal', { timeout: 60000 }, async t => {
  const f = fixture(t); const id = plugin(f, 'bench-op', { normal: { atk: 800 } });
  const b = bench(f); t.after(() => b.close());
  const req = { id, scenario: 'dummy', seconds: 4, seed: 7 };
  const a = await b.run(req), again = await b.run(req);
  assert.equal(a.ok, true, JSON.stringify(a)); assert.deepEqual(again, a);
  assert.ok(a.plugin.frames.length > 10); assert.ok(a.plugin.events.atk > 0);
  assert.ok(a.plugin.damage > a.vanilla.damage); assert.deepEqual(a.plugin.errors, []);
  const draft = await b.run({ ...req, draft: { template: 'operator', options: { normal: { atk: 1000 } } } });
  assert.equal(draft.ok, true, JSON.stringify(draft)); assert.ok(draft.plugin.damage > a.plugin.damage);
  const stored = JSON.parse(fs.readFileSync(path.join(f.dir, 'plugins', id, 'data/operator.json')));
  assert.equal(stored.forms.normal.stats.atk, 800, 'trial did not save the draft');
  fs.writeFileSync(path.join(f.dir, 'plugins', id, 'data/operator.json'), '{}'); f.registry.rescan();
  const bad = await b.run(req);
  assert.equal(bad.ok, false); assert.ok(bad.issues.every(x => x.code.startsWith('PLUGIN_'))); assert.equal(bad.plugin, undefined);
});

test('trial presets: wave, duel, and golden use engine events; invalid scenario refuses', { timeout: 60000 }, async t => {
  const f = fixture(t); const id = plugin(f); const b = bench(f); t.after(() => b.close());
  for (const scenario of ['wave','duel','golden:bonds:bond-deputShip-low']) {
    const r = await b.run({ id, scenario, seconds: 20 });
    assert.equal(r.ok, true, JSON.stringify(r)); assert.ok(r.plugin.frames.length > 1);
    if (scenario === 'duel') assert.ok(r.plugin.damage > 0, JSON.stringify(r.plugin.units));
    if (scenario === 'wave') assert.ok(r.plugin.events.spawn > 0);
  }
  const r = await b.run({ id, scenario: '../../etc/passwd' });
  assert.equal(r.ok, false); assert.equal(r.issues[0].code, 'PLUGIN_STUDIO_TRIAL_SCENARIO');
});

test('trial watchdog, concurrency limit, crash, cleanup and script gate', async t => {
  const f = fixture(t); const id = plugin(f); const children = [];
  const spawn = () => { const c = new EventEmitter(); c.send = () => {}; c.kill = () => { c.killed = true; }; children.push(c); return c; };
  const b = bench(f, { spawn, limits: { ...TRIAL_LIMITS, concurrent: 1, timeoutMs: 30 } });
  const running = b.run({ id });
  await assert.rejects(b.run({ id }), { code: 'PLUGIN_STUDIO_TRIAL_BUSY' });
  await assert.rejects(running, { code: 'PLUGIN_STUDIO_TRIAL_TIMEOUT' });
  assert.equal(b.active(), 0); assert.equal(children[0].killed, true);
  const crash = b.run({ id }); children[1].emit('exit', 1); await assert.rejects(crash, { code: 'PLUGIN_STUDIO_TRIAL_FAILED' });
  const pending = b.run({ id }); b.close(); await assert.rejects(pending); assert.equal(children[2].killed, true);
  const script = createPlugin(templateById('script'), { id: 'disabled-script' }); f.put('disabled-script', script.manifest, script.files);
  const real = bench(f); t.after(() => real.close());
  const r = await real.run({ id: 'disabled-script' }); assert.equal(r.ok, false); assert.equal(r.issues[0].code, 'PLUGIN_SCRIPTS_DISABLED');
});

async function request(studio, route, { body = {}, key, method = 'POST', ip = '127.0.0.1', host = 'localhost:3000', origin } = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = method; req.url = `/studio/api/${route}`; req.socket = { remoteAddress: ip };
  req.headers = { host, ...(key ? { 'x-sp-studio': key } : {}), ...(origin ? { origin } : {}) };
  const response = { headers: {}, status: null, body: null, headersSent: false,
    setHeader(k, v) { this.headers[k] = v; }, writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); this.headersSent = true; },
    end(body) { this.body = body?.toString(); }, destroy() {} };
  await studio.handle(req, response, req.url, '');
  return response;
}
test('trial API runs through LAN/Host/origin/key gates without opening a listening socket', async t => {
  const f = fixture(t); const id = plugin(f);
  const studio = createStudio({ registry: f.registry, pluginsDir: path.join(f.dir, 'plugins'), dataDir: path.resolve('data'), publicDir: path.resolve('public'),
    watch: () => ({ on() {}, close() {} }) });
  t.after(() => studio.close());
  const key = studio.key;
  for (const options of [{ ip: '8.8.8.8', key }, { host: 'evil.example', key }, { key, origin: 'https://evil.example' }, {}]) {
    assert.equal((await request(studio, 'trial', { body: { id }, ...options })).status, 404);
  }
  assert.equal((await request(studio, 'trial', { body: { id }, key: 'wrong' })).status, 403);
  const r = await request(studio, 'trial', { body: { id, seconds: 1 }, key });
  assert.equal(r.status, 200); assert.equal(JSON.parse(r.body).ok, true, r.body);
});

test('watchdog kills a real non-responsive child process and allows the next job', { timeout: 5000 }, async t => {
  const { fork } = await import('node:child_process');
  const f = fixture(t); const id = plugin(f);
  const entry = path.join(f.dir, 'hang.cjs');
  fs.writeFileSync(entry, "process.on('message', () => { for (;;) {} });\n");
  let child;
  const b = bench(f, { spawn: (_entry, args, options) => (child = fork(entry, args, options)), limits: { ...TRIAL_LIMITS, timeoutMs: 400 } });
  t.after(() => b.close());
  await assert.rejects(b.run({ id }), { code: 'PLUGIN_STUDIO_TRIAL_TIMEOUT' });
  // the child never exits by itself, and the job ends on its exit: it was killed. On Windows the watchdog's
  // taskkill /T /F ends the tree first, so child.kill() finds it gone and `killed` stays false — look at the process
  assert.ok(child.exitCode !== null || child.signalCode !== null, 'the job ended after the child exited');
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  if (process.platform !== 'win32') assert.equal(child.killed, true);
  assert.equal(b.active(), 0);
});

test('wizard API creates each class, saves with revision, validates DSL, and keeps executable files off studio GET', async t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.dir, 'plugins'), { recursive: true });
  const studio = createStudio({ registry: f.registry, pluginsDir: path.join(f.dir, 'plugins'), dataDir: path.resolve('data'), publicDir: path.resolve('public'),
    watch: () => ({ on() {}, close() {} }) });
  t.after(() => studio.close());
  for (const template of ['numbers','operator','dsl','meta','mode','ui','script']) {
    const id = `api-${template}`;
    const made = await request(studio, 'plugins', { key: studio.key, body: { id, template, name: id } });
    assert.equal(made.status, 201, made.body);
    const state = JSON.parse(made.body);
    assert.equal(state.authoring.template, template); assert.equal(state.check.ok, true);
    if (template === 'ui') {
      assert.ok(state.frame.frameFiles['ui/index.html']);
      const save = await request(studio, `plugins/${id}/authoring`, { key: studio.key,
        body: { ...state.authoring, options: { slot: 'room.panel', title: '</script><img src=x onerror=alert(1)>' } } });
      assert.equal(save.status, 200, save.body);
      const next = JSON.parse(save.body); assert.notEqual(next.vs, state.vs);
      const raw = fs.readFileSync(path.join(f.dir, `plugins/${id}/ui/index.html`), 'utf8');
      assert.match(raw, /&lt;\/script&gt;/); assert.match(raw, /slot: 'room.panel'/);
      assert.equal((await request(studio, `plugins/${id}/files/ui/index.html`, { method: 'GET' })).status, 404);
    }
    if (template === 'script') {
      assert.match(state.source.text, /sp.kits.register/);
      const noKey = await request(studio, `plugins/${id}`, { method: 'GET', ip: '192.168.1.20' });
      assert.equal(noKey.status, 200); assert.equal(JSON.parse(noKey.body).source, undefined);
      assert.doesNotMatch(noKey.body, /sp\.kits\.register/);
      const keyed = await request(studio, `plugins/${id}`, { method: 'GET', key: studio.key, ip: '192.168.1.20' });
      assert.match(JSON.parse(keyed.body).source.text, /sp.kits.register/);
      assert.equal((await request(studio, `plugins/${id}/authoring`, { key: studio.key, body: state.authoring })).status, 409);
    }
  }
  const valid = await request(studio, 'validate-dsl', { key: studio.key, body: { spec: { dsl: 1 } } });
  assert.equal(JSON.parse(valid.body).ok, true);
  const invalid = await request(studio, 'validate-dsl', { key: studio.key, body: { spec: { dsl: 1, talents: [{ when: 'every', seconds: 0 }] } } });
  assert.equal(JSON.parse(invalid.body).problems[0].code, 'PLUGIN_DSL_EVERY');
});
