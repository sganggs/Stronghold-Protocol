// Interface-plugin browser test (DESIGN §32.8). Not part of the default run.
//   SP_E2E=1 node --test test/ui/ui-plugins.e2e.test.js
//
// Copies plugins/_template/ui into a temp id `damage-meter`, turns it on in this browser
// (`sp.pref.ui-plugins`), reaches 休整期, and checks the widget is in hud.right, totals a battle
// event, and that a match intent posted from the frame is rejected. Do not run it from the
// sandbox; the integration pass runs it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, ROOT, hasChrome, startRealServer } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome();

describe('an interface plugin in the prep slot', { skip: !ENABLED }, () => {
  test('the example widget mounts, totals a damage event, and a match intent is rejected', { timeout: 4 * 60 * 1000 }, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-ui-e2e-'));
    fs.cpSync(path.join(ROOT, 'plugins/_template/ui'), path.join(tmp, 'damage-meter'), { recursive: true });
    const srv = await startRealServer({ fast: { timerScale: 1, combatSpeed: 2, startRound: 1, autoPlace: true }, pluginsDir: tmp });
    const P = (await import('puppeteer-core')).default;
    const c = new Client(P, srv.base, 'solo', { prefix: 'ui-plugin', w: 1600, h: 900 });
    try {
      await c.open();
      await c.page.evaluate(() => localStorage.setItem('sp.pref.ui-plugins', JSON.stringify(['damage-meter'])));
      await c.page.reload({ waitUntil: 'domcontentloaded' });
      await c.page.waitForSelector('.screen', { timeout: 20000 });
      await c.enter('凯尔希');
      await c.click('.mode-card', '独立模拟');
      await c.click('.diff-card', '标准模拟');
      await c.click('.create-box button', '开始独立模拟');
      await c.waitFor((s) => !!s.room, 'solo room');
      if (!(await c.st()).phase) await c.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
      await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
      await c.click('.brief__foot .btn--primary', '准备就绪');
      await c.waitFor((s) => s.phase === 'BAND_DRAFT', 'band draft', 30000);
      await c.click('.dband', null, { nth: 1 });
      await c.click('.draft-detail__btns .btn--primary', '确认选择');
      await c.waitFor((s) => s.phase === 'PREP', 'prep', 60000);
      await c.page.waitForSelector('[data-ui-slot="hud.right"] iframe', { timeout: 20000 });
      const frame = c.page.frames().find((f) => /\/p\/damage-meter\/[0-9a-f]{8}\/ui\/index\.html$/.test(f.url()));
      assert.ok(frame, 'the sandboxed page is the plugin entry');
      await frame.waitForSelector('#n', { timeout: 10000 });
      // Engine shape from server/sim/attack/health.js: ['dmg', unitId, amount, kind]. The widget adds index 2, not the unit id.
      await c.page.evaluate(() => globalThis.__SP_UI_PLUGINS__.debugBattle([['dmg', 7, 4, 'phys']]));
      await frame.waitForFunction(() => document.getElementById('n') && document.getElementById('n').textContent === '4', { timeout: 10000 });
      await frame.evaluate(() => parent.postMessage({ v: 1, t: 'g.buy', slot: 0 }, '*'));
      await frame.waitForFunction(() => document.documentElement.getAttribute('data-rejected') === 'intent', { timeout: 10000 });
      const rejected = await c.page.evaluate(() => globalThis.__SP_UI_PLUGINS__.rejected.slice());
      assert.ok(rejected.includes('intent'));
    } finally {
      await c.close();
      await srv.stop();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
