// Real-server browser E2E — text fit of the official versions' interface (DESIGN §35.23, M1; the §35.18 matrix): on the
// four phones 640×360 / 667×375 / 740×360 / 844×390, in all five languages at all four 文字大小, and on desktops
// 1920×1080 / 1280×720:
//   * the lobby's version chip inside the top bar and the screen, the version picker inside the screen with every name
//     whole and every period line inside its row; 选择模拟协议's 版本数据校验失败 + 重试 row (a failed version set's look,
//     laid over content.js contentSet) inside the dialog;
//   * a version room seen by a doctor whose lobby is 第二期下半: the pill (the name may end in an ellipsis) inside the
//     footer, the vote strip inside the screen with its texts wrapping (never cut sideways) and its buttons inside it (in
//     view, a tap on each reaches it), the banner inside the screen, the seat tags (版本数据就绪 …) inside their cards, the
//     tag beside the mode in the top bar with its whole name;
//   * the vote strip floating above 干员调配 (a voter's) inside the screen with its title and buttons in view;
//   * the settlement's team page and its detail of a version match: the version tag inside the screen, and the vote strip
//     floating over the settlement (the host's) inside the screen.
// The vote is drawn from a room.state with `versionVote` laid over the page's store (its look only; the vote itself:
// test/ui/versions.e2e.test.js); the settlement from an imported record's payload (test/ui/fixtures/stats-versions.json).
// The game texts of another version stay Chinese in other languages until M3 (data.js versionFiles) — the interface's own
// texts are what this measures.
//
//   SP_E2E=1 node --test test/ui/versions-fit.e2e.test.js
//
// The history row and briefing tags also keep their whole label throughout the same matrix.
// Screenshots: test/e2e/out/versions-fit-*.png.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, hasChrome, startRealServer, problemsOf, sleep } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome();
const LANGS = ['zh', 'zh-TW', 'en', 'ja', 'ko'];
const SIZES = ['sm', 'md', 'lg', 'xl'];
const PHONES = [[640, 360], [667, 375], [740, 360], [844, 390]];
const DESKTOPS = [[1920, 1080], [1280, 720]];

/** Switch the interface language and 文字大小 in place (ui/lang.js switchLang, settingsStore). */
const setLook = (c, lang, size) => c.page.evaluate(async (lang, size) => {
  const { switchLang } = await import('/js/ui/lang.js');
  const { settingsStore } = await import('/js/ui/settingsStore.js');
  await switchLang(lang);
  settingsStore.set({ textSize: size });
  await document.fonts.ready;
}, lang, size);
// (no touch emulation: a change of it reloads the page — ui/device.js —, and the sizes follow the screen's height alone)
const viewport = (c, w, h) => c.page.setViewport({ width: w, height: h, hasTouch: false, isMobile: false, deviceScaleFactor: 1 });

/**
 * Elements of `sel` that leave the screen sideways or up/down, or whose own text is cut sideways (`wrap`); `inView`: also
 * up/down inside `within` (not scrolled out of it) and hit by a tap on its centre.
 */
const misfits = (c, checks) => c.page.evaluate((checks) => {
  const out = [];
  const box = (el) => el.getBoundingClientRect();
  for (const { sel, within = null, wrap = false, optional = false, x = false, inView = false } of checks) {
    const els = [...document.querySelectorAll(sel)].filter((el) => { const r = box(el); return r.width > 0 && r.height > 0; });
    if (!els.length && !optional) { out.push(`${sel}: missing`); continue; }
    for (const el of els) {
      const r = box(el);
      if (r.left < -1 || r.right > innerWidth + 1 || (!x && (r.top < -1 || r.bottom > innerHeight + 1))) out.push(`${sel}: off the screen ${Math.round(r.left)},${Math.round(r.top)}–${Math.round(r.right)},${Math.round(r.bottom)}`);
      if (within) {
        const p = el.closest(within);
        if (p) { const q = box(p); if (r.left < q.left - 1 || r.right > q.right + 1) out.push(`${sel}: outside ${within}`); }
        if (p && inView) {
          const q = box(p);
          if (r.top < q.top - 1 || r.bottom > q.bottom + 1) out.push(`${sel}: scrolled out of ${within}`);
          else if (!el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))) out.push(`${sel}: a tap on its centre misses it`);
        }
      }
      if (wrap && el.scrollWidth > el.clientWidth + 1) out.push(`${sel}: cut sideways (${el.scrollWidth} > ${el.clientWidth})`);
    }
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push('the page scrolls sideways');
  return out;
}, checks);

describe('official versions: text fit (real server, SP_VERSIONS=all)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome)' }, () => {
  let srv;
  let P;
  before(async () => { srv = await startRealServer({ env: { SP_VERSIONS: 'all' } }); P = (await import('puppeteer-core')).default; });
  after(async () => { await srv?.stop(); });

  test('the lobby chip and the picker: four phones and two desktops, five languages, four 文字大小', { timeout: 10 * 60 * 1000 }, async () => {
    const c = new Client(P, srv.base, 'lobby', { prefix: 'versions-fit', w: 667, h: 375 });
    try {
      await c.open();
      await c.enter('可露希尔');
      await c.page.evaluate(async () => { (await import('/js/versions.js')).setLobbyVersion('act1autochess@V1_1'); });
      await c.page.waitForFunction(() => globalThis.__SP_CONTENT__?.state().status === 'ready', { timeout: 30000 });
      for (const lang of LANGS) {
        for (const size of SIZES) {
          await setLook(c, lang, size);
          for (const [w, h] of [...PHONES, ...DESKTOPS]) {
            await viewport(c, w, h);
            await sleep(120);
            const chip = await misfits(c, [{ sel: '[data-testid="version-switch"]', within: '.topbar' }]);
            assert.deepEqual(chip, [], `chip ${lang} ${size} ${w}×${h}`);
          }
          await viewport(c, 667, 375);
          await c.click('[data-testid="version-switch"]');
          await c.page.waitForSelector('[data-testid="version-picker"]', { visible: true });
          await sleep(500); // the dialog's 转场
          for (const [w, h] of [...PHONES, ...DESKTOPS]) {
            await viewport(c, w, h);
            await sleep(150);
            const bad = await misfits(c, [
              { sel: '.modal__box.verpick' },
              // (the list scrolls inside the dialog: its rows are checked sideways)
              { sel: '.verpick__name', within: '.verpick__row', wrap: true, x: true },
              { sel: '.verpick__period', within: '.verpick__row', wrap: true, x: true },
              { sel: '.verpick__badge', within: '.verpick__row', x: true },
            ]);
            assert.deepEqual(bad, [], `picker ${lang} ${size} ${w}×${h}`);
          }
          if (size === 'xl' && (lang === 'en' || lang === 'ja')) { await viewport(c, 667, 375); await c.shot(`picker-${lang}-xl`); }
          await c.page.keyboard.press('Escape');
          await c.page.waitForSelector('[data-testid="version-picker"]', { hidden: true });
        }
      }
      // 选择模拟协议 of a version whose set failed its check: the look of content.js contentSet 'failed' (the data stays)
      const setStatus = (status) => c.page.evaluate(async (status) => { (await import('/js/content.js')).contentSet.set({ status }); }, status);
      await setStatus('failed');
      await setLook(c, 'zh', 'md');
      await viewport(c, 667, 375);
      await c.click('.mode-card[data-mode="solo"]');
      await c.page.waitForSelector('[data-testid="proto-failed"]', { visible: true });
      await sleep(500); // the dialog's 转场
      const protoBad = [];
      for (const lang of LANGS) {
        for (const size of SIZES) {
          await setLook(c, lang, size);
          for (const [w, h] of [...PHONES, ...DESKTOPS]) {
            await viewport(c, w, h);
            await sleep(120);
            const bad = await misfits(c, [
              { sel: '[data-testid="proto-failed"]', within: '.modal__box.proto', wrap: true, x: true },
              { sel: '[data-testid="proto-retry"]', within: '.modal__box.proto', x: true },
            ]);
            if (bad.length) protoBad.push(`选择模拟协议 ${lang} ${size} ${w}×${h}: ${bad.join('; ')}`);
          }
          if (size === 'xl' && lang === 'ja') { await viewport(c, 667, 375); await c.shot('proto-failed-ja-xl'); }
        }
      }
      assert.deepEqual(protoBad, []);
      await c.page.keyboard.press('Escape');
      await setStatus('ready');
      assert.deepEqual(problemsOf([c]), []);
    } finally { await c.close(); }
  });

  test('a version room (pill, strip, banner, seat tags, the tag) and a version settlement: phones and desktops, five languages, four 文字大小', { timeout: 15 * 60 * 1000 }, async () => {
    const host = new Client(P, srv.base, 'host', { prefix: 'versions-fit', w: 667, h: 375 });
    const guest = new Client(P, srv.base, 'guest', { prefix: 'versions-fit', w: 667, h: 375 });
    try {
      await host.open();
      await host.enter('凯尔希');
      await host.page.evaluate(async () => { (await import('/js/versions.js')).setLobbyVersion('act1autochess@V1_1'); });
      await host.page.waitForFunction(() => globalThis.__SP_CONTENT__?.state().status === 'ready', { timeout: 30000 });
      const room = await host.createCoop();
      await guest.open(`?room=${room.code}`);
      await guest.enter('阿米娅');
      await guest.waitFor((s) => s.room?.code === room.code, 'guest joined');
      await guest.page.waitForFunction(() => globalThis.__SP_CONTENT__?.state().status === 'ready', { timeout: 30000 });
      await guest.page.waitForSelector('[data-testid="version-banner"]');
      // the vote's look: a room.state with an open vote laid over the guest's store (no server push comes while idle)
      await guest.page.evaluate(() => {
        const { store } = globalThis.__SP__;
        const r = store.get().room;
        const voters = r.seats.filter((s) => s && !s.isBot).map((s) => s.playerId);
        store.set({ room: { ...r, versionVote: { id: 1, proposerId: r.hostId, version: 'act2autochess@V2_1', voters, agreed: [r.hostId], remainingMs: 59000 } } });
      });
      await guest.page.waitForSelector('[data-testid="version-vote"] [data-testid="version-agree"]', { visible: true });
      const roomBad = [];
      for (const lang of LANGS) {
        for (const size of SIZES) {
          await setLook(guest, lang, size);
          for (const [w, h] of [...PHONES, ...DESKTOPS]) {
            await viewport(guest, w, h);
            await sleep(150);
            const bad = await misfits(guest, [
              { sel: '.rs-pill' },
              { sel: '[data-testid="room-version"]', within: '.rs-pill' },
              { sel: '[data-testid="version-vote"]' },
              { sel: '.vervote__text strong', wrap: true },
              { sel: '.vervote__hint', wrap: true },
              { sel: '.vervote__actions .btn', within: '[data-testid="version-vote"]', inView: true },
              // (a short screen gives the banner's line to the seats: then it is not shown at all)
              { sel: '[data-testid="version-banner"]', wrap: true, optional: h <= 520 },
              // §35.18's phone layout hides the redundant ready tag (02eebe5b); loading / failed tags remain visible.
              { sel: '.seat__content.is-ready', within: '.rseat', optional: h <= 520 },
              { sel: '.seat__content:not(.is-ready)', within: '.rseat', optional: true },
              // the whole name (the part tells two halves apart), never an ellipsis; a short screen gives its line to
              // the seats like the banner's (§37.117): the pill above names the version there
              { sel: '.rs-clock [data-testid="version-tag"]', wrap: true, optional: h <= 520 },
              { sel: '.rs-clock [data-testid="version-tag"] .vertag__label', wrap: true, optional: h <= 520 },
            ]);
            if (bad.length) roomBad.push(`room ${lang} ${size} ${w}×${h}: ${bad.join('; ')}`);
          }
          if (size === 'xl' && (lang === 'en' || lang === 'ko')) { await viewport(guest, 667, 375); await guest.shot(`room-${lang}-xl`); }
        }
      }
      assert.deepEqual(roomBad, []);

      // the strip floating above 干员调配 (the guest is a voter): inside the screen, its title and buttons in view
      await setLook(guest, 'zh', 'md');
      await viewport(guest, 1280, 720);
      await guest.click('.rs-loadout');
      await guest.page.waitForSelector('.lo-count', { visible: true });
      await guest.page.waitForSelector('.vervote--covered [data-testid="version-agree"]', { visible: true });
      const coverBad = [];
      for (const lang of LANGS) {
        for (const size of SIZES) {
          await setLook(guest, lang, size);
          for (const [w, h] of [...PHONES, ...DESKTOPS]) {
            await viewport(guest, w, h);
            await sleep(150);
            const bad = await misfits(guest, [
              { sel: '.vervote--covered' },
              { sel: '.vervote--covered .vervote__text strong', wrap: true },
              { sel: '.vervote--covered .vervote__actions .btn', within: '.vervote--covered', inView: true },
            ]);
            if (bad.length) coverBad.push(`over 干员调配 ${lang} ${size} ${w}×${h}: ${bad.join('; ')}`);
          }
          if (size === 'xl' && lang === 'en') { await viewport(guest, 640, 360); await guest.shot('covered-en-xl'); }
        }
      }
      assert.deepEqual(coverBad, []);
      await guest.page.keyboard.press('Escape');
      await guest.page.waitForSelector('.lo-count', { hidden: true });

      // a settlement of a version match (an imported record's payload on the host's screen, inside its version room)
      const fixture = JSON.parse(readFileSync(path.join(ROOT, 'test/ui/fixtures/stats-versions.json'), 'utf8'));
      // History and briefing share VersionTag, with their own layout / chip classes. Measure the label itself too:
      // the outer inline-flex box can fit while its child clips the half out of the name.
      await host.page.evaluate(async (fixture) => {
        const { importStats, saveStats } = await import('/js/ui/stats.js');
        saveStats(importStats(fixture).stats);
        (await import('/js/screens/stats.js')).openStats();
      }, fixture);
      await host.page.waitForSelector('[data-testid="stats-version"]', { visible: true });
      await host.click('[data-testid="stats-version"] [data-version="all"]');
      await host.click('.st-tab[data-tab="history"]');
      await host.page.waitForSelector('.st-table--history [data-testid="version-tag"]', { visible: true });
      const tagsFit = async (selector, sidewaysOnly = false) => {
        const bad = [];
        for (const lang of LANGS) for (const size of SIZES) {
          await setLook(host, lang, size);
          for (const [w, h] of [...PHONES, ...DESKTOPS]) {
            await viewport(host, w, h);
            await sleep(150);
            const found = await misfits(host, [
              { sel: selector, wrap: true, x: sidewaysOnly },
              { sel: `${selector} .vertag__label`, wrap: true, x: sidewaysOnly },
            ]);
            if (found.length) bad.push(`${selector} ${lang} ${size} ${w}×${h}: ${found.join('; ')}`);
          }
        }
        assert.deepEqual(bad, []);
      };
      await tagsFit('.st-table--history [data-testid="version-tag"]', true);
      await host.page.evaluate(async () => { (await import('/js/screens/stats.js')).closeStats(); });
      await host.page.waitForSelector('.st', { hidden: true });
      await host.page.evaluate(async () => {
        const { modeIdFor } = await import('/shared/constants.js');
        const { store } = globalThis.__SP__;
        const r = store.get().room;
        store.set({ match: { public: { phase: 'INFO_CHECK', round: 1, modeId: modeIdFor(r.mode, r.difficulty),
          players: r.seats.filter(Boolean).map((s) => ({ ...s, ready: false, lp: 100 })) }, private: null, field: null, battle: null, result: null } });
      });
      await host.page.waitForSelector('.brief__vertag', { visible: true });
      await tagsFit('.brief__vertag');
      await host.page.evaluate(async (rec) => {
        const { recordToResult } = await import('/js/ui/stats.js');
        const { store } = globalThis.__SP__;
        store.set({ match: { public: { phase: 'RESULT', round: 14, players: [] }, private: null, field: null, battle: null, result: recordToResult(rec) } });
      }, fixture.records[0]);
      await host.page.waitForSelector('[data-testid="settle"] [data-testid="version-tag"]', { visible: true, timeout: 20000 });
      // the vote over the settlement: the host's strip (取消投票), laid over its store like the guest's
      await host.page.evaluate(() => {
        const { store } = globalThis.__SP__;
        const r = store.get().room;
        const voters = r.seats.filter((s) => s && !s.isBot).map((s) => s.playerId);
        store.set({ room: { ...r, versionVote: { id: 1, proposerId: r.hostId, version: 'act2autochess@V2_1', voters, agreed: [r.hostId], remainingMs: 59000 } } });
      });
      await host.page.waitForSelector('.vervote--float [data-testid="version-cancel"]', { visible: true });
      const settleBad = [];
      for (const lang of LANGS) {
        for (const size of SIZES) {
          await setLook(host, lang, size);
          for (const [w, h] of [...PHONES, ...DESKTOPS]) {
            await viewport(host, w, h);
            await sleep(150);
            const bad = await misfits(host, [
              { sel: '[data-testid="settle"] [data-testid="version-tag"]', wrap: true },
              { sel: '[data-testid="settle"] [data-testid="version-tag"] .vertag__label', wrap: true },
              { sel: '.vervote--float' },
              { sel: '.vervote--float .vervote__text strong', wrap: true },
              { sel: '.vervote--float .vervote__actions .btn', within: '.vervote--float', inView: true },
            ]);
            if (bad.length) settleBad.push(`settlement ${lang} ${size} ${w}×${h}: ${bad.join('; ')}`);
          }
          if (size === 'xl' && lang === 'en') { await viewport(host, 640, 360); await host.shot('settle-vote-en-xl'); }
        }
      }
      assert.deepEqual(settleBad, []);
      await viewport(host, 667, 375);
      await host.shot('settle');
      assert.deepEqual(problemsOf([host, guest]), []);
    } finally {
      await host.close();
      await guest.close();
    }
  });
});
