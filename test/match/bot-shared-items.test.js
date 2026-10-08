import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botPickCard, botPrepBegin, itemTarget } from '../../server/match/bot.js';
import { makeMatch, give, giveItem, legalTileFor } from './harness.js';
import { matchScenarios, runMatch } from '../../tools/golden.mjs';

const document = 'chess_item_6_08_e_a';
const morph = 'chess_item_6_09_e_a';
const alternative = 'chess_item_5_06_e_a';

test('user: Given owned Yan in board, hand and temp, When drafting a document, Then start at six identities and weight deployed members higher', () => {
  const ids = ['chess_char_1_03_a', 'chess_char_2_04_a', 'chess_char_3_03_a', 'chess_char_3_04_a',
    'chess_char_4_17_a', 'chess_char_5_03_a', 'chess_char_5_12_a', 'chess_char_6_15_a'];
  for (const [owned, deployed, rival, take, duplicate] of [
    [5, 5, 'chess_item_2_01_e_a', false, false],
    [5, 5, 'chess_item_2_01_e_a', false, true],
    [6, 1, 'chess_item_2_01_e_a', false, false],
    [6, 2, 'chess_item_2_01_e_a', true, false],
    [6, 2, 'chess_item_3_01_e_a', false, false],
    [8, 2, 'chess_item_3_01_e_a', true, false],
  ]) {
    const h = makeMatch({ mode: 'solo', seed: 11 }).start().toPrep().setStage('act1autochess_m01');
    const m = h.m;
    const ps = m.order[0];
    try {
      ids.slice(0, owned).forEach((id, i) => {
        if (i < deployed) field(m, ps, id);
        else give(m, ps, id, i === owned - 1 ? 'temp' : 'hand');
      });
      if (duplicate) give(m, ps, ids[0].replace(/_a$/, '_b'));
      const cards = [document, rival].map((id) => ({ ...m.gd.item(id), kind: 'item' }));
      assert.equal(botPickCard(m, ps, cards, [0, 1]), take ? 0 : 1, `${owned}/${deployed}/${rival}/${duplicate}`);
    } finally { m.dispose(); }
  }
});

test('user: Given the solo NORMAL seed 1 lineup, When private purchases run, Then preserve its hidden-core clear', () => {
  const result = runMatch(matchScenarios().find((s) => s.id === 'solo-NORMAL-1'));
  assert.equal(result.end.hiddenReached, true);
  assert.equal(result.end.hiddenCleared, true);
  assert.equal(result.players.ai_0.roundsPassed, 15);
});

function field(m, ps, id) {
  const tile = legalTileFor(m, ps, id);
  assert.ok(tile, `legal tile for ${id}`);
  return give(m, ps, id, 'board', tile);
}

function equip(m, ps, piece, id) {
  const item = giveItem(m, ps, id);
  assert.deepEqual(ps.equip(item.uid, piece.uid), { ok: true });
}

function nineYan(m, ps, { transformed = true, reserve = true } = {}) {
  for (const id of ['chess_char_1_03_a', 'chess_char_2_04_a', 'chess_char_3_03_a',
    'chess_char_3_04_a', 'chess_char_4_17_a', 'chess_char_5_03_a', 'chess_char_5_12_a']) field(m, ps, id);
  const carrier = field(m, ps, 'chess_char_1_02_a');
  equip(m, ps, carrier, 'chess_item_3_04_e_a');
  if (transformed) equip(m, ps, carrier, morph);
  if (reserve) give(m, ps, 'chess_char_6_15_a');
}

function draft(m, ids) {
  m.round = 3;
  m.enterSpDraft();
  m.sp.order = m.order.map((p) => p.playerId);
  m.sp.idx = 0;
  m.sp.cards = ids.map((id, idx) => ({ ...m.gd.item(id), kind: 'item', idx }));
  return m.sp.cards;
}

test('user: Given actual Yan members, When drafting a document, Then value the lineup including transformed members', () => {
  for (const scenario of ['teammate', 'own', 'layers-only', 'missing-morph', 'missing-ninth', 'pending', 'cap-nine', 'duplicates', 'mate-picked']) {
    const h = makeMatch({ humans: 2, seed: 11 }).start().toPrep().setStage('act1autochess_m01');
    const m = h.m;
    const [ps, mate] = m.order;
    try {
      if (scenario !== 'teammate') nineYan(m, ps, { transformed: scenario !== 'missing-morph', reserve: scenario !== 'missing-ninth' });
      nineYan(m, mate);
      if (scenario === 'layers-only') {
        for (const p of ps.board.values()) ps.returnCopies(p);
        ps.board.clear(); ps.layers.yanShip = 999; ps.recompute();
      }
      if (scenario === 'pending') giveItem(m, ps, document);
      if (scenario === 'cap-nine') equip(m, ps, [...ps.board.values()][0], document);
      if (['own', 'layers-only', 'missing-morph', 'missing-ninth', 'pending', 'cap-nine'].includes(scenario)) mate.alive = false;
      const cards = draft(m, scenario === 'duplicates' ? [document, alternative, document]
        : scenario === 'mate-picked' ? [document, alternative, alternative] : [document, alternative]);
      if (scenario === 'mate-picked') {
        m.sp.order = [mate.playerId, ps.playerId];
        assert.deepEqual(m.pickCard(mate, 2), { ok: true });
      }
      const available = cards.map((c) => c.idx).filter((idx) => m.sp.taken[idx] == null);
      const before = JSON.stringify(m.order.map((p) => ({ board: [...p.board], hand: p.hand, bonds: p.bonds })));
      const picked = botPickCard(m, ps, cards, available);
      assert.equal(JSON.stringify(m.order.map((p) => ({ board: [...p.board], hand: p.hand, bonds: p.bonds }))), before);
      const take = ['own', 'missing-morph', 'missing-ninth', 'duplicates', 'mate-picked'].includes(scenario);
      assert.equal(cards[picked].id, take ? document : alternative, scenario);
      assert.deepEqual(m.pickCard(ps, picked), { ok: true });
      if (scenario === 'teammate') {
        assert.deepEqual(m.pickCard(mate, 0), { ok: true }, 'the document remains available to the teammate');
        h.runToPhase('PREP');
        const item = mate.hand.find((p) => p?.id === document);
        assert.deepEqual(mate.equip(item.uid, [...mate.board.values()][0].uid), { ok: true });
        assert.equal(mate.deployCap, 9);
      }
    } finally { m.dispose(); }
  }
});

test('user: Given a shared morph, When a teammate can complete a bond threshold, Then yield unless own benefit or supply is greater', () => {
  for (const scenario of ['teammate-threshold', 'own-threshold', 'duplicates', 'only-card']) {
    const h = makeMatch({ humans: 2, seed: 11 }).start().toPrep().setStage('act1autochess_m01');
    const m = h.m;
    const [ps, mate] = m.order;
    try {
      for (const player of m.order) {
        const carrier = field(m, player, 'chess_char_1_02_a');
        equip(m, player, carrier, 'chess_item_1_01_e_a');
      }
      const stronger = scenario === 'own-threshold' ? ps : mate;
      field(m, stronger, 'chess_char_1_06_a');
      field(m, stronger, 'chess_char_5_03_a');
      const cards = draft(m, scenario === 'duplicates' ? [morph, alternative, morph] : scenario === 'only-card' ? [morph] : [morph, alternative]);
      const picked = botPickCard(m, ps, cards, cards.map((c) => c.idx));
      assert.equal(cards[picked].id, scenario === 'teammate-threshold' ? alternative : morph, scenario);
      assert.deepEqual(m.pickCard(ps, picked), { ok: true });
      if (scenario === 'own-threshold') {
        const item = ps.hand.find((p) => p?.id === morph);
        assert.equal(itemTarget(m, ps, item)?.id, 'chess_char_1_02_a', 'equip the carrier whose paired item completes the bond');
      }
    } finally { m.dispose(); }
  }
});

test('user: Given a private shop or reward, When acquiring a document, Then value Yan members there too', () => {
  for (const source of ['shop', 'reward']) for (const ready of [false, true]) {
    const h = makeMatch({ mode: 'solo', seed: 11 }).start().toPrep().setStage('act1autochess_m01');
    const m = h.m;
    const ps = m.order[0];
    try {
      if (ready) nineYan(m, ps);
      else field(m, ps, 'chess_char_1_02_a');
      ps.shop.level = 6;
      ps.funds = source === 'shop' ? 4 : 0;
      const slot = { kind: 'item', id: document, basePrice: 4, sold: false };
      ps.shop.slots = source === 'shop' ? [slot] : [];
      if (source === 'reward') ps.pushItemOffer([document, alternative]);
      botPrepBegin(m, ps);
      if (source === 'shop') assert.equal(slot.sold, ready);
      assert.equal(ps.deployCap, ready ? 9 : 8, `${source}, nine Yan = ${ready}`);
    } finally { m.dispose(); }
  }
});

test('user: Given full faction equipment slots, When drafting signature equipment, Then leave it to a teammate who can equip it', () => {
  const h = makeMatch({ humans: 2, seed: 11 }).start().toPrep().setStage('act1autochess_m01');
  const m = h.m;
  const [ps, mate] = m.order;
  try {
    for (const id of ['chess_char_1_03_a', 'chess_char_2_04_a']) {
      const carrier = field(m, ps, id);
      equip(m, ps, carrier, 'chess_item_1_01_e_b');
      equip(m, ps, carrier, 'chess_item_1_02_e_b');
    }
    field(m, mate, 'chess_char_1_03_a');
    const cards = draft(m, ['chess_item_6_03_e_a', alternative]);
    assert.equal(botPickCard(m, ps, cards, [0, 1]), 1);
  } finally { m.dispose(); }
});

test('user: Given a teammate with a better morph pairing, When buying privately, Then keep the useful item for the buyer', () => {
  for (const source of ['shop', 'reward']) {
    const h = makeMatch({ humans: 2, seed: 11 }).start().toPrep().setStage('act1autochess_m01');
    const m = h.m;
    const [ps, mate] = m.order;
    try {
      const carrier = field(m, ps, 'chess_char_1_02_a');
      equip(m, ps, carrier, 'chess_item_1_01_e_a');
      const mateCarrier = field(m, mate, 'chess_char_1_02_a');
      equip(m, mate, mateCarrier, 'chess_item_1_01_e_a');
      field(m, mate, 'chess_char_1_06_a');
      field(m, mate, 'chess_char_5_03_a');
      ps.shop.level = 6;
      ps.funds = source === 'shop' ? 3 : 0;
      ps.shop.slots = source === 'shop' ? [{ kind: 'item', id: morph, basePrice: 3, sold: false }] : [];
      if (source === 'reward') ps.pushItemOffer([morph, alternative]);
      botPrepBegin(m, ps);
      assert.ok(carrier.items.some((item) => item.id === morph), source);
    } finally { m.dispose(); }
  }
});
