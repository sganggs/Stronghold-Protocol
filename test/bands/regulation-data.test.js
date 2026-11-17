import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSIONS } from '../../shared/versions.js';

const read = (v, file) => JSON.parse(readFileSync(new URL(`../../data/${v.dir}${file}.json`, import.meta.url)));

test('规程 exports all 74 command rows in their 61 complete, acyclic chains', () => {
  const v = VERSIONS.find(v => v.family === 'regulation');
  const bands = read(v, 'bands'), effects = read(v, 'effects');
  const seen = new Set();
  assert.equal(Object.keys(bands).length, 61);
  for (const band of Object.values(bands)) {
    assert.equal(band.skills[0].effectId, band.effectId);
    for (const [i, skill] of band.skills.entries()) {
      assert.ok(!seen.has(skill.effectId));
      seen.add(skill.effectId);
      assert.equal(skill.next, band.skills[i + 1]?.effectId ?? null);
      assert.deepEqual(skill.buffs, effects[skill.effectId].buffs);
      assert.ok(['NONE', 'PASSIVE', 'ACTIVE'].includes(skill.type));
      assert.ok(['DEFAULT', 'ROUND_RESET', 'COOLDOWN', 'ALL_LIMIT'].includes(skill.availType));
      assert.ok(Array.isArray(skill.unlockParam));
      assert.equal(typeof skill.descRaw, 'string');
    }
  }
  assert.equal(seen.size, 74);
  assert.deepEqual(bands.band_dance.skills.map(s => s.availCount), [1, 2, 3, 4]);
  assert.deepEqual(bands.band_rich.skills.map(s => s.unlockParam), [['60'], ['120'], []]);
});

test('the four covenant versions omit the command schema', () => {
  for (const v of VERSIONS.filter(v => v.family === 'covenant')) {
    for (const b of Object.values(read(v, 'bands'))) assert.equal(Object.hasOwn(b, 'skills'), false, `${v.id}: ${b.bandId}`);
  }
});
