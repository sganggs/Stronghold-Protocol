// Private server state. Never place this directory under a static mount.
import { mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export class Persistence {
  constructor(directory, log = console) {
    this.directory = resolve(directory);
    this.log = log;
    this.pendingResults = new Map();
    this.retryTimer = null;
    for (const name of ['profiles', 'matches']) mkdirSync(join(this.directory, name), { recursive: true, mode: 0o700 });
  }

  profilePath(token) {
    const hash = createHash('sha256').update(token).digest('hex');
    return join(this.directory, 'profiles', `${hash}.json`);
  }

  readProfile(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token)) return null;
    let raw;
    try { raw = readFileSync(this.profilePath(token), 'utf8'); }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    const profile = JSON.parse(raw);
    if (profile.v !== 1 || !/^p_[a-f0-9]{10}$/.test(profile.playerId)) throw new Error('Invalid saved profile');
    return profile;
  }

  writeProfile(session, changes = {}) {
    const { playerId, loadout, notOwned, diy } = { ...session, ...changes };
    this.writeJson(this.profilePath(session.token), { v: 1, playerId, loadout, notOwned, diy });
  }

  writeJson(file, value) {
    // A failed write leaves the previous complete record intact.
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flush: true });
    renameSync(temporary, file);
  }

  startMatch(metadata) {
    // Refuse new matches until a previous result can be saved; do not grow a failure backlog.
    this.flushResults();
    const id = randomUUID();
    this.writeJson(join(this.directory, 'matches', `${id}.json`), { v: 1, id, ...metadata, status: 'started' });
    return id;
  }

  recordAction(id, action) {
    appendFileSync(join(this.directory, 'matches', `${id}.actions.jsonl`), JSON.stringify(action) + '\n', { mode: 0o600, flush: true });
  }

  finishMatch(id, result, status = 'finished') {
    this.pendingResults.set(id, { status, finishedAt: Date.now(), result });
    try { this.flushResults(); }
    catch (e) {
      if (!this.retryTimer) {
        this.retryTimer = setInterval(() => {
          try { this.flushResults(); }
          catch (error) { this.log.error('[storage] result retry failed', error); }
        }, 5000);
        this.retryTimer.unref();
      }
      throw e;
    }
  }

  flushResults() {
    for (const [id, result] of this.pendingResults) {
      const file = join(this.directory, 'matches', `${id}.json`);
      const record = JSON.parse(readFileSync(file, 'utf8'));
      this.writeJson(file, { ...record, ...result });
      this.pendingResults.delete(id);
    }
    clearInterval(this.retryTimer);
    this.retryTimer = null;
  }

  close() {
    clearInterval(this.retryTimer);
    this.retryTimer = null;
    this.flushResults();
  }
}
