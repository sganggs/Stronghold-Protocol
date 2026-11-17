// #816 P1: per-seat strategy overrides (SP_BOT_STRATEGY_SEATS / opts.botStrategySeats). The default match keeps
// one strategy object for every seat; a seat override changes only that seat's hooks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEGACY_BOT, defineBotStrategy } from '../../server/match/botStrategyContract.js';
import { getBotStrategy, getBotStrategySeats } from '../../server/match/botStrategies.js';
import { replayTestMatch, decodeTestTrace } from '../../server/match/testReplay.js';
import { makeMatch, checkInvariants, giveItem, DATA } from './harness.js';
import { FakeBattle } from './fakeBattle.js';

const ENV = ['SP_BOT_STRATEGY', 'SP_BOT_STRATEGY_SEATS'];
/** Clear both variables for the test and restore them afterwards. */
function cleanEnv(t) {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  t.after(() => { for (const k of ENV) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
}
const bots = (opts = {}) => makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 0, bots: 3, seed: 7, fake: true, ...opts });
const journalLog = (entries) => ({ info(line) {
  if (line.startsWith('[test-input ')) entries.push(JSON.parse(line.slice(line.indexOf(']') + 2)));
} });

test('the seat list parses seat:id entries and rejects malformed ones', () => {
  assert.deepEqual(getBotStrategySeats(undefined), {});
  assert.deepEqual(getBotStrategySeats(''), {});
  const seats = getBotStrategySeats(' 1:ioleta , 3 : adaptive ');
  assert.deepEqual(Object.keys(seats), ['1', '3']);
  assert.equal(seats[1], getBotStrategy('ioleta'));
  assert.equal(seats[3], getBotStrategy('adaptive'));
  assert.ok(Object.isFrozen(seats));
  assert.equal(getBotStrategySeats({ 0: 'legacy' })[0], LEGACY_BOT);
  for (const [text, error] of [['4:legacy', /seat must be 0\.\.3, got "4"/], ['-1:legacy', /seat must be 0\.\.3/],
    ['a:legacy', /seat must be 0\.\.3/], ['1.5:legacy', /seat must be 0\.\.3/], ['1', /expected seat:id/],
    ['1:legacy,', /expected seat:id/], ['1:', /seat 1 needs a strategy id/], ['1:legacy,1:ioleta', /seat 1 is listed twice/],
    ['2:legcay', /seat 2: Unknown bot strategy: legcay; available: legacy/], ['0:legacy,1:legacy,2:legacy,3:legacy,0:legacy', /at most 4 seats/],
    [{ 1: '' }, /seat 1 needs a strategy id/], [{ 1: null }, /seat 1 needs a strategy id/], [['legacy'], /seat:id list or/], [42, /seat:id list or/]]) {
    assert.throws(() => getBotStrategySeats(text), error, String(text));
  }
});

test('a match without overrides plays every seat with its one strategy; explicit options win over the environment', (t) => {
  cleanEnv(t);
  const plain = bots();
  t.after(() => plain.m.dispose());
  assert.deepEqual(plain.m.seatBots, {});
  for (const ps of plain.m.order) assert.equal(plain.m.botFor(ps), LEGACY_BOT);
  process.env.SP_BOT_STRATEGY_SEATS = '1:ioleta';
  const fromEnv = bots();
  t.after(() => fromEnv.m.dispose());
  assert.equal(fromEnv.m.botFor(fromEnv.m.order[1]), getBotStrategy('ioleta'));
  assert.equal(fromEnv.m.botFor(fromEnv.m.order[0]), LEGACY_BOT);
  const explicit = bots({ botStrategySeats: {} });
  t.after(() => explicit.m.dispose());
  assert.deepEqual(explicit.m.seatBots, {});
  process.env.SP_BOT_STRATEGY_SEATS = '1:legcay';
  assert.throws(() => bots(), /seat 1: Unknown bot strategy: legcay/);
});

test('each seat runs only its own hooks: drafts, sliced prep and personal bounty choices', (t) => {
  cleanEnv(t);
  const seen = { base: new Set(), seat: new Set() };
  const probe = (id, into) => defineBotStrategy({ id,
    pickBand(m, ps) { into.add(`band:${ps.seat}`); return LEGACY_BOT.pickBand(m, ps); },
    pickCard(m, ps, cards, available) { into.add(`card:${ps.seat}`); return available.at(-1); },
    *prepBegin(m, ps, opts) { into.add(`begin:${ps.seat}`); return yield* LEGACY_BOT.prepBegin(m, ps, opts); },
    *prepEnd(m, ps, job) { into.add(`end:${ps.seat}`); yield* LEGACY_BOT.prepEnd(m, ps, job); },
  });
  const h = bots({ botStrategy: probe('probe-base', seen.base), botStrategySeats: { 1: probe('probe-seat', seen.seat) } });
  t.after(() => h.m.dispose());
  const { m } = h;
  h.start();
  assert.ok(h.run(() => m.phase === 'PREP' && m.order.every((ps) => ps.ready)));
  assert.deepEqual([...seen.seat].sort(), ['band:1', 'begin:1', 'end:1']);
  assert.deepEqual([...seen.base].sort(), ['band:0', 'band:2', 'begin:0', 'begin:2', 'end:0', 'end:2']);
  const ps = m.order[1];
  ps.ready = false;
  const art = giveItem(m, ps, 'chess_item_6_03_m');
  assert.ok(ps.useArt(art.uid, 10, 5).ok);
  m.autoPickPersonalChoice(ps, 'bot');
  assert.ok(seen.seat.has('card:1') && !seen.base.has('card:1'));
  checkInvariants(m);
  assert.deepEqual(h.logs.error, []);
});

test('no override, an empty override and an override naming the default play the same match', (t) => {
  cleanEnv(t);
  const play = (opts) => {
    const h = bots({ botStrategy: 'legacy', ...opts });
    t.after(() => h.m.dispose());
    h.start();
    assert.ok(h.run(() => h.m.round >= 3 && h.m.phase === 'PREP' && h.m.order.every((ps) => ps.ready)));
    return { pub: h.m.publicView(), own: h.m.order.map((ps) => ps.privateView()), rng: h.m.rngBots.state() };
  };
  const base = play({});
  for (const botStrategySeats of [{}, { 1: 'legacy' }, '0:legacy,2:legacy']) {
    assert.deepEqual(play({ botStrategySeats }), base, JSON.stringify(botStrategySeats));
  }
});

test('a seat under AI 托管 plays its seat override', (t) => {
  cleanEnv(t);
  const seats = new Set();
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 7, fake: true,
    botStrategySeats: { 0: defineBotStrategy({ id: 'probe-takeover',
      *prepBegin(m, ps, opts) { seats.add(ps.seat); return yield* LEGACY_BOT.prepBegin(m, ps, opts); } }) } });
  t.after(() => h.m.dispose());
  const { m } = h;
  h.start().toPrep();
  assert.ok(h.run(() => m.order[1].ready));
  assert.deepEqual([...seats], [], 'the AI teammate on seat 1 plays the match strategy');
  const human = m.order[0];
  assert.equal(human.isBot, false);
  m.setAutoplay(human, true);
  assert.ok(h.run(() => human.ready));
  assert.deepEqual([...seats], [0]);
});

test('journals record per-seat IDs beside botStrategy and replay them without reading the environment', (t) => {
  cleanEnv(t);
  const record = (opts) => {
    const entries = [];
    const h = bots({ test: true, log: journalLog(entries), ...opts });
    t.after(() => h.m.dispose());
    h.start();
    assert.ok(h.run(() => h.m.round >= 2 && h.m.phase === 'PREP' && h.m.order.every((ps) => ps.ready)));
    return { h, journal: decodeTestTrace(entries) };
  };
  const plain = record({});
  assert.equal(plain.journal[0].options.botStrategy, 'legacy');
  assert.equal('botStrategySeats' in plain.journal[0].options, false, 'no overrides: the old journal shape');
  const { h, journal } = record({ botStrategySeats: '1:adaptive' });
  assert.equal(journal[0].options.botStrategy, 'legacy');
  assert.deepEqual(journal[0].options.botStrategySeats, { 1: 'adaptive' });
  process.env.SP_BOT_STRATEGY_SEATS = '0:changed-after-recording';
  for (const recording of [journal, plain.journal]) {
    const copy = replayTestMatch(DATA, structuredClone(recording), { BattleClass: FakeBattle });
    try {
      const original = recording === journal ? h.m : plain.h.m;
      assert.deepEqual(copy.seatBots, recording === journal ? { 1: getBotStrategy('adaptive') } : {});
      assert.deepEqual(copy.publicView(), original.publicView());
      assert.deepEqual(copy.order.map((ps) => ps.privateView()), original.order.map((ps) => ps.privateView()));
      assert.equal(copy.rngBots.state(), original.rngBots.state());
      assert.equal(copy.errorCount, 0);
    } finally { copy.dispose(); }
  }
  const unknown = structuredClone(journal);
  unknown[0].options.botStrategySeats = { 1: 'unavailable-recorded-strategy' };
  assert.throws(() => replayTestMatch(DATA, unknown), /seat 1: Unknown bot strategy: unavailable-recorded-strategy/);
});

test('one external seat creates the one external host; only that seat asks it, within SP_EXTERNAL_AI_SEATS', (t) => {
  cleanEnv(t);
  const none = bots();
  t.after(() => none.m.dispose());
  assert.equal(none.m.externalAI, null);
  for (const [externalAI, asked] of [[undefined, [1]], [{ seats: [0, 1] }, [1]], [{ seats: [0] }, []]]) {
    const h = bots({ botStrategySeats: { 1: 'external' }, externalReplay: true, externalAI });
    t.after(() => h.m.dispose());
    const { m } = h;
    assert.ok(m.externalAI);
    const seats = [];
    const start = m.externalAI.start.bind(m.externalAI);
    m.externalAI.start = (ps, decision) => { seats.push(ps.seat); return start(ps, decision); };
    h.start();
    assert.ok(h.run(() => m.phase === 'BAND_DRAFT' && m.order.every((ps) => ps.bandId || m.externalAI.jobs.size > 0)));
    assert.deepEqual([...new Set(seats)], [1], JSON.stringify(externalAI));
    assert.deepEqual([...m.externalAI.states.keys()].map((id) => m.players.get(id).seat), asked);
  }
});
