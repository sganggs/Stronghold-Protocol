// test/match/plugin-offers.test.js — the engine side of the plugin interaction windows (PLUGIN API v2, docs/PLUGINS.md
// §10b; server/match/match/offers.js): a window the content set declares opens before the round it names, waits on the
// match's own clock, settles on its quorum or its deadline, and applies exactly one declared effect primitive.
//
// The point of the whole part is that `when.rounds` is an expression over the round number: this suite declares the
// same window before R3 and before R9 — rounds the official schedule does not treat specially — and an `{ every: 2 }`
// window that covers even rounds only. No path here may special-case a round, so the assertions are written per round.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { validateC2S } from '../../shared/protocol.js';
import { replayTestMatch, decodeTestTrace } from '../../server/match/testReplay.js';
import { FakeBattle } from './fakeBattle.js';
import { PHASE } from '../../shared/constants.js';
import { readOfferFile, readOfferCards } from '../../shared/plugins/offers.js';

/** One normalized window, read through the real reader so the test's shape is the shipped shape. */
const window_ = (extra = {}, when = { at: ['prep'], rounds: [3, 9] }) => {
  const raw = {
    offer: 1, id: 'early-pick', when, windowSec: 30, quorum: 'all', onTimeout: 'auto', defer: [], slots: 3,
    refresh: { perSlot: 1 }, options: { source: 'lib/cards.json' }, apply: { funds: 3 }, ...extra,
  };
  const r = readOfferFile(raw, { pluginId: 'demo', rel: 'offers/early-pick.json' });
  assert.deepEqual(r.problems, []);
  const pool = readOfferCards(['a', 'b', 'c', 'd'].map(id => ({ id, name: id, desc: 'Grant', icon: 'funds' })), r.offer);
  assert.deepEqual(pool.problems, []);
  return { pluginId: 'demo', ...r.offer, cards: pool.cards };
};

/** A co-op match with two humans and one AI seat, carrying the windows `offers`. */
function matchWith(offers, extra = {}) {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 1, seed: 7, ...extra });
  h.m.offers = offers;
  return h;
}

const openWindow = (h, round) => () => Array.isArray(h.m.offerWin) && h.m.offerWin.length > 0 && h.m.round === round;
const humans = (h) => h.m.alivePlayers().filter((ps) => !ps.isBot);

/** Pick the first option for every human of the open window (the ids are the plugins' own). */
function pickAll(h, id, idx = 0) {
  const picked = [];
  for (const ps of humans(h)) {
    if (h.m.offerWin.length && !h.m.offerWin[0].picks.has(ps.playerId)) picked.push(ps);
    const before = ps.funds;
    h.m.requestOffer(ps, id, idx);
    assert.equal(ps.funds, before + 3, `the declared primitive applied to ${ps.playerId}`);
  }
  return picked;
}

test('a window declared before R3 and before R9 opens on exactly those rounds — no round is special', () => {
  const h = matchWith([window_()]);
  h.start();
  assert.ok(h.run(() => h.m.phase === PHASE.PREP && h.m.round === 1), 'R1 reached');
  assert.equal(h.m.offerWin.length, 0, 'no window before R1');
  for (const round of [3, 9]) {
    assert.ok(h.run(openWindow(h, round)), `the window opens before R${round}`);
    assert.equal(h.m.offerWin[0].id, 'early-pick');
    assert.equal(h.m.offerWin[0].round, round);
    pickAll(h, 'early-pick', 1);
    assert.equal(h.m.offerWin.length, 0, 'the quorum is met: the window closed');
    assert.ok(h.run(() => h.m.phase === PHASE.PREP && h.m.round === round), `R${round} prep runs after the window`);
  }
  h.m.dispose();
});

test('{ every: 2 } covers the even rounds and skips the odd ones', () => {
  const h = matchWith([window_({ id: 'every-two' }, { at: ['prep'], rounds: { every: 2 } })]);
  h.start();
  const openedOn = [];
  for (let round = 1; round <= 6; round++) {
    const opened = h.run(() => openWindow(h, round)() || (h.m.phase === PHASE.PREP && h.m.round === round));
    assert.ok(opened, `R${round} reached`);
    if (h.m.offerWin.length) {
      openedOn.push(round);
      pickAll(h, 'every-two', 0);
    }
  }
  assert.deepEqual(openedOn, [2, 4, 6]);
  h.m.dispose();
});

test('a deadline settles the window for the players who did not pick (the declared fallback)', () => {
  const h = matchWith([window_({ id: 'timed', windowSec: 5, quorum: 'all' })]);
  h.start();
  assert.ok(h.run(openWindow(h, 3)), 'the window opened');
  const seats = humans(h);
  const before = seats.map((ps) => ps.funds);
  // nobody picks: the window's own deadline decides for every seat, and the prep of the round then runs
  assert.ok(h.run(() => h.m.offerWin.length === 0 && h.m.phase === PHASE.PREP), 'the deadline closed the window and the prep ran');
  seats.forEach((ps, i) => assert.equal(ps.funds, before[i] + 3, 'the fallback applied to the seat that did not pick'));
  h.m.dispose();
});

test('windowSec 0 opens no window and holds nothing back (the safe default)', () => {
  const h = matchWith([window_({ id: 'loose', quorum: 'all', windowSec: 0 })]);
  h.start();
  assert.ok(h.run(() => h.m.phase === PHASE.PREP && h.m.round === 3), 'R3 prep ran');
  assert.equal(h.m.offerWin.length, 0, 'nothing waits');
  assert.equal(h.m.offerSeq, 0, 'zero seconds creates no state or timer');
  h.m.dispose();
});

test('a refresh is bounded by the window\'s own declaration, and a second pick is refused', () => {
  const h = matchWith([window_({ id: 'refreshable', refresh: { perSlot: 1 } })]);
  h.start();
  assert.ok(h.run(openWindow(h, 3)), 'the window opened');
  const ps = humans(h)[0];
  assert.deepEqual(h.m.requestOfferRefresh(ps, 'refreshable', 0), { ok: true });
  assert.notDeepEqual(h.m.requestOfferRefresh(ps, 'refreshable', 0), { ok: true }, 'the declaration allows one redraw');
  assert.deepEqual(h.m.requestOffer(ps, 'refreshable', 2), { ok: true });
  assert.notDeepEqual(h.m.requestOffer(ps, 'refreshable', 0), { ok: true }, 'one pick per player');
  h.m.dispose();
});

test('the prep of the round holds until the window closes', () => {
  const h = matchWith([window_({ id: 'hold', quorum: 'all', windowSec: 30 })]);
  h.start();
  // watch every prep start: none of them may happen while a window is open
  const entered = [];
  const orig = h.m.enterPrep.bind(h.m);
  h.m.enterPrep = (...args) => { entered.push(h.m.offerWin.filter((w) => !w.closed).length); return orig(...args); };
  assert.ok(h.run(openWindow(h, 3)), 'the window opened');
  // the window is still waiting: only its own deadline can move the match on
  assert.ok(h.m.offerWin.length > 0, 'nothing but the picks closed it');
  assert.equal(entered.length, 2, 'R1 and R2 preps ran; R3 is held');
  pickAll(h, 'hold', 0);
  assert.ok(h.run(() => h.m.phase === PHASE.PREP && h.m.round === 3), 'the prep runs once the window closed');
  assert.equal(entered.length, 3);
  assert.equal(entered[2], 0, 'the held prep saw no open window');
  h.m.dispose();
});

test('a match whose content set declares no window never builds one, and no new phase ever appears', () => {
  const h = matchWith([]);
  const known = new Set(Object.values(PHASE));
  const unusual = new Set();
  h.start();
  for (let i = 0; i < 60 && !h.m.ended; i++) {
    if (!known.has(h.m.phase)) unusual.add(h.m.phase);
    assert.equal(h.m.offerWin.length, 0, 'no window is ever open');
    h.run(() => h.m.ended != null || h.m.phase === PHASE.PREP, { maxSteps: 4000 });
    if (!known.has(h.m.phase)) unusual.add(h.m.phase);
  }
  assert.deepEqual([...unusual], [], 'every phase this match entered is a PHASE member of 0.3.0');
  assert.equal(h.m.offerSeq, 0, 'no window was ever built');
  h.m.dispose();
});

test('requestOffer / requestOfferRefresh are refused when no window of that id is open', () => {
  const h = matchWith([]);
  h.start();
  const ps = h.ps('p_0');
  for (const r of [h.m.requestOffer(ps, 'nope', 0), h.m.requestOfferRefresh(ps, 'nope', 0)]) {
    assert.equal(typeof r, 'object');
    assert.ok(r.error, 'a refusal is an { error } answer');
  }
  h.m.dispose();
});

const intent = (w, idx = 0, t = 'g.offer') => ({ t, pluginId: w.pluginId, offerId: w.id, seq: w.seq, idx });
const direct = (extra = {}, options = {}) => {
  const h = matchWith([window_(extra, { at: 'prep', rounds: 'any' })], { fake: true, ...options });
  h.m.openOfferWindow('prep', 1);
  return h;
};

test('slots carry their own source payload and picking applies that card, not window.apply', () => {
  const offer = window_();
  offer.cards = offer.cards.map((c, i) => ({ ...c, name: `Choice ${i}`, desc: `Gain ${i + 10}`, effect: { funds: i + 10 } }));
  const h = matchWith([offer]);
  h.m.openOfferWindow('prep', 3);
  const w = h.m.offerWin[0], ps = humans(h)[0];
  const view = h.m.publicView().offers[0].seats.find(s => s.playerId === ps.playerId);
  assert.deepEqual(view.slots.map(s => s.id), w.options.get(ps.playerId).map(c => c.id));
  assert.ok(view.slots.every(s => s.name && s.desc && s.icon && !s.effect));
  const gain = w.options.get(ps.playerId)[1].effect.funds, before = ps.funds;
  assert.deepEqual(h.m.handle(ps.playerId, intent(w, 1)), { ok: true });
  assert.equal(ps.funds, before + gain);
  h.m.dispose();
});

test('refresh deterministically replaces only that seat/slot and enforces per-slot caps and picked state', () => {
  const a = direct(), b = direct();
  const ps = humans(a)[0], w = a.m.offerWin[0];
  assert.deepEqual(a.m.offerViews(), b.m.offerViews());
  const other = JSON.stringify(w.options.get('p_1'));
  const before = w.options.get(ps.playerId).slice();
  const msg = intent(w, 0, 'g.offerRefresh');
  assert.equal(validateC2S(msg), null);
  assert.deepEqual(a.m.handle(ps.playerId, msg), { ok: true });
  assert.deepEqual(b.m.handle(ps.playerId, msg), { ok: true });
  assert.notEqual(w.options.get(ps.playerId)[0].id, before[0].id);
  assert.equal(w.options.get(ps.playerId)[1], before[1]);
  assert.equal(JSON.stringify(w.options.get('p_1')), other);
  assert.deepEqual(a.m.offerViews(), b.m.offerViews());
  assert.equal(a.m.handle(ps.playerId, msg).error, 'RATE');
  assert.deepEqual(a.m.handle(ps.playerId, { ...msg, idx: 1 }), { ok: true });
  a.m.handle(ps.playerId, intent(w));
  assert.equal(a.m.handle(ps.playerId, { ...msg, idx: 2 }).error, 'ALREADY');
  a.m.dispose(); b.m.dispose();
});

test('bots receive the immediate first-slot fallback, including skip; an all-bot window never waits', () => {
  for (const onTimeout of ['auto', 'bot', 'skip']) {
    const h = matchWith([window_({ onTimeout }, { at: 'prep', rounds: 'any' })], { humans: 0, bots: 2, fake: true });
    const before = h.m.order.map(p => p.funds);
    assert.equal(h.m.openOfferWindow('prep', 1), 'settled');
    assert.equal(h.m.offerBlocking(), false);
    assert.equal(h.m.offerWin.length, 0);
    h.m.order.forEach((p, i) => assert.equal(p.funds, before[i] + (onTimeout === 'skip' ? 0 : 3)));
    assert.equal(h.m._offerTimers.size, 0);
    h.m.dispose();
  }
});

test('prep hooks follow the official round draw and draft; the draft is never held by a plugin', () => {
  const h = matchWith([], { fake: true });
  const round = h.m.gd.spRounds()[0];
  h.m.offers = [window_({}, { at: 'prep', rounds: [round] })];
  let drafted = false;
  const finish = h.m.finishSpDraft.bind(h.m);
  h.m.finishSpDraft = () => { drafted = true; finish(); };
  h.start();
  assert.ok(h.run(() => h.m.offerWin.length > 0));
  assert.equal(drafted, true);
  assert.equal(h.m.offerWin[0].round, round);
  assert.equal(h.m.sp, null);
  assert.ok(h.m.order.every(p => p.shop.slots.length > 0), 'round-start shop draw already ran');
  pickAll(h, 'early-pick');
  assert.ok(h.run(() => h.m.phase === PHASE.PREP && h.m.round === round));
  h.m.dispose();
});

test('battleCheck hooks open before every named round, including R3 and R9', () => {
  const h = matchWith([window_({}, { at: 'battleCheck', rounds: [3, 9] })], { fake: true });
  h.start();
  for (const round of [3, 9]) {
    assert.ok(h.run(() => h.m.offerWin.some(w => w.round === round)));
    assert.equal(h.m.round, round - 1);
    pickAll(h, 'early-pick');
    assert.ok(h.run(() => h.m.phase === PHASE.PREP && h.m.round === round));
  }
  h.m.dispose();
});

test('zero seconds creates no state, timers, frames, RNG draws or grants even beside a live window', () => {
  const h = matchWith([window_({ windowSec: 0 })]);
  const funds = h.m.order.map(p => p.funds), timers = h.m._timers.size, frames = h.bc.length;
  assert.equal(h.m.openOfferWindow('prep', 3), 'none');
  assert.equal(h.m.offerSeq, 0);
  assert.equal(h.m._timers.size, timers);
  assert.equal(h.bc.length, frames);
  assert.deepEqual(h.m.order.map(p => p.funds), funds);
  h.m.offers.push(window_({ id: 'live' }));
  h.m.openOfferWindow('prep', 3);
  assert.equal(h.m.offerSeq, 1);
  assert.equal(h.m._offerTimers.size, 1);
  h.m.dispose();
});

test('missing or empty source payloads fail open without holding a phase', () => {
  for (const cards of [undefined, []]) {
    const h = matchWith([{ ...window_(), cards }]);
    assert.equal(h.m.openOfferWindow('prep', 3), 'none');
    assert.equal(h.m.offerSeq, 0);
    h.m.dispose();
  }
});

test('a nonblocking window does not resume or hold the phase and uses the scaled timeout', () => {
  const h = direct({ quorum: 'none', windowSec: 10 }, { timerScale: 0.5 });
  assert.equal(h.m.offerBlocking(), false);
  assert.equal(h.m.offerWin[0].deadline - h.sched.now(), 5000);
  h.sched.advance(4999);
  assert.equal(h.m.offerWin.length, 1);
  h.sched.advance(1);
  assert.equal(h.m.offerWin.length, 0);
  h.m.dispose();
});

test('majority is strictly more than half; departure and autoplay release waiting seats', () => {
  const h = direct({ quorum: 'majority' }, { humans: 2, bots: 0 });
  const w = h.m.offerWin[0];
  h.m.handle('p_0', intent(w));
  assert.equal(h.m.offerWin.length, 1);
  h.m.setAutoplay(h.ps('p_1'), true);
  assert.equal(h.m.offerWin.length, 0);
  h.m.dispose();
  const left = direct({}, { humans: 2, bots: 0 });
  left.m.handle('p_0', intent(left.m.offerWin[0]));
  left.m.onLeave('p_1');
  assert.equal(left.m.offerWin.length, 0);
  left.m.dispose();
});

test('plugin identity and sequence reject cross-plugin and stale picks; spectators cannot answer', () => {
  const h = direct({}, { spectators: ['watcher'] });
  const old = h.m.offerWin[0];
  h.m.offers = [{ ...window_({}, { at: 'prep', rounds: 'any' }), pluginId: 'second' }];
  h.m.openOfferWindow('prep', 1);
  assert.equal(h.m.requestOffer(h.ps('p_0'), old.id, 0).error, 'WRONG_PHASE');
  assert.equal(h.m.handle('watcher', intent(old)).error, 'SPECTATOR');
  assert.equal(h.m.handle('p_0', { ...intent(old), seq: 99 }).error, 'WRONG_PHASE');
  assert.deepEqual(h.m.handle('p_0', intent(old)), { ok: true });
  assert.equal(h.m.offerWin[1].picks.has('p_0'), false);
  h.m._offerDeadline(old);
  assert.equal(h.m.handle('p_1', intent(old)).error, 'WRONG_PHASE');
  h.m.dispose();
});

test('reconnect snapshots restore full options, remaining refreshes, picks and quorum', () => {
  const h = direct();
  const w = h.m.offerWin[0];
  h.m.handle('p_0', intent(w, 1, 'g.offerRefresh'));
  h.m.handle('p_1', intent(w));
  const expected = h.m.offerViews();
  h.m.onDisconnect('p_0');
  h.m.onReconnect('p_0');
  const frame = h.sent.filter(([pid, msg]) => pid === 'p_0' && msg.t === 'm.public').at(-1)[1];
  assert.deepEqual(frame.offers, expected);
  assert.equal(frame.offers[0].seats.find(s => s.playerId === 'p_0').slots[1].remaining, 0);
  h.m.dispose();
});

test('test journal records g.offer/refresh and restores an open window on deterministic replay', () => {
  const entries = [];
  const offers = [window_({}, { at: 'prep', rounds: [1] })];
  const h = makeMatch({ humans: 2, bots: 0, fake: true, test: true, offers,
    log: { info(line) { if (line.startsWith('[test-input ')) entries.push(JSON.parse(line.slice(line.indexOf(']') + 2))); } } });
  h.start();
  assert.ok(h.run(() => h.m.offerWin.length > 0));
  const w = h.m.offerWin[0];
  h.m.handle('p_0', intent(w, 0, 'g.offerRefresh'));
  h.m.handle('p_1', intent(w));
  const calls = decodeTestTrace(entries).filter(e => e.kind === 'call').map(e => e.args?.[1]?.t);
  assert.ok(calls.includes('g.offer')); assert.ok(calls.includes('g.offerRefresh'));
  const replay = replayTestMatch(h.m.data, entries, { BattleClass: FakeBattle });
  assert.deepEqual(replay.offerViews(), h.m.offerViews());
  assert.deepEqual(replay.order.map(p => p.funds), h.m.order.map(p => p.funds));
  replay.dispose(); h.m.dispose();
});

test('protocol-valid picks and refreshes under churn never double-grant or stall active windows', () => {
  const h = direct({ windowSec: 3 }, { humans: 3, bots: 1 });
  const w = h.m.offerWin[0];
  const original = h.m.order.map(p => p.funds);
  for (let i = 0; i < 48; i++) {
    const msg = intent(w, i % 6, i % 3 ? 'g.offer' : 'g.offerRefresh');
    if (i % 5 === 0) msg.seq++;
    assert.equal(validateC2S(msg), null);
    const result = h.m.handle(`p_${i % 3}`, msg);
    assert.notEqual(result.error, 'INTERNAL');
    if (i % 7 === 0) { h.m.onDisconnect('p_0'); h.m.onReconnect('p_0'); }
  }
  h.sched.advance(3000);
  assert.equal(h.m.offerWin.length, 0);
  h.m.order.forEach((p, i) => assert.ok(p.funds - original[i] <= 3));
  assert.equal(h.m.errorCount, 0);
  h.m.dispose();
});

test('bots complete a whole match with offers on every round and no window errors', () => {
  const h = matchWith([window_({}, { at: ['battleCheck', 'prep'], rounds: 'any' })], { humans: 0, bots: 4, fake: true });
  h.start();
  assert.ok(h.run(() => h.m.ended === true, { maxSteps: 10000 }));
  assert.equal(h.m.errorCount, 0);
  assert.ok(h.m.offerSeq > 2);
  assert.equal(h.m.offerWin.length, 0);
  h.m.dispose();
});

test('the native client cardId refuses a pick sent before the refreshed snapshot arrived', () => {
  const h = direct();
  const w = h.m.offerWin[0], ps = h.ps('p_0');
  const cardId = w.options.get(ps.playerId)[0].id;
  assert.deepEqual(h.m.handle(ps.playerId, { ...intent(w, 0, 'g.offerRefresh'), cardId }), { ok: true });
  const before = ps.funds;
  assert.equal(h.m.handle(ps.playerId, { ...intent(w), cardId }).error, 'BAD_TARGET');
  assert.equal(ps.funds, before);
  h.m.dispose();
});

test('finishing and a test-console round jump discard old windows and queued continuations', () => {
  const h = direct();
  let resumed = 0;
  h.m._offerResume = () => resumed++;
  const w = h.m.offerWin[0];
  h.m.handle('p_0', intent(w)); h.m.handle('p_1', intent(w));
  h.m.startRound(7);
  h.sched.advance(0);
  assert.equal(resumed, 0);
  h.m.openOfferWindow('prep', 7);
  assert.ok(h.m.offerWin.length);
  h.m.finish({ victory: false });
  assert.equal(h.m.offerWin.length, 0);
  assert.equal(h.m._offerTimers.size, 0);
  h.m.dispose();
});


test('g.test hidden-round jumps initialize team LP after blocking battleCheck picks or timeout', () => {
  for (const timeout of [false, true]) {
    const h = matchWith([], { fake: true, test: true, bots: 0 });
    h.start(); h.toPrep(1);
    const hidden = h.m.gd.hiddenRound;
    h.m.offers = [window_({}, { at: 'battleCheck', rounds: [hidden] })];
    assert.deepEqual(h.m.handle('p_0', { t: 'g.test', cmd: 'round', args: { round: hidden } }), { ok: true });
    assert.equal(h.m.round, 1);
    assert.equal(h.m.teamLp, null);
    if (!timeout) for (const ps of humans(h)) h.m.handle(ps.playerId, intent(h.m.offerWin[0]));
    assert.ok(h.run(() => h.m.phase === PHASE.PREP && h.m.round === hidden));
    const sum = h.m.alivePlayers().reduce((n, p) => n + p.lp, 0);
    assert.equal(h.m.teamLp, sum);
    h.m.prepDeadline();
    assert.equal(h.m.phase, PHASE.HIDDEN_CORE);
    h.m._teamLpLoss(5);
    assert.equal(h.m.teamLp, sum - 5);
    h.m.dispose();
  }
});

const stockOffer = (effect, extra = {}) => ({ ...window_({ slots: 2, ...extra }), cards: [
  { id: 'grant', name: 'Grant', desc: 'Grant', icon: 'item', effect },
  { id: 'funds', name: 'Funds', desc: 'Funds', icon: 'funds', effect: { funds: 3 } },
] });
const exhaustItem = (h, id) => {
  for (let n = 0; n < 20 && h.m.itemPool.canGain(id); n++) assert.ok(h.ps('p_1').acquireItem(id));
  assert.equal(h.m.itemPool.canGain(id), false);
};

for (const [kind, id] of [['chess', 'chess_char_5_diy1_a'], ['item', 'chess_item_1_01_e_a']]) {
  test(`unavailable ${kind} stays unpicked and another option remains selectable`, () => {
    const offer = stockOffer({ [kind]: id });
    const h = matchWith([offer], { fake: true, bots: 0 });
    h.start(); h.toPrep(1);
    h.m.openOfferWindow('prep', 3);
    const w = h.m.offerWin[0], ps = h.ps('p_0');
    if (kind === 'item') exhaustItem(h, id); // stock can change after the slots are drawn
    const idx = w.options.get(ps.playerId).findIndex(c => c.id === 'grant');
    assert.equal(h.m.handle(ps.playerId, intent(w, idx)).error, 'BAD_TARGET');
    assert.equal(w.picks.has(ps.playerId), false);
    const slot = h.m.offerViews()[0].seats.find(s => s.playerId === ps.playerId).slots[idx];
    assert.equal(slot.available, false);
    const before = ps.funds;
    assert.deepEqual(h.m.handle(ps.playerId, intent(w, 1 - idx)), { ok: true });
    assert.equal(ps.funds, before + 3);
    h.m.dispose();
  });
}

test('failed acquisition does not consume a validated choice', () => {
  const h = matchWith([stockOffer({ item: 'chess_item_1_01_e_a' })], { fake: true, bots: 0 });
  h.m.openOfferWindow('prep', 3);
  const w = h.m.offerWin[0], ps = h.ps('p_0');
  const idx = w.options.get(ps.playerId).findIndex(c => c.id === 'grant');
  ps.acquireItem = () => null;
  assert.equal(h.m.handle(ps.playerId, intent(w, idx)).error, 'BAD_TARGET');
  assert.equal(w.picks.has(ps.playerId), false);
  h.m.dispose();
});

test('timeout, bots and majority skip unavailable slots in order, or close with no grant', () => {
  for (const onTimeout of ['auto', 'bot', 'skip']) for (const allUnavailable of [false, true]) {
    const offer = stockOffer({ item: 'chess_item_1_01_e_a' }, { onTimeout });
    if (allUnavailable) offer.cards[1].effect = { chess: 'chess_char_5_diy1_a' };
    const h = matchWith([offer], { fake: true, bots: 0 });
    exhaustItem(h, 'chess_item_1_01_e_a');
    h.m.openOfferWindow('prep', 3);
    const w = h.m.offerWin[0];
    for (const ps of h.m.order) w.options.set(ps.playerId, offer.cards.slice());
    const before = h.m.order.map(p => p.funds);
    h.sched.advance(30000);
    assert.equal(h.m.offerWin.length, 0);
    h.m.order.forEach((ps, i) => {
      const skipped = onTimeout === 'skip' || allUnavailable;
      assert.equal(w.picks.get(ps.playerId).idx, skipped ? null : 1);
      assert.equal(ps.funds, before[i] + (skipped ? 0 : 3));
    });
    h.m.dispose();
  }
  for (const bots of [0, 2]) {
    const h = matchWith([stockOffer({ chess: 'chess_char_5_diy1_a' }, { quorum: 'majority' })], { fake: true, humans: 3, bots });
    h.m.openOfferWindow('prep', 3);
    const w = h.m.offerWin[0];
    const idx = w.options.get('p_0').findIndex(c => c.id === 'funds');
    h.m.handle('p_0', intent(w, idx));
    if (!bots) h.m.handle('p_1', intent(w, w.options.get('p_1').findIndex(c => c.id === 'funds')));
    assert.equal(h.m.offerWin.length, 0);
    for (const ps of h.m.order) assert.equal(w.options.get(ps.playerId)[w.picks.get(ps.playerId).idx].id, 'funds');
    h.m.dispose();
  }
});
