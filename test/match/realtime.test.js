// Real-time co-op over websockets with the REAL simulation: the production server + lobby + Match (RealScheduler,
// real Battle, client-side combat — DESIGN §14), two scripted human clients (test/helpers/wsClient.js) that simulate
// their own battles from the b.start specs (test/match/simClient.js, the same sim the browser runs) and report
// b.progress / b.result, and two AI teammates whose fields the server simulates, from the room to the prep of round 4.
// Phase timers are scaled down and combat runs at 40× instead of 2× so the test takes seconds; everything else
// (throttled views, drafts, 联防, settlement, observing a teammate after the own battle) is the real path.
// Clients act only on what the server tells them (m.public / m.private / b.start), like the browser UI.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../../server/index.js';
import { Match } from '../../server/match/Match.js';
import { collectViolations } from '../../server/match/invariants.js';
import { TestClient } from '../helpers/wsClient.js';
import { attachWsSimClient } from './simClient.js';
import { DataSource } from '../../server/sim/simdata.js';
import { getData } from '../../server/data.js';

const DS = new DataSource(getData({ log: { warn() {}, error() {}, info() {} } }), null);

class RealtimeMatch extends Match {
  constructor(o) { super({ ...o, timerScale: 0.1, combatSpeed: 40 }); RealtimeMatch.last = this; }
}

const errors = [];
const log = { info() {}, warn() {}, debug() {}, error: (...a) => errors.push(a.map(String).join(' ')) };
let srv = null;
const clients = [];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

after(async () => {
  for (const c of clients) await c.terminate().catch(() => {});
  if (srv) await srv.close();
});

async function player(name) {
  const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
  clients.push(c);
  const w = await c.hello(name);
  c.id = w.playerId;
  c.sim = attachWsSimClient(c, { ds: DS, pace: 'instant', speed: 40 });
  return c;
}

const latest = (c, type) => { for (let i = c.log.length - 1; i >= 0; i--) if (c.log[i].t === type) return c.log[i]; return null; };

/** Candidate board tiles in the own region (the server answers BAD_TILE for illegal ones). */
const TILES = [];
for (let r = 12; r >= 9; r--) for (let c = 2; c <= 10; c++) TILES.push([r, c]);

/**
 * A scripted human: confirms the briefing, drafts a band on its turn (passing it once when not last), picks the first free
 * 机变 card, and in every prep buys what it can afford, places chess on legal tiles, clears the temp slots and readies.
 * During combat it watches a teammate's field. Stops when `until()` holds.
 */
let abort = false;
async function drive(c, opts) {
  try { await driveLoop(c, opts); } catch (e) { abort = true; throw e; }
}

async function driveLoop(c, { skipOnce = false, until, stats }) {
  const done = new Set();
  let skipped = !skipOnce;
  const deadlineAt = Date.now() + 90_000;
  while (!abort && !until() && Date.now() < deadlineAt) {
    await delay(20);
    const pub = latest(c, 'm.public');
    const priv = latest(c, 'm.private');
    if (!pub) continue;
    const me = pub.players.find((p) => p.playerId === c.id);
    if (pub.phase === 'INFO_CHECK' && !done.has('info')) {
      done.add('info');
      assert.equal((await c.request({ t: 'g.infoReady' })).t, 'ok');
    } else if (pub.phase === 'BAND_DRAFT' && pub.draft && pub.draft.turn === c.id) {
      const key = `band:${pub.draft.order.join()}`;
      if (done.has(key)) continue;
      done.add(key);
      const last = pub.draft.order.indexOf(c.id) === pub.draft.order.length - 1;
      if (!skipped && !last) {
        skipped = true;
        const r = await c.request({ t: 'g.bandSkip' });
        // a slow client may lose its (scaled) turn to the timer before the skip arrives
        if (r.t === 'ok') stats.skips++;
        else assert.ok(['NOT_YOUR_TURN', 'ALREADY'].includes(r.code), `bandSkip: ${JSON.stringify(r)}`);
        stats.skipTries++;
      } else {
        const r = await c.request({ t: 'g.band', bandId: 'band_bldsk' });
        if (r.t === 'ok') stats.bands++;
        else stats.bandTimeouts++;
      }
    } else if (pub.phase === 'SP_DRAFT' && pub.sp && pub.sp.turn === c.id) {
      const key = `sp:${pub.round}`;
      if (done.has(key)) continue;
      done.add(key);
      const card = pub.sp.cards.find((x) => pub.sp.taken[x.idx] == null);
      const r = await c.request({ t: 'g.choice', idx: card.idx });
      assert.equal(r.t, 'ok', `g.choice: ${JSON.stringify(r)}`);
      stats.cards++;
    } else if (pub.phase === 'PREP' && me && me.alive && priv && !priv.ready && !done.has(`prep:${pub.round}`)) {
      done.add(`prep:${pub.round}`);
      await prep(c, stats);
    } else if (pub.phase === 'COMBAT' && !done.has(`watch:${pub.round}`)) {
      // research 09 §3.1: a teammate's battle can be observed only after the own battle is over
      const own = pub.fields.find((f) => f.players.includes(c.id));
      const other = pub.fields.find((f) => f.kind === 'normal' && !f.players.includes(c.id) && f.live);
      if (!other) continue;
      if (own && own.live) {
        if (!done.has(`early:${pub.round}`)) {
          done.add(`early:${pub.round}`);
          const r = await c.request({ t: 'g.watch', fieldId: other.fieldId });
          if (r.t === 'error') { assert.equal(r.code, 'WRONG_PHASE'); stats.refused++; }
        }
        continue;
      }
      done.add(`watch:${pub.round}`);
      const r = await c.request({ t: 'g.watch', fieldId: other.fieldId });
      if (r.t === 'ok') stats.watches.push(other.fieldId);
    }
  }
}

async function prep(c, stats) {
  const priv = () => latest(c, 'm.private');
  // reward offer first (free)
  if (priv().shop.rewardOffer) await c.request({ t: 'g.reward', idx: 0 });
  // buy what is affordable (chess first)
  for (let guard = 0; guard < 8; guard++) {
    const p = priv();
    const i = p.shop.slots.findIndex((s) => s && !s.sold && s.kind === 'chess' && s.price <= p.funds);
    if (i < 0 || p.hand.every(Boolean)) break;
    const r = await c.request({ t: 'g.buy', slot: i });
    if (r.t !== 'ok') break;
    stats.buys++;
    await c.waitFor('m.private', (x) => x.shop.slots[i] && x.shop.slots[i].sold, 2000).catch(() => null);
  }
  // place hand chess on the board
  for (let guard = 0; guard < 10; guard++) {
    const p = priv();
    if (p.deployCount >= p.deployCap) break;
    const piece = [...p.hand, ...p.temp].find((x) => x && x.kind === 'chess');
    if (!piece) break;
    const taken = new Set(p.board.map((b) => `${b.row},${b.col}`));
    let placed = false;
    for (const [r, col] of TILES) {
      if (taken.has(`${r},${col}`)) continue;
      const move = () => c.request({ t: 'g.move', uid: piece.uid, to: { area: 'board', row: r, col } });
      let res = await move();
      // walking the whole tile list for a piece with few legal tiles can drain the socket's token bucket (40 msg/s):
      // like the real client, wait and send the same move again
      for (let k = 0; k < 5 && res.t === 'error' && res.code === 'RATE'; k++) { await delay(250); res = await move(); }
      if (res.t === 'ok') { placed = true; stats.placed++; break; }
      assert.equal(res.code, 'BAD_TILE', `g.move: ${JSON.stringify(res)}`);
    }
    if (!placed) break;
    await c.waitFor('m.private', (x) => x.board.some((b) => b.uid === piece.uid), 2000).catch(() => null);
  }
  // temp slots block Ready: sell chess / destroy items / place tokens
  for (const t of priv().temp) {
    if (!t) continue;
    if (t.kind === 'chess') await c.request({ t: 'g.sell', uid: t.uid });
    else if (t.kind === 'item') await c.request({ t: 'g.destroy', uid: t.uid });
  }
  const r = await c.request({ t: 'g.ready', ready: true });
  if (r.t === 'ok') stats.readies++;
}

test('real-time co-op over websockets with the real simulation: 2 humans + 2 AI from the room to the prep of round 4', { timeout: 120_000 }, async () => {
  srv = await startServer({ port: 0, host: '127.0.0.1', log, MatchClass: RealtimeMatch, seedFn: () => 20260928 });
  const a = await player('Alpha');
  const b = await player('Bravo');
  assert.equal((await a.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' })).t, 'ok');
  const st = await a.waitFor('room.state');
  assert.equal((await b.request({ t: 'room.join', code: st.code })).t, 'ok');
  assert.equal((await a.request({ t: 'room.addBot' })).t, 'ok');
  assert.equal((await a.request({ t: 'room.addBot' })).t, 'ok');
  assert.equal((await b.request({ t: 'room.ready', ready: true })).t, 'ok');
  assert.equal((await a.request({ t: 'room.start' })).t, 'ok');

  const reached = (c) => { const p = latest(c, 'm.public'); return !!p && ((p.phase === 'PREP' && p.round >= 4) || p.phase === 'RESULT' || p.round > 4); };
  const stats = { a: { skips: 0, skipTries: 0, bands: 0, bandTimeouts: 0, cards: 0, buys: 0, placed: 0, readies: 0, watches: [], refused: 0 }, b: { skips: 0, skipTries: 0, bands: 0, bandTimeouts: 0, cards: 0, buys: 0, placed: 0, readies: 0, watches: [], refused: 0 } };
  // snapshot of the prep → combat transitions the clients saw
  await Promise.all([
    drive(a, { skipOnce: true, until: () => reached(a), stats: stats.a }),
    drive(b, { skipOnce: true, until: () => reached(b), stats: stats.b }),
  ]);
  const m = RealtimeMatch.last;
  assert.ok(m, 'the lobby built the match');
  for (const c of [a, b]) {
    const pub = latest(c, 'm.public');
    assert.ok(pub.round >= 4, `${c.id} reached round ${pub.round} (${pub.phase})`);
  }
  assert.deepEqual(collectViolations(m), [], 'engine invariants hold in the live match');
  assert.equal(m.errorCount, 0, `match errors: ${JSON.stringify(m.errors.slice(0, 3))}`);
  assert.equal(m.dispatcher.errors, 0, 'meta handler errors');
  assert.deepEqual(errors, [], 'no server errors logged');

  assert.ok(stats.a.skipTries + stats.b.skipTries >= 1, 'a human tried to pass its band-draft turn (g.bandSkip)');
  for (const [c, s] of [[a, stats.a], [b, stats.b]]) {
    assert.equal(s.bands + s.bandTimeouts, 1, `${c.id} drafted a band (or its turn timed out → 华法琳)`);
    assert.ok(s.buys >= 3 && s.placed >= 3 && s.readies >= 3, `${c.id} played its preps: ${JSON.stringify(s)}`);
    // the SP round (NORMAL R3) gave every alive player a card
    assert.equal(s.cards, 1, `${c.id} picked one 机变 card`);
    const pubs = c.log.filter((x) => x.t === 'm.public');
    const phases = new Set(pubs.map((x) => x.phase));
    // (sub-100 ms presentation phases at this timer scale may fall between two throttled m.public frames)
    for (const ph of ['INFO_CHECK', 'BAND_DRAFT', 'SP_DRAFT', 'PREP', 'COMBAT']) assert.ok(phases.has(ph), `${c.id} saw ${ph}`);
    // m.public: throttled to ≤ 10/s (a 100 ms gap, small timer jitter tolerated)
    for (let i = 1; i < pubs.length; i++) assert.ok(pubs[i].serverNow - pubs[i - 1].serverNow >= 95, `m.public ${pubs[i].serverNow - pubs[i - 1].serverNow} ms apart`);
    const priv = latest(c, 'm.private');
    assert.equal(priv.hand.length, 10);
    assert.equal(priv.temp.length, 5);
    assert.ok(priv.board.length >= 1 || !priv.alive);
    // client-side combat: no combat streaming; the own spec every round (authoritative), results reported
    assert.equal(c.log.filter((x) => x.t === 'b.snap' || x.t === 'b.ev').length, 0, 'no b.snap / b.ev');
    const starts = c.log.filter((x) => x.t === 'b.start');
    const own = starts.filter((x) => x.fieldId === `n:${c.id}` && x.authoritative);
    assert.ok(own.length >= 3, `${c.id} got its own spec every round (${own.length})`);
    for (const st of own) {
      assert.equal(st.spec.kind, 'normal');
      assert.equal(st.speed, 40);
      assert.ok(c.sim.log.some((x) => x.t === 'b.result' && x.battleId === st.battleId), `${c.id} reported ${st.battleId}`);
    }
    assert.ok(c.sim.log.filter((x) => x.t === 'b.progress').length >= own.length);
    // observing a teammate after the own battle: the watched field's spec arrives as a display replica
    for (const fid of s.watches) assert.ok(starts.some((x) => x.fieldId === fid && x.watch && !x.authoritative), `${c.id} watched ${fid}`);
    assert.ok(!c.sim.error, `${c.id} client sim error: ${c.sim.error}`);
    const res = c.log.filter((x) => (x.t === 'error') && x.code === 'INTERNAL');
    assert.deepEqual(res, [], 'no INTERNAL errors');
  }
  assert.equal(m.verifyStats.rejected, 0, 'honest clients are never rejected');
  assert.equal(m.verifyStats.takeovers, 0, 'no takeovers');
  assert.ok(stats.a.watches.length + stats.b.watches.length >= 1, 'a human observed a teammate after its own battle');
  // the AI teammates played too (bought, placed, readied every prep)
  for (const ps of m.order.filter((p) => p.isBot && p.alive)) assert.ok(ps.deployCount >= 3, `${ps.playerId} deployed ${ps.deployCount}`);

  // both humans leave: the match ends as abandoned exactly once and the room returns to the lobby
  assert.equal((await a.request({ t: 'g.leave' })).t, 'ok');
  assert.equal((await b.request({ t: 'g.leave' })).t, 'ok');
  await delay(50);
  assert.equal(m.ended, true);
  assert.equal(m.outcome.reason, 'abandoned');
  assert.deepEqual(errors, []);
});
