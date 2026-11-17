// test/helpers/wsClient.js — promise-based WebSocket test client for server tests.
//
// Every inbound JSON frame is appended to an inbox. `waitFor(type, predicate)` consumes the first matching
// frame already in the inbox or the next one to arrive (so there is no race between an action and the
// wait for its effect). `request(msg)` assigns a `rid` and resolves with the server's direct reply
// (`ok` / `error` / `welcome` / `pong` carrying that rid).
//
//   const c = await TestClient.connect(`ws://127.0.0.1:${port}/ws`);
//   const welcome = await c.hello('Doctor');
//   const reply = await c.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
//   const state = await c.waitFor('room.state');
//   await c.close();

import WebSocket from 'ws';
import { DEFAULT_VERSION } from '../../shared/versions.js';

const REPLY_TYPES = new Set(['ok', 'error', 'welcome', 'pong']);

export class TestClient {
  /**
   * Open a socket and resolve once connected.
   * @param {string} url ws://host:port/ws
   * @param {{ timeout?: number, wsOptions?: object }} [opts] wsOptions are passed to `new WebSocket`
   * @returns {Promise<TestClient>}
   */
  static connect(url, { timeout = 3000, wsOptions = {} } = {}) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, wsOptions);
      const timer = setTimeout(() => { ws.terminate(); reject(new Error(`connect timeout ${url}`)); }, timeout);
      ws.once('open', () => { clearTimeout(timer); resolve(new TestClient(ws)); });
      ws.once('error', (e) => { clearTimeout(timer); reject(e); });
    });
  }

  /** @param {WebSocket} ws */
  constructor(ws) {
    this.ws = ws;
    /** @type {any[]} unconsumed frames */
    this.inbox = [];
    /** @type {any[]} every frame ever received (never consumed) */
    this.log = [];
    /** @type {{ match: (m: any) => boolean, resolve: Function }[]} */
    this.waiters = [];
    this.nextRid = 1;
    /** @type {{ code: number, reason: string } | null} */
    this.closeInfo = null;
    this.closed = new Promise((resolve) => {
      ws.on('close', (code, reason) => {
        this.closeInfo = { code, reason: reason.toString() };
        resolve(this.closeInfo);
      });
    });
    ws.on('error', () => {});
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      this.log.push(msg);
      const i = this.waiters.findIndex((w) => w.match(msg));
      if (i >= 0) {
        const [w] = this.waiters.splice(i, 1);
        w.resolve(msg);
      } else {
        this.inbox.push(msg);
      }
    });
  }

  /** True while the socket is OPEN. */
  get isOpen() { return this.ws.readyState === WebSocket.OPEN; }

  /**
   * Send a message; assigns `rid` unless the message already has one (use `rid: null` to omit it).
   * @param {object} msg
   * @returns {number | undefined} the rid used
   */
  send(msg) {
    const out = { ...msg };
    // a room.create names 第二期下半 unless the test names a version: the server's lobby default is 规程·序列Ⅰ
    // (shared/versions.js LOBBY_DEFAULT_VERSION) and these tests exercise the classic room; `version: undefined` asks
    // for the server's default
    if (out.t === 'room.create' && !Object.hasOwn(out, 'version')) out.version = DEFAULT_VERSION;
    if (out.rid === undefined) out.rid = this.nextRid++;
    if (out.rid === null) delete out.rid;
    this.ws.send(JSON.stringify(out));
    return out.rid;
  }

  /** Send a raw frame (string or Buffer). @param {string | Buffer} data @param {{ binary?: boolean }} [opts] */
  sendRaw(data, { binary = false } = {}) {
    this.ws.send(data, { binary });
  }

  /**
   * Wait for a frame of `type` (or any type when null) matching `predicate`.
   * @param {string | null} type
   * @param {(m: any) => boolean} [predicate]
   * @param {number} [timeout] ms
   * @returns {Promise<any>}
   */
  waitFor(type, predicate = () => true, timeout = 2000) {
    const match = (m) => (type == null || m.t === type) && predicate(m);
    const i = this.inbox.findIndex(match);
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { match, resolve: (m) => { clearTimeout(timer); resolve(m); } };
      const timer = setTimeout(() => {
        const k = this.waiters.indexOf(waiter);
        if (k >= 0) this.waiters.splice(k, 1);
        const recent = this.log.slice(-8).map((m) => m.t + (m.code ? `:${m.code}` : '')).join(', ');
        reject(new Error(`timeout waiting for ${type ?? 'any'} (recent: ${recent || 'none'})`));
      }, timeout);
      this.waiters.push(waiter);
    });
  }

  /**
   * Resolve after `ms` if no matching frame arrived (and none is in the inbox); reject otherwise.
   * @param {string | null} type @param {(m: any) => boolean} [predicate] @param {number} [ms]
   */
  async expectNone(type, predicate = () => true, ms = 150) {
    const got = await this.waitFor(type, predicate, ms).catch(() => null);
    if (got) throw new Error(`unexpected ${got.t}: ${JSON.stringify(got).slice(0, 200)}`);
  }

  /**
   * Send with a fresh rid and wait for the direct reply (ok / error / welcome / pong with that rid).
   * @param {object} msg @param {number} [timeout]
   * @returns {Promise<any>}
   */
  request(msg, timeout = 2000) {
    const rid = this.send({ ...msg, rid: this.nextRid++ });
    return this.waitFor(null, (m) => REPLY_TYPES.has(m.t) && m.rid === rid, timeout);
  }

  /**
   * Say hello and resolve with the `welcome` frame (rejects on `error`).
   * @param {string} name @param {string} [token] @param {object} [extra]
   */
  async hello(name, token, extra = {}) {
    const reply = await this.request({ t: 'hello', name, version: 1, ...(token ? { token } : {}), ...extra });
    if (reply.t !== 'welcome') throw new Error(`hello failed: ${JSON.stringify(reply)}`);
    return reply;
  }

  /** Drop every unconsumed frame. */
  clearInbox() { this.inbox.length = 0; }

  /** Close gracefully and wait for the close event. */
  async close() {
    if (this.ws.readyState === WebSocket.CLOSED) return this.closeInfo;
    this.ws.close();
    return this.closed;
  }

  /** Kill the TCP connection without a close handshake (simulates a network drop). */
  async terminate() {
    this.ws.terminate();
    return this.closed;
  }
}

/**
 * Connect and say hello in one step.
 * @param {string} url @param {string} name @param {string} [token]
 * @returns {Promise<{ client: TestClient, welcome: any }>}
 */
export async function connectAs(url, name, token) {
  const client = await TestClient.connect(url);
  const welcome = await client.hello(name, token);
  return { client, welcome };
}
