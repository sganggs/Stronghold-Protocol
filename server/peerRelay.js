// Co-op public snapshots only. The server remains authoritative; WebRTC peers forward signed bytes.
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { ERR } from '../shared/constants.js';
import { encode, sendRaw, sendSession } from './net.js';

// [ASSUMED] Remake transport limits, not official gameplay values (docs/history/0.3.4.md §37.14).
export const P2P_LEASE_MS = 3000;
export const P2P_ACK_MS = 2500;
export const P2P_FRAME_BYTES = 60 * 1024;

/** Operator switch: peer delivery is OPT-IN. Anything but an explicit enable keeps the server's own fanout. */
export function p2pEnabledFromEnv(env = process.env) {
  const value = String(env.SP_P2P ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'on';
}

/** Validate operator-provided STUN/TURN configuration without ever logging credentials. */
export function parseIceServers(value) {
  if (!value) return [];
  const servers = JSON.parse(value);
  if (!Array.isArray(servers) || servers.length > 8) throw new Error('expected up to 8 ICE servers');
  return servers.map((server) => {
    if (!server || typeof server !== 'object' || Array.isArray(server)) throw new Error('invalid ICE server');
    const urls = typeof server.urls === 'string' ? [server.urls] : server.urls;
    if (!Array.isArray(urls) || !urls.length || urls.length > 8
      || !urls.every((url) => typeof url === 'string' && url.length <= 2048 && /^(stun|stuns|turn|turns):[^\s]+$/i.test(url))) {
      throw new Error('invalid ICE urls');
    }
    const out = { urls: [...urls] };
    for (const key of ['username', 'credential']) {
      if (server[key] === undefined) continue;
      if (typeof server[key] !== 'string' || server[key].length > 2048) throw new Error('invalid ICE credentials');
      out[key] = server[key];
    }
    return out;
  });
}

/** One small star per room. Capability and readiness are tied to a particular WebSocket. */
export class PeerRelay {
  constructor({ now = Date.now, log = { warn() {} }, enabled = p2pEnabledFromEnv(),
    iceServers, ackMs = P2P_ACK_MS } = {}) {
    this.now = now;
    this.enabled = enabled;
    this.ackMs = ackMs;
    this.capabilities = new WeakMap();
    this.rooms = new Map();
    this.keys = null;
    try { this.iceServers = iceServers ?? parseIceServers(process.env.SP_P2P_ICE_SERVERS); }
    catch { this.iceServers = []; this.enabled = false; log.warn('[p2p] Invalid SP_P2P_ICE_SERVERS; peer delivery disabled'); }
  }

  capable(session) { return this.enabled && session.connected && !!session.ws && this.capabilities.get(session) === session.ws; }

  enable(session, enabled) {
    if (enabled && this.enabled) this.capabilities.set(session, session.ws);
    else this.capabilities.delete(session);
    if (!this.capable(session)) sendSession(session, { t: 'p2p.config', enabled: false });
  }

  disconnect(session) { this.capabilities.delete(session); }

  /** Sync after every membership/socket change; repeated room-state requests also resend their config. */
  sync(room, sessions, requester = null) {
    sessions = sessions.filter((s) => s.connected && s.ws?.readyState === 1 && s.roomCode === room.code);
    const peers = room.mode === 'coop' && !room.disposed ? sessions.filter((s) => this.capable(s)) : [];
    const previous = this.rooms.get(room);
    const same = previous && previous.match === room.match && previous.matchCtx === room.matchCtx && previous.members.length === sessions.length
      && previous.members.every((m, i) => m.session === sessions[i] && m.ws === sessions[i].ws)
      && previous.peers.length === peers.length && previous.peers.every((p, i) => p.session === peers[i]);
    if (same) {
      if (requester) this.config(previous, requester);
      return previous;
    }
    if (previous) this.clear(room);
    if (peers.length < 2) {
      for (const s of peers) sendSession(s, { t: 'p2p.config', enabled: false });
      return null;
    }
    this.keys ||= generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const plan = {
      room, match: room.match, matchCtx: room.matchCtx, epoch: randomBytes(16).toString('hex'), seq: 0,
      members: sessions.map((session) => ({ session, ws: session.ws })),
      peers: peers.map((session) => ({ session, ready: false, blocked: false, leaseUntil: 0, ack: 0, pending: null, timer: null })),
    };
    this.rooms.set(room, plan);
    for (const s of peers) this.config(plan, s);
    return plan;
  }

  config(plan, session) {
    if (!plan.peers.some((p) => p.session === session)) return;
    sendSession(session, {
      t: 'p2p.config', enabled: true, epoch: plan.epoch, relayId: plan.peers[0].session.playerId,
      peers: plan.peers.map((p) => p.session.playerId), publicKey: this.keys.publicKey.export({ format: 'jwk' }),
      iceServers: this.iceServers, leaseMs: P2P_LEASE_MS,
    });
  }

  signal(room, session, msg) {
    const plan = this.rooms.get(room);
    if (msg.epoch !== plan?.epoch && this.capable(session)) return { ok: true };
    const from = plan?.peers.find((p) => p.session === session);
    const to = plan?.peers.find((p) => p.session.playerId === msg.to);
    if (!plan || msg.epoch !== plan.epoch || !from || !to || from === to
      || (from !== plan.peers[0] && to !== plan.peers[0])) return { error: ERR.BAD_TARGET };
    // The network's normal 40/s bucket applies too. Limit forwarded SDP/ICE separately to prevent room amplification.
    const now = this.now();
    if (from.signalAt === undefined || now - from.signalAt >= 1000) { from.signalAt = now; from.signals = 0; }
    if (++from.signals > 24) return { error: ERR.RATE };
    const fields = msg.description ? { description: { type: msg.description.type, sdp: msg.description.sdp } }
      : { candidate: { candidate: msg.candidate.candidate, sdpMid: msg.candidate.sdpMid, sdpMLineIndex: msg.candidate.sdpMLineIndex } };
    sendSession(to.session, { t: 'p2p.signal', epoch: plan.epoch, from: session.playerId, ...fields });
    return { ok: true };
  }

  /**
   * A receiver's once-a-second lease renewal. `seq` is the watermark of the last snapshot it APPLIED (or that the
   * state it already holds supersedes) — a client never acknowledges a frame it merely received.
   * The server still does not take that watermark as proof of delivery: see `watch()`.
   */
  ready(room, session, msg) {
    const plan = this.rooms.get(room);
    if (msg.epoch !== plan?.epoch && this.capable(session)) return { ok: true };
    const peer = plan?.peers.find((p) => p.session === session);
    if (!peer || plan.epoch !== msg.epoch || msg.seq > plan.seq || msg.seq < peer.ack) return { error: ERR.BAD_TARGET };
    if (!msg.ready) peer.blocked = false;
    if (msg.ready && peer.blocked) return { ok: true };
    peer.ack = msg.seq;
    if (!msg.ready) {
      // The route is being abandoned: whatever it had in flight goes out over WebSocket now.
      this.fallback(plan, peer);
      return { ok: true };
    }
    peer.ready = msg.ready;
    peer.leaseUntil = this.now() + P2P_LEASE_MS;
    return { ok: true };
  }

  clearPending(peer) {
    if (peer.timer) clearTimeout(peer.timer);
    peer.timer = null;
    peer.pending = null;
  }

  /**
   * The watchdog for the latest snapshot a receiver was given. It is armed once, is never postponed by a newer
   * snapshot, and is never cancelled by an acknowledgement: a self-reported sequence number is a hint about the
   * receiver's game state, not proof that it arrived. When it fires, the snapshot goes out over WebSocket
   * regardless, so a receiver that confirmed a frame it never received, lost in the channel or could not verify
   * recovers within `ackMs`. Only a receiver that confirmed nothing since the snapshot was armed loses its route.
   */
  watch(plan, peer) {
    if (peer.timer) clearTimeout(peer.timer);
    peer.timer = setTimeout(() => {
      peer.timer = null;
      if (this.rooms.get(plan.room) !== plan || !peer.pending) return;
      const confirmed = peer.ack >= peer.pending.seq || peer.ack > peer.pending.armedAck;
      if (confirmed) this.resend(plan, peer);
      else this.fallback(plan, peer, true);
    }, this.ackMs);
    peer.timer.unref?.();
  }

  /**
   * Put the pending snapshot back onto the receiver's own WebSocket and keep the route. The receiver's ACK said it
   * applied this snapshot, but a self-reported sequence is not proof — the bytes still go out, and a receiver that
   * already has them drops the duplicate by sequence.
   */
  resend(plan, peer) {
    const pending = peer.pending;
    this.clearPending(peer);
    if (!pending || peer.session.roomCode !== plan.room.code) return false;
    // The signed frame is the resync: the same bytes the relay would have forwarded.
    return sendRaw(peer.session.ws, pending.data);
  }

  /**
   * Abandon the route and put the pending snapshot onto the receiver's WebSocket. `teardown` marks the frame
   * `fallback`, which tells the client to close the channels it was listening on, and blocks the star for that
   * receiver until it reports a fresh, unready pulse.
   * @param {object} plan @param {object} peer @param {boolean} [teardown]
   */
  fallback(plan, peer, teardown = false) {
    const pending = peer.pending;
    this.clearPending(peer);
    peer.ready = false;
    peer.leaseUntil = 0;
    if (teardown) peer.blocked = true;
    if (!pending || peer.session.roomCode !== plan.room.code) return;
    sendRaw(peer.session.ws, teardown ? encode({ ...pending.frame, fallback: true }) : pending.payload);
  }

  rawFallback(room, sessions, plan) {
    // A new snapshot arrives while some receivers still have one in flight: drop the plan so the lobby's own fanout
    // serves everyone, then re-sync (which re-arms the route for the next snapshot).
    if (plan.peers.some((p) => p.pending)) {
      this.clear(room);
      this.sync(room, sessions);
    }
    return null;
  }

  /**
   * Try the peer route for one public snapshot. The relay gets the signed frame over its own WebSocket — it must
   * forward these exact bytes, so this path deliberately bypasses the state-delta transport. Every other member
   * stays in the lobby's fanout, which is the server's own reliable send.
   * @param {object} room
   * @param {import('./net.js').Session[]} sessions the room's connected members
   * @param {string} payload the encoded stamped m.public
   * @returns {Set<import('./net.js').Session> | null} the members this call took over (the lobby skips them);
   *   null leaves the whole fanout to the lobby.
   */
  broadcast(room, sessions, payload) {
    const plan = this.sync(room, sessions);
    if (!plan) return null;
    const now = this.now();
    const relay = plan.peers[0];
    const receivers = relay.ready && relay.leaseUntil > now
      ? plan.peers.slice(1).filter((p) => p.ready && p.leaseUntil > now) : [];
    if (!receivers.length) return this.rawFallback(room, sessions, plan);
    // Reserve overhead before signing: large payloads use the existing reliable WebSocket transport.
    const seq = plan.seq + 1;
    const unsigned = { t: 'p2p.frame', epoch: plan.epoch, seq, payload, signature: 'A'.repeat(88) };
    if (Buffer.byteLength(JSON.stringify(unsigned)) >= P2P_FRAME_BYTES) return this.rawFallback(room, sessions, plan);
    const signature = sign('sha256', Buffer.from(JSON.stringify([plan.epoch, seq, payload])),
      { key: this.keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
    const frame = { ...unsigned, signature };
    const data = encode(frame);
    if (!sendRaw(relay.session.ws, data)) {
      // The relay's socket cannot carry it: the route serves nobody, so it is torn down and the lobby fans out.
      this.clear(room);
      return null;
    }
    plan.seq = seq;
    const handled = new Set([relay.session]);
    for (const peer of receivers) {
      handled.add(peer.session);
      peer.pending = { seq, payload, frame, data, armedAck: peer.ack };
      if (!peer.timer) this.watch(plan, peer);
    }
    return handled;
  }

  clear(room) {
    const plan = this.rooms.get(room);
    if (!plan) return;
    this.rooms.delete(room);
    for (const peer of plan.peers) {
      this.fallback(plan, peer);
      sendSession(peer.session, { t: 'p2p.config', enabled: false });
    }
  }

  dispose() { for (const room of this.rooms.keys()) this.clear(room); }
}
