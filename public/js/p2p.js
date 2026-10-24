// Optional WebRTC fanout of server-authored public snapshots. WebSocket remains the authority,
// signalling path and fallback. Peers cannot introduce commands, private data or unsigned state.

const MAX_FRAME = 60 * 1024;
const MAX_QUEUE = 16;
const MAX_BUFFER = 128 * 1024;
const encoder = new TextEncoder();

export class PeerTransport {
  constructor(net, opts = {}) {
    this.net = net;
    this.RTC = opts.RTCPeerConnection ?? globalThis.RTCPeerConnection;
    this.crypto = opts.crypto ?? globalThis.crypto;
    this.timers = opts.timers ?? net.timers;
    const optedOut = new URLSearchParams(globalThis.location?.search || '').get('p2p') === 'off';
    this.enabled = opts.enabled !== false && !optedOut && !!this.RTC && !!this.crypto?.subtle;
    this.config = null;
    this.links = new Map();
    this.generation = 0;
    this.seq = 0;
    this.directAt = -Infinity;
    this.deliveryEpoch = null;
    this.deliverySeq = 0;
    this.timer = null;
    this.queued = 0;
    this.incoming = Promise.resolve();
    this.sessionWs = null;
    this.sessionPlayerId = null;
    net.on('welcome', (msg) => {
      // Repeated hello (rename/resync) on the same socket does not invalidate a healthy peer plan.
      if (this.sessionWs && this.sessionWs === net.ws && this.sessionPlayerId === msg.playerId) return;
      this.sessionWs = net.ws;
      this.sessionPlayerId = msg.playerId;
      this.reset();
      if (this.enabled) net.send('p2p.enable', { enabled: true });
    });
    net.on('status', ({ status }) => { if (status !== 'online' && status !== 'handshaking') this.reset(); });
    net.on('room.closed', () => this.reset());
    net.on('p2p.config', (msg) => this.configure(msg));
    net.on('p2p.signal', (msg) => this.signal(msg));
    net.on('p2p.frame', (msg) => this.receive(msg, true));
  }

  reset(keepDelivery = false) {
    this.generation++;
    if (this.timer != null) this.timers.clearInterval(this.timer);
    this.timer = null;
    this.config = null;
    for (const link of this.links.values()) this.closeLink(link);
    this.links.clear();
    this.seq = 0;
    if (!keepDelivery) {
      this.directAt = -Infinity;
      this.deliveryEpoch = null;
      this.deliverySeq = 0;
    }
    this.queued = 0;
    this.incoming = Promise.resolve();
  }

  configure(msg) {
    if (!this.enabled) return;
    if (msg.enabled && msg.epoch === this.config?.epoch) return;
    this.reset(true);
    const myId = this.net.playerId;
    if (!msg.enabled || typeof msg.epoch !== 'string' || !Array.isArray(msg.peers)
      || msg.peers.length > 6 || !msg.peers.includes(myId) || !msg.peers.includes(msg.relayId)) return;
    const generation = this.generation;
    this.config = msg;
    const targets = myId === msg.relayId ? msg.peers.filter((id) => id !== myId) : [msg.relayId];
    try {
      this.key = this.crypto.subtle.importKey('jwk', msg.publicKey,
        { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      // A disabled/broken WebCrypto implementation must leave the client on WebSocket.
      this.key.catch(() => { if (generation === this.generation) this.fail(); });
      for (const id of targets) this.openLink(id, myId === msg.relayId);
    } catch {
      this.fail();
      return;
    }
    this.timer = this.timers.setInterval(() => this.pulse(), 1000);
  }

  openLink(id, initiator) {
    const config = this.config;
    const generation = this.generation;
    const pc = new this.RTC({ iceServers: config.iceServers || [] });
    const link = { id, pc, channel: null, closed: false, candidates: [], signals: Promise.resolve(), timeout: null };
    this.links.set(id, link);
    const current = () => !link.closed && generation === this.generation;
    pc.onicecandidate = ({ candidate }) => {
      if (!current() || !candidate) return;
      this.net.send('p2p.signal', { epoch: config.epoch, to: id, candidate: {
        candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex,
      } });
    };
    pc.onconnectionstatechange = () => {
      if (current() && ['failed', 'disconnected', 'closed'].includes(pc.connectionState)) this.dropLink(link);
    };
    pc.ondatachannel = ({ channel }) => {
      if (!current() || initiator || link.channel || channel.label !== 'public-state') { channel.close(); return; }
      this.attachChannel(link, channel);
    };
    link.timeout = this.timers.setTimeout(() => { if (current() && link.channel?.readyState !== 'open') this.dropLink(link); }, 12000);
    if (initiator) {
      this.attachChannel(link, pc.createDataChannel('public-state', { ordered: true }));
      link.signals = pc.createOffer().then(async (offer) => {
        if (!current()) return;
        await pc.setLocalDescription(offer);
        if (current()) this.sendDescription(id, pc.localDescription);
      }).catch(() => { if (current()) this.dropLink(link); });
    }
  }

  attachChannel(link, channel) {
    link.channel = channel;
    channel.onopen = () => {
      if (link.closed) return;
      if (link.timeout != null) this.timers.clearTimeout(link.timeout);
      link.timeout = null;
      this.pulse();
    };
    channel.onclose = channel.onerror = () => { if (!link.closed) this.dropLink(link); };
    channel.onmessage = ({ data }) => {
      if (link.closed || this.net.playerId === this.config?.relayId) return;
      if (typeof data !== 'string' || data.length > MAX_FRAME) { this.dropLink(link); return; }
      try { this.receive(JSON.parse(data), false); } catch { this.dropLink(link); }
    };
  }

  sendDescription(to, description) {
    if (!this.config || !description) return;
    this.net.send('p2p.signal', { epoch: this.config.epoch, to,
      description: { type: description.type, sdp: description.sdp } });
  }

  signal(msg) {
    if (!this.config || msg.epoch !== this.config.epoch) return;
    const link = this.links.get(msg.from);
    if (!link || link.closed) return;
    const generation = this.generation;
    link.signals = link.signals.then(async () => {
      if (link.closed || generation !== this.generation) return;
      if (msg.description) {
        const expected = this.net.playerId === this.config.relayId ? 'answer' : 'offer';
        if (msg.description.type !== expected) return;
        await link.pc.setRemoteDescription(msg.description);
        for (const candidate of link.candidates.splice(0)) await link.pc.addIceCandidate(candidate);
        if (expected === 'offer') {
          await link.pc.setLocalDescription(await link.pc.createAnswer());
          if (!link.closed && generation === this.generation) this.sendDescription(link.id, link.pc.localDescription);
        }
      } else if (msg.candidate) {
        if (link.pc.remoteDescription) await link.pc.addIceCandidate(msg.candidate);
        else if (link.candidates.length < 128) link.candidates.push(msg.candidate);
      }
    }).catch(() => { if (generation === this.generation) this.dropLink(link); });
  }

  /**
   * Renew the lease (once a second). `seq` is the APPLIED watermark — the highest sequence whose snapshot reached
   * game state, or that the state we hold has already superseded. It is never the last sequence we merely saw on the
   * wire, and the server does not treat it as proof of delivery either (it always re-sends on its watchdog).
   */
  pulse() {
    if (!this.config) return;
    const ready = [...this.links.values()].some((link) => !link.closed && link.channel?.readyState === 'open');
    this.net.send('p2p.ready', { epoch: this.config.epoch, ready, seq: this.seq });
  }

  closeLink(link) {
    link.closed = true;
    if (link.timeout != null) this.timers.clearTimeout(link.timeout);
    try { link.channel?.close(); } catch { /* already closed */ }
    try { link.pc.close(); } catch { /* already closed */ }
  }

  dropLink(link) {
    this.closeLink(link);
    this.links.delete(link.id);
    this.pulse();
  }

  fail() {
    this.reset(true);
    this.enabled = false;
    this.net.send('p2p.enable', { enabled: false });
  }

  // All snapshots carry the same server-issued delivery order across WebSocket and WebRTC.
  directSnapshot(msg) {
    if (typeof msg.deliveryEpoch === 'string' && Number.isSafeInteger(msg.deliverySeq) && msg.deliverySeq > 0) {
      if (msg.deliveryEpoch === this.deliveryEpoch && msg.deliverySeq <= this.deliverySeq) return false;
      this.deliveryEpoch = msg.deliveryEpoch;
      this.deliverySeq = msg.deliverySeq;
    } else if (Number.isFinite(msg.serverNow) && msg.serverNow < this.directAt) return false;
    if (Number.isFinite(msg.serverNow)) this.directAt = Math.max(this.directAt, msg.serverNow);
    return true;
  }

  receive(frame, fromServer) {
    const config = this.config;
    if (!config || frame.t !== 'p2p.frame' || frame.epoch !== config.epoch
      || !Number.isSafeInteger(frame.seq) || frame.seq < 1
      || typeof frame.payload !== 'string' || frame.payload.length > MAX_FRAME) return;
    // A duplicate timeout frame still carries an authenticated instruction to stop the failed route.
    if (fromServer && frame.fallback && this.net.playerId !== config.relayId) {
      for (const link of [...this.links.values()]) this.dropLink(link);
    }
    if (frame.seq <= this.seq) return;
    // Only the authenticated WebSocket can ask us to relay or to abandon a stalled peer.
    if (fromServer && this.net.playerId === config.relayId) {
      const data = JSON.stringify(frame);
      if (encoder.encode(data).byteLength <= MAX_FRAME) {
        for (const link of this.links.values()) {
          const channel = link.channel;
          if (link.closed || channel?.readyState !== 'open') continue;
          if (channel.bufferedAmount > MAX_BUFFER) { this.dropLink(link); continue; }
          try { channel.send(data); } catch { this.dropLink(link); }
        }
      }
    }
    // Trusted WebSocket snapshots bypass peer work, so a flooding relay cannot delay fallback.
    if (fromServer) {
      this.accept(frame, this.generation);
      return;
    }
    if (this.queued >= MAX_QUEUE) return;
    const generation = this.generation;
    this.queued++;
    this.incoming = this.incoming.then(async () => {
      if (generation !== this.generation || frame.seq <= this.seq) return;
      if (typeof frame.signature !== 'string' || frame.signature.length > 128) return;
      let signature;
      try { signature = Uint8Array.from(atob(frame.signature), (c) => c.charCodeAt(0)); } catch { return; }
      const valid = await this.crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' },
        await this.key, signature, encoder.encode(JSON.stringify([frame.epoch, frame.seq, frame.payload])));
      if (valid) this.accept(frame, generation);
    }).catch(() => { /* Invalid peer input cannot escape into game state. */ }).finally(() => {
      if (generation === this.generation) this.queued--;
    });
  }

  accept(frame, generation) {
    if (generation !== this.generation || frame.seq <= this.seq) return;
    let msg;
    try { msg = JSON.parse(frame.payload); } catch { return; }
    if (msg?.t !== 'm.public' || Object.hasOwn(msg, 'rid')) return;
    if (!Number.isFinite(msg.serverNow)) return;
    // The ACK watermark is a statement about GAME STATE, not about the wire: it moves only when this snapshot was
    // applied, or when the state we already hold supersedes it. A frame we merely received — one that is lost in the
    // channel, fails verification or never reaches game state — is never acknowledged, so the server's watchdog
    // still puts it back on the WebSocket.
    const stale = !this.directSnapshot(msg);
    if (!stale) this.net.acceptPeerSnapshot(msg);
    this.seq = frame.seq;
  }
}
