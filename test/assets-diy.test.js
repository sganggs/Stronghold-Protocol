// test/assets-diy.test.js — the art of the 自选 picks in the asset pipeline (tools/fetch-assets.mjs dataExtras,
// tools/assets/plan.mjs patternOperator / buildPlan `extraOperators` / `moduleTypes`; docs/ASSETS.md): the owned-6★
// units of data/backups.json are planned from research 07's URL patterns (avatar, portrait — E2 too —, battle Spine
// Front / Back, every skill icon), their summons as tokens, and every module's type icon as manifest `modules`; the
// committed data/assets.json lists them (checked against public/assets when present); --add-only never rewrites a file.
// Run: node --test test/assets-diy.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataExtras, orphanFiles, parseArgs } from '../tools/fetch-assets.mjs';
import { patternOperator, buildPlan } from '../tools/assets/plan.mjs';
import { indexAudio } from '../tools/assets/audio.mjs';
import { Downloader } from '../tools/assets/downloader.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => JSON.parse(readFileSync(join(ROOT, 'data', `${f}.json`), 'utf8'));
const BACKUPS = load('backups');
const CHESS = load('chess');
const YUAN = 'https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/';
const FEXLI = 'https://raw.githubusercontent.com/fexli/ArknightsResource/main/';

test('dataExtras: every backups.json unit (skills by index, once), the 自选 summons, the type icon of every module of chess.json and backups.json', () => {
  const x = dataExtras(BACKUPS, CHESS);
  assert.deepEqual(Object.keys(x.extraOperators), Object.keys(BACKUPS.units));
  assert.deepEqual(x.extraOperators.char_112_siege, {
    name: '推进之王', subProfessionId: 'pioneer', nationId: 'victoria',
    skills: [{ index: 0, skillId: 'skcom_charge_cost[3]', iconId: 'skcom_charge_cost[3]' }, { index: 1, skillId: 'skchr_siege_2', iconId: 'skchr_siege_2' }, { index: 2, skillId: 'skchr_siege_3', iconId: 'skchr_siege_3' }],
  });
  assert.deepEqual(x.tokenIds, Object.keys(BACKUPS.tokens).sort());
  const types = new Set();
  for (const c of Object.values(CHESS)) for (const m of c.modules || []) types.add(m.typeIcon);
  for (const u of Object.values(BACKUPS.units)) for (const f of Object.values(u.forms)) for (const m of f.modules || []) types.add(m.typeIcon);
  assert.deepEqual(x.moduleTypes, [...types].sort());
  assert.ok(x.moduleTypes.includes('sol-x') && x.moduleTypes.includes('sol-y'));
  assert.deepEqual(dataExtras(null, null), { extraOperators: {}, tokenIds: [], moduleTypes: [] });
});

test('patternOperator / buildPlan: an operator research 07 lacks gets the 07 URL patterns; known operators keep their research record; module type icons become `modules`', () => {
  const o = patternOperator('char_112_siege', { subProfessionId: 'pioneer', skills: [{ index: 0, skillId: 'skcom_charge_cost[3]', iconId: 'skcom_charge_cost[3]' }] });
  assert.deepEqual([o.avatar.e0e1.url, o.avatar.e2.url, o.portrait.e0e1.url, o.portrait.e2.url],
    [`${YUAN}avatar/char_112_siege.png`, `${YUAN}avatar/char_112_siege_2.png`, `${YUAN}portrait/char_112_siege_1.png`, `${YUAN}portrait/char_112_siege_2.png`]);
  assert.equal(o.battleSpine.front.skel, `${FEXLI}spine/char_112_siege/char_112_siege/Front/char_112_siege.skel`);
  assert.equal(o.battleSpine.back.png, `${FEXLI}spine/char_112_siege/char_112_siege/Back/char_112_siege.png`);
  assert.equal(o.skills[0].icon.url, `${YUAN}skill/skill_icon_skcom_charge_cost%5B3%5D.png`, 'brackets percent-encoded');
  assert.match(o.subProfessionIcon, /arts\/ui\/subprofessionicon\/sub_pioneer_icon\.png$/);
  const known = { name: 'x', avatar: { e0e1: { url: 'https://example.invalid/known.png' } }, skills: [] };
  const t = buildPlan({
    assets07: { operators: { char_609_acguad: known } }, ops03: {}, enemies05: {}, maps05: {}, audio: indexAudio({}), modelsData: {},
    extraOperators: { char_112_siege: dataExtras(BACKUPS, CHESS).extraOperators.char_112_siege, char_609_acguad: { skills: [] }, 'bad id': {} },
    moduleTypes: ['sol-x', 'sol-x', 'bad/type'],
  });
  const c = t.template.chars.char_112_siege;
  assert.deepEqual([c.avatar.alts[0].rel, c.avatarE2.alts[0].rel, c.portrait.alts[0].rel, c.portraitE2.alts[0].rel],
    ['char/avatar/char_112_siege.png', 'char/avatar/char_112_siege_2.png', 'char/portrait/char_112_siege_1.png', 'char/portrait/char_112_siege_2.png']);
  assert.deepEqual(c.spine, { front: { model: 'op:char_112_siege:front' }, back: { model: 'op:char_112_siege:back' } });
  assert.deepEqual(t.models.get('op:char_112_siege:front').skillIndices, [0, 1, 2], 'a Spine clip per skill index');
  for (const id of ['skcom_charge_cost[3]', 'skchr_siege_2', 'skchr_siege_3']) assert.ok(t.template.skills[id] && t.template.skillsById[id] === id, id);
  assert.equal(t.template.chars.char_609_acguad.avatar.alts[0].urls[0], 'https://example.invalid/known.png', 'research 07 wins for an operator it lists');
  assert.equal(t.template.chars['bad id'], undefined);
  assert.deepEqual(Object.keys(t.template.modules), ['sol-x']);
  assert.match(t.template.modules['sol-x'].alts[0].urls[0], /arts\/ui\/uniequiptype\/sol-x\.png$/);
  assert.equal(t.template.prof.sub.pioneer.alts[0].rel, 'prof/sub/pioneer.png');
});

test('module type icons: one lower-case file per type, so the official \'dec-X\' (uniequip_003_aglina) and \'dec-x\' share one; --prune keeps a file whose name differs only in case', () => {
  const t = buildPlan({ assets07: {}, ops03: {}, enemies05: {}, maps05: {}, audio: indexAudio({}), modelsData: {}, moduleTypes: ['dec-X', 'dec-x', 'WAH-Y'] });
  const rel = (k) => t.template.modules[k].alts[0].rel;
  assert.deepEqual([rel('dec-X'), rel('dec-x'), rel('WAH-Y')], ['module/dec-x.png', 'module/dec-x.png', 'module/wah-y.png']);
  assert.match(t.template.modules['dec-X'].alts[0].urls[0], /uniequiptype\/dec-X\.png$/, 'the upstream name keeps its case first');
  const m = load('assets');
  assert.equal(m.modules['dec-X'], m.modules['dec-x']);
  const byCase = new Map();
  const walk = (v) => {
    if (typeof v === 'string' && v.startsWith('/assets/')) {
      const k = v.toLowerCase();
      assert.ok(!byCase.has(k) || byCase.get(k) === v, `${v} and ${byCase.get(k)} differ only in case: one file on Windows / macOS`);
      byCase.set(k, v);
    } else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  walk(m);
  assert.deepEqual(orphanFiles(['module/WAH-Y.png', 'module/old.png', 'local/x.png', 'char/a.png'], new Set(['module/wah-y.png', 'char/a.png'])), ['module/old.png']);
});

test('--add-only: parsed, refused with --prune / --force; its downloader keeps every existing file and records what it wrote', async () => {
  assert.equal(parseArgs(['--add-only']).addOnly, true);
  assert.equal(parseArgs([]).addOnly, false);
  assert.throws(() => parseArgs(['--add-only', '--prune']), /never deletes or rewrites/);
  assert.throws(() => parseArgs(['--add-only', '--force']), /never deletes or rewrites/);
  const dl = new Downloader({ root: join(ROOT, 'data'), ledgerPath: join(ROOT, '.cache', 'test-never-written.json'), keepExisting: true, force: true, log() {} });
  assert.equal(dl.force, false, '--force never applies');
  assert.equal(await dl.existingSize({ rel: 'chess.json', urls: [], kind: 'png', bytes: 1 }), readFileSync(join(ROOT, 'data', 'chess.json')).length, 'an existing file is kept whatever its size / kind');
  assert.equal(await dl.existingSize({ rel: 'no-such-file.png', urls: [], kind: 'png' }), -1);
  assert.deepEqual([...dl.written], []);
});

test('the committed data/assets.json lists every 自选 operator\'s avatar, portrait, Front Spine and skill icons, and a type icon per module (files on disk when public/assets is here)', () => {
  const m = load('assets');
  const disk = existsSync(join(ROOT, 'public', 'assets', 'char', 'avatar', 'char_003_kalts.png'));
  const onDisk = (u) => !disk || existsSync(join(ROOT, 'public', u));
  for (const id of BACKUPS.diy.ownedPool) {
    const c = m.chars[id];
    assert.ok(c && c.avatar && c.portrait && c.spine?.front?.skel, `${id}: art`);
    for (const u of [c.avatar, c.portrait, c.spine.front.skel, c.spine.front.atlas, ...c.spine.front.textures]) assert.ok(onDisk(u), `${id}: ${u} on disk`);
    assert.deepEqual(Object.keys(c.spine.front.anims.skills || {}).sort(), ['0', '1', '2'], `${id}: a clip per skill index`);
    for (const s of BACKUPS.units[id].forms['2/1/4/0'].skills) assert.ok(m.skills[m.skillsById[s.skillId]] || m.skills[s.iconId], `${id}: skill icon ${s.skillId}`);
  }
  for (const t of dataExtras(BACKUPS, CHESS).moduleTypes) assert.ok(m.modules[t] && onDisk(m.modules[t]), `module type icon ${t}`);
  assert.equal(m.stats.modules, Object.keys(m.modules).length);
});

test('an operator left out of 自选 (data/backups.json diy.excluded: the collab picks, 焰狐龙梓兰 MH05 among them) keeps no art in data/assets.json, so the full release zip (tools/package.mjs) never ships it', () => {
  const m = load('assets');
  const text = JSON.stringify(m);
  assert.ok(BACKUPS.diy.excluded.includes('char_1048_orchd2'), '焰狐龙梓兰 is excluded');
  for (const id of BACKUPS.diy.excluded) {
    const code = id.split('_').slice(2).join('_');
    assert.equal(m.chars[id], undefined, `${id}: chars`);
    assert.equal(m.audio.sfx.units[id], undefined, `${id}: unit sfx`);
    assert.equal(m.audio.voice?.[id], undefined, `${id}: voice`);
    assert.ok(!Object.keys(m.skills).some((k) => k.startsWith(`skchr_${code}_`)), `${id}: skill icons`);
    assert.ok(!text.includes(id), `${id}: no file of theirs`);
  }
  assert.equal(m.stats.chars, Object.keys(m.chars).length);
  assert.equal(m.stats.skills, Object.keys(m.skills).length);
});
