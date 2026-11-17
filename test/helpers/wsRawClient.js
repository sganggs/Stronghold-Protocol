// A raw WebSocket client for frame-level assertions: it performs the upgrade itself and parses the server's frames,
// reporting each frame's own size, its RSV1 bit and its text (inflated with the connection's deflate context).
// `ws` hides both — a client-side socket counter sees TCP coalescing, and RSV1 is internal — so the transport tests
// need this instead of the library.
import net from 'node:net';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const CRLF = Buffer.from('\r\n');

/**
 * Open a session and return a client: `next()` resolves the next frame, `close()` ends it.
 * @param {{ port: number, host?: string, extensions?: string }} opts `extensions` is sent as
 *   Sec-WebSocket-Extensions ('' sends none).
 */
export function rawClient({ port, host = '127.0.0.1', extensions = 'permessage-deflate; client_max_window_bits' }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ port, host });
    const key = crypto.randomBytes(16).toString('base64');
    let buf = Buffer.alloc(0);
    let handshaken = false;
    let response = '';
    let inflate = null;
    const frames = [];
    const waiters = [];

    const pump = () => {
      while (waiters.length && frames.length) waiters.shift()(frames.shift());
    };

    const readFrame = async () => {
      if (buf.length < 2) return undefined;
      const b0 = buf[0];
      const b1 = buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const rsv1 = (b0 & 0x40) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return undefined;
        len = buf.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return undefined;
        len = Number(buf.readBigUInt64BE(2)); off = 10;
      }
      const masked = (b1 & 0x80) !== 0;
      const maskLen = masked ? 4 : 0;
      if (buf.length < off + maskLen + len) return undefined;
      let payload = buf.subarray(off + maskLen, off + maskLen + len);
      if (masked) {
        const mask = buf.subarray(off, off + 4);
        const copy = Buffer.from(payload);
        for (let i = 0; i < copy.length; i++) copy[i] ^= mask[i & 3];
        payload = copy;
      }
      const bytes = off + maskLen + len;
      buf = buf.subarray(bytes);
      if (!fin) throw new Error('fragmented frame: the server is expected to send whole messages');
      // control frames are answered / dropped here, never handed to `next()`: a heartbeat ping must not look like a
      // message to a test that counts frames
      if (opcode === 0x8) { socket.end(); return null; }
      if (opcode === 0x9) { socket.write(framed(0x0a, payload)); return null; } // pong
      if (opcode === 0xa) return null;
      if (opcode === 0x0 || opcode === 0x1) {
        let text;
        if (rsv1) {
          text = await new Promise((res) => {
            inflate ??= zlib.createInflateRaw();
            const chunks = [];
            const onData = (c) => chunks.push(c);
            inflate.on('data', onData);
            inflate.write(payload);
            inflate.write(Buffer.from([0x00, 0x00, 0xff, 0xff]));
            inflate.flush(zlib.constants.Z_SYNC_FLUSH, () => {
              inflate.off('data', onData);
              res(Buffer.concat(chunks).toString('utf8'));
            });
          });
        } else text = payload.toString('utf8');
        return { bytes, rsv1, opcode, text };
      }
      return { bytes, rsv1, opcode, text: '' };
    };

    const framed = (opcode, payload) => {
      const mask = crypto.randomBytes(4);
      const head = [];
      head.push(0x80 | opcode);
      if (payload.length < 126) head.push(0x80 | payload.length);
      else if (payload.length < 65536) { head.push(0x80 | 126); head.push(payload.length >> 8, payload.length & 0xff); }
      else {
        head.push(0x80 | 127);
        const len = Buffer.alloc(8);
        len.writeBigUInt64BE(BigInt(payload.length));
        head.push(...len);
      }
      const h = Buffer.from(head);
      const body = Buffer.from(payload);
      for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
      return Buffer.concat([h, mask, body]);
    };

    socket.on('connect', () => {
      socket.write([
        'GET /ws HTTP/1.1',
        `Host: ${host}:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        ...(extensions ? [`Sec-WebSocket-Extensions: ${extensions}`] : []),
        '', '',
      ].join('\r\n'));
    });

    let parsing = false;
    const drain = async () => {
      if (parsing) return; // a second 'data' during an await is picked up by the running loop (it reads `buf`)
      parsing = true;
      try {
        for (;;) {
          const frame = await readFrame();
          if (frame === undefined) break; // the rest of the frame has not arrived yet
          if (frame === null) continue;   // a control frame, answered above
          frames.push(frame);
          pump();
        }
      } finally { parsing = false; }
    };

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshaken) {
        const end = buf.indexOf(Buffer.from('\r\n\r\n'));
        if (end < 0) return;
        response = buf.subarray(0, end).toString('latin1');
        buf = buf.subarray(end + 4);
        if (!/^HTTP\/1\.1 101/.test(response)) { reject(new Error(`upgrade refused: ${response.split('\r\n')[0]}`)); return; }
        handshaken = true;
        resolve({
          response,
          next() { return new Promise((res) => { if (frames.length) res(frames.shift()); else waiters.push(res); }); },
          send: (text) => socket.write(framed(0x1, Buffer.from(text))),
          close: () => socket.destroy(),
        });
      }
      // Parse what is complete; the rest stays buffered until more bytes arrive.
      drain();
    });
    socket.on('error', reject);
  });
}
