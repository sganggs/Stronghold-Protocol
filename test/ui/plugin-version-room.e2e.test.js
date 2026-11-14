// SP_E2E=1 node --test test/ui/plugin-version-room.e2e.test.js (run this file alone).
// A 规程 room with a gameplay plugin that declares 规程 (§37.102) gets into the match (§37.210). Before, the page waited
// for the plain 规程 set, which a room with gameplay plugins never loads (its content set is the plugins' set built on
// 规程), and the match stayed on 正在载入模拟数据… for ever.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, hasChrome, waitForFunctionLong } from '../e2e/client.mjs';
import { writePlugin } from '../helpers/pluginFixtures.js';
import { startServer } from '../../server/index.js';

const REG = 'act3autochess@V3_1';
const enabled = process.env.SP_E2E === '1' && hasChrome();

test('a 规程 co-op room with a 规程 gameplay plugin enters the match screen (§37.210)', { skip: !enabled, timeout: 240000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-plugin-version-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const pluginsDir = path.join(tmp, 'plugins');
  // a data plugin that changes nothing: what matters is that the room's set is a plugin set built on 规程
  writePlugin(path.join(pluginsDir, 'reg-rules'), {
    manifest: 2, name: { zh: '规程测试数据', en: 'Regulation test data' }, version: '1.0.0', app: '*', api: 1, class: 'content',
    scope: ['room'], permissions: ['data.patch'], data: ['p.json'], versions: [REG],
  }, { 'p.json': { patch: 1, ops: [] } });
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir, assetIndex: false,
    matchHost: { matchOptions: { timerScale: 0.1, combatSpeed: 16, botRehearsal: 0 } } });
  t.after(() => srv.close());
  const P = (await import('puppeteer-core')).default;
  const host = new Client(P, srv.url, 'host', { prefix: 'plugin-version', w: 1600, h: 900, lobbyVersion: REG });
  t.after(() => host.close());
  await host.open();
  await host.enter('凯尔希');
  await host.createCoop();
  assert.equal(await host.page.evaluate(() => globalThis.__SP__.store.get().room?.version), REG, 'the room plays 规程');
  await host.page.evaluate(() => globalThis.__SP__.net.request('room.setPlugins', { plugins: [{ id: 'reg-rules' }] }));
  await waitForFunctionLong(host.page, () => {
    const s = globalThis.__SP__.store.get();
    return s.room?.content?.vanilla === false && s.room.content.version === 'act3autochess@V3_1'
      && s.room.seats.filter((x) => x && !x.isBot).every((x) => x.content === 'ready');
  }, { timeout: 90000 });
  const set = await host.page.evaluate(() => globalThis.__SP_CONTENT__?.state?.() ?? null);
  await host.click('.room-bar__right button', '开始模拟');
  await host.waitFor((s) => !!s.phase, 'the first match frame', 60000);
  // the match screen itself: before §37.210 the page stayed on the loading screen (.gload) with the frames already there
  await host.page.waitForFunction(() => !!globalThis.__SP__.store.get().match.public && !document.querySelector('.gload'), { timeout: 60000 })
    .catch(async (e) => {
      const text = await host.page.evaluate(() => document.querySelector('.gload')?.textContent?.trim() ?? null);
      throw new Error(`still on the loading screen (${text}); content set ${JSON.stringify(set)}: ${e.message}`);
    });
  const shown = await host.page.evaluate(() => {
    const s = globalThis.__SP__.store.get();
    return { phase: s.match.public?.phase ?? null, screen: document.querySelector('.screen')?.className ?? null };
  });
  await host.shot('regulation-plugin-match');
  assert.ok(shown.phase, 'match frames');
  assert.doesNotMatch(String(shown.screen), /\bgload\b/);
  assert.deepEqual(host.problems.filter((p) => !/favicon|requestfailed: .*\/(audio|voice)\//.test(p)), [], 'no page errors');
});
