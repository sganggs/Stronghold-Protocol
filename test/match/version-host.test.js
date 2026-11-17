// test/match/version-host.test.js — the match hosts of the official versions (DESIGN §35.23, M1; server/match/host/
// kind 'version', server/versions.js): a version's matches run in a child process whose data singleton is that version's.
//
//   (a) an all-AI co-op 绝境 match of 第一期下半 (four AI seats, virtual time) ends: no engine error, the host reports the
//       version and the cs of server/versions.js;
//   (b) a two-seat co-op 险境 match of 第二期上半 ends;
//   (c) data bytes that do not hash to the version's cs: the host never boots, the match ends 'version-start' with the
//       version msgid;
//   (d) a test match's journal, taken from the host's log lines (prefixed with the host's label), carries
//       init.options.version and replays in a process of that version's data to the same result;
//   (e) computing every version's bounds snapshot leaves this process's official-bounds cache (第二期下半's) as it was;
//   (f) no official blackboard value of any version is over the cap its own snapshot sets;
//   a test room in a version host takes test commands through the proxy, checked against that version's data; the host
//   refuses a match of another version; wireOptions forwards version and hostId together.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createMatchHosts, HostError } from '../../server/match/host/index.js';
import { wireOptions, crashMessage } from '../../server/match/host/proxy.js';
import { createVersionSets } from '../../server/versions.js';
import { computeVanillaContent } from '../../server/plugins/identity.js';
import { DATA_DIR, ROOT, getData, getVersionData } from '../../server/data.js';
import { DATA_SHIM_JS } from '../../server/http/static.js';
import { Lobby } from '../../server/lobby.js';
import { decodeTestTrace, replayTestMatch } from '../../server/match/testReplay.js';
import { SessionRegistry } from '../../server/net.js';
import { ERR } from '../../shared/constants.js';
import { DEFAULT_VERSION, VERSIONS } from '../../shared/versions.js';
import { bbCap, installOfficialBounds, officialBbMax, officialBoundsOf, rememberOfficialBounds } from '../../shared/plugins/officialBounds.js';

const HELPER = fileURLToPath(new URL('../helpers/versionReplay.mjs', import.meta.url));
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const giveUp = (ms) => new Promise((r) => { setTimeout(() => r(null), ms).unref(); });
const vanilla = computeVanillaContent({ simDir: path.join(ROOT, 'server', 'sim'), sharedDir: path.join(ROOT, 'shared'), dataDir: DATA_DIR, shim: DATA_SHIM_JS });
const ALL = VERSIONS.map((v) => v.id);
const versions = createVersionSets({ enabled: ALL, vanilla, defaultData: getData({ log: quiet }), log: quiet });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-version-host-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const frames = () => { const out = { sent: [], broadcast: [], ended: [] }; out.end = new Promise((r) => { out.resolveEnd = r; }); return out; };
const bots = (n) => Array.from({ length: n }, (_, i) => ({ seat: i, playerId: `ai_${i}`, name: `AI ${i}`, isBot: true, connected: true }));
function matchOpts(cs, version, seats, out, extra = {}) {
  return {
    roomCode: 'VERS', mode: 'coop', difficulty: 'HARD', modeId: 'mode_multi_hard', seats, spectators: [], seed: 11, matchNo: 1, cs, requireCs: true, version,
    send: (pid, msg) => { out.sent.push([pid, msg]); return true; },
    broadcast: (msg) => out.broadcast.push(msg),
    onEnd: (summary) => { out.ended.push(summary); out.resolveEnd?.(summary); },
    ...extra,
  };
}
/** Resolve once `list` has not grown for `ms` (at most `cap` ms in all). */
async function logQuiet(list, ms, cap) {
  const t0 = Date.now();
  let n = list.length;
  let since = t0;
  while (Date.now() - t0 < cap) {
    await new Promise((r) => { setTimeout(r, 25); });
    if (list.length !== n) { n = list.length; since = Date.now(); } else if (Date.now() - since >= ms) return;
  }
}
/** A logger that keeps the test journal lines: the host prefixes each with its label (`[act1autochess] [test-input …`). */
function journalLog() {
  const entries = [];
  const lines = [];
  const take = (line) => {
    const s = String(line);
    lines.push(s);
    const i = s.indexOf('[test-input ');
    if (i >= 0) entries.push(JSON.parse(s.slice(s.indexOf(']', i) + 2)));
  };
  return { entries, lines, log: { info: take, warn: take, error: (...a) => lines.push(a.map(String).join(' ')), debug() {} } };
}

test('(a) an all-AI co-op 绝境 match of 第一期下半 ends in its version host: no engine error, its version and cs', { timeout: 240_000 }, async () => {
  const cs = versions.csOf('act1autochess');
  const hosts = createMatchHosts({ contents: versions, log: quiet, options: { kind: 'version', virtualTime: true, matchOptions: { botRehearsal: 0 } } });
  try {
    const out = frames();
    const m = hosts.create(cs, matchOpts(cs, 'act1autochess', bots(4), out));
    assert.equal(m.hosted, true);
    m.start();
    const summary = await Promise.race([out.end, giveUp(220_000)]);
    assert.ok(summary, 'the match ended');
    assert.equal(typeof summary.victory, 'boolean');
    assert.ok(summary.roundsPassed >= 1, JSON.stringify(summary).slice(0, 200));
    assert.equal(summary.modeId, 'mode_multi_hard');
    const d = await m.diag();
    assert.equal(d.errorCount, 0, `engine errors: ${JSON.stringify(d.errors)}`);
    assert.equal(d.version, 'act1autochess');
    assert.equal(d.cs, cs);
    assert.equal(hosts._host(cs).kind, 'version');
    m.dispose();
  } finally { hosts.close(); }
});

test('(b) a two-seat co-op 险境 match of 第二期上半 ends', { timeout: 240_000 }, async () => {
  const cs = versions.csOf('act2autochess@V2_1');
  const hosts = createMatchHosts({ contents: versions, log: quiet, options: { kind: 'version', virtualTime: true, matchOptions: { botRehearsal: 0 } } });
  try {
    const out = frames();
    const m = hosts.create(cs, matchOpts(cs, 'act2autochess@V2_1', bots(2), out, { difficulty: 'NORMAL', modeId: 'mode_multi_normal' }));
    m.start();
    const summary = await Promise.race([out.end, giveUp(220_000)]);
    assert.ok(summary, 'the match ended');
    const d = await m.diag();
    assert.equal(d.errorCount, 0, `engine errors: ${JSON.stringify(d.errors)}`);
    assert.equal(d.version, 'act2autochess@V2_1');
    m.dispose();
  } finally { hosts.close(); }
});

test('(c) data bytes that do not hash to the version\'s cs: \'version-start\', the version msgid; another version\'s match is refused', { timeout: 60_000 }, async () => {
  const cs = versions.csOf('act1autochess@V1_1');
  const tampered = { ...versions, get: (x) => versions.get(x), dataBytes: (x) => ({ ...versions.dataBytes(x), chess: Buffer.from('{}') }) };
  const hosts = createMatchHosts({ contents: tampered, log: quiet, options: { kind: 'version', virtualTime: true } });
  try {
    const out = frames();
    const m = hosts.create(cs, matchOpts(cs, 'act1autochess@V1_1', bots(1), out));
    m.start();
    const summary = await Promise.race([out.end, giveUp(50_000)]);
    assert.equal(summary?.reason, 'version-start');
    const toast = out.broadcast.find((x) => x.t === 'm.toast');
    assert.equal(toast.msgid, '该版本的模拟无法启动');
    assert.equal(toast.kind, 'error');
  } finally { hosts.close(); }
  assert.deepEqual(['version-hang', 'version-start', 'version-crash', 'plugin-start'].map((r) => crashMessage(r).msgid),
    ['本局模拟长时间无响应，已结束', '该版本的模拟无法启动', '本局模拟出错，已结束', '房间的插件内容无法启动模拟']);
  // a match that names another version than its host's data: 'failed' → version-start
  const cs2 = versions.csOf('act1autochess');
  const hosts2 = createMatchHosts({ contents: versions, log: quiet, options: { kind: 'version', virtualTime: true } });
  try {
    const out = frames();
    const m = hosts2.create(cs2, matchOpts(cs2, 'act2autochess@V2_1', bots(1), out));
    m.start();
    const summary = await Promise.race([out.end, giveUp(50_000)]);
    assert.equal(summary?.reason, 'version-start');
    assert.match(summary.detail, /not this host's/);
  } finally { hosts2.close(); }
  // a full version pool: INTERNAL 'version hosts busy'
  const hosts3 = createMatchHosts({ contents: versions, log: quiet, options: { kind: 'version', maxWorkers: 1, transport: 'worker', matchModule: fileURLToPath(new URL('./fixtures/hostMatch.js', import.meta.url)) } });
  try {
    const one = hosts3.create(cs2, matchOpts(cs2, 'act1autochess', [{ seat: 0, playerId: 'p', name: 'P', isBot: false, connected: true }], frames()));
    one.start();
    assert.throws(() => hosts3.create(cs, matchOpts(cs, 'act1autochess@V1_1', bots(1), frames())), (e) => e instanceof HostError && e.code === ERR.INTERNAL && e.message === 'version hosts busy');
  } finally { hosts3.close(); }
});

test('(d) a test match\'s journal from the host log carries its version and replays in that version\'s process to the same result', { timeout: 300_000 }, async () => {
  const cs = versions.csOf('act1autochess');
  const j = journalLog();
  const hosts = createMatchHosts({ contents: versions, log: j.log, options: { kind: 'version', virtualTime: true, matchOptions: { botRehearsal: 0 } } });
  let summary;
  try {
    const out = frames();
    const m = hosts.create(cs, matchOpts(cs, 'act1autochess', bots(1), out, { test: true, difficulty: 'FUNNY', modeId: 'mode_multi_funny' }));
    m.start();
    summary = await Promise.race([out.end, giveUp(250_000)]);
    assert.ok(summary, 'the match ended');
    // the journal logs the timer that ended the match after its callback ran (testTrace records its steps), so that last
    // line reaches this process after 'end': wait until the log is quiet before the host goes — a harness race only
    // (a production host outlives its match by minutes, and its later lines still reach the log)
    await logQuiet(j.entries, 300, 10_000);
    m.dispose();
  } finally { hosts.close(); }
  assert.ok(j.lines.some((l) => l.startsWith('[act1autochess] [test-input ')), 'the host labels its lines with the version');
  assert.ok(j.entries.length > 1, 'journal lines were captured');
  const init = decodeTestTrace(j.entries)[0];
  assert.equal(init.kind, 'init');
  assert.equal(init.options.version, 'act1autochess');
  assert.equal(init.options.cs, cs);
  const file = path.join(tmp, 'journal.json');
  fs.writeFileSync(file, JSON.stringify(j.entries));
  const r = spawnSync(process.execPath, [HELPER, 'act1autochess', file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr);
  const replay = JSON.parse(r.stdout);
  assert.equal(replay.version, 'act1autochess');
  assert.deepEqual(replay.summary, summary, 'the same final m.result');
  // this process's singleton is 第二期下半's: the journal is refused with either data, never re-simulated on other kits
  for (const d of [getData(), getVersionData('act1autochess', { log: quiet })]) {
    assert.throws(() => replayTestMatch(d, j.entries), /journal of act1autochess needs that version's data/);
  }
});

test('(e) every version\'s bounds snapshot leaves this process\'s official bounds (第二期下半) as they were', () => {
  rememberOfficialBounds(getData({ log: quiet }));
  const keys = ['atk', 'max_hp', 'attack_speed', 'duration', 'base_def', 'cost'];
  const before = keys.map((k) => officialBbMax(k));
  for (const id of ALL) officialBoundsOf(getVersionData(id, { log: quiet }));
  assert.deepEqual(keys.map((k) => officialBbMax(k)), before);
});

test('(f) no official blackboard value of a version is over the cap of its own snapshot', () => {
  const walk = (node, fn, under = false) => {
    if (Array.isArray(node)) { for (const x of node) walk(x, fn, under); return; }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (k === 'bb' || k === 'blackboard') {
        if (Array.isArray(v)) { for (const row of v) if (row && typeof row.key === 'string' && typeof row.value === 'number') fn(row.key, row.value); }
        else walk(v, fn, true);
      } else if (under && typeof v === 'number' && Number.isFinite(v)) fn(k, v);
      else walk(v, fn, under);
    }
  };
  try {
    for (const id of ALL) {
      const data = getVersionData(id, { log: quiet });
      installOfficialBounds(officialBoundsOf(data));
      let n = 0;
      const over = [];
      for (const table of ['chess', 'backups', 'enemies', 'bands', 'bonds', 'effects', 'items', 'waves', 'choices', 'garrisons', 'tokens']) {
        walk(data[table], (key, value) => { n++; if (Math.abs(value) > bbCap(key)) over.push(`${table} ${key}=${value} > ${bbCap(key)}`); });
      }
      assert.ok(n > 1000, `${id}: ${n} values walked`);
      assert.deepEqual(over.slice(0, 5), [], id);
    }
  } finally {
    // this process's own bounds again (第二期下半's)
    installOfficialBounds(null);
    rememberOfficialBounds(getData({ log: quiet }));
  }
});

test('a test room of a version plays in its host: test commands through the proxy against that version\'s data', { timeout: 120_000 }, async () => {
  // 第一期 solo preparation is the official 300 s (DESIGN §35.22.7). Under virtual time that prep ends during the
  // first round trip and the next g.test is WRONG_PHASE. soloUnlimited holds the quiet phase for this item check.
  // The room's 「不限时」 defaults off (§35.23.10), so this test still forces it through matchOptions.
  const versionHosts = createMatchHosts({ contents: versions, log: quiet, options: { kind: 'version', virtualTime: true, matchOptions: { botRehearsal: 0, soloUnlimited: true } } });
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, log: quiet, content: { cs: vanilla.cs }, getData, versions, versionHosts, options: { testMode: '1', testHost: '127.0.0.1' } });
  try {
    const s = registry.create('Tester');
    s.connected = true;
    s.disconnectedAt = null;
    s.ws = { readyState: 1, bufferedAmount: 0, send() {}, terminate() {} };
    assert.deepEqual(lobby.create(s, { mode: 'solo', difficulty: 'NORMAL', test: true, version: 'act1autochess' }), { ok: true });
    const room = lobby.getRoom(s.roomCode);
    assert.deepEqual(lobby.contentReady(s, { cs: room.content.cs }), { ok: true });
    assert.deepEqual(lobby.start(s), { ok: true });
    assert.equal(room.match.hosted, true);
    assert.equal(room.match.opts.version, 'act1autochess');
    assert.deepEqual(Object.fromEntries(['test', 'hostId', 'version'].map((k) => [k, wireOptions(room.match.opts)[k]])), { test: true, hostId: s.playerId, version: 'act1autochess' });
    // 第一期-only equipment (chess_item_2_08_e_a) is granted; 第二期-only equipment (chess_item_3_07_e_a) is unknown here
    const yes = await lobby.onMessage(s, { t: 'g.test', cmd: 'item', args: { id: 'chess_item_2_08_e_a' } });
    assert.deepEqual(yes, { ok: true });
    const no = await lobby.onMessage(s, { t: 'g.test', cmd: 'item', args: { id: 'chess_item_3_07_e_a' } });
    assert.equal(no.error, ERR.BAD_TARGET, JSON.stringify(no));
  } finally {
    lobby.shutdown();
    versionHosts.close();
  }
  assert.equal(DEFAULT_VERSION, 'act2autochess');
});
