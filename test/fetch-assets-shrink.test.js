// tools/fetch-assets.mjs never shrinks the committed data/assets.json by accident. A rebuilt manifest leaves out every
// entry whose files are missing on this machine, so a run where some downloads failed (or whose upstream index lost
// them) dropped entries every other install still has — a pull request (PR #7) carried such a manifest, 42 audio
// entries short. The run now keeps the current manifest, lists the entries it would drop and exits 1, unless
// --allow-shrink (or --prune) is passed. DESIGN §21, docs/ASSETS.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { droppedEntries } from '../tools/assets/manifest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'data', 'assets.json');

test('droppedEntries: leaves of the old manifest the new one lacks; build fields, additions and shape changes are no drops', () => {
  const prev = {
    version: 1, hash: 'a', generator: 'x', stats: { files: 3 },
    audio: { sfx: { ui: { timer: '/t.mp3', click: '/c.mp3' }, units: { u1: { hit: '/h.mp3', skills: { 0: '/s.mp3' } } } } },
    chars: { c1: { avatar: '/a.png', spine: { textures: ['/x.png'] } }, c2: { avatar: '/b.png' } },
    ui: { gone: {} },
  };
  const next = {
    version: 2, hash: 'b', generator: 'y', stats: { files: 9 },
    audio: { sfx: { ui: { click: '/c2.mp3', extra: '/e.mp3' }, units: {} } },
    chars: { c1: { avatar: { lo: '/a.png' }, spine: { textures: [] } }, c3: { avatar: '/z.png' } },
  };
  assert.deepEqual(droppedEntries(prev, next), [
    'audio.sfx.ui.timer', 'audio.sfx.units.u1.hit', 'audio.sfx.units.u1.skills.0', 'chars.c2.avatar',
  ]);
  assert.deepEqual(droppedEntries(next, prev), ['audio.sfx.ui.extra', 'chars.c3.avatar'], 'the other way round');
  assert.deepEqual(droppedEntries(prev, prev), []);
  assert.deepEqual(droppedEntries(null, next), [], 'no current manifest: nothing to lose');
});

test('fetch-assets shrink guard: the committed manifest minus some audio entries (PR #7) is refused unless --allow-shrink / --prune', async () => {
  const { shrinkGuard, parseArgs } = await import('../tools/fetch-assets.mjs');
  const before = statSync(MANIFEST).mtimeMs;
  const prev = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const next = JSON.parse(JSON.stringify(prev));
  const gone = [];
  const drop = (path) => {
    const keys = path.split('.');
    const parent = keys.slice(0, -1).reduce((o, k) => o?.[k], next);
    if (parent && Object.hasOwn(parent, keys.at(-1))) { delete parent[keys.at(-1)]; gone.push(path); }
  };
  // what PR #7's manifest lacked: UI sounds, boss BGM intros, per-unit sounds
  for (const k of ['timer', 'draft', 'battleStart', 'artPlace', 'killBossAll']) drop(`audio.sfx.ui.${k}`);
  for (const b of ['boss_8', 'boss_9', 'boss_10']) drop(`audio.bossBgm.${b}.intro`);
  const unit = Object.entries(prev.audio.sfx.units).find(([, v]) => v && typeof v.hit === 'string');
  drop(`audio.sfx.units.${unit[0]}.hit`);
  assert.ok(gone.length >= 6, `the fixture drops real entries (${gone})`);
  next.stats = { ...next.stats, files: next.stats.files - gone.length };
  next.hash = 'changed';
  next.chars = { ...next.chars, char_new_test: { avatar: '/assets/char/avatar/new.png' } };

  const refused = shrinkGuard(prev, next, parseArgs([]));
  assert.equal(refused.write, false, 'a smaller manifest is not written by default');
  assert.deepEqual(refused.dropped, gone.slice().sort(), 'and the run names exactly the entries it would drop');
  assert.equal(shrinkGuard(prev, next, parseArgs(['--allow-shrink'])).write, true, '--allow-shrink writes it');
  assert.equal(shrinkGuard(prev, next, parseArgs(['--prune'])).write, true, '--prune writes it');
  assert.equal(shrinkGuard(prev, next, parseArgs(['--offline'])).write, false, '--offline is guarded too');
  const grown = JSON.parse(JSON.stringify(prev));
  grown.chars.char_new_test = { avatar: '/x.png' };
  grown.stats.files += 1;
  assert.deepEqual(shrinkGuard(prev, grown, parseArgs([])), { dropped: [], write: true }, 'a manifest that only grows is written');
  assert.deepEqual(shrinkGuard(null, next, parseArgs([])), { dropped: [], write: true }, 'no current manifest: written');
  assert.equal(parseArgs(['--allow-shrink']).allowShrink, true);
  assert.throws(() => parseArgs(['--allow-shrinks']), /unknown option/);
  // 干员战斗语音: the prep-only slots are opt-in (DESIGN §21.30 — no battle requests them)
  assert.equal(parseArgs([]).voiceAll, false, 'the battle slots are what a plain run plans');
  assert.equal(parseArgs(['--voice-all']).voiceAll, true);
  assert.equal(parseArgs(['--voice-lang=jp']).voiceLang, 'jp');
  assert.equal(statSync(MANIFEST).mtimeMs, before, 'importing the tool runs nothing');
});

test('a server where the mirror emotes / 玩法说明 pages failed to download keeps the committed manifest, so the next setup retries them (#42)', async () => {
  // setup re-runs fetch-assets only while data/assets.json lists a file that is not on disk: a manifest rewritten without
  // these entries would stop the retries, and the emotes would stay default icons on that server
  const { shrinkGuard, parseArgs } = await import('../tools/fetch-assets.mjs');
  const prev = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const next = JSON.parse(JSON.stringify(prev));
  for (const k of Object.keys(next.ui)) if (/^(emoticon|guide)\//.test(k)) delete next.ui[k];
  next.stats = { ...next.stats, ui: Object.keys(next.ui).length };
  const g = shrinkGuard(prev, next, parseArgs([]));
  assert.equal(g.write, false);
  assert.equal(g.dropped.length, 36 + 19);
  for (const k of ['ui.emoticon/basic/pic_happy_battle', 'ui.emoticon/fooldoctor/pic_fooldoctor_08_battle', 'ui.guide/autochess_home_1', 'ui.guide/autochess_handbook_4']) {
    assert.ok(g.dropped.includes(k), k);
  }
});

test('fetch-assets still runs as a script: --help lists --allow-shrink', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'fetch-assets.mjs'), '--help'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--allow-shrink/);
  assert.match(r.stdout, /--prune .*\n.*implies --allow-shrink/);
});
