// Only the actual room warning/dialog interaction needs Chrome; protocol and Worker logic have Node coverage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../server/index.js';

const CHROME = process.env.CHROME_PATH;
const ENABLED = process.env.SP_E2E === '1' && !!CHROME && existsSync(CHROME);

test('default and unsupported trust settings leave the real room screen without audit controls', {
  skip: !ENABLED && 'set SP_E2E=1 and CHROME_PATH', timeout: 60000,
}, async (t) => {
  const previous = process.env.SP_TRUST;
  t.after(() => { if (previous === undefined) delete process.env.SP_TRUST; else process.env.SP_TRUST = previous; });
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--mute-audio'] });
  t.after(() => browser.close());
  for (const setting of [undefined, 'unsupported']) {
    if (setting === undefined) delete process.env.SP_TRUST; else process.env.SP_TRUST = setting;
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    t.after(() => srv.close());
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: 'networkidle0' });
    await page.evaluate(async () => {
      const { net } = await import('/js/net.js');
      const { store } = await import('/js/store.js');
      store.patch('session', { entered: true });
      net.setName('DefaultTest');
    });
    await page.waitForFunction(async () => (await import('/js/net.js')).net.status === 'online');
    await page.evaluate(async () => (await import('/js/net.js')).net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' }));
    await page.waitForSelector('.room-bar__opts');
    assert.equal(await page.$('[data-testid="trust-audit"]'), null);
    assert.equal(await page.evaluate(async () => Object.hasOwn((await import('/js/store.js')).store.get().room, 'trustAudit')), false);
    await page.close();
    await srv.close();
  }
});

test('host warning cancellation, acknowledgment and room footer controls in the real page', {
  skip: !ENABLED && 'set SP_E2E=1 and CHROME_PATH', timeout: 60000,
}, async (t) => {
  const previous = process.env.SP_TRUST;
  process.env.SP_TRUST = 'L0';
  t.after(() => { if (previous === undefined) delete process.env.SP_TRUST; else process.env.SP_TRUST = previous; });
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--mute-audio'] });
  t.after(async () => { await browser.close(); await srv.close(); });
  const page = await browser.newPage();
  const out = new URL('../e2e/out/', import.meta.url);
  mkdirSync(out, { recursive: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    const { net } = await import('/js/net.js');
    const { store } = await import('/js/store.js');
    const { setLang } = await import('/shared/i18n.js');
    setLang('zh-CN');
    store.patch('session', { entered: true });
    net.setName('Tester');
  });
  await page.waitForFunction(async () => (await import('/js/net.js')).net.status === 'online');
  await page.evaluate(async () => (await import('/js/net.js')).net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' }));
  const button = '[data-testid="trust-audit"]';
  await page.waitForSelector(button);
  assert.equal(await page.$eval(button, (el) => el.getAttribute('aria-checked')), 'false');
  await page.click(button);
  await page.waitForSelector('.modal__text');
  assert.match(await page.$eval('.modal__text', (el) => el.textContent), /八分之一.*首领.*卡顿或延迟/);
  await page.screenshot({ path: fileURLToPath(new URL('trust-audit-warning.png', out)) });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal', { hidden: true });
  assert.equal(await page.$eval(button, (el) => el.getAttribute('aria-checked')), 'false');
  await page.click(button);
  await page.waitForSelector('.modal__text');
  await page.click('.modal button[data-autofocus]');
  await page.waitForFunction((selector) => document.querySelector(selector)?.getAttribute('aria-checked') === 'true', {}, button);
  await page.click(button);
  await page.waitForFunction((selector) => document.querySelector(selector)?.getAttribute('aria-checked') === 'false', {}, button);
  for (const width of [1280, 844]) {
    await page.setViewport({ width, height: width === 844 ? 390 : 720 });
    const box = await page.$eval(button, (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight }; });
    assert.ok(box.x >= 0 && box.y >= 0 && box.right <= box.width && box.bottom <= box.height, JSON.stringify(box));
    await page.screenshot({ path: fileURLToPath(new URL(`trust-audit-room-${width}.png`, out)) });
  }
  // Exercise the actual same-origin module URL and receiver; Node tests separately cover server timing and disputes.
  const { makeMatch } = await import('../match/harness.js');
  const { createBattleFromSpec, compactResult } = await import('../../server/sim/spec.js');
  const { runHeadless } = await import('../../server/match/fields.js');
  const { trustHash } = await import('../../shared/trust.js');
  const { trustResultHash } = await import('../../server/match/match/trust.js');
  const h = makeMatch({ humans: 1, clientCombat: true, clients: false });
  t.after(() => h.m.dispose());
  h.start();
  assert.ok(h.drive(() => h.m.phase === 'COMBAT'));
  const spec = h.m.fields[0].spec;
  const expected = compactResult(runHeadless(createBattleFromSpec(spec, h.m.ds, { quiet: true, recordEvents: false }), { players: ['p_0'] }).result);
  const reply = await page.evaluate(async (task) => {
    const { installTrustVerifier } = await import('/js/battle/trust.js');
    return new Promise((resolve, reject) => {
      const handlers = new Map();
      let receiver;
      const timer = setTimeout(() => { receiver.dispose(); reject(new Error('verification Worker timeout')); }, 15000);
      receiver = installTrustVerifier({ net: { on(t, fn) { handlers.set(t, fn); return () => handlers.delete(t); },
        send(t, fields) { clearTimeout(timer); receiver.dispose(); resolve({ t, ...fields }); } } });
      handlers.get('b.verify')(task);
    });
  }, { taskId: 'browser-check', spec, specHash: trustHash(spec) });
  assert.deepEqual(reply, { t: 'b.verifyResult', taskId: 'browser-check', specHash: trustHash(spec), digest: trustResultHash(expected) });
  assert.deepEqual(errors, []);
});
