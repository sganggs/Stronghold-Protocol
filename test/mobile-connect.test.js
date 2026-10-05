import test from 'node:test';
import assert from 'node:assert/strict';
import { isLoopbackHost, normalizeRemoteUrl, probeRemoteGame } from '../public/js/connect.js';

test('mobile entry recognises loopback hosts, including mapped IPv4', () => {
  for (const host of ['localhost', 'localhost.', 'host.localhost.', '127.0.0.1', '127.255.255.255', '::1', '[::1]', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1', '::ffff:7f00:1']) {
    assert.equal(isLoopbackHost(host), true, host);
  }
  for (const host of ['192.168.1.2', 'game.test', '127.game.test', '::ffff:c0a8:102']) {
    assert.equal(isLoopbackHost(host), false, host);
  }
});

test('remote URL normalisation accepts web URLs and rejects local or unsafe targets', () => {
  assert.equal(normalizeRemoteUrl('https://game.test:50594/path').startsWith('https://game.test:50594/path'), true);
  assert.equal(normalizeRemoteUrl('game.test'), 'http://game.test/');
  for (const value of ['', 'javascript:alert(1)', 'ftp://game.test', 'http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
    assert.equal(normalizeRemoteUrl(value), null, value);
  }
});

test('remote input accepts network addresses and rejects plain text, credentials and ambiguous IP forms', () => {
  for (const address of ['https://game.test/path?room=ABCD', 'game.test:8080', '192.168.1.3:3000', 'https://[2001:db8::2]:8443/', 'https://游戏.中国/']) {
    assert.ok(normalizeRemoteUrl(address), address);
  }
  for (const value of ['Doctor', '博士代号', '12345', 'hello world', 'foo_bar.test', 'https://-game.test',
    'https://user:pass@game.test/', 'http://game.test:0', 'http://game.test:70000', 'http://game.test/path with spaces',
    '<https://game.test>', 'http://2130706433', 'http://0x7f000001', 'http://0177.0.0.1', 'http://127.1',
    'http://host.localhost/', 'http://host.localhost./', 'http://[::]/', 'http://[::ffff:7f00:1]/', 'http://game.test\\@localhost/', 'data:text/html,game']) {
    assert.equal(normalizeRemoteUrl(value), null, value);
  }
});

test('invalid remote input cannot issue a request even when called outside the title screen', async () => {
  let calls = 0;
  const result = await probeRemoteGame('Doctor', { fetchFn: async () => { calls++; throw new Error('must not request'); } });
  assert.equal(calls, 0);
  assert.equal(result.reason, 'invalid-url');
  assert.equal(result.blocked, false);
});

test('remote probe reports game, ordinary page, and blocked responses', async () => {
  const okFetch = async () => ({ ok: true, status: 200, json: async () => ({ reachable: true, valid: true, blocked: false, reason: 'game' }) });
  assert.deepEqual(await probeRemoteGame('https://game.test/', { fetchFn: okFetch }), { reachable: true, valid: true, blocked: false, reason: 'game' });

  const ordinaryFetch = async () => ({ ok: true, status: 200, json: async () => ({ reachable: true, valid: false, blocked: false, reason: 'not-game' }) });
  assert.equal((await probeRemoteGame('https://page.test/', { fetchFn: ordinaryFetch })).valid, false);

  const blockedFetch = async () => { const e = new Error('timeout'); e.name = 'AbortError'; throw e; };
  assert.equal((await probeRemoteGame('https://blocked.test/', { fetchFn: blockedFetch })).blocked, true);
});
