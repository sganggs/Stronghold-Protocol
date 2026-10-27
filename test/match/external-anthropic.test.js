import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLLMAgent, advisorSystem, RETRY_TEXT } from '../../tools/ai/llm-agent.mjs';
import { validPlan, validUsage } from '../../server/match/aiPlan.js';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/llm-advisor.json', import.meta.url), 'utf8'));
const hello = { v: 'sp-ai/1', type: 'hello', id: 'hello', knowledge: fixture.knowledge };
const observation = { v: 'sp-ai/1', id: 'a1', knowledgeVersion: fixture.knowledge.version,
  context: { mode: 'plan', kind: 'prep', matchId: 'mock-match' }, digest: fixture.digest };
const message = (text = '{}', stop = 'end_turn', usage) => ({ type: 'message', role: 'assistant',
  content: [{ type: 'text', text }], stop_reason: stop, ...(usage ? { usage } : {}) });
const envFor = url => ({ SP_LLM_API_FORMAT: 'anthropic', SP_LLM_BASE_URL: `${url}/v1/`, SP_LLM_MODEL: 'mock-model',
  SP_LLM_API_KEY: 'fixture-secret', SP_LLM_TIMEOUT_MS: '2000' });
async function mock(t, handler) {
  const calls = [];
  const server = http.createServer((req, res) => {
    req.setEncoding('utf8');
    let body = '';
    req.on('data', b => { body += b; });
    req.on('end', () => {
      calls.push({ path: req.url, headers: req.headers, body: JSON.parse(body) });
      handler(res, calls.length);
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { url: `http://127.0.0.1:${server.address().port}`, calls };
}
function diagnostics(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sp-anthropic-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { debug: join(dir, 'debug.jsonl'), capture: join(dir, 'capture.jsonl') };
}

test('Anthropic Messages sends a stable cacheable system, both auth modes and safe extra headers', async t => {
  const { url, calls } = await mock(t, res => res.end(JSON.stringify({ ...message(), content: [
    { type: 'thinking', thinking: 'private-reasoning' }, { type: 'redacted_thinking', data: 'private-block' },
    { type: 'text', text: '```json\n{"economy":' }, { type: 'text', text: '{"maxRefreshes":2}}\n```' },
  ], usage: { input_tokens: 10, output_tokens: 12, cache_read_input_tokens: 80, cache_creation_input_tokens: 20 } })));
  for (const auth of [undefined, 'x-api-key']) {
    const agent = createLLMAgent({ ...envFor(url), SP_LLM_AUTH_TYPE: auth,
      SP_LLM_HEADERS: '{"HTTP-Referer":"https://example.invalid/","X-Title":"Mock app","x-opencode-session":"ignored","anthropic-version":"ignored"}',
      SP_LLM_SESSION_HEADER: 'x-opencode-session' });
    const before = calls.length;
    await agent(hello); assert.equal(calls.length, before, 'hello is local');
    const reply = await agent(observation);
    await agent({ ...observation, id: 'a2' });
    await agent({ ...observation, id: 'a3', digest: { ...fixture.digest, playerId: 'other-seat' } });
    assert.deepEqual(reply.plan, { economy: { maxRefreshes: 2 } });
    assert.deepEqual(reply.usage, { inputTokens: 110, outputTokens: 12, cachedTokens: 80 });
    assert.ok(validPlan(reply.plan)); assert.ok(validUsage(reply.usage));
    const [first, second, other] = calls.slice(before);
    assert.equal(first.path, '/v1/messages');
    assert.equal(first.headers.authorization, auth ? undefined : 'Bearer fixture-secret');
    assert.equal(first.headers['x-api-key'], auth ? 'fixture-secret' : undefined);
    assert.equal(first.headers['anthropic-version'], '2023-06-01');
    assert.equal(first.headers['content-type'], 'application/json');
    assert.equal(first.headers['http-referer'], 'https://example.invalid/');
    assert.equal(first.headers['x-title'], 'Mock app');
    assert.match(first.headers['x-opencode-session'], /^[a-f0-9]{32}$/);
    assert.equal(first.headers['x-opencode-session'], second.headers['x-opencode-session']);
    assert.notEqual(first.headers['x-opencode-session'], other.headers['x-opencode-session']);
    assert.deepEqual(first.body.system, [{ type: 'text', text: advisorSystem(fixture.knowledge), cache_control: { type: 'ephemeral' } }]);
    assert.deepEqual(first.body.system, second.body.system);
    assert.equal(first.body.max_tokens, 16000); assert.equal(first.body.model, 'mock-model');
    assert.deepEqual(first.body.messages.map(m => m.role), ['user']);
    assert.equal(JSON.parse(first.body.messages[0].content).kind, 'prep');
    for (const field of ['response_format', 'reasoning_effort', 'thinking', 'output_config']) assert.equal(first.body[field], undefined);
  }
});

test('Anthropic uses the existing brace recovery, choice correction and plan checks', async t => {
  const { debug } = diagnostics(t);
  const replies = [
    message('{"why":"Equip the carry.","plan":{"items":{"equip":[{"id":"item","target":"lead"}]}}'),
    message('{"why":"Pick support.","choiceName":"support","plan":{"choice":"a2"}}'),
    message('{"economy":"fixture-secret"}'),
  ];
  const { url } = await mock(t, res => res.end(JSON.stringify(replies.shift())));
  const agent = createLLMAgent({ ...envFor(url), SP_LLM_DEBUG_FILE: debug });
  await agent(hello);
  assert.deepEqual((await agent(observation)).plan.items.equip, [{ id: 'item', target: 'lead' }]);
  const choice = { ...observation, context: { ...observation.context, kind: 'reward' }, digest: { ...fixture.digest,
    actions: [...fixture.digest.actions, { id: 'a2', intent: { t: 'g.reward', idx: 1 }, text: 'other' }] } };
  assert.equal((await agent(choice)).plan.choice, 'a1');
  await assert.rejects(agent(observation), /^Error: plan$/);
  const logs = readFileSync(debug, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(logs[0].repairs.some(r => r.path === '$'));
  assert.ok(logs[1].repairs.some(r => r.path === 'choice'));
  assert.ok(!readFileSync(debug, 'utf8').includes('fixture-secret'));
});

test('Anthropic length and rate retries share the deadline, preserve the system and sum usage once', async t => {
  const { debug, capture } = diagnostics(t);
  const usage = { input_tokens: 10, output_tokens: 12, cache_read_input_tokens: 80, cache_creation_input_tokens: 20,
    cache_creation: { ephemeral_5m_input_tokens: 20, ephemeral_1h_input_tokens: 0 }, opencode: { tokens: { reasoning: 7 } } };
  const { url, calls } = await mock(t, (res, n) => {
    if (n === 1) { res.writeHead(429, { 'retry-after': '0' }).end('fixture-secret'); return; }
    const reply = message(n === 2 ? '' : '{"economy":{"reserve":2}}', n === 2 ? 'max_tokens' : 'end_turn', usage);
    reply.content.unshift({ type: 'thinking', thinking: 'never-store-reasoning fixture-secret' });
    res.end(JSON.stringify(reply));
  });
  const agent = createLLMAgent({ ...envFor(url), SP_LLM_THINKING: 'enabled', SP_LLM_REASONING_EFFORT: 'high',
    SP_LLM_RETRY_EFFORT: 'minimal', SP_LLM_DEBUG_FILE: debug, SP_LLM_DEBUG_FULL_REPLY: '1', SP_LLM_CAPTURE_FILE: capture,
    SP_LLM_HEADERS: '{"X-Title":"private-header-value"}' });
  await agent(hello);
  const reply = await agent(observation);
  assert.deepEqual(reply.usage, { inputTokens: 220, outputTokens: 24, cachedTokens: 160 });
  assert.deepEqual(calls[0].body, calls[1].body);
  assert.deepEqual(calls[1].body.system, calls[2].body.system);
  assert.deepEqual(calls[2].body.messages.at(-1), { role: 'user', content: RETRY_TEXT });
  assert.deepEqual(calls[1].body.thinking, { type: 'adaptive' });
  assert.deepEqual(calls[1].body.output_config, { effort: 'high' });
  assert.deepEqual(calls[2].body.output_config, { effort: 'low' });
  assert.equal(calls[2].body.reasoning_effort, undefined);
  const logs = readFileSync(debug, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(logs.map(r => r.stage), ['rate-limit', 'retry', 'ok']);
  assert.equal(logs.at(-1).cacheWriteTokens, 40); assert.equal(logs.at(-1).reasoningTokens, 14);
  for (const file of [debug, capture]) {
    const text = readFileSync(file, 'utf8');
    for (const forbidden of ['fixture-secret', 'never-store-reasoning', 'private-header-value', 'authorization']) assert.ok(!text.includes(forbidden));
  }
});

test('Anthropic thinking and cache controls are explicit and validated before any request', async t => {
  const { url, calls } = await mock(t, res => res.end(JSON.stringify(message())));
  const cases = [
    [{}, undefined, undefined],
    [{ SP_LLM_THINKING: 'disabled' }, { type: 'disabled' }, undefined],
    [{ SP_LLM_THINKING: 'enabled', SP_LLM_REASONING_EFFORT: 'low' }, { type: 'adaptive' }, 'low'],
    [{ SP_LLM_REASONING_EFFORT: 'medium' }, undefined, 'medium'],
    [{ SP_LLM_THINKING: 'enabled', SP_LLM_THINKING_BUDGET: '1024' }, { type: 'enabled', budget_tokens: 1024 }, undefined],
  ];
  for (const [setting, thinking, effort] of cases) {
    const agent = createLLMAgent({ ...envFor(url), ...setting, SP_LLM_CACHE_SYSTEM: '0' });
    await agent(hello); assert.equal((await agent(observation)).usage, undefined);
    assert.deepEqual(calls.at(-1).body.thinking, thinking);
    assert.deepEqual(calls.at(-1).body.output_config, effort ? { effort } : undefined);
    assert.equal(calls.at(-1).body.system[0].cache_control, undefined);
  }
  for (const setting of [
    { SP_LLM_API_FORMAT: 'unknown' }, { SP_LLM_AUTH_TYPE: 'both' }, { SP_LLM_CACHE_SYSTEM: 'yes' },
    { SP_LLM_THINKING: 'disabled', SP_LLM_REASONING_EFFORT: 'low' }, { SP_LLM_THINKING_BUDGET: '1024' },
    ...['NaN', '1023', '1024.5', '16000'].map(b => ({ SP_LLM_THINKING: 'enabled', SP_LLM_THINKING_BUDGET: b })),
    { SP_LLM_THINKING: 'enabled', SP_LLM_THINKING_BUDGET: '1024', SP_LLM_API_FORMAT: 'openai' },
    { SP_LLM_THINKING: 'enabled', SP_LLM_THINKING_BUDGET: '1024', SP_LLM_REASONING_EFFORT: 'low' },
    { SP_LLM_THINKING: 'enabled', SP_LLM_THINKING_BUDGET: '1024', SP_LLM_RETRY_EFFORT: 'low' },
    { SP_LLM_SESSION_HEADER: 'x-api-key' },
  ]) assert.throws(() => createLLMAgent({ ...envFor(url), ...setting }), /^Error: LLM configuration$/);
  assert.equal(calls.length, cases.length);
});

test('Anthropic maps the adaptive co-op policy per observation without sending adaptive as effort', async t => {
  const { url, calls } = await mock(t, res => res.end(JSON.stringify(message())));
  const agent = createLLMAgent({ ...envFor(url), SP_LLM_TIMEOUT_MS: '150000', SP_LLM_REASONING_EFFORT: 'adaptive' });
  const knowledge = { ...fixture.knowledge, modeId: 'mode_multi_abyss' };
  await agent({ ...hello, knowledge });
  for (const budget of [32000, 90000]) {
    await agent({ ...observation, public: { serverNow: 1000 }, context: { ...observation.context, deadline: 1000 + budget } });
  }
  assert.deepEqual(calls[0].body.output_config, { effort: 'low' });
  assert.equal(calls[1].body.output_config, undefined);
  assert.ok(calls.every(c => !c.body.reasoning_effort && !c.body.thinking));
});

for (const kind of ['length', 'stop', 'tool_use', 'refusal', 'pause_turn', 'stop_sequence', 'missing-stop', 'thinking-only', 'json', 'oversize', 'timeout', 'redirect']) {
  test(`Anthropic rejects ${kind} without leaking secrets or accepting partial plans`, async t => {
    const { debug } = diagnostics(t);
    let redirected = 0;
    const destination = await mock(t, res => { redirected++; res.end('{}'); });
    const { url, calls } = await mock(t, res => {
      if (kind === 'timeout') return;
      if (kind === 'redirect') { res.writeHead(302, { location: destination.url }).end('fixture-secret'); return; }
      if (kind === 'oversize') { res.end('x'.repeat(262145)); return; }
      const reply = message('{"why":"Equip.","plan":{"items":{"equip":[]}}', kind === 'length' ? 'max_tokens' : kind);
      if (kind === 'missing-stop') delete reply.stop_reason;
      if (kind === 'thinking-only') { reply.stop_reason = 'end_turn'; reply.content = [{ type: 'thinking', thinking: 'fixture-secret' }]; }
      if (kind === 'json') { reply.stop_reason = 'end_turn'; reply.content = [{ type: 'text', text: 'fixture-secret' }]; }
      res.end(JSON.stringify(reply));
    });
    const agent = createLLMAgent({ ...envFor(url), SP_LLM_AUTH_TYPE: 'x-api-key', SP_LLM_DEBUG_FILE: debug,
      SP_LLM_TIMEOUT_MS: kind === 'timeout' ? '40' : '2000' });
    await agent(hello);
    await assert.rejects(agent(observation), error => /^(incomplete|JSON|LLM request)$/.test(error.message));
    assert.equal(calls.length, kind === 'length' ? 2 : 1);
    assert.equal(redirected, 0);
    assert.ok(!readFileSync(debug, 'utf8').includes('fixture-secret'));
  });
}
