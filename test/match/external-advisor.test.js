import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA, give, giveItem, checkInvariants } from './harness.js';
import { validPlan, planPlacementWeight } from '../../server/match/aiPlan.js';
import { buyScoreOf, itemTarget, levelUp } from '../../server/match/bot.js';
import { externalConfig } from '../../server/match/externalConfig.js';
import { decodeTestTrace, replayTestMatch } from '../../server/match/testReplay.js';
import { FakeBattle } from './fakeBattle.js';
import { runMatch } from '../../tools/ai/run-match.mjs';
import { exampleServer } from '../../tools/ai/http.mjs';
import { once } from 'node:events';
import http from 'node:http';

const pending = m => [...m.externalAI.jobs.values()][0];
function send(m, plan) { const j = pending(m); m.externalReply(j.id, { v: 'sp-ai/1', id: j.id, plan }, false); }
function fixture(t, extra = {}) {
  const h = makeMatch({ mode: 'solo', fake: true, botStrategy: 'external', externalReplay: true,
    externalAI: { mode: 'plan' }, seats: [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true }], ...extra });
  t.after(() => h.m.dispose()); h.start(); h.run(() => !!pending(h.m)); send(h.m, { choice: [...pending(h.m).actions.keys()][0] });
  h.run(() => pending(h.m)?.kind === 'prep');
  return h;
}

test('advisor schema rejects unknown keys, unbounded lists, malformed preferences and non-finite numbers', () => {
  assert.ok(validPlan({}));
  assert.ok(validPlan({ bonds: [{ id: 'yanShip', priority: 5 }], buy: ['a'], keep: ['b'], sell: ['c'],
    economy: { level: 5, reserve: 5, maxRefreshes: 0, refreshAbove: 5, saveForInterest: true },
    items: { keep: ['i'], equip: [{ id: 'j', target: 'a' }] }, placements: [{ id: 'a', row: 9, col: 4, dir: 'UP' }], choice: 'a1' }));
  for (const bad of [null, [], { other: 0 }, { bonds: [{ id: 'a', priority: 6 }] }, { buy: Array(33).fill('a') },
    { economy: { reserve: Infinity } }, { economy: { level: 7 } }, { economy: { level: '3' } },
    { placements: [{ id: 'a', row: -1, col: 0 }] }, { items: { equip: [{ id: 'i', target: 1 }] } }, { choice: 'ai-1:a2' }]) assert.equal(validPlan(bad), false);
});

test('owner config defaults direct, enables plan/knowledge explicitly and rejects unknown modes/languages', () => {
  assert.equal(externalConfig({}, {}, true).mode, 'direct');
  assert.equal(externalConfig({}, {}, true).knowledge, false);
  assert.equal(externalConfig({ mode: 'plan' }, {}, true).knowledge, true);
  assert.throws(() => externalConfig({ mode: 'intent' }, {}, true));
  assert.throws(() => externalConfig({ language: '../key' }, {}, true));
});

test('accepted plan weights procurement, units, bonds and items without extra RNG draws', t => {
  const { m } = fixture(t), ps = m.order[0];
  const id = ps.shop.slots.find(s => s?.kind === 'chess').id;
  const before = buyScoreOf(m, ps, id), rng = m.rngBots.state();
  const bond = ps.gd.chess(id).bonds.find(id => !m.gd.modeInactiveBonds.has(id));
  const p = give(m, ps, id), item = giveItem(m, ps, 'chess_item_1_01_e_a');
  const baseline = buyScoreOf(m, ps, id);
  send(m, { buy: [id], keep: [id], bonds: bond ? [{ id: bond, priority: 4 }] : [],
    items: { equip: [{ id: item.id, target: id }] }, placements: [{ id, row: 9, col: 4, dir: 'UP' }] });
  assert.ok(buyScoreOf(m, ps, id) >= baseline + 24);
  assert.equal(itemTarget(m, ps, item)?.uid, p.uid);
  assert.equal(planPlacementWeight(m, ps, id, 9, 4, 'UP'), 0.05);
  assert.equal(planPlacementWeight(m, ps, id, 9, 4, 'DOWN'), 0);
  assert.deepEqual(m.rngBots.state(), rng); assert.ok(Number.isFinite(before));
  assert.equal(m.externalAI.states.get(ps.playerId).failures, 0);
  assert.ok(m.externalAI.planFor(ps));
  m.round++; assert.equal(m.externalAI.planFor(ps), null);
});

test('plan keeps items and explicit level hold; impossible wishes still reach Ready legally', t => {
  const h = fixture(t), { m } = h, ps = m.order[0];
  const item = giveItem(m, ps, 'chess_item_1_01_e_a');
  send(m, { buy: ['missing'], keep: ['missing'], sell: ['missing'], items: { keep: [item.id] },
    economy: { maxRefreshes: 0, level: 1, holdLevel: true, why: 'Farm low-tier elites.', reserve: 100 }, placements: [{ id: 'missing', row: 0, col: 0 }] });
  assert.equal(itemTarget(m, ps, item), null);
  assert.ok(h.run(() => ps.ready));
  assert.equal(ps.shop.level, 1);
  assert.ok(ps.deployCount > 0); checkInvariants(m); assert.deepEqual(h.logs.error, []);
});

test('once per prep round, including reschedules, and invalid plans use unweighted legacy', t => {
  const h = fixture(t), { m } = h, ps = m.order[0], job = pending(m);
  assert.equal(m.externalAI.start(ps, { kind: job.kind, valid: job.valid, complete: job.complete, fallback: job.fallback }), true, 'still waiting, do not begin legacy concurrently');
  assert.equal(m.externalAI.jobs.size, 1);
  send(m, { economy: { maxRefreshes: 999 } });
  assert.equal(m.externalAI.planFor(ps), null);
  assert.equal(m.externalAI.metrics.fallbacks, 1);
  assert.ok(h.run(() => ps.ready)); ps.ready = false;
  m.scheduleBotPrep(ps); assert.ok(h.run(() => ps.ready));
  assert.equal(m.externalAI.jobs.size, 0); assert.equal(m.externalAI.seq, 2);
});

test('advisor level policy obeys band carry-over reserve and remains validated', t => {
  const { m } = fixture(t), ps = m.order[0]; ps.bandId = 'band_cannot'; ps.funds = 20;
  send(m, { economy: { level: 3, reserve: 10 } });
  levelUp(m, ps); assert.ok(ps.shop.level > 1 && ps.shop.level <= 3); assert.ok(ps.funds >= 10);
});

test('a late plan cannot restore preferences after leaving its prep phase', t => {
  const h = fixture(t), { m } = h, ps = m.order[0], job = pending(m);
  m.endPrep(); const funds = ps.funds;
  m.externalReply(job.id, { v: 'sp-ai/1', id: job.id, plan: { economy: { level: 6 } } }, false);
  assert.equal(m.externalAI.planFor(ps), null); assert.equal(ps.funds, funds);
  assert.equal(m.externalAI.jobs.size, 0);
});

test('a mismatched hello acknowledgement falls back without sending a decision or advancing virtual time', async t => {
  let calls = 0;
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', c => { body += c; }); req.on('end', () => {
      const o = JSON.parse(body); calls++; assert.equal(o.type, 'hello');
      res.end(JSON.stringify({ v: o.v, id: o.id, type: 'hello', knowledgeVersion: 'wrong' }));
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const h = makeMatch({ mode: 'solo', fake: true, botStrategy: 'external',
    seats: [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true }],
    externalAI: { mode: 'plan', transport: 'http', url: `http://127.0.0.1:${server.address().port}`, timeoutMs: 5000 } });
  t.after(() => h.m.dispose()); h.start(); h.run(() => !!pending(h.m));
  const now = h.sched.now(); await h.m.externalAI.waitForIdle();
  assert.equal(h.sched.now(), now); assert.equal(calls, 1); assert.equal(h.m.externalAI.metrics.fallbacks, 1);
  assert.ok(h.m.order[0].bandId); assert.equal(h.m.externalAI.jobs.size, 0);
});

test('a restarted stdio child receives knowledge again before its next plan', async t => {
  const h = makeMatch({ mode: 'solo', fake: true, botStrategy: 'external',
    seats: [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true }],
    externalAI: { mode: 'plan', transport: 'stdio', command: [process.execPath, 'tools/ai/stdio.mjs'], timeoutMs: 5000 } });
  t.after(() => h.m.dispose()); h.start();
  assert.ok(await runMatch(h.m, () => h.m.order[0].ready));
  const ai = h.m.externalAI, old = ai.transport.child;
  ai.transport.breakChild(); ai.transport.retryAt = 0;
  assert.ok(await runMatch(h.m, () => h.m.round === 2 && h.m.order[0].ready));
  assert.notEqual(ai.transport.child, old); assert.equal(ai.metrics.helloCalls, 2); assert.equal(ai.metrics.fallbacks, 0);
});

test('accepted advisor plans and short draft IDs replay offline with identical state and RNG', t => {
  const entries = [];
  const h = fixture(t, { test: true, botSliceMs: 0.001, botRehearsal: 1,
    log: { info(line) { if (line.startsWith('[test-input ')) entries.push(JSON.parse(line.slice(line.indexOf(']') + 2))); } } });
  send(h.m, { economy: { maxRefreshes: 2 }, buy: [h.m.order[0].shop.slots.find(s => s?.kind === 'chess').id] });
  assert.ok(h.run(() => h.m.order[0].ready));
  const trace = decodeTestTrace(entries), replay = replayTestMatch(DATA, trace, { BattleClass: FakeBattle });
  t.after(() => replay.dispose());
  assert.equal(trace[0].options.externalAI.mode, 'plan');
  assert.deepEqual(replay.order[0].privateView(), h.m.order[0].privateView());
  assert.equal(replay.rngBots.state(), h.m.rngBots.state());
  assert.equal(replay.externalAI.inflight.size, 0); assert.equal(replay.externalAI.transport, null);
});

for (const transport of ['http', 'stdio']) test(`advisor ${transport}: one hello shared by seats, one prep call per round and real IO`, async t => {
  let config;
  if (transport === 'http') {
    const server = exampleServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => { server.closeAllConnections(); server.close(); });
    config = { transport, url: `http://127.0.0.1:${server.address().port}` };
  } else config = { transport, command: [process.execPath, 'tools/ai/stdio.mjs'] };
  const h = makeMatch({ mode: 'coop', humans: 0, bots: 2, fake: true, botStrategy: 'external',
    externalAI: { ...config, mode: 'plan', timeoutMs: 5000 } });
  t.after(() => h.m.dispose()); h.start();
  assert.ok(await runMatch(h.m, () => !!h.ended));
  const ai = h.m.externalAI;
  assert.equal(ai.metrics.helloCalls, 1); assert.equal(ai.metrics.fallbacks, 0);
  assert.ok(ai.metrics.calls > 2 && ai.metrics.calls < h.m.round * 4 + 4);
  assert.ok(ai.metrics.latencyMs > 0); assert.deepEqual(h.logs.error, []);
  assert.equal(ai.inflight.size, 0);
});
