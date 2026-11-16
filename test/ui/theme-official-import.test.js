// §37.232: an official interface theme imported as a zip (可露希尔 is not in the packages) — every file kept, the group
// laid over the local manifest, the official card that can be deleted; a third-party pack's Spine character built
// from its bytes; and the package side: the group and its ui/outer sprites held back, its own importable pack.
// The browser pass (import, the prefab HUD, the Spine on the funds card and in the 联防 window) was run by hand on a
// server without the group; the fixtures here are tiny stand-ins, never official files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { composeLocalManifest, createThemeLibrary } from '../../public/js/uiTheme.js';
import { createDataStore } from '../../public/js/data.js';
import { spineLoadParser } from '../../public/js/themeSpine.js';
import {
  OFFICIAL_PACK_LIMITS, importedPrefabDoc, isImportedThemeGroup, officialAssetUrl, setImportedThemeGroup, themeCharacterKey,
} from '../../shared/uiTheme.js';
import {
  HELD_THEME_ENTRIES, HELD_THEME_GROUPS, artPlan, holdBackStagedThemes, themePackPlans, themePackReadme, withoutHeldThemes,
} from '../../tools/package.mjs';

const GROUP = 'themes/ac_s_closur';
const enc = (s) => new TextEncoder().encode(s);
function entry(path, data) {
  const bytes = typeof data === 'string' ? enc(data) : data;
  return { path, size: bytes.length, read: async () => bytes };
}

function memoryOpen() {
  const rows = new Map();
  return async () => ({
    transaction() {
      const tx = {
        objectStore() {
          return {
            getAll() { return { result: [...rows.values()] }; },
            put(value, key) { rows.set(key, structuredClone(value)); return { result: key }; },
            delete(key) { rows.delete(key); return { result: undefined }; },
          };
        },
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
  });
}

function library(extra = {}) {
  let n = 0;
  return createThemeLibrary({
    openDb: extra.openDb || memoryOpen(),
    measure: async () => ({ ok: true, width: 12, height: 10 }),
    createUrl: () => `blob:test/${extra.tag || 'a'}/${++n}`,
    revokeUrl: () => {},
    revokeDelayMs: 0,
    fetchImpl: extra.fetchImpl || (async () => ({ ok: false, status: 404 })),
  });
}

const THEME = {
  spTheme: 1,
  id: 'ac_s_closur',
  name: '“全能的”可露希尔',
  description: 'stand-in',
  thumbnail: 'thumb.webp',
  colors: { skinLightColor: '#FF00AA' },
  images: { prep_ready: 'sprites/ready.webp' },
  voice: { AUTOCHESS_FREEZE: 'voice/cn_001.mp3' },
  character: { spine: { skel: 'spine/c.json', atlas: 'spine/c.atlas', textures: ['spine/c.png'] }, anims: { idle: 'Idle' } },
};
const PREFABS = { spPrefabs: 1, prefabs: { group_hud: { nodes: [] } } };

function officialEntries({ prefabs = JSON.stringify(PREFABS) } = {}) {
  return [
    entry('ac_s_closur/theme.json', JSON.stringify(THEME)),
    entry('ac_s_closur/prefabs.json', prefabs),
    entry('ac_s_closur/thumb.webp', Uint8Array.of(1)),
    entry('ac_s_closur/sprites/ready.webp', Uint8Array.of(2)),
    entry('ac_s_closur/sprites/only_in_prefabs.webp', Uint8Array.of(3)),
    entry('ac_s_closur/spine/c.json', '{"bones":[]}'),
    entry('ac_s_closur/spine/c.atlas', 'c.png\nsize: 4,4\n'),
    entry('ac_s_closur/spine/c.png', Uint8Array.of(4)),
    entry('ac_s_closur/voice/cn_001.mp3', Uint8Array.of(5)),
    entry('ac_s_closur/README.txt', 'read me'),
  ];
}

test('an official pack as a zip keeps every file, lays its group over the manifest, and is the official card (deletable, outside the eight)', async () => {
  const lib = library();
  const r = await lib.importEntries(officialEntries(), 0);
  assert.equal(r.ok, true, r.code);
  assert.equal(r.id, 'ac_s_closur');
  assert.deepEqual(r.report.ignored, ['README.txt']);
  assert.deepEqual(r.report.refused, []);
  const live = lib.get('ac_s_closur');
  assert.equal(live.officialPack, true);
  assert.equal(live.official, false, 'not an installed pack: storage and deletion are the imported ones');

  const groups = lib.importedGroups();
  assert.deepEqual(Object.keys(groups), [GROUP]);
  const entries = groups[GROUP];
  assert.deepEqual(Object.keys(entries).sort(), [
    'prefabs.json', 'spine/c.atlas', 'spine/c.json', 'spine/c.png', 'sprites/only_in_prefabs.webp', 'sprites/ready.webp',
    'thumb.webp', 'voice/cn_001.mp3',
  ], 'a sprite only the prefabs name is kept too');
  assert.deepEqual([entries['sprites/only_in_prefabs.webp'].w, entries['sprites/only_in_prefabs.webp'].h], [12, 10]);
  assert.equal(isImportedThemeGroup(GROUP), true);
  const ready = entries['sprites/ready.webp'];
  assert.equal(officialAssetUrl(GROUP, ready), ready.path);
  assert.equal(officialAssetUrl('themes/ac_n_iron', ready), null, 'a blob URL only for a group this browser imported');
  assert.deepEqual(importedPrefabDoc(entries['prefabs.json'].path), PREFABS);
  assert.equal(importedPrefabDoc('blob:test/none'), null);

  const card = lib.list().find((c) => c.id === 'ac_s_closur');
  assert.deepEqual([card.official, card.imported, card.name], [true, true, '“全能的”可露希尔']);
  assert.ok(live.character.spine.blobs.skel instanceof Blob, 'the character is built from the bytes');
  assert.equal(live.character.spine.blobs.skelName, 'spine/c.json');
  assert.deepEqual(Object.keys(live.character.spine.blobs.pages), ['c.png']);
  assert.match(themeCharacterKey(live.character), /^pack:ac_s_closur:/);

  for (let i = 0; i < 8; i++) {
    const body = JSON.stringify({ spTheme: 1, id: `pack${i}`, name: `主题${i}` });
    const one = await lib.importEntries([entry('theme.json', body)], body.length);
    assert.equal(one.ok, true, `custom pack ${i} beside the official one: ${one.code}`);
  }

  assert.equal(await lib.remove('ac_s_closur'), true);
  assert.equal(isImportedThemeGroup(GROUP), false);
  assert.deepEqual(lib.importedGroups(), {});
  assert.equal(officialAssetUrl(GROUP, ready), null);
});

test('an imported official group comes back from storage on the next page; the listeners hear it', async () => {
  const open = memoryOpen();
  const first = library({ openDb: open, tag: 'one' });
  assert.equal((await first.importEntries(officialEntries(), 0)).ok, true);
  setImportedThemeGroup(GROUP, null); // a new page starts without it
  const second = library({ openDb: open, tag: 'two' });
  const heard = [];
  second.onGroups((g) => heard.push(Object.keys(g)));
  await second.boot();
  assert.equal(isImportedThemeGroup(GROUP), true);
  assert.deepEqual(heard, [[GROUP]]);
  assert.ok(second.importedGroups()[GROUP]['prefabs.json'].path.startsWith('blob:test/two/'));
  assert.equal(await second.remove('ac_s_closur'), true);
  assert.equal(isImportedThemeGroup(GROUP), false);
});

test('refused when this server serves the group; a prefabs.json this client cannot read is dropped; the file limit', async () => {
  const served = { groups: { [GROUP]: { 'theme.json': { path: '/assets/local/themes/ac_s_closur/theme.json' } } } };
  const host = library({ fetchImpl: async (url) => (url === '/data/local-assets.json' ? { ok: true, json: async () => served } : { ok: false, status: 404 }) });
  assert.equal((await host.importEntries(officialEntries(), 0)).code, 'official-installed');

  const lib = library();
  const r = await lib.importEntries(officialEntries({ prefabs: '{"nope":1}' }), 0);
  assert.equal(r.ok, true, r.code);
  assert.ok(r.report.refused.some((x) => x.path === 'prefabs.json'));
  assert.equal(lib.importedGroups()[GROUP]['prefabs.json'], undefined, 'no prefab HUD from a document it cannot read');
  assert.equal(await lib.remove('ac_s_closur'), true);

  const many = [entry('ac_s_closur/theme.json', JSON.stringify(THEME))];
  for (let i = 0; i < OFFICIAL_PACK_LIMITS.files; i++) many.push(entry(`ac_s_closur/sprites/s${i}.webp`, Uint8Array.of(1)));
  assert.equal((await library().importEntries(many, 0)).code, 'too-many-files');
});

test('a third-party pack keeps its Spine skeleton and atlas: the character is built in memory, keyed for mounting', async () => {
  const lib = library();
  const body = JSON.stringify({
    spTheme: 1, id: 'with-spine', name: 'S',
    character: { spine: { skel: 'spine/x.skel', atlas: 'spine/x.atlas', textures: ['spine/x.png'] }, anims: { idle: 'Idle' } },
  });
  const r = await lib.importEntries([
    entry('theme.json', body), entry('spine/x.skel', Uint8Array.of(1, 2)), entry('spine/x.atlas', 'x.png\n'), entry('spine/x.png', Uint8Array.of(3)),
  ], 0);
  assert.equal(r.ok, true, r.code);
  const live = lib.get('with-spine');
  assert.equal(live.officialPack, false);
  assert.deepEqual(lib.importedGroups(), {}, 'a third-party pack adds no group');
  assert.ok(live.character.spine.blobs.skel instanceof Blob);
  assert.ok(live.character.spine.blobs.atlas instanceof Blob);
  assert.ok(live.character.spine.blobs.pages['x.png'].startsWith('blob:'));
  assert.match(themeCharacterKey(live.character), /^pack:with-spine:/);
  assert.equal(themeCharacterKey({ imageUrl: 'blob:x' }), 'blob:x');
  assert.equal(themeCharacterKey({ spine: { skel: '/assets/local/a.skel' } }), '/assets/local/a.skel');
  assert.equal(themeCharacterKey(null), '');
});

test('the local manifest view: imported groups join, a served group wins, and a missing file is stood in for once known missing', async () => {
  const served = { version: 1, groups: { a: { x: { path: '/assets/local/a/x.png' } } } };
  const g = { [GROUP]: { 'prefabs.json': { path: 'blob:test/1' } } };
  assert.equal(composeLocalManifest(served, {}), served);
  assert.equal(composeLocalManifest(null, {}), null, 'nothing imported: a host without local art stays null');
  assert.deepEqual(Object.keys(composeLocalManifest(served, g).groups), ['a', GROUP]);
  assert.deepEqual(composeLocalManifest(null, g), { groups: g });
  const both = { groups: { [GROUP]: { 'theme.json': { path: '/assets/local/themes/ac_s_closur/theme.json' } } } };
  assert.equal(composeLocalManifest(both, g), both, 'the served group wins');

  const store = createDataStore({ fetch: async () => ({ ok: false, status: 404, json: async () => null }), retryDelays: [], timeoutMs: 0 });
  const view = (v) => composeLocalManifest(v, g);
  view.withMissing = true;
  store.setView('local', view);
  assert.equal(store.get('local'), null, 'never asked for: no stand-in');
  await store.load('local').catch(() => {});
  assert.equal(store.status('local'), 'missing');
  assert.deepEqual(store.get('local'), { groups: g });
  const plain = createDataStore({ fetch: async () => ({ ok: false, status: 404, json: async () => null }), retryDelays: [], timeoutMs: 0 });
  plain.setView('local', (v) => composeLocalManifest(v, g));
  await plain.load('local').catch(() => {});
  assert.equal(plain.get('local'), null, 'a view without withMissing keeps a missing file null');
});

test('themeSpine finds pixi-spine\'s load parser among PIXI.Assets\' parsers', () => {
  const spine = { test: (u) => u.endsWith('.skel'), testParse: async () => true, parse: async () => ({}) };
  const json = { test: (u) => u.endsWith('.json'), parse: async () => ({}) };
  assert.equal(spineLoadParser({ Assets: { loader: { parsers: [json, spine] } } }), spine);
  assert.equal(spineLoadParser({ Assets: { loader: { parsers: [json] } } }), null);
  assert.equal(spineLoadParser({}), null);
});

test('the packages hold back 可露希尔: its group and ui/outer sprites leave the shipped manifest and the art; its own pack', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-held-theme-'));
  try {
    const put = (rel, body) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
    const files = [
      'public/assets/local/themes/ac_s_closur/theme.json', 'public/assets/local/themes/ac_s_closur/sprites/a.webp',
      'public/assets/local/themes/ac_s_closur/layout.json', 'public/assets/local/themes/ac_n_iron/theme.json',
      'public/assets/local/ui/outer/skin_pre_closur.png', 'public/assets/local/ui/outer/operator_preset.png',
    ];
    for (const f of files) put(f, f.endsWith('.json') ? '{}' : 'x');
    const at = (f) => ({ path: `/${f.slice('public/'.length)}` });
    const local = {
      version: 1,
      count: 6,
      groups: {
        [GROUP]: { 'theme.json': at(files[0]), 'sprites/a.webp': at(files[1]), 'layout.json': at(files[2]) },
        'themes/ac_n_iron': { 'theme.json': at(files[3]) },
        'ui/outer': { skin_pre_closur: at(files[4]), operator_preset: at(files[5]) },
      },
    };
    put('data/local-assets.json', JSON.stringify(local));
    put('data/assets.json', '{}');
    put('package.json', JSON.stringify({ name: 'x', version: '0.4.0' }));

    const shipped = withoutHeldThemes(local);
    assert.deepEqual(Object.keys(shipped.groups), ['themes/ac_n_iron', 'ui/outer']);
    assert.deepEqual(Object.keys(shipped.groups['ui/outer']), ['operator_preset']);
    assert.equal(shipped.count, 2);
    assert.equal(withoutHeldThemes(shipped), shipped, 'nothing left to hold back: the same object');
    assert.deepEqual(HELD_THEME_GROUPS, [GROUP]);
    assert.ok(HELD_THEME_ENTRIES['ui/outer'].includes('thumbnail_ac_s_closur'));

    const art = artPlan(dir);
    assert.deepEqual(art.files.filter((f) => f.startsWith('public/assets/local/')),
      ['public/assets/local/themes/ac_n_iron/theme.json', 'public/assets/local/ui/outer/operator_preset.png']);
    assert.deepEqual(art.themeHeld, [files[0], files[2], files[1], files[4]].sort());
    assert.deepEqual(art.missing, []);
    assert.deepEqual(art.orphans, [], 'held back is not "nothing lists it"');

    // the staged manifest the zip ships
    const stage = path.join(dir, 'stage');
    fs.mkdirSync(path.join(stage, 'data'), { recursive: true });
    fs.copyFileSync(path.join(dir, 'data/local-assets.json'), path.join(stage, 'data/local-assets.json'));
    assert.equal(holdBackStagedThemes(stage), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(stage, 'data/local-assets.json'), 'utf8')), shipped);
    assert.equal(holdBackStagedThemes(stage), false, 'once is enough');

    const [p] = themePackPlans(dir, { scan: false });
    assert.equal(p.name, 'Stronghold-Protocol-v0.4.0-theme-ac_s_closur');
    assert.deepEqual(p.files, ['sprites/a.webp', 'theme.json'], 'layout.json is the extractor\'s own: left out');
    assert.deepEqual(p.problems, []);
    const readme = themePackReadme(p);
    assert.match(readme, /「导入主题包」/);
    assert.match(readme, /"Import theme pack"/);
    assert.match(readme, /非商业/);
    assert.match(readme, /0\.4\.x/);
    const none = themePackPlans(dir, { scan: false, groups: ['themes/ac_x_none'] })[0];
    assert.match(none.problems.join('\n'), /not extracted here/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
