// §37.40 co-op play (round54, owner 2026-10-28 「发，继续做」): a co-op seat keeps 4 spare bench units (solo 6), fields no
// healer for its own sake, and takes the bounty card with the least enemy HP. 终极 co-op 1–320: 35.9 → 43.7 % pool
// completion (+7.8 ± 2.5 paired); each of the three alone was worth 3.4–4.3 points in the presence of the others.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botPickCard, sellJunk, arrange } from '../../server/match/bot.js';
import { makeMatch, give, legalTileFor, DATA } from './harness.js';

const bots = (n) => Array.from({ length: n }, (_, i) => ({ seat: i, playerId: `ai_${i}`, name: `AI-${i + 1}`, isBot: true, connected: true }));

function match(mode, seed = 5) {
  const h = makeMatch({ mode, difficulty: 'ABYSS', seed, seats: bots(mode === 'solo' ? 1 : 4) }).start().toPrep();
  const m = h.m, ps = m.order[0];
  ps.hand.fill(null);
  ps.board.clear();
  ps.recompute();
  return { h, m, ps };
}

/** Visible normal chess of one tier that the shared pool still holds, not yet owned by the player. */
function chessOfTier(m, ps, tier, n) {
  const owned = new Set(ps.allChess().map((p) => m.gd.baseIdOf(p.id)));
  return Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && c.tier === tier && m.pool.has(c.chessId)
    && m.pool.left(c.chessId) >= 3 && !owned.has(c.chessId)).slice(0, n);
}

test('§37.40: the bench keeps 4 spare units in co-op and 6 in solo (live pairs, sold beyond the budget)', () => {
  for (const [mode, budget] of [['solo', 6], ['coop', 4]]) {
    const { h, m, ps } = match(mode);
    try {
      m.round = 9;
      ps.shop.level = 5;
      for (const c of chessOfTier(m, ps, 5, ps.deployCap)) give(m, ps, c.chessId, 'board', legalTileFor(m, ps, c.chessId));
      for (const c of chessOfTier(m, ps, 2, 4)) { give(m, ps, c.chessId, 'hand'); give(m, ps, c.chessId, 'hand'); }
      ps.recompute();
      const spare = () => ps.allChess().length - ps.deployCap;
      assert.equal(spare(), 8, `${mode}: eight spare units (four live pairs) before`);
      sellJunk(m, ps);
      assert.equal(spare(), budget, `${mode}: ${budget} spare units kept`);
    } finally { h.dispose?.(); }
  }
});

test('§37.40: a co-op seat takes the bounty card with the least enemy HP, even against one that pays', () => {
  const card = (name) => {
    const c = DATA.choices.cards.bounty.find((x) => x.draft && DATA.enemies[x.enemyKey] && DATA.enemies[x.enemyKey].name === name);
    assert.ok(c, `a draft bounty with ${name}`);
    return { kind: 'bounty', id: c.effectId, tier: c.tier, coin: c.coin, payout: c.payout, rounds: c.rounds >= 90 ? 2 : c.rounds, enemyKey: c.enemyKey, count: c.count };
  };
  // the opening board as dealt; the solo expected-value pick (bot-smarter.test.js) takes several of these paying cards
  const h = makeMatch({ mode: 'coop', difficulty: 'ABYSS', seed: 5, seats: bots(4) }).start().toPrep();
  try {
    const m = h.m, ps = m.order[0];
    for (const name of ['沏虹', '异光体孽生者', '尖端萨卡兹枯朽战车', '重弩突袭者', '深池重甲卫士队长']) {
      const cards = [card(name), card('源石虫')].map((c, idx) => ({ ...c, idx }));
      assert.ok(cards[0].coin > 0 && !(cards[1].coin > 0), `${name} pays, 源石虫 does not`);
      assert.equal(botPickCard(m, ps, cards, [0, 1]), 1, `源石虫 (550 HP) over ${name}`);
    }
  } finally { h.dispose?.(); }
});

test('§37.40: from round 5 a solo seat swaps a healer into a full board of dealers, a co-op seat keeps its dealers', () => {
  for (const [mode, wantHealer] of [['solo', true], ['coop', false]]) {
    const { h, m, ps } = match(mode);
    try {
      m.round = 8;
      ps.shop.level = 4;
      const healers = Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && (c.dmgType === 'heal' || c.attackKind === 'heal') && m.pool.has(c.chessId));
      const healer = healers.sort((a, b) => a.tier - b.tier)[0];
      assert.ok(healer && healer.tier <= 2, 'a tier-I/II healer');
      const dealers = Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && c.tier === 4 && c.dmgType !== 'heal' && c.attackKind !== 'heal'
        && c.attackKind !== 'none' && m.pool.has(c.chessId) && m.pool.left(c.chessId) >= 2).slice(0, ps.deployCap);
      for (const c of dealers) give(m, ps, c.chessId, 'board', legalTileFor(m, ps, c.chessId));
      const hp = give(m, ps, healer.chessId, 'hand');
      ps.recompute();
      arrange(m, ps);
      const fielded = [...ps.board.values()].some((p) => p.uid === hp.uid);
      assert.equal(fielded, wantHealer, `${mode}: the healer ${wantHealer ? 'is' : 'is not'} fielded`);
    } finally { h.dispose?.(); }
  }
});
