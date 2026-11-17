import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { Match } from '../server/match/Match.js';
import { TestClient } from './helpers/wsClient.js';

test('startServer submits real bot prep to its public pool and accepts the worker result', { timeout: 30000 }, async () => {
  const previous = process.env.SP_WORKERS;
  process.env.SP_WORKERS = '1';
  let match, client, srv;
  class OpeningMatch extends Match {
    constructor(opts) { super({ ...opts, timerScale: 0.1, botRehearsal: 3, botRehearsalDelegate: false }); match = this; }
  }
  try {
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false, studio: false,
      MatchClass: OpeningMatch, seedFn: () => 69 });
    assert.equal(srv.simPool.stats().submitted, 0);
    client = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    const welcome = await client.hello('PoolTest');
    const request = async (msg) => assert.equal((await client.request(msg)).t, 'ok', msg.t);
    await request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    for (let i = 0; i < 3; i++) await request({ t: 'room.addBot' });
    await request({ t: 'room.start' });
    await client.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
    assert.equal(match.simPool, srv.simPool, 'the production wrapper is what Match submits through');
    await request({ t: 'g.infoReady' });
    const draft = await client.waitFor('m.public', (p) => p.phase === 'BAND_DRAFT' && p.draft.turn === welcome.playerId, 10000);
    const taken = new Set(Object.values(draft.draft.picks));
    await request({ t: 'g.band', bandId: match.gd.bandIds().find((id) => !taken.has(id)) });
    await client.waitFor('m.public', (p) => p.phase === 'PREP' && p.players.filter((ps) => ps.isBot).every((ps) => ps.ready), 15000);
    assert.ok(srv.simPool.stats().submitted > 0);
    assert.ok(srv.simPool.stats().completed > 0);
    assert.ok(match.rehearsalPoolStats.accepted > 0);
    assert.equal(match.rehearsalPoolStats.fallbacks, 0);
    assert.equal(match.errorCount, 0);
    assert.equal(srv.simPool.stats().rooms, 0, 'settled jobs release the room bookkeeping');
  } finally {
    await client?.terminate();
    await srv?.close();
    if (previous === undefined) delete process.env.SP_WORKERS; else process.env.SP_WORKERS = previous;
  }
});
