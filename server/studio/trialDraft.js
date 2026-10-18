// Generated draft files obey the same pack-path contract as saved studio files.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { isPackPath } from '../../shared/plugins/manifest.js';
import { StudioError } from './files.js';
export function writeTrialDraftFile(dir, rel, text) {
  if (!isPackPath(rel) || path.isAbsolute(rel)) throw new StudioError('PLUGIN_STUDIO_PATH', 403, { detail: rel });
  const target = path.join(dir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Replace a candidate hardlink, never write through its shared inode.
  const tmp = path.join(path.dirname(target), `.studio-${randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, text, { flag: 'wx' });
  try { fs.renameSync(tmp, target); }
  catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
}
