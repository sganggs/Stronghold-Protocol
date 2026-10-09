// test/local-token-models.test.js — optional default-model overlays for summons. Their default
// skeletons come from the battle token packs of the local client (tools/local-extract/extract.py TOKEN_SPINES →
// public/assets/local/spine/token/<id>/, optional and git-ignored) and are an OVERLAY like the enemy models of
// test/feedback1d-models.test.js: data/assets.json tokens[id].spineLocal names the files of the data/local-assets.json
// group `spine/token/<id>` with the metadata of the committed tools/assets/local-token-spines.json — never read from the
// disk, so the manifest is the same with or without the extraction. The client (assets.js spineEntry) draws the model
// when data/local-assets.json lists every one of its files; otherwise try a downloaded web model, then the diamond.
// Tokens whose prefab draws nothing (乌尔比安's 从不混淆的方向, 酒神's 迷狂牢笼, …) are not in the list (extract.py).
// The extractor side (job table, prefab walk, alpha merge): test/local-extract.test.js.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan } from '../tools/assets/plan.mjs';
import { resolveTemplate, collectLeaves } from '../tools/assets/manifest.mjs';
import {
  findLocalTokenModels, localSpineMeta, loadLocalSpines, LOCAL_TOKEN_SPINES_FILE, localTokenSpineGroup, LOCAL_SPINE_ROLES, applyRoleFix,
} from '../tools/assets/spine.mjs';
import { roleAnimationNames } from '../tools/assets/anim-roles.mjs';
import { indexAudio } from '../tools/assets/audio.mjs';
import { createAssets, spineEntry, validSpine } from '../public/js/assets.js';
import { installFakePixi, fakeViewCtx } from './render/fakepixi.js';
import { presetCamera } from '../public/js/render/projection.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'public/assets');
const readJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const COMMITTED = readJson(LOCAL_TOKEN_SPINES_FILE).models;
const MANIFEST = readJson('data/assets.json');
const PY = ['python3', 'python'].find((bin) => spawnSync(bin, ['--version']).status === 0);
/** extract.py TOKEN_SPINES (--print-jobs needs no dependencies). */
const TOKEN_SPINES = (() => {
  if (!PY) return null;
  const r = spawnSync(PY, [path.join(ROOT, 'tools/local-extract/extract.py'), '--print-jobs'], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  return r.status === 0 ? JSON.parse(r.stdout).tokenSpines.ids : null;
})();
const IDS = Object.keys(COMMITTED).sort();

/** A data/local-assets.json listing the extracted files of `ids` (extract.py's group layout), minus `drop`. */
function localManifest(ids, drop = null) {
  const groups = {};
  for (const id of ids) {
    const g = groups[localTokenSpineGroup(id)] = {};
    const m = COMMITTED[id];
    for (const f of [m.skel, m.atlas, ...m.textures]) if (f !== drop) g[f] = { path: `/assets/local/spine/token/${id}/${f}`, kind: f.endsWith('.png') ? 'Texture2D' : 'TextAsset' };
  }
  return { version: 1, source: 'local-client', groups };
}

describe('the 自选 summon models from the local client are an optional overlay', () => {
  test('the committed metadata: the TOKEN_SPINES of extract.py, each a skeleton + same-stem atlas + pages, its roles on its own clips', () => {
    assert.equal(IDS.length, 39);
    if (TOKEN_SPINES) assert.deepEqual(IDS, [...TOKEN_SPINES].sort(), 'one entry per extract.py TOKEN_SPINES id');
    for (const id of IDS) {
      const m = COMMITTED[id];
      assert.match(m.skel, /\.skel$/, id);
      assert.equal(m.atlas, m.skel.replace(/\.skel$/, '.atlas'), `${id}: next to the skeleton (pixi-spine finds the atlas by its name)`);
      assert.ok(m.textures.length >= 1 && m.textures.every((t) => t.endsWith('.png')), id);
      assert.equal(m.pma, true, `${id}: premultiplied pages (extract.py merge_alpha)`);
      const names = Object.keys(m.animations);
      assert.ok(names.includes(m.anims.idle), `${id} idle ${m.anims.idle}`);
      assert.ok(m.anims.attack && names.includes(m.anims.attack.loop), `${id} attack`);
      for (const n of roleAnimationNames(m.anims)) assert.ok(names.includes(n), `${id} role clip ${n}`);
    }
    // 凛御银灰's three 风雪之眼 share one skeleton (one prefab each)
    assert.deepEqual([...new Set(['1', '2', '3'].map((n) => COMMITTED[`token_10057_svash2_eagle${n}`].skel))], ['token_10057_svash2_eagle.skel']);
  });

  test('role fixes: clips the resolver cannot read by name are mapped (电弧\'s 戴乌, 酒神\'s 本能的召唤, 白铁\'s platforms, the anchor)', () => {
    for (const [id, fix] of Object.entries(LOCAL_SPINE_ROLES)) {
      assert.ok(COMMITTED[id], `${id} is a local model`);
      for (const [role, v] of Object.entries(fix)) assert.deepEqual(COMMITTED[id].anims[role], v, `${id} ${role}`);
    }
    const tower = COMMITTED.token_10051_radian_tower1.anims;
    assert.deepEqual([tower.idle, tower.deploy, tower.attack.loop, tower.die], ['C_Skill1_Idle', 'C_Skill1_Start', 'C_Skill1_Attack', 'C_Skill1_Die'],
      '戴乌: its C_Skill1_* set, not the 0 s C_Default pose');
    const webTower = MANIFEST.tokens.token_10051_radian_tower1.spine.anims;
    assert.deepEqual([webTower.idle, webTower.deploy, webTower.attack.loop, webTower.die],
      ['C_Skill1_Idle', 'C_Skill1_Start', 'C_Skill1_Attack', 'C_Skill1_Die'], 'the downloaded skin also uses its animated clips');
    assert.equal(COMMITTED.token_10054_phatm2_encdool.anims.idle, 'Loop');
    assert.equal(COMMITTED.token_10027_ironmn_pile1.anims.die, 'End');
    assert.equal(COMMITTED.token_10068_kalts2_mtship.anims.idle, 'Default', '战术锚点: its Idle clip hides its only attachment');
    // a fix naming a clip the skeleton lacks is not applied
    const roles = { idle: 'Idle', die: null };
    assert.deepEqual(applyRoleFix(roles, { idle: 'Nope', die: 'End' }, { Idle: 1, End: 1 }), { roles: { idle: 'Idle', die: 'End' }, missing: ['idle'] });
    assert.deepEqual(applyRoleFix(roles, undefined, {}), { roles, missing: [] });
  });

  test('plan: the token gets spineLocal from the committed metadata as it is; no metadata → no overlay; nothing to download', () => {
    const plan = (localTokenSpines) => buildPlan({
      assets07: readJson('docs/research/07-assets.json'), ops03: readJson('docs/research/03-operators.json'),
      enemies05: readJson('docs/research/05-enemies.json'), maps05: readJson('docs/research/05-maps.json'),
      audio: indexAudio({}), modelsData: { data: {} }, extraTokenIds: IDS, localTokenSpines,
    });
    const before = plan(undefined);
    for (const id of IDS) assert.equal(before.template.tokens[id].spineLocal, undefined, `${id}: no overlay without metadata`);
    const p = plan(COMMITTED);
    const tmp = mkdtempSync(path.join(tmpdir(), 'sp-tokplan-'));
    try {
      const { value } = resolveTemplate({ tokens: Object.fromEntries(IDS.map((id) => [id, p.template.tokens[id]])) }, { root: tmp, spine: new Map() });
      for (const id of IDS) assert.deepEqual(value.tokens[id].spineLocal, { group: `spine/token/${id}`, ...COMMITTED[id] }, id);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
    assert.ok(!collectLeaves(p.template).some((l) => /spineLocal/.test(l.path)), 'the overlay is no file to download');
    assert.ok(p.notes.includes('token_10002_kalts_mon3tr: official Spine from the local client when extracted (spineLocal)'));
  });

  test('user Given summons with only skin models When planning downloads Then use the published variant without replacing known defaults', () => {
    const p = buildPlan({
      assets07: readJson('docs/research/07-assets.json'), ops03: readJson('docs/research/03-operators.json'),
      enemies05: readJson('docs/research/05-enemies.json'), maps05: readJson('docs/research/05-maps.json'),
      audio: indexAudio({}), modelsData: { data: {} }, extraTokenIds: IDS, localTokenSpines: COMMITTED,
    });
    for (const [id, variant] of [
      ['token_10002_kalts_mon3tr', 'token_10002_kalts_mon3tr_boc_6'],
      ['token_10029_slent2_protrb', 'token_10029_slent2_protrb_epoque_32'],
    ]) {
      const entry = p.template.tokens[id];
      const model = p.models.get(entry.spine.model);
      assert.equal(entry.spineVariant, variant);
      for (const [ext, job] of [['skel', model.skel], ['atlas', model.atlas], ['png', model.pngs[0]]]) {
        assert.deepEqual(job.urls, ['Spine', 'Front'].map((folder) =>
          `https://raw.githubusercontent.com/fexli/ArknightsResource/main/spine/${id}/${variant}/${folder}/${variant}.${ext}`));
        assert.equal(job.rel, `spine/token/${id}/${variant}.${ext}`);
      }
      assert.ok(entry.spineLocal, 'the extracted default model keeps its overlay');
    }
    const drone = p.template.tokens.token_10000_silent_healrb;
    assert.equal(drone.spineVariant, undefined, 'a researched default model is not replaced with a skin');
    assert.ok(p.models.get(drone.spine.model).skel.urls[0].includes('token_10000_silent_healrb'));
    assert.equal(p.template.tokens.token_10008_cqbw_box.spineVariant, 'token_10008_cqbw_box',
      'an unverified skin is not guessed');
  });

  test('data/assets.json: local metadata stays optional beside downloadable web models', () => {
    const urls = [];
    const walk = (n) => { if (typeof n === 'string') { if (n.includes('/assets/local/')) urls.push(n); } else if (n && typeof n === 'object') Object.values(n).forEach(walk); };
    walk(MANIFEST);
    assert.deepEqual(urls, [], 'setup / doctor / the manifest tests count every /assets/ URL as required');
    const withLocal = Object.keys(MANIFEST.tokens).filter((id) => MANIFEST.tokens[id].spineLocal).sort();
    assert.deepEqual(withLocal, IDS);
    for (const id of IDS) {
      assert.deepEqual(MANIFEST.tokens[id].spineLocal, { group: `spine/token/${id}`, ...COMMITTED[id] }, `${id}: the committed metadata`);
      assert.equal(spineEntry(MANIFEST, id), MANIFEST.tokens[id].spine ?? null, `${id}: without local art use the available web model`);
    }
    for (const [id, t] of Object.entries(MANIFEST.tokens)) if (t.spine) assert.ok(validSpine(t.spine), id);
  });

  test('the committed metadata is what the extracted models parse to', { skip: !IDS.every((id) => existsSync(path.join(ASSETS, 'local/spine/token', id))) && 'token models not extracted (tools/local-extract)' }, async () => {
    const found = await findLocalTokenModels(ASSETS);
    const { meta, problems } = await localSpineMeta(ASSETS, Object.fromEntries(IDS.map((id) => [id, found[id]])));
    assert.deepEqual(problems, []);
    for (const id of IDS) assert.deepEqual(meta[id], COMMITTED[id], `${id}: re-run node tools/fetch-assets.mjs --local-spines`);
    // and the shared data/local-assets.json lists every file of each (the client draws the model only then)
    const local = JSON.parse(readFileSync(path.join(ROOT, 'data/local-assets.json'), 'utf8'));
    for (const id of IDS) assert.ok(spineEntry(MANIFEST, id, { local })?.local, `${id}: listed in data/local-assets.json`);
  });

  test('findLocalTokenModels: skeleton + same-stem atlas + page PNGs under local/spine/token/<id>/; loadLocalSpines', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sp-toklocal-'));
    try {
      const put = (rel, body = 'x') => { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), body); };
      put('local/spine/token/token_10057_svash2_eagle1/token_10057_svash2_eagle.skel');
      put('local/spine/token/token_10057_svash2_eagle1/token_10057_svash2_eagle.atlas');
      put('local/spine/token/token_10057_svash2_eagle1/token_10057_svash2_eagle.png');
      put('local/spine/token/token_x_noatlas/token_x_noatlas.skel');
      put('local/spine/token/enemy_1305_mhslim/enemy_1305_mhslim.skel');
      put('local/spine/token/enemy_1305_mhslim/enemy_1305_mhslim.atlas');
      put('local/spine/token/enemy_1305_mhslim/enemy_1305_mhslim.png');
      const found = await findLocalTokenModels(dir);
      assert.deepEqual(Object.keys(found), ['token_10057_svash2_eagle1'], 'one stem per folder; only token ids');
      assert.equal(found.token_10057_svash2_eagle1.atlas, 'local/spine/token/token_10057_svash2_eagle1/token_10057_svash2_eagle.atlas');
      assert.deepEqual(await findLocalTokenModels(path.join(dir, 'missing')), {});
      assert.deepEqual(await loadLocalSpines(path.join(ROOT, LOCAL_TOKEN_SPINES_FILE)), COMMITTED);
      assert.deepEqual(await loadLocalSpines(path.join(dir, 'none.json')), {});
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('client: the official summon model only when data/local-assets.json lists it', () => {
  test('assets.js spineEntry: every local file listed → the official model; anything missing → web model or diamond', () => {
    const local = localManifest(IDS);
    for (const id of IDS) {
      const m = COMMITTED[id];
      const fallback = MANIFEST.tokens[id].spine ?? null;
      const e = spineEntry(MANIFEST, id, { local });
      assert.equal(e.skel, `/assets/local/spine/token/${id}/${m.skel}`);
      assert.equal(e.atlas, `/assets/local/spine/token/${id}/${m.atlas}`);
      assert.deepEqual(e.textures, m.textures.map((t) => `/assets/local/spine/token/${id}/${t}`));
      assert.equal(e.pma, true);
      assert.deepEqual(e.anims, m.anims);
      assert.equal(e.local, true);
      assert.equal(e.fallback, fallback, 'retain the web model behind the local overlay');
      assert.equal(spineEntry(MANIFEST, id, { local }), e, 'one entry object per manifest pair');
      assert.equal(spineEntry(MANIFEST, id, { local: localManifest([]) }), fallback, 'not extracted → web model or diamond');
      assert.equal(spineEntry(MANIFEST, id, { local: localManifest([id], m.textures[0]) }), fallback, 'a page missing → web model or diamond');
    }
    assert.equal(spineEntry(MANIFEST, 'token_10028_vigil_wolf', { local }), MANIFEST.tokens.token_10028_vigil_wolf.spine, 'a web token unchanged');
    const store = createAssets({ manifest: MANIFEST, localManifest: local });
    assert.equal(store.spineEntry('token_10002_kalts_mon3tr').skel, '/assets/local/spine/token/token_10002_kalts_mon3tr/token_10002_kalts_mon3tr.skel');
    assert.equal(createAssets({ manifest: MANIFEST }).spineEntry('token_10002_kalts_mon3tr')?.skel,
      '/assets/spine/token/token_10002_kalts_mon3tr/token_10002_kalts_mon3tr_boc_6.skel', 'without local art: the downloaded skin');
  });

  describe('UnitView', () => {
    let fake, UnitView;
    before(async () => {
      fake = installFakePixi();
      ({ UnitView } = await import('../public/js/render/units.js'));
    });
    after(() => fake.restore());
    const tick = () => new Promise((r) => setImmediate(r));
    const cam = () => presetCamera('normal', { width: 1280, height: 720 });
    const info = (id) => ({ id: 7, side: 'ally', kind: 'token', defId: id, spine: id, avatar: id, tier: 1, x: 4, y: 10, maxHp: 1000, dir: 'RIGHT' });

    test('a summon view draws its official model with its own clips; a failed load keeps the diamond and is retried', async () => {
      const local = localManifest(IDS);
      const asked = [], released = [];
      const store = (fail) => ({
        picture: () => null, image: async () => null,
        spineEntry: (id) => spineEntry(MANIFEST, id, { local }),
        spine: {
          acquire: async (e) => { asked.push(e.skel); if (fail(e)) throw new Error('404'); return { animations: Object.keys(e.animations).map((name) => ({ name })) }; },
          release: (e) => released.push(e.skel),
        },
      });
      const id = 'token_10051_radian_tower1';
      const ok = new UnitView(fakeViewCtx(fake.P, { assets: store(() => false), cam }), info(id));
      await tick(); await tick();
      assert.equal(ok.actor?.entry.skel, `/assets/local/spine/token/${id}/${COMMITTED[id].skel}`, 'the official model');
      assert.equal(ok.actor.entry.anims.idle, 'C_Skill1_Idle', 'with the mapped clips');
      asked.length = 0;
      const bad = new UnitView(fakeViewCtx(fake.P, { assets: store(() => true), cam }), info(id));
      await tick(); await tick(); await tick();
      assert.deepEqual(asked, [`/assets/local/spine/token/${id}/${COMMITTED[id].skel}`,
        `/assets/spine/token/${id}/token_10051_radian_tower1_game_8.skel`], 'try the web model when the local model fails');
      assert.ok(released.includes(asked[0]), 'the failed acquire is released');
      assert.equal(bad.actor, null, 'the avatar diamond stays');
      assert.ok(bad._retryAt > 0, 'and the model is loaded again later (SPINE_RETRY_MS)');
      for (const v of [ok, bad]) v.destroy?.();
    });
  });
});
