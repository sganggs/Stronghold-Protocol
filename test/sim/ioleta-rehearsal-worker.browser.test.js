// Small correctness fixtures, no strength benchmark. SIM_E2E=1 and CHROME_PATH select a real headless browser.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { makeMatch, checkInvariants } from '../match/harness.js';
import { RehearsalRun } from '../../server/sim/rehearsal.js';
import { createBattleFromSpec } from '../../server/sim/spec.js';
import { simulateRehearsal } from '../match/simClient.js';
import { createIoletaPrepSteps } from '../../server/match/botIoleta.js';
import { getBotStrategy } from '../../server/match/botStrategies.js';
import { arrangeSteps, contactCandidatePlansSteps } from '../../server/match/bot.js';

const chrome = process.env.CHROME_PATH;
const enabled = process.env.SIM_E2E === '1' && chrome && existsSync(chrome);
const combined = { id: 'ioleta-contact', base: getBotStrategy('ioleta'), ...createIoletaPrepSteps({
  arrangeSteps: (m, ps, opts = {}) => arrangeSteps(m, ps, { ...opts, candidatePlans: contactCandidatePlansSteps }),
}) };

function fixture(seed, strategy = combined) {
  const h = makeMatch({ mode: 'coop', humans: 2, difficulty: 'HARD', seed, botStrategy: strategy,
    botRehearsal: 3, botRehearsalDelegate: true, botRehearsalDelegateMs: 1000, hostId: 'p_0' }).start().toPrep();
  const m = h.m, ps = m.order[1];
  ps.isBot = true;
  ps.bandId = 'band_ioleta';
  ps.funds = 8;
  m.scheduleBotPrep(ps);
  assert.ok(h.run(() => m._rehearsalTasks.size > 0));
  const frame = h.lastTo('p_0', 'b.rehearsal');
  const task = m._rehearsalTasks.get(frame.taskId);
  assert.ok(frame.specs.length >= 2 && frame.specs.length <= 8);
  assert.ok(ps.botStrategyState.ioleta.plan);
  return { h, m, ps, frame, job: task.job };
}

describe('ioleta + contact in the production browser rehearsal Worker', {
  skip: !enabled && 'set SIM_E2E=1 and CHROME_PATH', timeout: 120000,
}, () => {
  let server, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-first-run'] });
  });
  after(async () => { await browser?.close(); await server?.close(); });

  async function hostPage(t) {
    const page = await browser.newPage();
    t.after(() => page.close());
    const problems = [];
    page.on('pageerror', e => problems.push(e.message));
    page.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) problems.push(`HTTP ${r.status()}`); });
    await page.goto(`http://127.0.0.1:${server.port}/sim/spec.js`);
    await page.evaluate(async () => {
      const { loadBrowserSim } = await import('/js/battle/runner.js');
      const { installRehearsal, WORKER_URL } = await import('/js/battle/rehearsal.js');
      const sim = await loadBrowserSim();
      const bridge = window.rehearsalTest = { sent: [], workerResults: [], starts: {}, created: 0, terminated: 0, posted: [], cancelOnPost: null };
      const handlers = new Map();
      bridge.receive = msg => handlers.get(msg.t)(msg);
      bridge.host = installRehearsal({
        net: { on(type, fn) { handlers.set(type, fn); return () => handlers.delete(type); },
          send(type, fields) { bridge.sent.push({ t: type, ...fields }); return true; } },
        runner: { ensureSim: () => Promise.resolve(sim) },
        createWorker() {
          const worker = new Worker(WORKER_URL, { type: 'module' });
          worker.addEventListener('message', e => { if (e.data.t === 'done') bridge.workerResults.push({ ...e.data, ms: performance.now() - bridge.starts[e.data.taskId] }); });
          bridge.created++;
          const post = worker.postMessage.bind(worker), terminate = worker.terminate.bind(worker);
          worker.terminate = () => { bridge.terminated++; terminate(); };
          worker.postMessage = msg => {
            if (msg.t === 'rehearsal') bridge.starts[msg.taskId] = performance.now();
            post(msg);
            if (msg.t === 'rehearsal') {
              bridge.posted.push(msg.taskId);
              // Deliver the server's cancellation after actual posting, before this page handles any Worker result.
              if (bridge.cancelOnPost?.taskId === msg.taskId) bridge.receive(bridge.cancelOnPost);
            }
          };
          return worker;
        },
      });
    });
    return { page, problems };
  }

  for (const [seed, strategy, budget] of [[7, combined], [11, combined], [7, 'ioleta-adaptive'], [11, 'ioleta-adaptive'], [19, 'ioleta-adaptive', 4]]) test(`${typeof strategy === 'string' ? strategy : strategy.id} seed ${seed} budget ${budget ?? 'default'}: browser choice, server application and duplicate rejection`, async t => {
    const { h, m, ps, frame, job } = fixture(seed, strategy);
    t.after(() => m.dispose());
    if (budget) frame.limits = { stage: 3, tickBudget: budget };
    const want = simulateRehearsal(frame, m.ds);
    const { page, problems } = await hostPage(t);
    await page.evaluate(msg => window.rehearsalTest.receive(msg), frame);
    await page.waitForFunction(() => window.rehearsalTest.sent.length === 1, { timeout: 30000 });
    const answer = await page.evaluate(() => window.rehearsalTest.sent[0]);
    assert.equal(answer.choice, want);
    const run = new RehearsalRun(frame.specs.map(spec => () => createBattleFromSpec(spec, m.ds,
      { quiet: true, recordEvents: false })), frame.playerId, frame.cap, frame.limits || {});
    run.run();
    const diagnostic = await page.evaluate(() => window.rehearsalTest.workerResults[0]);
    const stats = diagnostic.stats;
    console.log('adaptive-worker-metric ' + JSON.stringify({ strategy: typeof strategy === 'string' ? strategy : strategy.id,
      seed, budget: budget || null, ms: diagnostic.ms, ...stats }));
    assert.deepEqual(stats, { totalTicks: run.totalTicks, completed: run.completed,
      considered: run.index, stopReason: run.stopReason });
    assert.equal(answer.error, undefined);
    m._onRehearsalResult(m.order[0], answer);
    assert.ok(h.run(() => ps.ready));
    assert.equal(job.best, job.plans[want]);
    const before = JSON.stringify(ps.privateView());
    m._onRehearsalResult(m.order[0], answer);
    assert.equal(JSON.stringify(ps.privateView()), before);
    assert.equal(m.rehearsalStats.answered, 1);
    assert.equal(m.rehearsalStats.takeovers, 0);
    checkInvariants(m);
    assert.deepEqual(h.logs.error, []);
    assert.deepEqual(problems, []);
  });

  test('timeout takes over; cancellation terminates a posted Worker task; the next task uses a fresh Worker', async t => {
    const first = fixture(7, 'ioleta-adaptive'), next = fixture(11, 'ioleta-adaptive');
    t.after(() => { first.m.dispose(); next.m.dispose(); });
    const want = simulateRehearsal(first.frame, first.m.ds);
    first.h.sched.advance(1000);
    assert.equal(first.ps.ready, true);
    assert.equal(first.m.rehearsalStats.takeovers, 1);
    assert.equal(first.job.best, first.job.plans[want]);
    const cancel = first.h.lastTo('p_0', 'b.rehearsalCancel');
    assert.equal(cancel.taskId, first.frame.taskId);
    const { page, problems } = await hostPage(t);
    await page.evaluate(({ frame, cancel }) => {
      window.rehearsalTest.cancelOnPost = cancel;
      window.rehearsalTest.receive(frame);
    }, { frame: first.frame, cancel });
    await page.waitForFunction(() => window.rehearsalTest.terminated === 1, { timeout: 30000 });
    await page.evaluate(msg => window.rehearsalTest.receive(msg), next.frame);
    await page.waitForFunction(() => window.rehearsalTest.sent.length === 1, { timeout: 30000 });
    const result = await page.evaluate(() => {
      const b = window.rehearsalTest;
      return { sent: b.sent, created: b.created, terminated: b.terminated, posted: b.posted };
    });
    assert.equal(result.created, 2);
    assert.equal(result.terminated, 1);
    assert.deepEqual(result.posted, [first.frame.taskId, next.frame.taskId]);
    assert.equal(result.sent[0].taskId, next.frame.taskId);
    assert.equal(result.sent[0].choice, simulateRehearsal(next.frame, next.m.ds));
    next.m._onRehearsalResult(next.m.order[0], result.sent[0]);
    assert.ok(next.h.run(() => next.ps.ready));
    const state = JSON.stringify(first.ps.privateView());
    first.m._onRehearsalResult(first.m.order[0], { taskId: first.frame.taskId, choice: 0 });
    assert.equal(JSON.stringify(first.ps.privateView()), state);
    assert.equal(first.m.rehearsalStats.answered, 0);
    for (const f of [first, next]) { checkInvariants(f.m); assert.deepEqual(f.h.logs.error, []); }
    assert.deepEqual(problems, []);
  });
});
