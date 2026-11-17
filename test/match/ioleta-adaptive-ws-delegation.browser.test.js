// The adaptive strategy behind the real platform: startServer (HTTP/WS + lobby + the real Match with real battles,
// scaled phase timers) configured only through SP_BOT_STRATEGY=ioleta-adaptive and SP_BOT_REHEARSAL=host. The room host is a
// websocket client (test/helpers/wsClient.js) that plays its own battles (simClient.js) and hands every `b.rehearsal`
// frame it receives to the production installRehearsal + rehearsalWorker in headless Chrome; the page's answers go back
// over the same socket. One prep per mode: the page answers (its pick is recomputed in Node), the page stays silent
// (the server's timeout takes over), or the Worker's result is held back (the server's cancel reaches a running task).
// SIM_E2E=1 and CHROME_PATH select a real headless browser.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { TestClient } from '../helpers/wsClient.js';
import { attachWsSimClient, simulateRehearsal } from './simClient.js';

const chrome = process.env.CHROME_PATH;
const enabled = process.env.SIM_E2E === '1' && chrome && existsSync(chrome);
const MODES = ['answer', 'mute', 'delay'];
const HOLD_MS = 4000; // past the scaled 1.5 s answer window

let srv, browser, page;
const matches = [], logs = { info: [], error: [] }, problems = [];
const saved = { strategy: process.env.SP_BOT_STRATEGY, rehearsal: process.env.SP_BOT_REHEARSAL };

before(async () => {
  if (!enabled) return;
  process.env.SP_BOT_STRATEGY = 'ioleta-adaptive';
  process.env.SP_BOT_REHEARSAL = 'host';
  const { startServer } = await import('../../server/index.js');
  const { Match } = await import('../../server/match/Match.js');
  class FastMatch extends Match {
    constructor(o) { super({ ...o, timerScale: 0.5 }); matches.push(this); }
  }
  const log = { debug() {}, warn() {}, info: (...a) => logs.info.push(a.map(String).join(' ')),
    error: (...a) => logs.error.push(a.map(String).join(' ')) };
  srv = await startServer({ port: 0, host: '127.0.0.1', log, MatchClass: FastMatch, seedFn: () => 2026101881 });
  const puppeteer = (await import('puppeteer-core')).default;
  browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-first-run'] });
  page = await browser.newPage();
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) problems.push(`HTTP ${r.status()} ${r.url()}`); });
  await page.goto(`http://127.0.0.1:${srv.port}/sim/spec.js`);
});

after(async () => {
  await browser?.close();
  await srv?.close();
  for (const [k, v] of [['SP_BOT_STRATEGY', saved.strategy], ['SP_BOT_REHEARSAL', saved.rehearsal]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test('ioleta-adaptive over real websockets: host-browser pick, timeout takeover and cancellation of a running Worker task', {
  skip: !enabled && 'set SIM_E2E=1 and CHROME_PATH', timeout: 300000,
}, async (t) => {
  const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
  t.after(() => c.terminate().catch(() => {}));
  c.id = (await c.hello('Host')).playerId;
  attachWsSimClient(c, { pace: 'instant' });

  // the page's side: the production module and Worker; `net` is this socket, reached through the CDP bridge
  await page.exposeFunction('wsSend', (type, fields) => { if (c.isOpen) c.send({ t: type, ...fields, rid: null }); });
  await page.evaluate(async (holdMs) => {
    const { loadBrowserSim } = await import('/js/battle/runner.js');
    const { installRehearsal, WORKER_URL } = await import('/js/battle/rehearsal.js');
    const sim = await loadBrowserSim();
    const handlers = new Map();
    const b = window.wsBridge = { mode: 'answer', received: [], sent: [], posted: [], created: 0, terminated: 0, dropped: [] };
    b.receive = (msg) => {
      b.received.push({ t: msg.t, taskId: msg.taskId, mode: b.mode });
      if (msg.t === 'b.rehearsal' && b.mode === 'mute') { b.dropped.push(msg.taskId); return; }
      handlers.get(msg.t)?.(msg);
    };
    installRehearsal({
      net: { on(type, fn) { handlers.set(type, fn); return () => handlers.delete(type); },
        send(type, fields) { b.sent.push({ t: type, ...fields }); window.wsSend(type, fields); return true; } },
      runner: { ensureSim: () => Promise.resolve(sim) },
      createWorker() {
        const worker = new Worker(WORKER_URL, { type: 'module' });
        b.created++;
        const port = {
          postMessage(msg) { if (msg.t === 'rehearsal') b.posted.push(msg.taskId); worker.postMessage(msg); },
          terminate() { b.terminated++; worker.terminate(); },
          set onerror(fn) { worker.onerror = fn; },
          set onmessage(fn) {
            // 'delay' holds back only the result, so the task is running in the Worker when the server cancels it
            worker.onmessage = (e) => (e.data?.t === 'done' && b.mode === 'delay' ? setTimeout(() => fn(e), holdMs) : fn(e));
          },
        };
        return port;
      },
    });
  }, HOLD_MS);
  const frames = [];
  c.ws.on('message', (data) => {
    let msg; try { msg = JSON.parse(String(data)); } catch { return; }
    if (msg.t !== 'b.rehearsal' && msg.t !== 'b.rehearsalCancel') return;
    frames.push(msg);
    page.evaluate((m) => window.wsBridge.receive(m), msg).catch((e) => problems.push(String(e)));
  });

  const ok = async (msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', `${msg.t}: ${JSON.stringify(r)}`); };
  await ok({ t: 'room.create', mode: 'coop', difficulty: 'HARD' });
  await c.waitFor('room.state');
  for (let i = 0; i < 3; i++) await ok({ t: 'room.addBot' });
  await ok({ t: 'room.start' });
  await c.waitFor('m.public', (p) => p.phase === 'INFO_CHECK', 10000);
  await ok({ t: 'g.infoReady' });
  const { getData } = await import('../../server/data.js');
  const draft = await c.waitFor('m.public', (p) => p.phase === 'BAND_DRAFT' && p.draft?.turn === c.id, 20000);
  const taken = new Set(Object.values(draft.draft.picks));
  const band = Object.values(getData().bands).find((x) => (!Array.isArray(x.modeTypeList) || x.modeTypeList.includes('MULTI'))
    && !taken.has(x.bandId) && x.bandId !== 'band_ioleta');
  await ok({ t: 'g.band', bandId: band.bandId });

  const m = matches.at(-1);
  assert.equal(m.bot.id, 'ioleta-adaptive');
  assert.equal(m.botRehearsalDelegate, true);
  const covered = new Map(), rounds = [];
  for (let round = 1; round <= 8 && covered.size < MODES.length; round++) {
    const mode = MODES.find((x) => !covered.has(x));
    await page.evaluate((x) => { window.wsBridge.mode = x; }, mode);
    const next = await c.waitFor('m.public', (p) => p.round === round && (p.phase === 'PREP' || p.phase === 'SP_DRAFT'), 60000);
    if (next.phase === 'SP_DRAFT') { // 机变: the humans pick first; any card still available
      for (let idx = 0; idx < 8; idx++) if ((await c.request({ t: 'g.choice', idx })).t === 'ok') break;
      await c.waitFor('m.public', (p) => p.phase === 'PREP' && p.round === round, 60000);
    }
    const before = { ...m.rehearsalStats }, firstFrame = frames.length;
    await ok({ t: 'g.ready', ready: true });
    await c.waitFor('m.public', (p) => p.round === round + 1 || p.phase === 'RESULT', 120000);
    if (mode === 'delay') await new Promise((r) => setTimeout(r, HOLD_MS + 500)); // let held results arrive late
    const tasks = frames.slice(firstFrame).filter((f) => f.t === 'b.rehearsal');
    const cancels = frames.slice(firstFrame).filter((f) => f.t === 'b.rehearsalCancel').map((f) => f.taskId);
    const delta = Object.fromEntries(Object.keys(m.rehearsalStats).map((k) => [k, m.rehearsalStats[k] - (before[k] || 0)]));
    rounds.push({ round, mode, tasks: tasks.length, candidates: tasks.map((f) => f.specs.length),
      limits: tasks.map((f) => f.limits || null), cancels: cancels.length, stats: delta });
    if (tasks.length) covered.set(mode, { tasks, cancels, delta });
  }
  const bridge = await page.evaluate(() => window.wsBridge);
  const seats = m.order.map((ps) => ({ playerId: ps.playerId, bot: !!ps.isBot, band: ps.bandId }));
  console.log('adaptive-ws-validation ' + JSON.stringify({ seats, rounds, created: bridge.created, terminated: bridge.terminated,
    posted: bridge.posted.length, sent: bridge.sent.length, takeoverLogs: logs.info.filter((l) => /rehearsal ← server/.test(l)) }));
  assert.deepEqual([...covered.keys()].sort(), [...MODES].sort(), `modes covered: ${JSON.stringify(rounds)}`);

  // every task is an adaptive one: 2..8 candidates and the zero-leak / tick-budget limits
  for (const { tasks } of covered.values()) for (const f of tasks) {
    assert.ok(f.specs.length >= 2 && f.specs.length <= 8);
    assert.ok(f.limits && Number.isInteger(f.limits.stage) && f.limits.tickBudget > 0);
  }
  // the ioleta-adaptive opener gives an AI seat Russell (the human avoided it): its procurement plan lives on that seat, and
  // its own preps went through the delegated rehearsal like every other band's
  const russell = m.order.find((ps) => ps.isBot && ps.bandId === 'band_ioleta');
  assert.ok(russell, `an AI seat plays Russell: ${JSON.stringify(seats)}`);
  assert.ok(russell.botStrategyState?.ioleta?.plan);
  assert.ok([...covered.values()].some(({ tasks }) => tasks.some((f) => f.playerId === russell.playerId)));
  // answer: every pick the page sent equals the one Node computes for the same frame, and the server accepted it
  const answered = covered.get('answer');
  for (const f of answered.tasks) {
    const sent = bridge.sent.find((s) => s.taskId === f.taskId);
    assert.ok(sent && sent.error === undefined, `answered ${f.taskId}`);
    assert.equal(sent.choice, simulateRehearsal(f, m.ds));
  }
  assert.equal(answered.delta.answered, answered.tasks.length);
  assert.equal(answered.delta.takeovers, 0);
  // mute: the server took every task over at its timeout and told the page
  const muted = covered.get('mute');
  assert.equal(muted.delta.takeovers, muted.tasks.length);
  assert.deepEqual(muted.cancels.sort(), muted.tasks.map((f) => f.taskId).sort());
  // delay: the cancel reached a task already posted to the Worker, which was terminated; the late result never counted
  const held = covered.get('delay');
  assert.equal(held.delta.takeovers, held.tasks.length);
  assert.equal(held.delta.answered, 0);
  assert.ok(held.tasks.some((f) => bridge.posted.includes(f.taskId) && held.cancels.includes(f.taskId)));
  assert.ok(bridge.terminated >= 1);
  assert.ok(!bridge.sent.some((s) => held.tasks.some((f) => f.taskId === s.taskId)), 'no answer for a cancelled task');
  assert.deepEqual(logs.error, []);
  assert.deepEqual(problems, []);
});
