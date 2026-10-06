// test/ipv6-bind.test.js — IPv6 is opted into with `HOST=::`, and the share list is IPv6-aware.
//
// The default bind stays `0.0.0.0` (IPv4 only). A machine that happens to have a public IPv6 prefix and an open
// firewall must not start answering the whole internet the moment it upgrades, so dual-stack is opt-in (review of
// #188). Setting `HOST=::` buys a single dual-stack socket — Node keeps `ipv6Only` off for `::` — so the same port
// answers IPv6 *and* IPv4 and every existing IPv4 setup keeps working exactly as before.
//
// What this file pins down:
//   * the defaults really are `0.0.0.0` in every entry point (server, the Windows runner/installer, the launcher,
//     doctor, the Dockerfile, the README table), while `HOST=::` really gives one dual-stack socket;
//   * the share list (server/index.js `lanUrls` and doctor's `classifyAddresses`) never offers an address a friend
//     cannot open — no link-local, no Teredo, no 6to4, no documentation range — through ONE rule (shared/ipv6.js);
//   * a host the machine cannot bind at all is not read as "the port is taken" (probePort / scripts/launch.mjs).
//
// Address handling itself (the `::ffff:` IPv4-mapped form, /64 limit keys, local/private detection) lives in
// server/net.js and is covered by test/lobby.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyAddresses, hostUrl, probePort } from '../tools/doctor.mjs';
import { ipv6Kind, isShareableIpv6 } from '../shared/ipv6.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = (p) => readFileSync(join(ROOT, p), 'utf8');

test('every entry point keeps the 0.0.0.0 default, and :: is offered as the opt-in', () => {
  assert.match(doc('server/index.js'), /export const DEFAULT_BIND_HOST = '0\.0\.0\.0';/);
  assert.match(doc('server/index.js'), /export const DUAL_STACK_HOST = '::';/);
  assert.match(doc('server/index.js'), /opts\.host \|\| process\.env\.HOST\) \|\| DEFAULT_BIND_HOST/);
  assert.ok(!/^\s*set "HOST=/m.test(doc('scripts/run-server.cmd')), 'run-server.cmd leaves HOST to the server default');
  assert.match(doc('scripts/install-service-windows.ps1'), /\[string\]\$BindHost = '0\.0\.0\.0',/);
  assert.match(doc('scripts/launch.mjs'), /process\.env\.HOST \|\| '0\.0\.0\.0'/);
  assert.match(doc('tools/doctor.mjs'), /process\.env\.HOST \|\| '0\.0\.0\.0'/);
  assert.match(doc('Dockerfile'), /HOST=0\.0\.0\.0/);
  assert.match(doc('README.md'), /\| `HOST` \| `0\.0\.0\.0` \|/);
  // The dual-stack address is documented rather than defaulted: both docs spell out the `::` opt-in.
  assert.match(doc('README.md'), /`::`/, 'README documents the `::` opt-in');
  assert.match(doc('docs/DEPLOY.md'), /HOST=::/, 'DEPLOY documents the `HOST=::` opt-in');
});

test('shared/ipv6.js: the kinds the share list is built on', () => {
  assert.equal(ipv6Kind('fe80::320d:9eff:fe07:e79a'), 'linklocal');
  assert.equal(ipv6Kind('fd00::5'), 'ula');
  assert.equal(ipv6Kind('240e:3b7:8c4:40f0:bb2b:c23f:a265:a95d'), 'global');
  assert.equal(ipv6Kind('2001:0:4136:e378:8000:63bf:3fff:fdd2'), 'teredo');
  assert.equal(ipv6Kind('2001::1'), 'teredo', 'the compressed form of 2001:0::1 is Teredo too');
  assert.equal(ipv6Kind('2001:db8::1'), 'doc');
  assert.equal(ipv6Kind('2002:c0a8:101::1'), '6to4');
  assert.equal(ipv6Kind('ff02::1'), 'other', 'multicast is not an address to hand out');
  assert.equal(ipv6Kind('1.2.3.4'), 'other', 'an IPv4 literal is not an IPv6 one');
  assert.equal(ipv6Kind('::1'), 'other');
  assert.equal(isShareableIpv6('240e:3b7:8c4:40f0::1'), true, 'global unicast is the way in from the internet');
  assert.equal(isShareableIpv6('fd00::5'), true, 'fc00::/7 ULA is the IPv6 RFC 1918');
  for (const bad of ['fe80::1', '2001:0:4136:e378::1', '2001:db8::1', '2002:c0a8:101::1', '1.2.3.4', '']) {
    assert.equal(isShareableIpv6(bad), false, `${bad} is not an address to hand to a friend`);
  }
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
    v6('以太网', 'fe80::1', '240e:3b7:8c4:40f0:bb2b:c23f:a265:a95d', '240e:3b7:8c4:40f0:7c4a:8d15:f95:fc16', 'fd00::5', '2001:0:4136:e378:8000:63bf:3fff:fdd2'),
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
  assert.equal(kindOf('2001:0:4136:e378:8000:63bf:3fff:fdd2'), 'virtual', 'nor is a Teredo tunnel (#188 review)');
  assert.equal(list.filter((a) => a.kind === 'public').length, 1, 'the two addresses of one /64 collapse into one');
  assert.ok(!list.some((a) => a.address === '::1'), 'loopback is internal');
  assert.ok(list.every((a) => a.address.includes(':') ? a.kind : true), 'every IPv6 address got a kind');
});

test('lanUrls: IPv4 first, then IPv6 — bracketed, one URL per /64, and only on a family that host listens on', async () => {
  const { lanUrls } = await import('../server/index.js');
  const v6 = (address) => ({ family: 'IPv6', address, internal: false });
  const ifaces = {
    以太网: [
      { family: 'IPv4', address: '192.168.110.89', internal: false },
      v6('fe80::320d:9eff:fe07:e79a'),
      v6('240e:3b7:8c4:40f0:bb2b:c23f:a265:a95d'),
      v6('240e:3b7:8c4:40f0:7c4a:8d15:f95:fc16'), // the same /64 — one URL is enough
      v6('2001:0:4136:e378:8000:63bf:3fff:fdd2'), // Teredo
      v6('2001:db8::1'),                          // documentation
      v6('2002:c0a8:101::1'),                     // 6to4
      v6('::1'),
    ],
  };
  // HOST=:: — one dual-stack socket answers both families, so both are worth sharing
  assert.deepEqual(lanUrls(3000, '::', ifaces), [
    'http://192.168.110.89:3000',
    'http://[240e:3b7:8c4:40f0:bb2b:c23f:a265:a95d]:3000',
  ]);
  // The default 0.0.0.0 is IPv4-only: an IPv6 URL would point at a socket that is not listening — a friend just waits
  // for a timeout. The share list must not offer one (review of #188).
  assert.deepEqual(lanUrls(3000, '0.0.0.0', ifaces), ['http://192.168.110.89:3000']);
  assert.deepEqual(lanUrls(3000, undefined, ifaces), ['http://192.168.110.89:3000'], 'the default host is 0.0.0.0');
  for (const host of ['127.0.0.1', '192.168.110.89', 'localhost']) {
    assert.deepEqual(lanUrls(3000, host, ifaces).filter((u) => u.includes('[')), [], `${host} listens on IPv4 only`);
  }
  // The same invariant against the real interfaces of this machine: default settings, so no bracketed URL at all.
  for (const u of lanUrls(3000)) assert.match(u, /^http:\/\/\d{1,3}(?:\.\d{1,3}){3}:3000$/, u);
  for (const u of lanUrls(3000, '::')) assert.match(u, /^http:\/\/(\[[0-9a-fA-F:]+\]|\d{1,3}(?:\.\d{1,3}){3}):3000$/, u);
});

test('shareTargets: doctor and launcher drop IPv6 unless the server listens on IPv6 (#188 review)', async () => {
  const { shareTargets, isShareTarget } = await import('../tools/doctor.mjs');
  const ifaces = {
    以太网: [
      { family: 'IPv4', address: '192.168.1.7', internal: false },
      { family: 'IPv6', address: '240e:3b7:8c4:40f0::1000', internal: false },
    ],
  };
  assert.deepEqual(shareTargets('0.0.0.0', ifaces).map((a) => a.address), ['192.168.1.7'], 'the default bind: IPv4 only');
  assert.deepEqual(shareTargets(undefined, ifaces).map((a) => a.address), ['192.168.1.7'], 'undefined host = the default');
  assert.deepEqual(shareTargets('::', ifaces).map((a) => a.address), ['192.168.1.7', '240e:3b7:8c4:40f0::1000']);
  assert.equal(isShareTarget({ kind: 'public', address: '240e:3b7:8c4:40f0::1' }, '0.0.0.0'), false);
  assert.equal(isShareTarget({ kind: 'public', address: '240e:3b7:8c4:40f0::1' }, '::'), true);
  assert.equal(isShareTarget({ kind: 'public', address: '1.2.3.4' }, '0.0.0.0'), true, 'IPv4 still travels');
  assert.equal(isShareTarget({ kind: 'virtual', address: '2001:db8::1' }, '::'), false, 'a non-shareable kind never does');
  assert.equal(isShareTarget({ kind: 'linklocal', address: 'fe80::1' }, '::'), false);
});

test('probePort: a host this machine cannot bind is not read as "port in use"', async () => {
  const freePort = await new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '0.0.0.0', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
  assert.equal((await probePort(freePort, '0.0.0.0')).state, 'free');
  // 2001:db8::1234 is on no interface, so the listen fails with EADDRNOTAVAIL (EAFNOSUPPORT on a machine with IPv6
  // switched off). That must fall back to 0.0.0.0 like the server does, not report the port as taken (#188 review).
  assert.equal((await probePort(freePort, '2001:db8::1234')).state, 'free', 'bind-unavailable falls back to 0.0.0.0');

  // A port that really is held still reads as busy through the same fallback.
  const holder = net.createServer();
  await new Promise((r) => holder.listen(0, '0.0.0.0', r));
  try {
    assert.equal((await probePort(holder.address().port, '2001:db8::1234')).state, 'busy');
  } finally { holder.close(); }
});

test('HOST=:: is one dual-stack socket: IPv6 and IPv4 answer on the same port', async (t) => {
  // A host without IPv6 at all is not a failure — the socket falls back to IPv4 on purpose (see probePort above).
  const hasV6 = await new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(0, '::', () => probe.close(() => resolve(true)));
  });
  if (!hasV6) { t.skip('this host has no IPv6'); return; }

  const saved = process.env.HOST;
  const { startServer } = await import('../server/index.js');
  const get = (port, host) => new Promise((resolve) => {
    const req = http.get({ host, port, path: '/healthz' }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', (e) => resolve(e.code || 0));
  });
  try {
    // The default stays IPv4-only, exactly as before this change.
    delete process.env.HOST;
    const plain = await startServer({ port: 0, quiet: true });
    try {
      assert.equal(plain.host, '0.0.0.0', 'the default bind host');
      assert.equal(await get(plain.port, '127.0.0.1'), 200, 'IPv4 reaches it');
    } finally { await plain.close(); }

    // The opt-in: one socket, both families.
    process.env.HOST = '::';
    const dual = await startServer({ port: 0, quiet: true });
    try {
      assert.equal(dual.host, '::', 'HOST=:: is taken literally');
      assert.equal(dual.server.address().family, 'IPv6', 'bound as IPv6');
      assert.match(dual.url, /^http:\/\/localhost:\d+$/);
      assert.equal(await get(dual.port, '::1'), 200, 'IPv6 loopback reaches the server');
      assert.equal(await get(dual.port, '127.0.0.1'), 200, 'and IPv4 does too — one socket serves both families');
    } finally { await dual.close(); }
  } finally {
    if (saved === undefined) delete process.env.HOST; else process.env.HOST = saved;
  }
});
