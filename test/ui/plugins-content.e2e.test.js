// Real-server browser E2E — a room's content set (DESIGN §32.6 P1c; opt-in, ~1 min):
//   SP_E2E=1 node --test test/ui/plugins-content.e2e.test.js   (SP_E2E_VERBOSE=1: the server's log too)
//
// A server with a data plugin of its own (bond-def: a bond value patched — no file of the game) and two browsers: the
// host switches it on in the room's 插件 panel → both pages download the room's content set, check every file's bytes and
// the manifest against the room's cs (the seats read 插件内容就绪; the tag 非官方) and show its data (the patched bond in
// data.get('bonds')); the guest readies, the host starts → the match runs in the set's match host worker (the briefing's
// and the HUD's unofficial marks) — the host's page is the authority of its own battle: it simulates on the set's data and
// its b.result (naming the room's cs) is accepted by the server (the worker's field: resultSource 'client'). The guest's
// page was made to claim another content (__SP_CONTENT__.forgeHeldCs, a tampered cs): it is no authority — it sends no
// b.result — and the server takes its field over at the deadline (resultSource 'server'). No console / page errors, no
// failed request but the game's own art when this checkout has none.
//
// Screenshots: test/e2e/out/plugins-content-*.png.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, ROOT, hasChrome, sleep, problemsOf } from '../e2e/client.mjs';
import { writePlugin } from '../helpers/pluginFixtures.js';

const ENABLED = process.env.SP_E2E === '1' && hasChrome();
const bondPatch = (value) => ({ patch: 1, ops: [['bb', 'base_def'], ['buffs', 0, 'bb', 'base_def']].map((p) => ({ op: 'set', file: 'bonds', id: 'deputShip', path: p, value })) });

describe('a room\'s content set in the browser (P1c)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome)' }, () => {
  test('host switches a data plugin on → the guest loads and checks it → a battle on it, the result accepted; a tampered cs is no authority', { timeout: 5 * 60 * 1000 }, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-plugins-content-e2e-'));
    writePlugin(path.join(tmp, 'bond-def'), { manifest: 2, name: { zh: '盟约数值', en: 'Bond numbers' }, version: '1.0.0', app: '*', api: 1, class: 'content', scope: ['room'],
      authors: ['e2e'], permissions: ['data.patch'], data: ['p.json'] }, { 'p.json': bondPatch(0.3) });
    const { startServer } = await import('../../server/index.js');
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: process.env.SP_E2E_VERBOSE !== '1', pluginsDir: tmp,
      matchHost: { matchOptions: { timerScale: 0.1, combatSpeed: 16, botRehearsal: 0 } } });
    for (const t0 = Date.now(); Date.now() - t0 < 20000;) {
      const h = await fetch(`${srv.url}/healthz?traffic=1`).then((r) => r.json(), () => null);
      if (!h?.assetHashes || h.assetHashes.ready) break;
      await sleep(150);
    }
    const P = (await import('puppeteer-core')).default;
    const host = new Client(P, srv.url, 'host', { prefix: 'plugins-content', w: 1600, h: 900 });
    const guest = new Client(P, srv.url, 'guest', { prefix: 'plugins-content', w: 1600, h: 900 });
    try {
      await host.open();
      await host.enter('凯尔希');
      const { code } = await host.createCoop();
      await guest.open();
      await guest.enter('阿米娅');
      await guest.click('.mode-card', '同盟模拟');
      await guest.click('.join-row input');
      await guest.page.keyboard.type(code);
      await guest.click('.join-row button', '加入同盟');
      await guest.page.waitForSelector('.room-screen', { timeout: 15000 });
      const vanillaBond = await guest.page.evaluate(async () => (await globalThis.__SP__.data.load('bonds'))?.deputShip?.bb?.base_def);

      // the host switches the data plugin on in the 插件 panel
      await host.click('[data-testid="plugin-tag"]');
      await host.page.waitForSelector('[data-testid="plugin-panel"] [data-plugin="bond-def"]', { timeout: 10000 });
      assert.match(await host.page.$eval('[data-plugin="bond-def"]', (e) => e.textContent), /改变玩法/);
      await host.click('[data-plugin="bond-def"] button[role="switch"]');
      await host.page.waitForFunction(() => document.querySelector('[data-plugin="bond-def"] button[role="switch"]')?.getAttribute('aria-checked') === 'true', { timeout: 10000 });
      await host.page.waitForFunction(() => /通过校验/.test(document.querySelector('[data-testid="content-state"]')?.textContent || ''), { timeout: 30000 });
      await host.shot('panel');
      await host.click('.modal__actions button', '完成');

      // both pages: the set downloaded and checked, its data shown, every seat 插件内容就绪, the tag 非官方
      const room = await guest.page.evaluate(() => globalThis.__SP__.store.get().room);
      assert.equal(room.content.vanilla, false);
      const cs = room.content.cs;
      for (const c of [host, guest]) {
        await c.page.waitForFunction((want) => { const s = globalThis.__SP_CONTENT__?.state(); return s && s.status === 'ready' && s.held === want; }, { timeout: 30000 }, cs);
        await c.page.waitForFunction(() => [...document.querySelectorAll('[data-testid="seat-content"]')].length === 2
          && [...document.querySelectorAll('[data-testid="seat-content"]')].every((e) => /插件内容就绪/.test(e.textContent)), { timeout: 15000 });
        assert.equal(await c.page.evaluate(() => globalThis.__SP__.data.get('bonds')?.deputShip?.bb?.base_def), 0.3, `${c.label}: the room's data`);
        assert.match(await c.page.$eval('[data-testid="plugin-tag"]', (e) => e.textContent), /非官方/);
      }
      assert.notEqual(vanillaBond, 0.3);
      await guest.shot('room-guest');

      // the guest's page claims another content than the one it checked: its runner must refuse the authority
      await guest.page.evaluate(() => globalThis.__SP_CONTENT__.forgeHeldCs('0'.repeat(64)));
      await guest.click('.room-bar__right button', '准备就绪');
      await host.page.waitForFunction(() => !document.querySelector('.room-bar__right button[disabled]'), { timeout: 15000 });
      await host.click('.room-bar__right button', '开始模拟');
      await host.page.waitForSelector('.brief [data-testid="unofficial-mark"]', { timeout: 30000 });
      await host.shot('briefing');
      const match = srv.lobby.getRoom(code).match;
      assert.equal(match.hosted, true, 'the match runs in the content set\'s match host');

      // round 1: the host's battle — authority on the set's data, b.result with the room's cs, accepted
      const hostId = await host.page.evaluate(() => globalThis.__SP__.store.get().me.playerId);
      const guestId = await guest.page.evaluate(() => globalThis.__SP__.store.get().me.playerId);
      await host.waitFor((s) => s.phase === 'COMBAT', 'the first battle', 120000);
      await host.page.waitForSelector('.gtop [data-testid="unofficial-mark"]', { timeout: 15000 });
      await host.shot('hud');
      // every finished field seen, by battle: the match clears its fields at the settlement, COMBAT_END (1.5 s, here
      // scaled to 0.15 s) after the last one finished — a poll may well miss the moment both are done
      const finished = new Map();
      let last = null;
      const firstDone = (id) => [...finished.values()].find((f) => f.kind === 'normal' && f.players.includes(id));
      for (const t0 = Date.now(); Date.now() - t0 < 90000 && !(firstDone(hostId) && firstDone(guestId)); await sleep(100)) {
        const d = await match.diag();
        last = d;
        for (const f of d?.fields || []) if (f.done && !finished.has(f.battleId)) finished.set(f.battleId, f);
      }
      // P3b: all gameplay sets use a real Worker; the page holds only cached wire state.
      assert.equal(await host.page.evaluate(() => [...globalThis.__SP_RUNNER__._entries.values()].some(e =>
        e.host?.remote && e.host.worker instanceof Worker && !e.battle.step && !e.battle.data)), true);
      const mine = firstDone(hostId);
      const theirs = firstDone(guestId);
      assert.ok(mine && theirs, `both battles settled: ${JSON.stringify([...finished.values()])} (the match's diag: ${JSON.stringify(last)?.slice(0, 600)})`);
      assert.equal(mine.resultSource, 'client', 'the host\'s result was accepted');
      assert.equal(theirs.resultSource, 'server', 'the guest\'s field was taken over by the server');
      const d = await match.diag();
      assert.equal(d.verifyStats.rejected, 0, 'no result refused: the host named the room\'s content');
      assert.ok(d.verifyStats.takeovers >= 1 || theirs.mode === 'server', `the takeover: ${JSON.stringify(d.verifyStats)}`);
      const hostEntry = await host.page.evaluate((battleId) => { const e = globalThis.__SP_RUNNER__._entries.get(battleId); return e ? { authoritative: e.authoritative, delivery: e.delivery, cs: e.spec.cs } : null; }, mine.battleId);
      assert.deepEqual(hostEntry, { authoritative: true, delivery: 'delivered', cs });
      const guestEntry = await guest.page.evaluate((battleId) => { const e = globalThis.__SP_RUNNER__._entries.get(battleId); return e ? { authoritative: e.authoritative, delivery: e.delivery } : null; }, theirs.battleId);
      assert.ok(!guestEntry || (guestEntry.authoritative === false && guestEntry.delivery == null), `the guest's page was no authority: ${JSON.stringify(guestEntry)}`);

      // no errors; a failed request only for the game's own art when this checkout has none
      const art = fs.existsSync(path.join(ROOT, 'public/assets'));
      const problems = problemsOf([host, guest]).filter((p) => art || !/\/assets\//.test(p));
      assert.deepEqual(problems, []);
    } finally {
      await host.close();
      await guest.close();
      await srv.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
