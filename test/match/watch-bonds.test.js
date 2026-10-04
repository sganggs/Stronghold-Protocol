// The data behind the watched player's bond strip (DESIGN §20.15, user report after playtest #6): what the server
// sends of every player's bonds and what the browser's battle runner adds live.
//   * m.public players[].bonds = every bond with members, layers or an active tier — the player's own m.private list
//     without the per-bond extras the client reads from bonds.json (thresholds / countsHand); nothing else (but `harmony`
//     on an entry whose count holds 调和's +1, DESIGN §21.26: test/match/feedback1-gaps.test.js) — and nothing at all for
//     an eliminated player (nobody can watch them).
//   * From the end of COMBAT until the settlement the views (m.private and m.public) carry the finished normal battle's
//     in-battle gains (PlayerState.bondsView / bondsMeta.bondsWithGains, capped at 999): the strip of a player — and of a
//     teammate watching him in the 联防 — keeps the layers his battle reached. The persistent state is untouched and the
//     settlement adds the gains once.
//   * The runner publishes state().bondLayers { [playerId]: { [bondId]: n } } — absolute live counts of every bond that
//     grew in a battle it simulates (the own one, a teammate's display replica), ≤ 999, kept through the round; and
//     ownerOps(ownerId) — that player's operators in the battle on screen (a teammate's popup: the members in play).
// UI selection logic: test/ui/watch-bonds.test.js; on screen: test/ui/watch-bonds.e2e.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE, BOND_LAYER_CAP } from '../../shared/constants.js';
import { bondsWithGains, computeBonds } from '../../server/match/bondsMeta.js';
import { createBattleRunner } from '../../public/js/battle/runner.js';
import { createStore, initialState } from '../../public/js/store.js';
import * as specMod from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';
import { DATA, makeMatch, checkInvariants } from './harness.js';
import { FakeBattle } from './fakeBattle.js';

const row = (h, pid) => h.m.publicView().players.find((p) => p.playerId === pid);
const entry = (list, id) => (list || []).find((b) => b.bondId === id) || null;

test('m.public players[].bonds: every bond with members, layers or a tier — the m.private list minus thresholds / countsHand', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 91, fake: true }).start();
  h.toPrep(1);
  const ps = h.ps('p_1');
  ps.layers.sargonShip = 7; // layers, no member on the board: the own strip shows it (grey) — so does the teammate's
  ps.recompute();
  const pub = row(h, 'p_1').bonds;
  const priv = ps.privateView().bonds;
  assert.deepEqual(entry(pub, 'sargonShip'), { bondId: 'sargonShip', count: 0, active: false, tier: 0, layers: 7 });
  assert.deepEqual(pub.map((b) => b.bondId), priv.map((b) => b.bondId), 'the same bonds, the same order');
  for (const b of pub) assert.deepEqual(Object.keys(b).sort(), ['active', 'bondId', 'count', 'layers', 'tier'], `${b.bondId}: only what the strip needs`);
  assert.ok(priv.every((b) => Array.isArray(b.thresholds) && typeof b.countsHand === 'boolean'), 'm.private keeps its extras');
  h.m.dispose();
});

test('m.public players[].bonds of an eliminated player: [] (nobody can watch them), even with layers and pending gains', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 95, fake: true }).start();
  h.toPrep(1);
  const ps = h.ps('p_1');
  ps.layers.sargonShip = 7;
  ps.recompute();
  assert.ok(entry(row(h, 'p_1').bonds, 'sargonShip'), 'alive: the layers-only bond is sent');
  ps.eliminate(1);
  ps.layers.yanShip = 40; // layers survive the elimination (computeBonds still lists them) …
  ps.pendingLayerGains = { sargonShip: 3 };
  ps.recompute();
  assert.ok(ps.bondsView().sargonShip.layers > 0, '… the state still has them');
  assert.deepEqual(row(h, 'p_1').bonds, [], 'm.public: nothing for an eliminated player');
  assert.equal(row(h, 'p_1').alive, false);
  const a = h.ps('p_0');
  a.layers.yanShip = 5;
  a.recompute();
  assert.equal(entry(row(h, 'p_0').bonds, 'yanShip')?.layers, 5, 'a living teammate keeps the list');
  h.m.dispose();
});

test('bondsWithGains: adds a result\'s layerGains like settle() (floored, ≤ 999), never mutates, ignores unknown bonds', () => {
  const ps = { board: new Map(), hand: [], layers: { yanShip: 990, sargonShip: 4 } };
  const bonds = computeBonds(gdOf(), ps);
  const snap = JSON.stringify(bonds);
  assert.equal(bondsWithGains(bonds, null), bonds);
  assert.equal(bondsWithGains(bonds, {}), bonds);
  const v = bondsWithGains(bonds, { yanShip: 50, sargonShip: 2.7, noSuchBond: 9 });
  assert.equal(v.yanShip.layers, BOND_LAYER_CAP, '990 + 50 shows 999');
  assert.equal(v.sargonShip.layers, 6, 'floored like settle()');
  assert.ok(!('noSuchBond' in v));
  assert.equal(JSON.stringify(bonds), snap, 'the computed states are untouched');
  assert.equal(bondsWithGains({ yanShip: { ...bonds.yanShip, layers: 999 } }, { yanShip: 5 }).yanShip.layers, 999, 'at the cap: nothing');
});

test('after COMBAT the views carry the battle\'s gains until SETTLE makes them persistent (once); the state is untouched meanwhile', () => {
  const h = makeMatch({
    mode: 'coop', humans: 2, seed: 92, fake: true,
    script: (b) => (b.round === 1 ? { layerGains: { p_0: { yanShip: 50 }, p_1: { sargonShip: 12 } } } : {}),
  }).start();
  const m = h.m;
  h.toPrep(1);
  const [a, b] = [h.ps('p_0'), h.ps('p_1')];
  a.layers.yanShip = 980;
  a.recompute();
  // the COMBAT_END pause: every result is in, nothing settled yet
  h.drive(() => m.phase === PHASE.COMBAT && m.lastResults.size === 2);
  assert.equal(m.phase, PHASE.COMBAT);
  assert.deepEqual([a.layers.yanShip, b.layers.sargonShip || 0], [980, 0], 'nothing persistent yet');
  assert.equal(a.bonds.yanShip.layers, 980, 'the computed state is untouched (rules read it)');
  assert.equal(entry(a.privateView().bonds, 'yanShip').layers, BOND_LAYER_CAP, 'm.private: 980 + 50 shows 999');
  assert.equal(entry(row(h, 'p_0').bonds, 'yanShip').layers, BOND_LAYER_CAP, 'm.public: the same');
  assert.equal(entry(row(h, 'p_1').bonds, 'sargonShip').layers, 12, 'a teammate\'s gain shows in his public row');
  checkInvariants(m);
  h.drive(() => m.phase === PHASE.SETTLE || m.phase === PHASE.PREP);
  assert.deepEqual([a.layers.yanShip, b.layers.sargonShip], [BOND_LAYER_CAP, 12], 'settled once');
  assert.deepEqual([a.pendingLayerGains, b.pendingLayerGains], [null, null]);
  assert.equal(entry(row(h, 'p_1').bonds, 'sargonShip').layers, 12, 'not added twice');
  assert.equal(entry(b.privateView().bonds, 'sargonShip').layers, 12);
  checkInvariants(m);
  m.dispose();
});

test('the 联防 phase keeps showing the gains (a teammate watching the helper sees the layers his battle reached)', () => {
  // p_0 perfect with a gain, p_1 leaks: 联防 with p_0 as the helper
  const h = makeMatch({
    mode: 'coop', humans: 2, seed: 93, fake: true,
    script: (b) => (b.round === 1 && b.kind === 'normal' ? { layerGains: { p_0: { yanShip: 9 } }, leaks: { p_1: 2 } } : {}),
  }).start();
  const m = h.m;
  h.toPrep(1);
  h.drive(() => m.phase === PHASE.UNITE || m.phase === PHASE.SETTLE);
  assert.equal(m.phase, PHASE.UNITE, 'p_1 leaked, p_0 was perfect: 联防');
  assert.equal(h.ps('p_0').layers.yanShip || 0, 0, 'not settled during 联防');
  assert.equal(entry(row(h, 'p_0').bonds, 'yanShip').layers, 9, 'the helper\'s public row shows his battle\'s count');
  assert.equal(entry(h.ps('p_0').privateView().bonds, 'yanShip').layers, 9, 'and his own strip');
  h.drive(() => m.phase === PHASE.PREP && m.round === 2);
  assert.equal(h.ps('p_0').layers.yanShip, 9);
  assert.equal(entry(row(h, 'p_0').bonds, 'yanShip').layers, 9);
  m.dispose();
});

test('the 联防 field fights with the layers the helper\'s own combat reached (PRTS 联防阶段 "以其阵地当前的状态"), capped like the settlement, which still adds them once', () => {
  // p_0 perfect with gains, p_1 leaks: 联防 with p_0 as the helper. Until 0.1.3 the 联防 input carried the round-start
  // layers while the strip showed the reached ones (community report #24: 不屈 at 200+ layers "sometimes not triggering")
  const h = makeMatch({
    mode: 'coop', humans: 2, seed: 95, fake: true,
    script: (b) => (b.round === 1 && b.kind === 'normal' ? { layerGains: { p_0: { indomShip: 20, yanShip: 9 } }, leaks: { p_1: 2 } } : {}),
  }).start();
  const m = h.m;
  h.toPrep(1);
  const a = h.ps('p_0');
  a.layers.indomShip = 230;
  a.layers.yanShip = 995;
  a.recompute();
  const first = FakeBattle.instances.length;
  const input = (kind, round) => FakeBattle.instances.slice(first).find((x) => x.kind === kind && x.round === round)?.opts.players.find((p) => p.playerId === 'p_0');
  h.drive(() => m.phase === PHASE.UNITE || m.phase === PHASE.SETTLE);
  assert.equal(m.phase, PHASE.UNITE, 'p_1 leaked, p_0 was perfect: 联防');
  assert.deepEqual([input('normal', 1).bonds.indomShip.layers, input('normal', 1).bonds.yanShip.layers], [230, 995], 'the own combat: the round-start layers');
  const u = input('unite', 1);
  assert.equal(u.bonds.indomShip.layers, 250, '联防: 230 + the 20 reached in the own combat');
  assert.equal(u.bonds.yanShip.layers, BOND_LAYER_CAP, '995 + 9 is capped at 999, as the settlement caps it');
  assert.equal(u.bonds.indomShip.layers, entry(a.privateView().bonds, 'indomShip').layers, 'the count the strip shows');
  assert.deepEqual([a.layers.indomShip, a.bonds.indomShip.layers], [230, 230], 'nothing persistent yet');
  h.drive(() => m.phase === PHASE.COMBAT && m.round === 2);
  assert.deepEqual([a.layers.indomShip, a.layers.yanShip], [250, BOND_LAYER_CAP], 'settled once (not 270)');
  assert.equal(input('normal', 2).bonds.indomShip.layers, 250, 'the next combat starts from 250');
  checkInvariants(m);
  m.dispose();
});

// ---- the browser runner's live layers ---------------------------------------------------------------------------------

const DS = new DataSource(DATA, null);

function gdOf() {
  const h = makeMatch({ mode: 'solo', seed: 94, fake: true });
  const gd = h.m.gd;
  h.m.dispose();
  return gd;
}

function rig() {
  let t = 1000;
  const frames = [];
  const handlers = new Map();
  const net = {
    on(type, fn) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); return () => handlers.get(type).delete(fn); },
    emit(type, msg) { for (const fn of handlers.get(type) || []) fn({ t: type, ...msg }); },
    send() { return true; },
    request() { return Promise.resolve({ t: 'ok' }); },
  };
  const store = createStore(initialState);
  const runner = createBattleRunner({
    net, store, doc: { hidden: false, addEventListener() {} }, now: () => t,
    raf: (fn) => { frames.push(fn); return frames.length; }, caf() {}, setInterval: () => 1, clearInterval() {},
    loadSim: async () => ({ spec: specMod, ds: DS }), logger: { error() {}, warn() {}, info() {}, debug() {} },
  });
  return {
    runner, net, store,
    advance(ms, step = 1000 / 60) { const end = t + ms; while (t < end) { t = Math.min(end, t + step); for (const fn of frames.splice(0)) fn(t); } },
    async settle() { for (let i = 0; i < 50; i++) { await new Promise((res) => setImmediate(res)); for (const fn of frames.splice(0)) fn(t); } },
  };
}

/** A real b.start of a normal round-2 battle (client-side combat), the board's bonds in its spec. */
function realStart(seed = 7302) {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed, captureFrames: false, clientCombat: true, clients: false });
  h.autoHumans();
  h.m.start();
  h.run(() => h.m.phase === PHASE.COMBAT && h.m.round === 2, { maxSteps: 3e6 });
  const msg = h.lastTo('p_0', 'b.start');
  h.m.dispose();
  return JSON.parse(JSON.stringify(msg));
}

test('runner: state().bondLayers = the absolute live counts of the bonds that grew (≤ 999), published when one grows, kept through the round', async () => {
  const start = realStart();
  assert.ok(start && start.kind === 'normal');
  const sp = start.spec.players.find((p) => p.playerId === 'p_0');
  const ids = Object.keys(sp.bonds);
  assert.ok(ids.length >= 2, 'the spec carries the bond snapshot');
  const [b1, b2] = ids;
  sp.bonds[b1].layers = 995; // near the cap
  sp.bonds[b2].layers = 3;
  const r = rig();
  r.net.emit('b.start', start);
  await r.settle();
  const e = r.runner._entries.get(start.battleId);
  assert.ok(e && e.battle.flags.layerGainsEnabled !== false);
  assert.deepEqual(r.store.get().match.battle.bondLayers, {}, 'nothing grew yet');
  let publishes = 0;
  r.store.subscribe((s, prev) => { if (s.match.battle !== prev.match.battle) publishes++; });
  e.battle.addLayers('p_0', b1, 10, 'test');
  e.battle.addLayers('p_0', b2, 4, 'test');
  r.advance(40);
  assert.deepEqual(r.store.get().match.battle.bondLayers, { p_0: { [b1]: BOND_LAYER_CAP, [b2]: 7 } }, 'absolute counts, capped at 999');
  assert.ok(publishes >= 1, 'published in the frame of the gain');
  const before = publishes;
  r.advance(200);
  assert.ok(publishes - before <= 2, 'no publish per frame without a change');
  // a display replica (a teammate's battle watched after the own one) reports its player's live counts too
  const replica = JSON.parse(JSON.stringify(start));
  replica.battleId = `${start.battleId}x`;
  replica.authoritative = false;
  replica.watch = true;
  r.net.emit('b.start', replica);
  await r.settle();
  const e2 = r.runner._entries.get(replica.battleId);
  e2.battle.addLayers('p_0', b2, 1, 'test');
  r.advance(40);
  assert.equal(r.store.get().match.battle.watch, true, 'the replica is on screen');
  assert.ok(r.store.get().match.battle.bondLayers.p_0, 'the round\'s counts stay published while another battle is on screen');
  // a new prep drops every battle: nothing to lay over any more
  r.store.patch('match', { public: { phase: 'PREP' } });
  assert.deepEqual(r.store.get().match.battle?.bondLayers ?? {}, {});
  r.runner.dispose();
});

test('runner: ownerOps(ownerId) = that player\'s operators in the battle on screen (a teammate\'s popup members), [] elsewhere', async () => {
  const start = realStart(7304);
  const r = rig();
  r.net.emit('b.start', start);
  await r.settle();
  const e = r.runner._entries.get(start.battleId);
  const pid = start.spec.players[0].playerId;
  const want = e.battle.allyUnits.filter((u) => u.kind === 'op' && u.ownerId === pid).map((u) => u.defId).sort();
  assert.ok(want.length > 0, 'the board fields operators');
  const got = r.runner.ownerOps(pid);
  assert.deepEqual(got.map((u) => u.defId).sort(), want, 'before they deploy too (the field meta may not list them yet)');
  assert.ok(got.every((u) => u.kind === 'op' && u.ownerId === pid), 'UnitInfo-like entries');
  assert.deepEqual(r.runner.ownerOps(pid, start.fieldId).length, want.length);
  assert.deepEqual(r.runner.ownerOps(pid, 'n:nobody'), [], 'another field: nothing');
  assert.deepEqual(r.runner.ownerOps('ghost'), [], 'a player without operators there');
  assert.deepEqual(r.runner.ownerOps(null), []);
  r.runner.dispose();
});

test('runner: a battle that disables gains (联防 / boss) publishes no live layers', async () => {
  const start = realStart(7303);
  start.spec.flags = { ...(start.spec.flags || {}), layerGainsEnabled: false };
  const r = rig();
  r.net.emit('b.start', start);
  await r.settle();
  const e = r.runner._entries.get(start.battleId);
  const id = Object.keys(start.spec.players[0].bonds)[0];
  assert.equal(e.battle.addLayers(start.spec.players[0].playerId, id, 5, 'test'), 0);
  r.advance(100);
  assert.deepEqual(r.store.get().match.battle.bondLayers, {});
  r.runner.dispose();
});
