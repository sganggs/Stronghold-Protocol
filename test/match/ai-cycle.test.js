import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from './harness.js';
import { buildPlaybook } from '../../server/ai/playbook.js';
import { COMMUNITY } from '../../server/ai/strategy-community.js';
import { strategyCandidates } from '../../server/ai/strategy.js';
import { knowledgePack } from '../../server/ai/knowledge.js';
import { createLLMAgent } from '../../tools/ai/llm-agent.mjs';

const modeId = 'mode_multi_normal', book = buildPlaybook(DATA, { modeId });
const op = id => book.operators.find(c => c.id === id);
const gains = id => op(id).events.filter(e => e.event === 'SERVER_GAIN');
const digest = () => ({ playerId: 'self', round: 6, lp: 24, band: { id: 'band_lisa' }, economy: { level: 5, gold: 10 },
  board: [], bench: [], factions: [], opponents: [], shop: [{ id: 'chess_char_4_19_a', price: 3 }],
  bonds: [{ bondId: 'investShip', active: true, layers: 100 }, { bondId: 'visiShip', active: true, layers: 150 }] });
const candidates = (d, b = book) => strategyCandidates(b, d).candidates.filter(c => c.build === 'meter-backwards');

test('cycle rules use current part-two thresholds, stock-dependent packaging and explicit source disagreements', () => {
  const c = book.cycles;
  assert.deepEqual(c.foresight.income, { every: 10, funds: 2 });
  assert.deepEqual(c.foresight.discounts.map(d => [d.layers, d.scope, d.amount]), [[80, 'visiShip', 1], [150, 'all', 1]]);
  assert.deepEqual(c.investor.repeats, [{ layers: 0, count: 2 }, { layers: 100, count: 3 }]);
  assert.equal(c.minimumShopLevel, 5); assert.deepEqual(c.engine.map(e => e.need), [2, 3]);
  assert.deepEqual(c.packages.map(p => p.sales), [8, 7]); assert.match(c.saleRule, /not to hand/);
  assert.ok(c.disagreements.some(d => d.rule === 'investorTriple' && d.value === 70 && d.actual === 100));
  assert.ok(c.disagreements.some(d => d.rule === 'foresightGlobalDiscount' && d.value === 100 && d.actual === 150));
  assert.ok(c.disagreements.some(d => d.rule === 'event-timing' && d.actual[0].event === 'SERVER_PREP_FIN'));
});

test('on-acquire layer derivation preserves owned bonds, explicit bonds and normal/elite quantities', () => {
  assert.equal(gains('chess_char_3_18_a')[0].count, 6);
  assert.deepEqual(gains('chess_char_3_18_a')[0].bonds, ['siracusaShip', 'swiftShip']);
  assert.equal(gains('chess_char_3_11_a')[0].count, 5);
  assert.equal(op('chess_char_3_11_a').eliteEvents.find(e => e.event === 'SERVER_GAIN').count, 10);
  assert.equal(gains('chess_char_1_03_a')[0].method, 'shoplv');
  assert.deepEqual(gains('chess_char_5_03_a')[0].bonds, ['yanShip', 'victoriaShip']);
  assert.deepEqual(gains('chess_char_5_23_a')[0].counts, [6, 3]);
  assert.equal(gains('chess_char_5_23_a').filter(e => e.bonds?.includes('miraShip')).length, 1,
    'the redundant single-bond trait must not double-count the multi-bond grant');
});

test('funds, copies and item grants do not confuse battle talents, next-round income or prep-end counters', () => {
  const funds = gains('chess_char_3_01_a')[0];
  assert.equal(funds.kind, 'funds'); assert.equal(funds.count, 1); assert.equal(funds.payout, 'next-round');
  assert.equal(gains('chess_char_3_04_a').length, 0, 'Swire Alter is prep-end income, not on-acquire');
  assert.equal(op('chess_char_3_04_a').events[0].event, 'SERVER_PREP_FIN');
  assert.equal(op('chess_char_3_04_a').events[0].payout, 'next-round');
  assert.equal(gains('chess_char_5_17_a').length, 0, 'Mountain tallies acquisitions at prep end');
  assert.equal(op('chess_char_5_17_a').events[0].method, 'round_gain_char');
  assert.equal(op('chess_char_5_17_a').events[0].boardOnly, true);
  assert.equal(gains('chess_char_4_22_a').length, 0, 'SilverAsh battle reveal is not acquisition');
  const copies = gains('chess_char_4_19_a')[0];
  assert.equal(copies.kind, 'operators'); assert.equal(copies.count, 1);
  assert.deepEqual(copies.options.map(o => o.id), ['chess_char_1_19_a', 'chess_char_2_18_a', 'chess_char_4_20_a']);
  assert.equal(gains('chess_char_3_03_a')[0].kind, 'items');
});

test('variants distinguish named members present in this roster from derived alternatives and acquisition support', () => {
  const yan = book.cycles.variants.find(v => v.id === 'yan-victoria');
  assert.deepEqual(yan.present, ['chess_char_5_17_a', 'chess_char_3_04_a']);
  assert.equal(yan.missing.length, 3);
  assert.ok(yan.cycleMembers.includes('chess_char_4_17_a'));
  assert.ok(yan.acquisitionSupport.includes('chess_char_2_04_a'));
  assert.ok(book.cycles.variants.find(v => v.id === 'siracusa').cycleMembers.includes('chess_char_3_18_a'));
  assert.deepEqual(book.cycles.variants.find(v => v.id === 'kjerag').present, ['chess_char_3_11_a', 'chess_char_4_22_a']);
});

test('regeneration discovers a new cycle member and changed thresholds without naming the operator in code', () => {
  const data = structuredClone(DATA);
  data.chess.fixture_cycle = { chessId: 'fixture_cycle', name: 'Cycle fixture', tier: 2, visible: true, isGolden: false,
    bonds: ['siracusaShip', 'investShip'], garrisonIds: ['fixture_gain'] };
  data.garrisons.fixture_gain = { eventType: 'SERVER_GAIN', effectKey: 'SERVER_ADD_BOND_CHESS_ALL', bb: { count: 7 }, bbStr: {}, desc: 'Fixture layer grant' };
  data.bonds.investShip.buffs[1].bb.layer = 70;
  data.bonds.investShip.layerMilestones[0].layer = 70;
  data.bonds.visiShip.buffs[1].bb.layer2 = 100;
  const changed = buildPlaybook(data, { modeId });
  assert.equal(changed.cycles.minimumShopLevel, 3);
  assert.equal(changed.operators.find(c => c.id === 'fixture_cycle').events[0].count, 7);
  assert.ok(changed.cycles.variants.find(v => v.id === 'siracusa').cycleMembers.includes('fixture_cycle'));
  assert.equal(changed.cycles.investor.repeats[1].layers, 70);
  assert.equal(changed.cycles.foresight.discounts[1].layers, 100);
  assert.ok(!changed.cycles.disagreements.some(d => d.rule === 'investorTriple'));
  const unresolved = buildPlaybook(DATA, { modeId, community: { ...COMMUNITY,
    builds: [{ id: 'meter-backwards', status: 'unresolved', bonds: ['visiShip', 'investShip'] }] } });
  assert.equal(unresolved.cycles.available, false);
  assert.equal(candidates(digest(), unresolved).length, 0, 'older overlays without variant evidence must not invent it');
});

test('draft and prep can propose the cycle with data-feasible shop hold and current readiness', () => {
  const prep = candidates(digest());
  assert.ok(prep.some(c => c.variant === 'suzuran-pinus' && c.status === 'ready'));
  assert.ok(prep.every(c => c.shopHold === 5 && c.subs.includes('investShip') && c.subs.includes('visiShip')));
  const d = { ...digest(), round: 1, bonds: [], economy: { level: 1, gold: 4 }, actions: [
    { id: 'choose-lisa', intent: { t: 'g.band', bandId: 'band_lisa' } },
  ] };
  assert.ok(candidates(d).some(c => c.choice === 'choose-lisa' && c.status === 'setup'));
  d.actions = []; d.economy.gold = 0;
  assert.ok(candidates(d).every(c => c.status === 'setup'), 'future funds are never marked spendable now');
});

test('cycle rejects engine bans, insufficient natural members, cheap-pool contention and unsafe early pressure', () => {
  for (const id of ['investShip', 'visiShip']) assert.equal(candidates({ ...digest(), availability: { disabledBonds: [id] } }).length, 0);
  assert.equal(candidates({ ...digest(), availability: { bannedChess: ['chess_char_5_14_a', 'chess_char_5_17_a'] } }).length, 0);
  assert.equal(candidates({ ...digest(), opponents: [{ playerId: 'other', bandId: 'band_bldsk',
    board: [{ id: 'chess_char_2_19_a' }, { id: 'chess_char_3_04_a' }] }] }).length, 0);
  assert.equal(candidates({ ...digest(), lp: 6 }).length, 0);
  assert.equal(candidates({ ...digest(), feedback: { lastBattle: { leaks: 3 } } }).length, 0);
  const short = buildPlaybook(DATA, { modeId: 'mode_multi_funny' });
  assert.equal(candidates(digest(), short).length, 0);
});

test('known gifted investors/growers and an owned package permit a level-four hold without inventing future gifts', () => {
  const d = { ...digest(), band: { id: 'band_malkie' }, economy: { level: 4, gold: 5 },
    bench: [{ id: 'chess_char_5_17_a' }, { id: 'chess_item_5_07_e_a', kind: 'item' }] };
  const found = candidates(d).find(c => c.variant === 'yan-victoria');
  assert.ok(found); assert.equal(found.shopHold, 4); assert.ok(found.preconditions.package.owned);
  assert.ok(found.members.engine.includes('chess_char_5_17_a'));
  assert.ok(!found.members.cycle.includes('chess_char_5_03_a'), 'cannot promise to repeatedly buy tier five from level four');
});

test('example prompt receives cycle evidence through an in-process mock transport without any API/socket', async () => {
  let sent;
  const pack = knowledgePack(DATA, { modeId });
  const agent = createLLMAgent({ SP_LLM_BASE_URL: 'http://127.0.0.1:1', SP_LLM_MODEL: 'mock', SP_LLM_API_KEY: 'mock' }, async (_config, body) => {
    sent = body;
    return { choices: [{ finish_reason: 'stop', message: { content: '{"why":"Preserve the funded engine.","plan":{}}' } }] };
  });
  await agent({ v: 'sp-ai/1', type: 'hello', id: 'hello', knowledge: pack });
  const reply = await agent({ v: 'sp-ai/1', id: 'prep', knowledgeVersion: pack.version, context: { mode: 'plan', kind: 'prep', matchId: 'cycle-test' }, digest: digest() });
  assert.deepEqual(reply.plan, {});
  assert.ok(JSON.parse(sent.messages[1].content).strategy.candidates.some(c => c.build === 'meter-backwards'));
  assert.match(sent.messages[0].content, /shopHold means stop upgrading/);
  assert.match(sent.messages[0].content, /cannot automate an arbitrary repeated buy\/sell/);
});
