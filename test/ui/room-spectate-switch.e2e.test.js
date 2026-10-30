// SP_E2E=1 CHROME_PATH=… [FIREFOX_PATH=…]: real UI / server role changes, no injected game state or requests.
// Screenshots: test/e2e/out/room-spectate-{chrome,firefox}-*.png (desktop and short landscape).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { Client, startRealServer, problemsOf, sleep } from '../e2e/client.mjs';

const engines = [
  ['chrome', process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  ['firefox', process.env.FIREFOX_PATH || ''],
];

const waitRole = (client, spectator) => client.page.waitForFunction((spectator) => {
  const s = globalThis.__SP__.store.get();
  return spectator ? s.room?.spectators.some((p) => p.playerId === s.me.playerId)
    : s.room?.seats.some((p) => p?.playerId === s.me.playerId);
}, { timeout: 20000 }, spectator);
const waitHost = (client) => client.page.waitForFunction(() => {
  const s = globalThis.__SP__.store.get(); return s.room?.hostId === s.me.playerId;
}, { timeout: 20000 });

for (const [engine, executablePath] of engines) test(`${engine}: a waiting-room player switches to spectator and back`, {
  skip: process.env.SP_E2E !== '1' || !existsSync(executablePath), timeout: 150000,
}, async () => {
  const srv = await startRealServer();
  const puppeteer = (await import('puppeteer-core')).default;
  const errorStacks = [];
  const launcher = { launch: async (opts) => {
    const browser = await puppeteer.launch({ ...opts, executablePath,
      ...(engine === 'firefox' ? { browser: 'firefox', args: [] } : {}) });
    for (const page of await browser.pages()) page.on('pageerror', (e) => errorStacks.push(e.stack || String(e)));
    return browser;
  } };
  const host = new Client(launcher, srv.base, 'host', { prefix: `room-spectate-${engine}`, w: 1280, h: 720 });
  const guest = new Client(launcher, srv.base, 'guest', { prefix: `room-spectate-${engine}`, w: 1280, h: 720 });
  try {
    await host.open();
    await host.enter('凯尔希');
    const room = await host.createCoop();
    assert.equal(await host.page.$eval('[data-testid="room-spectate"]', (b) => b.disabled), true, 'last human stays seated');
    await guest.open(`?room=${room.code}`);
    await guest.enter('阿米娅');
    await waitRole(guest, false);
    await host.page.waitForFunction(() => !document.querySelector('[data-testid="room-spectate"]')?.disabled);
    await guest.click('.rs-go', '准备就绪');
    await guest.page.waitForSelector('.seat.is-me.is-ready');
    await sleep(800); // Let the existing ready animation finish before taking the reference screenshot.
    await host.shot('before');

    // Cancel really leaves the host in its player seat.
    await host.click('[data-testid="room-spectate"]');
    await host.page.waitForSelector('.modal__actions', { visible: true });
    assert.match(await host.page.$eval('.modal__body', (el) => el.textContent), /创建者身份将移交/);
    await host.click('.modal__actions button', '取消');
    await host.page.waitForSelector('.modal', { hidden: true });
    assert.equal(await host.page.evaluate(() => {
      const s = globalThis.__SP__.store.get(); return s.room.hostId === s.me.playerId;
    }), true);

    await host.click('[data-testid="room-spectate"]');
    await host.page.waitForSelector('.modal__actions', { visible: true });
    await host.shot('confirm');
    await host.click('.modal__actions button', '转为观战');
    await waitRole(host, true);
    await waitHost(guest);
    assert.match(await guest.page.$eval('.seat.is-me .rseat__said', (el) => el.textContent), /待命中/);
    assert.equal(await host.page.$('[data-testid="room-spectate"]'), null);
    await host.shot('watching');

    await host.click('.specbar button', '入座');
    await waitRole(host, false);
    assert.equal(await host.page.evaluate(() => {
      const s = globalThis.__SP__.store.get(); return s.room.seats.find((p) => p?.playerId === s.me.playerId).ready;
    }), false);
    await waitHost(guest);

    // Both roles expose reachable, non-overlapping controls on a short landscape viewport.
    for (const client of [host, guest]) {
      await client.page.setViewport({ width: 844, height: 390 });
      await sleep(500);
      const geometry = await client.page.$eval('[data-testid="room-spectate"]', (el) => {
        const r = el.getBoundingClientRect(), foot = document.querySelector('.rs-foot').getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, footTop: foot.top,
          width: innerWidth, height: innerHeight, scroll: document.documentElement.scrollHeight };
      });
      assert.ok(geometry.left >= 0 && geometry.right <= geometry.width, JSON.stringify(geometry));
      assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.footTop + 1 && geometry.bottom <= geometry.height, JSON.stringify(geometry));
      assert.ok(geometry.scroll <= geometry.height + 1, JSON.stringify(geometry));
      await client.shot('mobile');
    }
    await host.click('[data-testid="room-spectate"]');
    await host.click('.modal__actions button', '转为观战');
    await waitRole(host, true);
    await host.shot('mobile-watching');
    const problems = problemsOf([host, guest]).filter((p) => !/\/(assets|media|fonts)\//.test(p));
    assert.deepEqual(problems, [], [...problems, ...errorStacks].join('\n'));
  } finally {
    await Promise.all([host.close(), guest.close()]);
    await srv.stop();
  }
});
