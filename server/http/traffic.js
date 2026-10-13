// server/http/traffic.js — what this server has sent and received since it started (host bandwidth, layer 0):
//
//   * HTTP: per category of shared/assetPaths.js trafficCategory (assets / audio / code / data / other) the responses
//     and the body bytes actually written (after gzip / brotli; headers not counted), and how many were 304s;
//   * WebSocket: the connections, the bytes on the wire both ways (the sockets' own counters, after permessage-deflate,
//     frame headers included, the HTTP upgrade not) and the message payloads before compression — their ratio is what
//     the compression saves.
//
// routes.js meters every response (`meter`), websocket.js every socket (`wsOpen` / `wsClose` / `wsSent` / `wsReceived`);
// `snapshot()` is the `traffic` object of GET /healthz?traffic=1 (docs/DEPLOY.md §5). Nothing is stored or sent
// anywhere else; the counters start at zero with the process.

import { TRAFFIC_CATEGORIES, trafficCategory } from '../../shared/assetPaths.js';

/** Byte length of a chunk handed to res.write / res.end (a string in `encoding`, utf8 by default). */
function chunkBytes(chunk, encoding) {
  if (chunk == null || typeof chunk === 'function') return 0;
  if (typeof chunk === 'string') return Buffer.byteLength(chunk, typeof encoding === 'string' && Buffer.isEncoding(encoding) ? encoding : 'utf8');
  return typeof chunk.byteLength === 'number' ? chunk.byteLength : 0;
}

/** Length of a ws 'message' payload (a Buffer, an ArrayBuffer or, fragmented, a Buffer list). */
function payloadBytes(data) {
  if (Array.isArray(data)) return data.reduce((n, b) => n + payloadBytes(b), 0);
  return data && typeof data.byteLength === 'number' ? data.byteLength : typeof data === 'string' ? Buffer.byteLength(data) : 0;
}

/**
 * A traffic counter for one server.
 * @param {{ now?: () => number }} [opts]
 */
export function createTrafficCounter({ now = Date.now } = {}) {
  const startedAt = now();
  const http = Object.fromEntries(TRAFFIC_CATEGORIES.map((c) => [c, { requests: 0, bytes: 0, notModified: 0 }]));
  const ws = { connections: 0, wireOut: 0, wireIn: 0, payloadOut: 0, payloadIn: 0, messagesOut: 0, messagesIn: 0 };
  /** @type {Map<import('node:net').Socket, { out: number, in: number }>} live sockets and their counters at the upgrade */
  const live = new Map();

  /** One finished HTTP response. */
  function record(path, status, bytes) {
    const c = http[trafficCategory(path)] || http.other;
    c.requests++;
    c.bytes += bytes;
    if (status === 304) c.notModified++;
  }

  return {
    /**
     * Count the body bytes of `res` (every res.write / res.end) under the category of `path`, once the response is
     * done or its connection gone.
     * @param {import('node:http').ServerResponse} res
     * @param {string} path the request's URL path
     */
    meter(res, path) {
      let bytes = 0;
      const { write, end } = res;
      res.write = function meteredWrite(chunk, encoding, cb) {
        bytes += chunkBytes(chunk, encoding);
        return write.call(this, chunk, encoding, cb);
      };
      res.end = function meteredEnd(chunk, encoding, cb) {
        bytes += chunkBytes(chunk, encoding);
        return end.call(this, chunk, encoding, cb);
      };
      res.once('close', () => record(path, res.statusCode, bytes));
    },
    /** A WebSocket connection opened on `socket` (after its upgrade answer was written). */
    wsOpen(socket) {
      ws.connections++;
      if (socket && !live.has(socket)) live.set(socket, { out: socket.bytesWritten || 0, in: socket.bytesRead || 0 });
    },
    /** …and closed: its wire bytes move to the totals. */
    wsClose(socket) {
      const base = live.get(socket);
      if (!base) return;
      live.delete(socket);
      ws.wireOut += Math.max(0, (socket.bytesWritten || 0) - base.out);
      ws.wireIn += Math.max(0, (socket.bytesRead || 0) - base.in);
    },
    /** A message handed to ws.send (its payload before compression). */
    wsSent(data) { ws.messagesOut++; ws.payloadOut += payloadBytes(data); },
    /** A message received (its payload after inflating). */
    wsReceived(data) { ws.messagesIn++; ws.payloadIn += payloadBytes(data); },
    /** The counters now (plain JSON). */
    snapshot() {
      let wireOut = ws.wireOut;
      let wireIn = ws.wireIn;
      for (const [socket, base] of live) {
        wireOut += Math.max(0, (socket.bytesWritten || 0) - base.out);
        wireIn += Math.max(0, (socket.bytesRead || 0) - base.in);
      }
      const byCat = Object.fromEntries(Object.entries(http).map(([k, v]) => [k, { ...v }]));
      const total = Object.values(http).reduce((t, v) => ({ requests: t.requests + v.requests, bytes: t.bytes + v.bytes }), { requests: 0, bytes: 0 });
      return {
        since: new Date(startedAt).toISOString(),
        seconds: Math.max(0, Math.round((now() - startedAt) / 1000)),
        http: { ...byCat, total },
        ws: { ...ws, open: live.size, wireOut, wireIn },
      };
    },
  };
}
