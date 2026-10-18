// One linked candidate for author saves and uploads; only requested changes are written back.
import fs from 'node:fs';
import path from 'node:path';
import { StudioError, STUDIO_LIMITS } from './files.js';
import { isPackPath } from '../../shared/plugins/manifest.js';
import { validatePng } from './mediaValidation.js';
import { createCandidate, createCandidateAsync, candidateLimits, commitCandidate, inventory } from './candidate.js';
import { checkCandidate } from './check.js';

export function snapshotDocuments(files, id) {
  return Object.fromEntries(inventory(files.root(id)).filter(f => !f.rel.split('/').some(p => p.startsWith('.')) && /\.(json|html)$/i.test(f.rel))
    .map(f => [f.rel, fs.readFileSync(f.abs)]));
}

export function stageUploads(input, documents, manifest, { validate = true } = {}) {
  if (input.uploads === undefined) return;
  if (input.template !== 'fx' || !Array.isArray(input.uploads) || input.uploads.length > 128)
    throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'uploads: at most 128 flipbook PNG files' });
  const overlay = typeof manifest.assets === 'string' ? JSON.parse(documents[manifest.assets]) : manifest.assets;
  const images = new Set(Object.values(overlay?.fx?.flipbooks || {}).map(b => b.image)), seen = new Set();
  for (const upload of input.uploads) {
    const rel = upload?.path;
    if (!isPackPath(rel) || !/\.png$/i.test(rel) || !images.has(rel) || seen.has(rel))
      throw new StudioError('PLUGIN_STUDIO_PATH', 400, { detail: 'upload must name a distinct declared flipbook PNG' });
    seen.add(rel);
    if (typeof upload.data !== 'string' || upload.data.length > Math.ceil(STUDIO_LIMITS.fileBytes / 3) * 4)
      throw new StudioError('PLUGIN_STUDIO_SIZE', 413, { file: rel });
    const bytes = Buffer.from(upload.data, 'base64');
    if (validate) validatePng(bytes, rel, { fx: true });
    documents[rel] = bytes;
  }
}

export function writeDocuments(candidate, id, documents) {
  for (const [rel, value] of Object.entries(documents)) {
    const bytes = Buffer.from(value), old = candidate.entries.find(f => f.rel === rel);
    // Only form text is compared. Uploaded/generated media is already a requested write.
    if (old && /\.(json|html)$/i.test(rel) && fs.readFileSync(old.abs).equals(bytes)) continue;
    candidate.files.write(id, rel, bytes, { generated: true });
  }
}

export function commitDocuments(files, id, documents, sidecar = null) {
  const candidate = createCandidate(files, id);
  try {
    writeDocuments(candidate, id, documents); candidateLimits(candidate);
    commitCandidate(files, id, candidate, sidecar);
  } finally { candidate.cleanup(); }
}

export function captureLockChange(candidate) {
  const lock = path.join(candidate.dir, 'plugin.lock.json'), before = candidate.entries.find(f => f.rel === 'plugin.lock.json');
  candidate.changes.delete('plugin.lock.json');
  if (fs.existsSync(lock) && (!before || !fs.readFileSync(lock).equals(fs.readFileSync(before.abs)))) candidate.changes.add('plugin.lock.json');
}

export async function editMediaDraft(files, id, edit, { dataDir }) {
  const candidate = await createCandidateAsync(files, id);
  try {
    edit(candidate.files);
    const checked = await checkCandidate({ dir: candidate.dir, live: files.root(id), dataDir, pluginsDir: files.base, strict: true, uploads: [...candidate.changes] });
    if (!checked.ok) {
      const p = checked.problems[0]; throw new StudioError(p.code, 400, { where: p.path, detail: p.message });
    }
    captureLockChange(candidate);
    commitCandidate(files, id, candidate);
  } finally { await candidate.cleanupAsync(); }
}
