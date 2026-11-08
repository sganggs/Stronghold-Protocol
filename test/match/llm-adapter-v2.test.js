// Round 65: the example LLM adapter v2 — "the bot is the floor, the LLM overrides" (tools/ai/llm-*.mjs,
// the measured priors in server/ai/strategy.js). Mock transports only: no socket, no real API, no hidden match state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DATA } from './harness.js';
import { bandStrength as botBandStrength } from '../../server/match/bot.js';
import { BAND_STRENGTH, bandStrength, lpWeight, draftPriors, strategyCandidates, LEVEL_CAP } from '../../server/ai/strategy.js';
import { knowledgePack } from '../../server/ai/knowledge.js';
import { buildPlaybook } from '../../server/ai/playbook.js';
import { COMMUNITY } from '../../server/ai/strategy-community.js';
import { createLLMAgent, advisorSystem, STRATEGY_PROMPT, BAND_TASK, CHOICE_TASK, SYSTEM_BUDGET, callRounds, callKinds, carriedPlan } from '../../tools/ai/llm-agent.mjs';
import { compactDigest, compactBot, compactFa, compactTeam, bondPanel, mainAtFive, draftDigest } from '../../tools/ai/llm-context.mjs';
import { slimKnowledge } from '../../tools/ai/llm-knowledge.mjs';
import { repairPlan, holdFloor } from '../../tools/ai/llm-plan.mjs';
import { validPlan } from '../../server/match/aiPlan.js';

const solo = knowledgePack(DATA, { modeId: 'mode_single_abyss' });
const coop = knowledgePack(DATA, { modeId: 'mode_multi_abyss' });
const ENV = { SP_LLM_BASE_URL: 'http://127.0.0.1:1', SP_LLM_MODEL: 'mock', SP_LLM_API_KEY: 'mock-key' };
const answer = content => ({ choices: [{ finish_reason: 'stop', message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] });
async function agentFor(pack, replies, env = {}) {
  const sent = [];
  const agent = createLLMAgent({ ...ENV, ...env }, async (_config, body) => { sent.push(structuredClone(body)); return answer(replies.shift()); });
  await agent({ v: 'sp-ai/1', type: 'hello', id: 'hello', knowledge: pack });
  return { agent, sent, user: (i = -1) => JSON.parse(sent.at(i).messages.at(-1).content) };
}
const ask = (agent, pack, kind, digest, id = `${kind}-${digest.round}`) => agent({ v: 'sp-ai/1', id, knowledgeVersion: pack.version,
  context: { mode: 'plan', kind, matchId: 'm' }, digest });
const chess = (id, uid, extra = {}) => ({ id, baseId: id.replace(/_b$/, '_a'), uid, kind: 'chess', stars: /_b$/.test(id) ? 2 : 1,
  name: DATA.chess[id].name, bonds: DATA.chess[id].bonds, ...extra });
const KJERAG = ['chess_char_1_02_a', 'chess_char_3_11_a', 'chess_char_3_14_a', 'chess_char_4_22_a', 'chess_char_5_14_a', 'chess_char_6_02_a'];

test('priors: the §37.46 strength table is bot.js bandStrength for every band, the mean for an unknown one; LP weight as botPickBand', () => {
  for (const id of [...Object.keys(DATA.bands), 'band_plugin_unknown']) {
    assert.equal(bandStrength('ABYSS', id), botBandStrength({ difficulty: 'ABYSS' }, id), id);
    assert.equal(bandStrength('HARD', id), botBandStrength({ difficulty: 'HARD' }, id), id);
  }
  for (const id of Object.keys(BAND_STRENGTH)) assert.ok(DATA.bands[id], `${id} is a band of the default data`);
  assert.equal(lpWeight(45, 'ABYSS'), 27 ** 3); assert.equal(lpWeight(28, 'HARD'), 100); assert.equal(lpWeight(17, 'ABYSS'), 1);
  assert.equal(LEVEL_CAP, 5);
});

test('draft priors: the host\'s shares win; else LP³ × strength over the offered bands; Touch forced once a teammate holds 歌利亚', () => {
  const book = buildPlaybook(DATA, { modeId: 'mode_multi_abyss' });
  const offered = ['band_sarkazb', 'band_amedic', 'band_amiya', 'band_pepe'];
  const p = draftPriors({ bands: book.bands, offered, difficulty: 'ABYSS', coop: true });
  const w = id => lpWeight(book.bands.find(b => b.id === id).lp, 'ABYSS') * bandStrength('ABYSS', id);
  const total = offered.reduce((n, id) => n + w(id), 0);
  for (const id of offered) assert.ok(Math.abs(p.shares.get(id) - w(id) / total) < 1e-12, id);
  assert.deepEqual([p.source, p.forced], ['prior', null]);
  const mates = [{ bandId: 'band_sarkazb' }];
  assert.equal(draftPriors({ bands: book.bands, offered: offered.slice(1), difficulty: 'ABYSS', coop: true, teammates: mates }).forced, 'band_amedic');
  assert.equal(draftPriors({ bands: book.bands, offered: offered.slice(1), difficulty: 'ABYSS', coop: false, teammates: mates }).forced, null);
  assert.equal(draftPriors({ bands: book.bands, offered: offered.slice(1), difficulty: 'HARD', coop: true, teammates: mates }).forced, null);
  assert.equal(draftPriors({ bands: book.bands, offered: offered.slice(1), difficulty: 'ABYSS', coop: true,
    teammates: [...mates, { bandId: 'band_amedic' }] }).forced, null, 'a teammate already holds Touch');
  const hosted = draftPriors({ bands: book.bands, offered, difficulty: 'ABYSS', coop: true, teammates: mates,
    bot: { bands: [{ id: 'band_amiya', share: 0.7 }, { id: 'band_sarkazb', share: 0.3 }], forced: null } });
  assert.deepEqual([hosted.source, hosted.forced, hosted.shares.get('band_amiya'), hosted.shares.get('band_amedic')], ['bot', null, 0.7, 0]);
  assert.equal(draftPriors({ bands: book.bands, offered, bot: { bands: [{ id: 'band_amiya', share: 1 }], forced: 'band_pepe' } }).forced, 'band_pepe');
  // A band whose bond the room switches off weighs 0 (DESIGN §21.26).
  assert.equal(draftPriors({ bands: book.bands, offered, difficulty: 'ABYSS', disabled: new Set(['sargonShip']) }).shares.get('band_pepe'), 0);
});

const draft = (extra = {}) => ({ playerId: 'self', round: 1, lp: 0, band: { id: null }, availability: { disabledBonds: [], bannedChess: [] },
  opponents: [{ playerId: 'mate1', lp: 45, bandId: 'band_sarkazb', bonds: [] }, { playerId: 'mate2', lp: 0, bandId: null, bonds: [] }],
  boss: { id: 'boss_5', name: '卢西恩', round: 14 },
  actions: ['band_amedic', 'band_amiya', 'band_pepe'].map((bandId, i) => ({ id: `a${i + 1}`, intent: { t: 'g.band', bandId }, text: `band ${bandId}` })),
  ...extra });

test('band draft: a choice-only call with the bot\'s shares and forced pick as the default; "bot" lets the bot pick', async () => {
  const { agent, user } = await agentFor(coop, [
    { why: 'Team medic.', choiceName: 'Touch', plan: { choice: 'a1' } },
    { why: 'Let the bot draw.', choiceName: 'bot', plan: { choice: 'bot' } },
    { why: 'Bot.', choiceName: 'bot', plan: {} },
    { why: 'Sargon supply.', choiceName: '佩佩', plan: {} },
    { why: 'Re-planned the prep too.', plan: { choice: 'a2', bonds: [{ id: 'sargonShip', priority: 5 }], economy: { level: 6 } } },
    { why: 'Host shares.', choiceName: 'bot', plan: { choice: 'bot' } },
  ]);
  assert.deepEqual((await ask(agent, coop, 'band', draft())).plan, { choice: 'a1' });
  const q = user();
  assert.equal(q.task, BAND_TASK);
  for (const k of ['strategy', 'continuity', 'choices']) assert.equal(q[k], undefined, k);
  assert.equal(q.digest.boss, undefined, 'no leader at the draft');
  assert.deepEqual(q.digest.teammates[1], { playerId: 'mate2', drafted: false }, 'an undrafted teammate is not "0 LP"');
  assert.deepEqual(q.digest.teammates[0].bandId, 'band_sarkazb');
  assert.equal(q.digest.mode, 'coop'); assert.equal(q.digest.difficulty, 'ABYSS');
  // Touch is the bot's rule pick (a teammate holds 歌利亚) and comes first; the rest by share, with the 职业队 bond.
  assert.deepEqual(q.bands.map(r => [r.choice, r.id, !!r.forced]), [['a1', 'band_amedic', true], ['a2', 'band_amiya', false], ['a3', 'band_pepe', false]]);
  assert.equal(q.bands.find(r => r.id === 'band_pepe').bond, 'sargonShip');
  assert.equal(q.bands.find(r => r.id === 'band_amedic').lp, 28);
  assert.ok(Math.abs(q.bands.reduce((n, r) => n + r.share, 0) - 100) < 0.2);
  assert.deepEqual((await ask(agent, coop, 'band', draft(), 'b2')).plan, {}, '"bot" leaves the window to botPickBand');
  assert.deepEqual((await ask(agent, coop, 'band', draft(), 'b3')).plan, {}, 'choiceName "bot" without a choice');
  assert.deepEqual((await ask(agent, coop, 'band', draft(), 'b4')).plan, { choice: 'a3' }, 'a missing choice follows the named band');
  assert.deepEqual((await ask(agent, coop, 'band', draft(), 'b5')).plan, { choice: 'a2' }, 'only plan.choice is executed at the draft');
  await ask(agent, coop, 'band', draft({ bot: { bands: [{ id: 'band_pepe', share: 0.6 }, { id: 'band_amiya', share: 0.4 }], forced: null } }), 'b6');
  assert.deepEqual(user().bands.map(r => [r.id, r.share, !!r.forced]), [['band_pepe', 60, false], ['band_amiya', 40, false], ['band_amedic', 0, false]]);
});

const prep = (extra = {}) => {
  const owned = [chess(KJERAG[0], 'u1', { row: 9, col: 3 }), chess(KJERAG[0], 'u2'), chess(KJERAG[3], 'u3', { row: 9, col: 4 }), chess('chess_char_5_14_b', 'u4', { row: 9, col: 5 })];
  return { playerId: 'self', round: 11, phase: 'PREP', lp: 30, deployCap: 8, band: { id: 'band_jesica' },
    availability: { disabledBonds: [], bannedChess: [KJERAG[2]], diyBanned: [] },
    economy: { gold: 9, level: 5, upgradePrice: 0, refreshPrice: 1, expiringFunds: 9 },
    board: owned.filter(p => p.row !== undefined), bench: owned.filter(p => p.row === undefined), overflow: [],
    shop: [{ ...chess(KJERAG[1], null), slot: 0, price: 3, tier: 3 }, { ...chess(KJERAG[0], null), slot: 1, price: 1, tier: 1 }],
    bonds: [{ bondId: 'kjeragShip', count: 3, active: true, layers: 120, nextThreshold: 6 }],
    upcoming: [], boss: { id: 'boss_5', round: 14 }, opponents: [], actions: [],
    feedback: { events: [], through: 0, lastBattle: { round: 10, lp: 30, lpLoss: 2, leaks: 2 }, acceptedPlan: null }, ...extra };
};

test('prep digest: digest.bot, digest.fa, the last battle and the main-bond panel pass through; an older host without them still works', async () => {
  const lastBattle = { round: 10, lp: 30, lpLoss: 2, killed: 40, total: 42,
    leaks: [{ enemyKey: 'enemy_x', name: 'X', count: 2, counted: 2, gates: ['upper'] }],
    units: Array.from({ length: 14 }, (_, i) => ({ uid: `u${i}`, id: KJERAG[3], name: '银灰', kind: 'chess', dmg: 1000 - i, kills: 1, taken: 5, heal: 0 })) };
  const d = prep({ bot: { focus: 'kjeragShip', second: 'swiftShip', levelTarget: 6, route: 'pager', secret: 'x' },
    fa: { pool: 3000000, alive: 1, clockSec: 120, drainPerSec: 1, teamLp: 30, stock: 9 }, lastBattle });
  const c = compactDigest(d, solo);
  assert.deepEqual(c.bot, { focus: 'kjeragShip', second: 'swiftShip', route: 'pager', levelTarget: 5 }, 'only known fields; the level target is capped at 5');
  assert.deepEqual(c.fa, { pool: 3000000, alive: 1, clockSec: 120, drainPerSec: 1, teamLp: 30, budgetSec: 150, dpsNeeded: 20000 });
  assert.equal(c.lastBattle.units.length, 12);
  assert.ok(c.lastBattle.units.every(u => !('uid' in u) && !('kind' in u)));
  assert.deepEqual(c.lastBattle.leaks, lastBattle.leaks);
  const [panel] = c.mainBonds;
  assert.equal(panel.id, 'kjeragShip'); assert.equal(panel.count, 3); assert.equal(panel.layers, 120);
  assert.deepEqual(panel.owned.map(o => [o.id, o.copies, !!o.elite]), [[KJERAG[0], 2, false], [KJERAG[3], 1, false], [KJERAG[4], 0, true]]);
  const missing = Object.values(panel.missing).flat().map(m => m.id);
  assert.ok(missing.includes(KJERAG[1]) && missing.includes(KJERAG[5]), 'unowned members by tier, tier 6 included');
  assert.ok(!missing.includes(KJERAG[2]), 'a banned member is not listed');
  assert.ok(!missing.some(id => [KJERAG[0], KJERAG[3], KJERAG[4]].includes(id)));
  assert.deepEqual(panel.inShop.map(s => [s.id, !!s.missing]), [[KJERAG[1], true], [KJERAG[0], false]]);
  assert.ok(!JSON.stringify(c).includes('secret') && !JSON.stringify(c).includes('stock'));
  // An older host: none of the new fields; the panel falls back to the band's or the best owned core bond.
  const old = compactDigest(prep(), solo);
  for (const k of ['bot', 'fa', 'lastBattle']) assert.equal(old[k], undefined, k);
  assert.equal(old.mainBonds[0].id, 'kjeragShip');
  assert.equal(compactBot({ bands: 'x', focus: 5 }), undefined); assert.equal(compactFa({ pool: -1 }), undefined);
  assert.equal(bondPanel(prep(), solo, 'missingBond'), null);
  // The prep question: no strategy candidates; the model sees digest.bot first-hand.
  const { agent, user } = await agentFor(solo, [{ why: 'Agree with the bot.', plan: {} }]);
  assert.deepEqual((await ask(agent, solo, 'prep', d)).plan, {});
  const q = user();
  assert.equal(q.strategy, undefined); assert.equal(q.task, undefined);
  assert.equal(q.digest.bot.focus, 'kjeragShip'); assert.equal(q.digest.fa.dpsNeeded, 20000);
  assert.equal(q.digest.mainBonds[0].id, 'kjeragShip');
});

test('repair: economy.level is clamped to 5, no L6 hold floor, a refresh cap needs a saving reason, keep ≤ 8 core ids, no placements', () => {
  const d = prep();
  const level = repairPlan({ economy: { level: 6 } }, solo, d, []);
  assert.deepEqual(level.plan.economy, { level: 5 });
  assert.ok(level.repairs.some(r => r.path === 'economy.level' && r.reason === 'clamped to 5'));
  assert.ok([9, 11, 13, 14].every(r => holdFloor(r) === 5));
  assert.equal(repairPlan({ economy: { level: 5, holdLevel: true, why: 'Finish the 谢拉格 pair first.' } }, solo, d, []).plan.economy.holdLevel, true,
    'an R11 hold at L5 is the bot\'s own level, not below an L6 floor');
  assert.equal(repairPlan({ economy: { level: 4, holdLevel: true, why: 'Cheaper next round.' } }, solo, { ...d, economy: { ...d.economy, level: 4 } }, [])
    .plan.economy.holdLevel, undefined);
  const caps = why => repairPlan({ economy: { maxRefreshes: 0, ...(why ? { why } : {}) } }, solo, d, []).plan.economy.maxRefreshes;
  assert.equal(caps(), undefined);
  assert.equal(caps('Buy the pair.'), undefined);
  assert.equal(caps('Save for interest on 坎诺特.'), 0);
  assert.equal(caps('攒钱下回合升级'), 0);
  assert.equal(repairPlan({ economy: { maxRefreshes: 2 } }, solo, d, []).plan.economy.maxRefreshes, undefined);
  assert.equal(repairPlan({ economy: { maxRefreshes: 3 } }, solo, d, []).plan.economy.maxRefreshes, 3);
  // keep: owned elites, pairs and members of the plan's bonds or the bot's focus, at most eight.
  const wide = { ...d, bot: { focus: 'kjeragShip' }, bench: [...d.bench, chess('chess_char_1_01_a', 'x1'),
    ...Array.from({ length: 9 }, (_, i) => chess(KJERAG[3], `k${i}`))] };
  const kept = repairPlan({ keep: ['chess_char_1_01_a', KJERAG[0], KJERAG[3], 'chess_char_5_14_b', KJERAG[1]] }, solo, wide, []);
  assert.deepEqual(kept.plan.keep, [KJERAG[0], KJERAG[3], 'chess_char_5_14_b']);
  assert.ok(kept.repairs.some(r => r.path === 'keep' && r.value === 'chess_char_1_01_a'), 'an owned off-plan single');
  assert.ok(kept.repairs.some(r => r.path === 'keep' && r.value === KJERAG[1]), 'not owned');
  const members = DATA.chess && Object.values(DATA.chess).filter(c => c.visible && !c.isGolden && c.bonds?.includes('kjeragShip')).map(c => c.chessId);
  const many = { ...d, bench: [...members, 'chess_char_1_01_a', 'chess_char_1_01_a'].map((id, i) => chess(id, `m${i}`)) };
  const capped = repairPlan({ bonds: [{ id: 'kjeragShip', priority: 5 }], keep: [...members, 'chess_char_1_01_a'] }, solo, many, []);
  assert.equal(capped.plan.keep.length, 8);
  assert.ok(capped.repairs.some(r => r.path === 'keep' && /keep cap 8/.test(r.reason)));
  const placed = repairPlan({ placements: [{ id: KJERAG[3], row: 9, col: 4 }] }, solo, d, []);
  assert.deepEqual(placed.plan, {}); assert.ok(placed.repairs.some(r => r.path === 'placements'));
  assert.ok(validPlan(capped.plan) && validPlan(level.plan));
});

test('no leader scoring: no community boss counters; the prompt and the draft task forbid leader-specific drafting', () => {
  assert.equal(COMMUNITY.bossCounters, undefined);
  assert.equal(buildPlaybook(DATA, { modeId: 'mode_single_abyss' }).community.bossCounters, undefined);
  const withOld = buildPlaybook(DATA, { modeId: 'mode_single_abyss', community: { ...COMMUNITY, bossCounters: [{ enemyKey: 'x', bonds: ['siracusaShip'] }] } });
  assert.equal(withOld.community.bossCounters, undefined, 'an older overlay\'s counters are ignored');
  assert.match(STRATEGY_PROMPT, /No leader-specific drafting/);
  assert.match(BAND_TASK, /Never draft for the leader/);
  for (const text of [STRATEGY_PROMPT, BAND_TASK, CHOICE_TASK]) {
    assert.doesNotMatch(text, /boss\/enemy factions demand|leader\/hidden-core counters|counter to the announced/);
  }
});

test('the system prompt stays within 50000 characters in every packaged language; the playbook is the measured one', () => {
  assert.equal(SYSTEM_BUDGET, 50000);
  for (const language of ['zh-CN', 'en', 'ja', 'ko', 'zh-TW']) for (const modeId of ['mode_single_abyss', 'mode_multi_abyss', 'mode_multi_hard']) {
    const system = advisorSystem(knowledgePack(DATA, { modeId, language }));
    assert.ok(system.length <= SYSTEM_BUDGET, `${language} ${modeId}: ${system.length} characters`);
  }
  assert.ok(advisorSystem(solo).length < 40000, 'the default Chinese 终极 prefix (182 045 characters before round 65)');
  assert.ok(STRATEGY_PROMPT.length < 7500);
  for (const fact of [/Level cap 5/, /120 s solo, 150 s co-op/, /No shop equipment except equipment merges/, /\+100 layers/,
    /Touch/, /歌利亚/, /backstop/, /distinct main bonds/, /Return \{\} to agree/, /digest\.mainBonds/, /budgetSec/]) {
    assert.match(STRATEGY_PROMPT, fact);
  }
  for (const contradicted of [/L6 at R11/, /150 real seconds/, /R3-R9 survival/, /Put items and multiplier layers/,
    /items\.buy:\[item id\] \(max 8/, /placements:\[/]) {
    assert.doesNotMatch(STRATEGY_PROMPT, contradicted);
  }
  // A content set that does not fit sheds the trait column instead of overflowing.
  const tight = slimKnowledge(solo, { maxChars: 20000 });
  assert.ok(!tight.operators.columns.includes('trait'));
  assert.ok(!tight.items.columns.includes('effect'));
});

test('cadence: SP_LLM_CALL_ROUNDS calls the model on its rounds; other preps keep the last accepted bonds and keep without a call', async t => {
  assert.deepEqual([...callRounds(' 1, 4,7 ')], [1, 4, 7]);
  assert.equal(callRounds(''), null); assert.equal(callRounds(undefined), null);
  for (const bad of ['0', 'a', '1,,2', '1;2', '100']) assert.throws(() => callRounds(bad), /LLM configuration/);
  assert.throws(() => createLLMAgent({ ...ENV, SP_LLM_CALL_ROUNDS: 'every' }), /^Error: LLM configuration$/);
  assert.deepEqual(carriedPlan({ bonds: [{ id: 'kjeragShip', priority: 5 }], keep: ['x'], economy: { level: 5 }, buy: ['y'] }),
    { bonds: [{ id: 'kjeragShip', priority: 5 }], keep: ['x'] });
  assert.deepEqual(carriedPlan(null), {});
  const dir = mkdtempSync(join(tmpdir(), 'sp-llm-cadence-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const debug = join(dir, 'debug.jsonl');
  const first = { bonds: [{ id: 'kjeragShip', priority: 5 }], keep: [KJERAG[0]], economy: { level: 5 } };
  const { agent, sent, user } = await agentFor(solo, [{ why: 'Hunt 谢拉格.', plan: first }, { why: 'Agree.', plan: {} }],
    { SP_LLM_CALL_ROUNDS: '9,11', SP_LLM_DEBUG_FILE: debug });
  const r9 = await ask(agent, solo, 'prep', prep({ round: 9 }), 'r9');
  assert.equal(sent.length, 1);
  const r10 = await ask(agent, solo, 'prep', prep({ round: 10, feedback: { events: [], through: 0, lastBattle: null,
    acceptedPlan: { id: 'r9', round: 9, plan: r9.plan } } }), 'r10');
  assert.equal(sent.length, 1, 'no model call outside the cadence');
  assert.deepEqual(r10.plan, { bonds: first.bonds, keep: first.keep });
  const r11 = await ask(agent, solo, 'prep', prep({ round: 11, feedback: { events: [{ seq: 1, round: 10, type: 'buy', id: KJERAG[1] }], through: 1,
    lastBattle: null, acceptedPlan: { id: 'r10', round: 10, plan: r10.plan } } }), 'r11');
  assert.equal(sent.length, 2);
  assert.deepEqual(r11.plan, {});
  const c = user().continuity;
  assert.deepEqual(c.previousPlan, r9.plan, 'the model\'s own last plan stays the baseline across a carried prep');
  assert.equal(c.carriedSince, true); assert.equal(c.round, 9);
  assert.deepEqual(c.outcome.events.map(e => e.seq), [1]); assert.equal(c.outcome.eventsComplete, true);
  // Without an accepted plan a prep outside the cadence answers {}; drafts and cards always call the model.
  const fresh = await agentFor(solo, [{ why: 'x', choiceName: 'bot', plan: { choice: 'bot' } }], { SP_LLM_CALL_ROUNDS: '9' });
  assert.deepEqual((await ask(fresh.agent, solo, 'prep', prep({ round: 3 }), 'p3')).plan, {});
  assert.equal(fresh.sent.length, 0);
  await ask(fresh.agent, solo, 'band', draft(), 'band');
  assert.equal(fresh.sent.length, 1);
  const stages = readFileSync(debug, 'utf8').trim().split('\n').map(l => JSON.parse(l).stage);
  assert.deepEqual(stages, ['ok', 'carried', 'ok']);
  assert.ok(!readFileSync(debug, 'utf8').includes('mock-key'));
});

test('card and reward calls: "bot" leaves the pick to the built-in bot, a missing choice follows choiceName, only plan.choice runs', async () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/llm-advisor.json', import.meta.url), 'utf8'));
  const pack = fixture.knowledge;
  const d = { ...fixture.digest, actions: [{ id: 'a1', intent: { t: 'g.reward', idx: 0 }, text: 'support' },
    { id: 'a2', intent: { t: 'g.reward', idx: 1 }, text: 'lead' }],
  rewards: [{ id: 'support', name: 'Support', kind: 'chess' }, { id: 'lead', name: 'Lead', kind: 'chess' }] };
  const { agent, user } = await agentFor(pack, [
    { why: 'The bot knows.', choiceName: 'bot', plan: { choice: 'bot' } },
    { why: 'Lead pairs.', choiceName: 'Lead', plan: {} },
    { why: 'Lead.', choiceName: 'Lead', plan: { choice: 'a2', keep: ['lead'] } },
  ]);
  assert.deepEqual((await ask(agent, pack, 'reward', d, 'w1')).plan, {});
  assert.equal(user().task, CHOICE_TASK);
  assert.deepEqual((await ask(agent, pack, 'reward', d, 'w2')).plan, { choice: 'a2' });
  assert.deepEqual((await ask(agent, pack, 'reward', d, 'w3')).plan, { choice: 'a2' });
});

test('§37.75: the plan\'s main (its highest-priority core bond) plays at priority 5; subs and class bonds keep theirs', () => {
  const core = solo.bonds.filter(b => b.core).map(b => b.id), cls = solo.bonds.find(b => !b.core).id;
  const repairs = [];
  const plan = { bonds: [{ id: cls, priority: 3 }, { id: core[0], priority: 1 }, { id: core[1], priority: 1 }] };
  mainAtFive(plan, solo, repairs);
  const main = [core[0], core[1]].sort()[0], other = main === core[0] ? core[1] : core[0];
  assert.deepEqual(plan.bonds.map(b => [b.id, b.priority]).sort(), [[cls, 3], [main, 5], [other, 1]].sort());
  assert.equal(repairs.length, 1); assert.equal(repairs[0].id, main);
  const same = { bonds: [{ id: core[0], priority: 5 }, { id: core[1], priority: 2 }] };
  mainAtFive(same, solo, repairs);
  assert.deepEqual(same.bonds, [{ id: core[0], priority: 5 }, { id: core[1], priority: 2 }]);
  const none = { bonds: [{ id: cls, priority: 2 }] };
  mainAtFive(none, solo, repairs);
  assert.deepEqual(none.bonds, [{ id: cls, priority: 2 }]);
  assert.equal(repairs.length, 1);
  const empty = {};
  mainAtFive(empty, solo, repairs);
  assert.deepEqual(empty, {});
});

test('round 65: a drawn bond stays in play (drawn, not off) and keeps its band\'s share; band rows carry their effect text', async () => {
  // prep digest: a drawn ban keeps the bond in the list, marked; an older host's disabled list still hides it
  const drawnPrep = prep({ availability: { disabledBonds: ['kjeragShip'], drawnBonds: ['kjeragShip'], bannedChess: [KJERAG[2]], diyBanned: [] } });
  const shown = compactDigest(drawnPrep, solo).bonds.find(b => b.id === 'kjeragShip');
  assert.equal(shown?.drawn, true); assert.equal(shown?.count, 3);
  const hidden = compactDigest(prep({ availability: { disabledBonds: ['kjeragShip'], bannedChess: [], diyBanned: [] } }), solo);
  assert.equal(hidden.bonds.find(b => b.id === 'kjeragShip'), undefined, 'without drawnBonds every listed bond is off');
  // band draft: 佩佩's 萨尔贡 drawn — marked bondDrawn, not bondOff, and weighted as usual; each row names its effect
  const { agent, user } = await agentFor(coop, [{ why: 'x', choiceName: 'bot', plan: { choice: 'bot' } }, { why: 'y', choiceName: 'bot', plan: { choice: 'bot' } }]);
  await ask(agent, coop, 'band', draft({ availability: { disabledBonds: ['sargonShip'], drawnBonds: ['sargonShip'], bannedChess: [] } }));
  const pepe = user().bands.find(r => r.id === 'band_pepe');
  assert.equal(pepe.bondDrawn, true); assert.equal(pepe.bondOff, undefined); assert.ok(pepe.share > 0);
  assert.match(pepe.effect, /博学多通/);
  await ask(agent, coop, 'band', draft({ availability: { disabledBonds: ['sargonShip'], bannedChess: [] } }), 'b-old');
  const old = user().bands.find(r => r.id === 'band_pepe');
  assert.equal(old.bondOff, true); assert.equal(old.share, 0, 'an older host: a listed bond is off and its band weighs 0');
  // the prompt states what the 职业队 bands give and the bots' real level schedule
  assert.match(STRATEGY_PROMPT, /only a discount, layers, funds or items/);
  assert.match(STRATEGY_PROMPT, /reaches L2 at R4/);
});

test('§37.84: the model\'s team line becomes the reply\'s note; digest.team reaches the model compacted; older hosts have none', async () => {
  const team = [{ playerId: 'mate1', round: 11, bonds: [{ id: 'swiftShip', priority: 2 }, { id: 'sargonShip', priority: 5 }], buy: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], note: 'Anchor, 萨尔贡.', noteRound: 11 },
    { playerId: 'mate2', round: 10, keep: ['x'] }];
  assert.deepEqual(compactTeam(team), [
    { playerId: 'mate1', round: 11, main: 'sargonShip', subs: ['swiftShip'], buy: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], note: 'Anchor, 萨尔贡.', noteRound: 11 },
    { playerId: 'mate2', round: 10, keep: ['x'] }]);
  assert.equal(compactTeam(undefined), undefined); assert.equal(compactTeam([]), undefined);
  const { agent, user } = await agentFor(coop, [
    { why: 'Distinct main.', team: 'Carry on 谢拉格, hunting 银灰. ' + 'x'.repeat(400), plan: { keep: [] } },
    { why: 'Touch.', team: 'Team medic.', choiceName: 'Touch', plan: { choice: 'a1' } },
    { why: 'No line.', plan: {} },
  ]);
  const r = await ask(agent, coop, 'prep', prep({ team }));
  assert.equal(user().digest.team[0].main, 'sargonShip');
  assert.ok(r.note.startsWith('Carry on 谢拉格')); assert.equal(r.note.length, 200);
  const band = await ask(agent, coop, 'band', draft({ team }));
  assert.equal(user().digest.team[1].playerId, 'mate2');
  assert.equal(band.note, 'Team medic.');
  const none = await ask(agent, coop, 'prep', prep(), 'p2');
  assert.equal(none.note, undefined); assert.equal(user().digest.team, undefined);
  assert.match(STRATEGY_PROMPT, /team channel/); assert.match(BAND_TASK, /digest\.team/);
});

test('review: a plan without a bonds array leaves the main to the bot; a bonds array that changes the main needs a pivot; keep sees the final bonds', async () => {
  const { agent } = await agentFor(solo, [
    { why: 'Name a main.', pivot: false, pivotReason: '', plan: { bonds: [{ id: 'kjeragShip', priority: 2 }] } },
    { why: 'Only the economy and a keep.', pivot: false, pivotReason: '', plan: { economy: { reserve: 1 }, keep: [KJERAG[3]] } },
    { why: 'A new main after a prep without one.', pivot: false, pivotReason: '', plan: { bonds: [{ id: 'yanShip', priority: 5 }] } },
    { why: 'Unexplained change back.', pivot: false, pivotReason: '', plan: { bonds: [{ id: 'kjeragShip', priority: 5 }], keep: [KJERAG[3]] } },
  ]);
  const base = { bot: { focus: 'yanShip', second: null }, availability: { disabledBonds: [], bannedChess: [], diyBanned: [] } };
  const feedback = (id, round, plan) => ({ events: [], through: 0, lastBattle: null, acceptedPlan: { id, round, plan } });
  const first = await ask(agent, solo, 'prep', prep({ ...base, round: 10 }), 'p10');
  assert.deepEqual(first.plan.bonds, [{ id: 'kjeragShip', priority: 5 }], 'the main plays at priority 5');
  const second = await ask(agent, solo, 'prep', prep({ ...base, round: 11, feedback: feedback('p10', 10, first.plan) }), 'p11');
  assert.equal(second.plan.bonds, undefined, 'no bonds array: this prep\'s main is the bot\'s');
  assert.deepEqual(second.plan.keep, [], 'and 银灰 is no member of the bot\'s focus or of any plan bond here');
  const third = await ask(agent, solo, 'prep', prep({ ...base, round: 12, feedback: feedback('p11', 11, second.plan) }), 'p12');
  assert.deepEqual(third.plan.bonds, [{ id: 'yanShip', priority: 5 }], 'a main after a prep without one is no pivot');
  const fourth = await ask(agent, solo, 'prep', prep({ ...base, round: 13, feedback: feedback('p12', 12, third.plan) }), 'p13');
  assert.deepEqual(fourth.plan.bonds, [{ id: 'yanShip', priority: 5 }], 'the unexplained change keeps the last main');
  assert.deepEqual(fourth.plan.keep, [], 'and the keep filter sees that main, not the rejected one');
});

test('review: a drawn bond is visible even with nothing owned (the bot\'s focus above all); the draft lists it apart; strategy candidates keep its band', () => {
  const availability = { disabledBonds: ['yanShip', 'sargonShip'], drawnBonds: ['yanShip', 'sargonShip'], bannedChess: [], diyBanned: [] };
  const c = compactDigest(prep({ availability, bot: { focus: 'yanShip' } }), solo);
  assert.equal(c.bonds.find(b => b.id === 'yanShip')?.drawn, true);
  assert.equal(c.mainBonds.find(p => p.id === 'yanShip')?.drawn, true);
  const q = draftDigest(draft({ availability }), coop);
  assert.deepEqual(q.availability.disabledBonds, []); assert.deepEqual(q.availability.drawnBonds, ['yanShip', 'sargonShip']);
  const book = buildPlaybook(DATA, { modeId: 'mode_multi_abyss' });
  const bandsOf = a => strategyCandidates(book, draft({ availability: a, actions: ['band_pepe', 'band_amiya'].map((bandId, i) => ({ id: `a${i + 1}`, intent: { t: 'g.band', bandId } })) })).candidates?.map(x => x.band ?? x.bandId);
  assert.ok(bandsOf({ disabledBonds: ['sargonShip'], drawnBonds: ['sargonShip'], bannedChess: [] }).includes('band_pepe'), 'a drawn 萨尔贡 keeps 佩佩');
  assert.ok(!bandsOf({ disabledBonds: ['sargonShip'], bannedChess: [] }).includes('band_pepe'), 'a never-active one drops it');
});

test('single-decision arms: SP_LLM_KINDS calls the model only for the listed kinds, the others answer {} without a call', async () => {
  assert.equal(callKinds(undefined), null); assert.equal(callKinds(''), null);
  assert.deepEqual([...callKinds('prep,band')], ['prep', 'band']);
  assert.throws(() => callKinds('prep,nope'), /LLM configuration/);
  const { agent, sent } = await agentFor(coop, [{ why: 'Agree.', plan: {} }], { SP_LLM_KINDS: 'prep', SP_LLM_CALL_ROUNDS: '14,15' });
  assert.deepEqual((await ask(agent, coop, 'band', draft())).plan, {});
  assert.deepEqual((await ask(agent, coop, 'card', prep({ round: 9 }), 'c9')).plan, {});
  assert.deepEqual((await ask(agent, coop, 'prep', prep({ round: 9 }), 'p9')).plan, {}, 'outside the rounds: nothing to carry');
  assert.equal(sent.length, 0, 'no model call yet');
  await ask(agent, coop, 'prep', prep({ round: 14 }), 'p14');
  assert.equal(sent.length, 1);
});
