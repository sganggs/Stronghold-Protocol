import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formationProfile, formationRole, formationValue, contactValue, resolveFormationMode } from '../../server/match/botFormation.js';
import { FORMATION_PROFILES } from '../../server/match/botFormationProfiles.js';
import { planLayout, arrange, ADAPTIVE_STAGE, ADAPTIVE_CAPS } from '../../server/match/bot.js';
import { rehearsalCap } from '../../server/sim/rehearsal.js';
import { createRng } from '../../server/sim/rng.js';
import { canPlace, placeClass } from '../../server/match/board.js';
import { demonstrations, exampleSetup, evaluateExample } from '../../tools/layout-lab/evaluate.mjs';
import { makeMatch, give } from './harness.js';

test('compiled map profiles include exactly five eight-person demonstrations per map', () => {
  assert.equal(demonstrations.examples.length, 42);
  assert.equal(Object.keys(FORMATION_PROFILES).length, 7);
  for (const profile of Object.values(FORMATION_PROFILES)) {
    assert.equal(Object.values(profile).flatMap(cells => Object.values(cells)).reduce((a, b) => a + b, 0), 40);
  }
});

test('demonstrations are scoped to ordinary R1–13, including an explicit stale-wave boss exclusion', () => {
  const { m } = exampleSetup(demonstrations.examples[0]);
  for (const round of [1, 8, 13]) { m.round = round; assert.ok(formationProfile(m)); }
  for (const round of [0, 14, 15, 16]) { m.round = round; assert.equal(formationProfile(m), null); }
  m.round = 8; m.gd.bossRound = 8;
  assert.equal(formationProfile(m), null);
  m.gd.bossRound = 14; m.gd.hiddenRound = 8;
  assert.equal(formationProfile(m), null);
  m.gd.hiddenRound = 15; m.wave = null;
  assert.equal(formationProfile(m), null);
});

test('Boss/Hidden Core planners keep the same tiles, directions and RNG even when formation is requested', t => {
  for (const round of [14, 15]) {
    const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seed: 11 }).start().toPrep();
    t.after(() => h.m.dispose());
    const { m } = h, ps = m.order[0];
    const pieces = ['chess_char_1_02_a', 'chess_char_1_10_a', 'chess_char_2_08_a', 'chess_char_3_16_a'].map(id => give(m, ps, id, 'hand'));
    m.startRound(round);
    assert.equal(m.wave, null);
    assert.ok(m.bossGroupOf(ps)?.wave);
    m.rngBots = createRng(123);
    const before = planLayout(m, ps, pieces), next = m.rngBots();
    m.rngBots = createRng(123);
    const after = planLayout(m, ps, pieces, undefined, { formation: true });
    assert.deepEqual(after, before);
    assert.equal(m.rngBots(), next);
    // The integration path must bypass the extra candidate too (it would otherwise
    // change this RNG tail, even if the resulting board happened to look identical).
    m.rngBots = createRng(456);
    arrange(m, ps, { final: false });
    const board = [...ps.board].map(([key, p]) => [key, p.uid, p.dir]);
    const tail = m.rngBots();
    m.rngBots = createRng(456);
    arrange(m, ps, { final: true });
    assert.deepEqual([...ps.board].map(([key, p]) => [key, p.uid, p.dir]), board);
    assert.equal(m.rngBots(), tail);
  }
});

test('taught candidate consumes no RNG, obeys occupied tiles and supports smaller/larger lineups', () => {
  const { m, ps, pieces } = exampleSetup(demonstrations.examples[0]);
  m.rngBots = () => { throw new Error('extra candidate must not draw RNG'); };
  const occupied = new Set(['11,6', '12,7']);
  for (const count of [1, 4, 8, 10]) {
    const roster = Array.from({ length: count }, (_, i) => ({ ...pieces[i % pieces.length], uid: i }));
    const plan = planLayout(m, ps, roster, undefined, { formation: true, occupied });
    assert.equal(plan.size, count);
    assert.equal(new Set(plan.values()).size, count);
    for (const p of roster) {
      const key = plan.get(p.uid), [r, c] = key.split(',').map(Number);
      assert.ok(!occupied.has(key) && canPlace(ps.deployMap(), placeClass(ps, ps.gd.chess(p.id)), r, c));
    }
  }
});

test('an unseen map retains the original planner and RNG', () => {
  const { m, ps, pieces } = exampleSetup(demonstrations.examples[0]);
  m.stageId = 'unseen-map';
  m.rngBots = createRng(789);
  const before = planLayout(m, ps, pieces), next = m.rngBots();
  m.rngBots = createRng(789);
  const after = planLayout(m, ps, pieces, undefined, { formation: true });
  assert.deepEqual(after, before);
  assert.equal(m.rngBots(), next);
});

test('dead-zone defenders are rear support; healing and crossfire favour covering allies', () => {
  assert.equal(formationRole({ position: 'MELEE', profession: 'TANK', stats: { blockCnt: 3 }, rangeGrid: [[0, 3]] }), 'support');
  const model = { ground: new Map([['9,6', {}]]), routes: [{ tiles: ['9,7', '9,6', '9,5'] }] };
  const front = { key: '9,6', block: 3, cover: new Set(['9,6', '9,7']), dps: 500, rec: {} };
  const rear = { key: '10,5', cover: new Set(['9,6']), dps: 500, rec: {} };
  const heal = { key: '10,4', cover: new Set(['9,6', '10,5']), heal: true, rec: { attackKind: 'heal' } };
  const good = formationValue(model, [front, rear, heal], {});
  const bad = formationValue(model, [front, { ...rear, cover: new Set() }, { ...heal, cover: new Set() }], {});
  assert.ok(good > bad);
});

test('held-out map examples produce legal layouts and improve aggregate healing coverage', () => {
  const examples = demonstrations.examples.filter(e => e.heldOut);
  assert.equal(examples.length, 7);
  let before = 0, after = 0;
  for (const e of examples) {
    const old = evaluateExample(e, false), taught = evaluateExample(e, true);
    before += old.metrics.healed; after += taught.metrics.healed;
    const { ps, records } = exampleSetup(e);
    assert.equal(new Set(taught.placements.map(p => `${p.row},${p.col}`)).size, 8);
    taught.placements.forEach((p, i) => assert.ok(canPlace(ps.deployMap(), placeClass(ps, records[i]), p.row, p.col)));
  }
  assert.ok(after > before, `${after} healed allies vs ${before} baseline (42 total)`);
});

for (const mode of ['ordered', 'contact', 'refined']) test(`${mode}: deterministic legal candidate, protected occupied tiles and no RNG`, () => {
  for (const example of demonstrations.examples.filter(e => e.heldOut)) {
    const { m, ps, pieces } = exampleSetup(example);
    m.botFormationMode = mode;
    m.rngBots = () => { throw new Error('unexpected RNG'); };
    const occupied = new Set(['11,6', '12,7']);
    const opts = { formation: true, occupied };
    const plan = planLayout(m, ps, pieces, undefined, opts);
    assert.deepEqual(planLayout(m, ps, pieces, undefined, opts), plan);
    assert.equal(plan.size, pieces.length);
    assert.equal(new Set(plan.values()).size, plan.size);
    for (const p of pieces) {
      const key = plan.get(p.uid), [r, c] = key.split(',').map(Number);
      assert.ok(!occupied.has(key) && canPlace(ps.deployMap(), placeClass(ps, ps.gd.chess(p.id)), r, c));
    }
    m.round = 14;
    m.rngBots = createRng(321);
    const before = planLayout(m, ps, pieces), tail = m.rngBots();
    m.rngBots = createRng(321);
    assert.deepEqual(planLayout(m, ps, pieces, undefined, { formation: true }), before);
    assert.equal(m.rngBots(), tail);
  }
});

test('contact score requires incoming contact coverage on every route; healing cannot supply damage', () => {
  const model = { ground: new Set(['b']), index: new Map([['b', [[0, 1], [1, 1]]]]),
    routes: [{ tiles: ['a', 'b'] }, { tiles: ['c', 'b'] }] };
  const front = { key: 'b', block: 3 };
  const dealer = { key: 'd', ground: true, dps: 10, cover: new Set(['a', 'b']) };
  assert.equal(contactValue(model, [front, dealer]), 0);
  dealer.cover.add('c');
  assert.equal(contactValue(model, [front, dealer]), 2);
  dealer.heal = true;
  assert.equal(contactValue(model, [front, dealer]), 0);
  assert.equal(contactValue(model, [{ key: 'b', block: 1, heal: true }]), -2);
  assert.equal(contactValue(model, [{ key: 'd', block: 1, heal: true }]), 2);
  assert.equal(contactValue(model, [{ key: 'b', block: 0, heal: true, rec: { stats: { blockCnt: 1 } } }]), -2);
  assert.equal(contactValue(model, [{ key: 'd', block: 0, heal: true, rec: { stats: { blockCnt: 1 } } }]), 2);
});

for (const budget of [1, 3]) test(`combined rehearsal budget ${budget} retains legacy order and RNG`, t => {
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seed: 31 }).start().toPrep();
  t.after(() => h.m.dispose());
  const { m } = h, ps = m.order[0];
  for (const id of ['chess_char_1_02_a', 'chess_char_1_10_a', 'chess_char_2_08_a', 'chess_char_3_16_a']) give(m, ps, id, 'hand');
  m.botRehearsal = budget;
  m.botRefinements = ['preview', 'capacity'];
  m.botFormationEnabled = false;
  m.rngBots = createRng(456);
  const base = arrange(m, ps, { final: true, defer: true });
  const tail = m.rngBots();
  m.botFormationEnabled = true;
  m.botFormationMode = 'combined';
  m.rngBots = createRng(456);
  const combined = arrange(m, ps, { final: true, defer: true });
  assert.equal(m.rngBots(), tail);
  assert.ok(combined);
  assert.ok(combined.plans.length <= budget + 3);
  if (base) assert.deepEqual(combined.plans.slice(0, base.plans.length), base.plans);
  combined.run();
  assert.ok(combined.done);
});

test('optimized preset selects independently measured HARD/ABYSS modes and preserves other defaults', () => {
  assert.equal(resolveFormationMode({ botFormationMode: 'adaptive', difficulty: 'HARD' }), 'adaptive');
  assert.equal(resolveFormationMode({ botFormationMode: 'optimized', difficulty: 'HARD' }), 'contact');
  assert.equal(resolveFormationMode({ botFormationMode: 'optimized', difficulty: 'ABYSS' }), 'combined');
  assert.equal(resolveFormationMode({ botFormationMode: 'optimized', difficulty: 'NORMAL' }), 'learned');
  assert.equal(resolveFormationMode({}), 'legacy');
  assert.equal(resolveFormationMode({ botIoletaPolicy: 'experimental' }, { bandId: 'band_ioleta' }), 'adaptive');
  assert.equal(resolveFormationMode({ botIoletaPolicy: 'experimental' }, { bandId: 'band_doberm' }), 'legacy');
  assert.equal(resolveFormationMode({ botIoletaPolicy: 'experimental', botFormationMode: 'legacy' }, { bandId: 'band_ioleta' }), 'legacy');
});

/** A HARD solo prep on a taught map, `ids` in hand, ready for a final placement. */
function poolSetup(t, ids, { stageId = 'act2autochess_m03', seed = 31 } = {}) {
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seed }).start().toPrep();
  t.after(() => h.m.dispose());
  h.setStage(stageId);
  const { m } = h, ps = m.order[0];
  for (const id of ids) give(m, ps, id, 'hand');
  m.botRefinements = ['preview', 'capacity'];
  return { h, m, ps };
}
const signature = plan => [...plan.entries()].sort((a, b) => a[0] - b[0]).map(([u, k]) => `${u}@${k}:${plan.dirOf(u)}`).join(' ');
/** The final rehearsal job of one mode from the same RNG state, and the RNG value right after it. */
function finalJob(m, ps, mode, budget = 3) {
  m.botRehearsal = budget;
  m.botFormationEnabled = mode !== 'legacy';
  m.botFormationMode = mode;
  m.rngBots = createRng(456);
  const job = arrange(m, ps, { final: true, defer: true });
  return { job, tail: m.rngBots() };
}

for (const ids of [['chess_char_1_02_a'], ['chess_char_1_02_a', 'chess_char_1_10_a', 'chess_char_2_08_a', 'chess_char_3_16_a']]) {
  test(`adaptive keep every distinct legacy candidate, the old default first, and the RNG (${ids.length} pieces)`, t => {
    const { m, ps } = poolSetup(t, ids);
    // every distinct legacy variant: the old planner with a budget that cuts none of them
    const legacy = finalJob(m, ps, 'legacy', 5);
    const legacyPlans = legacy.job ? legacy.job.plans : [];
    for (const mode of ['adaptive']) {
      const { job, tail } = finalJob(m, ps, mode);
      assert.equal(tail, legacy.tail, `${mode}: the same RNG draws as the old planner`);
      assert.ok(job, `${mode}: a rehearsal job`);
      const sigs = job.plans.map(signature);
      assert.equal(new Set(sigs).size, sigs.length, `${mode}: no duplicate candidate takes a rehearsal`);
      assert.equal(job.plans[0].source, 'legacy:0');
      if (legacyPlans.length) assert.equal(sigs[0], signature(legacyPlans[0]), `${mode}: the old default plan stays first`);
      if (mode === 'adaptive') {
        for (const p of legacyPlans) assert.ok(sigs.includes(signature(p)), `adaptive keeps legacy candidate ${p.source}`);
        assert.deepEqual(job.limits, { stage: ADAPTIVE_STAGE, tickBudget: ADAPTIVE_CAPS * rehearsalCap(m.wave.timeLimit) });
      } else {
        assert.ok(job.plans.length <= m.botRehearsal + 3);
        assert.deepEqual(job.limits, { stage: 0, tickBudget: 0 });
      }
      job.run();
      assert.ok(job.done && job.plans.includes(job.best));
    }
  });
}

test('adaptive change nothing on an unseen map, a Boss round or a Hidden Core round', t => {
  const ids = ['chess_char_1_02_a', 'chess_char_1_10_a', 'chess_char_2_08_a', 'chess_char_3_16_a'];
  const { m, ps } = poolSetup(t, ids);
  m.stageId = 'unseen-map'; // no profile: the legacy candidates only
  const legacy = finalJob(m, ps, 'legacy');
  for (const mode of ['adaptive']) {
    const { job, tail } = finalJob(m, ps, mode);
    assert.equal(tail, legacy.tail);
    assert.deepEqual(job?.plans.map(signature), legacy.job?.plans.map(signature), `${mode} on an unseen map`);
    assert.deepEqual(job?.limits, legacy.job?.limits);
  }
  for (const round of [14, 15]) {
    const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seed: 11 }).start().toPrep();
    t.after(() => h.m.dispose());
    const { m: bm } = h, bps = bm.order[0];
    for (const id of ids) give(bm, bps, id, 'hand');
    bm.startRound(round);
    const boards = [];
    for (const mode of ['legacy', 'adaptive']) {
      bm.botFormationEnabled = mode !== 'legacy';
      bm.botFormationMode = mode;
      bm.rngBots = createRng(321);
      arrange(bm, bps, { final: true });
      boards.push(JSON.stringify([[...bps.board].map(([key, p]) => [key, p.uid, p.dir]), bm.rngBots()]));
    }
    assert.equal(boards[1], boards[0], `adaptive, round ${round}`);
  }
});
