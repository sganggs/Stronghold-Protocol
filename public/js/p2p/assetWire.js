// Asset bytes on a second data channel, separate from the game log.
// Control messages are JSON strings. File bytes are 16 KB binary chunks.

export const ASSET_CHUNK = 16 * 1024;
export const ASSET_MAX_BYTES = 20 * 1024 * 1024;

/**
 * @param {number} id
 * @param {number} index
 * @param {number} count
 * @param {number} total
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function encodeChunk(id, index, count, total, bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const out = new Uint8Array(12 + u8.length);
  const view = new DataView(out.buffer);
  view.setUint8(0, 1);
  view.setUint16(1, id & 0xffff);
  view.setUint16(3, index);
  view.setUint16(5, count);
  view.setUint32(7, total);
  out.set(u8, 12);
  return out;
}

/**
 * @param {ArrayBuffer | Uint8Array} buf
 * @returns {{ id: number, index: number, count: number, total: number, bytes: Uint8Array } | null}
 */
export function decodeChunk(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf || []);
  if (u8.byteLength < 12 || u8[0] !== 1) return null;
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const count = view.getUint16(5);
  const index = view.getUint16(3);
  const total = view.getUint32(7);
  if (!count || index >= count || total > ASSET_MAX_BYTES) return null;
  return {
    id: view.getUint16(1),
    index,
    count,
    total,
    bytes: new Uint8Array(u8.subarray(12)),
  };
}

/**
 * @param {number} id
 * @param {Uint8Array} bytes
 * @param {number} [chunkSize]
 * @returns {Uint8Array[]}
 */
export function splitBlob(id, bytes, chunkSize = ASSET_CHUNK) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const count = Math.max(1, Math.ceil(u8.length / chunkSize) || 1);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const start = i * chunkSize;
    parts.push(encodeChunk(id, i, count, u8.length, u8.subarray(start, Math.min(u8.length, start + chunkSize))));
  }
  return parts;
}

/** Reassemble chunks from one peer. @returns {(buf: ArrayBuffer | Uint8Array) => { id: number, bytes: Uint8Array } | null} */
export function createAssembler() {
  /** @type {Map<number, { count: number, total: number, parts: Uint8Array[], got: number }>} */
  const pending = new Map();
  return function push(buf) {
    const part = decodeChunk(buf);
    if (!part) return null;
    let box = pending.get(part.id);
    if (!box) {
      box = { count: part.count, total: part.total, parts: new Array(part.count), got: 0 };
      pending.set(part.id, box);
    }
    if (box.count !== part.count || box.total !== part.total || box.parts[part.index]) return null;
    box.parts[part.index] = part.bytes;
    box.got++;
    if (box.got !== box.count) return null;
    const out = new Uint8Array(box.total);
    let offset = 0;
    for (const piece of box.parts) {
      if (!piece || offset + piece.length > out.length) {
        pending.delete(part.id);
        return null;
      }
      out.set(piece, offset);
      offset += piece.length;
    }
    pending.delete(part.id);
    if (offset !== box.total) return null;
    return { id: part.id, bytes: out };
  };
}

/**
 * Ask peers for one file and answer their asks from `loadLocal`.
 * @param {{ sendTo: (peerId: string, data: string | Uint8Array) => boolean | Promise<boolean>, loadLocal: (path: string) => Promise<Uint8Array | null> }} opts
 */
export function createAssetSession({ sendTo, loadLocal }) {
  /** @type {Map<string, ReturnType<typeof createAssembler>>} */
  const assemblers = new Map();
  /** @type {Map<number, { chunk: (bytes: Uint8Array) => void, miss: () => void }>} */
  const waiters = new Map();
  let seq = 1;

  /**
   * @param {string} peerId
   * @param {string | ArrayBuffer | Uint8Array} data
   */
  function onData(peerId, data) {
    if (typeof data === 'string') {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'get') { reply(peerId, msg); return; }
      if (msg.t === 'miss') waiters.get(msg.id)?.miss();
      return;
    }
    let asm = assemblers.get(peerId);
    if (!asm) {
      asm = createAssembler();
      assemblers.set(peerId, asm);
    }
    const done = asm(data);
    if (done) waiters.get(done.id)?.chunk(done.bytes);
  }

  /**
   * @param {string} peerId
   * @param {{ id?: number, path?: string }} msg
   */
  async function reply(peerId, msg) {
    const id = msg.id;
    const filePath = typeof msg.path === 'string' ? msg.path : '';
    if (!filePath.startsWith('/assets/') && !filePath.startsWith('/fonts/')) {
      await sendTo(peerId, JSON.stringify({ t: 'miss', id }));
      return;
    }
    let bytes = null;
    try { bytes = await loadLocal(filePath); } catch { bytes = null; }
    if (!bytes || bytes.length > ASSET_MAX_BYTES) {
      await sendTo(peerId, JSON.stringify({ t: 'miss', id }));
      return;
    }
    for (const part of splitBlob(id, bytes)) {
      if (!await sendTo(peerId, part)) return;
    }
  }

  /**
   * @param {string} filePath
   * @param {Iterable<string>} peerIds
   * @param {number} [timeout]
   * @returns {Promise<Uint8Array | null>}
   */
  function request(filePath, peerIds, timeout = 8000) {
    const peers = [...peerIds];
    if (!peers.length) return Promise.resolve(null);
    const id = seq;
    seq = (seq + 1) & 0xffff;
    if (seq === 0) seq = 1;
    return new Promise((resolve) => {
      let left = 0;
      let settled = false;
      const timer = setTimeout(() => finish(null), timeout);
      /** @param {Uint8Array | null} bytes */
      function finish(bytes) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        waiters.delete(id);
        resolve(bytes);
      }
      waiters.set(id, {
        chunk(bytes) { finish(bytes); },
        miss() { if (--left <= 0) finish(null); },
      });
      for (const peerId of peers) {
        const sent = sendTo(peerId, JSON.stringify({ t: 'get', id, path: filePath }));
        if (sent) left++;
      }
      if (!left) finish(null);
    });
  }

  return { onData, request };
}
