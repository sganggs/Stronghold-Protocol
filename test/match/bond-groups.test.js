import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getData, getVersionData, setData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { drawDisabledBonds } from '../../server/match/pool.js';
import { botPickBondGroup, botBondUnavailable } from '../../server/match/botBondGroups.js';
import { createRng } from '../../server/sim/rng.js';
import { createRegistry, makeCtx } from '../../server/match/effectsMeta.js';
import { Match } from '../../server/match/Match.js';
import { VirtualScheduler } from '../../server/match/scheduler.js';
import { replayTestMatch } from '../../server/match/testReplay.js';
import { validateC2S } from '../../shared/protocol.js';
import { PHASE, ERR } from '../../shared/constants.js';
import { makeMatch, DATA } from './harness.js';

const data = getVersionData('act3autochess@V3_1');
const make = (t, opts = {}) => {
  const h = makeMatch({ data, mode: 'solo', modeId: 'mode_single_1', registry: createRegistry(), ...opts });
  t.after(() => h.m.dispose());
  return h;
};
const pick = (m, idx, setupRevision = m.setupRevision) => m.handle('p_0', { t: 'g.bondGroup', idx, setupRevision });
const available = gd => gd.bondIds.filter(id => gd.bond(id).weight > 0 && !gd.modeInactiveBonds.has(id));
const offOf = m => new Set([...m.disabledBonds, ...m.staticInactiveBonds]);
// Independent statement of the tutorial, against real operator records.
const excluded = (gd, rec, off) => {
  const core = (rec.bonds || []).filter(id => gd.bond(id)?.isCore);
  const addon = (rec.bonds || []).filter(id => !gd.bond(id)?.isCore);
  return core.some(id => off.has(id)) || (addon.length > 0 && addon.every(id => off.has(id)));
};

for (const [mode, nCore, nAddon] of [['funny', 4, 1], ['normal', 5, 4], ['hard', 5, 4], ['abyss', 5, 4]]) {
  test(`co-op ${mode}: half the available cores + configured add-ons, deterministic`, () => {
    const gd = new GameData(data, `mode_multi_${mode}`);
    const draw = drawDisabledBonds(gd, createRng(37));
    assert.deepEqual(draw, drawDisabledBonds(gd, createRng(37)));
    assert.notDeepEqual(draw.drawn, drawDisabledBonds(gd, createRng(38)).drawn);
    assert.equal(draw.choice, undefined);
    assert.equal(draw.drawn.filter(id => gd.bond(id).isCore).length, nCore);
    assert.equal(draw.drawn.filter(id => !gd.bond(id).isCore).length, nAddon);
    assert.ok(draw.drawn.every(id => available(gd).includes(id)));
    assert.deepEqual(draw.staticOff, [...gd.modeInactiveBonds].filter(id => gd.bond(id)).sort());
  });
}

for (const [modeId, size, addons] of [['mode_single_1', 4, 1], ['mode_single_12', 5, 4], ['mode_single_funny', 4, 1]]) {
  test(`${modeId}: disjoint groups, pick greys the other; no shop or copies drawn before pick`, t => {
    const h = make(t, { modeId, seed: 29 }), m = h.m, ps = h.ps('p_0');
    const beforeRng = m.rngShop.state();
    m.pool.roll = () => assert.fail('the briefing must not roll the shop');
    h.start();
    assert.equal(ps.shop.slots.length, 0);
    assert.equal(ps.acquireChess(m.gd.visibleChess[0]), null, 'no acquisition while the choice is pending');
    const groups = structuredClone(m.bondChoice.groups);
    assert.deepEqual(groups.map(g => g.length), [size, size]);
    assert.equal(new Set(groups.flat()).size, size * 2);
    assert.deepEqual(groups.flat().sort(), available(m.gd).filter(id => m.gd.bond(id).isCore).sort());
    assert.equal(m.disabledBonds.length, addons);
    assert.deepEqual(pick(m, 1), { ok: true });
    assert.equal(m.bondChoice.picked, 1);
    assert.deepEqual(m.disabledBonds.filter(id => m.gd.bond(id).isCore).sort(), groups[0].sort());
    assert.equal(m.rngShop.state(), beforeRng);
    assert.equal(ps.shop.slots.length, 0);
    for (const id of m.gd.visibleChess) {
      assert.equal(m.pool.has(id), !excluded(m.gd, m.gd.chess(id), offOf(m)), id);
    }
    for (const e of m.pool.entries.values()) assert.equal(e.left, e.cap);
    assert.ok(groups[0].every(id => botBondUnavailable(m, id)));
    assert.ok(groups[1].some(id => !botBondUnavailable(m, id)));
    m.flush(true);
    assert.equal(h.lastBc('m.public').bondChoice.picked, 1);
    h.invariants();
  });
}

test('odd core count leaves one active; training draws zero add-ons', () => {
  const odd = structuredClone(data);
  odd.bonds.yanShip.weight = 0;
  const gd = new GameData(odd, 'mode_single_12');
  const draw = drawDisabledBonds(gd, createRng(15));
  assert.deepEqual(draw.choice.groups.map(g => g.length), [4, 4]);
  assert.equal(available(gd).filter(id => gd.bond(id).isCore && !draw.choice.groups.flat().includes(id)).length, 1);
  const training = drawDisabledBonds(new GameData(data, 'mode_training_2'), createRng(15));
  assert.deepEqual(training.drawn, []);
  assert.equal(training.choice, undefined);
});

test('protocol and handler reject invalid, stale, repeated, spectator, co-op and late picks', t => {
  assert.equal(validateC2S({ t: 'g.bondGroup', idx: 1, setupRevision: 0 }), null);
  for (const idx of [-1, 2, 0.5, '0', null, undefined]) {
    assert.notEqual(validateC2S({ t: 'g.bondGroup', idx, setupRevision: 0 }), null);
  }
  assert.notEqual(validateC2S({ t: 'g.bondGroup', idx: 0 }), null);
  const h = make(t, { spectators: ['viewer'] }), m = h.m;
  assert.equal(pick(m, 0).error, ERR.WRONG_PHASE);
  h.start();
  assert.equal(pick(m, 2).error, ERR.BAD_TARGET);
  assert.equal(pick(m, 0, 1).error, ERR.BAD_TARGET);
  assert.equal(m.handle('viewer', { t: 'g.bondGroup', idx: 0, setupRevision: 0 }).error, ERR.SPECTATOR);
  assert.deepEqual(pick(m, 0), { ok: true });
  assert.equal(pick(m, 1).error, ERR.WRONG_PHASE);
  m.enterBandDraft();
  assert.equal(pick(m, 0).error, ERR.WRONG_PHASE);
  const coop = make(t, { mode: 'coop', modeId: 'mode_multi_abyss' }).start().m;
  assert.equal(pick(coop, 0).error, ERR.WRONG_PHASE);
});

test('bot keeps its plan or strategy core, otherwise the seeded first; takeover also picks', t => {
  const h = make(t), m = h.m, ps = h.ps('p_0');
  const core = m.bondChoice.groups[1][0];
  ps._botSelf = { round: 0, plan: { bonds: [{ id: core, priority: 5 }] } };
  assert.equal(botPickBondGroup(m, ps), 1);
  delete ps._botSelf;
  ps.bandId = Object.keys(data.bands).find(id => m.gd.bandBondIds(id).includes(core));
  assert.ok(ps.bandId);
  assert.equal(botPickBondGroup(m, ps), 1);
  ps.bandId = null;
  assert.equal(botPickBondGroup(m, ps), 0);
  h.start();
  assert.deepEqual(m.handle('p_0', { t: 'g.autoplay', on: true }), { ok: true });
  assert.equal(m.bondChoice.picked, 0);
  assert.equal(ps.infoReady, true);
  const ai = make(t, { seats: [{ seat: 0, playerId: 'ai_0', isBot: true, name: 'AI', connected: true }] });
  ai.start();
  assert.equal(ai.m.bondChoice.picked, 0);
});

test('briefing completion defaults to first group, including a timed briefing', t => {
  for (const timed of [false, true]) {
    const h = make(t), m = h.m;
    // Solo is normally untimed; exercise the same deadline callback used by a timed rule profile.
    if (timed) Object.defineProperty(m, 'soloUntimed', { value: false });
    h.start();
    const other = [...m.bondChoice.groups[1]].sort();
    if (timed) h.sched.advance(m.deadline - h.sched.now());
    else { m.handle('p_0', { t: 'g.infoReady' }); h.sched.advance(0); }
    assert.equal(m.phase, PHASE.BAND_DRAFT);
    assert.equal(m.bondChoice.picked, 0);
    assert.deepEqual(m.disabledBonds.filter(id => m.gd.bond(id).isCore).sort(), other);
  }
});

test('exclusion: any grey core, or ALL add-ons; no add-ons is not itself a ban', () => {
  const gd = new GameData(data, 'mode_single_12');
  const c = gd.bondIds.find(id => gd.bond(id).isCore);
  const [a, b] = gd.bondIds.filter(id => !gd.bond(id).isCore);
  const rec = { bonds: [c, a, b] };
  assert.equal(gd.bondsExclude(rec, new Set([c])), true, 'active add-ons cannot rescue a grey core');
  assert.equal(gd.bondsExclude(rec, new Set([a])), false);
  assert.equal(gd.bondsExclude(rec, new Set([a, b])), true, 'active core cannot rescue all-grey add-ons');
  assert.equal(gd.bondsExclude({ bonds: [c] }, new Set()), false);
  assert.equal(gd.bondsExclude({ bonds: [] }, new Set()), false);
  const low = new GameData(data, 'mode_single_1');
  assert.ok(low.modeInactiveBonds.has('egirShip'));
  assert.equal(low.bondsExclude({ bonds: ['egirShip', a] }, low.modeInactiveBonds), true);
});

test('pick rebuilds 自选 stock, shop, promotion rewards, named pools and direct grants respect exclusion', t => {
  const custom = structuredClone(data);
  const h = make(t, { data: custom, modeId: 'mode_single_12', seed: 21 }), m = h.m, ps = h.ps('p_0');
  const slot = 'chess_char_5_diy1_a', charId = 'char_017_huang';
  assert.equal(ps.setDiy({ [slot]: { charId, skillIndex: 0 } }, { kitted: [charId] }), true);
  ps.initDiyStock(new Set());
  assert.equal(ps.diyStock.has(slot), true);
  h.start();
  const rec = ps.gd.chess(slot);
  const grey = m.bondChoice.groups.findIndex(g => g.some(id => rec.bonds.includes(id)));
  assert.ok(grey >= 0);
  pick(m, 1 - grey);
  assert.equal(ps.diyStock.has(slot), false);
  assert.ok(ps.diyBanned.includes(slot));
  assert.equal(h.lastTo('p_0', 'm.private').diyBanned.includes(slot), true);
  assert.equal(ps.acquireChess(slot), null);
  const banned = m.bannedChess[0];
  assert.equal(ps.acquireChess(banned), null);
  assert.equal(ps.acquireChess(m.gd.goldenIdOf(banned), { fromPool: false }), null);
  const ctx = makeCtx(m, ps, { key: 'test' }, 'onRoundStart', {});
  assert.equal(ctx.grantChess(banned, { requirePool: false }), null);
  assert.equal(ctx.offerChess([banned]), false);
  assert.equal(ps.offers.length, 0);
  custom.choices.pools.test_named = { kind: 'chess', items: [banned] };
  custom.choices.pools.test_weighted = { kind: 'chess', weighted: [[banned, 100]] };
  assert.equal(m.rollPool('test_named'), null);
  assert.equal(m.rollPool('test_weighted'), null);
  for (const id of Object.keys(m.gd.choices.pools || {})) {
    for (let n = 0; n < 3; n++) {
      const result = m.rollPool(id);
      if (result?.kind === 'chess') assert.equal(excluded(m.gd, m.gd.chess(result.id), offOf(m)), false, id);
    }
  }
  h.toPrep(1, { band: 'band_fund' });
  for (let n = 0; n < 8; n++) {
    ps.rollShop();
    for (const s of ps.shop.slots) if (s?.kind === 'chess') assert.equal(m.chessExcluded(ps.gd.chess(s.id)), false);
  }
  assert.equal(ctx.setShopSlot(0, { kind: 'chess', id: banned }), false);
  const normal = [...m.pool.entries.keys()].find(id => m.gd.goldenIdOf(id));
  for (let n = 0; n < 3; n++) assert.ok(ps.acquireChess(normal));
  assert.ok(ps.offers.length, 'a merge opens a promotion reward');
  const held = ps.allChess()[0];
  assert.equal(ps.transformChess(held, banned), null);
  assert.equal(ps.find(held.uid).piece, held, 'a refused transform keeps its carrier');
  for (const offer of ps.offers) for (const s of offer.slots) if (s.kind === 'chess') assert.equal(m.chessExcluded(ps.gd.chess(s.id)), false);
  h.invariants();
});

test('reroll resets the pick, draws fresh groups, rebuilds stock and rejects the previous revision', t => {
  const h = make(t, { seed: 61 }).start(), m = h.m;
  const before = structuredClone(m.bondChoice.groups);
  pick(m, 1);
  const pool = m.pool;
  assert.deepEqual(m.requestSetupReroll('p_0', 0), { ok: true });
  assert.equal(m.setupRevision, 1);
  assert.equal(m.bondChoice.picked, null);
  assert.notDeepEqual(m.bondChoice.groups, before);
  assert.notEqual(m.pool, pool);
  assert.equal(h.ps('p_0').infoReady, false);
  assert.equal(pick(m, 0, 0).error, ERR.BAD_TARGET);
  assert.deepEqual(pick(m, 1, 1), { ok: true });
});

test('pending and settled snapshots, reconnect and input-journal replay retain groups, picks and rerolls', t => {
  const previous = getData(); setData(data); t.after(() => setData(previous));
  const entries = [], sent = [], scheduler = new VirtualScheduler();
  const m = new Match({ data, mode: 'solo', modeId: 'mode_single_12', difficulty: 'HARD', version: 'act3autochess@V3_1',
    seed: 12, scheduler, test: true, clientCombat: false, botRehearsal: 0, registry: createRegistry(),
    seats: [{ playerId: 'p_0', seat: 0, name: 'P', connected: true }],
    send: (_, msg) => sent.push(msg), broadcast() {}, onEnd() {},
    log: { info(line) { if (line.startsWith('[test-input ')) entries.push(JSON.parse(line.slice(line.indexOf(']') + 2))); } } });
  t.after(() => m.dispose());
  m.start();
  const replay = () => {
    const copy = replayTestMatch(data, entries, { registry: createRegistry() }); t.after(() => copy.dispose());
    assert.deepEqual(copy.publicView(), m.publicView());
    assert.deepEqual(copy.pool.snapshot(), m.pool.snapshot());
    assert.deepEqual(copy.players.get('p_0').privateView(), m.players.get('p_0').privateView());
  };
  replay();
  pick(m, 1); replay();
  m.onDisconnect('p_0'); m.onReconnect('p_0');
  assert.deepEqual(sent.findLast(msg => msg.t === 'm.public').bondChoice, m.bondChoice);
  m.requestSetupReroll('p_0', 0); replay();
  pick(m, 0); replay();
  const snap = m.publicView(); snap.bondChoice.groups[0].pop();
  assert.notDeepEqual(snap.bondChoice, m.bondChoice, 'views do not expose mutable match arrays');
});

test('covenant control: same draw, RNG consumption and joint every-bond exclusion', () => {
  for (const mode of ['mode_single_funny', 'mode_multi_normal', 'mode_multi_abyss']) {
    const gd = new GameData(DATA, mode), rng = createRng(7), control = createRng(7);
    const actual = drawDisabledBonds(gd, rng), counts = gd.bans(gd.difficulty);
    const sample = (core, n) => { const ids = available(gd).filter(id => !!gd.bond(id).isCore === core); control.shuffle(ids); return ids.slice(0, n); };
    const drawn = [...sample(true, counts.core), ...sample(false, counts.addon)].sort();
    const staticOff = [...gd.modeInactiveBonds].filter(id => gd.bond(id)).sort();
    const off = new Set([...drawn, ...staticOff]);
    const banned = gd.visibleChess.filter(id => gd.chess(id).bonds.length && gd.chess(id).bonds.every(b => off.has(b)));
    assert.deepEqual(actual, { drawn, staticOff, banned });
    assert.equal(rng.state(), control.state());
    assert.equal(gd.bondsExclude({ bonds: ['yanShip', 'preciShip'] }, new Set(['yanShip'])), false);
  }
});
