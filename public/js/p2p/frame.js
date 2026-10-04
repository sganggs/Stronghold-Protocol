// Split a game frame across several data-channel messages. SCTP often refuses a single message
// larger than ~16 KB; match snapshots can be bigger. Frames at or under the limit are sent raw so
// the common case stays one JSON object.

const MAX = 8000;

/** @param {(text: string) => void} send @param {string} payload */
export function framedSend(send, payload) {
  const text = String(payload);
  if (text.length <= MAX) { send(text); return; }
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const n = Math.ceil(text.length / MAX);
  for (let i = 0; i < n; i++) {
    send(JSON.stringify({ _p2p: 1, id, i, n, d: text.slice(i * MAX, (i + 1) * MAX) }));
  }
}

/**
 * Reassemble framedSend output. Non-chunk messages are forwarded unchanged.
 * @param {(frame: string) => void} onFrame
 */
export function createReassembler(onFrame) {
  /** @type {Map<string, { n: number, parts: string[], got: number }>} */
  const pending = new Map();
  return (text) => {
    let msg;
    try { msg = JSON.parse(text); } catch { onFrame(text); return; }
    if (!msg || msg._p2p !== 1 || typeof msg.d !== 'string' || !Number.isInteger(msg.n) || msg.n < 2) {
      onFrame(text);
      return;
    }
    let slot = pending.get(msg.id);
    if (!slot) pending.set(msg.id, (slot = { n: msg.n, parts: [], got: 0 }));
    if (typeof slot.parts[msg.i] !== 'string') { slot.parts[msg.i] = msg.d; slot.got++; }
    if (slot.got === slot.n) {
      pending.delete(msg.id);
      onFrame(slot.parts.join(''));
    }
  };
}

/** @param {unknown} data */
export function decodeData(data) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  return String(data ?? '');
}
