// Real-server browser E2E — the official versions (DESIGN §35.23, M1) on a server that enables them all (SP_VERSIONS=all):
//   * the lobby switch: 第一期下半 picked in the version picker → S.W.E.E.P. 18 盟约 / 30 策略, 干员调配's 95 operators,
//     three difficulty cards (no 终极); the choice survives a reload;
//   * a co-op room created in that version shows its tag; a guest whose lobby is 第二期下半 joins, loads the version (the
//     seat tag, ready waits for it) and sees the banner that leaving restores its own version;
//   * the host proposes 第二期上半 → the strip on both pages, the guest agrees → both pages switch; a proposal the guest
//     declines → the host's toast; a solo room switches at once; leaving restores the guest's lobby version;
//   * a stats record of another version (an imported fixture) carries its tag in 统计数据;
//   * a vote opened while a voter has 干员调配 open floats above it (an alertdialog that takes the focus, its countdown not
//     announced; the room's strip under it aria-hidden),
//     and agreeing there switches the open 干员调配 to the new version's operators (95, then 112 back); a replay open when
//     the room goes away (a kick) keeps its version shown and is never replaced by the wait; a server limited to
//     第二期下半 (SP_VERSIONS=act2autochess) does not offer another version's record for re-viewing;
//   * phones (667×375): the chip, the picker, the room pill, the strip and the banner fit the width;
//   * no console error on any page.
// Game texts of another version stay Chinese in other languages until M3 (data.js versionFiles) — not checked here.
//
//   SP_E2E=1 node --test test/ui/versions.e2e.test.js
//
// Screenshots: test/e2e/out/versions-*.png.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Client, ROOT, hasChrome, startRealServer, problemsOf, sleep } from '../e2e/client.mjs';
import { VERSIONS } from '../../shared/versions.js';

const ENABLED = process.env.SP_E2E === '1' && hasChrome();
const FIXTURE = path.join(ROOT, 'test/ui/fixtures/stats-versions.json');

/** The page's content set (content.js __SP_CONTENT__) and the room's version as the store holds them. */
const stateOf = (c) => c.page.evaluate(() => {
  const s = globalThis.__SP__.store.get();
  const k = globalThis.__SP_CONTENT__?.state() || {};
  return { kind: k.kind ?? null, version: k.version ?? null, status: k.status ?? null, room: s.room ? (s.room.version ?? 'act2autochess') : null,
    vote: !!s.room?.versionVote, lobby: s.lobbyVersion ?? null, config: globalThis.__SP__.data.get('config')?.version?.id ?? 'act2autochess' };
});
const waitState = async (c, pred, what, timeout = 30000) => {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) { last = await stateOf(c); if (pred(last)) return last; await sleep(150); }
  throw new Error(`${c.label}: timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
};
/** Click until `waitSel` shows (a dialog's 转场 or an overlay still closing can swallow a click). */
const openWith = async (c, sel, text, waitSel) => {
  for (let i = 0; i < 4; i++) {
    await c.click(sel, text);
    try { await c.page.waitForSelector(waitSel, { visible: true, timeout: 2500 }); return; } catch { /* again */ }
  }
  throw new Error(`${c.label}: ${waitSel} never showed`);
};
/** Waits out the 转场 (tr-* / ps-* / rs-* animations: a dialog or a screen sliding in), not the looping scene motion. */
const settle = (c) => c.page.waitForFunction(() => !document.getAnimations()
  .some((a) => /^(tr|ps|rs|rseat)-/.test(String(a.animationName)) && a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity), { timeout: 10000 });
/** Pick a version in the open picker once it has settled. */
// The picker opens scrolled to the current version's card (round 72): bring the asked card into view first, as a player
// scrolls to it on a phone.
const pickVersion = async (c, id) => {
  await settle(c);
  await c.page.evaluate((v) => document.querySelector(`.verpick__pick[data-version="${v}"]`)?.scrollIntoView({ block: 'center' }), id);
  await c.click(`.verpick__pick[data-version="${id}"]`);
};
const noHScroll = (c) => c.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const toastText = (c) => c.page.evaluate(() => [...document.querySelectorAll('.toast__text')].map((e) => e.textContent).join(' | '));

describe('official versions (real server, SP_VERSIONS=all)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome)' }, () => {
  test('the lobby switch, a version room, the vote, leaving, a tagged record — 1920×1080', { timeout: 5 * 60 * 1000 }, async () => {
    const srv = await startRealServer({ env: { SP_VERSIONS: 'all' } });
    const P = (await import('puppeteer-core')).default;
    const host = new Client(P, srv.base, 'host', { prefix: 'versions' });
    const guest = new Client(P, srv.base, 'guest', { prefix: 'versions', w: 1280, h: 720 });
    try {
      await host.open();
      await host.enter('凯尔希');
      await host.page.waitForSelector('[data-testid="version-switch"]', { visible: true });
      assert.equal(await host.page.$eval('[data-testid="version-switch"]', (e) => e.dataset.version), 'act2autochess', 'the server\'s default');
      // the lobby switch → 第一期下半
      await openWith(host, '[data-testid="version-switch"]', null, '[data-testid="version-picker"]');
      assert.equal(await host.page.$$eval('.verpick__pick', (b) => b.length), VERSIONS.length, 'every enabled version');
      await sleep(600);
      await host.shot('picker');
      await pickVersion(host, 'act1autochess');
      await waitState(host, (s) => s.kind === 'version' && s.version === 'act1autochess' && s.status === 'ready', 'the 第一期下半 set');
      assert.equal((await stateOf(host)).config, 'act1autochess');
      assert.match(await host.page.$eval('[data-testid="hub-version"]', (e) => e.textContent), /第一期下半/);
      // S.W.E.E.P.: 18 盟约, 30 策略
      await openWith(host, '.lobby-sweep', null, '.sw-tabs');
      const sumCounts = () => host.page.$$eval('.sw-body .sw-sec__name small', (els) => els.reduce((n, e) => n + Number(e.textContent), 0));
      await host.click('.sw-tab', '盟约');
      await host.page.waitForFunction(() => document.querySelector('.sw-body')?.dataset.tab === 'bonds');
      assert.equal(await sumCounts(), 18, '第一期下半: 18 盟约');
      await host.click('.sw-tab', '策略');
      await host.page.waitForFunction(() => document.querySelector('.sw-body')?.dataset.tab === 'bands');
      assert.equal(await sumCounts(), 30, '30 策略');
      await host.page.keyboard.press('Escape');
      await host.page.waitForSelector('.sw-tabs', { hidden: true });
      // 干员调配: 95 operators
      await openWith(host, '.lobby-loadout', null, '.lo-count');
      await host.page.waitForFunction(() => /\/95\b/.test(document.querySelector('.lo-count')?.textContent || ''), { timeout: 20000 });
      await host.page.keyboard.press('Escape');
      await host.page.waitForFunction(() => !document.querySelector('.lo-count'), { timeout: 10000 });
      // 独立模拟 → three difficulty cards
      await openWith(host, '.mode-card', '独立模拟', '.modal__box.proto .diff-card');
      assert.equal(await host.page.$$eval('.modal__box.proto .diff-card', (b) => b.length), 3, 'no 终极');
      await host.page.keyboard.press('Escape');
      await host.page.waitForSelector('.modal__box.proto', { hidden: true });
      // the choice survives a reload
      await host.page.reload({ waitUntil: 'domcontentloaded' });
      await host.page.waitForSelector('[data-testid="version-switch"]', { visible: true, timeout: 30000 });
      await waitState(host, (s) => s.version === 'act1autochess' && s.status === 'ready', 'the choice after a reload');

      // a co-op room of 第一期下半; a guest of the default lobby joins
      const room = await host.createCoop();
      await waitState(host, (s) => s.room === 'act1autochess', 'the room in 第一期下半');
      await host.page.waitForSelector('.rs-clock [data-testid="version-tag"]', { visible: true });
      await guest.open(`?room=${room.code}`);
      await guest.enter('阿米娅');
      await guest.waitFor((s) => s.room?.code === room.code, 'guest joined');
      await guest.page.waitForSelector('.room-screen .seat.is-me [data-testid="seat-content"]');
      await waitState(guest, (s) => s.version === 'act1autochess' && s.status === 'ready', 'the guest loads 第一期下半');
      await guest.page.waitForFunction(() => document.querySelector('.room-screen .seat.is-me [data-testid="seat-content"]')?.textContent.includes('版本数据就绪'), { timeout: 15000 });
      assert.match(await guest.page.$eval('[data-testid="version-banner"]', (e) => e.textContent), /第一期下半.*第二期下半/, 'leaving restores the guest\'s lobby version');
      await guest.page.waitForFunction(() => !document.querySelector('.rs-go')?.disabled, { timeout: 10000 });
      await guest.shot('guest-room');

      // the host proposes 第二期上半: the strip on both pages, the guest agrees → both switch
      await openWith(host, '[data-testid="room-version"]', null, '[data-testid="version-picker"]');
      await pickVersion(host, 'act2autochess@V2_1');
      await host.page.waitForSelector('[data-testid="version-vote"]', { visible: true, timeout: 10000 });
      await guest.page.waitForSelector('[data-testid="version-vote"] [data-testid="version-agree"]', { visible: true, timeout: 10000 });
      assert.match(await guest.page.$eval('[data-testid="version-vote"]', (e) => e.textContent), /第二期上半.*1\/2/);
      await host.shot('vote-host');
      await guest.shot('vote-guest');
      assert.equal(await host.page.$eval('.rs-go', (b) => b.disabled), true, '开始模拟 waits for the vote');
      await guest.click('[data-testid="version-agree"]');
      for (const c of [host, guest]) await waitState(c, (s) => s.room === 'act2autochess@V2_1' && s.version === 'act2autochess@V2_1' && s.status === 'ready' && !s.vote, `${c.label}: switched`);
      await guest.page.waitForFunction(() => [...document.querySelectorAll('.toast__text')].some((e) => e.textContent.includes('同盟已切换到「第二期上半」')), { timeout: 5000 });

      // a proposal the guest declines: the host is told
      await openWith(host, '[data-testid="room-version"]', null, '[data-testid="version-picker"]');
      await pickVersion(host, 'act1autochess');
      await guest.page.waitForSelector('[data-testid="version-decline"]', { visible: true, timeout: 10000 });
      await guest.click('[data-testid="version-decline"]');
      await host.page.waitForFunction(() => [...document.querySelectorAll('.toast__text')].some((e) => e.textContent.includes('阿米娅拒绝了切换版本')), { timeout: 10000 });
      assert.equal((await stateOf(host)).room, 'act2autochess@V2_1', 'unchanged');
      await host.page.waitForSelector('[data-testid="version-vote"]', { hidden: true });

      // the guest leaves: its lobby's 第二期下半 again
      await guest.click('.rs-exit');
      await waitState(guest, (s) => s.room === null && s.kind === null && s.config === 'act2autochess', 'the guest back on 第二期下半');

      // a solo room switches at once
      await host.click('.rs-exit');
      await host.page.waitForSelector('.lobby-screen', { timeout: 15000 });
      await openWith(host, '.mode-card', '独立模拟', '.modal__box.proto .proto-start');
      await sleep(400);
      await host.click('.modal__box.proto .proto-start');
      await waitState(host, (s) => s.room === 'act1autochess', 'a solo room of 第一期下半');
      await openWith(host, '[data-testid="room-version"]', null, '[data-testid="version-picker"]');
      await pickVersion(host, 'act2autochess');
      await waitState(host, (s) => s.room === 'act2autochess' && !s.vote && s.kind === null, 'switched at once (a lone human)');
      await host.click('.rs-exit');
      await host.page.waitForSelector('.lobby-screen', { timeout: 15000 });

      // 统计数据: an imported record of 第一期下半 carries its tag
      await openWith(host, '.hub-ach', null, '.achv__more');
      await sleep(400);
      await host.click('.achv__more');
      await host.page.waitForSelector('.st', { visible: true });
      const input = await host.page.$('.st input[type=file]');
      await input.uploadFile(FIXTURE);
      await host.page.waitForFunction(() => [...document.querySelectorAll('.toast__text')].some((e) => /已导入 2 条记录/.test(e.textContent)), { timeout: 10000 });
      await host.click('.st-tab[data-tab="history"]');
      await host.page.waitForSelector('[data-testid="stats-version"]', { visible: true });
      await host.page.waitForSelector('.st-table--history tr[data-version="act1autochess"] [data-testid="version-tag"]', { visible: true });
      assert.equal(await host.page.$$eval('.st-table--history tbody tr', (r) => r.length), 1, 'the lobby\'s version: its records only');
      await host.click('[data-testid="stats-version"] [data-version="all"]');
      await host.page.waitForFunction(() => document.querySelectorAll('.st-table--history tbody tr').length === 2);
      await host.shot('stats');
      // re-viewing the 第二期下半 record from the 第一期下半 lobby shows 第二期下半 while it is open, and the lobby's own
      // choice stays (the store's replayVersion; the row used to switch the lobby for good)
      await host.click('.st-table--history tr[data-version="act2autochess"]');
      await waitState(host, (s) => s.kind === null && s.lobby === 'act1autochess', 'the replay shows 第二期下半');
      await host.page.waitForSelector('.st--replay', { visible: true });
      await host.page.waitForFunction(() => !document.querySelector('.st--replay .st-loading'), { timeout: 20000 });
      assert.equal(await host.page.evaluate(() => localStorage.getItem('sp.pref.lobby.version')), '"act1autochess"', 'the lobby preference is untouched');
      await host.page.keyboard.press('Escape');
      await waitState(host, (s) => s.kind === 'version' && s.version === 'act1autochess' && s.status === 'ready', 'closing the replay shows the lobby\'s version again');
      assert.equal(await host.page.evaluate(() => globalThis.__SP__.store.get().replayVersion), null);

      assert.deepEqual(problemsOf([host, guest]), []);
    } catch (err) {
      console.log('host toasts:', await toastText(host).catch(() => ''), JSON.stringify(await stateOf(host).catch(() => null)), problemsOf([host, guest]).join('\n'));
      await host.shot('fail-host').catch(() => {});
      await guest.shot('fail-guest').catch(() => {});
      throw err;
    } finally {
      await host.close();
      await guest.close();
      await srv.stop();
    }
  });

  test('the vote over 干员调配; a replay outlives a kick (1280×720)', { timeout: 4 * 60 * 1000 }, async () => {
    const srv = await startRealServer({ env: { SP_VERSIONS: 'all' } });
    const P = (await import('puppeteer-core')).default;
    const host = new Client(P, srv.base, 'cover-host', { prefix: 'versions-cover', w: 1280, h: 720 });
    const guest = new Client(P, srv.base, 'cover-guest', { prefix: 'versions-cover', w: 1280, h: 720 });
    try {
      await host.open();
      await host.enter('凯尔希');
      const room = await host.createCoop();
      // the guest's lobby shows 第一期下半; it joins the host's 第二期下半 room
      await guest.open();
      await guest.enter('阿米娅');
      await openWith(guest, '[data-testid="version-switch"]', null, '[data-testid="version-picker"]');
      await pickVersion(guest, 'act1autochess');
      await waitState(guest, (s) => s.version === 'act1autochess' && s.status === 'ready', 'the guest\'s lobby on 第一期下半');
      await guest.page.evaluate((code) => globalThis.__SP__.net.request('room.join', { code }), room.code);
      await waitState(guest, (s) => s.room === 'act2autochess' && s.kind === null, 'the guest in the 第二期下半 room');
      // 干员调配 open (a guest edits the loadout before readying): a vote opened now floats above it
      await openWith(guest, '.rs-loadout', null, '.lo-count');
      await guest.page.waitForSelector('.lo-search input', { visible: true });
      await guest.page.focus('.lo-search input');
      await host.page.evaluate(() => globalThis.__SP__.net.request('room.proposeVersion', { version: 'act1autochess' }));
      await guest.page.waitForSelector('.vervote--covered [data-testid="version-decline"]', { visible: true, timeout: 10000 });
      const top = await guest.page.$eval('.vervote--covered [data-testid="version-decline"]', (b) => {
        const r = b.getBoundingClientRect();
        return !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.vervote--covered');
      });
      assert.equal(top, true, 'the strip is on top of 干员调配');
      assert.equal(await host.page.$('.vervote--covered'), null, 'the host\'s room is not covered: its strip is the room\'s');
      assert.deepEqual(await guest.page.evaluate(() => [...document.querySelectorAll('[data-testid="version-vote"]')]
        .map((e) => [e.classList.contains('vervote--covered'), e.getAttribute('role'), e.getAttribute('aria-hidden'), e.hasAttribute('aria-live'),
          e.querySelector('.vervote__time')?.getAttribute('aria-hidden')])),
      [[false, null, 'true', false, 'true'], [true, 'alertdialog', null, true, 'true']], 'one live region: the floating alertdialog (the ticking countdown left out); the room\'s strip hidden');
      await guest.page.waitForFunction(() => document.activeElement?.matches('.vervote--covered'), { timeout: 5000 });
      await guest.shot('vote-over-loadout');
      await guest.click('.vervote--covered [data-testid="version-decline"]');
      await host.page.waitForFunction(() => [...document.querySelectorAll('.toast__text')].some((e) => e.textContent.includes('阿米娅拒绝了切换版本')), { timeout: 10000 });
      await guest.page.waitForSelector('.vervote--covered', { hidden: true });
      await guest.page.waitForFunction(() => document.activeElement?.matches('.lo-search input'), { timeout: 5000 });
      assert.match(await guest.page.$eval('.lo-count', (e) => e.textContent), /\/112\b/, '第二期下半: 112 operators');
      // agreed from the floating strip: the open 干员调配 follows the switch (its roster is keyed by the content set)
      for (const [id, n] of [['act1autochess', 95], ['act2autochess', 112]]) {
        // (RATE: no proposal for 5 s after a declined vote — server/lobby.js versionRetryMs)
        await host.page.evaluate(async (version) => {
          for (let i = 0; ; i++) {
            try { return await globalThis.__SP__.net.request('room.proposeVersion', { version }); } catch (err) {
              if (err?.code !== 'RATE' || i > 40) throw err;
              await new Promise((r) => setTimeout(r, 250));
            }
          }
        }, id);
        await guest.page.waitForSelector('.vervote--covered [data-testid="version-agree"]', { visible: true, timeout: 10000 });
        await guest.click('.vervote--covered [data-testid="version-agree"]');
        await waitState(guest, (s) => s.room === id && !s.vote && s.config === id, `the room on ${id}`);
        await guest.page.waitForFunction((k) => new RegExp(`/${k}\\b`).test(document.querySelector('.lo-count')?.textContent || ''), { timeout: 20000 }, n);
      }
      await guest.page.keyboard.press('Escape');
      await guest.page.waitForFunction(() => !document.querySelector('.lo-count'), { timeout: 10000 });

      // 统计数据 in the room: the 第二期下半 record re-viewed (the room's version), then the host kicks the guest — the
      // replay keeps 第二期下半 shown (replayVersion) instead of spinning on the lobby's 第一期下半
      await openWith(guest, '.stats-entry', null, '.st');
      const input = await guest.page.$('.st input[type=file]');
      await input.uploadFile(FIXTURE);
      await guest.page.waitForFunction(() => [...document.querySelectorAll('.toast__text')].some((e) => /已导入 2 条记录/.test(e.textContent)), { timeout: 10000 });
      await guest.click('.st-tab[data-tab="history"]');
      await guest.click('.st-table--history tr[data-version="act2autochess"]');
      await guest.page.waitForSelector('.st--replay', { visible: true });
      await guest.page.waitForFunction(() => !document.querySelector('.st--replay .st-loading'), { timeout: 20000 });
      // from here on the wait must never replace the settlement (no flip to the lobby's version and back)
      await guest.page.evaluate(() => {
        globalThis.__waitSeen = false;
        new MutationObserver(() => { if (document.querySelector('.st--replay .st-loading')) globalThis.__waitSeen = true; })
          .observe(document.body, { childList: true, subtree: true });
      });
      const seat = await host.page.evaluate(() => globalThis.__SP__.store.get().room.seats.find((x) => x && x.name === '阿米娅'));
      await host.page.evaluate(({ seat: n, playerId }) => globalThis.__SP__.net.request('room.kick', { seat: n, playerId }), { seat: seat.seat, playerId: seat.playerId });
      await waitState(guest, (s) => s.room === null, 'the guest kicked');
      assert.equal(await guest.page.evaluate(() => globalThis.__SP__.store.get().replayVersion), 'act2autochess');
      await sleep(800);
      assert.equal((await stateOf(guest)).kind, null, 'still 第二期下半');
      assert.equal(await guest.page.$('.st--replay .st-loading'), null, 'the settlement stays drawn');
      assert.equal(await guest.page.evaluate(() => globalThis.__waitSeen), false, 'the wait never showed after the kick');
      await guest.page.keyboard.press('Escape');
      await waitState(guest, (s) => s.kind === 'version' && s.version === 'act1autochess' && s.status === 'ready', 'closing the replay: the lobby\'s 第一期下半');
      assert.deepEqual(problemsOf([host, guest]), []);
    } catch (err) {
      console.log('guest:', await toastText(guest).catch(() => ''), JSON.stringify(await stateOf(guest).catch(() => null)), problemsOf([host, guest]).join('\n'));
      await host.shot('fail-host').catch(() => {});
      await guest.shot('fail-guest').catch(() => {});
      throw err;
    } finally {
      await host.close();
      await guest.close();
      await srv.stop();
    }
  });

  test('a server limited to 第二期下半: a record of another version is not offered for re-viewing (1280×720)', { timeout: 3 * 60 * 1000 }, async () => {
    const srv = await startRealServer({ env: { SP_VERSIONS: 'act2autochess' } });
    const P = (await import('puppeteer-core')).default;
    const c = new Client(P, srv.base, 'default', { prefix: 'versions-default', w: 1280, h: 720 });
    try {
      await c.open();
      await c.enter('凯尔希');
      await openWith(c, '.hub-ach', null, '.achv__more');
      await sleep(400);
      await c.click('.achv__more');
      await c.page.waitForSelector('.st', { visible: true });
      const input = await c.page.$('.st input[type=file]');
      await input.uploadFile(FIXTURE);
      await c.page.waitForFunction(() => [...document.querySelectorAll('.toast__text')].some((e) => /已导入 2 条记录/.test(e.textContent)), { timeout: 10000 });
      await c.click('.st-tab[data-tab="history"]');
      await c.click('[data-testid="stats-version"] [data-version="all"]');
      await c.page.waitForSelector('.st-table--history tr[data-version="act1autochess"]', { visible: true });
      const row = await c.page.$eval('.st-table--history tr[data-version="act1autochess"]', (r) => ({ cls: r.className, title: r.title }));
      assert.doesNotMatch(row.cls, /is-clickable/);
      assert.match(row.title, /这台服务器没有提供「第一期下半」/);
      await c.click('.st-table--history tr[data-version="act1autochess"] td');
      await sleep(600);
      assert.equal(await c.page.$('.st--replay'), null, 'no replay opened');
      assert.equal(await c.page.evaluate(() => globalThis.__SP__.store.get().replayVersion ?? null), null);
      await c.shot('row');
      assert.deepEqual(problemsOf([c]), []);
    } catch (err) {
      await c.shot('fail').catch(() => {});
      throw err;
    } finally {
      await c.close();
      await srv.stop();
    }
  });

  test('phones (667×375): the chip, the picker, the room pill, the strip and the banner fit the width', { timeout: 3 * 60 * 1000 }, async () => {
    const srv = await startRealServer({ env: { SP_VERSIONS: 'all' } });
    const P = (await import('puppeteer-core')).default;
    const host = new Client(P, srv.base, 'phone-host', { prefix: 'versions-phone', w: 667, h: 375 });
    const guest = new Client(P, srv.base, 'phone-guest', { prefix: 'versions-phone', w: 667, h: 375 });
    try {
      await host.open();
      await host.enter('凯尔希');
      await host.page.waitForSelector('[data-testid="version-switch"]', { visible: true });
      assert.equal(await noHScroll(host), true, 'the lobby');
      await openWith(host, '[data-testid="version-switch"]', null, '[data-testid="version-picker"]');
      await sleep(500);
      await host.shot('picker');
      await pickVersion(host, 'act1autochess@V1_1');
      await waitState(host, (s) => s.version === 'act1autochess@V1_1' && s.status === 'ready', 'V1_1 loaded');
      const room = await host.createCoop();
      await guest.open(`?room=${room.code}`);
      await guest.enter('阿米娅');
      await guest.waitFor((s) => s.room?.code === room.code, 'guest joined');
      await waitState(guest, (s) => s.version === 'act1autochess@V1_1' && s.status === 'ready', 'the guest loads V1_1');
      await host.page.waitForSelector('[data-testid="room-version"]', { visible: true });
      const pill = await host.page.$eval('[data-testid="room-version"]', (e) => { const r = e.getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0; });
      assert.equal(pill, true, 'the pill within the screen');
      await openWith(host, '[data-testid="room-version"]', null, '[data-testid="version-picker"]');
      await pickVersion(host, 'act2autochess');
      await guest.page.waitForSelector('[data-testid="version-vote"]', { visible: true, timeout: 10000 });
      for (const c of [host, guest]) assert.equal(await noHScroll(c), true, `${c.label}: the strip wraps`);
      // a short screen gives the banner's line to the seats (the pill's tooltip says it)
      assert.equal(await guest.page.$eval('[data-testid="version-banner"]', (e) => getComputedStyle(e).display), 'none');
      await guest.shot('vote-guest');
      await host.shot('vote-host');
      assert.deepEqual(problemsOf([host, guest]), []);
    } catch (err) {
      await host.shot('fail-host').catch(() => {});
      await guest.shot('fail-guest').catch(() => {});
      throw err;
    } finally {
      await host.close();
      await guest.close();
      await srv.stop();
    }
  });
});
