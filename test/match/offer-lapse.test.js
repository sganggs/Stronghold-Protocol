// Queued reward offers (晋升奖励, the strategies' special refreshes, item / 调度中心 offers) lapse at the end of the prep in
// which their player could act on them (DESIGN §37.339; the official client tip 「晋级的特殊奖励无法被刷新、冻结，也不会保留至
// 下一回合」, autoChessData.gameTipsList — only the promotion reward is named there, the other offers follow it
// [ASSUMED]). An offer queued during a prep before Ready is due at that prep's end; one queued after Ready, during the
// <休整期结束时> effects, in COMBAT / SETTLE or between phases is shown in the NEXT prep and lapses at its end (the due-prep
// idea of the temp pieces, PlayerState.tempDue). Unpicked = lost, nothing is picked for the player; a multi-pick offer
// lapses as a whole; elimination clears every offer. FakeBattle; the rule auditor (server/match/audit.js) watches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR, PHASE } from '../../shared/constants.js';
import { MetaRegistry } from '../../server/match/effectsMeta.js';
import { registerBuiltins } from '../../server/match/builtinMeta.js';
import { attachAudit } from '../../server/match/audit.js';
import { DATA, makeMatch, checkInvariants } from './harness.js';

/** Plain equipment (no equip / merge side effects) for item offers. */
const PLAIN = Object.values(DATA.items)
  .filter((i) => i.itemType === 'EQUIP' && !i.isGolden && i.kind === 'passive')
  .map((i) => i.itemId ?? i.id).filter(Boolean);

/**
 * Co-op match (2 humans: timed prep, FakeBattle) in PREP R1, p_0's hand emptied; `push(ps)` runs for p_0 on `hook` once
 * armed (registry global). Audited from the start.
 */
function setup({ seed = 1700, hook = null, who = 'p_0', push = (ps) => ps.pushRewardOffer('merge'), bots = 0 } = {}) {
  const reg = registerBuiltins(new MetaRegistry(), DATA);
  let armed = false;
  const box = {};
  if (hook) reg.global('offer_test', { [hook](ctx) { if (armed && ctx.playerId === who) { armed = false; box.offer = push(box.m.players.get(who)); } } });
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots, seed, fake: true, registry: reg }).start();
  box.m = h.m;
  const audit = attachAudit(h.m);
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.recompute();
  return { h, m, ps, audit, box, arm: () => { armed = true; } };
}

/** End the current co-op prep by its deadline (p_1 ready, p_0 left as it is). */
function deadline(h, m) {
  if (!h.ps('p_1').ready) assert.deepEqual(m.handle('p_1', { t: 'g.ready', ready: true }), { ok: true });
  // everybody ready: the prep ends at once; else its deadline ends it
  if (!m.alivePlayers().every((p) => p.ready)) h.sched.advance(m.deadline - h.sched.now() + 1);
  h.run(() => m.phase !== PHASE.PREP);
  assert.notEqual(m.phase, PHASE.PREP);
}

test('an offer left unpicked lapses at the end of its prep: nothing is picked for the player, the next prep shows none', () => {
  for (const how of ['deadline', 'ready']) {
    const { h, m, ps, audit } = setup({ seed: 1700 });
    const offer = ps.pushRewardOffer('merge');
    assert.ok(offer && ps.offers[0] === offer);
    assert.equal(ps.offerDue(offer), ps.prepsEnded, `${how}: queued before Ready, due at this prep`);
    assert.ok(ps.privateView().shop.rewardOffer, `${how}: shown`);
    const owned = ps.allChess().length;
    if (how === 'ready') {
      // a queued offer never blocks Ready: the player may let it lapse
      assert.deepEqual(m.handle('p_0', { t: 'g.ready', ready: true }), { ok: true });
      assert.ok(ps.offers.includes(offer), 'still queued while the prep lasts');
    }
    deadline(h, m);
    assert.equal(ps.offers.length, 0, `${how}: lapsed at the prep end`);
    assert.equal(ps.privateView().shop.rewardOffer, null, `${how}: no longer shown`);
    assert.equal(ps.allChess().length, owned, `${how}: no operator was picked for the player`);
    checkInvariants(m);
    h.toPrep(2);
    assert.equal(ps.offers.length, 0, `${how}: not shown again in the next prep`);
    assert.equal(m.handle('p_0', { t: 'g.reward', idx: 0 }).error, ERR.BAD_TARGET);
    assert.deepEqual(audit.violations, [], `${how}:\n${audit.violations.join('\n')}`);
    m.dispose();
  }
});

test('an offer that arrives after Ready waits for the next prep, can be taken there and lapses at its end; un-readying makes it due now', () => {
  for (const unready of [false, true]) {
    const { h, m, ps, audit } = setup({ seed: 1701 });
    assert.deepEqual(m.handle('p_0', { t: 'g.ready', ready: true }), { ok: true });
    // a passive gain while p_0 is ready (a teammate's effect, a delayed grant …): two offers, queued
    const first = ps.pushRewardOffer('merge');
    const second = ps.pushRewardOffer('merge');
    assert.equal(ps.offerDue(first), ps.prepsEnded + 1, 'the player could not act on it any more: due at the next prep');
    assert.deepEqual(m.handle('p_0', { t: 'g.reward', idx: 0 }), { error: ERR.WRONG_PHASE, detail: 'ready' });
    if (unready) {
      assert.deepEqual(m.handle('p_0', { t: 'g.ready', ready: false }), { ok: true });
      assert.equal(ps.offerDue(first), ps.prepsEnded, 'un-ready: it can be picked now, so it is due at this prep');
      assert.equal(ps.offerDue(second), ps.prepsEnded);
      deadline(h, m);
      assert.equal(ps.offers.length, 0, 'lapsed at this prep end');
      assert.deepEqual(audit.violations, [], `unready:\n${audit.violations.join('\n')}`);
      m.dispose();
      continue;
    }
    assert.deepEqual(m.handle('p_1', { t: 'g.ready', ready: true }), { ok: true });
    h.run(() => m.phase !== PHASE.PREP);
    assert.deepEqual(ps.offers, [first, second], 'kept past this prep end');
    h.toPrep(2);
    assert.deepEqual(ps.offers, [first, second], 'kept through COMBAT, SETTLE and the round start');
    assert.equal(ps.offerDue(first), ps.prepsEnded, 'due at this prep');
    const shown = ps.privateView().shop.rewardOffer;
    assert.deepEqual(shown.slots.map((s) => s.id), first.slots.map((s) => s.id), 'shown in this prep, the same cards');
    assert.equal(shown.queued, 1);
    const pick = first.slots[0].id;
    assert.deepEqual(m.handle('p_0', { t: 'g.reward', idx: 0 }), { ok: true });
    assert.ok([...ps.hand, ...ps.temp].some((p) => p && p.id === pick), 'the picked operator arrived');
    assert.deepEqual(ps.offers, [second]);
    deadline(h, m);
    assert.equal(ps.offers.length, 0, 'the second one lapsed at the end of the prep it was shown in');
    checkInvariants(m);
    assert.deepEqual(audit.violations, [], audit.violations.join('\n'));
    m.dispose();
  }
});

test('offers queued by <休整期结束时> effects and by battle results are shown in the next prep and lapse at its end', () => {
  for (const hook of ['onPrepEnd', 'onBattleResult']) {
    const { h, m, ps, audit, box, arm } = setup({ seed: 1702, hook });
    arm();
    assert.deepEqual(m.handle('p_0', { t: 'g.ready', ready: true }), { ok: true });
    assert.deepEqual(m.handle('p_1', { t: 'g.ready', ready: true }), { ok: true });
    h.drive(() => m.phase === PHASE.PREP && m.round === 2);
    assert.ok(box.offer, `${hook}: the effect queued an offer`);
    assert.deepEqual(ps.offers, [box.offer], `${hook}: it waited for this prep`);
    assert.equal(ps.offerDue(box.offer), ps.prepsEnded, `${hook}: due at this prep`);
    assert.ok(ps.privateView().shop.rewardOffer, `${hook}: shown`);
    deadline(h, m);
    assert.equal(ps.offers.length, 0, `${hook}: lapsed at the end of the prep it was shown in`);
    checkInvariants(m);
    assert.deepEqual(audit.violations, [], `${hook}:\n${audit.violations.join('\n')}`);
    m.dispose();
  }
});

test('a multi-pick offer (促销券 golden: 2 of 6) lapses as a whole, its unpicked second pick too', () => {
  const { h, m, ps, audit } = setup({ seed: 1703 });
  const ids = PLAIN.filter((id) => m.itemPool.canGain(id)).slice(0, 6);
  const offer = ps.pushItemOffer(ids, { picks: 2, label: '一次性促销券' });
  assert.ok(offer && offer.picks === 2 && offer.slots.length === 6);
  assert.deepEqual(m.handle('p_0', { t: 'g.reward', idx: 0 }), { ok: true });
  assert.deepEqual(ps.offers, [offer], 'the second pick is still open');
  const got = ps.hand.find((p) => p && p.id === ids[0]);
  assert.ok(got, 'the first pick arrived');
  deadline(h, m);
  assert.equal(ps.offers.length, 0, 'the whole offer lapsed');
  assert.ok(ps.find(got.uid), 'the first pick is kept');
  assert.equal(ps.hand.filter((p) => p && ids.includes(p.id)).length, 1, 'no second item was picked for the player');
  checkInvariants(m);
  assert.deepEqual(audit.violations, [], audit.violations.join('\n'));
  m.dispose();
});

test('elimination clears every queued offer, one due at a later prep too', () => {
  const { m, ps } = setup({ seed: 1704 });
  ps.pushRewardOffer('merge');
  assert.deepEqual(m.handle('p_0', { t: 'g.ready', ready: true }), { ok: true });
  ps.pushRewardOffer('merge');
  assert.equal(ps.offers.length, 2);
  ps.eliminate(m.round);
  assert.equal(ps.offers.length, 0);
  assert.equal(ps.privateView().shop.rewardOffer, null);
  checkInvariants(m);
  m.dispose();
});

test('a bot seat takes an offer queued after its Ready in the next prep (AI teammate, the same rule)', () => {
  const { h, m, audit, box, arm } = setup({ seed: 1705, hook: 'onPrepEnd', who: 'ai_0', bots: 1 });
  const bot = h.ps('ai_0');
  const picks = [];
  const pick = bot.pickReward.bind(bot);
  bot.pickReward = (idx) => { const offer = bot.offers[0]; const r = pick(idx); if (r.ok) picks.push(offer); return r; };
  arm();
  h.drive(() => m.phase === PHASE.PREP && m.round === 2);
  assert.ok(box.offer, 'the <休整期结束时> effect queued an offer for the bot');
  assert.ok(h.run(() => bot.ready || m.phase !== PHASE.PREP));
  assert.ok(picks.includes(box.offer), 'the bot took it in its next prep');
  assert.ok(!bot.offers.includes(box.offer));
  h.drive(() => m.phase === PHASE.COMBAT && m.round === 2);
  checkInvariants(m);
  assert.deepEqual(audit.violations, [], audit.violations.join('\n'));
  m.dispose();
});

test('AI seats take the offers their own late prep steps queue before Ready: a 寻呼模块 equipped in equipItems (AI teammate, human seat under AI 托管)', () => {
  // review of §37.339: the shared prep skeleton took offers for the last time before spending and equipping, so a pick
  // queued there (寻呼模块 / 信标, an onEquip grant's merge) lapsed at Ready — it is now taken right after equipItems and
  // once more before Ready (botPrep.js createPrepSteps)
  const PAGER = Object.values(DATA.items).find((i) => i.name === '寻呼模块' && !i.isGolden);
  assert.ok(PAGER, '寻呼模块 in the data');
  const pagerId = PAGER.itemId ?? PAGER.id;
  for (const who of ['p_0', 'ai_0']) {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 1, seed: 1708, fake: true }).start();
    const m = h.m;
    const audit = attachAudit(m);
    h.toPrep(2);
    const ps = h.ps(who);
    assert.equal(ps.ready, false, `${who}: its prep has not run yet`);
    assert.ok(ps.acquireItem(pagerId, { silent: true }), `${who}: holds a 寻呼模块`);
    const queued = [], picked = [], lapsed = [];
    const equip = ps.equip.bind(ps);
    ps.equip = (itemUid, targetUid, replaceUid) => {
      const id = ps.find(itemUid)?.piece.id;
      const before = new Set(ps.offers);
      const r = equip(itemUid, targetUid, replaceUid);
      if (id === pagerId && r.ok) for (const o of ps.offers) if (!before.has(o)) queued.push({ offer: o, ready: ps.ready });
      return r;
    };
    const pick = ps.pickReward.bind(ps);
    ps.pickReward = (idx) => { const o = ps.offers[0]; const r = pick(idx); if (r.ok) picked.push(o); return r; };
    const lapse = ps.lapseOffers.bind(ps);
    ps.lapseOffers = () => { for (const o of ps.offers) if (ps.offerDue(o) <= ps.prepsEnded) lapsed.push(o); return lapse(); };
    if (who === 'p_0') assert.deepEqual(m.handle('p_0', { t: 'g.autoplay', on: true }), { ok: true });
    assert.ok(h.run(() => ps.ready || m.phase !== PHASE.PREP));
    assert.equal(queued.length, 1, `${who}: equipping the 寻呼模块 in its own prep queued its offer`);
    assert.equal(queued[0].ready, false, `${who}: before Ready (due at this prep)`);
    assert.ok(picked.includes(queued[0].offer), `${who}: the AI took it before Ready`);
    if (!h.ps('p_1').ready) assert.deepEqual(m.handle('p_1', { t: 'g.ready', ready: true }), { ok: true });
    h.run(() => m.phase !== PHASE.PREP);
    assert.deepEqual(lapsed, [], `${who}: nothing the AI queued in its own prep lapsed`);
    checkInvariants(m);
    assert.deepEqual(audit.violations, [], `${who}:\n${audit.violations.join('\n')}`);
    m.dispose();
  }
});

test('the rule auditor flags an offer kept past its prep and one dropped before its due prep (engine regression guards)', () => {
  {
    const { h, m, ps, audit } = setup({ seed: 1706 });
    const offer = ps.pushRewardOffer('merge');
    offer.due = ps.prepsEnded + 5; // simulated engine bug: the offer outlives the prep it was shown in
    deadline(h, m);
    assert.ok(ps.offers.includes(offer));
    assert.ok(audit.violations.some((v) => /p_0: a queued reward offer .* survived its prep end/.test(v)), audit.violations.join('\n'));
    assert.ok(!audit.violations.some((v) => v.includes('p_1')));
    m.dispose();
  }
  {
    const { h, m, ps, audit } = setup({ seed: 1707 });
    assert.deepEqual(m.handle('p_0', { t: 'g.ready', ready: true }), { ok: true });
    const offer = ps.pushRewardOffer('merge');
    offer.due = ps.prepsEnded; // simulated engine bug: an offer queued after Ready lapses unseen at this prep end
    deadline(h, m);
    assert.ok(!ps.offers.includes(offer));
    assert.ok(audit.violations.some((v) => /p_0: a queued reward offer .* lapsed before its due prep/.test(v)), audit.violations.join('\n'));
    m.dispose();
  }
});
