import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { Match } from '../server/match/Match.js';
import { wireOptions, MatchProxy } from '../server/match/host/proxy.js';
import { TestClient } from './helpers/wsClient.js';
import { validateC2S } from '../shared/protocol.js';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';

async function roomFixture(t, { trust, verify, server = startServer, options = {} } = {}) {
  const previous = { SP_TRUST: process.env.SP_TRUST, SP_VERIFY: process.env.SP_VERIFY };
  for (const [key, value] of Object.entries({ SP_TRUST: trust, SP_VERIFY: verify })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  const starts = [], clients = [];
  class CaptureMatch extends StubMatch { constructor(opts) { super(opts); starts.push(opts); } }
  const srv = await server({ port: 0, host: '127.0.0.1', quiet: true, MatchClass: CaptureMatch, ...options });
  t.after(async () => {
    await Promise.all(clients.map((c) => c.terminate()));
    await srv.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const ok = async (c, msg) => assert.equal((await c.request(msg)).t, 'ok');
  const player = async (name) => {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    clients.push(c);
    c.welcome = await c.hello(name);
    c.id = c.welcome.playerId;
    return c;
  };
  const host = await player('Host');
  await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  const state = await host.waitFor('room.state');
  const guest = await player('Guest');
  await ok(guest, { t: 'room.join', code: state.code });
  const room = srv.lobby.rooms.get(state.code);
  const start = async () => {
    await ok(guest, { t: 'room.ready', ready: true });
    await ok(host, { t: 'room.start' });
    const opts = starts.at(-1);
    const match = new Match({ ...opts, send: () => true, broadcast() {}, onEnd() {} });
    const policy = { level: match.trustLevel, verify: match.verifyMode, explicit: match.trustExplicit };
    match.dispose();
    return { opts, policy, finish: () => opts.onEnd({ reason: 'test' }) };
  };
  return { srv, host, guest, room, state, ok, player, start };
}

for (const trust of [undefined, '', 'unsupported']) {
  test(`SP_TRUST=${JSON.stringify(trust)} keeps legacy sample rooms and host handling unchanged`, { timeout: 15000 }, async (t) => {
    const { srv, host, guest, room, state, start } = await roomFixture(t, { trust, verify: 'sample' });
    assert.equal(Object.hasOwn(state, 'trustAudit'), false);
    assert.equal(Object.hasOwn(room.toState(), 'trustAudit'), false);
    assert.equal(Object.keys(host.welcome).some((key) => /trust/i.test(key)), false);
    assert.equal((await host.request({ t: 'room.setTrustAudit', on: true, ack: true })).code, 'BAD_MSG');
    assert.equal(Object.hasOwn(room, 'trustAudit'), false);
    const first = await start();
    assert.deepEqual(first.policy, { level: 'L0', verify: 'sample', explicit: false });
    assert.equal(first.opts.onTrustDispute, undefined);
    assert.equal(first.opts.trust, undefined);
    first.finish();
    // Even retained evidence cannot opt a deployment into adaptive policy.
    srv.registry.byId(guest.id).trustDisputes = 1;
    assert.equal(srv.lobby.matchTrust(room), null);
    const later = await start();
    assert.deepEqual(later.policy, first.policy);
    later.finish();
    assert.equal(Object.hasOwn(room.toState(), 'trustAudit'), false);
  });
}

for (const trust of ['L0', 'L1', 'L2']) {
  test(`explicit ${trust} enables acknowledged host audit and private session elevation`, { timeout: 15000 }, async (t) => {
    const { srv, host, guest, room, state, ok, player, start } = await roomFixture(t, { trust, verify: 'all' });
    assert.equal(state.trustAudit, false);
    const initial = await start();
    assert.deepEqual(initial.policy, { level: trust, verify: trust === 'L2' ? 'sample' : 'off', explicit: true });
    initial.finish();
    assert.equal((await host.request({ t: 'room.setTrustAudit', on: true })).code, 'BAD_MSG');
    assert.equal(room.trustAudit, false);
    assert.equal((await guest.request({ t: 'room.setTrustAudit', on: true, ack: true })).code, 'NOT_HOST');
    await ok(host, { t: 'room.setTrustAudit', on: true, ack: true });
    assert.equal(room.toState().trustAudit, true);
    const audited = await start();
    assert.deepEqual(audited.policy, { level: 'L2', verify: 'sample', explicit: true });
    assert.equal(wireOptions(audited.opts).trust, 'L2');
    assert.equal((await host.request({ t: 'room.setTrustAudit', on: false })).code, 'ROOM_STARTED');
    audited.finish();
    await ok(host, { t: 'room.setTrustAudit', on: false });
    const disabled = await start();
    assert.deepEqual(disabled.policy, initial.policy);
    disabled.opts.onTrustDispute('foreign');
    disabled.opts.onTrustDispute(guest.id);
    disabled.finish();
    const adaptive = await start();
    assert.equal(adaptive.policy.level, 'L2');
    adaptive.finish();
    assert.equal(srv.registry.byId(guest.id).trustDisputes, 1);
    assert.equal(JSON.stringify(room.toState()).includes('trustDisputes'), false);
    await ok(host, { t: 'room.setTrustAudit', on: true, ack: true });
    await ok(host, { t: 'room.leave' });
    assert.equal(room.hostId, guest.id);
    assert.equal(room.trustAudit, true);
    await ok(guest, { t: 'room.leave' });
    await ok(guest, { t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
    const nextRoom = srv.lobby.roomOf(srv.registry.byId(guest.id));
    assert.equal(nextRoom.trustAudit, false);
    assert.equal(srv.lobby.matchTrust(nextRoom), 'L2', 'confirmed evidence follows the session');
    const fresh = await player('Fresh');
    await ok(fresh, { t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
    assert.equal(srv.lobby.matchTrust(srv.lobby.roomOf(srv.registry.byId(fresh.id))), trust);
    t.diagnostic(`TRUST_MEASUREMENT ${JSON.stringify({ initial: initial.policy, audited: audited.policy, adaptive: adaptive.policy })}`);
  });
}

for (const trustOption of ['', 'unsupported', 'L0', 'L1']) {
  test(`Lobby trust option ${JSON.stringify(trustOption)} overrides ambient L2 through Match construction`, { timeout: 15000 }, async (t) => {
    const { state, start } = await roomFixture(t, { trust: 'L2', verify: 'all', options: { trust: trustOption } });
    const explicit = trustOption === 'L0' || trustOption === 'L1';
    assert.equal(Object.hasOwn(state, 'trustAudit'), explicit);
    const match = await start();
    assert.deepEqual(match.policy, { level: explicit ? trustOption : 'L0', verify: explicit ? 'off' : 'all', explicit });
    assert.equal(match.opts.trust, explicit ? trustOption : '');
    match.finish();
  });
}

test('explicit empty trust options pin legacy Lobby and Match behavior under ambient L2', { timeout: 15000 }, async (t) => {
  const { srv, guest, room, state, start } = await roomFixture(t, { trust: 'L2', verify: 'sample', options: { trust: '' } });
  assert.equal(Object.hasOwn(state, 'trustAudit'), false);
  const first = await start();
  assert.deepEqual(first.policy, { level: 'L0', verify: 'sample', explicit: false });
  assert.equal(first.opts.onTrustDispute, undefined);
  first.finish();
  srv.registry.byId(guest.id).trustDisputes = 1;
  const later = await start();
  assert.deepEqual(later.policy, first.policy);
  later.finish();
  assert.equal(Object.hasOwn(room.toState(), 'trustAudit'), false);
  const direct = new Lobby({ registry: new SessionRegistry(), trust: '' });
  t.after(() => direct.shutdown());
  assert.equal(direct.trustPolicy.explicit, false);
});

test('protocol bounds peer replies; isolated hosts forward only bounded confirmed evidence', () => {
  assert.equal(validateC2S({ t: 'room.setTrustAudit', on: true, ack: false }), 'bad field ack');
  assert.equal(validateC2S({ t: 'b.verifyResult', taskId: 'a', error: true }), null);
  assert.equal(validateC2S({ t: 'b.verifyResult', taskId: 'a', digest: 'x'.repeat(65) }), 'bad field digest');
  const confirmed = [];
  const proxy = new MatchProxy({ host: { post() {} }, matchId: 'one', opts: { onTrustDispute: (id) => confirmed.push(id) } });
  proxy.deliver({ type: 'trust-confirmed', matchId: 'other', playerId: 'p_0' });
  proxy.deliver({ type: 'trust-confirmed', matchId: 'one', playerId: 'x'.repeat(129) });
  assert.deepEqual(confirmed, []);
  proxy.deliver({ type: 'trust-confirmed', matchId: 'one', playerId: 'p_0' });
  assert.deepEqual(confirmed, ['p_0']);
  proxy.dispose();
  proxy.deliver({ type: 'trust-confirmed', matchId: 'one', playerId: 'p_1' });
  assert.deepEqual(confirmed, ['p_0']);
});
