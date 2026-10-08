// AI player after the 0.1.0 player feedback (#10 "目前的人机有点太笨了", server/match/bot.js): bounty picks against the
// own board, item carriers by what the item does (both 博士投影, 突变细胞 never on an elite or a pair member), bounty
// Arts kept rather than destroyed (never on a human's seat under AI 托管), a tactician's 援军 inside its attack range,
// pairs completed through the shop freeze, 坎诺特's banked funds, a teammate's bond read from its bond strip, and a
// cost guard on the prep heuristics. The outcome numbers (old vs new bot on the same seeds) are measured with
// tools/botbench.mjs (docs/META.md §1.5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { botPickCard, bountyKillChance, itemTarget, arrange, botPrepBegin, botPrepEnd, bondPlan, rangeTiles, effDps, rangeRec, buyScoreOf } from '../../server/match/bot.js';
import { parseKey, tileKey } from '../../server/match/board.js';
import { makeMatch, checkInvariants, give, giveItem, legalTileFor, DATA } from './harness.js';

const soloBot = (o = {}) => makeMatch({ mode: 'solo', difficulty: 'NORMAL', seats: [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }], ...o });

test('user: Given a faction strategy teammate, When scoring shared high-tier chess, Then humans and bots receive the same preference even with full stock', () => {
  const { m } = makeMatch({ humans: 3, seed: 11 }).start().toPrep();
  const [ps, mate, other] = m.order;
  try {
    mate.bandId = other.bandId = null;
    ps.shop.level = 6;
    // 贾维 names 叙拉古; 铃兰 (V) and 荒芜拉普兰德 (VI) both belong to it.
    for (const id of ['chess_char_5_10_a', 'chess_char_6_18_a']) {
      mate.isBot = false;
      const ordinary = buyScoreOf(m, ps, id);
      mate.bandId = 'band_chiave';
      const cooperative = buyScoreOf(m, ps, id);
      assert.ok(cooperative < ordinary, `${m.gd.chess(id).name}: leave faction stock for the strategy`);
      mate.isBot = true;
      assert.equal(buyScoreOf(m, ps, id), cooperative, 'bot teammates count equally');
      other.bandId = 'band_chiave';
      assert.equal(buyScoreOf(m, ps, id), cooperative, 'multiple teammates do not multiply the penalty');
      mate.alive = other.alive = false;
      assert.equal(buyScoreOf(m, ps, id), ordinary, 'eliminated players no longer need cards');
      mate.alive = other.alive = true;
      other.bandId = null;
      m.gd.modeInactiveBonds.add('siracusaShip');
      const inactive = buyScoreOf(m, ps, id);
      mate.bandId = null;
      assert.equal(buyScoreOf(m, ps, id), inactive, 'inactive faction does not trigger yielding');
      m.gd.modeInactiveBonds.delete('siracusaShip');
    }
    const unaffected = Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden &&
      (c.tier < 5 || !c.bonds.includes('siracusaShip')));
    for (const c of unaffected) {
      mate.bandId = null;
      const ordinary = buyScoreOf(m, ps, c.chessId);
      mate.bandId = 'band_chiave';
      assert.equal(buyScoreOf(m, ps, c.chessId), ordinary, c.name);
    }
  } finally { m.dispose(); }
});

test('user: Given a teammate faction strategy, When buying or taking a reward, Then prefer an alternative but retain an immediate own merge', () => {
  const yu = 'chess_char_6_03_a';
  const nearl = 'chess_char_6_17_a';
  for (const { reward = false, ownPair = false, band = 'band_duyaoy', expected } of [
    { expected: nearl },
    { reward: true, expected: nearl },
    { ownPair: true, expected: yu },
    { band: null, expected: yu },
  ]) {
    const { m } = makeMatch({ humans: 2, seed: 11 }).start().toPrep();
    const [ps, mate] = m.order;
    try {
      mate.bandId = band;
      if (ownPair) for (let i = 0; i < 2; i++) give(m, ps, yu, 'hand');
      ps.shop.level = 6;
      ps.funds = reward ? 0 : 5;
      ps.shop.slots = reward ? [] : [yu, nearl].map((id) => ({ kind: 'chess', id, basePrice: 5, sold: false }));
      if (reward) ps.pushRewardOffer('merge', { tier: 6, ids: [yu, nearl] });
      botPrepBegin(m, ps);
      assert.equal(reward ? ps.allChess()[0]?.id : ps.shop.slots.find((s) => s.sold)?.id, expected);
    } finally { m.dispose(); }
  }
});

/** A 悬赏决策 card as the draft builds it (choices.js buildCards), by its enemy's name. */
function bountyCard(enemyName) {
  const c = DATA.choices.cards.bounty.find((x) => x.draft && DATA.enemies[x.enemyKey] && DATA.enemies[x.enemyKey].name === enemyName);
  assert.ok(c, `a draft bounty with ${enemyName}`);
  return { kind: 'bounty', id: c.effectId, name: c.name, tier: c.tier, coin: c.coin, payout: c.payout, rounds: c.rounds >= 90 ? 2 : c.rounds, enemyKey: c.enemyKey, count: c.count };
}

test('bounty pick: the card the own board can beat, never one it cannot (even when that one pays more)', () => {
  const h = soloBot({ seed: 5, difficulty: 'HARD' }).start();
  const m = h.m;
  const ps = m.order[0];
  h.run(() => m.phase === PHASE.PREP && m.round === 1);
  ps.lp = 999;
  h.run(() => m.phase === PHASE.PREP && m.round === 5);
  assert.ok(ps.deployCount >= 6, `a board (${ps.deployCount} deployed)`);
  const easy = bountyCard('源石虫'); // 550 HP, pays nothing
  const hard = bountyCard('泥岩巨像'); // 100000 HP, pays 3
  const huge = bountyCard('纠缠藤蔓'); // 90000 HP, pays 3
  const pe = bountyKillChance(m, ps, easy);
  const ph = bountyKillChance(m, ps, hard);
  assert.ok(pe > 0.8, `the board kills a 源石虫 (p ${pe.toFixed(2)})`);
  assert.ok(ph < 0.3, `…but not a 泥岩巨像 (p ${ph.toFixed(2)})`);
  assert.equal(botPickCard(m, ps, [hard, easy, huge].map((c, idx) => ({ ...c, idx })), [0, 1, 2]), 1);
  ps.lp = 2;
  assert.equal(botPickCard(m, ps, [hard, huge, easy].map((c, idx) => ({ ...c, idx })), [0, 1, 2]), 2, 'low LP: still the beatable one');
  const raw = [hard, easy].map((c) => DATA.choices.cards.bounty.find((x) => x.effectId === c.id));
  assert.deepEqual(m.offerBountyChoice(ps, raw, 'chess_item_6_03_m'), { ok: true });
  assert.deepEqual(m.autoPickPersonalChoice(ps, 'bot'), { ok: true });
  assert.equal(ps.personalChoice, null);
  assert.equal(ps.bounties.at(-1).card.enemyKey, easy.enemyKey, 'personal cards use bounty scoring too');
  const metaState = m.rngMeta.state(), botState = m.rngBots.state();
  m.autoPickPersonalChoice(ps, 'bot');
  m.autoPickPersonalChoice(ps, 'random');
  assert.equal(m.rngMeta.state(), metaState);
  assert.equal(m.rngBots.state(), botState, 'nothing pending: no RNG draws');
  m.dispose();
});

test('a bot\'s 教鞭 pick is deterministic: one seed offers the same three cards and picks the same one, drawing only on the bots\' rng', () => {
  const runs = [];
  for (let k = 0; k < 2; k++) {
    const h = soloBot({ seed: 5, difficulty: 'HARD' }).start();
    const m = h.m;
    const ps = m.order[0];
    h.run(() => m.phase === PHASE.PREP && m.round === 1);
    ps.lp = 999;
    h.run(() => m.phase === PHASE.PREP && m.round === 5);
    const art = giveItem(m, ps, 'chess_item_6_03_m');
    assert.deepEqual(ps.useArt(art.uid, 10, 5), { ok: true });
    const offered = ps.personalChoice.cards.map((c) => c.effectId);
    assert.equal(offered.length, 3);
    assert.equal(new Set(offered).size, 3, 'three different cards');
    const meta = m.rngMeta.state(), bots = m.rngBots.state();
    assert.deepEqual(m.autoPickPersonalChoice(ps, 'bot'), { ok: true });
    assert.equal(m.rngMeta.state(), meta, 'the pick leaves the meta rng alone');
    assert.notEqual(m.rngBots.state(), bots, 'one scoring draw per card from the bots\' rng');
    assert.equal(ps.personalChoice, null);
    runs.push({ offered, picked: ps.bounties.at(-1).card.effectId, bots: m.rngBots.state() });
    assert.ok(offered.includes(runs[k].picked));
    m.dispose();
  }
  assert.deepEqual(runs[0], runs[1]);
});

test('bounty pick in real drafts (绝境 R3 悬赏决策): a card the board likely beats (p ≥ 0.5) whenever a near-sure one (p ≥ 0.9) is offered', () => {
  let drafts = 0;
  for (const seed of [1, 2, 3, 4]) {
    const h = soloBot({ seed, difficulty: 'HARD', fake: true }).start();
    const m = h.m;
    const apply = m._applyCard.bind(m);
    m._applyCard = (ps, idx) => {
      const cards = m.sp ? m.sp.cards : [];
      if (cards.length && cards.every((c) => c.kind === 'bounty')) {
        drafts++;
        const p = cards.map((c) => bountyKillChance(m, ps, c));
        const best = Math.max(...p);
        const picked = p[cards.findIndex((c) => c.idx === idx)];
        if (best >= 0.9) assert.ok(picked >= 0.5, `seed ${seed} R${m.round}: picked p ${picked.toFixed(2)} while ${best.toFixed(2)} was offered`);
      }
      return apply(ps, idx);
    };
    h.run(() => m.phase === PHASE.PREP && m.round === 1);
    m.order[0].lp = 999;
    h.run(() => m.phase === PHASE.PREP && m.round === 4);
    assert.equal(m.errorCount, 0);
    m.dispose();
  }
  assert.ok(drafts >= 4, `${drafts} bounty drafts seen`);
});

test('items: 信标 on a bench single; both 博士投影 on a normal operator even when an elite is the best one; 突变细胞 never on an elite or a pair member; 拟态物质 on a pair', () => {
  const h = soloBot({ seed: 6 }).start();
  const m = h.m;
  const ps = m.order[0];
  h.run(() => m.phase === PHASE.PREP && m.round === 1);
  ps.lp = 999;
  h.run(() => m.phase === PHASE.ROUND_START && m.round === 7);
  const deployed = () => [...ps.board.values()].filter((p) => p.kind === 'chess');
  assert.ok(deployed().length >= 6);
  const owned = new Set(ps.allChess().map((p) => m.gd.baseIdOf(p.id)));
  const fresh = (tier) => Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && c.tier === tier && m.pool.left(c.chessId) >= 3 && !owned.has(c.chessId)).chessId;
  for (const p of ps.hand) if (p && p.kind === 'chess') ps.returnCopies(p);
  ps.hand.fill(null);
  // the highest-tier deployed operator becomes an elite: the most valuable piece on the board
  const [topKey, top] = [...ps.board.entries()].filter(([, p]) => p.kind === 'chess' && !m.gd.isGolden(p.id))
    .sort((a, b) => m.gd.chess(b[1].id).tier - m.gd.chess(a[1].id).tier || a[1].uid - b[1].uid)[0];
  ps.returnCopies(top);
  ps.board.delete(topKey);
  const elite = give(m, ps, m.gd.goldenIdOf(top.id), 'board', parseKey(topKey));
  const single = give(m, ps, fresh(4), 'hand');
  const pairId = fresh(1);
  const pairA = give(m, ps, pairId, 'hand');
  const pairB = give(m, ps, pairId, 'hand');
  const tierOf = (p) => m.gd.chess(p.id).tier;
  // 信标 (destroys its carrier for a pick of two of its tier)
  const beacon = itemTarget(m, ps, giveItem(m, ps, 'chess_item_5_04_e_a'));
  assert.equal(beacon && beacon.uid, single.uid, '信标 on the bench single');
  // 博士投影 (promotion; the golden one at once — 缪尔赛思's R1 item): a normal operator on the board, never the elite
  for (const id of ['chess_item_5_06_e_a', 'chess_item_5_06_e_b']) {
    const promo = itemTarget(m, ps, giveItem(m, ps, id));
    assert.ok(promo && deployed().includes(promo) && !m.gd.isGolden(promo.id), `${id} on a normal deployed operator`);
    assert.notEqual(promo.uid, elite.uid);
  }
  // 突变细胞 (becomes a random tier + 1 operator after the battle): normal, below VI, never one of the pair (the least
  // valuable pieces here) or the elite
  const cell = itemTarget(m, ps, giveItem(m, ps, 'chess_item_5_08_e_a'));
  assert.ok(cell && !m.gd.isGolden(cell.id) && tierOf(cell) < 6, '突变细胞 on a normal operator below VI');
  assert.ok(![pairA.uid, pairB.uid].includes(cell.uid), '…never one of a merge pair');
  // 拟态物质 (a third copy when two are owned): the pair
  const mimic = itemTarget(m, ps, giveItem(m, ps, 'chess_item_5_05_e_a'));
  assert.ok(mimic && [pairA.uid, pairB.uid].includes(mimic.uid), '拟态物质 on the pair');
  // …but not once the pool has no third copy: the item would give nothing (GitHub #207)
  m.pool.take(pairId, m.pool.left(pairId));
  const mimic2 = itemTarget(m, ps, giveItem(m, ps, 'chess_item_5_05_e_a'));
  assert.ok(mimic2 && ![pairA.uid, pairB.uid].includes(mimic2.uid), '拟态物质 not on a pair whose pool is out');
  // 盟约之币 (the same on anyone): a full carrier would lose an item to it (the replace rule, GitHub #263) — every
  // deployed operator wears two items here, so a bench operator with free slots takes it
  for (const p of deployed()) while (p.items.length < m.gd.equipPerChess) p.items.push(ps.newPiece('item', 'chess_item_3_03_e_a'));
  const coin = itemTarget(m, ps, giveItem(m, ps, 'chess_item_1_03_e_a'));
  assert.ok(coin && [single.uid, pairA.uid, pairB.uid].includes(coin.uid), '盟约之币 on an operator with a free slot');
  m.dispose();
});

test('bounty Arts (教鞭): kept after a battle with leaks, used after a perfect one; a full hand drops it on a bot\'s seat, never on a human\'s seat under AI 托管', () => {
  const WHIP = 'chess_item_6_03_m';
  const owns = (ps, id) => [...ps.hand, ...ps.temp].some((p) => p && p.id === id);
  const leaky = { killed: 5, total: 6, leaked: [{ counted: true }], perfect: false };
  const clean = { killed: 6, total: 6, leaked: [], perfect: true };
  {
    const h = soloBot({ seed: 4 }).start();
    const m = h.m;
    const ps = m.order[0];
    h.run(() => m.phase === PHASE.PREP && m.round === 1);
    ps.lp = 999;
    h.run(() => m.phase === PHASE.PREP && m.round === 3);
    m.lastResults.set(ps.playerId, leaky);
    giveItem(m, ps, WHIP);
    h.run(() => m.phase === PHASE.COMBAT && m.round === 3);
    assert.ok(owns(ps, WHIP), 'kept after a battle with leaks (not destroyed)');
    h.run(() => m.phase === PHASE.PREP && m.round === 4);
    m.lastResults.set(ps.playerId, clean);
    giveItem(m, ps, WHIP);
    const bounties = ps.bounties.length;
    h.run(() => m.phase === PHASE.COMBAT && m.round === 4);
    assert.ok(!owns(ps, WHIP) && ps.bounties.length === bounties + 2, 'both Arts used and picked after a perfect battle');
    assert.equal(ps.personalChoice, null);
    assert.equal(ps.round.arts, 2);
    assert.equal(m.errorCount, 0);
    m.dispose();
  }
  for (const human of [false, true]) {
    const seat = human ? { seat: 0, playerId: 'p_0', name: 'P', isBot: false, connected: true } : { seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true };
    const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seats: [seat], seed: 4 }).start();
    const m = h.m;
    const ps = m.order[0];
    if (human) assert.ok(m.setAutoplay(ps, true).ok, 'AI 托管 on');
    h.run(() => m.phase === PHASE.PREP && m.round === 1);
    ps.lp = 999;
    h.run(() => m.phase === PHASE.PREP && m.round === 3);
    m.lastResults.set(ps.playerId, leaky);
    // a full hand at the prep end with the 教鞭 in it
    const owned = new Set(ps.allChess().map((p) => m.gd.baseIdOf(p.id)));
    const fillers = Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && c.tier === 1 && m.pool.left(c.chessId) >= 1 && !owned.has(c.chessId));
    giveItem(m, ps, WHIP);
    for (let i = 0; ps.hand.some((x) => x == null); i++) give(m, ps, fillers[i].chessId, 'hand');
    const chessBefore = ps.allChess().length;
    botPrepEnd(m, ps);
    assert.ok(ps.hand.some((x) => x == null), 'a hand slot is free');
    if (human) {
      assert.ok(owns(ps, WHIP), 'a human\'s 教鞭 is never destroyed by AI 托管');
      assert.equal(ps.allChess().length, chessBefore - 1, 'a bench chess was sold instead');
    } else {
      assert.ok(!owns(ps, WHIP), 'the bot drops its kept 教鞭 for the slot');
      assert.equal(ps.allChess().length, chessBefore, 'no chess sold');
    }
    m.dispose();
  }
});

test('a tactician\'s 援军 (伺夜\'s 狼群) is placed on a tactical point inside the tactician\'s attack range', () => {
  const VIGIL = 'chess_char_3_19_a';
  const WOLF = 'token_10028_vigil_wolf';
  for (const seed of [3, 8]) {
    const h = soloBot({ seed }).start();
    const m = h.m;
    const ps = m.order[0];
    h.run(() => m.phase === PHASE.PREP && m.round === 2);
    for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
    ps.board.clear();
    ps.hand.fill(null);
    ps.recompute();
    const vigil = give(m, ps, VIGIL, 'hand');
    const melee = Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && c.tier === 1 && c.position === 'MELEE' && c.attackKind === 'melee').slice(0, 2);
    for (const c of melee) give(m, ps, c.chessId, 'hand');
    arrange(m, ps);
    const at = [...ps.board.entries()].find(([, p]) => p.uid === vigil.uid);
    assert.ok(at, '伺夜 deployed');
    const wolf = [...ps.board.entries()].find(([, p]) => p.kind === 'token' && p.id === WOLF);
    assert.ok(wolf, `seed ${seed}: the 狼群 is placed`);
    const [r, c] = parseKey(at[0]);
    assert.ok(rangeTiles(m.gd.chess(VIGIL), r, c, at[1].dir || 'RIGHT').includes(wolf[0]), `seed ${seed}: 狼群 at ${wolf[0]} inside 伺夜's range from ${at[0]}`);
    checkInvariants(m);
    m.dispose();
  }
});

test('economy: a held pair is completed — bought when affordable, else the shop is frozen and the copy bought next round', () => {
  const h = soloBot({ seed: 9 }).start();
  const m = h.m;
  const ps = m.order[0];
  h.run(() => m.phase === PHASE.PREP && m.round === 1);
  ps.lp = 999;
  h.run(() => m.phase === PHASE.ROUND_START && m.round === 6);
  const owned = new Set(ps.allChess().map((p) => m.gd.baseIdOf(p.id)));
  const id = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && c.tier === 2 && m.pool.left(c.chessId) >= 4 && !owned.has(c.chessId)).chessId;
  for (const p of ps.hand) if (p && p.kind === 'chess') ps.returnCopies(p);
  ps.hand.fill(null);
  give(m, ps, id, 'hand');
  give(m, ps, id, 'hand');
  h.run(() => m.phase === PHASE.PREP && m.round === 6);
  // the third copy in the shop, unaffordable this prep
  ps.funds = 0;
  ps.shop.slots[0] = { kind: 'chess', id, basePrice: m.gd.chessPrice(id), price: m.gd.chessPrice(id), sold: false, frozen: false };
  const merges = ps.stats.merges;
  h.run(() => m.phase === PHASE.COMBAT && m.round === 6);
  if (ps.stats.merges === merges) {
    assert.ok(ps.shop.slots[0] && ps.shop.slots[0].id === id && ps.shop.slots[0].frozen, 'the shop was frozen with the third copy in it');
    h.run(() => m.phase === PHASE.COMBAT && m.round === 7);
  }
  assert.ok(ps.stats.merges > merges, 'the pair was completed');
  assert.ok(ps.allChess().some((p) => p.id === m.gd.goldenIdOf(id)), 'the elite is owned');
  checkInvariants(m);
  m.dispose();
});

test('坎诺特 (利滚利: leftover funds are kept, +1 at ≥ 5): with a full board the bot banks its interest capital instead of refreshing it away', () => {
  let checked = 0;
  for (const seed of [5, 7, 9]) {
    const h = soloBot({ seed }).start();
    const m = h.m;
    const ps = m.order[0];
    h.run(() => m.phase === PHASE.PREP && m.round === 1);
    ps.lp = 999;
    h.run(() => m.phase === PHASE.PREP && m.round === 7);
    ps.bandId = 'band_cannot';
    assert.ok(m.gd.leftoverKeptBands.includes(ps.bandId));
    ps.funds = 14;
    const merges = ps.stats.merges;
    // the level-up on the curve is paid for first (its price depends on the rounds the run levelled at: 9 or 10 here);
    // after it the bot buys / refreshes nothing that takes it under the 5 capital
    const level0 = ps.shop.level, price0 = ps.shop.upgradePrice;
    h.run(() => m.phase === PHASE.COMBAT && m.round === 7);
    // (a merge may spend the reserve)
    if (ps.stats.merges === merges) {
      checked++;
      const afterLevelUp = 14 - (ps.shop.level > level0 ? price0 : 0);
      assert.ok(ps.funds >= Math.min(5, afterLevelUp), `seed ${seed}: ${ps.funds} funds banked (${afterLevelUp} after the level-up)`);
    }
    m.dispose();
  }
  assert.ok(checked >= 2, `${checked} preps without a merge`);
});

test('bond plan: a teammate\'s main core bond (its bond strip — a human\'s too) counts against the bot\'s focus (the shop pool is shared)', () => {
  const SARGON = ['chess_char_1_12_a', 'chess_char_2_06_a', 'chess_char_2_08_a'];
  const KAZIMIERZ = ['chess_char_1_19_a', 'chess_char_2_12_a', 'chess_char_2_18_a'];
  const focusWhenMateBuilds = (mateIds) => {
    const seats = [{ seat: 0, playerId: 'p_0', name: 'P', isBot: false, connected: true }, { seat: 1, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }];
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats, seed: 3 }).start();
    const m = h.m;
    const [human, ai] = m.order;
    h.run(() => m.phase === PHASE.PREP && m.round === 2);
    for (const ps of [human, ai]) {
      for (const p of ps.allChess()) ps.returnCopies(p);
      ps.board.clear();
      ps.hand.fill(null);
      ps.temp.fill(null);
      ps.layers = {};
    }
    for (const id of [SARGON[0], SARGON[1], KAZIMIERZ[0], KAZIMIERZ[1]]) give(m, ai, id, 'hand');
    for (const id of mateIds) give(m, human, id, 'board', legalTileFor(m, human, id));
    human.recompute();
    ai.recompute();
    ai._botFocus = null;
    ai._botFocusId = null;
    const { focus } = bondPlan(m, ai);
    m.dispose();
    return focus;
  };
  assert.equal(focusWhenMateBuilds(SARGON), 'kazimierzShip', 'the human builds 萨尔贡: the bot takes 卡西米尔');
  assert.equal(focusWhenMateBuilds(KAZIMIERZ), 'sargonShip', 'the human builds 卡西米尔: the bot takes 萨尔贡');
});

test('merged rules (0.1.1): an attack on every enemy in range counts double (阵法术师 / 轰击术师 rangeAoe); a unit is planned with the range it is deployed with', () => {
  const rec = (id) => DATA.chess[id];
  const raw = (r) => (r.stats.atk / (r.stats.bat * 100 / r.stats.aspd));
  // 阿罗玛 (轰击术师, attacks every enemy on her line) vs a single-target sniper: effDps without a field model is the raw DPS
  // × the crowd factor
  const aroma = rec('chess_char_4_10_a'), inside = rec('chess_char_1_01_a');
  assert.ok(Math.abs(effDps(null, aroma) - raw(aroma) * 2) < 1e-6, '轰击术师 ×2');
  assert.ok(Math.abs(effDps(null, inside) - raw(inside)) < 1e-6, 'a single-target dealer ×1');
  // the elite 信仰搅拌机 with SPT-Y (特性 攻击距离 +1): the bot covers the extended grid the server's summonRange and the card use
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 3, fake: true }).start();
  const ps = h.ps('p_0');
  const mixer = rec('chess_char_4_01_b');
  const mod = (mixer.modules || []).find((x) => x.typeName === 'SPT-Y');
  if (mod) {
    ps.loadout = Object.freeze({ chess_char_4_01_a: Object.freeze({ skill: mixer.skill?.index ?? 2, module: mod.uniEquipId }) });
    const r = rangeRec(ps, mixer);
    assert.ok(r.rangeGrid.length > mixer.rangeGrid.length, `the deployed grid (${r.rangeGrid.length} tiles) is the extended one (${mixer.rangeGrid.length})`);
  }
  assert.equal(rangeRec(ps, inside), inside, 'no loadout difference: the record itself');
  h.m.dispose();
});

test('cost guard: the prep heuristics of a late-round 4-bot match stay cheap (rehearsal off)', () => {
  const seats = [0, 1, 2, 3].map((i) => ({ seat: i, playerId: `ai_${i}`, name: `AI${i}`, isBot: true, connected: true }));
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats, seed: 13, fake: true }).start();
  const m = h.m;
  h.run(() => m.phase === PHASE.PREP && m.round === 1);
  for (const ps of m.order) ps.lp = 999;
  h.run(() => m.phase === PHASE.PREP && m.round === 10);
  let worst = 0;
  for (const ps of m.alivePlayers()) {
    // CPU time (process.cpuUsage) rather than wall clock: a loaded host stretches it far less
    const u0 = process.cpuUsage();
    assert.equal(botPrepBegin(m, ps), null, 'no rehearsal job with rehearsal off');
    const u = process.cpuUsage(u0);
    worst = Math.max(worst, (u.user + u.system) / 1000);
  }
  // 7–35 ms of CPU per bot prep R6–R13 (seeds 13–15); ≈ 10× headroom for a loaded host
  assert.ok(worst < 300, `worst bot prep ${worst.toFixed(1)} ms of CPU`);
  assert.equal(m.errorCount, 0);
  m.dispose();
});

test('bench shed: the buy loop never sells a piece that came this prep (it used to sell the single it had just bought back for 1)', async () => {
  // QA of the 0.1.1 bots: co-op 绝境, 2 humans on AI 托管 + 2 bots, seeds 21–23 — 29 same-prep buy → sell in 6 matches,
  // every one the buy loop's pre-emptive bench shed (the buy picks by lineup gain, the shed by piece value)
  const { PlayerState } = await import('../../server/match/PlayerState.js');
  const oSell = PlayerState.prototype.sell;
  const shed = [];
  PlayerState.prototype.sell = function (uid) {
    const loc = this.find(uid);
    const p = loc && loc.piece;
    if (p && p.boughtRound === this.m.round && /buyLoopSteps/.test(new Error().stack)) shed.push(`${p.id} R${this.m.round}`);
    return oSell.call(this, uid);
  };
  try {
    for (const seed of [21, 22, 23]) {
      const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 2, bots: 2, seed, botRehearsal: 0 });
      h.start();
      h.autoHumans();
      const m = h.m;
      h.run(() => h.ended != null, { maxSteps: 3e7 });
      assert.equal(m.errorCount, 0);
      m.dispose();
    }
  } finally { PlayerState.prototype.sell = oSell; }
  assert.deepEqual(shed, [], 'no piece of this prep sold by the shed');
});
