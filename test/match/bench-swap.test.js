// Round 53: exercise each official version in the same data isolation used by version hosts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('../helpers/benchSwap.mjs', import.meta.url));
for (const version of ['act2autochess', 'act1autochess', 'act1autochess@V1_1', 'act2autochess@V2_1']) {
  test(`${version}: full bench swaps preserve counts and real additions keep their limits`, () => {
    const result = spawnSync(process.execPath, [helper, version], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
  });
}
