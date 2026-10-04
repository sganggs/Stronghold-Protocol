// Full mesh for one room. Signaling carries only SDP and ICE. Game traffic and the saved
// request log travel on data channels. The peer with the lexicographically smaller peerId offers,
// so two browsers never glare. A heartbeat on each channel is the liveness test: miss it and the
// peer is down, and the next one can rebuild the match from the log the others kept.

import { createReassembler, decodeData, framedSend } from './frame.js';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const BEAT_MS = 2000;
const DEAD_MS = 6500;

/** @param {string} [storageKey] */
export function peerIdOf(storageKey = 'sp.p2p.peer') {
  try {
    const cur = sessionStorage.getItem(storageKey);
    if (cur && /^[A-Za-z0-9_-]{1,64}$/.test(cur)) return cur;
    const buf = new Uint8Array(8);
    crypto.getRandomValues(buf);
    let id = 'peer_';
    for (const b of buf) id += b.toString(16).padStart(2, '0');
    sessionStorage.setItem(storageKey, id);
    return id;
  } catch {
    return `peer_${Date.now().toString(36)}`;
  }
}

/** The smaller id creates the data channel. @param {string} self @param {string} other */
export function shouldOffer(self, other) {
  return String(self) < String(other);
}

export class SimpleP2PSync {
  /**
   * @param {{ peerId?: string, signalingUrl: string, now?: () => number }} opts
   */
  constructor(opts) {
    this.peerId = opts.peerId || peerIdOf();
    this.signalingUrl = opts.signalingUrl;
    this.now = opts.now || (() => Date.now());
    /** @type {string | null} */
    this.roomCode = null;
    /** @type {WebSocket | null} */
    this.ws = null;
    /** @type {Map<string, RTCPeerConnection>} */
    this.pcs = new Map();
    /** @type {Map<string, RTCDataChannel>} */
    this.channels = new Map();
    /** @type {Map<string, RTCDataChannel>} */
    this.assetChannels = new Map();
    /** @type {Map<string, object[]>} */
    this.iceQ = new Map();
    /** @type {Set<string>} */
    this.offering = new Set();
    /** @type {Map<string, number>} */
    this.lastRx = new Map();
    /** @type {Set<string>} */
    this.down = new Set();
    this._joined = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    this._rejoinTimer = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    this._beatTimer = null;
    /** @type {Promise<void> | null} */
    this._opening = null;
    /** @type {((id: string) => void)[]} */
    this._leadWaiters = [];
    /** @type {string | null} */
    this.leadHint = null;
    /** @type {((from: string, d: string) => void) | null} */
    this.onGame = null;
    /** @type {((from: string, env: any) => void) | null} */
    this.onEnvelope = null;
    /** @type {((peerId: string) => void) | null} */
    this.onUp = null;
    /** @type {((peerId: string) => void) | null} */
    this.onDown = null;
    /** Asset-channel payload: a JSON string or an ArrayBuffer chunk. */
    /** @type {((peerId: string, data: string | ArrayBuffer) => void) | null} */
    this.onAsset = null;
  }

  /** @param {string} room @returns {Promise<void>} */
  join(room) {
    const code = String(room || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(code)) return Promise.reject(new Error('房间号无效'));
    if (this._joined && this.roomCode === code && this.ws && this.ws.readyState === 1) return Promise.resolve();
    if (this.roomCode && this.roomCode !== code) {
      for (const id of [...this.pcs.keys()]) this.dropPeer(id, false);
    }
    this.roomCode = code;
    this._joined = false;
    this._startBeats();
    return this._ensureWs().then(() => this._sendJoin());
  }

  leave() {
    this._joined = false;
    const code = this.roomCode;
    this.roomCode = null;
    clearTimeout(this._rejoinTimer);
    this._stopBeats();
    for (const id of [...this.pcs.keys()]) this.dropPeer(id, false);
    if (code && this.ws && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify({ type: 'leave' })); } catch { /* ignore */ }
    }
  }

  /** @param {string} peerId */
  channelOpen(peerId) {
    const ch = this.channels.get(peerId);
    return !!ch && ch.readyState === 'open';
  }

  /** Peer ids whose heartbeat is fresh. */
  alivePeerIds() {
    const now = this.now();
    const ids = [];
    for (const [id, ch] of this.channels) {
      if (ch.readyState !== 'open') continue;
      const seen = this.lastRx.get(id) || 0;
      if (seen && now - seen <= DEAD_MS) ids.push(id);
    }
    return ids;
  }

  /**
   * Resolve with another peer's id once they tell us they are running the match, or null on timeout.
   * @param {number} [timeout]
   * @returns {Promise<string | null>}
   */
  waitForLead(timeout = 2500) {
    if (this.leadHint && this.leadHint !== this.peerId) return Promise.resolve(this.leadHint);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._leadWaiters = this._leadWaiters.filter((w) => w !== fn);
        resolve(this.leadHint && this.leadHint !== this.peerId ? this.leadHint : null);
      }, timeout);
      const fn = (id) => { clearTimeout(timer); resolve(id); };
      this._leadWaiters.push(fn);
    });
  }

  /** @param {string} peerId @param {object} env */
  sendTo(peerId, env) {
    const ch = this.channels.get(peerId);
    if (!ch || ch.readyState !== 'open') return false;
    this._sendCh(ch, env);
    return true;
  }

  /** @param {string} peerId @param {string} d raw game JSON */
  sendGame(peerId, d) {
    return this.sendTo(peerId, { k: 'game', d: String(d) });
  }

  /** @param {object} env @param {string} [except] */
  broadcast(env, except) {
    let n = 0;
    for (const [id, ch] of this.channels) {
      if (id === except || ch.readyState !== 'open') continue;
      this._sendCh(ch, env);
      n++;
    }
    return n;
  }

  rejoinSoon() {
    if (!this.roomCode) return;
    clearTimeout(this._rejoinTimer);
    this._rejoinTimer = setTimeout(() => {
      this._joined = false;
      this._ensureWs().then(() => this._sendJoin()).catch((err) => console.warn('[p2p] rejoin', err));
    }, 400);
  }

  /** @returns {Promise<void>} */
  _ensureWs() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) {
      if (this.ws.readyState === 1) return Promise.resolve();
      return this._opening || Promise.resolve();
    }
    this._opening = new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(this.signalingUrl); } catch (err) { reject(err); return; }
      this.ws = ws;
      const timer = setTimeout(() => { try { ws.close(); } catch { /* ignore */ } reject(new Error('信令服务器连接超时')); }, 8000);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = () => { /* close follows */ };
      ws.onmessage = (ev) => {
        try { this._onSignaling(JSON.parse(String(ev.data))); } catch (err) { console.warn('[p2p] bad signaling frame', err); }
      };
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null;
        this._joined = false;
        if (this.roomCode) this.rejoinSoon();
      };
    });
    return this._opening;
  }

  _sendJoin() {
    if (!this.ws || this.ws.readyState !== 1 || !this.roomCode) return;
    this.ws.send(JSON.stringify({ type: 'join', room: this.roomCode, peerId: this.peerId, role: 'peer' }));
  }

  /** @param {any} msg */
  _onSignaling(msg) {
    if (msg.type === 'joined') {
      this._joined = true;
      for (const peer of msg.peers || []) this._notePeer(peer.peerId);
      return;
    }
    if (msg.type === 'peer-joined') {
      this._notePeer(msg.peerId);
      return;
    }
    if (msg.type === 'peer-left') {
      this.dropPeer(msg.peerId, true);
      return;
    }
    if (msg.type === 'signal' && msg.from) {
      this._onSignal(msg.from, msg.data || {});
      return;
    }
    if (msg.type === 'error') console.warn('[p2p] signaling', msg.error);
  }

  /** @param {string} peerId */
  _notePeer(peerId) {
    if (!peerId || peerId === this.peerId) return;
    const live = this.channels.get(peerId);
    if (live && live.readyState === 'open') return;
    if (!shouldOffer(this.peerId, peerId)) return;
    if (this.offering.has(peerId)) return;
    this.offering.add(peerId);
    this.dropPeer(peerId, false);
    this._offerTo(peerId).finally(() => this.offering.delete(peerId));
  }

  /** @param {string} peerId */
  async _offerTo(peerId) {
    if (typeof RTCPeerConnection !== 'function') throw new Error('当前浏览器没有 WebRTC');
    const pc = this._pc(peerId);
    const channel = pc.createDataChannel('game', { ordered: true });
    const assets = pc.createDataChannel('assets', { ordered: true });
    this._wireChannel(peerId, channel);
    this._wireAsset(peerId, assets);
    const offer = await pc.createOffer();
    if (this.pcs.get(peerId) !== pc) return;
    await pc.setLocalDescription(offer);
    if (this.pcs.get(peerId) !== pc) return;
    this._signal(peerId, { kind: 'offer', sdp: pc.localDescription });
  }

  /** @param {string} peerId @param {RTCDataChannel} channel */
  _wireChannel(peerId, channel) {
    try { channel.binaryType = 'arraybuffer'; } catch { /* ignore */ }
    const reasm = createReassembler((text) => this._onEnvelopeText(peerId, text));
    channel.onmessage = (ev) => reasm(decodeData(ev.data));
    const publish = () => {
      this.channels.set(peerId, channel);
      this.lastRx.set(peerId, this.now());
      this.down.delete(peerId);
      console.info(`[p2p] 已与 ${peerId} 相连`);
      this._sendCh(channel, { k: 'need' });
      this.onUp?.(peerId);
    };
    if (channel.readyState === 'open') publish();
    else channel.onopen = publish;
    channel.onclose = () => {
      if (this.channels.get(peerId) !== channel) return;
      this.channels.delete(peerId);
      this._markDown(peerId);
      if (this.roomCode && shouldOffer(this.peerId, peerId)) this._notePeer(peerId);
    };
  }

  /** @param {string} peerId @param {RTCDataChannel} channel */
  _wireAsset(peerId, channel) {
    try { channel.binaryType = 'arraybuffer'; } catch { /* ignore */ }
    const publish = () => {
      this.assetChannels.set(peerId, channel);
    };
    channel.onmessage = (ev) => this.onAsset?.(peerId, ev.data);
    if (channel.readyState === 'open') publish();
    else channel.onopen = publish;
    channel.onclose = () => {
      if (this.assetChannels.get(peerId) === channel) this.assetChannels.delete(peerId);
    };
  }

  /** @param {string} from @param {string} text */
  _onEnvelopeText(from, text) {
    this.lastRx.set(from, this.now());
    if (this.down.has(from)) {
      this.down.delete(from);
      this.onUp?.(from);
    }
    let env;
    try { env = JSON.parse(text); } catch { return; }
    if (!env || typeof env.k !== 'string') return;
    if (env.k === 'beat') return;
    if (env.k === 'game') {
      this.onGame?.(from, typeof env.d === 'string' ? env.d : '');
      return;
    }
    const leadId = env.k === 'lead' ? env.id : env.k === 'sync' ? env.lead : null;
    if (typeof leadId === 'string' && leadId) {
      this.leadHint = leadId;
      if (leadId !== this.peerId) {
        const waiters = this._leadWaiters.splice(0);
        for (const w of waiters) w(leadId);
      }
    }
    this.onEnvelope?.(from, env);
  }

  /** @param {string} from @param {any} data */
  async _onSignal(from, data) {
    if (data.kind === 'offer') {
      if (shouldOffer(this.peerId, from)) return;
      const live = this.channels.get(from);
      if (live && live.readyState === 'open') return;
      this.dropPeer(from, false);
      const pc = this._pc(from);
      pc.ondatachannel = (ev) => {
        if (ev.channel.label === 'assets') this._wireAsset(from, ev.channel);
        else this._wireChannel(from, ev.channel);
      };
      await pc.setRemoteDescription(data.sdp);
      await this._flushIce(from);
      const answer = await pc.createAnswer();
      if (this.pcs.get(from) !== pc) return;
      await pc.setLocalDescription(answer);
      this._signal(from, { kind: 'answer', sdp: pc.localDescription });
      return;
    }
    const pc = this.pcs.get(from);
    if (!pc) {
      if (data.kind === 'ice' && data.candidate) {
        const q = this.iceQ.get(from) || [];
        q.push(data.candidate);
        this.iceQ.set(from, q);
      }
      return;
    }
    if (data.kind === 'answer') {
      await pc.setRemoteDescription(data.sdp);
      await this._flushIce(from);
      return;
    }
    if (data.kind === 'ice' && data.candidate) {
      if (!pc.remoteDescription) {
        const q = this.iceQ.get(from) || [];
        q.push(data.candidate);
        this.iceQ.set(from, q);
        return;
      }
      try { await pc.addIceCandidate(data.candidate); } catch (err) { console.warn('[p2p] ice', err); }
    }
  }

  /** @param {string} peerId */
  _pc(peerId) {
    const existing = this.pcs.get(peerId);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pcs.set(peerId, pc);
    pc.onicecandidate = (ev) => {
      if (this.pcs.get(peerId) !== pc || !ev.candidate) return;
      this._signal(peerId, { kind: 'ice', candidate: ev.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (this.pcs.get(peerId) !== pc) return;
      if (pc.connectionState === 'failed') this.dropPeer(peerId, true);
    };
    return pc;
  }

  /** @param {string} peerId */
  async _flushIce(peerId) {
    const pc = this.pcs.get(peerId);
    const queued = this.iceQ.get(peerId) || [];
    this.iceQ.delete(peerId);
    for (const candidate of queued) {
      try { await pc?.addIceCandidate(candidate); } catch { /* stale */ }
    }
  }

  /** @param {string} to @param {object} data */
  _signal(to, data) {
    if (!this.ws || this.ws.readyState !== 1) return;
    try { this.ws.send(JSON.stringify({ type: 'signal', to, data })); } catch { /* ignore */ }
  }

  /** @param {RTCDataChannel} ch @param {object} env */
  _sendCh(ch, env) {
    try { framedSend((text) => ch.send(text), JSON.stringify(env)); } catch { /* closing */ }
  }

  _startBeats() {
    if (this._beatTimer) return;
    this._beatTimer = setInterval(() => {
      const now = this.now();
      for (const [id, ch] of [...this.channels]) {
        if (ch.readyState !== 'open') continue;
        this._sendCh(ch, { k: 'beat', t: now });
        const seen = this.lastRx.get(id) || 0;
        if (seen && now - seen > DEAD_MS) this.dropPeer(id, true);
      }
    }, BEAT_MS);
  }

  _stopBeats() {
    if (this._beatTimer) clearInterval(this._beatTimer);
    this._beatTimer = null;
  }

  /** @param {string} peerId */
  _markDown(peerId) {
    if (this.down.has(peerId)) return;
    this.down.add(peerId);
    this.onDown?.(peerId);
  }

  /**
   * @param {string} peerId
   * @param {boolean} [tell] fire onDown when the channel was up
   */
  dropPeer(peerId, tell = true) {
    const pc = this.pcs.get(peerId);
    const ch = this.channels.get(peerId);
    const wasUp = !!ch && ch.readyState === 'open';
    this.pcs.delete(peerId);
    this.channels.delete(peerId);
    this.assetChannels.delete(peerId);
    this.iceQ.delete(peerId);
    if (pc) {
      try { pc.onicecandidate = null; pc.ondatachannel = null; pc.close(); } catch { /* ignore */ }
    }
    if (tell && wasUp) this._markDown(peerId);
  }
}
