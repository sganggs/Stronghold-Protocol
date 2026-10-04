// Client-side combat (DESIGN §14): BattleSpec round trip and determinism, authority per field, b.progress / b.result,
// result validation (implausible results → server re-simulation), takeovers (disconnect, deadline, leave), the shared
// boss pool across two client-run fields (b.pool, team LP, overtime, b.end), 联防 built from the helpers' reported end
// state, observing rules (research 09 §3.1 / §6.3), SP_VERIFY, reconnect. SimClients (test/match/simClient.js) play
// the browsers in virtual time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { validateC2S, isBattleResult } from '../../shared/protocol.js';
import { buildBattleSpec, createBattleFromSpec, resultDigest, compactResult, LocalBossPool, jsonClone } from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';
import { validateClientResult, specBounds } from '../../server/match/fields.js';
import { CreditPool, SharedBossPool } from '../../server/match/finalAssault.js';
import { FakeBattle } from './fakeBattle.js';
import { DATA, makeMatch, checkInvariants, give, chessOfTier } from './harness.js';

/** A fresh DataSource over the raw data, like a browser that fetched /data/*.json (no research fallback). */
const browserDs = () => new DataSource(DATA, null);

function fields(h) { return h.m.fields; }

test('spec: JSON-safe round trip; a browser-built battle and the server battle give identical results (real sim, many rounds)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 2, bots: 2, seed: 9101, captureFrames: false, clientCombat: true });
  h.autoHumans();
  const specs = [];
  h.onSend.push((pid, msg) => { if (msg.t === 'b.start' && msg.authoritative) specs.push(msg.spec); });
  h.m.start();
  h.run(() => h.ended != null || (h.m.round >= 6 && h.m.phase === PHASE.PREP), { maxSteps: 5e6 });
  assert.ok(specs.length >= 8, `authoritative specs seen (${specs.length})`);
  const kinds = new Set(specs.map((s) => s.kind));
  assert.ok(kinds.has('normal'), 'normal fields');
  for (const spec of specs) {
    assert.equal(JSON.stringify(jsonClone(spec)), JSON.stringify(spec), 'a spec survives JSON unchanged');
    assert.equal(typeof spec.stageId, 'string');
    assert.ok(!('stage' in spec) && !('sharedBoss' in spec) && !('data' in spec), 'no object references travel');
    const a = createBattleFromSpec(spec, browserDs(), { recordEvents: false, quiet: true }).runToEnd(4000);
    const b = createBattleFromSpec(JSON.parse(JSON.stringify(spec)), h.m.ds, { recordEvents: true, quiet: true }).runToEnd(4000);
    assert.equal(resultDigest(a).hash, resultDigest(b).hash, `${spec.fieldId} R${spec.round}: same result on both sides`);
    // what the client uploads passes the protocol validator and the server's semantic validation
    const up = compactResult(a);
    assert.ok(isBattleResult(up), 'compact result is a valid b.result payload');
    assert.equal(validateC2S({ t: 'b.result', battleId: spec.battleId, result: up }), null);
    const v = validateClientResult(spec, up, { gd: h.m.gd });
    assert.ok(v.ok, `${spec.fieldId} R${spec.round}: accepted (${v.reason})`);
  }
  h.m.dispose();
});

test('client-side combat is outcome-identical to server-run combat (same seed: LP, funds, layers every round)', () => {
  const trace = (clientCombat) => {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 1, seed: 9102, captureFrames: false, clientCombat });
    h.autoHumans();
    const m = h.m;
    const out = [];
    let last = '';
    m.start();
    h.run(() => {
      const k = `${m.phase}:${m.round}`;
      if (k !== last) { last = k; if (m.phase === PHASE.SETTLE) out.push(`${k} ${m.order.map((p) => `${p.lp}/${p.funds}+${p.pendingFunds}/${JSON.stringify(p.layers)}`).join(' ')}`); }
      return h.ended != null || m.round >= 8;
    }, { maxSteps: 5e6 });
    assert.equal(m.errorCount, 0, JSON.stringify(m.errors.slice(0, 2)));
    m.dispose();
    return out;
  };
  const server = trace(false);
  const client = trace(true);
  assert.ok(server.length >= 6);
  assert.deepEqual(client, server);
});

test('COMBAT: humans get their own spec (authoritative), bots are simulated by the server; no b.snap / b.ev; progress in m.public', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 1, seed: 9103, fake: true, clientCombat: true, clients: false, script: () => ({ duration: 6 }) }).start();
  const m = h.m;
  h.toPrep(1);
  m.handle('p_0', { t: 'g.ready', ready: true });
  m.handle('p_1', { t: 'g.ready', ready: true });
  h.run(() => m.phase === PHASE.COMBAT);
  const starts = h.sent.filter(([, x]) => x.t === 'b.start');
  assert.deepEqual(starts.map(([pid, x]) => [pid, x.fieldId, x.authoritative]).sort(), [['p_0', 'n:p_0', true], ['p_1', 'n:p_1', true]]);
  const st = starts[0][1];
  assert.equal(st.speed, m.gameSpeed);
  assert.equal(st.elapsed, 0);
  assert.equal(typeof st.startAt, 'number');
  assert.equal(st.spec.kind, 'normal');
  assert.equal(st.spec.battleId, st.battleId);
  const bot = fields(h).find((f) => f.fieldId === 'n:ai_0');
  assert.equal(bot.mode, 'server', 'the bot field runs on the server');
  assert.ok(bot.result, 'its result is computed at once');
  assert.equal(bot.live, true, '… and released at the battle\'s natural end');
  const human = fields(h).find((f) => f.fieldId === 'n:p_0');
  assert.equal(human.mode, 'client');
  assert.equal(human.authority, 'p_0');
  // progress reports drive the teammates' waiting UI
  assert.deepEqual(m.handle('p_0', { t: 'b.progress', battleId: human.battleId, gt: 4, killed: 3, total: 9, leaks: 0 }), { ok: true });
  m.flush(true);
  const pub = m.publicView();
  assert.deepEqual(pub.fields.find((f) => f.fieldId === 'n:p_0').progress, { killed: 3, total: 9, done: false });
  // a stale / foreign report is ignored (never an error toast)
  assert.deepEqual(m.handle('p_1', { t: 'b.progress', battleId: human.battleId, gt: 9, killed: 9, total: 9 }), { ok: true });
  assert.equal(human.progress.killed, 3);
  assert.deepEqual(m.handle('p_0', { t: 'b.progress', battleId: 'nope', gt: 1, killed: 0, total: 0 }), { ok: true });
  h.sched.advance(5000);
  assert.equal(h.sent.filter(([, x]) => x.t === 'b.snap' || x.t === 'b.ev').length, 0, 'no combat streaming');
  // both humans report (FakeBattle stands in for the browser sim)
  for (const pid of ['p_0', 'p_1']) {
    const f = fields(h).find((x) => x.fieldId === `n:${pid}`);
    const b = createBattleFromSpec(f.spec, m.ds, { BattleClass: FakeBattle });
    b.runToEnd?.(); while (!b.finished) b.step();
    assert.deepEqual(m.handle(pid, { t: 'b.result', battleId: f.battleId, result: compactResult(b.result()) }), { ok: true });
    assert.equal(f.resultSource, 'client');
  }
  h.run(() => m.phase !== PHASE.COMBAT);
  assert.ok([PHASE.SETTLE, PHASE.UNITE].includes(m.phase), m.phase);
  checkInvariants(m);
  m.dispose();
});

test('validation: implausible client results are rejected and replaced by the server\'s simulation', () => {
  const cases = [
    ['coins beyond the bounties', (r) => { for (const p of Object.values(r.perPlayer)) p.coins = 999; return r; }],
    ['a leak of an enemy that never spawned', (r) => { const p = Object.values(r.perPlayer)[0]; p.leaked.push({ enemyKey: 'enemy_1502_crowns', mods: null, lpr: 1, sourcePlayerId: null, tag: null, counted: true }); p.perfect = false; return r; }],
    ['perfect despite counted leaks', (r, spec) => { const p = Object.values(r.perPlayer)[0]; p.leaked = [{ enemyKey: spec.spawns[0].enemyKey, counted: true }]; p.perfect = true; return r; }],
    ['layer gains above the bound', (r) => { for (const p of Object.values(r.perPlayer)) p.layerGains = { yanShip: 500 }; return r; }],
    ['a player who is not in the battle', (r) => { r.perPlayer.ghost = { ...Object.values(r.perPlayer)[0] }; return r; }],
  ];
  for (const [name, tamper] of cases) {
    const h = makeMatch({ mode: 'coop', humans: 2, seed: 9104, captureFrames: false, clientCombat: true, perPlayer: { p_0: { tamper } } });
    h.autoHumans();
    const m = h.m;
    m.start();
    h.run(() => m.phase === PHASE.SETTLE || h.ended != null);
    const f = m.lastResults.get('p_0');
    assert.ok(f, name);
    assert.ok(m.verifyStats.rejected >= 1, `${name}: rejected`);
    assert.ok(m.verifyStats.takeovers >= 1, `${name}: server re-simulation`);
    assert.ok(Object.values(f.layerGains || {}).every((n) => n <= 60 + 4 * m.round), `${name}: no forged layers`);
    assert.ok(f.coins <= 50, `${name}: no forged coins`);
    const takeover = h.clients.get('p_0').ends.find((x) => x.reason === 'takeover');
    assert.ok(takeover, `${name}: the client was told the server took over`);
    m.dispose();
  }
  // unit checks of the validator
  const spec = buildBattleSpec({ battleId: 'x', fieldId: 'n:p', kind: 'normal', round: 3, stageId: 's', timeLimit: 120, players: [{ playerId: 'p', units: [{ uid: 5, kind: 'chess', chessId: 'chess_char_1_a', row: 9, col: 3 }] }], spawns: [{ enemyKey: 'enemy_1007_slime', count: 3, time: 0, bounty: { coins: 2, ownerPlayerId: 'p' } }], flags: { layerGainsEnabled: true } });
  const ok = { reason: 'timeout', time: 120, perPlayer: { p: { killed: 2, total: 3, leaked: [{ enemyKey: 'enemy_1007_slime', counted: true }], perfect: false, layerGains: { yanShip: 3 }, coins: 4, unitsEnd: [{ uid: 5, hpPct: 0.5, sp: 2, alive: true }] } } };
  assert.equal(validateClientResult(spec, ok, {}).ok, true);
  const bad = (edit) => { const r = JSON.parse(JSON.stringify(ok)); edit(r); return validateClientResult(spec, r, {}); };
  assert.equal(bad((r) => { r.perPlayer.p.coins = 7; }).reason, 'coins');
  assert.equal(bad((r) => { r.perPlayer.p.leaked.push(...Array(3).fill({ enemyKey: 'enemy_1007_slime', counted: true })); }).reason, 'leak multiset');
  assert.equal(bad((r) => { r.perPlayer.p.perfect = true; }).reason, 'perfect');
  assert.equal(bad((r) => { r.perPlayer.p.layerGains.yanShip = 73; }).reason, 'layer bound');
  assert.equal(bad((r) => { r.time = 500; }).reason, 'time');
  assert.equal(bad((r) => { r.perPlayer.q = r.perPlayer.p; }).reason, 'players');
  assert.equal(bad((r) => { r.perPlayer.p.unitsEnd[0].hpPct = 2; }).reason, 'unit state');
  const noLayers = buildBattleSpec({ ...spec, kind: 'unite', flags: { layerGainsEnabled: false } });
  assert.equal(validateClientResult(noLayers, ok, {}).reason, 'layers disabled');
  // a structurally broken payload never reaches the match (protocol validator)
  assert.notEqual(validateC2S({ t: 'b.result', battleId: 'x', result: { ...ok, perPlayer: {} } }), null);
  assert.notEqual(validateC2S({ t: 'b.result', battleId: 'x', result: { ...ok, reason: 'won' } }), null);
  assert.notEqual(validateC2S({ t: 'b.result', battleId: 'x', result: { ...ok, perPlayer: { p: { ...ok.perPlayer.p, leaked: Array(401).fill({ enemyKey: 'enemy_a' }) } } } }), null);
  assert.equal(specBounds(spec).bountyCoins, 6);
});

test('takeover: an authority that disconnects mid-combat loses its field; the server re-simulates it; reconnect gets a display replica', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 9105, captureFrames: false, clientCombat: true, perPlayer: { p_1: { mute: true } } });
  h.autoHumans();
  const m = h.m;
  m.start();
  h.run(() => m.phase === PHASE.COMBAT);
  const f = fields(h).find((x) => x.fieldId === 'n:p_1');
  assert.equal(f.mode, 'client');
  h.sched.advance(3000);
  m.onDisconnect('p_1');
  assert.equal(f.mode, 'server', 'server takeover on disconnect');
  assert.ok(f.result && f.resultSource === 'server');
  assert.equal(m.verifyStats.takeovers, 1);
  m.onReconnect('p_1');
  const again = h.lastTo('p_1', 'b.start');
  assert.equal(again.battleId, f.battleId);
  assert.equal(again.authoritative, false, 'the returning player only watches (the server holds the result)');
  assert.ok(again.elapsed > 0, `fast-forward target (${again.elapsed})`);
  h.run(() => m.phase === PHASE.SETTLE || h.ended != null);
  assert.ok(m.lastResults.has('p_1'));
  // the server's result equals what an honest client would have reported (deterministic spec)
  const honest = createBattleFromSpec(f.spec, browserDs(), { quiet: true }).runToEnd(4000);
  assert.equal(resultDigest(validateClientResult(f.spec, compactResult(honest), { gd: m.gd }).result).hash, resultDigest(validateClientResult(f.spec, compactResult(f.result), { gd: m.gd }).result).hash);
  checkInvariants(m);
  m.dispose();
});

test('takeover: a connected client that never reports is taken over at time limit + 15 s grace; departed players are settled at once', () => {
  const h = makeMatch({ mode: 'coop', humans: 3, seed: 9106, captureFrames: false, clientCombat: true, instant: false, perPlayer: { p_2: { stall: true } } });
  h.autoHumans();
  const m = h.m;
  m.start();
  h.run(() => m.phase === PHASE.COMBAT);
  const f = fields(h).find((x) => x.fieldId === 'n:p_2');
  const t0 = m.sched.now();
  const limitMs = (f.spec.timeLimit / m.gameSpeed) * 1000;
  h.run(() => f.mode === 'server' || m.phase !== PHASE.COMBAT, { maxTime: limitMs + 20000 });
  assert.equal(f.mode, 'server');
  const at = m.sched.now() - t0;
  assert.ok(at >= limitMs + 15000 - 50 && at <= limitMs + 15000 + 400, `taken over at ${at} ms (limit ${limitMs} + 15000)`);
  h.sched.advance(1);
  assert.ok(h.clients.get('p_2').ends.some((x) => x.reason === 'takeover'), 'the stalled client is told');
  h.run(() => m.phase !== PHASE.COMBAT);
  // a player who leaves mid-combat: its field is closed at once (it is eliminated anyway)
  h.run(() => m.phase === PHASE.COMBAT && m.round === 2, { maxSteps: 3e6 });
  if (m.phase === PHASE.COMBAT) {
    const g = fields(h).find((x) => x.fieldId === 'n:p_1');
    m.onLeave('p_1');
    assert.equal(g.done, true);
    assert.equal(g.live, false);
  }
  m.dispose();
});

test('observing: no watching while the own battle runs; after it ends a teammate\'s spec + clock; eliminated players watch anything', () => {
  const h = makeMatch({ mode: 'coop', humans: 3, seed: 9107, fake: true, clientCombat: true, instant: false, pace: 'paced',
    script: (b) => ({ duration: b.players.includes('p_0') ? 2 : 30 }) }).start();
  const m = h.m;
  h.toPrep(1);
  for (const pid of ['p_0', 'p_1', 'p_2']) m.handle(pid, { t: 'g.ready', ready: true });
  h.run(() => m.phase === PHASE.COMBAT);
  // p_1 still fights: it may not look elsewhere
  assert.deepEqual(m.handle('p_1', { t: 'g.watch', fieldId: 'n:p_2' }), { error: 'WRONG_PHASE', detail: 'own battle running' });
  h.run(() => fields(h).find((f) => f.fieldId === 'n:p_0').done);
  const target = fields(h).find((f) => f.fieldId === 'n:p_2');
  assert.equal(target.live, true);
  h.sched.advance(1000);
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_2' }), { ok: true });
  const st = h.lastTo('p_0', 'b.start');
  assert.equal(st.fieldId, 'n:p_2');
  assert.equal(st.watch, true);
  assert.equal(st.authoritative, false);
  assert.ok(st.elapsed > 0, 'the replica fast-forwards to the field clock');
  assert.deepEqual(st.spec, target.spec);
  assert.equal(m.watchers.get('p_0'), 'n:p_2');
  // back to the own (finished) field
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_0' }), { ok: true });
  assert.equal(h.lastTo('p_0', 'b.start').done, true);
  assert.equal(m.handle('p_0', { t: 'g.watch', fieldId: 'b9' }).error, 'BAD_TARGET');
  // an eliminated player may watch anything
  h.ps('p_0').alive = false;
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });
  h.ps('p_0').alive = true;
  m.dispose();
});

test('Final Assault: two client-run pair fields share the server pool (b.progress bossDmg), b.pool ≤ 4 Hz, victory, per-player damage', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 4, seed: 9108, fake: true, clientCombat: true, instant: false,
    script: (b) => (b.kind === 'boss' ? { bossDps: 20000 } : { duration: 2 }) }).start();
  const m = h.m;
  const poolAt = [];
  h.onBroadcast.push((msg) => { if (msg.t === 'b.pool') poolAt.push(h.sched.now()); });
  h.autoHumans();
  h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
  const [b1, b2] = fields(h);
  assert.deepEqual([b1.fieldId, b2.fieldId], ['b1', 'b2']);
  assert.deepEqual([b1.mode, b1.authority, b2.mode, b2.authority], ['client', 'p_0', 'client', 'p_2'], 'lowest seat of each pair');
  const startMsgs = h.sent.filter(([, x]) => x.t === 'b.start' && x.kind === 'boss');
  assert.deepEqual(startMsgs.map(([pid, x]) => `${pid}:${x.fieldId}:${x.authoritative ? 'A' : 'r'}`).sort(), ['p_0:b1:A', 'p_1:b1:r', 'p_2:b2:A', 'p_3:b2:r']);
  assert.equal(startMsgs[0][1].spec.boss.poolMax, m.bossPool.maxHp);
  const max = m.bossPool.maxHp;
  h.sched.advance(3000);
  const hp = m.bossPool.hp;
  assert.ok(hp < max, 'client damage reaches the server pool');
  assert.ok(b1.bossAcked > 0 && b2.bossAcked > 0, 'both fields contributed');
  assert.ok(Math.abs((max - hp) - (b1.bossAcked + b2.bossAcked)) < 1e-6, 'pool = max − Σ reported field damage');
  const pools = h.bc.filter((x) => x.t === 'b.pool');
  assert.ok(pools.length > 3);
  for (let i = 1; i < poolAt.length; i++) assert.ok(poolAt[i] - poolAt[i - 1] >= 250, `b.pool ≤ 4 Hz (${poolAt[i] - poolAt[i - 1]} ms apart)`);
  assert.deepEqual(Object.keys(pools[pools.length - 1].acked).sort(), ['b1', 'b2']);
  const end = h.runToEnd();
  assert.equal(end.victory, true);
  const dmg = [...m.players.values()].map((p) => p.stats.bossDamage);
  assert.ok(dmg.every((d) => d > 0), `per-player boss damage attributed (${dmg})`);
  assert.ok(Math.abs(dmg.reduce((a, b) => a + b, 0) - max) < 1, 'Σ player damage = pool');
  m.dispose();
});

test('Final Assault: leaks and leader LP effects from b.progress drain the team LP; overtime after 150 real s at 1 LP/real s; team LP 0 → b.end → defeat', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 2, seed: 9109, fake: true, clientCombat: true, instant: false,
    script: (b) => (b.kind === 'boss' ? { bossDps: 0, leakEvents: [{ at: 2, lpr: 3 }], lpLossEvents: [{ at: 3, amount: 2 }] } : { duration: 2 }) }).start();
  const m = h.m;
  h.autoHumans();
  h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
  const lp0 = m.teamLp;
  h.sched.advance(4000);
  assert.equal(m.teamLp, lp0 - 5, 'leak lpr 3 + leader effect 2');
  const lp1 = m.teamLp;
  // overtime (bossTurnHpReduceTime): 150 REAL s like the level's 120 s countdown, then 1 LP per real second
  const t0 = m._bossStartAt;
  const pub = () => h.bc.filter((x) => x.t === 'm.public').pop();
  m.flush(true);
  assert.equal(pub().deadline, t0 + 120000, 'the HUD counts the boss level\'s 120 s down');
  assert.equal(pub().overtimeAt, t0 + 150000, 'and knows when the drain starts');
  h.sched.advance(t0 + 150000 - m.sched.now() + 500);
  assert.equal(m.teamLp, lp1, 'no drain before 150 real s (the countdown ran out at 120 s, the battle went on)');
  h.sched.advance(5000);
  assert.ok(m.teamLp <= lp1 - 4 && m.teamLp >= lp1 - 6, `overtime drain ≈ 5 LP over 5 real s (${lp1} → ${m.teamLp})`);
  const end = h.runToEnd();
  assert.equal(end.victory, false);
  assert.equal(m.teamLp, 0);
  assert.ok(h.clients.get('p_1').ends.some((x) => x.reason === 'forced') || h.clients.get('p_0').ends.some((x) => x.reason === 'forced'), 'b.end reached the field');
  m.dispose();
});

test('Final Assault: the authority leaves → its partner\'s replica takes over; nobody left → the server paces the field (credits only new damage)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 2, seed: 9110, fake: true, clientCombat: true, instant: false,
    script: (b) => (b.kind === 'boss' ? { bossDps: 2000 } : { duration: 2 }) }).start();
  const m = h.m;
  h.autoHumans();
  h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
  const f = fields(h)[0];
  h.sched.advance(2000);
  const acked = f.bossAcked;
  assert.ok(acked > 0);
  m.onDisconnect('p_0');
  assert.equal(f.authority, 'p_1', 'the partner takes over');
  assert.equal(h.lastTo('p_1', 'b.start').authoritative, true);
  h.sched.advance(2000);
  assert.ok(f.bossAcked > acked, 'the new authority keeps reporting cumulative damage');
  const before = m.bossPool.hp;
  m.onDisconnect('p_1');
  assert.equal(f.mode, 'server');
  const afterHp = m.bossPool.hp;
  assert.ok(Math.abs(afterHp - before) < 1e-6, 'the re-simulation does not double count reported damage');
  h.sched.advance(3000);
  assert.ok(m.bossPool.hp < afterHp, 'the server run keeps damaging the pool');
  const end = h.runToEnd();
  assert.equal(end.victory, true);
  m.dispose();
});

test('联防 under client-side combat: helpers\' reported end state (HP%, SP) carries into the spec; everyone gets the spec; authority = lowest-seat helper', () => {
  const h = makeMatch({ mode: 'coop', humans: 3, seed: 9111, fake: true, clientCombat: true,
    script: (b) => (b.kind === 'normal' ? { leaks: { p_0: 4 } } : {}) }).start();
  const m = h.m;
  h.toPrep(1);
  const ps1 = h.ps('p_1');
  const id = chessOfTier(1, (c) => c.position === 'MELEE').find((x) => m.pool.has(x));
  const unit = give(m, ps1, id, 'board', [...ps1.deployMap()].find(([, v]) => v === 'melee')[0].split(',').map(Number));
  h.drive(() => m.phase === PHASE.UNITE);
  const f = fields(h)[0];
  assert.equal(f.fieldId, 'u');
  assert.deepEqual(f.players, ['p_1', 'p_2']);
  assert.equal(f.authority, 'p_1');
  const carried = f.spec.players[0].units.find((u) => u.uid === unit.uid);
  const reported = m.lastResults.get('p_1').unitsEnd.find((u) => u.uid === unit.uid);
  assert.deepEqual(carried.carryState, { hpPct: reported.hpPct, sp: reported.sp });
  const got = h.sent.filter(([, x]) => x.t === 'b.start' && x.fieldId === 'u').map(([pid, x]) => `${pid}:${x.authoritative ? 'A' : x.watch ? 'w' : 'r'}`).sort();
  assert.deepEqual(got, ['p_0:w', 'p_1:A', 'p_2:r']);
  h.drive(() => m.phase === PHASE.SETTLE);
  assert.ok(f.result && f.resultSource === 'client');
  m.dispose();
});

test('SP_VERIFY=all: an accepted but wrong client result is replaced by the server simulation', () => {
  // an empty board leaks everything; the client claims perfect rounds (valid shape, within every bound)
  const tamper = (r) => { for (const p of Object.values(r.perPlayer)) { p.leaked = []; p.perfect = true; p.killed = p.total; } return r; };
  const run = (verify) => {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 9112, captureFrames: false, clientCombat: true, verify, perPlayer: { p_0: { tamper } } });
    const m = h.m;
    m.start();
    h.drive(() => h.ended != null || ((m.phase === PHASE.UNITE || m.phase === PHASE.SETTLE) && m.round === 1), { band: 'band_bldsk' });
    const s = { ...m.verifyStats, leaks: m.lastResults.get('p_0').leaked.length };
    m.dispose();
    return s;
  };
  const off = run('off');
  const all = run('all');
  assert.equal(off.checked, 0);
  assert.equal(all.checked, 1, 'the result was re-simulated before it was accepted');
  assert.equal(all.mismatches, 1, 'the forged perfect round is caught');
  assert.equal(off.leaks, 0, 'without verification the forged result stands');
  assert.ok(all.leaks > 0, `the server's leaks count (${all.leaks})`);
});

test('LocalBossPool (client) and CreditPool (server takeover) keep the shared pool consistent', () => {
  const lp = new LocalBossPool(1000, 800);
  assert.equal(lp.hp, 800);
  assert.equal(lp.damage('a', 300), 300);
  assert.equal(lp.hp, 500);
  lp.sync(450, 300); // server counted our 300 and another field's 50
  assert.equal(lp.hp, 450);
  assert.equal(lp.damage('a', 1000), 450);
  assert.equal(lp.hp, 0);
  assert.equal(lp.cum, 750);
  const pool = new SharedBossPool(1000);
  pool.damage('a', 300);
  const cp = new CreditPool(pool, { acked: 300 });
  assert.equal(cp.damage('a', 200), 0, 'replayed damage is not counted twice');
  assert.equal(pool.hp, 700);
  assert.equal(cp.damage('a', 150), 50);
  assert.equal(pool.hp, 650);
  assert.equal(cp.hp, 650);
});

test('full co-op match with client-side combat and the real sim reaches RESULT with zero errors (humans on AI 托管)', () => {
  for (const [humans, bots, seed, pace] of [[2, 1, 9113, 'instant'], [4, 0, 9114, 'paced'], [1, 2, 9115, 'instant']]) {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans, bots, seed, captureFrames: false, checkFrames: true, clientCombat: true, pace });
    h.autoHumans();
    const m = h.m;
    let last = '';
    m.start();
    h.run(() => {
      const k = `${m.phase}:${m.round}`;
      if (k !== last) { last = k; checkInvariants(m); if (m.phase === PHASE.PREP && m.round === 1) for (const ps of m.players.values()) ps.lp = 300; }
      return h.ended != null;
    }, { maxSteps: 6e6 });
    assert.ok(h.ended, `${humans}+${bots}: ended (${m.phase} R${m.round})`);
    assert.equal(m.errorCount, 0, JSON.stringify(m.errors.slice(0, 2)));
    assert.deepEqual(h.logs.error.filter((l) => !l.startsWith('[sim]')), []);
    assert.deepEqual(h.badFrames, []);
    assert.equal(m.verifyStats.rejected, 0, 'honest clients are never rejected');
    assert.equal(m.verifyStats.takeovers, 0);
    assert.equal(h.sent.filter(([, x]) => x.t === 'b.snap' || x.t === 'b.ev').length, 0);
    for (const c of h.clients.values()) assert.ok(c.log.some((x) => x.t === 'b.result'), 'every human reported results');
    m.dispose();
  }
});

test('fuzz: random / hostile b.progress and b.result frames never throw, never corrupt, never end a field early', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 1, seed: 9116, captureFrames: false, clientCombat: true, clients: false });
  h.autoHumans();
  const m = h.m;
  m.start();
  h.run(() => m.phase === PHASE.COMBAT);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const f0 = fields(h).find((f) => f.fieldId === 'n:p_0');
  const junk = () => pick([undefined, null, -1, 1e20, NaN, 'x', {}, [], 3, 0.5, true]);
  let accepted = 0;
  for (let i = 0; i < 3000; i++) {
    const battleId = pick([f0.battleId, 'nope', junk()]);
    const msg = rnd() < 0.5
      ? { t: 'b.progress', battleId, gt: pick([1, 5, junk()]), killed: pick([0, 3, junk()]), total: pick([10, junk()]), leaks: pick([0, 2, junk()]), bossDmg: pick([undefined, 5, junk()]), by: pick([undefined, { p_0: 3 }, junk()]) }
      : { t: 'b.result', battleId, result: pick([junk(), { reason: 'cleared', time: 3, perPlayer: { p_0: { killed: 1, total: pick([1, 0, junk()]), leaked: pick([[], [{ enemyKey: 'enemy_x' }], junk()]), perfect: pick([true, false, junk()]), layerGains: pick([{}, { yanShip: 999 }, junk()]), unitsEnd: [] } } }]) };
    for (const k of Object.keys(msg)) if (msg[k] === undefined) delete msg[k];
    if (validateC2S(msg) != null) continue; // the platform drops what the protocol validator refuses
    accepted++;
    assert.doesNotThrow(() => m.handle(pick(['p_0', 'p_1']), msg));
  }
  assert.ok(accepted > 100, `fuzz frames reached the match (${accepted})`);
  assert.equal(m.errorCount, 0, JSON.stringify(m.errors.slice(0, 2)));
  assert.ok(f0.progress.killed <= f0.progress.total);
  // a structurally valid but implausible result for p_0's field was replaced by the server's run, never trusted
  if (f0.done) assert.equal(f0.resultSource, 'server');
  checkInvariants(m);
  m.dispose();
});

// ---- boss-field report plausibility (a modified authority client) -------------------------------------------------

function faWithForger(seed) {
  // p_0 is the authority of b1 but "modified": its SimClient is muted and the test sends its frames by hand
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 2, seed, fake: true, clientCombat: true, instant: false,
    perPlayer: { p_0: { mute: true } }, script: (b) => (b.kind === 'boss' ? { bossDps: 0 } : { duration: 2 }) }).start();
  h.autoHumans();
  h.drive(() => h.m.phase === PHASE.FINAL_ASSAULT);
  const f = fields(h)[0];
  assert.equal(f.authority, 'p_0');
  return { h, m: h.m, f };
}

test('Final Assault: a forged b.progress (bossDmg 1e13, leaks 1e6) is credited only up to the field clock\'s budget — one frame never empties the pool or the team LP', () => {
  const { h, m, f } = faWithForger(9120);
  const max = m.bossPool.maxHp;
  const lp0 = m.teamLp;
  h.sched.advance(500); // 1 game s on the field clock
  const gt = m._fieldElapsed(f);
  assert.deepEqual(m.handle('p_0', { t: 'b.progress', battleId: f.battleId, gt: 1, killed: 0, total: 0, bossDmg: 1e13, by: { p_0: 1e13 }, leaks: 1e6 }), { ok: true });
  assert.ok(max - m.bossPool.hp <= (max * gt) / 5 + 1, `≤ the whole pool per 5 game s (${max - m.bossPool.hp} of ${max})`);
  assert.ok(m.bossPool.hp > 0.7 * max);
  assert.ok(lp0 - m.teamLp <= 10 + gt + 1e-9, `≤ 10 + 1 LP per game s (${lp0} → ${m.teamLp})`);
  assert.ok(m.teamLp > 0);
  assert.equal(m._finalEnding, null, 'the fight goes on');
  assert.ok(!h.bc.some((x) => x.t === 'b.end'));
  // the held-back part is credited as the clock advances, at the bounded rate (nothing reported is lost)
  h.sched.advance(1000);
  const gt2 = m._fieldElapsed(f);
  assert.ok(max - m.bossPool.hp <= (max * gt2) / 5 + 1 && max - m.bossPool.hp > (max * gt) / 5, 'more credited, still bounded');
  assert.ok(lp0 - m.teamLp <= 10 + gt2 + 1e-9);
  assert.equal(f.bossAcked, max - m.bossPool.hp, 'b.pool acked = what was credited');
  m.dispose();
});

test('Final Assault: an early boss b.result (forced at t≈0) does not end the pair\'s fight — the partner takes the field over and the sender is never its authority again', () => {
  const { h, m, f } = faWithForger(9121);
  h.sched.advance(500);
  const res = { reason: 'forced', time: 1, killed: 0, total: 0, errors: 0,
    perPlayer: Object.fromEntries(f.players.map((pid) => [pid, { killed: 0, total: 0, leaked: [], perfect: true, layerGains: {}, coins: 0, damageDealt: 0, bossDamage: 0, healingDone: 0, deaths: 0, unitsEnd: [], unitStats: [] }])) };
  assert.equal(isBattleResult(res), true);
  assert.deepEqual(m.handle('p_0', { t: 'b.result', battleId: f.battleId, result: res }), { ok: true });
  assert.equal(f.done, false, 'the field keeps running');
  assert.equal(m.phase, PHASE.FINAL_ASSAULT);
  assert.equal(f.authority, 'p_1', 'the partner\'s replica is promoted');
  assert.equal(h.lastTo('p_1', 'b.start').authoritative, true);
  assert.equal(h.lastTo('p_0', 'b.end').reason, 'takeover');
  assert.ok(m.verifyStats.rejected >= 1);
  // the demoted client never gets the field back: the partner leaving hands it to the server
  m.onDisconnect('p_1');
  assert.equal(f.mode, 'server');
  assert.equal(f.authority, null);
  m.dispose();
});

test('Final Assault: a 999-layer kill faster than the budget — the \'cleared\' b.result whose report covers the pool waits for the budget, no takeover (QA 6b)', () => {
  const { h, m, f } = faWithForger(9122);
  const max = m.bossPool.maxHp;
  h.sched.advance(500); // 1 game s on the field clock: the budget credits ≤ 20 % of the pool
  const gt = m._fieldElapsed(f);
  const by = { [f.players[0]]: max * 0.6, [f.players[1]]: max * 0.4 + 5 };
  assert.deepEqual(m.handle('p_0', { t: 'b.progress', battleId: f.battleId, gt, killed: 0, total: 0, bossDmg: max + 5, by, leaks: 0 }), { ok: true });
  const res = { reason: 'cleared', time: gt, killed: 0, total: 0, errors: 0,
    perPlayer: Object.fromEntries(f.players.map((pid) => [pid, { killed: 0, total: 0, leaked: [], perfect: true, layerGains: {}, coins: 0, damageDealt: by[pid], bossDamage: by[pid], healingDone: 0, deaths: 0, unitsEnd: [], unitStats: [] }])) };
  assert.equal(isBattleResult(res), true);
  const rejected0 = m.verifyStats.rejected;
  const takeovers0 = m.verifyStats.takeovers; // the muted client's earlier normal fields went to the server
  assert.deepEqual(m.handle('p_0', { t: 'b.result', battleId: f.battleId, result: res }), { ok: true });
  assert.ok(m.bossPool.hp > 0.7 * max, 'still only the budget is credited');
  assert.equal(f.done, false, 'the field waits for the budget');
  assert.equal(f.authority, 'p_0', 'no takeover');
  assert.equal(f.mode, 'client');
  assert.equal(m.verifyStats.rejected, rejected0, 'not counted as rejected');
  assert.ok(!h.sent.some(([pid, x]) => pid === 'p_0' && x.t === 'b.end' && x.battleId === f.battleId), 'the sender is not told to stop');
  assert.equal(m._finalEnding, null);
  // a re-sent copy of the result changes nothing; the silence watchdog never hands the waiting field over
  assert.deepEqual(m.handle('p_0', { t: 'b.result', battleId: f.battleId, result: res }), { ok: true });
  h.drive(() => m._finalEnding != null || m.phase !== PHASE.FINAL_ASSAULT, { maxSteps: 2e5 });
  assert.equal(m._finalEnding, 'cleared', 'the budget credited the report: the pool is empty → victory');
  assert.equal(m.bossPool ? m.bossPool.hp : 0, 0);
  assert.ok(m._fieldElapsed(f) <= 5 * (max + 5) / max + 1, 'within the budget\'s 5 game s');
  assert.equal(f.done, true);
  assert.equal(f.resultSource, 'client', 'the held client result completed the field');
  assert.equal(m.verifyStats.takeovers, takeovers0);
  assert.equal(m.verifyStats.rejected, rejected0);
  for (const pid of f.players) assert.ok(Math.abs((f.bossBy[pid] || 0) - Math.min(by[pid], max)) <= max * 1e-9 + 5, `${pid} credited as reported (${f.bossBy[pid]} vs ${by[pid]})`);
  m.dispose();
});

test('Final Assault: a \'cleared\' b.result whose report does NOT cover the pool is still handed over (the partner takes the field)', () => {
  const { h, m, f } = faWithForger(9123);
  const max = m.bossPool.maxHp;
  h.sched.advance(500);
  const res = { reason: 'cleared', time: 1, killed: 0, total: 0, errors: 0,
    perPlayer: Object.fromEntries(f.players.map((pid) => [pid, { killed: 0, total: 0, leaked: [], perfect: true, layerGains: {}, coins: 0, damageDealt: 0, bossDamage: pid === 'p_0' ? max * 0.3 : 0, healingDone: 0, deaths: 0, unitsEnd: [], unitStats: [] }])) };
  assert.deepEqual(m.handle('p_0', { t: 'b.result', battleId: f.battleId, result: res }), { ok: true });
  assert.equal(f.heldResult, null);
  assert.equal(f.authority, 'p_1', 'the partner\'s replica is promoted');
  assert.equal(h.lastTo('p_0', 'b.end').reason, 'takeover');
  assert.ok(m.verifyStats.rejected >= 1);
  m.dispose();
});

test('Final Assault run on the server (nobody connected at its start): a human who reconnects gets b.pool with the field\'s own damage acknowledged', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 2, seed: 9110, fake: true, clientCombat: true, instant: false,
    script: (b) => (b.kind === 'boss' ? { bossDps: 3000 } : { duration: 2 }) }).start();
  const m = h.m;
  h.autoHumans();
  h.drive(() => m.phase === PHASE.PREP && m.round === m.gd.bossRound);
  m.onDisconnect('p_0');
  m.onDisconnect('p_1');
  h.run(() => m.phase === PHASE.FINAL_ASSAULT);
  h.sched.advance(2000);
  const f = fields(h)[0];
  assert.equal(f.mode, 'server');
  const n0 = h.bc.filter((x) => x.t === 'b.pool').length;
  m.onReconnect('p_0');
  assert.equal(h.lastTo('p_0', 'b.start').authoritative, false, 'a display replica');
  h.sched.advance(3000);
  const pools = h.bc.slice().filter((x) => x.t === 'b.pool').slice(n0);
  assert.ok(pools.length >= 8, `b.pool keeps the replica in sync (${pools.length} frames in 3 s)`);
  const last = pools[pools.length - 1];
  assert.ok(Math.abs(last.hp - m.bossPool.hp) < 1e-6 || last.hp > m.bossPool.hp, 'the server pool');
  assert.ok(last.acked[f.fieldId] > 0, 'the server run\'s own damage is acknowledged (the replica does not count it twice)');
  const dealt = m.bossPool.maxHp - last.hp;
  assert.ok(Math.abs(Object.values(last.acked).reduce((a, b) => a + b, 0) - dealt) <= 3000 * 2, 'Σ acked ≈ the pool damage');
  m.dispose();
});
