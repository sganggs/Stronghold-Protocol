// §35.63: 终极 cycle 2 — the example agent's choice-only calls, length retry and choice-name check, the digest's copy /
// level / enemy-scale rows, core-bond mains for carries, the executor's guards for plan seats, and the bots' level
// curve and layer trade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLLMAgent, CHOICE_TASK, RETRY_TEXT, checkChoiceName } from '../../tools/ai/llm-agent.mjs';
import { compactDigest, levelOptions } from '../../tools/ai/llm-context.mjs';
import { buildPlaybook } from '../../server/ai/playbook.js';
import { strategyCandidates } from '../../server/ai/strategy.js';
import { carryPlan } from '../../server/match/externalAI.js';
import { advisorProtected } from '../../server/match/aiEconomy.js';
import { sellWeakestHand, buyLoopSteps, levelUp } from '../../server/match/bot.js';
import { DATA, makeMatch, give, legalTileFor } from './harness.js';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/llm-advisor.json', import.meta.url), 'utf8'));
const pack = fixture.knowledge;
const ENV = { SP_LLM_BASE_URL: 'http://127.0.0.1:1', SP_LLM_MODEL: 'mock', SP_LLM_API_KEY: 'mock' };
const answer = (content, finish = 'stop', usage = { prompt_tokens: 10, completion_tokens: 5 }) =>
  ({ choices: [{ finish_reason: finish, message: { content } }], usage });
const rewardDigest = () => ({ ...fixture.digest, actions: [{ id: 'a1', intent: { t: 'g.reward', idx: 0 }, text: 'support' },
  { id: 'a2', intent: { t: 'g.reward', idx: 1 }, text: 'lead' }],
rewards: [{ id: 'support', name: 'Support', kind: 'chess' }, { id: 'lead', name: 'Lead', kind: 'chess' }] });

async function agentWith(replies) {
  const sent = [];
  const agent = createLLMAgent(ENV, async (_config, body) => { sent.push(structuredClone(body)); return replies.shift(); });
  await agent({ v: 'sp-ai/1', type: 'hello', id: 'hello', knowledge: pack });
  return { agent, sent };
}

test('a reward call gets the choice-only task, and a choice whose name the model contradicts follows the name', async () => {
  const { agent, sent } = await agentWith([answer('{"why":"Lead completes the pair.","choiceName":"Lead","plan":{"choice":"a1"}}')]);
  const reply = await agent({ v: 'sp-ai/1', id: 'r1', knowledgeVersion: pack.version, context: { mode: 'plan', kind: 'reward', matchId: 'm' },
    digest: rewardDigest() });
  assert.equal(reply.plan.choice, 'a2');
  const question = JSON.parse(sent[0].messages[1].content);
  assert.equal(question.task, CHOICE_TASK);
  assert.equal(question.strategy, undefined); assert.equal(question.continuity, undefined);
  assert.equal(sent[0].max_tokens, 16000);
  const plan = { choice: 'a1' }, repairs = [];
  checkChoiceName(plan, 'Nobody', [{ id: 'a1', card: { name: 'Support' } }, { id: 'a2', card: { name: 'Lead' } }], repairs);
  assert.equal(plan.choice, 'a1'); assert.equal(repairs.length, 0);
});

test('a reply cut off by the output limit is retried once with the decide-now turn; usage adds up', async () => {
  const { agent, sent } = await agentWith([answer('', 'length', { prompt_tokens: 100, completion_tokens: 50 }),
    answer('{"why":"Fill the board.","plan":{}}', 'stop', { prompt_tokens: 120, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 90 } })]);
  const reply = await agent({ v: 'sp-ai/1', id: 'p1', knowledgeVersion: pack.version, context: { mode: 'plan', kind: 'prep', matchId: 'm' },
    digest: fixture.digest });
  assert.deepEqual(reply.plan, {});
  assert.deepEqual(reply.usage, { inputTokens: 220, outputTokens: 70, cachedTokens: 90 });
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].messages.at(-1), { role: 'user', content: RETRY_TEXT });
  const twice = await agentWith([answer('', 'length'), answer('', 'length')]);
  await assert.rejects(twice.agent({ v: 'sp-ai/1', id: 'p2', knowledgeVersion: pack.version, context: { mode: 'plan', kind: 'prep', matchId: 'm' },
    digest: fixture.digest }), /incomplete/);
  assert.equal(twice.sent.length, 2);
});

test('digest shop rows carry copies held and merge completion; level options, enemy scale and bond kinds are computed', () => {
  const lead = fixture.digest.bench[0];
  const digest = { ...fixture.digest, round: 7, board: [], overflow: [], bench: [lead, { ...lead, uid: 'u3' }],
    shop: [{ id: 'lead', baseId: 'lead', kind: 'chess', slot: 0, stars: 1, price: 1, tier: 1, bonds: ['a'] },
      { id: 'support', baseId: 'support', kind: 'chess', slot: 1, stars: 1, price: 2, tier: 1, bonds: ['a'] }] };
  const scaled = { ...pack, modeId: 'mode_multi_abyss', difficulties: [{ id: 'mode_multi_abyss', enemyScale: { 7: { atk: 2.1, hp: 3.58, speed: 1 } } }],
    bonds: pack.bonds.map((b, i) => ({ ...b, core: i === 0 })) };
  const d = compactDigest(digest, scaled);
  assert.deepEqual(d.shop.map(s => [s.copiesHeld, s.completesMerge]), [[2, true], [0, false]]);
  assert.deepEqual(d.enemyScale, { atk: 2.1, hp: 3.58 });
  assert.equal(d.bonds.find(b => b.id === pack.bonds[0].id)?.kind, 'core');
  assert.ok(d.bonds.filter(b => b.id !== pack.bonds[0].id).every(b => b.kind === 'class'));
  assert.deepEqual(d.economy.levelOptions, [{ action: 'hold', fundsAfter: 8, mergesAffordable: 1, nextRoundPrice: 3 },
    { action: 'level', toLevel: 2, fundsAfter: 4, mergesAffordable: 1 }]);
  assert.deepEqual(levelOptions({ gold: 3, upgradePrice: 4, level: 2 }, [2, 2]), [{ action: 'hold', fundsAfter: 3, mergesAffordable: 1, nextRoundPrice: 3 }]);
});

test('a carry candidate leads with a core bond; the announced leader adds its community counter to finalAssault', () => {
  const book = buildPlaybook(DATA, { modeId: 'mode_single_abyss' });
  const core = new Set(book.bonds.filter(b => b.core).map(b => b.id));
  const prep = boss => strategyCandidates(book, { playerId: 'self', round: 4, band: { id: 'band_sarkazb' }, availability: {},
    board: [], bench: [], opponents: [], factions: [], economy: { level: 2 }, deployCap: 6, boss: { id: boss } }).candidates;
  const plain = prep('boss_1');
  assert.ok(plain.length >= 2);
  assert.ok(plain.filter(c => c.role === 'carry').every(c => core.has(c.main)), plain.map(c => c.main).join());
  const lucien = prep('boss_5').find(c => c.main === 'siracusaShip' && !c.build);
  const other = plain.find(c => c.main === 'siracusaShip' && !c.build);
  assert.ok(lucien && other, 'a generic 叙拉古 carry is offered against both leaders');
  assert.equal(lucien.scoreParts.finalAssault - other.scoreParts.finalAssault, 8);
  assert.ok(book.community.bossCounters.every(e => e.sources.length && e.bonds.every(id => core.has(id))));
});

test('a carried plan keeps only the funds direction of its economy', () => {
  assert.deepEqual(carryPlan({ bonds: [{ id: 'a', priority: 5 }], choice: 'a1', placements: [],
    economy: { level: 4, maxRefreshes: 0, refreshAbove: 100, holdLevel: true, why: 'x', saveForInterest: true, reserve: 5, freezeSearch: true } }),
  { bonds: [{ id: 'a', priority: 5 }], economy: { saveForInterest: true, reserve: 5 } });
  assert.deepEqual(carryPlan({ economy: { maxRefreshes: 0 } }), {});
});

function planSeat(t, plan) {
  const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', fake: true, botStrategy: 'external', externalReplay: true,
    externalAI: { mode: 'plan' } });
  t.after(() => h.m.dispose()); h.start().toPrep();
  const m = h.m, ps = m.order[0];
  m.externalAI.planFor = () => plan;
  ps.funds = 0; ps.shop.slots = []; ps.shop.frozen = false;
  return { m, ps, ids: m.gd.visibleChess.filter(id => m.pool.has(id)) };
}

test('a crowded R9+ bench frees keep-listed low tiers, and a full protected hand never sheds a tier 5/6 carry', t => {
  const { m, ps, ids } = planSeat(t, { keep: [] });
  const t2 = ids.find(id => m.gd.tierOf(id) === 2), t5 = ids.filter(id => m.gd.tierOf(id) >= 5);
  const plan = { keep: [t2] };
  m.externalAI.planFor = () => plan;
  m.round = 9;
  give(m, ps, t2);
  const low = ps.hand.find(p => p?.id === t2);
  assert.ok(advisorProtected(m, ps, low), 'keep-listed with a roomy bench');
  for (const id of t5) { if (!ps.hand.some(p => !p)) break; give(m, ps, id); }
  assert.equal(ps.hand.filter(p => !p).length, 0);
  assert.equal(advisorProtected(m, ps, low), false, 'crowded: the keep-listed tier 2 may go');
  assert.ok(sellWeakestHand(m, ps, { handOnly: true }));
  assert.ok(!ps.hand.some(p => p?.uid === low.uid));
  plan.keep = ps.hand.filter(Boolean).map(p => p.id);
  m.round = 3;
  const before = ps.allChess().length;
  assert.equal(sellWeakestHand(m, ps, { handOnly: true }), false, 'only tier 5/6 protected pieces left');
  assert.equal(ps.allChess().length, before);
});

const run = gen => { for (const step of gen) void step; };
function legacySeat(t) {
  const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', seats: [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }], seed: 3 });
  t.after(() => h.m.dispose()); h.start().toPrep();
  const m = h.m, ps = m.order[0];
  for (const p of ps.allChess()) ps.sell(p.uid);
  ps.funds = 0; ps.shop.freeRefreshes = 0; ps.shop.frozen = false;
  for (const slot of ps.shop.slots) if (slot) slot.sold = true;
  return { m, ps };
}

test('bots aim for level 5 at round 9 and stay there (§37.38: no level 6)', t => {
  const { m, ps } = legacySeat(t);
  const ids = DATA.chess ? Object.values(DATA.chess).filter(c => c.visible && !c.isGolden && c.tier <= 2).map(c => c.chessId) : [];
  for (const id of ids.slice(0, ps.deployCap)) give(m, ps, id, 'hand');
  for (const [round, from, to] of [[9, 4, 5], [11, 5, 5], [13, 5, 5], [8, 4, 4]]) {
    m.round = round; ps.shop.level = from; ps.shop.upgradePrice = 5; ps.funds = 6;
    levelUp(m, ps);
    assert.equal(ps.shop.level, to, `R${round}: level ${from} → ${to}`);
  }
  m.round = 12; ps.shop.level = 5; ps.shop.upgradePrice = 5; ps.funds = 100;
  levelUp(m, ps);
  assert.equal(ps.shop.level, 5, 'rich at level 5: still no level 6');
});

test('the layer trade buys a 获得时 layer unit of two active bonds and sells it again when the lineup does not take it', t => {
  const { m, ps } = legacySeat(t);
  m.round = 6;
  const KJERAG = ['chess_char_6_02_a', 'chess_char_5_14_a', 'chess_char_4_22_a'], STEAD = ['chess_char_6_03_a', 'chess_char_5_11_a', 'chess_char_4_01_a'];
  const OTHERS = Object.values(DATA.chess).filter(c => c.visible && !c.isGolden && c.tier >= 5 && !c.bonds.includes('kjeragShip')
    && !c.bonds.includes('steadShip')).map(c => c.chessId);
  for (const id of [...KJERAG, ...STEAD, ...OTHERS].slice(0, ps.deployCap)) give(m, ps, id, 'board', legalTileFor(m, ps, id));
  ps.recompute();
  assert.ok(ps.bonds.kjeragShip?.active && ps.bonds.steadShip?.active);
  const layers = { kjeragShip: ps.layers.kjeragShip || 0, steadShip: ps.layers.steadShip || 0 };
  ps.shop.slots[0] = { kind: 'chess', id: 'chess_char_1_02_a', basePrice: 2, sold: false, frozen: false }; // 角峰 +2
  ps.funds = 2;
  run(buyLoopSteps(m, ps, { maxRefreshes: 0 }));
  assert.equal(ps.shop.slots[0].sold, true);
  assert.ok(!ps.allChess().some(p => p.id === 'chess_char_1_02_a'), 'sold again');
  assert.equal(ps.funds, 1);
  assert.equal(ps.layers.kjeragShip, layers.kjeragShip + 2); assert.equal(ps.layers.steadShip, layers.steadShip + 2);
});
