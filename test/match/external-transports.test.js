import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { externalConfig } from '../../server/match/externalConfig.js';
import { httpDecision, StdioAI } from '../../server/ai/transport.js';
import { exampleServer } from '../../tools/ai/http.mjs';

const observation = { v: 'sp-ai/1', id: 'test', public: {}, private: { canReady: true }, context: { kind: 'prep' }, results: [] };
async function serve(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}
const request = (c, o = observation) => httpDecision(c, o, new AbortController().signal);
const stdioConfig = command => externalConfig({ transport: 'stdio', command, timeoutMs: 1500, backoffMs: 20 });

test('external configuration is explicit, bounded, credential-safe and environment-selectable', () => {
  assert.throws(() => externalConfig(undefined, {}), /TRANSPORT/);
  for (const url of ['file:///tmp/a', 'http://user:secret@localhost', 'bad', 'https://localhost/#secret']) {
    assert.throws(() => externalConfig({ transport: 'http', url }), /URL/);
  }
  for (const field of ['timeoutMs', 'maxIntents', 'maxBytes', 'failureLimit', 'backoffMs']) {
    for (const value of [0, -1, NaN, Infinity, 1e9]) assert.throws(() => externalConfig({ [field]: value }, {}, true), /invalid/);
  }
  for (const command of [null, [], 'node script.js', [''], [1]]) assert.throws(() => stdioConfig(command), /command/);
  assert.throws(() => externalConfig(undefined, { SP_EXTERNAL_AI_COMMAND: 'not json' }), /argv/);
  assert.throws(() => externalConfig({ seats: [4] }, {}, true), /seats/);
  const c = externalConfig(undefined, { SP_EXTERNAL_AI_TRANSPORT: 'http', SP_EXTERNAL_AI_URL: 'https://example.com/ai',
    SP_EXTERNAL_AI_TOKEN: 'secret', SP_EXTERNAL_AI_SEATS: '1,3', SP_EXTERNAL_AI_TIMEOUT_MS: '500' });
  assert.equal(c.timeoutMs, 500); assert.deepEqual(c.seats, [1, 3]); assert.equal(c.token, 'secret');
});

test('HTTP example on ephemeral loopback port returns human intents', async t => {
  const url = await serve(t, exampleServer());
  const result = await request(externalConfig({ transport: 'http', url }));
  assert.deepEqual(result, { v: 'sp-ai/1', id: 'test', intents: [{ t: 'g.ready', ready: true }], done: true });
});

test('HTTP POST JSON, bearer header, redirects refused without forwarding credentials', async t => {
  let visits = 0;
  const destination = await serve(t, http.createServer((_req, res) => { visits++; res.end('{}'); }));
  const url = await serve(t, http.createServer((req, res) => {
    assert.equal(req.method, 'POST'); assert.equal(req.headers.authorization, 'Bearer private-token');
    let body = ''; req.on('data', chunk => { body += chunk; });
    req.on('end', () => { assert.deepEqual(JSON.parse(body), observation); res.writeHead(302, { location: destination }).end(); });
  }));
  await assert.rejects(request(externalConfig({ transport: 'http', url }, { SP_EXTERNAL_AI_TOKEN: 'private-token' })));
  assert.equal(visits, 0);
});

for (const mode of ['oversized', 'malformed', 'status', 'stall', 'disconnect']) {
  test(`HTTP bounds and errors: ${mode}`, async t => {
    const url = await serve(t, http.createServer((req, res) => {
      if (mode === 'oversized') res.end('x'.repeat(2048));
      if (mode === 'malformed') res.end('{');
      if (mode === 'status') res.writeHead(500).end();
      if (mode === 'disconnect') req.socket.destroy();
    }));
    await assert.rejects(request(externalConfig({ transport: 'http', url, timeoutMs: 40, maxBytes: 1024 })));
  });
}

test('stdio example is long-lived, multiplexes IDs and terminates on close', async t => {
  const c = new StdioAI(stdioConfig([process.execPath, 'tools/ai/stdio.mjs']));
  t.after(() => c.close());
  const replies = await Promise.all(['a', 'b'].map(id => c.request({ ...observation, id }, new AbortController().signal)));
  assert.deepEqual(replies.map(r => r.id), ['a', 'b']);
  const child = c.child;
  const later = await c.request(observation, new AbortController().signal);
  assert.equal(c.child, child); assert.equal(later.intents[0].t, 'g.ready');
  const exited = once(child, 'exit'); c.close(); await exited;
  assert.equal(c.pending.size, 0); assert.equal(c.child, null);
});

for (const script of ['process.exit(1)', 'process.stdin.on("data",()=>process.stdout.write("broken\\n"))',
  'process.stdin.on("data",()=>process.stdout.write("x".repeat(70000)))', 'process.stdin.resume()']) {
  test(`stdio failure, bounded wait and backoff: ${script.slice(0, 24)}`, async t => {
    const c = new StdioAI({ ...stdioConfig([process.execPath, '-e', script]), timeoutMs: 100 });
    t.after(() => c.close());
    await assert.rejects(c.request(observation, new AbortController().signal));
    assert.equal(c.child, null);
    await assert.rejects(c.request(observation, new AbortController().signal), /backoff/);
    await delay(25);
    c.config.command = [process.execPath, 'tools/ai/stdio.mjs'];
    c.config.timeoutMs = 1500;
    assert.equal((await c.request(observation, new AbortController().signal)).done, true);
  });
}

test('stdio abort rejects all in-flight requests and kills the child', async t => {
  const c = new StdioAI(stdioConfig([process.execPath, '-e', 'process.stdin.resume()']));
  t.after(() => c.close());
  const a = new AbortController();
  const results = Promise.allSettled([c.request(observation, a.signal), c.request({ ...observation, id: 'b' }, new AbortController().signal)]);
  a.abort();
  assert.ok((await results).every(r => r.status === 'rejected'));
  assert.equal(c.pending.size, 0);
});
