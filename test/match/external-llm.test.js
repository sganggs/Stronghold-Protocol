import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLLMAgent, STRATEGY_PROMPT, advisorSystem } from '../../tools/ai/llm-agent.mjs';
import { knowledgePack } from '../../server/ai/knowledge.js';
import { DATA } from './harness.js';
import { exampleServer } from '../../tools/ai/http.mjs';
import { aggregateStrategies } from '../../tools/ai/run-match.mjs';

const exec = promisify(execFile);
const pack = knowledgePack(DATA, { modeId: 'mode_single_funny', language: 'en' });
async function mock(t, handler) {
  const server = http.createServer(handler); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}
const envFor = url => ({ SP_LLM_BASE_URL: `${url}/v1`, SP_LLM_MODEL: 'mock-model', SP_LLM_API_KEY: 'test-secret', SP_LLM_TIMEOUT_MS: '2000' });
const hello = { v: 'sp-ai/1', type: 'hello', id: 'hello-1', knowledge: pack };
const observation = { v: 'sp-ai/1', id: 'ai-1', knowledgeVersion: pack.version, private: { secretDuplicate: true },
  context: { mode: 'plan', kind: 'prep', matchId: 'mock-match' }, digest: { playerId: 'one', economy: { gold: 6 }, geometry: { omitted: true },
    actions: [{ id: 'a1', intent: { t: 'g.move' } }, { id: 'a2', intent: { t: 'g.reward' } }] } };

test('SP_LLM_HEADERS validates JSON before IO and forwards only safe OpenAI headers', async t => {
  const seen = [];
  const url = await mock(t, (req, res) => {
    seen.push(req.headers); req.resume(); req.on('end', () => res.end(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
    })));
  });
  for (const value of ['{', 'null', '[]', '"secret"', '5', '{"Authorization":"test-secret"}',
    '{"X-API-Key":"test-secret"}', '{"Host":"test-secret"}', '{"Cookie":"test-secret"}',
    '{"Content-Type":"test-secret"}', '{"content-encoding":"gzip"}', '{"x-test":7}',
    '{"x-test":"bad\\nvalue"}', '{"X-Test":"a","x-test":"b"}']) {
    assert.throws(() => createLLMAgent({ ...envFor(url), SP_LLM_HEADERS: value }), /^Error: LLM configuration$/);
  }
  const agent = createLLMAgent({ ...envFor(url),
    SP_LLM_HEADERS: '{"HTTP-Referer":"https://example.invalid/","X-Title":"My app","User-Agent":"ignored"}' });
  await agent(hello); assert.equal(seen.length, 0);
  await agent(observation);
  assert.equal(seen[0]['http-referer'], 'https://example.invalid/');
  assert.equal(seen[0]['x-title'], 'My app'); assert.equal(seen[0]['user-agent'], 'stronghold-protocol-llm-agent');
  assert.equal(seen[0].authorization, 'Bearer test-secret');
});

test('LLM retries 429/503 with bounded Retry-After or 10 seconds and private diagnostics', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-llm-backoff-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const waits = [], realTimeout = globalThis.setTimeout;
  // Only accelerate the backoff; HTTP still uses its real deadline and loopback server.
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => {
    if ([0, 1000, 10000, 30000].includes(ms)) { waits.push(ms); return realTimeout(fn, 0, ...args); }
    return realTimeout(fn, ms, ...args);
  });
  for (const [status, header, expected] of [[429, undefined, 10000], [429, '1', 1000], [503, '999', 30000],
    [503, 'bad-test-secret', 10000], [429, '0', 0]]) {
    const bodies = [];
    const url = await mock(t, (req, res) => {
      req.setEncoding('utf8');
      let body = ''; req.on('data', b => { body += b; }); req.on('end', () => {
        bodies.push(body);
        if (bodies.length === 1) { res.writeHead(status, header === undefined ? {} : { 'retry-after': header }).end('test-secret'); return; }
        res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 2 } }));
      });
    });
    const file = join(dir, `${status}-${expected}.jsonl`);
    const agent = createLLMAgent({ ...envFor(url), SP_LLM_TIMEOUT_MS: '150000', SP_LLM_DEBUG_FILE: file });
    await agent(hello);
    assert.deepEqual((await agent(observation)).usage, { inputTokens: 10, outputTokens: 2, cachedTokens: 0 });
    assert.equal(bodies.length, 2); assert.equal(bodies[0], bodies[1]);
    assert.equal(waits.at(-1), expected);
    const text = readFileSync(file, 'utf8');
    const [backoff, done] = text.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(backoff.stage, 'rate-limit'); assert.equal(backoff.status, status);
    assert.equal(backoff.waitMs, expected); assert.equal(backoff.retry, true); assert.equal(done.stage, 'ok');
    assert.ok(!text.includes('test-secret'));
  }
});

test('LLM rate-limit retry cap and insufficient budget retain the generic failure', async t => {
  for (const [status, header, timeout, expectedCalls] of [[429, '0', '2000', 4], [503, '0', '2000', 4],
    [429, '1', '1500', 1], [429, undefined, '2000', 1], [402, '0', '2000', 1]]) {
    let calls = 0;
    const url = await mock(t, (req, res) => {
      req.resume(); req.on('end', () => {
        calls++; res.writeHead(status, header === undefined ? {} : { 'retry-after': header }).end('test-secret');
      });
    });
    const agent = createLLMAgent({ ...envFor(url), SP_LLM_TIMEOUT_MS: timeout });
    await agent(hello);
    await assert.rejects(agent(observation), /^Error: LLM request$/);
    assert.equal(calls, expectedCalls);
  }
});

test('LLM rechecks the retry reserve after a delayed wake and shares the cap with length recovery', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const realTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => {
    t.mock.timers.tick(100001);
    return realTimeout(fn, 0, ...args);
  });
  let calls = 0;
  const agent = createLLMAgent({ ...envFor('https://example.invalid'), SP_LLM_TIMEOUT_MS: '150000' }, async () => {
    calls++; throw Object.assign(new Error('test-secret'), { status: 429, retryAfterMs: 0 });
  });
  await agent(hello); await assert.rejects(agent(observation), /^Error: LLM request$/);
  assert.equal(calls, 1, 'no shortened attempt after an overdue wake');
  t.mock.restoreAll();
  let attempts = 0;
  const length = createLLMAgent(envFor('https://example.invalid'), async () => {
    attempts++;
    if (attempts === 3) return { choices: [{ finish_reason: 'length', message: { content: '' } }] };
    throw Object.assign(new Error('test-secret'), { status: 503, retryAfterMs: 0 });
  });
  await length(hello); await assert.rejects(length(observation), /^Error: LLM request$/);
  assert.equal(attempts, 5, 'three rate-limit retries in total, not three per ask');
});

test('LLM adapter uses a stable cached system prefix, compact digest, JSON mode and numeric usage', async t => {
  const calls = [];
  const url = await mock(t, (req, res) => {
    // The playbook makes the prefix span more chunks; decode split Chinese UTF-8 sequences incrementally.
    req.setEncoding('utf8');
    let body = ''; req.on('data', b => { body += b; }); req.on('end', () => {
      calls.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"economy":{"maxRefreshes":2}}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 80 }, completion_tokens_details: { reasoning_tokens: 5 } } }));
    });
  });
  const agent = createLLMAgent(envFor(url));
  assert.deepEqual(await agent(hello), { v: hello.v, id: hello.id, type: 'hello', knowledgeVersion: pack.version });
  assert.equal(calls.length, 0, 'hello does not contact the provider');
  const reply = await agent(observation); await agent({ ...observation, id: 'ai-2' });
  assert.deepEqual(reply.usage, { inputTokens: 100, outputTokens: 12, cachedTokens: 80 });
  assert.equal(reply.plan.economy.maxRefreshes, 2); assert.ok(!JSON.stringify(reply).includes('test-secret'));
  assert.equal(calls[0].path, '/v1/chat/completions'); assert.equal(calls[0].auth, 'Bearer test-secret');
  assert.equal(calls[0].body.messages[0].content, calls[1].body.messages[0].content);
  assert.equal(calls[0].body.messages[0].content, advisorSystem(pack));
  assert.ok(calls[0].body.messages[0].content.startsWith(STRATEGY_PROMPT));
  assert.equal(calls[0].body.response_format.type, 'json_object');
  const user = calls[0].body.messages[1].content;
  assert.ok(!user.includes('secretDuplicate')); assert.ok(!user.includes('omitted')); assert.ok(!user.includes('g.move'));
  assert.ok(user.includes('g.reward'));
});

for (const bad of ['json', 'plan', 'truncated', 'redirect', 'oversize', 'timeout']) test(`LLM ${bad} failure is bounded and does not expose remote output or secrets`, async t => {
  const url = await mock(t, (req, res) => {
    req.on('error', () => {});
    req.resume();
    req.on('end', () => {
    if (bad === 'timeout') return;
    if (bad === 'redirect') { res.writeHead(302, { location: '/test-secret' }).end(); return; }
    if (bad === 'oversize') { res.end('x'.repeat(262145)); return; }
    res.end(JSON.stringify({ choices: [{ finish_reason: bad === 'truncated' ? 'length' : 'stop', message: {
      content: bad === 'json' ? 'test-secret' : '{"economy":"invalid structure"}' } }] }));
    });
  });
  const agent = createLLMAgent({ ...envFor(url), SP_LLM_TIMEOUT_MS: bad === 'timeout' ? '20' : '2000' });
  await agent(hello);
  await assert.rejects(agent(observation), error => !error.message.includes('test-secret'));
});

test('LLM requires explicit endpoint/model/key and a known knowledge version', async () => {
  assert.throws(() => createLLMAgent({}));
  assert.throws(() => createLLMAgent(envFor('https://user:secret@example.invalid')));
  const agent = createLLMAgent(envFor('http://127.0.0.1:1'));
  await assert.rejects(agent(observation), /knowledge/);
});

test('LLM thinking controls are explicit, validated and independent of the token cap', async () => {
  for (const setting of [{}, { SP_LLM_THINKING: 'disabled' }, { SP_LLM_THINKING: 'enabled', SP_LLM_REASONING_EFFORT: 'low' }]) {
    let sent;
    const agent = createLLMAgent({ ...envFor('https://example.invalid'), ...setting }, async (_config, body) => {
      sent = body;
      return { choices: [{ finish_reason: 'stop', message: { content: '{}' } }] };
    });
    await agent(hello); await agent(observation);
    assert.deepEqual(sent.thinking, setting.SP_LLM_THINKING ? { type: setting.SP_LLM_THINKING } : undefined);
    assert.equal(sent.reasoning_effort, setting.SP_LLM_REASONING_EFFORT);
    assert.equal(sent.max_tokens, 16000);
  }
  for (const setting of [{ SP_LLM_THINKING: 'off' }, { SP_LLM_THINKING: 'disabled', SP_LLM_REASONING_EFFORT: 'low' },
    { SP_LLM_THINKING: 'disabled', SP_LLM_RETRY_EFFORT: 'minimal' }]) {
    assert.throws(() => createLLMAgent({ ...envFor('https://example.invalid'), ...setting }), /LLM configuration/);
  }
});

test('adaptive effort keeps solo/default thinking and uses low only for a short known co-op budget', async () => {
  const coop = knowledgePack(DATA, { modeId: 'mode_multi_abyss', language: 'en' });
  const unknown = { ...pack, version: 'unknown-mode', modeId: undefined };
  const sent = new Map();
  const agent = createLLMAgent({ ...envFor('https://example.invalid'), SP_LLM_TIMEOUT_MS: '150000',
    SP_LLM_REASONING_EFFORT: 'adaptive' }, async (config, body) => {
    const round = JSON.parse(body.messages[1].content).digest.round;
    sent.set(round, { config, body });
    return { choices: [{ finish_reason: 'stop', message: { content: '{}' } }] };
  });
  for (const knowledge of [pack, coop, unknown]) await agent({ ...hello, knowledge });
  // These scheduler clocks intentionally differ from wall time. Every call shares the same agent, concurrently.
  const cases = [
    [pack, 170000, undefined], [pack, 30000, undefined], [coop, 90000, undefined], [coop, 89999, 'low'],
    [coop, 25000, 'low', 'band'], [coop, 7550, 'low', 'card'], [coop, 200000, undefined],
    [unknown, 30000, undefined], [coop, 0, undefined], [coop, -1, undefined],
  ];
  await Promise.all(cases.map(async ([knowledge, budget, expected, kind = 'prep'], index) => {
    const id = `adaptive-${index}`;
    await agent({ ...observation, id, knowledgeVersion: knowledge.version, public: { serverNow: 1000 },
      context: { ...observation.context, kind, deadline: 1000 + budget }, digest: { ...observation.digest, playerId: id, round: index + 1 } });
    const { body, config } = sent.get(index + 1);
    assert.equal(body.reasoning_effort, expected, id);
    assert.equal(Object.hasOwn(body, 'reasoning_effort'), expected !== undefined, 'omit the default, never send adaptive');
    assert.equal(body.max_tokens, 16000);
    assert.equal(body.thinking, undefined);
    assert.ok(config.timeoutMs > 0 && config.timeoutMs <= 150000, 'provider cap is not the host clock');
  }));
  for (const [deadline, serverNow] of [[undefined, 1000], [31000, undefined], [Infinity, 1000],
    [31000, NaN], ['31000', 1000], [31000, '1000'], [Number.MAX_VALUE, -Number.MAX_VALUE]]) {
    const id = 'invalid-clock';
    await agent({ ...observation, id, knowledgeVersion: coop.version, public: { serverNow },
      context: { ...observation.context, deadline }, digest: { ...observation.digest, playerId: id, round: 0 } });
    assert.equal(sent.get(0).body.reasoning_effort, undefined);
  }
});

test('adaptive effort considers the provider cap without changing fixed effort or length-retry precedence', async () => {
  const coop = knowledgePack(DATA, { modeId: 'mode_multi_abyss', language: 'en' });
  const o = { ...observation, knowledgeVersion: coop.version, public: { serverNow: 1000 },
    context: { ...observation.context, deadline: 171000 } };
  for (const [effort, timeout, expected, retry] of [
    ['adaptive', '20000', 'low', undefined], ['adaptive', '150000', undefined, undefined],
    [undefined, '20000', undefined, undefined], ['high', '20000', 'high', undefined],
    ['low', '150000', 'low', undefined], ['adaptive', '20000', 'low', 'minimal'],
  ]) {
    const sent = [];
    const agent = createLLMAgent({ ...envFor('https://example.invalid'), SP_LLM_TIMEOUT_MS: timeout,
      SP_LLM_REASONING_EFFORT: effort, SP_LLM_RETRY_EFFORT: retry }, async (_config, body) => {
      sent.push(body);
      return { choices: [{ finish_reason: sent.length === 1 ? 'length' : 'stop', message: { content: '{}' } }] };
    });
    await agent({ ...hello, knowledge: coop }); await agent(o);
    assert.equal(sent.length, 2);
    assert.equal(sent[0].reasoning_effort, expected);
    assert.equal(sent[1].reasoning_effort, retry || expected);
    assert.equal(sent[0].messages[0].content, sent[1].messages[0].content);
  }
  for (const setting of [{ SP_LLM_REASONING_EFFORT: 'auto' }, { SP_LLM_RETRY_EFFORT: 'adaptive' },
    { SP_LLM_REASONING_EFFORT: 'adaptive', SP_LLM_THINKING: 'disabled' }]) {
    assert.throws(() => createLLMAgent({ ...envFor('https://example.invalid'), ...setting }), /^Error: LLM configuration$/);
  }
});

test('adaptive rate-limit recovery preserves the selected effort and records no private configuration', async t => {
  const coop = knowledgePack(DATA, { modeId: 'mode_multi_abyss', language: 'en' });
  const dir = mkdtempSync(join(tmpdir(), 'sp-llm-adaptive-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const debug = join(dir, 'debug.jsonl'), calls = [];
  const agent = createLLMAgent({ ...envFor('https://example.invalid'), SP_LLM_TIMEOUT_MS: '150000',
    SP_LLM_REASONING_EFFORT: 'adaptive', SP_LLM_DEBUG_FILE: debug }, async (_config, body) => {
    calls.push(body);
    if (calls.length === 1) throw Object.assign(new Error('remote test-secret'), { status: 429, retryAfterMs: 0 });
    return { choices: [{ finish_reason: 'stop', message: { content: '{}' } }] };
  });
  await agent({ ...hello, knowledge: coop });
  await agent({ ...observation, knowledgeVersion: coop.version, public: { serverNow: 1000 },
    context: { ...observation.context, deadline: 31000 } });
  assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].reasoning_effort, 'low');
  const text = readFileSync(debug, 'utf8');
  const rows = text.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(rows.map(r => r.stage), ['rate-limit', 'ok']);
  assert.ok(rows.every(r => r.reasoningEffort === 'low'));
  assert.ok(!text.includes('test-secret')); assert.ok(!text.includes('example.invalid'));
});

test('opt-in capture and full failure diagnostics redact credentials and keep reasoning usage off the wire', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-llm-diagnostics-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const debug = join(dir, 'debug.jsonl'), capture = join(dir, 'capture.jsonl');
  let sent;
  const agent = createLLMAgent({ ...envFor('https://example.invalid'), SP_LLM_DEBUG_FILE: debug,
    SP_LLM_CAPTURE_FILE: capture, SP_LLM_DEBUG_FULL_REPLY: '1' }, async (_config, body) => {
    sent = body;
    return { choices: [{ finish_reason: 'stop', message: { content: 'broken test-secret reply' } }],
      usage: { prompt_tokens: 100, completion_tokens: 30, prompt_cache_hit_tokens: 80, completion_tokens_details: { reasoning_tokens: 20 } } };
  });
  await agent(hello);
  await assert.rejects(agent({ ...observation, digest: { ...observation.digest, lp: 'test-secret' } }), /JSON/);
  const log = JSON.parse(readFileSync(debug, 'utf8'));
  assert.equal(log.content, 'broken [REDACTED] reply');
  assert.equal(log.reasoningTokens, 20);
  assert.deepEqual(log.usage, { inputTokens: 100, outputTokens: 30, cachedTokens: 80 });
  assert.deepEqual(JSON.parse(readFileSync(capture, 'utf8')).body, JSON.parse(JSON.stringify(sent).replaceAll('test-secret', '[REDACTED]')));
  for (const file of [debug, capture]) {
    const text = readFileSync(file, 'utf8');
    assert.ok(!text.includes('test-secret')); assert.ok(!text.includes('authorization')); assert.ok(!text.includes('example.invalid'));
  }
  const failed = createLLMAgent({ ...envFor('https://example.invalid'), SP_LLM_DEBUG_FILE: debug }, async () => {
    throw new Error('remote echoed test-secret');
  });
  await failed(hello); await assert.rejects(failed(observation), /^Error: LLM request$/);
  assert.ok(!readFileSync(debug, 'utf8').includes('test-secret'));
});

test('a token-limit reply cannot use missing-wrapper recovery even when its plan looks complete', async () => {
  const agent = createLLMAgent(envFor('https://example.invalid'), async () => ({ choices: [{ finish_reason: 'length',
    message: { content: '{"why":"Keep","plan":{"items":{"equip":[]}}' } }] }));
  await agent(hello);
  await assert.rejects(agent(observation), /incomplete/);
});

for (const [tool, mode, transport] of [['botbench', 'direct', 'stdio'], ['botbench', 'plan', 'http'], ['matchrun', 'plan', 'stdio']]) {
  test(`${tool} executes ${mode} example ${transport} IO and reports real per-strategy outcomes`, async t => {
    let url;
    if (transport === 'http') {
      const server = exampleServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
      t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }); url = `http://127.0.0.1:${server.address().port}`;
    }
    const args = tool === 'botbench' ? ['--configs', 'solo:FUNNY', '--json', '-'] : ['--mode', 'solo', '--difficulty', 'FUNNY', '--json'];
    const { stdout } = await exec(process.execPath, [`tools/${tool}.mjs`, ...args, '--bot', 'external', '--seeds', '1', '--seed', '7', '--rehearsal', '0', '--quiet'], {
      timeout: 60000, maxBuffer: 2e6, env: { ...process.env, SP_EXTERNAL_AI_MODE: mode, SP_EXTERNAL_AI_TRANSPORT: transport,
        SP_EXTERNAL_AI_URL: url || '', SP_EXTERNAL_AI_COMMAND: JSON.stringify([process.execPath, 'tools/ai/stdio.mjs']),
        SP_EXTERNAL_AI_SEATS: '', SP_EXTERNAL_AI_TIMEOUT_MS: '5000' },
    });
    const [r] = JSON.parse(stdout); const p = r.strategyMetrics[0];
    assert.equal(p.strategy, `external:${mode}`); assert.ok(p.survivalRound > 1); assert.ok(p.external.calls > 1);
    assert.equal(p.external.fallbacks, 0); assert.ok(p.external.latencyMs > 0);
    for (const k of ['finalLP', 'damageDealt', 'leaderDamage', 'wins']) assert.equal(typeof p[k], 'number');
    assert.equal(r.external.helloCalls, mode === 'plan' ? 1 : 0);
    const [summary] = aggregateStrategies([r]); assert.equal(summary.calls, p.external.calls); assert.equal(summary.seats, 1);
  });
}

test('the stdio LLM example runs through matchrun using only the loopback mock API', async t => {
  let calls = 0;
  const url = await mock(t, (req, res) => {
    req.resume(); req.on('end', () => { calls++; res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 2 } })); });
  });
  const { stdout, stderr } = await exec(process.execPath, ['tools/matchrun.mjs', '--mode', 'solo', '--difficulty', 'FUNNY', '--bot', 'external', '--seed', '7', '--rehearsal', '0', '--json'], {
    timeout: 60000, maxBuffer: 2e6, env: { ...process.env, ...envFor(url), SP_EXTERNAL_AI_MODE: 'plan', SP_EXTERNAL_AI_TRANSPORT: 'stdio',
      SP_EXTERNAL_AI_COMMAND: JSON.stringify([process.execPath, 'tools/ai/llm-agent.mjs']), SP_EXTERNAL_AI_SEATS: '', SP_EXTERNAL_AI_TIMEOUT_MS: '5000' },
  });
  const [r] = JSON.parse(stdout); assert.ok(calls > 1); assert.equal(r.external.calls, calls);
  assert.equal(r.external.fallbacks, 0); assert.equal(r.external.inputTokens, calls * 10); assert.equal(r.external.outputTokens, calls * 2);
  assert.ok(!`${stdout}${stderr}`.includes('test-secret'));
});

test('LLM adapter identifies itself and sends a stable per-seat session header when a gateway asks for one', async t => {
  const seen = [];
  const url = await mock(t, (req, res) => {
    req.resume();
    req.on('end', () => {
      seen.push({ ua: req.headers['user-agent'], session: req.headers['x-opencode-session'], auth: req.headers.authorization });
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"economy":{"maxRefreshes":1}}' } }] }));
    });
  });
  const plain = createLLMAgent(envFor(url));
  await plain(hello); await plain(observation);
  assert.equal(seen[0].ua, 'stronghold-protocol-llm-agent');
  assert.equal(seen[0].session, undefined, 'no session header unless configured');
  const agent = createLLMAgent({ ...envFor(url), SP_LLM_SESSION_HEADER: 'x-opencode-session', SP_LLM_USER_AGENT: 'sp-test/1' });
  await agent(hello);
  await agent(observation); await agent({ ...observation, id: 'ai-2' });
  await agent({ ...observation, id: 'ai-3', digest: { ...observation.digest, playerId: 'two' } });
  const [a, b, c] = seen.slice(1);
  assert.equal(a.ua, 'sp-test/1');
  assert.match(a.session, /^[0-9a-f]{32}$/);
  assert.equal(b.session, a.session, 'one conversation per seat and match');
  assert.notEqual(c.session, a.session, 'another seat is another conversation');
  assert.equal(a.auth, 'Bearer test-secret', 'caller headers never replace the authorization');
  for (const bad of [{ SP_LLM_SESSION_HEADER: 'authorization' }, { SP_LLM_SESSION_HEADER: 'x-a\r\nb' }, { SP_LLM_USER_AGENT: 'a\nb' }]) {
    assert.throws(() => createLLMAgent({ ...envFor(url), ...bad }), /LLM configuration/);
  }
});
