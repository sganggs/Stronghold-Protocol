// Local presentation metadata only. No imported pack code, no network and no route of its own.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../data.js';
import { fxId } from '../../public/js/render/vfx/pluginFormat.js';

export function officialEffects(publicDir = path.join(ROOT, 'public')) {
  try {
    const file = path.join(publicDir, 'assets/local/fx/index.json');
    if (fs.statSync(file).size > 16 * 1024 * 1024) return []; // [ASSUMED] local authoring metadata budget
    const index = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (index.format !== 'fx-index' || index.version !== 3) return [];
    return Object.entries(index.units || {}).filter(([key, unit]) => fxId(key) && unit?.kind === 'char')
      .map(([key, unit]) => ({ key, skills: Object.keys(unit.skills || {}).filter(fxId) }));
  } catch { return []; }
}
