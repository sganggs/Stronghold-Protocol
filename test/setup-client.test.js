// tools/setup.mjs: where the local Arknights client is looked for (--game → SP_ARKNIGHTS_AB → remembered path →
// known install locations), and which folder layouts a given path may have.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, clientCandidates, findClient, locateClient, resolveAbRoot } from '../tools/setup.mjs';

const AB_TAIL = ['Arknights_Data', 'StreamingAssets', 'AB', 'Windows'];

function fakeInstall(t, { autochess = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-client-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ab = path.join(root, ...AB_TAIL);
  fs.mkdirSync(autochess ? path.join(ab, 'ui', 'autochess') : ab, { recursive: true });
  return { root, ab };
}

test('resolveAbRoot: the install folder, its Arknights_Data folder and the AssetBundle root give the same root', (t) => {
  const { root, ab } = fakeInstall(t);
  assert.equal(resolveAbRoot(root), ab);
  assert.equal(resolveAbRoot(path.join(root, 'Arknights_Data')), ab);
  assert.equal(resolveAbRoot(ab), ab);
  const missing = path.join(root, 'nowhere');
  assert.equal(resolveAbRoot(missing), missing);
  assert.equal(resolveAbRoot(''), null);
});

test('findClient: --game takes an install folder; a root without the autochess art is partial', (t) => {
  const full = fakeInstall(t);
  const hit = findClient(full.root);
  assert.equal(hit.path, full.ab);
  assert.equal(hit.kind, '--game');
  assert.ok(hit.autochess);
  const empty = fakeInstall(t, { autochess: false });
  const partial = findClient(empty.root);
  assert.equal(partial.path, empty.ab);
  assert.ok(!partial.autochess);
});

test('findClient: SP_ARKNIGHTS_AB is used when --game is not given', (t) => {
  const { root, ab } = fakeInstall(t);
  const before = process.env.SP_ARKNIGHTS_AB;
  t.after(() => { if (before === undefined) delete process.env.SP_ARKNIGHTS_AB; else process.env.SP_ARKNIGHTS_AB = before; });
  process.env.SP_ARKNIGHTS_AB = root;
  const hit = findClient();
  assert.equal(hit.path, ab);
  assert.equal(hit.kind, 'SP_ARKNIGHTS_AB');
});

// ---- locateClient: when setup asks, and what it remembers (GitHub #572, review of PR #573)

/** A state store in memory + a prompt that counts its calls and answers `answer`. */
function harness({ initial = {}, answer = null } = {}) {
  const saved = [];
  let data = { ...initial };
  const asked = [];
  return {
    saved, asked,
    opts: {
      state: { load: () => data, save: (patch) => { saved.push(patch); data = { ...data, ...patch }; } },
      prompt: async (q) => { asked.push(q); return answer; },
      find: (explicit) => (explicit ? findClient(explicit) : null),   // nothing installed in the usual places
      tty: true,
      log: () => {},
    },
  };
}

test('locateClient: --check, --quiet, --yes and a run without a terminal never ask and never write', async () => {
  for (const flags of [{ check: true }, { quiet: true }, { yes: true }, { tty: false }]) {
    const h = harness({ answer: 'C:\\somewhere' });
    assert.equal(await locateClient(null, { ...h.opts, ...flags }), null, JSON.stringify(flags));
    assert.equal(h.asked.length, 0, `asked with ${JSON.stringify(flags)}`);
    assert.deepEqual(h.saved, [], `state written with ${JSON.stringify(flags)}`);
  }
});

test('locateClient: a terminal run asks once; a valid folder is remembered and returned', async (t) => {
  const { root, ab } = fakeInstall(t);
  const h = harness({ answer: root });
  const hit = await locateClient(null, h.opts);
  assert.equal(h.asked.length, 1);
  assert.equal(hit.path, ab);
  assert.ok(hit.autochess);
  assert.deepEqual(h.saved, [{ clientPath: ab, clientDeclined: false }]);
});

test('locateClient: Enter is remembered as declined and stops the question; no answer in time changes nothing', async () => {
  const declined = harness({ answer: '' });
  assert.equal(await locateClient(null, declined.opts), null);
  assert.deepEqual(declined.saved, [{ clientDeclined: true }]);
  assert.equal(await locateClient(null, declined.opts), null);
  assert.equal(declined.asked.length, 1, 'asked again after a declined answer');

  const timedOut = harness({ answer: null });
  assert.equal(await locateClient(null, timedOut.opts), null);
  assert.equal(timedOut.asked.length, 1);
  assert.deepEqual(timedOut.saved, []);
});

test('locateClient: a folder without the autochess art is not remembered', async (t) => {
  const { root } = fakeInstall(t, { autochess: false });
  const h = harness({ answer: root });
  assert.equal(await locateClient(null, h.opts), null);
  assert.deepEqual(h.saved, []);
});

test('locateClient: --game is remembered when it holds the art — not with --check, not when it is incomplete, never asked', async (t) => {
  const full = fakeInstall(t);
  const h = harness();
  assert.equal((await locateClient(full.root, h.opts)).path, full.ab);
  assert.deepEqual(h.saved, [{ clientPath: full.ab, clientDeclined: false }]);
  await locateClient(full.root, h.opts);
  assert.equal(h.saved.length, 1, 'the same folder is not written twice');

  const checked = harness();
  assert.equal((await locateClient(full.root, { ...checked.opts, check: true })).path, full.ab);
  assert.deepEqual(checked.saved, []);

  const empty = fakeInstall(t, { autochess: false });
  const partial = harness({ answer: full.root });
  assert.ok(!(await locateClient(empty.root, partial.opts)).autochess);
  assert.deepEqual(partial.saved, []);
  assert.equal(partial.asked.length, 0);
});

test('setup --help names the install folder for --game and when setup asks', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'setup.mjs'), 'utf8');
  const help = src.slice(0, src.indexOf('// Exit code'));
  assert.match(help, /--game <dir>\s+the local client: its install folder/);
  assert.match(help, /--check, --quiet, -y and a run without a terminal never ask/);
});

// ---- the Python side takes the same folders (extract.py, enemy_scales.py, enemy_model_offsets.py)

const PY = ['python3', 'python'].find((bin) => spawnSync(bin, ['--version']).status === 0);
const TOOL = path.join(ROOT, 'tools', 'local-extract');

describe('extract.py find_ab_root (no UnityPy needed)', { skip: !PY && 'no python3' }, () => {
  const py = (code, env = {}) => {
    const src = `import sys, json\nsys.path.insert(0, ${JSON.stringify(TOOL)})\nimport extract as e\n${code}`;
    const r = spawnSync(PY, ['-c', src], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1', ...env } });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };

  test('--game: the install folder, Arknights_Data and the AB root give the same root; a missing folder gives none', (t) => {
    const { root, ab } = fakeInstall(t);
    const got = py(`print(json.dumps([str(e.find_ab_root(p)) for p in ${JSON.stringify([root, path.join(root, 'Arknights_Data'), ab])}] + [e.find_ab_root(${JSON.stringify(path.join(root, 'nowhere'))})]))`);
    assert.deepEqual(got.slice(0, 3).map((p) => path.resolve(p)), [ab, ab, ab]);
    assert.equal(got[3], null);
  });

  test('without --game: SP_ARKNIGHTS_AB comes first, and `usable` decides (the enemy scripts need battle/)', (t) => {
    const { root, ab } = fakeInstall(t);
    const got = py(
      'print(json.dumps([str(e.client_candidates()[0]), str(e.find_ab_root()), e.find_ab_root(usable=lambda p: (p / "battle").is_dir()) is None or str(e.find_ab_root(usable=lambda p: (p / "battle").is_dir()))]))',
      { SP_ARKNIGHTS_AB: root });
    assert.equal(path.resolve(got[0]), ab);
    assert.equal(path.resolve(got[1]), ab);
    assert.notEqual(got[2] === true ? null : path.resolve(got[2]), ab, 'a root without battle/ is not usable for the enemy scripts');
  });

  test('the usual Windows locations match setup.mjs clientCandidates', { skip: process.platform !== 'win32' && 'Windows only' }, () => {
    const got = py('print(json.dumps([str(p) for p in e.client_candidates()]))', { SP_ARKNIGHTS_AB: '' });
    // compare the install folders: an AB root of a folder that does not exist is the folder itself on the Python side
    const install = (p) => { const abs = path.resolve(p), tail = path.join(...AB_TAIL); return abs.endsWith(tail) ? abs.slice(0, -tail.length - 1) : abs; };
    const want = clientCandidates().map((c) => install(c.path));
    assert.deepEqual(got.map(install).slice(-want.length), want);
  });
});
