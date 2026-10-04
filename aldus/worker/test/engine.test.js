// The engine bundle of the Worker (aldus/worker/build-engine.mjs, engine/glue.js): the run-time imports of the original
// content loaders made static, and the bundle itself running a match start outside Node's own module loader. The bundle
// tests need esbuild (`npm install` in aldus/worker); they skip without it, like the suites that need downloaded art.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const HAS_ESBUILD = fs.existsSync(path.join(HERE, '..', 'node_modules', 'esbuild'));
const skip = !HAS_ESBUILD && 'esbuild not installed (npm install in aldus/worker)';
const builder = () => import('../build-engine.mjs');

test('the content loaders of the original project are the ones the build knows', { skip }, async () => {
  const { contentLoaders, staticContentLoader } = await builder();
  const files = contentLoaders().map((f) => path.relative(ROOT, f).split(path.sep).join('/')).sort();
  assert.deepEqual(files, ['server/sim/content/bands.js', 'server/sim/content/bonds.js', 'server/sim/content/index.js']);
  for (const f of files) {
    const made = staticContentLoader(fs.readFileSync(path.join(ROOT, f), 'utf8'), path.join(ROOT, f));
    assert.ok(made.modules.length > 0, `${f}: a table of modules`);
    assert.ok(!made.code.includes('import(path)'), `${f}: no run-time import left`);
    for (const m of made.modules) assert.ok(fs.existsSync(path.join(ROOT, path.dirname(f), m)), `${f}: ${m} exists`);
  }
  // the kits and the nine content domains are in the table of the main loader
  const index = staticContentLoader(fs.readFileSync(path.join(ROOT, 'server/sim/content/index.js'), 'utf8'), path.join(ROOT, 'server/sim/content/index.js'));
  for (const m of ['./kits/tier1.js', './kits/tier6.js', './tokens.js', './bosses.js', './choices.js']) assert.ok(index.modules.includes(m), m);
});

test('staticContentLoader leaves other files alone and refuses a loader it does not know', { skip }, async () => {
  const { staticContentLoader } = await builder();
  const file = path.join(ROOT, 'server/sim/content/index.js');
  assert.equal(staticContentLoader('export const x = 1;\n', file), null);
  const twice = 'async function a(path) { return await import(path); }\nasync function b(path) { return await import(path); }\n';
  assert.throws(() => staticContentLoader(twice, file), /2 run-time imports/);
});

test('the bundle runs the start of a match and answers like the session layer', { skip }, async () => {
  const { buildEngine } = await builder();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-engine-'));
  try {
    const out = path.join(dir, 'engine.bundle.mjs');
    const built = await buildEngine({ out });
    assert.ok(built.modules > 60, `${built.modules} modules: the kits and the content are in`);
    assert.ok(!built.dataFiles.includes('assets.json'), 'the art manifest of the browser client is not in');
    assert.ok(built.bytes < 8 * 1048576, `${built.bytes} bytes`);
    const text = fs.readFileSync(out, 'utf8');
    for (const banned of ['class Lobby', 'class Network', 'WebSocketServer']) assert.ok(!text.includes(banned), `${banned} is not in the bundle`);

    const errors = [];
    const realError = console.error;
    console.error = (...a) => errors.push(a.join(' '));
    let E;
    try {
      await import(pathToFileURL(out).href);
      E = globalThis.SP_ENGINE;
      assert.equal(typeof E?.createMatch, 'function');

      const c = JSON.parse(E.init());
      const { PROTOCOL_VERSION, APP_VERSION } = await import('../../../shared/constants.js');
      assert.equal(c.protocolVersion, PROTOCOL_VERSION);
      assert.equal(c.appVersion, APP_VERSION);
      assert.equal(c.roomCodeLen, 4);
      assert.ok(c.errText.NOT_HOST && c.botNames.length >= 3 && c.soloResumeMs >= 3600_000);

      // the frame checks of server/net.js onFrame, with its texts
      assert.deepEqual(JSON.parse(E.inspect('{"t":"ping","c":1,"rid":3}')), { t: 'ping', rid: 3, detail: null });
      assert.deepEqual(JSON.parse(E.inspect('{"t":"nope","rid":4}')), { t: null, rid: 4, detail: 'unknown type nope' });
      assert.deepEqual(JSON.parse(E.inspect('{"t":"constructor"}')), { t: null, rid: null, detail: 'unknown type constructor' });
      assert.deepEqual(JSON.parse(E.inspect('{"t":"room.create","mode":"x","difficulty":"NORMAL"}')), { t: 'room.create', rid: null, detail: 'bad field mode' });
      assert.deepEqual(JSON.parse(E.inspect('nope')), { t: null, rid: null, detail: 'invalid json' });
      assert.equal(E.sanitizeName('  Do​ctor   Kal  '), 'Doctor Kal');
      assert.equal(E.sanitizeName('​'), '');
      assert.deepEqual(JSON.parse(E.checkLoadout('{}')), { ok: true, loadout: {} });
      assert.equal(JSON.parse(E.checkLoadout('{"no_such_chess":{"skill":0}}')).error, 'BAD_TARGET');
      assert.match(E.randomHex(16), /^[0-9a-f]{32}$/);

      // a match: the first frames, an accepted intent, a refused one
      const frames = [];
      const opts = { roomCode: 'TEST', mode: 'solo', difficulty: 'NORMAL', seed: 7, matchNo: 1,
        seats: [{ seat: 0, playerId: 'p_1', name: 'Doc', isBot: false, connected: true, loadout: null }] };
      const m = E.createMatch(JSON.stringify(opts), (pid, j) => { frames.push(`${JSON.parse(j).t}>${pid}`); return true; }, (j) => frames.push(`${JSON.parse(j).t}>all`), () => frames.push('END'));
      E.matchStart(m);
      assert.deepEqual(frames, ['m.private>p_1', 'm.public>all']);
      assert.deepEqual(JSON.parse(E.matchHandle(m, 'p_1', '{"t":"g.infoReady"}')), { ok: true });
      assert.equal(JSON.parse(E.matchHandle(m, 'p_1', '{"t":"g.buy","slot":0}')).error, 'WRONG_PHASE');
      assert.equal(JSON.parse(E.matchHandle(m, 'nobody', '{"t":"g.infoReady"}')).error, 'NOT_IN_ROOM');
      E.matchDispose(m);
    } finally {
      console.error = realError;
      delete globalThis.SP_ENGINE;
    }
    assert.deepEqual(errors.filter((e) => /\[content\]|failed to load/.test(e)), [], 'every content module loaded');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
