import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeError } from '../../public/js/ui/toasts.js';
import { startServer } from '../../server/index.js';
import { TestClient } from '../helpers/wsClient.js';
import { ERR } from '../../shared/constants.js';

const ok = async (c, msg) => {
  const r = await c.request(msg);
  assert.equal(r.t, 'ok', JSON.stringify(r));
};
const err = async (c, msg, code) => {
  const r = await c.request(msg);
  assert.equal(r.t, 'error', JSON.stringify(r));
  assert.equal(r.code, code, JSON.stringify(r));
};
const setupOf = (pub) => ({ stageId: pub.stageId, bossId: pub.bossId, hiddenBossId: pub.hiddenBossId,
  factions: pub.factions, disabledBonds: pub.disabledBonds, bannedChess: pub.bannedChess, setupRevision: pub.setupRevision });

test('real four-player sockets: any seat proposes, unanimous sync, reconnect and stale requests', { timeout: 15000 }, async (t) => {
  const errors = [];
  const srv = await startServer({ port: 0, host: '127.0.0.1', seedFn: () => 123,
    log: { info() {}, warn() {}, debug() {}, error: (...args) => errors.push(args.map(String).join(' ')) } });
  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map((c) => c.terminate()));
    await srv.close();
    assert.deepEqual(errors, []);
  });
  const player = async (name, token) => {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    clients.push(c);
    const w = await c.hello(name, token);
    c.id = w.playerId;
    c.token = w.token;
    return c;
  };
  const host = await player('Host');
  await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'HARD' });
  const room = await host.waitFor('room.state');
  const guests = [];
  for (let i = 0; i < 3; i++) {
    const c = await player(`Guest${i}`);
    guests.push(c);
    await ok(c, { t: 'room.join', code: room.code });
    await ok(c, { t: 'room.ready', ready: true });
  }
  const spectator = await player('Viewer');
  await ok(spectator, { t: 'room.spectate', code: room.code });
  await ok(host, { t: 'room.start' });
  const initial = await host.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
  const m = srv.lobby.rooms.get(room.code).match;
  await ok(guests[0], { t: 'g.infoReady', setupRevision: 0 });
  await ok(guests[0], { t: 'room.rerollSetup', setupRevision: 0 }); // any seated player may open the vote
  await err(spectator, { t: 'room.rerollSetup', setupRevision: 0 }, ERR.SPECTATOR);
  const voting = await host.waitFor('m.public', (p) => !!p.rerollVote);
  await err(host, { t: 'room.rerollSetup', setupRevision: 0 }, ERR.WRONG_PHASE);
  assert.equal(voting.deadline, 0);
  assert.equal(voting.rerollVote.voters.length, 4);
  assert.deepEqual(voting.rerollVote.agreed, [guests[0].id]);
  const voteId = voting.rerollVote.id;
  await err(spectator, { t: 'g.rerollVote', voteId, agree: true }, ERR.SPECTATOR);
  await ok(guests[0], { t: 'g.rerollVote', voteId, agree: true });
  await ok(guests[1], { t: 'g.rerollVote', voteId, agree: true });
  assert.equal(m.setupRevision, 0, '2/4 agrees never refreshes');
  await ok(guests[2], { t: 'g.rerollVote', voteId, agree: true });
  assert.equal(m.setupRevision, 0, '3/4 agrees never refreshes');
  await ok(host, { t: 'g.rerollVote', voteId, agree: true }); // the proposer already agreed, the host is still owed
  const all = [host, ...guests, spectator];
  const fresh = await Promise.all(all.map((c) => c.waitFor('m.public', (p) => p.setupRevision === 1)));
  for (const p of fresh) {
    assert.deepEqual(setupOf(p), setupOf(fresh[0]));
    assert.equal(p.deadline, fresh[0].deadline, 'all players share the same new deadline');
    assert.equal(Math.ceil((p.deadline - p.serverNow) / 1000), 25, 'each player sees a fresh 25-second countdown');
    assert.equal(p.rerollVote, null);
    assert.ok(p.players.every((ps) => !ps.ready));
  }
  assert.notDeepEqual(setupOf(fresh[0]), { ...setupOf(initial), setupRevision: 1 });
  assert.equal(srv.lobby.rooms.get(room.code).match, m, 'room/match instance and sockets retained');
  assert.ok(all.every((c) => c.isOpen));
  await err(guests[0], { t: 'g.infoReady', setupRevision: 0 }, ERR.BAD_TARGET);
  await err(guests[0], { t: 'g.infoReady' }, ERR.BAD_TARGET);
  await err(host, { t: 'room.rerollSetup', setupRevision: 0 }, ERR.BAD_TARGET);
  // A completed reroll opens a fresh 30 s window: any seat may start again, and any seat may cancel it.
  await ok(host, { t: 'room.rerollSetup', setupRevision: 1 });
  const again = await host.waitFor('m.public', (p) => p.rerollVote && p.rerollVote.id > voteId);
  await ok(guests[1], { t: 'room.cancelReroll', voteId: again.rerollVote.id });
  await host.waitFor('m.public', (p) => !p.rerollVote && p.deadline > 0);
  // the cancelled vote keeps the cooldown; the toast names that limit, not the generic RATE text (PR #860 review)
  const cooled = await host.request({ t: 'room.rerollSetup', setupRevision: 1 });
  assert.deepEqual([cooled.t, cooled.code, cooled.detail], ['error', ERR.RATE, 'setup reroll cooldown']);
  assert.equal(describeError(cooled), '每人 30 秒内只能发起一次重刷投票');
  assert.equal(describeError({ code: ERR.RATE }), '操作过于频繁', 'other RATE refusals keep the generic text');
  // Disconnect/reconnect retains this room and returns the current full setup.
  const guest = guests[2];
  await guest.terminate();
  await host.waitFor('m.public', (p) => p.setupRevision === 1 && p.players.some((ps) => ps.playerId === guest.id && !ps.connected));
  const resumed = await player('Guest2', guest.token);
  assert.equal(resumed.id, guest.id);
  assert.deepEqual(setupOf(await resumed.waitFor('m.public', (p) => p.setupRevision === 1)), setupOf(fresh[0]));
  const restoredRoom = await resumed.waitFor('room.state');
  assert.equal(restoredRoom.code, room.code);
  for (const c of [host, guests[0], guests[1], resumed]) await ok(c, { t: 'g.infoReady', setupRevision: 1 });
  await host.waitFor('m.public', (p) => p.phase === 'BAND_DRAFT');
  await err(host, { t: 'room.rerollSetup', setupRevision: 1 }, ERR.WRONG_PHASE);
});

test('real sockets: reject/cancel/disconnect keep the setup and resume the countdown', { timeout: 15000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const clients = [];
  t.after(async () => { await Promise.all(clients.map((c) => c.terminate())); await srv.close(); });
  for (const name of ['Host', 'GuestA', 'GuestB']) {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    clients.push(c);
    await c.hello(name);
  }
  const [host, guestA, guestB] = clients;
  await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  const room = await host.waitFor('room.state');
  for (const c of [guestA, guestB]) {
    await ok(c, { t: 'room.join', code: room.code });
    await ok(c, { t: 'room.ready', ready: true });
  }
  await ok(host, { t: 'room.start' });
  const initial = await host.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
  const m = srv.lobby.rooms.get(room.code).match;
  // Each scenario uses a different starter, because one seat may only start one vote per 30 s.
  const moves = [
    { starter: guestA, finish: 'reject', by: guestB },
    { starter: guestB, finish: 'cancel', by: host },
    { starter: host, finish: 'disconnect', by: guestA },
  ];
  let lastVoteId = 0;
  for (const { starter, finish, by } of moves) {
    await ok(starter, { t: 'room.rerollSetup', setupRevision: 0 });
    // Buffered frames may still carry the previous vote, so wait for a strictly newer one.
    const voting = await starter.waitFor('m.public', (p) => p.rerollVote && p.rerollVote.id > lastVoteId);
    lastVoteId = voting.rerollVote.id;
    if (finish === 'reject') await ok(by, { t: 'g.rerollVote', voteId: voting.rerollVote.id, agree: false });
    if (finish === 'cancel') await ok(by, { t: 'room.cancelReroll', voteId: voting.rerollVote.id });
    if (finish === 'disconnect') await by.terminate();
    await host.waitFor('m.public', (p) => !p.rerollVote && p.deadline > 0);
    assert.equal(m.setupRevision, 0);
    assert.deepEqual(setupOf(m.publicView()), setupOf(initial));
    // A cancelled vote does not give the starter its cooldown back. Connectivity is checked first, so the
    // disconnect scenario reports that instead of the cooldown.
    await err(starter, { t: 'room.rerollSetup', setupRevision: 0 }, finish === 'disconnect' ? ERR.NOT_READY : ERR.RATE);
  }
});

test('real socket, one human: completed rerolls clear the seat cooldown, so the connection heavy bucket throttles them', { timeout: 15000 }, async (t) => {
  const errors = [];
  const srv = await startServer({ port: 0, host: '127.0.0.1', seedFn: () => 123,
    log: { info() {}, warn() {}, debug() {}, error: (...args) => errors.push(args.map(String).join(' ')) } });
  const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
  t.after(async () => {
    await c.terminate();
    await srv.close();
    assert.deepEqual(errors, []);
  });
  await c.hello('Solo');
  await ok(c, { t: 'room.create', mode: 'solo', difficulty: 'HARD' });
  await ok(c, { t: 'room.start' });
  await c.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
  const m = [...srv.lobby.rooms.values()][0].match;
  let revision = 0;
  for (let i = 0; i < 6; i++) await ok(c, { t: 'room.rerollSetup', setupRevision: revision++ }); // the burst (heavyBurst 6)
  assert.equal(m.setupRevision, 6);
  const r = await c.request({ t: 'room.rerollSetup', setupRevision: revision });
  assert.equal(r.code, ERR.RATE, JSON.stringify(r));
  assert.equal(m.setupRevision, 6, 'the refused start rebuilds nothing');
});
