import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';

// [ASSUMED] No redirects at all; bounded raw UTF-8 responses, no compression. Never log remote errors/body/argv.
export function httpDecision(config, observation, signal) {
  return new Promise((resolve, reject) => {
    const url = new URL(config.url);
    const body = JSON.stringify(observation);
    const request = (url.protocol === 'https:' ? https : http).request(url, {
      method: 'POST', signal, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
        ...(config.token ? { authorization: `Bearer ${config.token}` } : {}) },
    }, response => {
      if (response.statusCode !== 200) { response.destroy(); request.destroy(); reject(new Error('http-status')); return; }
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
    const timer = setTimeout(() => request.destroy(new Error('timeout')), config.timeoutMs);
    request.on('close', () => clearTimeout(timer));
    request.on('error', () => reject(new Error('transport')));
    request.end(body);
  });
}

// [ASSUMED] One multiplexed, long-lived child per match; request IDs correlate concurrent seats.
// Crash/protocol failure kills this child; next demand restarts after backoff (no idle restart loop).
export class StdioAI {
  constructor(config) {
    this.config = config;
    this.child = null;
    this.pending = new Map();
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
        const pending = this.pending.get(reply?.id);
        if (!pending) { fail(); return; }
        pending.finish(null, reply);
      }
      if (buffer.length > this.config.maxBytes) fail();
    });
  }

  request(observation, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new Error('cancelled')); return; }
      try { this.start(); } catch { reject(new Error('backoff')); return; }
      const abort = () => this.breakChild();
      const timer = setTimeout(abort, this.config.timeoutMs);
      const finish = (error, reply) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        this.pending.delete(observation.id);
        if (error) reject(new Error('transport')); else resolve(reply);
      };
      this.pending.set(observation.id, { finish });
      signal.addEventListener('abort', abort, { once: true });
      this.child.stdin.write(`${JSON.stringify(observation)}\n`);
    });
  }

  breakChild() {
    const child = this.child;
    this.child = null;
    this.retryAt = Date.now() + this.config.backoffMs;
    // [ASSUMED] SIGKILL bounds cleanup even if the configured program ignores SIGTERM.
    child?.kill('SIGKILL');
    for (const p of [...this.pending.values()]) p.finish(true);
  }

  close() { this.closed = true; this.breakChild(); }
}
