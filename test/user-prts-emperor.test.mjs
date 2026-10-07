import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle } from './helpers/battleHarness.js';

test('user Given Emperor and twenty deployments When the operator deploys again Then its next redeploy time halves again', () => {
  const h = makeBattle({ bandId: 'band_emperor', units: [{ chessId: 'chess_char_1_01_a', row: 10, col: 4 }], autoFinish: false });
  h.step();
  const u = h.unit('chess_char_1_01_a');
  for (let deployment = 1; deployment <= 21; deployment++) {
    h.b.retreat(u, { reason: 'raid' });
    const expected = u.base.respawnTime / 2 ** deployment;
    assert.ok(Math.abs((u.respawnAt - u.deathAt) - expected) < expected * 1e-6,
      `deployment ${deployment}: cooldown should be ${expected}`);
    if (deployment < 21) assert.ok(h.b._deploy(u));
  }
});
