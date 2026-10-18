// Local official tables only: workshop bytes never become input tables or executable modules.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deriveOfficialUnit } from './officialUnitBuilder.js';

export function localOfficialUnits(dataDir) {
  let loaded;
  return (charId, statuses) => {
    if (!loaded) {
      const root = path.resolve(dataDir, '../.cache/gamedata');
      try {
        const tables = {}, hashes = [];
        for (const [key, name] of Object.entries({ charTable: 'character_table', skillTable: 'skill_table', rangeTable: 'range_table' })) {
          const bytes = fs.readFileSync(path.join(root, 'excel', `${name}.json`));
          tables[key] = JSON.parse(bytes);
          hashes.push(createHash('sha256').update(bytes).digest('hex'));
        }
        // Version is a reproducible fingerprint even when the cache has no release metadata. [ASSUMED]
        for (const [key, name] of Object.entries({ uniequip: 'uniequip_table', battleEquip: 'battle_equip_table' })) {
          try { const bytes = fs.readFileSync(path.join(root, 'excel', `${name}.json`)); tables[key] = JSON.parse(bytes); hashes.push(createHash('sha256').update(bytes).digest('hex')); } catch { /* no selected module */ }
        }
        try { const bytes = fs.readFileSync(path.join(root, 'excel/activity_table.json')); tables.ac = JSON.parse(bytes).autoChessData; hashes.push(createHash('sha256').update(bytes).digest('hex')); } catch { /* builder's default trigger */ }
        const version = 'sha256:' + createHash('sha256').update(hashes.join('\n')).digest('hex');
        loaded = { tables, version };
      } catch (e) { loaded = { error: `Local official character/skill/range tables unavailable: ${e.code ?? e.message}` }; }
    }
    if (loaded.error) throw new Error(loaded.error);
    return { unit: deriveOfficialUnit(loaded.tables, charId, statuses), version: loaded.version };
  };
}
