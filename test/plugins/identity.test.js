// test/plugins/identity.test.js — the content identity (DESIGN §32): shared/sha256.js (the FIPS 180-2 vectors, node:crypto
// on every length and in pieces, UTF-8 like TextEncoder, and the same digests in a bare JavaScript realm — no Node
// API, as in a browser), the composition of `cs` (shared/plugins/identity.js: canonical JSON), the vanilla content of a
// server (server/plugins/identity.js): the same input gives the same `cs`, the Node and the browser hash agree, the
// manifest recomputes it, one changed byte of a gameplay file changes it while presentation files, data/i18n/ and
// nodeData.js do not, the hashed files are exactly the served bytes; and the wire: welcome.content,
// room.state.content, the match's opts.cs, /healthz content, GET /cs/<cs16>/index.json, BattleSpec `cs` (never read by
// the sim) and the optional b.result `cs`.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sha256, sha256Hex, createSha256, utf8 } from '../../shared/sha256.js';
import { canonicalJson, contentHashOf, contentHashInput, simHashOf, isContentHash, csUrlPart, CONTENT_HASH_VERSION } from '../../shared/plugins/identity.js';
import { computeVanillaContent, servedCodeFiles, gameplayDataFiles, PRESENTATION_DATA } from '../../server/plugins/identity.js';
import { DATA_SHIM_JS } from '../../server/http/static.js';
import { APP_VERSION } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { buildBattleSpec, createBattleFromSpec, resultDigest } from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';
import { Match } from '../../server/match/Match.js';
import { VirtualScheduler } from '../../server/match/scheduler.js';
import { StubMatch } from '../../server/match/StubMatch.js';
import { TestClient } from '../helpers/wsClient.js';
import { DATA } from '../match/harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const node = (b) => createHash('sha256').update(b).digest('hex');
const tmpdir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `sp-identity-${tag}-`));
const put = (dir, rel, body) => {
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), body);
};

describe('shared/sha256.js', () => {
  test('the FIPS 180-2 vectors', () => {
    assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.equal(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    const h = createSha256();
    const chunk = 'a'.repeat(1000);
    for (let i = 0; i < 1000; i++) h.update(chunk);
    assert.equal(h.hex(), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0', 'one million a');
    assert.equal(h.hex(), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0', 'a second digest answers the same');
    assert.throws(() => h.update('x'), /update after digest/);
    assert.deepEqual([...sha256('abc').subarray(0, 4)], [0xba, 0x78, 0x16, 0xbf]);
  });

  test('node:crypto agrees on every length around the block edges and on input in pieces', () => {
    for (let n = 0; n <= 300; n++) {
      const b = randomBytes(n);
      assert.equal(sha256Hex(b), node(b), `${n} bytes`);
      assert.equal(sha256Hex(new Uint8Array(b).buffer), node(b), `${n} bytes as an ArrayBuffer`);
    }
    const big = randomBytes(70_000);
    const h = createSha256();
    for (let i = 0, k = 1; i < big.length; i += k, k = (k * 7 + 3) % 257) h.update(big.subarray(i, i + k));
    assert.equal(h.hex(), node(big));
    const view = new DataView(big.buffer, big.byteOffset + 5, 100);
    assert.equal(sha256Hex(view), node(big.subarray(5, 105)), 'any ArrayBuffer view');
    assert.throws(() => sha256Hex(/** @type {any} */ (42)), /a string or bytes/);
  });

  test('strings are hashed as UTF-8, a lone surrogate as U+FFFD — as TextEncoder', () => {
    const enc = new TextEncoder();
    for (const s of ['', 'abc', '卫戍协议：盟约', '😀 emoji', 'é́', '\ud800', 'a\udc00b', '􏿿', `x${'一'.repeat(100)}`]) {
      assert.deepEqual([...utf8(s)], [...enc.encode(s)], JSON.stringify(s));
      assert.equal(sha256Hex(s), node(enc.encode(s)), JSON.stringify(s));
    }
  });

  test('the same digests in a bare JavaScript realm (no Buffer, no TextEncoder, no Node API — a browser\'s view)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'shared/sha256.js'), 'utf8');
    assert.ok(!/^import /m.test(src), 'no import');
    const realm = vm.createContext({});
    assert.equal(vm.runInContext('typeof Buffer + typeof TextEncoder + typeof process + typeof require', realm), 'undefinedundefinedundefinedundefined');
    const api = vm.runInContext(`${src.replace(/^export /gm, '')}\n;({ sha256Hex, utf8 })`, realm);
    for (const s of ['', 'abc', '卫戍协议：盟约', '😀', '\ud800x']) assert.equal(api.sha256Hex(s), sha256Hex(s), JSON.stringify(s));
    const bytes = randomBytes(1000);
    assert.equal(api.sha256Hex(bytes), node(bytes), 'bytes from another realm');
  });
});

describe('the composition of cs (shared/plugins/identity.js)', () => {
  test('canonical JSON: sorted keys, no white space, plain data only', () => {
    assert.equal(canonicalJson({ b: 1, a: [true, null, 'x', { d: 2, c: 1 }], u: undefined }), '{"a":[true,null,"x",{"c":1,"d":2}],"b":1}');
    assert.equal(canonicalJson('卫戍'), '"卫戍"');
    assert.equal(canonicalJson({ B: 1, a: 2, _: 3 }), '{"B":1,"_":3,"a":2}', 'UTF-16 code-unit order');
    for (const bad of [NaN, Infinity, [undefined], () => 1, 1n]) assert.throws(() => canonicalJson(bad), /canonicalJson/);
  });

  test('cs = sha256 of the canonical { v, app, sim, data, plugins, settings }; every part counts', () => {
    const parts = { app: '0.3.0', sim: 'aa'.repeat(32), data: { chess: 'bb'.repeat(32), config: 'cc'.repeat(32) } };
    const input = contentHashInput(parts);
    assert.deepEqual(input, { v: CONTENT_HASH_VERSION, app: '0.3.0', sim: 'aa'.repeat(32), data: parts.data, plugins: [], settings: {} });
    const cs = contentHashOf(parts);
    assert.equal(cs, sha256Hex(canonicalJson(input)));
    assert.ok(isContentHash(cs));
    assert.equal(contentHashOf({ ...parts, data: { config: 'cc'.repeat(32), chess: 'bb'.repeat(32) } }), cs, 'key order never matters');
    const variants = [
      { ...parts, app: '0.3.1' }, { ...parts, sim: 'ab'.repeat(32) }, { ...parts, data: { ...parts.data, chess: 'bc'.repeat(32) } },
      { ...parts, data: { chess: parts.data.chess } }, { ...parts, plugins: [{ id: 'marathon', version: '0.1.0', files: {} }] },
      { ...parts, settings: { marathon: { refresh: 1 } } },
    ];
    for (const v of variants) assert.notEqual(contentHashOf(v), cs, JSON.stringify(v).slice(0, 80));
    assert.equal(simHashOf({ 'b.js': '2', 'a.js': '1' }), simHashOf([['a.js', '1'], ['b.js', '2']]), 'a map or sorted pairs');
    assert.throws(() => simHashOf([['a.js', '1'], ['a.js', '2']]), /twice/);
    assert.equal(csUrlPart(cs), cs.slice(0, 16));
    assert.deepEqual(['ab'.repeat(32), 'AB'.repeat(32), 'ab'.repeat(31), 42, null].map(isContentHash), [true, false, false, false, false]);
  });
});

describe('the vanilla content of a server (server/plugins/identity.js)', () => {
  let fx;
  const opts = () => ({ simDir: path.join(fx, 'sim'), sharedDir: path.join(fx, 'shared'), dataDir: path.join(fx, 'data'), shim: 'export const shim = 1;\n', app: '0.3.0' });
  before(() => {
    fx = tmpdir('fx');
    put(fx, 'sim/Battle.js', 'export const a = 1;\n');
    put(fx, 'sim/battle/deploy.js', 'export const b = 2;\n');
    put(fx, 'sim/nodeData.js', 'import fs from "node:fs";\n');
    put(fx, 'sim/.hidden.js', 'x');
    put(fx, 'sim/content/kits/README.md', '# kits\n');
    put(fx, 'shared/protocol.js', 'export const c = 3;\n');
    put(fx, 'shared/plugins/manifest.js', 'export const d = 4;\n');
    put(fx, 'shared/notes.md', 'notes');
    put(fx, 'data/chess.json', '{"chess_a":{"atk":600}}\n');
    put(fx, 'data/config.json', '{"economy":{"income":[0,6]}}\n');
    for (const name of PRESENTATION_DATA) put(fx, `data/${name}.json`, '{}\n');
    put(fx, 'data/i18n/en.json', '{}\n');
    put(fx, 'data/readme.txt', 'x');
  });
  after(() => fs.rmSync(fx, { recursive: true, force: true }));

  test('the files: served code by URL path (no nodeData.js, no dot file, .js only) and the gameplay data (no presentation files, no data/i18n/)', () => {
    assert.deepEqual(servedCodeFiles(opts()).map((f) => f.path), ['shared/plugins/manifest.js', 'shared/protocol.js', 'sim/Battle.js', 'sim/battle/deploy.js']);
    assert.deepEqual(gameplayDataFiles(opts().dataDir).map((f) => f.name), ['chess', 'config']);
    const c = computeVanillaContent(opts());
    assert.deepEqual(Object.keys(c.simFiles), ['data.js', 'shared/plugins/manifest.js', 'shared/protocol.js', 'sim/Battle.js', 'sim/battle/deploy.js']);
    assert.equal(c.simFiles['sim/Battle.js'], node(Buffer.from('export const a = 1;\n')));
    assert.equal(c.simFiles['data.js'], node(Buffer.from(opts().shim)));
    assert.deepEqual(c.data.chess, { file: 'chess.json', sha256: node(Buffer.from('{"chess_a":{"atk":600}}\n')), bytes: 24 });
  });

  test('the same input gives the same cs; the Node hash and the browser\'s pure-JS hash agree; the manifest recomputes it', () => {
    const a = computeVanillaContent(opts());
    const b = computeVanillaContent(opts());
    assert.equal(a.cs, b.cs);
    assert.deepEqual(a.index, b.index);
    const browser = computeVanillaContent({ ...opts(), hash: (buf) => sha256Hex(buf) });
    assert.equal(browser.cs, a.cs, 'shared/sha256.js gives the cs of node:crypto');
    assert.deepEqual(browser.simFiles, a.simFiles);
    const idx = a.index;
    assert.deepEqual(Object.keys(idx), ['v', 'cs', 'app', 'vanilla', 'sim', 'simFiles', 'data', 'plugins', 'settings']);
    assert.equal(contentHashOf({ app: idx.app, sim: simHashOf(idx.simFiles), data: Object.fromEntries(Object.entries(idx.data).map(([k, v]) => [k, v.sha256])), plugins: idx.plugins, settings: idx.settings }), a.cs);
    assert.deepEqual(idx.data.chess, { url: `/data/chess.json?v=${a.data.chess.sha256.slice(0, 8)}`, sha256: a.data.chess.sha256, bytes: 24 });
  });

  test('one changed byte of a gameplay file changes cs; presentation files, data/i18n/, nodeData.js and documents do not', () => {
    const base = computeVanillaContent(opts()).cs;
    const edit = (rel, body) => {
      const abs = path.join(fx, rel);
      const was = fs.readFileSync(abs);
      fs.writeFileSync(abs, body);
      try { return computeVanillaContent(opts()).cs; } finally { fs.writeFileSync(abs, was); }
    };
    assert.notEqual(edit('data/chess.json', '{"chess_a":{"atk":601}}\n'), base, 'one data byte');
    assert.notEqual(edit('data/config.json', '{"economy":{"income":[0,6]}} \n'), base, 'white space is bytes too');
    assert.notEqual(edit('sim/battle/deploy.js', 'export const b = 3;\n'), base, 'a sim file');
    assert.notEqual(edit('shared/protocol.js', 'export const c = 4;\n'), base, 'a shared file');
    for (const rel of ['data/assets.json', 'data/local-assets.json', 'data/emotes.json', 'data/i18n/en.json', 'sim/nodeData.js', 'sim/content/kits/README.md', 'shared/notes.md', 'data/readme.txt']) {
      assert.equal(edit(rel, '{"changed":true}\n'), base, rel);
    }
    assert.equal(computeVanillaContent(opts()).cs, base, 'restored: the same cs again');
    put(fx, 'data/tuning.json', '{}\n');
    assert.notEqual(computeVanillaContent(opts()).cs, base, 'a new gameplay file');
    fs.rmSync(path.join(fx, 'data/tuning.json'));
    assert.notEqual(computeVanillaContent({ ...opts(), shim: `${opts().shim}// x\n` }).cs, base, 'the /data.js stand-in');
    assert.notEqual(computeVanillaContent({ ...opts(), app: '0.3.1' }).cs, base, 'the app version');
    assert.throws(() => computeVanillaContent({ ...opts(), shim: undefined }), /shim/);
  });

  test('this checkout: the vanilla content names the served sim, shared code, the stand-in and the gameplay data', () => {
    const c = computeVanillaContent({ simDir: path.join(ROOT, 'server/sim'), sharedDir: path.join(ROOT, 'shared'), dataDir: path.join(ROOT, 'data'), shim: DATA_SHIM_JS });
    assert.ok(isContentHash(c.cs));
    assert.equal(c.app, APP_VERSION);
    for (const p of ['sim/spec.js', 'sim/Battle.js', 'shared/sha256.js', 'shared/plugins/identity.js', 'data.js']) assert.ok(c.simFiles[p], p);
    assert.ok(!Object.keys(c.simFiles).some((p) => /nodedata\.js$/i.test(p)), 'the Node-only loader is never served');
    for (const name of ['chess', 'enemies', 'config', 'backups', 'waves']) assert.ok(c.data[name], name);
    for (const name of PRESENTATION_DATA) assert.equal(c.data[name], undefined, name);
  });

  test('this checkout: the cross-period 名片干员 roster (data/card-roster.json, DESIGN §37.325) is a presentation file — in no cs, no manifest', () => {
    const dataDir = path.join(ROOT, 'data');
    assert.ok(fs.existsSync(path.join(dataDir, 'card-roster.json')), 'the roster is committed');
    assert.ok(PRESENTATION_DATA.includes('card-roster'));
    assert.ok(!gameplayDataFiles(dataDir).some((f) => f.name === 'card-roster'), 'not a gameplay data file');
    const c = computeVanillaContent({ simDir: path.join(ROOT, 'server/sim'), sharedDir: path.join(ROOT, 'shared'), dataDir, shim: DATA_SHIM_JS });
    assert.equal(Object.hasOwn(c.index.data, 'card-roster'), false, 'not in the vanilla /cs/ index');
    assert.equal(Object.hasOwn(c.data, 'card-roster'), false);
  });
});

describe('the wire: welcome, room.state, the match, /healthz, /cs/, BattleSpec, b.result', () => {
  class RecordingStub extends StubMatch {
    static last = null;
    constructor(o) { super(o); RecordingStub.last = o; }
  }
  let srv;
  const clients = [];
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, MatchClass: RecordingStub });
  });
  after(async () => {
    await Promise.all(clients.map((c) => c.terminate().catch(() => {})));
    await srv.close();
  });

  test('welcome.content, room.state.content (always the vanilla set) and the match\'s opts.cs', async () => {
    const c = await TestClient.connect(srv.url.replace('http', 'ws') + '/ws');
    clients.push(c);
    const w = await c.hello('Amiya');
    assert.deepEqual(w.content, { vanilla: srv.content.cs });
    assert.ok(Array.isArray(w.diyKitted), 'welcome keeps diyKitted');
    const r = await c.request({ t: 'room.create', mode: 'solo', difficulty: 'FUNNY' });
    assert.equal(r.t, 'ok', JSON.stringify(r));
    const state = await c.waitFor('room.state', (s) => s.mode === 'solo');
    assert.deepEqual(state.content, { cs: srv.content.cs, vanilla: true, plugins: [] });
    assert.equal((await c.request({ t: 'room.start' })).t, 'ok');
    await c.waitFor('room.state', (s) => s.inMatch === true);
    assert.equal(RecordingStub.last.cs, srv.content.cs, 'lobby → Match opts.cs');
  });

  test('/healthz names the vanilla content; /cs/<cs16>/index.json is its manifest, cached for good, and only that one', async () => {
    const h = await (await fetch(`${srv.url}/healthz`)).json();
    assert.deepEqual(h.content, { vanilla: srv.content.cs, sets: 0 });
    const url = `${srv.url}/cs/${srv.content.cs.slice(0, 16)}/index.json`;
    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    const body = await res.json();
    assert.deepEqual(body, srv.content.index);
    assert.equal(body.cs, srv.content.cs);
    assert.equal((await fetch(url, { headers: { 'If-None-Match': res.headers.get('etag') } })).status, 304);
    for (const u of [`/cs/${'0'.repeat(16)}/index.json`, `/cs/${srv.content.cs}/index.json`, `/cs/${srv.content.cs.slice(0, 16)}/data/chess.json`, '/cs/']) {
      assert.equal((await fetch(srv.url + u)).status, 404, u);
    }
  });

  test('the hashed files are the bytes the server serves: every code file, the stand-in and every data URL of the manifest', async () => {
    const { simFiles, data } = srv.content.index;
    const entries = Object.entries(simFiles);
    assert.ok(entries.length > 250, `${entries.length} code files`);
    for (let i = 0; i < entries.length; i += 24) {
      await Promise.all(entries.slice(i, i + 24).map(async ([p, h]) => {
        const res = await fetch(`${srv.url}/${p}`);
        assert.equal(res.status, 200, p);
        assert.equal(node(Buffer.from(await res.arrayBuffer())), h, p);
      }));
    }
    for (const [name, f] of Object.entries(data)) {
      const res = await fetch(srv.url + f.url);
      assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable', name);
      const buf = Buffer.from(await res.arrayBuffer());
      assert.deepEqual([node(buf), buf.length], [f.sha256, f.bytes], name);
    }
  });

  test('BattleSpec cs: kept when well-formed, never read by the sim; the match puts its cs into every spec and b.start', () => {
    const cs = 'ef'.repeat(32);
    const chessId = Object.keys(DATA.chess).find((id) => id.endsWith('_a'));
    const base = { battleId: 'cs1', fieldId: 'n:p', kind: 'normal', seed: 9, round: 3, stageId: Object.keys(DATA.stages)[0], timeLimit: 30,
      players: [{ playerId: 'p', units: [{ uid: 1, kind: 'chess', chessId, row: 10, col: 5 }] }], spawns: [{ enemyKey: Object.keys(DATA.enemies)[0], count: 3, time: 0 }], routes: [] };
    const plain = buildBattleSpec(base);
    assert.equal(Object.hasOwn(plain, 'cs'), false, 'a spec built without cs is what it always was');
    assert.equal(buildBattleSpec({ ...base, cs }).cs, cs);
    for (const bad of ['EF'.repeat(32), 'ef', 42, null]) assert.equal(Object.hasOwn(buildBattleSpec({ ...base, cs: bad }), 'cs'), false, String(bad));
    const ds = new DataSource(DATA, null);
    const run = (spec) => { const b = createBattleFromSpec(spec, ds, { quiet: true }); while (!b.finished) b.step(); return resultDigest(b.result()); };
    assert.deepEqual(run(buildBattleSpec({ ...base, cs })), run(plain), 'the same battle with or without cs');
    const make = (o) => new Match({ roomCode: 'CS', mode: 'solo', difficulty: 'FUNNY', seats: [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true }],
      seed: 5, data: DATA, log: { info() {}, warn() {}, error() {}, debug() {} }, send: () => true, broadcast() {}, onEnd() {}, scheduler: new VirtualScheduler({ instantCombat: true }), ...o });
    const m = make({ cs });
    try {
      const f = m._ccField({ fieldId: 'n:p_0', kind: 'normal', players: ['p_0'], opts: { ...base, players: [{ ...base.players[0], playerId: 'p_0' }] } });
      assert.equal(f.spec.cs, cs);
      assert.equal(m._startMsg(f, 'p_0').spec.cs, cs, 'b.start carries it');
    } finally { m.dispose(); }
    const none = make({ cs: 'nope' });
    try { assert.equal(Object.hasOwn(none._ccField({ fieldId: 'n:p_0', kind: 'normal', players: ['p_0'], opts: base }).spec, 'cs'), false); } finally { none.dispose(); }
  });

  test('b.result: cs optional, checked for its form only', () => {
    const result = { reason: 'cleared', time: 10, perPlayer: { p_0: { killed: 1, total: 1, leaked: [], perfect: true, layerGains: {}, unitsEnd: [] } } };
    assert.equal(validateC2S({ t: 'b.result', battleId: 'b1', result }), null);
    assert.equal(validateC2S({ t: 'b.result', battleId: 'b1', result, cs: 'ab'.repeat(32) }), null);
    for (const bad of ['AB'.repeat(32), 'ab', 7, null]) assert.equal(validateC2S({ t: 'b.result', battleId: 'b1', result, cs: bad }), 'bad field cs', String(bad));
  });

  test('the golden results stay on the original content: the golden tool builds specs without cs and reads no plugin', () => {
    const src = fs.readFileSync(path.join(ROOT, 'tools/golden.mjs'), 'utf8');
    assert.ok(!/server\/plugins\/|shared\/plugins\/|\bcs:/.test(src));
  });
});
