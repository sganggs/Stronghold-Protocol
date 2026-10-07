// Concurrent, idempotent, verifying downloader for the asset pipeline.
//
// - Bounded concurrency (default 16) over a job list; each job writes exactly one
//   file under the output root, atomically (temp file + rename), so a partial
//   download never appears at the final path.
// - Per source: up to `retries` attempts with exponential backoff on network
//   errors, timeouts, 403/429/5xx and payloads that fail format validation;
//   a 404/410 moves on immediately. Each candidate uses its opt-in prefix proxy
//   first (when enabled), then the original URL and jsDelivr fallback. The proxy gets one short attempt
//   per file and shares a run-wide circuit breaker with the index/font fetchers.
// - Idempotent: an existing file is kept when its size matches the ledger entry
//   of a previous download or the expected byte count from research, or (when
//   neither is known) when it passes format validation. The ledger lives in
//   .cache/assets-ledger.json. `keepExisting` (fetch-assets --add-only) keeps
//   every existing file as it is; `written` = the files this run wrote.

import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { MirrorPolicy } from './network.mjs';
import { validate } from './formats.mjs';

/**
 * @typedef {{ rel: string, urls: string[], kind: string, bytes?: number, mutable?: boolean }} Job
 * @typedef {{ status: 'ok'|'skip'|'miss'|'error', bytes: number, url?: string, error?: string, sizeChanged?: boolean }} JobResult
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class HttpError extends Error {
  constructor(status, url) { super(`HTTP ${status} ${url}`); this.status = status; }
}

function fmtMB(n) { return (n / 1048576).toFixed(1) + ' MB'; }

export class Downloader {
  /**
   * @param {object} o
   * @param {string} o.root absolute output directory (public/assets)
   * @param {string} o.ledgerPath absolute path of the ledger JSON
   * @param {number} [o.concurrency]
   * @param {number} [o.retries]
   * @param {number} [o.timeoutMs]
   * @param {boolean} [o.force] re-download even when files exist
   * @param {boolean} [o.keepExisting] never re-download or rewrite an existing file (a checkout sharing public/assets)
   * @param {(msg:string)=>void} [o.log]
   * @param {typeof fetch} [o.fetchImpl]
   * @param {number} [o.backoffMs] base retry delay (doubles per attempt)
   * @param {'direct'|'mirror'} [o.source] preferred download source
   * @param {string} [o.proxyPrefix] HTTPS prefix for GitHub downloads
   * @param {MirrorPolicy} [o.mirrorPolicy] invocation-wide policy and mirror circuit breaker
   */
  constructor({ root, ledgerPath, concurrency = 16, retries = 3, timeoutMs = 120000, force = false, keepExisting = false, log = console.log, fetchImpl = globalThis.fetch, backoffMs = 400, source = 'direct', proxyPrefix, mirrorPolicy }) {
    this.root = root;
    this.ledgerPath = ledgerPath;
    this.concurrency = Math.max(1, Math.min(64, Number(concurrency) || 16));
    this.retries = Math.max(1, Number(retries) || 3);
    this.timeoutMs = timeoutMs;
    this.force = force && !keepExisting;
    this.keepExisting = !!keepExisting;
    /** @type {Set<string>} the files (paths under root) this run wrote */
    this.written = new Set();
    this.log = log;
    this.fetch = fetchImpl;
    this.network = mirrorPolicy ?? new MirrorPolicy({ source, proxyPrefix, log });
    this.backoffMs = Math.max(0, Number(backoffMs) || 0);
    this.ledger = { files: {} };
    this.totals = { ok: 0, skip: 0, miss: 0, error: 0, bytesDownloaded: 0, sizeChanged: 0 };
    this.dirty = 0;
    this.saving = false;
  }

  /** Load the ledger (missing or corrupt ledger → empty). */
  async loadLedger() {
    try {
      const j = JSON.parse(await readFile(this.ledgerPath, 'utf8'));
      if (j && typeof j === 'object' && j.files && typeof j.files === 'object') this.ledger = j;
    } catch { /* first run */ }
  }

  /** Persist the ledger. */
  async saveLedger() {
    await mkdir(dirname(this.ledgerPath), { recursive: true });
    const tmp = this.ledgerPath + '.tmp';
    await writeFile(tmp, JSON.stringify(this.ledger));
    await rename(tmp, this.ledgerPath);
    this.dirty = 0;
  }

  /**
   * Decide whether an existing file can be kept.
   * @param {Job} job
   * @returns {Promise<number>} size of the kept file, or -1 to (re)download
   */
  async existingSize(job) {
    if (this.force) return -1;
    const abs = join(this.root, job.rel);
    let st;
    try { st = await stat(abs); } catch { return -1; }
    if (!st.isFile() || st.size <= 0) return -1;
    if (this.keepExisting) return st.size;
    const led = this.ledger.files[job.rel];
    if (job.mutable) {
      // Post-processed files (atlases) change size; validate content instead.
      try { return validate(job.kind, await readFile(abs)) ? st.size : -1; } catch { return -1; }
    }
    if (led && led.bytes === st.size) return st.size;
    if (job.bytes && job.bytes === st.size) return st.size;
    if (led && led.bytes !== st.size) return -1; // changed since we wrote it
    // Unknown provenance (e.g. ledger deleted): keep it only if it validates.
    try { return validate(job.kind, await readFile(abs)) ? st.size : -1; } catch { return -1; }
  }

  /**
   * Fetch one URL with retries.
   * @returns {Promise<{buf:Buffer}|{notFound:true}|{skipped:true}|{error:string}>}
   */
  async fetchWithRetries(url, kind) {
    if (this.network.skip(url)) return { skipped: true };
    let lastErr = 'unknown error';
    const attempts = this.network.isProxy(url) ? 1 : this.retries;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const res = await this.network.request(url, this.fetch, {
          headers: { 'user-agent': 'stronghold-protocol-fetch-assets/1.0' },
          redirect: 'follow',
        }, this.timeoutMs);
        if (res.status === 404 || res.status === 410) {
          try { await res.body?.cancel(); } catch { /* ignore */ }
          this.network.succeeded(url); // a missing asset is not a proxy outage
          return { notFound: true };
        }
        if (!res.ok) {
          try { await res.body?.cancel(); } catch { /* ignore */ }
          throw new HttpError(res.status, url);
        }
        const buf = await this.network.readBody(url, res);
        const len = Number(res.headers.get('content-length'));
        const enc = res.headers.get('content-encoding');
        if (!enc && Number.isFinite(len) && len > 0 && len !== buf.length) {
          throw new Error(`truncated body ${buf.length}/${len} ${url}`);
        }
        if (!validate(kind, buf)) throw new Error(`invalid ${kind} payload (${buf.length} B) ${url}`);
        this.network.succeeded(url);
        return { buf };
      } catch (e) {
        lastErr = e?.message || String(e);
        this.network.failed(url);
        if (attempt < attempts && this.backoffMs) await sleep(this.backoffMs * 2 ** (attempt - 1) + Math.floor(Math.random() * this.backoffMs));
      }
    }
    return { error: lastErr };
  }

  /**
   * Download one job (all candidate URLs and mirrors).
   * @param {Job} job
   * @returns {Promise<JobResult>}
   */
  async runJob(job) {
    const kept = await this.existingSize(job);
    if (kept >= 0) return { status: 'skip', bytes: kept };
    let lastError = null;
    for (const url of job.urls) {
      const sources = this.network.urls(url);
      for (const src of sources) {
        const r = await this.fetchWithRetries(src, job.kind);
        if (r.notFound || r.skipped) continue;
        if (r.error) { lastError = r.error; continue; }
        const abs = join(this.root, job.rel);
        await mkdir(dirname(abs), { recursive: true });
        const tmp = `${abs}.part${process.pid}`;
        try {
          await writeFile(tmp, r.buf);
          await rename(tmp, abs);
        } catch (e) {
          try { await unlink(tmp); } catch { /* ignore */ }
          return { status: 'error', bytes: 0, error: `write failed: ${e.message}` };
        }
        this.ledger.files[job.rel] = { url: src, bytes: r.buf.length };
        this.written.add(job.rel);
        this.dirty++;
        const sizeChanged = !!(job.bytes && job.bytes !== r.buf.length && !job.mutable);
        return { status: 'ok', bytes: r.buf.length, url: src, sizeChanged };
      }
    }
    if (lastError) this.network.directFailureHint();
    return lastError ? { status: 'error', bytes: 0, error: lastError } : { status: 'miss', bytes: 0, error: 'not found (404) on all sources' };
  }

  /**
   * Run a list of jobs with bounded concurrency. Duplicate `rel`s are run once.
   * @param {Job[]} jobs
   * @param {string} label progress label
   * @returns {Promise<Map<string, JobResult>>}
   */
  async run(jobs, label = 'download') {
    const unique = [];
    const seen = new Set();
    for (const j of jobs) { if (!seen.has(j.rel)) { seen.add(j.rel); unique.push(j); } }
    const results = new Map();
    const t0 = Date.now();
    let done = 0; let bytes = 0; let lastLog = 0;
    const counts = { ok: 0, skip: 0, miss: 0, error: 0 };
    const progress = (force) => {
      const now = Date.now();
      if (!force && now - lastLog < 2000) return;
      lastLog = now;
      const secs = Math.max(0.001, (now - t0) / 1000);
      this.log(`[${label}] ${done}/${unique.length} ok=${counts.ok} skip=${counts.skip} miss=${counts.miss} err=${counts.error} ` +
        `${fmtMB(bytes)} ${(bytes / 1048576 / secs).toFixed(2)} MB/s`);
    };
    let next = 0;
    const worker = async () => {
      while (next < unique.length) {
        const job = unique[next++];
        let r;
        try { r = await this.runJob(job); } catch (e) { r = { status: 'error', bytes: 0, error: e?.message || String(e) }; }
        results.set(job.rel, r);
        counts[r.status]++;
        this.totals[r.status]++;
        if (r.status === 'ok') { bytes += r.bytes; this.totals.bytesDownloaded += r.bytes; }
        if (r.sizeChanged) this.totals.sizeChanged++;
        done++;
        if (this.dirty >= 200 && !this.saving) {
          this.saving = true;
          try { await this.saveLedger(); } catch { /* retried at the end */ } finally { this.saving = false; }
        }
        progress(false);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, unique.length) }, worker));
    if (unique.length) progress(true);
    await this.saveLedger();
    return results;
  }
}
