import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLLMAgent, modelStrategy, parseReply } from '../../tools/ai/llm-agent.mjs';
import { compactDigest, compactChoices, continuity, focusPlan } from '../../tools/ai/llm-context.mjs';
import { repairPlan, holdFloor } from '../../tools/ai/llm-plan.mjs';

test('round54 complete equip plans missing only the outer brace recover without guessing partial JSON', () => {
  const complete = { why: 'Keep the carry.', pivot: false, pivotReason: '',
    plan: { items: { equip: [{ id: 'item', target: 'lead' }] } } };
  const text = JSON.stringify(complete), repairs = [];
  assert.deepEqual(parseReply(text.slice(0, -1), repairs), complete);
  assert.deepEqual(repairs, [{ path: '$', reason: 'closed missing outer object after items.equip' }]);
  assert.deepEqual(parseReply(`\`\`\`json\n${text.slice(0, -1)}\n\`\`\``), complete);
  for (const malformed of [text.slice(0, -2), text.slice(0, -5), text.replace(',"pivot":', '"pivot":'),
    text.replace('"target":"lead"', '"target":"lead'), text.slice(0, -1).replace('"equip":', '"keep":'),
    `${text.slice(0, -1)},"other":"unfinished`,
    '{"why":"x","plan":{"items":{"equip":[{"id":"item","target":"lead"},]}}']) {
    assert.throws(() => parseReply(malformed));
  }
  const unchanged = [];
  assert.deepEqual(parseReply(text, unchanged), complete); assert.deepEqual(unchanged, []);
});

test('example repair preserves reasoned level holds and drops an unexplained hold', () => {
  const economy = { level: 2, holdLevel: true, why: 'Farm low-tier elites.' };
  assert.deepEqual(repairPlan({ economy }, pack, fixture.digest, []).plan.economy, economy);
  const repaired = repairPlan({ economy: { level: 2, holdLevel: true } }, pack, fixture.digest, []);
  assert.equal(repaired.plan.economy.holdLevel, undefined);
  assert.ok(repaired.repairs.some(r => r.path === 'economy.holdLevel'));
});

test('§35.62 repair drops level holds below the slow curve unless a candidate holds that level; item buys move', () => {
  // §35.63: L2 by R4 (not R3) and L6 by R11.
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13].map(holdFloor), [1, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  const economy = { level: 2, holdLevel: true, why: 'Price drops next round.' };
  const late = { ...fixture.digest, round: 5, economy: { ...fixture.digest.economy, level: 2 } };
  const dropped = repairPlan({ economy }, pack, late, []);
  assert.equal(dropped.plan.economy.holdLevel, undefined);
  assert.ok(dropped.repairs.some(r => r.path === 'economy.holdLevel' && /floor L3/.test(r.reason)));
  assert.equal(repairPlan({ economy }, pack, late, [], { holds: [2] }).plan.economy.holdLevel, true);
  assert.equal(repairPlan({ economy }, pack, { ...late, round: 4 }, []).plan.economy.holdLevel, true);
  // Levelling to the floor first and holding there is at the curve, not below it.
  assert.equal(repairPlan({ economy: { ...economy, level: 3 } }, pack, late, []).plan.economy.holdLevel, true);
  const moved = repairPlan({ buy: ['lead', 'item'], items: { buy: [] } }, pack, fixture.digest, []);
  assert.deepEqual(moved.plan.buy, ['lead']);
  assert.deepEqual(moved.plan.items.buy, ['item']);
  assert.deepEqual(repairPlan({ buy: ['item'] }, pack, fixture.digest, []).plan, { buy: [], items: { buy: ['item'] } });
});

test('§35.62 a strategy candidate main may lead the plan before a member is held; the model sees two prep candidates', () => {
  const digest = { ...compactDigest(fixture.digest, pack), bonds: [] };
  const plan = { bonds: [{ id: 'a', priority: 5 }] }, repairs = [];
  focusPlan(plan, { pivot: false }, digest, null, repairs, ['a']);
  assert.deepEqual(plan.bonds, [{ id: 'a', priority: 5 }]);
  const without = { bonds: [{ id: 'a', priority: 5 }] };
  focusPlan(without, { pivot: false }, digest, null, [], []);
  assert.deepEqual(without.bonds, []);
  const curve = [4, 7].map(round => ({ round, level: 2, basis: 'same sentence' }));
  const strategy = { candidates: [1, 2, 3, 4].map(i => ({ id: `c${i}`, main: 'a', levelCurve: curve })) };
  const prep = modelStrategy(strategy, 'prep');
  assert.equal(prep.candidates.length, 2);
  assert.equal(prep.levelCurveBasis, 'same sentence');
  assert.ok(prep.candidates.every(c => c.levelCurve.every(r => !('basis' in r) && r.round)));
  assert.equal(modelStrategy(strategy, 'band').candidates.length, 4);
  assert.deepEqual(parseReply('```json\n{"plan":{}}\n```'), { plan: {} });
  assert.throws(() => parseReply('no json'));
});
import { validPlan } from '../../server/match/aiPlan.js';
import { aiObservation } from '../../server/match/externalAI.js';
import { makeMatch, give, chessOfTier } from './harness.js';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/llm-advisor.json', import.meta.url), 'utf8'));
const pack = fixture.knowledge;
const observation = (digest, id, matchId = 'match-a', kind = 'prep') => ({ v: 'sp-ai/1', id, knowledgeVersion: pack.version,
  context: { matchId, mode: 'plan', kind }, digest });
async function mock(t) {
  const calls = [], replies = [];
  const server = http.createServer((req, res) => {
    req.setEncoding('utf8');
    let body = ''; req.on('data', b => { body += b; }); req.on('end', () => {
      calls.push(JSON.parse(body)); const reply = replies.shift();
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(reply) } }] }));
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const dir = mkdtempSync(join(tmpdir(), 'sp-llm-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'debug.ndjson');
  const agent = createLLMAgent({ SP_LLM_BASE_URL: `http://127.0.0.1:${server.address().port}`, SP_LLM_MODEL: 'mock',
    SP_LLM_API_KEY: 'offline-secret', SP_LLM_DEBUG_FILE: file });
  await agent({ v: 'sp-ai/1', id: 'hello', type: 'hello', knowledge: pack });
  return { agent, calls, replies, logs: () => readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse) };
}

test('recorded mock rounds preserve accepted direction, actual outcomes and private why; explicit pivot changes it', async t => {
  const { agent, calls, replies, logs } = await mock(t);
  replies.push(...structuredClone(fixture.replies));
  const d = structuredClone(fixture.digest);
  const first = await agent(observation(d, 'r1'));
  assert.deepEqual(first.plan.bonds.map(b => b.id), ['a', 'b', 'c']);
  assert.deepEqual(first.plan.buy, ['support']);
  assert.deepEqual(first.plan.economy, { reserve: 100, level: 2, maxRefreshes: 0 });
  assert.deepEqual(Object.keys(first).sort(), ['id', 'plan', 'v']);
  assert.ok(validPlan(first.plan));
  d.round = 2; d.lp = 17;
  d.board = [{ id: 'elite', baseId: 'lead', uid: 'u5', kind: 'chess', stars: 2, bonds: ['a', 'b', 'c', 'd'] }]; d.bench = [];
  d.bonds[0].count = 2;
  d.feedback = { events: fixture.events, through: 3, lastBattle: { round: 1, lp: 17, lpLoss: 3, leaks: 5 },
    acceptedPlan: { id: 'r1', round: 1, plan: first.plan } };
  const second = await agent(observation(d, 'r2'));
  assert.deepEqual(second.plan.bonds, first.plan.bonds, 'unexplained pivot repaired');
  const user = JSON.parse(calls[1].messages[1].content);
  assert.deepEqual(user.continuity.previousPlan, first.plan);
  assert.deepEqual(user.continuity.outcome.events, fixture.events);
  assert.equal(user.continuity.outcome.eventsComplete, true);
  assert.deepEqual(user.continuity.outcome.bonds.find(b => b.id === 'a'), { id: 'a', before: 1, after: 2 });
  assert.deepEqual(user.continuity.outcome.lp, { before: 20, after: 17 });
  assert.equal(user.continuity.outcome.lastBattle.leaks, 5);
  assert.equal(user.digest.board[0].stars, 2);
  d.round = 3; d.feedback.acceptedPlan = { id: 'r2', round: 2, plan: second.plan };
  const third = await agent(observation(d, 'r3'));
  assert.deepEqual(third.plan.bonds.map(b => b.id), ['d', 'b']);
  assert.deepEqual(JSON.parse(calls[2].messages[1].content).continuity.outcome.events, []);
  const entries = logs();
  assert.equal(entries[0].why, fixture.replies[0].why);
  assert.equal(entries[1].pivot, false); assert.equal(entries[2].pivot, true);
  assert.equal(entries[2].pivotReason, fixture.replies[2].pivotReason);
  assert.ok(entries[0].repairs.some(r => r.value === 'item'));
  assert.ok(entries[0].repairs.some(r => r.reason === 'clamped to 100'));
  assert.ok(!JSON.stringify(entries).includes('offline-secret'));
  assert.ok(calls.every(c => c.messages[0].content === calls[0].messages[0].content));
});

test('seat/match isolation, drafts, malformed and unaccepted replies do not replace the last accepted prep', async t => {
  const { agent, calls, replies } = await mock(t), d = structuredClone(fixture.digest);
  replies.push(fixture.replies[0]); const first = await agent(observation(d, 'r1'));
  d.round = 2; d.feedback.acceptedPlan = { id: 'r1', round: 1, plan: first.plan };
  replies.push({ why: 'Draft choice.', plan: { choice: 'a1' } });
  await agent(observation(d, 'card', 'match-a', 'card'));
  replies.push({ why: 'Bad shape.', plan: { economy: [] } });
  await assert.rejects(agent(observation(d, 'bad')), /plan/);
  replies.push(fixture.replies[2]); await agent(observation(d, 'unaccepted'));
  replies.push({ why: 'Delegate this round.', plan: {} });
  const delegated = await agent(observation(d, 'after'));
  assert.deepEqual(delegated.plan, {}, 'explicit empty plans retain unweighted legacy delegation');
  assert.deepEqual(JSON.parse(calls.at(-1).messages[1].content).continuity.previousPlan, first.plan);
  for (const [playerId, matchId] of [['seat-b', 'match-a'], ['seat-a', 'match-b']]) {
    const separate = { ...structuredClone(fixture.digest), playerId };
    replies.push({ why: 'Fresh seat.', plan: {} }); await agent(observation(separate, 'r1', matchId));
    const u = JSON.parse(calls.at(-1).messages[1].content);
    assert.equal(u.continuity, null); assert.equal(u.digest.lp, 20);
  }
});

test('digest stays compact and excludes bans, inaccessible tiers and hidden stock from candidate estimates', () => {
  const d = structuredClone(fixture.digest);
  d.bonds[0].layers = 42;
  d.geometry = { tiles: Array(1000).fill('unused') }; d.private = { secret: 'hidden' }; d.stock = { secret: 99 };
  d.shop = []; d.availability.bannedChess = ['support'];
  const digest = compactDigest(d, pack);
  assert.ok(digest.bonds.every(b => !b.candidate));
  assert.ok(!JSON.stringify(digest).includes('hidden'));
  d.shop = fixture.digest.shop; d.availability.disabledBonds = ['b'];
  const shown = compactDigest(d, pack);
  assert.ok(shown.bonds.find(b => b.id === 'a').candidate, 'displayed shop copy stays usable even if banned from future rolls');
  assert.ok(!shown.bonds.some(b => b.id === 'b' || b.id === 'e'));
  assert.equal(shown.shop[0].cost, 2); assert.equal(shown.shop[0].tier, 1);
  assert.deepEqual(shown.shop[0].bonds, ['a', 'b', 'c', 'd']);
  assert.equal(shown.bonds[0].nextThreshold, 2); assert.equal(shown.upcoming[0].fly, true);
  assert.equal(shown.bonds[0].layers, 42, 'keep actual accumulated investment visible');
  assert.equal(shown.economy.interest.nextGold, 10); assert.equal(shown.boss.id, 'boss');
  assert.ok(JSON.stringify(shown).length < 2000);
});

test('unreachable previous targets cause an explicit automatic pivot and truncated feedback reports a gap', () => {
  const d = structuredClone(fixture.digest), compact = compactDigest(d, pack);
  compact.bonds.find(b => b.id === 'a').candidate = false;
  const plan = { bonds: [] }, repairs = [];
  const pivot = focusPlan(plan, {}, compact, { bonds: [{ id: 'a', priority: 5 }, { id: 'b', priority: 3 }] }, repairs);
  assert.equal(pivot.pivot, true); assert.match(pivot.pivotReason, /reachable/);
  assert.deepEqual(plan.bonds, [{ id: 'b', priority: 3 }]);
  d.feedback = { acceptedPlan: { id: 'one', round: 1, plan }, events: fixture.events.slice(1), through: 3 };
  const c = continuity(d, { id: 'one', round: 1, plan, digest: compact, through: 0 });
  assert.equal(c.outcome.eventsComplete, false);
  assert.equal(continuity(d, null).outcome.bonds[0].before, null, 'restart does not fabricate a baseline');
});

test('priority-order changes need a pivot reason; explanations are bounded and stay outside the game reply', async t => {
  const { agent, replies, logs } = await mock(t), d = structuredClone(fixture.digest);
  replies.push(fixture.replies[0]); const first = await agent(observation(d, 'r1'));
  d.feedback.acceptedPlan = { id: 'r1', round: 1, plan: first.plan };
  for (const meta of [{ pivot: true }, { pivot: false, pivotReason: 'Change it.' }]) {
    replies.push({ why: 'One. Two! Three? Four.', ...meta, plan: { bonds: [{ id: 'b', priority: 5 }, { id: 'a', priority: 4 }, { id: 'c', priority: 3 }] } });
    const reply = await agent(observation(d, `r${replies.length}-${meta.pivot}`));
    assert.deepEqual(reply.plan.bonds, first.plan.bonds);
    assert.equal(reply.why, undefined); assert.equal(logs().at(-1).why, 'One. Two! Three?');
    assert.equal(logs().at(-1).pivot, false);
  }
});

test('compact choices retain visible card effects and reward prices without unrelated offer seats', () => {
  const d = structuredClone(fixture.digest);
  d.rewards = [{ id: 'support', kind: 'chess', price: 0, tier: 1, bonds: ['a'] }];
  d.personalChoice = { cards: [{ id: 'personal', desc: 'Gain funds', coin: 5 }] };
  d.choices = { cards: [{ idx: 2, id: 'draft', desc: 'Team effect', team: true }], offers: [{ id: 'offer', pluginId: 'p', seq: 1,
    seats: [{ playerId: 'seat-a', slots: [{ idx: 0, id: 'own', desc: 'Own effect' }] }, { playerId: 'other', slots: [{ id: 'other-card' }] }] }] };
  d.actions.push({ id: 'a2', intent: { t: 'g.choice', idx: 2 } }, { id: 'a3', intent: { t: 'g.choice', idx: 0, choiceId: 'personal' } },
    { id: 'a4', intent: { t: 'g.offer', idx: 0, offerId: 'offer', pluginId: 'p', seq: 1 } });
  const choices = compactChoices(d);
  assert.equal(choices[0].card.price, 0); assert.equal(choices[1].card.desc, 'Team effect');
  assert.equal(choices[2].card.coin, 5); assert.equal(choices[3].card.id, 'own');
  assert.ok(!JSON.stringify(choices).includes('other-card'));
});

test('repairs preserve useful fields, clamp numeric bounds and drop unknown IDs throughout the plan', () => {
  const { plan, repairs } = repairPlan({ buy: ['lead', 'bad'], keep: ['item'], sell: ['bad'],
    bonds: [{ id: 'a', priority: 9 }, { id: 'a', priority: 3 }, { id: 'unknown', priority: 1 }],
    items: { keep: ['item', 'bad'], equip: [{ id: 'item', target: 'lead' }, { id: 'item', target: 'bad' }] },
    placements: [{ id: 'lead', row: -3, col: 500, dir: 'up' }, { id: 'bad', row: 1, col: 1 }],
    choice: 'a999', economy: { reserve: 'NaN', refreshAbove: '7', saveForInterest: true } }, pack, fixture.digest, fixture.digest.actions);
  assert.ok(validPlan(plan)); assert.deepEqual(plan.bonds, [{ id: 'a', priority: 5 }]);
  assert.deepEqual(plan.placements, [{ id: 'lead', row: 0, col: 10, dir: 'UP' }]);
  assert.deepEqual(plan.items, { keep: ['item'], equip: [{ id: 'item', target: 'lead' }] });
  assert.deepEqual(plan.economy, { refreshAbove: 7, saveForInterest: true });
  assert.equal(plan.choice, undefined); assert.ok(repairs.length >= 10);
  assert.throws(() => repairPlan([], pack, fixture.digest, []));
});

test('host feedback observes real successful buys, sales, merges and battle results for this seat only', t => {
  const h = makeMatch({ humans: 2, fake: true, botStrategy: 'external', externalReplay: true, externalAI: { mode: 'plan' } });
  t.after(() => h.m.dispose()); h.start().toPrep();
  const { m } = h, ps = m.order[0], other = m.order[1], ai = m.externalAI;
  ai.states.set(ps.playerId, {}); ai.states.set(other.playerId, {});
  const id = chessOfTier(1).find(id => m.gd.mergeCount(id) === 3);
  give(m, ps, id); give(m, ps, id); ps.funds = 20;
  ps.shop.slots[0] = { kind: 'chess', id, basePrice: 1 };
  assert.ok(ps.buy(0).ok); assert.ok(ps.buy(0).error);
  const elite = ps.allChess().find(p => m.gd.isGolden(p.id)); assert.ok(elite);
  assert.ok(ps.sell(elite.uid).ok); assert.ok(ps.sell(elite.uid).error);
  const own = ai.feedbackFor(ps);
  assert.deepEqual(own.events.map(e => e.type).sort(), ['buy', 'merge', 'sell']);
  assert.equal(own.events.find(e => e.type === 'merge').id, elite.id);
  assert.equal(ai.feedbackFor(other).events.length, 0);
  const ownWire = ps.privateView(), pubWire = m.publicView();
  const o = aiObservation(m, ps, { kind: 'prep', id: 'o' }, []);
  assert.deepEqual(o.private, ownWire); assert.deepEqual(o.public, pubWire);
  assert.equal(o.digest.feedback.through, 3); assert.equal(o.context.matchId, ai.matchId);
  m.lastResults = new Map([[ps.playerId, { leaked: [{}, {}, { counted: false }], layerGains: {} }]]);
  m.settle(null, null);
  assert.equal(ai.feedbackFor(ps).lastBattle.leaks, 2);
  assert.equal(ai.feedbackFor(ps).lastBattle.lpLoss, 2);
  assert.equal(ai.feedbackFor(ps).lastBattle.lp, ps.lp);
  for (let n = 0; n < 300; n++) ai.observe(ps, 'onBuy', { slot: { id }, kind: 'chess', price: 1 });
  assert.equal(ai.feedbackFor(ps).events.length, 256);
  assert.equal(ai.feedbackFor(other).events.length, 0);
});
