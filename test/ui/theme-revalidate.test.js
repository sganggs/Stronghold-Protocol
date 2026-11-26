// test/ui/theme-revalidate.test.js — the selected theme is checked again when the theme settings open, not only at
// boot: the settings mount calls bootUiThemes() every time (ui/themeSettings.js), and a pack that was valid at boot
// can be gone by then (the served group no longer listed). The fallback is the built-in terminal with the 'broken'
// notice, and a later valid selection clears that notice. A loaded record must not hide a removed group.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bindThemeSettings, bootUiThemes, selectTheme, themePack, themeStatus } from '../../public/js/uiTheme.js';
import { stubFetch } from '../helpers/fetchStub.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const MANIFEST = '/data/local-assets.json';
const THEME_URL = '/assets/local/themes/ac_n_iron/theme.json';
const THEME_DOC = JSON.stringify({
  spTheme: 1, id: 'ac_n_iron', name: '乌萨斯齐心团', author: 'test', version: '1.0.0', description: 'd',
});

/** Responses for the theme library's fetches, serving `ac_n_iron` only while `served`. */
function fakeFetch(state) {
  return async (url) => {
    if (String(url) === MANIFEST) {
      const groups = state.served
        ? { 'themes/ac_n_iron': { 'theme.json': { path: THEME_URL } } }
        : {};
      return { ok: true, json: async () => ({ version: 1, groups }) };
    }
    if (String(url) === THEME_URL) return { ok: true, text: async () => THEME_DOC };
    return { ok: false, status: 404 };
  };
}

test('bootUiThemes re-checks the served group every time the theme settings open, and a valid selection clears broken', async () => {
  const state = { served: true };
  const stub = stubFetch(fakeFetch(state));
  let settings = { uiTheme: 'ac_n_iron', voice: 0.8, muted: false };
  const patches = [];
  bindThemeSettings({
    get: () => settings,
    set: (patch) => { patches.push(patch); settings = { ...settings, ...patch }; },
  });
  try {
    // 1. the boot loads the served official theme and keeps it selected
    await bootUiThemes();
    assert.equal(settings.uiTheme, 'ac_n_iron', 'a stored official theme served by this server boots selected');
    assert.ok(themePack('ac_n_iron'), 'the pack is loaded in memory');
    // (this node harness has no IndexedDB: the boot reports the session-only storage warning, not a theme failure)
    assert.equal(themeStatus().notice, 'session', 'the boot reports no theme damage');

    // 2. the theme settings open after the server stopped serving the group: the LOADED pack must not hide that
    state.served = false;
    await bootUiThemes();
    assert.equal(settings.uiTheme, '', 'a group no longer served falls back to the built-in terminal');
    assert.deepEqual(patches.at(-1), { uiTheme: '' });
    assert.equal(themeStatus().notice, 'broken', 'the settings page shows the broken notice');

    // 3. selecting a valid theme (the built-in terminal) clears the broken notice
    selectTheme('');
    assert.equal(themeStatus().notice, null, 'a valid selection clears the broken notice');
  } finally {
    stub.restore();
  }
});

// Wiring guards: the Preact mount effect and the module's boot-once flag have no Node-level seam (this suite has
// no DOM renderer), so the two checks below read the source. The re-validation *behaviour* they wire up is the
// test above (bootUiThemes called twice: served → kept, gone → fallback + broken notice, select → cleared).
test('the theme settings mount calls bootUiThemes and shows its broken notice (wiring guard)', () => {
  const section = read('public/js/ui/themeSettings.js');
  assert.match(section, /bootUiThemes\(\)\.then\(\(\) => \{/, 'ThemeSection mounts through bootUiThemes');
  assert.match(section, /if \(status\.notice === 'broken'\) setNotice\('broken'\);/,
    'a re-validation that fell back paints the broken notice');
  assert.match(section, /setNotice\(\(n\) => \(n === 'broken' \? null : n\)\);/,
    'a successful selection hides the broken banner (the session warning stays)');
  assert.match(section, /notice === 'broken' \? html`<p class="set-keys__note is-warn" role="status">\$\{t\('这个主题已损坏，已回到卫戍协议终端。'\)\}/,
    'the notice text is the existing broken-theme copy');
});

test('bootUiThemes keeps booting once and only re-validates on later calls (wiring guard)', () => {
  const source = read('public/js/uiTheme.js');
  assert.match(source, /async function revalidateActiveTheme\(\)/, 'the re-check has its own function');
  assert.match(source, /if \(!themeBootStarted\) \{/, 'the boot itself still runs once');
  assert.match(source, /await revalidateActiveTheme\(\);/, 'a later call re-validates the selected theme');
  assert.match(source, /if \(themeBootError\) return;/, 'a failed boot is not re-validated over');
  assert.match(source, /prepareTheme\(id, \{ recheck: true \}\)/, 'the served group is re-read before the loaded record is trusted');
  assert.match(source, /if \(prepared\.ok\) \{ applyUiTheme\(id\); clearBrokenNotice\(\); return; \}/, 'a pack that still resolves stays selected');
});
