// Append-only copy of a room's requests, kept by every peer.
//
// A request is stored once (same peer, same payload). Welcomes are stored beside the log so a peer
// that has to rebuild the match can resume the same player ids. The log is what a disconnected
// player replays after the heartbeat says the previous match browser is gone.

const SKIP_OP = new Set(['ping', 'pong']);

/** @param {string} text */
function fnv(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}

/** @param {string} text */
function parse(text) {
  try {
    const msg = JSON.parse(text);
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') return null;
    return msg;
  } catch {
    return null;
  }
}

/**
 * Stable id for one client request. Retries of the same payload collapse; a new rid does not.
 * @param {string} from @param {string} text
 */
export function opId(from, text) {
  const msg = parse(text);
  if (!msg || SKIP_OP.has(msg.t)) return null;
  return `${from}:${msg.t}:${msg.rid ?? ''}:${fnv(text)}`;
}

/** @param {string} code */
export function seedFromCode(code) {
  return Number.parseInt(fnv(String(code || 'room')), 16) >>> 0;
}

/**
 * @param {{ cap?: number, now?: () => number }} [opts]
 */
export function createJournal({ cap = 4000, now = () => Date.now() } = {}) {
  /** @type {{ id: string, from: string, d: string, ts: number }[]} */
  const ops = [];
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Map<string, { peerId: string, playerId: string, token: string, name: string }>} */
  const welcomes = new Map();
  let roomCode = null;
  let term = 0;

  function trim() {
    if (ops.length <= cap) return;
    const extra = ops.length - cap;
    ops.splice(40, extra);
  }

  return {
    now,
    get roomCode() { return roomCode; },
    set roomCode(v) { roomCode = v ? String(v).trim().toUpperCase() : null; },
    get term() { return term; },
    set term(v) { term = Number.isFinite(v) ? v : term; },

    /** Drop a previous room's log (a new room.create). */
    clear() {
      ops.length = 0;
      seen.clear();
      welcomes.clear();
      roomCode = null;
      term = 0;
    },

    /**
     * @param {string} from peer that sent the request
     * @param {string} d raw client JSON
     * @returns {boolean} true when this request was new
     */
    addOp(from, d) {
      const text = typeof d === 'string' ? d : '';
      const id = opId(from, text);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      ops.push({ id, from, d: text, ts: now() });
      trim();
      return true;
    },

    /**
     * Remember a welcome (and the room code on room.state) from a server frame.
     * @param {string} peerId who this frame was addressed to
     * @param {string} d
     */
    noteFrame(peerId, d) {
      const msg = parse(typeof d === 'string' ? d : '');
      if (!msg) return;
      if (msg.t === 'room.state' && typeof msg.code === 'string') roomCode = msg.code.trim().toUpperCase();
      if (msg.t === 'welcome' && typeof msg.playerId === 'string' && typeof msg.token === 'string' && peerId) {
        welcomes.set(peerId, { peerId, playerId: msg.playerId, token: msg.token, name: typeof msg.name === 'string' ? msg.name : '' });
      }
    },

    /** @param {string} peerId @returns {{ peerId: string, playerId: string, token: string, name: string } | null} */
    welcome(peerId) {
      return welcomes.get(peerId) || null;
    },

    /** @returns {{ id: string, from: string, d: string, ts: number }[]} */
    ops() { return ops; },

    /** Payload other peers persist and send back on reconnect. */
    wire() {
      return {
        ops: ops.map((op) => ({ id: op.id, from: op.from, d: op.d, ts: op.ts })),
        welcomes: [...welcomes.values()],
        roomCode,
        term,
      };
    },

    /**
     * Fold another peer's saved log into ours. Returns the requests we did not already have, in order.
     * @param {{ ops?: { id?: string, from?: string, d?: string, ts?: number }[], welcomes?: object[], roomCode?: string, term?: number }} remote
     */
    merge(remote) {
      /** @type {{ id: string, from: string, d: string, ts: number }[]} */
      const fresh = [];
      if (remote && typeof remote.term === 'number' && remote.term > term) term = remote.term;
      if (remote?.roomCode && !roomCode) roomCode = String(remote.roomCode).trim().toUpperCase();
      for (const w of remote?.welcomes || []) {
        if (!w || typeof w.peerId !== 'string' || typeof w.playerId !== 'string' || typeof w.token !== 'string') continue;
        welcomes.set(w.peerId, { peerId: w.peerId, playerId: w.playerId, token: w.token, name: typeof w.name === 'string' ? w.name : '' });
      }
      for (const op of remote?.ops || []) {
        if (!op || typeof op.from !== 'string' || typeof op.d !== 'string') continue;
        if (this.addOp(op.from, op.d)) fresh.push(ops[ops.length - 1]);
      }
      return fresh;
    },
  };
}
