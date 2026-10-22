// test/http-limits.test.js — the configurable room / match / socket caps (server/http/config.js).
//
// The parseEnvLimit table is taken verbatim from test/lobby.test.js (authored by @xinhai-ai); the second test is the
// wiring: the environment reaches the net.js / lobby.js options while an explicit startServer() option still wins, and
// the third goes through createSessionStack so a junk SP_MAX_* is reported on the path the server actually starts on.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseEnvLimit, netOptionsFrom, lobbyOptionsFrom } from '../server/http/config.js';
import { createSessionStack } from '../server/http/websocket.js';
import { NET_DEFAULTS } from '../server/net.js';
import { LOBBY_DEFAULTS } from '../server/lobby.js';

test('parseEnvLimit: a value from the environment wins, 0 is kept as a real value, junk keeps the default', () => {
  assert.equal(parseEnvLimit(undefined, 16, 'X'), 16);
  assert.equal(parseEnvLimit('', 16, 'X'), 16);
  assert.equal(parseEnvLimit(' 25 ', 16, 'X'), 25);
  assert.equal(parseEnvLimit('0', 16, 'X'), 0, '0 is a real value: global caps reject everything, _PER_ADDR caps are unlimited');
  const warns = [];
  for (const bad of ['many', '-1', '1.5', '1e9', 'NaN']) assert.equal(parseEnvLimit(bad, 16, 'SP_MAX_ROOMS', { warn: (m) => warns.push(m) }), 16, bad);
  assert.equal(warns.length, 5);
  assert.match(warns[0], /SP_MAX_ROOMS=many ignored: a non-negative integer is required/);
  assert.equal(parseEnvLimit('50', 16, 'X'), 50);
});

test('the SP_MAX_* variables reach the lobby and net options, and an explicit option wins', () => {
  const names = ['SP_MAX_ROOMS', 'SP_MAX_ROOMS_PER_ADDR', 'SP_MAX_MATCHES_PER_ADDR', 'SP_MAX_CONNECTIONS', 'SP_MAX_CONNECTIONS_PER_ADDR'];
  const before = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  try {
    process.env.SP_MAX_ROOMS = '12';
    process.env.SP_MAX_ROOMS_PER_ADDR = '0';
    process.env.SP_MAX_MATCHES_PER_ADDR = 'junk';
    process.env.SP_MAX_CONNECTIONS = '500';
    process.env.SP_MAX_CONNECTIONS_PER_ADDR = '7';

    assert.deepEqual(lobbyOptionsFrom({}), { maxRooms: 12, maxRoomsPerAddr: 0 });
    assert.equal(netOptionsFrom({}).maxConnections, 500);
    assert.equal(netOptionsFrom({}).maxConnectionsPerAddr, 7);
    // a junk value is ignored: the option keeps whatever default net.js / lobby.js has
    assert.equal('maxMatchesPerAddr' in lobbyOptionsFrom({}), false);
    // an explicit startServer() option still wins over the environment
    assert.deepEqual(lobbyOptionsFrom({ maxRooms: 3 }), { maxRooms: 3, maxRoomsPerAddr: 0 });
    assert.equal(netOptionsFrom({ maxConnections: 9 }).maxConnections, 9);
  } finally {
    for (const k of names) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  }
});

test('a junk cap is reported on the real startup path, and the server still starts with its defaults', () => {
  const names = ['SP_MAX_ROOMS', 'SP_MAX_CONNECTIONS'];
  const before = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  const warns = [];
  const log = { warn: (m) => warns.push(m), info() {}, debug() {}, error() {} };
  try {
    process.env.SP_MAX_ROOMS = 'abc';
    process.env.SP_MAX_CONNECTIONS = '-5';
    const stack = createSessionStack({}, { data: {}, log });
    assert.equal(warns.length, 2, 'both junk values are reported when the server builds its stack');
    assert.ok(warns.some((m) => /SP_MAX_ROOMS=abc/.test(m)), 'the room cap is named');
    assert.ok(warns.some((m) => /SP_MAX_CONNECTIONS=-5/.test(m)), 'the socket cap is named');
    assert.equal(stack.lobby.opts.maxRooms, LOBBY_DEFAULTS.maxRooms, 'the default room cap stays');
    assert.equal(stack.network.opts.maxConnections, NET_DEFAULTS.maxConnections, 'the default socket cap stays');
  } finally {
    for (const k of names) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  }
});

test('a global 0 rejects everything, a per-network 0 is unlimited', () => {
  const names = ['SP_MAX_ROOMS', 'SP_MAX_ROOMS_PER_ADDR', 'SP_MAX_CONNECTIONS', 'SP_MAX_CONNECTIONS_PER_ADDR'];
  const before = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  try {
    for (const k of names) process.env[k] = '0';
    // 0 is passed through, not treated as "missing": lobby.js / net.js then compare size >= 0, which rejects every
    // room / socket for the global caps, and only guard the _PER_ADDR counters when cap > 0, i.e. unlimited there.
    assert.equal(lobbyOptionsFrom({}).maxRooms, 0, 'global room cap 0 = reject every create');
    assert.equal(lobbyOptionsFrom({}).maxRoomsPerAddr, 0, 'per-network room cap 0 = unlimited');
    assert.equal(netOptionsFrom({}).maxConnections, 0, 'global socket cap 0 = reject every upgrade');
    assert.equal(netOptionsFrom({}).maxConnectionsPerAddr, 0, 'per-network socket cap 0 = unlimited');
  } finally {
    for (const k of names) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  }
});
