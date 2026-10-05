import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { startServer, lanUrls } from '../server/index.js';

test('local connection guide reports the actual listening port and terminal LAN URLs', async (t) => {
  const service = await startServer({ port: 0, host: '0.0.0.0', quiet: true });
  t.after(() => service.close());
  const endpoint = `http://127.0.0.1:${service.port}/connect/info`;
  const response = await fetch(endpoint);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.deepEqual(await response.json(), { ok: true, port: service.port, lan: lanUrls(service.port), lanAvailable: true });
  const head = await fetch(endpoint, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('guide identifies a service restricted to loopback instead of promising LAN access', async (t) => {
  const service = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  t.after(() => service.close());
  const info = await (await fetch(`${service.url}/connect/info`)).json();
  assert.equal(info.lanAvailable, false);
  assert.equal(info.port, service.port);
});

test('LAN visitors cannot read host network information by spoofing forwarded headers', async (t) => {
  const address = Object.values(os.networkInterfaces()).flat().find((a) => a?.family === 'IPv4' && !a.internal)?.address;
  if (!address) { t.skip('No LAN interface available'); return; }
  const service = await startServer({ port: 0, host: '0.0.0.0', quiet: true });
  t.after(() => service.close());
  const response = await fetch(`http://${address}:${service.port}/connect/info`, {
    headers: { 'X-Forwarded-For': '127.0.0.1', 'X-Forwarded-Host': 'localhost' },
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, reason: 'local-only' });
});
