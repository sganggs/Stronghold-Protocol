// The Rust Worker against the Node server of the original project: the same session and lobby messages must give the
// same frames to the same sockets, in the same order. It needs the Worker running (`npm run dev` in aldus/worker) and
// its address:
//
//   SP_WORKER_URL=ws://127.0.0.1:8870/ws node --test aldus/worker/test/conformance.test.js
//
// Without SP_WORKER_URL the suite skips. The Node server is started here, on a free port.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const WORKER_URL = process.env.SP_WORKER_URL || '';
const skip = !WORKER_URL && 'SP_WORKER_URL not set (start the Worker and give its ws:// address)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** What a frame is for the comparison: its type and the fields that are the same on every run. */
function mark(f) {
  switch (f.t) {
    case 'room.state': return `room.state(inMatch=${f.inMatch},host=${f.seats.findIndex((s) => s && s.playerId === f.hostId)},seats=${f.seats.map((s) => (s ? `${s.isBot ? 'ai' : 'h'}${s.ready ? 'R' : '-'}${s.connected ? 'C' : '-'}` : '_')).join('')},${f.mode}/${f.difficulty},spectators=${Array.isArray(f.spectators) ? f.spectators.map((x) => (x.connected ? 'C' : '-')).join('') || 'none' : 'ABSENT'})`;
    case 'welcome': return `welcome(resumed=${f.resumed},version=${f.version})`;
    case 'error': return `error(${f.code}${f.detail ? `: ${f.detail}` : ''})`;
    case 'room.closed': return `room.closed(${f.reason})`;
    case 'm.public': return `m.public(${f.phase})`;
    default: return f.t;
  }
}

/** Play the script on one server and return, for each step, what each socket received. */
async function run(url) {
  const { TestClient } = await import('../../../test/helpers/wsClient.js');
  const clients = {};
  const trace = [];
  const step = async (label, who, fn) => {
    const from = Object.fromEntries(Object.entries(clients).map(([k, c]) => [k, c.log.length]));
    try { await fn(clients[who]); } catch (e) { trace.push(`${label}: threw ${String(e.message).slice(0, 60)}`); }
    await sleep(300);
    for (const [k, c] of Object.entries(clients)) trace.push(`${label} | ${k === who ? 'sender' : 'other'} ${k}: ${c.log.slice(from[k] ?? 0).map(mark).join(', ') || '-'}`);
  };
  const lastState = (c) => c.log.filter((f) => f.t === 'room.state').pop();
  let tokenA = null;

  clients.A = await TestClient.connect(url);
  await step('ping before hello', 'A', (c) => c.request({ t: 'ping', c: 1 }));
  await step('a message before hello', 'A', (c) => c.request({ t: 'room.leave' }));
  await step('an unknown type', 'A', (c) => c.request({ t: 'nope' }));
  await step('a bad field', 'A', (c) => c.request({ t: 'room.create', mode: 'x', difficulty: 'NORMAL' }));
  await step('hello', 'A', async (c) => { tokenA = (await c.hello('Alice')).token; });
  await step('room.leave without a room', 'A', (c) => c.request({ t: 'room.leave' }));
  await step('room.join an unknown code', 'A', (c) => c.request({ t: 'room.join', code: 'ZZZZ' }));
  await step('room.create', 'A', (c) => c.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' }));
  const code = lastState(clients.A).code;
  clients.B = await TestClient.connect(url);
  await step('hello (second player)', 'B', (c) => c.hello('Bob'));
  await step('room.join', 'B', (c) => c.request({ t: 'room.join', code: code.toLowerCase() }));
  await step('room.start before the others are ready', 'A', (c) => c.request({ t: 'room.start' }));
  await step('room.ready', 'B', (c) => c.request({ t: 'room.ready', ready: true }));
  await step('room.setDifficulty by the host', 'A', (c) => c.request({ t: 'room.setDifficulty', difficulty: 'HARD' }));
  await step('room.setDifficulty by a guest', 'B', (c) => c.request({ t: 'room.setDifficulty', difficulty: 'NORMAL' }));
  await step('room.addBot', 'A', (c) => c.request({ t: 'room.addBot' }));
  await step('room.addBot again', 'A', (c) => c.request({ t: 'room.addBot' }));
  await step('room.addBot in a full room', 'A', (c) => c.request({ t: 'room.addBot' }));
  await step('room.removeBot', 'A', (c) => c.request({ t: 'room.removeBot', seat: lastState(c).seats.find((s) => s && s.isBot).seat }));
  await step('room.removeBot on a human seat', 'A', (c) => c.request({ t: 'room.removeBot', seat: 0 }));
  await step('room.loadout', 'A', (c) => c.request({ t: 'room.loadout', entries: {} }));
  await step('room.loadout with an unknown operator', 'A', (c) => c.request({ t: 'room.loadout', entries: { nope: { skill: 0 } } }));
  await step('room.ready again', 'B', (c) => c.request({ t: 'room.ready', ready: true }));
  await step('room.start', 'A', (c) => c.request({ t: 'room.start' }));
  await step('room.create in a running match', 'A', (c) => c.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' }));
  await step('g.buy in the wrong phase', 'A', (c) => c.request({ t: 'g.buy', slot: 0 }));
  await step('g.infoReady', 'A', (c) => c.request({ t: 'g.infoReady' }));
  await step('hello again on the same socket', 'A', (c) => c.hello('Alice', tokenA));
  await step('the socket of A closes', 'A', (c) => c.close());
  clients.A = await TestClient.connect(url);
  await step('hello with the token', 'A', (c) => c.hello('Alice', tokenA));
  await step('g.leave', 'B', (c) => c.request({ t: 'g.leave' }));
  await step('room.leave by the last human', 'A', (c) => c.request({ t: 'room.leave' }));
  await step('room.create solo', 'A', (c) => c.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' }));
  await step('room.addBot in a solo room', 'A', (c) => c.request({ t: 'room.addBot' }));
  await step('room.join a solo room', 'B', (c) => c.request({ t: 'room.join', code: lastState(clients.A).code }));
  await step('room.start solo', 'A', (c) => c.request({ t: 'room.start' }));
  await step('room.leave in a solo match', 'A', (c) => c.request({ t: 'room.leave' }));

  // the lobby of version 0.1.3: the host removes a player (room.kick), and the spectator seats
  let idA = null, idB = null, idC = null, tokenC = null;
  const idOf = (c, name) => lastState(c).seats.find((x) => x && x.name === name)?.playerId;
  const spectate = (c2) => (c) => c.request({ t: 'room.spectate', code: c2 });
  clients.C = await TestClient.connect(url);
  await step('hello (third player)', 'C', async (c) => { const w = await c.hello('Carol'); idC = w.playerId; tokenC = w.token; });
  await step('room.create for the next steps', 'A', (c) => c.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' }));
  const code2 = lastState(clients.A).code;
  idA = idOf(clients.A, 'Alice');
  await step('room.spectate an unknown code', 'C', spectate('ZZZZ'));
  await step('room.spectate', 'C', spectate(code2.toLowerCase()));
  await step('room.spectate again', 'C', spectate(code2));
  await step('room.ready by a spectator', 'C', (c) => c.request({ t: 'room.ready', ready: true }));
  await step('room.start by a spectator', 'C', (c) => c.request({ t: 'room.start' }));
  await step('room.loadout by a spectator', 'C', (c) => c.request({ t: 'room.loadout', entries: {} }));
  await step('room.join (the room has a spectator)', 'B', (c) => c.request({ t: 'room.join', code: code2 }));
  idB = idOf(clients.A, 'Bob');
  await step('room.spectate by a player of the room', 'B', spectate(code2));
  await step('room.removeSpectator by a guest', 'B', (c) => c.request({ t: 'room.removeSpectator', playerId: idC }));
  await step('room.removeSpectator for a player', 'A', (c) => c.request({ t: 'room.removeSpectator', playerId: idB }));
  await step('room.kick by a guest', 'B', (c) => c.request({ t: 'room.kick', seat: 0, playerId: idA }));
  await step('room.kick of the host', 'A', (c) => c.request({ t: 'room.kick', seat: 0, playerId: idA }));
  await step('room.kick with the id of another player', 'A', (c) => c.request({ t: 'room.kick', seat: 1, playerId: idC }));
  await step('room.kick on an empty seat', 'A', (c) => c.request({ t: 'room.kick', seat: 3, playerId: idB }));
  await step('room.addBot (for room.kick)', 'A', (c) => c.request({ t: 'room.addBot' }));
  await step('room.kick on an AI seat', 'A', (c) => { const ai = lastState(c).seats.find((x) => x && x.isBot); return c.request({ t: 'room.kick', seat: ai.seat, playerId: ai.playerId }); });
  await step('room.kick', 'A', (c) => c.request({ t: 'room.kick', seat: 1, playerId: idB }));
  await step('room.ready after the kick', 'B', (c) => c.request({ t: 'room.ready', ready: true }));
  await step('room.join after the kick', 'B', (c) => c.request({ t: 'room.join', code: code2 }));
  await step('room.join by a spectator of the room', 'C', (c) => c.request({ t: 'room.join', code: code2 }));
  await step('room.leave from the player seat', 'C', (c) => c.request({ t: 'room.leave' }));
  await step('room.spectate after the leave', 'C', spectate(code2));
  await step('the socket of the spectator closes', 'C', (c) => c.close());
  clients.C = await TestClient.connect(url);
  await step('hello of the spectator with the token', 'C', (c) => c.hello('Carol', tokenC));
  await step('room.removeSpectator', 'A', (c) => c.request({ t: 'room.removeSpectator', playerId: idC }));
  await step('room.leave after room.removeSpectator', 'C', (c) => c.request({ t: 'room.leave' }));
  await step('room.spectate before the match', 'C', spectate(code2));
  await step('room.ready before the match', 'B', (c) => c.request({ t: 'room.ready', ready: true }));
  await step('room.start with a spectator', 'A', (c) => c.request({ t: 'room.start' }));
  await step('g.infoReady by a spectator', 'C', (c) => c.request({ t: 'g.infoReady' }));
  await step('g.watch by a spectator', 'C', (c) => c.request({ t: 'g.watch', fieldId: `n:${idB}` }));
  await step('room.join by a spectator of a running match', 'C', (c) => c.request({ t: 'room.join', code: code2 }));
  await step('room.removeSpectator in a running match', 'A', (c) => c.request({ t: 'room.removeSpectator', playerId: idC }));
  await step('room.spectate a running match', 'C', spectate(code2));
  await step('hello again by a spectator of a running match', 'C', (c) => c.hello('Carol', tokenC));
  await step('g.leave by a spectator', 'C', (c) => c.request({ t: 'g.leave' }));
  await step('room.spectate a running match again', 'C', spectate(code2));
  await step('g.leave by a player', 'B', (c) => c.request({ t: 'g.leave' }));
  await step('g.leave by the last player: the spectator gets room.closed', 'A', (c) => c.request({ t: 'g.leave' }));
  await step('room.leave after the room closed', 'C', (c) => c.request({ t: 'room.leave' }));
  for (const c of Object.values(clients)) { try { await c.close(); } catch { /* closed */ } }
  return trace;
}

test('the Worker gives the frames the Node server gives, for the session and lobby messages', { skip, timeout: 240_000 }, async () => {
  const { startServer } = await import('../../../server/index.js');
  const node = await startServer({ port: 0, quiet: true });
  let expected;
  try {
    expected = await run(`ws://127.0.0.1:${node.port}/ws`);
  } finally {
    await node.close();
  }
  const actual = await run(WORKER_URL);
  assert.ok(expected.length > 60, `${expected.length} lines`);
  assert.ok(expected.some((l) => l.includes('m.public(INFO_CHECK)')), 'the script reaches a running match');
  // the script reaches what it is for: a player removed by the host, a spectator seat, a spectator who is told
  assert.ok(expected.some((l) => l.startsWith('room.kick |') && l.includes('room.closed(kicked)')), 'room.kick');
  assert.ok(expected.some((l) => l.includes('spectators=C')), 'a spectator seat in room.state');
  assert.ok(expected.some((l) => l.includes('error(SPECTATOR')), 'a spectator may not act');
  assert.ok(expected.some((l) => l.includes('room.closed(empty)')), 'the spectator of a room that emptied');
  assert.deepEqual(actual, expected);
});

test('the Worker says what it is on /healthz', { skip }, async (t) => {
  const res = await fetch(WORKER_URL.replace(/^ws/, 'http').replace(/\/ws$/, '/healthz'));
  assert.equal(res.status, 200);
  // the live host gives only /ws to the Worker (wrangler.toml): there /healthz is a page of the imprint
  if (!(res.headers.get('content-type') || '').includes('json')) { t.skip('this host does not give /healthz to the Worker'); return; }
  const h = await res.json();
  const { PROTOCOL_VERSION, APP_VERSION } = await import('../../../shared/constants.js');
  assert.equal(h.ok, true);
  assert.equal(h.version, PROTOCOL_VERSION);
  assert.equal(h.app, APP_VERSION);
  assert.equal(h.runtime, 'cloudflare-worker');
});
