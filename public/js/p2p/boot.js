// P2P is the only play path. Every browser runs the match when it is the one the room agreed on,
// and every browser keeps a copy of everyone else's requests. Data channels form a full mesh.
// Heartbeats mark a peer down; if the browser that was applying the match goes quiet, the next
// peer rebuilds it from the saved requests and the welcomes the others stored.

import { NetError } from '../net.js';
import { createJournal, seedFromCode } from './journal.js';
import { createLoopback, createRemoteClient, createVirtualPeer } from './socket.js';
import { SimpleP2PSync, peerIdOf } from './sync.js';
import { installAssetBus } from './assetBus.js';

const DATA_FILES = [
  'config', 'chess', 'bonds', 'garrisons', 'items', 'bands', 'effects', 'choices',
  'enemies', 'factions', 'waves', 'stages', 'bosses', 'tokens', 'assets', 'emotes', 'tuning',
];
const STORE_KEY = 'sp.p2p.journal';

/** Always on. The page does not open the old /ws game socket. */
export function p2pEnabled() {
  return true;
}

/** @param {Location | { protocol: string, host: string, search: string }} [loc] */
export function signalingUrl(loc = globalThis.location) {
  try {
    const custom = new URLSearchParams(loc.search || '').get('signal');
    if (custom) return custom;
  } catch { /* ignore */ }
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${loc.host}/signal`;
}

function localReq() {
  return { socket: { remoteAddress: '127.0.0.1' }, headers: {} };
}

function randomSeed() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}

/** @param {Storage | null} storage @param {ReturnType<typeof createJournal>} journal */
function loadStored(storage, journal) {
  if (!storage) return;
  try {
    const raw = storage.getItem(STORE_KEY);
    if (raw) journal.merge(JSON.parse(raw));
  } catch { /* ignore a corrupt copy */ }
}

/** @param {Storage | null} storage @param {ReturnType<typeof createJournal>} journal */
function saveStored(storage, journal) {
  if (!storage) return;
  try { storage.setItem(STORE_KEY, JSON.stringify(journal.wire())); }
  catch { /* quota: the in-memory log still works for this tab */ }
}

/**
 * Point `net` at the mesh. Call before the first `net.connect()`.
 * @param {import('../net.js').Net} net
 * @param {{ roomCode?: string | null }} [opts]
 */
export async function installP2P(net, opts = {}) {
  const sync = new SimpleP2PSync({ peerId: peerIdOf(), signalingUrl: signalingUrl() });
  installAssetBus(sync);
  const journal = createJournal();
  const storage = (() => { try { return sessionStorage; } catch { return null; } })();
  loadStored(storage, journal);

  /** @type {string | null} peer whose browser is applying the match; null until a coop room exists */
  let leaderId = null;
  let replaying = false;
  /** @type {{ registry: any, lobby: any, network: any } | null} */
  let authority = null;
  /** @type {Promise<any> | null} */
  let booting = null;
  let authorityError = null;
  let loggedFail = false;
  /** @type {Map<string, ReturnType<typeof createVirtualPeer>>} */
  const peerSocks = new Map();
  /** @type {ReturnType<typeof createRemoteClient> | null} */
  let followerSock = null;
  /** @type {{ from: string, d: string }[]} */
  let liveQueue = [];
  /** @type {Promise<void>} */
  let gate = Promise.resolve();
  let saveTimer = 0;

  function iAmLeader() {
    return !leaderId || leaderId === sync.peerId;
  }

  function persistSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveStored(storage, journal), 400);
  }

  async function fetchGameData() {
    /** @type {Record<string, any>} */
    const out = {};
    await Promise.all(DATA_FILES.map(async (name) => {
      try {
        const res = await fetch(`/data/${name}.json`, { cache: 'no-cache' });
        if (!res.ok) {
          console.warn(`[p2p] 数据文件 /data/${name}.json 获取失败 (${res.status})`);
          return;
        }
        out[name] = await res.json();
      } catch (err) {
        console.warn(`[p2p] 数据文件 /data/${name}.json 获取失败`, err);
      }
    }));
    return out;
  }

  async function ensureAuthority() {
    if (authority && !authority.network.closed) return authority;
    if (authorityError) throw authorityError;
    if (booting) return booting;
    booting = (async () => {
      const raw = await fetchGameData();
      const missing = DATA_FILES.filter((name) => raw[name] == null);
      if (missing.length) console.warn(`[p2p] 这些数据没有加载到对局里: ${missing.join(', ')}`);
      const dataMod = await import('/engine/data.js');
      dataMod.setData(raw);
      const simMod = await import('/engine/sim/simdata.js');
      simMod.setSimData(raw);
      const netMod = await import('/engine/net.js');
      const lobbyMod = await import('/engine/lobby.js');
      const log = {
        info: (...a) => console.info('[p2p]', ...a),
        warn: (...a) => console.warn('[p2p]', ...a),
        error: (...a) => console.error('[p2p]', ...a),
        debug() {},
      };
      const registry = new netMod.SessionRegistry();
      const lobby = new lobbyMod.Lobby({
        registry,
        getData: () => dataMod.getData(),
        log,
        codeFor: () => (replaying ? journal.roomCode : null),
        seedFn: () => (replaying && journal.roomCode ? seedFromCode(journal.roomCode) : randomSeed()),
      });
      const network = new netMod.Network({ registry, handler: lobby, log });
      authority = { registry, lobby, network };
      return authority;
    })().catch((err) => {
      authorityError = err;
      throw err;
    }).finally(() => { booting = null; });
    return booting;
  }

  function failAuthority(err) {
    if (!loggedFail) { loggedFail = true; console.error('[p2p] 无法在本机启动对局', err); }
  }

  function stopAuthority() {
    const old = authority;
    authority = null;
    authorityError = null;
    if (!old) return;
    try { old.lobby.shutdown('leave'); } catch { /* ignore */ }
    try { old.network.close(); } catch { /* ignore */ }
  }

  function noteFrame(peerId, d) {
    journal.noteFrame(peerId, d);
    const welcome = journal.welcome(peerId);
    if (welcome) {
      sync.broadcast({ k: 'welcome', ...welcome });
      persistSoon();
    }
  }

  function rememberOp(from, d) {
    if (journal.addOp(from, d)) persistSoon();
  }

  /** @param {string} peerId */
  function attachPeer(peerId) {
    let sock = peerSocks.get(peerId);
    if (sock && sock.readyState === 1) return sock;
    sock = createVirtualPeer({
      send: (data) => {
        sync.sendGame(peerId, data);
        noteFrame(peerId, data);
      },
    });
    peerSocks.set(peerId, sock);
    ensureAuthority().then((auth) => {
      if (!iAmLeader() || sock.readyState === 3) return;
      auth.network.handleConnection(sock, localReq());
      sock.arm();
    }).catch(failAuthority);
    return sock;
  }

  function openLocal() {
    const pair = createLoopback();
    const clientSend = pair.client.send.bind(pair.client);
    pair.client.send = (data) => {
      clientSend(data);
      if (!replaying) {
        rememberOp(sync.peerId, data);
        sync.broadcast({ k: 'op', from: sync.peerId, d: String(data) });
      }
    };
    const serverSend = pair.server.send.bind(pair.server);
    pair.server.send = (data, cb) => {
      serverSend(data, cb);
      noteFrame(sync.peerId, String(data));
    };
    ensureAuthority().then((auth) => {
      if (pair.client.readyState === 3 || !iAmLeader()) {
        if (pair.client.readyState !== 3) pair.client.close(1000, 'switch');
        return;
      }
      auth.network.handleConnection(pair.server, localReq());
      pair.open();
    }).catch((err) => {
      failAuthority(err);
      if (pair.client.readyState !== 3) pair.client.close(1011, 'authority');
    });
    return pair.client;
  }

  function openFollower() {
    const sock = createRemoteClient();
    followerSock = sock;
    const leader = leaderId;
    sock._send = (data) => {
      if (!leaderId) return;
      rememberOp(sync.peerId, data);
      sync.sendGame(leaderId, data);
      sync.broadcast({ k: 'op', from: sync.peerId, d: String(data) }, leaderId);
    };
    queueMicrotask(() => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (sock.readyState !== 0) { clearInterval(timer); return; }
        if (leaderId && leaderId !== leader) { clearInterval(timer); sock.close(1000, 'leader changed'); return; }
        if (leader && sync.channelOpen(leader)) { clearInterval(timer); sock.markOpen(); return; }
        if (Date.now() - started > 20000) { clearInterval(timer); sock.close(1006, 'no peer'); }
      }, 50);
    });
    return sock;
  }

  sync.onGame = (from, d) => {
    if (!iAmLeader()) {
      if (from === leaderId) {
        noteFrame(sync.peerId, d);
        followerSock?.deliver(d);
      }
      return;
    }
    if (replaying) { liveQueue.push({ from, d }); return; }
    rememberOp(from, d);
    sync.broadcast({ k: 'op', from, d: String(d) }, from);
    attachPeer(from).push(d);
  };

  sync.onEnvelope = (from, env) => {
    if (!env || typeof env !== 'object') return;
    if (env.k === 'op' && typeof env.from === 'string' && typeof env.d === 'string') {
      rememberOp(env.from, env.d);
      return;
    }
    if (env.k === 'welcome' && typeof env.peerId === 'string' && typeof env.token === 'string') {
      journal.merge({ welcomes: [env], term: journal.term });
      persistSoon();
      return;
    }
    if (env.k === 'need') {
      sync.sendTo(from, { k: 'lead', id: leaderId || sync.peerId, term: journal.term });
      sync.sendTo(from, syncEnv());
      return;
    }
    if (env.k === 'sync') {
      journal.merge(env);
      persistSoon();
      if (typeof env.lead === 'string') onLead(env.lead, env.term);
      return;
    }
    if (env.k === 'lead' && typeof env.id === 'string') onLead(env.id, env.term);
  };

  sync.onUp = (peerId) => {
    if (iAmLeader() && journal.roomCode) {
      sync.sendTo(peerId, { k: 'lead', id: sync.peerId, term: journal.term });
      sync.sendTo(peerId, syncEnv());
    }
  };

  sync.onDown = (peerId) => {
    const sock = peerSocks.get(peerId);
    peerSocks.delete(peerId);
    sock?.remoteClose();
    if (peerId === leaderId) void takeover();
  };

  function onLead(id, term) {
    const nextTerm = typeof term === 'number' ? term : journal.term;
    if (id === sync.peerId) {
      if (nextTerm > journal.term) journal.term = nextTerm;
      return;
    }
    const haveRoom = !!(authority && journal.roomCode && authority.lobby.rooms.has(journal.roomCode));
    if (leaderId === sync.peerId && haveRoom && nextTerm <= journal.term) return;
    if (nextTerm < journal.term) return;
    journal.term = nextTerm;
    if (leaderId === id) return;
    leaderId = id;
    if (net.ws || net.status === 'online' || net.status === 'connecting' || net.status === 'handshaking' || net.status === 'reconnecting') {
      gate = follow(id);
    }
  }

  async function follow(id) {
    leaderId = id;
    net.reconnectNow();
    try { await whenOnline(); } catch { /* the banner shows the retry */ }
    if (leaderId === id) stopAuthority();
  }

  function smallestAlive() {
    const ids = [sync.peerId, ...sync.alivePeerIds()];
    ids.sort();
    return ids[0];
  }

  async function takeover() {
    const next = smallestAlive();
    if (next !== sync.peerId) {
      leaderId = next;
      if (sync.channelOpen(next)) await follow(next);
      return;
    }
    await assumeLeader(true);
  }

  /**
   * Rebuild the match from the requests the room saved.
   * @param {boolean} reconnect move the UI onto the rebuilt match
   */
  async function assumeLeader(reconnect) {
    if (replaying) return;
    if (authority && journal.roomCode && authority.lobby.rooms.has(journal.roomCode)) {
      leaderId = sync.peerId;
      sync.broadcast({ k: 'lead', id: sync.peerId, term: journal.term });
      return;
    }
    replaying = true;
    liveQueue = [];
    leaderId = sync.peerId;
    journal.term += 1;
    const run = (async () => {
      sync.broadcast({ k: 'need' });
      await new Promise((r) => setTimeout(r, 350));
      const auth = await ensureAuthority();
      for (const w of journal.wire().welcomes) auth.registry.importSession(w);
      /** @type {Map<string, ReturnType<typeof createLoopback>>} */
      const buckets = new Map();
      const sockFor = (from) => {
        let pair = buckets.get(from);
        if (pair) return pair;
        pair = createLoopback();
        auth.network.handleConnection(pair.server, localReq());
        pair.open();
        buckets.set(from, pair);
        return pair;
      };
      for (const op of journal.ops()) {
        let text = op.d;
        const welcome = journal.welcome(op.from);
        if (welcome) {
          try {
            const msg = JSON.parse(text);
            if (msg && msg.t === 'hello' && !msg.token) {
              msg.token = welcome.token;
              text = JSON.stringify(msg);
            }
          } catch { /* keep the original */ }
        }
        sockFor(op.from).client.send(text);
        await new Promise((r) => setTimeout(r, 0));
      }
      for (const pair of buckets.values()) {
        try { pair.client.close(1000, 'replayed'); } catch { /* ignore */ }
      }
      sync.broadcast({ k: 'lead', id: sync.peerId, term: journal.term });
      sync.broadcast(syncEnv());
      const queued = liveQueue.splice(0);
      for (const item of queued) {
        rememberOp(item.from, item.d);
        attachPeer(item.from).push(item.d);
      }
      if (reconnect) {
        net.reconnectNow();
        await whenOnline();
      }
    })().catch((err) => {
      failAuthority(err);
    }).finally(() => { replaying = false; });
    gate = run.then(() => {});
    await run;
  }

  net.WS = function P2PSocket() {
    return iAmLeader() ? openLocal() : openFollower();
  };
  net.url = 'p2p://local';

  function syncEnv() {
    return { k: 'sync', ...journal.wire(), lead: leaderId || sync.peerId };
  }

  function whenOnline(timeout = 25000) {
    if (net.status === 'online') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new NetError('P2P', '还没有连上房间里的其他人')); }, timeout);
      const off = net.on('status', (snap) => {
        if (snap.status === 'online') { clearTimeout(timer); off(); resolve(); }
        else if (snap.status === 'closed') { clearTimeout(timer); off(); reject(new NetError('CLOSED')); }
      });
    });
  }

  async function followRoom(code) {
    const room = String(code || '').trim().toUpperCase();
    if (!room) return;
    if (leaderId === sync.peerId && sync.roomCode === room && authority?.lobby.rooms.has(room)) return;
    if (leaderId && leaderId !== sync.peerId && sync.roomCode === room && sync.channelOpen(leaderId)
      && (net.status === 'online' || net.status === 'connecting' || net.status === 'handshaking')) return;
    await sync.join(room);
    const lead = sync.leadHint && sync.leadHint !== sync.peerId ? sync.leadHint : await sync.waitForLead(2500);
    if (lead && lead !== sync.peerId) await follow(lead);
  }

  const orig = net.request.bind(net);
  net.request = async (t, fields = {}, reqOpts) => {
    await gate;
    if (t === 'room.create') {
      journal.clear();
      persistSoon();
    } else if (t === 'room.join' && fields && fields.code) await followRoom(fields.code);
    return orig(t, fields, reqOpts);
  };

  net.on('room.state', (msg) => {
    if (!msg || msg.mode === 'solo') {
      if (leaderId === sync.peerId) {
        sync.leave();
        leaderId = null;
      }
      return;
    }
    if (msg.mode !== 'coop' || typeof msg.code !== 'string') return;
    journal.roomCode = msg.code;
    persistSoon();
    if (leaderId && leaderId !== sync.peerId) return;
    if (!journal.term) journal.term = 1;
    leaderId = sync.peerId;
    sync.join(msg.code).then(() => {
      sync.broadcast({ k: 'lead', id: sync.peerId, term: journal.term });
    }).catch((err) => console.warn('[p2p] 信令加入失败', err));
  });

  const pending = opts.roomCode ? String(opts.roomCode).trim().toUpperCase() : '';
  if (pending && /^[A-Z0-9]{4,8}$/.test(pending)) {
    try {
      await sync.join(pending);
      const lead = await sync.waitForLead(4000);
      if (lead && lead !== sync.peerId) leaderId = lead;
      else if (journal.roomCode === pending && journal.ops().length && sync.alivePeerIds().length === 0) await assumeLeader(false);
    } catch (err) {
      console.warn('[p2p] 信令加入失败', err);
    }
  }

  globalThis.__SP_P2P_SYNC = sync;
  return sync;
}
