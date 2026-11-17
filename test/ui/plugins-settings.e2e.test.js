// SP_E2E=1, run this file alone. Settings selected in the actual room panel reach the second browser's content data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, OUT, hasChrome } from '../e2e/client.mjs';
import { writePlugin } from '../helpers/pluginFixtures.js';
const enabled = process.env.SP_E2E === '1' && hasChrome();

test('room settings form changes both clients content compositions', { skip: !enabled, timeout: 180000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-settings-e2e-'));
  writePlugin(path.join(tmp, 'settings-test'), { manifest: 2, name: 'Settings test', version: '1.0.0', app: '*', api: 1,
    class: 'content', scope: ['room'], permissions: ['data.patch'], data: ['p.json'],
    settings: { defense: { type: 'number', min: 0, max: 1, step: 0.1, default: 0.1, label: 'DEF' } } },
  { 'p.json': { patch: 1, ops: [['bb','base_def'],['buffs',0,'bb','base_def']].map(p => ({ op:'set', file:'bonds', id:'deputShip', path:p, value:{ $setting:'defense' } })) } });
  const { startServer } = await import('../../server/index.js');
  const srv = await startServer({ port:0, host:'127.0.0.1', quiet:true, pluginsDir:tmp, assetIndex:false });
  const P = (await import('puppeteer-core')).default;
  const host = new Client(P, srv.url, 'host', { prefix: 'settings', w:1600, h:1000 });
  const guest = new Client(P, srv.url, 'guest', { prefix: 'settings', w:1600, h:1000 });
  try {
    await host.open(); await host.enter('凯尔希'); const { code } = await host.createCoop();
    await guest.open(); await guest.enter('阿米娅'); await guest.click('.mode-card', '同盟模拟'); await guest.click('.join-row input'); await guest.page.keyboard.type(code); await guest.click('.join-row button', '加入同盟');
    await host.click('[data-testid="plugin-tag"]');
    await host.page.waitForSelector('[data-plugin="settings-test"] [role="switch"]');
    await host.page.click('[data-plugin="settings-test"] [role="switch"]');
    await host.page.waitForSelector('[data-plugin="settings-test"] [data-setting="defense"]');
    const selector = '[data-plugin="settings-test"] [data-setting="defense"]';
    await host.page.click(selector, { count: 3 }); await host.page.type(selector, '0.4');
    await host.page.click('[data-plugin="settings-test"] [data-testid="plugin-settings"] button[type="submit"]');
    // Each browser checks and installs its composition independently; guest readiness does not order the host's load
    // (the default server now enables every version, §35.23.11). Wait for both before asserting the shared setting.
    await Promise.all([host, guest].map(c => c.page.waitForFunction(() => globalThis.__SP__?.data.get('bonds')?.deputShip?.bb?.base_def === 0.4, { timeout:30000 })));
    assert.equal(await host.page.evaluate(() => globalThis.__SP__.data.get('bonds').deputShip.bb.base_def), 0.4);
    fs.mkdirSync(OUT, { recursive:true });
    await host.page.screenshot({ path:path.join(OUT,'plugins-settings-host.png'), fullPage:true });
    await guest.click('[data-testid="plugin-tag"]');
    await guest.page.waitForSelector(selector);
    assert.equal(await guest.page.$eval(selector, e => e.disabled), true);
  } finally { await host.close(); await guest.close(); await srv.close(); fs.rmSync(tmp, { recursive:true, force:true }); }
});
