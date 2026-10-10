import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('real four-player sockets: host-only proposal, unanimous sync, reconnect and stale requests', { timeout: 15000 }, async (t) => {
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
  await err(guests[0], { t: 'room.rerollSetup', setupRevision: 0 }, ERR.NOT_HOST);
  await err(spectator, { t: 'room.rerollSetup', setupRevision: 0 }, ERR.SPECTATOR);
  await ok(guests[0], { t: 'g.infoReady', setupRevision: 0 });
  await ok(host, { t: 'room.rerollSetup', setupRevision: 0 });
  const voting = await host.waitFor('m.public', (p) => !!p.rerollVote);
  assert.equal(voting.deadline, 0);
  assert.equal(voting.rerollVote.voters.length, 4);
  assert.deepEqual(voting.rerollVote.agreed, [host.id]);
  const voteId = voting.rerollVote.id;
  await err(spectator, { t: 'g.rerollVote', voteId, agree: true }, ERR.SPECTATOR);
  await err(guests[0], { t: 'room.cancelReroll', voteId }, ERR.NOT_HOST);
  await ok(guests[0], { t: 'g.rerollVote', voteId, agree: true });
  await ok(guests[1], { t: 'g.rerollVote', voteId, agree: true });
  assert.equal(m.setupRevision, 0, '3/4 agrees never refreshes');
  await ok(guests[2], { t: 'g.rerollVote', voteId, agree: true });
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
  for (const name of ['Host', 'Guest']) {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    clients.push(c);
    await c.hello(name);
  }
  const [host, guest] = clients;
  await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  const room = await host.waitFor('room.state');
  await ok(guest, { t: 'room.join', code: room.code });
  await ok(guest, { t: 'room.ready', ready: true });
  await ok(host, { t: 'room.start' });
  const initial = await host.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
  const m = srv.lobby.rooms.get(room.code).match;
  for (const finish of ['reject', 'cancel', 'disconnect']) {
    await new Promise((resolve) => setTimeout(resolve, 310));
    await ok(host, { t: 'room.rerollSetup', setupRevision: 0 });
    const voting = await host.waitFor('m.public', (p) => !!p.rerollVote);
    if (finish === 'reject') await ok(guest, { t: 'g.rerollVote', voteId: voting.rerollVote.id, agree: false });
    if (finish === 'cancel') await ok(host, { t: 'room.cancelReroll', voteId: voting.rerollVote.id });
    if (finish === 'disconnect') await guest.terminate();
    await host.waitFor('m.public', (p) => !p.rerollVote && p.deadline > 0);
    assert.equal(m.setupRevision, 0);
    assert.deepEqual(setupOf(m.publicView()), setupOf(initial));
  }
});
