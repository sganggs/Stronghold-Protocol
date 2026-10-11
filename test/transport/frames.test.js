// test/transport/frames.test.js — chunking/reassembly (PRD M1, TR-7).
//
// Pure text in / text out: every oversized frame must survive split->reassemble byte-identical,
// every wire message must stay within its byte budget, and non-chunk traffic must pass through
// untouched (a frame that fits is sent raw).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CHUNK_PREFIX, utf8ByteLength, needsChunk, chunkMessages, FrameAssembler } from '../../shared/transportFrames.js';

/** Split then reassemble through a fresh assembler - the wire round trip. */
function roundTrip(text, maxBytes, id = 1) {
  const parts = chunkMessages(text, maxBytes, id);
  const asm = new FrameAssembler();
  let out = null;
  for (const p of parts) {
    const frame = asm.push(p);
    if (frame !== null) {
      assert.equal(out, null, 'one complete frame per round trip');
      out = frame;
    }
  }
  return { parts, out };
}

/** Parse a chunk envelope back into [id, index, last, slice]. */
const env = (p) => JSON.parse(p.slice(CHUNK_PREFIX.length));

describe('transportFrames: utf8ByteLength', () => {
  test('counts UTF-8 bytes for every length class', () => {
    assert.equal(utf8ByteLength(''), 0);
    assert.equal(utf8ByteLength('abc'), 3);
    assert.equal(utf8ByteLength('\u00e9'), 2);
    assert.equal(utf8ByteLength('\u4e2d'), 3);
    assert.equal(utf8ByteLength('\u{1f389}'), 4, 'one astral char = 4 bytes');
    assert.equal(utf8ByteLength('\u{1f1ec}\u{1f1e7}'), 8, 'flag = two regional indicators = 2x4 bytes');
    assert.equal(utf8ByteLength('a\u4e2d\u{1f389}z'), 1 + 3 + 4 + 1);
    assert.equal(utf8ByteLength('\ud800'), 3, 'lone surrogate encodes as 3 bytes');
    assert.equal(utf8ByteLength(String.fromCharCode(7)), 1, 'control char = 1 byte on the wire');
  });

  test('matches Buffer byte length', () => {
    const samples = ['hello', '\u7a81\u51fb\u7ec4\u00b7\u8fd1\u536b', 'x'.repeat(1000), '\u00e9\u00e8\u00ea',
      '\u{1f389}\u{1f38a}', '{"t":"b.snap","b":[]}', '\n\t"\\'];
    for (const s of samples) assert.equal(utf8ByteLength(s), Buffer.byteLength(s, 'utf8'), s.slice(0, 20));
  });
});

describe('transportFrames: needsChunk', () => {
  test('0 or negative = unlimited, boundary is exclusive', () => {
    assert.equal(needsChunk('anything', 0), false);
    assert.equal(needsChunk('anything', -1), false);
    assert.equal(needsChunk('12345', 5), false, 'exactly at the limit fits');
    assert.equal(needsChunk('123456', 5), true);
    assert.equal(needsChunk('\u4e2d', 2), true, '3 bytes into a 2-byte budget');
  });
});

describe('transportFrames: chunkMessages', () => {
  test('a frame that fits comes back raw, without an envelope', () => {
    assert.deepEqual(chunkMessages('{"t":"ping","c":1}', 4096, 7), ['{"t":"ping","c":1}']);
    assert.deepEqual(chunkMessages('x'.repeat(100), 100, 1), ['x'.repeat(100)]);
  });

  test('every chunk of an oversized frame stays within the byte budget', () => {
    const text = 'a'.repeat(5000);
    const { parts, out } = roundTrip(text, 64);
    assert.ok(parts.length > 10, `split into ${parts.length} chunks`);
    for (const p of parts) assert.ok(utf8ByteLength(p) <= 64, `chunk of ${utf8ByteLength(p)} > 64`);
    assert.equal(out, text);
  });

  test('round trips: CJK, emoji pairs, JSON escapes, control chars, quotes', () => {
    const bell = String.fromCharCode(7);
    const cases = [
      '\u4e2d'.repeat(400),
      '\u{1f389}'.repeat(300),
      'line1\nline2\ttab "quoted" \\backslash',
      bell + ' bell ' + bell + ' mixed bytes',
      JSON.stringify({ t: 'b.snap', ev: [['dmg', 12345, '\u51ef\u5c14\u5e0c']], s: 'unicode' }),
      'pair \u{1f1ec}\u{1f1e7} lone \udfff end \u{1f468}\u200d\u{1f469}\u200d\u{1f467}\u200d\u{1f466}',
      'x'.repeat(100_000),
      '\u4e00'.repeat(90),
    ];
    for (const text of cases) {
      const { parts, out } = roundTrip(text, 256, 42);
      assert.equal(out, text, `round trip failed for ${JSON.stringify(text.slice(0, 30))}`);
      // The budget is exact for ordinary characters; only a single forced character may exceed it.
      for (const p of parts) assert.ok(utf8ByteLength(p) <= 264, `chunk ${utf8ByteLength(p)} > 256+8`);
    }
  });

  test('a surrogate pair is never cut between chunks', () => {
    const text = 'a'.repeat(60) + '\u{1f1ec}\u{1f1e7}' + 'b'.repeat(60);
    const parts = chunkMessages(text, 70, 5);
    assert.ok(parts.length > 1, 'actually split');
    for (const p of parts) {
      const slice = env(p)[3];
      const first = slice.charCodeAt(0);
      const last = slice.charCodeAt(slice.length - 1);
      assert.ok(!(first >= 0xdc00 && first <= 0xdfff), 'chunk starts with a low surrogate');
      assert.ok(!(last >= 0xd800 && last <= 0xdbff), 'chunk ends with a high surrogate');
    }
    assert.equal(roundTrip(text, 70, 5).out, text);
  });

  test('frame ids tag a frame; a round trip never merges two ids', () => {
    const parts = chunkMessages('y'.repeat(300), 64, 9);
    for (const p of parts) assert.equal(env(p)[0], 9);
    const asm = new FrameAssembler();
    for (const p of parts.slice(0, -1)) assert.equal(asm.push(p), null, 'still incomplete');
    assert.equal(asm.push(parts[parts.length - 1]), 'y'.repeat(300), 'completes on last');
  });

  test('budget of 1 still terminates (single char larger than the envelope)', () => {
    const text = '\u554a'.repeat(3);
    const parts = chunkMessages(text, 1, 1);
    assert.equal(parts.length, 3, 'forced through one char at a time');
    assert.equal(roundTrip(text, 1, 1).out, text);
  });
});

describe('transportFrames: FrameAssembler', () => {
  test('non-chunk messages pass through and drop any partial frame', () => {
    const asm = new FrameAssembler();
    const parts = chunkMessages('z'.repeat(300), 64, 1);
    asm.push(parts[0]);
    assert.equal(asm.push('{"t":"ok"}'), '{"t":"ok"}', 'raw frame wins');
    assert.equal(asm.push(parts[1]), null, 'partial was dropped');
    assert.equal(asm.push(parts[2]), null, 'index restarts at 0 -> mismatch -> dropped');
  });

  test('wrong index resets the buffer instead of guessing', () => {
    const asm = new FrameAssembler();
    const text = 'q'.repeat(300);
    const parts = chunkMessages(text, 64, 3);
    assert.ok(parts.length >= 3, `split into ${parts.length} chunks`);
    asm.push(parts[0]);
    assert.equal(env(parts[2])[1], 2);
    assert.equal(asm.push(parts[2]), null, 'index 2 after [0] is out of order');
    // Replay the whole sequence from scratch: the reset must not corrupt the next frame.
    let out = null;
    for (const p of parts) { const frame = asm.push(p); if (frame !== null) out = frame; }
    assert.equal(out, text, 'same sequence replays cleanly after a reset');
  });

  test('a new frame id drops the stale partial', () => {
    const asm = new FrameAssembler();
    const a = chunkMessages('a'.repeat(300), 64, 1);
    const b = chunkMessages('b'.repeat(300), 64, 2);
    asm.push(a[0]);
    asm.push(b[0]);
    assert.equal(asm.push(b[1]), null, 'id switched at [0]');
    for (const p of b.slice(2, -1)) assert.equal(asm.push(p), null);
    assert.equal(asm.push(b[b.length - 1]), 'b'.repeat(300));
  });

  test('malformed envelopes are dropped, not thrown', () => {
    const asm = new FrameAssembler();
    assert.equal(asm.push(CHUNK_PREFIX + 'not json'), null);
    assert.equal(asm.push(CHUNK_PREFIX + '{"a":1}'), null, 'not an array');
    assert.equal(asm.push(CHUNK_PREFIX + '[1,2,true]'), null, 'wrong arity');
    assert.equal(asm.push(CHUNK_PREFIX + '[1,0,true,5]'), null, 'slice not a string');
    assert.equal(asm.push('{"t":"ok"}'), '{"t":"ok"}', 'channel still usable');
    assert.equal(asm.push(null), null, 'binary frames are ignored');
    assert.equal(asm.push(12345), null, 'non-strings are ignored');
  });

  test('reset() clears a partial frame', () => {
    const asm = new FrameAssembler();
    const parts = chunkMessages('r'.repeat(300), 64, 1);
    asm.push(parts[0]);
    asm.reset();
    assert.equal(asm.push(parts[1]), null, 'after reset the stale index no longer matches');
    for (const p of chunkMessages('r'.repeat(300), 64, 4)) asm.push(p);
    assert.equal(asm.push('done'), 'done');
  });
});
