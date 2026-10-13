// test/ui/ammo-count.test.js — 设置「弹药数量」 (PR #552 by @IceCodeNew, ported in 0.2.6, DESIGN §31.9): the remaining ammo
// count under an ammo skill's bar is not part of the official HUD, so it is an option, off by default (the maintainer's
// decision of 2026-10-13, like 「官方伤害数字」). Settings normalisation, the dialog's toggle and its hint in every language
// pack, the field view's live setting, the diagnostics line. What the renderer draws: test/render/hud-readouts.test.js.
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
const LABEL = '弹药数量';
const HINT = '弹药类技能开启时，在弹药条下方显示剩余弹药 / 总弹药数（如 13/14）。官方界面没有这个数字。';

test('ammoCount is stored with the other settings: off by default and for a profile saved before it, a boolean kept, junk off', () => {
  assert.equal(DEFAULT_SETTINGS.ammoCount, false);
  assert.equal(sanitizeSettings(null).ammoCount, false);
  assert.equal(sanitizeSettings({ bgm: 0.4, officialDamageNumbers: true }).ammoCount, false, 'a profile saved before 0.2.6');
  assert.equal(sanitizeSettings({ ammoCount: true }).ammoCount, true);
  assert.equal(sanitizeSettings({ ammoCount: false }).ammoCount, false);
  for (const bad of ['true', 1, 0, null, {}, []]) assert.equal(sanitizeSettings({ ammoCount: bad }).ammoCount, false, JSON.stringify(bad));
  // independent of the damage-number switches
  assert.deepEqual(sanitizeSettings({ ammoCount: true, damageNumbers: false, officialDamageNumbers: true }), { ...sanitizeSettings({ damageNumbers: false, officialDamageNumbers: true }), ammoCount: true });
});

test('the settings dialog has the toggle and a hint that the official interface has no such number, in every language pack', () => {
  const src = read('public/js/ui/settings.js');
  assert.match(src, /<\$\{Toggle\} label=\$\{t\('弹药数量'\)\} micro="AMMO COUNT" value=\$\{s\.ammoCount\} onChange=\$\{\(v\) => updateSettings\(\{ ammoCount: v \}\)\} \/>/);
  assert.ok(src.includes(`t('${HINT}')`), 'the hint under it');
  assert.ok(src.indexOf("t('官方伤害数字')") < src.indexOf(`t('${LABEL}')`), 'beside the damage-number options');
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const pack = JSON.parse(read(`public/i18n/${lang}.json`));
    for (const id of [LABEL, HINT]) assert.ok(typeof pack[id] === 'string' && pack[id].length > 0, `${lang}: ${id}`);
    assert.match(pack[HINT], /13\/14/, `${lang}: the example count`);
  }
});

test('the field view takes the setting at creation and live (setSettings); the units read it from their shared settings', () => {
  const app = read('public/js/render/app.js');
  assert.match(app, /const settings = \{ damageNumbers: true, officialDamageNumbers: false, ammoCount: false, quality: 'high', \.\.\.\(opts\.settings \|\| \{\}\) \};/);
  assert.match(app, /if \(typeof s\.ammoCount === 'boolean'\) settings\.ammoCount = s\.ammoCount;/);
  const units = read('public/js/render/units.js');
  assert.match(units, /this\._updateAmmoCount\(showSp && !!ammo && this\.ctx\.settings\?\.ammoCount === true, x0 \+ bw \/ 2, rowsTop, s\)/);
  // the simplified board draws no ammo bar (its SP bar is the tuple's SP), so it has nothing to count under
  assert.doesNotMatch(read('public/js/ui/fallbackField.js'), /ammo/);
});

test('the diagnostics name the option when it is on', () => {
  const state = { me: {}, room: null, match: { public: null, battle: null }, connection: { status: 'online' } };
  const line = (settings) => buildDiagnostics({ state, env: {}, settings }).split('\n').find((l) => l.startsWith('settings:'));
  assert.equal(line({ quality: 'high', damageNumbers: true, ammoCount: true }), 'settings: quality high | damage numbers | ammo count');
  assert.equal(line({ quality: 'high', damageNumbers: true, ammoCount: false }), 'settings: quality high | damage numbers');
});
