// Act3 Terra import: TL manifest dict (exact zh→en) + JS season block for chess kits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
// The importer writes under .cache/ (Terra's README terms: the dictionary is never committed), so a fresh checkout
// has neither file: those tests skip until `node tools/i18n/import-terra-act3-en.mjs` has run.
const PATHS = join(ROOT, '.cache/terra-tl-en/terra-act3-en-paths.json');
const DICT = join(ROOT, '.cache/terra-tl-en/terra-act3-en.json');
const EN = join(ROOT, 'data/versions/act3autochess-v3_1/i18n/en.json');
const haveImport = existsSync(PATHS) && existsSync(DICT);
const skipImport = haveImport ? false : 'run node tools/i18n/import-terra-act3-en.mjs (writes .cache/terra-tl-en/)';

test('terra act3 meta credits the README terms; Talulah is not Mudrock/Sharp', { skip: skipImport }, () => {
  const pathsDoc = JSON.parse(readFileSync(PATHS, 'utf8'));
  const dict = JSON.parse(readFileSync(DICT, 'utf8'));
  assert.match(pathsDoc._meta.source, /files\.terra-archive\.net\/assets\/tl\/en\/README\.md$/);
  assert.match(pathsDoc._meta.manifest, /files\.terra-archive\.net.*manifest\.json/);
  assert.equal(pathsDoc._meta.sourceRead, '2026-11-21');
  assert.equal(pathsDoc._meta.officialGlobalWithoutX, true);
  assert.match(pathsDoc._meta.credit, /Terra Archive.*partly machine-translated/);
  // default import is --no-kits until Terra confirms the JS bundle terms
  assert.match(pathsDoc._meta.kitsNote, /--no-kits|\[ASSUMED\]/);
  assert.equal(dict._meta.hash, pathsDoc._meta.hash);

  const { leaves } = pathsDoc;
  // Talulah may come from the TL dict path walk and/or reuse at build time; without --kits the JS season block is skipped
  if (pathsDoc._meta.jsFallback) {
    const names = leaves.filter((l) => l.file === 'chess' && l.id === 'chess_char_6_16_a' && l.path.join('.') === 'name');
    assert.ok(names.length >= 1);
    assert.equal(names[names.length - 1].en, 'Talulah');
    assert.ok(!names.some((l) => l.en === 'Sharp' || l.en === 'Mudrock'));
  } else {
    assert.equal(pathsDoc._meta.kitsBundle, null);
    assert.equal(pathsDoc._meta.chessHits, 0);
  }

  const garDesc = leaves.filter((l) => l.file === 'garrisons' && l.path.join('.') === 'desc');
  assert.ok(garDesc.length > 200, `expected many garrison desc leaves, got ${garDesc.length}`);
  const ursus = garDesc.find((l) => l.id === 'garrison_23_a');
  assert.ok(ursus?.en.includes('[Ursus]'), ursus?.en);
});

test('built act3 en.json localizes Talulah, garrison_23_a, and Amiya strategy', () => {
  assert.ok(existsSync(EN), 'run node tools/build-version-i18n.mjs');
  const en = JSON.parse(readFileSync(EN, 'utf8'));
  assert.equal(en.files.chess.chess_char_6_16_a.name, 'Talulah');
  assert.ok(en.files.garrisons.garrison_23_a.desc.includes('[Ursus]'));
  assert.equal(en.files.bands.band_amiya.name, 'Amiya');
  assert.equal(en.files.bands.band_amiya.effectName, 'Wills As One');
  assert.ok(en.files.bands.band_amiya.desc.includes('Passive'));
  assert.equal(en.files.factions.types.REBORN.name, 'Tactical Training/Revival');
});

test('act3 Current Effect (effectDescRaw) comes from Terra TL dictionary', () => {
  assert.ok(existsSync(EN), 'run node tools/build-version-i18n.mjs');
  if (haveImport) {
    const { leaves } = JSON.parse(readFileSync(PATHS, 'utf8'));
    const sargonFx = leaves.filter((l) => l.file === 'bonds' && l.id === 'sargonShip' && l.path.join('.') === 'effectDescRaw');
    assert.ok(sargonFx.length >= 1, 'sargonShip effectDescRaw path');
    const enFx = sargonFx[sargonFx.length - 1].en;
    assert.ok(/quicksand/i.test(enFx), enFx.slice(0, 120));
    assert.ok(enFx.includes('{0:'), 'layer placeholders from TL');
    assert.ok(!/[\u4e00-\u9fff]/.test(enFx), 'no CJK in Terra effect EN');
  }

  const en = JSON.parse(readFileSync(EN, 'utf8'));
  const raw = en.files.bonds.sargonShip.effectDescRaw;
  assert.ok(/quicksand/i.test(raw), raw.slice(0, 160));
  assert.ok(raw.includes('{0:'), raw);
  assert.ok(!/[\u4e00-\u9fff]/.test(raw));
  assert.ok(/quicksand/i.test(en.files.effects.bondeffect_sargon_2.descRaw));
});

test('act3 command skills (replace-command draft) are English from TL', () => {
  assert.ok(existsSync(EN), 'run node tools/build-version-i18n.mjs');
  const en = JSON.parse(readFileSync(EN, 'utf8'));
  const price = en.files.bands.band_price.skills[0].descRaw;
  assert.match(price, /Insider Supply/);
  assert.match(price, /Click to use/);
  assert.ok(!/消耗|内部货源/.test(price), price);
  assert.ok(!/\(Cost \d+\)/.test(price), 'skill row omits Cost (HUD shows it)');
  const jengaActive = en.files.bands.band_jenga.skills[1].descRaw;
  assert.match(jengaActive, /Clause Amendment/);
  assert.match(jengaActive, /Drag to use/);
  assert.ok(!/解锁|条文修正/.test(jengaActive), jengaActive);
  assert.ok(en.files.effects.aceffect_band_73.descRaw.includes('Insider Supply'));
  assert.ok(en.files.effects.aceffect_band_89.descRaw.includes('Clause Amendment'));
});

test('default-season English (data/i18n/en.json) is unchanged by the act3 version overlay', () => {
  assert.ok(existsSync(EN), 'run node tools/build-version-i18n.mjs');
  const basePath = join(ROOT, 'data/i18n/en.json');
  const base = JSON.parse(readFileSync(basePath, 'utf8'));
  const act3 = JSON.parse(readFileSync(EN, 'utf8'));
  assert.equal(base.lang || base.meta?.lang || 'en', 'en');
  // Shared overlay keeps official Act2 Sargon (Narantuya note); act3 overlay is the quicksand rewrite.
  assert.match(base.files.bonds.sargonShip.effectDescRaw, /Narantuya|ATK/);
  assert.match(act3.files.bonds.sargonShip.effectDescRaw, /quicksand/i);
  assert.ok(!/quicksand/i.test(base.files.bonds.sargonShip.effectDescRaw));
  assert.equal(act3.meta.communityTranslated, true);
  assert.match(act3.meta.credit, /Terra Archive.*partly machine-translated/);
  assert.match(act3.meta.source.readme, /README\.md$/);
  assert.equal(act3.meta.source.readmeRead, '2026-11-21');
  assert.equal(act3.meta.source.officialGlobalWithoutX, true);
  assert.ok('kitsBundle' in act3.meta.source);
  assert.ok('kitsNote' in act3.meta.source);
});
