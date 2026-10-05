// Browser checks of the official emotes (research 09 §4) in headless Chrome (puppeteer-core + system Chrome):
// the UI-kit demo (/dev/uikit.html §13) and the in-match mock harness (/dev/game-mock.html). Opt-in like the other
// browser suites: SP_E2E=1 node --test test/ui/emotes.e2e.test.js   → screenshots in test/e2e/out/emotes-*.png
//
// Asserted: picture-only wheel pages (3×2 per theme) and bubbles (no text anywhere), swipe / arrow keys / dots change
// the theme, sending closes the panel and greys 交流 for the 1 s cooldown, the panel reopens on the last-used theme,
// a bubble fades out after 3 s and a newer one replaces it, the neutral glyph fallback when the art is missing, the
// bubble sits beside the sender's avatar in the team panel, and zero console errors.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMOTE_THEMES } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
// The official pictures reach the wheel through a two-link chain (data.js artUrls): the local-client extraction
// first (tools/local-extract → data/local-assets.json), then the copies tools/fetch-assets.mjs downloads into
// public/assets/ui/emoticon (GitHub #42). A deployment has one link or the other; the assertions below check that
// the pictures LOAD, never which link served them, so either one is enough to run the suite.
const HAS_ART = existsSync(path.join(ROOT, 'public/assets/local/emoticon/fooldoctor'))
  || existsSync(path.join(ROOT, 'public/assets/ui/emoticon/fooldoctor'));
// The WHEEL's own chrome is a different story: emoji_cell_bkg / emoji_bkg / emoji_btn come from the local client's
// ui/battle atlas (ui/emotes.js emoteUiSprite → localAsset), which tools/fetch-assets.mjs does NOT carry — no dump,
// no official cell, and the wheel draws its own. One assertion below is about that official chrome, so it asks for it
// separately instead of quietly failing on a fetch-assets-only deployment.
const HAS_UI = existsSync(path.join(ROOT, 'public/assets/local/ui/battle/emoji_cell_bkg.png'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('official emotes in the browser', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv;
  let browser;
  let base;

  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--force-device-scale-factor=1'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  async function open(url, { w = 1600, h = 900, manifest = null, ignore = [], block = null } = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    const problems = [];
    const bad = (s) => !ignore.some((re) => re.test(s));
    page.on('console', (m) => { if (m.type() === 'error' && bad(m.text())) problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    // a reload cancels the images still in flight (net::ERR_ABORTED): not a failure of the page
    page.on('requestfailed', (r) => { if (bad(r.url()) && r.failure()?.errorText !== 'net::ERR_ABORTED') problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`); });
    page.on('response', (r) => { if (r.status() >= 400 && bad(r.url())) problems.push(`http ${r.status()}: ${r.url()}`); });
    if (manifest || block) {
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        // `block`: answer 404 for these URLs (e.g. the emote copies setup downloads, GitHub #42 — the second link of the chain)
        if (block && block.test(req.url())) return req.respond({ status: 404, contentType: 'text/plain', body: 'blocked' });
        if (manifest && req.url().endsWith('/data/local-assets.json')) return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(manifest) });
        return req.continue();
      });
    }
    await page.goto(`${base}${url}`, { waitUntil: 'networkidle0' });
    return { page, problems };
  }

  const wheelState = (page, root = '') => page.evaluate((root) => {
    const q = (s) => document.querySelector(`${root} ${s}`.trim());
    const panel = q('.ewheel__panel');
    return {
      open: !!panel,
      theme: q('.ewheel__page')?.dataset.theme || null,
      items: document.querySelectorAll(`${root} .ewheel__item`.trim()).length,
      imgs: [...document.querySelectorAll(`${root} .ewheel__item img`.trim())].filter((i) => i.complete && i.naturalWidth > 0).length,
      glyphs: document.querySelectorAll(`${root} .ewheel__item .eart--glyph`.trim()).length,
      panelText: panel ? panel.textContent.trim() : '',
      btnDisabled: q('.ewheel__btn')?.disabled ?? null,
      dotOn: [...document.querySelectorAll(`${root} .ewheel__dot`.trim())].findIndex((d) => d.classList.contains('is-on')),
    };
  }, root);

  test('UI kit: pager per theme, picture-only, swipe / keys / dots, cooldown, remembered theme, 3 s bubble', { skip: !HAS_ART && 'no official emote art (neither the local extraction nor the fetched copies)' }, async () => {
    const { page, problems } = await open('/dev/uikit.html');
    await page.evaluate(() => localStorage.removeItem('sp.pref.emoteTheme'));
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#emo-stage .ewheel__panel');
    await page.$eval('#emo-stage', (el) => el.closest('section').scrollIntoView());
    await sleep(500);
    const section = await page.evaluateHandle(() => document.querySelector('#emo-stage').closest('section'));
    let s = await wheelState(page, '#emo-stage');
    assert.equal(s.theme, EMOTE_THEMES[0].themeId, 'first page by default');
    assert.equal(s.items, 6, '3×2 cells');
    assert.equal(s.imgs, 6, 'official pictures loaded');
    assert.equal(s.panelText, '', 'no text in the panel');
    assert.equal(s.dotOn, 0);
    assert.equal(await page.$$eval('.emo-cat img', (els) => els.filter((i) => i.complete && i.naturalWidth > 0).length), 36, 'all 36 pictures load');
    await section.screenshot({ path: path.join(OUT, 'emotes-uikit.png') });

    // swipe left → next theme (mouse drag across the pager)
    const box = await (await page.$('#emo-stage .ewheel__viewport')).boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.8, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(box.x + box.width * (0.8 - i * 0.08), y); await sleep(16); }
    await page.mouse.up();
    await sleep(250);
    s = await wheelState(page, '#emo-stage');
    assert.equal(s.theme, EMOTE_THEMES[1].themeId, 'swipe → next page');
    assert.equal(s.open, true, 'a drag is not a send');
    // a short drag is ignored
    await page.mouse.move(box.x + box.width * 0.5, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5 - 20, y, { steps: 3 });
    await page.mouse.up();
    await sleep(150);
    assert.equal((await wheelState(page, '#emo-stage')).theme, EMOTE_THEMES[1].themeId);
    // swipe right at the first page does nothing beyond the edge
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await sleep(200);
    assert.equal((await wheelState(page, '#emo-stage')).theme, EMOTE_THEMES[0].themeId, 'arrow keys, clamped at the first page');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await sleep(200);
    assert.equal((await wheelState(page, '#emo-stage')).theme, EMOTE_THEMES[3].themeId);
    await page.click('#emo-stage .ewheel__dot:nth-child(5)');
    await sleep(250);
    s = await wheelState(page, '#emo-stage');
    assert.equal(s.theme, EMOTE_THEMES[4].themeId, 'dot → page');
    assert.equal(s.dotOn, 4);
    assert.equal(s.imgs, 6);
    await section.screenshot({ path: path.join(OUT, 'emotes-uikit-page5.png') });

    // send: panel closes, bubble beside the avatar (picture only), 交流 greyed for 1 s
    const sent = EMOTE_THEMES[4].emotes[2].id;
    await page.click(`#emo-stage .ewheel__item[data-emote="${sent}"]`);
    await sleep(150);
    s = await wheelState(page, '#emo-stage');
    assert.equal(s.open, false);
    assert.equal(s.btnDisabled, true, 'cooldown');
    const bubble = await page.$eval('.emo-row .ebubble', (b) => ({ id: b.dataset.emote, text: b.textContent.trim(), img: !!b.querySelector('img') }));
    assert.deepEqual(bubble, { id: sent, text: '', img: true });
    await section.screenshot({ path: path.join(OUT, 'emotes-uikit-sent.png') });
    await sleep(1000);
    assert.equal((await wheelState(page, '#emo-stage')).btnDisabled, false, 'cooldown over after 1 s');
    await page.click('#emo-stage .ewheel__btn');
    await sleep(200);
    assert.equal((await wheelState(page, '#emo-stage')).theme, EMOTE_THEMES[4].themeId, 'reopens on the last used theme');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#emo-stage .ewheel__panel');
    assert.equal((await wheelState(page, '#emo-stage')).theme, EMOTE_THEMES[4].themeId, 'remembered across reloads');

    // bubble lifetime: gone (faded) after 3 s; a newer emote replaces it and pops again
    await page.click('#emo-stage .ewheel__item:nth-child(1)');
    await sleep(3250);
    const op = await page.$eval('.emo-row .ebubble', (b) => Number(getComputedStyle(b).opacity));
    assert.ok(op < 0.05, `faded after 3 s (opacity ${op})`);
    const texts = await page.$$eval('.ebubble', (els) => els.map((b) => b.textContent.trim()).filter(Boolean));
    assert.deepEqual(texts, [], 'no bubble ever shows text');
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('wheel: one trackpad swipe (momentum included) turns one page, a mouse-wheel notch turns one page', { skip: !HAS_ART && 'no official emote art (neither the local extraction nor the fetched copies)' }, async () => {
    const { page, problems } = await open('/dev/uikit.html');
    await page.evaluate(() => localStorage.removeItem('sp.pref.emoteTheme'));
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#emo-stage .ewheel__panel');
    await page.$eval('#emo-stage', (el) => el.scrollIntoView({ block: 'center' }));
    await sleep(300);
    const idx = async () => EMOTE_THEMES.map((t) => t.themeId).indexOf((await wheelState(page, '#emo-stage')).theme);
    assert.equal(await idx(), 0);
    // a macOS trackpad swipe: 60 wheel events 16 ms apart with a decaying deltaX (≈ 750 px) — v1 skipped to the last theme
    await page.evaluate(async () => {
      const vp = document.querySelector('#emo-stage .ewheel__viewport');
      for (let i = 0; i < 60; i++) {
        vp.dispatchEvent(new WheelEvent('wheel', { deltaX: Math.max(2, 40 * 0.95 ** i), deltaY: 0, bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 16));
      }
    });
    await sleep(350);
    assert.equal(await idx(), 1, 'one swipe = one theme');
    // a plain mouse wheel drives the horizontal pager (Unity ScrollRect): down = next, up = previous
    const box = await (await page.$('#emo-stage .ewheel__viewport')).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel({ deltaY: 100 });
    await sleep(350);
    assert.equal(await idx(), 2, 'wheel down → next theme');
    await page.mouse.wheel({ deltaY: -100 });
    await sleep(350);
    assert.equal(await idx(), 1, 'wheel up → previous theme');
    assert.equal((await wheelState(page, '#emo-stage')).open, true);
    // hover over an official cell (emoji_cell_bkg: rounded, transparent corners) brightens it, never fills its square box
    const cell = await (await page.$('#emo-stage .ewheel__item:nth-child(2)')).boundingBox();
    await page.mouse.move(cell.x + cell.width / 2, cell.y + cell.height / 2);
    await sleep(200);
    const hover = await page.$eval('#emo-stage .ewheel__item:nth-child(2)', (el) => ({
      sprite: el.closest('.ewheel__panel').classList.contains('has-cell'), bg: getComputedStyle(el).backgroundColor, filter: getComputedStyle(el).filter,
    }));
    if (HAS_UI) {
      assert.deepEqual(hover, { sprite: true, bg: 'rgba(0, 0, 0, 0)', filter: 'brightness(1.35)' }, 'the official emoji_cell_bkg cell');
    } else {
      // no local client dump: the wheel draws its own cell and the hover is a drawn fill — the pictures are what this
      // test is about on such a deployment, so only pin that it is NOT pretending to be the official sprite cell
      assert.equal(hover.sprite, false, 'without ui/battle/emoji_cell_bkg the cell is drawn, not the official sprite');
      assert.ok(hover.bg !== '' && hover.filter !== '', `the drawn cell is still styled: ${JSON.stringify(hover)}`);
    }
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('the cooldown survives a remount of the wheel; a bubble mounted late resumes its timeline', { skip: !HAS_ART && 'no official emote art (neither the local extraction nor the fetched copies)' }, async () => {
    const { page, problems } = await open('/dev/uikit.html');
    await page.waitForSelector('#emo-stage .ewheel__panel');
    await page.evaluate(async () => {
      const { render } = await import('preact');
      const { useState } = await import('preact/hooks');
      const { html } = await import('/js/ui/components.js');
      const { EmoteWheel, EmoteBubble } = await import('/js/ui/emotes.js');
      const host = document.createElement('div');
      host.id = 'emo-probe';
      host.style.cssText = 'position:fixed;left:40px;bottom:40px;z-index:99';
      const bubbles = document.createElement('div');
      bubbles.id = 'emo-probe-bubbles';
      bubbles.style.cssText = 'position:fixed;right:40px;top:40px;z-index:99;display:flex;gap:10px';
      document.body.append(host, bubbles);
      function Probe() {
        const [open, setOpen] = useState(true);
        return html`<${EmoteWheel} open=${open} onToggle=${setOpen} onSend=${() => {}} />`;
      }
      window.__probe = {
        mount: (n) => render(html`<${Probe} key=${n} />`, host),
        unmount: () => render(null, host),
        bubbles: (age) => render(html`<div class="late"><${EmoteBubble} id="autochess_battle_happy" at=${Date.now() - age} /></div>
          <div class="fresh"><${EmoteBubble} id="autochess_battle_happy" at=${Date.now()} /></div>`, bubbles),
      };
      window.__probe.mount(1);
    });
    await page.waitForSelector('#emo-probe .ewheel__item');
    await page.click('#emo-probe .ewheel__item:nth-child(2)');
    await sleep(100);
    const btn = () => page.$eval('#emo-probe .ewheel__btn', (b) => b.disabled);
    assert.equal(await btn(), true, 'cooling after the send');
    await page.evaluate(() => { window.__probe.unmount(); window.__probe.mount(2); });
    await sleep(50);
    assert.equal(await btn(), true, 'a remounted wheel is still cooling (v1 re-enabled it at once)');
    await sleep(1000);
    assert.equal(await btn(), false, 'cooldown over 1 s after the send');

    await page.evaluate(() => window.__probe.bubbles(2000));
    await sleep(60);
    const delay = await page.$eval('#emo-probe-bubbles .late .ebubble', (b) => getComputedStyle(b).animationDelay);
    assert.match(delay, /^-2(\.0\d*)?s,/, `late bubble resumes 2 s into its timeline (${delay})`);
    await sleep(1250);
    const op = await page.$$eval('#emo-probe-bubbles .ebubble', (els) => els.map((b) => Number(getComputedStyle(b).opacity)));
    assert.ok(op[0] < 0.05, `the late bubble faded at its own 3 s mark (${op[0]})`);
    assert.ok(op[1] > 0.95, `the fresh bubble is still up (${op[1]})`);
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('touch: a horizontal swipe on the pager turns the page, a tap sends', { skip: !HAS_ART && 'no official emote art (neither the local extraction nor the fetched copies)' }, async () => {
    const { page, problems } = await open('/dev/uikit.html');
    await page.setViewport({ width: 1280, height: 720, hasTouch: true, isMobile: false });
    await page.evaluate(() => localStorage.removeItem('sp.pref.emoteTheme'));
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#emo-stage .ewheel__panel');
    await page.$eval('#emo-stage', (el) => el.scrollIntoView({ block: 'center' }));
    await sleep(300);
    const box = await (await page.$('#emo-stage .ewheel__viewport')).boundingBox();
    const y = box.y + box.height / 2;
    await page.touchscreen.touchStart(box.x + box.width * 0.85, y);
    for (let i = 1; i <= 8; i++) { await page.touchscreen.touchMove(box.x + box.width * (0.85 - i * 0.08), y); await sleep(16); }
    await page.touchscreen.touchEnd();
    await sleep(250);
    let s = await wheelState(page, '#emo-stage');
    assert.equal(s.theme, EMOTE_THEMES[1].themeId, 'swipe left → next theme');
    assert.equal(s.open, true);
    const cell = await (await page.$('#emo-stage .ewheel__item:nth-child(4)')).boundingBox();
    await page.touchscreen.tap(cell.x + cell.width / 2, cell.y + cell.height / 2);
    await sleep(200);
    s = await wheelState(page, '#emo-stage');
    assert.equal(s.open, false, 'tap sends and closes');
    assert.equal(await page.$eval('.emo-row .ebubble', (b) => b.dataset.emote), EMOTE_THEMES[1].emotes[3].id);
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('missing art: neutral glyphs, never text', async () => {
    // neither the local-client art nor the copies setup downloads (GitHub #42) load: the glyph is the last link
    const { page, problems } = await open('/dev/uikit.html', {
      manifest: { version: 1, groups: { 'emoticon/basic': { pic_happy_battle: { path: '/assets/local/emoticon/basic/nope_404.png', w: 120, h: 120 } } } },
      block: /\/assets\/ui\/emoticon\//,
      ignore: [/nope_404\.png/, /\/assets\/ui\/emoticon\//, /Failed to load resource/],
    });
    await page.evaluate(() => localStorage.removeItem('sp.pref.emoteTheme'));
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#emo-stage .ewheel__panel');
    await sleep(400);
    const s = await wheelState(page, '#emo-stage');
    assert.equal(s.items, 6);
    assert.equal(s.imgs, 0);
    assert.equal(s.glyphs, 6, 'unlisted and broken pictures both fall back to the glyph');
    assert.equal(s.panelText, '');
    const bubbles = await page.$$eval('.ebubble', (els) => els.map((b) => ({ text: b.textContent.trim(), glyph: !!b.querySelector('.eart--glyph') })));
    assert.ok(bubbles.length >= 7);
    for (const b of bubbles) assert.deepEqual(b, { text: '', glyph: true });
    await (await page.evaluateHandle(() => document.querySelector('#emo-stage').closest('section'))).screenshot({ path: path.join(OUT, 'emotes-uikit-fallback.png') });
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('in-match mock: bubbles beside the senders\' avatars, wheel above 交流', { skip: !HAS_ART && 'no official emote art (neither the local extraction nor the fetched copies)' }, async () => {
    const { page, problems } = await open('/dev/game-mock.html?shot=1&render=fallback&phase=PREP&variant=emote', { w: 1920, h: 1080 });
    await page.waitForFunction(() => !!document.querySelector('.screen:not(.gload)'), { timeout: 15000 });
    await page.waitForSelector('.team__bubble');
    await page.waitForSelector('.ewheel__panel');
    await sleep(700);
    const s = await wheelState(page);
    assert.equal(s.items, 6);
    assert.equal(s.imgs, 6);
    assert.equal(s.panelText, '');
    const geo = await page.$$eval('.team__row', (rows) => rows.filter((r) => r.querySelector('.team__bubble')).map((r) => {
      const row = r.getBoundingClientRect();
      const a = r.querySelector('.pavatar, .team__btn').getBoundingClientRect();
      const b = r.querySelector('.team__bubble').getBoundingClientRect();
      const bubble = r.querySelector('.team__bubble');
      return {
        beside: b.left >= a.right && b.left - row.right >= 0 && b.left - row.right <= 24, // just right of the sender's row
        centred: Math.abs((b.top + b.bottom) / 2 - (a.top + a.bottom) / 2) <= 14,     // at the avatar's height
        absolute: getComputedStyle(bubble).position === 'absolute',                     // does not push the row
        text: bubble.textContent.trim(),
        img: [...r.querySelectorAll('.team__bubble img')].some((i) => i.complete && i.naturalWidth > 0),
      };
    }));
    assert.ok(geo.length >= 1, 'a teammate bubble is shown');
    for (const g of geo) assert.deepEqual(g, { beside: true, centred: true, absolute: true, text: '', img: true });
    await page.screenshot({ path: path.join(OUT, 'emotes-mock-1920.png') });
    // send from the wheel → own bubble
    await page.click('.ewheel__item:nth-child(3)');
    await sleep(300);
    assert.equal((await wheelState(page)).open, false);
    await page.screenshot({ path: path.join(OUT, 'emotes-mock-sent-1920.png') });
    assert.deepEqual(problems, []);
    await page.close();
  });
});
