// Real version hosts and client data: natural shop rolls (only funds are granted through the test console).
// SP_E2E=1 node --test test/ui/version-equipment.e2e.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, hasChrome, problemsOf, sleep } from '../e2e/client.mjs';

const enabled = process.env.SP_E2E === '1' && hasChrome();
const request = (c, type, body = {}) => c.page.evaluate((type, body) => globalThis.__SP__.net.request(type, body), type, body);

for (const version of ['act1autochess', 'act1autochess@V1_1', 'act2autochess@V2_1']) {
  test(`${version}: the real client renders and buys naturally rolled equipment`, { skip: !enabled, timeout: 120_000 }, async () => {
    const { startServer } = await import('../../server/index.js');
    const saved = process.env.SP_TEST_MODE;
    process.env.SP_TEST_MODE = '1';
    let srv;
    let c;
    try {
      srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false,
        versions: { enabled: 'all' }, matchHost: { matchOptions: { botRehearsal: 0 } } });
      const P = (await import('puppeteer-core')).default;
      c = new Client(P, srv.url, 'equipment', { prefix: 'version-equipment' });
      await c.open('?render=fallback');
      await c.enter('Tester');
      await request(c, 'room.create', { mode: 'solo', difficulty: 'NORMAL', test: true, version, soloUnlimited: true });
      await c.page.waitForFunction((id) => globalThis.__SP__.data.get('config')?.version?.id === id
        && globalThis.__SP_CONTENT__?.state()?.status === 'ready', { timeout: 30000 }, version);
      await request(c, 'room.start');
      await c.waitFor(s => s.phase === 'INFO_CHECK', 'match information');
      await request(c, 'g.infoReady');
      await c.waitFor(s => s.phase === 'BAND_DRAFT', 'strategy draft');
      await request(c, 'g.band', { bandId: 'band_bldsk' });
      await c.waitFor(s => s.phase === 'PREP', 'test match preparation');
      await c.page.waitForSelector('.shopbar', { visible: true });
      await request(c, 'g.test', { cmd: 'funds', args: { amount: 1000 } });
      const firstLevel = version.startsWith('act1') ? 5 : 1;
      for (let level = 1; level <= 6; level++) {
        if (level > 1) {
          await request(c, 'g.levelUp');
          await c.waitFor(s => s.level === level, `level ${level} before refresh`);
          if (level === firstLevel) {
            await c.page.waitForSelector('.shopbar__item .scard--empty', { visible: true });
            assert.equal(await c.page.$$eval('.shopbar__cards .scard', es => es.length), 5, 'empty equipment is not an operator slot');
            assert.doesNotMatch(await c.page.$eval('.shopbar__item', e => e.textContent), /SOLD OUT|已购买/);
          }
        }
        await request(c, 'g.refresh');
        await c.waitFor(s => s.level === level, `level ${level}`);
        if (level < firstLevel) {
          assert.equal(await c.page.$('.shopbar__item button.scard--item'), null, 'no equipment before the official unlock');
          assert.doesNotMatch(await c.page.$eval('.shopbar__item', e => e.textContent), /SOLD OUT|已购买/);
          continue;
        }
        await c.page.waitForSelector('.shopbar__item button.scard--item', { visible: true });
        const offer = await c.page.evaluate(() => {
          const p = globalThis.__SP__.store.get().match.private;
          const slot = p.shop.slots.find(s => s?.kind === 'item' && !s.sold);
          return { id: slot.id, price: slot.price, funds: p.funds, name: globalThis.__SP__.data.lookup('items', slot.id).name };
        });
        assert.ok((await c.page.$eval('.shopbar__item', e => e.textContent)).includes(offer.name), 'the version item name is rendered');
        await c.click('.shopbar__item button.scard--item');
        await c.page.waitForSelector('.shopbar__item .is-armed');
        await sleep(100);
        await c.click('.shopbar__item button.scard--item');
        await c.page.waitForFunction((id) => globalThis.__SP__.store.get().match.private.shop.slots
          .some(s => s?.kind === 'item' && s.id === id && s.sold), { timeout: 5000 }, offer.id);
        assert.equal((await c.st()).funds, offer.funds - offer.price);
        assert.ok(await c.page.evaluate(() => globalThis.__SP__.store.get().match.private.hand.some(p => p?.kind === 'item')));
        assert.match(await c.page.$eval('.shopbar__item', e => e.textContent), /已购买/);
      }
      assert.deepEqual(problemsOf([c]), []);
    } finally {
      await c?.close();
      await srv?.close();
      if (saved === undefined) delete process.env.SP_TEST_MODE;
      else process.env.SP_TEST_MODE = saved;
    }
  });
}
