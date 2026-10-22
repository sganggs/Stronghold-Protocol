// test/http-boot-limits.test.js — the caps in effect are printed once when the session stack is built.
//
// The line is the configuration the server is running with, not a reason for a particular rejection: a global cap of 0
// therefore prints as 0 (it rejects every room / socket), while a per-network 0 prints as "unlimited".

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSessionStack } from '../server/http/websocket.js';
import { NET_DEFAULTS } from '../server/net.js';
import { LOBBY_DEFAULTS } from '../server/lobby.js';

/** Build the stack with `opts` and no SP_MAX_* in the environment; return what `log.info` was given. */
function logLines(opts = {}) {
  const saved = new Map();
  for (const k of ['SP_MAX_ROOMS', 'SP_MAX_ROOMS_PER_ADDR', 'SP_MAX_MATCHES_PER_ADDR', 'SP_MAX_CONNECTIONS', 'SP_MAX_CONNECTIONS_PER_ADDR']) {
    saved.set(k, process.env[k]);
    delete process.env[k];
  }
  const lines = [];
  const log = { info: (m) => lines.push(m), warn() {}, debug() {}, error() {} };
  try {
    createSessionStack(opts, { data: {}, log });
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return lines;
}

test('the defaults are printed as they are', () => {
  const lines = logLines();
  assert.equal(lines.length, 1, 'exactly one line on boot');
  assert.equal(lines[0], `[http] limits: rooms ${LOBBY_DEFAULTS.maxRooms} (${LOBBY_DEFAULTS.maxRoomsPerAddr}/network), `
    + `matches ${LOBBY_DEFAULTS.maxMatchesPerAddr}/network, `
    + `sockets ${NET_DEFAULTS.maxConnections} (${NET_DEFAULTS.maxConnectionsPerAddr}/network)`);
});

test('an explicit cap is printed, and a per-network 0 reads as unlimited', () => {
  const lines = logLines({ maxRooms: 5, maxConnections: 100, maxConnectionsPerAddr: 0, maxMatchesPerAddr: 0 });
  assert.equal(lines[0], '[http] limits: rooms 5 (16/network), matches unlimited/network, sockets 100 (unlimited/network)');
});

test('a global 0 is printed as 0, because it rejects every room / socket', () => {
  const lines = logLines({ maxRooms: 0, maxConnections: 0 });
  assert.match(lines[0], /rooms 0 \(16\/network\)/, 'a global room cap of 0 is not "unlimited"');
  assert.match(lines[0], /sockets 0 \(64\/network\)/, 'a global socket cap of 0 is not "unlimited"');
});
