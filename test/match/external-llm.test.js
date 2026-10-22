import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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

test('LLM adapter uses a stable cached system prefix, compact digest, JSON mode and numeric usage', async t => {
  const calls = [];
  const url = await mock(t, (req, res) => {
    // The playbook makes the prefix span more chunks; decode split Chinese UTF-8 sequences incrementally.
    req.setEncoding('utf8');
    let body = ''; req.on('data', b => { body += b; }); req.on('end', () => {
      calls.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"economy":{"maxRefreshes":2}}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 80 } } }));
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
