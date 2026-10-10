// Real browser / server checks for local identity recovery, per-operator voice, install offers and large text.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
describe('0.2.3 follow-up client features', { skip: !ENABLED }, () => {
  let server, browser, base;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${server.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  });
  after(async () => { await browser?.close(); await server?.close(); });
  async function pageIn(ctx, phone = false, random = null) {
    const page = await ctx.newPage();
    await page.setViewport({ width: phone ? 844 : 1440, height: phone ? 390 : 900 });
    if (random != null) await page.evaluateOnNewDocument((value) => { Math.random = () => value; }, random);
    await page.evaluateOnNewDocument(() => { localStorage.setItem('sp.name', 'Recovery Test'); sessionStorage.setItem('sp.entered', '1'); });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online' && document.querySelector('.lobby-screen'));
    return page;
  }
  test('closed second window resumes the same server player and match through the recovery UI', async () => {
    const ctx = await browser.createBrowserContext();
    try {
      const a = await pageIn(ctx), b = await pageIn(ctx);
      const before = await b.evaluate(async () => {
        const { net, store } = globalThis.__SP__;
        await net.request('room.create', { mode: 'solo', difficulty: 'NORMAL' });
        await net.request('room.start', {});
        return { id: store.get().me.playerId, code: store.get().room.code };
      });
      await b.waitForFunction(() => globalThis.__SP__.store.get().match.public?.phase === 'INFO_CHECK');
      await a.waitForSelector('[data-testid="resume-local-match"]');
      const refused = await a.evaluate(async () => { const { identity } = await import('/js/net.js'); return identity.resume(identity.recoverable()[0].id); });
      assert.equal(refused, false, 'live window is not displaced');
      assert.equal(await b.evaluate(() => globalThis.__SP__.store.get().connection.status), 'online');
      await b.close();
      await a.click('[data-testid="resume-local-match"]');
      await a.waitForSelector('.modal .btn--block');
      await a.evaluate(() => { globalThis.recoveryDocument = true; });
      await a.click('.modal .btn--block');
      await a.waitForFunction(() => globalThis.__SP__?.store.get().match.public?.phase === 'INFO_CHECK');
      const after = await a.evaluate(() => { const s = globalThis.__SP__.store.get(); return { id: s.me.playerId, code: s.room.code }; });
      assert.deepEqual(after, before);
      assert.equal(await a.evaluate(() => globalThis.recoveryDocument), true, 'welcome arrives in the same document');
    } finally { await ctx.close(); }
  });
  test('a refreshing match window keeps its seat while its init is waiting and another window clicks recovery', async () => {
    const ctx = await browser.createBrowserContext();
    try {
      const guest = await pageIn(ctx, false, 0.01), owner = await pageIn(ctx, false, 0.99);
      const before = await owner.evaluate(async () => {
        const { net, store } = globalThis.__SP__;
        await net.request('room.create', { mode: 'solo', difficulty: 'NORMAL' });
        await net.request('room.start', {});
        return { id: store.get().me.playerId, code: store.get().room.code, token: sessionStorage.getItem('sp.token') };
      });
      const guestId = await guest.evaluate(() => globalThis.__SP__.store.get().me.playerId);
      await owner.waitForFunction(() => globalThis.__SP__.store.get().match.public?.phase === 'INFO_CHECK');
      await guest.waitForSelector('[data-testid="resume-local-match"]');
      await owner.evaluateOnNewDocument(() => {
        // Hold precisely the timeout scheduled immediately after the real identity query.
        // Messages still use Chrome's BroadcastChannel; only init's completion is controlled.
        const Channel = globalThis.BroadcastChannel, timer = globalThis.setTimeout;
        let hold = false;
        globalThis.BroadcastChannel = class extends Channel {
          constructor(name) { super(name); this.identityChannel = name === 'sp.identity'; }
          postMessage(message) {
            super.postMessage(message);
            if (this.identityChannel && message.type === 'who') hold = true;
          }
        };
        globalThis.setTimeout = (fn, ms, ...args) => {
          if (hold) {
            hold = false;
            globalThis.finishIdentityInit = () => fn(...args);
            return 0;
          }
          return timer(fn, ms, ...args);
        };
      });
      await owner.reload({ waitUntil: 'domcontentloaded' });
      await owner.waitForFunction(() => typeof globalThis.finishIdentityInit === 'function');
      await guest.bringToFront();
      await guest.click('[data-testid="resume-local-match"]');
      await guest.waitForSelector('.modal .btn--block');
      await guest.click('.modal .btn--block');
      await guest.waitForFunction(() => document.body.textContent.includes('此对局仍在其他窗口中'));
      assert.equal(await owner.evaluate(() => sessionStorage.getItem('sp.token')), before.token);
      await owner.evaluate(() => globalThis.finishIdentityInit());
      await owner.waitForFunction(() => globalThis.__SP__?.store.get().match.public?.phase === 'INFO_CHECK');
      const after = await owner.evaluate(() => {
        const s = globalThis.__SP__.store.get();
        return { id: s.me.playerId, code: s.room.code, token: sessionStorage.getItem('sp.token') };
      });
      assert.deepEqual(after, before);
      assert.equal(await guest.evaluate(() => globalThis.__SP__.store.get().me.playerId), guestId);
      for (const page of [guest, owner]) {
        const pong = await page.evaluate(() => globalThis.__SP__.net.request('ping', { c: Date.now() }));
        assert.equal(pong.t, 'pong');
        assert.equal(await page.evaluate(() => globalThis.__SP__.store.get().connection.status), 'online');
      }
    } finally { await ctx.close(); }
  });
  test('co-op opening reroll shows a unanimous vote, clears stale readiness and can be rejected', { timeout: 45000 }, async () => {
    const ctx = await browser.createBrowserContext();
    try {
      const host = await pageIn(ctx), guest = await pageIn(ctx);
      const code = await host.evaluate(async () => {
        const { net, store } = globalThis.__SP__;
        await net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' });
        return store.get().room.code;
      });
      await guest.evaluate(async (code) => {
        const { net } = globalThis.__SP__;
        await net.request('room.join', { code }); await net.request('room.ready', { ready: true });
      }, code);
      await host.evaluate(() => globalThis.__SP__.net.request('room.start', {}));
      for (const p of [host, guest]) await p.waitForFunction(() => globalThis.__SP__.store.get().match.public?.phase === 'INFO_CHECK');
      await guest.evaluate(() => globalThis.__SP__.net.request('g.infoReady', { setupRevision: 0 }));
      await host.waitForSelector('.brief-reroll button');
      await host.bringToFront();
      await host.click('.brief-reroll button');
      await guest.waitForSelector('.brief-reroll .btn--primary');
      assert.equal(await guest.evaluate(() => globalThis.__SP__.store.get().match.public.deadline), 0);
      await guest.bringToFront();
      await guest.click('.brief-reroll .btn--primary');
      for (const p of [host, guest]) await p.waitForFunction(() => globalThis.__SP__.store.get().match.public?.setupRevision === 1);
      const state = await guest.evaluate(() => globalThis.__SP__.store.get().match.public);
      assert.equal(state.rerollVote, null);
      assert.ok(state.players.filter((p) => !p.isBot).every((p) => !p.ready));
      await host.waitForFunction(() => !!document.querySelector('.brief-reroll button:not(:disabled)'));
      // Wait out the documented server anti-burst interval before a second request.
      await new Promise((resolve) => setTimeout(resolve, 350));
      await host.bringToFront();
      await host.click('.brief-reroll button');
      await guest.waitForSelector('.brief-reroll .btn--danger');
      await guest.bringToFront();
      await guest.click('.brief-reroll .btn--danger');
      await host.waitForFunction(() => !globalThis.__SP__.store.get().match.public.rerollVote);
      assert.equal(await host.evaluate(() => globalThis.__SP__.store.get().match.public.setupRevision), 1);
    } finally { await ctx.close(); }
  });
  test('operator voice selection persists across reload and follows global after reset', async () => {
    const ctx = await browser.createBrowserContext();
    try {
      const page = await pageIn(ctx, true);
      const open = async () => { await page.evaluate(async () => (await import('/js/ui/loadoutSync.js')).openLoadout()); await page.waitForSelector('.lo-card__pick'); await page.click('.lo-card__pick'); await page.waitForSelector('[data-voice-char] select', { visible: true }); };
      await open();
      const id = await page.$eval('[data-voice-char]', (e) => e.dataset.voiceChar);
      await page.select('[data-voice-char] select', 'jp');
      assert.equal(await page.evaluate(async (id) => (await import('/js/audio.js')).audio.voiceOverrides[id], id), 'jp');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online');
      await open();
      assert.equal(await page.$eval('[data-voice-char] select', (e) => e.value), 'jp');
      await page.select('[data-voice-char] select', '');
      assert.equal(await page.evaluate((id) => JSON.parse(localStorage.getItem('sp.pref.settings')).voiceOverrides[id], id), undefined);
    } finally { await ctx.close(); }
  });
  test('install manifest is eligible and a dismissed offer is consumed through the actual button', async () => {
    const ctx = browser.defaultBrowserContext();
    let page;
    try {
      page = await pageIn(ctx);
      const client = await page.createCDPSession();
      const manifest = await client.send('Page.getAppManifest');
      assert.deepEqual(manifest.errors, []);
      const icons = await page.evaluate(async () => {
        const m = await (await fetch('/manifest.json')).json();
        const entries = [...m.icons, ...[...document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')]
          .map((link) => ({ src: link.getAttribute('href'), purpose: link.rel }))];
        return Promise.all(entries.map(async (entry) => {
          const response = await fetch(entry.src);
          if (!response.ok) throw new Error(`${entry.src}: ${response.status}`);
          const img = new Image(); img.src = entry.src; await img.decode();
          return { purpose: entry.purpose, width: img.naturalWidth, height: img.naturalHeight };
        }));
      });
      assert.deepEqual(icons.filter((i) => i.purpose === 'maskable').map((i) => i.width).sort((a, b) => a - b), [192, 512]);
      assert.ok(icons.every((i) => i.width > 0 && i.width === i.height));
      assert.ok(icons.some((i) => i.purpose === 'apple-touch-icon' && i.width === 180));
      const install = await client.send('Page.getInstallabilityErrors');
      assert.deepEqual(install.installabilityErrors, []);
      await page.evaluate(() => {
        const e = new Event('beforeinstallprompt', { cancelable: true });
        window.promptCalls = 0;
        e.prompt = async () => { window.promptCalls++; return { outcome: 'dismissed' }; };
        window.dispatchEvent(e);
      });
      await page.waitForSelector('[data-testid="pwa-install"]');
      await page.click('[data-testid="pwa-install"]');
      await page.waitForFunction(() => !document.querySelector('[data-testid="pwa-install"]'));
      assert.equal(await page.evaluate(() => window.promptCalls), 1);
    } finally { await page?.close(); }
  });
  test('extra-large settings stay within a landscape phone in every shipped interface language', async () => {
    const ctx = await browser.createBrowserContext();
    try {
      const page = await pageIn(ctx, true);
      for (const lang of ['zh-CN', 'en', 'ja', 'ko', 'zh-TW']) {
        await page.evaluate(async (lang) => {
          await (await import('/js/ui/lang.js')).switchLang(lang);
          (await import('/js/ui/settings.js')).updateSettings({ textSize: 'xl' });
        }, lang);
        await page.click('[data-testid="settings-btn"]');
        await page.waitForSelector('.modal .set-list');
        const overflow = await page.$eval('.modal__body', (e) => e.scrollWidth - e.clientWidth);
        const excess = await page.$eval('.modal__body', (e) => { const right = e.getBoundingClientRect().right; return [...e.querySelectorAll('*')].filter((x) => x.getBoundingClientRect().right > right + 1).map((x) => [x.className, x.textContent.slice(0, 50), Math.round(x.getBoundingClientRect().width)]); });
        assert.ok(overflow <= 1, `${lang}: settings overflow ${overflow} ${JSON.stringify(excess)}`);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('.modal .set-list'));
      }
    } finally { await ctx.close(); }
  });
});
