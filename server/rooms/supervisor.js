// Optional room processes: the primary owns sessions, placement and aggregate admission.
import { fork } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createPeer } from './peer.js';
import { clientAddress } from '../net.js';
import { LOBBY_DEFAULTS } from '../lobby.js';
import { splitUrl } from '../http/common.js';
import { roomProcessCount } from './config.js';

export { roomProcessCount } from './config.js';

const ENTRY = fileURLToPath(new URL('./entry.js', import.meta.url));
const HEALTH_MISS_LIMIT = 3;
export async function startRoomSupervisor(opts, start) {
  const count = roomProcessCount(opts.roomProcs ?? process.env.SP_ROOM_PROCS);
  // Injected constructors and functions have no meaningful cross-process representation.
  if (opts.MatchClass || opts.seedFn) throw new TypeError('room processes require serializable server options');
  const childOptions = Object.fromEntries(Object.entries(opts).filter(([key]) => !['log', 'fetch', 'routeUpgrade', 'routeRequest', 'sessionHooks', 'healthExtra', 'roomRestart', 'roomFailure'].includes(key)));
  const serializable = JSON.parse(JSON.stringify(childOptions, (_key, value) => {
    if (['function', 'symbol', 'bigint'].includes(typeof value)) throw new TypeError('room processes require serializable server options');
    return value;
  }));
  const slots = [], rooms = new Map(), admissions = new Map(), placements = new Map(), starts = new Map();
  const ownerLookups = new Map(), connectionsByKey = new Map();
  const restart = { baseMs: 100, maxMs: 5000, stableMs: 30000, maxFailures: 6,
    healthTimeoutMs: 5000, healthIntervalMs: 1000, ...opts.roomRestart };
  let srv, closing, stopping = false, booting = true, fatal = false, seq = 0;
  const log = opts.log || { info() {}, warn() {}, error() {}, debug() {} };
  function publicSession(session) {
    const { ws: _ws, ...value } = session;
    return value;
  }
  const available = (slot) => slot?.ready && !slot.dead && !slot.intentional && !slot.restarting;
  const alive = () => slots.filter(available);
  const choose = () => alive().filter((s) => !s.draining).sort((a, b) =>
    [...rooms.values()].filter((r) => r.slot === a.id).length - [...rooms.values()].filter((r) => r.slot === b.id).length || a.id - b.id)[0];
  function release(id) {
    const admission = admissions.get(id);
    if (!admission) return;
    admissions.delete(id);
    admission.slot.connections--;
    if (admission.key) {
      const remaining = connectionsByKey.get(admission.key) - 1;
      if (remaining) connectionsByKey.set(admission.key, remaining);
      else connectionsByKey.delete(admission.key);
    }
  }
  const settlePlacement = (p, reason) => { if (!p.settled) { p.settled = true; p.settle?.(reason); } };
  const placementValue = (p) => ({ id: p.id, slot: p.slot, code: p.code, at: p.at, credit: p.credit, committed: p.committed });
  async function releasePlacement(playerId, p, rollback = false) {
    if (placements.get(playerId) !== p) return;
    placements.delete(playerId);
    settlePlacement(p, 'finished');
    if (rooms.get(p.code)?.reserved) rooms.delete(p.code);
    if (p.committed && slots[p.slot]?.ready && slots[p.slot] === p.targetGeneration) {
      const slot = slots[p.slot];
      const value = { playerId, id: p.id, rollback };
      try {
        // Leave time within the source's 15-second completion budget to acknowledge failed target cleanup.
        if (rollback) applyUpdate(slot.id, await slot.peer.request('releaseEntry', value, 10000, { critical: true }));
        else await slot.peer.notify('releaseEntry', value);
      } catch { markDead(slot); slot.child.kill('SIGKILL'); }
    }
  }
  function applyUpdate(id, { sessions: changedSessions, rooms: changedRooms }) {
    for (const [playerId, value] of changedSessions) {
      const s = srv.registry.byId(playerId);
      if (s?.roomSlot !== id) continue;
      if (value) Object.assign(s, value, { roomSlot: id, ws: null });
      else srv.registry.remove(s);
    }
    for (const [code, value] of changedRooms) {
      if (value) rooms.set(code, { ...value, slot: id, reserved: false });
      else if (rooms.get(code)?.slot === id) { rooms.delete(code); starts.delete(code); }
    }
  }
  const prune = setInterval(() => {
    const now = Date.now();
    for (const slot of slots) if (available(slot) && !slot.checking) {
      slot.checking = true;
      slot.peer.request('health', null, restart.healthTimeoutMs).then((value) => {
        if (!value?.ready) throw new Error('room process is not serving');
        if (!available(slot) || slots[slot.id] !== slot || stopping) return;
        slot.healthMisses = 0;
        slot.checkedAt = Date.now();
      }).catch(() => {
        if (!available(slot) || slots[slot.id] !== slot || stopping) return;
        if (++slot.healthMisses >= HEALTH_MISS_LIMIT) { markDead(slot); slot.child.kill('SIGKILL'); }
      }).finally(() => { slot.checking = false; });
    }
    for (const [code, pending] of starts) if (pending.until <= now) starts.delete(code);
    for (const [playerId, p] of placements) if (now - p.at > 30000) {
      releasePlacement(playerId, p, !p.moved).catch(() => {});
    }
  }, restart.healthIntervalMs);
  prune.unref();
  function markDead(slot) {
    if (slot.dead) return;
    slot.dead = true; slot.ready = false;
    slot.peer.close();
    const members = new Set();
    for (const [code, r] of rooms) if (r.slot === slot.id) {
      for (const playerId of [...(r.humans || []), ...(r.spectators || [])]) members.add(playerId);
      rooms.delete(code); starts.delete(code);
    }
    for (const [id, a] of admissions) if (a.slot === slot) release(id);
    for (const [playerId, p] of placements) if (p.slot === slot.id || p.source === slot.id) {
      if (p.slot === slot.id && p.moved && p.session?.roomCode) members.add(playerId);
      if (p.slot === slot.id && p.moved && slots[p.source]?.ready) {
        // Keep the receipt for a source still awaiting its ownership ACK, so it can restore its untouched seat.
        p.targetDead = true;
        settlePlacement(p, 'target-dead');
      } else releasePlacement(playerId, p, !p.moved).catch(() => {});
    }
    for (const s of srv.registry.all()) if (s.roomSlot === slot.id) {
      const member = s.roomCode && members.has(s.playerId);
      s.connected = false; s.disconnectedAt = Date.now(); s.roomCode = null; s.roomSlot = null;
      if (member) s.notice = 'shutdown';
    }
    if (!slot.intentional) slot.failures = slot.readyAt && Date.now() - slot.readyAt >= restart.stableMs ? 1 : slot.failures + 1;
  }
  function health() {
    const live = alive();
    return { ok: !fatal && live.length > 0, contentSets: new Set([...rooms.values()].map((r) => r.cs).filter(Boolean)).size,
      roomProcesses: { requested: count, ready: live.length, stopping,
        slots: slots.map((s) => ({ slot: s.id, pid: s.child.pid ?? null, ready: !!available(s), draining: s.draining,
          connections: s.connections, healthMisses: s.healthMisses, restarting: !!s.restartTimer || !!s.restarting,
          failures: s.failures, checkedAt: s.checkedAt ?? null, lastExit: s.lastExit ?? null })) } };
  }
  function scheduleRespawn(slot) {
    if (stopping || booting || slot.intentional || slot.restartTimer || slots[slot.id] !== slot) return;
    if (slots.length === count && slots.every((s) => s.dead && s.failures >= restart.maxFailures)) {
      fatal = true;
      log.error('[rooms] no room process can be kept alive; shutting down');
      const finish = () => { if (opts.roomFailure) opts.roomFailure(); else process.exitCode = 1; };
      srv.close().then(finish, finish);
      return;
    }
    const delay = Math.min(restart.maxMs, restart.baseMs * 2 ** Math.min(16, Math.max(0, slot.failures - 1)));
    log.warn(`[rooms:${slot.id}] restarting in ${delay} ms`);
    slot.restartTimer = setTimeout(async () => {
      slot.restartTimer = null;
      if (stopping || slots[slot.id] !== slot) return;
      try {
        await stopSlot(slot, false);
        if (!stopping && slots[slot.id] === slot) await spawn(slot.id);
      }
      catch (error) { log.error(`[rooms:${slot.id}] restart failed`, error); scheduleRespawn(slots[slot.id]); }
    }, delay);
  }
  async function stopSlot(slot, graceful = true) {
    const child = slot.child;
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    try {
      if (graceful && slot.ready && child.connected) await slot.peer.request('stop').catch(() => {});
      if (child.connected) child.disconnect();
      if (!graceful) child.kill('SIGKILL');
      await exited;
    } finally { clearTimeout(timer); slot.peer.close(); }
  }
  async function spawn(id) {
    const previous = slots[id];
    const child = fork(ENTRY, [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'advanced',
      env: { ...process.env, SP_ROOM_PROCS: '1' } });
    const slot = { id, child, ready: false, dead: false, draining: previous?.draining ?? false,
      connections: 0, healthMisses: 0, failures: previous?.failures ?? 0,
      lastExit: previous?.lastExit ?? null };
    child.stderr.on('data', (data) => log.error(`[rooms:${id}] ${String(data).trim()}`));
    slots[id] = slot;
    slot.peer = createPeer(child, {
      async hello({ token, name, noReplace, claimAt }) {
        let s = srv.registry.byToken(token), fresh = false;
        const pending = s && placements.get(s.playerId);
        if (pending?.moved) {
          await pending.completion;
          if (pending.targetDead && placements.get(s.playerId) === pending) return { error: 'INTERNAL' };
          s = srv.registry.byToken(token);
        }
        if (slot.dead || slots[id] !== slot || stopping) return { error: 'INTERNAL' };
        if (s && s.roomSlot != null && s.roomSlot !== id && slots[s.roomSlot]?.ready) return { route: s.roomSlot };
        if (!s) { s = srv.registry.create(name); fresh = true; }
        if (!s) return { error: 'INTERNAL' };
        if (s.connected && (noReplace || (Number.isFinite(claimAt) && s.claimAt != null && claimAt > s.claimAt))) return { error: 'SESSION_IN_USE' };
        s.roomSlot = id;
        return { session: publicSession(s), fresh };
      },
      update(value) { applyUpdate(id, value); },
      closed({ admission }) { release(admission); },
      trustedEvent({ event, value }) {
        if (['roomCreated', 'roomClosed', 'playerJoined', 'playerLeft', 'matchStarted'].includes(event)) srv.lobby.trustedRuntime?.event(event, value);
      },
      async prepare({ playerId, msg, key, value, update }) {
        if (update) applyUpdate(id, update);
        const s = srv.registry.byId(playerId);
        if (!s || s.roomSlot !== id) return { error: 'INTERNAL' };
        const pending = placements.get(playerId);
        if (pending) return JSON.stringify(pending.msg) === JSON.stringify(msg) ? placementValue(pending) : { error: 'INTERNAL' };
        let target, code, credit = null;
        if (msg.t === 'room.create') {
          if (rooms.size >= (opts.maxRooms ?? LOBBY_DEFAULTS.maxRooms)) return { error: 'INTERNAL' };
          const previous = rooms.get(s.roomCode);
          credit = previous && !previous.running && previous.ownerKey === key
            && previous.humans?.length === 1 && previous.humans[0] === playerId && !previous.spectators?.includes(playerId) ? previous.code : null;
          if (key && [...rooms.values()].filter((r) => r.ownerKey === key && r.code !== credit).length >= (opts.maxRoomsPerAddr ?? LOBBY_DEFAULTS.maxRoomsPerAddr)
            && (opts.maxRoomsPerAddr ?? LOBBY_DEFAULTS.maxRoomsPerAddr) > 0) return { error: 'RATE' };
          target = choose();
          if (!target) return { error: 'INTERNAL' };
          code = null;
          for (let attempt = 0; attempt < 1000; attempt++) {
            const candidate = srv.lobby.genCode();
            if (candidate && !rooms.has(candidate)) { code = candidate; break; }
          }
          if (!code) return { error: 'INTERNAL' };
          rooms.set(code, { code, slot: target.id, reserved: true, ownerKey: key });
        } else {
          const r = rooms.get(String(msg.code).trim().toUpperCase());
          if (!r || r.reserved || !slots[r.slot]?.ready) return { error: 'ROOM_NOT_FOUND' };
          target = slots[r.slot]; code = r.code;
        }
        const p = { id: ++seq, slot: target.id, source: id, sourceGeneration: slot, targetGeneration: target,
          code, at: Date.now(), credit, msg, committed: false, moved: false, settled: false };
        p.completion = new Promise((resolve) => { p.settle = resolve; });
        placements.set(playerId, p);
        if (target.id !== id) {
          try {
            // Occupy the target seat before the source leaves. A disconnected player blocks starts as usual.
            p.committed = true;
            const result = await target.peer.request('admit', { id: p.id, code, value, msg });
            if (result.error) { await releasePlacement(playerId, p); return result; }
            p.session = result.session;
            if (slot.dead || placements.get(playerId) !== p) { await releasePlacement(playerId, p, true); return { error: 'INTERNAL' }; }
          } catch (error) { await releasePlacement(playerId, p, true); throw error; }
        }
        return placementValue(p);
      },
      async finish({ playerId, placement, rollback = false, restore, update }) {
        const p = placements.get(playerId);
        if (p?.id === placement && ((p.source === id && p.sourceGeneration === slot) || (p.slot === id && p.targetGeneration === slot))) {
          if (rollback && p.moved && p.source === id) {
            const s = srv.registry.byId(playerId);
            if (s && restore?.token === s.token && (s.roomSlot === p.slot || (p.targetDead && s.roomSlot == null))) {
              Object.assign(s, restore, { roomSlot: id, ws: null });
            }
          }
          if (update) applyUpdate(id, update);
          await releasePlacement(playerId, p, rollback);
        }
      },
      move({ value, target, placement }) {
        const s = srv.registry.byId(value.playerId);
        const p = placements.get(value.playerId);
        if (!s || s.roomSlot !== id || p?.id !== placement || p.slot !== target || p.sourceGeneration !== slot
          || slots[target] !== p.targetGeneration || !slots[target]?.ready) throw new Error('room route expired');
        Object.assign(s, value, { roomSlot: target, roomCode: p.session?.roomCode ?? null,
          notice: p.session?.notice ?? null, pendingResult: p.session?.pendingResult ?? null,
          connected: false, ws: null, disconnectedAt: Date.now() });
        p.moved = true;
        p.at = Date.now();
        return { expiresAt: p.at + 30000 };
      },
      begin({ code, key }) {
        const room = rooms.get(code);
        if (!room || room.slot !== id) return { error: 'ROOM_NOT_FOUND' };
        const max = opts.maxMatchesPerAddr ?? LOBBY_DEFAULTS.maxMatchesPerAddr;
        if (key && max > 0 && [...rooms.values()].filter((r) => r.code !== code
          && ((r.running && r.matchKey === key) || starts.get(r.code)?.key === key)).length >= max) return { error: 'RATE' };
        starts.set(code, { key, until: Date.now() + 30000 }); return {};
      },
      endBegin({ code, running, matchKey, update }) {
        if (update) applyUpdate(id, update);
        const room = rooms.get(code);
        if (room?.slot === id) { Object.assign(room, { running, matchKey }); starts.delete(code); }
      },
    });
    child.once('exit', (code, signal) => { slot.lastExit = { code, signal }; markDead(slot); scheduleRespawn(slot); });
    child.once('error', () => { markDead(slot); child.kill('SIGKILL'); scheduleRespawn(slot); });
    child.once('disconnect', () => { if (!stopping && !slot.intentional) { markDead(slot); child.kill('SIGKILL'); } });
    try {
      const initialized = await slot.peer.request('init', { opts: serializable, slot: id, ownerHost: srv.host, trusted: !!srv.lobby.trustedRuntime });
      if (stopping || slot.dead || slots[id] !== slot) throw new Error('room process exited during startup');
      slot.port = initialized.port;
      slot.ready = true;
      slot.readyAt = Date.now();
      return slot;
    } catch (error) {
      markDead(slot);
      await stopSlot(slot, false);
      scheduleRespawn(slot);
      throw error;
    }
  }
  function routeUpgrade(req, socket, head) {
    const reject = (status) => { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
    if (stopping) { reject('503 Service Unavailable'); return; }
    const { key } = clientAddress(req, srv.network.opts.trustProxy);
    if (admissions.size >= srv.network.opts.maxConnections) { reject('503 Service Unavailable'); return; }
    if (key && srv.network.opts.maxConnectionsPerAddr > 0 && (connectionsByKey.get(key) || 0) >= srv.network.opts.maxConnectionsPerAddr) {
      reject('429 Too Many Requests'); return;
    }
    const url = new URL(req.url, 'http://room.invalid');
    const route = url.searchParams.get('roomSlot');
    const preferred = route != null && /^\d+$/.test(route) ? slots[Number(route)] : null;
    let slot = available(preferred) ? preferred : null;
    if (!slot) for (const candidate of slots) {
      if (available(candidate) && (!slot || candidate.connections < slot.connections)) slot = candidate;
    }
    if (!slot) { reject('503 Service Unavailable'); return; }
    const admission = ++seq;
    admissions.set(admission, { slot, key });
    slot.connections++;
    if (key) connectionsByKey.set(key, (connectionsByKey.get(key) || 0) + 1);
    // pause() alone leaves the native handle reading during IPC detachment.
    socket.pause();
    const buffered = [];
    let chunk;
    while ((chunk = socket.read()) !== null) buffered.push(chunk); // loop-cap: finite already-buffered bytes
    const bytes = Buffer.concat([head, ...buffered]);
    // Draining the stream may call _read again. Stop native reads last, immediately before transfer.
    if (socket._handle) { socket._handle.reading = false; socket._handle.readStop(); }
    socket.on('error', () => {});
    try {
      slot.child.send({ type: 'room.socket', admission, url: req.url, method: req.method, headers: req.headers,
        remoteAddress: req.socket.remoteAddress, head: bytes.toString('base64') }, socket, { keepOpen: false }, (error) => {
        if (error) { release(admission); if (socket.localPort !== undefined) socket.destroy(); }
        // A successfully detached wrapper belongs to Node's connection accounting.
      });
    } catch { release(admission); if (socket.localPort !== undefined) socket.destroy(); }
  }
  function locateSet(kind, hash) {
    const key = `${kind}:${hash}`;
    if (ownerLookups.has(key)) return ownerLookups.get(key);
    if (ownerLookups.size >= 4) return Promise.reject(new Error('room content lookup busy'));
    const candidates = alive();
    const pending = Promise.all(candidates.map(async (slot) => {
      try { return { slot, known: await slot.peer.request('publicSet', { kind, hash }, 1000) }; }
      catch { return { slot, failed: true }; }
    })).then((results) => {
      if (stopping || !candidates.length) throw new Error('room content unavailable');
      const owner = results.find(({ slot, known }) => known && slot.ready && !slot.dead && slots[slot.id] === slot);
      if (owner) return owner.slot;
      if (results.some(({ slot, failed }) => failed || !slot.ready || slot.dead || slots[slot.id] !== slot)) throw new Error('room content unavailable');
      return null;
    }).finally(() => ownerLookups.delete(key));
    ownerLookups.set(key, pending);
    return pending;
  }
  function routeRequest(req, res, next) {
    if (stopping || !['GET', 'HEAD'].includes(req.method)) return false;
    const match = /^\/(cs|vs)\/([0-9a-f]{16})\//.exec(splitUrl(req.url)?.rawPath || '');
    if (!match) return false;
    if (match[1] === 'cs' && (srv.content.cs.startsWith(match[2]) || srv.contents.file(match[2], 'index.json'))) return false;
    const room = [...rooms.values()].find((r) => r[match[1]]?.startsWith(match[2]) && slots[r.slot]?.ready);
    if (room) { forwardSet(req, res, slots[room.slot]); return true; }
    // Room.state can expose a new URL before its coalesced directory update. Ask only public set managers on a miss.
    const lookup = match[1] === 'vs' ? srv.visual.doc(match[2]).then((doc) => doc ? null : locateSet(match[1], match[2])) : locateSet(match[1], match[2]);
    lookup.then((slot) => {
      if (res.destroyed) return;
      if (slot) forwardSet(req, res, slot); else next(req, res);
    }).catch(() => { if (!res.destroyed) { res.writeHead(503, { 'Content-Length': 0, 'Cache-Control': 'no-store' }); res.end(); } });
    return true;
  }
  function forwardSet(req, res, slot) {
    if (!slot.ready || slot.dead || slots[slot.id] !== slot) { res.writeHead(503, { 'Content-Length': 0 }); res.end(); return; }
    // Dynamic plugin sets belong to their room child; the same origin still serves every URL.
    const headers = {};
    for (const key of ['accept-encoding', 'if-none-match', 'if-modified-since', 'range', 'if-range']) {
      if (req.headers[key] != null) headers[key] = req.headers[key];
    }
    const upstream = http.request({ host: '127.0.0.1', port: slot.port, path: req.url, method: req.method, headers, agent: false }, (answer) => {
      if (res.destroyed) { answer.destroy(); return; }
      const responseHeaders = { ...answer.headers };
      for (const key of ['connection', 'keep-alive', 'transfer-encoding', 'trailer', 'upgrade']) delete responseHeaders[key];
      res.writeHead(answer.statusCode, responseHeaders); answer.pipe(res);
      answer.on('error', () => res.destroy());
    });
    upstream.on('error', () => {
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(503, { 'Content-Length': 0 }); res.end();
    });
    upstream.setTimeout(10000, () => upstream.destroy());
    res.on('close', () => upstream.destroy());
    upstream.end();
  }
  try {
    srv = await start({ ...opts, roomProcs: 1, routeUpgrade, routeRequest, detachedUpgrades: true, healthExtra: health,
      sessionHooks: { network: { connectionCount: () => admissions.size }, lobby: { stats: () => aggregateStats() } } });
    for (let id = 0; id < count; id++) await spawn(id);
    booting = false;
    function aggregateStats() {
      const live = [...rooms.values()].filter((r) => !r.reserved);
      return { rooms: live.length, matches: live.filter((r) => r.running).length,
        humans: live.reduce((sum, r) => sum + (r.humans?.length || 0), 0),
        bots: live.reduce((sum, r) => sum + (r.bots || 0), 0),
        spectators: live.reduce((sum, r) => sum + (r.spectators?.length || 0), 0) };
    }
    const closeBase = srv.close;
    srv.roomSupervisor = {
      rooms, slots, health,
      drain(id) { const slot = slots[id]; if (!slot?.ready) throw new Error('unknown room slot'); slot.draining = true; },
      async restart(id, { force = false } = {}) {
        if (stopping) throw new Error('room supervisor is stopping');
        const slot = slots[id]; if (!slot) throw new Error('unknown room slot');
        if (slot.restarting) throw new Error('room slot is restarting');
        slot.restarting = true;
        const wasDraining = slot.draining;
        try {
          if (slot.dead) {
            clearTimeout(slot.restartTimer); slot.restartTimer = null; slot.intentional = true;
            await stopSlot(slot, false);
            if (!stopping && slots[id] === slot) await spawn(id);
            return;
          }
          if (!slot.ready) throw new Error('room slot is starting');
          if (!force && [...rooms.values()].some((r) => r.slot === id)) throw new Error('room slot still owns rooms');
          slot.intentional = true;
          await stopSlot(slot);
          if (!stopping) await spawn(id);
        } catch (error) { if (!slot.dead) { slot.draining = wasDraining; slot.intentional = false; } throw error; }
        finally { slot.restarting = false; }
      },
    };
    srv.close = () => {
      if (closing) return closing;
      closing = (async () => {
        stopping = true;
        clearInterval(prune);
        for (const slot of slots) { clearTimeout(slot.restartTimer); slot.intentional = true; }
        await Promise.all(slots.map((s) => stopSlot(s)));
        await closeBase();
      })();
      return closing;
    };
    for (const slot of slots) if (slot.dead) scheduleRespawn(slot);
    return srv;
  } catch (error) {
    stopping = true;
    clearInterval(prune);
    await Promise.all(slots.map((s) => stopSlot(s, false)));
    if (srv) await srv.close();
    throw error;
  }
}
