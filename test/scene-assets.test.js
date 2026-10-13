// Official battlefield scenes in the 0.2.5 asset pack (PR #533, GitHub #532).
// The repository never stores the bundles or the extracted files. The full release zip includes
// public/assets/local/scene when the maintainer extracted it; a lite zip and a source install do not,
// and setup may fetch + extract on that machine. Missing extractor dependencies keep the metal board.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { artPlan, formatSummary, isPlayerFile, isRefused } from '../tools/package.mjs';
import { localGaps, sceneInstallPlan } from '../tools/setup.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('sceneInstallPlan: fetch only with a client and extractor deps; otherwise the metal board', () => {
  const present = sceneInstallPlan({ hasScenes: true, client: false });
  assert.equal(present.run, false);
  assert.equal(present.state, 'ok');
  assert.match(present.detail, /金属地块/);

  const check = sceneInstallPlan({ hasScenes: false, check: true, client: true, python: true });
  assert.equal(check.run, false);
  assert.equal(check.state, 'skip');
  assert.match(check.detail, /--scenes/);
  assert.match(check.detail, /金属地块/);

  const noClient = sceneInstallPlan({ hasScenes: false, client: false, python: true });
  assert.equal(noClient.run, false);
  assert.equal(noClient.state, 'skip');
  assert.match(noClient.detail, /完整包/);
  assert.match(noClient.detail, /金属地块/);

  const incomplete = sceneInstallPlan({ hasScenes: false, client: 'incomplete', python: true, force: true });
  assert.equal(incomplete.run, false);
  assert.equal(incomplete.state, 'warn');
  assert.match(incomplete.detail, /金属地块/);

  const noPy = sceneInstallPlan({ hasScenes: false, client: true, python: false });
  assert.equal(noPy.run, false);
  assert.equal(noPy.state, 'warn');
  assert.match(noPy.detail, /Python/);
  assert.match(noPy.detail, /金属地块/);

  const noDeps = sceneInstallPlan({ hasScenes: false, client: true, python: true, deps: false });
  assert.equal(noDeps.run, false);
  assert.equal(noDeps.state, 'warn');
  assert.match(noDeps.detail, /UnityPy/);
  assert.match(noDeps.detail, /金属地块/);

  const declined = sceneInstallPlan({ hasScenes: false, client: true, python: true, declined: true });
  assert.equal(declined.run, false);
  assert.equal(declined.state, 'skip');

  const ask = sceneInstallPlan({ hasScenes: false, client: true, python: true });
  assert.equal(ask.run, false);
  assert.equal(ask.state, 'ask');
  assert.match(ask.detail, /金属地块/);

  for (const extra of [{ force: true, declined: true }, { yes: true }]) {
    const go = sceneInstallPlan({ hasScenes: false, client: true, python: true, ...extra });
    assert.equal(go.run, true, JSON.stringify(extra));
    assert.match(go.detail, /金属地块/);
  }
});

test('an older extraction is told it lacks the battlefield scenes', () => {
  assert.equal(localGaps({ enemySpines: true, tokenSpines: true }), '');
  assert.match(localGaps({ enemySpines: true, tokenSpines: true, scenes: false }), /各战场官方场景/);
  assert.match(localGaps({ enemySpines: false, tokenSpines: false, scenes: false }), /各战场官方场景/);
});

test('official scene bundles and extracted scenes are not git files; the extractor scripts are', () => {
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(gi, /^public\/assets\/$/m);
  assert.match(gi, /^data\/local-assets\.json$/m);
  assert.match(gi, /^\.cache\/$/m);
  assert.match(gi, /official-scenes/);
  assert.equal(isRefused('.cache/official-scenes/26-04-13-12-31-42_e9b560/scenes/a.ab'), true);
  assert.equal(isRefused('public/assets/local/scene/act2autochess_m02/scene.bin'), false);
  assert.equal(isPlayerFile('public/assets/local/scene/act2autochess_m02/scene.bin'), false);
  assert.equal(isPlayerFile('tools/local-extract/scenes.py'), true);
  assert.equal(isPlayerFile('tools/local-extract/fetch_scenes.py'), true);
});

test('the full asset plan ships extracted scenes; the lite plan ships none', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-scenes-'));
  try {
    const sceneDir = path.join(dir, 'public/assets/local/scene/act2autochess_m02');
    const texDir = path.join(dir, 'public/assets/local/scene/tex');
    fs.mkdirSync(sceneDir, { recursive: true });
    fs.mkdirSync(texDir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'data/assets.json'), '{}\n');
    fs.writeFileSync(path.join(sceneDir, 'scene.bin'), 'mesh-bytes');
    fs.writeFileSync(path.join(sceneDir, 'scene.json'), '{}\n');
    fs.writeFileSync(path.join(texDir, 'TX_A.webp'), 'webp');
    fs.writeFileSync(path.join(dir, 'data/local-assets.json'), JSON.stringify({
      version: 1,
      groups: {
        'scene/act2autochess_m02': {
          scene: { path: '/assets/local/scene/act2autochess_m02/scene.json' },
          bin: { path: '/assets/local/scene/act2autochess_m02/scene.bin' },
        },
        'scene/tex': { TX_A: { path: '/assets/local/scene/tex/TX_A.webp' } },
      },
    }));
    const full = artPlan(dir, { lite: false });
    for (const f of [
      'public/assets/local/scene/act2autochess_m02/scene.bin',
      'public/assets/local/scene/act2autochess_m02/scene.json',
      'public/assets/local/scene/tex/TX_A.webp',
      'data/local-assets.json',
    ]) assert.ok(full.files.includes(f), f);
    assert.ok(full.scenes.includes('public/assets/local/scene/act2autochess_m02/scene.bin'));
    assert.equal(full.scenes.length, 3);
    const lite = artPlan(dir, { lite: true });
    assert.deepEqual(lite.files, []);
    assert.deepEqual(lite.scenes, []);
    const summary = formatSummary({
      lite: false, version: '0.2.5-dev', tracked: [], art: [], localArt: true, generated: [], dropped: {}, orphans: [], held: [],
      scanned: 0, names: 0, problems: [], scenes: { files: full.scenes, bytes: 9 + 3 + 4 },
      bytes: { tracked: 0, art: 16, modules: 0, vendor: 0, total: 16, leftOut: 0, orphans: 0 },
    });
    assert.match(summary, /battlefield scenes: 3 files/);
    const empty = formatSummary({
      lite: false, version: '0.2.5-dev', tracked: [], art: [], localArt: true, generated: [], dropped: {}, orphans: [], held: [],
      scanned: 0, names: 0, problems: [], scenes: { files: [], bytes: 0 },
      bytes: { tracked: 0, art: 0, modules: 0, vendor: 0, total: 0, leftOut: 0, orphans: 0 },
    });
    assert.match(empty, /battlefield scenes: none/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
