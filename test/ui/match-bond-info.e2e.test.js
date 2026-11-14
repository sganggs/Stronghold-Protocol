// #915: inspect a banned bond directly, including nested preparation dialogs and watched players.
// SP_E2E=1; isolated local server and background browsers, without production or user profiles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';

for (const [engine, executablePath] of [
  ['chrome', process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  ['firefox', process.env.FIREFOX_PATH || ''],
]) test(`${engine}: match-info bond details preserve bans, parent dialogs and watched ownership`, {
  skip: process.env.SP_E2E !== '1' || !executablePath || !existsSync(executablePath), timeout: 90000,
}, async () => {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, workers: 0 });
  const out = process.env.SP_E2E_OUT || fileURLToPath(new URL('../e2e/out/match-bond-info/', import.meta.url));
  mkdirSync(out, { recursive: true });
  let browser;
  try {
    browser = await puppeteer.launch({ browser: engine, executablePath, headless: true,
      args: engine === 'chrome' ? ['--no-sandbox', '--mute-audio', '--no-proxy-server'] : [] });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1366, height: 768 });
    await page.goto(`${server.url}/dev/game-mock.html?render=fallback&shot=1&phase=PREP`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__MOCK__ && window.__SP_VIEW__?.kind === 'fallback');
    const expected = await page.evaluate(async () => {
      const { data } = await import('/js/data.js');
      const bond = data.lookup('bonds', 'arcaneShip');
      const banned = bond.visibleMembers.find(id => data.lookup('chess', id));
      window.__MOCK__.mutate(s => {
        s.pub.drawnDisabledBonds = ['arcaneShip']; s.pub.disabledBonds = ['arcaneShip']; s.pub.bannedChess = [banned];
      });
      return { name: bond.name, bannedId: banned, bannedName: data.lookup('chess', banned).name };
    });
    const card = '.match-bond-dialog .bpop';
    const chip = '.ibond[data-bond="arcaneShip"]';
    const showCard = async selector => {
      await page.locator(selector).click();
      await page.waitForSelector(card);
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.match-bond-modal')).opacity) > .99);
      assert.equal(await page.$eval(`${card} .bpop__name`, e => e.textContent), expected.name);
      assert.equal(await page.$eval(card, e => e.getAttribute('aria-modal')), 'true');
      assert.ok((await page.$$eval(`${card} .bpop__member.is-banned`, es => es.map(e => e.textContent))).some(t => t.includes(expected.bannedName)));
    };
    const checkSize = async label => {
      const rect = await page.$eval(card, e => {
        const r = e.getBoundingClientRect();
        const close = e.querySelector('.bpop__close').getBoundingClientRect();
        const hit = document.elementFromPoint(close.x + close.width / 2, close.y + close.height / 2);
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom,
          overflow: e.scrollWidth - e.clientWidth, closeVisible: !!hit?.closest('.bpop__close'), width: innerWidth, height: innerHeight };
      });
      assert.ok(rect.left >= 0 && rect.top >= 0 && rect.right <= rect.width + 1 && rect.bottom <= rect.height + 1, JSON.stringify(rect));
      assert.ok(rect.overflow <= 1 && rect.closeVisible, JSON.stringify(rect));
      await page.screenshot({ path: path.join(out, `${engine}-${label}.png`) });
    };
    await page.click('[data-testid="check-player"]');
    await showCard(chip);
    await checkSize('game-desktop');
    await page.keyboard.press('Tab');
    assert.ok(await page.$eval('.match-bond-dialog', e => e.contains(document.activeElement)), 'Tab stays inside the top dialog');
    await page.keyboard.press('Escape'); await page.waitForSelector(card, { hidden: true });
    assert.ok(await page.$('.edrawer'), 'Escape preserves the underlying match information');
    assert.equal(await page.$eval(chip, e => e === document.activeElement), true, 'focus returns to the bond chip');
    await showCard(chip);
    // The card is a full-screen modal, so a coordinate click lands on the mask. Dispatch on the chip.
    // pointerdown used to clear the card; the following click then opened it again. A frame in between
    // is when that clear commits, so the click must be what closes it.
    await page.evaluate((selector) => {
      document.querySelector(selector).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    }, chip);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.ok(await page.$(card), 'pointerdown on the chip leaves the card open');
    await page.evaluate((selector) => { document.querySelector(selector).click(); }, chip);
    await page.waitForSelector(card, { hidden: true });

    for (const size of [{ width: 844, height: 390 }, { width: 390, height: 844 }]) {
      await page.setViewport(size); await showCard(chip); await checkSize(`game-${size.width}`);
      await page.click(`${card} .bpop__close`); await page.waitForSelector(card, { hidden: true });
    }
    await page.setViewport({ width: 1366, height: 768 }); await showCard(chip);
    await page.click(`${card} button.bpop__member`); await page.waitForSelector('.dpanel');
    assert.equal(await page.$('.match-bond-modal, .edrawer'), null, 'member details are not hidden behind match information');
    await page.keyboard.press('Escape');

    const mate = await page.evaluate(() => {
      const mock = window.__MOCK__, p = mock.S().pub.players[2];
      p.bonds = [{ bondId: 'arcaneShip', layers: 43, count: 2, tier: 1, active: true }]; mock.pushPublic();
      return { id: p.playerId, name: p.name };
    });
    await (await page.$$('.team__btn'))[2].click();
    await page.waitForFunction(id => window.__MOCK__.store.get().match.field?.fieldId === `n:${id}`, {}, mate.id);
    await page.click('[data-testid="check-player"]'); await showCard(chip);
    assert.equal(await page.$eval(card, e => e.dataset.owner), mate.name);
    assert.match(await page.$eval(`${card} .bpop__facts`, e => e.textContent), /43/);
    await page.screenshot({ path: path.join(out, `${engine}-watched.png`) });
    await page.keyboard.press('Escape'); await page.waitForSelector(card, { hidden: true });

    // A mode activation ban stays distinct from the random incomplete lineup above.
    await page.evaluate(() => window.__MOCK__.mutate(s => { s.pub.modeId = 'mode_multi_funny'; }));
    await showCard(chip);
    assert.ok(await page.$(`${card} .bpop__off`), 'the mode ban keeps its explanation');
    assert.equal(await page.$(`${card} .bpop__sec--now`), null, 'a mode-disabled bond promises no current effect');
    await page.screenshot({ path: path.join(out, `${engine}-mode-disabled.png`) });
    await page.keyboard.press('Escape'); await page.waitForSelector(card, { hidden: true });

    // The same bond entry is available before combat. No dead member buttons in these reference-only cards.
    for (const phase of ['INFO_CHECK', 'BAND_DRAFT']) {
      await page.evaluate(({ phase, bannedId }) => {
        window.__MOCK__.setPhase(phase);
        window.__MOCK__.mutate(s => {
          s.pub.drawnDisabledBonds = ['arcaneShip']; s.pub.disabledBonds = ['arcaneShip']; s.pub.bannedChess = [bannedId];
        });
      }, { phase, bannedId: expected.bannedId });
      if (phase === 'BAND_DRAFT') await page.locator('[data-testid="match-info-open"]').click();
      const disc = '.brief-bond[data-bond="arcaneShip"] button.bond';
      await showCard(disc); await checkSize(phase.toLowerCase());
      assert.equal(await page.$(`${card} button.bpop__member`), null);
      await page.keyboard.press('Escape'); await page.waitForSelector(card, { hidden: true });
      if (phase === 'BAND_DRAFT') {
        assert.ok(await page.$('.minfo-dlg'), 'the draft information stays open');
        await showCard(disc);
        await page.mouse.click(3, 3); await page.waitForSelector(card, { hidden: true });
        assert.ok(await page.$('.minfo-dlg'), 'a backdrop click does not reach the parent dialog');
        await showCard(disc);
        await page.evaluate(() => window.__MOCK__.setPhase('PREP'));
        await page.waitForSelector('.match-bond-modal, .minfo-dlg', { hidden: true });
      }
    }
    // 规程: a core disc of the two groups opens the card before the pick (effects stay, the covenant off note does not).
    // After the pick, a drawn-out core says its operators cannot appear unless a lit core also holds them; a mode-off
    // add-on is not listed.
    await page.evaluate(() => {
      window.__MOCK__.setPhase('INFO_CHECK');
      window.__MOCK__.mutate(s => {
        s.pub.modeId = 'mode_single_normal';
        s.pub.bondDraw = 'regulation';
        s.pub.bondChoice = { groups: [['yanShip', 'victoriaShip'], ['sargonShip', 'kjeragShip']], picked: null };
        s.pub.drawnDisabledBonds = [];
        s.pub.disabledBonds = [];
        s.pub.bannedChess = [];
      });
    });
    await page.waitForSelector('[data-testid="bond-groups"]');
    const openDisc = async (selector) => {
      await page.locator(selector).click();
      await page.waitForSelector(card);
      return page.$eval(card, e => e.textContent);
    };
    const before = await openDisc('.brief-bond[data-bond="yanShip"] button.bond');
    assert.match(before, /当前效果/);
    assert.doesNotMatch(before, /本模式下该盟约不会激活|仍可能因所属的其他盟约出现|该核心盟约的干员无法出现/);
    await page.keyboard.press('Escape'); await page.waitForSelector(card, { hidden: true });
    await page.evaluate(() => {
      window.__MOCK__.mutate(s => {
        s.pub.bondChoice = { groups: [['yanShip', 'victoriaShip'], ['sargonShip', 'kjeragShip']], picked: 0 };
        s.pub.drawnDisabledBonds = ['sargonShip'];
        s.pub.disabledBonds = ['sargonShip'];
        s.pub.modeId = 'mode_single_funny';
      });
    });
    await page.waitForSelector('.brief-bond[data-bond="sargonShip"].is-off button.bond');
    const drawn = await openDisc('.brief-bond[data-bond="sargonShip"] button.bond');
    assert.match(drawn, /该核心盟约的干员无法出现，同属其他亮着的盟约（核心或附加）的除外/);
    assert.doesNotMatch(drawn, /本模式下该盟约不会激活|仍可能因所属的其他盟约出现/);
    await page.keyboard.press('Escape'); await page.waitForSelector(card, { hidden: true });
    // the 规程 briefing lists only the bonds the mode loads (official briefings, 293f2dae): 奥术 is off in this mode
    assert.equal(await page.$('.brief-bond[data-bond="arcaneShip"]'), null);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server.close(); }
});
