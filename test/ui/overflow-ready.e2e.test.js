// Controlled HUD snapshots use the real Regulation content; server disposal/stock tests are in equip-hand.test.js.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';

const firefox = process.env.SP_BROWSER === 'firefox';
const executable = firefox ? process.env.FIREFOX_PATH : process.env.CHROME_PATH;
const enabled = process.env.SP_E2E === '1' && executable && existsSync(executable);
const out = process.env.SP_OVERFLOW_SCREENSHOTS || 'test/e2e/out/overflow-ready';

describe('Regulation Ready with overflow', { skip: !enabled && 'set SP_E2E and browser path' }, () => {
  let srv, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ host: '127.0.0.1', port: 0, quiet: true, clientBuild: false,
      workers: 0, roomWorkers: 0, matchWorkers: 0, userFile: ':memory:', assetIndex: false, serverConfigFile: false, announcementsFile: null });
    browser = await puppeteer.launch({ browser: firefox ? 'firefox' : 'chrome', executablePath: executable, headless: true,
      args: firefox ? [] : ['--no-sandbox', '--no-proxy-server'],
      extraPrefsFirefox: { 'dom.ipc.processCount': 2, 'dom.ipc.processPrelaunch.enabled': false, 'fission.autostart': false } });
    if (firefox) await browser.newPage();
    mkdirSync(out, { recursive: true });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  async function pageFor(width, height, regulation = true) {
    const page = await browser.newPage(); page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    await page.setViewport({ width, height });
    await page.goto(`${srv.url}/dev/game-mock.html?shot=1&render=fallback&phase=PREP`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!globalThis.__MOCK__);
    await page.evaluate(async regulation => {
      await document.fonts.ready; await import('/sim/content/index.js');
      const { data } = await import('/js/data.js');
      const { net } = await import('/js/net.js');
      if (regulation) {
        const names = ['config', 'stages', 'bonds', 'effects', 'chess', 'items'];
        const values = Object.fromEntries(await Promise.all(names.map(async name =>
          [name, await (await fetch(`/data/versions/act3autochess-v3_1/${name}.json`)).json()])));
        data.setContent({ id: 'act3autochess@V3_1', values });
      }
      const original = net.request;
      globalThis.__readyCalls = [];
      net.request = (type, body) => {
        if (type === 'g.ready') globalThis.__readyCalls.push(body.ready);
        return original(type, body);
      };
      const { __MOCK__: mock } = globalThis;
      mock.mutate(s => {
        s.priv.funds = 0; s.priv.ready = false; s.priv.personalChoice = null; s.priv.command = null;
        s.priv.commandDraft = null; s.priv.board = []; s.priv.hand.fill(null); s.priv.shop.slots = [];
        s.priv.temp = Array(5).fill(null); s.priv.stashCount = regulation ? 2 : 0;
        if (!regulation) s.priv.temp[4] = { uid: 99001, kind: 'item', id: data.list('items')[0].id };
      });
    }, regulation);
    await page.waitForSelector('.readybtn');
    return { page, errors };
  }
  async function answer(page, text) {
    const buttons = await page.$$('.modal__actions button');
    for (const button of buttons) if ((await button.evaluate(el => el.textContent)).includes(text)) {
      await button.click(); return;
    }
    assert.fail(`missing dialog action ${text}`);
  }
  const calls = page => page.evaluate(() => globalThis.__readyCalls);
  const pressReady = async page => {
    const label = await page.$eval('.readybtn kbd', el => el.textContent.trim());
    await page.keyboard.press(label === 'Space' ? (firefox ? ' ' : 'Space') : label.toLowerCase());
  };
  const settleDialog = page => page.waitForFunction(() => {
    const modal = document.querySelector('.ready-ask')?.closest('.modal'), box = modal?.querySelector('.modal__box');
    return modal && box && Number(getComputedStyle(modal).opacity) > .99 && Number(getComputedStyle(box).opacity) > .99;
  });

  for (const [width, height] of [[1600, 900], [640, 360]]) {
    test(`button and shortcut confirm overflow at ${width}px; cancel preserves it`, async () => {
      const { page, errors } = await pageFor(width, height);
      try {
        assert.equal(await page.$eval('.readybtn', el => el.disabled), false);
        assert.match(await page.$eval('[data-testid="ready-why"]', el => el.textContent), /暂存 2 个单位/);
        await page.screenshot({ path: `${out}/${width}-available.png` });
        await page.click('.readybtn'); await page.waitForSelector('.ready-ask');
        assert.match(await page.$eval('.ready-ask', el => el.textContent), /进入战斗后自动销毁.*召唤物仍会在下个休整期出现/);
        assert.deepEqual(await calls(page), []);
        await settleDialog(page);
        await page.screenshot({ path: `${out}/${width}-confirm.png` });
        await answer(page, '继续整备'); await page.waitForSelector('.ready-ask', { hidden: true });
        assert.deepEqual(await calls(page), []);
        assert.equal(await page.evaluate(() => globalThis.__MOCK__.S().priv.stashCount), 2);
        // Shortcut and button share the same confirmation. Blur the dialog's restored focus first.
        await page.evaluate(() => document.activeElement?.blur());
        await pressReady(page); await page.waitForSelector('.ready-ask');
        await answer(page, '准备就绪');
        await page.waitForFunction(() => globalThis.__MOCK__.S().priv.ready);
        assert.deepEqual(await calls(page), [true]);
        assert.equal(await page.evaluate(() => globalThis.__MOCK__.S().priv.stashCount), 2, 'Ready itself does not clear inventory');
        await page.click('.readybtn'); await page.waitForFunction(() => !globalThis.__MOCK__.S().priv.ready);
        assert.deepEqual(await calls(page), [true, false]);
        assert.equal(await page.$('.ready-ask'), null);
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
  }

  test('overflow shares funds/command dialog, cannot be muted, and closes when prep ends', async () => {
    const { page, errors } = await pageFor(1600, 900);
    try {
      await page.evaluate(() => globalThis.__MOCK__.mutate(s => {
        s.priv.funds = 4;
        s.priv.command = { type: 'ACTIVE', targetType: 'CHESS', usable: true, targets: [1] };
      }));
      await page.click('.readybtn'); await page.waitForSelector('[data-testid="ready-ask-mute"]');
      const text = await page.$eval('.ready-ask', el => el.textContent);
      assert.match(text, /自动销毁/); assert.match(text, /4 资金/); assert.match(text, /指令/);
      await page.click('[data-testid="ready-ask-mute"]'); await answer(page, '继续整备');
      await page.click('.readybtn'); await page.waitForSelector('.ready-ask');
      assert.equal(await page.$('[data-testid="ready-ask-mute"]'), null);
      assert.match(await page.$eval('.ready-ask', el => el.textContent), /自动销毁/);
      await settleDialog(page);
      await page.screenshot({ path: `${out}/combined-confirm.png` });
      await page.evaluate(() => { globalThis.__MOCK__.S().pub.phase = 'SETTLE'; globalThis.__MOCK__.pushPublic(); });
      await page.waitForSelector('.ready-ask', { hidden: true });
      assert.deepEqual(await calls(page), []);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('permanent equipment does not ask; covenant overflow still blocks Ready', async () => {
    const { page, errors } = await pageFor(1600, 900);
    try {
      await page.evaluate(async () => {
        const { data } = await import('/js/data.js');
        const it = data.list('items').find(i => i.itemType === 'EQUIP');
        globalThis.__MOCK__.mutate(s => { s.priv.stashCount = 0; s.priv.temp[4] = { uid: 99002, kind: 'item', id: it.id }; });
      });
      await page.click('.readybtn'); await page.waitForFunction(() => globalThis.__MOCK__.S().priv.ready);
      assert.equal(await page.$('.ready-ask'), null); assert.deepEqual(await calls(page), [true]);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
    const old = await pageFor(1600, 900, false);
    try {
      assert.equal(await old.page.$eval('.readybtn', el => el.disabled), true);
      await pressReady(old.page);
      assert.deepEqual(await calls(old.page), []); assert.equal(await old.page.$('.ready-ask'), null);
      assert.deepEqual(old.errors, []);
    } finally { await old.page.close(); }
  });
});
