import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';

// Optional caller headers (an LLM gateway's client identification, e.g. OpenCode Go's user agent and stable
// x-opencode-session): plain token names and single-line values only; they can never replace the content headers or
// the authorization, which are set after them.
// [ASSUMED] Header name/value bounds and the reserved set are shared with strict LLM environment validation.
const RESERVED_HEADERS = new Set(['authorization', 'proxy-authorization', 'x-api-key', 'host', 'cookie', 'cookie2',
  'set-cookie', 'transfer-encoding', 'connection', 'trailer', 'te', 'upgrade']);
// RFC 9110 §10.2.3: delta-seconds or HTTP-date. Retain only a numeric delay, never a remote header/body.
export function retryAfterMs(value, now = Date.now()) {
  if (typeof value !== 'string' || value.length > 128) return undefined;
  const text = value.trim();
  const ms = /^\d+$/.test(text) ? Number(text) * 1000
    : /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/.test(text) ? Date.parse(text) - now : NaN;
  return Number.isFinite(ms) ? Math.max(0, ms) : undefined;
}

export function safeHeaders(h, { strict = false } = {}) {
  const out = {};
  if (!h || typeof h !== 'object' || Array.isArray(h)) {
    if (strict) throw new Error('headers');
    return out;
  }
  for (const [k, v] of Object.entries(h)) {
    const name = String(k).toLowerCase();
    if (!/^[a-z0-9-]{1,64}$/.test(name) || RESERVED_HEADERS.has(name) || name.startsWith('content-')
      || typeof v !== 'string' || !v || v.length > 256 || /[^\x20-\x7e\x80-\xff]/.test(v) || Object.hasOwn(out, name)) {
      if (strict) throw new Error('headers');
      continue;
    }
    out[name] = v;
  }
  return out;
}

// [ASSUMED] No redirects at all; bounded raw UTF-8 responses, no compression. Never log remote errors/body/argv.
export function httpDecision(config, observation, signal) {
  return new Promise((resolve, reject) => {
    // Credentials use a dedicated setting, never caller headers. Bearer remains the transport default.
    const authType = config.authType || 'bearer';
    if (!['bearer', 'x-api-key'].includes(authType)) { reject(new Error('auth-type')); return; }
    const url = new URL(config.url);
    const body = JSON.stringify(observation);
    const request = (url.protocol === 'https:' ? https : http).request(url, {
      method: 'POST', signal, headers: { ...safeHeaders(config.headers), 'content-type': 'application/json',
        'content-length': Buffer.byteLength(body), ...(config.token ? (authType === 'x-api-key'
          ? { 'x-api-key': config.token } : { authorization: `Bearer ${config.token}` }) : {}) },
    }, response => {
      if (response.statusCode !== 200) {
        const error = Object.assign(new Error('http-status'), { status: response.statusCode });
        const delay = retryAfterMs(response.headers['retry-after']);
        if (delay !== undefined) Object.assign(error, { retryAfterMs: delay });
        response.destroy(); request.destroy(); reject(error); return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > config.maxBytes) { response.destroy(); request.destroy(); reject(new Error('response-size')); }
        else chunks.push(chunk);
      });
      response.on('error', () => reject(new Error('transport')));
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('malformed')); }
      });
    });
    // Covers DNS/connect/header/body stalls, including trickled bodies; independent of the phase scheduler.
    const timer = config.timeoutMs === 0 ? null : setTimeout(() => request.destroy(new Error('timeout')), config.timeoutMs);
    request.on('close', () => clearTimeout(timer));
    request.on('error', () => reject(new Error('transport')));
    request.end(body);
  });
}

// [ASSUMED] One multiplexed, long-lived child per match; request IDs correlate concurrent seats.
// Crash/protocol failure kills this child; next demand restarts after backoff (no idle restart loop).
// §35.62: a cancelled request (the host dropped that decision) ends only that request; its late reply is
// ignored by ID. The child is killed only for a protocol error, a crash, or a timeout with no reply at all
// since the request was written (a real hang), so one slow seat cannot fail every other seat's request.
const ABANDONED_CAP = 256;
export class StdioAI {
  constructor(config) {
    this.config = config;
    this.child = null;
    this.pending = new Map();
    this.abandoned = new Set();
    this.replies = 0;
    this.retryAt = 0;
    this.closed = false;
  }

  start() {
    if (this.closed || Date.now() < this.retryAt) throw new Error('backoff');
    if (this.child) return;
    const [file, ...args] = this.config.command;
    const child = spawn(file, args, { shell: false, stdio: ['pipe', 'pipe', 'ignore'] });
    this.child = child;
    let buffer = Buffer.alloc(0);
    const fail = () => { if (this.child === child) this.breakChild(); };
    child.on('error', fail);
    child.on('exit', fail);
    child.stdin.on('error', fail);
    child.stdout.on('error', fail);
    child.stdout.on('data', chunk => {
      if (this.child !== child) return;
      buffer = Buffer.concat([buffer, chunk]);
      let end;
      while ((end = buffer.indexOf(10)) !== -1) { // loop-cap: bytes in the received chunk, bounded frames
        if (end > this.config.maxBytes) { fail(); return; }
        let reply;
        try { reply = JSON.parse(buffer.subarray(0, end).toString('utf8')); } catch { fail(); return; }
        buffer = buffer.subarray(end + 1);
        this.replies++;
        const pending = this.pending.get(reply?.id);
        if (!pending) {
          if (this.abandoned.delete(reply?.id)) continue;
          fail(); return;
        }
        pending.finish(null, reply);
      }
      if (buffer.length > this.config.maxBytes) fail();
    });
  }

  request(observation, signal, { timeoutMs = this.config.timeoutMs } = {}) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new Error('cancelled')); return; }
      try { this.start(); } catch { reject(new Error('backoff')); return; }
      const child = this.child, replies = this.replies;
      const cancel = () => {
        if (this.pending.get(observation.id)?.finish !== finish) return;
        if (this.child === child) {
          if (this.abandoned.size >= ABANDONED_CAP) this.abandoned.delete(this.abandoned.values().next().value);
          this.abandoned.add(observation.id);
        }
        finish(true);
      };
      // No line from the child since this request was written: treat as a hang and restart after backoff.
      const timer = timeoutMs === 0 ? null : setTimeout(() => (this.child === child && this.replies === replies ? this.breakChild() : cancel()), timeoutMs);
      const finish = (error, reply) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        this.pending.delete(observation.id);
        if (error) reject(new Error('transport')); else resolve(reply);
      };
      this.pending.set(observation.id, { finish });
      signal.addEventListener('abort', cancel, { once: true });
      this.child.stdin.write(`${JSON.stringify(observation)}\n`);
    });
  }

  breakChild() {
    const child = this.child;
    this.child = null;
    this.retryAt = Date.now() + this.config.backoffMs;
    // [ASSUMED] SIGKILL bounds cleanup even if the configured program ignores SIGTERM.
    child?.kill('SIGKILL');
    this.abandoned.clear();
    for (const p of [...this.pending.values()]) p.finish(true);
  }

  close() { this.closed = true; this.breakChild(); }
}
