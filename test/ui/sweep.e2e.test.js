// S.W.E.E.P. with cold data, delayed version responses, tab/reopen loops and a different-version room.
// SP_E2E=1 node --test test/ui/sweep.e2e.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, hasChrome, startRealServer, problemsOf, sleep } from '../e2e/client.mjs';
import { VERSIONS, versionSlug } from '../../shared/versions.js';

const enabled = process.env.SP_E2E === '1' && hasChrome();
const shots = process.env.SP_FIX53_SHOTS;
const req = (c, type, body = {}) => c.page.evaluate((type, body) =>
  globalThis.__SP__.net.request(type, body).then(() => null), type, body);
const expected = (version) => {
  const read = (name) => JSON.parse(readFileSync(path.join(ROOT, 'data', version.dir, `${name}.json`), 'utf8'));
  return { bonds: Object.values(read('bonds')).filter((b) => b.bondId).length,
    bands: Object.values(read('bands')).filter((b) => b.bandId).length,
    enemies: Object.values(read('bosses')).filter((b) => b.bossId && !b.hidden).length
      + Object.values(read('factions').types).filter((f) => f.type).length };
};
const shot = async (c, name) => {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await c.page.screenshot({ path: path.join(shots, `${name}.png`) });
};
async function close(c) {
  await c.page.keyboard.press('Escape');
  await c.page.waitForSelector('.sw-tabs', { hidden: true });
}
async function report(c, version, capture = false) {
  const counts = expected(version);
  for (const [tab, label] of [['bands', '策略'], ['enemies', '敌方'], ['bonds', '盟约']]) {
    await c.click('.sw-tab', label);
    await c.page.waitForFunction((tab, count) => document.querySelector('.sw-body')?.dataset.tab === tab
      && document.querySelectorAll('.sw-tile').length === count && document.querySelector('.sw-left .sw-hero__name'),
    { timeout: 30000 }, tab, counts[tab]);
    const rows = await c.page.$$eval('.sw-sec', (els) => els.map((e) => ({
      expected: Number(e.querySelector('.sw-sec__name small').textContent), actual: e.querySelectorAll('.sw-tile').length,
    })));
    assert.ok(rows.every((r) => r.expected === r.actual && r.actual > 0), JSON.stringify(rows));
    // Check the last tile too: a total alone can miss a collapsed/clipped grid or a missing second section.
    const tiles = await c.page.$$('.sw-tile');
    for (const tile of [tiles[0], tiles.at(-1)]) {
      await tile.evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await tile.click();
      const visible = await tile.evaluate((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 16 && r.height > 16 && e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      });
      assert.ok(visible, `${version.id} ${tab}: tile is visible and hit-testable`);
      assert.ok(await c.page.$eval('.sw-hero__name', (e) => e.textContent.trim()), `${version.id} ${tab}: detail`);
    }
    if (capture) {
      await c.page.$eval('.sw-right', (e) => { e.scrollTop = 0; });
      await shot(c, `sweep-${versionSlug(version)}-${tab}`);
    }
  }
}

test('S.W.E.E.P.: pending version never presents the previous report; 64 opens with throttling and room round trips', {
  skip: !enabled, timeout: 6 * 60 * 1000,
}, async (t) => {
  const srv = await startRealServer({ env: { SP_VERSIONS: 'all' } });
  const P = (await import('puppeteer-core')).default;
  const c = new Client(P, srv.base, 'sweep');
  const host = new Client(P, srv.base, 'sweep-host');
  let held = null, holdVersion = null;
  const network = [];
  const warnings = [];
  try {
    await c.open();
    c.page.on('console', (m) => { if (m.type() === 'warn' || m.type() === 'warning') warnings.push(m.text()); });
    const cdp = await c.page.createCDPSession();
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 120, downloadThroughput: 1024 * 1024, uploadThroughput: 512 * 1024,
    });
    c.page.on('response', (r) => { if (/\/data\/|\/cs\//.test(r.url())) network.push({ url: r.url(), status: r.status() }); });
    await c.page.setRequestInterception(true);
    c.page.on('request', (r) => {
      // Hold one real response until the report opens: deterministic slow-link timing, with real server bytes.
      if (holdVersion && r.url().includes(`/data/${holdVersion.dir}bands.json`)) held = r;
      else void r.continue();
    });
    await c.enter('报告验收');
    await host.open(); await host.enter('同盟验收');
    for (const [index, version] of VERSIONS.entries()) {
      if (index) {
        holdVersion = version;
        await c.click('[data-testid="version-switch"]');
        await c.click(`.verpick__pick[data-version="${version.id}"]`);
      }
      await c.click('.lobby-sweep');
      if (index) {
        for (let n = 0; !held && n < 100; n++) await sleep(50);
        assert.ok(held, 'the version data request is still pending');
        await c.click('.sw-tab', '策略');
        await sleep(200);
        await shot(c, `pending-${versionSlug(version)}`);
        const pending = await c.page.evaluate(() => ({
          loading: !!document.querySelector('.sw-loading'), tiles: document.querySelectorAll('.sw-tile').length,
        }));
        assert.deepEqual(pending, { loading: true, tiles: 0 }, 'never show the previous version while this one is loading');
        holdVersion = null;
        if (index === VERSIONS.length - 1) {
          // A delivered but corrupt version file must expose retry, never a blank/previous report.
          await held.respond({ status: 200, contentType: 'application/json', body: '{}' }); held = null;
          await c.page.waitForSelector('.sw-loading[role="alert"]', { visible: true });
          assert.equal(await c.page.$$eval('.sw-tile', (els) => els.length), 0);
          await shot(c, 'sweep-version-failed');
          await c.click('.sw-loading button', '重试');
        } else { await held.continue(); held = null; }
      }
      await report(c, version, true); await close(c);
      // A room of a different version temporarily replaces this lobby's set, then restores it on leaving.
      const other = VERSIONS[(index + VERSIONS.length - 1) % VERSIONS.length];
      await req(host, 'room.create', { mode: 'coop', version: other.id });
      const code = (await host.st()).room.code;
      await req(c, 'room.join', { code });
      await c.page.waitForFunction((id) => {
        const s = globalThis.__SP_CONTENT__.state();
        return id === 'act2autochess' ? s.status === 'idle' : s.status === 'ready' && s.version === id;
      }, { timeout: 30000 }, other.id);
      await c.click('.rs-exit');
      await c.page.waitForSelector('.lobby-sweep', { visible: true });
      await req(host, 'room.leave');
      await host.page.evaluate(() => globalThis.__SP__.store.set({ room: null }));
      for (let i = 1; i < 16; i++) {
        await c.click('.lobby-sweep');
        await report(c, version); await close(c);
      }
      t.diagnostic(`${version.id}: 16 opens, 48 tab checks, cross-version room returned; no missing tiles`);
    }
    assert.deepEqual(problemsOf([c, host]), []);
  } catch (e) {
    await shot(c, 'sweep-failure').catch(() => {});
    throw e;
  } finally {
    holdVersion = null;
    if (held) await held.continue().catch(() => {});
    if (shots) writeFileSync(path.join(shots, 'sweep-network.json'), JSON.stringify({ network, warnings, problems: problemsOf([c, host]) }, null, 2) + '\n');
    await c.close(); await host.close(); await srv.stop();
  }
});

// DOM presence and hit testing alone accept opacity:0. Check the whole ancestor chain as well.
async function assertPainted(c, selector) {
  const bad = await c.page.$$eval(selector, (els) => {
    if (!els.length) return ['missing elements'];
    return els.flatMap((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return [`${el.className}: empty box`];
      for (let e = el; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (Number(s.opacity) < .99 || s.visibility !== 'visible' || s.display === 'none') {
          return [`${el.className}: ${e.className} opacity=${s.opacity} visibility=${s.visibility}`];
        }
      }
      return [];
    });
  });
  assert.deepEqual(bad, [], `${selector} stays painted without advancing the animation clock`);
}

test('S.W.E.E.P.: paused entry animations keep the report, selections and codex visible', {
  skip: !enabled, timeout: 120000,
}, async (t) => {
  const srv = await startRealServer();
  const P = (await import('puppeteer-core')).default;
  const c = new Client(P, srv.base, 'sweep-paused');
  try {
    await c.open(); await c.enter('暂停动画验收');
    // Finish the lobby's unrelated entry before freezing newly opened report/codex animations.
    await c.page.waitForFunction(() => !document.getAnimations().some((a) =>
      a.effect.getTiming().iterations !== Infinity && a.playState === 'running'));
    const cdp = await c.page.createCDPSession();
    await cdp.send('Animation.enable');
    for (const mode of ['cdp', 'web-animations', 'disabled', 'reduced-motion']) {
      await t.test(mode, async () => {
        let style;
        const freeze = async () => {
          if (mode !== 'web-animations') return;
          await c.page.evaluate(() => {
            for (const a of document.getAnimations()) {
              const modal = a.effect.target?.closest('.modal');
              if (modal?.querySelector('.sw, .sw-codex')) { a.pause(); a.currentTime = 0; }
            }
          });
        };
        try {
          if (mode === 'cdp') await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
          if (mode === 'disabled') style = await c.page.addStyleTag({ content: '* { animation: none !important; transition: none !important; }' });
          if (mode === 'reduced-motion') await c.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
          await c.click('.lobby-sweep');
          for (const [tab, label] of [['bands', '策略'], ['bonds', '盟约'], ['enemies', '敌方']]) {
            await c.click('.sw-tab', label);
            await c.page.waitForFunction((tab) => document.querySelector('.sw-body')?.dataset.tab === tab
              && !!document.querySelector('.sw-detail'), {}, tab);
            await freeze();
            await shot(c, `animation-${mode}-${tab}`);
            await assertPainted(c, '.sw-top, .sw-hero__name, .sw-text, .sw-sec__head, .sw-tile');
            const tiles = await c.page.$$('.sw-tile');
            for (const tile of [tiles.at(-1), tiles[0]]) {
              const title = await tile.evaluate((el) => el.title);
              await tile.evaluate((el) => el.scrollIntoView({ block: 'center' }));
              await tile.click();
              await c.page.waitForFunction((title) => document.querySelector('.sw-hero__name')?.textContent === title, {}, title);
              await freeze();
              await assertPainted(c, '.sw-hero__name, .sw-text, .sw-tile.is-on');
              assert.ok(await tile.evaluate((el) => {
                const r = el.getBoundingClientRect();
                return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
              }), 'selected tile remains hit-testable');
            }
            // Publish ready-data notifications while the entry clock is frozen. Use a locale with no
            // overlays (Chinese fallback), so this checks rerenders without introducing network timing.
            const retained = await c.page.evaluate(async () => {
              const box = document.querySelector('.sw'), detail = document.querySelector('.sw-detail');
              const animations = box.getAnimations({ subtree: true });
              const { data } = await import('/js/data.js');
              await data.setLocale(data.locale() === 'zh' ? 'en' : 'zh', []);
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              const now = box.getAnimations({ subtree: true });
              // (a transition that ran out meanwhile is not dropped: under reduced motion the tab's 1 ms colour fades
              // finish within the two frames; a remount cancels — playState 'idle' — and still fails)
              return box === document.querySelector('.sw') && detail === document.querySelector('.sw-detail')
                && animations.every((a) => now.includes(a) || a.playState === 'finished');
            });
            assert.ok(retained, 'data updates retain the report, detail and running animations');
            await freeze();
            await assertPainted(c, '.sw-hero__name, .sw-tile');
          }
          await c.page.$eval('.sw-allcodex', (el) => el.scrollIntoView({ block: 'center' }));
          await c.click('.sw-allcodex');
          await c.page.waitForSelector('.sw-cd__name');
          await freeze();
          await shot(c, `animation-${mode}-codex`);
          await assertPainted(c, '.sw-codex__title, .sw-cd__name, .sw-stat, .sw-codex__list .sw-eth');
          const enemies = await c.page.$$('.sw-codex__list .sw-eth');
          const lastEnemy = await enemies.at(-1).evaluate((el) => el.title);
          await enemies.at(-1).evaluate((el) => el.scrollIntoView({ block: 'center' }));
          await enemies.at(-1).click();
          await c.page.waitForFunction((name) => document.querySelector('.sw-cd__name')?.textContent.includes(name), {}, lastEnemy);
          await freeze();
          await assertPainted(c, '.sw-cd__name, .sw-stat');
          if (mode === 'reduced-motion' || mode === 'disabled') {
            assert.equal(await c.page.$eval('.sw', (el) => el.getAnimations({ subtree: true }).length), 0);
          }
          await c.page.keyboard.press('Escape');
          await c.page.waitForSelector('.sw-codex', { hidden: true });
          await assertPainted(c, '.sw-hero__name, .sw-tile');
        } finally {
          await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
          await c.page.emulateMediaFeatures([]);
          if (style) await style.evaluate((el) => el.remove());
          if (await c.page.$('.sw-codex')) {
            await c.page.keyboard.press('Escape');
            await c.page.waitForSelector('.sw-codex', { hidden: true });
          }
          if (await c.page.$('.sw')) await close(c);
        }
      });
    }
    assert.deepEqual(problemsOf([c]), []);
  } finally {
    await c.close(); await srv.stop();
  }
});
