import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { AI_ACTIONS, aiObservation, validAIReply } from '../../server/match/externalAI.js';
import { buildResult } from '../../server/match/results.js';
import { replayTestMatch, decodeTestTrace } from '../../server/match/testReplay.js';
import { makeMatch, DATA, giveItem, checkInvariants } from './harness.js';
import { FakeBattle } from './fakeBattle.js';
import { exampleServer } from '../../tools/ai/http.mjs';
import { readOfferFile, readOfferCards } from '../../shared/plugins/offers.js';
import { validateC2S } from '../../shared/protocol.js';

const json = x => JSON.parse(JSON.stringify(x));
const pending = m => [...m.externalAI.jobs.values()][0];
const reply = (m, intents, done = false) => m.externalReply(pending(m).id, { v: 'sp-ai/1', id: pending(m).id, intents, done }, false);
function fixture(t, opts = {}) {
  const h = makeMatch({ mode: 'solo', fake: true, botStrategy: 'external', externalReplay: true,
    seats: [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }], ...opts });
  t.after(() => h.m.dispose());
  h.start();
  assert.ok(h.run(() => !!pending(h.m)));
  return h;
}
function prep(t, opts) {
  const h = fixture(t, opts);
  reply(h.m, [{ t: 'g.band', bandId: 'band_bldsk' }], true);
  h.toPrep();
  assert.ok(h.run(() => pending(h.m)?.kind === 'prep'));
  return h;
}

test('reply schema bounds the envelope and batches; malformed individual intents reach rejection', () => {
  const good = { v: 'sp-ai/1', id: 'one', intents: [], done: true };
  assert.ok(validAIReply(good, 'one', 64));
  for (const bad of [null, [], {}, { ...good, v: 'sp-ai/2' }, { ...good, id: 'two' },
    { ...good, extra: 1 }, { ...good, done: 1 }, { ...good, done: false }, { ...good, intents: Array(65).fill({}) }]) {
    assert.equal(validAIReply(bad, 'one', 64), false);
  }
  assert.ok(validAIReply({ ...good, intents: [null, { t: 'g.buy', slot: -1 }] }, 'one', 64));
});

test('observation keys exactly match the seat wire views; no private opponents, seed or RNG', t => {
  const h = makeMatch({ humans: 2, bots: 1, fake: true });
  t.after(() => h.m.dispose());
  h.start().toPrep();
  const { m } = h, ps = m.order[2];
  m.order[0].funds = 123456789;
  const o = aiObservation(m, ps, { id: 'a', kind: 'prep', deadline: 123, remaining: 64 }, []);
  assert.deepEqual(Object.keys(o).sort(), ['context', 'digest', 'id', 'private', 'public', 'results', 'v']);
  assert.deepEqual(o.public, json(m.publicView())); assert.deepEqual(o.private, json(ps.privateView()));
  assert.deepEqual(Object.keys(o.context).sort(), ['deadline', 'kind', 'legalActions', 'phase', 'remaining', 'round']);
  assert.deepEqual(o.context.legalActions, AI_ACTIONS.prep);
  assert.ok(!JSON.stringify(o).includes('123456789'));
  for (const key of ['seed', 'rng', 'rngBots', 'rngMeta', 'rngDraft', 'pool']) assert.ok(!Object.hasOwn(o, key));
  o.private.hand.push({ uid: -100 }); assert.notDeepEqual(o.private.hand, ps.privateView().hand);
});

test('another official version\'s match names it in the observation context (gameVersion, DESIGN §35.23); the default never', t => {
  const h = makeMatch({ humans: 1, bots: 1, fake: true, version: 'act2autochess' });
  t.after(() => h.m.dispose());
  h.start().toPrep();
  assert.equal(h.m.version, null, 'act2autochess is the default: no version');
  const ps = h.m.order[1];
  assert.equal(Object.hasOwn(aiObservation(h.m, ps, { id: 'a', kind: 'prep', deadline: 1, remaining: 64 }, []).context, 'gameVersion'), false);
  h.m.version = 'act1autochess';
  assert.equal(aiObservation(h.m, ps, { id: 'b', kind: 'prep', deadline: 1, remaining: 64 }, []).context.gameVersion, 'act1autochess');
});

test('another official version\'s m.public / m.result name it (`version`, DESIGN §35.23: a replayed result on a fresh page); the default\'s frames never', t => {
  const h = makeMatch({ humans: 1, bots: 1, fake: true });
  t.after(() => h.m.dispose());
  h.start().toPrep();
  const outcome = { victory: false, hiddenReached: false, hiddenCleared: false, reason: 'test' };
  assert.equal(Object.hasOwn(h.m.publicView(), 'version'), false, 'the default\'s m.public is unchanged');
  assert.equal(Object.hasOwn(buildResult(h.m, outcome), 'version'), false, 'the default\'s m.result is unchanged');
  h.m.version = 'act1autochess@V1_1';
  assert.equal(h.m.publicView().version, 'act1autochess@V1_1');
  assert.equal(buildResult(h.m, outcome).version, 'act1autochess@V1_1');
});

test('external intents share human schema, semantic errors, mutation and authorization boundaries', t => {
  const h = prep(t), { m } = h, ps = m.order[0];
  const funds = ps.funds;
  const bad = [{ t: 'g.buy', slot: -1 }, { t: 'g.move', uid: 999999, to: { area: 'hand', slot: 0 } },
    { t: 'g.buy', slot: 15 }, { t: 'g.pause', on: true }, { t: 'g.test', cmd: 'funds', value: 999 }, null];
  const expected = bad.slice(0, 3).map(intent => validateC2S(intent) ? 'BAD_MSG' : m._handleSeatIntent(ps, intent).error);
  reply(m, bad);
  assert.equal(ps.funds, funds); assert.equal(m.paused, false);
  assert.deepEqual(pending(m).state.results, [], 'next observation consumed the previous results');
  // Inspect delivery by using a real observation capture on the next request.
  const results = [];
  const original = m.externalAI.request.bind(m.externalAI);
  m.externalAI.request = job => { results.push(...job.state.results); original(job); };
  reply(m, bad);
  assert.deepEqual(results.slice(0, 3).map(r => r.error), expected);
  assert.deepEqual(results.slice(3).map(r => r.error), ['BAD_MSG', 'BAD_MSG', 'BAD_MSG']);
  assert.deepEqual(m.handle(ps.playerId, { t: 'g.ready', ready: true }), { error: 'NOT_IN_ROOM' });
  const slot = ps.privateView().shop.slots.findIndex(s => s && !s.sold && s.price <= ps.funds);
  assert.ok(slot >= 0);
  reply(m, [{ t: 'g.buy', slot }]);
  assert.ok(ps.shop.slots[slot].sold || ps.funds < funds);
  reply(m, [{ t: 'g.ready', ready: true }], true);
  assert.ok(ps.ready); assert.equal(m.externalAI.states.get(ps.playerId).failures, 0);
  checkInvariants(m);
});

test('a buy shortcut whose slot an earlier refresh of the same reply changed fails as STALE_ACTION; unchanged slots still buy', t => {
  const h = prep(t), { m } = h, ps = m.order[0];
  const results = [], original = m.externalAI.request.bind(m.externalAI);
  m.externalAI.request = job => { results.push(...job.state.results); original(job); };
  ps.funds = 60;
  reply(m, [{ t: 'g.buy', slot: -1 }]); // a fresh observation that sees the funds
  const ids = [...pending(m).actions].filter(([, i]) => i.t === 'g.buy' || i.t === 'g.refresh').map(([id, i]) => ({ id, i }));
  const refresh = ids.find(a => a.i.t === 'g.refresh'), buys = ids.filter(a => a.i.t === 'g.buy');
  assert.ok(refresh && buys.length >= 3);
  const before = buys.map(b => ps.shop.slots[b.i.slot].id);
  results.length = 0;
  reply(m, [refresh.id, ...buys.map(b => b.id)]);
  const after = buys.map(b => ps.shop.slots[b.i.slot]?.id ?? null), got = results.slice(1, 1 + buys.length);
  assert.ok(after.some((id, k) => id !== before[k]), 'the refresh changed at least one slot');
  got.forEach((r, k) => {
    if (after[k] !== before[k]) assert.deepEqual([r.error, r.detail], ['STALE_ACTION', `${buys[k].id} was for ${before[k]}; that slot now holds ${after[k]}`]);
    else assert.notEqual(r.error, 'STALE_ACTION');
  });
  assert.ok(buys.every((b, k) => after[k] === before[k] || !ps.shop.slots[b.i.slot].sold), 'no newcomer bought');
  checkInvariants(m);
});

test('a reward shortcut used twice never buys the next queued offer, even when it shows the same operator', t => {
  const h = prep(t), { m } = h, ps = m.order[0];
  const results = [], original = m.externalAI.request.bind(m.externalAI);
  m.externalAI.request = job => { results.push(...job.state.results); original(job); };
  const ids = ps.shop.slots.filter(x => x && x.kind === 'chess').map(x => x.id).slice(0, 2); // allowed in this match
  ps.pushRewardOffer('merge', { ids });
  ps.pushRewardOffer('merge', { ids });
  reply(m, [{ t: 'g.buy', slot: -1 }]); // an observation that lists the reward
  const [rid] = [...pending(m).actions].find(([, i]) => i.t === 'g.reward' && i.idx === 0);
  results.length = 0;
  reply(m, [rid, rid]);
  assert.equal(results[0].ok, true);
  assert.equal(results[1].error, 'STALE_ACTION');
  assert.match(results[1].detail, /no longer the current one/);
  assert.equal(ps.offers.length, 1, 'the second offer is still queued');
  checkInvariants(m);
});

test('a helper\'s last battle keeps its own wave\'s gates when its 联防 battle starts later', t => {
  const h = prep(t), { m } = h, ps = m.order[0];
  const spawn = (enemyKey, gate) => ({ enemyKey, count: 1, time: 0, preview: { gate } });
  m.externalAI.observe(ps, 'onBattleStart', { kind: 'normal', spawns: [spawn('enemy_1007_slime', 'upper')] });
  m.externalAI.observe(ps, 'onBattleStart', { kind: 'unite', spawns: [spawn('enemy_1007_slime', 'lower')] });
  m.externalAI.observe(ps, 'onBattleResult', { result: { leaked: [{ enemyKey: 'enemy_1007_slime' }], killed: 0, total: 1 }, lpLoss: 1 });
  assert.deepEqual(m.externalAI.battleFor(ps).leaks.map(l => l.gates), [['upper']]);
});

test('the observation carries the round routes and the last own battle (leaks per enemy with gates, unit statistics)', t => {
  const h = prep(t, { script: b => (b.round === 1 && b.kind === 'normal' ? { leaks: { ai_0: 2 } } : {}) }), { m } = h, ps = m.order[0];
  const look = () => aiObservation(m, ps, { id: 'look', kind: 'prep', deadline: 0, remaining: 1 }, []).digest;
  const first = look();
  assert.equal(first.lastBattle, null);
  assert.ok(first.geometry.routes.length > 0);
  for (const r of first.geometry.routes) {
    assert.equal(typeof r.fly, 'boolean');
    assert.ok(r.tiles.every(([row, col]) => row >= first.geometry.rows[0] && row <= first.geometry.rows[1] && col <= first.geometry.cols[1]));
  }
  const slot = ps.privateView().shop.slots.findIndex(s => s && s.kind === 'chess' && !s.sold && s.price <= ps.funds);
  reply(m, [{ t: 'g.buy', slot }]);
  const place = [...pending(m).actions.values()].find(i => i.t === 'g.move' && i.to.area === 'board');
  reply(m, [place, { t: 'g.ready', ready: true }], true);
  assert.ok(h.run(() => m.round === 2 && pending(m)?.kind === 'prep'));
  const b = look().lastBattle;
  assert.deepEqual([b.round, b.lpLoss, b.lp], [1, 2, ps.lp]);
  assert.deepEqual([b.leaks.reduce((n, l) => n + l.count, 0), b.leaks.reduce((n, l) => n + l.counted, 0)], [2, 2]);
  assert.ok(b.leaks.every(l => l.gates.length > 0 && l.name));
  assert.deepEqual(b.units.map(u => [u.uid, u.dmg, u.kills, u.taken, u.heal]), [[place.uid, 100, 1, 10, 0]]);
  assert.ok(b.units[0].name);
  checkInvariants(m);
});

for (const failure of ['timeout', 'transport', 'malformed', 'not-ready', 'intent-cap']) {
  test(`prep ${failure} resumes sliced legacy and reaches Ready`, t => {
    const h = prep(t, { botSliceMs: 0.001, botRehearsal: 1, externalAI: { maxIntents: 2 } }), { m } = h, ps = m.order[0];
    const id = pending(m).id;
    if (failure === 'timeout') assert.ok(h.run(() => !m.externalAI.jobs.size));
    if (failure === 'transport') m.externalReply(id, null, true);
    if (failure === 'malformed') m.externalReply(id, { v: 'bad' }, false);
    if (failure === 'not-ready') reply(m, [], true);
    if (failure === 'intent-cap') reply(m, [{ t: 'g.buy', slot: -1 }, { t: 'g.buy', slot: -1 }]);
    assert.ok(h.run(() => ps.ready));
    assert.ok(ps.deployCount > 0, 'legacy completed shopping and placement');
    assert.equal(m.externalAI.states.get(ps.playerId).failures, 1);
    m.externalReply(id, { v: 'sp-ai/1', id, done: true, intents: [{ t: 'g.sell', uid: ps.allChess()[0]?.uid }] }, false);
    assert.ok(ps.ready); checkInvariants(m); assert.deepEqual(h.logs.error, []);
  });
}

test('three consecutive failures disable only that seat and log once; success resets the streak', t => {
  const h = prep(t), { m } = h, ps = m.order[0];
  const state = m.externalAI.states.get(ps.playerId);
  state.failures = 2;
  reply(m, [{ t: 'g.ready', ready: true }], true);
  assert.equal(state.failures, 0);
  for (let i = 1; i <= 3; i++) {
    ps.ready = false; m.scheduleBotPrep(ps);
    assert.ok(h.run(() => !!pending(m)));
    m.externalReply(pending(m).id, null, true);
    assert.ok(h.run(() => ps.ready));
    assert.equal(state.failures, i);
  }
  assert.equal(state.disabled, true); assert.equal(h.logs.warn.length, 1);
  ps.ready = false; m.scheduleBotPrep(ps); assert.ok(h.run(() => ps.ready));
  assert.equal(m.externalAI.jobs.size, 0); assert.equal(h.logs.warn.length, 1);
});

test('phase deadline bounds the adapter and late replies cannot mutate another phase', t => {
  const h = prep(t), { m } = h, ps = m.order[0];
  m.externalAI.close();
  m.deadline = m.sched.now() + 1000;
  m.scheduleBotPrep(ps);
  assert.ok(h.run(() => !!pending(m)));
  const job = pending(m);
  assert.ok(job.deadline <= m.deadline);
  m.endPrep();
  const funds = ps.funds;
  m.externalReply(job.id, { v: 'sp-ai/1', id: job.id, intents: [{ t: 'g.refresh' }], done: true }, false);
  assert.equal(ps.funds, funds); assert.equal(m.externalAI.jobs.size, 0);
});

test('turn changes and manual takeover invalidate delayed decisions', t => {
  const h = fixture(t), { m } = h, job = pending(m), ps = m.order[0];
  m._applyBand(ps, 'band_amiya');
  m.externalReply(job.id, { v: 'sp-ai/1', id: job.id, intents: [{ t: 'g.band', bandId: 'band_bldsk' }], done: true }, false);
  assert.equal(ps.bandId, 'band_amiya');
  const human = makeMatch({ mode: 'solo', botStrategy: 'external', externalReplay: true, fake: true });
  t.after(() => human.m.dispose()); human.start().toPrep();
  const p = human.m.order[0]; human.m.setAutoplay(p, true);
  assert.ok(human.run(() => !!pending(human.m)));
  const old = pending(human.m); human.m.setAutoplay(p, false);
  human.m.externalReply(old.id, { v: 'sp-ai/1', id: old.id, intents: [{ t: 'g.ready', ready: true }], done: true }, false);
  assert.equal(p.ready, false);
});

test('personal choices and plugin offer refresh/pick use human intents', t => {
  const h = prep(t), { m } = h, ps = m.order[0];
  const art = giveItem(m, ps, 'chess_item_6_03_m');
  reply(m, [{ t: 'g.art', itemUid: art.uid, row: 10, col: 5 }]);
  assert.ok(ps.personalChoice);
  reply(m, [{ t: 'g.choice', idx: 0, choiceId: ps.personalChoice.id }]);
  assert.equal(ps.personalChoice, null); assert.equal(ps.bounties.length, 1);
  const parsed = readOfferFile({ offer: 1, id: 'pick', when: { at: ['prep'], rounds: [1] }, windowSec: 30, quorum: 'all',
    onTimeout: 'auto', defer: [], slots: 3, refresh: { perSlot: 1 }, options: { source: 'cards.json' }, apply: { funds: 3 } }, { pluginId: 'demo', rel: 'offers/a.json' });
  assert.deepEqual(parsed.problems, []);
  const cards = readOfferCards(['a', 'b', 'c', 'd'].map(id => ({ id, name: id, desc: 'Grant', icon: 'funds' })), parsed.offer).cards;
  m.offers = [{ pluginId: 'demo', ...parsed.offer, cards }];
  m.openOfferWindow('prep', 1);
  const job = [...m.externalAI.jobs.values()].find(j => j.kind === 'offer');
  assert.ok(job); const w = m.offerWin[0];
  m.externalReply(job.id, { v: 'sp-ai/1', id: job.id, done: false,
    intents: [{ t: 'g.offerRefresh', offerId: w.id, pluginId: w.pluginId, seq: w.seq, idx: 0 }] }, false);
  assert.equal(w.refreshUsed.get(ps.playerId)[0], 1);
  const next = [...m.externalAI.jobs.values()].find(j => j.kind === 'offer');
  const funds = ps.funds;
  m.externalReply(next.id, { v: 'sp-ai/1', id: next.id, done: true,
    intents: [{ t: 'g.offer', offerId: w.id, pluginId: w.pluginId, seq: w.seq, idx: 0 }] }, false);
  assert.equal(ps.funds, funds + 3); assert.equal(w.closed, true);
});

test('journal replays accepted/rejected intents, transport fallback and sliced legacy without IO', t => {
  const entries = [];
  const h = prep(t, { test: true, botSliceMs: 0.001, botRehearsal: 1, log: { info(line) {
    if (line.startsWith('[test-input ')) entries.push(JSON.parse(line.slice(line.indexOf(']') + 2)));
  } } });
  reply(h.m, [{ t: 'g.refresh' }, { t: 'g.buy', slot: -1 }]);
  h.m.externalReply(pending(h.m).id, null, true);
  assert.ok(h.run(() => h.m.order[0].ready));
  const journal = decodeTestTrace(entries);
  assert.ok(journal.some(e => e.method === 'externalReply'));
  assert.equal(journal[0].options.externalAI.token, undefined);
  const copy = replayTestMatch(DATA, journal, { BattleClass: FakeBattle });
  t.after(() => copy.dispose());
  assert.equal(copy.externalAI.replay, true); assert.equal(copy.externalAI.transport, null);
  assert.deepEqual(copy.publicView(), h.m.publicView());
  assert.deepEqual(copy.order[0].privateView(), h.m.order[0].privateView());
  assert.equal(copy.rngBots.state(), h.m.rngBots.state());
  assert.equal(copy.rngMeta.state(), h.m.rngMeta.state());
  assert.equal(copy.errorCount, 0);
});

for (const transport of ['http', 'stdio']) {
  test(`full real-sim bot match: one example ${transport} seat, legacy peer, offline journal replay`, async t => {
    const entries = [];
    let config;
    if (transport === 'http') {
      const server = exampleServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
      t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
      config = { transport, url: `http://127.0.0.1:${server.address().port}` };
    } else config = { transport, command: [process.execPath, 'tools/ai/stdio.mjs'] };
    const h = makeMatch({ mode: 'coop', humans: 0, bots: 2, seed: 7, botStrategy: 'external',
      externalAI: { ...config, seats: [0], timeoutMs: 2000 }, test: true, captureFrames: false,
      log: { info(line) { if (line.startsWith('[test-input ')) entries.push(JSON.parse(line.slice(line.indexOf(']') + 2))); } } });
    t.after(() => h.m.dispose()); h.start();
    for (let steps = 0; steps < 20000 && !h.ended; steps++) {
      for (let wait = 0; pending(h.m) && wait < 500; wait++) await delay(5);
      assert.equal(h.m.externalAI.jobs.size, 0, 'external request completed without advancing the virtual phase clock');
      if (!h.sched.runNext()) break;
    }
    assert.ok(h.ended); assert.equal(h.m.errorCount, 0); assert.deepEqual(h.logs.warn, []);
    assert.equal(h.m.externalAI.states.size, 1); assert.equal(h.m.externalAI.states.get('ai_0').failures, 0);
    assert.ok(h.m.round > 1); checkInvariants(h.m);
    const journal = decodeTestTrace(entries);
    assert.ok(journal.some(e => e.method === 'externalReply'));
    assert.ok(!JSON.stringify(journal[0]).includes('127.0.0.1'));
    const copy = replayTestMatch(DATA, journal);
    t.after(() => copy.dispose());
    assert.deepEqual(copy.outcome, h.m.outcome);
    assert.deepEqual(copy.order.map(p => json(p.privateView())), h.m.order.map(p => json(p.privateView())));
    assert.equal(copy.rngBots.state(), h.m.rngBots.state()); assert.equal(copy.errorCount, 0);
  });
}

test('band and common card decisions fall back without waiting for their phase deadline', t => {
  const h = fixture(t), { m } = h;
  m.externalReply(pending(m).id, null, true);
  assert.ok(m.order[0].bandId);
  assert.ok(h.run(() => pending(m)?.kind === 'prep'));
  reply(m, [{ t: 'g.ready', ready: true }], true);
  for (let count = 0; count < 20; count++) {
    assert.ok(h.run(() => !!pending(m) || m.ended));
    assert.ok(!m.ended);
    if (pending(m).kind === 'card') break;
    reply(m, [{ t: 'g.ready', ready: true }], true);
  }
  const job = pending(m);
  assert.equal(job.kind, 'card');
  m.externalReply(job.id, null, true);
  assert.ok(m.sp.picks[job.ps.playerId] != null);
  assert.equal(m.externalAI.jobs.size, 0);
});

test('the intent cap is cumulative across replies and stops further IO', t => {
  const h = prep(t, { externalAI: { maxIntents: 2 } }), { m } = h;
  reply(m, [{ t: 'g.freeze' }]);
  assert.equal(pending(m).used, 1);
  reply(m, [{ t: 'g.freeze' }]);
  assert.equal(m.externalAI.jobs.size, 0);
  assert.ok(h.run(() => m.order[0].ready));
  assert.equal(m.externalAI.states.get('ai_0').failures, 1);
});

test('oversized batch rejects every action before falling back', t => {
  const h = prep(t, { externalAI: { maxIntents: 1 } }), { m } = h;
  reply(m, [{ t: 'g.freeze' }, { t: 'g.ready', ready: true }], true);
  assert.equal(m.order[0].shop.frozen, false);
  assert.equal(m.order[0].ready, false);
  assert.ok(h.run(() => m.order[0].ready));
});

test('a phase deadline remains armed while an external decision waits', t => {
  const h = prep(t), { m } = h;
  const old = pending(m).id;
  m.setDeadline(0.01, () => m.prepDeadline());
  assert.ok(h.run(() => m.phase !== 'PREP'));
  assert.equal(m.deadline, 0);
  const funds = m.order[0].funds;
  m.externalReply(old, { v: 'sp-ai/1', id: old, intents: [{ t: 'g.refresh' }], done: true }, false);
  assert.equal(m.order[0].funds, funds);
});

test('an unfinished offer falls back to the existing default and releases its phase gate', t => {
  const h = prep(t), { m } = h, ps = m.order[0];
  m.externalAI.close();
  const raw = { offer: 1, id: 'fallback', when: { at: ['prep'], rounds: [1] }, windowSec: 30, quorum: 'all',
    onTimeout: 'auto', defer: [], slots: 1, options: { source: 'cards.json' }, apply: { funds: 3 } };
  const parsed = readOfferFile(raw, { pluginId: 'demo', rel: 'offers/a.json' });
  assert.deepEqual(parsed.problems, []);
  const cards = readOfferCards([{ id: 'a', name: 'a', desc: 'Grant', icon: 'funds' }], parsed.offer).cards;
  m.offers = [{ pluginId: 'demo', ...parsed.offer, cards }];
  assert.equal(m.openOfferWindow('prep', 1), 'open');
  const funds = ps.funds;
  reply(m, [], true);
  assert.equal(ps.funds, funds + 3);
  assert.equal(m.offerBlocking(), false);
  assert.equal(m.externalAI.states.get(ps.playerId).failures, 1);
});

test('human intents and other seats keep running during asynchronous HTTP timeout', async t => {
  const { default: http } = await import('node:http');
  const server = http.createServer(() => {});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const h = makeMatch({ humans: 2, bots: 1, fake: true, botStrategy: 'external',
    externalAI: { transport: 'http', url: `http://127.0.0.1:${server.address().port}`, seats: [2], timeoutMs: 50 } });
  t.after(() => h.m.dispose()); h.start().toPrep();
  const { m } = h;
  assert.ok(h.run(() => pending(m)?.kind === 'prep'));
  assert.deepEqual(m.handle('p_0', { t: 'g.freeze' }), { ok: true });
  assert.ok(m.order[0].shop.frozen);
  for (let tries = 0; pending(m) && tries < 100; tries++) await delay(5);
  assert.equal(m.externalAI.jobs.size, 0);
  assert.ok(h.run(() => m.order[2].ready));
  assert.equal(m.externalAI.states.get('ai_0').failures, 2, 'band and prep both used legacy fallback');
  assert.equal(m.phase, 'PREP', 'humans continue their own decisions');
  assert.deepEqual(h.logs.error, []);
});
