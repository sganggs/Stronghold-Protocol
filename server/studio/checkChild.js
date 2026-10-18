// Data-only packer/composer checks in a disposable child. No author code is imported or executed.
import fs from 'node:fs';
import path from 'node:path';
import { linkFile } from './candidate.js';
import { checkGameplayFolder } from './gameplayCheck.js';
import { createPluginFiles } from './files.js';
import { effectImages, validatePng } from './mediaValidation.js';
import { atlasInfo } from '../../tools/assets/atlas.mjs';
import { parseSkel } from '../../tools/assets/skel.mjs';

process.on('disconnect', () => process.exit(0));
process.once('message', ({ dir, live, dataDir, pluginsDir, strict, uploads, stage }) => {
  try {
    if (stage) {
      const directories = new Set([stage.dir]);
      for (const f of stage.entries) linkFile(f.abs, path.join(stage.dir, f.rel), directories);
      process.send({ checked: { ok: true, problems: [] } }); return;
    }
    const files = createPluginFiles(path.dirname(dir)), id = path.basename(dir);
    const images = uploads?.length ? effectImages(files, id) : new Set();
    for (const rel of uploads || []) {
      const ext = path.extname(rel).toLowerCase();
      if (!['.png', '.skel', '.atlas'].includes(ext)) continue;
      const bytes = fs.readFileSync(files.stat(id, rel).abs);
      if (ext === '.png') validatePng(bytes, rel, { fx: images.has(rel) });
      if (ext === '.atlas') { const info = atlasInfo(bytes.toString('utf8')); if (!info.pages.length || !info.hasSize) throw new Error('invalid Spine atlas'); }
      if (ext === '.skel') { const parsed = parseSkel(new Uint8Array(bytes), new Set()); if (!parsed.animations.length) throw new Error('skeleton has no animations'); }
    }
    const checked = checkGameplayFolder(dir, { dataDir, pluginsDir, strict, enforceLimits: true });
    if (live && !checked.ok) {
      const before = checkGameplayFolder(live, { dataDir, pluginsDir, strict, updateLock: false });
      // [ASSUMED] Compare exact reasons, including measured numbers; one finding excuses one identical copy.
      const key = p => JSON.stringify([p.code, p.path || p.params?.where || p.file || p.at?.join('.') || '', p.message ?? p.text ?? p.params?.detail ?? '']);
      const existing = new Map();
      for (const p of before.problems) { const k = key(p); existing.set(k, (existing.get(k) || 0) + 1); }
      checked.problems = checked.problems.filter(p => {
        const k = key(p), count = existing.get(k) || 0;
        if (!count) return true;
        existing.set(k, count - 1); return false;
      });
      checked.ok = !checked.problems.length;
    }
    process.send({ checked });
  } catch (e) { process.send({ error: { code: e.code?.startsWith('PLUGIN_') ? e.code : 'PLUGIN_PART_SHAPE', status: e.status || 400, params: e.params || { detail: e.message } } }); }
});
