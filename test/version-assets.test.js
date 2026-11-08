import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { assetCoverage } from '../tools/assets/coverage.mjs';
import { addManifestEntries, presentationUnion, versionAssetData, versionAssetJobs, versionAudioData } from '../tools/assets/versions.mjs';
import { localFxIndexPath } from '../tools/assets/cache.mjs';
import { VERSIONS } from '../shared/versions.js';
import { loadProfile, pinnedShaOf } from '../tools/versions/profiles.mjs';
import { sourceOfProfile } from '../tools/versions/sources.mjs';
import { fxFixture } from './helpers/fxFixtures.js';

const root = path.resolve(import.meta.dirname, '..');
const assets = JSON.parse(readFileSync(path.join(root, 'data/assets.json'), 'utf8'));

test('every official version declares comparable pictures, models, clips, icons and scenes without installed art', () => {
  const result = assetCoverage({ root, local: { groups: {} } });
  assert.equal(result.versions.length, VERSIONS.length);
  assert.deepEqual(result.missing.filter((r) => r.version !== 'act3autochess@V3_1'), []);
  // The updated client has an effect-only cocoon without an icon and dynamic boards without baked scene art.
  assert.deepEqual(result.missing.filter((r) => r.version === 'act3autochess@V3_1').map((r) => [r.id, r.missing]), [
    ['enemy_9036_acweb', ['icon']],
    ...['01', '02', '03', '04', '05', '06', '09', '10', '11', '12'].map((n) => [`act3autochess_m${n}`, ['scene']]),
  ]);
});

test('coverage fails for missing earlier-version pictures, model, skill icon, enemy and strategy art', () => {
  for (const [kind, id, field] of [
    ['chars', 'char_198_blackd', 'avatar'], ['chars', 'char_198_blackd', 'portraitE2'],
    ['chars', 'char_198_blackd', 'spine'], ['skills', 'skchr_blackd_2'],
    ['enemies', 'enemy_1254_lypa'], ['bands', 'band_zumama'],
  ]) {
    const broken = structuredClone(assets);
    if (field) delete broken[kind][id][field];
    else delete broken[kind][id];
    const result = assetCoverage({ root, assets: broken, local: { groups: {} } });
    assert.ok(result.missing.some((r) => r.version === 'act1autochess'), `${kind}.${id}.${field}`);
    assert.equal(result.versions[0].missing, 0, 'the default roster alone would not detect this regression');
  }
});

test('presentation union retains the operators behind reused chess ids and their skills', () => {
  const sets = versionAssetData(root), all = presentationUnion(sets);
  assert.equal(Object.keys(all.operators).length, 269);
  assert.ok(all.operators.char_198_blackd.skills.some((s) => s.skillId === 'skchr_blackd_2'));
  assert.ok(all.enemies.enemy_1254_lypa);
  assert.ok(all.bands.band_zumama);
  assert.equal(Object.keys(all.tokens).length, 62, 'including enemy/char-backed summons and the two regulation summons');
});

test('regulation art uses the actual default patch skin, one-facing robot and boss prefab references', () => {
  assert.equal(assets.chars.char_1037_amiya3.avatar, assets.chars.char_1037_amiya3.avatarE2);
  assert.equal(assets.chars.char_1037_amiya3.portrait, assets.chars.char_1037_amiya3.portraitE2);
  for (const id of ['enemy_9029_acfnc_2', 'enemy_9037_aceel_2']) {
    const model = assets.enemies[id].spineLocal;
    assert.equal(model.skel, id.replace(/_2$/, '') + '.skel');
    assert.ok(model.animations[model.anims.idle] > 0);
  }
  const result = assetCoverage({ root, local: { groups: {} } });
  assert.equal(result.rows.find((r) => r.id === 'char_618_acrbot').checks.back, 'one-facing prefab');
  assert.ok(result.rows.some((r) => r.kind === 'module' && r.checks.icon === 'ok'));
});

test('regulation enemy timing uses committed local model clips', () => {
  const sets = versionAssetData(root);
  const regulation = sets.find((s) => s.version.family === 'regulation');
  for (const id of ['enemy_9029_acfnc_2', 'enemy_9037_aceel_2']) {
    const model = assets.enemies[id].spineLocal, clip = model.anims.attack.loop;
    assert.equal(regulation.enemies[id].attackAnim.clip, clip);
    assert.equal(regulation.enemies[id].attackAnim.dur, model.animations[clip]);
  }
});

test('version gap planning includes missing summons and preserves the official mixed-case bond sprite name', (t) => {
  const f = fxFixture(t);
  const tables = { chess: {}, backups: {}, tokens: { token_10018_robrta_mach: {} }, enemies: {},
    items: {}, bands: {}, bonds: { ursusShip: { iconId: 'icon_ursusShip' } }, bosses: {}, stages: {} };
  for (const [name, value] of Object.entries(tables)) f.put(`data/${name}.json`, value);
  f.put('data/assets.json', { chars: {}, enemies: {}, tokens: {} });
  const jobs = versionAssetJobs(f.root);
  assert.deepEqual(jobs.tokens, ['token_10018_robrta_mach']);
  assert.ok(jobs.sprites.some((s) => s.name === 'icon_ursusShip' && s.path === 'bond/ursusShip.png'));
  assert.ok(jobs.sprites.some((s) => s.name === 'token_10018_robrta_mach'));
});

test('asset tools follow the manifest-selected immutable FX index and retain the legacy fallback', (t) => {
  const f = fxFixture(t);
  assert.equal(localFxIndexPath(f.root), path.join(f.root, 'public/assets/local/fx/index.json'));
  f.put('data/local-fx.json', { groups: { fx: { index: { path: '/assets/local/fx/index-0123456789abcdef.json' } } } });
  assert.equal(localFxIndexPath(f.root), path.join(f.root, 'public/assets/local/fx/index-0123456789abcdef.json'));
  f.put('data/local-fx.json', { groups: { fx: { index: { path: '/assets/local/fx/../../escape.json' } } } });
  assert.equal(localFxIndexPath(f.root), path.join(f.root, 'public/assets/local/fx/index.json'));
});

test('pinned season audio adds new bank names without replacing legacy banks or requiring network access', async (t) => {
  const f = fxFixture(t), base = { soundFXBanks: [{ name: 'shared', sounds: ['keep'] }],
    bgmBanks: [], bankAlias: { shared: 'keep' } };
  const { entry, profile } = await loadProfile('act3autochess@V3_1');
  const tag = sourceOfProfile(profile).cacheTag(pinnedShaOf(profile, 'excel/audio_data.json'));
  f.put(`.cache/gamedata@${tag}/excel/audio_data.json`, { soundFXBanks: [
    { name: 'shared', sounds: ['replace'] }, { name: 'new', sounds: [] },
  ], bgmBanks: [], bankAlias: { shared: 'replace', added: 'new' } });
  assert.deepEqual(versionAudioData(f.root, base), base, 'an uninstalled season is not planned');
  f.put(`data/${entry.dir}chess.json`, {});
  const merged = versionAudioData(f.root, base);
  assert.deepEqual(merged.soundFXBanks, [base.soundFXBanks[0], { name: 'new', sounds: [] }]);
  assert.deepEqual(merged.bankAlias, { shared: 'keep', added: 'new' });
  assert.equal(base.soundFXBanks.length, 1, 'the base index is not mutated');
});

test('add-only keeps existing nested values, arrays and null while admitting new identities', () => {
  const old = { chars: { old: { avatar: '/old.png', events: ['a'], optional: null } }, audio: { hit: '/hit.mp3' } };
  const next = { chars: { old: { avatar: '/new.png', events: ['b'], optional: 'new' }, added: { avatar: '/added.png' } } };
  assert.deepEqual(addManifestEntries(old, next), { ...old, chars: { ...old.chars, added: next.chars.added } });
  assert.deepEqual(old.chars.old.events, ['a']);
});

test('fx discovery includes each season even when their chess ids collide', (t) => {
  const f = fxFixture(t);
  f.put('data/chess.json', { shared: { charId: 'char_9001_current', skills: [{ skillId: 'sk_current' }] } });
  f.put('data/versions/earlier/chess.json', { shared: { charId: 'char_9002_earlier', skills: [{ skillId: 'sk_earlier' }] } });
  f.put('.cache/gamedata/excel/character_table.json', {
    char_9001_current: { skills: [{ skillId: 'sk_shared[3]' }] },
    char_9002_earlier: { skills: [{ skillId: 'sk_shared[3]', overridePrefabKey: 'skchr_earlier_1' }] },
  });
  const r = spawnSync('python3', ['-B', '-c', `import sys,json\nsys.path.insert(0,${JSON.stringify(path.join(root, 'tools/local-extract'))})\nimport fx\nprint(json.dumps(fx.game_data(${JSON.stringify(f.root)})))`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const gd = JSON.parse(r.stdout);
  assert.deepEqual(gd.chars, ['char_9001_current', 'char_9002_earlier']);
  assert.deepEqual(gd.skills.char_9002_earlier, ['sk_earlier']);
  assert.deepEqual(gd.skillOverrides, { char_9002_earlier: { sk_shared: 'skchr_earlier_1' } }, 'official art overrides stay scoped to their operator');
});

test('add-only FX extraction retains shared metadata and old files while crawling only new units', (t) => {
  const f = fxFixture(t);
  const script = `import sys,json,pathlib
from unittest.mock import patch
# This metadata-only fixture must also run on CI without Pillow installed (#881).
sys.modules['PIL'] = None
sys.path.insert(0,${JSON.stringify(path.join(root, 'tools/local-extract'))})
import fx
root=pathlib.Path(${JSON.stringify(f.root)})
out=root/'local'; dest=out/'fx'; dest.mkdir(parents=True)
manifest=root/'local-fx.json'
old={'format':'fx-index','version':fx.INDEX_VERSION,'set':'used',
 'units':{'char_old':{'keep':1}},'projectiles':{'shared':{'keep':2}},
 'skills':{'shared':{'keep':3}},'skins':{'char_old':{'keep':4}},
 'prefabs':{'old':{'file':'prefabs/old.json'}}}
texture={'file':'tex/shared.png','w':2,'h':2}
groups={'fx/tex':{'shared':{'path':'/assets/local/fx/tex/shared.png','kind':'Texture2D','w':2,'h':2}}}
(dest/'index.json').write_text(json.dumps(old))
(dest/'textures.json').write_text(json.dumps({'textures':{'shared':texture}}))
manifest.write_text(json.dumps({'groups':groups}))
(dest/'untouched.bin').write_bytes(b'keep')
def crawl(ab,cabs,ids,*args):
 assert ids==['char_new'],ids
 return ({'char_new':{'added':1}}, {'shared':{'replace':True},'new':{}},
         {'shared':{'replace':True},'new':{}}, {'char_new':{}}, {'old','new'})
def worker(work,*args):
 assert work[4]==['new'],work
 return ({'new':{'file':'prefabs/new.json','refs':['old']}},
         {'shared':{'file':'tex/shared.webp','w':4,'h':4}}, {}, [])
with patch.object(fx,'scan_cabs',return_value={}), \\
 patch.object(fx,'container_index',return_value={'old':'bundle','new':'bundle'}), \\
 patch.object(fx,'client_version',return_value='fixture'), \\
 patch.object(fx,'game_data',return_value={'chars':['char_old','char_new'],'enemies':[],'tokens':[]}), \\
 patch.object(fx,'crawl_units',side_effect=crawl), patch.object(fx,'_export_worker',side_effect=worker):
 fx.export_fx(root,out,{},lambda line:None,selection='used',jobs=1,root=root,fx_manifest=manifest,add_only=True,texture_format='png')
new=json.loads((dest/'index.json').read_text())
for group in ['units','projectiles','skills','skins','prefabs']:
 for key,value in old[group].items(): assert new[group][key]==value,(group,key)
assert 'char_new' in new['units'] and 'new' in new['prefabs']
assert json.loads((dest/'textures.json').read_text())['textures']['shared']==texture
assert json.loads(manifest.read_text())['groups']['fx/tex']==groups['fx/tex']
assert (dest/'untouched.bin').read_bytes()==b'keep'
`;
  const r = spawnSync('python3', ['-B', '-c', script], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
