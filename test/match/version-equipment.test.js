// Round 53 owner report: 第一期 never sold equipment. Pin each version's official unlock levels, all lobby modes,
// solo/four seats, actual purchases and the other equipment surfaces in separate version-data processes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('../helpers/versionEquipment.mjs', import.meta.url));
for (const version of ['act1autochess', 'act1autochess@V1_1', 'act2autochess@V2_1']) {
  test(`${version}: official shop levels offer buyable equipment; drafts, pools and rewards grant it`, () => {
    const result = spawnSync(process.execPath, [helper, version], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
    const rows = JSON.parse(result.stdout.trim());
    assert.equal(rows.length, 6, 'three difficulties, solo and four-player co-op');
    for (const row of rows) {
      assert.equal(row.players, row.mode.includes('_single_') ? 1 : 4);
      assert.deepEqual(row.levels, version.startsWith('act1') ? [5, 6] : [1, 2, 3, 4, 5, 6]);
    }
  });
}
