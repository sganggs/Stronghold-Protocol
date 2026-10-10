import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { ERR, PHASE } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { createRng, deriveSeed } from '../../server/sim/rng.js';
import { setupMatchWaves } from '../../server/match/waves.js';
import { drawDisabledBonds } from '../../server/match/pool.js';

const snapshot = (m) => ({ stageId: m.stageId, bossId: m.bossId, hiddenBossId: m.hiddenBossId,
  factions: [...m.factions], schedule: m.factions.schedule, bans: [...m.bannedChess], drawn: [...m.disabledBonds] });
const approve = (m, id, voteId = m.setupVote.id) => m.handle(id, { t: 'g.rerollVote', voteId, agree: true });

test('reroll with one second left gives everyone a fresh full countdown; old timeout cannot advance it', (t) => {
  const h = makeMatch({ humans: 2 }).start();
  t.after(() => h.m.dispose());
  const m = h.m;
  const fullMs = m.scaled(m.gd.timer('infoCheck') * 1000);
  h.sched.advance(fullMs - 1000);
  assert.equal(m.deadline - h.sched.now(), 1000);
  assert.deepEqual(m.requestSetupReroll('p_0', 0), { ok: true });
  h.sched.advance(5000);
  assert.deepEqual(approve(m, 'p_1'), { ok: true });
  const fresh = h.lastBc('m.public');
  assert.equal(fresh.deadline - fresh.serverNow, fullMs);
  assert.ok(fresh.players.every((p) => !p.ready));
  h.sched.advance(fullMs - 1);
  assert.equal(m.phase, PHASE.INFO_CHECK);
  h.sched.advance(1);
  assert.equal(m.phase, PHASE.BAND_DRAFT);
});

test('protocol requires setup revisions and vote identities; old initial ready remains supported', () => {
  assert.equal(validateC2S({ t: 'room.rerollSetup', setupRevision: 0 }), null);
  assert.equal(validateC2S({ t: 'room.cancelReroll', voteId: 1 }), null);
  assert.equal(validateC2S({ t: 'g.rerollVote', voteId: 1, agree: false }), null);
  assert.equal(validateC2S({ t: 'g.infoReady' }), null);
  assert.equal(validateC2S({ t: 'g.infoReady', setupRevision: 2 }), null);
  for (const msg of [{ t: 'room.rerollSetup' }, { t: 'room.rerollSetup', setupRevision: -1 },
    { t: 'room.rerollSetup', setupRevision: 0.5 }, { t: 'g.rerollVote', voteId: 0, agree: true },
    { t: 'g.rerollVote', voteId: 1 }, { t: 'g.rerollVote', voteId: 1, agree: 'yes' },
    { t: 'room.cancelReroll' }, { t: 'g.infoReady', setupRevision: -1 }]) {
    assert.notEqual(validateC2S(msg), null, JSON.stringify(msg));
  }
});

test('four humans must agree; rerolls the entire official setup and stock, preserves seats/settings/RNG', (t) => {
  const h = makeMatch({ humans: 4, difficulty: 'HARD', seed: 123, spectators: ['viewer'] }).start();
  t.after(() => h.m.dispose());
  const m = h.m;
  const before = snapshot(m);
  const pool = m.pool;
  const players = [...m.order];
  const rngs = [m.rngSetup, m.rngShop, m.rngDraft, m.rngWaves, m.rngBots, m.rngMeta].map((r) => [r, r.state()]);
  const p0 = h.ps('p_0');
  assert.equal(p0.setDiy({ chess_char_5_diy1_a: { charId: 'char_017_huang', skillIndex: 0 } }), true);
  p0.initDiyStock(new Set([...m.disabledBonds, ...m.staticInactiveBonds]));
  const settings = [p0.loadout, p0.standIns, p0.diy];
  const stock = p0.diyStock;
  m.handle('p_1', { t: 'g.infoReady' });
  h.sched.advance(500);
  assert.deepEqual(m.requestSetupReroll('p_0', 0), { ok: true });
  assert.deepEqual(m.setupVote.voters, ['p_0', 'p_1', 'p_2', 'p_3']);
  assert.equal(m.deadline, 0);
  assert.deepEqual(approve(m, 'p_1'), { ok: true });
  assert.deepEqual(approve(m, 'p_2'), { ok: true });
  h.sched.advance(30000);
  assert.equal(m.phase, PHASE.INFO_CHECK);
  assert.deepEqual(snapshot(m), before, 'nothing rerolled until everyone agrees');
  assert.equal(m.handle('viewer', { t: 'g.rerollVote', voteId: m.setupVote.id, agree: true }).error, ERR.SPECTATOR);
  assert.deepEqual(approve(m, 'p_3'), { ok: true });
  assert.equal(m.setupRevision, 1);
  assert.equal(m.setupVote, null);
  const rng = createRng(deriveSeed(m.seed, 'reroll-setup:1'));
  const setup = setupMatchWaves(m.gd, rng);
  const bans = drawDisabledBonds(m.gd, rng);
  assert.deepEqual(snapshot(m), { stageId: setup.stageId, bossId: setup.bossId, hiddenBossId: setup.hiddenBossId,
    factions: [...setup.factions], schedule: setup.factions.schedule, bans: bans.banned, drawn: bans.drawn });
  assert.notDeepEqual(snapshot(m), before);
  assert.equal(m.stage, m.gd.stage(m.stageId));
  assert.notEqual(m.pool, pool);
  assert.deepEqual(m.order, players);
  assert.deepEqual([p0.loadout, p0.standIns, p0.diy], settings);
  assert.equal(p0.diy, settings[2]);
  assert.notEqual(p0.diyStock, stock);
  const off = new Set([...bans.drawn, ...bans.staticOff]);
  const diy = p0.gd.chess('chess_char_5_diy1_a');
  assert.equal(p0.diyBanned.includes(diy.chessId), diy.bonds.every((b) => off.has(b)));
  assert.equal(p0.diyStock.has(diy.chessId), !p0.diyBanned.includes(diy.chessId));
  for (const [r, state] of rngs) assert.equal(r.state(), state);
  for (const id of m.gd.visibleChess) assert.equal(m.pool.has(id), !bans.banned.includes(id));
  assert.ok(m.order.every((p) => !p.infoReady));
  assert.equal(m.deadline, h.sched.now() + m.scaled(m.gd.timer('infoCheck') * 1000));
  assert.equal(h.lastBc('m.public').setupRevision, 1);
  h.invariants();
  for (const p of m.order) assert.deepEqual(m.handle(p.playerId, { t: 'g.infoReady', setupRevision: 1 }), { ok: true });
  h.sched.advance(0);
  assert.equal(m.phase, PHASE.BAND_DRAFT);
});

test('reject/cancel restores exact remaining countdown and keeps setup and ready flags', (t) => {
  const h = makeMatch({ humans: 2, timerScale: 0.5 }).start();
  t.after(() => h.m.dispose());
  const m = h.m;
  const before = snapshot(m);
  m.handle('p_1', { t: 'g.infoReady' });
  h.sched.advance(1000);
  const remaining = m.deadline - h.sched.now();
  m.requestSetupReroll('p_0', 0);
  h.sched.advance(10000);
  assert.deepEqual(m.handle('p_1', { t: 'g.rerollVote', voteId: m.setupVote.id, agree: false }), { ok: true });
  assert.deepEqual(snapshot(m), before);
  assert.equal(m.setupRevision, 0);
  assert.equal(h.ps('p_1').infoReady, true);
  assert.equal(m.deadline, h.sched.now() + remaining, 'real remaining ms, no extra timer scaling');
  m.requestSetupReroll('p_0', 0);
  assert.deepEqual(m.cancelSetupReroll('p_0', m.setupVote.id), { ok: true });
  assert.equal(m.deadline, h.sched.now() + remaining);
  h.sched.advance(remaining - 1);
  assert.equal(m.phase, PHASE.INFO_CHECK);
  h.sched.advance(1);
  assert.equal(m.phase, PHASE.BAND_DRAFT);
});

test('reroll cancels queued all-ready transition; stale ready and previous vote cannot affect a new setup', (t) => {
  const h = makeMatch({ humans: 2 }).start();
  t.after(() => h.m.dispose());
  const m = h.m;
  for (const p of m.order) m.handle(p.playerId, { t: 'g.infoReady' });
  assert.ok(m._infoAdvanceTimer);
  m.requestSetupReroll('p_0', 0);
  const oldVote = m.setupVote.id;
  assert.equal(m.handle('p_1', { t: 'g.infoReady' }).error, ERR.WRONG_PHASE);
  approve(m, 'p_1');
  h.sched.advance(0);
  assert.equal(m.phase, PHASE.INFO_CHECK);
  for (const msg of [{ t: 'g.infoReady' }, { t: 'g.infoReady', setupRevision: 0 }]) {
    assert.equal(m.handle('p_1', msg).error, ERR.BAD_TARGET);
  }
  assert.equal(m.requestSetupReroll('p_0', 0).error, ERR.BAD_TARGET);
  assert.equal(m.requestSetupReroll('p_0', 1).error, ERR.RATE);
  h.sched.advance(300);
  assert.deepEqual(m.requestSetupReroll('p_0', 1), { ok: true });
  assert.equal(approve(m, 'p_1', oldVote).error, ERR.BAD_TARGET);
  assert.equal(m.cancelSetupReroll('p_0', oldVote).error, ERR.BAD_TARGET);
  assert.equal(m.setupVote.agreed.size, 1);
});

test('solo and one human with bots refresh immediately without a forced timer; fixed rules remain fixed', (t) => {
  for (const mode of ['solo', 'coop']) {
    const h = makeMatch({ mode, humans: 1, bots: 2, difficulty: 'FUNNY' }).start();
    t.after(() => h.m.dispose());
    const m = h.m;
    const stage = m.stageId;
    const staticOff = [...m.staticInactiveBonds];
    assert.deepEqual(m.requestSetupReroll('p_0', 0), { ok: true });
    assert.equal(m.stageId, stage);
    assert.deepEqual(m.staticInactiveBonds, staticOff);
    assert.equal(m.deadline, 0);
    assert.equal(m.setupRevision, 1);
    assert.equal(m.setupVote, null);
    assert.equal(h.ps('p_0').infoReady, false);
    assert.ok(m.order.filter((p) => p.isBot).every((p) => p.infoReady));
    m.handle('p_0', { t: 'g.infoReady', setupRevision: 1 });
    h.sched.advance(0);
    assert.equal(m.phase, PHASE.BAND_DRAFT);
    assert.equal(m.requestSetupReroll('p_0', 1).error, ERR.WRONG_PHASE);
  }
});

test('disconnect and leave cancel rather than count as consent; reconnect sees current vote/setup', (t) => {
  const h = makeMatch({ humans: 3 }).start();
  t.after(() => h.m.dispose());
  const m = h.m;
  const before = snapshot(m);
  m.requestSetupReroll('p_0', 0);
  const id = m.setupVote.id;
  m.onReconnect('p_1');
  assert.equal(h.lastTo('p_1', 'm.public').rerollVote.id, id);
  m.onDisconnect('p_1');
  assert.equal(m.setupVote, null);
  assert.deepEqual(snapshot(m), before);
  h.sched.advance(300);
  assert.equal(m.requestSetupReroll('p_0', 0).error, ERR.NOT_READY);
  m.onReconnect('p_1');
  assert.equal(h.lastTo('p_1', 'm.public').rerollVote, null);
  m.requestSetupReroll('p_0', 0);
  m.onLeave('p_1');
  assert.equal(m.setupVote, null);
  assert.equal(m.setupRevision, 0);
  h.sched.advance(300);
  m.requestSetupReroll('p_0', 0);
  assert.deepEqual(m.setupVote.voters, ['p_0', 'p_2']);
  approve(m, 'p_2');
  assert.equal(m.setupRevision, 1);
});

test('autoplay humans still explicitly consent; dispose stops a paused vote and invalid actors are refused', (t) => {
  const h = makeMatch({ humans: 2, bots: 1 }).start();
  t.after(() => h.m.dispose());
  const m = h.m;
  m.handle('p_1', { t: 'g.autoplay', on: true });
  assert.equal(m.requestSetupReroll('ai_0', 0).error, ERR.NOT_IN_ROOM);
  assert.equal(m.requestSetupReroll('stranger', 0).error, ERR.NOT_IN_ROOM);
  m.requestSetupReroll('p_0', 0);
  assert.equal(m.setupVote.agreed.size, 1);
  h.sched.advance(30000);
  assert.equal(m.setupRevision, 0);
  assert.equal(m.phase, PHASE.INFO_CHECK);
  m.dispose();
  assert.equal(m.requestSetupReroll('p_0', 0).error, ERR.WRONG_PHASE);
  h.sched.advance(30000);
  assert.equal(m.setupRevision, 0);
});

test('failed DIY stock preparation leaves every opening field and player stock intact', (t) => {
  const h = makeMatch({ humans: 2, difficulty: 'HARD' }).start();
  t.after(() => h.m.dispose());
  const m = h.m, before = snapshot(m), pool = m.pool, stage = m.stage;
  const stocks = m.order.map((ps) => ps.diyStock), banned = m.order.map((ps) => ps.diyBanned);
  h.sched.advance(1000);
  const remaining = m.deadline - h.sched.now();
  m.requestSetupReroll('p_0', 0);
  const original = h.ps('p_1').buildDiyStock;
  h.ps('p_1').buildDiyStock = () => { throw Error('stock preparation failed'); };
  assert.equal(approve(m, 'p_1').error, ERR.INTERNAL);
  h.ps('p_1').buildDiyStock = original;
  assert.deepEqual(snapshot(m), before); assert.equal(m.pool, pool); assert.equal(m.stage, stage);
  for (const [i, ps] of m.order.entries()) { assert.equal(ps.diyStock, stocks[i]); assert.equal(ps.diyBanned, banned[i]); }
  assert.equal(m.setupRevision, 0); assert.equal(m.setupVote, null);
  assert.equal(m.deadline - h.sched.now(), remaining);
  assert.equal(h.logs.error.length, 1, 'failure is reported once');
});
