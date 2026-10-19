// Parent-side validation, independent of the child API. [ASSUMED] Limits allow full battle event batches.
import { S2C } from '../../../shared/protocol.js';

export const HOST_IPC_LIMITS = Object.freeze({ message: 16 * 1024 * 1024, reply: 1024 * 1024, log: 4000, error: 300, depth: 64, nodes: 500000 });
const object = v => !!v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const str = (v, n) => typeof v === 'string' && v.length <= n && Buffer.byteLength(v) <= n;
const matchFrames = new Set(S2C.filter(t => t.startsWith('m.') || t.startsWith('b.')));

/** Bound traversal before serializing; reject cycles/non-JSON values and never invoke accessors. */
export function boundedJson(value, limit) {
  let bytes = 0, nodes = 0;
  const active = new Set();
  function visit(v, depth) {
    if (++nodes > HOST_IPC_LIMITS.nodes || depth > HOST_IPC_LIMITS.depth || bytes > limit) return false;
    if (typeof v === 'string') { if (v.length > limit) return false; bytes += Buffer.byteLength(v) + 2; }
    else if (v == null || typeof v === 'boolean') bytes += 5;
    else if (typeof v === 'number') { if (!Number.isFinite(v)) return false; bytes += String(v).length; }
    else if (typeof v === 'object' && (Array.isArray(v) || object(v))) {
      if (active.has(v)) return false;
      active.add(v); bytes += 2;
      for (const key of Object.keys(v)) {
        const d = Object.getOwnPropertyDescriptor(v, key);
        if (!d || !Object.hasOwn(d, 'value') || !str(key, limit)) return false;
        bytes += Buffer.byteLength(key) + 4;
        if (!visit(d.value, depth + 1)) return false;
      }
      active.delete(v);
    } else return false;
    return bytes <= limit;
  }
  try { return visit(value, 0) && Buffer.byteLength(JSON.stringify(value) ?? '') <= limit; } catch { return false; }
}

export function validHostMessage(m) {
  if (!object(m)) return false;
  if (m.type === 'hb' || m.type === 'ready') return Object.keys(m).length === 1;
  if (m.type === 'log') return ['info','warn','error','debug'].includes(m.level) && str(m.text, HOST_IPC_LIMITS.log)
    && boundedJson(m, HOST_IPC_LIMITS.log + 128);
  if (m.type === 'boot-error') return str(m.error, HOST_IPC_LIMITS.error) && boundedJson(m, HOST_IPC_LIMITS.error + 128);
  if (!str(m.matchId, 160) || !m.matchId) return false;
  switch (m.type) {
    case 'trust-confirmed': return str(m.playerId, 128) && !!m.playerId && boundedJson(m, 512);
    case 'send':
      if (!str(m.playerId, 128) || !m.playerId) return false;
      // falls through to the shared match-frame validation below
      return object(m.msg) && matchFrames.has(m.msg.t) && boundedJson(m, HOST_IPC_LIMITS.message);
    case 'broadcast': return object(m.msg) && matchFrames.has(m.msg.t) && boundedJson(m, HOST_IPC_LIMITS.message);
    case 'reply': return Number.isSafeInteger(m.id) && m.id > 0 && object(m.result)
      && (m.result.error === undefined || str(m.result.error, 80))
      && (m.result.ok === undefined || typeof m.result.ok === 'boolean') && boundedJson(m, HOST_IPC_LIMITS.reply);
    case 'end': return (m.summary == null || object(m.summary)) && boundedJson(m, HOST_IPC_LIMITS.reply);
    case 'failed': return str(m.error, HOST_IPC_LIMITS.error) && boundedJson(m, HOST_IPC_LIMITS.error + 512);
    default: return false;
  }
}
