// The co-op room option 「AI 队友最后选择」 (opts.aiPicksLast; GitHub #338): in the strategy draft (BAND_DRAFT) and the
// 机变 draft (SP_DRAFT) every human seat picks before every AI seat. The drawn order is kept inside each group (a stable
// partition AFTER the usual shuffle): no extra random draw, so the option off is today's order and the option on moves
// no random stream. A human under AI 托管, disconnected or departed is still a human (only room.addBot seats are AI).
// A human's skip passes the turn to the other humans still to pick, ahead of the AI seats [ASSUMED]; with no other
// human left it goes to the end as without the option.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { makeMatch } from './harness.js';

const isAi = (pid) => pid.startsWith('ai_');
/** the stable humans-first partition of a drawn order */
const humansFirst = (order) => [...order.filter((p) => !isAi(p)), ...order.filter(isAi)];
/** humans first, then AI seats, each in seat order — 1 host + 3 AI by default */
const seatsOf = (ids) => ids.map((playerId, seat) => ({ seat, playerId, name: playerId, isBot: isAi(playerId), connected: true }));

/** A match driven to BAND_DRAFT (every human confirms the briefing); `before(m)` runs while still in INFO_CHECK. */
function toBandDraft(o, before) {
  const h = makeMatch({ mode: 'coop', ...o }).start();
  if (before) before(h.m);
  for (const ps of h.m.players.values()) if (!ps.isBot && !ps.left) h.m.handle(ps.playerId, { t: 'g.infoReady' });
  h.run(() => h.m.phase !== PHASE.INFO_CHECK);
  assert.equal(h.m.phase, PHASE.BAND_DRAFT);
  return h;
}

/** The band-draft order (taken at its start, before any skip) and the next draws of the random streams after it. */
function bandOrder(o, before) {
  const h = toBandDraft(o, before);
  const order = h.m.draft.order.slice();
  const draws = { draft: h.m.rngDraft(), shop: h.m.rngShop(), bots: h.m.rngBots(), meta: h.m.rngMeta(), waves: h.m.rngWaves() };
  h.m.dispose();
  return { order, draws };
}

test('the option: off by default, on only when opts.aiPicksLast === true, never in solo', () => {
  const mk = (o) => { const h = makeMatch(o); const v = h.m.aiPicksLast; h.m.dispose(); return v; };
  assert.equal(mk({ mode: 'coop', humans: 1, bots: 3 }), false);
  assert.equal(mk({ mode: 'coop', humans: 1, bots: 3, aiPicksLast: true }), true);
  assert.equal(mk({ mode: 'coop', humans: 1, bots: 3, aiPicksLast: 'yes' }), false, 'only a real boolean');
  assert.equal(mk({ mode: 'solo', humans: 1, aiPicksLast: true }), false, 'solo: nothing to order');
});

test('band draft, option off: the order is exactly today\'s for the same seed (no option = off)', () => {
  let humanNotFirst = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const o = { seats: seatsOf(['p_0', 'ai_0', 'ai_1', 'ai_2']), seed };
    const def = bandOrder(o);
    const off = bandOrder({ ...o, aiPicksLast: false });
    assert.deepEqual(off, def, `seed ${seed}`);
    if (def.order[0] !== 'p_0') humanNotFirst++;
  }
  assert.ok(humanNotFirst > 0, 'the shuffle does put an AI first without the option (so the next test means something)');
});

test('band draft, option on, 1 human + 3 AI: the human always picks first; the same shuffle, every random stream unchanged', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const o = { seats: seatsOf(['p_0', 'ai_0', 'ai_1', 'ai_2']), seed };
    const off = bandOrder(o);
    const on = bandOrder({ ...o, aiPicksLast: true });
    assert.equal(on.order[0], 'p_0', `seed ${seed}`);
    assert.deepEqual(on.order, humansFirst(off.order), `seed ${seed}: the AI seats keep their drawn order`);
    assert.deepEqual(on.draws, off.draws, `seed ${seed}: no extra random draw`);
  }
});

test('band draft, option on, 2 humans + 2 AI on interleaved seats: both humans first, in their drawn order', () => {
  const ids = ['p_0', 'ai_0', 'p_1', 'ai_1'];
  const seen = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const o = { seats: seatsOf(ids), seed };
    const off = bandOrder(o);
    const on = bandOrder({ ...o, aiPicksLast: true });
    assert.deepEqual(on.order, humansFirst(off.order), `seed ${seed}`);
    assert.deepEqual(on.order.slice(0, 2).sort(), ['p_0', 'p_1']);
    seen.add(on.order[0]);
  }
  assert.equal(seen.size, 2, 'the humans\' own order is still drawn (either may lead)');
});

test('band draft, option on: all humans, or all AI seats (tools/matchrun), keep today\'s order', () => {
  for (const ids of [['p_0', 'p_1', 'p_2', 'p_3'], ['ai_0', 'ai_1', 'ai_2', 'ai_3']]) {
    for (let seed = 1; seed <= 4; seed++) {
      const o = { seats: seatsOf(ids), seed };
      if (ids[0] === 'ai_0') {
        // no human: INFO_CHECK ends by itself
        const run = (x) => { const h = makeMatch({ mode: 'coop', ...x }).start(); h.run(() => h.m.phase !== PHASE.INFO_CHECK); const r = h.m.draft.order.slice(); h.m.dispose(); return r; };
        assert.deepEqual(run({ ...o, aiPicksLast: true }), run(o), `all AI, seed ${seed}`);
      } else {
        assert.deepEqual(bandOrder({ ...o, aiPicksLast: true }), bandOrder(o), `all humans, seed ${seed}`);
      }
    }
  }
});

test('band draft, option on: a human under AI 托管, disconnected or departed is still ordered as a human', () => {
  for (let seed = 1; seed <= 8; seed++) {
    const o = { seats: seatsOf(['p_0', 'p_1', 'p_2', 'ai_0']), seed, aiPicksLast: true };
    const before = (m) => {
      m.handle('p_0', { t: 'g.autoplay', on: true });
      m.onDisconnect('p_1');
      m.onLeave('p_2');
    };
    const h = toBandDraft(o, before);
    assert.equal(h.m.draft.order[3], 'ai_0', `seed ${seed}: ${h.m.draft.order}`);
    h.m.dispose();
  }
});

test('band draft, option on: a skip passes the turn to the other humans, ahead of the AI seats; the last human\'s skip goes to the end [ASSUMED]', () => {
  const h = toBandDraft({ seats: seatsOf(['p_0', 'ai_0', 'p_1', 'ai_1']), seed: 3, aiPicksLast: true });
  const m = h.m;
  const [h1, h2, a1, a2] = m.draft.order;
  assert.ok(!isAi(h1) && !isAi(h2) && isAi(a1) && isAi(a2), String(m.draft.order));
  // the first human passes: behind the other human, still before the AI seats
  assert.deepEqual(m.handle(h1, { t: 'g.bandSkip' }), { ok: true });
  assert.deepEqual(m.draft.order, [h2, h1, a1, a2]);
  assert.equal(m.draftTurn(), h2);
  // the second human passes: behind the first again
  assert.deepEqual(m.handle(h2, { t: 'g.bandSkip' }), { ok: true });
  assert.deepEqual(m.draft.order, [h1, h2, a1, a2]);
  assert.deepEqual(m.handle(h1, { t: 'g.band', bandId: 'band_amiya' }), { ok: true });
  assert.equal(m.draftTurn(), h2);
  m.dispose();

  // a lone human (host + AI): no other human to pass to — the skip moves it to the end as without the option
  const h3 = toBandDraft({ seats: seatsOf(['p_0', 'ai_0', 'ai_1', 'ai_2']), seed: 3, aiPicksLast: true });
  const order = h3.m.draft.order.slice();
  assert.equal(order[0], 'p_0');
  assert.deepEqual(h3.m.handle('p_0', { t: 'g.bandSkip' }), { ok: true });
  assert.deepEqual(h3.m.draft.order, [...order.slice(1), 'p_0']);
  h3.m.dispose();

  // option off: the skip still goes to the very end (today's rule)
  const h4 = toBandDraft({ seats: seatsOf(['p_0', 'ai_0', 'p_1', 'ai_1']), seed: 3 });
  h4.run(() => !isAi(h4.m.draftTurn() || 'ai_'));
  const o4 = h4.m.draft.order.slice();
  const at = h4.m.draft.idx;
  const cur = h4.m.draftTurn();
  assert.deepEqual(h4.m.handle(cur, { t: 'g.bandSkip' }), { ok: true });
  assert.deepEqual(h4.m.draft.order, [...o4.slice(0, at), ...o4.slice(at + 1), cur]);
  h4.m.dispose();
});

/** Drive a fake-battle match into the SP draft of round `r`; `flip(m)` runs just before it is entered. */
function toSpDraft(o, r, flip) {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', fake: true, ...o }).start();
  const m = h.m;
  h.drive(() => m.phase === PHASE.ROUND_START && m.round === r);
  assert.equal(m.round, r);
  if (flip) flip(m);
  h.run(() => m.phase === PHASE.SP_DRAFT);
  assert.equal(m.phase, PHASE.SP_DRAFT);
  return h;
}

test('机变 draft, option off vs on from the same state: on = the humans-first partition of the same shuffle; no random stream moves', () => {
  for (const [ids, seed] of [[['p_0', 'ai_0', 'ai_1', 'ai_2'], 14], [['p_0', 'ai_0', 'p_1', 'ai_1'], 5], [['p_0', 'ai_0', 'ai_1', 'ai_2'], 2]]) {
    const o = { seats: seatsOf(ids), seed };
    const off = toSpDraft(o, 3);
    const on = toSpDraft(o, 3, (m) => { m.aiPicksLast = true; });
    assert.deepEqual(on.m.sp.order, humansFirst(off.m.sp.order), `seed ${seed}`);
    assert.deepEqual(on.m.sp.cards, off.m.sp.cards, 'the same cards');
    for (const k of ['rngDraft', 'rngShop', 'rngBots', 'rngMeta', 'rngWaves']) assert.equal(on.m[k](), off.m[k](), `${k} unchanged (seed ${seed})`);
    off.m.dispose();
    on.m.dispose();
  }
});

test('机变 draft, option on, 1 human + 3 AI: the human picks first in every 机变 round of the match', () => {
  for (const seed of [1, 14]) {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', fake: true, seats: seatsOf(['p_0', 'ai_0', 'ai_1', 'ai_2']), seed, aiPicksLast: true }).start();
    const m = h.m;
    const firsts = {};
    const enter = m.enterSpDraft;
    m.enterSpDraft = function () {
      enter.call(this);
      if (this.sp) firsts[this.round] = this.sp.order[0];
    };
    h.drive(() => h.ended != null || m.round > 9);
    const rounds = m.gd.spRounds().filter((r) => r <= 9);
    assert.deepEqual(rounds, [3, 6, 9]);
    for (const r of rounds) if (firsts[r] != null) assert.equal(firsts[r], 'p_0', `seed ${seed} R${r}`);
    assert.ok(firsts[3] === 'p_0', 'round 3 is always reached');
    m.dispose();
  }
});

test('机变 draft, option on, 2 humans + 2 AI interleaved, one under AI 托管: both humans ahead of the AI seats', () => {
  const o = { seats: seatsOf(['p_0', 'ai_0', 'p_1', 'ai_1']), seed: 5 };
  const h = toSpDraft({ ...o, aiPicksLast: true }, 3, (m) => { m.handle('p_1', { t: 'g.autoplay', on: true }); });
  assert.deepEqual(h.m.sp.order.slice(0, 2).sort(), ['p_0', 'p_1']);
  assert.ok(h.m.sp.order.slice(2).every(isAi));
  h.m.dispose();
});

test('solo: the option changes nothing (seat order, no skip)', () => {
  const run = (aiPicksLast) => {
    const h = makeMatch({ mode: 'solo', humans: 1, seed: 7, aiPicksLast }).start();
    h.m.handle('p_0', { t: 'g.infoReady' });
    h.run(() => h.m.phase !== PHASE.INFO_CHECK);
    const r = { order: h.m.draft.order.slice(), next: h.m.rngDraft() };
    h.m.dispose();
    return r;
  };
  assert.deepEqual(run(true), run(undefined));
});
