// The real bond components: first-tier activation and the briefing's 阵容不完整 corner after the sprite migration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// the lit plate is the official bondBoardIcon/1_1 sprite: without the asset pack the core falls back to none
const PLATE = fileURLToPath(new URL('../../public/assets/ui/bondBoardIcon/1_1.png', import.meta.url));
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME) && existsSync(PLATE);
const OUT = fileURLToPath(new URL('../e2e/out/', import.meta.url));

test('activated bond centres light before the last tier; briefing corners never displace the glyph', {
  skip: !ENABLED && 'set SP_E2E=1 and CHROME_PATH to run (needs the asset pack)',
}, async () => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    mkdirSync(OUT, { recursive: true });
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${srv.url}/dev/game-mock.html?shot=1&render=fallback&phase=INFO_CHECK&version=regulation`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.brief-bond.is-incomplete .bond__core');
    for (const [width, height] of [[1440, 900], [844, 390]]) {
      await page.setViewport({ width, height });
      const offsets = await page.$$eval('.brief-bond .bond', (nodes) => nodes.map((el) => {
        const disc = el.querySelector('.bond__disc').getBoundingClientRect();
        const core = el.querySelector('.bond__core').getBoundingClientRect();
        const tag = el.querySelector('.bond__tag');
        return { dy: core.y + core.height / 2 - disc.y - disc.height / 2, tag: tag ? getComputedStyle(tag).position : null };
      }));
      assert.ok(offsets.length > 0 && offsets.some((x) => x.tag === 'absolute'));
      assert.ok(offsets.every((x) => Math.abs(x.dy) < 1 && (!x.tag || x.tag === 'absolute')), JSON.stringify(offsets));
      await page.screenshot({ path: `${OUT}/bond-briefing-${width}.png` });
    }
    await page.click('.brief-bond[data-bond="preciShip"] .bond');
    await page.waitForSelector('.match-bond-dialog .bpop', { visible: true });
    await page.keyboard.press('Escape');
    await page.waitForSelector('.match-bond-dialog', { hidden: true });
    await page.evaluate(async () => {
      const { h, render } = await import('/vendor/preact.module.js');
      const { BondDisc } = await import('/js/ui/components.js');
      const host = document.createElement('div');
      host.id = 'disc-regression';
      host.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#10201a;padding:60px;display:flex;gap:40px;align-items:start';
      document.body.append(host);
      const cases = [
        { name: '精准 2/3', active: true, tier: 1, maxTier: 2 },
        { name: '维多利亚 3/6', active: true, tier: 1, maxTier: 2 },
        { name: '第二档', active: true, tier: 2, maxTier: 3 },
        { name: '最高档', active: true, tier: 2, maxTier: 2 },
        { name: '未激活', members: 1, minCount: 2 },
        { name: '禁用', active: true, disabled: true },
      ];
      render(h('div', { style: 'display:flex;gap:40px' }, cases.map((props) => h(BondDisc, props))), host);
    });
    await page.waitForFunction(() => [...document.querySelectorAll('#disc-regression img')].every((img) => img.complete));
    const discs = await page.$$eval('#disc-regression .bond', (nodes) => nodes.map((el) => ({
      ring: getComputedStyle(el.querySelector('.bond__disc'), '::before').backgroundImage,
      plate: getComputedStyle(el.querySelector('.bond__core'), '::before').backgroundImage,
      glyph: getComputedStyle(el.querySelector('.bond__glyph')).color,
    })));
    for (const disc of discs.slice(0, 4)) {
      assert.match(disc.plate, /bondBoardIcon\/1_1\.png/);
      assert.equal(disc.glyph, 'rgb(6, 34, 26)');
    }
    assert.match(discs[0].ring, /2_1\.png/);
    assert.match(discs[2].ring, /3_2\.png/);
    assert.match(discs[3].ring, /2_2\.png/);
    assert.doesNotMatch(discs[4].plate, /1_1\.png/);
    assert.doesNotMatch(discs[5].plate, /1_1\.png/);
    await page.screenshot({ path: `${OUT}/bond-tier-centres.png` });
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await srv.close();
  }
});
