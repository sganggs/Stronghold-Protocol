// Real regulation match; test console only prepares the strategy/owned-piece fixture.
// Both commands are submitted through the HUD with real click/pointer gestures.
// SP_E2E=1 node --test test/ui/regulation-commands.e2e.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, hasChrome, problemsOf, cameraSettled } from '../e2e/client.mjs';

const request = (c, type, body = {}) => c.page.evaluate((type, body) => globalThis.__SP__.net.request(type, body), type, body);
const state = c => c.page.evaluate(() => globalThis.__SP__.store.get().match.private);

test('regulation HUD: click command, refusal state, and drag onto a highlighted own operator', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 120000,
}, async t => {
  const saved = process.env.SP_TEST_MODE; process.env.SP_TEST_MODE = '1';
  let srv, c;
  try {
    const { startServer } = await import('../../server/index.js');
    try {
      srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false,
        versions: { enabled: 'all' }, matchHost: { matchOptions: { botRehearsal: 0 } } });
    } catch (e) {
      if (e.code === 'EPERM' || e.code === 'EACCES') { t.skip(`Sandbox cannot start the local browser-test server: ${e.message}`); return; }
      throw e;
    }
    const puppeteer = (await import('puppeteer-core')).default;
    c = new Client(puppeteer, srv.url, 'regulation-command', { prefix: 'regulation-command' });
    await c.open('?render=fallback'); await c.enter('CommandTester');
    await request(c, 'room.create', { mode: 'solo', difficulty: 'FUNNY', test: true, version: 'act3autochess@V3_1', soloUnlimited: true });
    await c.page.waitForFunction(() => globalThis.__SP__.data.get('config')?.version?.id === 'act3autochess@V3_1'
      && globalThis.__SP_CONTENT__?.state()?.status === 'ready', { timeout: 30000 });
    await request(c, 'room.start'); await c.waitFor(s => s.phase === 'INFO_CHECK', 'briefing');
    await request(c, 'g.infoReady'); await c.waitFor(s => s.phase === 'BAND_DRAFT', 'draft');
    await request(c, 'g.test', { cmd: 'strategy', args: { id: 'band_fund' } });
    await c.waitFor(s => s.phase === 'CUSTOM_CHECK', 'diy');
    await request(c, 'g.diyBring', { slots: [] });
    await c.waitFor(s => s.phase === 'PREP', 'prep');
    await request(c, 'g.test', { cmd: 'timers', args: { on: false } });
    await c.page.waitForSelector('[data-testid="band-command"]');
    const before = await state(c);
    await c.click('[data-testid="band-command"]');
    await c.page.waitForFunction(() => globalThis.__SP__.store.get().match.private.command.cooldown > 0);
    const used = await state(c); assert.ok(used.funds > before.funds); assert.equal(used.command.cooldown, used.funds - before.funds);
    // on cooldown the button is aria-disabled: click it anyway (the refusal state), funds stay
    await c.click('[data-testid="band-command"]', null, { any: true }); assert.equal((await state(c)).funds, used.funds);
    await request(c, 'g.test', { cmd: 'strategy', args: { id: 'band_survive' } });
    await request(c, 'g.test', { cmd: 'funds', args: { amount: 20 } });
    // a tier-2 operator this match has not excluded (the 规程 bond draw takes some out)
    const chessId = await c.page.evaluate(() => {
      const banned = new Set(globalThis.__SP__.store.get().match.public?.bannedChess || []);
      return Object.values(globalThis.__SP__.data.get('chess')).find(c => c.tier === 2 && !c.isGolden && !c.isDiy && !banned.has(c.chessId)).chessId;
    });
    await request(c, 'g.test', { cmd: 'chess', args: { id: chessId } });
    await cameraSettled(c.page);
    const target = (await state(c)).command.targets[0]; assert.ok(target?.uid);
    // §37.201: 准备 with the drag command unused asks, its 「本局不再提醒」 box mutes that reason for the match
    await c.page.$eval('.readybtn', (b) => b.click());
    await c.page.waitForSelector('.ready-ask');
    assert.match(await c.page.$eval('.ready-ask', (el) => el.textContent), /指令还可以使用/);
    await c.page.click('[data-testid="ready-ask-mute"]');
    await c.page.click('.modal__actions .btn--secondary, .modal__actions button:first-child');
    await c.page.waitForFunction(() => !document.querySelector('.ready-ask'));
    assert.equal((await state(c)).ready, false, 'cancelled: still not ready');
    await c.page.$eval('.readybtn', (b) => b.click());
    await c.page.waitForSelector('.ready-ask');
    const second = await c.page.$eval('.ready-ask', (el) => ({ text: el.textContent, mute: !!el.querySelector('[data-testid="ready-ask-mute"]') }));
    assert.doesNotMatch(second.text, /指令还可以使用/, 'muted for this match: only the funds sentence');
    assert.equal(second.mute, false);
    await c.page.click('.modal__actions .btn--secondary, .modal__actions button:first-child');
    await c.page.waitForFunction(() => !document.querySelector('.ready-ask'));
    const piece = await c.page.waitForSelector(`.ff-piece[data-uid="${target.uid}"]`);
    const box = await piece.boundingBox(), button = await c.page.$('[data-testid="band-command"]'), start = await button.boundingBox();
    await c.page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await c.page.mouse.down();
    await c.page.waitForSelector('.band-command.is-dragging');
    await c.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
    // the aiming arrow follows the pointer and turns orange over the target (§37.201)
    await c.page.waitForFunction(() => document.querySelectorAll('.cmd-aim .cmd-aim__c').length > 1 && document.querySelector('.cmd-aim.is-on'));
    await c.page.mouse.up();
    await c.page.waitForFunction(() => !document.querySelector('.cmd-aim'));
    await c.page.waitForFunction(() => globalThis.__SP__.store.get().match.private.command.usesLeft === 0);
    assert.equal((await state(c)).command.reason, 'exhausted');
    assert.deepEqual(problemsOf([c]), []);
  } finally {
    await c?.close(); await srv?.close();
    if (saved === undefined) delete process.env.SP_TEST_MODE; else process.env.SP_TEST_MODE = saved;
  }
});
