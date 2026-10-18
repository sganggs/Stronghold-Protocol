// #680: generated audio metadata only; official files are read optionally from the local cache, never fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { bankPool, indexAudio } from '../tools/assets/audio.mjs';
import { buildPlan } from '../tools/assets/plan.mjs';
import { resolveTemplate, collectLeaves } from '../tools/assets/manifest.mjs';

const manifest = JSON.parse(readFileSync(new URL('../data/assets.json', import.meta.url), 'utf8'));
const official = new URL('../.cache/gamedata/excel/audio_data.json', import.meta.url);
const sound = (asset, extra = {}) => ({ asset: `Audio/Sound_Beta_2/Player/${asset}`, minPitch: 0.8, maxPitch: 1.2, delay: 0, ...extra });

test('bank indexing preserves per-file parameters and canonical pool identity through aliases', () => {
  const bank = { name: 'first', maxSoundAllowed: 3, popOldest: true, sounds: [sound('a'), sound('b', { minPitch: 1, maxPitch: 1, delay: 0.1 })] };
  const idx = indexAudio({ soundFXBanks: [bank, { ...bank, name: 'second', maxSoundAllowed: 1, popOldest: false }], bankAlias: { alias: 'first' } });
  assert.deepEqual(idx.poolOf(idx.bank('alias')), bankPool(bank));
  assert.equal(idx.poolOf(idx.bank('alias')).id, 'first');
  assert.equal(idx.poolOf(idx.bank('second')).maxSoundAllowed, 1);
  assert.equal(idx.poolOf(idx.bank('second')).popOldest, false);
  assert.deepEqual(idx.poolOf(idx.bank('first')).sounds['player/b.mp3'], { minPitch: 1, maxPitch: 1, delay: 0.1 });
});

test('the asset plan emits ordinary and mode pool references and literal metadata without extra downloads', () => {
  const names = ['battle.ON_ABILITY_START.char_999_example.attack', 'battle.ON_ABILITY_START.char_999_example.attack.3', 'battle.ON_ABILITY_HIT.char_999_example.attack.3'];
  const raw = { soundFXBanks: names.map((name, i) => ({ name, maxSoundAllowed: i + 1, popOldest: i !== 1, sounds: [sound(i === 0 ? 'test_n' : `mode${i}_s`, { delay: i / 10 })] })) };
  const { template } = buildPlan({ assets07: { operators: { char_999_example: { skills: [{ index: 2, skillId: 'skchr_example_3' }] } } }, ops03: {}, enemies05: {}, maps05: {}, modelsData: {}, audio: indexAudio(raw) });
  const sfx = template.audio.sfx;
  const u = sfx.units.char_999_example;
  assert.deepEqual(u.pools, { attack: names[0] });
  assert.deepEqual(u.attackPools, { 2: names[1] });
  assert.deepEqual(u.hitPools, { 2: names[2] });
  assert.equal(collectLeaves(sfx.pools).length, 0);
  const resolved = resolveTemplate(sfx.pools, { root: '.', spine: new Map() }).value;
  assert.deepEqual(resolved[names[1]], { maxSoundAllowed: 2, popOldest: false, sounds: { 'player/mode1_s.mp3': { minPitch: 0.8, maxPitch: 1.2, delay: 0.1 } } });
});

test('every generated attack/hit reference resolves to a valid pool and its selected sound parameters', () => {
  const { units, pools } = manifest.audio.sfx;
  let refs = 0;
  for (const [id, u] of Object.entries(units)) {
    for (const [urls, ids] of [[{ attack: u.attack, hit: u.hit }, u.pools], [u.attacks, u.attackPools], [u.hits, u.hitPools]]) {
      for (const [role, url] of Object.entries(urls || {})) {
        if (!url) continue;
        const p = pools[ids?.[role]];
        assert.ok(p, `${id}.${role}`);
        assert.ok(Number.isInteger(p.maxSoundAllowed) && p.maxSoundAllowed >= 0);
        assert.equal(typeof p.popOldest, 'boolean');
        const s = p.sounds[url.replace('/assets/audio/sfx/', '')];
        assert.ok(s, `${id}.${role}: selected file belongs to this bank`);
        assert.ok(s.minPitch > 0 && s.maxPitch >= s.minPitch && s.delay >= 0);
        refs++;
      }
    }
  }
  assert.equal(refs, 952); // 0.3.1 release fetch-assets: + 琳琅诗怀雅 S3, 刻俄柏, 风丸 attacks and 松果's hit (their official pools)
  assert.equal(Object.keys(pools).length, 941); // + the four pools above
  const p = pools[units.char_4064_mlynar.attackPools[2]];
  assert.equal(p.sounds['player/p_imp/p_imp_loyalsword_h.mp3'].delay, 0.1);
});

test('all exported pools match the cached official bank limits, pitches and delays', { skip: !existsSync(official) }, () => {
  const raw = JSON.parse(readFileSync(official, 'utf8'));
  const banks = new Map(raw.soundFXBanks.map(b => [b.name, b]));
  for (const [id, pool] of Object.entries(manifest.audio.sfx.pools)) {
    const bank = banks.get(id);
    assert.ok(bank, id);
    assert.equal(pool.maxSoundAllowed, bank.maxSoundAllowed, id);
    assert.equal(pool.popOldest, bank.popOldest, id);
    for (const [path, s] of Object.entries(pool.sounds)) {
      const original = bank.sounds.find(v => v.asset?.toLowerCase().replace('audio/sound_beta_2/', '') + '.mp3' === path);
      assert.ok(original, `${id}: ${path}`);
      assert.deepEqual(s, { minPitch: original.minPitch, maxPitch: original.maxPitch, delay: original.delay }, id);
    }
  }
});
