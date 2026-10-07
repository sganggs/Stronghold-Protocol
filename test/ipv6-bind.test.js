// test/ipv6-bind.test.js — the dual-stack default (docs/IPV6.md).
//
// The server binds '::' when neither `opts.host` nor `HOST` is set: Node keeps `ipv6Only` off for `::`, so ONE socket
// answers IPv6 *and* IPv4. That is what lets a household with a public IPv6 prefix be reachable without a tunnel, a
// second listener or a port forward (IPv6 has no NAT — only the inbound firewall matters), while every existing IPv4
// setup keeps working exactly as before. 0.2.0 split the entry point, so the default lives in server/http/config.js
// (`DEFAULT_BIND_HOST` / `bindCandidates`), the address list in server/http/boot.js (`lanUrls`) and the URL shape in
// tools/doctor.mjs (`hostUrl`).
//
// Three things this file pins down:
//   * the defaults really are '::' in every entry point (server config, the Windows runner/installer, the launcher,
//     doctor, the Dockerfile, the README table) — a revert to '0.0.0.0' should turn up here;
//   * an IPv6 literal is never handed out as a URL without brackets: `http://240e:…:3000` is not something a browser
//     (or a friend) can open, and doctor.mjs / launch.mjs / the banner all go through hostUrl() / lanUrls();
//   * the fallback that keeps a host without IPv6 booting: only the default is retried, on the three errors that mean
//     "this kernel has no IPv6", and the returned `host` is the address that was really bound.
//
// Address handling itself (the `::ffff:` IPv4-mapped form, /64 limit keys, local/private detection) lives in
// server/net.js and is covered by test/lobby.test.js; the classification is covered by test/doctor.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyAddresses, hostUrl } from '../tools/doctor.mjs';
import { DEFAULT_BIND_HOST, listenAddress, bindCandidates } from '../server/http/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = (p) => readFileSync(join(ROOT, p), 'utf8');

test('every entry point defaults to the dual-stack bind', () => {
  // both files are checked because the default moved into http/config.js in 0.2.0 while the banner stayed in boot.js
  assert.match(doc('server/http/config.js'), /export const DEFAULT_BIND_HOST = '::';/);
  assert.match(doc('server/http/config.js'), /opts\.host \|\| process\.env\.HOST\) \|\| DEFAULT_BIND_HOST/);
  assert.match(doc('server/http/boot.js'), /for \(const u of lanUrls\(srv\.port\)\)/);
  assert.match(doc('scripts/run-server.cmd'), /^\s*set "HOST=::"$/m);
  assert.match(doc('scripts/install-service-windows.ps1'), /\[string\]\$BindHost = '::',/);
  assert.match(doc('scripts/launch.mjs'), /process\.env\.HOST \|\| '::'/);
  assert.match(doc('tools/doctor.mjs'), /process\.env\.HOST \|\| '::'/);
  assert.match(doc('Dockerfile'), /HOST=::/);
  assert.match(doc('README.md'), /\| `HOST` \| `::` \|/);
});

test('listenAddress: the option wins over the environment, the environment over the default', () => {
  // process.env.HOST is whatever this machine set, so the no-option case is only asserted when it is unset (the
  // dual-stack test below clears it on purpose and goes all the way through startServer()).
  if (!process.env.HOST) assert.deepEqual(listenAddress({}), { port: 3000, host: DEFAULT_BIND_HOST });
  assert.equal(listenAddress({ port: 0 }).port, 0, 'port 0 is a real port (an ephemeral one)');
  assert.equal(listenAddress({ host: '127.0.0.1' }).host, '127.0.0.1', 'the option wins');
  assert.equal(listenAddress({ host: '' }).host, DEFAULT_BIND_HOST, 'an empty host is no host');
  assert.throws(() => listenAddress({ port: 70000 }), RangeError);
});

test('bindCandidates: only the default is retried, an explicit host is literal', () => {
  assert.deepEqual(bindCandidates(DEFAULT_BIND_HOST), ['::', '0.0.0.0'], 'the default falls back to IPv4 only');
  assert.deepEqual(bindCandidates('0.0.0.0'), ['0.0.0.0'], 'HOST=0.0.0.0 asks for IPv4, not for a retry');
  assert.deepEqual(bindCandidates('127.0.0.1'), ['127.0.0.1']);
  assert.deepEqual(bindCandidates('192.168.1.7'), ['192.168.1.7']);
});

test('hostUrl: only an IPv6 literal gets brackets', () => {
  assert.equal(hostUrl('192.168.1.7', 3000), 'http://192.168.1.7:3000');
  assert.equal(hostUrl('100.64.0.9', 3000), 'http://100.64.0.9:3000');
  assert.equal(hostUrl('240e:3b7:8c4:40f0::1000', 3000), 'http://[240e:3b7:8c4:40f0::1000]:3000');
  assert.equal(hostUrl('fe80::320d:9eff:fe07:e79a', 8080), 'http://[fe80::320d:9eff:fe07:e79a]:8080');
});

test('classifyAddresses: IPv6 kinds, and one entry per /64', () => {
  const v6 = (name, ...addresses) => [name, addresses.map((address) => ({ family: 'IPv6', address, internal: false }))];
  const list = classifyAddresses(Object.fromEntries([
    v6('以太网', 'fe80::1', '240e:3b7:8c4:40f0:bb2b:c23f:a265:a95d', '240e:3b7:8c4:40f0:7c4a:8d15:f95:fc16', 'fd00::5'),
    v6('vEthernet (Default Switch)', '2001:db8::1', '2002:c0a8:101::1'),
    v6('Tailscale', 'fd7a:115c:a1e0::1'),
    ['Loopback Pseudo-Interface 1', [{ family: 'IPv6', address: '::1', internal: true }]],
  ]));
  const kindOf = (address) => list.find((a) => a.address === address)?.kind;
  assert.equal(kindOf('240e:3b7:8c4:40f0:bb2b:c23f:a265:a95d'), 'public', 'global unicast is the way in from the internet');
  assert.equal(kindOf('fe80::1'), 'linklocal', 'link-local needs a zone id a URL cannot carry');
  assert.equal(kindOf('fd00::5'), 'lan', 'fc00::/7 ULA is the IPv6 RFC 1918');
  assert.equal(kindOf('fd7a:115c:a1e0::1'), 'vpn', 'Tailscale keeps its own kind (the name rule still wins)');
  assert.equal(kindOf('2001:db8::1'), 'virtual', 'the documentation range is never handed to anyone');
  assert.equal(kindOf('2002:c0a8:101::1'), 'virtual', '6to4 is a deprecated tunnel, not a usable address');
  assert.equal(list.filter((a) => a.kind === 'public').length, 1, 'the two addresses of one /64 collapse into one');
  assert.ok(!list.some((a) => a.address === '::1'), 'loopback is internal');
  assert.ok(list.every((a) => a.address.includes(':') ? a.kind : true), 'every IPv6 address got a kind');
});

test('lanUrls never returns an IPv6 literal without brackets', async () => {
  const { lanUrls } = await import('../server/index.js');
  const urls = lanUrls(3000);
  for (const u of urls) assert.match(u, /^http:\/\/(\[[0-9a-fA-F:]+\]|\d{1,3}(?:\.\d{1,3}){3}):3000$/, u);
  // And link-local is useless to a friend (a URL cannot carry the zone id), so it is left out.
  assert.ok(!urls.some((u) => u.includes('[fe80:')), 'no link-local URLs');
});

test('the default bind is one dual-stack socket: IPv6 and IPv4 answer on the same port', async (t) => {
  // A host without IPv6 at all is not a failure — the server falls back to IPv4 only on purpose. Skip there instead.
  const hasV6 = await new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(0, '::', () => probe.close(() => resolve(true)));
  });
  if (!hasV6) { t.skip('this host has no IPv6'); return; }

  const saved = process.env.HOST;
  delete process.env.HOST;
  const { startServer } = await import('../server/index.js');
  const srv = await startServer({ port: 0, quiet: true });
  try {
    assert.equal(srv.host, '::', 'the default bind host');
    const address = srv.server.address();
    assert.equal(address.family, 'IPv6', 'bound as IPv6');
    assert.match(srv.url, /^http:\/\/localhost:\d+$/);
    const get = (host) => new Promise((resolve) => {
      const req = http.get({ host, port: srv.port, path: '/healthz' }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', (e) => resolve(e.code || 0));
    });
    assert.equal(await get('::1'), 200, 'IPv6 loopback reaches the server');
    assert.equal(await get('127.0.0.1'), 200, 'and IPv4 does too — one socket serves both families');
  } finally {
    await srv.close();
    if (saved === undefined) delete process.env.HOST; else process.env.HOST = saved;
  }
});
