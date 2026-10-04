// Connectivity probe for the play path. The match still uses iceServerList() below.
// A probe checks three separate stages and says which one stopped:
//   1. signaling WebSocket (the Worker at /signal)
//   2. each STUN server, one at a time (does it hand back a public address?)
//   3. a data channel to a second browser in a throwaway room

export const STUN_SERVERS = Object.freeze([
  { id: 'google', label: 'Google STUN', urls: 'stun:stun.l.google.com:19302' },
  { id: 'miwifi', label: '小米 STUN', urls: 'stun:stun.miwifi.com:3478' },
  { id: 'bilibili', label: '哔哩哔哩 STUN', urls: 'stun:stun.chat.bilibili.com:3478' },
]);

const TYPE_LABEL = { host: '内网', srflx: '公网', prflx: '对端看见的公网', relay: '中继' };

/** @returns {{ urls: string }[]} */
export function iceServerList() {
  return STUN_SERVERS.map((server) => ({ urls: server.urls }));
}

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Four-character room code that avoids easily confused glyphs. */
export function makeProbeRoom() {
  const buf = new Uint8Array(4);
  globalThis.crypto.getRandomValues(buf);
  let code = '';
  for (const b of buf) code += ROOM_ALPHABET[b % ROOM_ALPHABET.length];
  return code;
}

/** @returns {string} */
export function makeProbePeerId() {
  const buf = new Uint8Array(4);
  globalThis.crypto.getRandomValues(buf);
  let id = 'probe_';
  for (const b of buf) id += b.toString(16).padStart(2, '0');
  return id;
}

/**
 * Pull the type and address out of an ICE candidate line.
 * @param {string} line
 * @returns {{ type: string, address: string }}
 */
export function parseCandidate(line) {
  const text = String(line || '').trim().replace(/^a=/, '').replace(/^candidate:/, '');
  const parts = text.split(' ');
  if (parts.length < 8 || parts[6] !== 'typ') return { type: '', address: '' };
  return { type: parts[7], address: `${parts[4]}:${parts[5]}` };
}

/** @param {string[]} candidates */
export function formatCandidateKinds(candidates) {
  /** @type {string[]} */
  const kinds = [];
  for (const line of candidates || []) {
    const type = parseCandidate(line).type;
    if (type && !kinds.includes(type)) kinds.push(type);
  }
  if (!kinds.length) return '本机没有收集到候选地址';
  return `本机候选：${kinds.map((type) => TYPE_LABEL[type] || type).join('、')}`;
}

/**
 * @param {string[]} candidates
 * @param {boolean} timedOut
 * @returns {{ ok: boolean, detail: string }}
 */
export function stunVerdict(candidates, timedOut) {
  const parsed = (candidates || []).map(parseCandidate);
  const srflx = parsed.find((item) => item.type === 'srflx' && item.address);
  if (srflx) return { ok: true, detail: `返回了公网地址 ${srflx.address}` };
  const host = parsed.some((item) => item.type === 'host');
  if (host) {
    return { ok: false, detail: timedOut ? '超时，只有内网地址，这台 STUN 没有返回公网地址' : '只有内网地址，这台 STUN 没有返回公网地址' };
  }
  return { ok: false, detail: timedOut ? '超时，没有收集到任何地址' : '没有收集到任何地址' };
}

/**
 * @param {{ sawPeer?: boolean, sentOffer?: boolean, gotAnswer?: boolean, gotOffer?: boolean, sentAnswer?: boolean,
 *   connectionState?: string, timedOut?: boolean, pong?: boolean, candidates?: string[],
 *   pair?: { localType?: string, remoteType?: string, rtt?: number | null } | null }} events
 * @returns {{ ok: boolean, detail: string }}
 */
export function peerVerdict(events) {
  const kinds = formatCandidateKinds(events.candidates || []);
  if (events.pong || events.connectionState === 'connected' || events.connectionState === 'completed') {
    const pair = events.pair;
    const path = pair?.localType
      ? `本机${TYPE_LABEL[pair.localType] || pair.localType} → 对方${TYPE_LABEL[pair.remoteType] || pair.remoteType || '未知'}`
      : '数据通道已打开';
    const rtt = pair && pair.rtt != null ? `，往返 ${pair.rtt}ms` : '';
    return { ok: true, detail: `已连通（${path}${rtt}）` };
  }
  if (!events.sawPeer) return { ok: false, detail: '测试房间里没有第二台浏览器。把测试号填到另一台，再点「加入这个测试号」' };
  const exchanged = (events.sentOffer && events.gotAnswer) || (events.gotOffer && events.sentAnswer);
  if (!exchanged) return { ok: false, detail: `看见了同伴，但连接提议没有交换完。${kinds}` };
  if (events.connectionState === 'failed') return { ok: false, detail: `地址已经交换，UDP 打洞失败。${kinds}。没有中继时，只有内网地址就无法远程连通` };
  if (events.timedOut) return { ok: false, detail: `打洞超时。${kinds}。没有中继时，只有内网地址就无法远程连通` };
  return { ok: false, detail: `停在 ${events.connectionState || '未知'}。${kinds}` };
}

/**
 * Open /signal, join one room, and wait for `joined`.
 * @param {string} url
 * @param {{ room: string, peerId?: string, timeoutMs?: number, signal?: AbortSignal, WebSocket?: typeof WebSocket }} [opts]
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
export function probeSignaling(url, opts = {}) {
  const WS = opts.WebSocket || globalThis.WebSocket;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const peerId = opts.peerId || makeProbePeerId();
  return new Promise((resolve) => {
    /** @type {WebSocket | null} */
    let ws = null;
    let done = false;
    const started = Date.now();
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (ws && ws.readyState === 1) {
        try { ws.send(JSON.stringify({ type: 'leave' })); } catch { /* closing */ }
      }
      try { ws?.close(); } catch { /* ignore */ }
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, detail: `超时，${timeoutMs / 1000}s 内没有收到 joined` }), timeoutMs);
    opts.signal?.addEventListener('abort', () => finish({ ok: false, detail: '已取消' }), { once: true });
    try { ws = new WS(url); }
    catch (err) { finish({ ok: false, detail: err instanceof Error ? err.message : String(err) }); return; }
    ws.onopen = () => {
      try { ws?.send(JSON.stringify({ type: 'join', room: opts.room, peerId, role: 'peer' })); }
      catch (err) { finish({ ok: false, detail: err instanceof Error ? err.message : String(err) }); }
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.type === 'joined') finish({ ok: true, detail: `已收到 joined，用时 ${Date.now() - started}ms` });
      else if (msg.type === 'error') finish({ ok: false, detail: `服务器拒绝：${msg.error || '未知错误'}` });
    };
    ws.onerror = () => { /* onclose carries the result when the handshake never opens */ };
    ws.onclose = () => { if (!done) finish({ ok: false, detail: '连接被关掉，没有收到 joined' }); };
  });
}

/**
 * Ask one STUN server for a public address. Host-only candidates count as a failure:
 * they cannot reach a browser on another network.
 * @param {{ id: string, label: string, urls: string }} server
 * @param {{ timeoutMs?: number, signal?: AbortSignal, RTCPeerConnection?: typeof RTCPeerConnection }} [opts]
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
export function probeOneStun(server, opts = {}) {
  const PC = opts.RTCPeerConnection || globalThis.RTCPeerConnection;
  const timeoutMs = opts.timeoutMs ?? 5000;
  if (typeof PC !== 'function') return Promise.resolve({ ok: false, detail: `${server.urls} · 这个环境没有 WebRTC` });
  return new Promise((resolve) => {
    /** @type {RTCPeerConnection | null} */
    let pc = null;
    /** @type {string[]} */
    const candidates = [];
    let done = false;
    const started = Date.now();
    const finish = (timedOut, early) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { pc?.close(); } catch { /* ignore */ }
      if (early) { resolve(early); return; }
      const verdict = stunVerdict(candidates, timedOut);
      resolve({ ok: verdict.ok, detail: `${server.urls} · ${verdict.detail}，用时 ${Date.now() - started}ms` });
    };
    const timer = setTimeout(() => finish(true), timeoutMs);
    opts.signal?.addEventListener('abort', () => finish(false, { ok: false, detail: '已取消' }), { once: true });
    try {
      pc = new PC({ iceServers: [{ urls: server.urls }] });
      pc.createDataChannel('probe');
      pc.onicecandidate = (ev) => {
        if (!ev.candidate) { finish(false); return; }
        if (ev.candidate.candidate) candidates.push(ev.candidate.candidate);
      };
      pc.createOffer()
        .then((offer) => pc?.setLocalDescription(offer))
        .catch((err) => finish(false, { ok: false, detail: `${server.urls} · 无法发起探测：${err instanceof Error ? err.message : err}` }));
    } catch (err) {
      finish(false, { ok: false, detail: `${server.urls} · ${err instanceof Error ? err.message : err}` });
    }
  });
}

/**
 * @param {RTCPeerConnection} pc
 * @returns {Promise<{ localType: string, remoteType: string, rtt: number | null } | null>}
 */
async function describePair(pc) {
  try {
    const stats = await pc.getStats();
    /** @type {any} */
    let pair = null;
    for (const stat of stats.values()) {
      if (stat.type === 'transport' && stat.selectedCandidatePairId) pair = stats.get(stat.selectedCandidatePairId);
    }
    if (!pair) {
      for (const stat of stats.values()) {
        if (stat.type === 'candidate-pair' && stat.nominated && stat.state === 'succeeded') pair = stat;
      }
    }
    if (!pair) return null;
    const local = stats.get(pair.localCandidateId);
    const remote = stats.get(pair.remoteCandidateId);
    return {
      localType: local?.candidateType || '',
      remoteType: remote?.candidateType || '',
      rtt: Number.isFinite(pair.currentRoundTripTime) ? Math.round(pair.currentRoundTripTime * 1000) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Join `room` and try to open one data channel to whoever else is there.
 * @param {{ signalingUrl: string, room: string, peerId?: string, timeoutMs?: number, signal?: AbortSignal,
 *   iceServers?: { urls: string }[], WebSocket?: typeof WebSocket, RTCPeerConnection?: typeof RTCPeerConnection,
 *   onProgress?: (detail: string) => void }} opts
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
export function probePeer(opts) {
  const WS = opts.WebSocket || globalThis.WebSocket;
  const PC = opts.RTCPeerConnection || globalThis.RTCPeerConnection;
  const timeoutMs = opts.timeoutMs ?? 20000;
  const peerId = opts.peerId || makeProbePeerId();
  const iceServers = opts.iceServers || iceServerList();
  if (typeof PC !== 'function') return Promise.resolve({ ok: false, detail: '这个环境没有 WebRTC，无法测直连' });

  return new Promise((resolve) => {
    /** @type {WebSocket | null} */
    let ws = null;
    /** @type {Map<string, RTCPeerConnection>} */
    const pcs = new Map();
    /** @type {Map<string, RTCIceCandidateInit[]>} */
    const iceQ = new Map();
    /** @type {Set<string>} */
    const offering = new Set();
    /** @type {string[]} */
    const candidates = [];
    const events = {
      sawPeer: false, sentOffer: false, gotAnswer: false, gotOffer: false, sentAnswer: false,
      connectionState: 'new', timedOut: false, pong: false, candidates,
      /** @type {{ localType: string, remoteType: string, rtt: number | null } | null} */
      pair: null,
    };
    let done = false;
    let pongTimer = 0;

    const shutdown = () => {
      clearTimeout(pongTimer);
      if (ws && ws.readyState === 1) {
        try { ws.send(JSON.stringify({ type: 'leave' })); } catch { /* ignore */ }
      }
      try { ws?.close(); } catch { /* ignore */ }
      for (const pc of pcs.values()) {
        try { pc.close(); } catch { /* ignore */ }
      }
    };
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      shutdown();
      resolve(result);
    };
    const timer = setTimeout(() => {
      events.timedOut = true;
      finish(peerVerdict(events));
    }, timeoutMs);
    opts.signal?.addEventListener('abort', () => finish({ ok: false, detail: '已取消' }), { once: true });

    const sendSignal = (to, data) => {
      if (!ws || ws.readyState !== 1) return;
      try { ws.send(JSON.stringify({ type: 'signal', to, data })); } catch { /* ignore */ }
    };

    /** @param {string} other @param {RTCDataChannel} channel @param {RTCPeerConnection} pc */
    const wireChannel = (other, channel, pc) => {
      channel.onopen = () => {
        events.connectionState = 'connected';
        opts.onProgress?.('数据通道已打开，正在测往返');
        try { channel.send(JSON.stringify({ t: 'ping', n: Date.now() })); } catch { /* ignore */ }
        clearTimeout(pongTimer);
        pongTimer = setTimeout(async () => {
          events.pair = await describePair(pc);
          events.pong = true;
          finish(peerVerdict(events));
        }, 2500);
      };
      channel.onmessage = async (ev) => {
        let msg;
        try { msg = JSON.parse(String(ev.data)); } catch { return; }
        if (msg.t === 'ping') {
          try { channel.send(JSON.stringify({ t: 'pong', n: msg.n })); } catch { /* ignore */ }
          return;
        }
        if (msg.t === 'pong') {
          events.pong = true;
          events.pair = await describePair(pc);
          if (events.pair && typeof msg.n === 'number') events.pair.rtt = Date.now() - msg.n;
          finish(peerVerdict(events));
        }
      };
    };

    /** @param {string} other */
    const ensurePc = (other) => {
      const existing = pcs.get(other);
      if (existing) return existing;
      const pc = new PC({ iceServers });
      pcs.set(other, pc);
      pc.onicecandidate = (ev) => {
        if (!ev.candidate) return;
        if (ev.candidate.candidate) candidates.push(ev.candidate.candidate);
        sendSignal(other, { kind: 'ice', candidate: ev.candidate.toJSON() });
      };
      pc.onconnectionstatechange = () => {
        events.connectionState = pc.connectionState;
        if (pc.connectionState === 'failed') finish(peerVerdict(events));
      };
      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') {
          events.connectionState = 'failed';
          finish(peerVerdict(events));
        }
      };
      pc.ondatachannel = (ev) => wireChannel(other, ev.channel, pc);
      return pc;
    };

    const flushIce = async (other) => {
      const pc = pcs.get(other);
      const queued = iceQ.get(other) || [];
      iceQ.delete(other);
      for (const candidate of queued) {
        try { await pc?.addIceCandidate(candidate); } catch { /* stale */ }
      }
    };

    const offerTo = async (other) => {
      if (String(peerId) > String(other) || offering.has(other)) return;
      offering.add(other);
      const pc = ensurePc(other);
      const channel = pc.createDataChannel('probe');
      wireChannel(other, channel, pc);
      const offer = await pc.createOffer();
      if (done || pcs.get(other) !== pc) return;
      await pc.setLocalDescription(offer);
      events.sentOffer = true;
      opts.onProgress?.('已发出连接提议，等待应答');
      sendSignal(other, { kind: 'offer', sdp: pc.localDescription });
    };

    const notePeer = (other) => {
      if (!other || other === peerId) return;
      events.sawPeer = true;
      opts.onProgress?.(`已看见同伴 ${other}，正在交换地址`);
      offerTo(other).catch((err) => finish({ ok: false, detail: `发起连接失败：${err instanceof Error ? err.message : err}` }));
    };

    /** @param {string} from @param {any} data */
    const onSignal = async (from, data) => {
      if (!data || typeof data !== 'object') return;
      if (data.kind === 'offer') {
        if (String(peerId) < String(from)) return;
        events.gotOffer = true;
        const pc = ensurePc(from);
        await pc.setRemoteDescription(data.sdp);
        await flushIce(from);
        const answer = await pc.createAnswer();
        if (done || pcs.get(from) !== pc) return;
        await pc.setLocalDescription(answer);
        events.sentAnswer = true;
        opts.onProgress?.('已应答连接提议，正在打洞');
        sendSignal(from, { kind: 'answer', sdp: pc.localDescription });
        return;
      }
      const pc = pcs.get(from);
      if (!pc) {
        if (data.kind === 'ice' && data.candidate) {
          const queued = iceQ.get(from) || [];
          queued.push(data.candidate);
          iceQ.set(from, queued);
        }
        return;
      }
      if (data.kind === 'answer') {
        events.gotAnswer = true;
        opts.onProgress?.('已收到应答，正在打洞');
        await pc.setRemoteDescription(data.sdp);
        await flushIce(from);
        return;
      }
      if (data.kind === 'ice' && data.candidate) {
        if (!pc.remoteDescription) {
          const queued = iceQ.get(from) || [];
          queued.push(data.candidate);
          iceQ.set(from, queued);
          return;
        }
        try { await pc.addIceCandidate(data.candidate); } catch { /* ignore */ }
      }
    };

    try { ws = new WS(opts.signalingUrl); }
    catch (err) { finish({ ok: false, detail: err instanceof Error ? err.message : String(err) }); return; }
    ws.onopen = () => {
      try { ws?.send(JSON.stringify({ type: 'join', room: opts.room, peerId, role: 'peer' })); }
      catch (err) { finish({ ok: false, detail: err instanceof Error ? err.message : String(err) }); }
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.type === 'joined') {
        for (const peer of msg.peers || []) notePeer(peer.peerId);
        return;
      }
      if (msg.type === 'peer-joined') { notePeer(msg.peerId); return; }
      if (msg.type === 'signal' && msg.from) {
        onSignal(msg.from, msg.data).catch((err) => finish({ ok: false, detail: `处理应答失败：${err instanceof Error ? err.message : err}` }));
      } else if (msg.type === 'error') finish({ ok: false, detail: `服务器拒绝：${msg.error || '未知错误'}` });
    };
    ws.onerror = () => { /* onclose reports a dead socket */ };
    ws.onclose = () => { if (!done) finish({ ok: false, detail: '对端测试时信令断开了' }); };
  });
}

/**
 * Run signaling, then each STUN server, then the peer channel.
 * @param {{ signalingUrl: string, room: string, signal?: AbortSignal,
 *   onStep: (id: string, patch: { state?: string, detail?: string }) => void,
 *   onProgress?: (detail: string) => void }} opts
 */
export async function runLinkProbe(opts) {
  const { onStep, signal } = opts;
  const peerId = makeProbePeerId();
  if (signal?.aborted) return;

  onStep('peer', { state: 'wait', detail: `测试号 ${opts.room}。信令和 STUN 测完后才会在这个房间里等待另一台浏览器` });
  onStep('signal', { state: 'run', detail: opts.signalingUrl });
  const signaling = await probeSignaling(opts.signalingUrl, { room: opts.room, peerId: `${peerId}s`, signal });
  onStep('signal', { state: signaling.ok ? 'ok' : 'bad', detail: signaling.detail });

  await Promise.all(STUN_SERVERS.map(async (server) => {
    if (signal?.aborted) return;
    onStep(server.id, { state: 'run', detail: server.urls });
    const result = await probeOneStun(server, { signal });
    onStep(server.id, { state: result.ok ? 'ok' : 'bad', detail: result.detail });
  }));

  if (signal?.aborted) return;
  if (!signaling.ok) {
    onStep('peer', { state: 'bad', detail: '信令没通，无法和对端交换地址，这一步跳过' });
    return;
  }
  onStep('peer', { state: 'run', detail: `等待另一台浏览器加入测试号 ${opts.room}` });
  const peer = await probePeer({
    signalingUrl: opts.signalingUrl,
    room: opts.room,
    peerId,
    signal,
    timeoutMs: 30000,
    onProgress: (detail) => onStep('peer', { state: 'run', detail }),
  });
  onStep('peer', { state: peer.ok ? 'ok' : 'bad', detail: peer.detail });
}
