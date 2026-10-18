// test/ui/ammo-count.test.js — 设置「显示弹药与能量数量」 (0.3.1, §34.3): one switch for the old 「弹药数量」
// (PR #552 by @IceCodeNew, 0.2.6, DESIGN §31.9) and 「秘术师能量」. Off by default. A saved `ammoCount: true` migrates
// on. The dialog, every language pack, the field view and the diagnostics line. What the renderer draws:
// test/render/hud-readouts.test.js. Migration from `mysticEnergy` alone: test/ui/mystic-energy.test.js.
// Run: node --test test/ui/ammo-count.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeSettings, DEFAULT_SETTINGS } from '../../public/js/ui/gameLogic.js';
import { buildDiagnostics } from '../../public/js/diag.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const LABEL = '显示弹药与能量数量';
const HINT = '弹药类技能开启时，在弹药条下方显示剩余弹药 / 总弹药数（如 13/14）；秘术师的血条下方显示储存的攻击能量 / 上限（如 2/3）。官方界面没有这些数字。';

test('ammoEnergyCount is off by default; a saved ammoCount true migrates on; the old key is not written back', () => {
  assert.equal(DEFAULT_SETTINGS.ammoEnergyCount, false);
  assert.equal(sanitizeSettings(null).ammoEnergyCount, false);
  assert.equal(sanitizeSettings({ bgm: 0.4, officialDamageNumbers: true }).ammoEnergyCount, false, 'a profile saved before either count');
  assert.equal(sanitizeSettings({ ammoCount: true }).ammoEnergyCount, true, 'only the old ammo switch was on');
  assert.equal(sanitizeSettings({ ammoCount: false }).ammoEnergyCount, false);
  assert.equal(sanitizeSettings({ ammoCount: true, mysticEnergy: true }).ammoEnergyCount, true);
  assert.equal(sanitizeSettings({ ammoCount: false, mysticEnergy: false }).ammoEnergyCount, false);
  for (const bad of ['true', 1, 0, null, {}, []]) assert.equal(sanitizeSettings({ ammoCount: bad }).ammoEnergyCount, false, JSON.stringify(bad));
  // [ASSUMED] a stored boolean wins, so turning the merged switch off is not undone by a leftover old key
  assert.equal(sanitizeSettings({ ammoEnergyCount: false, ammoCount: true }).ammoEnergyCount, false);
  assert.equal(sanitizeSettings({ ammoEnergyCount: true, ammoCount: false }).ammoEnergyCount, true);
  const migrated = sanitizeSettings({ ammoCount: true, damageNumbers: false, officialDamageNumbers: true });
  assert.equal(migrated.ammoEnergyCount, true);
  assert.equal('ammoCount' in migrated, false);
  assert.equal('mysticEnergy' in migrated, false);
  const again = sanitizeSettings(migrated);
  assert.equal(again.ammoEnergyCount, true);
  assert.equal('ammoCount' in again, false, 'sanitising the result does not resurrect the old key');
  assert.deepEqual(migrated, { ...sanitizeSettings({ damageNumbers: false, officialDamageNumbers: true }), ammoEnergyCount: true });
});

test('the settings dialog has one merged toggle and a hint with both example counts, in every language pack', () => {
  const src = read('public/js/ui/settings.js');
  assert.match(src, /<\$\{Toggle\} label=\$\{t\('显示弹药与能量数量'\)\} micro="AMMO & ENERGY" value=\$\{s\.ammoEnergyCount\} onChange=\$\{\(v\) => updateSettings\(\{ ammoEnergyCount: v \}\)\} \/>/);
  assert.ok(src.includes(`t('${HINT}')`), 'the hint under it');
  assert.ok(src.indexOf("t('官方伤害数字')") < src.indexOf(`t('${LABEL}')`), 'beside the damage-number options');
  assert.equal(src.includes("t('弹药数量')"), false, 'the old ammo toggle is gone');
  assert.equal(src.includes("t('秘术师能量')"), false, 'the old energy toggle is gone');
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const pack = JSON.parse(read(`public/i18n/${lang}.json`));
    for (const id of [LABEL, HINT]) assert.ok(typeof pack[id] === 'string' && pack[id].length > 0, `${lang}: ${id}`);
    assert.match(pack[HINT], /13\/14/, `${lang}: the ammo example`);
    assert.match(pack[HINT], /2\/3/, `${lang}: the energy example`);
  }
});

test('the field view and the unit bars read the merged setting, not the old keys', () => {
  const app = read('public/js/render/app.js');
  assert.match(app, /const settings = \{ damageNumbers: true, officialDamageNumbers: false, ammoEnergyCount: false, quality: 'high', officialFx: 'auto', \.\.\.\(opts\.settings \|\| \{\}\) \};/);
  assert.match(app, /if \(typeof s\.ammoEnergyCount === 'boolean'\) settings\.ammoEnergyCount = s\.ammoEnergyCount;/);
  assert.equal(/ammoCount|mysticEnergy/.test(app), false);
  const units = read('public/js/render/units.js');
  assert.match(units, /this\._updateAmmoCount\(showSp && !!ammo && this\.ctx\.settings\?\.ammoEnergyCount === true, x0 \+ bw \/ 2, rowsTop, s\)/);
  assert.equal(/settings\?\.ammoCount|settings\?\.mysticEnergy/.test(units), false);
  // the simplified board draws no ammo bar (its SP bar is the tuple's SP), so it has nothing to count under
  assert.doesNotMatch(read('public/js/ui/fallbackField.js'), /ammo/);
});

test('the diagnostics name the merged option when it is on', () => {
  const state = { me: {}, room: null, match: { public: null, battle: null }, connection: { status: 'online' } };
  const line = (settings) => buildDiagnostics({ state, env: {}, settings }).split('\n').find((l) => l.startsWith('settings:'));
  assert.equal(line({ quality: 'high', damageNumbers: true, ammoEnergyCount: true }), 'settings: quality high | damage numbers | ammo and energy counts');
  assert.equal(line({ quality: 'high', damageNumbers: true, ammoEnergyCount: false }), 'settings: quality high | damage numbers');
  assert.equal(line({ quality: 'high', damageNumbers: true, ammoCount: true }), 'settings: quality high | damage numbers', 'a raw old key is not a reader');
});
