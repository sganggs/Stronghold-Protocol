// Plugin author diagnostics only; never alter placement or battle data (DESIGN §34.21).
import fs from 'node:fs';
import path from 'node:path';
import { applyPatches, normalizeSettings } from '../../shared/plugins/patch.js';
import { expandRecords } from '../../shared/plugins/records.js';
import { makeIssue } from '../../shared/plugins/errors.js';

/** The mode's stage is shared by Final Assault and Hidden Core, including both players' halves. */
export function bossCentreWarnings(data) {
  const used = new Set();
  for (const mode of Object.values(data?.config?.modes ?? {})) {
    if (!mode || mode.type === 'SINGLE' || /^mode_single_/.test(mode.modeId ?? '')) continue;
    if (!Object.values(mode.rounds ?? {}).some(r => r?.isBoss || r?.isHidden)) continue;
    for (const id of Array.isArray(mode.stages) ? mode.stages : []) if (typeof id === 'string') used.add(id);
  }
  const issues = [];
  for (const id of used) {
    const stage = data.stages?.[id];
    if (!stage || !Array.isArray(stage.rows)) continue;
    const rows = [];
    // Official levels/activities/act*autochess/level_act*autochess_m*.json: mapData.tiles.buildableType NONE
    // on boss col 10. Board col 10 maps to 10 on the left and 20 - 10 on the right (DATA §12).
    // Maintainer decision 2026-10-17 (#659 / #660): warn only; retain the plugin's placement rules.
    for (let row = 1; row <= 5; row++) {
      const glyph = typeof stage.rows[row] === 'string' ? stage.rows[row][10] : undefined;
      const tile = (stage.tiles ?? stage.legend)?.[glyph];
      // [ASSUMED] Also warn under removable blockers, and for active deployment platforms (board.js roles).
      if (['ALL', 'MELEE', 'RANGED'].includes(tile?.buildable)
        || (Array.isArray(stage.devices) && stage.devices.some(d => d?.active && ['platform', 'waterPlatform'].includes(d.role) && d.pos?.[0] === row && d.pos[1] === 10))) rows.push(row);
    }
    if (!rows.length) continue;
    // [ASSUMED] One finding per stage, with all affected field rows in ascending order.
    const stageName = typeof stage.name === 'string' && stage.name ? `${stage.name} (${id})` : id;
    const detail = `stage ${stageName}: boss centre column 10 is deployable at field rows ${rows.join(', ')}; both players map to the same tile and battle deploys only the first unit`;
    issues.push(makeIssue('warning', 'PLUGIN_BOSS_CENTRE_DEPLOYABLE', detail,
      { at: ['stages', id], stage: stageName, rows: rows.join(', ') }));
  }
  return issues;
}

/** Read-only, no script execution: the stage/mode slice of one folder, with the same patch/record expanders as C1.
 * Dependency-only paths still require the full content-set check, which calls bossCentreWarnings again.
 */
export function pluginStageWarnings(plugin, dataDir) {
  const parts = [];
  for (const part of ['data', 'stages', 'modes']) for (const rel of plugin.manifest.parts[part]?.files ?? []) {
    const doc = plugin.content.documents[rel];
    const entries = part === 'data' ? doc?.entries : (Array.isArray(doc) ? doc : [doc]).map(v => ({ ...v, file: part }));
    const ops = part === 'data' && doc?.patch === 1 ? doc.ops?.filter(op => op?.file === 'stages' || op?.file === 'config') : null;
    const records = entries?.filter(r => r?.file === 'stages' || r?.file === 'modes');
    if (ops?.length || records?.length) parts.push({ ops, records });
  }
  if (!parts.length) return [];
  let data;
  try {
    data = Object.fromEntries(['config', 'stages'].map(file => [file, JSON.parse(fs.readFileSync(path.join(dataDir, `${file}.json`), 'utf8'))]));
  } catch { return []; } // A checkout without game data can still check manifests and files.
  const settings = normalizeSettings(plugin.manifest.settings);
  for (const { ops, records } of parts) {
    for (const op of ops ?? []) data = applyPatches(data, [op], { pluginId: plugin.id, settings }).data;
    for (const record of records ?? []) data = expandRecords(data, [record], { pluginId: plugin.id }).data;
  }
  return bossCentreWarnings(data);
}
