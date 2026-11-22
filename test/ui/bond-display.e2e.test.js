// The real bond components: an active bond draws the full ring at every tier (§37.340: the official 规程 screenshot), the
// segmented rings count members before activation, the stage numeral above the disc still shows the tier, a missing ring
// sprite keeps a readable lit disc, and the briefing's 阵容不完整 corner never displaces the glyph.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// the full ring is the official bondBoardIcon/1_1 sprite: without the asset pack every disc is the CSS fallback
const RING = fileURLToPath(new URL('../../public/assets/ui/bondBoardIcon/1_1.png', import.meta.url));
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME) && existsSync(RING);
const OUT = fileURLToPath(new URL('../e2e/out/', import.meta.url));

test('active bonds draw the full ring at every tier, the numeral shows the tier; briefing corners never displace the glyph', {
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
    // the briefing's drawn bonds are all lit: one full ring each, no tier on the element (none is reached before the match)
    const briefRings = await page.$$eval('.brief-bond:not(.is-off) .bond', (nodes) => nodes.map((el) => getComputedStyle(el.querySelector('.bond__disc'), '::before').backgroundImage));
    assert.ok(briefRings.length > 0 && briefRings.every((ring) => /bondBoardIcon\/1_1\.png/.test(ring)), JSON.stringify(briefRings));
    assert.deepEqual(await page.$$eval('.brief-bond .bond[data-tier]', (nodes) => nodes.length), 0);
    await page.evaluate(async () => {
      const { h, render } = await import('/vendor/preact.module.js');
      const { BondDisc } = await import('/js/ui/components.js');
      const host = document.createElement('div');
      host.id = 'disc-regression';
      host.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#10201a;padding:60px;display:flex;gap:40px;align-items:start';
      document.body.append(host);
      const cases = [
        { name: '精准 2/3', active: true, tier: 1, members: 2, minCount: 2 },
        { name: '维多利亚 3/6', active: true, tier: 1, members: 3, minCount: 3 },
        { name: '第二档', active: true, tier: 2, members: 6, minCount: 3 },
        { name: '最高档', active: true, tier: 2, members: 3, minCount: 2 },
        { name: '无人数', active: true, tier: 1 },
        { name: '未激活', members: 1, minCount: 2 },
        { name: '差一人', members: 2, minCount: 3 },
        { name: '零人', members: 0, minCount: 2 },
        { name: '禁用', active: true, disabled: true, tier: 1, members: 3, minCount: 2 },
      ];
      render(h('div', { style: 'display:flex;gap:40px' }, cases.map((props) => h(BondDisc, props))), host);
    });
    await page.waitForFunction(() => [...document.querySelectorAll('#disc-regression img')].every((img) => img.complete));
    const discs = await page.$$eval('#disc-regression .bond', (nodes) => nodes.map((el) => {
      const ring = getComputedStyle(el.querySelector('.bond__disc'), '::before');
      return {
        ring: ring.backgroundImage, size: parseFloat(ring.width) / el.querySelector('.bond__disc').getBoundingClientRect().width,
        plate: getComputedStyle(el.querySelector('.bond__core'), '::before').backgroundImage,
        glyph: getComputedStyle(el.querySelector('.bond__glyph')).color, tier: el.dataset.tier ?? null,
        empty: el.classList.contains('is-empty-progress'),
      };
    }));
    // every active tier: the same full ring (1_1) and lit centre, the 77-unit sprite's size; the tier stays on the element
    discs.slice(0, 5).forEach((disc, i) => {
      assert.match(disc.ring, /bondBoardIcon\/1_1\.png/, `case ${i}`);
      assert.match(disc.plate, /bondBoardIcon\/1_1\.png/, `case ${i}`);
      assert.equal(disc.glyph, 'rgb(6, 34, 26)');
      assert.ok(Math.abs(disc.size - .815 / .52) < .02, `case ${i}: ${disc.size}`);
    });
    assert.deepEqual(discs.slice(0, 5).map((d) => d.tier), ['1', '1', '2', '2', '1']);
    // before activation: the member progress (k of N), the grey centre, no tier
    assert.match(discs[5].ring, /bondBoardIcon\/2_1\.png/);
    assert.match(discs[6].ring, /bondBoardIcon\/3_2\.png/);
    assert.match(discs[7].ring, /bondBoardIcon\/2_1\.png/);
    assert.equal(discs[7].empty, true);
    assert.match(discs[8].ring, /bondBoardIcon\/1_0\.png/);
    for (const disc of discs.slice(5)) {
      assert.doesNotMatch(disc.plate, /1_1\.png/);
      assert.notEqual(disc.glyph, 'rgb(6, 34, 26)');
      assert.equal(disc.tier, null);
    }
    await page.screenshot({ path: `${OUT}/bond-tier-rings.png` });
    assert.deepEqual(errors, []);

    // the top bar (a 盟约 version): every active disc wears the full ring, its numeral above it shows the tier and sits on
    // the ring's rim; an inactive disc shows its member progress and no numeral
    const strip = await browser.newPage();
    strip.on('pageerror', (e) => errors.push(e.message));
    await strip.setViewport({ width: 1600, height: 900 });
    await strip.goto(`${srv.url}/dev/game-mock.html?shot=1&render=fallback&phase=PREP`, { waitUntil: 'domcontentloaded' });
    await strip.waitForSelector('.bstrip .bond');
    await strip.evaluate(() => {
      const mock = globalThis.__MOCK__;
      const state = mock.store.get();
      const bonds = [
        { bondId: 'yanShip', count: 3, tier: 1, active: true, layers: 9, thresholds: [3, 6, 9] },
        { bondId: 'kazimierzShip', count: 6, tier: 2, active: true, layers: 8, thresholds: [3, 6, 9] },
        { bondId: 'siracusaShip', count: 6, tier: 2, active: true, layers: 7, thresholds: [3, 6] },
        { bondId: 'swiftShip', count: 2, tier: 1, active: true, layers: 6, thresholds: [2] },
        { bondId: 'sargonShip', count: 2, tier: 0, active: false, layers: 0, thresholds: [3, 6] },
      ];
      mock.store.set({ match: { ...state.match, private: { ...state.match.private, bonds } } });
    });
    await strip.waitForFunction(() => document.querySelectorAll('.bslot').length === 5);
    await strip.waitForFunction(() => [...document.querySelectorAll('.bstrip img')].every((img) => img.complete));
    const slots = await strip.$$eval('.bslot', (nodes) => nodes.map((el) => {
      const disc = el.querySelector('.bond__disc');
      const box = disc.getBoundingClientRect();
      const ring = getComputedStyle(disc, '::before');
      const stage = el.querySelector('.bslot__stage');
      const s = stage?.getBoundingClientRect();
      return {
        bond: el.dataset.bond, ring: ring.backgroundImage, stage: stage?.getAttribute('aria-label') ?? null,
        rim: s ? s.y + s.height / 2 - (box.y + box.height / 2 - parseFloat(ring.height) * (0.5 - 13 / 77)) : null,
      };
    }));
    const by = Object.fromEntries(slots.map((x) => [x.bond, x]));
    assert.deepEqual(['yanShip', 'kazimierzShip', 'siracusaShip', 'swiftShip'].map((id) => by[id].stage), ['阶段 Ⅰ', '阶段 Ⅱ', '阶段 Ⅱ', '阶段 Ⅰ']);
    for (const id of ['yanShip', 'kazimierzShip', 'siracusaShip', 'swiftShip']) {
      assert.match(by[id].ring, /bondBoardIcon\/1_1\.png/, id);
      assert.ok(Math.abs(by[id].rim) < 2, `${id}: the numeral ${by[id].rim} px off the rim`);
    }
    assert.match(by.sargonShip.ring, /bondBoardIcon\/3_2\.png/);
    assert.equal(by.sargonShip.stage, null);
    await strip.screenshot({ path: `${OUT}/bond-strip-full-rings.png` });

    // a ring sprite that fails to load: the active disc is the CSS fallback, lit, no guessed URL
    const bare = await browser.newPage();
    bare.on('pageerror', (e) => errors.push(e.message));
    await bare.setBypassServiceWorker(true);
    await bare.setRequestInterception(true);
    bare.on('request', (req) => (req.url().includes('bondBoardIcon/1_1') ? req.respond({ status: 404, body: '' }) : req.continue()));
    await bare.goto(`${srv.url}/dev/game-mock.html?shot=1&render=fallback&phase=PREP`, { waitUntil: 'domcontentloaded' });
    await bare.waitForSelector('.bstrip .bond');
    await bare.evaluate(async () => {
      const { h, render } = await import('/vendor/preact.module.js');
      const { BondDisc } = await import('/js/ui/components.js');
      const host = document.createElement('div');
      host.id = 'disc-missing';
      document.body.append(host);
      render(h(BondDisc, { name: '精准', active: true, tier: 1, members: 2, minCount: 2 }), host);
    });
    await bare.waitForSelector('#disc-missing .bond.is-frame-missing');
    const fallback = await bare.$eval('#disc-missing .bond', (el) => ({
      core: getComputedStyle(el.querySelector('.bond__core')).backgroundColor,
      ring: getComputedStyle(el.querySelector('.bond__disc'), '::before').backgroundImage,
      imgs: el.querySelectorAll('img').length,
    }));
    assert.deepEqual(fallback, { core: 'rgb(89, 244, 202)', ring: 'none', imgs: 0 });
    // the strip's active discs share that one sprite, so they all fall back together; each stage numeral still sits on the
    // plain disc's top edge (the full ring's rim is .815rem × (½ − 13/77) ≈ .27rem above the centre, the plain disc's
    // edge .26rem: no gap opens under the numeral)
    await bare.waitForFunction(() => {
      const active = [...document.querySelectorAll('.bslot.is-active .bond')];
      return active.length > 0 && active.every((el) => el.classList.contains('is-frame-missing'));
    });
    const numerals = await bare.$$eval('.bslot.is-active', (nodes) => nodes.filter((el) => el.querySelector('.bslot__stage')).map((el) => {
      const s = el.querySelector('.bslot__stage').getBoundingClientRect();
      return s.y + s.height / 2 - el.querySelector('.bond__core').getBoundingClientRect().y;
    }));
    assert.ok(numerals.length > 0 && numerals.every((dy) => Math.abs(dy) < 2), `numeral centre minus the plain disc's top edge: ${JSON.stringify(numerals)}`);
    await bare.screenshot({ path: `${OUT}/bond-strip-ring-missing.png` });
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await srv.close();
  }
});
