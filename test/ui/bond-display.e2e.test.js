// The real bond components: an active bond draws a full lit ring at every tier — 规程 the unbroken 1_1 (§37.340: the
// official 规程 screenshot), a 盟约 period N_N by the bond's first threshold (§37.342: the official 盟约 recordings) —, the
// segmented rings count members before activation, the 规程 stage numeral sits on the ring's rim and the 盟约 strip has
// none (and no gap where it was), a missing ring sprite keeps a readable lit disc, and the briefing's 阵容不完整 corner
// never displaces the glyph. The popup's header disc wears N_N in both families (§37.342 review: the official 规程
// screenshot's open 不屈 card draws 2_2), and its active count is one bold string, the members in the accent and
// 「/第一档」 light grey (the official 7/3 and 3/2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// the full ring is the official bondBoardIcon/1_1 sprite: without the asset pack every disc is the CSS fallback
const RING = fileURLToPath(new URL('../../public/assets/ui/bondBoardIcon/1_1.png', import.meta.url));
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME) && existsSync(RING);
const OUT = fileURLToPath(new URL('../e2e/out/', import.meta.url));

test('active bonds draw a full ring at every tier (规程 1_1 with the numeral, 盟约 N_N without); briefing corners never displace the glyph', {
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
        // §37.342: the 盟约 periods' lit ring, N_N by the first threshold, at every tier
        { name: '维多利亚 7/3 盟约', active: true, tier: 2, members: 7, minCount: 3, phased: false },
        { name: '迅捷 盟约', active: true, tier: 1, members: 2, minCount: 2, phased: false },
        { name: '调和 盟约', active: true, tier: 1, members: 1, minCount: 1, phased: false },
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
    for (const disc of discs.slice(5, 9)) {
      assert.doesNotMatch(disc.plate, /1_1\.png/);
      assert.notEqual(disc.glyph, 'rgb(6, 34, 26)');
      assert.equal(disc.tier, null);
    }
    // the 盟约 rings: lit, full size, the same sprite for the centre plate
    for (const [i, key] of [[9, '3_3'], [10, '2_2'], [11, '1_1']]) {
      assert.match(discs[i].ring, new RegExp(`bondBoardIcon/${key}\\.png`), `case ${i}`);
      assert.match(discs[i].plate, new RegExp(`bondBoardIcon/${key}\\.png`), `case ${i}`);
      assert.equal(discs[i].glyph, 'rgb(6, 34, 26)');
      assert.ok(Math.abs(discs[i].size - .815 / .52) < .02, `case ${i}: ${discs[i].size}`);
    }
    await page.screenshot({ path: `${OUT}/bond-tier-rings.png` });
    assert.deepEqual(errors, []);

    // the top bar in a 盟约 period (§37.342): every active disc wears the full ring split by its first threshold, no numeral
    // above it and no gap where one sat (the full ring's glow fills the slot's top padding, as before, inside the scroller's
    // clip); an inactive disc shows its member progress
    const STRIP_BONDS = [
      { bondId: 'yanShip', count: 3, tier: 1, active: true, layers: 9, thresholds: [3, 6, 9] },
      { bondId: 'kazimierzShip', count: 6, tier: 2, active: true, layers: 8, thresholds: [3, 6, 9] },
      { bondId: 'siracusaShip', count: 6, tier: 2, active: true, layers: 7, thresholds: [3, 6] },
      { bondId: 'swiftShip', count: 2, tier: 1, active: true, layers: 6, thresholds: [2] },
      { bondId: 'sargonShip', count: 2, tier: 0, active: false, layers: 0, thresholds: [3, 6] },
    ];
    const setBonds = (pg) => pg.evaluate((bonds) => {
      const mock = globalThis.__MOCK__;
      const state = mock.store.get();
      mock.store.set({ match: { ...state.match, private: { ...state.match.private, bonds } } });
    }, STRIP_BONDS);
    const readSlots = (pg) => pg.$$eval('.bslot', (nodes) => nodes.map((el) => {
      const disc = el.querySelector('.bond__disc');
      const box = disc.getBoundingClientRect();
      const ring = getComputedStyle(disc, '::before');
      const stage = el.querySelector('.bslot__stage');
      const s = stage?.getBoundingClientRect();
      const clip = el.closest('.bstrip').getBoundingClientRect();
      return {
        bond: el.dataset.bond, ring: ring.backgroundImage, stage: stage?.getAttribute('aria-label') ?? null,
        rim: s ? s.y + s.height / 2 - (box.y + box.height / 2 - parseFloat(ring.height) * (0.5 - 13 / 77)) : null,
        centre: box.y + box.height / 2, ringTop: box.y + box.height / 2 - parseFloat(ring.height) / 2 - el.getBoundingClientRect().y,
        clipped: box.y + box.height / 2 - parseFloat(ring.height) / 2 < clip.y - .5,
      };
    }));
    // open a strip disc's popup: its header disc's ring and the count's computed look; Escape closes it again
    const readPopup = async (pg, id) => {
      await pg.click(`.bslot[data-bond="${id}"] .bond`);
      await pg.waitForSelector('.bpop', { visible: true });
      await pg.waitForFunction(() => [...document.querySelectorAll('.bpop__head img')].every((img) => img.complete));
      const pop = await pg.$eval('.bpop', (el) => {
        const look = (n) => { const st = getComputedStyle(n); return { color: st.color, weight: st.fontWeight, size: st.fontSize }; };
        const count = el.querySelector('.bpop__count');
        const cap = el.querySelector('.bpop__cap');
        return {
          ring: (getComputedStyle(el.querySelector('.bpop__disc .bond__disc'), '::before').backgroundImage.match(/bondBoardIcon\/(\w+)\.png/) || [])[1] || null,
          tally: el.querySelector('.bpop__tally').textContent, count: look(count), cap: look(cap),
          gap: cap.getBoundingClientRect().left - count.getBoundingClientRect().right,
          icon: getComputedStyle(el.querySelector('.bpop__population > .icon')).color,
          check: el.querySelector('.bpop__check') ? getComputedStyle(el.querySelector('.bpop__check')).color : null,
        };
      });
      await pg.keyboard.press('Escape');
      await pg.waitForSelector('.bpop', { hidden: true });
      return pop;
    };
    const MINT = 'rgb(89, 244, 202)';
    const assertActiveCount = (pop, tally, label) => {
      assert.equal(pop.tally, tally, label);
      assert.deepEqual([pop.count.color, pop.icon, pop.check], [MINT, MINT, MINT], `${label}: the members in the accent`);
      assert.equal(pop.cap.color, 'rgb(195, 203, 199)', `${label}: 「/第一档」 light grey (--text-md)`);
      assert.deepEqual([pop.count.size, pop.count.weight], [pop.cap.size, pop.cap.weight], `${label}: one size and weight`);
      assert.equal(pop.count.weight, '700', label);
      assert.ok(Math.abs(pop.gap) < .5, `${label}: no gap inside the count (${pop.gap})`);
    };
    const strip = await browser.newPage();
    strip.on('pageerror', (e) => errors.push(e.message));
    await strip.setViewport({ width: 1600, height: 900 });
    await strip.goto(`${srv.url}/dev/game-mock.html?shot=1&render=fallback&phase=PREP`, { waitUntil: 'domcontentloaded' });
    await strip.waitForSelector('.bstrip .bond');
    await setBonds(strip);
    await strip.waitForFunction(() => document.querySelectorAll('.bslot').length === 5);
    await strip.waitForFunction(() => [...document.querySelectorAll('.bstrip img')].every((img) => img.complete));
    const slots = await readSlots(strip);
    const by = Object.fromEntries(slots.map((x) => [x.bond, x]));
    assert.deepEqual(await strip.$$eval('.bslot__stage', (nodes) => nodes.length), 0, 'no numeral in a 盟约 period');
    for (const [id, key] of [['yanShip', '3_3'], ['kazimierzShip', '3_3'], ['siracusaShip', '3_3'], ['swiftShip', '2_2']]) {
      assert.match(by[id].ring, new RegExp(`bondBoardIcon/${key}\\.png`), id);
      // the full ring's top sits in the slot's top padding (.18rem − its .147rem overhang ≈ 3 px), unclipped
      assert.ok(by[id].ringTop >= 0 && by[id].ringTop < 6 && !by[id].clipped, `${id}: ring top ${by[id].ringTop} px`);
    }
    assert.match(by.sargonShip.ring, /bondBoardIcon\/3_2\.png/);
    // every disc on one line: no offset between the lit and the progress discs
    assert.ok(slots.every((x) => Math.abs(x.centre - slots[0].centre) < .5), JSON.stringify(slots.map((x) => x.centre)));
    await strip.screenshot({ path: `${OUT}/bond-strip-full-rings.png` });
    // the 盟约 popup: the header disc's ring is the strip's (卡西米尔 at 6 members, first threshold 3: 3_3; 迅捷 2_2); the count
    const covKaz = await readPopup(strip, 'kazimierzShip');
    assert.equal(covKaz.ring, '3_3');
    assertActiveCount(covKaz, '6/3', '盟约 kazimierzShip');
    assert.equal((await readPopup(strip, 'swiftShip')).ring, '2_2');
    // inactive: the member progress ring and the red plate's white count, unchanged
    const covIdle = await readPopup(strip, 'sargonShip');
    assert.deepEqual([covIdle.ring, covIdle.tally, covIdle.count.color, covIdle.cap.color], ['3_2', '2/3', 'rgb(255, 255, 255)', 'rgb(242, 242, 242)']);

    // the top bar in 规程 (unchanged): the unbroken 1_1 on every active disc, the numeral above it on the ring's rim
    const reg = await browser.newPage();
    reg.on('pageerror', (e) => errors.push(e.message));
    await reg.setViewport({ width: 1600, height: 900 });
    await reg.goto(`${srv.url}/dev/game-mock.html?shot=1&render=fallback&phase=PREP&version=regulation`, { waitUntil: 'domcontentloaded' });
    await reg.waitForSelector('.bstrip .bond');
    await setBonds(reg);
    await reg.waitForFunction(() => document.querySelectorAll('.bslot').length === 5);
    await reg.waitForFunction(() => [...document.querySelectorAll('.bstrip img')].every((img) => img.complete));
    const regBy = Object.fromEntries((await readSlots(reg)).map((x) => [x.bond, x]));
    // the mock's bonds are the default files (no phase table): the member tier, as for a plugin bond in 规程 [ASSUMED]
    assert.deepEqual(['yanShip', 'kazimierzShip', 'siracusaShip', 'swiftShip'].map((id) => regBy[id].stage), ['阶段 Ⅰ', '阶段 Ⅱ', '阶段 Ⅱ', '阶段 Ⅰ']);
    for (const id of ['yanShip', 'kazimierzShip', 'siracusaShip', 'swiftShip']) {
      assert.match(regBy[id].ring, /bondBoardIcon\/1_1\.png/, id);
      assert.ok(Math.abs(regBy[id].rim) < 2, `${id}: the numeral ${regBy[id].rim} px off the rim`);
    }
    assert.match(regBy.sargonShip.ring, /bondBoardIcon\/3_2\.png/);
    assert.equal(regBy.sargonShip.stage, null);
    await reg.screenshot({ path: `${OUT}/bond-strip-regulation.png` });
    // the 规程 popup: the header disc wears N_N by the first threshold while the strip keeps 1_1 (the official 规程
    // screenshot: the open 不屈 card draws 2_2 over its unbroken strip disc); the count as in 盟约
    const regKaz = await readPopup(reg, 'kazimierzShip');
    assert.equal(regKaz.ring, '3_3');
    assertActiveCount(regKaz, '6/3', '规程 kazimierzShip');
    const regSwift = await readPopup(reg, 'swiftShip');
    assert.equal(regSwift.ring, '2_2');
    assertActiveCount(regSwift, '2/2', '规程 swiftShip');
    assert.equal((await readPopup(reg, 'sargonShip')).ring, '3_2');
    assert.match((await readSlots(reg)).find((x) => x.bond === 'kazimierzShip').ring, /bondBoardIcon\/1_1\.png/, 'the strip disc stays unbroken');
    await reg.click('.bslot[data-bond="swiftShip"] .bond');
    await reg.waitForSelector('.bpop', { visible: true });
    await reg.screenshot({ path: `${OUT}/bond-popup-regulation.png` });
    await reg.keyboard.press('Escape');

    // a ring sprite that fails to load: the active disc is the CSS fallback, lit, no guessed URL
    const bare = await browser.newPage();
    bare.on('pageerror', (e) => errors.push(e.message));
    await bare.setBypassServiceWorker(true);
    await bare.setRequestInterception(true);
    bare.on('request', (req) => (req.url().includes('bondBoardIcon/1_1') ? req.respond({ status: 404, body: '' }) : req.continue()));
    await bare.goto(`${srv.url}/dev/game-mock.html?shot=1&render=fallback&phase=PREP&version=regulation`, { waitUntil: 'domcontentloaded' });
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
    // 规程: the strip's active discs share that one sprite, so they all fall back together; each stage numeral still sits on
    // the plain disc's top edge (the full ring's rim is .815rem × (½ − 13/77) ≈ .27rem above the centre, the plain disc's
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

    // 盟约: a missing N_N falls back the same way (the lit CSS disc), only the discs that use it
    const bareCov = await browser.newPage();
    bareCov.on('pageerror', (e) => errors.push(e.message));
    await bareCov.setBypassServiceWorker(true);
    await bareCov.setRequestInterception(true);
    bareCov.on('request', (req) => (req.url().includes('bondBoardIcon/3_3') ? req.respond({ status: 404, body: '' }) : req.continue()));
    await bareCov.setViewport({ width: 1600, height: 900 });
    await bareCov.goto(`${srv.url}/dev/game-mock.html?shot=1&render=fallback&phase=PREP`, { waitUntil: 'domcontentloaded' });
    await bareCov.waitForSelector('.bstrip .bond');
    await setBonds(bareCov);
    await bareCov.waitForFunction(() => document.querySelectorAll('.bslot').length === 5);
    await bareCov.waitForFunction(() => ['yanShip', 'kazimierzShip', 'siracusaShip'].every((id) => document.querySelector(`.bslot[data-bond="${id}"] .bond.is-frame-missing`)));
    const covFallback = await bareCov.$$eval('.bslot', (nodes) => nodes.map((el) => ({
      bond: el.dataset.bond, missing: el.querySelector('.bond').classList.contains('is-frame-missing'),
      core: getComputedStyle(el.querySelector('.bond__core')).backgroundColor,
    })));
    for (const x of covFallback.filter((x) => ['yanShip', 'kazimierzShip', 'siracusaShip'].includes(x.bond))) assert.deepEqual([x.missing, x.core], [true, 'rgb(89, 244, 202)'], x.bond);
    assert.equal(covFallback.find((x) => x.bond === 'swiftShip').missing, false, '2_2 still draws');
    await bareCov.screenshot({ path: `${OUT}/bond-strip-ring-missing-covenant.png` });
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await srv.close();
  }
});
