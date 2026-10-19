// Room process: the game server engine, with identities and room placement owned by the primary.
import http from 'node:http';
import { startServer } from '../index.js';
import { sendSession } from '../net.js';
import { createPeer } from './peer.js';
import { createRoomUpdates } from './updates.js';
import { ignoreRoomSignals } from './signals.js';
import { createSimulationPermitClient, remoteSimulationAuthority } from './simulationClient.js';
import { configureSimulationSlices } from '../../shared/simulationSlices.js';

let srv, slot, updates, simulationClient, stopping = false;
const incoming = new Map(), bySession = new Map();
const snapshot = (session) => { const { ws: _ws, ...value } = session; return value; };
// Group signals belong to the primary, which sends room.closed and closes sockets before stopping us.
ignoreRoomSignals();
const peer = createPeer(process, {
  async init(value) {
    slot = value.slot;
    updates = createRoomUpdates(peer);
    const simulationAuthority = value.simulationPermits ? remoteSimulationAuthority(peer, () => { if (process.connected) process.disconnect(); }) : null;
    if (simulationAuthority) {
      simulationClient = createSimulationPermitClient({
        acquire: (request) => simulationAuthority.acquire('room', process.pid, request),
        cancel: (request) => simulationAuthority.cancel('room', request),
        begin: (lease) => simulationAuthority.begin('room', lease),
        release: (lease) => simulationAuthority.release('room', lease),
      });
      configureSimulationSlices(() => simulationClient.enter());
    }
    const sessionHooks = {
      sessionChanged: (session, removed) => updates.session(session, removed),
      network: { async resolveHello(msg) {
        const value = await peer.request('hello', { ...msg });
        if (!value.session) return value;
        const session = srv.registry.adopt(value.session);
        return session ? { session, resumed: !value.fresh } : { error: 'INTERNAL' };
      } },
      lobby: { roomChanged: (room, removed) => updates.room(room, removed), dispatch },
    };
    srv = await startServer({ ...value.opts, port: 0, host: '127.0.0.1', roomOwnerHost: value.ownerHost,
      roomProcs: 1, roomChild: true, quiet: true, studio: false, assetIndex: false, sessionHooks, simulationAuthority });
    if (value.trusted) srv.lobby.trustedRuntime = { event: (event, data) => peer.notify('trustedEvent', { event, value: data }).catch(() => {}) };
    return { port: srv.port };
  },
  async admit({ id, code, value, msg }) {
    const pending = incoming.get(value.playerId);
    if (pending) return pending.id === id ? { session: snapshot(pending.session) } : { error: 'INTERNAL' };
    if (srv.registry.byId(value.playerId)) return { error: 'INTERNAL' };
    const session = srv.registry.adopt({ ...value, connected: false, roomCode: null, disconnectedAt: Date.now() });
    if (!session) return { error: 'INTERNAL' };
    try {
      const result = await applyEntry(session, msg, code);
      if (result?.error) { srv.registry.remove(session); return result; }
      const room = srv.lobby.roomOf(session);
      if (room && !room.match) srv.lobby.startGrace(room, room.seatOf(session.playerId) || room.spectatorOf(session.playerId));
      incoming.set(session.playerId, { id, session, result, msg: JSON.stringify(msg) });
      return { session: snapshot(session) };
    } catch (error) {
      if (session.roomCode) srv.lobby.leave(session);
      srv.registry.remove(session);
      throw error;
    }
  },
  releaseEntry({ playerId, id, rollback }) {
    const pending = incoming.get(playerId);
    if (pending?.id === id) {
      incoming.delete(playerId);
      if (rollback) {
        if (pending.session.roomCode) srv.lobby.leave(pending.session);
        srv.registry.remove(pending.session);
      }
    }
    return rollback ? updates.snapshot() : undefined;
  },
  async stop() { stopping = true; await srv?.close(); simulationClient?.close(); updates?.close(); return true; },
  async publicSet({ kind, hash }) {
    if (!srv || stopping || !/^[0-9a-f]{16}$/.test(hash)) return false;
    if (kind === 'cs') return !!srv.contents.file(hash, 'index.json');
    return kind === 'vs' && !!await srv.visual.doc(hash);
  },
  health() { return { ready: !!srv && !stopping }; },
});
const applyEntry = (session, msg, code) => srv.lobby.dispatchMessage(session, msg, { code });
// If a required lifecycle notification cannot enter the IPC channel, end the slot. Primary exit handling
// releases every admission and reservation owned by it; request saturation never drops these events.
const lifecycle = (method, value) => peer.notify(method, value).catch(() => { if (process.connected) process.disconnect(); });
// Admission completions are acknowledged before the client can start another transaction on another child.
// They bypass ordinary request saturation, and a failed completion retires the slot without changing the result.
const complete = (method, value) => peer.request(method, value, 15000, { critical: true })
  .catch(() => { setImmediate(() => { if (process.connected) process.disconnect(); }); });
function dispatch(session, msg, next) {
  const task = (bySession.get(session.playerId) || Promise.resolve()).then(async () => {
    if (stopping || !session.connected) return { error: 'INTERNAL' };
    const { lobby, registry } = srv;
    const sourceSocket = session.ws;
    if (['room.create', 'room.join', 'room.spectate'].includes(msg.t)) {
      const admitted = incoming.get(session.playerId);
      const retrying = admitted?.msg === JSON.stringify(msg);
      if (!retrying && lobby.roomOf(session)?.match) return { error: 'ROOM_STARTED' };
      const placement = await peer.request('prepare', { playerId: session.playerId, msg, key: session.limitKey,
        value: snapshot(session), update: updates.snapshot() });
      if (placement.error) return placement;
      const finish = (rollback = false) => complete('finish', { playerId: session.playerId, placement: placement.id, rollback,
        ...(rollback ? { restore: snapshot(session) } : {}), update: updates.snapshot() });
      if (stopping || !session.connected || session.ws !== sourceSocket) { await finish(true); return { error: 'INTERNAL' }; }
      if (!retrying && lobby.roomOf(session)?.match) { await finish(true); return { error: 'ROOM_STARTED' }; }
      if (placement.credit) {
        const current = lobby.roomOf(session);
        if (!current || current.code !== placement.credit || current.activeHumans().length !== 1 || current.spectatorOf(session.playerId)) {
          await finish(true); return { error: 'RATE' };
        }
      }
      if (placement.slot !== slot) {
        let moved;
        try {
          // Commit ownership while the source seat still exists. A failed/late reply can roll back both replicas.
          moved = await peer.request('move', { value: snapshot(session), target: placement.slot, placement: placement.id });
        } catch { await finish(true); return { error: 'INTERNAL' }; }
        if (stopping || !session.connected || session.ws !== sourceSocket || !(moved?.expiresAt > Date.now())) {
          await finish(true); return { error: 'INTERNAL' };
        }
        const current = lobby.roomOf(session);
        if (current?.match) { await finish(true); return { error: 'ROOM_STARTED' }; }
        if (placement.credit && (!current || current.code !== placement.credit || current.activeHumans().length !== 1 || current.spectatorOf(session.playerId))) {
          await finish(true); return { error: 'RATE' };
        }
        if (session.roomCode) lobby.leave(session);
        registry.remove(session);
        await finish();
        // Network writes the accepted intent's OK before this route. The target already applied it, so no retry.
        setImmediate(() => sendSession(session, { t: 'room.route', slot: placement.slot }));
        return { ok: true, routeSlot: placement.slot };
      }
      try { return placement.committed && admitted?.id === placement.id ? admitted.result : await applyEntry(session, msg, placement.code); }
      finally { await finish(); }
    }
    if (msg.t === 'room.start') {
      const room = lobby.roomOf(session);
      if (room && !room.match && room.hostId === session.playerId) {
        const result = await peer.request('begin', { code: room.code, key: session.limitKey });
        if (result.error) return result;
        try { return await next(); }
        finally { await complete('endBegin', { code: room.code, running: !!room.match, matchKey: room.matchKey, update: updates.snapshot() }); }
      }
    }
    return next();
  }).finally(() => { if (srv.registry.byId(session.playerId) === session) srv.registry.changed(session); });
  const tail = task.catch(() => {});
  bySession.set(session.playerId, tail);
  tail.finally(() => { if (bySession.get(session.playerId) === tail) bySession.delete(session.playerId); });
  return task;
}
process.on('message', (msg, socket) => {
  if (msg?.type !== 'room.socket') return;
  if (!socket) { lifecycle('closed', { admission: msg.admission }); return; }
  socket.on('error', () => {});
  socket.once('close', () => lifecycle('closed', { admission: msg.admission }));
  if (!srv || stopping) { socket.destroy(); return; }
  const req = new http.IncomingMessage(socket);
  req.url = msg.url; req.method = msg.method; req.headers = msg.headers;
  srv.server.emit('upgrade', req, socket, Buffer.from(msg.head, 'base64'));
  socket.resume();
});
process.on('disconnect', async () => { stopping = true; await srv?.close(); simulationClient?.close(); updates?.close(); process.exit(0); });
