import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { DATA, makeMatch, give } from './harness.js';
import { buildPlaybook } from '../../server/ai/playbook.js';
import { COMMUNITY } from '../../server/ai/strategy-community.js';
import { strategyCandidates, enemyProfile } from '../../server/ai/strategy.js';
import { knowledgePack } from '../../server/ai/knowledge.js';
import { aiObservation } from '../../server/match/externalAI.js';
import { createLLMAgent, STRATEGY_PROMPT } from '../../tools/ai/llm-agent.mjs';

const modeId = 'mode_multi_normal', book = buildPlaybook(DATA, { modeId });
const band = id => book.bands.find(b => b.id === id);
const digest = (id = 'band_bldsk') => ({ playerId: 'self', round: 4, band: { id }, availability: {},
  board: [], bench: [], opponents: [], factions: [], economy: { level: 3 }, deployCap: 8 });
const draft = extra => ({ ...digest(), actions: book.bands.map((b, i) => ({ id: `a${i}`, intent: { t: 'g.band', bandId: b.id } })), ...extra });

test('recommended level curves use stage operator tiers and mode costs; measured legacy is scoped and labeled', () => {
  const hard = buildPlaybook(DATA, { modeId: 'mode_multi_hard' });
  assert.equal(hard.legacyReference.config, 'coop4:HARD');
  assert.deepEqual(hard.legacyReference.checkpoints.map(c => c.round), [4, 7, 10, 13]);
  assert.equal(book.legacyReference, null, 'do not pass hard-mode measurements off as normal-mode results');
  const candidates = strategyCandidates(hard, digest()).candidates;
  assert.ok(candidates.length);
  for (const c of candidates) for (const r of c.levelCurve) {
    assert.equal(r.level, Math.min(c.shopHold || hard.maxShopLevel, r.targetTier, hard.recommendedSchedule.find(s => s.round === r.round).level));
    assert.ok(r.keyDrawShareBeforePurchases >= 0 && r.keyDrawShareBeforePurchases <= 1);
    assert.match(r.basis, /ASSUMED/);
  }
  assert.deepEqual(hard.recommendedSchedule.filter(r => [4, 7, 10, 13].includes(r.round)).map(r => r.level), [2, 4, 5, 6]);
});

test('current data classifies engines and derives exact band implications from buff parameters', () => {
  assert.equal(band('band_duyaoy').roleClass, 'bond-engine');
  assert.deepEqual(band('band_duyaoy').bondIds, ['yanShip']);
  assert.equal(band('band_amiya').roleClass, 'wide-bond');
  assert.match(band('band_amiya').insights[0].mechanic, /3\+ active: ATK \+20%/);
  assert.equal(band('band_yu').insights[0].parameters.count1, 36);
  assert.equal(band('band_yu').insights[0].parameters.round, 8);
  assert.equal(band('band_bldsk').insights[0].kind, 'mixed-tier');
  assert.equal(band('band_bldsk').insights[0].parameters.layer, 2);
  assert.equal(band('band_dusk').insights[0].parameters.atk, 0.3);
  assert.equal(band('band_ioleta').insights[0].parameters.atk_per_cnt, 0.1);
  assert.equal(band('band_amedic').insights[0].parameters.cnt, 2);
  assert.equal(band('band_chen').insights[0].kind, 'weakness');
  assert.deepEqual(band('band_fang').beaconRounds, [8, 10, 12, 14]);
  assert.ok(band('band_fang').roleClasses.includes('team-support'));
  assert.ok(band('band_cannot').carriesFunds);
  assert.equal(book.leaderHitLimit, 300000);
});

test('graph, tier membership, capability hints and threshold estimates are reproducible and data-derived', () => {
  assert.deepEqual(buildPlaybook(structuredClone(DATA), { modeId }), book);
  const laterano = book.bonds.find(b => b.id === 'lateranoShip');
  assert.ok(laterano.pairings.some(b => b.id === 'preciShip'));
  for (const edge of book.graph) {
    const members = edge.operators.map(id => book.operators.find(c => c.id === id));
    assert.ok(members.every(c => edge.bonds.every(b => c.bonds.includes(b))));
    assert.equal(edge.weight, +members.reduce((n, c) => n + 1 / c.tier, 0).toFixed(4));
  }
  assert.ok(book.bonds.find(b => b.id === 'steadShip').thresholds[0].estimatedRound > 0);
  assert.equal(book.bonds.find(b => b.id === 'yanShip').thresholds[2].estimatedRound, null, 'nine natural members exceed eight slots');
  assert.ok(book.operators.find(c => c.id === 'chess_char_4_22_a').capabilities.reveal);
  assert.ok(book.operators.find(c => c.id === 'chess_char_2_05_a').capabilities.elementRecovery);
  assert.equal(book.operators.find(c => c.id === 'chess_char_6_09_a').capabilities.elementRecovery, false, 'element offense is not recovery');
  assert.ok(book.bonds.every(b => b.thresholds.every(t => t.estimatedRound === null || t.estimatedRound <= 14)));
});

test('community suggestions retain provenance, resolved cycle sources and explicit disagreement flags', () => {
  assert.equal(band('band_ermengard').communityMain.main, 'egirShip');
  assert.deepEqual(band('band_ermengard').bondIds, []);
  assert.ok(book.community.builds.some(b => b.id === 'meter-backwards' && b.available && b.sources.length === 5));
  assert.ok(book.community.pairs.every(p => p.source.includes('2026-10-19')));
  const community = { ...COMMUNITY, mains: [
    { band: 'band_duyaoy', main: 'egirShip', source: 'test counterexample' },
    { band: 'removed-band', main: 'yanShip', source: 'old version' },
  ] };
  const changed = buildPlaybook(DATA, { modeId, community });
  assert.ok(changed.warnings.some(w => w.kind === 'main-disagreement' && w.dataBondIds.includes('yanShip')));
  assert.ok(changed.warnings.some(w => w.kind === 'unavailable-community-main'));
  assert.deepEqual(changed.bands.find(b => b.id === 'band_duyaoy').bondIds, ['yanShip']);
});

test('another content version changes members, graph, mechanics and knowledge hash without editing the generator', () => {
  const data = structuredClone(DATA);
  data.bands.band_yu.buffs[0].bb.count1 = 17;
  data.chess.chess_char_1_01_a.bonds = ['yanShip', 'arcaneShip'];
  const changed = buildPlaybook(data, { modeId });
  assert.equal(changed.bands.find(b => b.id === 'band_yu').insights[0].parameters.count1, 17);
  assert.ok(changed.graph.some(e => e.bonds.includes('yanShip') && e.bonds.includes('arcaneShip') && e.operators.includes('chess_char_1_01_a')));
  assert.notEqual(knowledgePack(data, { modeId }).version, knowledgePack(DATA, { modeId }).version);
});

test('draft keeps at most eight legal directions and prep collapses one band and main', () => {
  const d = draft({ availability: { disabledBonds: ['yanShip', 'preciShip'], bannedChess: ['chess_char_1_01_a'] } });
  const result = strategyCandidates(book, d);
  assert.ok(result.candidates.length > 4 && result.candidates.length <= 8);
  for (const c of result.candidates) {
    assert.ok(!['yanShip', 'preciShip'].some(id => [c.main, ...c.subs].includes(id)));
    assert.notEqual(c.band, 'band_duyaoy');
    assert.ok(!JSON.stringify(c.stages).includes('chess_char_1_01_a'));
    assert.equal(d.actions.find(a => a.id === c.choice).intent.bandId, c.band);
  }
  const prep = strategyCandidates(book, digest('band_duyaoy'));
  assert.ok(prep.candidates.length >= 1 && prep.candidates.length <= 4);
  assert.ok(prep.candidates.every(c => c.band === 'band_duyaoy' && c.main === 'yanShip' && c.subs.length <= 2));
  const direction = prep.candidates.find(c => c.id === 'band_duyaoy:yanShip');
  assert.ok(direction.subOptions.length >= 2);
  assert.equal(new Set(prep.candidates.map(c => c.id)).size, prep.candidates.length);
});

test('public teammate engines and boards penalize contention, while acknowledged progress supports continuity', () => {
  const d = digest('band_duyaoy'), alone = strategyCandidates(book, d).candidates[0];
  d.opponents = [{ playerId: 'other', bandId: 'band_duyaoy', bonds: [], board: [{ id: 'chess_char_1_03_a' }] }];
  const conflict = strategyCandidates(book, d).candidates.find(c => c.id === alone.id);
  assert.ok(conflict.scoreParts.contention <= -26);
  assert.ok(conflict.score < alone.score);
  const continued = strategyCandidates(book, d, { bonds: [{ id: 'yanShip', priority: 5 }] }).candidates[0];
  assert.equal(continued.scoreParts.continuity, 14);
  const choices = strategyCandidates(book, draft({ opponents: d.opponents })).candidates;
  assert.ok(choices.every(c => c.main !== 'yanShip'));
});

test('announced special factions and boss escorts require separate air, reveal and element counters', () => {
  const d = { ...digest('band_duyaoy'), factions: ['INVISIBLE', 'ELEMENT'], boss: { id: 'boss_1' } };
  const profile = enemyProfile(book, d);
  assert.deepEqual(profile.needs, ['air', 'reveal', 'elementRecovery']);
  assert.ok(profile.repeatedHits); assert.ok(profile.checks.some(s => s.includes('voided')));
  const candidates = strategyCandidates(book, d).candidates;
  assert.ok(candidates.every(c => c.coverageRepairs.length === 3));
  for (const c of candidates) for (const repair of c.coverageRepairs) for (const id of repair.options)
    assert.ok(book.operators.find(o => o.id === id).capabilities[repair.need]);
  assert.notDeepEqual(candidates.map(c => c.score), strategyCandidates(book, digest('band_duyaoy')).candidates.map(c => c.score));
});

test('safety-net, supplier and economy roles are grounded in mechanics and public missing members', () => {
  const d = { ...digest('band_fang'), factions: ['ELEMENT'], opponents: [{ playerId: 'other', bandId: 'band_paganini', board: [] }] };
  const c = strategyCandidates(book, d).candidates[0];
  assert.equal(c.role, 'supplier'); assert.ok(c.supplierTargets[0].operators.length);
  assert.ok(c.implications.some(i => i.kind === 'supplier'));
  assert.equal(strategyCandidates(book, digest('band_ioleta')).candidates[0].role, 'safety-net');
  assert.equal(strategyCandidates(book, digest('band_cannot')).candidates[0].role, 'economy');
  assert.notEqual(strategyCandidates(book, digest('band_fang')).candidates[0].role, 'supplier');
});

test('seat-visible generation is unchanged by hidden holdings/funds/pool, and consumes no match RNG', t => {
  const h = makeMatch({ humans: 2, fake: true }); t.after(() => h.m.dispose()); h.start().toPrep();
  const ps = h.m.order[0], other = h.m.order[1];
  const observe = () => aiObservation(h.m, ps, { id: 'test', kind: 'prep', remaining: 64, deadline: 100 }, []);
  const before = strategyCandidates(book, observe().digest);
  give(h.m, other, h.m.gd.visibleChess[0]); other.funds = 987654321;
  const rng = [h.m.rngBots.state(), h.m.rngShop.state()];
  const after = strategyCandidates(book, observe().digest);
  assert.deepEqual(after, before);
  assert.deepEqual([h.m.rngBots.state(), h.m.rngShop.state()], rng);
  assert.ok(!JSON.stringify(after).includes('987654321'));
});

test('LLM mock receives staged candidates at draft and prep, preserving static prefix and private reply shape', async () => {
  const calls = [];
  const pack = knowledgePack(DATA, { modeId });
  const agent = createLLMAgent({ SP_LLM_BASE_URL: 'http://127.0.0.1:1', SP_LLM_MODEL: 'mock', SP_LLM_API_KEY: 'mock' }, async (_config, call) => {
    calls.push(call);
    const user = JSON.parse(call.messages[1].content), first = user.strategy.candidates[0];
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ why: 'Continue the supported direction.',
      pivot: false, pivotReason: '', plan: user.kind === 'band' ? { choice: first.choice } : {} }) } }] };
  });
  await agent({ v: 'sp-ai/1', type: 'hello', id: 'hello', knowledge: pack });
  for (const kind of ['band', 'prep']) {
    const reply = await agent({ v: 'sp-ai/1', id: kind, knowledgeVersion: pack.version, context: { mode: 'plan', kind, matchId: 'test' },
      digest: kind === 'band' ? draft() : digest('band_duyaoy') });
    assert.equal(reply.why, undefined);
    const user = JSON.parse(calls.at(-1).messages[1].content);
    const cap = kind === 'band' ? 8 : 4;
    assert.ok(user.strategy.candidates.length >= 1 && user.strategy.candidates.length <= cap);
    if (kind === 'band') assert.ok(user.strategy.candidates.length > 4);
    assert.ok(user.strategy.candidates.every(c => c.stages.length === 4 && c.pivotConditions.length));
  }
  assert.equal(calls[0].messages[0].content, calls[1].messages[0].content);
  assert.match(STRATEGY_PROMPT, /strategy.candidates/); assert.match(STRATEGY_PROMPT, /pivotReason/);
});

test('offline CLI emits repeatable evidence hashes and rejects an unknown version mode', () => {
  const args = ['tools/ai/playbook.mjs', '--mode', modeId];
  const run = () => execFileSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 4e6 });
  const a = run(); assert.equal(a, run());
  const output = JSON.parse(a); assert.deepEqual(output.playbook, book);
  assert.match(output.inputHashes.chess, /^[a-f0-9]{64}$/);
  assert.ok(Object.keys(output.codeHashes).length >= 5);
  assert.throws(() => execFileSync(process.execPath, ['tools/ai/playbook.mjs', '--mode', 'missing'], { stdio: 'pipe' }));
});
