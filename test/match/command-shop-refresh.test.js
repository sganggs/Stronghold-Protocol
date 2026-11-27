// A 指挥 shop refresh (雅拉 / 杜遥夜 / 渡桥) rerolls, then overwrites the row with its own picks.
// That roll must not spend a queued garrison bondRefresh, and must not mark the row special.
// The canvas slots panel plays whole_card_refresh_special from isSpecialRecruit, which reads
// m.private.shop.specialRefresh. The DOM ShopBar does not read that flag (no separate clip).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../server/data.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { SharedPool } from '../../server/match/pool.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { makeMatch } from './harness.js';
import { beginCommandPrep } from '../../server/match/bandCommands.js';
import { botUseCommand } from '../../server/match/bot.js';
import { shopModelFromPrivate } from '../../public/js/ui/shop/adapter/model.js';
import { AutoChessStylizedShopSlotsPanel } from '../../public/js/ui/shop/slots.js';

const data = loadData(fileURLToPath(new URL('../../data/versions/act3autochess-v3_1', import.meta.url)), { log: { warn() {} } });
before(() => setGameData(data));
after(() => setGameData(null));

const QUEUE = [{ bond: 'kjeragShip', count: 2 }, { bond: 'yanShip', count: 1 }];
const BANDS = [
  { band: 'band_support', name: '雅拉', effectId: 'aceffect_band_74' },
  { band: 'band_yan', name: '杜遥夜', effectId: 'aceffect_band_79' },
  { band: 'band_high', name: '渡桥', effectId: 'aceffect_band_106', board: true },
];

const copyQueue = () => QUEUE.map((job) => ({ ...job }));

function chessOfTier(tier) {
  const rec = Object.values(data.chess).find((c) => !c.isGolden && !c.isDiy && c.tier === tier);
  assert.ok(rec, `a tier-${tier} chess`);
  return rec.chessId;
}

function setup(t, band, seed) {
  const h = makeMatch({ data, mode: 'coop', humans: 2, bots: 0, fake: true, seed, registry: createRegistry() }).start();
  t.after(() => { assert.equal(h.m.errorCount, 0); h.m.dispose(); });
  h.m.disabledBonds = [];
  h.m.bannedChess = [];
  h.m.pool = new SharedPool(h.m.gd);
  h.toPrep(1);
  const ps = h.ps('p_0');
  ps.bandId = band;
  ps.funds = 100;
  ps.offers = [];
  ps.recompute();
  beginCommandPrep(ps);
  return { h, ps };
}

function arm(ps, { queue = true, charges = 0, counter = 0, special = false, frozen = false } = {}) {
  if (queue) ps.shop.bondRefresh = copyQueue();
  else delete ps.shop.bondRefresh;
  ps.shop.specialRefreshCharges = charges;
  ps.counters['band:pepe:special'] = counter;
  ps.shop.specialRefresh = special;
  ps.shop.frozen = frozen;
  if (frozen) for (const s of ps.shop.slots) if (s && !s.sold) s.frozen = true;
  return ps.shop.refreshSeq;
}

function place(ps, tier = 1) {
  const p = ps.acquireChess(chessOfTier(tier), { silent: true });
  ps._detach(ps.find(p.uid));
  ps.board.set('10,5', p);
  return p;
}

function clipFor(isSpecial) {
  const panel = Object.create(AutoChessStylizedShopSlotsPanel.prototype);
  panel.anims = {
    _refreshAnim: { clip: 'whole_card_refresh_normal' },
    _refreshSpecAnim: { clip: 'whole_card_refresh_special' },
  };
  return panel.playRefreshClip(!!isSpecial);
}

function rowModel(ps) {
  const view = ps.privateView();
  const model = shopModelFromPrivate(view);
  return { view, model };
}

function assertCommandRow(ps, spec, piece) {
  const chess = ps.shop.slots.filter((s) => s && s.kind === 'chess' && !s.sold);
  assert.ok(chess.length >= 1, `${spec.name} still shows chess`);
  if (spec.band === 'band_support') {
    assert.equal(ps.gd.tierOf(chess[0].id), Math.min(6, ps.shop.level + 1), '雅拉 replaces the first chess with tier+1');
  } else if (spec.band === 'band_yan') {
    assert.ok(data.chess[chess[0].id].bonds.includes('yanShip'), '杜遥夜 replaces the first chess with 炎');
    assert.ok(ps.gd.tierOf(chess[0].id) <= ps.shop.level);
  } else {
    assert.ok(chess.some((s) => ps.gd.baseIdOf(s.id) === ps.gd.baseIdOf(piece.id)), '渡桥 rewrites the row toward the board');
  }
  assert.ok(ps.shop.slots.some((s) => s && s.kind === 'item'), 'the item slot is still the roll, not cleared');
}

test('a command refresh keeps a queued bond refresh and does not mark the row special', (t) => {
  for (const spec of BANDS) {
    const { ps } = setup(t, spec.band, 137);
    const piece = spec.board ? place(ps, 1) : null;
    const seq = arm(ps, { charges: 2, counter: 3, special: true });
    const refreshes = ps.round.refreshes;
    const result = ps.useCommand(spec.effectId, {});
    assert.equal(result.ok, true, `${spec.name} applies`);
    assert.equal(ps.command.currentEffectId, spec.effectId);

    assert.deepEqual(ps.shop.bondRefresh, copyQueue(), `${spec.name} must not shift a queued garrison refresh`);
    assert.equal(ps.shop.specialRefresh, false, `${spec.name} must not mark its own row special`);
    assert.equal(ps.shop.specialRefreshCharges, 2, '佩佩 charges are a different counter');
    assert.equal(ps.counters['band:pepe:special'], 3, '佩佩\'s pending counter is not a command refresh');
    assert.equal(ps.round.refreshes, refreshes, 'a command refresh is not a manual refresh');
    assert.equal(ps.shop.refreshSeq, seq + 1, 'the row is new, so the sequence still advances');

    const { view, model } = rowModel(ps);
    assert.equal(view.shop.specialRefresh, false);
    assert.equal(view.shop.specialRefreshArmed, true, 'the queued charge still lights the refresh button');
    assert.equal(view.shop.refreshSeq, seq + 1);
    assert.equal(model.isSpecialRecruit, false, 'the canvas slots clip stays the ordinary refresh');
    assert.equal(model.isSpecRefresh, true, 'the button stays special while the queue remains');
    assert.equal(clipFor(model.isSpecialRecruit), 'whole_card_refresh_normal');
    assertCommandRow(ps, spec, piece);
  }

  const last = setup(t, 'band_support', 9);
  arm(last.ps, { charges: 0, counter: 0 });
  last.ps.shop.bondRefresh = [{ bond: 'kjeragShip', count: 1 }];
  assert.equal(last.ps.useCommand('aceffect_band_74', {}).ok, true);
  assert.deepEqual(last.ps.shop.bondRefresh, [{ bond: 'kjeragShip', count: 1 }], 'the only queued charge survives');
  assert.equal(last.ps.shop.specialRefresh, false);
  assert.equal(last.ps.privateView().shop.specialRefreshArmed, true, 'the button stays special for that remaining charge');
  assert.equal(shopModelFromPrivate(last.ps.privateView()).isSpecialRecruit, false);
});

test('the next manual refresh and the next round-start roll still spend the charge', (t) => {
  const manual = setup(t, 'band_yan', 11);
  arm(manual.ps, { charges: 2, counter: 3 });
  assert.equal(manual.ps.useCommand('aceffect_band_79', {}).ok, true);
  assert.deepEqual(manual.ps.shop.bondRefresh, copyQueue());
  assert.equal(manual.ps.refresh().ok, true);
  assert.deepEqual(manual.ps.shop.bondRefresh, [{ bond: 'yanShip', count: 1 }], 'the manual refresh spends the first queued job');
  assert.equal(manual.ps.shop.specialRefresh, true);
  assert.equal(manual.ps.shop.specialRefreshCharges, 2, 'that spend is the garrison queue, not 佩佩');
  assert.equal(manual.ps.counters['band:pepe:special'], 3);
  assert.equal(manual.ps.round.refreshes, 1);
  const afterManual = shopModelFromPrivate(manual.ps.privateView());
  assert.equal(afterManual.isSpecialRecruit, true, 'the roll that spent the charge plays the special clip');
  assert.equal(afterManual.isSpecRefresh, true, '佩佩\'s charges and the remaining job keep the button special');

  const round = setup(t, 'band_support', 12);
  arm(round.ps, { charges: 0, counter: 0 });
  assert.equal(round.ps.useCommand('aceffect_band_74', {}).ok, true);
  assert.deepEqual(round.ps.shop.bondRefresh, copyQueue());
  round.ps.startRound(2);
  assert.deepEqual(round.ps.shop.bondRefresh, [{ bond: 'yanShip', count: 1 }], 'the round-start roll spends the first queued job');
  assert.equal(round.ps.shop.specialRefresh, true);
  assert.equal(round.ps.shop.specialRefreshCharges, 0);
  assert.equal(shopModelFromPrivate(round.ps.privateView()).isSpecialRecruit, true);
});

test('an empty queue stays empty, and a frozen shop stays frozen', (t) => {
  const empty = setup(t, 'band_yan', 21);
  const seq = arm(empty.ps, { queue: false, special: true, charges: 2, counter: 1 });
  assert.equal(empty.ps.useCommand('aceffect_band_79', {}).ok, true);
  assert.equal(empty.ps.shop.bondRefresh, undefined);
  assert.equal(empty.ps.shop.specialRefresh, false);
  assert.equal(empty.ps.shop.refreshSeq, seq + 1);
  assert.equal(empty.ps.shop.specialRefreshCharges, 2);
  assert.equal(empty.ps.counters['band:pepe:special'], 1);
  assert.equal(empty.ps.privateView().shop.specialRefreshArmed, true, '佩佩\'s arm still lights the button');
  assert.equal(shopModelFromPrivate(empty.ps.privateView()).isSpecialRecruit, false);

  const frozen = setup(t, 'band_high', 22);
  const piece = place(frozen.ps, 1);
  arm(frozen.ps, { frozen: true, charges: 0, counter: 0 });
  assert.equal(frozen.ps.shop.frozen, true);
  assert.equal(frozen.ps.useCommand('aceffect_band_106', {}).ok, true);
  assert.equal(frozen.ps.shop.frozen, true, 'a command refresh does not cancel the freeze');
  assert.ok(frozen.ps.shop.slots.filter((s) => s && !s.sold).every((s) => s.frozen), 'the new row stays frozen');
  assert.deepEqual(frozen.ps.shop.bondRefresh, copyQueue());
  assert.equal(frozen.ps.shop.specialRefresh, false);
  assert.ok(frozen.ps.shop.slots.some((s) => s && s.kind === 'chess' && frozen.ps.gd.baseIdOf(s.id) === frozen.ps.gd.baseIdOf(piece.id)));
});

test('a bot reaches the same command refresh and also leaves the queue', (t) => {
  const { h, ps } = setup(t, 'band_yan', 31);
  arm(ps, { charges: 2, counter: 4 });
  assert.equal(botUseCommand(h.m, ps, false), true);
  assert.deepEqual(ps.shop.bondRefresh, copyQueue());
  assert.equal(ps.shop.specialRefresh, false);
  assert.equal(ps.shop.specialRefreshCharges, 2);
  assert.equal(ps.counters['band:pepe:special'], 4);
  assert.equal(shopModelFromPrivate(ps.privateView()).isSpecialRecruit, false);
});
