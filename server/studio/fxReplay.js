// A saved plugin's visual test uses the same record resolution and checked preview as a room, without author code.
import fs from 'node:fs';
import path from 'node:path';
import { StudioError } from './files.js';
import { createPreviews } from './preview.js';

export function addFxReplay(result, registry, selected, data, files, { staged = [] } = {}) {
  if (!result?.ok) return result;
  const ids = new Set();
  const visit = (id, depth = 0) => {
    if (depth > 32 || ids.has(id)) return;
    const p = registry.plugin(id); if (!p) return;
    for (const dep of Object.keys(p.manifest.requires || {})) visit(dep, depth + 1);
    ids.add(id);
  };
  visit(selected);
  const fx = {}, previews = createPreviews({ vanilla: () => registry.vanillaAssets() });
  for (const id of ids) for (const op of previews.preview(id, files.root(id)).ops) if (op.at?.[0] === 'fx' && op.value) fx[id] = op.value;
  // [ASSUMED] Embed at most 8 MiB of staged compressed PNG bytes (inside the 16 MiB trial result cap).
  // Data URLs last as long as the replay, even after its draft directory is removed or the live plugin changes.
  let imageBytes = 0;
  for (const rel of new Set(staged)) {
    const image = fx[selected]?.images?.[rel]; if (!image) continue;
    const file = path.join(files.root(selected), rel);
    imageBytes += fs.statSync(file).size;
    if (imageBytes > 8 * 1024 * 1024) throw new StudioError('PLUGIN_STUDIO_TRIAL_LIMIT', 413);
    image.url = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
  }
  const infos = [...result.plugin.field.units, ...result.plugin.frames.flatMap(f => f.ev.filter(e => e[0] === 'spawn').map(e => e[1]))];
  const records = { chess: {}, enemies: {}, tokens: {}, backups: { units: {} } };
  for (const info of infos) {
    const file = info.side === 'enemy' ? 'enemies' : info.kind === 'token' ? 'tokens' : 'chess';
    const r = data[file]?.[info.defId]; if (r) records[file][info.defId] = r;
    if (info.diy?.charId && data.backups?.units?.[info.diy.charId]) records.backups.units[info.diy.charId] = data.backups.units[info.diy.charId];
  }
  if (Object.keys(fx).length || Object.values(records.chess).some(r => r.fx) || Object.values(records.backups.units).some(r => r.fx)) {
    result.plugin.fxAssets = fx; result.plugin.renderRecords = records;
  }
  return result;
}
