// Frame chunking for transports whose pipe caps one message (PRD M1, TR-7).
//
// A DataChannel message is limited by the SCTP stack (Chrome ~256 KB, some relays less) and the
// game's largest frame (`b.snap`, `b.start`) can exceed that once the field fills. Frames stay
// whole at the protocol level: a transport that must split one wraps the slices in an envelope
// that cannot collide with a game frame (game frames start with '{', envelopes with '\u0001CH:'),
// and the receiver re-assembles before net.js ever sees the text.
//
// Pure text in / text out: no globals, no timers — unit-testable in isolation.

/** Envelope marker. U+0001 cannot start a JSON frame, so detection is a prefix compare. */
export const CHUNK_PREFIX = '\u0001CH:';

/**
 * UTF-8 byte length of a string without TextEncoder (shared/ stays free of browser and Node
 * globals so it typechecks under lib ES2022 and runs anywhere).
 * @param {string} str
 * @returns {number}
 */
export function utf8ByteLength(str) {
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length && str.charCodeAt(i + 1) >= 0xdc00 && str.charCodeAt(i + 1) <= 0xdfff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/**
 * Bytes one source character contributes inside `JSON.stringify(text)` — the form the envelope
 * stores it in. Quotes and backslashes double, control characters become `\uXXXX`, lone surrogates
 * are escaped (well-formed JSON.stringify), everything else is its raw UTF-8 length.
 * @param {string} str
 * @param {number} i index of the character
 * @returns {{ bytes: number, units: number }} bytes after encoding, UTF-16 units consumed
 */
function encodedCost(str, i) {
  const c = str.charCodeAt(i);
  if (c === 0x22 || c === 0x5c) return { bytes: 2, units: 1 }; // " or \
  if (c < 0x20) return { bytes: 6, units: 1 };                  // \uXXXX
  if (c >= 0xd800 && c <= 0xdbff) {
    if (i + 1 < str.length && str.charCodeAt(i + 1) >= 0xdc00 && str.charCodeAt(i + 1) <= 0xdfff) {
      return { bytes: 4, units: 2 }; // valid pair, raw in JSON
    }
    return { bytes: 6, units: 1 };   // lone high surrogate → \uD800
  }
  if (c >= 0xdc00 && c <= 0xdfff) return { bytes: 6, units: 1 }; // lone low surrogate
  if (c < 0x80) return { bytes: 1, units: 1 };
  if (c < 0x800) return { bytes: 2, units: 1 };
  return { bytes: 3, units: 1 };
}

// Envelope shell without the payload: CHUNK_PREFIX + JSON [id, i, last, ""] with worst-case
// digit counts (id and i stay below 2^31 → 10 digits each, `true` = 4).
const ENVELOPE_OVERHEAD = CHUNK_PREFIX.length + '[2147483647,2147483647,true,""]'.length;

/**
 * Is `text` too big for one message of `maxBytes` UTF-8 bytes? `maxBytes <= 0` = unlimited.
 * @param {string} text
 * @param {number} maxBytes
 * @returns {boolean}
 */
export function needsChunk(text, maxBytes) {
  return maxBytes > 0 && utf8ByteLength(text) > maxBytes;
}

/**
 * Split `text` into wire messages of at most `maxBytes` UTF-8 bytes each. A frame that already
 * fits comes back as `[text]` (sent raw, no envelope). Oversized frames come back as envelope
 * messages carrying `{ id, index, last, slice }`; `id` tags the frame so the assembler can spot a
 * boundary. Slices never break a surrogate pair.
 * @param {string} text
 * @param {number} maxBytes must be > 0 (call after `needsChunk`)
 * @param {number} id frame id (integer below 2^31, unique per frame on one channel)
 * @returns {string[]}
 */
export function chunkMessages(text, maxBytes, id) {
  if (!needsChunk(text, maxBytes)) return [text];
  const out = [];
  const budget = Math.max(1, maxBytes - ENVELOPE_OVERHEAD);
  let start = 0;
  let index = 0;
  while (start < text.length) {
    let used = 0;
    let end = start;
    while (end < text.length) {
      const cost = encodedCost(text, end);
      if (used + cost.bytes > budget) break;
      used += cost.bytes;
      end += cost.units;
    }
    if (end === start) {
      // One character exceeds the whole budget (maxBytes smaller than one encoded character plus
      // the envelope): force it through rather than loop forever — tests use sane sizes.
      end = start + encodedCost(text, start).units;
    }
    const last = end >= text.length;
    out.push(CHUNK_PREFIX + JSON.stringify([id, index, last, text.slice(start, end)]));
    start = end;
    index++;
  }
  return out;
}

/**
 * Re-assembles chunk envelopes; passes non-chunk messages through untouched (a frame that fit was
 * sent raw). One instance per channel — chunks are ordered, so a wrong index or a new frame id
 * drops the partial buffer instead of guessing.
 */
export class FrameAssembler {
  constructor() {
    /** @type {number|null} */
    this._id = null;
    /** @type {string[]} */
    this._buf = [];
  }

  /**
   * Feed one inbound wire message.
   * @param {any} msg
   * @returns {string|null} a complete frame, or null while a chunked frame is still incomplete
   */
  push(msg) {
    if (typeof msg !== 'string') return null;
    if (!msg.startsWith(CHUNK_PREFIX)) {
      this._id = null;
      this._buf = [];
      return msg;
    }
    /** @type {any} */
    let env;
    try {
      env = JSON.parse(msg.slice(CHUNK_PREFIX.length));
    } catch {
      this.reset();
      return null;
    }
    if (!Array.isArray(env) || env.length !== 4 || typeof env[0] !== 'number' || typeof env[1] !== 'number'
        || typeof env[3] !== 'string') {
      this.reset();
      return null;
    }
    const [id, index, last, slice] = env;
    if (this._id !== id) {
      this._id = id;
      this._buf = [];
    }
    if (index !== this._buf.length) {
      this.reset();
      return null;
    }
    this._buf.push(slice);
    if (last !== true) return null;
    const frame = this._buf.join('');
    this.reset();
    return frame;
  }

  /** Drop any partial frame (channel reset / close). */
  reset() {
    this._id = null;
    this._buf = [];
  }
}
