// Raw Git object verification, shared by indexes and the asset downloader.
import { createHash } from 'node:crypto';
import { guardDefaultFetch } from './env-proxy.mjs';

function blobHash(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

export class SourceVerifier {
  constructor(snapshot, { fetchImpl = globalThis.fetch, token = process.env.GH_TOKEN, timeoutMs = 30000 } = {}) {
    if (!snapshot || Array.isArray(snapshot) || typeof snapshot !== 'object') throw new Error('invalid source snapshot');
    for (const [key, value] of Object.entries(snapshot)) {
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[^?#\s\\]+$/.test(key) || !value ||
          !/^[a-f0-9]{40}$/i.test(value.commit) || !/^[a-f0-9]{40}$/i.test(value.tree)) {
        throw new Error(`invalid source snapshot entry ${key}`);
      }
    }
    this.snapshot = snapshot;
    this.fetch = guardDefaultFetch(fetchImpl);
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.trees = new Map();
  }

  async tree(repo, sha, recursive) {
    const key = `${repo}/${sha}/${recursive}`;
    if (!this.trees.has(key)) {
      const pending = (async () => {
        const headers = { accept: 'application/vnd.github+json' };
        if (this.token) headers.authorization = `Bearer ${this.token}`;
        // Never forward API credentials to redirects or payload transports.
        const res = await this.fetch(`https://api.github.com/repos/${repo}/git/trees/${sha}${recursive ? '?recursive=1' : ''}`, {
          headers, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!res.ok) throw new Error(`source tree API HTTP ${res.status} (${repo})`);
        const data = await res.json();
        if (!Array.isArray(data.tree) || typeof data.truncated !== 'boolean') throw new Error(`invalid source tree (${repo})`);
        if (!recursive && data.truncated) throw new Error(`truncated source subtree (${repo})`);
        if (!data.truncated && data.tree.some((e) => !e || typeof e.path !== 'string' || !e.path ||
          !['blob', 'tree', 'commit'].includes(e.type) || !/^[a-f0-9]{40}$/i.test(e.sha))) {
          throw new Error(`invalid source tree entry (${repo})`);
        }
        // Never use partial recursive results as evidence of presence or absence.
        return { truncated: data.truncated, entries: new Map(data.truncated ? [] : data.tree.map((e) => [e.path, e])) };
      })();
      this.trees.set(key, pending);
    }
    const data = await this.trees.get(key);
    return data;
  }

  async resolve(url) {
    const parsed = new URL(url);
    if (parsed.origin !== 'https://raw.githubusercontent.com' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('unsupported source URL: expected public raw.githubusercontent.com URL');
    const parts = parsed.pathname.slice(1).split('/').map(decodeURIComponent);
    const repo = parts.slice(0, 2).join('/');
    // Match the snapshot branch, including branch names containing slashes.
    const key = Object.keys(this.snapshot).filter((k) => k.startsWith(repo + '@') &&
      parts.slice(2).join('/').startsWith(k.slice(repo.length + 1) + '/'))
      .sort((a, b) => b.length - a.length)[0];
    if (!key) throw new Error(`source snapshot missing ${repo}@${parts[2]}`);
    const pin = this.snapshot[key];
    const path = parts.slice(2).join('/').slice(key.length - repo.length);
    // Very large repositories can return HTTP 500 instead of a truncated tree.
    // Complete subtree lookups still provide the same authoritative blob IDs.
    const recursive = await this.tree(repo, pin.tree, true).catch(() => null);
    let entry;
    if (recursive && !recursive.truncated) entry = recursive.entries.get(path);
    else {
      const segments = path.split('/');
      if (segments.length > 64) throw new Error('source path exceeds subtree traversal limit');
      let sha = pin.tree;
      for (let i = 0; i < segments.length; i++) {
        if (i > 0) {
          const nested = await this.tree(repo, sha, true).catch(() => null);
          if (nested && !nested.truncated) {
            entry = nested.entries.get(segments.slice(i).join('/'));
            break;
          }
        }
        const subtree = await this.tree(repo, sha, false);
        entry = subtree.entries.get(segments[i]);
        if (!entry) break;
        if (i < segments.length - 1) {
          if (entry.type !== 'tree') { entry = null; break; }
          if (!/^[a-f0-9]{40}$/i.test(entry.sha)) throw new Error('invalid source subtree SHA');
          sha = entry.sha;
        }
      }
    }
    if (!entry || entry.type !== 'blob') return null;
    if (!/^[a-f0-9]{40}$/i.test(entry.sha)) throw new Error('invalid source blob SHA');
    return { blob: entry.sha.toLowerCase(), commit: pin.commit, url,
      pinnedUrl: `https://raw.githubusercontent.com/${repo}/${pin.commit}/${path.split('/').map(encodeURIComponent).join('/')}` };
  }

  verify(bytes, source) {
    if (blobHash(bytes) !== source.blob) throw new Error(`source blob mismatch (${source.url})`);
  }
}
