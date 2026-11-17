// A guest keeps the loadout mounted while the host changes the room's data plugins through the real UI.
// SP_E2E=1 CHROME_PATH=<chrome> node --test test/ui/loadout-content.e2e.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, ROOT, OUT, hasChrome, problemsOf } from '../e2e/client.mjs';
import { writePlugin } from '../helpers/pluginFixtures.js';

const ENABLED = process.env.SP_E2E === '1' && hasChrome();
const IDS = ['chess_char_3_01_a', 'chess_char_3_04_a']; // visible NORMAL chess, on both roster tabs
// Generous waits: on a loaded machine (a parallel browser sweep, a busy CI runner) one step once took ~50 s and failed
// under puppeteer's 30 s default, while the test passes in ~7 s alone (the merge review of 2026-10-23).
const WAIT = 90000;

test('mounted rosters follow the room content without a language switch', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome)', timeout: 420000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-loadout-content-'));
  // Derive the data-only manifest from the shipped content template. No art, scripts or personal data.
  const { operators: _operators, dsl: _dsl, ...template } = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/_template/content/plugin.json')));
  for (const [i, id] of ['roster-alpha', 'roster-beta'].entries()) {
    writePlugin(path.join(tmp, id), { ...template, id, name: id, permissions: ['data.patch'], data: ['data/name.json'] }, {
      'data/name.json': { patch: 1, ops: [{ op: 'set', file: 'chess', id: IDS[i], path: ['name'], value: id }] },
    });
  }
  const { startServer } = await import('../../server/index.js');
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir: tmp });
  const P = (await import('puppeteer-core')).default;
  const host = new Client(P, srv.url, 'host', { prefix: 'loadout-content', w: 1600, h: 900 });
  const guest = new Client(P, srv.url, 'guest', { prefix: 'loadout-content', w: 1600, h: 900 });
  try {
    await host.open(); host.page.setDefaultTimeout(WAIT); await host.enter('Roster host');
    const { code } = await host.createCoop(); // the 0.3.2 lobby (§35.18): 同盟模拟 → 创建同盟 enters the room at once
    await guest.open(); guest.page.setDefaultTimeout(WAIT); await guest.enter('Roster guest');
    await guest.click('.mode-card', '同盟模拟'); await guest.click('.join-row input'); await guest.page.keyboard.type(code);
    await guest.click('.join-row button', '加入同盟');
    await guest.page.waitForSelector('.room-screen');
    await host.click('[data-testid="plugin-tag"]');
    await host.page.waitForSelector('[data-plugin="roster-alpha"]');

    const snapshot = () => guest.page.evaluate((ids) => {
      const d = globalThis.__SP__.data;
      return { locale: d.locale(), content: d.contentId(),
        expected: ids.map(id => ({ id, name: d.lookup('chess', id)?.name })),
        statuses: ['chess', 'bonds', 'assets', 'local', 'backups'].map(n => d.status(n)),
      };
    }, IDS);
    const open = async () => {
      // The overlay unmounts before its effect restores the room's visibility.
      await guest.page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="loadout-open"]');
        if (!el || getComputedStyle(el).visibility !== 'visible') return false;
        const { x, y, width, height } = el.getBoundingClientRect();
        return width > 0 && height > 0 && el.contains(document.elementFromPoint(x + width / 2, y + height / 2));
      }, { timeout: WAIT });
      await guest.click('[data-testid="loadout-open"]', null, { timeout: WAIT });
      await guest.click('[data-tab="loadout"]', null, { timeout: WAIT });
      await guest.page.waitForSelector('.lo-card');
      await guest.click('.lo-chip--t3[aria-pressed="false"]', null, { optional: true, timeout: 500 });
      return guest.page.$('.lo');
    };
    const close = async (overlay) => {
      await guest.click('.lo-back', null, { timeout: WAIT });
      await guest.page.waitForSelector('.lo', { hidden: true });
      await overlay.dispose();
    };
    const toggle = async (id) => {
      const old = (await snapshot()).content;
      await host.click(`[data-plugin="${id}"] button[role="switch"]`, null, { timeout: WAIT });
      await guest.page.waitForFunction((old) => {
        const d = globalThis.__SP__.data, c = globalThis.__SP_CONTENT__.state();
        const r = globalThis.__SP__.store.get().room;
        return r.content.vanilla ? d.contentId() === null && old !== null
          : c.status === 'ready' && d.contentId() === r.content.cs && d.contentId() !== old;
      }, { timeout: WAIT }, old);
      await guest.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    const verify = async (label, overlay, before) => {
      const after = await snapshot();
      assert.equal(after.locale, before.locale, 'the language did not change');
      assert.notEqual(after.content, before.content, 'a different checked content set was applied');
      assert.deepEqual(after.statuses, before.statuses, 'readiness did not change');
      assert.equal(await overlay.evaluate(el => el === document.querySelector('.lo')), true, 'the overlay stayed mounted');
      // Capture both tabs before asserting, so one failure cannot hide the other stale roster.
      const shown = {};
      for (const tab of ['loadout', 'ownership']) {
        await guest.click(`[data-tab="${tab}"]`, null, { timeout: WAIT });
        const card = tab === 'loadout' ? '.lo-card' : '.own-card';
        const name = tab === 'loadout' ? '.lo-card__name' : '.own-card__name';
        shown[tab] = await guest.page.evaluate((ids, card, name) => ids.map(id => ({ id,
          name: document.querySelector(`${card}[data-chess="${id}"] ${name}`)?.textContent,
        })), IDS, card, name);
        await guest.shot(`${label}-${tab}`);
      }
      t.diagnostic(JSON.stringify({ label, before, after, shown }));
      assert.deepEqual(shown, { loadout: after.expected, ownership: after.expected }, `${label}: both tabs read the current roster`);
    };

    let overlay = await open();
    let before = await snapshot();
    await toggle('roster-alpha');
    await t.test('vanilla → content', () => verify('enable', overlay, before));
    await close(overlay);

    overlay = await open(); before = await snapshot();
    await toggle('roster-beta');
    await t.test('content → another content set', () => verify('replace', overlay, before));
    await close(overlay);

    await toggle('roster-beta'); // mount afresh on alpha, then remove the last plugin
    overlay = await open(); before = await snapshot();
    await toggle('roster-alpha');
    await t.test('content → vanilla', () => verify('disable', overlay, before));
    await close(overlay);

    const art = fs.existsSync(path.join(ROOT, 'public/assets'));
    const problems = problemsOf([host, guest]);
    fs.writeFileSync(path.join(OUT, 'loadout-content-browser-problems.json'), JSON.stringify(problems, null, 2));
    await t.test('browser reports no non-art problems', () => {
      assert.deepEqual(problems.filter(p => art || !/\/assets\//.test(p)), []);
    });
  } finally {
    await host.close(); await guest.close(); await srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
