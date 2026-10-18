// [ASSUMED] Candidates live inside the real plugins directory, under a dot name (registry readDirSorted ignores it).
// Walk before staging anything: even an undeclared/hidden symlink refuses the whole transaction.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createPluginFiles, StudioError } from './files.js';
import { checkCandidate } from './check.js';
import { WALK_LIMITS } from '../plugins/registry.js';
import { PLUGIN_LIMITS } from '../../shared/plugins/manifest.js';

export function inventory(dir) {
  const entries = [];
  let dirs = 0, visited = 0;
  function walk(folder, prefix, depth) {
    if (depth > WALK_LIMITS.depth || ++dirs > WALK_LIMITS.dirs) throw new StudioError('PLUGIN_FILE_SIZE', 413);
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      if (++visited > WALK_LIMITS.entries) throw new StudioError('PLUGIN_FILE_SIZE', 413);
      const rel = prefix + item.name, abs = path.join(folder, item.name), st = fs.lstatSync(abs);
      if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile())) throw new StudioError('PLUGIN_STUDIO_PATH', 403, { detail: rel });
      if (st.isDirectory()) walk(abs, rel + '/', depth + 1);
      else entries.push({ rel, abs, bytes: st.size, mtime: st.mtimeMs, ino: st.ino });
    }
  }
  walk(dir, '', 0);
  return entries;
}

export function linkFile(from, to, directories = null) {
  if (!fs.lstatSync(from).isFile()) throw new StudioError('PLUGIN_STUDIO_PATH', 403);
  const dir = path.dirname(to);
  if (!directories?.has(dir)) { fs.mkdirSync(dir, { recursive: true }); directories?.add(dir); }
  try { fs.linkSync(from, to); }
  catch { fs.copyFileSync(from, to, fs.constants.COPYFILE_FICLONE); }
}

export function folderRevision(entries) {
  const hash = createHash('sha256');
  for (const f of [...entries].sort((a, b) => a.rel.localeCompare(b.rel))) {
    if (f.rel.split('/').some(p => p.startsWith('.'))) continue;
    hash.update(f.rel).update('\0');
    // [ASSUMED] Text revisions hash bytes; media revisions use size/mtime/inode to avoid loading unchanged media.
    if (/\.(json|html)$/i.test(f.rel)) hash.update(fs.readFileSync(f.abs));
    else hash.update(`${f.bytes}:${f.mtime}:${f.ino}`);
  }
  return hash.digest('hex');
}

export function createCandidate(files, id, { deferLinks = false } = {}) {
  const live = files.root(id), entries = inventory(live), revision = folderRevision(entries);
  const tmp = fs.mkdtempSync(path.join(path.dirname(live), '.sp-studio-'));
  try {
    const staged = createPluginFiles(tmp); staged.root(id, { create: true });
    const directories = new Set([staged.root(id)]);
    if (!deferLinks) for (const f of entries) linkFile(f.abs, path.join(tmp, id, f.rel), directories);
    const changes = new Set(), removed = new Set(), write = staged.write, remove = staged.remove;
    staged.write = (key, rel, bytes, opts) => { const result = write(key, rel, bytes, { ...opts, aggregate: false }); changes.add(rel); removed.delete(rel); return result; };
    staged.remove = (key, rel) => { remove(key, rel); changes.delete(rel); removed.add(rel); };
    return { files: staged, dir: staged.root(id), tmp, revision, entries, changes, removed,
      cleanupAsync: () => fs.promises.rm(tmp, { recursive: true, force: true }),
      cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
  } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); throw e; }
}

// Link creation on some filesystems also takes seconds at the 5000-file cap. Keep it off the game loop.
export async function createCandidateAsync(files, id) {
  const candidate = createCandidate(files, id, { deferLinks: true });
  try {
    await checkCandidate({ stage: { entries: candidate.entries, dir: candidate.dir } });
    return candidate;
  } catch (e) { await candidate.cleanupAsync(); throw e; }
}

export function candidateLimits(candidate) {
  const entries = inventory(candidate.dir).filter(f => !f.rel.split('/').some(p => p.startsWith('.')));
  if (entries.length > PLUGIN_LIMITS.files) throw new StudioError('PLUGIN_FILE_SIZE', 413);
  if (entries.reduce((sum, f) => sum + f.bytes, 0) > PLUGIN_LIMITS.pluginBytes) throw new StudioError('PLUGIN_STUDIO_SIZE', 413);
}

export function commitCandidate(files, id, candidate, sidecar = null) {
  if (folderRevision(inventory(files.root(id))) !== candidate.revision) throw new StudioError('PLUGIN_STUDIO_CHANGED', 409);
  const previous = new Map(candidate.entries.map(f => [f.rel, f]));
  const backup = path.join(candidate.tmp, '.rollback'); fs.mkdirSync(backup);
  const paths = [...new Set([...candidate.changes, ...candidate.removed, ...(sidecar ? ['.studio.json'] : [])])];
  for (const rel of paths) if (previous.has(rel)) linkFile(previous.get(rel).abs, path.join(backup, rel));
  const written = [];
  try {
    // Media first, manifest last. Atomic writes replace links, never modify shared inodes.
    const order = rel => rel === 'plugin.json' ? 2 : /\.(json|html|css|js|md|txt)$/i.test(rel) ? 1 : 0;
    for (const rel of [...candidate.changes].sort((a, b) => order(a) - order(b))) {
      files.write(id, rel, fs.readFileSync(path.join(candidate.dir, rel)), { generated: true, aggregate: false }); written.push(rel);
    }
    for (const rel of candidate.removed) { files.remove(id, rel); written.push(rel); }
    if (sidecar) { files.writeSidecar(id, '.studio.json', sidecar); written.push('.studio.json'); }
  } catch (e) {
    for (const rel of written.reverse()) {
      const dest = path.join(files.root(id), rel), old = path.join(backup, rel);
      if (previous.has(rel)) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.renameSync(old, dest); }
      else fs.rmSync(dest, { force: true });
    }
    throw e;
  }
}
