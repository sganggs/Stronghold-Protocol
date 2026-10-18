// test/ui/mystic-energy.test.js — 设置「显示弹药与能量数量」 reads the retired 「秘术师能量」 key once
// (PR #636 by @zasx77771, GitHub #633, DESIGN §32.14.28, merged in §34.3). A profile with only `mysticEnergy: true`
// migrates on; junk does not. The energy row in the renderer: test/render/hud-readouts.test.js.
// Run: node --test test/ui/mystic-energy.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeSettings, DEFAULT_SETTINGS } from '../../public/js/ui/gameLogic.js';
import { buildDiagnostics } from '../../public/js/diag.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const HINT = '弹药类技能开启时，在弹药条下方显示剩余弹药 / 总弹药数（如 13/14）；秘术师的血条下方显示储存的攻击能量 / 上限（如 2/3）。官方界面没有这些数字。';

test('a saved mysticEnergy true migrates the merged switch on, and does not come back as its own key', () => {
  assert.equal(DEFAULT_SETTINGS.ammoEnergyCount, false);
  assert.equal('mysticEnergy' in DEFAULT_SETTINGS, false);
  assert.equal(sanitizeSettings(null).ammoEnergyCount, false);
  assert.equal(sanitizeSettings({ bgm: 0.4 }).ammoEnergyCount, false, 'a profile saved before 0.3.0');
  assert.equal(sanitizeSettings({ mysticEnergy: true }).ammoEnergyCount, true, 'only the old energy switch was on');
  assert.equal(sanitizeSettings({ mysticEnergy: true, ammoCount: false }).ammoEnergyCount, true);
  assert.equal(sanitizeSettings({ mysticEnergy: false, ammoCount: false }).ammoEnergyCount, false);
  for (const bad of ['true', 1, 0, null, {}, []]) assert.equal(sanitizeSettings({ mysticEnergy: bad }).ammoEnergyCount, false, JSON.stringify(bad));
  // [ASSUMED] the new boolean wins over the old energy key
  assert.equal(sanitizeSettings({ ammoEnergyCount: false, mysticEnergy: true }).ammoEnergyCount, false);
  const migrated = sanitizeSettings({ mysticEnergy: true, ammoCount: true });
  assert.equal(migrated.ammoEnergyCount, true);
  assert.equal('mysticEnergy' in migrated, false);
  assert.equal('ammoCount' in migrated, false);
  assert.equal(sanitizeSettings(migrated).ammoEnergyCount, true);
  assert.equal('mysticEnergy' in sanitizeSettings(migrated), false);
});

test('the dialog hint still names the stored-energy example, and the units read the merged switch', () => {
  const src = read('public/js/ui/settings.js');
  assert.ok(src.includes(`t('${HINT}')`));
  assert.equal(src.includes('s.mysticEnergy'), false);
  assert.equal(src.includes('s.ammoCount'), false);
  assert.match(read('public/js/render/units.js'), /this\._updateEnergy\(showBars && !this\.isEnemy && !!this\.energy && this\.ctx\.settings\?\.ammoEnergyCount === true, /);
  assert.equal(/s\.mysticEnergy/.test(read('public/js/render/app.js')), false);
});

test('the diagnostics no longer have a separate mystic-energy flag', () => {
  const state = { me: {}, room: null, match: { public: null, battle: null }, connection: { status: 'online' } };
  const line = (settings) => buildDiagnostics({ state, env: {}, settings }).split('\n').find((l) => l.startsWith('settings:'));
  assert.equal(line({ quality: 'high', damageNumbers: true, ammoEnergyCount: true }), 'settings: quality high | damage numbers | ammo and energy counts');
  assert.equal(line({ quality: 'high', damageNumbers: true, mysticEnergy: true }), 'settings: quality high | damage numbers');
});
