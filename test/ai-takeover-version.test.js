// AI handover in a room of a non-default official version. The match runs in a real version host
// (process transport). test/ai-takeover.test.js stays the in-process 第二期下半 contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';

const VERSION = 'act1autochess';
const SLOW = 20000;

test.describe('AI handover in an official version host', { concurrency: 1 }, () => {
  /** @type {Awaited<ReturnType<typeof startServer>> | null} */
  let srv = null;
  const clients = [];

  test.before(async () => {
    srv = await startServer({
      port: 0, host: '127.0.0.1', quiet: true,
      versions: { enabled: ['act2autochess', VERSION] },
      matchHost: { transport: 'process', matchOptions: { botRehearsal: 0, botRehearsalDelegate: false } },
    });
    srv.lobby.testMode = 'local';
    srv.lobby.setTestHost('127.0.0.1');
  });

  test.after(async () => {
    for (const c of clients) await c.terminate().catch(() => {});
    if (srv) await srv.close();
    srv = null;
  });

  async function player(name, token) {
    const c = await TestClient.connect(srv.url.replace('http', 'ws') + '/ws');
    clients.push(c);
    const w = await c.hello(name, token);
    c.id = w.playerId;
    c.token = w.token;
    return c;
  }

  async function openPrep() {
    const host = await player('Host');
    const created = await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL', version: VERSION, test: true });
    assert.equal(created.t, 'ok', JSON.stringify(created));
    const room = [...srv.lobby.rooms.values()].find((r) => r.hostId === host.id);
    assert.ok(room);
    const opted = await host.request({ t: 'room.setAiTakeover', on: true });
    assert.equal(opted.t, 'ok', JSON.stringify(opted));
    assert.equal(room.aiTakeoverEnabled, true);
    assert.equal(room.toState().aiTakeoverEnabled, true);
    const mate = await player('Mate');
    assert.equal((await mate.request({ t: 'room.join', code: room.code, testAck: true })).t, 'ok');
    const cs = room.content.cs;
    assert.equal((await host.request({ t: 'room.contentReady', cs })).t, 'ok');
    assert.equal((await mate.request({ t: 'room.contentReady', cs })).t, 'ok');
    assert.equal((await mate.request({ t: 'room.ready', ready: true })).t, 'ok');
    assert.equal((await host.request({ t: 'room.addBot' })).t, 'ok');
    assert.equal((await host.request({ t: 'room.addBot' })).t, 'ok');
    assert.equal((await host.request({ t: 'room.start' })).t, 'ok');
    assert.equal(room.match?.hosted, true);
    assert.equal(room.match.host.kind, 'version');
    assert.equal(room.version, VERSION);
    const late = await player('Late');
    assert.equal((await late.request({ t: 'room.spectate', code: room.code, testAck: true })).t, 'ok');
    const timers = await host.request({ t: 'g.test', cmd: 'timers', args: { on: false } }, 90000);
    assert.equal(timers.t, 'ok', JSON.stringify(timers));
    assert.equal((await host.request({ t: 'g.infoReady' }, SLOW)).t, 'ok');
    assert.equal((await mate.request({ t: 'g.infoReady' }, SLOW)).t, 'ok');
    await host.waitFor('m.public', (m) => m.phase === 'BAND_DRAFT', SLOW);
    assert.equal((await host.request({ t: 'g.test', cmd: 'phase', args: { name: 'battleCheck' } }, SLOW)).t, 'ok');
    assert.equal((await host.request({ t: 'g.test', cmd: 'phase', args: { name: 'advance' } }, SLOW)).t, 'ok');
    const prep = await host.request({ t: 'g.test', cmd: 'phase', args: { name: 'prep' } }, SLOW);
    assert.equal(prep.t, 'ok', JSON.stringify(prep));
    await host.waitFor('m.public', (m) => m.phase === 'PREP', SLOW);
    return { host, mate, late, room };
  }

  async function botInventory(room) {
    const view = await room.match.aiHandoverView();
    assert.equal(view?.ok, true, JSON.stringify(view));
    assert.equal(view.phase, 'PREP');
    const bot = view.players.find((p) => p.isBot && p.alive && !p.left && p.pieceUids.length + p.funds > 0);
    assert.ok(bot, JSON.stringify(view.players));
    return { view, bot };
  }

  function pieceKey(ids) {
    return [...ids].sort().join(',');
  }

  async function settledBot(room, host) {
    const first = await botInventory(room);
    await host.waitFor('m.public', (m) => m.phase === 'PREP' && m.players.some((p) => p.isBot && p.ready), 30000);
    const done = await botInventory(room);
    const bot = done.view.players.find((p) => p.playerId === first.bot.playerId);
    assert.ok(bot.funds !== first.bot.funds || pieceKey(bot.pieceUids) !== pieceKey(first.bot.pieceUids),
      `prep left the starting inventory ${JSON.stringify(first.bot)} -> ${JSON.stringify(bot)}`);
    return { before: first.bot, bot };
  }

  async function pollClear(room) {
    for (let i = 0; i < 100 && room.aiTakeoverVotes.length; i++) await new Promise((r) => setTimeout(r, 30));
    assert.equal(room.aiTakeoverVotes.length, 0);
  }

  test('opt-in, strict majority, and handover keep inventory, identity and reconnect token', { timeout: 180000 }, async () => {
    const { host, mate, late, room } = await openPrep();
    const { before, bot } = await settledBot(room, host);
    assert.ok(bot.funds !== before.funds || pieceKey(bot.pieceUids) !== pieceKey(before.pieceUids));
    const old = late.id;
    const token = late.token;
    assert.equal((await late.request({ t: 'room.aiRequest', botId: bot.playerId }, SLOW)).t, 'ok');
    const vote = room.aiTakeoverVotes[0];
    assert.equal(vote.eligible.length, 2);
    assert.equal((await host.request({ t: 'room.aiVote', voteId: vote.id, approve: true }, SLOW)).t, 'ok');
    const mid = await room.match.aiHandoverView();
    assert.equal(mid.players.find((p) => p.playerId === bot.playerId).isBot, true, 'one yes is not a strict majority');
    late.clearInbox();
    const passed = await mate.request({ t: 'room.aiVote', voteId: vote.id, approve: true }, SLOW);
    assert.equal(passed.t, 'ok', JSON.stringify(passed));
    const welcome = await late.waitFor('welcome', (w) => w.playerId === bot.playerId, SLOW);
    assert.equal(welcome.takeoverFrom, old);
    const priv = await late.waitFor('m.private', (m) => m.playerId === bot.playerId && !m.isBot, SLOW);
    const uids = [];
    for (const piece of priv.hand || []) if (piece?.uid) uids.push(piece.uid);
    for (const piece of priv.board || []) if (piece?.uid) uids.push(piece.uid);
    assert.equal(priv.funds, bot.funds);
    assert.equal(pieceKey(uids), pieceKey(bot.pieceUids));
    assert.equal(room.spectatorOf(old), null);
    assert.equal(srv.registry.byId(old), null);
    assert.equal(srv.registry.byToken(token).playerId, bot.playerId);
    const after = await room.match.aiHandoverView();
    const inherited = after.players.find((p) => p.playerId === bot.playerId);
    assert.equal(inherited.isBot, false);
    assert.equal(inherited.funds, bot.funds);
    assert.equal(pieceKey(inherited.pieceUids), pieceKey(bot.pieceUids));
    const acted = await late.request({ t: 'g.freeze' }, SLOW);
    assert.equal(acted.t, 'ok', JSON.stringify(acted));
    await late.terminate();
    const resumed = await player('Late', token);
    assert.equal(resumed.id, bot.playerId);
  });

  test('reject majority leaves the AI seat in place', { timeout: 180000 }, async () => {
    const { host, mate, late, room } = await openPrep();
    const { bot } = await botInventory(room);
    assert.equal((await late.request({ t: 'room.aiRequest', botId: bot.playerId }, SLOW)).t, 'ok');
    const vote = room.aiTakeoverVotes[0];
    assert.equal((await host.request({ t: 'room.aiVote', voteId: vote.id, approve: false }, SLOW)).t, 'ok');
    assert.equal(room.aiTakeoverVotes.length, 1);
    assert.equal((await mate.request({ t: 'room.aiVote', voteId: vote.id, approve: false }, SLOW)).t, 'ok');
    assert.equal(room.aiTakeoverVotes.length, 0);
    const after = await room.match.aiHandoverView();
    assert.equal(after.players.find((p) => p.playerId === bot.playerId).isBot, true);
    assert.equal((await host.request({ t: 'room.aiVote', voteId: vote.id, approve: true }, SLOW)).t, 'error');
  });

  test('applicant leaving cancels the pending vote', { timeout: 180000 }, async () => {
    const { late, room } = await openPrep();
    const { bot } = await botInventory(room);
    assert.equal((await late.request({ t: 'room.aiRequest', botId: bot.playerId }, SLOW)).t, 'ok');
    assert.equal((await late.request({ t: 'room.leave' }, SLOW)).t, 'ok');
    await pollClear(room);
    const after = await room.match.aiHandoverView();
    assert.equal(after.players.find((p) => p.playerId === bot.playerId).isBot, true);
  });

  test('a voter disconnect cancels the pending vote', { timeout: 180000 }, async () => {
    const { host, mate, late, room } = await openPrep();
    const { bot } = await botInventory(room);
    assert.equal((await late.request({ t: 'room.aiRequest', botId: bot.playerId }, SLOW)).t, 'ok');
    assert.equal((await host.request({ t: 'room.aiVote', voteId: room.aiTakeoverVotes[0].id, approve: true }, SLOW)).t, 'ok');
    await mate.terminate();
    await pollClear(room);
    const after = await room.match.aiHandoverView();
    assert.equal(after.players.find((p) => p.playerId === bot.playerId).isBot, true);
  });

  test('a phase change cancels the pending vote', { timeout: 180000 }, async () => {
    const { host, late, room } = await openPrep();
    const { bot } = await botInventory(room);
    assert.equal((await late.request({ t: 'room.aiRequest', botId: bot.playerId }, SLOW)).t, 'ok');
    const combat = await host.request({ t: 'g.test', cmd: 'phase', args: { name: 'combat' } }, SLOW);
    assert.equal(combat.t, 'ok', JSON.stringify(combat));
    await pollClear(room);
    const after = await room.match.aiHandoverView();
    assert.notEqual(after.phase, 'PREP');
    assert.equal(after.players.find((p) => p.playerId === bot.playerId).isBot, true);
  });

  test('a host crash during a pending vote returns the room to the lobby and clears the vote', { timeout: 180000 }, async () => {
    const { late, room } = await openPrep();
    const { bot } = await botInventory(room);
    assert.equal((await late.request({ t: 'room.aiRequest', botId: bot.playerId }, SLOW)).t, 'ok');
    assert.equal(room.aiTakeoverVotes.length, 1);
    const child = room.match.host.child;
    assert.ok(child?.pid);
    child.kill('SIGKILL');
    for (let i = 0; i < 100 && (room.match || room.aiTakeoverVotes.length); i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(room.match, null);
    assert.equal(room.aiTakeoverVotes.length, 0);
    assert.equal(room.toState().inMatch, false);
  });
});
