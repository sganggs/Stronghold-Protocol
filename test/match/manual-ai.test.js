import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { makeMatch } from './harness.js';
import { externalConfig } from '../../server/match/externalConfig.js';
import { StdioAI } from '../../server/ai/transport.js';
import { actionReply, writeJSON, readJSON } from '../../tools/ai/manual-files.mjs';

const pending = m => [...m.externalAI.jobs.values()][0];
const seats = Array.from({ length: 4 }, (_, seat) => ({ seat, playerId: `manual_${seat}`, name: `Seat ${seat}`, isBot: true, connected: true }));
function temp(t) { const dir = mkdtempSync(path.join(os.tmpdir(), 'sp-manual-test-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
async function until(fn) {
  for (let i = 0; i < 2000; i++) { const v = fn(); if (v) return v; await delay(10); }
  throw new Error('Timed out waiting for manual files');
}

test('manual solo stays pending beyond 300000 ms; a co-op seat gets the whole turn and its timeout is the human one, never the bot', t => {
  assert.equal(externalConfig(undefined, { SP_EXTERNAL_AI_TRANSPORT: 'stdio', SP_EXTERNAL_AI_COMMAND: '["node","a"]', SP_EXTERNAL_AI_MANUAL_WAIT: '1' }).manualWait, true);
  for (const mode of ['solo', 'coop']) {
    const h = makeMatch({ mode, fake: true, seats: seats.slice(0, mode === 'solo' ? 1 : 4), botStrategy: 'external', externalReplay: true,
      externalAI: { manualWait: true, timeoutMs: 300000 } });
    t.after(() => h.m.dispose());
    h.start(); h.run(() => !!pending(h.m));
    const j = pending(h.m), ps = j.ps;
    if (mode === 'solo') {
      assert.equal(j.deadline, 0); assert.equal(j.timer, null); assert.equal(j.wallTimer, undefined);
      h.sched.advance(600001);
      assert.equal(pending(h.m), j);
      h.m.externalReply(j.id, { v: 'sp-ai/1', id: j.id, intents: [{ t: 'g.band', bandId: 'band_bldsk' }], done: false }, false);
      assert.equal(ps.bandId, 'band_bldsk');
    } else {
      assert.equal(j.deadline, h.m.deadline, 'no half of the turn is kept for the built-in bot');
      const original = h.m.externalAI.request.bind(h.m.externalAI), observed = [];
      h.m.externalAI.request = job => { if (job.ps === ps) observed.push(structuredClone(job.state.results)); original(job); };
      // the seat only highlights a strategy; the expired turn then takes the human timeout pick (the highlighted one)
      const focus = [...h.m.gd.bandIds()].reverse().find(id => h.m.gd.bandAllowed(id) && !h.m.bandTaken(id, ps.playerId));
      h.m.externalReply(j.id, { v: 'sp-ai/1', id: j.id, intents: [{ t: 'g.bandFocus', bandId: focus }], done: false }, false);
      const again = pending(h.m);
      assert.equal(again.ps, ps);
      h.sched.advance(again.deadline - h.sched.now());
      assert.equal(ps.bandId, focus, 'the human timeout pick, not a bot pick');
      assert.equal(h.m.externalAI.metrics.fallbacks, 0);
      h.run(() => observed.length > 1);
      assert.ok(observed.flat().some(r => r.error === 'TIMEOUT' && r.fallback === false && /as for a human/.test(r.detail)));
    }
  }
});

test('a silent manual co-op seat keeps its own board through the prep timer; a broken reply is asked again, never handed to the bot', t => {
  const h = makeMatch({ mode: 'coop', fake: true, seats, botStrategy: 'external', externalReplay: true, externalAI: { manualWait: true, timeoutMs: 300000 } });
  t.after(() => h.m.dispose());
  h.start();
  for (let i = 0; i < 40 && !(h.m.phase === 'PREP' && pending(h.m)?.kind === 'prep'); i++) { // loop-cap: drafts time out
    h.run(() => !!pending(h.m) || h.m.phase === 'PREP');
    const j = pending(h.m);
    if (!j || j.kind !== 'prep') h.sched.advance(j ? Math.max(1, j.deadline - h.sched.now()) : 1000);
  }
  const ps = h.m.order[0], j = [...h.m.externalAI.jobs.values()].find(x => x.ps === ps);
  assert.equal(j.deadline, h.m.deadline, 'the whole prep');
  const before = { gold: ps.stats.gold, board: ps.board.size, hand: ps.hand.filter(Boolean).length };
  const first = j.id, seen = [], original = h.m.externalAI.request.bind(h.m.externalAI);
  h.m.externalAI.request = job => { if (job.ps === ps) seen.push(...job.state.results); original(job); };
  h.m.externalReply(first, { v: 'sp-ai/1', id: first, intents: [], done: false }, false); // invalid: no intents and not done
  const again = [...h.m.externalAI.jobs.values()].find(x => x.ps === ps);
  assert.ok(again && again.id !== first, 'asked again');
  assert.ok(seen.some(r => r.error === 'EXTERNAL_ERROR' && r.fallback === false && /asking again/.test(r.detail)));
  const round = h.m.round;
  h.sched.advance(h.m.deadline - h.sched.now());
  assert.ok(h.m.round > round || h.m.phase !== 'PREP', 'the prep timer ended the prep');
  assert.deepEqual({ gold: ps.stats.gold, board: ps.board.size, hand: ps.hand.filter(Boolean).length }, before, 'no bot purchases or placements');
  assert.equal(h.m.externalAI.metrics.fallbacks, 0);
  assert.equal(h.m.externalAI.states.get(ps.playerId).disabled, false);
});

test('an untimed manual window never dead-ends: three broken replies let the bot finish only that decision, a used-up budget asks again', t => {
  const h = makeMatch({ mode: 'solo', fake: true, seats: seats.slice(0, 1), botStrategy: 'external', externalReplay: true,
    externalAI: { manualWait: true, timeoutMs: 300000, failureLimit: 3, maxIntents: 2 } });
  t.after(() => h.m.dispose());
  h.start(); h.run(() => !!pending(h.m));
  const ps = h.m.order[0], state = () => h.m.externalAI.states.get(ps.playerId);
  for (let i = 0; i < 3; i++) { const j = pending(h.m); assert.equal(j.deadline, 0); h.m.externalReply(j.id, null, true); }
  assert.ok(ps.bandId, 'the built-in bot finished this one untimed decision');
  assert.equal(state().disabled, false);
  assert.ok(state().results.some(r => r.fallback === true && /finished this untimed decision \(the seat stays manual\)/.test(r.detail)));
  assert.ok(h.run(() => pending(h.m)?.kind === 'prep'), 'the next decision is the seat\'s again');
  const j = pending(h.m), first = j.id;
  h.m.externalReply(first, { v: 'sp-ai/1', id: first, intents: [{ t: 'g.freeze' }, { t: 'g.freeze' }], done: false }, false);
  const again = pending(h.m);
  assert.ok(again && again.id !== first && again.used === 0, 'a fresh observation with a new intent budget');
  assert.equal(ps.ready, false);
  h.sched.advance(600000);
  assert.equal(pending(h.m), again, 'still waiting for the seat');
});

test('a lone human\'s co-op has untimed windows: its manual teammate is not timed out either', t => {
  const h = makeMatch({ mode: 'coop', fake: true, botStrategy: 'external', externalReplay: true, externalAI: { manualWait: true, timeoutMs: 5000 },
    seats: [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true }, { seat: 1, playerId: 'manual_1', name: 'M1', isBot: true, connected: true }] });
  t.after(() => h.m.dispose());
  h.start();
  assert.ok(h.drive(() => pending(h.m)?.ps.playerId === 'manual_1'));
  const j = pending(h.m);
  assert.deepEqual([h.m.deadline, j.deadline, j.timer], [0, 0, null]);
  h.sched.advance(600000);
  assert.equal(pending(h.m), j);
  assert.equal(h.m.externalAI.metrics.fallbacks, 0);
});

test('stdio zero request timeout remains cancellable; ordinary requests still time out', async t => {
  const c = new StdioAI({ command: [process.execPath, '-e', 'process.stdin.resume()'], timeoutMs: 30, maxBytes: 65536, backoffMs: 1 });
  t.after(() => c.close());
  const ac = new AbortController();
  let finished = false;
  const waiting = c.request({ id: 'manual' }, ac.signal, { timeoutMs: 0 });
  void waiting.then(() => { finished = true; }, () => { finished = true; });
  await delay(100); assert.equal(finished, false);
  ac.abort(); await assert.rejects(waiting);
  await assert.rejects(c.request({ id: 'ordinary' }, new AbortController().signal));
});

test('scripted file player completes a real solo ABYSS match, shows validator rejections and reconciles report', { timeout: 60000 }, async t => {
  const dir = temp(t);
  const launcher = spawn(process.execPath, ['tools/ai/manual-match.mjs', '--dir', dir, '--mode', 'solo', '--difficulty', 'ABYSS', '--seed', '1'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const player = spawn(process.execPath, ['test/fixtures/manual-player.mjs', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { launcher.kill('SIGKILL'); player.kill('SIGKILL'); });
  let errors = ''; launcher.stderr.on('data', s => { errors += s; }); player.stderr.on('data', s => { errors += s; });
  const [end, played] = await Promise.all([once(launcher, 'exit'), once(player, 'exit')]);
  assert.equal(end[0], 0, errors); assert.equal(played[0], 0, errors);
  const files = readdirSync(dir).filter(f => /^obs-\d+\.md$/.test(f));
  const pages = files.map(f => readFileSync(path.join(dir, f), 'utf8'));
  assert.ok(pages.some(s => /REJECTED .*BAD_TARGET/.test(s)));
  assert.ok(pages.some(s => /ACCEPTED .*g.buy/.test(s)));
  assert.ok(pages.every(s => s.length < 9100));
  const r = readJSON(path.join(dir, 'result.json'));
  assert.equal(r.summary.errors, 0); assert.equal(r.external.fallbacks, 0);
  assert.equal(r.summary.victory, false);
  assert.ok(r.round > 1);
  assert.equal(r.layerTrace.spending.reduce((n, s) => n + s.spent, 0), r.summary.players[0].stats.gold);
  const report = readFileSync(path.join(dir, 'result.md'), 'utf8');
  for (const pattern of [/LOSS/, /FA damage/, /Banked layers per round/, /Gold spent by kind/, /buy:chess/]) assert.match(report, pattern);
  assert.equal(readJSON(path.join(dir, 'status.json')).state, 'finished');
});

test('co-op stdio agent multiplexes four seat directories and supersedes late files without cross-seat actions', async t => {
  const dir = temp(t), h = makeMatch({ mode: 'coop', seats, fake: true });
  t.after(() => h.m.dispose()); h.start().toPrep();
  const { aiObservation } = await import('../../server/match/externalAI.js');
  const c = new StdioAI({ command: [process.execPath, 'tools/ai/manual-agent.mjs', '--dir', dir, '--mode', 'coop'], timeoutMs: 15000, maxBytes: 65536, backoffMs: 1 });
  t.after(() => c.close());
  const requests = seats.map((s, i) => {
    const o = aiObservation(h.m, h.m.order[i], { id: `s${i}`, kind: 'prep', deadline: h.sched.now() + 5000, remaining: 64 }, []);
    o.context.mode = 'direct';
    return o;
  });
  const abort = new AbortController();
  const first = c.request(requests[0], abort.signal);
  const others = requests.slice(1).map(o => c.request(o, new AbortController().signal));
  for (let seat = 0; seat < 4; seat++) await until(() => existsSync(path.join(dir, `seat-${seat}`, 'obs-1.md')));
  abort.abort(); await assert.rejects(first);
  const next = { ...requests[0], id: 's0-next', results: [{ intent: null, error: 'TIMEOUT', fallback: true, detail: 'built-in bot fallback' }] };
  const second = c.request(next, new AbortController().signal);
  await until(() => existsSync(path.join(dir, 'seat-0', 'obs-2.md')));
  writeJSON(path.join(dir, 'seat-0', 'act-1.json'), [{ t: 'g.refresh' }]);
  writeJSON(path.join(dir, 'seat-0', 'act-2.json'), [{ t: 'g.freeze' }]);
  for (let seat = 1; seat < 4; seat++) writeJSON(path.join(dir, `seat-${seat}`, 'act-1.json'), [{ t: 'g.buy', slot: seat }]);
  assert.equal((await second).intents[0].t, 'g.freeze');
  const replies = await Promise.all(others);
  assert.deepEqual(replies.map(r => r.id), ['s1', 's2', 's3']);
  assert.deepEqual(replies.map(r => r.intents[0].slot), [1, 2, 3]);
  assert.match(readFileSync(path.join(dir, 'seat-0', 'obs-2.md'), 'utf8'), /TIMEOUT.*FALLBACK/);
});

test('manual-act is atomic, refuses duplicates and expired observations; done means validated Ready', t => {
  const dir = temp(t), status = { state: 'waiting', n: 1, kind: 'prep', remaining: 2, obs: 'obs-1.md' };
  writeJSON(path.join(dir, 'status.json'), status);
  const call = value => spawnSync(process.execPath, ['tools/ai/manual-act.mjs', dir, value], { encoding: 'utf8' });
  assert.equal(call('{"done":true}').status, 0);
  assert.deepEqual(actionReply(readJSON(path.join(dir, 'act-1.json')), status), { intents: [{ t: 'g.ready', ready: true }], done: false });
  assert.equal(call('["a1"]').status, 1);
  assert.throws(() => actionReply({ done: true }, { ...status, kind: 'band' }), /only for prep/);
  writeJSON(path.join(dir, 'status.json'), { ...status, n: 2, expiresAt: Date.now() - 1 });
  assert.equal(call('["a1"]').status, 1);
  assert.equal(existsSync(path.join(dir, 'act-2.json')), false);
  // §37.32: an answer bound to an older page is refused, never applied to the live one (its IDs mean other actions)
  writeJSON(path.join(dir, 'status.json'), { ...status, n: 3 });
  const late = spawnSync(process.execPath, ['tools/ai/manual-act.mjs', dir, '["a5"]', '--obs', '2'], { encoding: 'utf8' });
  assert.equal(late.status, 1);
  assert.match(late.stderr, /for obs-2, but obs-3 is the current observation \(live\); nothing was applied/);
  assert.equal(existsSync(path.join(dir, 'act-3.json')), false);
  assert.equal(spawnSync(process.execPath, ['tools/ai/manual-act.mjs', dir, '["a5"]', '--obs', '3'], { encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync(process.execPath, ['tools/ai/manual-act.mjs', dir, '["a5"]', '--obs'], { encoding: 'utf8' }).status, 1);
});

test('four-seat co-op launcher reaches concurrent prep with live wall-clock deadlines', { timeout: 30000 }, async t => {
  const dir = temp(t), child = spawn(process.execPath, ['tools/ai/manual-match.mjs', '--dir', dir, '--mode', 'coop', '--seats', '0,1,2,3', '--seed', '7'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exit = once(child, 'exit');
  t.after(() => child.kill('SIGKILL'));
  let errors = ''; child.stderr.on('data', s => { errors += s; });
  const answered = new Set();
  await until(() => {
    let ready = 0;
    for (let seat = 0; seat < 4; seat++) {
      const folder = path.join(dir, `seat-${seat}`), statusFile = path.join(folder, 'status.json');
      if (!existsSync(statusFile)) continue;
      const s = readJSON(statusFile);
      if (s.kind === 'prep' && s.state === 'waiting') { ready++; assert.ok(s.expiresAt > Date.now()); continue; }
      if (s.kind === 'band' && s.state === 'waiting' && !answered.has(s.id)) {
        const d = readJSON(path.join(folder, `obs-${s.n}.json`));
        assert.equal(d.playerId, `manual_${seat}`);
        writeJSON(path.join(folder, `act-${s.n}.json`), [d.actions.find(a => a.intent.t === 'g.band').id]);
        answered.add(s.id);
      }
    }
    return ready === 4;
  });
  assert.equal(answered.size, 4);
  child.kill('SIGTERM');
  assert.equal((await exit)[0], 1, errors);
  for (let seat = 0; seat < 4; seat++) assert.equal(readJSON(path.join(dir, `seat-${seat}`, 'status.json')).state, 'stopped');
});

test('historical solo selects its data and existing unlimited option; unavailable difficulties fail before creating a session', { timeout: 30000 }, async t => {
  const dir = temp(t);
  const bad = spawnSync(process.execPath, ['tools/ai/manual-match.mjs', '--dir', dir, '--version', 'act1autochess'], { encoding: 'utf8' });
  assert.equal(bad.status, 1); assert.match(bad.stderr, /ABYSS is unavailable/); assert.deepEqual(readdirSync(dir), []);
  const child = spawn(process.execPath, ['tools/ai/manual-match.mjs', '--dir', dir, '--mode', 'solo', '--version', 'act1autochess', '--difficulty', 'HARD'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exit = once(child, 'exit'); t.after(() => child.kill('SIGKILL'));
  await until(() => existsSync(path.join(dir, 'obs-1.request.json')));
  const o = readJSON(path.join(dir, 'obs-1.request.json'));
  assert.equal(o.context.gameVersion, 'act1autochess'); assert.equal(o.context.deadline, 0);
  child.kill('SIGTERM'); assert.equal((await exit)[0], 1);
});

test('a completed winning fixture reports Final Assault pool, damage and settled layer banks', { timeout: 30000 }, async t => {
  const { manualMatch } = await import('../../tools/ai/manual-match.mjs');
  const { Match } = await import('../../server/match/Match.js');
  const { FakeBattle } = await import('./fakeBattle.js');
  const dir = temp(t);
  FakeBattle.reset(); t.after(() => FakeBattle.reset());
  FakeBattle.script = b => ({ duration: b.sharedBoss ? Infinity : 0.1, bossDps: 1e8,
    layerGains: Object.fromEntries(b.players.map(pid => [pid, { yanShip: 3 }])) });
  class FixtureMatch extends Match {
    constructor(opts) { super({ ...opts, BattleClass: FakeBattle, clientCombat: false, botRehearsal: 0 }); }
  }
  const player = spawn(process.execPath, ['test/fixtures/manual-player.mjs', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exit = once(player, 'exit'); t.after(() => player.kill('SIGKILL'));
  let errors = ''; player.stderr.on('data', s => { errors += s; });
  const record = await manualMatch({ dir, mode: 'solo', difficulty: 'ABYSS', seed: 7 }, { MatchClass: FixtureMatch });
  assert.equal((await exit)[0], 0, errors);
  assert.equal(record.summary.victory, true);
  assert.ok(record.fa.pool > 0); assert.equal(record.fa.remaining, 0);
  assert.equal(record.fa.damageBySeat[0], record.fa.pool);
  assert.ok(record.layerTrace.snapshots.some(s => s.phase === 'SETTLE' && s.layers.yanShip >= 3));
  assert.match(readFileSync(path.join(dir, 'result.md'), 'utf8'), /WIN.*[\s\S]*yanShip\)=/);
});
