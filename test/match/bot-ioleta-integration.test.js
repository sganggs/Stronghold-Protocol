import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSteps, arrangeSteps, contactCandidatePlansSteps, levelUp as legacyLevelUp } from '../../server/match/bot.js';
import { IOLETA_POLICY, createIoletaPrepSteps } from '../../server/match/botIoleta.js';
import { getBotStrategy } from '../../server/match/botStrategies.js';
import { refreshIoletaPlan, ioletaPlan, IOLETA_OPS as O } from '../../server/match/botIoletaPolicy.js';
import { makeMatch, give, giveItem, checkInvariants, DATA } from './harness.js';
import { startServer } from '../../server/index.js';
import { replayTestMatch } from '../../server/match/testReplay.js';

const levelUp = (m, ps) => legacyLevelUp(m, ps, { policy: IOLETA_POLICY });
const botPrepBegin = (m, ps) => runSteps(m.bot.prepBegin(m, ps));
function setup(t, opts = {}) {
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seed: 11, fake: true, botStrategy: 'ioleta', ...opts }).start().toPrep();
  t.after(() => h.m.dispose());
  const m = h.m, ps = m.order[0];
  ps.bandId = 'band_ioleta';
  ps.shop.slots = [];
  ps.shop.freeRefreshes = 0;
  ps.funds = 0;
  return { m, ps, h };
}

test('startup rejects an unknown environment strategy before opening a listener', async t => {
  const saved = process.env.SP_BOT_STRATEGY;
  t.after(() => { if (saved === undefined) delete process.env.SP_BOT_STRATEGY; else process.env.SP_BOT_STRATEGY = saved; });
  process.env.SP_BOT_STRATEGY = 'unknown-test';
  await assert.rejects(startServer({ port: 0, quiet: true }), /Unknown bot strategy/);
});

test('ioleta plans are isolated by seat and match and survive a JSON state copy', t => {
  const a = setup(t), b = setup(t);
  const plan = refreshIoletaPlan(a.m, a.ps);
  b.m.disabledBonds = ['deputShip'];
  const other = refreshIoletaPlan(b.m, b.ps);
  assert.notEqual(plan, other);
  assert.equal(other.goals.deputShip, undefined);
  assert.equal(ioletaPlan(a.m, a.ps), plan);
  a.ps.botStrategyState = JSON.parse(JSON.stringify(a.ps.botStrategyState));
  assert.deepEqual(ioletaPlan(a.m, a.ps), plan);
  assert.notEqual(a.ps.botStrategyState, b.ps.botStrategyState);
});

test('other bands use exactly the legacy prep and RNG sequence', t => {
  const a = setup(t), b = setup(t, { botStrategy: 'legacy' });
  for (const { m, ps } of [a, b]) {
    ps.bandId = 'band_bldsk'; ps.funds = 9;
    ps.shop.slots = [{ kind: 'chess', id: O.gummy, basePrice: 2, sold: false }];
    botPrepBegin(m, ps);
    runSteps(m.bot.prepEnd(m, ps));
    checkInvariants(m);
  }
  const snapshot = ({ m, ps }) => ({ funds: ps.funds, hand: ps.hand, board: [...ps.board],
    shop: ps.shop, rng: m.rngBots.state(), pool: m.pool.snapshot(), ready: ps.ready });
  assert.deepEqual(snapshot(a), snapshot(b));
  assert.equal(a.ps.botStrategyState, undefined);
});

test('failed PlayerState purchase stops the loop without fabricated spending or repeated attempts', t => {
  const { m, ps } = setup(t);
  ps.funds = 2; ps.shop.upgradePrice = 100;
  ps.shop.slots = [{ kind: 'chess', id: O.gummy, basePrice: 2, sold: false }];
  const calls = [];
  ps.buy = () => { calls.push('buy'); return { ok: false, code: 'HAND_FULL' }; };
  ps.refresh = () => { calls.push('refresh'); return { ok: false }; };
  botPrepBegin(m, ps);
  assert.equal(calls.filter(x => x === 'buy').length, 2, 'one attempt in each bounded purchase pass');
  assert.equal(ps.funds, 2);
  assert.equal(ps.shop.slots[0].sold, false);
  assert.equal(ps.allChess().length, 0);
});

test('a full item hand preserves resources and finishes cleanup under AI takeover', t => {
  const { m, ps } = setup(t);
  ps.autoplay = true;
  for (let i = 0; i < ps.gd.benchSize; i++) giveItem(m, ps, 'chess_item_6_03_m');
  ps.funds = 2; ps.shop.upgradePrice = 100;
  ps.shop.slots = [{ kind: 'chess', id: O.gummy, basePrice: 2, sold: false }, null, null, null];
  botPrepBegin(m, ps);
  runSteps(m.bot.prepEnd(m, ps));
  assert.equal(ps.shop.slots[0].sold, false);
  assert.equal(ps.funds, 2);
  assert.equal(ps.ready, true);
  checkInvariants(m);
});

test('a core merge reward is resolved before upgrading', t => {
  const { m, ps } = setup(t);
  m.round = 7; ps.funds = 2; ps.shop.upgradePrice = 0;
  give(m, ps, O.gummy); give(m, ps, O.gummy);
  ps.shop.slots = [{ kind: 'chess', id: O.gummy, basePrice: 2, sold: false }];
  const calls = [];
  const reward = ps.pickReward.bind(ps), upgrade = ps.levelUp.bind(ps);
  ps.pickReward = (...args) => { const r = reward(...args); calls.push(['reward', r.ok]); return r; };
  ps.levelUp = () => { calls.push(['upgrade', ps.offers.length]); return upgrade(); };
  botPrepBegin(m, ps);
  assert.ok(calls.some(([kind, ok]) => kind === 'reward' && ok));
  assert.ok(calls.findIndex(([kind]) => kind === 'reward') < calls.findIndex(([kind]) => kind === 'upgrade'));
  assert.ok(calls.filter(([kind]) => kind === 'upgrade').every(([, offers]) => offers === 0));
  checkInvariants(m);
});

for (const selected of ['ioleta', 'ioleta-adaptive']) test(`${selected}: sliced prep replays strategy and state with unrelated environment`, t => {
  const entries = [];
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', fake: true, test: true, botStrategy: selected,
    botSliceMs: 0.001, seats: [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }],
    log: { info(line) { if (line.startsWith('[test-input ')) entries.push(JSON.parse(line.slice(line.indexOf(']') + 2))); } },
  }).start().toPrep();
  t.after(() => h.m.dispose());
  assert.ok(h.run(() => h.m.order[0].ready));
  assert.equal(entries[0].options.botStrategy, selected);
  const saved = process.env.SP_BOT_STRATEGY;
  process.env.SP_BOT_STRATEGY = 'unrelated-env';
  let copy;
  try { copy = replayTestMatch(DATA, entries); }
  finally { if (saved === undefined) delete process.env.SP_BOT_STRATEGY; else process.env.SP_BOT_STRATEGY = saved; }
  t.after(() => copy.dispose());
  assert.deepEqual(copy.order[0].privateView(), h.m.order[0].privateView());
  assert.deepEqual(copy.order[0].botStrategyState, h.m.order[0].botStrategyState);
  assert.equal(copy.rngBots.state(), h.m.rngBots.state());
  assert.equal(copy.errorCount, 0);
  assert.deepEqual(h.logs.error, []);
});

test('only the ioleta registered picker adds the Russell preference', t => {
  const { m, ps } = setup(t);
  assert.equal(getBotStrategy('ioleta').pickBand(m, ps), 'band_ioleta');
  assert.notEqual(getBotStrategy('ioleta').pickBand, getBotStrategy('legacy').pickBand);
});

test('an object strategy journal replays through the strategy registered under its ID', t => {
  const entries = [];
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', fake: true, test: true, botStrategy: { ...getBotStrategy('ioleta') },
    seats: [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }],
    log: { info(line) { if (line.startsWith('[test-input ')) entries.push(JSON.parse(line.slice(line.indexOf(']') + 2))); } },
  }).start().toPrep();
  t.after(() => h.m.dispose());
  assert.ok(h.run(() => h.m.order[0].ready));
  assert.equal(entries[0].options.botStrategy, 'ioleta');
  assert.equal('botStrategyCustom' in entries[0].options, false);
  const copy = replayTestMatch(DATA, entries);
  t.after(() => copy.dispose());
  assert.equal(copy.bot, getBotStrategy('ioleta'));
  assert.deepEqual(copy.order[0].privateView(), h.m.order[0].privateView());
  assert.equal(copy.rngBots.state(), h.m.rngBots.state());
});

for (const seed of [7, 11]) test(`ioleta real prep supports independent contact candidates (seed ${seed})`, t => {
  const records = [];
  for (const contact of [false, true]) {
    const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seed, botStrategy: 'ioleta', botRehearsal: 3 }).start().toPrep();
    t.after(() => h.m.dispose());
    const m = h.m, ps = m.order[0];
    ps.bandId = 'band_ioleta';
    ps.funds = 8;
    const preps = contact ? createIoletaPrepSteps({
      arrangeSteps: (match, player, opts = {}) => arrangeSteps(match, player,
        { ...opts, candidatePlans: contactCandidatePlansSteps }),
    }) : m.bot;
    const job = runSteps(preps.prepBegin(m, ps));
    assert.ok(job && job.inputs.length >= 2, 'real rehearsal has distinct candidates');
    records.push({ funds: ps.funds, level: ps.shop.level, chess: ps.allChess().map(p => p.id).sort(),
      buys: ps.stats.buys, plan: ps.botStrategyState.ioleta.plan });
    if (job) job.run();
    runSteps(preps.prepEnd(m, ps, job));
    assert.equal(ps.ready, true);
    checkInvariants(m);
    assert.deepEqual(h.logs.error, []);
  }
  assert.deepEqual(records[0], records[1], 'placement choice keeps procurement identical');
});

test('ioleta R7 escape upgrades L1 without an elite gate', t => {
  {
    const { m, ps } = setup(t);
    m.round = 7;
    ps.shop.upgradePrice = 0;
    levelUp(m, ps);
    assert.equal(ps.shop.level, 2);
  }
});

test('ioleta available core merge happens before R7 upgrade', t => {
  const { m, ps } = setup(t);
  const id = 'chess_char_1_10_a'; // 古米
  m.round = 7;
  give(m, ps, id); give(m, ps, id);
  ps.shop.upgradePrice = 0;
  ps.funds = 2;
  ps.shop.slots = [{ kind: 'chess', id, basePrice: 2, sold: false }];
  const events = [];
  const buy = ps.buy.bind(ps), upgrade = ps.levelUp.bind(ps);
  ps.buy = i => { events.push('buy'); return buy(i); };
  ps.levelUp = () => { events.push('upgrade'); return upgrade(); };
  levelUp(m, ps);
  assert.equal(ps.shop.level, 1);
  botPrepBegin(m, ps);
  assert.ok(events.indexOf('buy') >= 0);
  assert.ok(events.indexOf('upgrade') > events.indexOf('buy'));
  assert.ok(ps.allChess().some(p => p.id === m.gd.goldenIdOf(id)));
});

test('R7 escape budget is not spent on a core first copy before upgrading', t => {
  const { m, ps } = setup(t);
  m.round = 7;
  ps.funds = 5;
  ps.shop.upgradePrice = 5;
  ps.shop.slots = [{ kind: 'chess', id: 'chess_char_1_10_a', basePrice: 2, sold: false }];
  const events = [];
  const buy = ps.buy.bind(ps), upgrade = ps.levelUp.bind(ps);
  ps.buy = i => { events.push('buy'); return buy(i); };
  ps.levelUp = () => { events.push('upgrade'); return upgrade(); };
  botPrepBegin(m, ps);
  assert.equal(events[0], 'upgrade');
  assert.ok(ps.shop.level >= 2);
});

test('ioleta buys useful equipment when funds cannot cover refreshing and buying a target', t => {
  const { m, ps } = setup(t);
  m.round = 2;
  ps.funds = 2;
  ps.shop.upgradePrice = 100;
  give(m, ps, 'chess_char_1_10_a');
  ps.shop.slots = [{ kind: 'item', id: 'chess_item_1_01_e_a', basePrice: 1, sold: false }];
  const bought = [];
  const buy = ps.buy.bind(ps);
  ps.buy = index => { bought.push(index); return buy(index); };
  botPrepBegin(m, ps);
  assert.ok(bought.includes(0), 'a search target alone must not suppress the affordable equipment');
});

for (const selected of ['ioleta', 'ioleta-adaptive']) test(`${selected}: one Match routes AI and human takeover by band without repeating procurement`, t => {
  const h = makeMatch({ mode: 'coop', humans: 4, difficulty: 'HARD', fake: true,
    botStrategy: selected, botRehearsal: 0 }).start().toPrep();
  t.after(() => h.m.dispose());
  const { m } = h;
  const strategy = m.bot;
  const players = m.order.slice(0, 3);
  players[0].isBot = true;
  players[1].autoplay = true;
  players[2].autoplay = true;
  players[0].bandId = players[1].bandId = 'band_ioleta';
  players[2].bandId = 'band_bldsk';
  const attempts = new Map();
  for (const ps of players) {
    ps.ready = false;
    delete ps.botStrategyState;
    ps.funds = 2;
    ps.shop.upgradePrice = 100;
    ps.shop.freeRefreshes = 0;
    ps.shop.slots = [{ kind: 'chess', id: O.gummy, basePrice: 2, sold: false }, null, null, null];
    attempts.set(ps.playerId, 0);
    ps.buy = () => {
      attempts.set(ps.playerId, attempts.get(ps.playerId) + 1);
      return { ok: false, code: 'HAND_FULL' };
    };
    ps.refresh = () => ({ ok: false });
    m.scheduleBotPrep(ps);
  }
  assert.ok(h.run(() => players.every(ps => ps.ready)));
  assert.equal(m.bot, strategy);
  for (const ps of players) {
    assert.equal(attempts.get(ps.playerId), 2, 'one fill pass and one refresh pass per prep');
    assert.equal(ps.funds, 2);
    assert.equal(!!ps.botStrategyState?.ioleta?.plan, ps.bandId === 'band_ioleta');
  }
  assert.notEqual(players[0].botStrategyState.ioleta.plan, players[1].botStrategyState.ioleta.plan);
  assert.deepEqual(h.logs.error, []);
  checkInvariants(m);
});
