// test/versions-default-guard.test.js — the default version (第二期下半, act2autochess) stays exactly as it was before
// the official version switch (DESIGN §35.22.2, docs/DATA.md "Official versions (M0)"). The fixture
// test/fixtures/versions-default-guard.json pins:
//   G2  the default config.json has no `version`, and cs reads exactly the top-level gameplay files
//   G3  the cs formula (known-answer vectors of shared/plugins/identity.js), not the vanilla cs itself, which changes with
//       any code change (server/plugins/identity.js)
//   G4  a fresh co-op/NORMAL room's room.state (code, ids, name and content.cs normalised; no `version` key) and the
//       welcome's `versions` list (each cs normalised: the default as <vanilla cs>, the others as <cs:id>)
// G1 (the sha256 of every tracked default data file and of the golden corpus) was the M0 merge check; it was deleted when
// M1 started (DESIGN §35.22.2, §35.23): test/golden.test.js and test/data.test.js guard the data and the goldens now.
// An intended change of the default must regenerate the fixture on purpose and say why in the commit:
//   SP_UPDATE_GUARD=1 node --test test/versions-default-guard.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTENT_HASH_VERSION, contentHashOf, simHashOf } from '../shared/plugins/identity.js';
import { gameplayDataFiles, computeVanillaContent } from '../server/plugins/identity.js';
import { DATA_SHIM_JS } from '../server/http/static.js';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'versions-default-guard.json');
const UPDATE = process.env.SP_UPDATE_GUARD === '1';
const HOW = 'an intended change of the default version must regenerate test/fixtures/versions-default-guard.json with '
  + 'SP_UPDATE_GUARD=1 node --test test/versions-default-guard.test.js and give the reason in the commit';

/** The gameplay data files of the default version (gameplayDataFiles: data/*.json without the presentation files). */
const GAMEPLAY = ['backups', 'bands', 'bonds', 'bosses', 'chess', 'choices', 'config', 'effects', 'enemies', 'factions',
  'garrisons', 'items', 'stages', 'tokens', 'tuning', 'waves'];

const VERSION_ENV = ['SP_VERSIONS', 'SP_VERSION_DEFAULT', 'SP_MAX_VERSION_HOSTS'];
const HEX64 = /^[0-9a-f]{64}$/;

/** Run `fn` with the version environment unset, then put it back. The server reads it only while starting. */
async function withUnsetVersions(fn) {
  const saved = VERSION_ENV.map((k) => [k, process.env[k]]);
  for (const [k] of saved) delete process.env[k];
  try {
    return await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** A fresh co-op/NORMAL room's room.state and the host's welcome, on the default data, with nothing narrowing the versions. */
async function freshRoom() {
  const srv = await withUnsetVersions(() => startServer({ port: 0, host: '127.0.0.1', quiet: true }));
  const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
  try {
    const welcome = await c.hello('Guard');
    const r = await c.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    assert.equal(r.t, 'ok', JSON.stringify(r));
    const state = await c.waitFor('room.state', (s) => s.hostId === welcome.playerId);
    return { welcome, state };
  } finally {
    await c.terminate().catch(() => {});
    await srv.close();
  }
}

/** Replace what differs between runs: the room code, the player's id and name, and the vanilla cs (a code hash). */
function normaliseState(state, welcome) {
  const id = welcome.playerId;
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== 'object') return v === id ? '<player>' : v;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
  };
  const out = walk(state);
  out.code = '<code>';
  for (const s of out.seats || []) if (s && s.playerId === '<player>' && typeof s.name === 'string') s.name = '<name>';
  if (out.content && typeof out.content.cs === 'string') {
    assert.equal(out.content.cs, welcome.content?.vanilla, 'room content cs = the vanilla cs');
    out.content.cs = '<vanilla cs>';
  }
  return out;
}

/**
 * The welcome's versions list with each cs replaced. The default version's cs must be the vanilla hash; every cs is a
 * distinct 64-hex digest, so a sim change does not move the fixture.
 */
function normaliseVersions(welcome) {
  assert.ok(Array.isArray(welcome.versions), 'welcome.versions');
  const seen = new Set();
  return welcome.versions.map((v) => {
    assert.match(v.cs, HEX64, v.id);
    assert.equal(seen.has(v.cs), false, `duplicate cs ${v.id}`);
    seen.add(v.cs);
    if (v.id === 'act2autochess') assert.equal(v.cs, welcome.content?.vanilla, 'the default entry cs is the vanilla cs');
    else assert.notEqual(v.cs, welcome.content?.vanilla, v.id);
    return { ...v, cs: v.id === 'act2autochess' ? '<vanilla cs>' : `<cs:${v.id}>` };
  });
}

const KAT = {
  cs: contentHashOf({ app: '0.0.0-kat', sim: 'aa'.repeat(32), data: { chess: 'bb'.repeat(32), config: 'cc'.repeat(32) } }),
  sim: simHashOf({ 'shared/a.js': '1'.repeat(64), 'sim/b.js': '2'.repeat(64) }),
};

if (UPDATE) {
  test('regenerate the default-version guard fixture', async () => {
    const { welcome, state } = await freshRoom();
    const fixture = {
      _: `Default-version guard (test/versions-default-guard.test.js); ${HOW}.`,
      kat: { cs: KAT.cs, sim: KAT.sim, contentHashVersion: CONTENT_HASH_VERSION },
      roomState: normaliseState(state, welcome),
      welcomeVersions: normaliseVersions(welcome),
    };
    fs.writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`);
  });
} else {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

  test('G2: the default config has no version and cs reads exactly the gameplay files', () => {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
    assert.equal(Object.hasOwn(config, 'version'), false, 'data/config.json never carries `version` (non-default builds only)');
    const listed = gameplayDataFiles(path.join(ROOT, 'data'));
    assert.deepEqual(listed.map((f) => f.name), GAMEPLAY);
    assert.ok(listed.every((f) => !f.abs.includes(`${path.sep}versions${path.sep}`)), 'nothing under data/versions/');
    const content = computeVanillaContent({ simDir: path.join(ROOT, 'server', 'sim'), sharedDir: path.join(ROOT, 'shared'),
      dataDir: path.join(ROOT, 'data'), shim: DATA_SHIM_JS });
    assert.deepEqual(Object.keys(content.data), GAMEPLAY);
  });

  test('G3: the cs formula is unchanged (known-answer vectors)', () => {
    assert.equal(CONTENT_HASH_VERSION, 1);
    assert.equal(KAT.cs, '7d6565abd4c1ec7ceaf979a2d82f90a04f5fe3a11a03d822c6775b2a6c632309');
    assert.equal(KAT.sim, 'f03a3610c2c41607ef1c8fe00e88ed771c6cfdab0b0a164dbbc4d7d2deeb304f');
    assert.deepEqual(fixture.kat, { cs: KAT.cs, sim: KAT.sim, contentHashVersion: CONTENT_HASH_VERSION });
  });

  test('G4: a fresh default room.state and the welcome versions list stay pinned', async () => {
    const { welcome, state } = await freshRoom();
    assert.equal(Object.hasOwn(state, 'version'), false, 'a default room.state carries no `version`');
    assert.deepEqual(normaliseState(state, welcome), fixture.roomState, `the default room.state changed; ${HOW}`);
    assert.deepEqual(normaliseVersions(welcome), fixture.welcomeVersions, `the welcome versions list changed; ${HOW}`);
  });
}
