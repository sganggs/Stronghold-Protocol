// A local extract that is missing groups this version writes, or whose fx catalog disagrees,
// must be reported (GitHub #665, DESIGN §34.3). The expected set is tools/local-extract/expected.mjs,
// kept equal to `extract.py --print-jobs` (no game client). These tests never call checkLocal(),
// so they do not read the machine's data/local-assets.json or data/local-fx.json.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { EXPECTED_FX, EXPECTED_LOCAL_GROUPS, EXPECTED_SCENE } from '../tools/local-extract/expected.mjs';
import {
  assessLocal, artRowAfterScenes, doctorLocalDetail, fxCatalogReport, fxReextractCommand,
  localArtDetail, localArtState, localGaps, sceneAskDefault, sceneClientExtractAllowed, sceneFilesPartial,
  sceneInstallPlan, sceneVersionOnlyGap,
  IS_WIN, ROOT, venvPython,
} from '../tools/setup.mjs';


const PY = ['python3', 'python'].find((bin) => spawnSync(bin, ['--version']).status === 0);
const ENV = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };

function manifestOf(keys) {
  const groups = {};
  for (const k of keys) groups[k] = { a: { path: '/x' } };
  return { version: 1, source: 'local-client', count: keys.length, groups };
}

/** 75 groups / 1658 entries: every expected key except scene/tex, count field matching the listed entries. */
function manifestMissingTex() {
  const keys = EXPECTED_LOCAL_GROUPS.filter((g) => g !== 'scene/tex');
  const groups = {};
  keys.forEach((k, i) => {
    const n = i === 0 ? 1658 - (keys.length - 1) : 1;
    const g = {};
    for (let j = 0; j < n; j++) g[`e${j}`] = { path: '/x' };
    groups[k] = g;
  });
  return { version: 1, source: 'local-client', count: 1658, groups };
}

function sceneOpts(assessed, extra = {}) {
  return {
    hasScenes: assessed.scenes,
    sceneStagesHave: assessed.sceneStagesHave,
    sceneStagesExpected: assessed.sceneStagesExpected,
    sceneGroupHave: assessed.sceneGroupHave,
    missingSceneGroups: assessed.missingSceneGroups,
    sceneVersionStale: assessed.sceneVersionStale,
    sceneVersionHave: assessed.sceneVersionHave,
    sceneVersionExpected: assessed.sceneVersionExpected,
    ...extra,
  };
}

describe('expected.mjs matches the extractor (no game client)', { skip: !PY && 'no python3' }, () => {
  test('--print-jobs expectedGroups and fx fields', () => {
    const r = spawnSync(PY, ['-I', '-B', path.join(ROOT, 'tools/local-extract/extract.py'), '--print-jobs'], { encoding: 'utf8', env: ENV });
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.deepEqual(j.expectedGroups, [...EXPECTED_LOCAL_GROUPS]);
    assert.deepEqual(j.fx.groups, [...EXPECTED_FX.groups]);
    assert.equal(j.fx.manifestVersion, EXPECTED_FX.manifestVersion);
    assert.equal(j.fx.version, EXPECTED_FX.formatVersion);
    assert.equal(j.fx.indexVersion, EXPECTED_FX.indexVersion);
    assert.equal(j.fx.meshVersion, EXPECTED_FX.meshVersion);
    assert.equal(j.fx.optIn, true);
    assert.equal(j.scenes.version, EXPECTED_SCENE.version);
  });
});

test('this version expects 76 local groups, 11 battlefields and scene/tex', () => {
  assert.equal(EXPECTED_LOCAL_GROUPS.length, 76);
  assert.equal(new Set(EXPECTED_LOCAL_GROUPS).size, 76);
  const scenes = EXPECTED_LOCAL_GROUPS.filter((g) => g.startsWith('scene/'));
  assert.ok(scenes.includes('scene/tex'));
  assert.equal(scenes.length, 12);
  assert.deepEqual(EXPECTED_FX.groups, ['fx', 'fx/prefabs', 'fx/tex', 'fx/mesh']);
  assert.equal(EXPECTED_FX.indexVersion, 3);
  assert.equal(EXPECTED_FX.manifestVersion, 1);
});

test('a 75-group / 1658-entry manifest that only lacks scene/tex is stale', () => {
  const assessed = assessLocal(manifestMissingTex(), null);
  assert.equal(assessed.groupCount, 75);
  assert.equal(assessed.count, 1658);
  assert.equal(assessed.expectedGroupCount, 76);
  assert.deepEqual(assessed.missingGroups, ['scene/tex']);
  assert.equal(assessed.stale, true);
  assert.equal(assessed.scenes, false);
  assert.equal(assessed.sceneStagesHave, 11);
  assert.equal(assessed.sceneGroupHave, 11);
  assert.equal(localArtState(assessed), 'warn');
  const sceneGap = '，已有 75 个分组、1658 项，这一版期望 76 个分组（缺少 scene/tex）';
  assert.equal(localGaps(assessed, { client: true }), `${sceneGap}，请重新运行 node tools/setup.mjs --scenes`);
  assert.equal(localArtDetail(assessed, '', '已提取', { client: true }), `已提取 1658 项${sceneGap}，请重新运行 node tools/setup.mjs --scenes`);
  assert.equal(assessed.fx.state, 'skip');
  assert.equal(assessed.fx.stale, false);

  const ask = sceneInstallPlan(sceneOpts(assessed, { client: true, python: true }));
  assert.equal(ask.state, 'ask');
  assert.equal(ask.run, false);
  assert.match(ask.detail, /已有 11 个战场，这一版期望 11 个，缺少共用贴图 scene\/tex/);
  assert.match(ask.detail, /node tools\/setup\.mjs --scenes/);
  assert.doesNotMatch(ask.detail, /0\.2\.5/);

  const blocked = sceneInstallPlan(sceneOpts(assessed, { client: false, python: true }));
  assert.equal(blocked.state, 'warn');
  assert.equal(blocked.run, false);
  assert.match(blocked.detail, /scene\/tex/);
  assert.match(blocked.detail, /同一版本的整合包/);
  assert.doesNotMatch(blocked.detail, /--scenes/);
  assert.doesNotMatch(blocked.detail, /--local/);
  const checking = sceneInstallPlan(sceneOpts(assessed, { check: true, client: true, python: true }));
  assert.equal(checking.state, 'warn');
  assert.equal(checking.run, false);
});

test('the full group set is not stale, and a superset of local-assets groups is not either', () => {
  const full = assessLocal(manifestOf(EXPECTED_LOCAL_GROUPS), null);
  assert.equal(full.stale, false);
  assert.equal(full.scenes, true);
  assert.equal(full.groupCount, 76);
  assert.equal(localGaps(full), '');
  assert.equal(localArtState(full), 'ok');
  const scene = sceneInstallPlan(sceneOpts(full, { client: false }));
  assert.equal(scene.state, 'ok');
  assert.match(scene.detail, /11 个战场/);
  assert.match(scene.detail, /金属地块/);
  assert.doesNotMatch(scene.detail, /0\.2\.5/);
  assert.equal(localArtDetail(full, '，3D 棋盘可用'), '已提取 76 项，3D 棋盘可用（重新提取：--local）');

  const extra = manifestOf(EXPECTED_LOCAL_GROUPS);
  extra.groups['old/leftover'] = { a: { path: '/x' } };
  extra.groups.fx = { a: { path: '/x' } };
  extra.count += 2;
  const sup = assessLocal(extra, null);
  assert.equal(sup.stale, false);
  assert.equal(sup.fx.state, 'skip');
  assert.equal(localGaps(sup), '');
});

test('a count field that disagrees with the listed entries is stale; a missing count is not', () => {
  const doc = manifestOf(EXPECTED_LOCAL_GROUPS);
  doc.count = 9999;
  const bad = assessLocal(doc, null);
  assert.equal(bad.stale, true);
  assert.equal(bad.missingGroups.length, 0);
  assert.match(localGaps(bad), /已有 76 个分组、76 项，这一版期望 76 个分组，清单写 9999 项，分组里是 76 项/);
  assert.match(localGaps(bad), /node tools\/setup\.mjs --local/);
  delete doc.count;
  const bare = assessLocal(doc, null);
  assert.equal(bare.countMismatch, false);
  assert.equal(bare.stale, false);
});

test('prefix-only gap objects keep the older sentences', () => {
  assert.equal(localGaps({ enemySpines: true, tokenSpines: true }), '');
  assert.equal(localGaps({ enemySpines: true, tokenSpines: false }), '，缺少新版的自选召唤物模型');
  assert.match(localGaps({ enemySpines: true, tokenSpines: true, scenes: false }), /各战场官方场景/);
});

test('no manifest is skip, not a stale art row', () => {
  const none = assessLocal(null, null);
  assert.equal(none.manifest, false);
  assert.equal(none.stale, true);
  assert.equal(none.count, 0);
  assert.equal(none.missingGroups.length, 76);
  assert.equal(localArtState(none), 'skip');
  assert.equal(localArtState({ manifest: false, stale: true }), 'skip');
});

test('fx catalog: absent is skip; a wrong catalog warns; a matching one is ok', () => {
  const absent = fxCatalogReport(null);
  assert.equal(absent.state, 'skip');
  assert.equal(absent.stale, false);
  assert.match(absent.detail, /已有 0 个分组、0 项/);
  assert.match(absent.detail, /这一版期望 4 个分组（fx、fx\/prefabs、fx\/tex、fx\/mesh）、索引版本 3/);
  assert.match(absent.detail, /--only fx --fx-set used/);
  assert.doesNotMatch(absent.detail, /需要时 python tools/);

  const groups = {
    fx: {
      index: { version: 2, path: '/assets/local/fx/index.json' },
      textures: { path: '/assets/local/fx/textures.json' },
    },
    'fx/prefabs': { a: { path: '/x' } },
    'fx/tex': { a: { path: '/x' } },
  };
  const wrong = fxCatalogReport({ version: 1, format: 'fx-manifest', count: 100, groups });
  assert.equal(wrong.state, 'warn');
  assert.equal(wrong.stale, true);
  assert.equal(wrong.listed, 4);
  assert.match(wrong.detail, /已有 3 个分组、4 项/);
  assert.match(wrong.detail, /索引版本 2，期望 3/);
  assert.match(wrong.detail, /清单写 100 项，分组里是 4 项/);
  assert.match(wrong.detail, /缺少 fx\/mesh/);
  assert.match(wrong.detail, /--only fx --fx-set used/);
  assert.doesNotMatch(wrong.detail, /--local/);

  const okGroups = {
    fx: { index: { version: 3, path: '/i' }, textures: { path: '/t' } },
    'fx/prefabs': { a: { path: '/x' } },
    'fx/tex': { a: { path: '/x' } },
    'fx/mesh': { a: { path: '/x' } },
  };
  const ok = fxCatalogReport({ version: 1, format: 'fx-manifest', count: 5, groups: okGroups });
  assert.equal(ok.state, 'ok');
  assert.equal(ok.detail, '已提取 5 项，4 个分组，索引版本 3');

  const extra = fxCatalogReport({
    version: 1, format: 'fx-manifest', count: 6,
    groups: { ...okGroups, 'fx/old': { a: { path: '/x' } } },
  });
  assert.equal(extra.state, 'warn');
  assert.match(extra.detail, /多出 fx\/old/);
});

test('a scene-only gap names --scenes with a client and the full-package copy without one', () => {
  const assessed = assessLocal(manifestMissingTex(), null);
  const copy = '没有客户端的服务器可以从同一版本的整合包（完整包）复制 public/assets/local 和 data/local-assets.json';
  assert.equal(localGaps(assessed), `，已有 75 个分组、1658 项，这一版期望 76 个分组（缺少 scene/tex）。${copy}`);
  assert.doesNotMatch(localGaps(assessed, { client: false }), /--local|--scenes/);
  assert.match(localGaps(assessed, { client: true }), /node tools\/setup\.mjs --scenes/);
  assert.doesNotMatch(localGaps(assessed, { client: true }), /--local/);
  const noClient = doctorLocalDetail(assessed, false);
  assert.match(noClient, /同一版本的整合包/);
  assert.doesNotMatch(noClient, /--local/);
  assert.doesNotMatch(noClient, /--scenes/);
  assert.equal((noClient.match(/同一版本的整合包/g) || []).length, 1);
  const withClient = doctorLocalDetail(assessed, true);
  assert.match(withClient, /--scenes/);
  assert.doesNotMatch(withClient, /--local/);
  assert.equal((withClient.match(/--scenes/g) || []).length, 1);

  const before = {
    state: 'warn', label: '本地客户端美术（可选）',
    detail: localArtDetail(assessed, '，3D 棋盘可用', '已提取', { client: true }),
  };
  assert.match(before.detail, /--scenes/);
  const after = artRowAfterScenes(before, assessLocal(manifestOf(EXPECTED_LOCAL_GROUPS), null), {
    client: true, tail: '，3D 棋盘可用', verb: '已提取',
  });
  assert.equal(after.state, 'ok');
  assert.equal(after.detail, '已提取 76 项，3D 棋盘可用（重新提取：--local）');
  const src = fs.readFileSync(path.join(ROOT, 'tools/setup.mjs'), 'utf8');
  const step7 = src.indexOf('// 7. official battlefield scenes');
  assert.ok(step7 > 0 && src.indexOf('artRowAfterScenes(', step7) > step7);

  const mixedKeys = EXPECTED_LOCAL_GROUPS.filter((g) => g !== 'scene/tex' && !g.startsWith('spine/token/'));
  const mixed = assessLocal(manifestOf(mixedKeys), null);
  assert.ok(mixed.missingGroups.some((g) => g.startsWith('scene/')) && mixed.missingGroups.some((g) => !g.startsWith('scene/')));
  assert.match(localGaps(mixed, { client: true }), /node tools\/setup\.mjs --local/);
});

test('a partial battlefield set does not start a client extract unless --scenes or --yes', () => {
  const assessed = assessLocal(manifestMissingTex(), null);
  const ask = sceneInstallPlan(sceneOpts(assessed, { client: true, python: true }));
  assert.equal(ask.state, 'ask');
  assert.equal(ask.run, false);
  assert.equal(sceneFilesPartial(assessed), true);
  assert.equal(sceneVersionOnlyGap(assessed), false);
  assert.equal(sceneAskDefault(true), false);
  assert.equal(sceneAskDefault(false), true);
  assert.equal(sceneClientExtractAllowed({ partial: true, answer: true }), false);
  assert.equal(sceneClientExtractAllowed({ partial: true, answer: false }), false);
  assert.equal(sceneClientExtractAllowed({ partial: true, force: true, answer: false }), true);
  assert.equal(sceneClientExtractAllowed({ partial: true, yes: true, answer: false }), true);
  assert.equal(sceneClientExtractAllowed({ partial: false, answer: true }), true);
  const src = fs.readFileSync(path.join(ROOT, 'tools/setup.mjs'), 'utf8');
  assert.match(src, /ask\('现在下载并提取吗？', sceneAskDefault\(filesPartial \|\| versionOnly\)\)/);
  assert.equal((src.match(/ask\('现在下载并提取吗？'/g) || []).length, 1);
  assert.equal(sceneInstallPlan(sceneOpts(assessed, { client: true, python: true, yes: true })).run, true);
  assert.equal(sceneInstallPlan(sceneOpts(assessed, { client: true, python: true, force: true })).run, true);
  const checking = sceneInstallPlan(sceneOpts(assessed, { check: true, client: true, python: true }));
  assert.equal(checking.state, 'warn');
  assert.equal(checking.run, false);
});

test('the fx repair command is the venv interpreter, not python on PATH', () => {
  assert.equal(fxReextractCommand(false), '.venv-extract/bin/python tools/local-extract/extract.py --only fx --fx-set used');
  assert.equal(fxReextractCommand(true), '.venv-extract\\Scripts\\python.exe tools/local-extract/extract.py --only fx --fx-set used');
  assert.equal(fxReextractCommand().split(' tools/')[0], path.relative(ROOT, venvPython()));
  assert.equal(IS_WIN, process.platform === 'win32');
  const groups = {
    fx: { index: { version: 3, path: '/i' }, textures: { path: '/t' } },
    'fx/prefabs': { a: { path: '/x' } },
    'fx/tex': { a: { path: '/x' } },
    'fx/mesh': { a: { path: '/x' } },
    'fx/plugin': { a: { path: '/x' } },
  };
  const extra = fxCatalogReport({ version: 1, format: 'fx-manifest', count: 6, groups });
  assert.equal(extra.state, 'warn');
  assert.match(extra.detail, /多出 fx\/plugin/);
  assert.match(extra.detail, /请重新运行 \.venv-extract(?:\/bin\/python|\\Scripts\\python\.exe) tools\/local-extract\/extract\.py --only fx --fx-set used/);
  assert.doesNotMatch(extra.detail, /请重新运行 python /);
});

test('callers that omit sceneGroupHave still use the old scene branches', () => {
  const check = sceneInstallPlan({ hasScenes: false, check: true, client: true, python: true });
  assert.equal(check.state, 'skip');
  assert.match(check.detail, /未提取各战场官方场景/);
});

/** Full group set plus one kind:Scene record per battlefield. `version` omitted leaves the field off. */
function manifestCurrentScenes(version) {
  const doc = manifestOf(EXPECTED_LOCAL_GROUPS);
  let extra = 0;
  for (const g of EXPECTED_LOCAL_GROUPS) {
    if (!g.startsWith('scene/') || g === 'scene/tex') continue;
    const rec = { path: '/x', kind: 'Scene', chunks: 1 };
    if (version !== undefined) rec.version = version;
    doc.groups[g].scene = rec;
    extra++;
  }
  doc.count += extra;
  return doc;
}

test('an old scene-record version is stale and asks for --scenes once; version 4 is fresh', () => {
  assert.equal(EXPECTED_SCENE.version, 4);
  const current = assessLocal(manifestCurrentScenes(4), null);
  assert.equal(current.sceneVersionStale, false);
  assert.equal(current.scenes, true);
  assert.equal(current.stale, false);
  assert.equal(localGaps(current), '');
  assert.equal(sceneInstallPlan(sceneOpts(current, { client: true, python: true })).state, 'ok');

  const bare = manifestOf(EXPECTED_LOCAL_GROUPS);
  assert.equal(assessLocal(bare, null).sceneVersionStale, false, 'no Scene record is not a version problem');

  const old = assessLocal(manifestCurrentScenes(undefined), null);
  assert.equal(old.sceneVersionHave, '无');
  assert.equal(old.sceneVersionStale, true);
  assert.equal(old.scenes, false);
  assert.equal(old.stale, true);
  assert.equal(old.missingGroups.length, 0);
  assert.equal(localGaps(old, { client: true }), '，场景版本 无，期望 4，请重新运行 node tools/setup.mjs --scenes');
  assert.doesNotMatch(localGaps(old, { client: true }), /--local|金属地块|已有 11 个战场/);
  const copy = '没有客户端的服务器可以从同一版本的整合包（完整包）复制 public/assets/local 和 data/local-assets.json';
  assert.equal(localGaps(old), `，场景版本 无，期望 4。${copy}`);
  assert.doesNotMatch(localGaps(old), /--scenes|--local/);
  const withClient = doctorLocalDetail(old, true);
  assert.match(withClient, /场景版本 无，期望 4，请重新运行 node tools\/setup\.mjs --scenes/);
  assert.equal((withClient.match(/--scenes/g) || []).length, 1);
  assert.doesNotMatch(withClient, /--local|金属地块|已有 11 个战场/);
  const noClient = doctorLocalDetail(old, false);
  assert.match(noClient, /场景版本 无，期望 4/);
  assert.match(noClient, /同一版本的整合包/);
  assert.doesNotMatch(noClient, /--scenes|--local/);

  const ask = sceneInstallPlan(sceneOpts(old, { client: true, python: true }));
  assert.equal(ask.state, 'ask');
  assert.equal(ask.run, false);
  assert.match(ask.detail, /场景版本 无，期望 4/);
  assert.doesNotMatch(ask.detail, /--local|金属地块/);
  assert.equal(sceneVersionOnlyGap(old), true);
  assert.equal(sceneFilesPartial(old), false);
  assert.equal(sceneClientExtractAllowed({ partial: sceneFilesPartial(old), answer: true }), true);
  assert.equal(sceneInstallPlan(sceneOpts(old, { client: true, python: true, yes: true })).run, true);

  const v3 = assessLocal(manifestCurrentScenes(3), null);
  assert.equal(v3.sceneVersionStale, true, 'version 3 still contains redundant scene renderers');
  assert.equal(sceneVersionOnlyGap(v3), true);
  assert.equal(sceneAskDefault(sceneFilesPartial(v3) || sceneVersionOnlyGap(v3)), false);
  assert.equal(sceneInstallPlan(sceneOpts(v3, { client: true, python: true })).state, 'ask');
  assert.equal(sceneClientExtractAllowed({ partial: sceneFilesPartial(v3), answer: true }), true);

  const v2 = assessLocal(manifestCurrentScenes(2), null);
  assert.equal(v2.sceneVersionHave, '2');
  assert.equal(v2.sceneVersionStale, true);
  assert.equal(v2.scenes, false);
  assert.equal(sceneVersionOnlyGap(v2), true, 'a version-2 extract (normal and gloss only) is stale');
  assert.match(localGaps(v2, { client: true }), /场景版本 2，期望 4，请重新运行 node tools\/setup\.mjs --scenes/);

  const v1 = assessLocal(manifestCurrentScenes(1), null);
  assert.equal(v1.sceneVersionHave, '1');
  assert.equal(v1.stale, true);
  assert.match(localGaps(v1, { client: true }), /场景版本 1，期望 4，请重新运行 node tools\/setup\.mjs --scenes/);

  const mixed = manifestCurrentScenes(4);
  const stage = EXPECTED_LOCAL_GROUPS.find((g) => g.startsWith('scene/act'));
  mixed.groups[stage].scene.version = 1;
  const mix = assessLocal(mixed, null);
  assert.equal(mix.sceneVersionHave, '不一致');
  assert.equal(mix.stale, true);
  assert.match(localGaps(mix, { client: true }), /场景版本 不一致，期望 4/);
});

test('a typed yes on a version-only gap extracts; a missing-scene set still does not', () => {
  const v2 = assessLocal(manifestCurrentScenes(2), null);
  assert.equal(sceneAskDefault(sceneFilesPartial(v2) || sceneVersionOnlyGap(v2)), false);
  assert.equal(sceneClientExtractAllowed({ partial: sceneFilesPartial(v2), answer: true }), true);
  assert.equal(sceneClientExtractAllowed({ partial: sceneFilesPartial(v2), answer: false }), false);

  const bothDoc = manifestCurrentScenes(2);
  delete bothDoc.groups['scene/tex'];
  const both = assessLocal(bothDoc, null);
  assert.ok(both.missingSceneGroups.includes('scene/tex'));
  assert.equal(both.sceneVersionStale, true);
  assert.equal(sceneFilesPartial(both), true, 'missing scenes keep the §34.11 rule even when the version is old');
  assert.equal(sceneVersionOnlyGap(both), false);
  assert.equal(sceneClientExtractAllowed({ partial: sceneFilesPartial(both), answer: true }), false);

  const src = fs.readFileSync(path.join(ROOT, 'tools/setup.mjs'), 'utf8');
  assert.equal((src.match(/ask\('现在下载并提取吗？'/g) || []).length, 1);
  assert.match(src, /sceneClientExtractAllowed\(\{ partial: filesPartial,/);
  assert.match(src, /saveState\(\{ sceneDeclined: true \}\)/);
  assert.equal((src.match(/'--only', 'scene'/g) || []).length, 1);
});
