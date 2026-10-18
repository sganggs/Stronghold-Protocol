// test/match/plugin-host.test.js — the match hosts of rooms with gameplay plugins (DESIGN §32.6, P1c;
// server/match/host/): a content set's matches run in a match host of their own — a child process by default, a worker
// thread with SP_MATCH_HOST=worker (or the `transport: 'worker'` option).
//
//   * the transport: a child process unless a worker thread is asked for by name;
//   * a whole match of AI seats in its host (the real Match on a content set — a data plugin's bond value and its own
//     mode — virtual time): it ends with its result, no engine error, the plugin mode played;
//   * a real-time co-op room over websockets with SP_VERIFY=all (matchOptions.verify): two scripted humans simulate
//     their battles on the set's data (test/match/simClient.js) — one names the room's content in b.result, the other
//     names none: the worker verifies the first one's results and accepts them, refuses the second one's (requireCs) and
//     runs those battles itself;
//   * the watchdog: a worker whose heartbeats stop (the test fixture's match spins forever) is terminated, the pending
//     request answered INTERNAL, the room back in its lobby and told (a message id); the next match of the set starts a
//     new worker; a worker that throws (an uncaught error) ends its match the same way;
//   * test data with extreme numbers — a data plugin that sets factions.generation.maxLevelCnt to 1e9 (the round-type
//     schedule is that long): its child process runs out of its memory limit (or stops beating while it tries) and the
//     room is back in its lobby;
//   * the concurrency limit (worker threads, the opt-in): one worker more than maxWorkers is PLUGIN_BUSY while every
//     worker has a match; an idle worker is stopped to make room.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../server/index.js';
import { getData } from '../../server/data.js';
import { createPluginRegistry } from '../../server/plugins/registry.js';
import { createContentSets } from '../../server/plugins/contentSets.js';
import { createMatchHosts, HostError } from '../../server/match/host/index.js';
import { DataSource } from '../../server/sim/simdata.js';
import { EMOTES, ERR } from '../../shared/constants.js';
import { TestClient } from '../helpers/wsClient.js';
import { writePlugin } from '../helpers/pluginFixtures.js';
import { attachWsSimClient } from './simClient.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = fileURLToPath(new URL('./fixtures/hostMatch.js', import.meta.url));
const HANG = '房间的插件内容长时间无响应，本局模拟已结束';
const CRASH = '房间的插件内容出错，本局模拟已结束';
const START = '房间的插件内容无法启动模拟';
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
/** Resolves null after `ms` without keeping the process alive (a race's fallback). */
const giveUp = (ms) => new Promise((r) => { setTimeout(() => r(null), ms).unref(); });
const content = (extra = {}) => ({ manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'content', scope: ['room'], permissions: ['data.patch', 'data.add'], ...extra });
const bondPatch = (value) => ({ patch: 1, ops: [['bb', 'base_def'], ['buffs', 0, 'bb', 'base_def']].map((p) => ({ op: 'set', file: 'bonds', id: 'deputShip', path: p, value })) });

const dirs = [];
/** A plugins folder with these plugins: id → [manifest extra, files]. */
function pluginsDir(plugins) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-plugin-host-'));
  dirs.push(tmp);
  const dir = path.join(tmp, 'plugins');
  for (const [id, [extra, files]] of Object.entries(plugins)) writePlugin(path.join(dir, id), content(extra), files);
  return dir;
}
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

/** The content sets of a plugins folder (the server's pieces, without a server). */
function setsOf(dir) {
  const registry = createPluginRegistry({ publicDir: path.join(ROOT, 'public'), dataDir: path.join(ROOT, 'data'), packsDir: path.join(path.dirname(dir), 'packs'), pluginsDir: dir }, { log: quiet });
  registry.refresh(true);
  return createContentSets({ registry, vanillaData: getData({ log: quiet }), log: quiet });
}

/** Lobby-shaped options for a hosted match whose frames land in `out`. */
function matchOpts(cs, seats, out, extra = {}) {
  return {
    roomCode: 'TEST', mode: 'coop', difficulty: 'NORMAL', modeId: 'mode_multi_normal', seats, spectators: [], seed: 7, matchNo: 1, cs, requireCs: true,
    send: (pid, msg) => { out.sent.push([pid, msg]); return true; },
    broadcast: (msg) => out.broadcast.push(msg),
    onEnd: (summary) => { out.ended.push(summary); out.resolveEnd?.(summary); },
    ...extra,
  };
}
const frames = () => { const out = { sent: [], broadcast: [], ended: [] }; out.end = new Promise((r) => { out.resolveEnd = r; }); return out; };
const bots = (n) => Array.from({ length: n }, (_, i) => ({ seat: i, playerId: `ai_${i}`, name: `AI ${i}`, isBot: true, connected: true }));

describe('match hosts (P1c): a content set\'s matches in a match host of its own', () => {
  test('the transport: a child process by default; a worker thread only with SP_MATCH_HOST=worker', { timeout: 60_000 }, async () => {
    const was = process.env.SP_MATCH_HOST;
    try {
      for (const [env, want] of [[undefined, 'process'], ['worker', 'worker'], ['WORKER ', 'worker'], ['process', 'process'], ['threads', 'process']]) {
        if (env === undefined) delete process.env.SP_MATCH_HOST; else process.env.SP_MATCH_HOST = env;
        const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir: pluginsDir({}), assetIndex: false });
        try { assert.equal(srv.hosts.stats().transport, want, `SP_MATCH_HOST=${env}`); } finally { await srv.close(); }
      }
    } finally { if (was === undefined) delete process.env.SP_MATCH_HOST; else process.env.SP_MATCH_HOST = was; }
    assert.equal(createMatchHosts({ contents: { get: () => null, dataBytes: () => null }, log: quiet }).stats().transport, 'process');
  });

  test('a whole match of AI seats in its match host (a child process): the content set\'s data and mode, its result, no engine error', { timeout: 120_000 }, async () => {
    const dir = pluginsDir({
      marathon: [{ data: ['patch.json'], modes: ['modes/long.json'] }, {
        'patch.json': bondPatch(0.35),
        'modes/long.json': { id: 'mode_x_marathon_long', base: 'mode_multi_normal', set: { name: '马拉松·险境' } },
      }],
    });
    const contents = setsOf(dir);
    const r = contents.resolve(['marathon']);
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual(r.set.modes.map((m) => [m.id, m.roomMode, m.difficulty]), [['mode_x_marathon_long', 'coop', 'NORMAL']]);
    contents.hold(r.set.cs);
    const hosts = createMatchHosts({ contents, log: quiet, options: { virtualTime: true, matchOptions: { botRehearsal: 0 } } });
    try {
      assert.equal(hosts.stats().transport, 'process');
      const out = frames();
      const m = hosts.create(r.set.cs, matchOpts(r.set.cs, bots(4), out, { modeId: 'mode_x_marathon_long' }));
      assert.equal(m.hosted, true);
      m.start();
      const summary = await Promise.race([out.end, giveUp(100_000)]);
      assert.ok(summary, 'the match ended');
      assert.equal(typeof summary.victory, 'boolean');
      assert.ok(summary.roundsPassed >= 1, JSON.stringify(summary).slice(0, 200));
      const d = await m.diag();
      assert.equal(d.errorCount, 0, `engine errors: ${JSON.stringify(d.errors)}`);
      assert.equal(d.modeId, 'mode_x_marathon_long', 'the plugin mode was played');
      assert.equal(d.cs, r.set.cs);
      const pubs = out.broadcast.filter((x) => x.t === 'm.public');
      assert.ok(pubs.length > 10, 'its m.public frames went out through the lobby\'s broadcast');
      assert.equal(pubs[pubs.length - 1].phase, 'RESULT');
      m.dispose();
      assert.equal(hosts.stats().matches, 0);
    } finally { hosts.close(); }
  });

  test('the concurrency limit (worker threads, the opt-in): one worker more than maxWorkers is PLUGIN_BUSY while each has a match; an idle one makes room', { timeout: 60_000 }, async () => {
    const dir = pluginsDir({ one: [{ data: ['p.json'] }, { 'p.json': bondPatch(0.31) }], two: [{ data: ['p.json'] }, { 'p.json': bondPatch(0.32) }] });
    const contents = setsOf(dir);
    const a = contents.resolve(['one']).set;
    const b = contents.resolve(['two']).set;
    const hosts = createMatchHosts({ contents, log: quiet, options: { transport: 'worker', maxWorkers: 1, matchModule: FIXTURE } });
    const human = [{ seat: 0, playerId: 'p_1', name: 'P1', isBot: false, connected: true }];
    try {
      const first = hosts.create(a.cs, matchOpts(a.cs, human, frames()));
      first.start();
      assert.throws(() => hosts.create(b.cs, matchOpts(b.cs, human, frames())), (e) => e instanceof HostError && e.code === ERR.PLUGIN_BUSY);
      // a second match of the same set shares its worker
      const twin = hosts.create(a.cs, matchOpts(a.cs, human, frames()));
      twin.start();
      assert.deepEqual(hosts.stats(), { workers: 1, matches: 2, transport: 'worker' });
      assert.deepEqual(await twin.handle('p_1', { t: 'g.emote', id: EMOTES[0] }), { ok: true });
      first.dispose();
      twin.dispose();
      // the worker is idle now: the other set's match stops it and starts its own
      const other = hosts.create(b.cs, matchOpts(b.cs, human, frames()));
      other.start();
      assert.deepEqual(await other.handle('p_1', { t: 'g.emote', id: EMOTES[0] }), { ok: true });
      assert.deepEqual(hosts.stats(), { workers: 1, matches: 1, transport: 'worker' });
      other.dispose();
    } finally { hosts.close(); }
  });
  test('the official-bounds snapshot: a match host installs the one the server validated the set against (the caps its pages install), never a scan of the set', { timeout: 60_000 }, async () => {
    // a plugin whose own numbers are far above the official maximum: a scan of the set would raise the cap with them
    const dir = pluginsDir({ caps: [{ data: ['p.json'] }, { 'p.json': bondPatch(0.34) }] });
    const contents = setsOf(dir);
    const r = contents.resolve(['caps']);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.set.bounds?.v, 1, 'the set carries the snapshot');
    assert.equal(r.set.bounds.bb.times, 12);
    const hosts = createMatchHosts({ contents, log: quiet, options: { matchModule: FIXTURE } });
    const human = [{ seat: 0, playerId: 'p_1', name: 'P1', isBot: false, connected: true }];
    const out = frames();
    try {
      const m = hosts.create(r.set.cs, matchOpts(r.set.cs, human, out));
      m.start();
      assert.deepEqual(await m.handle('p_1', { t: 'g.emote', id: EMOTES[0] }), { ok: true });
      let probe = null;
      for (let i = 0; i < 100 && !probe; i++) { probe = out.sent.map(([, x]) => x).find((x) => x.t === 'm.toast' && /^probe;/.test(x.text || '')); if (!probe) await delay(50); }
      assert.ok(probe, 'the probe answered');
      assert.match(probe.text, /;bond=0\.34;/);
      assert.match(probe.text, /;times-cap=120$/, '10 × the official 12 — the page\'s cap; the floor 64 without the snapshot');
      m.dispose();
    } finally { hosts.close(); }
  });
});

describe('match hosts in rooms (P1c): verification, the watchdog, crashes', () => {
  const open = [];
  const servers = [];
  after(async () => {
    await Promise.all(open.map((c) => c.terminate().catch(() => {})));
    for (const s of servers) await s.close();
  });
  const player = async (srv, name) => {
    const c = await TestClient.connect(srv.url.replace('http', 'ws') + '/ws');
    open.push(c);
    const w = await c.hello(name);
    c.id = w.playerId;
    return c;
  };
  // room.setPlugins composes the room's content set and room.start answers once the room's match host (a child
  // process) is up: a Windows CI runner can take more than the client's 2 s default for either, so those steps and
  // the states they publish get a longer wait
  const START_MS = 20_000;
  const ok = async (c, msg, timeout) => { const r = await c.request(msg, timeout); assert.equal(r.t, 'ok', `${msg.t}: ${JSON.stringify(r)}`); return r; };
  /** A solo room with the plugin `id` switched on and checked by the host's page. */
  async function moddedRoom(srv, host, id, mode = 'solo') {
    await ok(host, { t: 'room.create', mode, difficulty: 'NORMAL' });
    await host.waitFor('room.state');
    await ok(host, { t: 'room.setPlugins', plugins: [{ id }] }, START_MS);
    const st = await host.waitFor('room.state', (s) => s.content?.vanilla === false, START_MS);
    await ok(host, { t: 'room.contentReady', cs: st.content.cs }, START_MS);
    return st;
  }

  test('the watchdog: a worker that stops beating is terminated — the request answered INTERNAL, the room back in its lobby and told', { timeout: 60_000 }, async () => {
    const dir = pluginsDir({ rules: [{ data: ['p.json'] }, { 'p.json': bondPatch(0.33) }] });
    const errors = [];
    const log = { ...quiet, warn: (...a) => errors.push(a.join(' ')), error: (...a) => errors.push(a.map(String).join(' ')) };
    const srv = await startServer({ port: 0, host: '127.0.0.1', log, pluginsDir: dir, assetIndex: false,
      matchHost: { matchModule: FIXTURE, watchdogMs: 1500, heartbeatMs: 100 } });
    servers.push(srv);
    const host = await player(srv, 'Kal');
    const st = await moddedRoom(srv, host, 'rules');
    await ok(host, { t: 'room.start' }, START_MS);
    await host.waitFor('room.state', (s) => s.inMatch === true, START_MS);
    await ok(host, { t: 'g.emote', id: EMOTES[0] }, 5000); // the worker is up and answering
    const t0 = Date.now();
    const hung = await host.request({ t: 'g.emote', id: EMOTES[1] }, 15_000);
    assert.deepEqual([hung.t, hung.code], ['error', ERR.INTERNAL], 'the request the worker never answers');
    assert.ok(Date.now() - t0 >= 1000 && Date.now() - t0 < 10_000, `answered when the watchdog acted (${Date.now() - t0} ms)`);
    const toast = await host.waitFor('m.toast', (m) => m.msgid === HANG, 5000);
    assert.equal(toast.kind, 'error');
    const back = await host.waitFor('room.state', (s) => s.inMatch === false, 5000);
    assert.equal(back.content.cs, st.content.cs, 'the room keeps its content set');
    assert.ok(errors.some((l) => /stopped \(plugin-hang/.test(l)), `the log names it: ${errors.join(' | ')}`);
    assert.equal(srv.hosts.stats().workers, 0);
    // the next match of the set gets a new worker
    await ok(host, { t: 'room.start' }, START_MS);
    await host.waitFor('room.state', (s) => s.inMatch === true, START_MS);
    await ok(host, { t: 'g.emote', id: EMOTES[0] }, 5000);
    const probe = await host.waitFor('m.toast', (m) => /^probe;/.test(m.text || ''), 5000);
    assert.match(probe.text, /;bond=0\.33;/);
    // a worker that throws: its match ends the same way (plugin-crash)
    await ok(host, { t: 'g.emote', id: EMOTES[2] }, 5000);
    await host.waitFor('m.toast', (m) => m.msgid === CRASH, 5000);
    await host.waitFor('room.state', (s) => s.inMatch === false, 5000);
  });

  // maxLevelCnt 1e9 has makeTypeSchedule push a billion round slots. In a worker thread that growth ends at
  // ERR_WORKER_OUT_OF_MEMORY (the worker alone); what aborts a worker thread's WHOLE process is one large allocation —
  // `new Array(n).fill(…)`, which the bounty plan did for a plugin's minReplacedEnemyCount (now clamped: waves.js,
  // test/match/waves-plugin-bounds.test.js). The default child process aborts alone in either case.
  test('a match host that runs out of memory (a child process): the room is back in its lobby, the server lives', { timeout: 90_000 }, async () => {
    // (the data that once did it — factions.generation.maxLevelCnt 1e9 — is refused by the data check now, PLUGIN_DATA_BOUND,
    // and the type schedule stops at 256 besides: the fixture allocates without end instead, as a bomb past every check would)
    const dir = pluginsDir({ endless: [{ data: ['p.json'] }, { 'p.json': bondPatch(0.36) }] });
    const errors = [];
    const log = { ...quiet, warn: (...a) => errors.push(a.join(' ')), error: (...a) => errors.push(a.map(String).join(' ')) };
    const srv = await startServer({ port: 0, host: '127.0.0.1', log, pluginsDir: dir, assetIndex: false,
      matchHost: { transport: 'process', matchModule: FIXTURE, watchdogMs: 4000, resourceLimits: { maxOldGenerationSizeMb: 160, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 } } });
    servers.push(srv);
    const host = await player(srv, 'Doctor');
    await moddedRoom(srv, host, 'endless');
    await ok(host, { t: 'room.start' }, START_MS);
    await host.waitFor('room.state', (s) => s.inMatch === true, START_MS);
    await host.request({ t: 'g.emote', id: EMOTES[3] }).catch(() => null);
    const toast = await host.waitFor('m.toast', (m) => [HANG, CRASH, START].includes(m.msgid), 60_000);
    assert.equal(toast.kind, 'error');
    await host.waitFor('room.state', (s) => s.inMatch === false, 10_000);
    assert.ok(errors.some((l) => /match host \[cs:/.test(l)), `the log names the set: ${errors.slice(0, 3).join(' | ')}`);
    assert.equal(srv.hosts.stats().workers, 0);
  });

  test('SP_VERIFY=all in its match host: a result naming the room\'s content is verified and accepted; one naming none is refused and run by the server', { timeout: 150_000 }, async () => {
    const dir = pluginsDir({ rules: [{ data: ['p.json'] }, { 'p.json': bondPatch(0.36) }] });
    const errors = [];
    const log = { ...quiet, error: (...a) => errors.push(a.map(String).join(' ')) };
    const srv = await startServer({ port: 0, host: '127.0.0.1', log, pluginsDir: dir, assetIndex: false, seedFn: () => 20261013,
      matchHost: { matchOptions: { timerScale: 0.1, combatSpeed: 40, verify: 'all', botRehearsal: 0 } } });
    servers.push(srv);
    const a = await player(srv, 'Alpha');
    const b = await player(srv, 'Bravo');
    await ok(a, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    const s0 = await a.waitFor('room.state');
    await ok(b, { t: 'room.join', code: s0.code });
    await ok(a, { t: 'room.addBot' });
    await ok(a, { t: 'room.setPlugins', plugins: [{ id: 'rules' }] }, START_MS);
    const st = await a.waitFor('room.state', (s) => s.content?.vanilla === false, START_MS);
    const cs = st.content.cs;
    // both pages simulate on the content set's data (what /cs/<cs16>/ serves): Alpha names it in b.result, Bravo not
    const ds = new DataSource(srv.contents.dataOf(cs), null);
    assert.equal(srv.contents.dataOf(cs).bonds.deputShip.bb.base_def, 0.36);
    a.sim = attachWsSimClient(a, { ds, pace: 'instant', speed: 40, withCs: true });
    b.sim = attachWsSimClient(b, { ds, pace: 'instant', speed: 40 });
    for (const c of [a, b]) await ok(c, { t: 'room.contentReady', cs }, START_MS);
    await ok(b, { t: 'room.ready', ready: true });
    await ok(a, { t: 'room.start' }, START_MS);
    const latest = (c, type) => { for (let i = c.log.length - 1; i >= 0; i--) if (c.log[i].t === type) return c.log[i]; return null; };
    const reached = (c) => { const p = latest(c, 'm.public'); return !!p && ((p.phase === 'PREP' && p.round >= 3) || p.phase === 'RESULT' || p.round > 3); };
    await Promise.all([drive(a, () => reached(a)), drive(b, () => reached(b))]);
    const room = srv.lobby.getRoom(s0.code);
    const d = await room.match.diag();
    assert.equal(d.errorCount, 0, `engine errors: ${JSON.stringify(d.errors)}`);
    assert.ok(d.verifyStats.checked >= 1, `the worker re-simulated Alpha's results: ${JSON.stringify(d.verifyStats)}`);
    assert.equal(d.verifyStats.mismatches, 0, 'the same content set: the same results');
    assert.ok(d.verifyStats.rejected >= 1, `Bravo's results named no content: refused (${JSON.stringify(d.verifyStats)})`);
    const sentA = a.sim.log.filter((x) => x.t === 'b.result');
    const sentB = b.sim.log.filter((x) => x.t === 'b.result');
    assert.ok(sentA.length >= 1 && sentA.every((x) => x.cs === cs), 'Alpha named the room\'s content');
    assert.ok(sentB.length >= 1 && sentB.every((x) => x.cs === undefined));
    assert.deepEqual(errors, [], 'no server error logged');

    async function drive(c, until) {
      const done = new Set();
      const deadline = Date.now() + 120_000;
      while (!until() && Date.now() < deadline) {
        await delay(25);
        const pub = latest(c, 'm.public');
        const priv = latest(c, 'm.private');
        if (!pub) continue;
        if (pub.phase === 'INFO_CHECK' && !done.has('info')) { done.add('info'); await c.request({ t: 'g.infoReady' }); }
        else if (pub.phase === 'BAND_DRAFT' && pub.draft && pub.draft.turn === c.id && !done.has(`band:${pub.draft.order.join()}`)) {
          done.add(`band:${pub.draft.order.join()}`);
          const taken = new Set(Object.values(pub.draft.picks || {}));
          const band = Object.values(getData().bands).find((x) => (!Array.isArray(x.modeTypeList) || x.modeTypeList.includes('MULTI')) && !taken.has(x.bandId));
          await c.request({ t: 'g.band', bandId: band.bandId });
        } else if (pub.phase === 'SP_DRAFT' && pub.sp && pub.sp.turn === c.id && !done.has(`sp:${pub.round}`)) {
          done.add(`sp:${pub.round}`);
          const card = pub.sp.cards.find((x) => pub.sp.taken[x.idx] == null);
          if (card) await c.request({ t: 'g.choice', idx: card.idx });
        } else if (pub.phase === 'PREP' && priv && !priv.ready && !done.has(`prep:${pub.round}`)) {
          done.add(`prep:${pub.round}`);
          await prep(c, () => latest(c, 'm.private'));
        }
      }
      assert.ok(until(), `${c.id} reached round 3 (${latest(c, 'm.public')?.phase} R${latest(c, 'm.public')?.round})`);
    }
  });
});

/** Board tiles of the own region (the server refuses illegal ones). */
const TILES = [];
for (let r = 12; r >= 9; r--) for (let c = 2; c <= 10; c++) TILES.push([r, c]);

/** A prep like a player's: buy what is affordable, place it, clear the temp slots, ready (test/match/realtime.test.js). */
async function prep(c, priv) {
  if (priv().shop.rewardOffer) await c.request({ t: 'g.reward', idx: 0 });
  for (let guard = 0; guard < 6; guard++) {
    const p = priv();
    const i = p.shop.slots.findIndex((s) => s && !s.sold && s.kind === 'chess' && s.price <= p.funds);
    if (i < 0 || p.hand.every(Boolean)) break;
    if ((await c.request({ t: 'g.buy', slot: i })).t !== 'ok') break;
    await c.waitFor('m.private', (x) => x.shop.slots[i] && x.shop.slots[i].sold, 2000).catch(() => null);
  }
  for (let guard = 0; guard < 8; guard++) {
    const p = priv();
    if (p.deployCount >= p.deployCap) break;
    const piece = [...p.hand, ...p.temp].find((x) => x && x.kind === 'chess');
    if (!piece) break;
    const taken = new Set(p.board.map((x) => `${x.row},${x.col}`));
    let placed = false;
    for (const [r, col] of TILES) {
      if (taken.has(`${r},${col}`)) continue;
      const res = await c.request({ t: 'g.move', uid: piece.uid, to: { area: 'board', row: r, col } });
      if (res.t === 'ok') { placed = true; break; }
    }
    if (!placed) break;
    await c.waitFor('m.private', (x) => x.board.some((b) => b.uid === piece.uid), 2000).catch(() => null);
  }
  for (const t of priv().temp) {
    if (!t) continue;
    if (t.kind === 'chess') await c.request({ t: 'g.sell', uid: t.uid });
    else if (t.kind === 'item') await c.request({ t: 'g.destroy', uid: t.uid });
  }
  await c.request({ t: 'g.ready', ready: true });
}
