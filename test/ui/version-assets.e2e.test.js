// SP_E2E=1: real lobby + version-host matches, using installed official art.
// SP_VERSION_ASSET_SHOTS optionally saves review screenshots and the observed match coverage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { VERSIONS, versionSlug } from '../../shared/versions.js';
import { Client, hasChrome, problemsOf, sleep } from '../e2e/client.mjs';

const enabled = process.env.SP_E2E === '1' && hasChrome();
const out = process.env.SP_VERSION_ASSET_SHOTS;
const req = (c, type, body = {}) => c.page.evaluate((type, body) => globalThis.__SP__.net.request(type, body).then(() => null), type, body);
const shot = async (c, name) => {
  if (!out) return;
  mkdirSync(out, { recursive: true });
  await c.page.waitForFunction(() => !document.getAnimations().some((a) =>
    /^(tr|ps|rs)-/.test(String(a.animationName)) && a.playState === 'running'
      && a.effect?.getTiming().iterations !== Infinity), { timeout: 10000 });
  await sleep(400);
  await c.page.screenshot({ path: path.join(out, name + '.png') });
};
async function images(c, selector) {
  await c.page.waitForFunction((selector) => {
    const images = [...document.querySelectorAll(selector)].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    });
    return images.length && images.every((e) => e.complete && e.naturalWidth > 0);
  }, { timeout: 20000 }, selector);
}
async function close(c, selector) {
  await c.page.keyboard.press('Escape');
  await c.page.waitForSelector(selector, { hidden: true, timeout: 10000 });
}

for (const version of VERSIONS.filter((v) => v.dir)) test(`${version.label}: lobby pictures, real match and settlement`, {
  skip: !enabled, timeout: 9 * 60 * 1000,
}, async (t) => {
  const { startServer } = await import('../../server/index.js');
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true,
    matchHost: { matchOptions: { timerScale: 0.05, combatSpeed: 32, botRehearsal: 0 } } });
  const P = (await import('puppeteer-core')).default;
  const c = new Client(P, srv.url, versionSlug(version), { w: 1600, h: 900 });
  const name = versionSlug(version);
  const seen = { version: version.id, phases: [], operators: [], enemies: [], models: 0, rounds: 0 };
  try {
    await c.open(); await c.enter('资源验收');
    await c.click('[data-testid="version-switch"]');
    await c.click(`.verpick__pick[data-version="${version.id}"]`);
    await c.page.waitForFunction((id) => globalThis.__SP_CONTENT__?.state().version === id && globalThis.__SP_CONTENT__.state().status === 'ready', { timeout: 30000 }, version.id);
    await c.click('.lobby-sweep');
    for (const tab of ['盟约', '策略']) {
      await c.click('.sw-tab', tab);
      await images(c, '.sw-body img');
    }
    await shot(c, `${name}-sweep`);
    await close(c, '.sw-tabs');
    await c.click('.lobby-loadout');
    await images(c, '.lo-card img');
    await shot(c, `${name}-loadout-list`);
    await c.click('[data-testid="loadout-view-deck"]');
    await images(c, '.lo-op img');
    await shot(c, `${name}-loadout-cards`);
    await c.click('[data-testid="loadout-ownership"]');
    await images(c, '.lo img');
    await shot(c, `${name}-ownership`);
    await c.click('.lo-back');
    await c.page.$eval('.lo-op--diy[data-diy-tier="6"]', (e) => e.scrollIntoView({ block: 'center', inline: 'center' }));
    await c.click('.lo-op--diy[data-diy-tier="6"]');
    await images(c, '.lo img');
    await shot(c, `${name}-diy`);
    await close(c, '.lo');
    await c.createCoop();
    await c.click('[data-testid="seat-card-pick"]');
    await images(c, '.cardpick img');
    await shot(c, `${name}-namecard`);
    await close(c, '.cardpick');
    for (let i = 0; i < 3; i++) await req(c, 'room.addBot');
    await req(c, 'room.start');
    await c.page.waitForFunction(() => globalThis.__SP__.store.get().match.public?.phase === 'INFO_CHECK', { timeout: 60000 });
    await req(c, 'g.infoReady'); await req(c, 'g.autoplay', { on: true });
    let prepShot = false, battleShot = false;
    const end = Date.now() + 6 * 60 * 1000;
    while (Date.now() < end) {
      const s = await c.page.evaluate(() => {
        const s = globalThis.__SP__.store.get(), r = globalThis.__SP_VIEW__?.raw;
        const views = [...(r?.debug?.views?.values() || [])];
        return { phase: s.match.public?.phase, round: s.match.public?.round, result: !!s.match.result,
          board: s.match.private?.board?.length || 0,
          models: views.filter((v) => v.actor && v.spineReady).length,
          operators: views.filter((v) => !v.isEnemy).map((v) => v.info?.spine).filter(Boolean),
          enemies: views.filter((v) => v.isEnemy).map((v) => v.info?.defId).filter(Boolean) };
      });
      seen.rounds = Math.max(seen.rounds, s.round || 0);
      seen.phases = [...new Set([...seen.phases, s.phase])];
      seen.operators = [...new Set([...seen.operators, ...s.operators])];
      seen.enemies = [...new Set([...seen.enemies, ...s.enemies])];
      seen.models = Math.max(seen.models, s.models);
      if (!prepShot && s.phase === 'PREP' && s.board && s.models) {
        await req(c, 'g.autoplay', { on: false });
        await c.page.waitForSelector('.awayov', { hidden: true });
        await shot(c, `${name}-shop-board`); prepShot = true;
        await req(c, 'g.autoplay', { on: true });
      }
      if (!battleShot && s.phase === 'COMBAT' && s.models > 2) {
        await req(c, 'g.autoplay', { on: false });
        await c.page.waitForSelector('.awayov', { hidden: true });
        await shot(c, `${name}-battle`); battleShot = true;
        await req(c, 'g.autoplay', { on: true });
      }
      if (s.result) break;
      await sleep(100);
    }
    assert.ok((await c.st()).result, JSON.stringify(seen));
    assert.ok(seen.rounds >= 3 && seen.models > 0, JSON.stringify(seen));
    await c.page.waitForSelector('.settle', { visible: true, timeout: 30000 });
    await c.click('[data-testid="settle-intro"]', null, { optional: true, timeout: 3000 });
    await images(c, '.settle img');
    await shot(c, `${name}-settlement`);
    const problems = problemsOf([c]);
    const layoutNotices = problems.filter((p) => p.includes('console: [app] uncaught error ResizeObserver loop completed with undelivered notifications.'));
    if (layoutNotices.length) t.diagnostic(`${layoutNotices.length} existing ResizeObserver layout notices; recorded separately from asset/network errors`);
    if (out) writeFileSync(path.join(out, `${name}-match.json`), JSON.stringify({ ...seen, layoutNotices }, null, 2) + '\n');
    assert.deepEqual(problems.filter((p) => !layoutNotices.includes(p)), []);
  } catch (e) {
    await shot(c, `${name}-failure`).catch(() => {});
    throw e;
  } finally { await c.close(); await srv.close(); }
});
