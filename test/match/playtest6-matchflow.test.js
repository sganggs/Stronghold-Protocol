// User playtest #6, match flow (workstream WC): #4 悬赏决策 bounty enemies keep coming back, #19 the merge reward offers
// the same operator twice, #7 the 联防 leak counter (server side; the HUD helpers are in test/ui/playtest6-unite.test.js);
// GitHub #235, the 联防 outcome in the SETTLE view (the result box's words: test/ui/gameLogic.test.js).
// Real match paths (the match harness in virtual time), real data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { DATA, makeMatch, give, chessOfTier, checkInvariants } from './harness.js';
import { FakeBattle } from './fakeBattle.js';
import { GameData } from '../../server/match/gamedata.js';
import { generateDraft, cardView, bountyCard, MULTI_ROUND_BOUNTY_BATTLES } from '../../server/match/choices.js';
import { createRng } from '../../server/sim/rng.js';
import { Battle } from '../../server/sim/Battle.js';
import { uniteLeft, battleProgress } from '../../server/sim/spec.js';
import { uniteSurvivors } from '../../server/match/unite.js';
import { attachSimClients } from './simClient.js';

// =====================================================================================================================
// #19 — "拿到三个相同干员合成高级干员时赠送的3选1干员经常出现两个一样的，没记错的话官方原版不会"

/** A solo prep at shop level `level` with an empty board and hand (the pool untouched). */
function soloPrep(seed, level = 1) {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.shop.level = level;
  ps.recompute();
  ps.funds = 100;
  return { h, m: h.m, ps };
}

test('#19 the promotion reward (3 copies → 精锐) offers three DIFFERENT operators of tier level + 1 — the real merge path', () => {
  let offers = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const { m, ps } = soloPrep(600 + seed, 1 + (seed % 5));
    // merge three copies of one tier-I operator (two in the hand, the third bought from the shop)
    const id = chessOfTier(1).find((x) => m.pool.has(x) && m.pool.left(x) >= 3);
    give(m, ps, id);
    give(m, ps, id);
    ps.shop.slots[0] = { kind: 'chess', id, basePrice: m.gd.chessPrice(id), frozen: false, sold: false };
    assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
    assert.equal(ps.stats.merges, 1, 'merged');
    const offer = ps.privateView().shop.rewardOffer;
    assert.ok(offer, 'a reward offer');
    const tier = Math.min(ps.shop.level + 1, 6);
    assert.equal(offer.tier, tier);
    const ids = offer.slots.map((s) => s.id);
    assert.equal(ids.length, 3);
    assert.equal(new Set(ids).size, 3, `seed ${seed}: three different operators (${ids.join(', ')})`);
    for (const x of ids) assert.equal(DATA.chess[x].tier, tier, `${x} is tier ${tier}`);
    offers++;
    checkInvariants(m);
    m.dispose();
  }
  assert.equal(offers, 12);
});

test('#19 many reward offers at every shop level: never the same operator twice; offers reserve no copies', () => {
  const { m, ps } = soloPrep(640);
  let dupBefore = 0;
  for (let level = 1; level <= 6; level++) {
    ps.shop.level = level;
    for (let k = 0; k < 60; k++) {
      const before = m.pool.snapshot();
      const offer = ps.pushRewardOffer('merge');
      const ids = offer.slots.map((s) => s.id);
      if (new Set(ids).size !== ids.length) dupBefore++;
      assert.equal(ids.length, 3);
      for (const x of ids) assert.equal(DATA.chess[x].tier, Math.min(level + 1, 6));
      assert.deepEqual(m.pool.snapshot(), before, 'an offer takes no copies (only the pick does)');
      ps.offers.length = 0;
    }
  }
  assert.equal(dupBefore, 0, `${dupBefore} of 360 offers showed an operator twice`);
  m.dispose();
});

test('#19 a tier short of different operators: the offer tops up from the tier below, still three different ones; the pick keeps the pool exact', () => {
  const { m, ps } = soloPrep(650, 3); // offers of tier IV
  const t4 = chessOfTier(4).filter((x) => m.pool.has(x));
  const keep = t4.slice(0, 2);
  const drained = new Map();
  for (const x of t4) if (!keep.includes(x)) drained.set(x, m.pool.take(x, 100));
  for (let k = 0; k < 20; k++) {
    const offer = ps.pushRewardOffer('merge');
    const ids = offer.slots.map((s) => s.id);
    assert.equal(new Set(ids).size, 3, ids.join(', '));
    assert.deepEqual(ids.filter((x) => DATA.chess[x].tier === 4).sort(), keep.slice().sort(), 'both tier-IV operators left are offered');
    assert.equal(ids.filter((x) => DATA.chess[x].tier === 3).length, 1, 'the third comes from tier III');
    if (k < 19) ps.offers.length = 0;
  }
  // pick the tier-III one: one copy leaves the pool, into the hand
  const offer = ps.offers[0];
  const idx = offer.slots.findIndex((s) => DATA.chess[s.id].tier === 3);
  const id = offer.slots[idx].id;
  const left = m.pool.left(id);
  assert.deepEqual(m.handle('p_0', { t: 'g.reward', idx }), { ok: true });
  assert.equal(m.pool.left(id), left - 1);
  assert.ok(ps.hand.some((p) => p && p.id === id));
  for (const [x, n] of drained) m.pool.give(x, n);
  checkInvariants(m);
  m.dispose();
});

// =====================================================================================================================
// #4 — "官方版悬赏决策的敌人我没记错的话正常只会在选择之后出现两回合，现在是一直出"
// v2.4.1 drafted 战术特训 (only 法术教鞭 makes those) and the hidden 鸭爵 set, put one or more multi-round "之后 / 后续的每场
// 作战" cards in about half of the co-op R3 drafts and showed every card as plain text, so a "每场" card looked like a
// "下场" one. Now: no 战术特训 / 鸭爵 set (战术特训 is the 教鞭 Art's, test/content/items.test.js); since player feedback
// #2 the drafts follow the 66 official screenshots (test/match/feedback1-bounty.test.js), where no multi-round card
// appears; each card names its battles in the official colours (blue "下场作战" / "两场作战", red "每场"); a 1–2-battle
// bounty stops after its battles; a multi-round card (教鞭's 法术大师A2·多轮战术特训) lasts two battles.

const BOUNTY_MODES = ['mode_multi_normal', 'mode_multi_hard', 'mode_multi_abyss', 'mode_single_hard', 'mode_single_abyss'];
/** 鸭爵 / 高普尼克 / 流泪小子 / 圆仔·悬赏: commented out of the PRTS 敌人轮选 table */
const HIDDEN = new Set(['enemyeffect_5', 'enemyeffect_6', 'enemyeffect_7', 'enemyeffect_8']);
/** The official rich text of a card's battles (activity_table effectDesc): 1 / 2 battles in blue, every battle in red. */
const DURATION_RE = { 1: /<@ba\.vup>下场(作战|战斗)<\/>/, 2: /<@ba\.vup>两场作战<\/>/, 99: /<@ba\.vdown>每场<\/>/ };
/** The official multi-round cards ("之后 / 后续的每场作战"): two battles since the user's playtest #6 answer. */
const MULTI = new Set(DATA.choices.cards.bounty.filter((c) => c.multiRound).map((c) => c.effectId));

test('#4 the 悬赏决策 draft: kill bounties only (no 战术特训, no 鸭爵 set, no multi-round card), each naming its battles in the official colours', () => {
  let bountyDrafts = 0;
  let cards = 0;
  for (const modeId of BOUNTY_MODES) {
    const gd = new GameData(DATA, modeId);
    const sch = DATA.choices.schedule[modeId];
    for (const r of sch.spRounds) {
      for (let seed = 1; seed <= 25; seed++) {
        const d = generateDraft(gd, createRng(seed * 131 + r), r, { stageId: 'act2autochess_m01' });
        if (!d || d.family !== 'bounty') continue;
        bountyDrafts++;
        assert.equal(new Set(d.cards.map((c) => c.id)).size, d.cards.length, 'distinct cards');
        for (const c of d.cards) {
          cards++;
          assert.equal(c.payout, 'kill', `${modeId} R${r}: ${c.id} ${c.name} — 战术特训 comes from 法术教鞭 only`);
          assert.ok(!HIDDEN.has(c.id), `${c.id} ${c.name}: hidden from the PRTS table`);
          assert.ok([1, 2].includes(c.rounds), `${c.id}: ${c.rounds} battles`);
          assert.ok(!MULTI.has(c.id), `${c.id} ${c.name}: no official draft shows a multi-round card (player feedback #2)`);
          assert.match(c.descRaw || '', DURATION_RE[c.rounds], `${c.id} ${c.name}: the card text shows its battles (${c.descRaw})`);
          assert.equal(cardView(c).descRaw, c.descRaw, 'the public card carries the rich text (ui/choiceOverlay.js renders it first)');
        }
      }
    }
  }
  assert.ok(bountyDrafts >= 100 && cards >= 400, `${bountyDrafts} bounty drafts, ${cards} cards`);
});

test('#4 data: cards.bounty marks the draft pool — 战术特训 (教鞭), the 鸭爵 set and the cards no official draft shows are out, 源石虫·特训 in', () => {
  const list = DATA.choices.cards.bounty;
  const reasons = {};
  for (const c of list) {
    if (c.payout !== 'kill') assert.equal(c.draftExcluded, 'perfect', `${c.effectId} ${c.name}`);
    else if (HIDDEN.has(c.effectId)) assert.equal(c.draftExcluded, 'hidden', `${c.effectId} ${c.name}`);
    if (!c.draft) reasons[c.draftExcluded] = (reasons[c.draftExcluded] || 0) + 1;
    else assert.equal(c.draftExcluded, null);
  }
  assert.deepEqual(reasons, { perfect: 20, hidden: 4, unseen: 19 });
  assert.equal(list.filter((c) => c.draft).length, 86);
  const multi = list.filter((c) => c.rounds >= 99 && c.payout === 'kill');
  assert.equal(multi.length, 7, '多轮悬赏 · 假想敌 ×6 + 山海众头目·多轮悬赏');
  assert.ok(multi.every((c) => !c.draft && c.draftExcluded === 'unseen'), 'in none of the 59 official bounty drafts');
  const slime = list.find((c) => c.effectId === 'enemyeffect_5_1');
  assert.ok(slime.draft && slime.draftPool === 'boss', '源石虫·特训 is an R9 card (16 of the 23 official R9 drafts)');
});

/** Drive a co-op 绝境 match to its R3 bounty draft; the human takes the first free card `want(card, free)` accepts. */
function pickAtR3(seed, want) {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1, bots: 1, seed, fake: true }).start();
  const m = h.m;
  const ok = h.drive(() => m.phase === PHASE.SP_DRAFT && m.round === 3, { ready: true });
  assert.ok(ok && m.sp.family === 'bounty', `seed ${seed}: the R3 bounty draft`);
  let picked = null;
  for (let guard = 0; guard < 200 && m.phase === PHASE.SP_DRAFT; guard++) {
    if (m.spTurn() === 'p_0') {
      const free = m.sp.cards.filter((c) => m.sp.taken[c.idx] == null);
      picked = free.find((c) => want(c, free)) || null;
      if (!picked) break;
      assert.deepEqual(m.handle('p_0', { t: 'g.choice', idx: picked.idx }), { ok: true });
    } else h.sched.runNext();
  }
  return { h, m, ps: h.ps('p_0'), picked };
}

/** Rounds whose normal battle of p_0 spawned bounty `bountyId`. */
function bountyRounds(bountyId) {
  const out = [];
  for (const f of FakeBattle.instances) {
    if (f.kind !== 'normal' || !f.players.includes('p_0')) continue;
    if (f.spawns.some((s) => s.tag === 'bounty' && s.mods && s.mods.bountyId === bountyId)) out.push(f.round);
  }
  return out;
}

test('#4 E2E (co-op 绝境, the real R3 draft): a 1–2-battle bounty\'s enemies come for its battles and never again', () => {
  const seen = [];
  for (let seed = 1; seed <= 6; seed++) {
    // the human takes the longest short bounty on offer (a "接下来两场作战" one when there is one)
    const { h, m, ps, picked } = pickAtR3(660 + seed, (c, free) => c.rounds <= 2 && c.rounds === Math.max(...free.filter((x) => x.rounds <= 2).map((x) => x.rounds)));
    assert.ok(picked, 'picked a card');
    const b = ps.bounties.find((x) => x.card.effectId === picked.id);
    assert.ok(b, 'the picker holds the bounty');
    h.drive(() => m.phase === PHASE.ROUND_START && m.round === 9, { ready: true });
    const expect = picked.rounds === 1 ? [3] : [3, 4];
    const got = bountyRounds(b.id);
    assert.deepEqual(got, expect, `seed ${seed}: ${picked.id} ${picked.name} (${picked.rounds} battles) spawned in R${got.join(', R')}`);
    assert.equal(ps.bounties.length, 0, 'no bounty left after its battles');
    seen.push(picked.rounds);
    m.dispose();
  }
  assert.ok(seen.includes(2), 'a two-battle card was picked at least once');
});

test('#4 E2E: a multi-round card lasts two battles like the "两场作战" cards — blue text on the card and in the effects column (the user\'s call)', () => {
  // "我不记得有过多轮悬赏" (user, after playtest #6): choices.js MULTI_ROUND_BOUNTY_BATTLES = 2; null restores 每场. No
  // official draft shows a multi-round card (player feedback #2); 教鞭's 法术大师A2·多轮战术特训 is one
  assert.equal(MULTI_ROUND_BOUNTY_BATTLES, 2);
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1, bots: 1, seed: 701, fake: true }).start();
  const m = h.m;
  h.toPrep(4);
  const ps = h.ps('p_0');
  const src = DATA.choices.cards.bounty.find((c) => c.effectId === 'enemyeffect_2');
  assert.ok(MULTI.has(src.effectId) && src.payout === 'perfect', '法术大师A2·多轮战术特训');
  const card = bountyCard(m.gd, src);
  assert.equal(card.rounds, 2);
  assert.match(card.descRaw, /接下来<@ba\.vup>两场作战<\/>/, 'the card says 两场作战 in blue');
  assert.ok(!/每场/.test(card.descRaw), 'no red 每场');
  const id = m.addBounty(ps, src);
  const b = ps.bounties.find((x) => x.id === id);
  assert.equal(b.roundsLeft, 2);
  const e = ps.privateView().effects.find((x) => x.id === b.id);
  assert.equal(e.counterText, '还剩 2 场作战');
  assert.match(e.desc, /<@ba\.vup>两场作战<\/>/, 'the effects tooltip says the same');
  h.drive(() => m.phase === PHASE.ROUND_START && m.round === 7, { ready: true });
  assert.deepEqual(bountyRounds(b.id), [4, 5], 'its enemies come for two battles, then never again');
  assert.ok(!ps.bounties.some((x) => x.id === b.id), 'and the bounty is gone');
  m.dispose();
});

test('#4 the active bounty says how many battles it has left, with its card text in the official colours (effects column)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1, bots: 1, seed: 670, fake: true }).start();
  const m = h.m;
  h.toPrep(1);
  const ps = h.ps('p_0');
  const card = DATA.choices.cards.bounty.find((c) => c.draft && c.rounds === 2 && m.gd.enemy(c.enemyKey));
  m.addBounty(ps, card);
  const e = ps.privateView().effects.find((x) => x.name === card.name);
  assert.ok(e, 'listed');
  assert.equal(e.counter, 2);
  assert.equal(e.counterText, '还剩 2 场作战');
  assert.match(e.desc, /<@ba\.vup>两场作战<\/>/);
  m.dispose();
});

// =====================================================================================================================
// #7 — "联防阶段队友漏掉的怪要是被打掉了漏怪的数字实时回调（现在好像最高只显示漏10个…十个以上最多只会一次扣10滴血的规则保持不变）"

const LEAKS = 14; // more than the 10-LP cap
const SLIME = 'enemy_1007_slime';

/** Real battles whose 联防 helpers strike down one of the leaked enemies every `every` game seconds (from 4 s on). */
function slowHelpers(every = 6) {
  return class SlowHelpers extends Battle {
    constructor(opts) {
      super(opts);
      if (this.kind !== 'unite') return;
      let next = 4;
      this.on('tick', () => {
        if (this.time < next) return;
        const e = this.enemies.find((x) => x.alive && x.counted);
        if (!e) return;
        this.kill(e, null);
        next += every;
      });
    }
  };
}

/** Normal-battle results of the round: `leaker` let `n` `key` enemies (LEAKS 源石虫) through, everyone else was perfect. */
function craftedResults(m, leaker, key = SLIME, n = LEAKS) {
  const out = new Map();
  for (const ps of m.alivePlayers()) {
    const leaked = ps.playerId === leaker
      ? Array.from({ length: n }, () => ({ enemyKey: key, mods: { hpMul: 1, atkMul: 1, speedMul: 1 }, lpr: 1, sourcePlayerId: leaker, tag: null, counted: true }))
      : [];
    out.set(ps.playerId, { leaked, perfect: leaked.length === 0, coins: 0, layerGains: {}, killed: 5, total: 5 + leaked.length, damageDealt: 0, unitsEnd: [] });
  }
  return out;
}

/** Enter the 联防 of round 1 from crafted COMBAT results (the real planner, field and settlement from there). */
function enterUnite(h, leaker, key = SLIME, n = LEAKS) {
  const m = h.m;
  h.drive(() => m.phase === PHASE.PREP && m.round === 1, { ready: false });
  m.phase = PHASE.COMBAT;
  m.fields = [];
  m.lastResults = craftedResults(m, leaker, key, n);
  m._afterCombat();
  assert.equal(m.phase, PHASE.UNITE, '联防');
  assert.deepEqual(m.unitePlan.leakers.map((p) => p.playerId), [leaker]);
}

/** m.public players[] entry of a player. */
const pubOf = (m, pid) => m.publicView().players.find((p) => p.playerId === pid);

/** Follow the leaker's public count until the 联防 ends; returns the samples [uniteLeft, pendingLp]. */
function followUnite(h, leaker, stepMs = 500) {
  const m = h.m;
  const seen = [];
  for (let i = 0; i < 4000 && m.phase === PHASE.UNITE; i++) {
    const p = pubOf(m, leaker);
    if (p && Number.isFinite(p.uniteLeft)) seen.push([p.uniteLeft, p.pendingLp ?? 0]);
    h.sched.advance(stepMs);
  }
  return seen;
}

function checkCounter(seen, lpBefore, lpAfter) {
  assert.ok(seen.length > 5, `${seen.length} samples`);
  assert.equal(seen[0][0], LEAKS, `the counter starts at every enemy that got through (${LEAKS}, not capped at 10)`);
  assert.equal(seen[0][1], 10, 'the LP about to be lost is capped at 10');
  // 源石虫 never split or summon: here it can only fall (a splitting enemy raises it — the 磨砻 test below)
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i][0] <= seen[i - 1][0], `no split, so it never rises (${seen[i - 1][0]} → ${seen[i][0]})`);
  for (const [left, pending] of seen) assert.equal(pending, Math.min(10, left), `pendingLp = min(10, ${left})`);
  const distinct = new Set(seen.map((s) => s[0]));
  assert.ok(distinct.size >= 4, `it moved live: ${[...distinct].join(' → ')}`);
  const last = seen[seen.length - 1][0];
  assert.ok(last < 10, `helpers brought it under the cap (${last})`);
  assert.equal(lpBefore - lpAfter, Math.min(10, last), `settled LP loss = min(10, ${last} left)`);
}

/** Run on until the round's settlement has been applied. */
const toSettled = (h) => assert.ok(h.drive(() => h.m.phase !== PHASE.UNITE && h.m.phase !== PHASE.SETTLE, { ready: false }));

test('#7 联防 (server-run): the leaker\'s count of its enemies still standing falls live as the helpers kill them; LP loss stays capped at 10', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 700, instant: false });
  h.m.BattleClass = slowHelpers();
  h.start();
  enterUnite(h, 'p_1');
  const leaker = h.ps('p_1');
  const lp = leaker.lp;
  assert.equal(pubOf(h.m, 'p_0').uniteLeft, undefined, 'only leakers carry the counter');
  const seen = followUnite(h, 'p_1');
  toSettled(h);
  checkCounter(seen, lp, leaker.lp);
  h.m.dispose();
});

test('#7 联防 (client-side combat, a human helper runs it): b.progress carries `left`; the server republishes it to everyone', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 701, instant: false, clientCombat: true, clients: false });
  h.clients = attachSimClients(h, { BattleClass: slowHelpers(), pace: 'paced' });
  h.start();
  enterUnite(h, 'p_1');
  const leaker = h.ps('p_1');
  const lp = leaker.lp;
  const seen = followUnite(h, 'p_1');
  toSettled(h);
  checkCounter(seen, lp, leaker.lp);
  const lefts = h.clients.get('p_0').log.filter((x) => x.t === 'b.progress' && x.left);
  assert.ok(lefts.length > 3, 'the authority reported the leakers\' counts');
  assert.ok(lefts.every((x) => Object.keys(x.left).every((k) => k === 'p_1')), 'only the leaker\'s enemies');
  h.clients.closeAll();
  h.m.dispose();
});

test('#7 联防 (client-side combat, a bot helper: the server runs it headlessly) — the timeline carries the counts on the field clock', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 702, instant: false, clientCombat: true });
  h.m.BattleClass = slowHelpers();
  h.start();
  enterUnite(h, 'p_0');
  assert.equal(h.m.fields[0].mode, 'server', 'the bot helper\'s field runs on the server');
  const leaker = h.ps('p_0');
  const lp = leaker.lp;
  const seen = followUnite(h, 'p_0');
  toSettled(h);
  checkCounter(seen, lp, leaker.lp);
  h.clients.closeAll();
  h.m.dispose();
});

test('#7 uniteLeft (sim) = each source\'s enemies unspawned + alive + through again; at the end = unite.js uniteSurvivors', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 703, instant: false });
  h.m.BattleClass = slowHelpers(9);
  h.start();
  enterUnite(h, 'p_1');
  const b = h.m.fields[0].battle;
  const samples = [];
  for (let i = 0; i < 4000 && !b.finished; i++) {
    h.sched.advance(250);
    if (b.finished) break;
    const left = uniteLeft(b);
    const pending = b._pending.filter((p) => p.sourcePlayerId === 'p_1').length;
    const alive = b.enemies.filter((e) => e.alive && e.counted && e.sourcePlayerId === 'p_1').length;
    const through = Object.values(b._perPlayer).flatMap((pp) => pp.leaked).filter((l) => l.counted !== false && l.sourcePlayerId === 'p_1').length;
    assert.equal(left.p_1 || 0, pending + alive + through);
    assert.equal((left.p_1 || 0) + b.killed, LEAKS, 'standing + struck down = what got through');
    samples.push(left.p_1 || 0);
  }
  assert.ok(b.finished);
  const survivors = uniteSurvivors(h.m.unitePlan, b.result()).get('p_1') || 0;
  assert.equal(uniteLeft(b).p_1 || 0, survivors, 'the finished field: exactly the survivors settle() charges');
  assert.equal(battleProgress(b).left.p_1 || 0, survivors, 'battleProgress carries it (b.progress `left`)');
  assert.ok(samples[0] === LEAKS && samples[samples.length - 1] >= survivors);
  h.m.dispose();
});

test('#7 a leaked enemy that splits (磨砻: DeadSpawn ×2) raises the counter — the children are billed to the same leaker; the clamp is what settlement can bill, not what was sent in', () => {
  const MOLONG = 'enemy_1195_sfyin';
  const SENT = 4;
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 710, instant: false });
  h.m.BattleClass = slowHelpers(3);
  h.start();
  enterUnite(h, 'p_1', MOLONG, SENT);
  const m = h.m;
  const leaker = h.ps('p_1');
  const lp = leaker.lp;
  const b = m.fields[0].battle;
  const seen = [];
  for (let i = 0; i < 4000 && m.phase === PHASE.UNITE; i++) {
    const p = pubOf(m, 'p_1');
    if (!b.finished) {
      const alive = b.enemies.filter((e) => e.alive && e.counted && e.sourcePlayerId === 'p_1').length;
      const pending = b._pending.filter((x) => x.sourcePlayerId === 'p_1').length;
      const through = Object.values(b._perPlayer).flatMap((pp) => pp.leaked).filter((l) => l.counted !== false && l.sourcePlayerId === 'p_1').length;
      assert.equal(p.uniteLeft, pending + alive + through, 'm.public = the leaker\'s enemies standing on the field, children included');
    }
    seen.push(p.uniteLeft);
    h.sched.advance(500);
  }
  // the split children are runtime spawns: they enter neither part of the HUD capsule (PR #157: the denominator counts
  // only what the 联防 scheduled — `b.total` — and the numerator only that set's own knock-outs / leaks), while the
  // 联防 live counter (m.public uniteLeft) still bills them to the leaker
  const kids = b.units.filter((u) => u.side === 'enemy' && !u.inTotal).length;
  assert.ok(kids > 0, `the 磨砻 split into ${kids} runtime children`);
  assert.equal(b.total, SENT, `the children stay out of the capsule's denominator (total = the ${SENT} the 联防 scheduled)`);
  assert.equal(b.resolved, Math.min(SENT, b.killedInTotal + b.leakedInTotal), 'the capsule numerator counts only the 联防\'s own enemies');
  const rises = seen.filter((v, i) => i > 0 && v > seen[i - 1]).length;
  assert.ok(rises > 0, `the counter rose after a split: ${seen.filter((v, i) => i === 0 || v !== seen[i - 1]).join(' → ')}`);
  assert.ok(Math.max(...seen) > SENT, 'above the number sent in (the old clamp hid it)');
  assert.ok(Math.max(...seen) <= SENT * 3, 'within what 4 磨砻 can leave behind (2 each)');
  const last = seen[seen.length - 1];
  toSettled(h);
  assert.equal(lp - leaker.lp, Math.min(10, last), `settled LP loss = min(10, ${last} left)`);
  h.m.dispose();
});

// =====================================================================================================================
// GitHub #235 (PR #112 by @Convey123): the official result box at settlement. The 联防's outcome rides the SETTLE
// m.public as data (`uniteResult`), each player's own LP charge in `losses` — the number the client's 「生命值减少 −N」
// shows (ui/gameLogic/phases.js uniteResultBox) — and that box is the only announcement: no 联防 result ticker line.

test('#235 联防 outcome: the SETTLE view carries every player\'s own charge (= the LP settled), no result line is broadcast, and the next phase drops it', () => {
  const run = (survivors) => {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 3, seed: 6060, fake: true, clientCombat: true, instant: false,
      script: (b) => (b.kind === 'normal'
        ? (b.players[0] === 'p_0' ? { duration: 2, leaks: { p_0: 3 } } : { duration: 3 })
        : { duration: 5, survivors }) }).start();
    const m = h.m;
    h.autoHumans();
    const before = h.bc.length;
    let lpBefore = null;
    h.run(() => {
      if (m.phase === PHASE.UNITE && !lpBefore) lpBefore = Object.fromEntries([...m.players.values()].map((ps) => [ps.playerId, ps.lp]));
      return m.phase === PHASE.SETTLE || h.ended != null;
    }, { maxSteps: 5e6 });
    const tickers = h.bc.slice(before).filter((x) => x.t === 'm.ticker').map((x) => x.text);
    const view = m.publicView();
    assert.equal(view.phase, PHASE.SETTLE);
    assert.ok(lpBefore, 'a 联防 ran this round');
    const through = Object.values(survivors).reduce((a, b) => a + b, 0);
    const losses = { p_0: Math.min(m.gd.lpCapPerRound, through) };
    for (const id of view.uniteResult.helpers) losses[id] = 0;
    assert.deepEqual(view.uniteResult, { through, helpers: view.uniteResult.helpers, leakers: ['p_0'], losses }, 'the 联防 outcome rides the SETTLE view');
    assert.ok(view.uniteResult.helpers.length > 0 && !view.uniteResult.helpers.includes('p_0'), 'the helpers are the perfect players');
    // the box's number is the LP settlement really charged — never the leaker's own battle leaks (3)
    for (const ps of m.players.values()) assert.equal(lpBefore[ps.playerId] - ps.lp, view.uniteResult.losses[ps.playerId], `${ps.playerId}: losses = the LP settled`);
    checkInvariants(m);
    // the next phase carries no stale outcome
    h.run(() => m.phase !== PHASE.SETTLE || h.ended != null, { maxSteps: 5e6 });
    assert.equal(m.publicView().uniteResult, undefined, `no uniteResult in ${m.phase}`);
    m.dispose();
    return tickers;
  };
  const cleared = run({});
  // the 联防's opening line is still broadcast (the official 「联防阶段」 banner while it runs) …
  assert.ok(cleared.some((t) => t.startsWith('联防阶段')), `expected the 联防阶段 line, got ${JSON.stringify(cleared)}`);
  // … but the outcome is box-only: no 「联防成功」 / 「联防结束」 line beside it
  assert.ok(!cleared.some((t) => /^联防(成功|结束|失败)/.test(t)), `no result line may be broadcast, got ${JSON.stringify(cleared)}`);
  const through = run({ p_0: 2 });
  assert.ok(!through.some((t) => /^联防(成功|结束|失败)/.test(t)), `no result line may be broadcast, got ${JSON.stringify(through)}`);
  // more survivors than the per-round cap: the charge (and the box) stops at the cap
  run({ p_0: 14 });
});

test('#235 no 联防 this round: the SETTLE view carries no uniteResult (the client then shows the round\'s own battle result)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 6061, fake: true, clientCombat: true, instant: false,
    script: () => ({ duration: 3 }) }).start();
  const m = h.m;
  h.autoHumans();
  h.run(() => m.phase === PHASE.SETTLE || h.ended != null, { maxSteps: 5e6 });
  assert.equal(m.phase, PHASE.SETTLE);
  assert.equal(m.publicView().uniteResult, undefined);
  checkInvariants(m);
  m.dispose();
});
