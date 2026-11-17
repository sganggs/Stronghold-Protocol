import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as legacy from '../../server/match/bot.js';
import { LEGACY_BOT, defineBotStrategy, createBotRegistry } from '../../server/match/botStrategyContract.js';
import { BOT_STRATEGIES, getBotStrategy } from '../../server/match/botStrategies.js';
import { createRng } from '../../server/sim/rng.js';
import { makeMatch, checkInvariants, giveItem, DATA } from './harness.js';
import { replayTestMatch, decodeTestTrace } from '../../server/match/testReplay.js';
import { FakeBattle } from './fakeBattle.js';

const soloBot = (opts = {}) => makeMatch({ mode: 'solo', difficulty: 'NORMAL', fake: true,
  seats: [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }], ...opts });

test('the default strategy is the original bot functions with no wrapping or policy changes', () => {
  assert.deepEqual(Object.keys(BOT_STRATEGIES), ['legacy', 'external', 'ioleta', 'adaptive', 'ioleta-adaptive']);
  assert.equal(getBotStrategy(), LEGACY_BOT);
  assert.equal(getBotStrategy(''), LEGACY_BOT);
  assert.equal(LEGACY_BOT.pickBand, legacy.botPickBand);
  assert.equal(LEGACY_BOT.pickCard, legacy.botPickCard);
  assert.equal(LEGACY_BOT.prepBegin, legacy.botPrepBeginSteps);
  assert.equal(LEGACY_BOT.prepEnd, legacy.botPrepEndSteps);
  assert.equal(LEGACY_BOT.bountyKillChance, legacy.bountyKillChance);
  assert.ok(Object.isFrozen(LEGACY_BOT) && Object.isFrozen(BOT_STRATEGIES));
});

test('recorded and old journals keep legacy when the replay environment changes', () => {
  const previous = process.env.SP_BOT_STRATEGY;
  const entries = [];
  let h;
  try {
    process.env.SP_BOT_STRATEGY = '';
    h = soloBot({ test: true, log: { info(line) {
      if (line.startsWith('[test-input ')) entries.push(JSON.parse(line.slice(line.indexOf(']') + 2)));
    } } }).start().toPrep();
    assert.ok(h.run(() => h.m.order[0].ready));
    const journal = decodeTestTrace(entries);
    assert.equal(journal[0].options.botStrategy, 'legacy');
    process.env.SP_BOT_STRATEGY = 'changed-after-recording';
    assert.throws(() => soloBot(), /Unknown bot strategy/);
    for (const old of [false, true]) {
      const recording = structuredClone(journal);
      if (old) delete recording[0].options.botStrategy;
      const copy = replayTestMatch(DATA, recording, { BattleClass: FakeBattle });
      try {
        assert.equal(copy.bot, LEGACY_BOT);
        assert.deepEqual(copy.publicView(), h.m.publicView());
        assert.deepEqual(copy.order[0].privateView(), h.m.order[0].privateView());
        assert.equal(copy.rngBots.state(), h.m.rngBots.state());
        assert.equal(copy.errorCount, 0);
      } finally { copy.dispose(); }
    }
    const unknown = structuredClone(journal);
    unknown[0].options.botStrategy = 'unavailable-recorded-strategy';
    process.env.SP_BOT_STRATEGY = 'legacy';
    assert.throws(() => replayTestMatch(DATA, unknown), /Unknown bot strategy: unavailable-recorded-strategy/);
  } finally {
    h?.m.dispose();
    if (previous == null) delete process.env.SP_BOT_STRATEGY; else process.env.SP_BOT_STRATEGY = previous;
  }
});

test('strategies override individual hooks and inherit their base without mutating it', () => {
  const pickCard = (_m, _ps, _cards, available) => available.at(-1);
  const a = defineBotStrategy({ id: 'last-card', pickCard });
  const b = defineBotStrategy({ id: 'last-card-derived', base: a, pickBand: () => 'band_bldsk' });
  assert.equal(a.pickCard, pickCard); assert.equal(a.pickBand, LEGACY_BOT.pickBand);
  assert.equal(b.pickCard, pickCard); assert.equal(b.prepBegin, LEGACY_BOT.prepBegin);
  assert.ok(Object.isFrozen(a) && Object.isFrozen(b));
  assert.throws(() => { a.pickBand = () => null; }, TypeError);
  assert.equal(LEGACY_BOT.pickCard, legacy.botPickCard);
  const registry = createBotRegistry([a, b]);
  assert.ok(Object.isFrozen(registry));
  assert.equal(getBotStrategy('last-card', registry).pickCard, pickCard);
  assert.equal(getBotStrategy('legacy', registry), LEGACY_BOT);
  assert.deepEqual(Object.keys(BOT_STRATEGIES), ['legacy', 'external', 'ioleta', 'adaptive', 'ioleta-adaptive'], 'a local registry cannot leak into other rooms');
});

test('unknown names, duplicate registrations, malformed hooks and misspellings fail early', () => {
  for (const id of ['missing', 'constructor', '__proto__', ' ', null, 42]) assert.throws(() => getBotStrategy(id), /Unknown bot strategy/);
  for (const definition of [null, [], {}, { id: 'Bad ID' }, { id: 'a', pickCard: null },
    { id: 'a', prepBegn() {} }, { id: 'a', base: {} }]) assert.throws(() => defineBotStrategy(definition), TypeError);
  assert.throws(() => createBotRegistry([{ id: 'legacy' }]), /Duplicate/);
  assert.throws(() => createBotRegistry([{ id: 'a' }, { id: 'a' }]), /Duplicate/);
  assert.throws(() => createBotRegistry(null), TypeError);
  assert.throws(() => soloBot({ botStrategy: 'typo' }), /Unknown bot strategy/);
});

test('each match resolves its own object; an explicit choice takes precedence over the environment', () => {
  const previous = process.env.SP_BOT_STRATEGY;
  let a, b;
  try {
    process.env.SP_BOT_STRATEGY = 'legacy';
    a = soloBot();
    const custom = defineBotStrategy({ id: 'custom', pickBand: () => 'band_bldsk' });
    b = soloBot({ botStrategy: custom });
    assert.equal(a.m.bot, LEGACY_BOT); assert.equal(b.m.bot.id, 'custom');
    assert.notEqual(a.m.bot.pickBand, b.m.bot.pickBand);
    process.env.SP_BOT_STRATEGY = 'unknown-env';
    const explicit = soloBot({ botStrategy: 'legacy' });
    assert.equal(explicit.m.bot, LEGACY_BOT); explicit.m.dispose();
    assert.throws(() => soloBot(), /Unknown bot strategy/);
    process.env.SP_BOT_STRATEGY = '';
    const empty = soloBot();
    assert.equal(empty.m.bot, LEGACY_BOT); empty.m.dispose();
    const explicitEmpty = soloBot({ botStrategy: '' });
    assert.equal(explicitEmpty.m.bot, LEGACY_BOT); explicitEmpty.m.dispose();
  } finally {
    a?.m.dispose(); b?.m.dispose();
    if (previous == null) delete process.env.SP_BOT_STRATEGY; else process.env.SP_BOT_STRATEGY = previous;
  }
});

test('default dispatch preserves seeded opening decisions and RNG state', () => {
  const h = soloBot().start().toPrep(), { m } = h, ps = m.order[0];
  try {
    for (let seed = 1; seed <= 1000; seed++) {
      m.rngBots = createRng(seed);
      const direct = legacy.botPickBand(m, ps), state = m.rngBots.state();
      m.rngBots = createRng(seed);
      assert.equal(m.bot.pickBand(m, ps), direct);
      assert.equal(m.rngBots.state(), state);
    }
  } finally { m.dispose(); }
});

test('scheduled drafts, sliced prep and personal bounty choices use the selected hooks', () => {
  const calls = { bands: 0, cards: 0, begin: 0, end: 0, delegate: null };
  const strategy = defineBotStrategy({ id: 'probe',
    pickBand(m, ps) { calls.bands++; return LEGACY_BOT.pickBand(m, ps); },
    pickCard(m, ps, cards, available) { calls.cards++; return available.at(-1); },
    *prepBegin(m, ps, opts) { calls.begin++; calls.delegate = opts.delegate; yield; return yield* LEGACY_BOT.prepBegin(m, ps, opts); },
    *prepEnd(m, ps, job) { calls.end++; yield* LEGACY_BOT.prepEnd(m, ps, job); },
  });
  const h = soloBot({ botStrategy: strategy, botSliceMs: 0.001 }).start().toPrep(), { m } = h, ps = m.order[0];
  try {
    assert.ok(h.run(() => ps.ready));
    assert.ok(calls.bands > 0 && calls.begin > 0 && calls.end > 0);
    assert.equal(calls.delegate, m.botRehearsalDelegate);
    // A real private Pointing Stick choice uses the same hook as the common SP draft.
    ps.ready = false;
    const art = giveItem(m, ps, 'chess_item_6_03_m');
    assert.ok(ps.useArt(art.uid, 10, 5).ok);
    const expected = ps.personalChoice.cards.at(-1).effectId;
    m.autoPickPersonalChoice(ps, 'bot');
    assert.equal(ps.personalChoice, null);
    assert.ok(ps.bounties.some((b) => b.card.effectId === expected));
    const before = calls.cards;
    // Resume automatic prep and reach the first common SP draft.
    m.scheduleBotPrep(ps);
    assert.ok(h.run(() => calls.cards > before));
    checkInvariants(m);
    assert.deepEqual(h.logs.error, []);
  } finally { m.dispose(); }
});

test('a custom prep hook throwing before creating its generator still runs cleanup and reaches Ready', () => {
  let ended = 0;
  const h = soloBot({ botStrategy: defineBotStrategy({ id: 'broken-prep',
    prepBegin() { throw new Error('intentional test failure'); },
    *prepEnd(m, ps, job) { ended++; yield* LEGACY_BOT.prepEnd(m, ps, job); },
  }) }).start().toPrep();
  try {
    assert.ok(h.run(() => h.m.order[0].ready));
    assert.equal(ended, 1);
    assert.ok(h.logs.error.some((s) => s.includes('intentional test failure')));
    checkInvariants(h.m);
  } finally { h.m.dispose(); }
});

test('an accidental async prep iterator fails safely instead of looping in the virtual scheduler', () => {
  const h = soloBot({ botStrategy: defineBotStrategy({ id: 'async-prep',
    async *prepBegin() { yield; },
  }) }).start().toPrep();
  try {
    assert.ok(h.run(() => h.m.order[0].ready));
    assert.ok(h.logs.error.some((s) => s.includes('synchronous iterator')));
    checkInvariants(h.m);
  } finally { h.m.dispose(); }
});

for (const id of ['ioleta', 'adaptive', 'ioleta-adaptive']) test(`${id}: registered strategy exposes exactly five hooks and inherits unmodified hooks`, () => {
  const strategy = getBotStrategy(id);
  assert.deepEqual(Object.keys(strategy), ['id', 'pickBand', 'pickCard', 'prepBegin', 'prepEnd', 'bountyKillChance']);
  assert.equal(strategy.pickCard, LEGACY_BOT.pickCard);
  assert.equal(strategy.bountyKillChance, LEGACY_BOT.bountyKillChance);
  assert.ok(Object.isFrozen(strategy));
});

test('adaptive is placement-only: legacy band picker and procurement; ioleta-adaptive keeps the Russell opener', () => {
  const adaptive = getBotStrategy('adaptive'), ioleta = getBotStrategy('ioleta'), both = getBotStrategy('ioleta-adaptive');
  assert.equal(adaptive.pickBand, LEGACY_BOT.pickBand);
  assert.notEqual(adaptive.prepBegin, LEGACY_BOT.prepBegin);
  assert.equal(both.pickBand, ioleta.pickBand);
  assert.notEqual(both.prepBegin, ioleta.prepBegin);
});
