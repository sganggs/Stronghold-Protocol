// Real-server browser E2E of player report #6 after 0.1.0: "凯瑟琳策略升级刷新的三个装备显示异常". A solo 险境 prep with the
// strategy 凯瑟琳 (【定向投放】"每次升级调度中心时，在调度中心刷新随机3件装备，可以选择并获得其中1件"; test/e2e/fastServer.mjs
// SP_START_ROUND 2: a starter kit + 20 funds) is driven with real input: the LEVEL card is tapped twice (确认升级) and the
// three free items replace the bar's operator cards — each drawn as an item card (icon, name, tier, description, FREE),
// under a 定向投放 header (not 晋升奖励 / PROMOTION), with the item's detail on the first tap; the second tap takes it into
// the hand and the bar shows the shop again. Desktop 1920×1080 and the phones 844×390 / 756×366 (touch). Zero console
// errors. Screenshots: test/e2e/out/fb1-offer-*.png. A second case puts the offer off (稍后) and levels up again: the
// pill reads 定向投放待选择 +1, the header 之后还有 1 项, and the second offer follows the first pick
// (test/e2e/out/fb1-queue-*.png).
//
//   SP_E2E=1 node --test test/ui/feedback1-offers.e2e.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, sleep, hasChrome, startRealServer, problemsOf } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome() && existsSync(path.join(ROOT, 'public/assets'));

async function soloToPrep(c, bandName) {
  await c.open();
  await c.enter('煌');
  await c.click('.mode-card', '独立模拟');
  await c.click('.diff-card', '险境');
  await c.click('.create-box button', '开始独立模拟');
  await c.waitFor((s) => !!s.room, 'solo room');
  if (!(await c.st()).phase) await c.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
  await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
  await c.click('.brief__foot .btn--primary', '准备就绪');
  await c.waitFor((s) => s.phase === 'BAND_DRAFT', 'band draft', 30000);
  // The four-column strategy wall scrolls (DESIGN §35.18); 凯瑟琳 is below its first screen.
  await c.page.waitForSelector('.dband');
  await c.page.evaluate((name) => {
    [...document.querySelectorAll('.dband')].find((el) => el.textContent.includes(name))?.scrollIntoView({ block: 'center' });
  }, bandName);
  await c.click('.dband', bandName);
  await c.click('.draft-detail__btns .btn--primary', '确认选择');
  await c.waitFor((x) => x.phase === 'PREP' && !x.ready, 'prep', 60000);
  await sleep(1800);
}

/** The offer as drawn: header texts, the cards (kind, name, description, art, free tag) and their boxes. */
function offerDom(c) {
  return c.page.evaluate(() => {
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const root = document.querySelector('.shopbar__reward');
    if (!root) return null;
    const cards = [...root.querySelectorAll('.scard')].map((el) => ({
      item: el.classList.contains('scard--item'),
      name: el.querySelector('.scard__name')?.textContent.trim() || '',
      desc: el.querySelector('.scard__idesc')?.textContent.trim() || '',
      icon: !!el.querySelector('.scard__itemart img'),
      free: !!el.querySelector('.scard__free'),
      tier: el.querySelector('.tierchip, [class*="tier"]')?.textContent.trim() || '',
      box: box(el),
      clipped: el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1,
    }));
    return {
      title: root.querySelector('.rwtag__title')?.textContent.trim() || '',
      micro: root.querySelector('.rwtag__micro')?.textContent.trim() || '',
      sub: root.querySelector('.rwtag__sub')?.textContent.trim() || '',
      cards, root: box(root), vw: innerWidth, vh: innerHeight,
    };
  });
}

const privOf = (c) => c.page.evaluate(() => globalThis.__SP__.store.get().match.private);

describe('player report #6: 凯瑟琳\'s three free items after a level-up (real server, headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome + assets) to run' }, () => {
  test('the level-up offer shows three item cards (desktop and phones); a pick puts the item into the hand', { timeout: 240000 }, async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const srv = await startRealServer({ fast: { timerScale: 0.5, combatSpeed: 4, startRound: 2 } });
    const c = new Client(puppeteer, srv.base, 'cathy', { prefix: 'fb1-offer' });
    try {
      await soloToPrep(c, '凯瑟琳');
      assert.equal((await privOf(c)).bandId, 'band_cathy', 'strategy 凯瑟琳');
      // LEVEL: first tap arms 确认升级, the second upgrades
      await c.click('.lvcard');
      await sleep(250);
      await c.click('.lvcard');
      await c.page.waitForFunction(() => !!globalThis.__SP__.store.get().match.private?.shop?.rewardOffer, { timeout: 8000 });
      await sleep(600);
      const priv = await privOf(c);
      const offer = priv.shop.rewardOffer;
      assert.equal(offer.slots.length, 3, 'three items');
      assert.ok(offer.slots.every((s) => s.kind === 'item' && s.price === 0), JSON.stringify(offer));
      const names = await c.page.evaluate((ids) => ids.map((id) => globalThis.__SP__.data.lookup('items', id)?.name), offer.slots.map((s) => s.id));
      await c.shot('desktop');
      const dom = await offerDom(c);
      assert.ok(dom, 'the offer is in the bar');
      assert.equal(dom.title, '定向投放', `the header names the strategy (${dom.title} / ${dom.micro})`);
      assert.match(dom.sub, /免费选择 1 件/);
      assert.deepEqual(dom.cards.map((x) => x.name), names, 'the item names');
      for (const card of dom.cards) {
        assert.ok(card.item, `${card.name}: drawn as an item card`);
        assert.ok(card.icon, `${card.name}: the item icon`);
        assert.ok(card.desc.length > 2, `${card.name}: the description`);
        assert.ok(card.free, `${card.name}: FREE`);
      }
      // phones (touch, landscape): the same cards inside the viewport, none overlapping another
      const browserUa = await c.browser.userAgent();
      for (const [w, h] of [[844, 390], [756, 366]]) {
        await c.page.emulate({ viewport: { width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true }, userAgent: browserUa });
        await c.page.waitForFunction(() => !!document.querySelector('.shopbar__reward .scard'), { timeout: 30000 });
        await sleep(900);
        await c.page.screenshot({ path: path.join(ROOT, 'test/e2e/out', `fb1-offer-${w}x${h}.png`) });
        const d = await offerDom(c);
        assert.ok(d && d.cards.length === 3, `${w}×${h}: three cards`);
        for (const card of d.cards) {
          assert.ok(card.item && card.icon, `${w}×${h} ${card.name}: an item card with its icon`);
          assert.ok(card.box.l >= 0 && card.box.r <= w + 0.5 && card.box.t >= 0 && card.box.b <= h + 0.5, `${w}×${h} ${card.name}: inside the viewport ${JSON.stringify(card.box)}`);
        }
        for (let i = 1; i < d.cards.length; i++) assert.ok(d.cards[i].box.l >= d.cards[i - 1].box.r - 0.5, `${w}×${h}: cards ${i - 1} / ${i} do not overlap`);
      }
      await c.page.emulate({ viewport: { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false, hasTouch: false }, userAgent: browserUa });
      // switching touch emulation reloads the page: the session resumes with the offer still queued (re-hook the intents)
      await c.page.waitForFunction(() => !!globalThis.__SP__?.store.get().match.private?.shop?.rewardOffer && !!document.querySelector('.shopbar__reward'), { timeout: 30000 });
      await sleep(900);
      await c.hookRequests();
      // first tap: armed + the item's detail; second tap: taken
      const want = names[1];
      await c.click('.shopbar__reward .scard', want);
      await sleep(400);
      const armed = await c.page.evaluate(() => ({
        armed: document.querySelector('.shopbar__reward .scard.is-armed .scard__name')?.textContent.trim() || null,
        strip: document.querySelector('.shopbar__reward .scard.is-armed .scard__confirm')?.textContent.trim() || null,
        detail: document.querySelector('.dpanel')?.textContent || '',
      }));
      assert.equal(armed.armed, want, 'the tapped card is armed');
      assert.match(armed.strip || '', /确认选择/);
      assert.ok(armed.detail.includes(want), 'the detail card shows the item');
      await c.shot('armed');
      await c.click('.shopbar__reward .scard.is-armed');
      await c.page.waitForFunction(() => !globalThis.__SP__.store.get().match.private?.shop?.rewardOffer, { timeout: 8000 });
      const after = await privOf(c);
      const got = await c.page.evaluate((hand) => hand.filter((p) => p && p.kind === 'item').map((p) => globalThis.__SP__.data.lookup('items', p.id)?.name), after.hand);
      assert.ok(got.includes(want), `the item is in the hand (${got.join(', ')})`);
      assert.equal((await c.requests('g.reward')).length, 1, 'one g.reward');
      await sleep(300);
      assert.ok(await c.exists('.shopbar__cards'), 'the shop is back');
      await c.shot('after');
      assert.deepEqual(problemsOf([c]), []);
    } finally {
      await c.close();
      await srv.stop();
    }
  });

  test('an offer put off (稍后) and a second level-up: the pill says "+1", the header "之后还有 1 项", then the second offer', { timeout: 180000 }, async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const srv = await startRealServer({ fast: { timerScale: 0.5, combatSpeed: 4, startRound: 2 } });
    const c = new Client(puppeteer, srv.base, 'cathy2', { prefix: 'fb1-queue' });
    const levelUp = async () => { await c.click('.lvcard'); await sleep(250); await c.click('.lvcard'); };
    const offerOf = () => c.page.evaluate(() => globalThis.__SP__.store.get().match.private?.shop?.rewardOffer || null);
    try {
      await soloToPrep(c, '凯瑟琳');
      await levelUp();
      await c.page.waitForFunction(() => !!document.querySelector('.shopbar__reward .scard'), { timeout: 8000 });
      await c.click('.rwtag__later');
      await c.page.waitForFunction(() => !!document.querySelector('.rewardpill') && !!document.querySelector('.shopbar__cards'), { timeout: 8000 });
      await levelUp();
      await c.page.waitForFunction(() => globalThis.__SP__.store.get().match.private?.shop?.rewardOffer?.queued === 1, { timeout: 8000 });
      await sleep(400);
      const pill = await c.page.evaluate(() => document.querySelector('.rewardpill')?.textContent.replace(/\s+/g, '') || '');
      assert.match(pill, /定向投放待选择/);
      assert.match(pill, /\+1/, `the pill counts the offer behind (${pill})`);
      await c.shot('pill');
      await c.click('.rewardpill');
      await c.page.waitForFunction(() => !!document.querySelector('.shopbar__reward .scard'), { timeout: 8000 });
      await sleep(300);
      assert.equal(await c.page.evaluate(() => document.querySelector('.rwtag__more')?.textContent.trim() || null), '之后还有 1 项');
      await c.shot('offer');
      // the narrowest phone: the header strip still holds every line and the 稍后 button inside the screen
      const browserUa = await c.browser.userAgent();
      await c.page.emulate({ viewport: { width: 756, height: 366, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true }, userAgent: browserUa });
      await c.page.waitForFunction(() => !!document.querySelector('.rwtag__more'), { timeout: 30000 });
      await sleep(900);
      await c.page.screenshot({ path: path.join(ROOT, 'test/e2e/out', 'fb1-queue-756x366.png') });
      const strip = await c.page.evaluate(() => {
        const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
        const tag = document.querySelector('.rwtag');
        return { tag: box(tag), parts: [...tag.children].map((el) => ({ cls: el.className, ...box(el) })), vw: innerWidth, vh: innerHeight };
      });
      for (const part of strip.parts) {
        assert.ok(part.t >= strip.tag.t - 0.5 && part.b <= strip.tag.b + 0.5 && part.b <= strip.vh + 0.5, `756×366 ${part.cls}: inside the strip and the screen ${JSON.stringify(strip)}`);
      }
      await c.page.emulate({ viewport: { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false, hasTouch: false }, userAgent: browserUa });
      await c.page.waitForFunction(() => !!document.querySelector('.shopbar__reward .scard'), { timeout: 30000 });
      await sleep(900);
      await c.hookRequests();
      const first = await offerOf();
      await c.click('.shopbar__reward .scard');
      await sleep(300);
      await c.click('.shopbar__reward .scard.is-armed');
      await c.page.waitForFunction((ids) => { const o = globalThis.__SP__.store.get().match.private?.shop?.rewardOffer; return !!o && o.queued === 0 && o.slots.map((x) => x.id).join() !== ids; }, { timeout: 8000 }, first.slots.map((x) => x.id).join());
      await sleep(300);
      assert.equal(await c.exists('.rwtag__more'), false, 'nothing behind the second offer');
      assert.equal(await c.page.evaluate(() => document.querySelector('.rwtag__title')?.textContent.trim()), '定向投放');
      await c.shot('second');
      assert.deepEqual(problemsOf([c]), []);
    } finally {
      await c.close();
      await srv.stop();
    }
  });
});
